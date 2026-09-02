import { createRenderer } from "@solidjs/universal";
import {
  DEV,
  createComponent as solidCreateComponent,
  createContext,
  getOwner,
  onCleanup,
  useContext,
  type Component,
  type Element as SolidElement,
} from "solid-js";

import {
  NativeRoot,
  assertNativeCausalName,
  createNativeRoot,
  createNativeRootAsync,
  createNativeCausalRetainedResult,
  createDetachedNativeSentinel,
  createDetachedNativeText,
  type NativeApplication,
  type NativeCausalComputation,
  type NativeCausalEventRetention,
  type NativeCausalPlatformEventOptions,
  type NativeCausalOwner,
  type NativeCausalRetainedResult,
  type NativeCausalScope,
  type NativeNode,
  type NativeRootOptions,
  nativeNodeFirstChild,
  nativeNodeNextSibling,
  nativeNodeParent,
  compareNativeNodeOrder,
  nativeNodeRoot,
  runWithNativeNodeCausalContext,
} from "./native-root.js";

export {
  NativeNode,
  NativeRoot,
  type NativeApplication,
  type NativeCausalComputation,
  type NativeCausalComputationState,
  type NativeCausalEventRetention,
  type NativeCausalEventRetentionState,
  type NativeCausalPlatformEventOptions,
  type NativeCausalOwner,
  type NativeCausalOwnerState,
  type NativeCausalScope,
  type NativeCausalScopeState,
  type NativeCausalRetainedResult,
  type NativeEventHandler,
  type NativeNodeKind,
  type NativeRootOptions,
  type NativeSyntheticEvent,
  compareNativeNodeOrder,
  nativeNodeHandle,
  nativeNodeRoot,
} from "./native-root.js";
export type { NativeHost, SolidNativeHost } from "@solid-native/host-contract";
export type { CausalTelemetry } from "@solid-native/observability";
export {
  Errored,
  For,
  Loading,
  Match,
  Repeat,
  Reveal,
  Show,
  Switch,
  createSignal,
} from "solid-js";

const NativeRootContext = createContext<NativeRoot>();
const NativeCausalOwnerContext = createContext<NativeCausalOwner | null>(null);
const NativeCausalComputationContext =
  createContext<NativeCausalComputation | null>(null);

function currentRoot(): NativeRoot {
  const root = useContext(NativeRootContext);
  return root;
}

/**
 * Starts a bounded task operation and cancels it with the current Solid owner.
 * Re-enter the returned scope around each synchronous reactive settlement.
 */
export function createCausalScope(name: string): NativeCausalScope {
  const scope = currentRoot().createCausalScope(name);
  onCleanup(() => scope.cancel());
  return scope;
}

export type NativeCausalScopeFactory = (name: string) => NativeCausalScope;

/** Captures the current native root for causal tasks started by later events. */
export function useNativeCausalScopeFactory(): NativeCausalScopeFactory {
  const root = currentRoot();
  return (name) => root.createCausalScope(name);
}

/**
 * Preserves a synchronous platform callback result while explicitly retaining
 * that delivery for a bounded asynchronous settlement.
 */
export function retainCausalPlatformEvent<TResult>(
  result: TResult,
  retain: (event: NativeCausalEventRetention) => void,
): NativeCausalRetainedResult<TResult> {
  return createNativeCausalRetainedResult(result, retain);
}

/**
 * Keeps one Fabric event causally active across an explicit asynchronous
 * settlement. Calls to `event.run` preserve the original event's cause and
 * priority; the retention is cancelled if its native root stops first.
 */
export function retainCausalNativeEvent<TResult>(
  result: TResult,
  retain: (event: NativeCausalEventRetention) => void,
): NativeCausalRetainedResult<TResult> {
  return createNativeCausalRetainedResult(result, retain);
}

/**
 * Wraps one non-Fabric native subscription callback in a privacy-safe causal
 * event. Synchronous Solid writes inherit its cause and commit priority; a
 * returned promise follows the same settlement rule as a Fabric event.
 */
export function createCausalPlatformEventHandler<
  TArgs extends readonly unknown[],
  TResult,
