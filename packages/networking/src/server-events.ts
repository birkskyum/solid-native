import {
  type NetworkResponse,
  type NetworkTextObserver,
  type NetworkTextRequest,
  type NetworkTextRequestHandle,
  type NetworkTextResult,
} from "./index.js";

export const SERVER_EVENT_DEFAULT_MAX_LINE_CHARACTERS = 65_536;
export const SERVER_EVENT_MAX_LINE_CHARACTERS = 1_048_576;
export const SERVER_EVENT_DEFAULT_MAX_DATA_CHARACTERS = 1_048_576;
export const SERVER_EVENT_MAX_DATA_CHARACTERS = 8_388_608;
export const SERVER_EVENT_DEFAULT_MAX_LINES = 4_096;
export const SERVER_EVENT_MAX_LINES = 65_536;
export const SERVER_EVENT_DEFAULT_MAX_EVENTS = 10_000;
export const SERVER_EVENT_MAX_EVENTS = 100_000;
export const SERVER_EVENT_MAX_RETRY_MILLISECONDS = 300_000;

export interface ServerEventDecoderOptions {
  readonly maxLineCharacters?: number;
  readonly maxDataCharacters?: number;
  readonly maxLines?: number;
  readonly maxEvents?: number;
}

export interface ServerEvent {
  readonly sequence: number;
  readonly type: string;
  readonly data: string;
  readonly lastEventId: string;
  readonly retryMilliseconds?: number;
}

export interface ServerEventDecoder {
  readonly eventCount: number;
  readonly lastEventId: string;
  readonly retryMilliseconds: number | undefined;
  push(chunk: string): readonly ServerEvent[];
  finish(): readonly ServerEvent[];
}

export interface ServerEventObserver {
  readonly onResponse?: (response: NetworkResponse) => unknown;
  readonly onEvent?: (event: ServerEvent) => unknown;
  readonly onResult?: (result: ServerEventResult) => unknown;
}

export interface ServerEventRequestOptions extends ServerEventDecoderOptions {
  readonly requireEventStreamContentType?: boolean;
}

export interface ServerEventResult extends NetworkTextResult {
  readonly eventCount: number;
  readonly lastEventId: string;
  readonly retryMilliseconds?: number;
}

export interface ServerEventRequestHandle {
  readonly result: Promise<ServerEventResult>;
  cancel(): void;
}

export interface NetworkTextRequester {
  requestText(
    request: NetworkTextRequest,
    observer?: NetworkTextObserver,
  ): NetworkTextRequestHandle;
}

export class ServerEventProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServerEventProtocolError";
  }
}

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

function boundedInteger(
  value: unknown,
  path: string,
  defaultValue: number,
  maximum: number,
): number {
  const candidate = value === undefined ? defaultValue : value;
  if (
    typeof candidate !== "number" ||
    !Number.isSafeInteger(candidate) ||
    candidate < 1 ||
    candidate > maximum
  ) {
    throw new TypeError(
      `${path} must be an integer from 1 through ${maximum}.`,
    );
  }
  return candidate;
}

function decoderOptions(value: ServerEventDecoderOptions): Readonly<{
  maxLineCharacters: number;
  maxDataCharacters: number;
  maxLines: number;
  maxEvents: number;
}> {
  const source = record(value, "Server-event decoder options");
  return Object.freeze({
    maxLineCharacters: boundedInteger(
      source.maxLineCharacters,
      "Server-event maxLineCharacters",
      SERVER_EVENT_DEFAULT_MAX_LINE_CHARACTERS,
      SERVER_EVENT_MAX_LINE_CHARACTERS,
    ),
    maxDataCharacters: boundedInteger(
      source.maxDataCharacters,
      "Server-event maxDataCharacters",
      SERVER_EVENT_DEFAULT_MAX_DATA_CHARACTERS,
      SERVER_EVENT_MAX_DATA_CHARACTERS,
    ),
    maxLines: boundedInteger(
      source.maxLines,
      "Server-event maxLines",
      SERVER_EVENT_DEFAULT_MAX_LINES,
      SERVER_EVENT_MAX_LINES,
    ),
    maxEvents: boundedInteger(
      source.maxEvents,
      "Server-event maxEvents",
      SERVER_EVENT_DEFAULT_MAX_EVENTS,
      SERVER_EVENT_MAX_EVENTS,
    ),
  });
}

