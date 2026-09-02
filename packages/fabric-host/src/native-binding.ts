import {
  HOST_CAUSAL_OPERATION_ID_MAX_LENGTH,
  HOST_CONTRACT_VERSION,
  type CommitSequence,
  type HostCommit,
  type HostCommitResult,
  type HostLifecycleEvent,
  type HostLifecycleListener,
  type NativeMeasurement,
  type NativeEventListener,
  type NodeHandle,
} from "@solid-native/host-contract";

import {
  createNativeHostTransaction,
  type NativeHostTransaction,
} from "./native-transaction.js";
import { REACT_NATIVE_0_87_BACKEND } from "./react-native-0.87.js";

export const NATIVE_HOST_GLOBAL = "__solidNativeHost" as const;
export const NATIVE_FATAL_ERROR_NAME_MAX_LENGTH = 128;
export const NATIVE_FATAL_ERROR_MESSAGE_MAX_LENGTH = 2_048;

export interface NativeSurfaceInfo {
  readonly ready: boolean;
  readonly surface: number;
  readonly sequence: number;
  /**
   * Runtime-owned JSI identities retained for Fabric event targets. This can
   * remain non-zero briefly after their logical nodes are deleted, until the
   * retiring Fabric revision has mounted.
   */
  readonly retainedNodeCount: number;
  /** Opaque JSI values explicitly retained for native component props. */
  readonly retainedResourceCount: number;
  /** Present on backends that account for native UI worklet ownership. */
  readonly activeUIWorkletCount?: number;
  /** Native UI worklets with a display callback currently scheduled. */
  readonly pendingUIWorkletFrameCount?: number;
}

export interface NativeUIWorkletInfo {
  readonly handle: number;
  readonly target: NodeHandle;
  readonly sequence: number;
  readonly appliedSequence: number;
  readonly applied: boolean;
  readonly frameTimeNanoseconds: number;
  readonly timestamp?: number;
  readonly timingActive: boolean;
  readonly timingProgress: number;
  readonly timingFrameStatistics?: NativeUIWorkletFrameStatistics;
  readonly springActive?: boolean;
  readonly springPosition?: number;
  readonly springVelocity?: number;
  readonly springFrameStatistics?: NativeUIWorkletFrameStatistics;
  readonly decayActive?: boolean;
  readonly decayElapsedMilliseconds?: number;
  readonly decaySpeed?: number;
  readonly decayFrameStatistics?: NativeUIWorkletFrameStatistics;
  readonly gestureAttached?: boolean;
  readonly gestureActive?: boolean;
  readonly gestureSequence?: number;
  readonly gestureTimestamp?: number;
  readonly outputs: Readonly<Record<string, number>>;
}

export interface NativeUIWorkletFrameStatistics {
  readonly frameCount: number;
  readonly intervalCount: number;
  readonly sampledIntervalCount: number;
  readonly droppedIntervalSampleCount: number;
  readonly firstFrameTimeMilliseconds: number;
  readonly lastFrameTimeMilliseconds: number;
  readonly minimumFrameIntervalMilliseconds: number;
  readonly maximumFrameIntervalMilliseconds: number;
  readonly meanFrameIntervalMilliseconds: number;
  readonly p50FrameIntervalMilliseconds: number;
  readonly p95FrameIntervalMilliseconds: number;
  readonly p99FrameIntervalMilliseconds: number;
}

export type NativeUIWorkletTimingEasing =
  "linear" | "ease-in" | "ease-out" | "ease-in-out";

export interface NativeUIWorkletTiming {
  readonly durationMilliseconds: number;
  readonly easing: NativeUIWorkletTimingEasing;
}

export interface NativeUIWorkletTimingKeyframe {
  readonly inputs: readonly number[];
  readonly timing: NativeUIWorkletTiming;
}

export interface NativeUIWorkletSpring {
  readonly mass: number;
  readonly stiffness: number;
  readonly damping: number;
  readonly initialVelocity: number;
  readonly restSpeedThreshold: number;
  readonly restDisplacementThreshold: number;
  readonly maximumDurationMilliseconds: number;
}

