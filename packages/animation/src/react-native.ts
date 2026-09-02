import {
  nativeNodeHandle,
  nativeNodeRoot,
  type NativeNode,
} from "@solid-native/renderer";
import {
  NativeFabricHost,
  supportsNativeUIWorkletAnimationCancellation,
  supportsNativeUIWorkletDecays,
  supportsNativeUIWorkletKeyframes,
  supportsNativeUIWorkletPanGestures,
  supportsNativeUIWorkletPanGestureDetachment,
  supportsNativeUIWorkletSprings,
  supportsNativeUIWorkletTimings,
  supportsNativeUIWorklets,
  type NativeFabricBinding,
  type NativeUIWorkletFrameStatistics,
  type NativeUIWorkletInfo,
} from "@solid-native/fabric-host";

import {
  UI_WORKLET_MAX_FRAME_INTERVAL_SAMPLES,
  UI_WORKLET_PROTOCOL_VERSION,
  parseUIWorkletGraph,
  type UIWorkletDecay,
  type UIWorkletGraph,
  type UIWorkletHandle,
  type UIWorkletHost,
  type UIWorkletPanGesture,
  type UIWorkletSpring,
  type UIWorkletTimingKeyframe,
} from "./index.js";

export interface NativeViewUIWorkletSnapshot extends NativeUIWorkletInfo {
  readonly outputs: Readonly<Record<string, number>>;
}

export interface NativeViewUIWorkletHost extends UIWorkletHost {
  readonly target: number;
  attachPanGesture?(
    handle: UIWorkletHandle,
    gesture: UIWorkletPanGesture,
  ): void;
  detachPanGesture?(
    handle: UIWorkletHandle,
    timestamp: number,
  ): readonly number[];
  springGraphInputs?(
    handle: UIWorkletHandle,
    inputs: readonly number[],
    timestamp: number,
    spring: UIWorkletSpring,
  ): void;
  decayGraphInputs?(
    handle: UIWorkletHandle,
    velocities: readonly number[],
    timestamp: number,
    decay: UIWorkletDecay,
  ): void;
  animateGraphKeyframes?(
    handle: UIWorkletHandle,
    keyframes: readonly UIWorkletTimingKeyframe[],
    timestamp: number,
  ): void;
  cancelGraphAnimation?(
    handle: UIWorkletHandle,
    timestamp: number,
  ): readonly number[];
  inspectGraph(handle: UIWorkletHandle): NativeViewUIWorkletSnapshot;
}

function positiveSafeInteger(value: unknown, context: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError(`${context} must be a positive safe integer.`);
  }
  return value as number;
}

function nonNegativeInteger(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${context} must be a non-negative safe integer.`);
  }
  return value;
}

function nonNegativeNumber(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${context} must be finite and non-negative.`);
  }
  return value;
}

