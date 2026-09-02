import {
  createCausalPlatformEventHandler,
  retainCausalPlatformEvent,
  type NativeCausalEventRetention,
} from "@solid-native/core";
import { getOwner, onCleanup } from "solid-js";

import type { SecureStorage } from "./index.js";

export class SecureStorageOwnerDisposedError extends Error {
  constructor() {
    super("The Solid owner was disposed before secure storage settled.");
    this.name = "SecureStorageOwnerDisposedError";
  }
}

interface PendingOperation<T = unknown> {
  readonly reject: (error: unknown) => void;
  readonly resolve: (value: T) => void;
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

function settleInsideEvent<T>(settlement: PendingOperation<T>, value: T) {
  return retainCausalPlatformEvent(undefined, (event) => {
    settlement.resolve(value);
    void Promise.resolve().then(() => finishPromiseSettlement(event));
  });
}

/** Owns private storage settlements and carries them into Solid causality. */
export function createSecureStorageController(
  storage: SecureStorage,
): SecureStorage {
  if (
    typeof storage !== "object" ||
    storage === null ||
    typeof storage.getItem !== "function" ||
    typeof storage.setItem !== "function" ||
    typeof storage.removeItem !== "function"
  ) {
    throw new TypeError(
      "A Solid secure-storage controller requires a SecureStorage service.",
    );
  }
  if (getOwner() === null) {
    throw new Error(
      "createSecureStorageController requires an active Solid owner.",
    );
  }
  let active = true;
  const pending = new Set<PendingOperation>();
  const settleRead = createCausalPlatformEventHandler(
    "platform.secure-storage.read",
    settleInsideEvent<string | null>,
    { priority: "default" },
  );
  const settleWrite = createCausalPlatformEventHandler(
    "platform.secure-storage.write",
    settleInsideEvent<void>,
    { priority: "default" },
  );
  const settleRemove = createCausalPlatformEventHandler(
    "platform.secure-storage.remove",
    settleInsideEvent<void>,
    { priority: "default" },
  );

  const invoke = <T>(
    operation: () => Promise<T>,
    settle: (settlement: PendingOperation<T>, value: T) => unknown,
  ): Promise<T> => {
    if (!active) return Promise.reject(new SecureStorageOwnerDisposedError());
    return new Promise<T>((resolve, reject) => {
      const settlement: PendingOperation<T> = { reject, resolve };
      pending.add(settlement as PendingOperation);
      let result: Promise<T>;
      try {
        result = operation();
      } catch (error) {
        pending.delete(settlement as PendingOperation);
        reject(error);
        return;
      }
      void Promise.resolve(result).then(
        (value) => {
          if (!pending.delete(settlement as PendingOperation)) return;
          settle(settlement, value);
        },
        (error: unknown) => {
          if (!pending.delete(settlement as PendingOperation)) return;
          reject(error);
        },
      );
    });
  };

  onCleanup(() => {
    if (!active) return;
    active = false;
    const error = new SecureStorageOwnerDisposedError();
    for (const settlement of pending) settlement.reject(error);
    pending.clear();
  });

  return Object.freeze({
    getItem(key: string): Promise<string | null> {
      return invoke(() => storage.getItem(key), settleRead);
    },
    setItem(key: string, value: string): Promise<void> {
      return invoke(() => storage.setItem(key, value), settleWrite);
    },
    removeItem(key: string): Promise<void> {
      return invoke(() => storage.removeItem(key), settleRemove);
    },
  });
}

export type { SecureStorage } from "./index.js";
