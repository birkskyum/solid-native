import {
  createCausalPlatformEventHandler,
  retainCausalPlatformEvent,
  type NativeCausalEventRetention,
} from "@solid-native/core";
import { getOwner, onCleanup } from "solid-js";

import {
  type AlertRequest,
  type AlertResult,
  type AlertService,
} from "./index.js";

export class AlertOwnerDisposedError extends Error {
  constructor() {
    super("The Solid owner was disposed before its native alert settled.");
    this.name = "AlertOwnerDisposedError";
  }
}

export interface SolidAlertController {
  show(request: AlertRequest): Promise<AlertResult>;
}

interface PendingAlert {
  readonly reject: (error: unknown) => void;
  readonly resolve: (result: AlertResult) => void;
}

function settlePromiseInsideEvent(
  settlement: PendingAlert,
  result: AlertResult,
) {
  return retainCausalPlatformEvent(undefined, (event) => {
    settlement.resolve(result);
    // A consumer's first await/then continuation is queued by resolve(). Queue
    // this flush immediately after it so its Solid writes retain the discrete
    // platform cause and priority.
    void Promise.resolve().then(() => finishPromiseSettlement(event));
  });
}

function finishPromiseSettlement(event: NativeCausalEventRetention): void {
  if (event.state !== "active") return;
  try {
    event.run(() => undefined);
    event.finish();
  } catch (error) {
    event.fail(error);
  }
}

/**
 * Owns alert promise settlements with the current Solid owner. Native button
 * and dismissal callbacks become discrete privacy-safe causal inputs.
 */
export function createAlertController(
  service: AlertService,
): SolidAlertController {
  if (
    typeof service !== "object" ||
    service === null ||
    typeof service.show !== "function"
  ) {
    throw new TypeError("A Solid alert controller requires an AlertService.");
  }
  if (getOwner() === null) {
    throw new Error("createAlertController requires an active Solid owner.");
  }
  let active = true;
  const pending = new Set<PendingAlert>();
  const settleButton = createCausalPlatformEventHandler(
    "platform.alert.button",
    settlePromiseInsideEvent,
    { priority: "discrete" },
  );
  const settleDismissed = createCausalPlatformEventHandler(
    "platform.alert.dismissed",
    settlePromiseInsideEvent,
    { priority: "discrete" },
  );
  onCleanup(() => {
    if (!active) return;
    active = false;
    const error = new AlertOwnerDisposedError();
    for (const settlement of pending) settlement.reject(error);
    pending.clear();
  });
  return Object.freeze({
    show(request: AlertRequest): Promise<AlertResult> {
      if (!active) return Promise.reject(new AlertOwnerDisposedError());
      return new Promise<AlertResult>((resolve, reject) => {
        const settlement: PendingAlert = { reject, resolve };
        pending.add(settlement);
        let presentation: Promise<AlertResult>;
        try {
          presentation = service.show(request);
        } catch (error) {
          pending.delete(settlement);
          reject(error);
          return;
        }
        void Promise.resolve(presentation).then(
          (result) => {
            if (!pending.delete(settlement)) return;
            if (result.action === "button") {
              settleButton(settlement, result);
            } else {
              settleDismissed(settlement, result);
            }
          },
          (error: unknown) => {
            if (!pending.delete(settlement)) return;
            reject(error);
          },
        );
      });
    },
  });
}

export { AlertPresentationInProgressError } from "./index.js";

export type {
  AlertButton,
  AlertButtonStyle,
  AlertPlatform,
  AlertRequest,
  AlertResult,
  AlertService,
  AlertUserInterfaceStyle,
} from "./index.js";