function parseFrameStatistics(
  value: unknown,
  driver: "decay" | "spring" | "timing",
): Readonly<NativeUIWorkletFrameStatistics> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(
      `Snapshot ${driver} frame statistics must be an object.`,
    );
  }
  const record = value as Record<string, unknown>;
  const keys = [
    "frameCount",
    "intervalCount",
    "sampledIntervalCount",
    "droppedIntervalSampleCount",
    "firstFrameTimeMilliseconds",
    "lastFrameTimeMilliseconds",
    "minimumFrameIntervalMilliseconds",
    "maximumFrameIntervalMilliseconds",
    "meanFrameIntervalMilliseconds",
    "p50FrameIntervalMilliseconds",
    "p95FrameIntervalMilliseconds",
    "p99FrameIntervalMilliseconds",
  ] as const;
  if (
    Object.keys(record).length !== keys.length ||
    keys.some((key) => !(key in record))
  ) {
    throw new TypeError(
      `Snapshot ${driver} frame statistics must contain the complete known schema.`,
    );
  }
  const frameCount = nonNegativeInteger(
    record.frameCount,
    `Snapshot ${driver} frame count`,
  );
  const intervalCount = nonNegativeInteger(
    record.intervalCount,
    `Snapshot ${driver} interval count`,
  );
  const sampledIntervalCount = nonNegativeInteger(
    record.sampledIntervalCount,
    `Snapshot sampled ${driver} interval count`,
  );
  const droppedIntervalSampleCount = nonNegativeInteger(
    record.droppedIntervalSampleCount,
    `Snapshot dropped ${driver} interval count`,
  );
  const firstFrameTimeMilliseconds = nonNegativeNumber(
    record.firstFrameTimeMilliseconds,
    `Snapshot first ${driver} frame`,
  );
  const lastFrameTimeMilliseconds = nonNegativeNumber(
    record.lastFrameTimeMilliseconds,
    `Snapshot last ${driver} frame`,
  );
  const minimumFrameIntervalMilliseconds = nonNegativeNumber(
    record.minimumFrameIntervalMilliseconds,
    `Snapshot minimum ${driver} frame interval`,
  );
  const maximumFrameIntervalMilliseconds = nonNegativeNumber(
    record.maximumFrameIntervalMilliseconds,
    `Snapshot maximum ${driver} frame interval`,
  );
  const meanFrameIntervalMilliseconds = nonNegativeNumber(
    record.meanFrameIntervalMilliseconds,
    `Snapshot mean ${driver} frame interval`,
  );
  const p50FrameIntervalMilliseconds = nonNegativeNumber(
    record.p50FrameIntervalMilliseconds,
    `Snapshot p50 ${driver} frame interval`,
  );
  const p95FrameIntervalMilliseconds = nonNegativeNumber(
    record.p95FrameIntervalMilliseconds,
    `Snapshot p95 ${driver} frame interval`,
  );
  const p99FrameIntervalMilliseconds = nonNegativeNumber(
    record.p99FrameIntervalMilliseconds,
    `Snapshot p99 ${driver} frame interval`,
  );
  if (
    frameCount < 1 ||
    intervalCount !== frameCount - 1 ||
    sampledIntervalCount + droppedIntervalSampleCount !== intervalCount ||
    sampledIntervalCount > UI_WORKLET_MAX_FRAME_INTERVAL_SAMPLES ||
    lastFrameTimeMilliseconds < firstFrameTimeMilliseconds
  ) {
    throw new RangeError(`Snapshot ${driver} frame counts are inconsistent.`);
  }
  const intervals = [
    minimumFrameIntervalMilliseconds,
    p50FrameIntervalMilliseconds,
    p95FrameIntervalMilliseconds,
    p99FrameIntervalMilliseconds,
    maximumFrameIntervalMilliseconds,
  ];
  if (intervalCount === 0) {
    if (
      lastFrameTimeMilliseconds !== firstFrameTimeMilliseconds ||
      sampledIntervalCount !== 0 ||
      droppedIntervalSampleCount !== 0 ||
      meanFrameIntervalMilliseconds !== 0 ||
      intervals.some((interval) => interval !== 0)
    ) {
      throw new RangeError(
        `A single ${driver} frame cannot publish interval statistics.`,
      );
    }
  } else if (
    sampledIntervalCount < 1 ||
    minimumFrameIntervalMilliseconds <= 0 ||
    intervals.some((interval, index) =>
      index === 0 ? false : interval < intervals[index - 1]!,
    ) ||
    meanFrameIntervalMilliseconds < minimumFrameIntervalMilliseconds ||
    meanFrameIntervalMilliseconds > maximumFrameIntervalMilliseconds ||
    lastFrameTimeMilliseconds <= firstFrameTimeMilliseconds
  ) {
    throw new RangeError(
      `Snapshot ${driver} frame intervals are inconsistent.`,
    );
  }
  return Object.freeze({
    frameCount,
    intervalCount,
    sampledIntervalCount,
    droppedIntervalSampleCount,
    firstFrameTimeMilliseconds,
    lastFrameTimeMilliseconds,
    minimumFrameIntervalMilliseconds,
    maximumFrameIntervalMilliseconds,
    meanFrameIntervalMilliseconds,
    p50FrameIntervalMilliseconds,
    p95FrameIntervalMilliseconds,
    p99FrameIntervalMilliseconds,
  });
}

