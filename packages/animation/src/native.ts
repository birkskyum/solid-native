import { flushNativeNodeMount, type NativeNode } from "@solid-native/renderer";
import { getOwner, onCleanup, runWithOwner, type Accessor } from "solid-js";

import {
  parseUIWorkletGraph,
  type UIWorkletDecay,
  type UIWorkletGraph,
  type UIWorkletNamedTimingKeyframe,
  type UIWorkletPanGesture,
  type UIWorkletSession,
  type UIWorkletSpring,
  type UIWorkletTiming,
} from "./index.js";
import {
  createNativeViewUIWorkletHost,
  type NativeViewUIWorkletHost,
  type NativeViewUIWorkletSnapshot,
} from "./react-native.js";
import {
  createOwnedUIWorkletSession,
  createSolidUIWorklet,
  type SolidUIWorkletOptions,
} from "./solid.js";

export type NativeViewAnimationState =
  "unbound" | "mounting" | "ready" | "failed" | "disposed";

export interface NativeViewAnimationOptions extends SolidUIWorkletOptions {
  /** Coarse Solid state synchronized after the target has mounted. */
  readonly inputs?: Accessor<Readonly<Record<string, number>>>;
}

/**
 * Solid-owned animation bound through `ref` to one committed native element.
 * Imperative operations are synchronous once `ready` resolves to `true`.
 */
export interface NativeViewAnimation {
  readonly graph: UIWorkletGraph;
  readonly state: NativeViewAnimationState;
  readonly error: unknown | undefined;
  readonly handle: number | undefined;
  readonly disposed: boolean;
  readonly nativeInputsOwned: boolean;
  readonly inputs: Readonly<Record<string, number>>;
  /** Resolves false when its Solid owner ends before installation completes. */
  readonly ready: Promise<boolean>;
  readonly ref: (node: NativeNode) => void;
  update(inputs: Readonly<Record<string, number>>, timestamp?: number): void;
  animate(
    inputs: Readonly<Record<string, number>>,
    timing: UIWorkletTiming,
    timestamp?: number,
  ): void;
  animateKeyframes(
    keyframes: readonly UIWorkletNamedTimingKeyframe[],
    timestamp?: number,
  ): void;
  spring(
    inputs: Readonly<Record<string, number>>,
    spring: UIWorkletSpring,
    timestamp?: number,
  ): void;
  decay(
    velocities: Readonly<Record<string, number>>,
    decay: UIWorkletDecay,
    timestamp?: number,
  ): void;
  cancel(timestamp?: number): void;
  attachPanGesture(gesture: UIWorkletPanGesture): void;
  detachPanGesture(timestamp?: number): void;
  inspect(): NativeViewUIWorkletSnapshot;
  dispose(): void;
}

function reportSetupError(
  error: unknown,
  options: NativeViewAnimationOptions,
): void {
  if (options.onError === undefined) throw error;
  try {
    const reported = options.onError(error);
    void Promise.resolve(reported).catch(() => undefined);
  } catch {
    // A diagnostic hook cannot revive or break another Solid owner.
  }
}

/**
 * Creates the application-facing native animation boundary. Its ref waits for
 * the renderer's platform mount acknowledgement before installing the graph,
 * and the current Solid owner disposes native execution automatically.
 */