export interface NativeUIWorkletDecay {
  readonly deceleration: number;
  readonly velocityThreshold: number;
  readonly maximumDurationMilliseconds: number;
}

export interface NativeUIWorkletPanGesture {
  readonly xInput: string;
  readonly yInput: string;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly releaseDecay?: NativeUIWorkletDecay;
}

export const NATIVE_RESOURCE_REFERENCE_KEY = "__solidNativeResource" as const;
export const NATIVE_RESOURCE_KIND_MAX_LENGTH = 128;

export type NativeResourceReference<Kind extends string = string> = Readonly<{
  readonly [NATIVE_RESOURCE_REFERENCE_KEY]: Readonly<{
    readonly handle: number;
    readonly kind: Kind;
  }>;
}>;

export interface RetainedNativeResource<Kind extends string = string> {
  readonly reference: NativeResourceReference<Kind>;
  readonly released: boolean;
  release(): void;
}

/** The synchronous object installed by the selected React Native Fabric boundary. */
export interface NativeFabricBinding {
  readonly contractVersion: typeof HOST_CONTRACT_VERSION;
  readonly backend: "react-native-fabric";
  readonly backendVersion: typeof REACT_NATIVE_0_87_BACKEND.backendVersion;
  readonly platform: "android" | "ios";

  getSurfaceInfo(): NativeSurfaceInfo;
  /**
   * Hands a terminal JavaScript or commit failure to the package-owned native
   * shell. The native side stops the Fabric surface before presenting its
   * dependency-free fallback. Only a bounded name and message cross.
   */
  reportFatalError?(name: string, message: string): void;
  setEventHandler(listener: NativeEventListener | null): void;
  setCommitLifecycleHandler?(listener: HostLifecycleListener | null): void;
  retainNativeResource(kind: string, value: object): number;
  releaseNativeResource(handle: number): void;
  installUIWorklet?(target: NodeHandle, graph: object): number;
  updateUIWorkletInputs?(
    handle: number,
    inputs: readonly number[],
    timestamp: number,
  ): void;
  animateUIWorkletInputs?(
    handle: number,
    inputs: readonly number[],
    timestamp: number,
    timing: NativeUIWorkletTiming,
  ): void;
  animateUIWorkletKeyframes?(
    handle: number,
    keyframes: readonly NativeUIWorkletTimingKeyframe[],
    timestamp: number,
  ): void;
  springUIWorkletInputs?(
    handle: number,
    inputs: readonly number[],
    timestamp: number,
    spring: NativeUIWorkletSpring,
  ): void;
  decayUIWorkletInputs?(
    handle: number,
    velocities: readonly number[],
    timestamp: number,
    decay: NativeUIWorkletDecay,
  ): void;
  cancelUIWorkletAnimation?(
    handle: number,
    timestamp: number,
  ): readonly number[];
  attachUIWorkletPanGesture?(
    handle: number,
    gesture: NativeUIWorkletPanGesture,
  ): void;
  detachUIWorkletPanGesture?(
    handle: number,
    timestamp: number,
  ): readonly number[];
  destroyUIWorklet?(handle: number): void;
  getUIWorkletInfo?(handle: number): NativeUIWorkletInfo;
  measure(node: NodeHandle, afterSequence?: CommitSequence): NativeMeasurement;
  destroySurface(): void;
  commit(transaction: NativeHostTransaction): HostCommitResult;
}

const activeEventHandlerTokens = new WeakMap<NativeFabricBinding, symbol>();
const activeLifecycleHandlerTokens = new WeakMap<NativeFabricBinding, symbol>();

