import {
  createEffect,
  createSignal,
  getOwner,
  onCleanup,
  untrack,
  type Accessor,
} from "solid-js";

import {
  requestJSON,
  type NetworkJSONRequestOptions,
  type NetworkJSONRequestHandle,
  type NetworkJSONRequester,
  type NetworkJSONResult,
  type NetworkJSONValue,
} from "./json.js";
import type { NetworkResponse, NetworkTextRequest } from "./index.js";

export type SolidNetworkJSONResourceState =
  "unresolved" | "pending" | "ready" | "refreshing" | "errored";

export type SolidNetworkJSONResourceSource =
  NetworkTextRequest | false | null | undefined;

export interface SolidNetworkJSONResourceOptions<T> {
  readonly initialValue?: T;
  /** Synchronously validates or projects the parsed JSON value. */
  readonly decode?: (value: NetworkJSONValue, result: NetworkJSONResult) => T;
  readonly onError?: (error: unknown) => unknown;
  readonly request?: NetworkJSONRequestOptions;
}

/**
 * A Solid-style resource backed by the bounded native JSON transport.
 * Property reads are reactive, and the callable value retains the last good
 * document while a refresh is pending or has failed.
 */
export interface SolidNetworkJSONResource<T> {
  (): T | undefined;
  readonly state: SolidNetworkJSONResourceState;
  readonly loading: boolean;
  readonly error: unknown;
  readonly latest: T | undefined;
  readonly response: NetworkResponse | undefined;
  readonly result: NetworkJSONResult | undefined;
  refetch(): Promise<NetworkJSONResult | undefined>;
  cancel(): void;
}

const OPTION_KEYS = new Set(["initialValue", "decode", "onError", "request"]);

function record(
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

function snapshotOptions<T>(
  value: SolidNetworkJSONResourceOptions<T>,
): SolidNetworkJSONResourceOptions<T> {
  const source = record(value, "Solid network JSON resource options");
  for (const key of Object.keys(source)) {
    if (!OPTION_KEYS.has(key)) {
      throw new TypeError(
        `Solid network JSON resource options contain unknown field ${JSON.stringify(key)}.`,
      );
    }
  }
  if (source.decode !== undefined && typeof source.decode !== "function") {
    throw new TypeError(
      "Solid network JSON resource decode must be a function.",
    );
  }
  if (source.onError !== undefined && typeof source.onError !== "function") {
    throw new TypeError(
      "Solid network JSON resource onError must be a function.",
    );
  }
  const requestOptions =
    source.request === undefined
      ? undefined
      : Object.freeze({
          ...record(
            source.request,
            "Solid network JSON resource request options",
          ),
        });
  return Object.freeze({
    ...(Object.hasOwn(source, "initialValue")
      ? { initialValue: source.initialValue as T }
      : {}),
    ...(source.decode === undefined
      ? {}
      : {
          decode: source.decode as (
            value: NetworkJSONValue,
            result: NetworkJSONResult,
          ) => T,
        }),
    ...(source.onError === undefined
      ? {}
      : { onError: source.onError as (error: unknown) => unknown }),
    ...(requestOptions === undefined
      ? {}
      : { request: requestOptions as NetworkJSONRequestOptions }),
  });
}

function validateRequester(value: NetworkJSONRequester): void {
  const requester = record(value, "Solid network JSON requester");
  if (typeof requester.requestText !== "function") {
    throw new TypeError(
      "Solid network JSON requester must provide requestText().",
    );
  }
}

function isThenable(value: unknown): boolean {
  return (
    value !== null &&
    value !== undefined &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as Readonly<{ then?: unknown }>).then === "function"
  );
}

function reportError<T>(
  error: unknown,
  options: SolidNetworkJSONResourceOptions<T>,
): void {
  try {
    const reported = options.onError?.(error);
    void Promise.resolve(reported).catch(() => undefined);
  } catch {
    // Diagnostics cannot break request settlement or owner cleanup.
  }
}

/**
 * Projects a static or reactive request into fine-grained Solid state. A
 * source change cancels the obsolete native request before starting its
 * replacement; owner disposal cancels the final request. Successful decode
 * and state publication run synchronously in the native completion cause.
 */
