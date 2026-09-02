import {
  HOST_CAUSAL_OPERATION_ID_MAX_LENGTH,
  type CommitPriority,
  type CommitSequence,
  type HostCausalContext,
  type HostCommit,
  type HostCommitResult,
  type HostLifecycleEvent,
  type HostMutation,
  type HostProps,
  type HostValue,
  type NativeEvent,
  type NativeMeasurement,
  type NodeHandle,
  type NativeHost,
  type SurfaceId,
  type SurfaceOptions,
} from "@solid-native/host-contract";
import {
  telemetryErrorAttributes,
  type CausalOperation,
  type CausalOperationName,
  type CausalTelemetry,
  type TelemetryAttribute,
  type TelemetryAttributes,
} from "@solid-native/observability";
import { flush as flushSolid } from "solid-js";

import {
  normalizeCommandArgs,
  normalizeHostProperty,
  normalizeStaticProps,
  parseEventProperty,
} from "./values.js";

export type NativeNodeKind = "element" | "text" | "sentinel";

export interface NativeSyntheticEvent<TPayload extends HostValue = HostValue> {
  readonly name: string;
  readonly target: NativeNode;
  readonly currentTarget: NativeNode;
  readonly observedSequence: CommitSequence;
  readonly timestamp: number;
  readonly priority: NativeEvent["priority"];
  readonly bubbles: boolean;
  readonly coalescible: boolean;
  readonly payload: TPayload;
  stopPropagation(): void;
}

export type NativeEventHandler = (event: NativeSyntheticEvent) => unknown;

export interface NativeCausalPlatformEventOptions {
  readonly coalescible?: boolean;
  readonly priority?: NativeEvent["priority"];
}

export type NativeCausalScopeState =
  "active" | "finished" | "failed" | "cancelled";

export type NativeCausalEventRetentionState = NativeCausalScopeState;

/**
 * Explicitly re-enters one platform-event operation around asynchronous
 * settlement writes. The retention is cancelled when its native root stops.
 */
export interface NativeCausalEventRetention {
  readonly state: NativeCausalEventRetentionState;
  run<T>(callback: () => T): T;
  finish(): void;
  fail(error: unknown): void;
  cancel(): void;
}

const NATIVE_CAUSAL_RETAINED_RESULT = Symbol(
  "solid-native.causal-retained-result",
);

/** Result envelope consumed by `createCausalPlatformEventHandler`. */
export interface NativeCausalRetainedResult<TResult> {
  readonly [NATIVE_CAUSAL_RETAINED_RESULT]: true;
  readonly result: TResult;
  readonly retain: (event: NativeCausalEventRetention) => void;
}

/** @internal */
export function createNativeCausalRetainedResult<TResult>(
  result: TResult,
  retain: (event: NativeCausalEventRetention) => void,
): NativeCausalRetainedResult<TResult> {
  if (typeof retain !== "function") {
    throw new TypeError("Native causal event retention must be a function.");
  }
  return Object.freeze({
    [NATIVE_CAUSAL_RETAINED_RESULT]: true as const,
    result,
    retain,
  });
}

function isNativeCausalRetainedResult<TResult>(
  value: unknown,
): value is NativeCausalRetainedResult<TResult> {
  return (
    value !== null &&
    typeof value === "object" &&
    NATIVE_CAUSAL_RETAINED_RESULT in value &&
    value[NATIVE_CAUSAL_RETAINED_RESULT] === true
  );
}

/**
 * Explicit causal context for work that cannot return its promise to a native
 * event handler. Only synchronous mutations inside `run` inherit the scope.
 */
export interface NativeCausalScope {
  readonly name: string;
  readonly state: NativeCausalScopeState;
  run<T>(callback: () => T): T;
  finish(): void;
  fail(error: unknown): void;
  cancel(): void;
}

export type NativeCausalOwnerState = "active" | "finished" | "cancelled";

/** @internal Used by the renderer's opt-in causal owner boundary. */
export interface NativeCausalOwner {
  readonly name: string;
  readonly state: NativeCausalOwnerState;
  run<T>(callback: () => T): T;
  finish(): void;
}

export type NativeCausalComputationState = "active" | "finished" | "cancelled";

/** @internal Used by the renderer's opt-in computation boundary. */
export interface NativeCausalComputation {
  readonly name: string;
  readonly state: NativeCausalComputationState;
  run<T>(callback: () => T): T;
  finish(): void;
}

export interface NativeRootOptions {
  readonly surface: SurfaceOptions;
  readonly rootComponent?: string;
  readonly autoCommit?: boolean;
  readonly onCommitError?: (error: unknown) => unknown;
  readonly telemetry?: CausalTelemetry;
  readonly onTelemetryError?: (error: unknown) => unknown;
}

export interface NativeApplication {
  readonly root: NativeRoot;
  dispose(): Promise<void>;
}

interface EventRegistration {
  readonly handler: NativeEventHandler;
}

interface MountWaiter {
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

function reportIsolatedRootError(
  handler: ((error: unknown) => unknown) | undefined,
  error: unknown,
): void {
  try {
    const reported = handler?.(error);
    void Promise.resolve(reported).catch(() => undefined);
  } catch {
    // A diagnostic observer cannot replace a renderer or telemetry failure.
  }
}

interface CausalScopeController {
  cancel(): void;
}

interface CausalComputationController extends CausalScopeController {
  readonly name: string;
  readonly parent: NativeCausalComputation | undefined;
}

interface NodeState {
  root?: NativeRoot;
  causalComputation?: NativeCausalComputation;
  causalOwner?: NativeCausalOwner;
  readonly kind: NativeNodeKind;
  handle?: NodeHandle;
  readonly component?: string;
  text?: string;
  parent?: NativeNode;
  readonly children: NativeNode[];
  readonly props: Map<string, HostValue>;
  readonly events: Map<string, EventRegistration>;
  readonly captureEvents: Map<string, EventRegistration>;
}

type PendingEntry =
  | {
      readonly kind: "create-element";
      readonly node: NodeHandle;
      readonly component: string;
      readonly props: Record<string, HostValue>;
    }
  | {
      readonly kind: "create-text";
      readonly node: NodeHandle;
      text: string;
    }
  | {
      readonly kind: "update-props";
      readonly node: NodeHandle;
      readonly props: Record<string, HostValue>;
      readonly removedProps: Set<string>;
    }
  | {
      readonly kind: "update-text";
      readonly node: NodeHandle;
      text: string;
    }
  | {
      readonly kind: "update-event-listeners";
      readonly node: NodeHandle;
      events: string[];
    }
  | { readonly kind: "mutation"; readonly mutation: HostMutation };

const NODE_STATES = new WeakMap<NativeNode, NodeState>();

const PRIORITY_RANK: Record<CommitPriority, number> = {
  background: 0,
  normal: 1,
  "user-blocking": 2,
  immediate: 3,
};

const MAX_PENDING_MOUNT_OPERATIONS = 256;
const CAUSAL_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u;

/** @internal */
export function assertNativeCausalName(
  kind: "computation" | "event" | "owner" | "scope",
  name: string,
): void {
  if (!CAUSAL_NAME_PATTERN.test(name)) {
    throw new TypeError(
      `Native causal ${kind} names must be 1-128 character identifiers.`,
    );
  }
}

function lifecycleKey(event: HostLifecycleEvent): string {
  return `${event.surface}:${event.sequence}:${event.hostRevision}`;
}

function stateOf(node: NativeNode): NodeState {
  const state = NODE_STATES.get(node);
  if (state === undefined) throw new Error("Unknown native node.");
  return state;
}

function requireHandle(node: NativeNode): NodeHandle {
  const handle = stateOf(node).handle;
  if (handle === undefined) {
    throw new Error("Sentinel nodes do not have host handles.");
  }
  return handle;
}

function isPromiseLike<T = unknown>(value: unknown): value is PromiseLike<T> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    "then" in value &&
    typeof value.then === "function"
  );
}

function distinctCausalOperations(
  ...candidates: readonly (CausalOperation | undefined)[]
): CausalOperation[] {
  return candidates.filter(
    (cause, index): cause is CausalOperation =>
      cause !== undefined && candidates.indexOf(cause) === index,
  );
}

function commitTelemetryAttributes(
  transaction: HostCommit,
): TelemetryAttributes {
  const attributes: Record<string, TelemetryAttribute> = {
    "commit.mutation_count": transaction.mutations.length,
    "commit.priority": transaction.priority,
    "commit.sequence": transaction.sequence,
    "surface.id": transaction.surface,
  };
  for (const mutation of transaction.mutations) {
    const key = `commit.mutation.${mutation.type}`;
    const count = attributes[key];
    attributes[key] = typeof count === "number" ? count + 1 : 1;
  }
  return attributes;
}