/** Parses bounded SSE line and field grammar and flushes pending data at EOF. */
export function createServerEventDecoder(
  rawOptions: ServerEventDecoderOptions = {},
): ServerEventDecoder {
  const options = decoderOptions(rawOptions);
  let active = true;
  let atStart = true;
  let pendingCarriageReturn = false;
  let line = "";
  let dataLines: string[] = [];
  let dataCharacters = 0;
  let eventType = "";
  let eventCount = 0;
  let lastEventId = "";
  let retryMilliseconds: number | undefined;

  const resetEvent = (): void => {
    dataLines = [];
    dataCharacters = 0;
    eventType = "";
  };
  const dispatch = (events: ServerEvent[]): void => {
    if (dataLines.length === 0) {
      resetEvent();
      return;
    }
    if (eventCount >= options.maxEvents) {
      throw new RangeError(
        `Server-event stream exceeded ${options.maxEvents} events.`,
      );
    }
    eventCount += 1;
    events.push(
      Object.freeze({
        sequence: eventCount,
        type: eventType === "" ? "message" : eventType,
        data: dataLines.join("\n"),
        lastEventId,
        ...(retryMilliseconds === undefined ? {} : { retryMilliseconds }),
      }),
    );
    resetEvent();
  };
  const processLine = (events: ServerEvent[]): void => {
    const current = line;
    line = "";
    if (current === "") {
      dispatch(events);
      return;
    }
    if (current.startsWith(":")) return;
    const colon = current.indexOf(":");
    const field = colon === -1 ? current : current.slice(0, colon);
    let value = colon === -1 ? "" : current.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") {
      eventType = value;
      return;
    }
    if (field === "data") {
      if (dataLines.length >= options.maxLines) {
        throw new RangeError(
          `One server event exceeded ${options.maxLines} data lines.`,
        );
      }
      const nextCharacters =
        dataCharacters + value.length + (dataLines.length === 0 ? 0 : 1);
      if (nextCharacters > options.maxDataCharacters) {
        throw new RangeError(
          `One server event exceeded ${options.maxDataCharacters} data characters.`,
        );
      }
      dataLines.push(value);
      dataCharacters = nextCharacters;
      return;
    }
    if (field === "id") {
      if (!value.includes("\u0000")) lastEventId = value;
      return;
    }
    if (field === "retry" && /^\d+$/u.test(value)) {
      const retry = Number(value);
      if (
        Number.isSafeInteger(retry) &&
        retry <= SERVER_EVENT_MAX_RETRY_MILLISECONDS
      ) {
        retryMilliseconds = retry;
      }
    }
  };
  const push = (chunk: string): readonly ServerEvent[] => {
    if (!active) {
      throw new Error("The server-event decoder is already finished.");
    }
    if (typeof chunk !== "string") {
      throw new TypeError("Server-event decoder chunks must be strings.");
    }
    const events: ServerEvent[] = [];
    for (let index = 0; index < chunk.length; index += 1) {
      const character = chunk[index]!;
      if (atStart) {
        atStart = false;
        if (character === "\ufeff") continue;
      }
      if (pendingCarriageReturn) {
        pendingCarriageReturn = false;
        if (character === "\n") continue;
      }
      if (character === "\r") {
        processLine(events);
        pendingCarriageReturn = true;
        continue;
      }
      if (character === "\n") {
        processLine(events);
        continue;
      }
      if (line.length >= options.maxLineCharacters) {
        throw new RangeError(
          `Server-event line exceeded ${options.maxLineCharacters} characters.`,
        );
      }
      line += character;
    }
    return Object.freeze(events);
  };
  const finish = (): readonly ServerEvent[] => {
    if (!active) return Object.freeze([]);
    active = false;
    const events: ServerEvent[] = [];
    if (line !== "") processLine(events);
    dispatch(events);
    line = "";
    pendingCarriageReturn = false;
    return Object.freeze(events);
  };
  return Object.freeze({
    get eventCount() {
      return eventCount;
    },
    get lastEventId() {
      return lastEventId;
    },
    get retryMilliseconds() {
      return retryMilliseconds;
    },
    push,
    finish,
  });
}

function snapshotObserver(value: ServerEventObserver): ServerEventObserver {
  const source = record(value, "Server-event observer");
  if (
    source.onResponse !== undefined &&
    typeof source.onResponse !== "function"
  ) {
    throw new TypeError("Server-event observer onResponse must be a function.");
  }
  if (source.onEvent !== undefined && typeof source.onEvent !== "function") {
    throw new TypeError("Server-event observer onEvent must be a function.");
  }
  if (source.onResult !== undefined && typeof source.onResult !== "function") {
    throw new TypeError("Server-event observer onResult must be a function.");
  }
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
    ...(source.onResult === undefined
      ? {}
      : {
          onResult: source.onResult as (result: ServerEventResult) => unknown,
        }),
  });
}

