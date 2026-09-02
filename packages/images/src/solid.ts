import {
  createCausalPlatformEventHandler,
  retainCausalPlatformEvent,
  type NativeCausalEventRetention,
} from "@solid-native/core";
import { getOwner, onCleanup } from "solid-js";

import {
  ImagePrefetchCancelledError,
  type ImageCacheEntry,
  type ImageDimensions,
  type ImagePrefetchHandle,
  type ImageRequest,
  type ImageService,
} from "./index.js";

export class ImageOwnerDisposedError extends Error {
  constructor() {
    super("The Solid owner was disposed before its image operation settled.");
    this.name = "ImageOwnerDisposedError";
  }
}

export interface SolidImageController {
  getDimensions(request: string | ImageRequest): Promise<ImageDimensions>;
  prefetch(uri: string): Promise<void>;
  queryCache(uris: readonly string[]): Promise<readonly ImageCacheEntry[]>;
}

interface PendingOperation {
  readonly reject: (error: unknown) => void;
  readonly cancel?: () => void;
}

interface Settlement<T> extends PendingOperation {
  readonly resolve: (value: T) => void;
}

function settlePromiseInsideEvent<T>(settlement: Settlement<T>, value: T) {
  return retainCausalPlatformEvent(undefined, (event) => {
    settlement.resolve(value);
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

/** Owns image work and traces settlements without recording URIs or headers. */
export function createImageController(
  service: ImageService,
): SolidImageController {
  if (
    typeof service !== "object" ||
    service === null ||
    typeof service.getDimensions !== "function" ||
    typeof service.prefetch !== "function" ||
    typeof service.queryCache !== "function"
  ) {
    throw new TypeError("A Solid image controller requires an ImageService.");
  }
  if (getOwner() === null) {
    throw new Error("createImageController requires an active Solid owner.");
  }
  let active = true;
  const pending = new Set<PendingOperation>();
  const settleDimensions = createCausalPlatformEventHandler(
    "platform.image.dimensions",
    settlePromiseInsideEvent<ImageDimensions>,
    { priority: "default" },
  );
  const settlePrefetch = createCausalPlatformEventHandler(
    "platform.image.prefetch",
    settlePromiseInsideEvent<void>,
    { priority: "default" },
  );
  const settleCacheQuery = createCausalPlatformEventHandler(
    "platform.image.cache-query",
    settlePromiseInsideEvent<readonly ImageCacheEntry[]>,
    { priority: "default" },
  );

  const owned = <T>(
    operation: Promise<T>,
    settle: (settlement: Settlement<T>, value: T) => unknown,
    cancel?: () => void,
  ): Promise<T> => {
    if (!active) {
      cancel?.();
      return Promise.reject(new ImageOwnerDisposedError());
    }
    return new Promise<T>((resolve, reject) => {
      const settlement: Settlement<T> = {
        reject,
        resolve,
        ...(cancel === undefined ? {} : { cancel }),
      };
      pending.add(settlement);
      void Promise.resolve(operation).then(
        (value) => {
          if (!pending.delete(settlement)) return;
          settle(settlement, value);
        },
        (error: unknown) => {
          if (pending.delete(settlement)) reject(error);
        },
      );
    });
  };

  onCleanup(() => {
    if (!active) return;
    active = false;
    const error = new ImageOwnerDisposedError();
    for (const operation of pending) {
      try {
        operation.cancel?.();
      } catch {
        // Owner disposal remains the observable settlement for every operation.
      }
      operation.reject(error);
    }
    pending.clear();
  });

  return Object.freeze({
    getDimensions(request: string | ImageRequest): Promise<ImageDimensions> {
      if (!active) return Promise.reject(new ImageOwnerDisposedError());
      let operation: Promise<ImageDimensions>;
      try {
        operation = service.getDimensions(request);
      } catch (error) {
        return Promise.reject(error);
      }
      return owned(operation, settleDimensions);
    },
    prefetch(uri: string): Promise<void> {
      if (!active) return Promise.reject(new ImageOwnerDisposedError());
      let handle: ImagePrefetchHandle;
      try {
        handle = service.prefetch(uri);
      } catch (error) {
        return Promise.reject(error);
      }
      if (
        typeof handle !== "object" ||
        handle === null ||
        !(handle.result instanceof Promise) ||
        typeof handle.cancel !== "function"
      ) {
        return Promise.reject(
          new TypeError("ImageService returned an invalid prefetch handle."),
        );
      }
      return owned(handle.result, settlePrefetch, () => handle.cancel());
    },
    queryCache(uris: readonly string[]): Promise<readonly ImageCacheEntry[]> {
      if (!active) return Promise.reject(new ImageOwnerDisposedError());
      let operation: Promise<readonly ImageCacheEntry[]>;
      try {
        operation = service.queryCache(uris);
      } catch (error) {
        return Promise.reject(error);
      }
      return owned(operation, settleCacheQuery);
    },
  });
}

export { ImagePrefetchCancelledError };

export type {
  ImageCacheEntry,
  ImageCacheLocation,
  ImageDimensions,
  ImageRequest,
  ImageService,
} from "./index.js";
