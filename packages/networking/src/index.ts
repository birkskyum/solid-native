export const NETWORK_MAX_URL_LENGTH = 8_192;
export const NETWORK_MAX_METHOD_LENGTH = 32;
export const NETWORK_MAX_HEADER_COUNT = 256;
export const NETWORK_MAX_HEADER_NAME_LENGTH = 256;
export const NETWORK_MAX_HEADER_VALUE_LENGTH = 16_384;
export const NETWORK_MAX_HEADER_CHARACTERS = 131_072;
export const NETWORK_MAX_REQUEST_BODY_CHARACTERS = 1_048_576;
export const NETWORK_MAX_CHUNK_CHARACTERS = 1_048_576;
export const NETWORK_DEFAULT_MAX_RESPONSE_CHARACTERS = 8_388_608;
export const NETWORK_MAX_RESPONSE_CHARACTERS = 67_108_864;
export const NETWORK_DEFAULT_TIMEOUT_MILLISECONDS = 30_000;
export const NETWORK_MAX_TIMEOUT_MILLISECONDS = 300_000;
export const NETWORK_MAX_NATIVE_ERROR_LENGTH = 2_048;

export type NetworkPlatform = "android" | "ios";
export type NetworkCredentials = "include" | "omit";

export interface NetworkTextRequest {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly credentials?: NetworkCredentials;
  readonly timeoutMilliseconds?: number;
  readonly maxResponseCharacters?: number;
}

export interface NormalizedNetworkTextRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly withCredentials: boolean;
  readonly timeoutMilliseconds: number;
  readonly maxResponseCharacters: number;
}

