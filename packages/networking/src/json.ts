import {
  NETWORK_MAX_RESPONSE_CHARACTERS,
  type NetworkResponse,
  type NetworkTextObserver,
  type NetworkTextRequest,
  type NetworkTextRequestHandle,
  type NetworkTextResult,
} from "./index.js";

export const NETWORK_JSON_DEFAULT_MAX_DOCUMENT_CHARACTERS = 1_048_576;
export const NETWORK_JSON_MAX_DOCUMENT_CHARACTERS = 8_388_608;
export const NETWORK_JSON_DEFAULT_MAX_DEPTH = 64;
export const NETWORK_JSON_MAX_DEPTH = 256;
export const NETWORK_JSON_DEFAULT_MAX_NODES = 100_000;
export const NETWORK_JSON_MAX_NODES = 1_000_000;
export const NETWORK_JSON_DEFAULT_MAX_CHUNKS = 4_096;
export const NETWORK_JSON_MAX_CHUNKS = 65_536;

export type NetworkJSONValue =
  | null
  | boolean
  | number
  | string
  | readonly NetworkJSONValue[]
  | Readonly<{ [key: string]: NetworkJSONValue }>;

export interface NetworkJSONRequestOptions {
  readonly requireJSONContentType?: boolean;
  readonly maxDocumentCharacters?: number;
  readonly maxDepth?: number;
  readonly maxNodes?: number;
  readonly maxChunks?: number;
}

export interface NetworkJSONObserver {
  readonly onResponse?: (response: NetworkResponse) => unknown;
  readonly onResult?: (result: NetworkJSONResult) => unknown;
}

export interface NetworkJSONResult extends NetworkTextResult {
  readonly value: NetworkJSONValue;
}

export interface NetworkJSONRequestHandle {
  readonly result: Promise<NetworkJSONResult>;
  cancel(): void;
}

export interface NetworkJSONRequester {
  requestText(
    request: NetworkTextRequest,
    observer?: NetworkTextObserver,
  ): NetworkTextRequestHandle;
}

export class NetworkJSONProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkJSONProtocolError";
  }
}

const OPTION_KEYS = new Set([
  "requireJSONContentType",
  "maxDocumentCharacters",
  "maxDepth",
  "maxNodes",
  "maxChunks",
]);

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

function requestOptions(value: NetworkJSONRequestOptions): Readonly<{
  requireJSONContentType: boolean;
  maxDocumentCharacters: number;
  maxDepth: number;
  maxNodes: number;
  maxChunks: number;
}> {
  const source = record(value, "Network JSON request options");
  for (const key of Object.keys(source)) {
    if (!OPTION_KEYS.has(key)) {
      throw new TypeError(
        `Network JSON request options contain unknown field ${JSON.stringify(key)}.`,
      );
    }
  }
  if (
    source.requireJSONContentType !== undefined &&
    typeof source.requireJSONContentType !== "boolean"
  ) {
    throw new TypeError(
      "Network JSON requireJSONContentType must be a boolean.",
    );
  }
  return Object.freeze({
    requireJSONContentType: source.requireJSONContentType !== false,
    maxDocumentCharacters: boundedInteger(
      source.maxDocumentCharacters,
      "Network JSON maxDocumentCharacters",
      NETWORK_JSON_DEFAULT_MAX_DOCUMENT_CHARACTERS,
      NETWORK_JSON_MAX_DOCUMENT_CHARACTERS,
    ),
    maxDepth: boundedInteger(
      source.maxDepth,
      "Network JSON maxDepth",
      NETWORK_JSON_DEFAULT_MAX_DEPTH,
      NETWORK_JSON_MAX_DEPTH,
    ),
    maxNodes: boundedInteger(
      source.maxNodes,
      "Network JSON maxNodes",
      NETWORK_JSON_DEFAULT_MAX_NODES,
      NETWORK_JSON_MAX_NODES,
    ),
    maxChunks: boundedInteger(
      source.maxChunks,
      "Network JSON maxChunks",
      NETWORK_JSON_DEFAULT_MAX_CHUNKS,
      NETWORK_JSON_MAX_CHUNKS,
    ),
  });
}

function snapshotObserver(value: NetworkJSONObserver): NetworkJSONObserver {
  const source = record(value, "Network JSON observer");
  if (
    source.onResponse !== undefined &&
    typeof source.onResponse !== "function"
  ) {
    throw new TypeError("Network JSON observer onResponse must be a function.");
  }
  if (source.onResult !== undefined && typeof source.onResult !== "function") {
    throw new TypeError("Network JSON observer onResult must be a function.");
  }
  return Object.freeze({
    ...(source.onResponse === undefined
      ? {}
      : {
          onResponse: source.onResponse as (
            response: NetworkResponse,
          ) => unknown,
        }),
    ...(source.onResult === undefined
      ? {}
      : {
          onResult: source.onResult as (result: NetworkJSONResult) => unknown,
        }),
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
      "Network JSON observer callbacks must complete synchronously.",
    );
  }
}

