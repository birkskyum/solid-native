import {
  HOST_CAUSAL_OPERATION_ID_MAX_LENGTH,
  HOST_CONTRACT_VERSION,
  type CommitPriority,
  type CommitSequence,
  type HostCapabilities,
  type HostCommit,
  type HostCommitResult,
  type HostCausalContext,
  type HostLifecycleEvent,
  type HostLifecycleListener,
  type HostMutation,
  type HostProps,
  type HostValue,
  type NativeComponentDescriptor,
  type NativeEvent,
  type NativeEventListener,
  type NativeEventPriority,
  type NativeMeasurement,
  type NodeHandle,
  type NativeHost,
  type SurfaceId,
  type SurfaceOptions,
} from "@solid-native/host-contract";
import { CORE_COMPONENT_DESCRIPTORS } from "@solid-native/core";
import {
  mount,
  type NativeApplication,
  type NativeRootOptions,
} from "@solid-native/renderer";

export interface InMemoryHostOptions {
  readonly platform?: string;
  readonly capabilities?: Partial<HostCapabilities>;
  readonly descriptors?: readonly NativeComponentDescriptor[];
  readonly clock?: () => number;
}

export interface InMemoryElementSnapshot {
  readonly kind: "element";
  readonly node: NodeHandle;
  readonly component: string;
  readonly props: HostProps;
  readonly eventListeners: readonly string[];
  readonly parent: NodeHandle | null;
  readonly children: readonly NodeHandle[];
}

export interface InMemoryTextSnapshot {
  readonly kind: "text";
  readonly node: NodeHandle;
  readonly text: string;
  readonly parent: NodeHandle | null;
}

export type InMemoryNodeSnapshot =
  InMemoryElementSnapshot | InMemoryTextSnapshot;

export interface InMemorySurfaceSnapshot {
  readonly id: SurfaceId;
  readonly name: string;
  readonly initialProps: HostProps;
  readonly sequence: CommitSequence;
  readonly nodes: readonly InMemoryNodeSnapshot[];
}

export interface InjectNativeEventOptions {
  readonly surface: SurfaceId;
  readonly target: NodeHandle;
  readonly name: string;
  readonly payload?: HostValue;
  readonly observedSequence?: CommitSequence;
  readonly timestamp?: number;
  readonly priority?: NativeEventPriority;
  readonly bubbles?: boolean;
  readonly coalescible?: boolean;
}

type MutableElement = {
  kind: "element";
  node: NodeHandle;
  component: string;
  props: HostProps;
  eventListeners: string[];
  parent: NodeHandle | null;
  children: NodeHandle[];
};

type MutableText = {
  kind: "text";
  node: NodeHandle;
  text: string;
  parent: NodeHandle | null;
};

type MutableNode = MutableElement | MutableText;

interface MutableSurface {
  readonly id: SurfaceId;
  readonly name: string;
  readonly initialProps: HostProps;
  nextNode: NodeHandle;
  sequence: CommitSequence;
  nodes: Map<NodeHandle, MutableNode>;
}

const DEFAULT_CAPABILITIES: HostCapabilities = {
  contractVersion: HOST_CONTRACT_VERSION,
  synchronousMeasurement: true,
  bubblingEvents: true,
  nativeScreens: false,
  uiWorklets: false,
  viewRecycling: false,
  commitMountEvents: true,
};

function cloneValue(value: HostValue): HostValue {
  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneValue(child)]),
    );
  }

  return value;
}

function cloneProps(props: HostProps): HostProps {
  return Object.fromEntries(
    Object.entries(props).map(([key, value]) => [key, cloneValue(value)]),
  );
}

function cloneMutation(mutation: HostMutation): HostMutation {
  switch (mutation.type) {
    case "create-element":
      return { ...mutation, props: cloneProps(mutation.props) };
    case "update-props":
      return {
        ...mutation,
        props: cloneProps(mutation.props),
        removedProps: [...mutation.removedProps],
      };
    case "update-event-listeners":
      return { ...mutation, events: [...mutation.events] };
    case "command":
      return { ...mutation, args: mutation.args.map(cloneValue) };
    default:
      return { ...mutation };
  }
}

function cloneCausalContext(context: HostCausalContext): HostCausalContext {
  if (
    context.operationId.length === 0 ||
    context.operationId.length > HOST_CAUSAL_OPERATION_ID_MAX_LENGTH ||
    context.operationId.includes("\0")
  ) {
    throw new RangeError(
      `The causal operation ID must contain 1-${HOST_CAUSAL_OPERATION_ID_MAX_LENGTH} characters without null bytes.`,
    );
  }
  return { operationId: context.operationId };
}

function cloneCommit(commit: HostCommit): HostCommit {
  return {
    ...commit,
    mutations: commit.mutations.map(cloneMutation),
    ...(commit.causalContext === undefined
      ? {}
      : { causalContext: cloneCausalContext(commit.causalContext) }),
  };
}

function cloneNode(node: MutableNode): MutableNode {
  return node.kind === "element"
    ? {
        ...node,
        props: cloneProps(node.props),
        eventListeners: [...node.eventListeners],
        children: [...node.children],
      }
    : { ...node };
}

function cloneDescriptor(
  descriptor: NativeComponentDescriptor,
): NativeComponentDescriptor {
  return {
    ...descriptor,
    bubblingEvents: [...descriptor.bubblingEvents],
    directEvents: [...descriptor.directEvents],
    commands: Object.fromEntries(
      Object.entries(descriptor.commands).map(([name, parameters]) => [
        name,
        [...parameters],
      ]),
    ),
  };
}

function getNode(
  surface: MutableSurface,
  node: NodeHandle,
  operation: string,
): MutableNode {
  const value = surface.nodes.get(node);
  if (value === undefined) {
    throw new Error(
      `Cannot ${operation}: node ${node} does not exist on surface ${surface.id}.`,
    );
  }
  return value;
}

function getElement(
  surface: MutableSurface,
  node: NodeHandle,
  operation: string,
): MutableElement {
  const value = getNode(surface, node, operation);
  if (value.kind !== "element") {
    throw new Error(`Cannot ${operation}: node ${node} is a text node.`);
  }
  return value;
}

/**
 * A strict, deterministic implementation of the host contract for renderer tests.
 * Commits are applied to a copy of the surface and become visible atomically.
 */
export class InMemoryHost implements NativeHost {
  readonly platform: string;
  readonly capabilities: HostCapabilities;

  readonly #surfaces = new Map<SurfaceId, MutableSurface>();
  readonly #descriptors = new Map<string, NativeComponentDescriptor>();
  readonly #listeners = new Set<NativeEventListener>();
  readonly #lifecycleListeners = new Set<HostLifecycleListener>();
  readonly #commits: HostCommit[] = [];
  readonly #measurements = new Map<string, NativeMeasurement>();
  readonly #clock: () => number;
  #nextSurface: SurfaceId = 1;

  constructor(options: InMemoryHostOptions = {}) {
    this.#clock = options.clock ?? (() => 0);
    this.platform = options.platform ?? "test";
    this.capabilities = {
      ...DEFAULT_CAPABILITIES,
      ...options.capabilities,
      contractVersion: HOST_CONTRACT_VERSION,
    };

    for (const descriptor of options.descriptors ?? []) {
      if (this.#descriptors.has(descriptor.name)) {
        throw new Error(`Duplicate component descriptor: ${descriptor.name}.`);
      }
      this.#descriptors.set(descriptor.name, cloneDescriptor(descriptor));
    }
  }

