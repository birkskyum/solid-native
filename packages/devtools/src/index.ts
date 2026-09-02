export const DEVELOPMENT_ERROR_PROTOCOL_VERSION = 0 as const;
export const DEVELOPMENT_ERROR_MAX_HISTORY = 50;
export const DEVELOPMENT_ERROR_DEFAULT_HISTORY = 20;
export const DEVELOPMENT_ERROR_MAX_NAME_LENGTH = 128;
export const DEVELOPMENT_ERROR_MAX_MESSAGE_LENGTH = 4_096;
export const DEVELOPMENT_ERROR_MAX_STACK_LENGTH = 32_768;

export type DevelopmentErrorSource =
  | "application"
  | "async"
  | "commit"
  | "native"
  | "render"
  | "runtime"
  | "telemetry";

export interface DevelopmentErrorSnapshot {
  readonly protocolVersion: typeof DEVELOPMENT_ERROR_PROTOCOL_VERSION;
  /** Monotonic within one controller lifetime. */
  readonly id: number;
  readonly source: DevelopmentErrorSource;
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly firstOccurredAt: number;
  readonly lastOccurredAt: number;
  /** Consecutive equivalent reports are coalesced instead of growing memory. */
  readonly occurrenceCount: number;
}

export interface DevelopmentErrorReportOptions {
  readonly source?: DevelopmentErrorSource;
}

export interface DevelopmentErrorControllerOptions {
  readonly maxHistory?: number;
  /** Injectable wall clock for deterministic local tooling tests. */
  readonly clock?: () => number;
}

export interface DevelopmentErrorSubscription {
  remove(): void;
}

export interface DevelopmentErrorController {
  /** Never throws, including when the thrown value has hostile property getters. */
  report(
    error: unknown,
    options?: DevelopmentErrorReportOptions,
  ): DevelopmentErrorSnapshot;
  current(): DevelopmentErrorSnapshot | undefined;
  history(): readonly DevelopmentErrorSnapshot[];
  /** Dismisses only the currently visible report. Retained history is unchanged. */
  dismiss(id?: number): boolean;
  clear(): void;
  subscribe(
    listener: (current: DevelopmentErrorSnapshot | undefined) => unknown,
  ): DevelopmentErrorSubscription;
}

const DEVELOPMENT_ERROR_SOURCES = new Set<DevelopmentErrorSource>([
  "application",
  "async",
  "commit",
  "native",
  "render",
  "runtime",
  "telemetry",
]);

function boundedText(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  let prefix = value.slice(0, maximum - 1);
  const finalCodeUnit = prefix.charCodeAt(prefix.length - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) {
    prefix = prefix.slice(0, -1);
  }
  return `${prefix}\u2026`;
}

function safeProperty(value: object, property: string): unknown {
  try {
    return Reflect.get(value, property);
  } catch {
    return undefined;
  }
}

function errorText(value: unknown): {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
} {
  if (typeof value === "string") {
    return {
      name: "ThrownValue",
      message: boundedText(
        value || "An empty string was thrown.",
        DEVELOPMENT_ERROR_MAX_MESSAGE_LENGTH,
      ),
    };
  }
  if (
    value === undefined ||
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "bigint"
  ) {
    return {
      name: "ThrownValue",
      message: boundedText(String(value), DEVELOPMENT_ERROR_MAX_MESSAGE_LENGTH),
    };
  }
  if (typeof value === "symbol") {
    let message = "A symbol was thrown.";
    try {
      message = String(value);
    } catch {
      // A diagnostic path must not replace the original failure.
    }
    return { name: "ThrownValue", message };
  }
  if (typeof value !== "object" && typeof value !== "function") {
    return { name: "ThrownValue", message: "An unknown value was thrown." };
  }

  const nameValue = safeProperty(value, "name");
  const messageValue = safeProperty(value, "message");
  const stackValue = safeProperty(value, "stack");
  const name =
    typeof nameValue === "string" && nameValue.length > 0
      ? boundedText(nameValue, DEVELOPMENT_ERROR_MAX_NAME_LENGTH)
      : "Error";
  const message =
    typeof messageValue === "string" && messageValue.length > 0
      ? boundedText(messageValue, DEVELOPMENT_ERROR_MAX_MESSAGE_LENGTH)
      : "An object was thrown without a string message.";
  const stack =
    typeof stackValue === "string" && stackValue.length > 0
      ? boundedText(stackValue, DEVELOPMENT_ERROR_MAX_STACK_LENGTH)
      : undefined;
  return { name, message, ...(stack === undefined ? {} : { stack }) };
}

function reportSource(value: unknown): DevelopmentErrorSource {
  return typeof value === "string" &&
    DEVELOPMENT_ERROR_SOURCES.has(value as DevelopmentErrorSource)
    ? (value as DevelopmentErrorSource)
    : "application";
}

function safeTimestamp(clock: () => number): number {
  try {
    const value = clock();
    if (Number.isSafeInteger(value) && value >= 0) return value;
  } catch {
    // Error reporting remains available even when an injected clock fails.
  }
  const fallback = Date.now();
  return Number.isSafeInteger(fallback) && fallback >= 0 ? fallback : 0;
}