>(
  name: string,
  handler: (...args: TArgs) => NativeCausalRetainedResult<TResult>,
  options?: NativeCausalPlatformEventOptions,
): (...args: TArgs) => TResult;
export function createCausalPlatformEventHandler<
  TArgs extends readonly unknown[],
  TResult,
>(
  name: string,
  handler: (...args: TArgs) => TResult,
  options?: NativeCausalPlatformEventOptions,
): (...args: TArgs) => TResult;
export function createCausalPlatformEventHandler<
  TArgs extends readonly unknown[],
  TResult,
>(
  name: string,
  handler: (...args: TArgs) => TResult | NativeCausalRetainedResult<TResult>,
  options: NativeCausalPlatformEventOptions = {},
): (...args: TArgs) => TResult {
  if (typeof handler !== "function") {
    throw new TypeError("Native causal event handler must be a function.");
  }
  assertNativeCausalName("event", name);
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
  const normalizedOptions = Object.freeze({ coalescible, priority });
  const root = currentRoot();
  const owner = currentCausalOwner();
  return (...args) => {
    const invoke = () =>
      root.runCausalPlatformEvent(name, normalizedOptions, () =>
        handler(...args),
      );
    return owner === undefined ? invoke() : owner.run(invoke);
  };
}

export interface CausalOwnerProps {
  readonly name: string;
  readonly children?: SolidElement;
}

const CausalOwnerProvider = NativeCausalOwnerContext as Component<{
  readonly value: NativeCausalOwner;
  readonly children?: SolidElement;
}>;

/**
 * Names one selected Solid owner subtree for privacy-safe causal inspection.
 * Native mutations created beneath it link their commits to this owner.
 */
export function CausalOwner(props: CausalOwnerProps): SolidElement {
  const root = currentRoot();
  const parent = useContext(NativeCausalOwnerContext);
  const owner =
    parent === null
      ? root.createCausalOwner(props.name)
      : parent.run(() => root.createCausalOwner(props.name));
  onCleanup(() => owner.finish());
  return solidCreateComponent(CausalOwnerProvider, {
    value: owner,
    get children() {
      return props.children;
    },
  });
}

function currentCausalOwner(): NativeCausalOwner | undefined {
  if (getOwner() === null) return undefined;
  return useContext(NativeCausalOwnerContext) ?? undefined;
}

export interface CausalComputationProps {
  readonly name: string;
  readonly children?: SolidElement;
}

const CausalComputationProvider = NativeCausalComputationContext as Component<{
  readonly value: NativeCausalComputation;
  readonly children?: SolidElement;
}>;

/**
 * Names selected reactive native output without observing dependencies or
 * values. Host mutations beneath the boundary link to a computation batch.
 */
export function CausalComputation(props: CausalComputationProps): SolidElement {
  const root = currentRoot();
  const parent = useContext(NativeCausalComputationContext) ?? undefined;
  const computation = root.createCausalComputation(props.name, parent);
  onCleanup(() => computation.finish());
  return solidCreateComponent(CausalComputationProvider, {
    value: computation,
    get children() {
      return props.children;
    },
  });
}

function currentCausalComputation(): NativeCausalComputation | undefined {
  if (getOwner() === null) return undefined;
  return useContext(NativeCausalComputationContext) ?? undefined;
}

function runWithCausalAnnotations<T>(
  owner: NativeCausalOwner | undefined,
  computation: NativeCausalComputation | undefined,
  callback: () => T,
): T {
  const run = () =>
    computation === undefined ? callback() : computation.run(callback);
  return owner === undefined ? run() : owner.run(run);
}