function parseSnapshot(
  value: NativeUIWorkletInfo,
  handle: number,
  target: number,
): NativeViewUIWorkletSnapshot {
  if (value === null || typeof value !== "object") {
    throw new TypeError("The native UI worklet snapshot must be an object.");
  }
  if (positiveSafeInteger(value.handle, "Snapshot handle") !== handle) {
    throw new Error("The native UI worklet snapshot returned another handle.");
  }
  if (positiveSafeInteger(value.target, "Snapshot target") !== target) {
    throw new Error("The native UI worklet snapshot returned another target.");
  }
  const sequence = nonNegativeInteger(value.sequence, "Snapshot sequence");
  const appliedSequence = nonNegativeInteger(
    value.appliedSequence,
    "Snapshot applied sequence",
  );
  if (appliedSequence > sequence) {
    throw new RangeError(
      "The native UI worklet applied sequence is ahead of evaluation.",
    );
  }
  if (typeof value.applied !== "boolean") {
    throw new TypeError("Snapshot applied must be a boolean.");
  }
  const frameTimeNanoseconds = nonNegativeInteger(
    value.frameTimeNanoseconds,
    "Snapshot frame time",
  );
  if (typeof value.timingActive !== "boolean") {
    throw new TypeError("Snapshot timing state must be a boolean.");
  }
  if (
    typeof value.timingProgress !== "number" ||
    !Number.isFinite(value.timingProgress) ||
    value.timingProgress < 0 ||
    value.timingProgress > 1
  ) {
    throw new TypeError(
      "Snapshot timing progress must be between zero and one.",
    );
  }
  if (value.timingActive && value.timingProgress >= 1) {
    throw new RangeError("An active native timing cannot already be complete.");
  }
  const timingFrameStatistics =
    value.timingFrameStatistics === undefined
      ? undefined
      : parseFrameStatistics(value.timingFrameStatistics, "timing");
  const springFields = [
    value.springActive,
    value.springPosition,
    value.springVelocity,
    value.springFrameStatistics,
  ];
  const hasSpringFields = springFields.some((field) => field !== undefined);
  let spring:
    | {
        readonly springActive: boolean;
        readonly springPosition: number;
        readonly springVelocity: number;
        readonly springFrameStatistics?: Readonly<NativeUIWorkletFrameStatistics>;
      }
    | undefined;
  if (hasSpringFields) {
    if (typeof value.springActive !== "boolean") {
      throw new TypeError("Snapshot spring state must be a boolean.");
    }
    if (
      typeof value.springPosition !== "number" ||
      !Number.isFinite(value.springPosition)
    ) {
      throw new TypeError("Snapshot spring position must be finite.");
    }
    if (
      typeof value.springVelocity !== "number" ||
      !Number.isFinite(value.springVelocity)
    ) {
      throw new TypeError("Snapshot spring velocity must be finite.");
    }
    if (value.springActive && value.timingActive) {
      throw new RangeError(
        "Native timing and spring drivers cannot be active together.",
      );
    }
    const springFrameStatistics =
      value.springFrameStatistics === undefined
        ? undefined
        : parseFrameStatistics(value.springFrameStatistics, "spring");
    spring = {
      springActive: value.springActive,
      springPosition: value.springPosition,
      springVelocity: value.springVelocity,
      ...(springFrameStatistics === undefined ? {} : { springFrameStatistics }),
    };
  }
  const decayFields = [
    value.decayActive,
    value.decayElapsedMilliseconds,
    value.decaySpeed,
    value.decayFrameStatistics,
  ];
  const hasDecayFields = decayFields.some((field) => field !== undefined);
  let decay:
    | {
        readonly decayActive: boolean;
        readonly decayElapsedMilliseconds: number;
        readonly decaySpeed: number;
        readonly decayFrameStatistics?: Readonly<NativeUIWorkletFrameStatistics>;
      }
    | undefined;
  if (hasDecayFields) {
    if (typeof value.decayActive !== "boolean") {
      throw new TypeError("Snapshot decay state must be a boolean.");
    }
    const decayElapsedMilliseconds = nonNegativeNumber(
      value.decayElapsedMilliseconds,
      "Snapshot decay elapsed time",
    );
    const decaySpeed = nonNegativeNumber(
      value.decaySpeed,
      "Snapshot decay speed",
    );
    if (
      value.decayActive &&
      (value.timingActive || value.springActive === true)
    ) {
      throw new RangeError(
        "Native timing, spring, and decay drivers cannot be active together.",
      );
    }
    const decayFrameStatistics =
      value.decayFrameStatistics === undefined
        ? undefined
        : parseFrameStatistics(value.decayFrameStatistics, "decay");
    decay = {
      decayActive: value.decayActive,
      decayElapsedMilliseconds,
      decaySpeed,
      ...(decayFrameStatistics === undefined ? {} : { decayFrameStatistics }),
    };
  }
  const gestureFields = [
    value.gestureAttached,
    value.gestureActive,
    value.gestureSequence,
    value.gestureTimestamp,
  ];
  const hasGestureFields = gestureFields.some((field) => field !== undefined);
  let gesture:
    | {
        readonly gestureAttached: boolean;
        readonly gestureActive: boolean;
        readonly gestureSequence: number;
        readonly gestureTimestamp?: number;
      }
    | undefined;
  if (hasGestureFields) {
    if (value.gestureAttached !== true) {
      throw new TypeError("Snapshot gesture attachment must be true.");
    }
    if (typeof value.gestureActive !== "boolean") {
      throw new TypeError("Snapshot gesture state must be a boolean.");
    }
    const gestureSequence = nonNegativeInteger(
      value.gestureSequence,
      "Snapshot gesture sequence",
    );
    let gestureTimestamp: number | undefined;
    if (value.gestureTimestamp !== undefined) {
      if (
        typeof value.gestureTimestamp !== "number" ||
        !Number.isFinite(value.gestureTimestamp) ||
        value.gestureTimestamp < 0
      ) {
        throw new TypeError(
          "Snapshot gesture timestamp must be finite and non-negative.",
        );
      }
      gestureTimestamp = value.gestureTimestamp;
    }
    gesture = {
      gestureAttached: true,
      gestureActive: value.gestureActive,
      gestureSequence,
      ...(gestureTimestamp === undefined ? {} : { gestureTimestamp }),
    };
  }
  let timestamp: number | undefined;
  if (value.timestamp !== undefined) {
    if (
      typeof value.timestamp !== "number" ||
      !Number.isFinite(value.timestamp) ||
      value.timestamp < 0
    ) {
      throw new TypeError(
        "Snapshot input timestamp must be finite and non-negative.",
      );
    }
    timestamp = value.timestamp;
  }
  if (
    value.outputs === null ||
    typeof value.outputs !== "object" ||
    Array.isArray(value.outputs)
  ) {
    throw new TypeError("Snapshot outputs must be an object.");
  }
  const outputs: Record<string, number> = {};
  for (const [name, output] of Object.entries(value.outputs)) {
    if (typeof output !== "number" || !Number.isFinite(output)) {
      throw new TypeError(`Native UI worklet output ${name} must be finite.`);
    }
    outputs[name] = output;
  }
  const base = {
    handle,
    target,
    sequence,
    appliedSequence,
    applied: value.applied,
    frameTimeNanoseconds,
    timingActive: value.timingActive,
    timingProgress: value.timingProgress,
    ...(timingFrameStatistics === undefined ? {} : { timingFrameStatistics }),
    ...spring,
    ...decay,
    ...gesture,
    outputs: Object.freeze(outputs),
  };
  return Object.freeze(timestamp === undefined ? base : { ...base, timestamp });
}