function equivalentError(
  left: DevelopmentErrorSnapshot,
  right: Pick<
    DevelopmentErrorSnapshot,
    "source" | "name" | "message" | "stack"
  >,
): boolean {
  return (
    left.source === right.source &&
    left.name === right.name &&
    left.message === right.message &&
    left.stack === right.stack
  );
}

function notifyListeners(
  listeners: ReadonlySet<
    (current: DevelopmentErrorSnapshot | undefined) => unknown
  >,
  current: DevelopmentErrorSnapshot | undefined,
): void {
  for (const listener of [...listeners]) {
    try {
      const result = listener(current);
      void Promise.resolve(result).catch(() => undefined);
    } catch {
      // Diagnostic observers are isolated from the application and each other.
    }
  }
}

/** Creates one bounded, process-local development error channel. It performs no I/O. */
export function createDevelopmentErrorController(
  options: DevelopmentErrorControllerOptions = {},
): DevelopmentErrorController {
  if (options === null || typeof options !== "object") {
    throw new TypeError(
      "Development error controller options must be an object.",
    );
  }
  const maxHistory = options.maxHistory ?? DEVELOPMENT_ERROR_DEFAULT_HISTORY;
  if (
    !Number.isSafeInteger(maxHistory) ||
    maxHistory < 1 ||
    maxHistory > DEVELOPMENT_ERROR_MAX_HISTORY
  ) {
    throw new TypeError(
      `Development error maxHistory must be a safe integer from 1 through ${String(DEVELOPMENT_ERROR_MAX_HISTORY)}.`,
    );
  }
  if (options.clock !== undefined && typeof options.clock !== "function") {
    throw new TypeError("Development error clock must be a function.");
  }

  const clock = options.clock ?? Date.now;
  const listeners = new Set<
    (current: DevelopmentErrorSnapshot | undefined) => unknown
  >();
  let retained: DevelopmentErrorSnapshot[] = [];
  let visible: DevelopmentErrorSnapshot | undefined;
  let nextId = 1;

  const report = (
    error: unknown,
    reportOptions: DevelopmentErrorReportOptions = {},
  ): DevelopmentErrorSnapshot => {
    const occurredAt = safeTimestamp(clock);
    const normalized = errorText(error);
    const source = reportSource(reportOptions?.source);
    if (
      visible !== undefined &&
      equivalentError(visible, { source, ...normalized })
    ) {
      const occurrenceCount =
        visible.occurrenceCount >= Number.MAX_SAFE_INTEGER
          ? Number.MAX_SAFE_INTEGER
          : visible.occurrenceCount + 1;
      visible = Object.freeze({
        ...visible,
        lastOccurredAt: Math.max(visible.lastOccurredAt, occurredAt),
        occurrenceCount,
      });
      retained[retained.length - 1] = visible;
      notifyListeners(listeners, visible);
      return visible;
    }

    const snapshot: DevelopmentErrorSnapshot = Object.freeze({
      protocolVersion: DEVELOPMENT_ERROR_PROTOCOL_VERSION,
      id: nextId,
      source,
      name: normalized.name,
      message: normalized.message,
      ...(normalized.stack === undefined ? {} : { stack: normalized.stack }),
      firstOccurredAt: occurredAt,
      lastOccurredAt: occurredAt,
      occurrenceCount: 1,
    });
    nextId = nextId >= Number.MAX_SAFE_INTEGER ? 1 : nextId + 1;
    if (nextId === 1) retained = [];
    retained.push(snapshot);
    if (retained.length > maxHistory) retained.shift();
    visible = snapshot;
    notifyListeners(listeners, visible);
    return snapshot;
  };

  const controller: DevelopmentErrorController = {
    report,
    current: () => visible,
    history: () => Object.freeze([...retained]),
    dismiss(id) {
      if (visible === undefined || (id !== undefined && id !== visible.id)) {
        return false;
      }
      visible = undefined;
      notifyListeners(listeners, undefined);
      return true;
    },
    clear() {
      if (visible === undefined && retained.length === 0) return;
      retained = [];
      visible = undefined;
      notifyListeners(listeners, undefined);
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Development error listener must be a function.");
      }
      let active = true;
      listeners.add(listener);
      return Object.freeze({
        remove() {
          if (!active) return;
          active = false;
          listeners.delete(listener);
        },
      });
    },
  };
  return Object.freeze(controller);
}

/** Produces a callback suitable for explicit adapter and promise error paths. */
export function createDevelopmentErrorHandler(
  controller: DevelopmentErrorController,
  source: DevelopmentErrorSource = "application",
): (error: unknown) => DevelopmentErrorSnapshot {
  if (
    controller === null ||
    typeof controller !== "object" ||
    typeof controller.report !== "function"
  ) {
    throw new TypeError("Development error controller is required.");
  }
  if (!DEVELOPMENT_ERROR_SOURCES.has(source)) {
    throw new TypeError("Development error source is invalid.");
  }
  return (error) => controller.report(error, { source });
}