export function createJSONResource<T = NetworkJSONValue>(
  requester: NetworkJSONRequester,
  source:
    SolidNetworkJSONResourceSource | Accessor<SolidNetworkJSONResourceSource>,
  rawOptions: SolidNetworkJSONResourceOptions<T> = {},
): SolidNetworkJSONResource<T> {
  validateRequester(requester);
  if (getOwner() === null) {
    throw new Error("createJSONResource requires an active Solid owner.");
  }
  if (
    typeof source !== "function" &&
    source !== false &&
    source !== null &&
    source !== undefined
  ) {
    record(source, "Solid network JSON resource source");
  }
  const options = snapshotOptions(rawOptions);
  const hasInitialValue = Object.hasOwn(options, "initialValue");
  const [value, setValue] = createSignal<T | undefined>();
  if (hasInitialValue) setValue(() => options.initialValue);
  const [state, setState] = createSignal<SolidNetworkJSONResourceState>(
    hasInitialValue ? "ready" : "unresolved",
  );
  const [error, setError] = createSignal<unknown>();
  const [response, setResponse] = createSignal<NetworkResponse>();
  const [result, setResult] = createSignal<NetworkJSONResult>();
  let active = true;
  let generation = 0;
  let currentHandle: NetworkJSONRequestHandle | undefined;
  let latestRequest: NetworkTextRequest | undefined;

  const cancelCurrent = (): void => {
    const handle = currentHandle;
    currentHandle = undefined;
    if (handle === undefined) return;
    try {
      handle.cancel();
    } catch {
      // Cancellation is best effort; generation still suppresses stale work.
    }
  };

  const publishFailure = (
    failure: unknown,
    requestGeneration: number,
  ): void => {
    if (!active || requestGeneration !== generation) return;
    currentHandle = undefined;
    setError(() => failure);
    setState("errored");
    reportError(failure, options);
  };

  const start = (
    request: SolidNetworkJSONResourceSource,
  ): Promise<NetworkJSONResult | undefined> => {
    const requestGeneration = ++generation;
    let failurePublished = false;
    const fail = (failure: unknown): void => {
      if (failurePublished) return;
      failurePublished = true;
      publishFailure(failure, requestGeneration);
    };
    cancelCurrent();
    if (
      !active ||
      request === false ||
      request === null ||
      request === undefined
    ) {
      latestRequest = undefined;
      if (active) {
        setResponse(undefined);
        setError(undefined);
        setState("unresolved");
      }
      return Promise.resolve(undefined);
    }
    latestRequest = request;
    setResponse(undefined);
    setError(undefined);
    setState(untrack(value) === undefined ? "pending" : "refreshing");

    let handle;
    try {
      handle = requestJSON(
        requester,
        request,
        {
          onResponse(nextResponse) {
            if (!active || requestGeneration !== generation) return;
            setResponse(nextResponse);
          },
          onResult(nextResult) {
            if (!active || requestGeneration !== generation) return;
            try {
              const decoded =
                options.decode === undefined
                  ? (nextResult.value as T)
                  : options.decode(nextResult.value, nextResult);
              if (isThenable(decoded)) {
                throw new TypeError(
                  "Solid network JSON resource decode must complete synchronously.",
                );
              }
              setResult(nextResult);
              setValue(() => decoded);
              setError(undefined);
              setState("ready");
            } catch (failure) {
              fail(failure);
              throw failure;
            }
          },
        },
        options.request,
      );
    } catch (failure) {
      fail(failure);
      return Promise.reject(failure);
    }
    currentHandle = handle;
    return Promise.resolve(handle.result).then(
      (nextResult) => {
        if (active && requestGeneration === generation) {
          currentHandle = undefined;
        }
        return nextResult;
      },
      (failure: unknown) => {
        fail(failure);
        throw failure;
      },
    );
  };

  createEffect(
    () => (typeof source === "function" ? source() : source),
    (request) => {
      void start(request).catch(() => undefined);
    },
  );

  onCleanup(() => {
    if (!active) return;
    active = false;
    generation += 1;
    cancelCurrent();
  });

  const read = (() => value()) as SolidNetworkJSONResource<T>;
  Object.defineProperties(read, {
    state: { enumerable: true, get: state },
    loading: {
      enumerable: true,
      get: () => state() === "pending" || state() === "refreshing",
    },
    error: { enumerable: true, get: error },
    latest: { enumerable: true, get: value },
    response: { enumerable: true, get: response },
    result: { enumerable: true, get: result },
    refetch: {
      enumerable: true,
      value: (): Promise<NetworkJSONResult | undefined> => {
        if (!active) return Promise.resolve(undefined);
        return start(latestRequest);
      },
    },
    cancel: {
      enumerable: true,
      value: (): void => {
        if (!active) return;
        generation += 1;
        cancelCurrent();
        setError(undefined);
        setState(untrack(value) === undefined ? "unresolved" : "ready");
      },
    },
  });
  return Object.freeze(read);
}
