import {
  createEffect,
  createSignal,
  getOwner,
  onCleanup,
  type Accessor,
} from "solid-js";

import type { NetworkResponse, NetworkTextRequest } from "./index.js";
import {
  requestServerEvents,
  type NetworkTextRequester,
  type ServerEvent,
  type ServerEventRequestHandle,
  type ServerEventRequestOptions,
  type ServerEventResult,
} from "./server-events.js";

export type SolidServerEventStreamState =
  "unresolved" | "connecting" | "open" | "closed" | "errored";

export type SolidServerEventStreamSource =
  NetworkTextRequest | false | null | undefined;

export interface SolidServerEventStreamOptions {
  /** Runs synchronously before the response is published by the stream. */
  readonly onResponse?: (response: NetworkResponse) => unknown;
  /** Runs synchronously before the event is published by the stream accessor. */
  readonly onEvent?: (event: ServerEvent) => unknown;
  readonly onError?: (error: unknown) => unknown;
  readonly request?: ServerEventRequestOptions;
}

/** A Solid-owned view of one explicitly managed SSE connection. */
export interface SolidServerEventStream {
  (): ServerEvent | undefined;
  readonly state: SolidServerEventStreamState;
  readonly active: boolean;
  readonly error: unknown;
  readonly latest: ServerEvent | undefined;
  readonly response: NetworkResponse | undefined;
  readonly result: ServerEventResult | undefined;
  readonly eventCount: number;
  readonly lastEventId: string;
  readonly retryMilliseconds: number | undefined;
  restart(request?: NetworkTextRequest): Promise<ServerEventResult | undefined>;
  cancel(): void;
}

const OPTION_KEYS = new Set(["onResponse", "onEvent", "onError", "request"]);

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

function snapshotOptions(
  value: SolidServerEventStreamOptions,
): SolidServerEventStreamOptions {
  const source = record(value, "Solid server-event stream options");
  for (const key of Object.keys(source)) {
    if (!OPTION_KEYS.has(key)) {
      throw new TypeError(
        `Solid server-event stream options contain unknown field ${JSON.stringify(key)}.`,
      );
    }
  }
  if (source.onEvent !== undefined && typeof source.onEvent !== "function") {
    throw new TypeError(
      "Solid server-event stream onEvent must be a function.",
    );
  }
  if (
    source.onResponse !== undefined &&
    typeof source.onResponse !== "function"
  ) {
    throw new TypeError(
      "Solid server-event stream onResponse must be a function.",
    );
  }
  if (source.onError !== undefined && typeof source.onError !== "function") {
    throw new TypeError(
      "Solid server-event stream onError must be a function.",
    );
  }
  const requestOptions =
    source.request === undefined
      ? undefined
      : Object.freeze({
          ...record(
            source.request,
            "Solid server-event stream request options",
          ),
        });
  return Object.freeze({
    ...(source.onResponse === undefined
      ? {}
      : {
          onResponse: source.onResponse as (
            response: NetworkResponse,
          ) => unknown,
        }),
    ...(source.onEvent === undefined
      ? {}
      : { onEvent: source.onEvent as (event: ServerEvent) => unknown }),
    ...(source.onError === undefined
      ? {}
      : { onError: source.onError as (error: unknown) => unknown }),
    ...(requestOptions === undefined
      ? {}
      : { request: requestOptions as ServerEventRequestOptions }),
  });
}