export class NativeNode {
  private constructor() {}

  get kind(): NativeNodeKind {
    return stateOf(this).kind;
  }

  get componentName(): string | undefined {
    return stateOf(this).component;
  }

  get parentNode(): NativeNode | undefined {
    return stateOf(this).parent;
  }

  get firstChild(): NativeNode | undefined {
    return stateOf(this).children[0];
  }

  get nextSibling(): NativeNode | undefined {
    const state = stateOf(this);
    if (state.parent === undefined) return undefined;
    const siblings = stateOf(state.parent).children;
    const index = siblings.indexOf(this);
    return index === -1 ? undefined : siblings[index + 1];
  }

  measure(): Promise<NativeMeasurement> {
    return nativeNodeRoot(this).measure(this);
  }

  dispatchCommand(command: string, ...args: readonly unknown[]): Promise<void> {
    return nativeNodeRoot(this).dispatchCommand(this, command, args);
  }

  focus(): Promise<void> {
    return this.dispatchCommand("focus");
  }

  blur(): Promise<void> {
    return this.dispatchCommand("blur");
  }

  /** Moves platform accessibility focus to this mounted native element. */
  focusAccessibility(): Promise<void> {
    return this.dispatchCommand("accessibilityFocus");
  }
}

class NativeRootDisposedError extends Error {
  constructor() {
    super("Native root has been disposed.");
    this.name = "NativeRootDisposedError";
  }
}

class NativeRootInitializationError extends Error {
  constructor(
    readonly initializationError: unknown,
    readonly cleanup: Promise<void>,
  ) {
    super("Native root initialization failed after acquiring its surface.", {
      cause: initializationError,
    });
    this.name = "NativeRootInitializationError";
  }
}

function createNode(state: NodeState): NativeNode {
  const node = new (NativeNode as unknown as { new (): NativeNode })();
  NODE_STATES.set(node, state);
  return node;
}

/** @internal Runs a host mutation with the causal annotations of a node. */
export function runWithNativeNodeCausalContext<T>(
  node: NativeNode,
  fallback: NativeNode | undefined,
  callback: () => T,
): T {
  const nodeComputation = stateOf(node).causalComputation;
  const fallbackComputation =
    fallback === undefined ? undefined : stateOf(fallback).causalComputation;
  // Solid disposes a component owner before its reconciler removes the
  // component's native children. The closed boundary truthfully describes no
  // further output; fall back to an active parent boundary instead of trying
  // to revive it for teardown mutations.
  const computation =
    nodeComputation?.state === "active"
      ? nodeComputation
      : fallbackComputation?.state === "active"
        ? fallbackComputation
        : undefined;
  const owner =
    stateOf(node).causalOwner ??
    (fallback === undefined ? undefined : stateOf(fallback).causalOwner);
  const run = () =>
    computation === undefined ? callback() : computation.run(callback);
  return owner === undefined ? run() : owner.run(run);
}

/** @internal */
export function createDetachedNativeText(value: string): NativeNode {
  return createNode({
    kind: "text",
    text: value,
    children: [],
    props: new Map(),
    events: new Map(),
    captureEvents: new Map(),
  });
}

/** @internal */
export function createDetachedNativeSentinel(): NativeNode {
  return createNode({
    kind: "sentinel",
    children: [],
    props: new Map(),
    events: new Map(),
    captureEvents: new Map(),
  });
}

export class NativeRoot {
  readonly host: NativeHost;
  readonly surfaceId: SurfaceId;
  readonly container: NativeNode;

  readonly #autoCommit: boolean;
  readonly #onCommitError: ((error: unknown) => unknown) | undefined;
  readonly #telemetry: CausalTelemetry | undefined;
  readonly #onTelemetryError: ((error: unknown) => unknown) | undefined;
  readonly #surfaceOperation: CausalOperation | undefined;
  readonly #nodes = new Set<NativeNode>();
  readonly #nodesByHandle = new Map<NodeHandle, NativeNode>();
  readonly #pending: PendingEntry[] = [];
  readonly #pendingCreates = new Map<
    NodeHandle,
    PendingEntry & { kind: "create-element" }
  >();
  readonly #pendingTextCreates = new Map<
    NodeHandle,
    PendingEntry & { kind: "create-text" }
  >();
  readonly #pendingProps = new Map<
    NodeHandle,
    PendingEntry & { kind: "update-props" }
  >();
  readonly #pendingText = new Map<
    NodeHandle,
    PendingEntry & { kind: "update-text" }
  >();
  readonly #pendingEventListeners = new Map<
    NodeHandle,
    PendingEntry & { kind: "update-event-listeners" }
  >();
  readonly #pendingDetached = new Set<NativeNode>();
  readonly #pendingCauses = new Map<string, CausalOperation>();
  readonly #pendingComputations = new Map<
    CausalComputationController,
    CausalOperation
  >();
  readonly #causalScopes = new Set<CausalScopeController>();
  readonly #mountOperations = new Map<string, CausalOperation>();
  readonly #mountedLifecycleKeys = new Set<string>();
  readonly #mountWaiters = new Map<string, MountWaiter[]>();
  readonly #pendingMeasurements = new Set<Promise<NativeMeasurement>>();
  #unsubscribe: () => void = () => {};
  #unsubscribeLifecycle: () => void = () => {};
  #supportsMountLifecycle = false;
  #commitTail: Promise<void> = Promise.resolve();
  #commandTail: Promise<void> = Promise.resolve();
  #nextSequence: CommitSequence = 1;
  #lastCommittedSequence: CommitSequence = 0;
  #pendingPriority: CommitPriority = "background";
  #scopedPriority: CommitPriority = "normal";
  #mutationGeneration = 0;
  #flushScheduled = false;
  #disposed = false;
  #disposal: Promise<void> | undefined;
  #commitError: unknown;
  #activeCause: CausalOperation | undefined;

  constructor(host: NativeHost, options: NativeRootOptions) {
    this.host = host;
    this.#autoCommit = options.autoCommit ?? true;
    this.#onCommitError = options.onCommitError;
    this.#telemetry = options.telemetry;
    this.#onTelemetryError = options.onTelemetryError;
    const component = options.rootComponent ?? "RootView";
    if (host.getComponentDescriptor(component) === undefined) {
      throw new Error(`The host does not provide root component ${component}.`);
    }
    this.surfaceId = host.createSurface(options.surface);
    try {
      this.#surfaceOperation =
        this.#telemetry === undefined
          ? undefined
          : this.#startOperation("solid-native.surface", {
              "surface.id": this.surfaceId,
              "surface.name": options.surface.name,
              "surface.root_component": component,
            });

