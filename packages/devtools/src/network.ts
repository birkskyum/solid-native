import type {
  NetworkPlatform,
  NetworkResponse,
  NetworkService,
  NetworkTextChunk,
  NetworkTextObserver,
  NetworkTextRequest,
  NetworkTextRequestHandle,
  NetworkTextResult,
} from "@solid-native/networking";

export const DEVELOPMENT_NETWORK_PROTOCOL_VERSION = 0 as const;
export const DEVELOPMENT_NETWORK_DEFAULT_HISTORY = 100;
export const DEVELOPMENT_NETWORK_MAX_HISTORY = 500;
export const DEVELOPMENT_NETWORK_MAX_TARGET_LENGTH = 2_048;
export const DEVELOPMENT_NETWORK_MAX_ERROR_NAME_LENGTH = 128;
const DEVELOPMENT_NETWORK_MAX_INPUT_URL_LENGTH = 8_192;

export type DevelopmentNetworkRequestState =
  "pending" | "completed" | "failed" | "cancelled";

export interface DevelopmentNetworkRequestSnapshot {
  readonly protocolVersion: typeof DEVELOPMENT_NETWORK_PROTOCOL_VERSION;
  /** Monotonic within one inspector lifetime. */
  readonly id: number;
  readonly platform: NetworkPlatform;
  readonly method: string;
  /** Origin and path only. Query strings, fragments, and credentials are never retained. */
  readonly requestTarget?: string;
  readonly responseTarget?: string;
  readonly state: DevelopmentNetworkRequestState;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly finishedAt?: number;
  readonly durationMilliseconds?: number;
  readonly responseStatus?: number;
  readonly chunkCount: number;
  readonly receivedCharacters: number;
  readonly loadedBytes: number;
  readonly totalBytes?: number;
  /** Low-cardinality class only; error messages and stacks are never retained. */
  readonly errorName?: string;
}

export interface DevelopmentNetworkInspectorOptions {
  readonly maxHistory?: number;
  /** Retain URL origins and paths. Defaults to false. */
  readonly captureRequestTargets?: boolean;
  /** Injectable wall clock for deterministic local tooling tests. */
  readonly clock?: () => number;
}

export interface DevelopmentNetworkInspectionSubscription {
  remove(): void;
}

export interface DevelopmentNetworkInspector {
  /** Returns a NetworkService that preserves request results plus local inspection. */
  instrument(service: NetworkService): NetworkService;
  history(): readonly DevelopmentNetworkRequestSnapshot[];
  activeCount(): number;
  /** Requests omitted because every bounded history slot was active. */
  droppedCount(): number;
  /** Clears retained state and detaches in-flight requests from this inspector. */
  clear(): void;
  subscribe(
    listener: (
      snapshot: DevelopmentNetworkRequestSnapshot | undefined,
    ) => unknown,
  ): DevelopmentNetworkInspectionSubscription;
}

interface TrackedRequest {
  snapshot: DevelopmentNetworkRequestSnapshot;
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

function safeProperty(value: unknown, property: string): unknown {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return undefined;
  }
  try {
    return Reflect.get(value, property);
  } catch {
    return undefined;
  }
}

function safeTimestamp(clock: () => number): number {
  try {
    const value = clock();
    if (Number.isSafeInteger(value) && value >= 0) return value;
  } catch {
    // Local inspection remains available when an injected clock fails.
  }
  const fallback = Date.now();
  return Number.isSafeInteger(fallback) && fallback >= 0 ? fallback : 0;
}

function boundedText(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  let prefix = value.slice(0, maximum - 1);
  const finalCodeUnit = prefix.charCodeAt(prefix.length - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) {
    prefix = prefix.slice(0, -1);
  }
  return `${prefix}\u2026`;
}

function requestMethod(request: NetworkTextRequest): string {
  const value = safeProperty(request, "method");
  if (value === undefined) return "GET";
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 32 ||
    !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u.test(value)
  ) {
    return "UNKNOWN";
  }
  return value.toUpperCase();
}

function requestTarget(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length > DEVELOPMENT_NETWORK_MAX_INPUT_URL_LENGTH ||
    /[\u0000-\u0020\u007f\\]/u.test(value)
  ) {
    return undefined;
  }
  const match = /^(https?):\/\/([^/?#]+)([^?#]*)/iu.exec(value);
  const protocol = match?.[1];
  const authority = match?.[2];
  const path = match?.[3];
  if (
    protocol === undefined ||
    authority === undefined ||
    path === undefined ||
    authority.includes("@")
  ) {
    return undefined;
  }
  return boundedText(
    `${protocol.toLowerCase()}://${authority}${path}`,
    DEVELOPMENT_NETWORK_MAX_TARGET_LENGTH,
  );
}

function errorName(error: unknown): string {
  const value = safeProperty(error, "name");
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > DEVELOPMENT_NETWORK_MAX_ERROR_NAME_LENGTH ||
    !/^[A-Za-z][A-Za-z0-9_.:-]*$/u.test(value)
  ) {
    return "Error";
  }
  return boundedText(value, DEVELOPMENT_NETWORK_MAX_ERROR_NAME_LENGTH);
}

