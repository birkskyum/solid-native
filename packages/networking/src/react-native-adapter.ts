import {
  type NetworkAdapter,
  type NetworkAdapterEvent,
  type NetworkAdapterRequestHandle,
  type NormalizedNetworkTextRequest,
} from "./index.js";

export interface NativeNetworkEventSubscription {
  remove(): void;
}

export interface NativeNetworkEventEmitter {
  addListener(
    eventName: string,
    listener: (payload: unknown) => void,
  ): NativeNetworkEventSubscription;
}

export interface AndroidNetworkingModule {
  sendRequest(
    method: string,
    url: string,
    requestId: number,
    headers: readonly (readonly [string, string])[],
    data: Readonly<Record<string, unknown>>,
    responseType: "text",
    useIncrementalUpdates: true,
    timeoutMilliseconds: number,
    withCredentials: boolean,
  ): void;
  abortRequest(requestId: number): void;
}

export interface IOSNetworkingModule {
  sendRequest(
    query: Readonly<{
      method: string;
      url: string;
      data: Readonly<Record<string, unknown>>;
      headers: Readonly<Record<string, string>>;
      responseType: "text";
      incrementalUpdates: true;
      timeout: number;
      withCredentials: boolean;
    }>,
    callback: (requestId: number) => void,
  ): void;
  abortRequest(requestId: number): void;
}

function record(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function requireFunctions(
  value: unknown,
  path: string,
  names: readonly string[],
): void {
  const candidate = record(value, path);
  for (const name of names) {
    if (typeof candidate[name] !== "function") {
      throw new TypeError(`${path} must provide ${name}().`);
    }
  }
}

function validateEmitter(value: NativeNetworkEventEmitter): void {
  requireFunctions(value, "Native network event emitter", ["addListener"]);
}

function iosRequestId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(
      "The iOS Networking request identifier must be a non-negative safe integer.",
    );
  }
  return value;
}

function requestBody(
  request: NormalizedNetworkTextRequest,
): Readonly<Record<string, unknown>> {
  return Object.freeze(
    request.body === undefined ? {} : { string: request.body },
  );
}

function attachRequestEvents(
  emitter: NativeNetworkEventEmitter,
  currentRequestId: () => number | undefined,
  listener: (event: NetworkAdapterEvent) => void,
): () => void {
  let active = true;
  const subscriptions: NativeNetworkEventSubscription[] = [];
  const matches = (
    payload: unknown,
    expectedLength: number,
  ): readonly unknown[] | undefined => {
    const id = currentRequestId();
    if (id === undefined || !Array.isArray(payload) || payload[0] !== id) {
      return undefined;
    }
    if (payload.length !== expectedLength) {
      return Object.freeze([id]);
    }
    return payload;
  };
  const remove = (): void => {
    if (!active) return;
    active = false;
    for (const subscription of subscriptions.splice(0)) {
      try {
        subscription.remove();
      } catch {
        // Every listener is attempted even when one native removal fails.
      }
    }
  };
  const subscribe = (
    eventName: string,
    callback: (payload: unknown) => void,
  ): void => {
    subscriptions.push(emitter.addListener(eventName, callback));
  };
  try {
    subscribe("didReceiveNetworkResponse", (payload) => {
      if (!active) return;
      const values = matches(payload, 4);
      if (values === undefined) return;
      listener(
        Object.freeze({
          kind: "response",
          status: values[1],
          headers: values[2],
          url: values[3],
        }),
      );
    });
    subscribe("didReceiveNetworkIncrementalData", (payload) => {
      if (!active) return;
      const values = matches(payload, 4);
      if (values === undefined) return;
      listener(
        Object.freeze({
          kind: "chunk",
          text: values[1],
          loaded: values[2],
          total: values[3],
        }),
      );
    });
    subscribe("didCompleteNetworkResponse", (payload) => {
      if (!active) return;
      const matched = matches(payload, 3);
      // RN 0.87 can omit the timeout slot for success and non-timeout
      // failures. Android's NetworkEventUtil does so by construction. The
      // bridgeless iOS event path can surface the false NSNumber slot as
      // null/undefined, while other native paths expose NSNumber booleans as
      // 0/1.
      // Keep those React Native representations at this boundary so the public
      // network service receives one strict, canonical boolean shape.
      const values =
        Array.isArray(payload) &&
        payload.length === 2 &&
        payload[0] === currentRequestId()
          ? Object.freeze([...payload, false])
          : matched;
      if (values === undefined) return;
      if (values.length !== 3) {
        remove();
        throw new TypeError(
          `Native network completion tuple must contain two or three elements; received ${String(Array.isArray(payload) ? payload.length : 0)}.`,
        );
      }
      const nativeTimedOut = values[2];
      let timedOut: boolean;
      if (typeof nativeTimedOut === "boolean") {
        timedOut = nativeTimedOut;
      } else if (
        nativeTimedOut === null ||
        nativeTimedOut === undefined ||
        nativeTimedOut === 0
      ) {
        timedOut = false;
      } else if (nativeTimedOut === 1) {
        timedOut = true;
      } else {
        remove();
        throw new TypeError(
          `Native network completion timeout flag has unsupported kind ${Array.isArray(nativeTimedOut) ? "array" : typeof nativeTimedOut}.`,
        );
      }
      try {
        listener(
          Object.freeze({
            kind: "complete",
            error: values[1],
            timedOut,
          }),
        );
      } finally {
        remove();
      }
    });
  } catch (error) {
    remove();
    throw error;
  }
  return remove;
}