      const handle = host.allocateNode(this.surfaceId);
      this.container = createNode({
        root: this,
        kind: "element",
        handle,
        component,
        children: [],
        props: new Map(),
        events: new Map(),
        captureEvents: new Map(),
      });
      this.#nodes.add(this.container);
      this.#nodesByHandle.set(handle, this.container);
      const previousCause = this.#activeCause;
      this.#activeCause = this.#surfaceOperation;
      try {
        this.#queueCreateElement(
          handle,
          component,
          normalizeStaticProps(options.surface.initialProps),
        );
      } finally {
        this.#activeCause = previousCause;
      }
      this.#unsubscribe = host.subscribe((event) => this.#handleEvent(event));
      this.#supportsMountLifecycle =
        host.capabilities.commitMountEvents &&
        host.subscribeLifecycle !== undefined;
      this.#unsubscribeLifecycle =
        this.#telemetry !== undefined && this.#supportsMountLifecycle
          ? host.subscribeLifecycle!((event) => this.#handleLifecycle(event))
          : () => {};
    } catch (initializationError) {
      const cleanup = this.#rollbackFailedInitialization(initializationError);
      // A direct constructor caller cannot await rollback. Observe its
      // rejection here; NativeRoot.createAsync still awaits the original
      // promise and retains any rollback failure for production startup.
      void cleanup.catch(() => undefined);
      throw new NativeRootInitializationError(initializationError, cleanup);
    }
  }

  async #rollbackFailedInitialization(
    initializationError: unknown,
  ): Promise<void> {
    this.#disposed = true;
    const cleanupErrors: unknown[] = [];
    for (const unsubscribe of [this.#unsubscribeLifecycle, this.#unsubscribe]) {
      try {
        unsubscribe();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      await this.host.destroySurface(this.surfaceId);
    } catch (error) {
      cleanupErrors.push(error);
    } finally {
      this.#finishOperation(
        this.#surfaceOperation,
        "error",
        telemetryErrorAttributes(initializationError),
      );
      this.#pending.length = 0;
      this.#pendingCreates.clear();
      this.#pendingTextCreates.clear();
      this.#pendingProps.clear();
      this.#pendingText.clear();
      this.#pendingEventListeners.clear();
      this.#pendingDetached.clear();
      this.#pendingCauses.clear();
      this.#pendingComputations.clear();
      this.#nodes.clear();
      this.#nodesByHandle.clear();
    }
    if (cleanupErrors.length === 1) throw cleanupErrors[0];
    if (cleanupErrors.length > 1) {
      throw new AggregateError(
        cleanupErrors,
        "Multiple native root initialization rollback steps failed.",
      );
    }
  }

  get lastCommittedSequence(): CommitSequence {
    return this.#lastCommittedSequence;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  createCausalScope(name: string): NativeCausalScope {
    this.#assertActive();
    assertNativeCausalName("scope", name);

    const parentCause = this.#activeCause ?? this.#surfaceOperation;
    const operation = this.#startOperation(
      "solid-native.task",
      { "task.name": name },
      parentCause === undefined ? [] : [parentCause],
    );
    let state: NativeCausalScopeState = "active";
    let controller!: CausalScopeController;
    const complete = (
      nextState: Exclude<NativeCausalScopeState, "active">,
      error?: unknown,
    ): void => {
      if (state !== "active") return;
      state = nextState;
      this.#causalScopes.delete(controller);
      this.#finishOperation(
        operation,
        nextState === "finished"
          ? "ok"
          : nextState === "failed"
            ? "error"
            : "cancelled",
        nextState === "failed" ? telemetryErrorAttributes(error) : {},
      );
    };
    controller = { cancel: () => complete("cancelled") };
    this.#causalScopes.add(controller);

    return Object.freeze({
      name,
      get state() {
        return state;
      },
      run: <T>(callback: () => T): T => {
        if (state !== "active") {
          throw new Error(`Native causal scope ${name} is no longer active.`);
        }
        this.#assertActive();
        if (typeof callback !== "function") {
          throw new TypeError(
            "Native causal scope callback must be a function.",
          );
        }
        const previousCause = this.#activeCause;
        this.#activeCause = operation;
        try {
          const result = callback();
          flushSolid();
          return result;
        } finally {
          this.#activeCause = previousCause;
        }
      },
      finish: () => complete("finished"),
      fail: (error: unknown) => complete("failed", error),
      cancel: controller.cancel,
    });
  }

  /** @internal Runs one non-Fabric native callback as a causal input event. */
  runCausalPlatformEvent<T>(
    name: string,
    options: NativeCausalPlatformEventOptions,
    callback: () => T | NativeCausalRetainedResult<T>,
  ): T {
    this.#assertActive();
    assertNativeCausalName("event", name);
    if (typeof callback !== "function") {
      throw new TypeError("Native causal event callback must be a function.");
    }
    const priority = options.priority ?? "default";
    if (
      priority !== "default" &&
      priority !== "continuous" &&
      priority !== "discrete"
    ) {
      throw new TypeError(
        "Native causal event priority must be default, continuous, or discrete.",
      );
    }
    const coalescible = options.coalescible ?? false;
    if (typeof coalescible !== "boolean") {
      throw new TypeError("Native causal event coalescible must be a boolean.");
    }

    const previousCause = this.#activeCause;
    const parentCause = previousCause ?? this.#surfaceOperation;
    const operation = this.#startOperation(
      "solid-native.event",
      {
        "event.bubbles": false,
        "event.coalescible": coalescible,
        "event.name": name,
        "event.priority": priority,
        "event.source": "platform",
        "surface.id": this.surfaceId,
      },
      parentCause === undefined ? [] : [parentCause],
    );
    const previousPriority = this.#scopedPriority;
    let operationFinished = false;
    const finishEvent = (
      status: "ok" | "error" | "cancelled",
      attributes: TelemetryAttributes,
    ): void => {
      if (operationFinished) return;
      operationFinished = true;
      this.#finishOperation(operation, status, attributes);
    };
    this.#activeCause = operation ?? previousCause;
    this.#scopedPriority = priority === "discrete" ? "user-blocking" : "normal";
    try {
      const result = callback();
      flushSolid();
      if (isNativeCausalRetainedResult<T>(result)) {
        let state: NativeCausalEventRetentionState = "active";
        let controller!: NativeCausalEventRetention;
        const complete = (
          nextState: Exclude<NativeCausalEventRetentionState, "active">,
          error?: unknown,
        ): void => {
          if (state !== "active") return;
          state = nextState;
          this.#causalScopes.delete(controller);
          finishEvent(
            nextState === "finished"
              ? "ok"
              : nextState === "failed"
                ? "error"
                : "cancelled",
            {
              "event.handler_count": 1,
              "event.propagation_stopped": false,
              ...(nextState === "failed"
                ? telemetryErrorAttributes(error)
                : {}),
            },
          );
        };
        controller = Object.freeze({
          get state() {
            return state;
          },
          run: <TResult>(settle: () => TResult): TResult => {
            if (state !== "active") {
              throw new Error(
                "Native causal event retention is no longer active.",
              );
            }
            this.#assertActive();
            if (typeof settle !== "function") {
              throw new TypeError(
                "Native causal event settlement must be a function.",
              );
            }
            const retainedCause = this.#activeCause;
            const retainedPriority = this.#scopedPriority;
            this.#activeCause = operation ?? retainedCause;
            this.#scopedPriority =
              priority === "discrete" ? "user-blocking" : "normal";
            try {
              const settled = settle();
              flushSolid();
              return settled;
            } finally {
              this.#scopedPriority = retainedPriority;
              this.#activeCause = retainedCause;
            }
          },
          finish: () => complete("finished"),
          fail: (error: unknown) => complete("failed", error),
          cancel: () => complete("cancelled"),
        });
        this.#causalScopes.add(controller);
        try {
          result.retain(controller);
        } catch (error) {
          controller.fail(error);
          throw error;
        }
        return result.result;
      }
      finishEvent("ok", {
        "event.handler_count": 1,
        "event.propagation_stopped": false,
      });
      if (isPromiseLike(result)) {
        void Promise.resolve(result).finally(() => {
          if (!this.#disposed) this.#linkPendingCause(operation);
        });
      }
      return result;
    } catch (error) {
      finishEvent("error", {
        "event.handler_count": 1,
        ...telemetryErrorAttributes(error),
      });
      throw error;
    } finally {
      this.#scopedPriority = previousPriority;
      this.#activeCause = previousCause;
    }
  }

  createCausalOwner(name: string): NativeCausalOwner {
    this.#assertActive();
    assertNativeCausalName("owner", name);

    const parentCause = this.#activeCause ?? this.#surfaceOperation;
    const operation = this.#startOperation(
      "solid-native.owner",
      { "owner.name": name },
      parentCause === undefined ? [] : [parentCause],
    );
    let state: NativeCausalOwnerState = "active";
    let controller!: CausalScopeController;
    const complete = (
      nextState: Exclude<NativeCausalOwnerState, "active">,
    ): void => {
      if (state !== "active") return;
      state = nextState;
      this.#causalScopes.delete(controller);
      this.#finishOperation(
        operation,
        nextState === "finished" ? "ok" : "cancelled",
      );
    };
    controller = { cancel: () => complete("cancelled") };
    this.#causalScopes.add(controller);

    return Object.freeze({
      name,
      get state() {
        return state;
      },
      run: <T>(callback: () => T): T => {
        this.#assertActive();
        if (typeof callback !== "function") {
          throw new TypeError(
            "Native causal owner callback must be a function.",
          );
        }
        const previousCause = this.#activeCause;
        const previousMutationGeneration = this.#mutationGeneration;
        this.#activeCause = operation;
        try {
          return callback();
        } finally {
          if (this.#mutationGeneration !== previousMutationGeneration) {
            this.#linkPendingCause(previousCause);
          }
          this.#activeCause = previousCause;
        }
      },
      finish: () => complete("finished"),
    });
  }

  /** @internal Creates one opt-in annotation for selected reactive output. */
  createCausalComputation(
    name: string,
    parent?: NativeCausalComputation,
  ): NativeCausalComputation {
    this.#assertActive();
    assertNativeCausalName("computation", name);
    let state: NativeCausalComputationState = "active";
    let controller!: CausalComputationController;
    const complete = (
      nextState: Exclude<NativeCausalComputationState, "active">,
    ): void => {
      if (state !== "active") return;
      state = nextState;
      this.#causalScopes.delete(controller);
      const operation = this.#pendingComputations.get(controller);
      this.#pendingComputations.delete(controller);
      this.#finishOperation(
        operation,
        nextState === "finished" ? "ok" : "cancelled",
      );
    };
    controller = {
      name,
      parent,
      cancel: () => complete("cancelled"),
    };
    this.#causalScopes.add(controller);

    const runCurrent = <T>(callback: () => T): T => {
      if (state !== "active") {
        throw new Error(
          `Native causal computation ${name} is no longer active.`,
        );
      }
      this.#assertActive();
      if (typeof callback !== "function") {
        throw new TypeError(
          "Native causal computation callback must be a function.",
        );
      }
      if (this.#telemetry === undefined) return callback();

      const previousCause = this.#activeCause;
      const existingOperation = this.#pendingComputations.get(controller);
      const parentCause = previousCause ?? this.#surfaceOperation;
      const operation =
        existingOperation ??
        this.#startOperation(
          "solid-native.computation",
          {
            "computation.kind": "native-output",
            "computation.name": name,
          },
          parentCause === undefined ? [] : [parentCause],
        );
      if (operation === undefined) return callback();

      const previousMutationGeneration = this.#mutationGeneration;
      let failed = false;
      let failure: unknown;
      this.#activeCause = operation;
      try {
        return callback();
      } catch (caught) {
        failed = true;
        failure = caught;
        throw caught;
      } finally {
        const mutated = this.#mutationGeneration !== previousMutationGeneration;
        if (mutated) this.#linkPendingCause(previousCause);
        this.#activeCause = previousCause;
        if (failed) {
          this.#pendingComputations.delete(controller);
          this.#finishOperation(operation, "error", {
            ...telemetryErrorAttributes(failure),
          });
        } else if (mutated) {
          this.#pendingComputations.set(controller, operation);
        } else if (existingOperation === undefined) {
          this.#finishOperation(operation);
        }
      }
    };

    return Object.freeze({
      name,
      get state() {
        return state;
      },
      run: <T>(callback: () => T): T =>
        parent === undefined
          ? runCurrent(callback)
          : parent.run(() => runCurrent(callback)),
      finish: () => complete("finished"),
    });
  }

  /** @internal */
  createElement(
    component: string,
    staticProps: Record<string, unknown> | undefined,
    causalOwner?: NativeCausalOwner,
    causalComputation?: NativeCausalComputation,
  ): NativeNode {
    this.#assertActive();
    let resolvedComponent = component;
    if (this.host.getComponentDescriptor(resolvedComponent) === undefined) {
      const capitalized = `${component[0]?.toUpperCase() ?? ""}${component.slice(1)}`;
      if (this.host.getComponentDescriptor(capitalized) !== undefined) {
        resolvedComponent = capitalized;
      } else {
        throw new Error(`Unknown native component: ${component}.`);
      }
    }

    const handle = this.host.allocateNode(this.surfaceId);
    const props = normalizeStaticProps(staticProps);
    const node = createNode({
      root: this,
      ...(causalComputation === undefined ? {} : { causalComputation }),
      ...(causalOwner === undefined ? {} : { causalOwner }),
      kind: "element",
      handle,
      component: resolvedComponent,
      children: [],
      props: new Map(Object.entries(props)),
      events: new Map(),
      captureEvents: new Map(),
    });
    this.#nodes.add(node);
    this.#nodesByHandle.set(handle, node);
    this.#queueCreateElement(handle, resolvedComponent, props);

    for (const [name, value] of Object.entries(staticProps ?? {})) {
      if (parseEventProperty(name) !== undefined) {
        this.setProperty(node, name, value);
      }
    }
    return node;
  }

  /** @internal */
  createText(value: string): NativeNode {
    this.#assertActive();
    const node = createDetachedNativeText(value);
    this.#materializeNode(node);
    return node;
  }

  /** @internal */
  createSentinel(): NativeNode {
    this.#assertActive();
    const node = createDetachedNativeSentinel();
    this.#materializeNode(node);
    return node;
  }

  /** @internal */
  replaceText(node: NativeNode, value: string): void {
    const state = this.#requireNode(node);
    if (state.kind !== "text") {
      throw new Error("Only text nodes can receive text updates.");
    }
    if (state.text === value) return;
    state.text = value;
    const handle = requireHandle(node);
    const create = this.#pendingTextCreates.get(handle);
    if (create !== undefined) {
      create.text = value;
    } else {
      const existing = this.#pendingText.get(handle);
      if (existing !== undefined) {
        existing.text = value;
      } else {
        const entry: PendingEntry & { kind: "update-text" } = {
          kind: "update-text",
          node: handle,
          text: value,
        };
        this.#pending.push(entry);
        this.#pendingText.set(handle, entry);
      }
    }
    this.#scheduleCommit();
  }

  /** @internal */
  setProperty(node: NativeNode, name: string, value: unknown): void {
    const state = this.#requireNode(node);
    if (state.kind !== "element") {
      throw new Error(`Cannot set property ${name} on a ${state.kind} node.`);
    }

    const event = parseEventProperty(name);
    if (event !== undefined) {
      const registry = event.capture ? state.captureEvents : state.events;
      const observedBefore =
        state.events.has(event.name) || state.captureEvents.has(event.name);
      if (value === undefined || value === null) {
        registry.delete(event.name);
      } else if (typeof value === "function") {
        registry.set(event.name, {
          handler: value as NativeEventHandler,
        });
      } else {
        throw new TypeError(`Event property ${name} must be a function.`);
      }
      const observedAfter =
        state.events.has(event.name) || state.captureEvents.has(event.name);
      if (observedBefore !== observedAfter) {
        this.#queueEventListeners(requireHandle(node), state);
      }
      return;
    }

    if (name === "children" || name === "ref") return;
    const normalized = normalizeHostProperty(name, value);
    const handle = requireHandle(node);
    const create = this.#pendingCreates.get(handle);

    if (normalized === undefined) {
      state.props.delete(name);
      if (create !== undefined) {
        delete create.props[name];
      } else {
        const update = this.#getPendingProps(handle);
        delete update.props[name];
        update.removedProps.add(name);
      }
    } else {
      state.props.set(name, normalized);
      if (create !== undefined) {
        create.props[name] = normalized;
      } else {
        const update = this.#getPendingProps(handle);
        update.props[name] = normalized;
        update.removedProps.delete(name);
      }
    }
    this.#scheduleCommit();
  }

  /** @internal */
  insertNode(parent: NativeNode, node: NativeNode, anchor?: NativeNode): void {
    const parentState = this.#requireNode(parent);
    const detachedState = stateOf(node);
    if (
      detachedState.causalOwner === undefined &&
      parentState.causalOwner !== undefined
    ) {
      detachedState.causalOwner = parentState.causalOwner;
    }
    if (
      detachedState.causalComputation === undefined &&
      parentState.causalComputation !== undefined
    ) {
      detachedState.causalComputation = parentState.causalComputation;
    }
    const nodeState = this.#materializeNode(node);
    if (parentState.kind !== "element") {
      throw new Error("Native children can only be inserted into elements.");
    }
    if (parent === node) throw new Error("A node cannot be its own parent.");
    if (anchor !== undefined && stateOf(anchor).parent !== parent) {
      throw new Error("The insertion anchor is not a child of the parent.");
    }

    for (
      let ancestor: NativeNode | undefined = parent;
      ancestor !== undefined;
    ) {
      if (ancestor === node)
        throw new Error("The insertion would create a cycle.");
      ancestor = stateOf(ancestor).parent;
    }

    if (nodeState.parent !== undefined) {
      const oldSiblings = stateOf(nodeState.parent).children;
      const oldIndex = oldSiblings.indexOf(node);
      if (oldIndex !== -1) oldSiblings.splice(oldIndex, 1);
    }

    let index =
      anchor === undefined
        ? parentState.children.length
        : parentState.children.indexOf(anchor);
    if (index < 0) index = parentState.children.length;
    parentState.children.splice(index, 0, node);
    nodeState.parent = parent;
    this.#pendingDetached.delete(node);

    if (nodeState.kind !== "sentinel") {
      let before: NodeHandle | undefined;
      for (let next = index + 1; next < parentState.children.length; next++) {
        const candidate = stateOf(
          parentState.children[next] as NativeNode,
        ).handle;
        if (candidate !== undefined) {
          before = candidate;
          break;
        }
      }
      this.#queueMutation({
        type: "insert-child",
        parent: requireHandle(parent),
        child: requireHandle(node),
        ...(before === undefined ? {} : { before }),
      });
    }
  }

  /** @internal */
  removeNode(parent: NativeNode, node: NativeNode): void {
    const parentState = this.#requireNode(parent);
    const nodeState = this.#requireNode(node);
    const index = parentState.children.indexOf(node);
    if (index === -1 || nodeState.parent !== parent) return;
    parentState.children.splice(index, 1);
    delete nodeState.parent;
    this.#pendingDetached.add(node);
    if (nodeState.kind !== "sentinel") {
      this.#queueMutation({
        type: "remove-child",
        parent: requireHandle(parent),
        child: requireHandle(node),
      });
    }
  }

  /** @internal Releases a component-owned tree that is deliberately detached. */
  releaseDetachedNode(node: NativeNode): void {
    const state = this.#requireNode(node);
    if (state.parent !== undefined) {
      throw new Error("Only a detached native node can be released.");
    }
    this.#pendingDetached.add(node);
    this.#scheduleCommit();
  }

  async flush(): Promise<HostCommitResult | undefined> {
    let result = await this.#flushPending(true);
    while (true) {
      const commands = this.#commandTail;
      await commands;
      const trailingResult = await this.#flushPending(true);
      if (trailingResult !== undefined) result = trailingResult;
      if (commands === this.#commandTail) return result;
    }
  }

  /** @internal */
  async flushMounted(): Promise<HostCommitResult | undefined> {
    const unsubscribe =
      this.#telemetry === undefined && this.#supportsMountLifecycle
        ? this.host.subscribeLifecycle!((event) => this.#handleLifecycle(event))
        : undefined;
    try {
      const result = await this.flush();
      if (result?.hostRevision !== undefined && this.#supportsMountLifecycle) {
        await this.#waitForMount(result.sequence, result.hostRevision);
      }
      return result;
    } finally {
      unsubscribe?.();
    }
  }

  async #flushPending(
    flushReactiveWork: boolean,
  ): Promise<HostCommitResult | undefined> {
    this.#flushScheduled = false;
    if (this.#commitError !== undefined) throw this.#commitError;
    if (flushReactiveWork) flushSolid();
    if (!this.#disposed) this.#reclaimDetachedNodes();
    this.#finishPendingComputations();

    const causes =
      this.#telemetry === undefined
        ? undefined
        : [...this.#pendingCauses.values()];
    this.#pendingCauses.clear();
    const mutations = this.#drainPending();
    if (mutations.length === 0) {
      await this.#commitTail;
      if (this.#commitError !== undefined) throw this.#commitError;
      return undefined;
    }

    const sequence = this.#nextSequence++;
    const priority = this.#pendingPriority;
    this.#pendingPriority = "background";
    const baseTransaction: HostCommit = {
      surface: this.surfaceId,
      sequence,
      priority,
      mutations,
    };
    let operation: CausalOperation | undefined;
    if (this.#telemetry !== undefined) {
      operation = this.#startOperation(
        "solid-native.commit",
        commitTelemetryAttributes(baseTransaction),
        causes ?? [],
      );
    }
    let causalContext: HostCausalContext | undefined;
    if (operation !== undefined) {
      if (
        typeof operation.id === "string" &&
        operation.id.length > 0 &&
        operation.id.length <= HOST_CAUSAL_OPERATION_ID_MAX_LENGTH &&
        !operation.id.includes("\0")
      ) {
        causalContext = { operationId: operation.id };
      } else {
        this.#reportTelemetryError(
          new RangeError(
            `Telemetry operation IDs crossing the host boundary must contain 1-${HOST_CAUSAL_OPERATION_ID_MAX_LENGTH} characters without null bytes.`,
          ),
        );
      }
    }
    const transaction: HostCommit = {
      ...baseTransaction,
      ...(causalContext === undefined ? {} : { causalContext }),
    };

    let resolveResult!: (result: HostCommitResult) => void;
    let rejectResult!: (error: unknown) => void;
    const resultPromise = new Promise<HostCommitResult>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });

    this.#commitTail = this.#commitTail.then(async () => {
      try {
        if (this.#commitError !== undefined) throw this.#commitError;
        const pendingResult = this.host.commit(transaction);
        const result = isPromiseLike(pendingResult)
          ? await pendingResult
          : pendingResult;
        if (
          result.surface !== this.surfaceId ||
          result.sequence !== sequence ||
          !result.mounted
        ) {
          throw new Error(
            `Host returned an invalid result for commit ${sequence} on surface ${this.surfaceId}.`,
          );
        }
        this.#lastCommittedSequence = sequence;
        this.#finishOperation(operation, "ok", {
          "commit.mounted": result.mounted,
          ...(result.hostRevision === undefined
            ? {}
            : { "commit.host_revision": result.hostRevision }),
        });
        resolveResult(result);
      } catch (error) {
        this.#commitError = error;
        this.#finishOperation(operation, "error", {
          ...telemetryErrorAttributes(error),
        });
        reportIsolatedRootError(this.#onCommitError, error);
        rejectResult(error);
      }
    });

    await this.#commitTail;
    return resultPromise;
  }

  measure(node: NativeNode): Promise<NativeMeasurement> {
    const callsiteCause = this.#activeCause;
    return runWithNativeNodeCausalContext(node, undefined, () => {
      const causes = distinctCausalOperations(callsiteCause, this.#activeCause);
      const pending = this.#measure(node, causes);
      this.#pendingMeasurements.add(pending);
      const release = (): void => {
        this.#pendingMeasurements.delete(pending);
      };
      void pending.then(release, release);
      return pending;
    });
  }

  async #measure(
    node: NativeNode,
    causes: readonly CausalOperation[],
  ): Promise<NativeMeasurement> {
    this.#requireHostNode(node);
    const target = requireHandle(node);
    const operation =
      this.#telemetry === undefined
        ? undefined
        : this.#startOperation(
            "solid-native.measure",
            {
              "surface.id": this.surfaceId,
              "target.node": target,
            },
            causes,
          );
    this.#linkPendingCause(operation);
    try {
      await this.flush();
      this.#assertActive();
      const afterSequence = this.#lastCommittedSequence;
      const measurement = await this.host.measure(
        this.surfaceId,
        target,
        afterSequence,
      );
      this.#assertActive();
      this.#finishOperation(operation, "ok", {
        "measurement.after_sequence": afterSequence,
        "measurement.observed_sequence": measurement.observedSequence,
      });
      return measurement;
    } catch (error) {
      this.#finishOperation(operation, "error", {
        ...telemetryErrorAttributes(error),
      });
      throw error;
    }
  }

  dispatchCommand(
    node: NativeNode,
    command: string,
    args: readonly unknown[],
  ): Promise<void> {
    const target = requireHandle(node);
    const callsiteCause = this.#activeCause;
    const priority = this.#scopedPriority;
    return runWithNativeNodeCausalContext(node, undefined, () => {
      const annotatedCause = this.#activeCause;
      const causes = distinctCausalOperations(callsiteCause, annotatedCause);
      // Capture the caller's synchronous event plus the node's selected
      // owner/computation before the command crosses its required microtask
      // boundary. Neither context should erase the other.
      const operation =
        this.#telemetry === undefined
          ? undefined
          : this.#startOperation(
              "solid-native.command",
              {
                "command.name": command,
                "surface.id": this.surfaceId,
                "target.node": target,
              },
              causes,
            );
      // Framework components may request an imperative correction from an
      // effect's apply phase. Start native work after that reactive drain has
      // completed so its structural barrier does not re-enter Solid's flush.
      const pending = Promise.resolve().then(() =>
        this.#dispatchCommand(node, command, args, operation, priority),
      );
      const previousCommands = this.#commandTail;
      this.#commandTail = Promise.all([previousCommands, pending]).then(
        () => undefined,
      );
      // A framework-owned command may be scheduled from a reactive effect
      // where there is no call site that can await it. Keep the rejection
      // observed; the next root flush still receives it through #commandTail.
      void this.#commandTail.catch(() => undefined);
      return pending;
    });
  }

  async #dispatchCommand(
    node: NativeNode,
    command: string,
    args: readonly unknown[],
    operation: CausalOperation | undefined,
    priority: CommitPriority,
  ): Promise<void> {
    this.#requireHostNode(node);
    const target = requireHandle(node);
    // Commands are observable side effects and cannot participate in the
    // rollback semantics of a structural transaction. Commit any pending tree
    // work first, then send exactly one command in its own sequence.
    try {
      await this.#flushPending(true);
      // A native event can enqueue reactive work while the preceding commit is
      // crossing an asynchronous host boundary. Drain all such structural work
      // before reserving the command transaction. Once JavaScript observes an
      // empty queue, queue and drain the command synchronously without another
      // Solid flush so no reactive mutation can join it.
      while (this.#pending.length > 0) await this.#flushPending(true);
      // Disposal can begin while an earlier structural commit is crossing an
      // asynchronous host boundary. Revalidate immediately before emitting
      // the observable command so a retired handle never receives it.
      this.#assertActive();
      const previousCause = this.#activeCause;
      const previousPriority = this.#scopedPriority;
      this.#activeCause = operation;
      this.#scopedPriority = priority;
      try {
        this.#queueMutation({
          type: "command",
          node: target,
          command,
          args: normalizeCommandArgs(args),
        });
      } finally {
        this.#scopedPriority = previousPriority;
        this.#activeCause = previousCause;
      }
      await this.#flushPending(false);
      this.#finishOperation(operation);
    } catch (error) {
      this.#finishOperation(operation, "error", {
        ...telemetryErrorAttributes(error),
      });
      throw error;
    }
  }

  dispose(): Promise<void> {
    this.#disposal ??= this.#dispose();
    return this.#disposal;
  }

  async #dispose(): Promise<void> {
    this.#disposed = true;
    for (const scope of [...this.#causalScopes]) scope.cancel();
    const failures: unknown[] = [];
    const retainFailure = (error: unknown): void => {
      if (!failures.includes(error)) failures.push(error);
    };

    // A host is allowed to implement measurement asynchronously. Let any read
    // that already crossed into the host settle before deleting its target or
    // destroying the surface; the post-read active check still rejects stale
    // geometry to the caller.
    await Promise.allSettled([...this.#pendingMeasurements]);

    const previousCause = this.#activeCause;
    this.#activeCause = this.#surfaceOperation;
    let teardownQueued = false;
    try {
      for (const node of this.#nodes) {
        const state = stateOf(node);
        if (
          state.kind !== "sentinel" &&
          state.parent !== undefined &&
          stateOf(state.parent).kind !== "sentinel"
        ) {
          this.#queueMutation({
            type: "remove-child",
            parent: requireHandle(state.parent),
            child: requireHandle(node),
          });
        }
        delete state.parent;
      }
      for (const node of this.#nodes) stateOf(node).children.length = 0;
      this.#pendingDetached.clear();
      for (const node of this.#nodes) {
        if (stateOf(node).kind !== "sentinel") {
          this.#queueMutation({
            type: "delete-node",
            node: requireHandle(node),
          });
        }
      }
      teardownQueued = true;
    } catch (error) {
      retainFailure(error);
    } finally {
      this.#activeCause = previousCause;
    }

    if (teardownQueued) {
      try {
        await this.flush();
      } catch (error) {
        if (!(error instanceof NativeRootDisposedError)) retainFailure(error);
      }
    }

    for (const unsubscribe of [this.#unsubscribeLifecycle, this.#unsubscribe]) {
      try {
        unsubscribe();
      } catch (error) {
        retainFailure(error);
      }
    }

    const disposedError = new Error(
      "The native root was disposed before its pending mount barrier completed.",
    );
    for (const waiters of this.#mountWaiters.values()) {
      for (const waiter of waiters) waiter.reject(disposedError);
    }
    this.#mountWaiters.clear();

    try {
      await this.host.destroySurface(this.surfaceId);
    } catch (error) {
      retainFailure(error);
    }

    const failure =
      failures.length === 0
        ? undefined
        : failures.length === 1
          ? failures[0]
          : new AggregateError(
              failures,
              "Native root disposal failed in multiple lifecycle steps.",
            );
    this.#finishOperation(
      this.#surfaceOperation,
      failure === undefined ? "ok" : "error",
      failure === undefined ? {} : telemetryErrorAttributes(failure),
    );
    this.#pending.length = 0;
    this.#pendingCreates.clear();
    this.#pendingTextCreates.clear();
    this.#pendingProps.clear();
    this.#pendingText.clear();
    this.#pendingEventListeners.clear();
    this.#pendingDetached.clear();
    this.#pendingCauses.clear();
    this.#pendingComputations.clear();
    this.#nodes.clear();
    this.#nodesByHandle.clear();
    this.#pendingMeasurements.clear();
    this.#mountOperations.clear();
    this.#mountedLifecycleKeys.clear();
    this.#causalScopes.clear();
    if (failure !== undefined) throw failure;
  }

  #assertActive(): void {
    if (this.#disposed) throw new NativeRootDisposedError();
    if (this.#commitError !== undefined) throw this.#commitError;
  }

  #materializeNode(node: NativeNode): NodeState {
    const state = stateOf(node);
    if (state.root !== undefined) {
      if (state.root !== this) {
        throw new Error("Node belongs to another native root.");
      }
      if (this.#nodes.has(node)) return state;
      this.#rematerializeRetainedSubtree(node);
      return state;
    }
    if (state.kind === "element") {
      throw new Error("Detached element nodes are not supported.");
    }

    this.#assertActive();
    state.root = this;
    this.#rematerializeRetainedSubtree(node);
    return state;
  }

  #rematerializeRetainedSubtree(node: NativeNode): void {
    const state = stateOf(node);
    if (state.root !== this) {
      throw new Error("Retained native subtree belongs to another root.");
    }
    if (this.#nodes.has(node)) return;
    this.#assertActive();
    this.#nodes.add(node);
    this.#pendingDetached.delete(node);

    if (state.kind === "element") {
      if (state.component === undefined) {
        throw new Error("Retained native element has no component identity.");
      }
      const handle = this.host.allocateNode(this.surfaceId);
      state.handle = handle;
      this.#nodesByHandle.set(handle, node);
      this.#queueCreateElement(
        handle,
        state.component,
        Object.fromEntries(state.props),
      );
      if (state.events.size > 0 || state.captureEvents.size > 0) {
        this.#queueEventListeners(handle, state);
      }
    } else if (state.kind === "text") {
      const handle = this.host.allocateNode(this.surfaceId);
      state.handle = handle;
      this.#nodesByHandle.set(handle, node);
      const entry: PendingEntry & { kind: "create-text" } = {
        kind: "create-text",
        node: handle,
        text: state.text ?? "",
      };
      this.#pending.push(entry);
      this.#pendingTextCreates.set(handle, entry);
      this.#scheduleCommit();
    }

    for (const child of state.children) {
      const childState = stateOf(child);
      if (childState.parent !== node) {
        throw new Error("Retained native subtree has an invalid child link.");
      }
      this.#rematerializeRetainedSubtree(child);
      if (state.kind !== "element" || childState.kind === "sentinel") continue;
      this.#queueMutation({
        type: "insert-child",
        parent: requireHandle(node),
        child: requireHandle(child),
      });
    }
  }

  #reclaimDetachedNodes(): void {
    const reclaim = (node: NativeNode): void => {
      if (!this.#nodes.has(node)) return;
      const state = stateOf(node);
      for (const child of [...state.children]) {
        const childState = stateOf(child);
        if (childState.kind !== "sentinel") {
          this.#pending.push({
            kind: "mutation",
            mutation: {
              type: "remove-child",
              parent: requireHandle(node),
              child: requireHandle(child),
            },
          });
        }
        reclaim(child);
      }
      if (state.kind !== "sentinel") {
        const handle = requireHandle(node);
        this.#pending.push({
          kind: "mutation",
          mutation: { type: "delete-node", node: handle },
        });
        this.#nodesByHandle.delete(handle);
      }
      this.#nodes.delete(node);
      this.#pendingDetached.delete(node);
    };

    for (const node of [...this.#pendingDetached]) {
      if (stateOf(node).parent === undefined) reclaim(node);
    }
  }

  #requireNode(node: NativeNode): NodeState {
    this.#assertActive();
    const state = stateOf(node);
    if (state.root !== this || !this.#nodes.has(node)) {
      throw new Error("Node belongs to another native root.");
    }
    return state;
  }

  #requireHostNode(node: NativeNode): NodeState {
    const state = this.#requireNode(node);
    if (state.kind === "sentinel") {
      throw new Error("Sentinel nodes cannot receive host operations.");
    }
    return state;
  }

  #queueCreateElement(
    node: NodeHandle,
    component: string,
    props: HostProps,
  ): void {
    const entry: PendingEntry & { kind: "create-element" } = {
      kind: "create-element",
      node,
      component,
      props: { ...props },
    };
    this.#pending.push(entry);
    this.#pendingCreates.set(node, entry);
    this.#scheduleCommit();
  }

  #getPendingProps(node: NodeHandle): PendingEntry & { kind: "update-props" } {
    const existing = this.#pendingProps.get(node);
    if (existing !== undefined) return existing;
    const entry: PendingEntry & { kind: "update-props" } = {
      kind: "update-props",
      node,
      props: {},
      removedProps: new Set(),
    };
    this.#pending.push(entry);
    this.#pendingProps.set(node, entry);
    return entry;
  }

  #queueMutation(mutation: HostMutation): void {
    this.#pending.push({ kind: "mutation", mutation });
    this.#scheduleCommit();
  }

  #queueEventListeners(node: NodeHandle, state: NodeState): void {
    const events = [
      ...new Set([...state.events.keys(), ...state.captureEvents.keys()]),
    ].sort();
    const existing = this.#pendingEventListeners.get(node);
    if (existing !== undefined) {
      existing.events = events;
    } else {
      const entry: PendingEntry & { kind: "update-event-listeners" } = {
        kind: "update-event-listeners",
        node,
        events,
      };
      this.#pending.push(entry);
      this.#pendingEventListeners.set(node, entry);
    }
    this.#scheduleCommit();
  }

  #scheduleCommit(priority: CommitPriority = this.#scopedPriority): void {
    this.#mutationGeneration =
      this.#mutationGeneration === Number.MAX_SAFE_INTEGER
        ? 0
        : this.#mutationGeneration + 1;
    if (PRIORITY_RANK[priority] > PRIORITY_RANK[this.#pendingPriority]) {
      this.#pendingPriority = priority;
    }
    if (this.#telemetry !== undefined) {
      this.#linkPendingCause(this.#activeCause);
    }
    if (!this.#autoCommit || this.#flushScheduled) return;
    this.#flushScheduled = true;
    void Promise.resolve().then(async () => {
      try {
        await this.flush();
      } catch {
        // The error is retained and reported through onCommitError/flush.
      }
    });
  }

  #drainPending(): HostMutation[] {
    const entries = this.#pending.splice(0);
    this.#pendingCreates.clear();
    this.#pendingTextCreates.clear();
    this.#pendingProps.clear();
    this.#pendingText.clear();
    this.#pendingEventListeners.clear();

    return entries.flatMap((entry): HostMutation[] => {
      switch (entry.kind) {
        case "create-element":
          return [
            {
              type: "create-element",
              node: entry.node,
              component: entry.component,
              props: entry.props,
            },
          ];
        case "create-text":
          return [{ type: "create-text", node: entry.node, text: entry.text }];
        case "update-props":
          if (
            Object.keys(entry.props).length === 0 &&
            entry.removedProps.size === 0
          ) {
            return [];
          }
          return [
            {
              type: "update-props",
              node: entry.node,
              props: entry.props,
              removedProps: [...entry.removedProps],
            },
          ];
        case "update-text":
          return [{ type: "update-text", node: entry.node, text: entry.text }];
        case "update-event-listeners":
          return [
            {
              type: "update-event-listeners",
              node: entry.node,
              events: entry.events,
            },
          ];
        case "mutation":
          return [entry.mutation];
      }
    });
  }

  #handleEvent(event: NativeEvent): void {
    if (event.surface !== this.surfaceId || this.#disposed) return;
    const target = this.#nodesByHandle.get(event.target);
    if (target === undefined) {
      this.#recordDroppedEvent(event, "unknown-target");
      return;
    }
    const targetState = stateOf(target);
    if (target !== this.container && targetState.parent === undefined) {
      this.#recordDroppedEvent(event, "detached-target");
      return;
    }

    const path: NativeNode[] = [];
    for (let node: NativeNode | undefined = target; node !== undefined;) {
      path.push(node);
      node = stateOf(node).parent;
    }

    const operation =
      this.#telemetry === undefined
        ? undefined
        : this.#startOperation("solid-native.event", {
            "event.bubbles": event.bubbles,
            "event.coalescible": event.coalescible,
            "event.name": event.name,
            "event.native_timestamp": event.timestamp,
            "event.observed_sequence": event.observedSequence,
            "event.priority": event.priority,
            "surface.id": event.surface,
            "target.node": event.target,
          });
    const previousCause = this.#activeCause;
    this.#activeCause = operation;
    let handlerCount = 0;
    let stopped = false;
    let dispatchComplete = false;
    let retainedCount = 0;
    let retainedStatus: "ok" | "error" | "cancelled" = "ok";
    let retainedError: unknown;
    let operationFinished = false;
    const asyncHandlers: PromiseLike<unknown>[] = [];
    const activeRetentions = new Set<NativeCausalEventRetention>();
    const finishEvent = (
      status: "ok" | "error" | "cancelled",
      attributes: TelemetryAttributes,
    ): void => {
      if (operationFinished) return;
      operationFinished = true;
      this.#finishOperation(operation, status, attributes);
    };
    const finishDispatchIfSettled = (): void => {
      if (!dispatchComplete || retainedCount !== 0 || operationFinished) return;
      const status =
        handlerCount === 0
          ? "cancelled"
          : retainedStatus === "error"
            ? "error"
            : retainedStatus === "cancelled"
              ? "cancelled"
              : "ok";
      finishEvent(status, {
        "event.handler_count": handlerCount,
        "event.propagation_stopped": stopped,
        ...(handlerCount === 0 ? { "event.drop_reason": "no-handler" } : {}),
        ...(status === "error" ? telemetryErrorAttributes(retainedError) : {}),
      });
    };
    const retainEvent = (
      retained: NativeCausalRetainedResult<unknown>,
    ): void => {
      retainedCount++;
      let state: NativeCausalEventRetentionState = "active";
      let controller!: NativeCausalEventRetention;
      const complete = (
        nextState: Exclude<NativeCausalEventRetentionState, "active">,
        error?: unknown,
      ): void => {
        if (state !== "active") return;
        state = nextState;
        activeRetentions.delete(controller);
        this.#causalScopes.delete(controller);
        retainedCount--;
        if (nextState === "failed") {
          retainedStatus = "error";
          retainedError ??= error;
        } else if (nextState === "cancelled" && retainedStatus === "ok") {
          retainedStatus = "cancelled";
        }
        finishDispatchIfSettled();
      };
      controller = Object.freeze({
        get state() {
          return state;
        },
        run: <TResult>(settle: () => TResult): TResult => {
          if (state !== "active") {
            throw new Error(
              "Native causal event retention is no longer active.",
            );
          }
          this.#assertActive();
          if (typeof settle !== "function") {
            throw new TypeError(
              "Native causal event settlement must be a function.",
            );
          }
          const retainedCause = this.#activeCause;
          const retainedPriority = this.#scopedPriority;
          this.#activeCause = operation ?? retainedCause;
          this.#scopedPriority =
            event.priority === "discrete" ? "user-blocking" : "normal";
          try {
            const settled = settle();
            flushSolid();
            return settled;
          } finally {
            this.#scopedPriority = retainedPriority;
            this.#activeCause = retainedCause;
          }
        },
        finish: () => complete("finished"),
        fail: (error: unknown) => complete("failed", error),
        cancel: () => complete("cancelled"),
      });
      activeRetentions.add(controller);
      this.#causalScopes.add(controller);
      try {
        retained.retain(controller);
      } catch (error) {
        controller.fail(error);
        throw error;
      }
    };
    const invoke = (node: NativeNode, capture: boolean): void => {
      if (stopped) return;
      const state = stateOf(node);
      const registration = (capture ? state.captureEvents : state.events).get(
        event.name,
      );
      if (registration === undefined) return;
      handlerCount++;
      const synthetic: NativeSyntheticEvent = {
        name: event.name,
        target,
        currentTarget: node,
        observedSequence: event.observedSequence,
        timestamp: event.timestamp,
        priority: event.priority,
        bubbles: event.bubbles,
        coalescible: event.coalescible,
        payload: event.payload,
        stopPropagation() {
          stopped = true;
        },
      };
      const previous = this.#scopedPriority;
      this.#scopedPriority =
        event.priority === "discrete" ? "user-blocking" : "normal";
      let result: unknown;
      try {
        // Solid 2 event callbacks are deliberately unowned. Re-entering the
        // component owner here turns ordinary signal setters into illegal
        // writes from an owned computation scope in development builds.
        result = registration.handler(synthetic);
        flushSolid();
      } finally {
        this.#scopedPriority = previous;
      }
      if (isNativeCausalRetainedResult(result)) retainEvent(result);
      else if (isPromiseLike(result)) asyncHandlers.push(result);
    };

    try {
      if (event.bubbles) {
        for (let index = path.length - 1; index >= 0; index--) {
          invoke(path[index] as NativeNode, true);
        }
      } else {
        invoke(target, true);
      }
      const bubblePath = event.bubbles ? path : [target];
      for (const node of bubblePath) invoke(node, false);
      dispatchComplete = true;
      finishDispatchIfSettled();
      for (const result of asyncHandlers) {
        void Promise.resolve(result).finally(() => {
          if (!this.#disposed) this.#linkPendingCause(operation);
        });
      }
    } catch (error) {
      for (const retention of [...activeRetentions]) retention.cancel();
      finishEvent("error", {
        "event.handler_count": handlerCount,
        ...telemetryErrorAttributes(error),
      });
      throw error;
    } finally {
      this.#activeCause = previousCause;
    }
  }

  #recordDroppedEvent(event: NativeEvent, reason: string): void {
    if (this.#telemetry === undefined) return;
    const operation = this.#startOperation("solid-native.event", {
      "event.name": event.name,
      "event.observed_sequence": event.observedSequence,
      "event.priority": event.priority,
      "surface.id": event.surface,
      "target.node": event.target,
    });
    this.#finishOperation(operation, "cancelled", {
      "event.drop_reason": reason,
      "event.handler_count": 0,
    });
  }

  #handleLifecycle(event: HostLifecycleEvent): void {
    if (event.surface !== this.surfaceId) return;
    if (event.type === "commit-mounted") {
      const key = lifecycleKey(event);
      this.#mountedLifecycleKeys.add(key);
      if (this.#mountedLifecycleKeys.size > MAX_PENDING_MOUNT_OPERATIONS) {
        const oldest = this.#mountedLifecycleKeys.values().next().value as
          string | undefined;
        if (oldest !== undefined) this.#mountedLifecycleKeys.delete(oldest);
      }
      const waiters = this.#mountWaiters.get(key);
      this.#mountWaiters.delete(key);
      if (waiters !== undefined) {
        for (const waiter of waiters) waiter.resolve();
      }
    }
    if (this.#telemetry === undefined) return;
    const commitCause =
      event.causalContext === undefined
        ? []
        : [{ id: event.causalContext.operationId }];
    const key = lifecycleKey(event);
    if (event.type === "commit-mounted") {
      const operation = this.#startOperation(
        "solid-native.mount",
        {
          "commit.sequence": event.sequence,
          "mount.host_revision": event.hostRevision,
          "surface.id": event.surface,
        },
        commitCause,
        event.commitStartedAt,
      );
      this.#finishOperation(
        operation,
        "ok",
        { "mount.completed": true },
        { timestamp: event.mountedAt, duration: event.mountLatency },
      );
      if (operation !== undefined) {
        if (this.#mountOperations.size >= MAX_PENDING_MOUNT_OPERATIONS) {
          const oldest = this.#mountOperations.keys().next().value as
            string | undefined;
          if (oldest !== undefined) this.#mountOperations.delete(oldest);
        }
        this.#mountOperations.set(key, operation);
      }
      return;
    }

    const mountOperation = this.#mountOperations.get(key);
    this.#mountOperations.delete(key);
    const operation = this.#startOperation(
      "solid-native.frame",
      {
        "commit.sequence": event.sequence,
        "frame.commit_latency": event.frameLatency,
        "frame.host_revision": event.hostRevision,
        "frame.observation": "next-vsync-after-mount",
        "surface.id": event.surface,
      },
      mountOperation === undefined ? commitCause : [mountOperation],
      event.mountedAt,
    );
    this.#finishOperation(
      operation,
      "ok",
      { "frame.started": true },
      {
        timestamp: event.frameStartedAt,
        duration: event.mountToFrameLatency,
      },
    );
  }

  #waitForMount(sequence: CommitSequence, hostRevision: number): Promise<void> {
    const key = `${this.surfaceId}:${sequence}:${hostRevision}`;
    if (this.#mountedLifecycleKeys.has(key)) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const waiters = this.#mountWaiters.get(key);
      const waiter = { resolve, reject };
      if (waiters === undefined) this.#mountWaiters.set(key, [waiter]);
      else waiters.push(waiter);
    });
  }

  #linkPendingCause(operation: CausalOperation | undefined): void {
    if (operation !== undefined && this.#pending.length > 0) {
      this.#pendingCauses.set(operation.id, operation);
    }
  }

  #finishPendingComputations(): void {
    for (const operation of this.#pendingComputations.values()) {
      this.#finishOperation(operation);
    }
    this.#pendingComputations.clear();
  }

  #startOperation(
    name: CausalOperationName,
    attributes: TelemetryAttributes,
    causes: readonly CausalOperation[] = [],
    timestamp?: number,
  ): CausalOperation | undefined {
    if (this.#telemetry === undefined) return undefined;
    try {
      return this.#telemetry.startOperation(name, {
        attributes,
        causes,
        ...(timestamp === undefined ? {} : { timestamp }),
      });
    } catch (error) {
      this.#reportTelemetryError(error);
      return undefined;
    }
  }

  #finishOperation(
    operation: CausalOperation | undefined,
    status: "ok" | "error" | "cancelled" = "ok",
    attributes: TelemetryAttributes = {},
    timing: { readonly timestamp?: number; readonly duration?: number } = {},
  ): void {
    if (operation === undefined || this.#telemetry === undefined) return;
    try {
      this.#telemetry.finishOperation(operation, {
        status,
        attributes,
        ...(timing.timestamp === undefined
          ? {}
          : { timestamp: timing.timestamp }),
        ...(timing.duration === undefined ? {} : { duration: timing.duration }),
      });
    } catch (error) {
      this.#reportTelemetryError(error);
    }
  }

  #reportTelemetryError(error: unknown): void {
    reportIsolatedRootError(this.#onTelemetryError, error);
  }
}