function contentType(response: NetworkResponse): string | undefined {
  for (const [name, value] of Object.entries(response.headers)) {
    if (name.toLowerCase() === "content-type") return value;
  }
  return undefined;
}

function isJSONContentType(value: string | undefined): boolean {
  if (value === undefined) return false;
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType === undefined) return false;
  const match = /^([^/]+)\/([^/]+)$/u.exec(mediaType);
  if (match?.[1] !== "application") return false;
  const subtype = match[2];
  if (subtype === undefined || !/^[!#$%&'*+\-.^_`|~0-9a-z]+$/u.test(subtype)) {
    return false;
  }
  return subtype === "json" || subtype.endsWith("+json");
}

function parseAndFreezeJSON(
  source: string,
  maxDepth: number,
  maxNodes: number,
): NetworkJSONValue {
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    throw new NetworkJSONProtocolError(
      "The native network response did not contain valid JSON.",
    );
  }

  const pending: Array<Readonly<{ value: unknown; depth: number }>> = [
    { value, depth: 0 },
  ];
  let nodeCount = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    nodeCount += 1;
    if (nodeCount > maxNodes) {
      throw new RangeError(
        `The native network JSON response exceeded ${maxNodes} values.`,
      );
    }
    if (current.depth > maxDepth) {
      throw new RangeError(
        `The native network JSON response exceeded depth ${maxDepth}.`,
      );
    }
    if (
      current.value === null ||
      typeof current.value === "boolean" ||
      typeof current.value === "number" ||
      typeof current.value === "string"
    ) {
      continue;
    }
    if (Array.isArray(current.value)) {
      Object.freeze(current.value);
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        pending.push({
          value: current.value[index],
          depth: current.depth + 1,
        });
      }
      continue;
    }
    if (typeof current.value === "object") {
      const candidate = current.value as Record<string, unknown>;
      const prototype = Object.getPrototypeOf(candidate);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new NetworkJSONProtocolError(
          "The native network JSON response contained an invalid object.",
        );
      }
      Object.freeze(candidate);
      const children = Object.values(candidate);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        pending.push({
          value: children[index],
          depth: current.depth + 1,
        });
      }
      continue;
    }
    throw new NetworkJSONProtocolError(
      "The native network JSON response contained an invalid value.",
    );
  }
  return value as NetworkJSONValue;
}

/**
 * Buffers and validates one bounded JSON document over a native text requester.
 * `onResult` runs during a Solid controller's completion event, preserving the
 * exact native cause for synchronous reactive writes.
 */
export function requestJSON(
  requesterValue: NetworkJSONRequester,
  request: NetworkTextRequest,
  rawObserver: NetworkJSONObserver = {},
  rawOptions: NetworkJSONRequestOptions = {},
): NetworkJSONRequestHandle {
  const requester = record(requesterValue, "Network JSON requester");
  if (typeof requester.requestText !== "function") {
    throw new TypeError("Network JSON requester must provide requestText().");
  }
  const observer = snapshotObserver(rawObserver);
  const options = requestOptions(rawOptions);
  const chunks: string[] = [];
  let documentCharacters = 0;
  const base = requesterValue.requestText(request, {
    onResponse(response) {
      if (
        options.requireJSONContentType &&
        !isJSONContentType(contentType(response))
      ) {
        throw new NetworkJSONProtocolError(
          "The native network response must use an application/json or application/*+json content type.",
        );
      }
      deliver(observer.onResponse, response);
    },
    onChunk(chunk) {
      if (chunks.length >= options.maxChunks) {
        throw new RangeError(
          `The native network JSON response exceeded ${options.maxChunks} chunks.`,
        );
      }
      documentCharacters += chunk.text.length;
      if (documentCharacters > options.maxDocumentCharacters) {
        throw new RangeError(
          `The native network JSON response exceeded ${options.maxDocumentCharacters} characters.`,
        );
      }
      chunks.push(chunk.text);
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
      "Network JSON requester returned an invalid request handle.",
    );
  }
  const result = Promise.resolve(base.result).then((baseResult) => {
    const parsed = Object.freeze({
      ...baseResult,
      value: parseAndFreezeJSON(
        chunks.join(""),
        options.maxDepth,
        options.maxNodes,
      ),
    });
    deliver(observer.onResult, parsed);
    return parsed;
  });
  return Object.freeze({
    result,
    cancel(): void {
      base.cancel();
    },
  });
}

// This assertion keeps the JSON layer's independent cap within the raw
// transport's accepted request range if either contract changes.
if (NETWORK_JSON_MAX_DOCUMENT_CHARACTERS > NETWORK_MAX_RESPONSE_CHARACTERS) {
  throw new Error(
    "The Network JSON document cap exceeds the native text transport cap.",
  );
}