  createSurface(options: SurfaceOptions): SurfaceId {
    const id = this.#nextSurface++;
    this.#surfaces.set(id, {
      id,
      name: options.name,
      initialProps: cloneProps(options.initialProps ?? {}),
      nextNode: 1,
      sequence: 0,
      nodes: new Map(),
    });
    return id;
  }

  destroySurface(surface: SurfaceId): void {
    this.#getSurface(surface);
    this.#surfaces.delete(surface);

    const prefix = `${surface}:`;
    for (const key of this.#measurements.keys()) {
      if (key.startsWith(prefix)) this.#measurements.delete(key);
    }
  }

  allocateNode(surface: SurfaceId): NodeHandle {
    const state = this.#getSurface(surface);
    return state.nextNode++;
  }

  commit(transaction: HostCommit): HostCommitResult {
    const causalContext =
      transaction.causalContext === undefined
        ? undefined
        : cloneCausalContext(transaction.causalContext);
    const commitStartedAt = this.#clock();
    const current = this.#getSurface(transaction.surface);
    if (transaction.sequence <= current.sequence) {
      throw new Error(
        `Commit sequence ${transaction.sequence} must be greater than ${current.sequence} on surface ${current.id}.`,
      );
    }

    const staged: MutableSurface = {
      ...current,
      nodes: new Map(
        [...current.nodes].map(([handle, node]) => [handle, cloneNode(node)]),
      ),
    };

    for (const mutation of transaction.mutations) {
      this.#applyMutation(staged, mutation);
    }

    staged.sequence = transaction.sequence;
    this.#surfaces.set(staged.id, staged);
    for (const node of current.nodes.keys()) {
      if (!staged.nodes.has(node)) {
        this.#measurements.delete(this.#measurementKey(staged.id, node));
      }
    }
    this.#commits.push(cloneCommit(transaction));

    const producedRevision = !transaction.mutations.some(
      (mutation) => mutation.type === "command",
    );
    if (producedRevision) {
      const mountedAt = this.#clock();
      const mountEvent: HostLifecycleEvent = {
        type: "commit-mounted",
        surface: staged.id,
        sequence: staged.sequence,
        hostRevision: staged.sequence,
        commitStartedAt,
        mountedAt,
        mountLatency: Math.max(0, mountedAt - commitStartedAt),
        ...(causalContext === undefined ? {} : { causalContext }),
      };
      for (const listener of [...this.#lifecycleListeners]) {
        listener(mountEvent);
      }
      const frameStartedAt = this.#clock();
      const frameEvent: HostLifecycleEvent = {
        type: "commit-frame",
        surface: staged.id,
        sequence: staged.sequence,
        hostRevision: staged.sequence,
        mountedAt,
        frameStartedAt,
        frameLatency: Math.max(0, frameStartedAt - commitStartedAt),
        mountToFrameLatency: Math.max(0, frameStartedAt - mountedAt),
        ...(causalContext === undefined ? {} : { causalContext }),
      };
      for (const listener of [...this.#lifecycleListeners]) {
        listener(frameEvent);
      }
    }

    return {
      surface: staged.id,
      sequence: staged.sequence,
      mounted: true,
      ...(producedRevision ? { hostRevision: staged.sequence } : {}),
    };
  }

  measure(
    surface: SurfaceId,
    node: NodeHandle,
    afterSequence?: CommitSequence,
  ): NativeMeasurement {
    const state = this.#getSurface(surface);
    getNode(state, node, "measure node");

    if (afterSequence !== undefined && state.sequence < afterSequence) {
      throw new Error(
        `Cannot measure surface ${surface} after sequence ${afterSequence}; latest commit is ${state.sequence}.`,
      );
    }

    const measurement =
      this.#measurements.get(this.#measurementKey(surface, node)) ??
      ({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        pageX: 0,
        pageY: 0,
        observedSequence: state.sequence,
      } satisfies NativeMeasurement);

    if (
      afterSequence !== undefined &&
      measurement.observedSequence < afterSequence
    ) {
      throw new Error(
        `Measurement for node ${node} only observes sequence ${measurement.observedSequence}, before requested sequence ${afterSequence}.`,
      );
    }

    return { ...measurement };
  }

  subscribe(listener: NativeEventListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  subscribeLifecycle(listener: HostLifecycleListener): () => void {
    this.#lifecycleListeners.add(listener);
    return () => {
      this.#lifecycleListeners.delete(listener);
    };
  }

  getComponentDescriptor(name: string): NativeComponentDescriptor | undefined {
    const descriptor = this.#descriptors.get(name);
    return descriptor === undefined ? undefined : cloneDescriptor(descriptor);
  }

  get commits(): readonly HostCommit[] {
    return this.#commits.map(cloneCommit);
  }

  hasSurface(surface: SurfaceId): boolean {
    return this.#surfaces.has(surface);
  }

  getSurfaceSnapshot(surface: SurfaceId): InMemorySurfaceSnapshot {
    const state = this.#getSurface(surface);
    return {
      id: state.id,
      name: state.name,
      initialProps: cloneProps(state.initialProps),
      sequence: state.sequence,
      nodes: [...state.nodes.values()]
        .sort((left, right) => left.node - right.node)
        .map((node) =>
          node.kind === "element"
            ? {
                kind: "element",
                node: node.node,
                component: node.component,
                props: cloneProps(node.props),
                eventListeners: [...node.eventListeners],
                parent: node.parent,
                children: [...node.children],
              }
            : { ...node },
        ),
    };
  }

  setMeasurement(
    surface: SurfaceId,
    node: NodeHandle,
    measurement: Omit<NativeMeasurement, "observedSequence"> & {
      readonly observedSequence?: CommitSequence;
    },
  ): void {
    const state = this.#getSurface(surface);
    getNode(state, node, "set measurement for node");
    if (
      measurement.observedSequence !== undefined &&
      measurement.observedSequence > state.sequence
    ) {
      throw new Error(
        `Measurement observes future sequence ${measurement.observedSequence}; latest commit is ${state.sequence}.`,
      );
    }
    this.#measurements.set(this.#measurementKey(surface, node), {
      ...measurement,
      observedSequence: measurement.observedSequence ?? state.sequence,
    });
  }

  injectEvent(options: InjectNativeEventOptions): NativeEvent {
    const state = this.#getSurface(options.surface);
    getNode(state, options.target, "dispatch event to node");

    const observedSequence = options.observedSequence ?? state.sequence;
    if (observedSequence > state.sequence) {
      throw new Error(
        `Event observes future sequence ${observedSequence}; latest commit is ${state.sequence}.`,
      );
    }

    const event: NativeEvent = {
      surface: options.surface,
      target: options.target,
      observedSequence,
      name: options.name,
      timestamp: options.timestamp ?? 0,
      priority: options.priority ?? "default",
      bubbles: options.bubbles ?? false,
      coalescible: options.coalescible ?? false,
      payload: cloneValue(options.payload ?? null),
    };

    const target = getElement(state, options.target, "dispatch event to node");
    if (!target.eventListeners.includes(options.name)) {
      throw new Error(
        `Node ${options.target} is not observing event ${options.name}.`,
      );
    }

    for (const listener of [...this.#listeners]) listener(event);
    return event;
  }

  #getSurface(surface: SurfaceId): MutableSurface {
    const state = this.#surfaces.get(surface);
    if (state === undefined) {
      throw new Error(`Surface ${surface} does not exist.`);
    }
    return state;
  }

  #measurementKey(surface: SurfaceId, node: NodeHandle): string {
    return `${surface}:${node}`;
  }

  #applyMutation(surface: MutableSurface, mutation: HostMutation): void {
    switch (mutation.type) {
      case "create-element": {
        this.#assertNodeCanBeCreated(surface, mutation.node);
        const descriptor = this.#descriptors.get(mutation.component);
        if (descriptor === undefined) {
          throw new Error(`Unknown native component: ${mutation.component}.`);
        }
        surface.nodes.set(mutation.node, {
          kind: "element",
          node: mutation.node,
          component: mutation.component,
          props: cloneProps(mutation.props),
          eventListeners: [],
          parent: null,
          children: [],
        });
        break;
      }
      case "create-text":
        this.#assertNodeCanBeCreated(surface, mutation.node);
        surface.nodes.set(mutation.node, {
          kind: "text",
          node: mutation.node,
          text: mutation.text,
          parent: null,
        });
        break;
      case "update-props": {
        const node = getElement(surface, mutation.node, "update props on node");
        const nextProps: Record<string, HostValue> = { ...node.props };
        for (const name of mutation.removedProps) delete nextProps[name];
        for (const [name, value] of Object.entries(mutation.props)) {
          nextProps[name] = cloneValue(value);
        }
        node.props = nextProps;
        break;
      }
      case "update-text": {
        const node = getNode(surface, mutation.node, "update text on node");
        if (node.kind !== "text") {
          throw new Error(
            `Cannot update text on node ${mutation.node}: it is an element.`,
          );
        }
        node.text = mutation.text;
        break;
      }
      case "update-event-listeners": {
        const node = getElement(
          surface,
          mutation.node,
          "update event listeners on node",
        );
        const descriptor = this.#descriptors.get(node.component);
        const supported = new Set([
          ...(descriptor?.bubblingEvents ?? []),
          ...(descriptor?.directEvents ?? []),
        ]);
        const seen = new Set<string>();
        let previous = "";
        for (const event of mutation.events) {
          if (event.length === 0) {
            throw new Error("Event listener names cannot be empty.");
          }
          if (seen.has(event)) {
            throw new Error(`Event listener ${event} is duplicated.`);
          }
          if (previous !== "" && event < previous) {
            throw new Error("Event listener names must be sorted.");
          }
          if (!supported.has(event)) {
            throw new Error(
              `Component ${node.component} does not define event ${event}.`,
            );
          }
          seen.add(event);
          previous = event;
        }
        node.eventListeners = [...mutation.events];
        break;
      }
      case "insert-child":
        this.#insertChild(surface, mutation);
        break;
      case "remove-child": {
        const parent = getElement(
          surface,
          mutation.parent,
          "remove child from node",
        );
        const child = getNode(surface, mutation.child, "remove child node");
        const index = parent.children.indexOf(child.node);
        if (index === -1 || child.parent !== parent.node) {
          throw new Error(
            `Node ${child.node} is not a child of node ${parent.node}.`,
          );
        }
        parent.children.splice(index, 1);
        child.parent = null;
        break;
      }
      case "delete-node": {
        const node = getNode(surface, mutation.node, "delete node");
        if (node.parent !== null) {
          throw new Error(
            `Cannot delete node ${node.node} while it is attached to parent ${node.parent}.`,
          );
        }
        if (node.kind === "element" && node.children.length > 0) {
          throw new Error(
            `Cannot delete node ${node.node} while it still has children.`,
          );
        }
        surface.nodes.delete(node.node);
        break;
      }
      case "command": {
        const node = getElement(surface, mutation.node, "send command to node");
        const descriptor = this.#descriptors.get(node.component);
        const parameters = descriptor?.commands[mutation.command];
        if (parameters === undefined) {
          throw new Error(
            `Component ${node.component} does not define command ${mutation.command}.`,
          );
        }
        if (parameters.length !== mutation.args.length) {
          throw new Error(
            `Command ${node.component}.${mutation.command} expects ${parameters.length} arguments, received ${mutation.args.length}.`,
          );
        }
        break;
      }
    }
  }

  #assertNodeCanBeCreated(surface: MutableSurface, node: NodeHandle): void {
    if (node <= 0 || node >= surface.nextNode) {
      throw new Error(
        `Node ${node} was not allocated on surface ${surface.id}.`,
      );
    }
    if (surface.nodes.has(node)) {
      throw new Error(`Node ${node} already exists on surface ${surface.id}.`);
    }
  }

  #insertChild(
    surface: MutableSurface,
    mutation: Extract<HostMutation, { readonly type: "insert-child" }>,
  ): void {
    const parent = getElement(
      surface,
      mutation.parent,
      "insert child into node",
    );
    const child = getNode(surface, mutation.child, "insert child node");

    if (parent.node === child.node) {
      throw new Error(`Node ${child.node} cannot be its own parent.`);
    }

    let ancestor: MutableNode | undefined = parent;
    while (ancestor !== undefined) {
      if (ancestor.node === child.node) {
        throw new Error(
          `Cannot insert node ${child.node}: the operation would create a cycle.`,
        );
      }
      ancestor =
        ancestor.parent === null
          ? undefined
          : surface.nodes.get(ancestor.parent);
    }

    if (child.kind === "text") {
      const descriptor = this.#descriptors.get(parent.component);
      if (descriptor?.acceptsRawText !== true) {
        throw new Error(
          `Component ${parent.component} does not accept raw text children.`,
        );
      }
    }

    let beforeIndex = parent.children.length;
    if (mutation.before !== undefined) {
      beforeIndex = parent.children.indexOf(mutation.before);
      if (beforeIndex === -1) {
        throw new Error(
          `Before-node ${mutation.before} is not a child of node ${parent.node}.`,
        );
      }
    }

    if (child.parent !== null) {
      const oldParent = getElement(
        surface,
        child.parent,
        "move child from node",
      );
      const oldIndex = oldParent.children.indexOf(child.node);
      if (oldIndex === -1) {
        throw new Error(`Node ${child.node} has inconsistent parent state.`);
      }
      oldParent.children.splice(oldIndex, 1);
      if (oldParent.node === parent.node && oldIndex < beforeIndex) {
        beforeIndex--;
      }
    }

    parent.children.splice(beforeIndex, 0, child.node);
    child.parent = parent.node;
  }
}

export type NativeTestTextMatcher = string | RegExp;

export interface NativeTestRoleOptions {
  readonly name?: NativeTestTextMatcher;
}

export interface NativeTestElement {
  readonly host: InMemoryHost;
  readonly surface: SurfaceId;
  readonly node: NodeHandle;
  readonly component: string;
  readonly props: HostProps;
  readonly eventListeners: readonly string[];
  readonly parent: NodeHandle | null;
  readonly children: readonly NodeHandle[];
  readonly textContent: string;
}

export interface NativeTestEventOptions {
  readonly observedSequence?: CommitSequence;
  readonly timestamp?: number;
  readonly priority?: NativeEventPriority;
  readonly bubbles?: boolean;
  readonly coalescible?: boolean;
}

export interface RenderNativeOptions {
  /** Uses an existing deterministic host. Cannot be combined with hostOptions. */
  readonly host?: InMemoryHost;
  /** Configures the default host. Core component descriptors are installed unless replaced. */
  readonly hostOptions?: InMemoryHostOptions;
  readonly surface?: SurfaceOptions;
  /** autoCommit is deliberately controlled by the test renderer. */
  readonly rootOptions?: Omit<NativeRootOptions, "autoCommit" | "surface">;
}

export interface NativeTestDebugOptions {
  /** Includes every transport prop as bounded, deterministic JSON. */
  readonly includeProps?: boolean;
  /** Maximum rendered tree depth. Defaults to 64 and cannot exceed 256. */
  readonly maxDepth?: number;
  /** Maximum rendered nodes. Defaults to 200 and cannot exceed 1,000. */
  readonly maxNodes?: number;
}

