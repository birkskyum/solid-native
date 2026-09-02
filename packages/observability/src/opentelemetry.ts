import type {
  CausalOperationFinished,
  CausalOperationName,
  CausalTelemetryRecord,
  CausalTelemetrySink,
  TelemetryAttribute,
  TelemetryAttributes,
} from "./index.js";

export const DEFAULT_OPEN_TELEMETRY_MAX_ACTIVE_SPANS = 1_024;
export const DEFAULT_OPEN_TELEMETRY_MAX_CAUSE_IDS = 16;

export interface OpenTelemetrySpanStatus {
  /** OpenTelemetry SpanStatusCode: 0 unset, 1 ok, 2 error. */
  readonly code: 0 | 1 | 2;
  readonly message?: string;
}

/** The stable subset of an OpenTelemetry JavaScript span used by this adapter. */
export interface OpenTelemetrySpanLike {
  setAttribute(name: string, value: TelemetryAttribute): unknown;
  setStatus(status: OpenTelemetrySpanStatus): unknown;
  end(endTimestamp?: number): void;
}

/**
 * Structurally compatible with a tracer returned by the OpenTelemetry
 * JavaScript API. The application owns API/SDK initialization and transport.
 */
export interface OpenTelemetryTracingApi {
  startSpan(
    name: string,
    options: {
      readonly startTime: number;
      readonly attributes: TelemetryAttributes;
    },
  ): OpenTelemetrySpanLike;
}

export interface OpenTelemetryCausalExporterOptions {
  readonly tracer: OpenTelemetryTracingApi;
  readonly attributePrefix?: string;
  readonly maxActiveSpans?: number;
  readonly maxCauseIds?: number;
}

export interface OpenTelemetryCausalExporterSnapshot {
  readonly activeSpanCount: number;
  readonly startedSpanCount: number;
  readonly finishedSpanCount: number;
  readonly droppedStartCount: number;
  readonly duplicateStartCount: number;
  readonly orphanedFinishCount: number;
  readonly truncatedCauseCount: number;
}

export interface OpenTelemetryCausalExporter {
  readonly sink: CausalTelemetrySink;
  snapshot(): OpenTelemetryCausalExporterSnapshot;
  close(endTimestamp?: number): void;
}

interface ActiveOpenTelemetrySpan {
  readonly name: CausalOperationName;
  readonly span: OpenTelemetrySpanLike;
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

/**
 * Translates the vendor-neutral causal stream into independently managed
 * OpenTelemetry spans. The causal graph can have multiple parents, so opaque
 * cause IDs remain authoritative rather than being forced into a span tree.
 */
export function createOpenTelemetryCausalExporter(
  options: OpenTelemetryCausalExporterOptions,
): OpenTelemetryCausalExporter {
  const prefix = options.attributePrefix ?? "solid_native";
  if (
    prefix.length > 64 ||
    !/^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*$/u.test(prefix)
  ) {
    throw new TypeError(
      "OpenTelemetry attributePrefix must be a 1-64 character identifier.",
    );
  }
  const maxActiveSpans = positiveInteger(
    options.maxActiveSpans ?? DEFAULT_OPEN_TELEMETRY_MAX_ACTIVE_SPANS,
    "OpenTelemetry maxActiveSpans",
  );
  const maxCauseIds = nonNegativeInteger(
    options.maxCauseIds ?? DEFAULT_OPEN_TELEMETRY_MAX_CAUSE_IDS,
    "OpenTelemetry maxCauseIds",
  );
  const active = new Map<string, ActiveOpenTelemetrySpan>();
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
      const span = options.tracer.startSpan(record.name, {
        startTime: record.timestamp,
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
      if (record.status === "error") {
        running.span.setStatus({ code: 2, message: "error" });
      }
    } finally {
      running.span.end(record.timestamp);
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
        throw new RangeError(
          "OpenTelemetry exporter endTimestamp must be finite.",
        );
      }
      let firstError: unknown;
      for (const running of active.values()) {
        try {
          try {
            running.span.setAttribute(`${prefix}.outcome`, "cancelled");
            running.span.setAttribute(`${prefix}.exporter_closed`, true);
          } finally {
            running.span.end(endTimestamp);
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
