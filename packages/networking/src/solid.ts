import {
  createCausalPlatformEventHandler,
  retainCausalPlatformEvent,
  type NativeCausalEventRetention,
} from "@solid-native/core";
import { getOwner, onCleanup } from "solid-js";

import {
  type NetworkResponse,
  type NetworkService,
  type NetworkTextChunk,
  type NetworkTextObserver,
  type NetworkTextRequest,
  type NetworkTextRequestHandle,
  type NetworkTextResult,
} from "./index.js";

export class NetworkOwnerDisposedError extends Error {
  constructor() {
    super("The Solid owner was disposed before its network request settled.");
    this.name = "NetworkOwnerDisposedError";
  }
}

export interface SolidNetworkController {
  requestText(
    request: NetworkTextRequest,
    observer?: NetworkTextObserver,
  ): NetworkTextRequestHandle;
}

interface PendingRequest {
  readonly cancel: () => void;
  readonly reject: (error: unknown) => void;
  readonly resolve: (result: NetworkTextResult) => void;
}

interface Delivery<T> {
  readonly callback?: (value: T) => unknown;
  readonly value: T;
}

function deliver<T>(delivery: Delivery<T>): unknown {
  const result = delivery.callback?.(delivery.value);
  if (
    result !== null &&
    result !== undefined &&
    (typeof result === "object" || typeof result === "function") &&
    typeof (result as Readonly<{ then?: unknown }>).then === "function"
  ) {
    void Promise.resolve(result).catch(() => undefined);
    throw new TypeError(
      "Solid network observer callbacks must complete synchronously.",
    );
  }
  return result;
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

function settleResolved(settlement: PendingRequest, result: NetworkTextResult) {
  return retainCausalPlatformEvent(undefined, (event) => {
    settlement.resolve(result);
    void Promise.resolve().then(() => finishPromiseSettlement(event));
  });
}

function settleRejected(settlement: PendingRequest, error: unknown) {
  return retainCausalPlatformEvent(undefined, (event) => {
    settlement.reject(error);
    void Promise.resolve().then(() => finishPromiseSettlement(event));
  });
}

function rejectedHandle(error: unknown): NetworkTextRequestHandle {
  return Object.freeze({
    result: Promise.reject(error),
    cancel(): void {},
  });
}

function snapshotObserver(value: NetworkTextObserver): NetworkTextObserver {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Network text observer must be a plain object.");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Network text observer must be a plain object.");
  }
  if (
    value.onResponse !== undefined &&
    typeof value.onResponse !== "function"
  ) {
    throw new TypeError("Network text observer onResponse must be a function.");
  }
  if (value.onChunk !== undefined && typeof value.onChunk !== "function") {
    throw new TypeError("Network text observer onChunk must be a function.");
  }
  return Object.freeze({
    ...(value.onResponse === undefined ? {} : { onResponse: value.onResponse }),
    ...(value.onChunk === undefined ? {} : { onChunk: value.onChunk }),
  });
}

/**
 * Owns incremental native text requests and attributes response metadata,
 * every stream chunk, completion, and failure without recording payload data.
 */
export function createNetworkController(
  service: NetworkService,
): SolidNetworkController {
  if (
    typeof service !== "object" ||
    service === null ||
    typeof service.requestText !== "function"
  ) {
    throw new TypeError(
      "A Solid network controller requires a NetworkService.",
    );
  }
  if (getOwner() === null) {
    throw new Error("createNetworkController requires an active Solid owner.");
  }
  let active = true;
  const pending = new Set<PendingRequest>();
  const deliverResponse = createCausalPlatformEventHandler(
    "platform.network.response",
    deliver<NetworkResponse>,
    { priority: "default" },
  );
  const deliverChunk = createCausalPlatformEventHandler(
    "platform.network.chunk",
    deliver<NetworkTextChunk>,
    { priority: "default" },
  );
  const settleComplete = createCausalPlatformEventHandler(
    "platform.network.complete",
    settleResolved,
    { priority: "default" },
  );
  const settleError = createCausalPlatformEventHandler(
    "platform.network.error",
    settleRejected,
    { priority: "default" },
  );

  onCleanup(() => {
    if (!active) return;
    active = false;
    const error = new NetworkOwnerDisposedError();
    for (const request of pending) {
      try {
        request.cancel();
      } catch {
        // Owner disposal remains the observable settlement.
      }
      request.reject(error);
    }
    pending.clear();
  });

  return Object.freeze({
    requestText(
      request: NetworkTextRequest,
      observer: NetworkTextObserver = {},
    ): NetworkTextRequestHandle {
      if (!active) return rejectedHandle(new NetworkOwnerDisposedError());
      let callbacks: NetworkTextObserver;
      try {
        callbacks = snapshotObserver(observer);
      } catch (error) {
        return rejectedHandle(error);
      }
      let serviceHandle: NetworkTextRequestHandle;
      try {
        serviceHandle = service.requestText(request, {
          onResponse(response) {
            if (!active) return;
            deliverResponse({
              ...(callbacks.onResponse === undefined
                ? {}
                : { callback: callbacks.onResponse }),
              value: response,
            });
          },
          onChunk(chunk) {
            if (!active) return;
            deliverChunk({
              ...(callbacks.onChunk === undefined
                ? {}
                : { callback: callbacks.onChunk }),
              value: chunk,
            });
          },
        });
      } catch (error) {
        return rejectedHandle(error);
      }
      if (
        typeof serviceHandle !== "object" ||
        serviceHandle === null ||
        typeof serviceHandle.result?.then !== "function" ||
        typeof serviceHandle.cancel !== "function"
      ) {
        try {
          serviceHandle?.cancel?.();
        } catch {
          // The invalid handle is the observable contract failure.
        }
        return rejectedHandle(
          new TypeError("NetworkService returned an invalid request handle."),
        );
      }
      let settlement!: PendingRequest;
      const result = new Promise<NetworkTextResult>((resolve, reject) => {
        settlement = {
          cancel: () => serviceHandle.cancel(),
          reject,
          resolve,
        };
        pending.add(settlement);
        void Promise.resolve(serviceHandle.result).then(
          (value) => {
            if (!pending.delete(settlement)) return;
            settleComplete(settlement, value);
          },
          (error: unknown) => {
            if (!pending.delete(settlement)) return;
            settleError(settlement, error);
          },
        );
      });
      return Object.freeze({
        result,
        cancel(): void {
          if (!pending.has(settlement)) return;
          serviceHandle.cancel();
        },
      });
    },
  });
}

export {
  NetworkRequestCancelledError,
  NetworkRequestTimedOutError,
  NetworkTransportError,
} from "./index.js";

export type {
  NetworkCredentials,
  NetworkPlatform,
  NetworkResponse,
  NetworkService,
  NetworkTextChunk,
  NetworkTextObserver,
  NetworkTextRequest,
  NetworkTextRequestHandle,
  NetworkTextResult,
} from "./index.js";