export interface NativeTestCommitDebugOptions {
  /** Includes text, prop, and command-argument values. Defaults to false. */
  readonly includeValues?: boolean;
  /** Maximum latest commits to render. Defaults to 20 and cannot exceed 100. */
  readonly maxCommits?: number;
  /** Maximum mutations across rendered commits. Defaults to 200; maximum 2,000. */
  readonly maxMutations?: number;
}

export interface NativeTestWaitOptions {
  /** Maximum polling time in milliseconds. Defaults to 1,000; maximum 60,000. */
  readonly timeout?: number;
  /** Delay between attempts in milliseconds. Defaults to 10; maximum 1,000. */
  readonly interval?: number;
  /** Cancels pending polling without disposing the rendered application. */
  readonly signal?: AbortSignal;
}

export type NativeTestMutationType = HostMutation["type"];

export interface NativeTestCommitMatcher {
  /** Matches commits strictly newer than this checkpoint. */
  readonly afterSequence?: CommitSequence;
  readonly sequence?: CommitSequence;
  readonly priority?: CommitPriority;
  readonly causalOperationId?: string;
  /** Matches the complete ordered mutation-kind sequence. */
  readonly mutationTypes?: readonly NativeTestMutationType[];
}

interface NativeTestMutationCommitMatcher {
  /** Matches mutations in commits strictly newer than this checkpoint. */
  readonly afterSequence?: CommitSequence;
  readonly sequence?: CommitSequence;
  readonly priority?: CommitPriority;
  readonly causalOperationId?: string;
}

export type NativeTestNodeMatcher = NodeHandle | NativeTestElement;

/**
 * Structurally matches one mutation without inspecting application values.
 * Text, prop values, and command arguments remain assertions on public UI or
 * behavior; prop/event names and native identities are safe structural facts.
 */
export type NativeTestMutationMatcher = NativeTestMutationCommitMatcher &
  (
    | {
        readonly type: "create-element";
        readonly node?: NativeTestNodeMatcher;
        readonly component?: string;
      }
    | {
        readonly type: "create-text";
        readonly node?: NativeTestNodeMatcher;
      }
    | {
        readonly type: "update-props";
        readonly node?: NativeTestNodeMatcher;
        /** Matches the complete unordered set of property names being set. */
        readonly setProps?: readonly string[];
        /** Matches the complete unordered set of property names being removed. */
        readonly removedProps?: readonly string[];
      }
    | {
        readonly type: "update-text";
        readonly node?: NativeTestNodeMatcher;
      }
    | {
        readonly type: "update-event-listeners";
        readonly node?: NativeTestNodeMatcher;
        /** Matches the complete unordered set of subscribed event names. */
        readonly events?: readonly string[];
      }
    | {
        readonly type: "insert-child";
        readonly parent?: NativeTestNodeMatcher;
        readonly child?: NativeTestNodeMatcher;
        /** `null` explicitly matches an append rather than an insertion before a sibling. */
        readonly before?: NativeTestNodeMatcher | null;
      }
    | {
        readonly type: "remove-child";
        readonly parent?: NativeTestNodeMatcher;
        readonly child?: NativeTestNodeMatcher;
      }
    | {
        readonly type: "delete-node";
        readonly node?: NativeTestNodeMatcher;
      }
    | {
        readonly type: "command";
        readonly node?: NativeTestNodeMatcher;
        readonly command?: string;
      }
  );

export interface NativeTestMutationMatch<
  Mutation extends HostMutation = HostMutation,
> {
  readonly commit: HostCommit;
  readonly mutation: Mutation;
  readonly index: number;
}

export type NativeTestMatchedMutation<
  Matcher extends NativeTestMutationMatcher,
> = Extract<HostMutation, { readonly type: Matcher["type"] }>;

export class NativeTestQueryError extends Error {
  readonly query: string;
  readonly matchCount: number;

  constructor(query: string, matchCount: number, available: string) {
    super(
      matchCount === 0
        ? `Unable to find a native element by ${query}.${available}`
        : `Found ${String(matchCount)} native elements by ${query}; expected exactly one.${available}`,
    );
    this.name = "NativeTestQueryError";
    this.query = query;
    this.matchCount = matchCount;
  }
}

export class NativeTestCommitQueryError extends Error {
  readonly query: string;
  readonly matchCount: number;

  constructor(query: string, matchCount: number, available: string) {
    super(
      matchCount === 0
        ? `Unable to find a native commit matching ${query}.\n\n${available}`
        : `Found ${String(matchCount)} native commits matching ${query}; expected exactly one.\n\n${available}`,
    );
    this.name = "NativeTestCommitQueryError";
    this.query = query;
    this.matchCount = matchCount;
  }
}

export class NativeTestMutationQueryError extends Error {
  readonly query: string;
  readonly matchCount: number;

  constructor(query: string, matchCount: number, available: string) {
    super(
      matchCount === 0
        ? `Unable to find a native mutation matching ${query}.\n\n${available}`
        : `Found ${String(matchCount)} native mutations matching ${query}; expected exactly one.\n\n${available}`,
    );
    this.name = "NativeTestMutationQueryError";
    this.query = query;
    this.matchCount = matchCount;
  }
}

export class NativeTestWaitTimeoutError extends Error {
  readonly timeout: number;
  readonly attempts: number;

  constructor(
    timeout: number,
    attempts: number,
    lastError: unknown,
    diagnostics: string,
  ) {
    const lastMessage =
      lastError instanceof Error
        ? lastError.message.slice(0, 1_000)
        : "The assertion threw a non-Error value.";
    super(
      `Native test waitFor timed out after ${String(timeout)} ms (${String(attempts)} attempt(s)).\nLast assertion: ${lastMessage}\n\n${diagnostics}`,
      { cause: lastError },
    );
    this.name = "NativeTestWaitTimeoutError";
    this.timeout = timeout;
    this.attempts = attempts;
  }
}

export class NativeTestWaitAbortedError extends Error {
  constructor(reason: unknown) {
    super("Native test waitFor was aborted.", { cause: reason });
    this.name = "NativeTestWaitAbortedError";
  }
}

class NativeTestAsyncAssertionError extends TypeError {
  constructor() {
    super(
      "Native test waitFor assertions must be synchronous; await asynchronous work before asserting.",
    );
    this.name = "NativeTestAsyncAssertionError";
  }
}

function matchesNativeTestText(
  value: string,
  matcher: NativeTestTextMatcher,
): boolean {
  if (typeof matcher === "string") return value === matcher;
  matcher.lastIndex = 0;
  const matched = matcher.test(value);
  matcher.lastIndex = 0;
  return matched;
}

function assertNativeTestTextMatcher(matcher: NativeTestTextMatcher): void {
  if (typeof matcher !== "string" && !(matcher instanceof RegExp)) {
    throw new TypeError("Native text queries require a string or RegExp.");
  }
}

function describeNativeTestMatcher(matcher: NativeTestTextMatcher): string {
  return typeof matcher === "string"
    ? JSON.stringify(matcher)
    : String(matcher);
}

const NATIVE_TEST_NODE_SUMMARY_LIMIT = 20;
const NATIVE_TEST_DEBUG_DEFAULT_MAX_DEPTH = 64;
const NATIVE_TEST_DEBUG_MAX_DEPTH = 256;
const NATIVE_TEST_DEBUG_DEFAULT_MAX_NODES = 200;
const NATIVE_TEST_DEBUG_MAX_NODES = 1_000;
const NATIVE_TEST_DEBUG_TEXT_MAX_CHARACTERS = 160;
const NATIVE_TEST_DEBUG_PROPS_MAX_CHARACTERS = 2_048;
const NATIVE_TEST_COMMIT_DEFAULT_MAX_COMMITS = 20;
const NATIVE_TEST_COMMIT_MAX_COMMITS = 100;
const NATIVE_TEST_COMMIT_DEFAULT_MAX_MUTATIONS = 200;
const NATIVE_TEST_COMMIT_MAX_MUTATIONS = 2_000;
const NATIVE_TEST_COMMIT_VALUE_MAX_CHARACTERS = 2_048;
const NATIVE_TEST_MATCHER_MAX_ITEMS = 2_000;
const NATIVE_TEST_MATCHER_MAX_STRING_CHARACTERS = 1_024;
const NATIVE_TEST_WAIT_DEFAULT_TIMEOUT = 1_000;
const NATIVE_TEST_WAIT_MAX_TIMEOUT = 60_000;
const NATIVE_TEST_WAIT_DEFAULT_INTERVAL = 10;
const NATIVE_TEST_WAIT_MAX_INTERVAL = 1_000;

const NATIVE_TEST_COMMIT_PRIORITIES = new Set<CommitPriority>([
  "immediate",
  "user-blocking",
  "normal",
  "background",
]);
const NATIVE_TEST_MUTATION_TYPES = new Set<NativeTestMutationType>([
  "create-element",
  "create-text",
  "update-props",
  "update-text",
  "update-event-listeners",
  "insert-child",
  "remove-child",
  "delete-node",
  "command",
]);
const NATIVE_TEST_COMMIT_MATCHER_KEYS = new Set([
  "afterSequence",
  "sequence",
  "priority",
  "causalOperationId",
  "mutationTypes",
]);
const NATIVE_TEST_MUTATION_COMMON_KEYS = [
  "type",
  "afterSequence",
  "sequence",
  "priority",
  "causalOperationId",
] as const;
const NATIVE_TEST_MUTATION_SPECIFIC_KEYS: Readonly<
  Record<NativeTestMutationType, readonly string[]>
> = {
  "create-element": ["node", "component"],
  "create-text": ["node"],
  "update-props": ["node", "setProps", "removedProps"],
  "update-text": ["node"],
  "update-event-listeners": ["node", "events"],
  "insert-child": ["parent", "child", "before"],
  "remove-child": ["parent", "child"],
  "delete-node": ["node"],
  command: ["node", "command"],
};

interface NormalizedNativeTestCommitFilter {
  readonly afterSequence: CommitSequence | undefined;
  readonly sequence: CommitSequence | undefined;
  readonly priority: CommitPriority | undefined;
  readonly causalOperationId: string | undefined;
}

interface NormalizedNativeTestCommitMatcher extends NormalizedNativeTestCommitFilter {
  readonly mutationTypes: readonly NativeTestMutationType[] | undefined;
}

interface NormalizedNativeTestMutationMatcher {
  readonly commit: NormalizedNativeTestCommitFilter;
  readonly type: NativeTestMutationType;
  readonly node: NodeHandle | undefined;
  readonly component: string | undefined;
  readonly command: string | undefined;
  readonly parent: NodeHandle | undefined;
  readonly child: NodeHandle | undefined;
  readonly matchesBefore: boolean;
  readonly before: NodeHandle | null | undefined;
  readonly setProps: readonly string[] | undefined;
  readonly removedProps: readonly string[] | undefined;
  readonly events: readonly string[] | undefined;
}

function nativeTestMatcherRecord(
  matcher: unknown,
  description: string,
): Readonly<Record<string, unknown>> {
  if (
    matcher === null ||
    typeof matcher !== "object" ||
    Array.isArray(matcher) ||
    (Object.getPrototypeOf(matcher) !== Object.prototype &&
      Object.getPrototypeOf(matcher) !== null)
  ) {
    throw new TypeError(`Native test ${description} must be a plain object.`);
  }
  return matcher as Readonly<Record<string, unknown>>;
}