/** @internal Preserves the synchronous mount API while starting rollback. */
export function createNativeRoot(
  host: NativeHost,
  options: NativeRootOptions,
): NativeRoot {
  try {
    return new NativeRoot(host, options);
  } catch (error) {
    if (!(error instanceof NativeRootInitializationError)) throw error;
    throw error.initializationError;
  }
}

/** @internal Awaits surface rollback before rejecting native startup. */
export async function createNativeRootAsync(
  host: NativeHost,
  options: NativeRootOptions,
): Promise<NativeRoot> {
  try {
    return new NativeRoot(host, options);
  } catch (error) {
    if (!(error instanceof NativeRootInitializationError)) throw error;
    try {
      await error.cleanup;
    } catch (cleanupError) {
      throw new AggregateError(
        [error.initializationError, cleanupError],
        "Native root initialization and surface rollback both failed.",
      );
    }
    throw error.initializationError;
  }
}

/** @internal */
export function nativeNodeRoot(node: NativeNode): NativeRoot {
  const root = stateOf(node).root;
  if (root === undefined) {
    throw new Error("Native node is not attached to a root.");
  }
  return root;
}

/** @internal Native execution adapters use this opaque logical identity. */
export function nativeNodeHandle(node: NativeNode): NodeHandle {
  nativeNodeRoot(node);
  return requireHandle(node);
}

