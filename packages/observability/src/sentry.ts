import type {
  CausalOperationFinished,
  CausalOperationName,
  CausalTelemetryRecord,
  CausalTelemetrySink,
  TelemetryAttribute,
  TelemetryAttributes,
} from "./index.js";

export const DEFAULT_SENTRY_MAX_ACTIVE_SPANS = 1_024;
export const DEFAULT_SENTRY_MAX_CAUSE_IDS = 16;

export interface SentrySpanStatus {
  readonly code: 1 | 2;
  readonly message?: string;
}

/** The stable subset of a Sentry v8+ span used by this adapter. */
export interface SentrySpanLike {
  setAttribute(name: string, value: TelemetryAttribute): unknown;
  setStatus(status: SentrySpanStatus): unknown;
  end(endTimestamp?: number): void;
}

/**
 * Structurally compatible with the top-level tracing API exported by current
 * `@sentry/react-native` and other Sentry JavaScript SDKs.
 */
export interface SentryTracingApi {
  startInactiveSpan(options: {
    readonly name: string;
    readonly op: string;
    readonly startTime: number;
    readonly attributes: TelemetryAttributes;
  }): SentrySpanLike;
}

export interface SentryCausalExporterOptions {
  readonly sentry: SentryTracingApi;
  readonly attributePrefix?: string;
  readonly maxActiveSpans?: number;
  readonly maxCauseIds?: number;
}

export interface SentryCausalExporterSnapshot {
  readonly activeSpanCount: number;
  readonly startedSpanCount: number;
  readonly finishedSpanCount: number;
  readonly droppedStartCount: number;
  readonly duplicateStartCount: number;
  readonly orphanedFinishCount: number;
  readonly truncatedCauseCount: number;
}

export interface SentryCausalExporter {
  readonly sink: CausalTelemetrySink;
  snapshot(): SentryCausalExporterSnapshot;
  close(endTimestamp?: number): void;
}

interface ActiveSentrySpan {
  readonly name: CausalOperationName;
  readonly span: SentrySpanLike;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer.`);
  }
  return value;
}

function sentryOperation(name: CausalOperationName): string {
  switch (name) {
    case "solid-native.event":
    case "solid-native.command":
      return "ui.action";
    case "solid-native.task":
      return "task";
    case "solid-native.owner":
      return "ui.component";
    case "solid-native.computation":
      return "ui.computation";
    case "solid-native.commit":
    case "solid-native.mount":
    case "solid-native.frame":
      return "ui.render";
    case "solid-native.measure":
      return "ui.measure";
    case "solid-native.surface":
      return "ui.load";
  }
}

function sentryStatus(
  status: CausalOperationFinished["status"],
): SentrySpanStatus {
  return status === "ok"
    ? { code: 1 }
    : { code: 2, message: status === "error" ? "error" : "cancelled" };
}

/**
 * Translates the vendor-neutral causal stream into independently managed
 * Sentry spans. Causal IDs are span data, not tags, and record attributes are
 * namespaced so an application cannot overwrite Sentry semantic attributes.
 */
export function createSentryCausalExporter(
  options: SentryCausalExporterOptions,
): SentryCausalExporter {
  const prefix = options.attributePrefix ?? "solid_native";
  if (
    prefix.length > 64 ||
    !/^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*$/u.test(prefix)
  ) {
    throw new TypeError(
      "Sentry attributePrefix must be a 1-64 character identifier.",
    );
  }
  const maxActiveSpans = positiveInteger(
    options.maxActiveSpans ?? DEFAULT_SENTRY_MAX_ACTIVE_SPANS,
    "Sentry maxActiveSpans",
  );
  const maxCauseIds = nonNegativeInteger(
    options.maxCauseIds ?? DEFAULT_SENTRY_MAX_CAUSE_IDS,
    "Sentry maxCauseIds",
  );
  const active = new Map<string, ActiveSentrySpan>();
  let startedSpanCount = 0;
  let finishedSpanCount = 0;
  let droppedStartCount = 0;
  let duplicateStartCount = 0;
  let orphanedFinishCount = 0;
  let truncatedCauseCount = 0;

  const attributes = (
    record: CausalTelemetryRecord,
  ): Record<string, TelemetryAttribute> => {
    const result: Record<string, TelemetryAttribute> = {};
    for (const [name, value] of Object.entries(record.attributes)) {
      result[`${prefix}.${name}`] = value;
    }
    // Protocol identity wins if a custom telemetry implementation emits an
    // attribute that collides with the adapter's reserved field names.
    result[`${prefix}.protocol_version`] = record.protocolVersion;
    result[`${prefix}.operation_id`] = record.operationId;
    return result;
  };

  const sink = (record: CausalTelemetryRecord): void => {
    if (record.type === "operation-started") {
      if (active.has(record.operationId)) {
        duplicateStartCount++;
        return;
      }
      if (active.size >= maxActiveSpans) {
        droppedStartCount++;
        return;
      }
      const spanAttributes = attributes(record);
      spanAttributes["sentry.origin"] = "auto.solid_native";
      spanAttributes[`${prefix}.cause_count`] = record.causes.length;
      if (record.causes.length > 0) {
        const exportedCauses = record.causes.slice(0, maxCauseIds);
        if (exportedCauses.length > 0) {
          spanAttributes[`${prefix}.cause_ids`] =
            JSON.stringify(exportedCauses);
        }
        if (exportedCauses.length < record.causes.length) {
          const truncated = record.causes.length - exportedCauses.length;
          spanAttributes[`${prefix}.cause_ids_truncated`] = truncated;
          truncatedCauseCount += truncated;
        }
      }
      const span = options.sentry.startInactiveSpan({
        name: record.name,
        op: sentryOperation(record.name),
        startTime: record.timestamp / 1_000,
        attributes: spanAttributes,
      });
      active.set(record.operationId, { name: record.name, span });
      startedSpanCount++;
      return;
    }

    const running = active.get(record.operationId);
    if (running === undefined || running.name !== record.name) {
      orphanedFinishCount++;
      return;
    }
    active.delete(record.operationId);
    try {
      for (const [name, value] of Object.entries(attributes(record))) {
        running.span.setAttribute(name, value);
      }
      running.span.setAttribute(`${prefix}.duration_ms`, record.duration);
      running.span.setAttribute(`${prefix}.outcome`, record.status);
      running.span.setStatus(sentryStatus(record.status));
    } finally {
      running.span.end(record.timestamp / 1_000);
      finishedSpanCount++;
    }
  };

  return {
    sink,
    snapshot() {
      return {
        activeSpanCount: active.size,
        startedSpanCount,
        finishedSpanCount,
        droppedStartCount,
        duplicateStartCount,
        orphanedFinishCount,
        truncatedCauseCount,
      };
    },
    close(endTimestamp = Date.now()) {
      if (!Number.isFinite(endTimestamp)) {
        throw new RangeError("Sentry exporter endTimestamp must be finite.");
      }
      let firstError: unknown;
      for (const running of active.values()) {
        try {
          try {
            running.span.setAttribute(`${prefix}.outcome`, "cancelled");
            running.span.setAttribute(`${prefix}.exporter_closed`, true);
            running.span.setStatus(sentryStatus("cancelled"));
          } finally {
            running.span.end(endTimestamp / 1_000);
            finishedSpanCount++;
          }
        } catch (error) {
          firstError ??= error;
        }
      }
      active.clear();
      if (firstError !== undefined) throw firstError;
    },
  };
}
