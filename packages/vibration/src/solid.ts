import { getOwner, onCleanup } from "solid-js";

import {
  type VibrationHandle,
  type VibrationRequest,
  type VibrationService,
} from "./index.js";

export class VibrationOwnerDisposedError extends Error {
  constructor() {
    super("The Solid vibration owner has been disposed.");
    this.name = "VibrationOwnerDisposedError";
  }
}

export interface SolidVibrationController {
  vibrate(request?: VibrationRequest): VibrationHandle;
  cancel(): void;
}

/** Owns one revocable process-wide vibration lease with the current owner. */
export function createVibrationController(
  service: VibrationService,
): SolidVibrationController {
  if (
    typeof service !== "object" ||
    service === null ||
    typeof service.vibrate !== "function" ||
    typeof service.cancel !== "function"
  ) {
    throw new TypeError(
      "A Solid vibration controller requires a VibrationService.",
    );
  }
  if (getOwner() === null) {
    throw new Error(
      "createVibrationController requires an active Solid owner.",
    );
  }
  let active = true;
  let handle: VibrationHandle | undefined;
  const cancel = (): void => {
    const current = handle;
    handle = undefined;
    current?.cancel();
  };
  onCleanup(() => {
    if (!active) return;
    active = false;
    cancel();
  });
  return Object.freeze({
    vibrate(request?: VibrationRequest): VibrationHandle {
      if (!active) throw new VibrationOwnerDisposedError();
      cancel();
      const next = service.vibrate(request);
      if (
        typeof next !== "object" ||
        next === null ||
        typeof next.cancel !== "function"
      ) {
        try {
          service.cancel();
        } catch {
          // Preserve the invalid handle boundary as the primary failure.
        }
        throw new TypeError("VibrationService returned an invalid handle.");
      }
      handle = next;
      return Object.freeze({
        cancel(): void {
          if (handle !== next) return;
          handle = undefined;
          next.cancel();
        },
      });
    },
    cancel,
  });
}

export type {
  VibrationHandle,
  VibrationPlatform,
  VibrationRequest,
  VibrationSegment,
  VibrationService,
} from "./index.js";
