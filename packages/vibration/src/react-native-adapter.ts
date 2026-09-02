import {
  type NormalizedVibrationRequest,
  type VibrationAdapter,
  type VibrationSegment,
} from "./index.js";

export interface ReactNativeVibrationModule {
  vibrate(durationMs: number): void;
  vibrateByPattern(pattern: readonly number[], repeatIndex: number): void;
  cancel(): void;
}

export interface VibrationScheduler {
  schedule(callback: () => void, delayMs: number): () => void;
}

interface TimerRuntime {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

const defaultScheduler: VibrationScheduler = Object.freeze({
  schedule(callback: () => void, delayMs: number): () => void {
    const runtime = globalThis as unknown as TimerRuntime;
    const handle = runtime.setTimeout(callback, delayMs);
    return () => runtime.clearTimeout(handle);
  },
});

function record(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function vibrationModule(
  value: ReactNativeVibrationModule,
): ReactNativeVibrationModule {
  const candidate = record(value, "React Native vibration module");
  if (
    typeof candidate.vibrate !== "function" ||
    typeof candidate.vibrateByPattern !== "function" ||
    typeof candidate.cancel !== "function"
  ) {
    throw new TypeError(
      "React Native vibration module must provide vibrate(), vibrateByPattern(), and cancel().",
    );
  }
  return value;
}

function scheduler(value: VibrationScheduler): VibrationScheduler {
  const candidate = record(value, "Vibration scheduler");
  if (typeof candidate.schedule !== "function") {
    throw new TypeError("Vibration scheduler must provide schedule().");
  }
  return value;
}

/** @internal Translation seam kept separate from React Native module lookup. */
export function createAndroidVibrationAdapter(
  value: ReactNativeVibrationModule,
): VibrationAdapter {
  const module = vibrationModule(value);
  return Object.freeze({
    platform: "android" as const,
    startVibration(request: NormalizedVibrationRequest): void {
      if (request.kind === "pulse") {
        module.vibrate(request.durationMs);
        return;
      }
      const waveform = Object.freeze(
        request.pattern.flatMap((segment) => [
          segment.delayMs,
          segment.durationMs,
        ]),
      );
      module.vibrateByPattern(waveform, request.repeat ? 0 : -1);
    },
    cancelVibration(): void {
      module.cancel();
    },
  });
}

/** @internal Translation seam kept separate from React Native module lookup. */
export function createIOSVibrationAdapter(
  value: ReactNativeVibrationModule,
  schedulerValue: VibrationScheduler = defaultScheduler,
): VibrationAdapter {
  const module = vibrationModule(value);
  const timer = scheduler(schedulerValue);
  let cancelScheduled: (() => void) | undefined;

  const cancel = (): void => {
    const cancelTimer = cancelScheduled;
    cancelScheduled = undefined;
    cancelTimer?.();
  };
  const schedulePattern = (
    pattern: readonly VibrationSegment[],
    repeat: boolean,
  ): void => {
    let index = 0;
    const schedulePulse = (delayMs: number): void => {
      const pulse = (): void => {
        cancelScheduled = undefined;
        const segment = pattern[index]!;
        module.vibrate(segment.durationMs);
        const currentDuration = segment.durationMs;
        index++;
        if (index >= pattern.length) {
          if (!repeat) return;
          index = 0;
        }
        schedulePulse(currentDuration + pattern[index]!.delayMs);
      };
      if (delayMs === 0) {
        pulse();
        return;
      }
      const scheduledCancel = timer.schedule(pulse, delayMs);
      if (typeof scheduledCancel !== "function") {
        throw new TypeError(
          "Vibration scheduler must return a cancellation function.",
        );
      }
      cancelScheduled = scheduledCancel;
    };
    schedulePulse(pattern[0]!.delayMs);
  };

  return Object.freeze({
    platform: "ios" as const,
    startVibration(request: NormalizedVibrationRequest): void {
      cancel();
      if (request.kind === "pulse") {
        module.vibrate(request.durationMs);
        return;
      }
      schedulePattern(request.pattern, request.repeat);
    },
    cancelVibration: cancel,
  });
}