export function createNativeViewAnimation(
  graphValue: UIWorkletGraph,
  options: NativeViewAnimationOptions = {},
): NativeViewAnimation {
  const owner = getOwner();
  if (owner === null) {
    throw new Error(
      "createNativeViewAnimation requires an active Solid owner.",
    );
  }
  if (options.inputs !== undefined && typeof options.inputs !== "function") {
    throw new TypeError("Native view animation inputs must be an accessor.");
  }
  const graph = parseUIWorkletGraph(graphValue);
  const initialInputs = Object.freeze(
    Object.fromEntries(
      graph.inputs.map((input) => [input.name, input.initialValue]),
    ),
  );
  let state: NativeViewAnimationState = "unbound";
  let error: unknown;
  let node: NativeNode | undefined;
  let host: NativeViewUIWorkletHost | undefined;
  let session: UIWorkletSession | undefined;
  let readySettled = false;
  let resolveReady!: (installed: boolean) => void;
  let rejectReady!: (error: unknown) => void;
  const ready = new Promise<boolean>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // Setup errors are also published through `error` and `onError`; callers can
  // independently await this same promise without causing duplicate handling.
  void ready.catch(() => undefined);

  const settleReady = (installed: boolean): void => {
    if (readySettled) return;
    readySettled = true;
    resolveReady(installed);
  };
  const settleFailure = (failure: unknown): void => {
    if (state === "disposed") {
      settleReady(false);
      return;
    }
    state = "failed";
    error = failure;
    if (!readySettled) {
      readySettled = true;
      rejectReady(failure);
    }
    // `ready` is the observable asynchronous error channel. Report through an
    // explicit diagnostic hook as well, but do not create a second unhandled
    // rejection merely because the caller has not awaited `ready` yet.
    if (options.onError !== undefined) reportSetupError(failure, options);
  };
  const requireSession = (): UIWorkletSession => {
    if (session?.disposed === true) {
      throw new Error("The native view animation is disposed.");
    }
    if (state !== "ready" || session === undefined) {
      if (state === "failed") {
        throw new Error("The native view animation failed to install.", {
          cause: error,
        });
      }
      if (state === "disposed") {
        throw new Error("The native view animation is disposed.");
      }
      throw new Error(
        "The native view animation is not ready; await animation.ready before issuing imperative work.",
      );
    }
    return session;
  };
  const install = async (target: NativeNode): Promise<void> => {
    await flushNativeNodeMount(target);
    if (state === "disposed") {
      settleReady(false);
      return;
    }
    const nextHost = createNativeViewUIWorkletHost(target);
    const nextSession = runWithOwner(owner, () =>
      options.inputs === undefined
        ? createOwnedUIWorkletSession(nextHost, graph, options)
        : createSolidUIWorklet(nextHost, graph, options.inputs, options),
    );
    host = nextHost;
    session = nextSession;
    state = "ready";
    settleReady(true);
  };
  const dispose = (): void => {
    if (state === "disposed") return;
    state = "disposed";
    settleReady(false);
    session?.dispose();
  };

  const animation: NativeViewAnimation = {
    graph,
    get state() {
      return session?.disposed === true ? "disposed" : state;
    },
    get error() {
      return error;
    },
    get handle() {
      return session?.handle;
    },
    get disposed() {
      return state === "disposed" || session?.disposed === true;
    },
    get nativeInputsOwned() {
      return session?.nativeInputsOwned ?? false;
    },
    get inputs() {
      return session?.inputs ?? initialInputs;
    },
    ready,
    ref(target) {
      if (state === "disposed") {
        throw new Error("The native view animation is disposed.");
      }
      if (state === "failed") {
        throw new Error("The native view animation failed to install.", {
          cause: error,
        });
      }
      if (node !== undefined) {
        if (node === target) return;
        throw new Error(
          "A native view animation cannot be rebound to another element.",
        );
      }
      node = target;
      state = "mounting";
      void install(target).catch(settleFailure);
    },
    update(inputs, timestamp) {
      requireSession().update(inputs, timestamp);
    },
    animate(inputs, timing, timestamp) {
      requireSession().animate(inputs, timing, timestamp);
    },
    animateKeyframes(keyframes, timestamp) {
      requireSession().animateKeyframes(keyframes, timestamp);
    },
    spring(inputs, spring, timestamp) {
      requireSession().spring(inputs, spring, timestamp);
    },
    decay(velocities, decay, timestamp) {
      requireSession().decay(velocities, decay, timestamp);
    },
    cancel(timestamp) {
      requireSession().cancel(timestamp);
    },
    attachPanGesture(gesture) {
      requireSession().attachPanGesture(gesture);
    },
    detachPanGesture(timestamp) {
      requireSession().detachPanGesture(timestamp);
    },
    inspect() {
      const currentSession = requireSession();
      return host!.inspectGraph(currentSession.handle);
    },
    dispose,
  };
  Object.freeze(animation);

  onCleanup(() => {
    try {
      dispose();
    } catch (failure) {
      reportSetupError(failure, options);
    }
  });
  return animation;
}