function validateRequestHandle(
  value: NetworkAdapterRequestHandle,
): NetworkAdapterRequestHandle {
  requireFunctions(value, "Native network request handle", ["cancel"]);
  return value;
}

/** @internal Maps React Native 0.87's client-ID Android Networking ABI. */
export function createAndroidNetworkingAdapter(
  value: AndroidNetworkingModule,
  emitterValue: NativeNetworkEventEmitter,
): NetworkAdapter {
  requireFunctions(value, "Android Networking", [
    "sendRequest",
    "abortRequest",
  ]);
  validateEmitter(emitterValue);
  const module = value;
  const emitter = emitterValue;
  const activeRequestIds = new Set<number>();
  let nextRequestId = 1;
  const allocateRequestId = (): number => {
    for (let attempts = 0; attempts < 2_147_483_647; attempts += 1) {
      const candidate = nextRequestId;
      nextRequestId = candidate === 2_147_483_647 ? 1 : candidate + 1;
      if (!activeRequestIds.has(candidate)) {
        activeRequestIds.add(candidate);
        return candidate;
      }
    }
    throw new Error("No native network request identifiers are available.");
  };
  return Object.freeze({
    platform: "android" as const,
    startTextRequest(
      request: NormalizedNetworkTextRequest,
      listener: (event: NetworkAdapterEvent) => void,
    ): NetworkAdapterRequestHandle {
      const id = allocateRequestId();
      let active = true;
      const removeEvents = attachRequestEvents(
        emitter,
        () => id,
        (event) => {
          if (!active) return;
          if (event.kind === "complete") {
            active = false;
            activeRequestIds.delete(id);
          }
          listener(event);
        },
      );
      try {
        module.sendRequest(
          request.method,
          request.url,
          id,
          Object.freeze(Object.entries(request.headers)),
          requestBody(request),
          "text",
          true,
          request.timeoutMilliseconds,
          request.withCredentials,
        );
      } catch (error) {
        active = false;
        activeRequestIds.delete(id);
        removeEvents();
        throw error;
      }
      return validateRequestHandle(
        Object.freeze({
          cancel(): void {
            if (!active) return;
            active = false;
            activeRequestIds.delete(id);
            removeEvents();
            module.abortRequest(id);
          },
        }),
      );
    },
  });
}

/** @internal Maps React Native 0.87's callback-ID iOS Networking ABI. */
export function createIOSNetworkingAdapter(
  value: IOSNetworkingModule,
  emitterValue: NativeNetworkEventEmitter,
): NetworkAdapter {
  requireFunctions(value, "iOS Networking", ["sendRequest", "abortRequest"]);
  validateEmitter(emitterValue);
  const module = value;
  const emitter = emitterValue;
  return Object.freeze({
    platform: "ios" as const,
    startTextRequest(
      request: NormalizedNetworkTextRequest,
      listener: (event: NetworkAdapterEvent) => void,
    ): NetworkAdapterRequestHandle {
      let id: number | undefined;
      let active = true;
      const removeEvents = attachRequestEvents(
        emitter,
        () => id,
        (event) => {
          if (!active) return;
          if (event.kind === "complete") active = false;
          listener(event);
        },
      );
      try {
        module.sendRequest(
          Object.freeze({
            method: request.method,
            url: request.url,
            data: requestBody(request),
            headers: request.headers,
            responseType: "text" as const,
            incrementalUpdates: true as const,
            timeout: request.timeoutMilliseconds,
            withCredentials: request.withCredentials,
          }),
          (nativeRequestId) => {
            try {
              if (id !== undefined) {
                throw new TypeError(
                  "The iOS Networking module assigned duplicate request identifiers.",
                );
              }
              id = iosRequestId(nativeRequestId);
              if (!active) module.abortRequest(id);
            } catch {
              if (!active) return;
              active = false;
              removeEvents();
              listener(
                Object.freeze({
                  kind: "complete",
                  error:
                    "The iOS Networking module returned an invalid request identifier.",
                  timedOut: false,
                }),
              );
            }
          },
        );
      } catch (error) {
        active = false;
        removeEvents();
        throw error;
      }
      return validateRequestHandle(
        Object.freeze({
          cancel(): void {
            if (!active) return;
            active = false;
            removeEvents();
            if (id !== undefined) module.abortRequest(id);
          },
        }),
      );
    },
  });
}