function normalizeObserver(
  value: NetworkTextObserver | undefined,
): NetworkTextObserver {
  if (value === undefined) return Object.freeze({});
  const source = record(value, "Development network observer");
  if (
    source.onResponse !== undefined &&
    typeof source.onResponse !== "function"
  ) {
    throw new TypeError(
      "Development network observer onResponse must be a function.",
    );
  }
  if (source.onChunk !== undefined && typeof source.onChunk !== "function") {
    throw new TypeError(
      "Development network observer onChunk must be a function.",
    );
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

function requireService(value: NetworkService): NetworkService {
  if (value === null || typeof value !== "object") {
    throw new TypeError(
      "A development network inspector requires a NetworkService.",
    );
  }
  if (value.platform !== "android" && value.platform !== "ios") {
    throw new TypeError(
      "Inspected NetworkService platform must be android or ios.",
    );
  }
  if (typeof value.requestText !== "function") {
    throw new TypeError("Inspected NetworkService must provide requestText().");
  }
  return value;
}

function requireHandle(
  value: NetworkTextRequestHandle,
): NetworkTextRequestHandle {
  if (
    value === null ||
    typeof value !== "object" ||
    typeof safeProperty(value, "cancel") !== "function" ||
    typeof safeProperty(safeProperty(value, "result"), "then") !== "function"
  ) {
    throw new TypeError(
      "Inspected NetworkService returned an invalid request handle.",
    );
  }
  return value;
}

function cancelInvalidHandle(value: unknown): void {
  const cancel = safeProperty(value, "cancel");
  if (typeof cancel !== "function") return;
  try {
    Reflect.apply(cancel, value, []);
  } catch {
    // The invalid handle remains the reported contract failure.
  }
}

function notifyListeners(
  listeners: ReadonlySet<
    (snapshot: DevelopmentNetworkRequestSnapshot | undefined) => unknown
  >,
  snapshot: DevelopmentNetworkRequestSnapshot | undefined,
): void {
  for (const listener of [...listeners]) {
    try {
      const result = listener(snapshot);
      void Promise.resolve(result).catch(() => undefined);
    } catch {
      // Local inspection cannot change network request behavior.
    }
  }
}

/**
 * Instruments Solid Native's explicit NetworkService seam. The inspector is
 * bounded, process-local, performs no I/O, and never retains headers, bodies,
 * response text, query strings, fragments, error messages, or stacks.
 */
export function createDevelopmentNetworkInspector(
  options: DevelopmentNetworkInspectorOptions = {},
): DevelopmentNetworkInspector {
  if (options === null || typeof options !== "object") {
    throw new TypeError(
      "Development network inspector options must be an object.",
    );
  }
  const maxHistory = options.maxHistory ?? DEVELOPMENT_NETWORK_DEFAULT_HISTORY;
  if (
    !Number.isSafeInteger(maxHistory) ||
    maxHistory < 1 ||
    maxHistory > DEVELOPMENT_NETWORK_MAX_HISTORY
  ) {
    throw new TypeError(
      `Development network maxHistory must be a safe integer from 1 through ${String(DEVELOPMENT_NETWORK_MAX_HISTORY)}.`,
    );
  }
  if (
    options.captureRequestTargets !== undefined &&
    typeof options.captureRequestTargets !== "boolean"
  ) {
    throw new TypeError("captureRequestTargets must be a boolean.");
  }
  if (options.clock !== undefined && typeof options.clock !== "function") {
    throw new TypeError("Development network clock must be a function.");
  }

  const clock = options.clock ?? Date.now;
  const listeners = new Set<
    (snapshot: DevelopmentNetworkRequestSnapshot | undefined) => unknown
  >();
  let retained: TrackedRequest[] = [];
  const active = new Map<number, TrackedRequest>();
  let nextId = 1;
  let dropped = 0;

  const publish = (tracked: TrackedRequest): void => {
    if (active.get(tracked.snapshot.id) !== tracked) return;
    notifyListeners(listeners, tracked.snapshot);
  };

  const update = (
    tracked: TrackedRequest,
    values: Partial<DevelopmentNetworkRequestSnapshot>,
  ): void => {
    if (active.get(tracked.snapshot.id) !== tracked) return;
    tracked.snapshot = Object.freeze({ ...tracked.snapshot, ...values });
    publish(tracked);
  };

  const finish = (
    tracked: TrackedRequest,
    state: Exclude<DevelopmentNetworkRequestState, "pending">,
    values: Partial<DevelopmentNetworkRequestSnapshot> = {},
  ): void => {
    if (!active.delete(tracked.snapshot.id)) return;
    const finishedAt = safeTimestamp(clock);
    tracked.snapshot = Object.freeze({
      ...tracked.snapshot,
      ...values,
      state,
      updatedAt: finishedAt,
      finishedAt,
      durationMilliseconds: Math.max(
        0,
        finishedAt - tracked.snapshot.startedAt,
      ),
    });
    notifyListeners(listeners, tracked.snapshot);
  };

  const begin = (
    platform: NetworkPlatform,
    request: NetworkTextRequest,
  ): TrackedRequest | undefined => {
    if (nextId >= Number.MAX_SAFE_INTEGER) {
      retained = [];
      active.clear();
      nextId = 1;
    }
    if (retained.length >= maxHistory) {
      const settledIndex = retained.findIndex(
        (entry) => entry.snapshot.state !== "pending",
      );
      if (settledIndex === -1) {
        dropped = Math.min(Number.MAX_SAFE_INTEGER, dropped + 1);
        return undefined;
      }
      retained.splice(settledIndex, 1);
    }
    const startedAt = safeTimestamp(clock);
    const target =
      options.captureRequestTargets === true
        ? requestTarget(safeProperty(request, "url"))
        : undefined;
    const tracked: TrackedRequest = {
      snapshot: Object.freeze({
        protocolVersion: DEVELOPMENT_NETWORK_PROTOCOL_VERSION,
        id: nextId++,
        platform,
        method: requestMethod(request),
        ...(target === undefined ? {} : { requestTarget: target }),
        state: "pending",
        startedAt,
        updatedAt: startedAt,
        chunkCount: 0,
        receivedCharacters: 0,
        loadedBytes: 0,
      }),
    };
    retained.push(tracked);
    active.set(tracked.snapshot.id, tracked);
    publish(tracked);
    return tracked;
  };

  const inspector: DevelopmentNetworkInspector = {
    instrument(serviceValue) {
      const service = requireService(serviceValue);
      return Object.freeze({
        platform: service.platform,
        requestText(
          request: NetworkTextRequest,
          observerValue?: NetworkTextObserver,
        ): NetworkTextRequestHandle {
          const observer = normalizeObserver(observerValue);
          const tracked = begin(service.platform, request);
          if (tracked === undefined) {
            return service.requestText(request, observer);
          }

          let handle: NetworkTextRequestHandle;
          try {
            const candidate = service.requestText(request, {
              onResponse(response: NetworkResponse) {
                const target =
                  options.captureRequestTargets === true
                    ? requestTarget(response.url)
                    : undefined;
                update(tracked, {
                  responseStatus: response.status,
                  ...(target === undefined ? {} : { responseTarget: target }),
                  updatedAt: safeTimestamp(clock),
                });
                return observer.onResponse?.(response);
              },
              onChunk(chunk: NetworkTextChunk) {
                update(tracked, {
                  chunkCount: chunk.sequence,
                  receivedCharacters:
                    tracked.snapshot.receivedCharacters + chunk.text.length,
                  loadedBytes: chunk.loaded,
                  ...(chunk.total === undefined
                    ? {}
                    : { totalBytes: chunk.total }),
                  updatedAt: safeTimestamp(clock),
                });
                return observer.onChunk?.(chunk);
              },
            });
            try {
              handle = requireHandle(candidate);
            } catch (error) {
              cancelInvalidHandle(candidate);
              throw error;
            }
          } catch (error) {
            finish(tracked, "failed", { errorName: errorName(error) });
            throw error;
          }

          void Promise.resolve(handle.result).then(
            (result: NetworkTextResult) => {
              const target =
                options.captureRequestTargets === true
                  ? requestTarget(result.response.url)
                  : undefined;
              finish(tracked, "completed", {
                responseStatus: result.response.status,
                ...(target === undefined ? {} : { responseTarget: target }),
                chunkCount: result.chunkCount,
                receivedCharacters: result.receivedCharacters,
              });
            },
            (error: unknown) => {
              finish(tracked, "failed", { errorName: errorName(error) });
            },
          );

          return Object.freeze({
            result: handle.result,
            cancel(): void {
              try {
                handle.cancel();
              } catch (error) {
                finish(tracked, "failed", { errorName: errorName(error) });
                throw error;
              }
              finish(tracked, "cancelled");
            },
          });
        },
      });
    },
    history: () => Object.freeze(retained.map((entry) => entry.snapshot)),
    activeCount: () => active.size,
    droppedCount: () => dropped,
    clear() {
      retained = [];
      active.clear();
      dropped = 0;
      notifyListeners(listeners, undefined);
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError(
          "Development network inspector listener must be a function.",
        );
      }
      let subscribed = true;
      listeners.add(listener);
      return Object.freeze({
        remove(): void {
          if (!subscribed) return;
          subscribed = false;
          listeners.delete(listener);
        },
      });
    },
  };
  return Object.freeze(inspector);
}