function assertNativeTestMatcherKeys(
  matcher: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  description: string,
): void {
  const unknown = Object.keys(matcher).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new TypeError(
      `Native test ${description} contains unknown field ${JSON.stringify(unknown[0])}.`,
    );
  }
}

function nativeTestMatcherSequence(
  value: unknown,
  minimum: number,
  name: string,
): CommitSequence | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new RangeError(
      `Native test ${name} must be a safe integer of at least ${String(minimum)}.`,
    );
  }
  return value as CommitSequence;
}

function nativeTestMatcherPriority(value: unknown): CommitPriority | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    !NATIVE_TEST_COMMIT_PRIORITIES.has(value as CommitPriority)
  ) {
    throw new TypeError(
      "Native test commit priority must be immediate, user-blocking, normal, or background.",
    );
  }
  return value as CommitPriority;
}

function nativeTestMatcherString(
  value: unknown,
  name: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > NATIVE_TEST_MATCHER_MAX_STRING_CHARACTERS ||
    value.includes("\0")
  ) {
    throw new TypeError(
      `Native test ${name} must contain 1-${String(NATIVE_TEST_MATCHER_MAX_STRING_CHARACTERS)} characters without null bytes.`,
    );
  }
  return value;
}

function nativeTestMatcherCausalOperationId(
  value: unknown,
): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > HOST_CAUSAL_OPERATION_ID_MAX_LENGTH ||
    value.includes("\0")
  ) {
    throw new TypeError(
      `Native test causal operation ID must contain 1-${String(HOST_CAUSAL_OPERATION_ID_MAX_LENGTH)} characters without null bytes.`,
    );
  }
  return value;
}

function nativeTestMatcherStringSet(
  value: unknown,
  name: string,
): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > NATIVE_TEST_MATCHER_MAX_ITEMS) {
    throw new TypeError(
      `Native test ${name} must be an array of at most ${String(NATIVE_TEST_MATCHER_MAX_ITEMS)} unique names.`,
    );
  }
  const result = value.map((entry) => {
    const nameValue = nativeTestMatcherString(entry, `${name} entry`);
    if (nameValue === undefined) {
      throw new TypeError(`Native test ${name} entries cannot be undefined.`);
    }
    return nameValue;
  });
  const unique = new Set(result);
  if (unique.size !== result.length) {
    throw new TypeError(`Native test ${name} cannot contain duplicates.`);
  }
  return [...result].sort();
}

function normalizeNativeTestCommitFilter(
  matcher: Readonly<Record<string, unknown>>,
): NormalizedNativeTestCommitFilter {
  const afterSequence = nativeTestMatcherSequence(
    matcher.afterSequence,
    0,
    "afterSequence",
  );
  const sequence = nativeTestMatcherSequence(
    matcher.sequence,
    1,
    "commit sequence",
  );
  if (
    afterSequence !== undefined &&
    sequence !== undefined &&
    sequence <= afterSequence
  ) {
    throw new RangeError(
      "Native test commit sequence must be newer than afterSequence.",
    );
  }
  return {
    afterSequence,
    sequence,
    priority: nativeTestMatcherPriority(matcher.priority),
    causalOperationId: nativeTestMatcherCausalOperationId(
      matcher.causalOperationId,
    ),
  };
}

function normalizeNativeTestCommitMatcher(
  matcher: NativeTestCommitMatcher,
): NormalizedNativeTestCommitMatcher {
  const record = nativeTestMatcherRecord(matcher, "commit matcher");
  assertNativeTestMatcherKeys(
    record,
    NATIVE_TEST_COMMIT_MATCHER_KEYS,
    "commit matcher",
  );
  let mutationTypes: readonly NativeTestMutationType[] | undefined;
  if (record.mutationTypes !== undefined) {
    if (
      !Array.isArray(record.mutationTypes) ||
      record.mutationTypes.length > NATIVE_TEST_MATCHER_MAX_ITEMS
    ) {
      throw new TypeError(
        `Native test commit mutationTypes must be an array of at most ${String(NATIVE_TEST_MATCHER_MAX_ITEMS)} mutation kinds.`,
      );
    }
    mutationTypes = record.mutationTypes.map((type) => {
      if (
        typeof type !== "string" ||
        !NATIVE_TEST_MUTATION_TYPES.has(type as NativeTestMutationType)
      ) {
        throw new TypeError(
          `Native test commit mutationTypes contains invalid kind ${JSON.stringify(type)}.`,
        );
      }
      return type as NativeTestMutationType;
    });
  }
  return { ...normalizeNativeTestCommitFilter(record), mutationTypes };
}

function nativeTestMatcherNode(
  value: unknown,
  host: InMemoryHost,
  surface: SurfaceId,
  name: string,
): NodeHandle | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(
        `Native test mutation ${name} must be a positive safe integer node handle.`,
      );
    }
    return value;
  }
  if (value === null || typeof value !== "object") {
    throw new TypeError(
      `Native test mutation ${name} must be a node handle or NativeTestElement.`,
    );
  }
  const element = value as Partial<NativeTestElement>;
  if (element.host !== host || element.surface !== surface) {
    throw new Error(
      `Native test mutation ${name} belongs to another render; expected the current host and surface ${String(surface)}.`,
    );
  }
  if (!Number.isSafeInteger(element.node) || (element.node ?? 0) < 1) {
    throw new TypeError(
      `Native test mutation ${name} contains an invalid NativeTestElement node handle.`,
    );
  }
  return element.node;
}

function normalizeNativeTestMutationMatcher(
  matcher: NativeTestMutationMatcher,
  host: InMemoryHost,
  surface: SurfaceId,
): NormalizedNativeTestMutationMatcher {
  const record = nativeTestMatcherRecord(matcher, "mutation matcher");
  if (
    typeof record.type !== "string" ||
    !NATIVE_TEST_MUTATION_TYPES.has(record.type as NativeTestMutationType)
  ) {
    throw new TypeError(
      `Native test mutation matcher requires a valid type; received ${JSON.stringify(record.type)}.`,
    );
  }
  const type = record.type as NativeTestMutationType;
  assertNativeTestMatcherKeys(
    record,
    new Set([
      ...NATIVE_TEST_MUTATION_COMMON_KEYS,
      ...NATIVE_TEST_MUTATION_SPECIFIC_KEYS[type],
    ]),
    `${type} mutation matcher`,
  );
  const node = nativeTestMatcherNode(record.node, host, surface, "node");
  const parent = nativeTestMatcherNode(record.parent, host, surface, "parent");
  const child = nativeTestMatcherNode(record.child, host, surface, "child");
  const matchesBefore = Object.prototype.hasOwnProperty.call(record, "before");
  const before =
    record.before === null
      ? null
      : nativeTestMatcherNode(record.before, host, surface, "before");
  return {
    commit: normalizeNativeTestCommitFilter(record),
    type,
    node,
    component: nativeTestMatcherString(record.component, "component name"),
    command: nativeTestMatcherString(record.command, "command name"),
    parent,
    child,
    matchesBefore,
    before,
    setProps: nativeTestMatcherStringSet(record.setProps, "setProps"),
    removedProps: nativeTestMatcherStringSet(
      record.removedProps,
      "removedProps",
    ),
    events: nativeTestMatcherStringSet(record.events, "events"),
  };
}

function matchesNativeTestCommitFilter(
  commit: HostCommit,
  matcher: NormalizedNativeTestCommitFilter,
): boolean {
  return (
    (matcher.afterSequence === undefined ||
      commit.sequence > matcher.afterSequence) &&
    (matcher.sequence === undefined || commit.sequence === matcher.sequence) &&
    (matcher.priority === undefined || commit.priority === matcher.priority) &&
    (matcher.causalOperationId === undefined ||
      commit.causalContext?.operationId === matcher.causalOperationId)
  );
}

function matchesNativeTestStringArray(
  actual: readonly string[],
  expected: readonly string[] | undefined,
): boolean {
  if (expected === undefined) return true;
  const sorted = [...actual].sort();
  return (
    sorted.length === expected.length &&
    sorted.every((value, index) => value === expected[index])
  );
}

function matchesNativeTestCommit(
  commit: HostCommit,
  matcher: NormalizedNativeTestCommitMatcher,
): boolean {
  return (
    matchesNativeTestCommitFilter(commit, matcher) &&
    (matcher.mutationTypes === undefined ||
      (commit.mutations.length === matcher.mutationTypes.length &&
        commit.mutations.every(
          (mutation, index) => mutation.type === matcher.mutationTypes?.[index],
        )))
  );
}

function matchesNativeTestMutation(
  mutation: HostMutation,
  matcher: NormalizedNativeTestMutationMatcher,
): boolean {
  if (mutation.type !== matcher.type) return false;
  switch (mutation.type) {
    case "create-element":
      return (
        (matcher.node === undefined || mutation.node === matcher.node) &&
        (matcher.component === undefined ||
          mutation.component === matcher.component)
      );
    case "create-text":
    case "update-text":
    case "delete-node":
      return matcher.node === undefined || mutation.node === matcher.node;
    case "update-props":
      return (
        (matcher.node === undefined || mutation.node === matcher.node) &&
        matchesNativeTestStringArray(
          Object.keys(mutation.props),
          matcher.setProps,
        ) &&
        matchesNativeTestStringArray(
          mutation.removedProps,
          matcher.removedProps,
        )
      );
    case "update-event-listeners":
      return (
        (matcher.node === undefined || mutation.node === matcher.node) &&
        matchesNativeTestStringArray(mutation.events, matcher.events)
      );
    case "insert-child":
      return (
        (matcher.parent === undefined || mutation.parent === matcher.parent) &&
        (matcher.child === undefined || mutation.child === matcher.child) &&
        (!matcher.matchesBefore ||
          (matcher.before === null
            ? mutation.before === undefined
            : mutation.before === matcher.before))
      );
    case "remove-child":
      return (
        (matcher.parent === undefined || mutation.parent === matcher.parent) &&
        (matcher.child === undefined || mutation.child === matcher.child)
      );
    case "command":
      return (
        (matcher.node === undefined || mutation.node === matcher.node) &&
        (matcher.command === undefined || mutation.command === matcher.command)
      );
  }
}

function describeNativeTestCommitMatcher(
  matcher: NormalizedNativeTestCommitMatcher,
): string {
  const parts: string[] = [];
  if (matcher.afterSequence !== undefined) {
    parts.push(`after sequence ${String(matcher.afterSequence)}`);
  }
  if (matcher.sequence !== undefined) {
    parts.push(`sequence ${String(matcher.sequence)}`);
  }
  if (matcher.priority !== undefined) {
    parts.push(`priority ${JSON.stringify(matcher.priority)}`);
  }
  if (matcher.causalOperationId !== undefined) {
    parts.push(
      `cause ${clippedNativeTestDebugValue(matcher.causalOperationId, HOST_CAUSAL_OPERATION_ID_MAX_LENGTH)}`,
    );
  }
  if (matcher.mutationTypes !== undefined) {
    parts.push(
      `exact mutations ${clippedNativeTestDebugValue(matcher.mutationTypes, NATIVE_TEST_COMMIT_VALUE_MAX_CHARACTERS)}`,
    );
  }
  return parts.length === 0 ? "all render commits" : parts.join(", ");
}