const universal = createRenderer<NativeNode>({
  createElement(component, staticProps) {
    const root = currentRoot();
    const causalOwner = currentCausalOwner();
    const causalComputation = currentCausalComputation();
    const create = () =>
      root.createElement(
        component,
        staticProps,
        causalOwner,
        causalComputation,
      );
    return runWithCausalAnnotations(causalOwner, causalComputation, create);
  },
  createTextNode(value) {
    return createDetachedNativeText(String(value));
  },
  createSentinel() {
    return createDetachedNativeSentinel();
  },
  replaceText(node, value) {
    runWithNativeNodeCausalContext(node, undefined, () =>
      nativeNodeRoot(node).replaceText(node, String(value)),
    );
  },
  isTextNode(node) {
    return node.kind === "text";
  },
  setProperty(node, name, value) {
    runWithNativeNodeCausalContext(node, undefined, () =>
      nativeNodeRoot(node).setProperty(node, name, value),
    );
  },
  insertNode(parent, node, anchor) {
    runWithNativeNodeCausalContext(node, parent, () =>
      nativeNodeRoot(parent).insertNode(parent, node, anchor),
    );
  },
  removeNode(parent, node) {
    runWithNativeNodeCausalContext(node, parent, () =>
      nativeNodeRoot(parent).removeNode(parent, node),
    );
  },
  cleanupNodes(parent, nodes) {
    const root = nativeNodeRoot(parent);
    for (const node of nodes) {
      runWithNativeNodeCausalContext(node, parent, () => {
        if (nativeNodeParent(node) === parent) root.removeNode(parent, node);
      });
    }
  },
  getParentNode: nativeNodeParent,
  getFirstChild: nativeNodeFirstChild,
  getNextSibling: nativeNodeNextSibling,
});

interface UniversalEffectOptions {
  readonly name?: string;
}

type UniversalEffect = <T>(
  compute: (previous?: T) => T,
  apply: (value: T, previous?: T) => void,
  options?: UniversalEffectOptions,
) => void;

type UniversalInsert = <T>(
  parent: NativeNode,
  accessor: (() => T) | T,
  marker?: NativeNode | null,
  initial?: unknown,
  options?: UniversalEffectOptions,
) => NativeNode;

const universalEffect = universal.effect as UniversalEffect;
const universalInsert = universal.insert as UniversalInsert;

function currentCausalEffectOptions(): UniversalEffectOptions | undefined {
  if (DEV === undefined) return undefined;
  const computation = currentCausalComputation();
  return computation === undefined ? undefined : { name: computation.name };
}

/**
 * Creates a universal render effect carrying the active native-output name.
 * Solid's development attribution can therefore use the same stable name as
 * the renderer's value-free causal telemetry.
 */
export function effect<T>(
  compute: (previous?: T) => T,
  apply: (value: T, previous?: T) => void,
): void {
  universalEffect(compute, apply, currentCausalEffectOptions());
}

/** Inserts reactive output while carrying an active causal computation name. */
export function insert<T>(
  parent: NativeNode,
  accessor: (() => T) | T,
  marker?: NativeNode | null,
  initial?: unknown,
): NativeNode {
  return universalInsert(
    parent,
    accessor,
    marker,
    initial,
    currentCausalEffectOptions(),
  );
}

/**
 * Applies component props through the named effect/insert adapters above.
 * `@solidjs/universal` 2.0.0-rc.3 does not expose effect options on spread, so
 * the development path deliberately mirrors its small public helper until the
 * upstream explicit-options API is published.
 */
export function spread<T extends object>(
  node: NativeNode,
  props: T,
  skipChildren = false,
): void {
  if (DEV === undefined) {
    universal.spread(node, props, skipChildren);
    return;
  }
  const source = props as Record<string, unknown>;
  const previous: Record<string, unknown> = {};
  if (!skipChildren) insert(node, () => source.children);
  effect(
    () => {
      const resolved = source.ref;
      if (typeof resolved === "function" || Array.isArray(resolved)) {
        universal.ref(
          () =>
            resolved as
              | ((element: NativeNode) => void)
              | ((element: NativeNode) => void)[],
          node,
        );
      }
    },
    () => undefined,
  );
  effect(
    () => {
      const next: Record<string, unknown> = {};
      for (const property in source) {
        if (property === "children" || property === "ref") continue;
        next[property] = source[property];
      }
      return next;
    },
    (next) => {
      for (const property in previous) {
        if (!(property in next)) {
          universal.setProp(node, property, undefined, previous[property]);
          delete previous[property];
        }
      }
      for (const property in next) {
        const value = next[property];
        if (value === previous[property]) continue;
        universal.setProp(node, property, value, previous[property]);
        previous[property] = value;
      }
    },
  );
}

