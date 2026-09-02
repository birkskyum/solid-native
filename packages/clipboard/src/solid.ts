import {
  createCausalPlatformEventHandler,
  retainCausalPlatformEvent,
  type NativeCausalEventRetention,
} from "@solid-native/core";
import { getOwner, onCleanup } from "solid-js";

import type { ClipboardService } from "./index.js";

export class ClipboardOwnerDisposedError extends Error {
  constructor() {
    super("The Solid owner was disposed before its clipboard read settled.");
    this.name = "ClipboardOwnerDisposedError";
  }
}

export interface SolidClipboardController {
  readText(): Promise<string>;
  writeText(text: string): void;
  clear(): void;
}

interface PendingRead {
  readonly reject: (error: unknown) => void;
  readonly resolve: (text: string) => void;
}

function settleReadInsideEvent(settlement: PendingRead, text: string) {
  return retainCausalPlatformEvent(undefined, (event) => {
    settlement.resolve(text);
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

/** Owns clipboard reads and carries private native input into Solid causality. */
export function createClipboardController(
  service: ClipboardService,
): SolidClipboardController {
  if (
    typeof service !== "object" ||
    service === null ||
    typeof service.readText !== "function" ||
    typeof service.writeText !== "function" ||
    typeof service.clear !== "function"
  ) {
    throw new TypeError(
      "A Solid clipboard controller requires a ClipboardService.",
    );
  }
  if (getOwner() === null) {
    throw new Error(
      "createClipboardController requires an active Solid owner.",
    );
  }
  let active = true;
  const pending = new Set<PendingRead>();
  const settleRead = createCausalPlatformEventHandler(
    "platform.clipboard.read",
    settleReadInsideEvent,
    { priority: "default" },
  );
  const assertActive = (): void => {
    if (!active) throw new ClipboardOwnerDisposedError();
  };
  onCleanup(() => {
    if (!active) return;
    active = false;
    const error = new ClipboardOwnerDisposedError();
    for (const settlement of pending) settlement.reject(error);
    pending.clear();
  });
  return Object.freeze({
    readText(): Promise<string> {
      if (!active) return Promise.reject(new ClipboardOwnerDisposedError());
      return new Promise<string>((resolve, reject) => {
        const settlement: PendingRead = { reject, resolve };
        pending.add(settlement);
        let read: Promise<string>;
        try {
          read = service.readText();
        } catch (error) {
          pending.delete(settlement);
          reject(error);
          return;
        }
        void Promise.resolve(read).then(
          (text) => {
            if (!pending.delete(settlement)) return;
            settleRead(settlement, text);
          },
          (error: unknown) => {
            if (!pending.delete(settlement)) return;
            reject(error);
          },
        );
      });
    },
    writeText(text: string): void {
      assertActive();
      service.writeText(text);
    },
    clear(): void {
      assertActive();
      service.clear();
    },
  });
}

export type { ClipboardService } from "./index.js";