function describeNativeTestMutationMatcher(
  matcher: NormalizedNativeTestMutationMatcher,
): string {
  const parts = [JSON.stringify(matcher.type)];
  if (matcher.node !== undefined) parts.push(`node ${String(matcher.node)}`);
  if (matcher.component !== undefined) {
    parts.push(`component ${JSON.stringify(matcher.component)}`);
  }
  if (matcher.command !== undefined) {
    parts.push(`command ${JSON.stringify(matcher.command)}`);
  }
  if (matcher.parent !== undefined) {
    parts.push(`parent ${String(matcher.parent)}`);
  }
  if (matcher.child !== undefined) parts.push(`child ${String(matcher.child)}`);
  if (matcher.matchesBefore) {
    parts.push(
      matcher.before === null
        ? "appended without before"
        : `before ${String(matcher.before)}`,
    );
  }
  for (const [name, values] of [
    ["setProps", matcher.setProps],
    ["removedProps", matcher.removedProps],
    ["events", matcher.events],
  ] as const) {
    if (values !== undefined) {
      parts.push(
        `${name} ${clippedNativeTestDebugValue(values, NATIVE_TEST_COMMIT_VALUE_MAX_CHARACTERS)}`,
      );
    }
  }
  const commit = describeNativeTestCommitMatcher({
    ...matcher.commit,
    mutationTypes: undefined,
  });
  if (commit !== "all render commits") parts.push(commit);
  return parts.join(", ");
}

function nativeTestLimit(
  value: number | undefined,
  fallback: number,
  maximum: number,
  description: string,
): number {
  const candidate = value ?? fallback;
  if (
    !Number.isSafeInteger(candidate) ||
    candidate < 1 ||
    candidate > maximum
  ) {
    throw new RangeError(
      `Native test ${description} must be an integer from 1 through ${String(maximum)}.`,
    );
  }
  return candidate;
}

function nativeTestWaitLimit(
  value: number | undefined,
  fallback: number,
  maximum: number,
  name: string,
): number {
  const candidate = value ?? fallback;
  if (
    !Number.isSafeInteger(candidate) ||
    candidate < 1 ||
    candidate > maximum
  ) {
    throw new RangeError(
      `Native test waitFor ${name} must be an integer from 1 through ${String(maximum)} milliseconds.`,
    );
  }
  return candidate;
}

function assertNativeTestWaitSignal(signal: AbortSignal | undefined): void {
  if (
    signal !== undefined &&
    (signal === null ||
      typeof signal !== "object" ||
      typeof signal.aborted !== "boolean" ||
      typeof signal.addEventListener !== "function" ||
      typeof signal.removeEventListener !== "function")
  ) {
    throw new TypeError("Native test waitFor signal must be an AbortSignal.");
  }
}

function assertNativeTestWaitActive(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new NativeTestWaitAbortedError(signal.reason);
  }
}

function isNativeTestPromiseLike(
  value: unknown,
): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { readonly then?: unknown }).then === "function"
  );
}