/** @internal */
export function nativeNodeParent(node: NativeNode): NativeNode | undefined {
  return stateOf(node).parent;
}

/** @internal */
export function nativeNodeFirstChild(node: NativeNode): NativeNode | undefined {
  return stateOf(node).children[0];
}

/** @internal */
export function nativeNodeNextSibling(
  node: NativeNode,
): NativeNode | undefined {
  return node.nextSibling;
}

/** @internal Component facades use this for current logical tree ordering. */
export function compareNativeNodeOrder(
  left: NativeNode,
  right: NativeNode,
): number {
  if (left === right) return 0;
  if (stateOf(left).root !== stateOf(right).root) {
    throw new Error("Cannot compare native nodes from different roots.");
  }
  const path = (node: NativeNode): NativeNode[] => {
    const ancestors: NativeNode[] = [];
    let current: NativeNode | undefined = node;
    while (current !== undefined) {
      ancestors.push(current);
      current = stateOf(current).parent;
    }
    return ancestors.reverse();
  };
  const leftPath = path(left);
  const rightPath = path(right);
  let sharedLength = 0;
  while (
    sharedLength < leftPath.length &&
    sharedLength < rightPath.length &&
    leftPath[sharedLength] === rightPath[sharedLength]
  ) {
    sharedLength++;
  }
  if (sharedLength === 0) {
    throw new Error("Cannot compare detached native node subtrees.");
  }
  if (sharedLength === leftPath.length) return -1;
  if (sharedLength === rightPath.length) return 1;
  const parent = leftPath[sharedLength - 1];
  const leftChild = leftPath[sharedLength];
  const rightChild = rightPath[sharedLength];
  if (
    parent === undefined ||
    leftChild === undefined ||
    rightChild === undefined
  ) {
    throw new Error("Cannot compare incomplete native node paths.");
  }
  const siblings = stateOf(parent).children;
  const leftIndex = siblings.indexOf(leftChild);
  const rightIndex = siblings.indexOf(rightChild);
  if (leftIndex < 0 || rightIndex < 0) {
    throw new Error("Cannot compare native nodes outside their parent tree.");
  }
  return leftIndex - rightIndex;
}