/** @internal Node-aware adapters should normally be preferred. */
export function createNativeBindingUIWorkletHost(
  binding: NativeFabricBinding,
  targetValue: number,
): NativeViewUIWorkletHost {
  const target = positiveSafeInteger(targetValue, "Native worklet target");
  if (!supportsNativeUIWorklets(binding)) {
    throw new Error(
      "The React Native binding does not expose the complete native UI worklet protocol.",
    );
  }
  const host: NativeViewUIWorkletHost = {
    protocolVersion: UI_WORKLET_PROTOCOL_VERSION,
    target,
    installGraph(graphValue: UIWorkletGraph) {
      const graph = parseUIWorkletGraph(graphValue);
      return positiveSafeInteger(
        binding.installUIWorklet(target, graph),
        "Native worklet handle",
      );
    },
    updateGraphInputs(handle, inputs, timestamp) {
      binding.updateUIWorkletInputs(handle, inputs, timestamp);
    },
    ...(supportsNativeUIWorkletTimings(binding)
      ? {
          animateGraphInputs(handle, inputs, timestamp, timing) {
            binding.animateUIWorkletInputs(handle, inputs, timestamp, timing);
          },
        }
      : {}),
    ...(supportsNativeUIWorkletKeyframes(binding)
      ? {
          animateGraphKeyframes(handle, keyframes, timestamp) {
            binding.animateUIWorkletKeyframes(handle, keyframes, timestamp);
          },
        }
      : {}),
    ...(supportsNativeUIWorkletSprings(binding)
      ? {
          springGraphInputs(handle, inputs, timestamp, spring) {
            binding.springUIWorkletInputs(handle, inputs, timestamp, spring);
          },
        }
      : {}),
    ...(supportsNativeUIWorkletDecays(binding)
      ? {
          decayGraphInputs(handle, velocities, timestamp, decay) {
            binding.decayUIWorkletInputs(handle, velocities, timestamp, decay);
          },
        }
      : {}),
    ...(supportsNativeUIWorkletAnimationCancellation(binding)
      ? {
          cancelGraphAnimation(handle, timestamp) {
            return binding.cancelUIWorkletAnimation(handle, timestamp);
          },
        }
      : {}),
    ...(supportsNativeUIWorkletPanGestures(binding)
      ? {
          attachPanGesture(handle, gesture) {
            binding.attachUIWorkletPanGesture(handle, gesture);
          },
        }
      : {}),
    ...(supportsNativeUIWorkletPanGestureDetachment(binding)
      ? {
          detachPanGesture(handle, timestamp) {
            return binding.detachUIWorkletPanGesture(handle, timestamp);
          },
        }
      : {}),
    destroyGraph(handle) {
      binding.destroyUIWorklet(handle);
    },
    inspectGraph(handle) {
      return parseSnapshot(binding.getUIWorkletInfo(handle), handle, target);
    },
  };
  return Object.freeze(host);
}

/** Binds version-0 numeric output channels to one owned Fabric element. */
export function createNativeViewUIWorkletHost(
  node: NativeNode,
): NativeViewUIWorkletHost {
  if (node.kind !== "element") {
    throw new TypeError("Native UI worklets require an element target.");
  }
  const root = nativeNodeRoot(node);
  if (!(root.host instanceof NativeFabricHost)) {
    throw new Error(
      "Native view UI worklets require the React Native Fabric host.",
    );
  }
  return createNativeBindingUIWorkletHost(
    root.host.binding,
    nativeNodeHandle(node),
  );
}