async function nativeTestWaitDelay(
  milliseconds: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  assertNativeTestWaitActive(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(finish, milliseconds);
    function finish(): void {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    function abort(): void {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new NativeTestWaitAbortedError(signal?.reason));
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function clippedNativeTestDebugValue(
  value: HostValue,
  maximum: number,
): string {
  const serialized = JSON.stringify(value, (_key, nested: unknown) =>
    nested !== null && typeof nested === "object" && !Array.isArray(nested)
      ? Object.fromEntries(
          Object.entries(nested).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        )
      : nested,
  );
  return serialized.length <= maximum
    ? serialized
    : `${serialized.slice(0, maximum)}…`;
}

/** Formats one trusted in-memory host snapshot without writing to the console. */
export function formatNativeTestTree(
  snapshot: InMemorySurfaceSnapshot,
  options: NativeTestDebugOptions = {},
): string {
  const includeProps = options.includeProps ?? false;
  if (typeof includeProps !== "boolean") {
    throw new TypeError("Native test debug includeProps must be a boolean.");
  }
  const maxDepth = nativeTestLimit(
    options.maxDepth,
    NATIVE_TEST_DEBUG_DEFAULT_MAX_DEPTH,
    NATIVE_TEST_DEBUG_MAX_DEPTH,
    "debug maxDepth",
  );
  const maxNodes = nativeTestLimit(
    options.maxNodes,
    NATIVE_TEST_DEBUG_DEFAULT_MAX_NODES,
    NATIVE_TEST_DEBUG_MAX_NODES,
    "debug maxNodes",
  );
  const nodes = new Map(snapshot.nodes.map((node) => [node.node, node]));
  const roots = snapshot.nodes.filter((node) => node.parent === null);
  const stack = roots
    .slice()
    .reverse()
    .map((node) => ({ depth: 0, node }));
  const lines = [
    `Native surface ${JSON.stringify(snapshot.name)} (id=${String(snapshot.id)}, sequence=${String(snapshot.sequence)})`,
  ];
  const visited = new Set<NodeHandle>();
  let renderedNodes = 0;
  while (stack.length > 0 && renderedNodes < maxNodes) {
    const current = stack.pop()!;
    if (visited.has(current.node.node)) continue;
    visited.add(current.node.node);
    renderedNodes += 1;
    const indentation = "  ".repeat(current.depth);
    if (current.node.kind === "text") {
      lines.push(
        `${indentation}#text node=${String(current.node.node)} ${clippedNativeTestDebugValue(current.node.text, NATIVE_TEST_DEBUG_TEXT_MAX_CHARACTERS)}`,
      );
      continue;
    }
    const attributes: string[] = [`node=${String(current.node.node)}`];
    for (const [name, value] of [
      ["role", current.node.props.accessibilityRole],
      ["label", current.node.props.accessibilityLabel],
      ["testID", current.node.props.testID],
    ] as const) {
      if (typeof value === "string") {
        attributes.push(
          `${name}=${clippedNativeTestDebugValue(value, NATIVE_TEST_DEBUG_TEXT_MAX_CHARACTERS)}`,
        );
      }
    }
    if (current.node.eventListeners.length > 0) {
      attributes.push(
        `events=${JSON.stringify([...current.node.eventListeners].sort())}`,
      );
    }
    if (includeProps) {
      attributes.push(
        `props=${clippedNativeTestDebugValue(current.node.props, NATIVE_TEST_DEBUG_PROPS_MAX_CHARACTERS)}`,
      );
    }
    lines.push(
      `${indentation}<${current.node.component} ${attributes.join(" ")}>`,
    );
    if (current.node.children.length === 0) continue;
    if (current.depth >= maxDepth) {
      lines.push(`${indentation}  … depth limit`);
      continue;
    }
    for (const childHandle of current.node.children.slice().reverse()) {
      const child = nodes.get(childHandle);
      if (child === undefined) {
        lines.push(`${indentation}  <missing node=${String(childHandle)}>`);
      } else {
        stack.push({ depth: current.depth + 1, node: child });
      }
    }
  }
  const omitted = snapshot.nodes.length - visited.size;
  if (omitted > 0) lines.push(`… ${String(omitted)} node(s) omitted`);
  if (snapshot.nodes.length === 0) lines.push("  <empty>");
  return lines.join("\n");
}

function formatNativeTestMutation(
  mutation: HostMutation,
  includeValues: boolean,
): string {
  switch (mutation.type) {
    case "create-element":
      return `create-element node=${String(mutation.node)} component=${clippedNativeTestDebugValue(mutation.component, NATIVE_TEST_DEBUG_TEXT_MAX_CHARACTERS)}${includeValues ? ` props=${clippedNativeTestDebugValue(mutation.props, NATIVE_TEST_COMMIT_VALUE_MAX_CHARACTERS)}` : ""}`;
    case "create-text":
      return `create-text node=${String(mutation.node)}${includeValues ? ` text=${clippedNativeTestDebugValue(mutation.text, NATIVE_TEST_DEBUG_TEXT_MAX_CHARACTERS)}` : ""}`;
    case "update-props": {
      const set = Object.keys(mutation.props).sort();
      const removed = [...mutation.removedProps].sort();
      return `update-props node=${String(mutation.node)} set=${clippedNativeTestDebugValue(set, NATIVE_TEST_COMMIT_VALUE_MAX_CHARACTERS)} removed=${clippedNativeTestDebugValue(removed, NATIVE_TEST_COMMIT_VALUE_MAX_CHARACTERS)}${includeValues ? ` props=${clippedNativeTestDebugValue(mutation.props, NATIVE_TEST_COMMIT_VALUE_MAX_CHARACTERS)}` : ""}`;
    }
    case "update-text":
      return `update-text node=${String(mutation.node)}${includeValues ? ` text=${clippedNativeTestDebugValue(mutation.text, NATIVE_TEST_DEBUG_TEXT_MAX_CHARACTERS)}` : ""}`;
    case "update-event-listeners":
      return `update-event-listeners node=${String(mutation.node)} events=${clippedNativeTestDebugValue([...mutation.events].sort(), NATIVE_TEST_COMMIT_VALUE_MAX_CHARACTERS)}`;
    case "insert-child":
      return `insert-child parent=${String(mutation.parent)} child=${String(mutation.child)}${mutation.before === undefined ? "" : ` before=${String(mutation.before)}`}`;
    case "remove-child":
      return `remove-child parent=${String(mutation.parent)} child=${String(mutation.child)}`;
    case "delete-node":
      return `delete-node node=${String(mutation.node)}`;
    case "command":
      return `command node=${String(mutation.node)} name=${clippedNativeTestDebugValue(mutation.command, NATIVE_TEST_DEBUG_TEXT_MAX_CHARACTERS)}${includeValues ? ` args=${clippedNativeTestDebugValue(mutation.args, NATIVE_TEST_COMMIT_VALUE_MAX_CHARACTERS)}` : ""}`;
  }
}

/** Formats trusted, render-scoped commits without writing to the console. */
export function formatNativeTestCommits(
  commits: readonly HostCommit[],
  options: NativeTestCommitDebugOptions = {},
): string {
  const includeValues = options.includeValues ?? false;
  if (typeof includeValues !== "boolean") {
    throw new TypeError(
      "Native test commit debug includeValues must be a boolean.",
    );
  }
  const maxCommits = nativeTestLimit(
    options.maxCommits,
    NATIVE_TEST_COMMIT_DEFAULT_MAX_COMMITS,
    NATIVE_TEST_COMMIT_MAX_COMMITS,
    "commit debug maxCommits",
  );
  const maxMutations = nativeTestLimit(
    options.maxMutations,
    NATIVE_TEST_COMMIT_DEFAULT_MAX_MUTATIONS,
    NATIVE_TEST_COMMIT_MAX_MUTATIONS,
    "commit debug maxMutations",
  );
  const selected = commits.slice(-maxCommits);
  const lines = [
    `Native commits (showing ${String(selected.length)} of ${String(commits.length)})`,
  ];
  const omittedCommits = commits.length - selected.length;
  if (omittedCommits > 0) {
    lines.push(`… ${String(omittedCommits)} earlier commit(s) omitted`);
  }
  let mutationsToOmit = Math.max(
    0,
    selected.reduce((total, commit) => total + commit.mutations.length, 0) -
      maxMutations,
  );
  for (const commit of selected) {
    lines.push(
      `commit surface=${String(commit.surface)} sequence=${String(commit.sequence)} priority=${commit.priority} mutations=${String(commit.mutations.length)}${commit.causalContext === undefined ? "" : ` cause=${clippedNativeTestDebugValue(commit.causalContext.operationId, NATIVE_TEST_DEBUG_TEXT_MAX_CHARACTERS)}`}`,
    );
    const omittedMutations = Math.min(mutationsToOmit, commit.mutations.length);
    mutationsToOmit -= omittedMutations;
    if (omittedMutations > 0) {
      lines.push(`  … ${String(omittedMutations)} earlier mutation(s) omitted`);
    }
    const visibleMutations = commit.mutations.slice(omittedMutations);
    for (const mutation of visibleMutations) {
      lines.push(`  ${formatNativeTestMutation(mutation, includeValues)}`);
    }
  }
  if (commits.length === 0) lines.push("  <empty>");
  return lines.join("\n");
}

function nativeTestElements(
  host: InMemoryHost,
  snapshot: InMemorySurfaceSnapshot,
): readonly NativeTestElement[] {
  const nodes = new Map(snapshot.nodes.map((node) => [node.node, node]));
  const textContent = (node: InMemoryNodeSnapshot): string =>
    node.kind === "text"
      ? node.text
      : node.children
          .map((child) => nodes.get(child))
          .filter((child): child is InMemoryNodeSnapshot => child !== undefined)
          .map(textContent)
          .join("");
  return snapshot.nodes.flatMap((node) =>
    node.kind === "text"
      ? []
      : [
          {
            host,
            surface: snapshot.id,
            node: node.node,
            component: node.component,
            props: node.props,
            eventListeners: node.eventListeners,
            parent: node.parent,
            children: node.children,
            textContent: textContent(node),
          },
        ],
  );
}

function nativeTestAvailableSummary(
  elements: readonly NativeTestElement[],
): string {
  if (elements.length === 0) return " No native elements are mounted.";
  const summary = elements
    .slice(0, NATIVE_TEST_NODE_SUMMARY_LIMIT)
    .map((element) => {
      const role = element.props.accessibilityRole;
      const label = element.props.accessibilityLabel;
      const testId = element.props.testID;
      return `<${element.component} node=${String(element.node)}${typeof role === "string" ? ` role=${JSON.stringify(role)}` : ""}${typeof label === "string" ? ` label=${JSON.stringify(label)}` : ""}${typeof testId === "string" ? ` testID=${JSON.stringify(testId)}` : ""}${element.textContent.length === 0 ? "" : ` text=${JSON.stringify(element.textContent.slice(0, 120))}`}>`;
    })
    .join(", ");
  return ` Available: ${summary}${elements.length > NATIVE_TEST_NODE_SUMMARY_LIMIT ? ", …" : ""}.`;
}

function describeNativeTestRoleQuery(
  role: string,
  options: NativeTestRoleOptions,
): string {
  return options.name === undefined
    ? `role ${JSON.stringify(role)}`
    : `role ${JSON.stringify(role)} and accessible name ${describeNativeTestMatcher(options.name)}`;
}

export interface NativeTestScope {
  readonly root: NativeTestElement;
  queryAllByComponent(component: string): readonly NativeTestElement[];
  queryByComponent(component: string): NativeTestElement | undefined;
  getByComponent(component: string): NativeTestElement;
  findByComponent(
    component: string,
    options?: NativeTestWaitOptions,
  ): Promise<NativeTestElement>;
  queryAllByText(matcher: NativeTestTextMatcher): readonly NativeTestElement[];
  queryByText(matcher: NativeTestTextMatcher): NativeTestElement | undefined;
  getByText(matcher: NativeTestTextMatcher): NativeTestElement;
  findByText(
    matcher: NativeTestTextMatcher,
    options?: NativeTestWaitOptions,
  ): Promise<NativeTestElement>;
  queryAllByTestId(testId: string): readonly NativeTestElement[];
  queryByTestId(testId: string): NativeTestElement | undefined;
  getByTestId(testId: string): NativeTestElement;
  findByTestId(
    testId: string,
    options?: NativeTestWaitOptions,
  ): Promise<NativeTestElement>;
  queryAllByLabelText(
    matcher: NativeTestTextMatcher,
  ): readonly NativeTestElement[];
  queryByLabelText(
    matcher: NativeTestTextMatcher,
  ): NativeTestElement | undefined;
  getByLabelText(matcher: NativeTestTextMatcher): NativeTestElement;
  findByLabelText(
    matcher: NativeTestTextMatcher,
    options?: NativeTestWaitOptions,
  ): Promise<NativeTestElement>;
  queryAllByRole(
    role: string,
    options?: NativeTestRoleOptions,
  ): readonly NativeTestElement[];
  queryByRole(
    role: string,
    options?: NativeTestRoleOptions,
  ): NativeTestElement | undefined;
  getByRole(role: string, options?: NativeTestRoleOptions): NativeTestElement;
  findByRole(
    role: string,
    options?: NativeTestRoleOptions,
    waitOptions?: NativeTestWaitOptions,
  ): Promise<NativeTestElement>;
}

/**
 * One deterministic Solid Native application render. Queries always read the
 * latest immutable host snapshot, so a returned element can be used for an
 * event and stale handles fail instead of silently targeting another node.
 */
export interface NativeTestRender {
  readonly application: NativeApplication;
  readonly host: InMemoryHost;
  readonly surfaceId: SurfaceId;
  readonly commits: readonly HostCommit[];
  readonly disposed: boolean;
  snapshot(): InMemorySurfaceSnapshot;
  debug(options?: NativeTestDebugOptions): string;
  debugCommits(options?: NativeTestCommitDebugOptions): string;
  /** Returns the latest render-owned sequence for an exclusive afterSequence filter. */
  commitCheckpoint(): CommitSequence;
  queryAllCommits(matcher?: NativeTestCommitMatcher): readonly HostCommit[];
  queryCommit(matcher?: NativeTestCommitMatcher): HostCommit | undefined;
  getCommit(matcher?: NativeTestCommitMatcher): HostCommit;
  queryAllMutations<Matcher extends NativeTestMutationMatcher>(
    matcher: Matcher,
  ): readonly NativeTestMutationMatch<NativeTestMatchedMutation<Matcher>>[];
  queryMutation<Matcher extends NativeTestMutationMatcher>(
    matcher: Matcher,
  ): NativeTestMutationMatch<NativeTestMatchedMutation<Matcher>> | undefined;
  getMutation<Matcher extends NativeTestMutationMatcher>(
    matcher: Matcher,
  ): NativeTestMutationMatch<NativeTestMatchedMutation<Matcher>>;
  flush(): Promise<HostCommitResult | undefined>;
  act<T>(callback: () => T | PromiseLike<T>): Promise<T>;
  waitFor<T>(assertion: () => T, options?: NativeTestWaitOptions): Promise<T>;
  queryAllByComponent(component: string): readonly NativeTestElement[];
  queryByComponent(component: string): NativeTestElement | undefined;
  getByComponent(component: string): NativeTestElement;
  findByComponent(
    component: string,
    options?: NativeTestWaitOptions,
  ): Promise<NativeTestElement>;
  queryAllByText(matcher: NativeTestTextMatcher): readonly NativeTestElement[];
  queryByText(matcher: NativeTestTextMatcher): NativeTestElement | undefined;
  getByText(matcher: NativeTestTextMatcher): NativeTestElement;
  findByText(
    matcher: NativeTestTextMatcher,
    options?: NativeTestWaitOptions,
  ): Promise<NativeTestElement>;
  queryAllByTestId(testId: string): readonly NativeTestElement[];
  queryByTestId(testId: string): NativeTestElement | undefined;
  getByTestId(testId: string): NativeTestElement;
  findByTestId(
    testId: string,
    options?: NativeTestWaitOptions,
  ): Promise<NativeTestElement>;
  queryAllByLabelText(
    matcher: NativeTestTextMatcher,
  ): readonly NativeTestElement[];
  queryByLabelText(
    matcher: NativeTestTextMatcher,
  ): NativeTestElement | undefined;
  getByLabelText(matcher: NativeTestTextMatcher): NativeTestElement;
  findByLabelText(
    matcher: NativeTestTextMatcher,
    options?: NativeTestWaitOptions,
  ): Promise<NativeTestElement>;
  queryAllByRole(
    role: string,
    options?: NativeTestRoleOptions,
  ): readonly NativeTestElement[];
  queryByRole(
    role: string,
    options?: NativeTestRoleOptions,
  ): NativeTestElement | undefined;
  getByRole(role: string, options?: NativeTestRoleOptions): NativeTestElement;
  findByRole(
    role: string,
    options?: NativeTestRoleOptions,
    waitOptions?: NativeTestWaitOptions,
  ): Promise<NativeTestElement>;
  within(target: NativeTestElement): NativeTestScope;
  fireEvent(
    target: NativeTestElement,
    name: string,
    payload?: HostValue,
    options?: NativeTestEventOptions,
  ): Promise<NativeEvent>;
  press(target: NativeTestElement, payload?: HostValue): Promise<NativeEvent>;
  cleanup(): Promise<void>;
  assertDisposed(): void;
}

class NativeTestRenderImplementation implements NativeTestRender {
  readonly application: NativeApplication;
  readonly host: InMemoryHost;
  readonly surfaceId: SurfaceId;

  readonly #commitOffset: number;
  #disposal: Promise<void> | undefined;
  #disposed = false;

  constructor(
    application: NativeApplication,
    host: InMemoryHost,
    commitOffset: number,
  ) {
    this.application = application;
    this.host = host;
    this.surfaceId = application.root.surfaceId;
    this.#commitOffset = commitOffset;
  }

  get commits(): readonly HostCommit[] {
    return this.host.commits
      .slice(this.#commitOffset)
      .filter((commit) => commit.surface === this.surfaceId);
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  snapshot(): InMemorySurfaceSnapshot {
    if (this.#disposed) {
      throw new Error("Cannot inspect a disposed native test render.");
    }
    return this.host.getSurfaceSnapshot(this.surfaceId);
  }

  debug(options: NativeTestDebugOptions = {}): string {
    return formatNativeTestTree(this.snapshot(), options);
  }

  debugCommits(options: NativeTestCommitDebugOptions = {}): string {
    if (this.#disposed) {
      throw new Error(
        "Cannot inspect commits for a disposed native test render.",
      );
    }
    return formatNativeTestCommits(this.commits, options);
  }

  commitCheckpoint(): CommitSequence {
    this.#assertCommitInspection();
    return this.commits.at(-1)?.sequence ?? 0;
  }

  queryAllCommits(
    matcher: NativeTestCommitMatcher = {},
  ): readonly HostCommit[] {
    this.#assertCommitInspection();
    const normalized = normalizeNativeTestCommitMatcher(matcher);
    return this.commits.filter((commit) =>
      matchesNativeTestCommit(commit, normalized),
    );
  }

  queryCommit(matcher: NativeTestCommitMatcher = {}): HostCommit | undefined {
    const normalized = normalizeNativeTestCommitMatcher(matcher);
    return this.#optionalCommit(
      this.queryAllCommits(matcher),
      describeNativeTestCommitMatcher(normalized),
    );
  }

  getCommit(matcher: NativeTestCommitMatcher = {}): HostCommit {
    const normalized = normalizeNativeTestCommitMatcher(matcher);
    return this.#oneCommit(
      this.queryAllCommits(matcher),
      describeNativeTestCommitMatcher(normalized),
    );
  }

  queryAllMutations<Matcher extends NativeTestMutationMatcher>(
    matcher: Matcher,
  ): readonly NativeTestMutationMatch<NativeTestMatchedMutation<Matcher>>[] {
    this.#assertCommitInspection();
    const normalized = normalizeNativeTestMutationMatcher(
      matcher,
      this.host,
      this.surfaceId,
    );
    const matches: NativeTestMutationMatch[] = [];
    for (const commit of this.commits) {
      if (!matchesNativeTestCommitFilter(commit, normalized.commit)) continue;
      commit.mutations.forEach((mutation, index) => {
        if (matchesNativeTestMutation(mutation, normalized)) {
          matches.push({ commit, mutation, index });
        }
      });
    }
    return matches as unknown as readonly NativeTestMutationMatch<
      NativeTestMatchedMutation<Matcher>
    >[];
  }

  queryMutation<Matcher extends NativeTestMutationMatcher>(
    matcher: Matcher,
  ): NativeTestMutationMatch<NativeTestMatchedMutation<Matcher>> | undefined {
    const normalized = normalizeNativeTestMutationMatcher(
      matcher,
      this.host,
      this.surfaceId,
    );
    return this.#optionalMutation(
      this.queryAllMutations(matcher),
      describeNativeTestMutationMatcher(normalized),
    );
  }

  getMutation<Matcher extends NativeTestMutationMatcher>(
    matcher: Matcher,
  ): NativeTestMutationMatch<NativeTestMatchedMutation<Matcher>> {
    const normalized = normalizeNativeTestMutationMatcher(
      matcher,
      this.host,
      this.surfaceId,
    );
    return this.#oneMutation(
      this.queryAllMutations(matcher),
      describeNativeTestMutationMatcher(normalized),
    );
  }

  async flush(): Promise<HostCommitResult | undefined> {
    if (this.#disposed) {
      throw new Error("Cannot flush a disposed native test render.");
    }
    return await this.application.root.flush();
  }

  async act<T>(callback: () => T | PromiseLike<T>): Promise<T> {
    if (typeof callback !== "function") {
      throw new TypeError("Native test act requires a callback.");
    }
    if (this.#disposed) {
      throw new Error("Cannot act on a disposed native test render.");
    }
    const result = await callback();
    await Promise.resolve();
    await this.flush();
    return result;
  }

  async waitFor<T>(
    assertion: () => T,
    options: NativeTestWaitOptions = {},
  ): Promise<T> {
    if (typeof assertion !== "function") {
      throw new TypeError(
        "Native test waitFor requires an assertion callback.",
      );
    }
    if (this.#disposed) {
      throw new Error("Cannot wait on a disposed native test render.");
    }
    const timeout = nativeTestWaitLimit(
      options.timeout,
      NATIVE_TEST_WAIT_DEFAULT_TIMEOUT,
      NATIVE_TEST_WAIT_MAX_TIMEOUT,
      "timeout",
    );
    const interval = nativeTestWaitLimit(
      options.interval,
      NATIVE_TEST_WAIT_DEFAULT_INTERVAL,
      NATIVE_TEST_WAIT_MAX_INTERVAL,
      "interval",
    );
    assertNativeTestWaitSignal(options.signal);
    const startedAt = Date.now();
    let attempts = 0;
    let lastError: unknown;
    for (;;) {
      assertNativeTestWaitActive(options.signal);
      await Promise.resolve();
      await this.flush();
      attempts += 1;
      try {
        const result = assertion();
        if (isNativeTestPromiseLike(result)) {
          void Promise.resolve(result).catch(() => undefined);
          throw new NativeTestAsyncAssertionError();
        }
        return result;
      } catch (error) {
        if (error instanceof NativeTestAsyncAssertionError) throw error;
        lastError = error;
      }
      const elapsed = Date.now() - startedAt;
      if (elapsed >= timeout) {
        throw new NativeTestWaitTimeoutError(
          timeout,
          attempts,
          lastError,
          `${this.debug({ maxDepth: 16, maxNodes: 50 })}\n\n${this.debugCommits({ maxCommits: 3, maxMutations: 20 })}`,
        );
      }
      await nativeTestWaitDelay(
        Math.min(interval, Math.max(1, timeout - elapsed)),
        options.signal,
      );
    }
  }

  queryAllByComponent(component: string): readonly NativeTestElement[] {
    if (typeof component !== "string" || component.length === 0) {
      throw new TypeError("Native component queries require a non-empty name.");
    }
    return this.#elements().filter(
      (element) => element.component === component,
    );
  }

  queryByComponent(component: string): NativeTestElement | undefined {
    return this.#optionalOne(
      this.queryAllByComponent(component),
      `component ${JSON.stringify(component)}`,
    );
  }

  getByComponent(component: string): NativeTestElement {
    return this.#one(
      this.queryAllByComponent(component),
      `component ${JSON.stringify(component)}`,
    );
  }

  async findByComponent(
    component: string,
    options: NativeTestWaitOptions = {},
  ): Promise<NativeTestElement> {
    this.queryAllByComponent(component);
    return await this.waitFor(() => this.getByComponent(component), options);
  }

  queryAllByText(matcher: NativeTestTextMatcher): readonly NativeTestElement[] {
    assertNativeTestTextMatcher(matcher);
    return this.#elements().filter((element) => {
      const descriptor = this.host.getComponentDescriptor(element.component);
      return (
        descriptor?.acceptsRawText === true &&
        matchesNativeTestText(element.textContent, matcher)
      );
    });
  }

  queryByText(matcher: NativeTestTextMatcher): NativeTestElement | undefined {
    return this.#optionalOne(
      this.queryAllByText(matcher),
      `text ${describeNativeTestMatcher(matcher)}`,
    );
  }

  getByText(matcher: NativeTestTextMatcher): NativeTestElement {
    return this.#one(
      this.queryAllByText(matcher),
      `text ${describeNativeTestMatcher(matcher)}`,
    );
  }

  async findByText(
    matcher: NativeTestTextMatcher,
    options: NativeTestWaitOptions = {},
  ): Promise<NativeTestElement> {
    this.queryAllByText(matcher);
    return await this.waitFor(() => this.getByText(matcher), options);
  }

  queryAllByTestId(testId: string): readonly NativeTestElement[] {
    if (typeof testId !== "string" || testId.length === 0) {
      throw new TypeError("Native test-ID queries require a non-empty value.");
    }
    return this.#elements().filter(
      (element) => element.props.testID === testId,
    );
  }

  queryByTestId(testId: string): NativeTestElement | undefined {
    return this.#optionalOne(
      this.queryAllByTestId(testId),
      `test ID ${JSON.stringify(testId)}`,
    );
  }

  getByTestId(testId: string): NativeTestElement {
    return this.#one(
      this.queryAllByTestId(testId),
      `test ID ${JSON.stringify(testId)}`,
    );
  }

  async findByTestId(
    testId: string,
    options: NativeTestWaitOptions = {},
  ): Promise<NativeTestElement> {
    this.queryAllByTestId(testId);
    return await this.waitFor(() => this.getByTestId(testId), options);
  }

  queryAllByLabelText(
    matcher: NativeTestTextMatcher,
  ): readonly NativeTestElement[] {
    assertNativeTestTextMatcher(matcher);
    return this.#elements().filter((element) => {
      const label = element.props.accessibilityLabel;
      return typeof label === "string" && matchesNativeTestText(label, matcher);
    });
  }

  queryByLabelText(
    matcher: NativeTestTextMatcher,
  ): NativeTestElement | undefined {
    return this.#optionalOne(
      this.queryAllByLabelText(matcher),
      `accessibility label ${describeNativeTestMatcher(matcher)}`,
    );
  }

  getByLabelText(matcher: NativeTestTextMatcher): NativeTestElement {
    return this.#one(
      this.queryAllByLabelText(matcher),
      `accessibility label ${describeNativeTestMatcher(matcher)}`,
    );
  }

  async findByLabelText(
    matcher: NativeTestTextMatcher,
    options: NativeTestWaitOptions = {},
  ): Promise<NativeTestElement> {
    this.queryAllByLabelText(matcher);
    return await this.waitFor(() => this.getByLabelText(matcher), options);
  }

  queryAllByRole(
    role: string,
    options: NativeTestRoleOptions = {},
  ): readonly NativeTestElement[] {
    if (typeof role !== "string" || role.length === 0) {
      throw new TypeError("Native role queries require a non-empty role.");
    }
    if (options.name !== undefined) {
      assertNativeTestTextMatcher(options.name);
    }
    return this.#elements().filter((element) => {
      if (element.props.accessibilityRole !== role) return false;
      if (options.name === undefined) return true;
      const label = element.props.accessibilityLabel;
      const accessibleName =
        typeof label === "string" ? label : element.textContent;
      return matchesNativeTestText(accessibleName, options.name);
    });
  }

  queryByRole(
    role: string,
    options: NativeTestRoleOptions = {},
  ): NativeTestElement | undefined {
    return this.#optionalOne(
      this.queryAllByRole(role, options),
      describeNativeTestRoleQuery(role, options),
    );
  }

  getByRole(
    role: string,
    options: NativeTestRoleOptions = {},
  ): NativeTestElement {
    return this.#one(
      this.queryAllByRole(role, options),
      describeNativeTestRoleQuery(role, options),
    );
  }

  async findByRole(
    role: string,
    options: NativeTestRoleOptions = {},
    waitOptions: NativeTestWaitOptions = {},
  ): Promise<NativeTestElement> {
    this.queryAllByRole(role, options);
    return await this.waitFor(() => this.getByRole(role, options), waitOptions);
  }

  within(target: NativeTestElement): NativeTestScope {
    if (target.host !== this.host || target.surface !== this.surfaceId) {
      throw new Error(
        `Native test element ${String(target.node)} belongs to another render (surface ${String(target.surface)}); expected the current host and surface ${String(this.surfaceId)}.`,
      );
    }
    const current = this.#elementByHandle(target.node);
    if (current.component !== target.component) {
      throw new Error(
        `Native test element ${String(target.node)} is stale; expected ${target.component}, found ${current.component}.`,
      );
    }
    return new NativeTestScopeImplementation(this, current);
  }

  async fireEvent(
    target: NativeTestElement,
    name: string,
    payload: HostValue = null,
    options: NativeTestEventOptions = {},
  ): Promise<NativeEvent> {
    if (typeof name !== "string" || name.length === 0) {
      throw new TypeError("Native test events require a non-empty name.");
    }
    if (target.host !== this.host || target.surface !== this.surfaceId) {
      throw new Error(
        `Native test element ${String(target.node)} belongs to another render (surface ${String(target.surface)}); expected the current host and surface ${String(this.surfaceId)}.`,
      );
    }
    const current = this.#elementByHandle(target.node);
    if (current.component !== target.component) {
      throw new Error(
        `Native test element ${String(target.node)} is stale; expected ${target.component}, found ${current.component}.`,
      );
    }
    const descriptor = this.host.getComponentDescriptor(current.component);
    const bubbles =
      options.bubbles ?? descriptor?.bubblingEvents.includes(name) ?? false;
    let event!: NativeEvent;
    await this.act(() => {
      event = this.host.injectEvent({
        surface: this.surfaceId,
        target: current.node,
        name,
        payload,
        bubbles,
        ...(options.observedSequence === undefined
          ? {}
          : { observedSequence: options.observedSequence }),
        ...(options.timestamp === undefined
          ? {}
          : { timestamp: options.timestamp }),
        ...(options.priority === undefined
          ? {}
          : { priority: options.priority }),
        ...(options.coalescible === undefined
          ? {}
          : { coalescible: options.coalescible }),
      });
    });
    return event;
  }

  async press(
    target: NativeTestElement,
    payload: HostValue = null,
  ): Promise<NativeEvent> {
    return await this.fireEvent(target, "press", payload, {
      priority: "discrete",
    });
  }

  cleanup(): Promise<void> {
    this.#disposal ??= (async () => {
      await this.application.dispose();
      if (this.host.hasSurface(this.surfaceId)) {
        throw new Error(
          `Native test cleanup left surface ${String(this.surfaceId)} alive.`,
        );
      }
      this.#disposed = true;
    })();
    return this.#disposal;
  }

  assertDisposed(): void {
    if (!this.#disposed) {
      throw new Error("Native test render has not completed cleanup.");
    }
  }

  #assertCommitInspection(): void {
    if (this.#disposed) {
      throw new Error(
        "Cannot inspect commits for a disposed native test render.",
      );
    }
  }

  #optionalCommit(
    commits: readonly HostCommit[],
    query: string,
  ): HostCommit | undefined {
    if (commits.length <= 1) return commits[0];
    throw new NativeTestCommitQueryError(
      query,
      commits.length,
      this.debugCommits(),
    );
  }

  #oneCommit(commits: readonly HostCommit[], query: string): HostCommit {
    const commit = commits.length === 1 ? commits[0] : undefined;
    if (commit !== undefined) return commit;
    throw new NativeTestCommitQueryError(
      query,
      commits.length,
      this.debugCommits(),
    );
  }

  #optionalMutation<Mutation extends HostMutation>(
    mutations: readonly NativeTestMutationMatch<Mutation>[],
    query: string,
  ): NativeTestMutationMatch<Mutation> | undefined {
    if (mutations.length <= 1) return mutations[0];
    throw new NativeTestMutationQueryError(
      query,
      mutations.length,
      this.debugCommits(),
    );
  }

  #oneMutation<Mutation extends HostMutation>(
    mutations: readonly NativeTestMutationMatch<Mutation>[],
    query: string,
  ): NativeTestMutationMatch<Mutation> {
    const mutation = mutations.length === 1 ? mutations[0] : undefined;
    if (mutation !== undefined) return mutation;
    throw new NativeTestMutationQueryError(
      query,
      mutations.length,
      this.debugCommits(),
    );
  }

  #optionalOne(
    elements: readonly NativeTestElement[],
    query: string,
  ): NativeTestElement | undefined {
    if (elements.length <= 1) return elements[0];
    throw new NativeTestQueryError(
      query,
      elements.length,
      this.#availableSummary(),
    );
  }

  #one(
    elements: readonly NativeTestElement[],
    query: string,
  ): NativeTestElement {
    const element = elements.length === 1 ? elements[0] : undefined;
    if (element !== undefined) return element;
    throw new NativeTestQueryError(
      query,
      elements.length,
      this.#availableSummary(),
    );
  }

  #elementByHandle(node: NodeHandle): NativeTestElement {
    const element = this.#elements().find(
      (candidate) => candidate.node === node,
    );
    if (element === undefined) {
      throw new Error(
        `Native test element ${String(node)} is no longer mounted on surface ${String(this.surfaceId)}.`,
      );
    }
    return element;
  }

  #elements(): readonly NativeTestElement[] {
    return nativeTestElements(this.host, this.snapshot());
  }

  #availableSummary(): string {
    return nativeTestAvailableSummary(this.#elements());
  }
}

