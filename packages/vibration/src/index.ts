export const VIBRATION_DEFAULT_DURATION_MS = 400;
export const VIBRATION_MAX_DURATION_MS = 60_000;
export const VIBRATION_MAX_PATTERN_SEGMENTS = 64;
export const VIBRATION_MAX_PATTERN_CYCLE_MS = 300_000;

export type VibrationPlatform = "android" | "ios";

export interface VibrationSegment {
  /** Silence after the previous segment finishes. */
  readonly delayMs: number;
  /** Requested vibration duration; iOS hardware uses its fixed system pulse. */
  readonly durationMs: number;
}

export interface VibrationRequest {
  /** One immediate pulse. Defaults to 400ms when no pattern is supplied. */
  readonly durationMs?: number;
  /** Ordered silence/vibration segments. Mutually exclusive with durationMs. */
  readonly pattern?: readonly VibrationSegment[];
  /** Repeats a pattern until its lease is cancelled. */
  readonly repeat?: boolean;
}

export type NormalizedVibrationRequest =
  | {
      readonly kind: "pulse";
      readonly durationMs: number;
    }
  | {
      readonly kind: "pattern";
      readonly pattern: readonly VibrationSegment[];
      readonly repeat: boolean;
    };

export interface VibrationAdapter {
  readonly platform: VibrationPlatform;
  startVibration(request: NormalizedVibrationRequest): void;
  cancelVibration(): void;
}

export interface VibrationHandle {
  cancel(): void;
}

export interface VibrationService {
  readonly platform: VibrationPlatform;
  vibrate(request?: VibrationRequest): VibrationHandle;
  cancel(): void;
}

function plainRecord(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must be a plain object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function boundedInteger(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    throw new TypeError(
      `${path} must be a safe integer from ${minimum} through ${maximum}.`,
    );
  }
  return value as number;
}

function normalizePattern(value: unknown): readonly VibrationSegment[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > VIBRATION_MAX_PATTERN_SEGMENTS
  ) {
    throw new TypeError(
      `Vibration pattern must contain 1-${VIBRATION_MAX_PATTERN_SEGMENTS} segments.`,
    );
  }
  let cycleDuration = 0;
  const pattern = value.map((rawSegment, index) => {
    const segment = plainRecord(
      rawSegment,
      `Vibration pattern segment ${index}`,
    );
    const delayMs = boundedInteger(
      segment.delayMs,
      `Vibration pattern segment ${index}.delayMs`,
      0,
      VIBRATION_MAX_DURATION_MS,
    );
    const durationMs = boundedInteger(
      segment.durationMs,
      `Vibration pattern segment ${index}.durationMs`,
      1,
      VIBRATION_MAX_DURATION_MS,
    );
    cycleDuration += delayMs + durationMs;
    return Object.freeze({ delayMs, durationMs });
  });
  if (cycleDuration > VIBRATION_MAX_PATTERN_CYCLE_MS) {
    throw new RangeError(
      `Vibration pattern cycle must not exceed ${VIBRATION_MAX_PATTERN_CYCLE_MS}ms.`,
    );
  }
  return Object.freeze(pattern);
}

function normalizeVibrationRequest(
  value: VibrationRequest | undefined,
): NormalizedVibrationRequest {
  const request =
    value === undefined ? {} : plainRecord(value, "Vibration request");
  if (request.durationMs !== undefined && request.pattern !== undefined) {
    throw new TypeError(
      "Vibration request durationMs and pattern are mutually exclusive.",
    );
  }
  const repeat = request.repeat ?? false;
  if (typeof repeat !== "boolean") {
    throw new TypeError("Vibration request repeat must be a boolean.");
  }
  if (request.pattern === undefined) {
    if (repeat) {
      throw new TypeError("Vibration repeat requires a pattern.");
    }
    return Object.freeze({
      kind: "pulse",
      durationMs: boundedInteger(
        request.durationMs ?? VIBRATION_DEFAULT_DURATION_MS,
        "Vibration durationMs",
        1,
        VIBRATION_MAX_DURATION_MS,
      ),
    });
  }
  return Object.freeze({
    kind: "pattern",
    pattern: normalizePattern(request.pattern),
    repeat,
  });
}

/**
 * Owns the process-wide native vibrator through revocable leases. A stale
 * handle can never cancel a newer vibration started by another owner.
 */
export function createVibrationService(
  adapter: VibrationAdapter,
): VibrationService {
  const candidate = plainRecord(adapter, "Vibration adapter");
  if (candidate.platform !== "android" && candidate.platform !== "ios") {
    throw new TypeError("Vibration adapter platform must be android or ios.");
  }
  if (
    typeof candidate.startVibration !== "function" ||
    typeof candidate.cancelVibration !== "function"
  ) {
    throw new TypeError(
      "Vibration adapter must provide startVibration() and cancelVibration().",
    );
  }
  const platform = candidate.platform;
  let activeLease: symbol | undefined;

  const cancelLease = (lease: symbol): void => {
    if (activeLease !== lease) return;
    activeLease = undefined;
    adapter.cancelVibration();
  };
  const cancel = (): void => {
    const lease = activeLease;
    if (lease !== undefined) cancelLease(lease);
  };
  return Object.freeze({
    platform,
    vibrate(request?: VibrationRequest): VibrationHandle {
      const normalized = normalizeVibrationRequest(request);
      cancel();
      adapter.startVibration(normalized);
      const lease = Symbol("vibration-lease");
      activeLease = lease;
      return Object.freeze({
        cancel(): void {
          cancelLease(lease);
        },
      });
    },
    cancel,
  });
}