function requestOptions(value: ServerEventRequestOptions): Readonly<{
  decoder: ServerEventDecoderOptions;
  requireEventStreamContentType: boolean;
}> {
  const source = record(value, "Server-event request options");
  if (
    source.requireEventStreamContentType !== undefined &&
    typeof source.requireEventStreamContentType !== "boolean"
  ) {
    throw new TypeError(
      "Server-event requireEventStreamContentType must be a boolean.",
    );
  }
  return Object.freeze({
    decoder: Object.freeze({
      ...(source.maxLineCharacters === undefined
        ? {}
        : { maxLineCharacters: source.maxLineCharacters as number }),
      ...(source.maxDataCharacters === undefined
        ? {}
        : { maxDataCharacters: source.maxDataCharacters as number }),
      ...(source.maxLines === undefined
        ? {}
        : { maxLines: source.maxLines as number }),
      ...(source.maxEvents === undefined
        ? {}
        : { maxEvents: source.maxEvents as number }),
    }),
    requireEventStreamContentType:
      source.requireEventStreamContentType !== false,
  });
}

function deliver<T>(
  callback: ((value: T) => unknown) | undefined,
  value: T,
): void {
  if (callback === undefined) return;
  const result = callback(value);
  if (
    result !== null &&
    (typeof result === "object" || typeof result === "function") &&
    typeof (result as Readonly<{ then?: unknown }>).then === "function"
  ) {
    void Promise.resolve(result).catch(() => undefined);
    throw new TypeError(
      "Server-event observer callbacks must complete synchronously.",
    );
  }
}

function contentType(response: NetworkResponse): string | undefined {
  for (const [name, value] of Object.entries(response.headers)) {
    if (name.toLowerCase() === "content-type") return value;
  }
  return undefined;
}

/**
 * Runs one bounded SSE response over either a raw service or Solid controller.
 * Reconnection and Last-Event-ID request policy remain explicit caller work.
 */
export function requestServerEvents(
  requesterValue: NetworkTextRequester,
  request: NetworkTextRequest,
  rawObserver: ServerEventObserver = {},
  rawOptions: ServerEventRequestOptions = {},
): ServerEventRequestHandle {
  const requester = record(requesterValue, "Server-event network requester");
  if (typeof requester.requestText !== "function") {
    throw new TypeError(
      "Server-event network requester must provide requestText().",
    );
  }
  const observer = snapshotObserver(rawObserver);
  const options = requestOptions(rawOptions);
  const decoder = createServerEventDecoder(options.decoder);
  let eventCount = 0;
  const emit = (events: readonly ServerEvent[]): void => {
    for (const event of events) {
      deliver(observer.onEvent, event);
      eventCount += 1;
    }
  };
  const base = requesterValue.requestText(request, {
    onResponse(response) {
      if (response.status !== 200) {
        throw new ServerEventProtocolError(
          `Server-event request requires HTTP 200, received ${response.status}.`,
        );
      }
      const mediaType = contentType(response)
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      if (
        options.requireEventStreamContentType &&
        mediaType !== "text/event-stream"
      ) {
        throw new ServerEventProtocolError(
          "Server-event response must use Content-Type text/event-stream.",
        );
      }
      deliver(observer.onResponse, response);
    },
    onChunk(chunk) {
      emit(decoder.push(chunk.text));
    },
  });
  if (
    base === null ||
    typeof base !== "object" ||
    typeof base.result?.then !== "function" ||
    typeof base.cancel !== "function"
  ) {
    try {
      base?.cancel?.();
    } catch {
      // The invalid requester handle remains the contract failure.
    }
    throw new TypeError(
      "Server-event network requester returned an invalid request handle.",
    );
  }
  const result = Promise.resolve(base.result).then((networkResult) => {
    emit(decoder.finish());
    const serverEventResult = Object.freeze({
      ...networkResult,
      eventCount,
      lastEventId: decoder.lastEventId,
      ...(decoder.retryMilliseconds === undefined
        ? {}
        : { retryMilliseconds: decoder.retryMilliseconds }),
    });
    deliver(observer.onResult, serverEventResult);
    return serverEventResult;
  });
  return Object.freeze({
    result,
    cancel(): void {
      base.cancel();
    },
  });
}