export interface NetworkResponse {
  readonly status: number;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface NetworkTextChunk {
  readonly sequence: number;
  readonly text: string;
  readonly loaded: number;
  readonly total?: number;
}

export interface NetworkTextObserver {
  readonly onResponse?: (response: NetworkResponse) => unknown;
  readonly onChunk?: (chunk: NetworkTextChunk) => unknown;
}

export interface NetworkTextResult {
  readonly response: NetworkResponse;
  readonly chunkCount: number;
  readonly receivedCharacters: number;
}

export interface NetworkTextRequestHandle {
  readonly result: Promise<NetworkTextResult>;
  cancel(): void;
}

export type NetworkAdapterEvent =
  | Readonly<{
      kind: "response";
      status: unknown;
      headers: unknown;
      url: unknown;
    }>
  | Readonly<{
      kind: "chunk";
      text: unknown;
      loaded: unknown;
      total: unknown;
    }>
  | Readonly<{
      kind: "complete";
      error: unknown;
      timedOut: unknown;
    }>;

export interface NetworkAdapterRequestHandle {
  cancel(): void;
}

export interface NetworkAdapter {
  readonly platform: NetworkPlatform;
  startTextRequest(
    request: NormalizedNetworkTextRequest,
    listener: (event: NetworkAdapterEvent) => void,
  ): NetworkAdapterRequestHandle;
}

export interface NetworkService {
  readonly platform: NetworkPlatform;
  requestText(
    request: NetworkTextRequest,
    observer?: NetworkTextObserver,
  ): NetworkTextRequestHandle;
}

export class NetworkRequestCancelledError extends Error {
  constructor() {
    super("The native network request was cancelled.");
    this.name = "NetworkRequestCancelledError";
  }
}

export class NetworkRequestTimedOutError extends Error {
  constructor() {
    super("The native network request timed out.");
    this.name = "NetworkRequestTimedOutError";
  }
}

export class NetworkTransportError extends Error {
  constructor(reason: string) {
    super(`The native network request failed: ${reason}`);
    this.name = "NetworkTransportError";
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

function absoluteHTTPURL(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > NETWORK_MAX_URL_LENGTH ||
    /[\u0000-\u0020\u007f\\]/u.test(value)
  ) {
    throw new TypeError(
      `${path} must be a 1-${NETWORK_MAX_URL_LENGTH} character HTTP(S) URL without ASCII control characters.`,
    );
  }
  const match = /^https?:\/\/([^/?#]*)(?:[/?#]|$)/iu.exec(value);
  const authority = match?.[1];
  if (
    authority === undefined ||
    authority.length === 0 ||
    authority.includes("@")
  ) {
    throw new TypeError(`${path} must be an absolute HTTP(S) URL.`);
  }
  let hostname: string;
  let port: string | undefined;
  if (authority.startsWith("[")) {
    const close = authority.indexOf("]");
    if (close < 2) {
      throw new TypeError(`${path} contains an invalid IP-literal host.`);
    }
    hostname = authority.slice(1, close);
    const suffix = authority.slice(close + 1);
    if (suffix !== "") {
      if (!suffix.startsWith(":")) {
        throw new TypeError(`${path} contains an invalid authority.`);
      }
      port = suffix.slice(1);
    }
    if (!/^[0-9A-Fa-f:.]+$/u.test(hostname) || !hostname.includes(":")) {
      throw new TypeError(`${path} contains an invalid IP-literal host.`);
    }
  } else {
    const colon = authority.lastIndexOf(":");
    if (colon !== -1) {
      hostname = authority.slice(0, colon);
      port = authority.slice(colon + 1);
    } else {
      hostname = authority;
    }
    if (
      hostname.length === 0 ||
      hostname.length > 253 ||
      !hostname
        .split(".")
        .every(
          (label) =>
            label.length >= 1 &&
            label.length <= 63 &&
            /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u.test(label),
        )
    ) {
      throw new TypeError(`${path} contains an invalid ASCII host.`);
    }
  }
  if (
    port !== undefined &&
    (!/^\d{1,5}$/u.test(port) || Number(port) < 1 || Number(port) > 65_535)
  ) {
    throw new TypeError(`${path} contains an invalid TCP port.`);
  }
  return value;
}

function method(value: unknown): string {
  const candidate = value === undefined ? "GET" : value;
  if (
    typeof candidate !== "string" ||
    candidate.length === 0 ||
    candidate.length > NETWORK_MAX_METHOD_LENGTH ||
    !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u.test(candidate)
  ) {
    throw new TypeError(
      `Network method must be a 1-${NETWORK_MAX_METHOD_LENGTH} character HTTP token.`,
    );
  }
  return candidate.toUpperCase();
}

function headers(
  value: unknown,
  path: string,
): Readonly<Record<string, string>> {
  if (value === undefined || value === null) return Object.freeze({});
  const source = record(value, path);
  const entries = Object.entries(source);
  if (entries.length > NETWORK_MAX_HEADER_COUNT) {
    throw new RangeError(
      `${path} must contain at most ${NETWORK_MAX_HEADER_COUNT} entries.`,
    );
  }
  let totalCharacters = 0;
  const normalized: Record<string, string> = {};
  for (const [name, rawValue] of entries) {
    if (
      name.length === 0 ||
      name.length > NETWORK_MAX_HEADER_NAME_LENGTH ||
      !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u.test(name)
    ) {
      throw new TypeError(
        `${path} names must be 1-${NETWORK_MAX_HEADER_NAME_LENGTH} character HTTP tokens.`,
      );
    }
    if (
      typeof rawValue !== "string" ||
      rawValue.length > NETWORK_MAX_HEADER_VALUE_LENGTH ||
      /[\u0000\r\n]/u.test(rawValue)
    ) {
      throw new TypeError(
        `${path}.${name} must be a string of at most ${NETWORK_MAX_HEADER_VALUE_LENGTH} characters without null bytes or line breaks.`,
      );
    }
    totalCharacters += name.length + rawValue.length;
    Object.defineProperty(normalized, name, {
      configurable: false,
      enumerable: true,
      value: rawValue,
      writable: false,
    });
  }
  if (totalCharacters > NETWORK_MAX_HEADER_CHARACTERS) {
    throw new RangeError(
      `${path} must contain at most ${NETWORK_MAX_HEADER_CHARACTERS} total characters.`,
    );
  }
  return Object.freeze(normalized);
}

function boundedInteger(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new TypeError(
      `${path} must be an integer from ${minimum} through ${maximum}.`,
    );
  }
  return value;
}

function normalizeRequest(
  value: NetworkTextRequest,
): NormalizedNetworkTextRequest {
  const source = record(value, "Network text request");
  const requestMethod = method(source.method);
  const body = source.body;
  if (
    body !== undefined &&
    (typeof body !== "string" ||
      body.length > NETWORK_MAX_REQUEST_BODY_CHARACTERS)
  ) {
    throw new TypeError(
      `Network request body must be a string of at most ${NETWORK_MAX_REQUEST_BODY_CHARACTERS} characters.`,
    );
  }
  if (
    body !== undefined &&
    (requestMethod === "GET" || requestMethod === "HEAD")
  ) {
    throw new TypeError(
      `${requestMethod} network requests cannot contain a body.`,
    );
  }
  if (
    source.credentials !== undefined &&
    source.credentials !== "include" &&
    source.credentials !== "omit"
  ) {
    throw new TypeError("Network credentials must be include or omit.");
  }
  const timeoutMilliseconds =
    source.timeoutMilliseconds === undefined
      ? NETWORK_DEFAULT_TIMEOUT_MILLISECONDS
      : boundedInteger(
          source.timeoutMilliseconds,
          "Network timeoutMilliseconds",
          1,
          NETWORK_MAX_TIMEOUT_MILLISECONDS,
        );
  const maxResponseCharacters =
    source.maxResponseCharacters === undefined
      ? NETWORK_DEFAULT_MAX_RESPONSE_CHARACTERS
      : boundedInteger(
          source.maxResponseCharacters,
          "Network maxResponseCharacters",
          1,
          NETWORK_MAX_RESPONSE_CHARACTERS,
        );
  return Object.freeze({
    url: absoluteHTTPURL(source.url, "Network request URL"),
    method: requestMethod,
    headers: headers(source.headers, "Network request headers"),
    ...(body === undefined ? {} : { body }),
    withCredentials: source.credentials !== "omit",
    timeoutMilliseconds,
    maxResponseCharacters,
  });
}

function normalizeObserver(
  value: NetworkTextObserver | undefined,
): NetworkTextObserver {
  if (value === undefined) return Object.freeze({});
  const source = record(value, "Network text observer");
  if (
    source.onResponse !== undefined &&
    typeof source.onResponse !== "function"
  ) {
    throw new TypeError("Network text observer onResponse must be a function.");
  }
  if (source.onChunk !== undefined && typeof source.onChunk !== "function") {
    throw new TypeError("Network text observer onChunk must be a function.");
  }
  return Object.freeze({
    ...(source.onResponse === undefined
      ? {}
      : {
          onResponse: source.onResponse as (
            response: NetworkResponse,
          ) => unknown,
        }),
    ...(source.onChunk === undefined
      ? {}
      : { onChunk: source.onChunk as (chunk: NetworkTextChunk) => unknown }),
  });
}

function deliverObserver<T>(
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
      "Network text observer callbacks must complete synchronously.",
    );
  }
}

function validateAdapter(value: NetworkAdapter): NetworkAdapter {
  const candidate = record(value, "Network adapter");
  if (candidate.platform !== "android" && candidate.platform !== "ios") {
    throw new TypeError("Network adapter platform must be android or ios.");
  }
  if (typeof candidate.startTextRequest !== "function") {
    throw new TypeError("Network adapter must provide startTextRequest().");
  }
  return value;
}

function response(
  event: Extract<NetworkAdapterEvent, { readonly kind: "response" }>,
  requestURL: string,
): NetworkResponse {
  const status = boundedInteger(
    event.status,
    "Native network status",
    100,
    599,
  );
  const responseURL =
    event.url === null || event.url === undefined
      ? requestURL
      : absoluteHTTPURL(event.url, "Native network response URL");
  return Object.freeze({
    status,
    url: responseURL,
    headers: headers(event.headers, "Native network response headers"),
  });
}

function chunk(
  event: Extract<NetworkAdapterEvent, { readonly kind: "chunk" }>,
  sequence: number,
  previousLoaded: number,
): NetworkTextChunk {
  if (
    typeof event.text !== "string" ||
    event.text.length > NETWORK_MAX_CHUNK_CHARACTERS
  ) {
    throw new TypeError(
      `Native network chunks must contain at most ${NETWORK_MAX_CHUNK_CHARACTERS} text characters.`,
    );
  }
  const loaded = boundedInteger(
    event.loaded,
    "Native network chunk loaded bytes",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  if (loaded < previousLoaded) {
    throw new TypeError("Native network chunk progress must be monotonic.");
  }
  let total: number | undefined;
  if (event.total !== -1 && event.total !== null && event.total !== undefined) {
    total = boundedInteger(
      event.total,
      "Native network chunk total bytes",
      loaded,
      Number.MAX_SAFE_INTEGER,
    );
  }
  return Object.freeze({
    sequence,
    text: event.text,
    loaded,
    ...(total === undefined ? {} : { total }),
  });
}

function nativeCompletionError(
  event: Extract<NetworkAdapterEvent, { readonly kind: "complete" }>,
): Error | undefined {
  if (typeof event.timedOut !== "boolean") {
    throw new TypeError(
      "Native network completion timedOut must be a boolean.",
    );
  }
  if (event.timedOut) return new NetworkRequestTimedOutError();
  if (event.error === null || event.error === undefined || event.error === "") {
    return undefined;
  }
  if (
    typeof event.error !== "string" ||
    event.error.length > NETWORK_MAX_NATIVE_ERROR_LENGTH ||
    /[\u0000]/u.test(event.error)
  ) {
    throw new TypeError("Native network completion returned an invalid error.");
  }
  return new NetworkTransportError(event.error);
}

/** Validates requests plus every metadata, chunk, and completion settlement. */
export function createNetworkService(
  adapterValue: NetworkAdapter,
): NetworkService {
  const adapter = validateAdapter(adapterValue);
  return Object.freeze({
    platform: adapter.platform,
    requestText(
      rawRequest: NetworkTextRequest,
      rawObserver?: NetworkTextObserver,
    ): NetworkTextRequestHandle {
      const request = normalizeRequest(rawRequest);
      const observer = normalizeObserver(rawObserver);
      let active = true;
      let nativeHandle: NetworkAdapterRequestHandle | undefined;
      let responseMetadata: NetworkResponse | undefined;
      let chunkCount = 0;
      let receivedCharacters = 0;
      let previousLoaded = 0;
      let resolveResult!: (result: NetworkTextResult) => void;
      let rejectResult!: (error: unknown) => void;
      const result = new Promise<NetworkTextResult>((resolve, reject) => {
        resolveResult = resolve;
        rejectResult = reject;
      });
      const cancelNative = (): void => {
        try {
          nativeHandle?.cancel();
        } catch {
          // The public settlement remains the first validated failure.
        }
      };
      const fail = (error: unknown, abortNative = true): void => {
        if (!active) return;
        active = false;
        if (abortNative) cancelNative();
        rejectResult(error);
      };
      const listener = (event: NetworkAdapterEvent): void => {
        if (!active) return;
        try {
          const candidate = record(event, "Native network event");
          if (candidate.kind === "response") {
            if (responseMetadata !== undefined) {
              throw new TypeError(
                "Native network request delivered duplicate response metadata.",
              );
            }
            responseMetadata = response(
              event as Extract<
                NetworkAdapterEvent,
                { readonly kind: "response" }
              >,
              request.url,
            );
            deliverObserver(observer.onResponse, responseMetadata);
            return;
          }
          if (candidate.kind === "chunk") {
            if (responseMetadata === undefined) {
              throw new TypeError(
                "Native network request delivered text before response metadata.",
              );
            }
            const nextChunk = chunk(
              event as Extract<NetworkAdapterEvent, { readonly kind: "chunk" }>,
              chunkCount + 1,
              previousLoaded,
            );
            const nextCharacters = receivedCharacters + nextChunk.text.length;
            if (nextCharacters > request.maxResponseCharacters) {
              throw new RangeError(
                `Native network response exceeded ${request.maxResponseCharacters} characters.`,
              );
            }
            chunkCount += 1;
            receivedCharacters = nextCharacters;
            previousLoaded = nextChunk.loaded;
            deliverObserver(observer.onChunk, nextChunk);
            return;
          }
          if (candidate.kind === "complete") {
            const error = nativeCompletionError(
              event as Extract<
                NetworkAdapterEvent,
                { readonly kind: "complete" }
              >,
            );
            if (error !== undefined) {
              fail(error, false);
              return;
            }
            if (responseMetadata === undefined) {
              throw new TypeError(
                "Native network request completed without response metadata.",
              );
            }
            active = false;
            resolveResult(
              Object.freeze({
                response: responseMetadata,
                chunkCount,
                receivedCharacters,
              }),
            );
            return;
          }
          throw new TypeError("Native network event has an unsupported kind.");
        } catch (error) {
          fail(error);
        }
      };
      void Promise.resolve().then(() => {
        if (!active) return;
        try {
          const handle = adapter.startTextRequest(request, listener);
          const candidate = record(handle, "Network adapter request handle");
          if (typeof candidate.cancel !== "function") {
            throw new TypeError(
              "Network adapter request handle must provide cancel().",
            );
          }
          nativeHandle = handle;
          if (!active) cancelNative();
        } catch (error) {
          fail(error, false);
        }
      });
      return Object.freeze({
        result,
        cancel(): void {
          fail(new NetworkRequestCancelledError());
        },
      });
    },
  });
}
