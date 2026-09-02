import {
  getNativeHostBinding,
  readNativeSurfaceInfo,
  type NativeFabricBinding,
  type NativeSurfaceInfo,
} from "./native-binding.js";

const DEFAULT_SURFACE_READY_TIMEOUT_MS = 10_000;
const MAX_SURFACE_READY_TIMEOUT_MS = 60_000;
const DEFAULT_SURFACE_READY_POLL_INTERVAL_MS = 10;
const MAX_SURFACE_READY_POLL_INTERVAL_MS = 1_000;

export interface WaitForNativeSurfaceOptions {
  readonly binding?: NativeFabricBinding;
  /** Maximum native bootstrap wait. Defaults to 10 seconds and is capped at 60 seconds. */
  readonly timeoutMs?: number;
  /** Poll interval while the platform allocates its Fabric surface. Defaults to 10 ms. */
  readonly pollIntervalMs?: number;
}

export class NativeSurfaceStartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativeSurfaceStartupError";
  }
}

function boundedMilliseconds(
  value: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(
      `${name} must be a safe integer from ${String(minimum)} through ${String(maximum)} milliseconds.`,
    );
  }
  return value;
}

function nativeDelay(milliseconds: number): Promise<void> {
  const timers = globalThis as unknown as {
    setTimeout(callback: () => void, delay: number): unknown;
  };
  return new Promise((resolve) => timers.setTimeout(resolve, milliseconds));
}

/**
 * Waits for the package-owned iOS or Android shell to publish its empty Fabric
 * surface. The wait is bounded so a failed native bootstrap cannot leave a
 * hidden JavaScript polling loop running indefinitely.
 */
export async function waitForNativeSurface(
  options: WaitForNativeSurfaceOptions = {},
): Promise<NativeSurfaceInfo> {
  const binding = options.binding ?? getNativeHostBinding();
  const timeoutMs = boundedMilliseconds(
    options.timeoutMs ?? DEFAULT_SURFACE_READY_TIMEOUT_MS,
    "timeoutMs",
    0,
    MAX_SURFACE_READY_TIMEOUT_MS,
  );
  const pollIntervalMs = boundedMilliseconds(
    options.pollIntervalMs ?? DEFAULT_SURFACE_READY_POLL_INTERVAL_MS,
    "pollIntervalMs",
    1,
    MAX_SURFACE_READY_POLL_INTERVAL_MS,
  );
  const startedAt = Date.now();

  while (true) {
    const surface = readNativeSurfaceInfo(binding);
    if (surface.ready) return surface;
    const elapsed = Date.now() - startedAt;
    if (elapsed >= timeoutMs) {
      throw new NativeSurfaceStartupError(
        `The native Fabric surface was not ready within ${String(timeoutMs)} milliseconds.`,
      );
    }
    await nativeDelay(Math.min(pollIntervalMs, timeoutMs - elapsed));
  }
}
