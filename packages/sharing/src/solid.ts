import {
  createCausalPlatformEventHandler,
  retainCausalPlatformEvent,
  type NativeCausalEventRetention,
} from "@solid-native/core";
import { getOwner, onCleanup } from "solid-js";

import {
  type ShareRequest,
  type ShareResult,
  type ShareService,
} from "./index.js";

export class ShareOwnerDisposedError extends Error {
  constructor() {
    super("The Solid owner was disposed before its system share settled.");
    this.name = "ShareOwnerDisposedError";
  }
}

export interface SolidShareController {
  share(request: ShareRequest): Promise<ShareResult>;
}

interface PendingShare {
  readonly reject: (error: unknown) => void;
  readonly resolve: (result: ShareResult) => void;
}

function settlePromiseInsideEvent(
  settlement: PendingShare,
  result: ShareResult,
) {
  return retainCausalPlatformEvent(undefined, (event) => {
    settlement.resolve(result);
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

/** Owns share settlements and carries system responses into Solid causality. */
export function createShareController(
  service: ShareService,
): SolidShareController {
  if (
    typeof service !== "object" ||
    service === null ||
    typeof service.share !== "function"
  ) {
    throw new TypeError("A Solid share controller requires a ShareService.");
  }
  if (getOwner() === null) {
    throw new Error("createShareController requires an active Solid owner.");
  }
  let active = true;
  const pending = new Set<PendingShare>();
  const settlePresented = createCausalPlatformEventHandler(
    "platform.share.presented",
    settlePromiseInsideEvent,
    { priority: "discrete" },
  );
  const settleCompleted = createCausalPlatformEventHandler(
    "platform.share.completed",
    settlePromiseInsideEvent,
    { priority: "discrete" },
  );
  const settleDismissed = createCausalPlatformEventHandler(
    "platform.share.dismissed",
    settlePromiseInsideEvent,
    { priority: "discrete" },
  );
  onCleanup(() => {
    if (!active) return;
    active = false;
    const error = new ShareOwnerDisposedError();
    for (const settlement of pending) settlement.reject(error);
    pending.clear();
  });
  return Object.freeze({
    share(request: ShareRequest): Promise<ShareResult> {
      if (!active) return Promise.reject(new ShareOwnerDisposedError());
      return new Promise<ShareResult>((resolve, reject) => {
        const settlement: PendingShare = { reject, resolve };
        pending.add(settlement);
        let presentation: Promise<ShareResult>;
        try {
          presentation = service.share(request);
        } catch (error) {
          pending.delete(settlement);
          reject(error);
          return;
        }
        void Promise.resolve(presentation).then(
          (result) => {
            if (!pending.delete(settlement)) return;
            if (result.action === "presented") {
              settlePresented(settlement, result);
            } else if (result.action === "completed") {
              settleCompleted(settlement, result);
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

export { SharePresentationInProgressError } from "./index.js";

export type {
  SharePlatform,
  ShareRequest,
  ShareResult,
  ShareService,
} from "./index.js";
