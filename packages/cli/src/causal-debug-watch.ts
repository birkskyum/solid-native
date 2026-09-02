import {
  parseCausalDebugSnapshot,
  type CausalDebugSnapshot,
} from "@solid-native/observability";

export const NATIVE_CAUSAL_DEBUG_WATCH_DEFAULT_INTERVAL_MS = 1_000;
export const NATIVE_CAUSAL_DEBUG_WATCH_MIN_INTERVAL_MS = 100;
export const NATIVE_CAUSAL_DEBUG_WATCH_MAX_INTERVAL_MS = 30_000;
export const NATIVE_CAUSAL_DEBUG_WATCH_DEFAULT_MAX_CONSECUTIVE_FAILURES = 3;
export const NATIVE_CAUSAL_DEBUG_WATCH_MAX_CONSECUTIVE_FAILURES = 100;
export const NATIVE_CAUSAL_DEBUG_WATCH_MAX_SNAPSHOT_COUNT = 10_000;

type MaybePromise<T> = T | Promise<T>;

export interface NativeCausalDebugWatchDependencies {
  readonly wait: (milliseconds: number) => Promise<void>;
}

export interface WatchNativeCausalDebugSnapshotsOptions {
  readonly capture: () => Promise<CausalDebugSnapshot>;
  readonly onSnapshot: (
    snapshot: CausalDebugSnapshot,
    snapshotIndex: number,
  ) => MaybePromise<void>;
  readonly onCaptureError?: (
    error: unknown,
    consecutiveFailureCount: number,
  ) => MaybePromise<void>;
  readonly shouldContinue?: () => boolean;
  readonly intervalMs?: number;
  readonly count?: number;
  readonly maxConsecutiveFailures?: number;
  readonly dependencies?: Partial<NativeCausalDebugWatchDependencies>;
}

export interface NativeCausalDebugWatchResult {
  readonly capturedSnapshotCount: number;
  readonly captureFailureCount: number;
  readonly interrupted: boolean;
}

function boundedSafeInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    throw new TypeError(
      `${label} must be a safe integer from ${minimum} through ${maximum}.`,
    );
  }
  return value as number;
}

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Repeats a one-shot device capture without overlapping requests or retaining
 * snapshots. Capture failures have a bounded consecutive retry budget.
 */
export async function watchNativeCausalDebugSnapshots(
  options: WatchNativeCausalDebugSnapshotsOptions,
): Promise<NativeCausalDebugWatchResult> {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("Causal-debug watch options are required.");
  }
  if (typeof options.capture !== "function") {
    throw new TypeError("Causal-debug watch capture must be a function.");
  }
  if (typeof options.onSnapshot !== "function") {
    throw new TypeError("Causal-debug watch onSnapshot must be a function.");
  }
  if (
    options.onCaptureError !== undefined &&
    typeof options.onCaptureError !== "function"
  ) {
    throw new TypeError(
      "Causal-debug watch onCaptureError must be a function when supplied.",
    );
  }
  if (
    options.shouldContinue !== undefined &&
    typeof options.shouldContinue !== "function"
  ) {
    throw new TypeError(
      "Causal-debug watch shouldContinue must be a function when supplied.",
    );
  }
  if (
    options.dependencies?.wait !== undefined &&
    typeof options.dependencies.wait !== "function"
  ) {
    throw new TypeError(
      "Causal-debug watch wait dependency must be a function when supplied.",
    );
  }

  const intervalMs = boundedSafeInteger(
    options.intervalMs ?? NATIVE_CAUSAL_DEBUG_WATCH_DEFAULT_INTERVAL_MS,
    "Causal-debug watch interval",
    NATIVE_CAUSAL_DEBUG_WATCH_MIN_INTERVAL_MS,
    NATIVE_CAUSAL_DEBUG_WATCH_MAX_INTERVAL_MS,
  );
  const count =
    options.count === undefined
      ? undefined
      : boundedSafeInteger(
          options.count,
          "Causal-debug watch snapshot count",
          1,
          NATIVE_CAUSAL_DEBUG_WATCH_MAX_SNAPSHOT_COUNT,
        );
  const maxConsecutiveFailures = boundedSafeInteger(
    options.maxConsecutiveFailures ??
      NATIVE_CAUSAL_DEBUG_WATCH_DEFAULT_MAX_CONSECUTIVE_FAILURES,
    "Causal-debug watch maximum consecutive failures",
    1,
    NATIVE_CAUSAL_DEBUG_WATCH_MAX_CONSECUTIVE_FAILURES,
  );
  const wait = options.dependencies?.wait ?? defaultWait;
  const shouldContinue = options.shouldContinue ?? (() => true);
  let capturedSnapshotCount = 0;
  let captureFailureCount = 0;
  let consecutiveFailureCount = 0;

  while (shouldContinue() && capturedSnapshotCount !== count) {
    let snapshot: CausalDebugSnapshot;
    try {
      snapshot = parseCausalDebugSnapshot(await options.capture());
      consecutiveFailureCount = 0;
    } catch (error: unknown) {
      consecutiveFailureCount += 1;
      captureFailureCount += 1;
      if (options.onCaptureError !== undefined) {
        try {
          await options.onCaptureError(error, consecutiveFailureCount);
        } catch {
          // A diagnostic observer must not replace the capture failure.
        }
      }
      if (consecutiveFailureCount >= maxConsecutiveFailures) throw error;
      if (!shouldContinue()) break;
      await wait(intervalMs);
      continue;
    }

    await options.onSnapshot(snapshot, capturedSnapshotCount);
    capturedSnapshotCount += 1;

    if (capturedSnapshotCount === count || !shouldContinue()) break;
    await wait(intervalMs);
  }

  return Object.freeze({
    capturedSnapshotCount,
    captureFailureCount,
    interrupted: capturedSnapshotCount !== count,
  });
}