export class IncompatibleNativeHostBindingError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Incompatible native host binding: ${issues.join(" ")}`);
    this.name = "IncompatibleNativeHostBindingError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function assertNativeHostBinding(value: unknown): NativeFabricBinding {
  if (!isRecord(value)) {
    throw new IncompatibleNativeHostBindingError([
      `${NATIVE_HOST_GLOBAL} is not installed.`,
    ]);
  }

  const issues: string[] = [];
  if (value.contractVersion !== HOST_CONTRACT_VERSION) {
    issues.push(
      `Expected host contract ${HOST_CONTRACT_VERSION}, received ${String(value.contractVersion)}.`,
    );
  }
  if (value.backend !== "react-native-fabric") {
    issues.push(
      `Expected react-native-fabric, received ${String(value.backend)}.`,
    );
  }
  if (value.backendVersion !== REACT_NATIVE_0_87_BACKEND.backendVersion) {
    issues.push(
      `Expected React Native ${REACT_NATIVE_0_87_BACKEND.backendVersion}, received ${String(value.backendVersion)}.`,
    );
  }
  if (value.platform !== "android" && value.platform !== "ios") {
    issues.push(
      `Expected platform android or ios, received ${String(value.platform)}.`,
    );
  }
  if (typeof value.getSurfaceInfo !== "function") {
    issues.push("getSurfaceInfo is unavailable.");
  }
  if (
    value.reportFatalError !== undefined &&
    typeof value.reportFatalError !== "function"
  ) {
    issues.push("reportFatalError must be a function when present.");
  }
  if (typeof value.setEventHandler !== "function") {
    issues.push("setEventHandler is unavailable.");
  }
  if (
    value.setCommitLifecycleHandler !== undefined &&
    typeof value.setCommitLifecycleHandler !== "function"
  ) {
    issues.push("setCommitLifecycleHandler must be a function when present.");
  }
  if (typeof value.measure !== "function") {
    issues.push("measure is unavailable.");
  }
  if (typeof value.retainNativeResource !== "function") {
    issues.push("retainNativeResource is unavailable.");
  }
  if (typeof value.releaseNativeResource !== "function") {
    issues.push("releaseNativeResource is unavailable.");
  }
  const uiWorkletMethods = [
    value.installUIWorklet,
    value.updateUIWorkletInputs,
    value.destroyUIWorklet,
    value.getUIWorkletInfo,
  ];
  const uiWorkletMethodCount = uiWorkletMethods.filter(
    (method) => typeof method === "function",
  ).length;
  if (uiWorkletMethodCount !== 0 && uiWorkletMethodCount !== 4) {
    issues.push(
      "Native UI worklets require install, update, destroy, and inspection methods together.",
    );
  }
  if (
    value.animateUIWorkletInputs !== undefined &&
    typeof value.animateUIWorkletInputs !== "function"
  ) {
    issues.push("animateUIWorkletInputs must be a function when present.");
  } else if (
    typeof value.animateUIWorkletInputs === "function" &&
    uiWorkletMethodCount !== 4
  ) {
    issues.push(
      "Native UI worklet timings require the complete UI worklet protocol.",
    );
  }
  if (
    value.animateUIWorkletKeyframes !== undefined &&
    typeof value.animateUIWorkletKeyframes !== "function"
  ) {
    issues.push("animateUIWorkletKeyframes must be a function when present.");
  } else if (
    typeof value.animateUIWorkletKeyframes === "function" &&
    uiWorkletMethodCount !== 4
  ) {
    issues.push(
      "Native UI worklet keyframes require the complete UI worklet protocol.",
    );
  }
  if (
    value.springUIWorkletInputs !== undefined &&
    typeof value.springUIWorkletInputs !== "function"
  ) {
    issues.push("springUIWorkletInputs must be a function when present.");
  } else if (
    typeof value.springUIWorkletInputs === "function" &&
    uiWorkletMethodCount !== 4
  ) {
    issues.push(
      "Native UI worklet springs require the complete UI worklet protocol.",
    );
  }
  if (
    value.decayUIWorkletInputs !== undefined &&
    typeof value.decayUIWorkletInputs !== "function"
  ) {
    issues.push("decayUIWorkletInputs must be a function when present.");
  } else if (
    typeof value.decayUIWorkletInputs === "function" &&
    uiWorkletMethodCount !== 4
  ) {
    issues.push(
      "Native UI worklet decays require the complete UI worklet protocol.",
    );
  }
  if (
    value.cancelUIWorkletAnimation !== undefined &&
    typeof value.cancelUIWorkletAnimation !== "function"
  ) {
    issues.push("cancelUIWorkletAnimation must be a function when present.");
  } else if (
    typeof value.cancelUIWorkletAnimation === "function" &&
    uiWorkletMethodCount !== 4
  ) {
    issues.push(
      "Native UI worklet cancellation requires the complete UI worklet protocol.",
    );
  }
  if (
    value.attachUIWorkletPanGesture !== undefined &&
    typeof value.attachUIWorkletPanGesture !== "function"
  ) {
    issues.push("attachUIWorkletPanGesture must be a function when present.");
  } else if (
    typeof value.attachUIWorkletPanGesture === "function" &&
    uiWorkletMethodCount !== 4
  ) {
    issues.push(
      "Native UI worklet pan gestures require the complete UI worklet protocol.",
    );
  }
  if (
    value.detachUIWorkletPanGesture !== undefined &&
    typeof value.detachUIWorkletPanGesture !== "function"
  ) {
    issues.push("detachUIWorkletPanGesture must be a function when present.");
  } else if (
    typeof value.detachUIWorkletPanGesture === "function" &&
    typeof value.attachUIWorkletPanGesture !== "function"
  ) {
    issues.push(
      "Native UI worklet pan detachment requires the pan attachment extension.",
    );
  }
  if (typeof value.destroySurface !== "function") {
    issues.push("destroySurface is unavailable.");
  }
  if (typeof value.commit !== "function") {
    issues.push("commit is unavailable.");
  }
  if (issues.length > 0) throw new IncompatibleNativeHostBindingError(issues);
  return value as unknown as NativeFabricBinding;
}

export function subscribeToNativeHostEvents(
  binding: NativeFabricBinding,
  listener: NativeEventListener,
): () => void {
  const token = Symbol("native-event-handler");
  binding.setEventHandler(listener);
  activeEventHandlerTokens.set(binding, token);
  let subscribed = true;
  return () => {
    if (!subscribed) return;
    if (activeEventHandlerTokens.get(binding) !== token) {
      subscribed = false;
      return;
    }
    binding.setEventHandler(null);
    activeEventHandlerTokens.delete(binding);
    subscribed = false;
  };
}

function parseNativeHostLifecycleEvent(value: unknown): HostLifecycleEvent {
  if (!isRecord(value)) {
    throw new IncompatibleNativeHostBindingError([
      "The commit lifecycle event is not an object.",
    ]);
  }
  const issues: string[] = [];
  if (value.type !== "commit-mounted" && value.type !== "commit-frame") {
    issues.push("The commit lifecycle event type is invalid.");
  }
  for (const [name, candidate] of [
    ["surface", value.surface],
    ["sequence", value.sequence],
    ["hostRevision", value.hostRevision],
  ] as const) {
    if (!Number.isSafeInteger(candidate) || (candidate as number) <= 0) {
      issues.push(`${name} must be a positive safe integer.`);
    }
  }
  const timingValues =
    value.type === "commit-frame"
      ? ([
          ["mountedAt", value.mountedAt],
          ["frameStartedAt", value.frameStartedAt],
          ["frameLatency", value.frameLatency],
          ["mountToFrameLatency", value.mountToFrameLatency],
        ] as const)
      : ([
          ["commitStartedAt", value.commitStartedAt],
          ["mountedAt", value.mountedAt],
          ["mountLatency", value.mountLatency],
        ] as const);
  for (const [name, candidate] of timingValues) {
    if (
      typeof candidate !== "number" ||
      !Number.isFinite(candidate) ||
      candidate < 0
    ) {
      issues.push(`${name} must be a finite non-negative number.`);
    }
  }

  let causalContext: { readonly operationId: string } | undefined;
  if (value.causalContext !== undefined) {
    if (!isRecord(value.causalContext)) {
      issues.push("The lifecycle causal context must be an object.");
    } else {
      const operationId = value.causalContext.operationId;
      if (
        typeof operationId !== "string" ||
        operationId.length === 0 ||
        operationId.length > HOST_CAUSAL_OPERATION_ID_MAX_LENGTH ||
        operationId.includes("\0")
      ) {
        issues.push("The lifecycle causal operation ID is invalid.");
      } else {
        causalContext = { operationId };
      }
    }
  }
  if (issues.length > 0) throw new IncompatibleNativeHostBindingError(issues);

  if (value.type === "commit-frame") {
    return {
      type: "commit-frame",
      surface: value.surface as number,
      sequence: value.sequence as number,
      hostRevision: value.hostRevision as number,
      mountedAt: value.mountedAt as number,
      frameStartedAt: value.frameStartedAt as number,
      frameLatency: value.frameLatency as number,
      mountToFrameLatency: value.mountToFrameLatency as number,
      ...(causalContext === undefined ? {} : { causalContext }),
    };
  }
  return {
    type: "commit-mounted",
    surface: value.surface as number,
    sequence: value.sequence as number,
    hostRevision: value.hostRevision as number,
    commitStartedAt: value.commitStartedAt as number,
    mountedAt: value.mountedAt as number,
    mountLatency: value.mountLatency as number,
    ...(causalContext === undefined ? {} : { causalContext }),
  };
}

export function subscribeToNativeHostCommitLifecycle(
  binding: NativeFabricBinding,
  listener: HostLifecycleListener,
): () => void {
  const setHandler = binding.setCommitLifecycleHandler;
  if (setHandler === undefined) {
    throw new IncompatibleNativeHostBindingError([
      "setCommitLifecycleHandler is unavailable.",
    ]);
  }
  const token = Symbol("native-commit-lifecycle-handler");
  const handler: HostLifecycleListener = (event) => {
    listener(parseNativeHostLifecycleEvent(event));
  };
  setHandler.call(binding, handler);
  activeLifecycleHandlerTokens.set(binding, token);
  let subscribed = true;
  return () => {
    if (!subscribed) return;
    if (activeLifecycleHandlerTokens.get(binding) !== token) {
      subscribed = false;
      return;
    }
    setHandler.call(binding, null);
    activeLifecycleHandlerTokens.delete(binding);
    subscribed = false;
  };
}

export function getNativeHostBinding(
  globalObject: object = globalThis,
): NativeFabricBinding {
  const value = (globalObject as Record<string, unknown>)[NATIVE_HOST_GLOBAL];
  return assertNativeHostBinding(value);
}

function safeErrorProperty(value: object, key: "message" | "name"): unknown {
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

function boundedFatalErrorText(value: string, maximumLength: number): string {
  const truncated = value.length > maximumLength;
  const contentLength = truncated ? maximumLength - 1 : maximumLength;
  let normalized = "";
  for (const character of value) {
    if (normalized.length + character.length > contentLength) break;
    normalized +=
      character === "\n" ||
      character === "\t" ||
      (character >= " " && character !== "\u007f")
        ? character
        : " ";
  }
  return truncated ? `${normalized}\u2026` : normalized;
}

function nativeFatalErrorDetails(error: unknown): {
  readonly name: string;
  readonly message: string;
} {
  const record =
    (typeof error === "object" && error !== null) || typeof error === "function"
      ? error
      : undefined;
  const rawName =
    record === undefined ? undefined : safeErrorProperty(record, "name");
  const rawMessage =
    record === undefined ? undefined : safeErrorProperty(record, "message");
  const name =
    typeof rawName === "string" && rawName.length > 0 ? rawName : "Error";
  const message =
    typeof rawMessage === "string" && rawMessage.length > 0
      ? rawMessage
      : typeof error === "string" && error.length > 0
        ? error
        : "A terminal JavaScript failure occurred.";
  return {
    name: boundedFatalErrorText(name, NATIVE_FATAL_ERROR_NAME_MAX_LENGTH),
    message: boundedFatalErrorText(
      message,
      NATIVE_FATAL_ERROR_MESSAGE_MAX_LENGTH,
    ),
  };
}

export function supportsNativeFatalErrorReporting(
  binding: NativeFabricBinding,
): binding is NativeFabricBinding &
  Required<Pick<NativeFabricBinding, "reportFatalError">> {
  return typeof binding.reportFatalError === "function";
}

/**
 * Replaces a terminal Fabric surface with the package-owned native fallback.
 * Stack traces and arbitrary thrown values never cross this boundary.
 */
export function reportNativeFatalError(
  binding: NativeFabricBinding,
  error: unknown,
): void {
  if (!supportsNativeFatalErrorReporting(binding)) {
    throw new IncompatibleNativeHostBindingError([
      "reportFatalError is unavailable.",
    ]);
  }
  const details = nativeFatalErrorDetails(error);
  binding.reportFatalError(details.name, details.message);
}

export function readNativeSurfaceInfo(
  binding: NativeFabricBinding,
): NativeSurfaceInfo {
  const value: unknown = binding.getSurfaceInfo();
  const issues: string[] = [];
  if (!isRecord(value)) {
    throw new IncompatibleNativeHostBindingError([
      "getSurfaceInfo returned a non-object value.",
    ]);
  }
  if (typeof value.ready !== "boolean") {
    issues.push("Surface readiness must be a boolean.");
  }
  if (!isNonNegativeSafeInteger(value.surface)) {
    issues.push("Surface ID must be a non-negative safe integer.");
  }
  if (!isNonNegativeSafeInteger(value.sequence)) {
    issues.push("Commit sequence must be a non-negative safe integer.");
  }
  if (!isNonNegativeSafeInteger(value.retainedNodeCount)) {
    issues.push("Retained node count must be a non-negative safe integer.");
  }
  if (!isNonNegativeSafeInteger(value.retainedResourceCount)) {
    issues.push("Retained resource count must be a non-negative safe integer.");
  }
  if (
    value.activeUIWorkletCount !== undefined &&
    !isNonNegativeSafeInteger(value.activeUIWorkletCount)
  ) {
    issues.push("Active UI worklet count must be a non-negative safe integer.");
  }
  if (
    value.pendingUIWorkletFrameCount !== undefined &&
    !isNonNegativeSafeInteger(value.pendingUIWorkletFrameCount)
  ) {
    issues.push(
      "Pending UI worklet frame count must be a non-negative safe integer.",
    );
  }
  if (
    isNonNegativeSafeInteger(value.activeUIWorkletCount) &&
    isNonNegativeSafeInteger(value.pendingUIWorkletFrameCount) &&
    value.pendingUIWorkletFrameCount > value.activeUIWorkletCount
  ) {
    issues.push(
      "Pending UI worklet frame count cannot exceed the active UI worklet count.",
    );
  }
  if (value.ready === true && value.surface === 0) {
    issues.push("A ready surface must have a positive ID.");
  }
  if (issues.length > 0) throw new IncompatibleNativeHostBindingError(issues);

  const result: NativeSurfaceInfo = {
    ready: value.ready as boolean,
    surface: value.surface as number,
    sequence: value.sequence as number,
    retainedNodeCount: value.retainedNodeCount as number,
    retainedResourceCount: value.retainedResourceCount as number,
  };
  return {
    ...result,
    ...(value.activeUIWorkletCount === undefined
      ? {}
      : { activeUIWorkletCount: value.activeUIWorkletCount as number }),
    ...(value.pendingUIWorkletFrameCount === undefined
      ? {}
      : {
          pendingUIWorkletFrameCount:
            value.pendingUIWorkletFrameCount as number,
        }),
  };
}

export function supportsNativeUIWorklets(
  binding: NativeFabricBinding,
): binding is NativeFabricBinding &
  Required<
    Pick<
      NativeFabricBinding,
      | "installUIWorklet"
      | "updateUIWorkletInputs"
      | "destroyUIWorklet"
      | "getUIWorkletInfo"
    >
  > {
  return (
    typeof binding.installUIWorklet === "function" &&
    typeof binding.updateUIWorkletInputs === "function" &&
    typeof binding.destroyUIWorklet === "function" &&
    typeof binding.getUIWorkletInfo === "function"
  );
}

export function supportsNativeUIWorkletTimings(
  binding: NativeFabricBinding,
): binding is NativeFabricBinding &
  Required<
    Pick<
      NativeFabricBinding,
      | "installUIWorklet"
      | "updateUIWorkletInputs"
      | "animateUIWorkletInputs"
      | "destroyUIWorklet"
      | "getUIWorkletInfo"
    >
  > {
  return (
    supportsNativeUIWorklets(binding) &&
    typeof binding.animateUIWorkletInputs === "function"
  );
}

export function supportsNativeUIWorkletKeyframes(
  binding: NativeFabricBinding,
): binding is NativeFabricBinding &
  Required<
    Pick<
      NativeFabricBinding,
      | "installUIWorklet"
      | "updateUIWorkletInputs"
      | "animateUIWorkletKeyframes"
      | "destroyUIWorklet"
      | "getUIWorkletInfo"
    >
  > {
  return (
    supportsNativeUIWorklets(binding) &&
    typeof binding.animateUIWorkletKeyframes === "function"
  );
}

export function supportsNativeUIWorkletSprings(
  binding: NativeFabricBinding,
): binding is NativeFabricBinding &
  Required<
    Pick<
      NativeFabricBinding,
      | "installUIWorklet"
      | "updateUIWorkletInputs"
      | "springUIWorkletInputs"
      | "destroyUIWorklet"
      | "getUIWorkletInfo"
    >
  > {
  return (
    supportsNativeUIWorklets(binding) &&
    typeof binding.springUIWorkletInputs === "function"
  );
}

export function supportsNativeUIWorkletDecays(
  binding: NativeFabricBinding,
): binding is NativeFabricBinding &
  Required<
    Pick<
      NativeFabricBinding,
      | "installUIWorklet"
      | "updateUIWorkletInputs"
      | "decayUIWorkletInputs"
      | "destroyUIWorklet"
      | "getUIWorkletInfo"
    >
  > {
  return (
    supportsNativeUIWorklets(binding) &&
    typeof binding.decayUIWorkletInputs === "function"
  );
}

export function supportsNativeUIWorkletAnimationCancellation(
  binding: NativeFabricBinding,
): binding is NativeFabricBinding &
  Required<
    Pick<
      NativeFabricBinding,
      | "installUIWorklet"
      | "updateUIWorkletInputs"
      | "cancelUIWorkletAnimation"
      | "destroyUIWorklet"
      | "getUIWorkletInfo"
    >
  > {
  return (
    supportsNativeUIWorklets(binding) &&
    typeof binding.cancelUIWorkletAnimation === "function"
  );
}

export function supportsNativeUIWorkletPanGestures(
  binding: NativeFabricBinding,
): binding is NativeFabricBinding &
  Required<
    Pick<
      NativeFabricBinding,
      | "installUIWorklet"
      | "updateUIWorkletInputs"
      | "attachUIWorkletPanGesture"
      | "destroyUIWorklet"
      | "getUIWorkletInfo"
    >
  > {
  return (
    supportsNativeUIWorklets(binding) &&
    typeof binding.attachUIWorkletPanGesture === "function"
  );
}

export function supportsNativeUIWorkletPanGestureDetachment(
  binding: NativeFabricBinding,
): binding is NativeFabricBinding &
  Required<
    Pick<
      NativeFabricBinding,
      | "installUIWorklet"
      | "updateUIWorkletInputs"
      | "attachUIWorkletPanGesture"
      | "detachUIWorkletPanGesture"
      | "destroyUIWorklet"
      | "getUIWorkletInfo"
    >
  > {
  return (
    supportsNativeUIWorkletPanGestures(binding) &&
    typeof binding.detachUIWorkletPanGesture === "function"
  );
}

function validateNativeResourceKind(kind: string): void {
  if (
    kind.length === 0 ||
    kind.length > NATIVE_RESOURCE_KIND_MAX_LENGTH ||
    kind.includes("\0") ||
    !/^[a-z][a-z0-9.-]*$/.test(kind)
  ) {
    throw new RangeError(
      `The native resource kind must contain 1-${NATIVE_RESOURCE_KIND_MAX_LENGTH} lowercase identifier characters.`,
    );
  }
}

/**
 * Retains a JSI object without admitting it into the transport-safe HostValue
 * domain. The frozen reference may be used only as a direct native prop.
 */
export function retainNativeResource<Kind extends string>(
  binding: NativeFabricBinding,
  kind: Kind,
  value: object,
): RetainedNativeResource<Kind> {
  validateNativeResourceKind(kind);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(
      "A retained native resource must be a non-array object.",
    );
  }
  const handle = binding.retainNativeResource(kind, value);
  if (!Number.isSafeInteger(handle) || handle <= 0) {
    throw new IncompatibleNativeHostBindingError([
      "retainNativeResource returned an invalid handle.",
    ]);
  }
  const reference = Object.freeze({
    [NATIVE_RESOURCE_REFERENCE_KEY]: Object.freeze({ handle, kind }),
  }) as NativeResourceReference<Kind>;
  let released = false;
  return Object.freeze({
    reference,
    get released() {
      return released;
    },
    release() {
      if (released) return;
      binding.releaseNativeResource(handle);
      released = true;
    },
  });
}

export function measureNativeHostNode(
  binding: NativeFabricBinding,
  node: NodeHandle,
  afterSequence: CommitSequence = 0,
): NativeMeasurement {
  if (!Number.isSafeInteger(node) || node <= 0) {
    throw new RangeError("The measured node must be a positive safe integer.");
  }
  if (!isNonNegativeSafeInteger(afterSequence)) {
    throw new RangeError(
      "The measurement sequence must be a non-negative safe integer.",
    );
  }

  const value: unknown = binding.measure(node, afterSequence);
  if (!isRecord(value)) {
    throw new IncompatibleNativeHostBindingError([
      "measure returned a non-object value.",
    ]);
  }
  const issues: string[] = [];
  for (const name of ["x", "y", "width", "height", "pageX", "pageY"] as const) {
    if (typeof value[name] !== "number" || !Number.isFinite(value[name])) {
      issues.push(`${name} must be finite.`);
    }
  }
  if (
    typeof value.width === "number" &&
    Number.isFinite(value.width) &&
    value.width < 0
  ) {
    issues.push("width must be non-negative.");
  }
  if (
    typeof value.height === "number" &&
    Number.isFinite(value.height) &&
    value.height < 0
  ) {
    issues.push("height must be non-negative.");
  }
  if (!isNonNegativeSafeInteger(value.observedSequence)) {
    issues.push("Observed sequence must be a non-negative safe integer.");
  } else if (value.observedSequence < afterSequence) {
    issues.push(
      `Measurement only observes sequence ${value.observedSequence}, before requested sequence ${afterSequence}.`,
    );
  }
  if (issues.length > 0) throw new IncompatibleNativeHostBindingError(issues);

  return {
    x: value.x as number,
    y: value.y as number,
    width: value.width as number,
    height: value.height as number,
    pageX: value.pageX as number,
    pageY: value.pageY as number,
    observedSequence: value.observedSequence as number,
  };
}

export function commitNativeHostTransaction(
  binding: NativeFabricBinding,
  commit: HostCommit,
): HostCommitResult {
  const transaction = createNativeHostTransaction(commit, binding.platform);
  const result: unknown = binding.commit(transaction);
  if (
    !isRecord(result) ||
    result.surface !== transaction.surface ||
    result.sequence !== transaction.sequence ||
    typeof result.mounted !== "boolean"
  ) {
    throw new IncompatibleNativeHostBindingError([
      "commit returned a result that does not match its transaction.",
    ]);
  }
  const hostRevision = result.hostRevision;
  if (
    hostRevision !== undefined &&
    (!Number.isSafeInteger(hostRevision) || (hostRevision as number) <= 0)
  ) {
    throw new IncompatibleNativeHostBindingError([
      "commit returned an invalid host revision.",
    ]);
  }
  return {
    surface: result.surface as number,
    sequence: result.sequence as number,
    mounted: result.mounted,
    ...(hostRevision === undefined
      ? {}
      : { hostRevision: hostRevision as number }),
  };
}