function validateRequester(value: NetworkTextRequester): void {
  const requester = record(value, "Solid server-event network requester");
  if (typeof requester.requestText !== "function") {
    throw new TypeError(
      "Solid server-event network requester must provide requestText().",
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

function deliver<T>(
  callback: ((value: T) => unknown) | undefined,
  value: T,
  name: "onResponse" | "onEvent",
): void {
  if (callback === undefined) return;
  const result = callback(value);
  if (isThenable(result)) {
    void Promise.resolve(result).catch(() => undefined);
    throw new TypeError(
      `Solid server-event stream ${name} must complete synchronously.`,
    );
  }
}

function reportError(
  error: unknown,
  options: SolidServerEventStreamOptions,
): void {
  try {
    const reported = options.onError?.(error);
    void Promise.resolve(reported).catch(() => undefined);
  } catch {
    // Diagnostics cannot break stream settlement or owner cleanup.
  }
}

/**
 * Projects a static or reactive SSE request into one fine-grained Solid stream.
 * Replacement and disposal cancel obsolete native work. It never sleeps,
 * reconnects automatically, or adds a Last-Event-ID header.
 */
export function createServerEventStream(
  requester: NetworkTextRequester,
  source: SolidServerEventStreamSource | Accessor<SolidServerEventStreamSource>,
  rawOptions: SolidServerEventStreamOptions = {},
): SolidServerEventStream {
  validateRequester(requester);
  if (getOwner() === null) {
    throw new Error("createServerEventStream requires an active Solid owner.");
  }
  if (
    typeof source !== "function" &&
    source !== false &&
    source !== null &&
    source !== undefined
  ) {
    record(source, "Solid server-event stream source");
  }
  const options = snapshotOptions(rawOptions);
  const [state, setState] =
    createSignal<SolidServerEventStreamState>("unresolved");
  const [error, setError] = createSignal<unknown>();
  const [event, setEvent] = createSignal<ServerEvent>();
  const [response, setResponse] = createSignal<NetworkResponse>();
  const [result, setResult] = createSignal<ServerEventResult>();
  const [eventCount, setEventCount] = createSignal(0);
  const [lastEventId, setLastEventId] = createSignal("");
  const [retryMilliseconds, setRetryMilliseconds] = createSignal<number>();
  let active = true;
  let generation = 0;
  let currentHandle: ServerEventRequestHandle | undefined;
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

  const resetConnection = (): void => {
    setError(undefined);
    setEvent(undefined);
    setResponse(undefined);
    setResult(undefined);
    setEventCount(0);
    setLastEventId("");
    setRetryMilliseconds(undefined);
  };

  const start = (
    request: SolidServerEventStreamSource,
  ): Promise<ServerEventResult | undefined> => {
    const requestGeneration = ++generation;
    let failurePublished = false;
    const fail = (failure: unknown): void => {
      if (failurePublished) return;
      failurePublished = true;
      publishFailure(failure, requestGeneration);
    };
    cancelCurrent();
    resetConnection();
    if (
      !active ||
      request === false ||
      request === null ||
      request === undefined
    ) {
      latestRequest = undefined;
      if (active) setState("unresolved");
      return Promise.resolve(undefined);
    }
    latestRequest = request;
    setState("connecting");

    let handle;
    try {
      handle = requestServerEvents(
        requester,
        request,
        {
          onResponse(nextResponse) {
            if (!active || requestGeneration !== generation) return;
            try {
              deliver(options.onResponse, nextResponse, "onResponse");
              setResponse(nextResponse);
              setState("open");
            } catch (failure) {
              fail(failure);
              throw failure;
            }
          },
          onEvent(nextEvent) {
            if (!active || requestGeneration !== generation) return;
            try {
              deliver(options.onEvent, nextEvent, "onEvent");
              setEvent(nextEvent);
              setEventCount(nextEvent.sequence);
              setLastEventId(nextEvent.lastEventId);
              setRetryMilliseconds(nextEvent.retryMilliseconds);
            } catch (failure) {
              fail(failure);
              throw failure;
            }
          },
          onResult(nextResult) {
            if (!active || requestGeneration !== generation) return;
            setResult(nextResult);
            setEventCount(nextResult.eventCount);
            setLastEventId(nextResult.lastEventId);
            setRetryMilliseconds(nextResult.retryMilliseconds);
            setError(undefined);
            setState("closed");
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

  const read = (() => event()) as SolidServerEventStream;
  Object.defineProperties(read, {
    state: { enumerable: true, get: state },
    active: {
      enumerable: true,
      get: () => state() === "connecting" || state() === "open",
    },
    error: { enumerable: true, get: error },
    latest: { enumerable: true, get: event },
    response: { enumerable: true, get: response },
    result: { enumerable: true, get: result },
    eventCount: { enumerable: true, get: eventCount },
    lastEventId: { enumerable: true, get: lastEventId },
    retryMilliseconds: { enumerable: true, get: retryMilliseconds },
    restart: {
      enumerable: true,
      value: (
        request?: NetworkTextRequest,
      ): Promise<ServerEventResult | undefined> => {
        if (!active) return Promise.resolve(undefined);
        if (request !== undefined) {
          record(request, "Solid server-event stream restart request");
        }
        return start(request === undefined ? latestRequest : request);
      },
    },
    cancel: {
      enumerable: true,
      value: (): void => {
        if (!active) return;
        generation += 1;
        cancelCurrent();
        setError(undefined);
        setState(latestRequest === undefined ? "unresolved" : "closed");
      },
    },
  });
  return Object.freeze(read);
}