class NativeTestScopeImplementation implements NativeTestScope {
  readonly root: NativeTestElement;
  readonly #render: NativeTestRender;

  constructor(render: NativeTestRender, root: NativeTestElement) {
    this.#render = render;
    this.root = root;
  }

  queryAllByComponent(component: string): readonly NativeTestElement[] {
    return this.#filter(this.#render.queryAllByComponent(component));
  }

  queryByComponent(component: string): NativeTestElement | undefined {
    return this.#optionalOne(
      this.queryAllByComponent(component),
      `component ${JSON.stringify(component)}`,
    );
  }

  getByComponent(component: string): NativeTestElement {
    return this.#one(
      this.queryAllByComponent(component),
      `component ${JSON.stringify(component)}`,
    );
  }

  async findByComponent(
    component: string,
    options: NativeTestWaitOptions = {},
  ): Promise<NativeTestElement> {
    this.queryAllByComponent(component);
    return await this.#render.waitFor(
      () => this.getByComponent(component),
      options,
    );
  }

  queryAllByText(matcher: NativeTestTextMatcher): readonly NativeTestElement[] {
    return this.#filter(this.#render.queryAllByText(matcher));
  }

  queryByText(matcher: NativeTestTextMatcher): NativeTestElement | undefined {
    return this.#optionalOne(
      this.queryAllByText(matcher),
      `text ${describeNativeTestMatcher(matcher)}`,
    );
  }

  getByText(matcher: NativeTestTextMatcher): NativeTestElement {
    return this.#one(
      this.queryAllByText(matcher),
      `text ${describeNativeTestMatcher(matcher)}`,
    );
  }

  async findByText(
    matcher: NativeTestTextMatcher,
    options: NativeTestWaitOptions = {},
  ): Promise<NativeTestElement> {
    this.queryAllByText(matcher);
    return await this.#render.waitFor(() => this.getByText(matcher), options);
  }

  queryAllByTestId(testId: string): readonly NativeTestElement[] {
    return this.#filter(this.#render.queryAllByTestId(testId));
  }

  queryByTestId(testId: string): NativeTestElement | undefined {
    return this.#optionalOne(
      this.queryAllByTestId(testId),
      `test ID ${JSON.stringify(testId)}`,
    );
  }

  getByTestId(testId: string): NativeTestElement {
    return this.#one(
      this.queryAllByTestId(testId),
      `test ID ${JSON.stringify(testId)}`,
    );
  }

  async findByTestId(
    testId: string,
    options: NativeTestWaitOptions = {},
  ): Promise<NativeTestElement> {
    this.queryAllByTestId(testId);
    return await this.#render.waitFor(() => this.getByTestId(testId), options);
  }

  queryAllByLabelText(
    matcher: NativeTestTextMatcher,
  ): readonly NativeTestElement[] {
    return this.#filter(this.#render.queryAllByLabelText(matcher));
  }

  queryByLabelText(
    matcher: NativeTestTextMatcher,
  ): NativeTestElement | undefined {
    return this.#optionalOne(
      this.queryAllByLabelText(matcher),
      `accessibility label ${describeNativeTestMatcher(matcher)}`,
    );
  }

  getByLabelText(matcher: NativeTestTextMatcher): NativeTestElement {
    return this.#one(
      this.queryAllByLabelText(matcher),
      `accessibility label ${describeNativeTestMatcher(matcher)}`,
    );
  }

  async findByLabelText(
    matcher: NativeTestTextMatcher,
    options: NativeTestWaitOptions = {},
  ): Promise<NativeTestElement> {
    this.queryAllByLabelText(matcher);
    return await this.#render.waitFor(
      () => this.getByLabelText(matcher),
      options,
    );
  }

  queryAllByRole(
    role: string,
    options: NativeTestRoleOptions = {},
  ): readonly NativeTestElement[] {
    return this.#filter(this.#render.queryAllByRole(role, options));
  }

  queryByRole(
    role: string,
    options: NativeTestRoleOptions = {},
  ): NativeTestElement | undefined {
    return this.#optionalOne(
      this.queryAllByRole(role, options),
      describeNativeTestRoleQuery(role, options),
    );
  }

  getByRole(
    role: string,
    options: NativeTestRoleOptions = {},
  ): NativeTestElement {
    return this.#one(
      this.queryAllByRole(role, options),
      describeNativeTestRoleQuery(role, options),
    );
  }

  async findByRole(
    role: string,
    options: NativeTestRoleOptions = {},
    waitOptions: NativeTestWaitOptions = {},
  ): Promise<NativeTestElement> {
    this.queryAllByRole(role, options);
    return await this.#render.waitFor(
      () => this.getByRole(role, options),
      waitOptions,
    );
  }

  #filter(
    elements: readonly NativeTestElement[],
  ): readonly NativeTestElement[] {
    const handles = new Set(
      this.#scopedElements().map((element) => element.node),
    );
    return elements.filter((element) => handles.has(element.node));
  }

  #scopedElements(): readonly NativeTestElement[] {
    const snapshot = this.#render.snapshot();
    const elements = nativeTestElements(this.#render.host, snapshot);
    const currentRoot = elements.find(
      (element) => element.node === this.root.node,
    );
    if (currentRoot === undefined) {
      throw new Error(
        `Native test scope root ${String(this.root.node)} is no longer mounted on surface ${String(this.root.surface)}.`,
      );
    }
    if (currentRoot.component !== this.root.component) {
      throw new Error(
        `Native test scope root ${String(this.root.node)} is stale; expected ${this.root.component}, found ${currentRoot.component}.`,
      );
    }
    const nodes = new Map(snapshot.nodes.map((node) => [node.node, node]));
    return elements.filter((element) => {
      let current = nodes.get(element.node);
      let remaining = nodes.size + 1;
      while (current !== undefined && remaining > 0) {
        if (current.node === this.root.node) return true;
        current =
          current.parent === null ? undefined : nodes.get(current.parent);
        remaining -= 1;
      }
      return false;
    });
  }

  #optionalOne(
    elements: readonly NativeTestElement[],
    query: string,
  ): NativeTestElement | undefined {
    if (elements.length <= 1) return elements[0];
    throw new NativeTestQueryError(
      query,
      elements.length,
      nativeTestAvailableSummary(this.#scopedElements()),
    );
  }

  #one(
    elements: readonly NativeTestElement[],
    query: string,
  ): NativeTestElement {
    const element = elements.length === 1 ? elements[0] : undefined;
    if (element !== undefined) return element;
    throw new NativeTestQueryError(
      query,
      elements.length,
      nativeTestAvailableSummary(this.#scopedElements()),
    );
  }
}

/**
 * Mounts one Solid Native tree into the strict in-memory host and flushes its
 * initial commit before returning. The render always disables background
 * auto-commit scheduling so every later mutation crosses an explicit test
 * boundary through flush, act, or fireEvent.
 */
export async function renderNative(
  code: () => unknown,
  options: RenderNativeOptions = {},
): Promise<NativeTestRender> {
  if (typeof code !== "function") {
    throw new TypeError("renderNative requires a root callback.");
  }
  if (options.host !== undefined && options.hostOptions !== undefined) {
    throw new TypeError("renderNative cannot combine host and hostOptions.");
  }
  const host =
    options.host ??
    new InMemoryHost({
      ...options.hostOptions,
      descriptors:
        options.hostOptions?.descriptors ?? CORE_COMPONENT_DESCRIPTORS,
    });
  const commitOffset = host.commits.length;
  const application = mount(code, host, {
    ...options.rootOptions,
    surface: options.surface ?? { name: "test" },
    autoCommit: false,
  });
  const result = new NativeTestRenderImplementation(
    application,
    host,
    commitOffset,
  );
  try {
    await result.flush();
    return result;
  } catch (error) {
    await result.cleanup().catch(() => undefined);
    throw error;
  }
}