export const {
  applyRef,
  createComponent,
  createElement,
  createTextNode,
  insertNode,
  memo,
  mergeProps,
  ref,
  setProp,
} = universal;

const RootProvider = NativeRootContext as Component<{
  readonly value: NativeRoot;
  readonly children: unknown;
}>;

function renderIntoRoot(code: () => unknown, root: NativeRoot): () => void {
  return universal.render(
    () =>
      solidCreateComponent(RootProvider, {
        value: root,
        get children() {
          return code();
        },
      }) as NativeNode,
    root.container,
  );
}

function createNativeApplication(
  root: NativeRoot,
  disposeSolid: () => void,
): NativeApplication {
  let disposal: Promise<void> | undefined;
  return {
    root,
    dispose() {
      disposal ??= (async () => {
        let solidCleanupFailed = false;
        let solidCleanupError: unknown;
        try {
          disposeSolid();
        } catch (error) {
          solidCleanupFailed = true;
          solidCleanupError = error;
        }
        try {
          await root.dispose();
        } catch (nativeCleanupError) {
          if (solidCleanupFailed) {
            // A rejected native operation can be observed once while Solid
            // disposes its owner and again while NativeRoot drains the same
            // failed commit. Preserve that operation's established identity
            // instead of presenting one failure as two independent causes.
            if (solidCleanupError === nativeCleanupError) {
              throw nativeCleanupError;
            }
            throw new AggregateError(
              [solidCleanupError, nativeCleanupError],
              "Solid owner cleanup and native surface teardown both failed.",
            );
          }
          throw nativeCleanupError;
        }
        if (solidCleanupFailed) throw solidCleanupError;
      })();
      return disposal;
    },
  };
}

export function render(code: () => unknown, container: NativeNode): () => void {
  const root = nativeNodeRoot(container);
  const disposeSolid = renderIntoRoot(code, root);
  return () => {
    disposeSolid();
    void root.dispose();
  };
}

/** @internal Component facades use this to sequence platform-owned teardown. */
export async function flushNativeNodeMount(node: NativeNode): Promise<void> {
  // A component may request this barrier from an effect apply phase. Let the
  // active Solid drain finish before NativeRoot flushes reactive work again.
  await Promise.resolve();
  await nativeNodeRoot(node).flushMounted();
}

/** @internal Component facades use this for platform lifecycle normalization. */
export function nativeNodePlatform(node: NativeNode): string {
  return nativeNodeRoot(node).host.platform;
}

/** @internal Component facades use this to release private detached trees. */
export function releaseDetachedNativeNode(node: NativeNode): void {
  nativeNodeRoot(node).releaseDetachedNode(node);
}

export function mount(
  code: () => unknown,
  host: import("@solid-native/host-contract").NativeHost,
  options: NativeRootOptions,
): NativeApplication {
  const root = createNativeRoot(host, options);
  try {
    const disposeSolid = renderIntoRoot(code, root);
    return createNativeApplication(root, disposeSolid);
  } catch (mountError) {
    // Preserve the synchronous API and original render failure, but do not
    // strand a surface that was already acquired. Callers that need to await
    // rollback should use mountAsync.
    void root.dispose().catch(() => undefined);
    throw mountError;
  }
}

/**
 * Mounts a root while retaining an asynchronous cleanup boundary for initial
 * render failures. Native application bootstraps should prefer this form so a
 * claimed platform surface cannot outlive a failed Solid owner graph.
 */
export async function mountAsync(
  code: () => unknown,
  host: import("@solid-native/host-contract").NativeHost,
  options: NativeRootOptions,
): Promise<NativeApplication> {
  const root = await createNativeRootAsync(host, options);
  let disposeSolid: () => void;
  try {
    disposeSolid = renderIntoRoot(code, root);
  } catch (mountError) {
    try {
      await root.dispose();
    } catch (nativeCleanupError) {
      if (mountError === nativeCleanupError) throw mountError;
      throw new AggregateError(
        [mountError, nativeCleanupError],
        "Solid application mount and native surface cleanup both failed.",
      );
    }
    throw mountError;
  }
  return createNativeApplication(root, disposeSolid);
}
