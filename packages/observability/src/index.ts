import {
  createAuthorizedReleaseAttributes,
  type CausalTelemetryAuthorizedRelease,
} from "./release.js";

export const OBSERVABILITY_PROTOCOL_VERSION = 0 as const;

export type CausalOperationId = string;

export type CausalOperationName =
  | "solid-native.command"
  | "solid-native.commit"
  | "solid-native.computation"
  | "solid-native.event"
  | "solid-native.frame"
  | "solid-native.measure"
  | "solid-native.mount"
  | "solid-native.owner"
  | "solid-native.surface"
  | "solid-native.task";

export type TelemetryAttribute = boolean | number | string;
export type TelemetryAttributes = Readonly<Record<string, TelemetryAttribute>>;

export interface CausalOperation {
  readonly id: CausalOperationId;
}

export interface CausalOperationStarted {
  readonly protocolVersion: typeof OBSERVABILITY_PROTOCOL_VERSION;
  readonly type: "operation-started";
  readonly operationId: CausalOperationId;
  readonly name: CausalOperationName;
  readonly timestamp: number;
  readonly causes: readonly CausalOperationId[];
  readonly attributes: TelemetryAttributes;
}

export interface CausalOperationFinished {
  readonly protocolVersion: typeof OBSERVABILITY_PROTOCOL_VERSION;
  readonly type: "operation-finished";
  readonly operationId: CausalOperationId;
  readonly name: CausalOperationName;
  readonly timestamp: number;
  readonly duration: number;
  readonly status: "ok" | "error" | "cancelled";
  readonly attributes: TelemetryAttributes;
}

export type CausalTelemetryRecord =
  CausalOperationStarted | CausalOperationFinished;

export type CausalTelemetrySink = (record: CausalTelemetryRecord) => void;

export interface CausalTelemetrySinkError {
  readonly error: unknown;
  readonly sinkIndex: number;
}

export interface StartOperationOptions {
  readonly causes?: readonly CausalOperation[];
  readonly attributes?: TelemetryAttributes;
  /** Milliseconds since the Unix epoch; defaults to the session clock. */
  readonly timestamp?: number;
}

export interface FinishOperationOptions {
  readonly status?: CausalOperationFinished["status"];
  readonly attributes?: TelemetryAttributes;
  /** Milliseconds since the Unix epoch; defaults to the session clock. */
  readonly timestamp?: number;
  /** Monotonic milliseconds; defaults to timestamp minus the start. */
  readonly duration?: number;
}

/**
 * Renderer-facing instrumentation boundary. Implementations must be synchronous;
 * exporters can enqueue records before forwarding them to another process.
 */
export interface CausalTelemetry {
  startOperation(
    name: CausalOperationName,
    options?: StartOperationOptions,
  ): CausalOperation;
  finishOperation(
    operation: CausalOperation,
    options?: FinishOperationOptions,
  ): void;
}

export interface CausalTelemetryOptions {
  readonly sink: CausalTelemetrySink;
  readonly clock?: () => number;
  readonly createOperationId?: () => CausalOperationId;
  readonly onSinkError?: (error: unknown) => unknown;
  /** Stable process/build identity copied onto every emitted record. */
  readonly resource?: CausalTelemetryResource;
  /**
   * Complete release identity returned by the signature verifier. The
   * observability package validates and binds it, but does not establish its
   * cryptographic trust itself.
   */
  readonly authorizedRelease?: CausalTelemetryAuthorizedRelease;
}

export interface SampledCausalTelemetryOptions extends CausalTelemetryOptions {
  /** Probability that the complete causal session is retained, from 0 to 1. */
  readonly sampleRate: number;
  /** Injected for deterministic tests; must return a number from 0 (inclusive) to 1 (exclusive). */
  readonly random?: () => number;
}

export interface CausalTelemetryResource {
  readonly runtimeName?: string;
  readonly runtimeVersion?: string;
  readonly hostContractVersion?: number;
  readonly platform?: string;
  readonly buildFingerprint?: string;
  readonly release?: string;
  readonly updateFingerprint?: string;
  /** Canonical identities copied from a policy-verified release envelope. */
  readonly releaseChannel?: string;
  readonly sourceRevision?: string;
  readonly releaseFingerprint?: string;
  readonly bundleFingerprint?: string;
  readonly nativeCompatibilityFingerprint?: string;
  /** Authenticated signer identity used to verify the detached statement. */
  readonly releaseSignerKeyId?: string;
  /** Whether the verifier independently checked the signed bundle and native artifact. */
  readonly releaseInputsVerified?: boolean;
}

export interface CausalTelemetryFanoutOptions {
  readonly sinks: readonly CausalTelemetrySink[];
  readonly onSinkError?: (failure: CausalTelemetrySinkError) => unknown;
}

interface ActiveOperation {
  readonly name: CausalOperationName;
  readonly startedAt: number;
}

let nextSessionId = 1;

function reportIsolatedSinkError<TFailure>(
  handler: ((failure: TFailure) => unknown) | undefined,
  failure: TFailure,
): void {
  try {
    const reported = handler?.(failure);
    void Promise.resolve(reported).catch(() => undefined);
  } catch {
    // Telemetry must never change application behavior.
  }
}

const RESOURCE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:+/@-]{0,127}$/;
const RELEASE_CHANNEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SOURCE_REVISION_PATTERN = /^[a-f0-9]{7,64}$/;
const SHA256_FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SIGNING_KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/;
const MANUAL_RELEASE_RESOURCE_KEYS = [
  "release",
  "releaseChannel",
  "sourceRevision",
  "releaseFingerprint",
  "bundleFingerprint",
  "nativeCompatibilityFingerprint",
  "releaseSignerKeyId",
  "releaseInputsVerified",
] as const;

function resourceIdentifier(name: string, value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !RESOURCE_IDENTIFIER_PATTERN.test(value)) {
    throw new TypeError(
      `Telemetry resource ${name} must be a static identifier of 1 to 128 characters.`,
    );
  }
  return value;
}

function releaseIdentifier(
  name: string,
  value: unknown,
  pattern: RegExp,
  description: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new TypeError(`Telemetry resource ${name} must be ${description}.`);
  }
  return value;
}

function createResourceAttributes(
  resource: CausalTelemetryResource | undefined,
  authorizedRelease: CausalTelemetryAuthorizedRelease | undefined,
): TelemetryAttributes {
  const authorizedReleaseAttributes =
    authorizedRelease === undefined
      ? undefined
      : createAuthorizedReleaseAttributes(authorizedRelease);
  if (authorizedRelease !== undefined && resource !== undefined) {
    for (const key of MANUAL_RELEASE_RESOURCE_KEYS) {
      if (resource[key] !== undefined) {
        throw new TypeError(
          `Telemetry resource ${key} cannot be supplied with authorizedRelease.`,
        );
      }
    }
    if (
      resource.platform !== undefined &&
      resource.platform !== authorizedRelease.platform
    ) {
      throw new TypeError(
        "Telemetry resource platform must match authorizedRelease platform.",
      );
    }
  }
  if (resource === undefined) return authorizedReleaseAttributes ?? {};
  const attributes: Record<string, TelemetryAttribute> = {};
  const identifiers = [
    ["resource.runtime.name", "runtimeName", resource.runtimeName],
    ["resource.runtime.version", "runtimeVersion", resource.runtimeVersion],
    ["resource.platform", "platform", resource.platform],
    [
      "resource.build.fingerprint",
      "buildFingerprint",
      resource.buildFingerprint,
    ],
    ["resource.release", "release", resource.release],
    [
      "resource.update.fingerprint",
      "updateFingerprint",
      resource.updateFingerprint,
    ],
  ] as const;
  for (const [attributeName, resourceName, value] of identifiers) {
    const identifier = resourceIdentifier(resourceName, value);
    if (identifier !== undefined) attributes[attributeName] = identifier;
  }
  const releaseIdentifiers = [
    [
      "resource.release.channel",
      "releaseChannel",
      resource.releaseChannel,
      RELEASE_CHANNEL_PATTERN,
      "a static release channel of 1 to 64 characters",
    ],
    [
      "resource.source.revision",
      "sourceRevision",
      resource.sourceRevision,
      SOURCE_REVISION_PATTERN,
      "a canonical lowercase hexadecimal revision of 7 to 64 characters",
    ],
    [
      "resource.release.fingerprint",
      "releaseFingerprint",
      resource.releaseFingerprint,
      SHA256_FINGERPRINT_PATTERN,
      "a canonical SHA-256 fingerprint",
    ],
    [
      "resource.bundle.fingerprint",
      "bundleFingerprint",
      resource.bundleFingerprint,
      SHA256_FINGERPRINT_PATTERN,
      "a canonical SHA-256 fingerprint",
    ],
    [
      "resource.native.compatibility_fingerprint",
      "nativeCompatibilityFingerprint",
      resource.nativeCompatibilityFingerprint,
      SHA256_FINGERPRINT_PATTERN,
      "a canonical SHA-256 fingerprint",
    ],
    [
      "resource.release.signing_key_id",
      "releaseSignerKeyId",
      resource.releaseSignerKeyId,
      SIGNING_KEY_ID_PATTERN,
      "a static signing key identifier of 1 to 128 characters",
    ],
  ] as const;
  for (const [
    attributeName,
    resourceName,
    value,
    pattern,
    description,
  ] of releaseIdentifiers) {
    const identifier = releaseIdentifier(
      resourceName,
      value,
      pattern,
      description,
    );
    if (identifier !== undefined) attributes[attributeName] = identifier;
  }
  if (resource.hostContractVersion !== undefined) {
    if (
      !Number.isSafeInteger(resource.hostContractVersion) ||
      resource.hostContractVersion < 0
    ) {
      throw new TypeError(
        "Telemetry resource hostContractVersion must be a non-negative safe integer.",
      );
    }
    attributes["resource.runtime.host_contract_version"] =
      resource.hostContractVersion;
  }
  if (resource.releaseInputsVerified !== undefined) {
    if (typeof resource.releaseInputsVerified !== "boolean") {
      throw new TypeError(
        "Telemetry resource releaseInputsVerified must be a boolean.",
      );
    }
    attributes["resource.release.inputs_verified"] =
      resource.releaseInputsVerified;
  }
  return Object.freeze({
    ...attributes,
    ...(authorizedReleaseAttributes ?? {}),
  });
}

/**
 * Creates a process-local causal telemetry session. Sink failures are isolated
 * from application execution; a failing exporter cannot break rendering.
 */
export function createCausalTelemetry(
  options: CausalTelemetryOptions,
): CausalTelemetry {
  const clock = options.clock ?? Date.now;
  const resourceAttributes = createResourceAttributes(
    options.resource,
    options.authorizedRelease,
  );
  const sessionId = nextSessionId++;
  let nextOperationId = 1;
  const createOperationId =
    options.createOperationId ??
    (() => `solid-native-${sessionId}-${nextOperationId++}`);
  const active = new Map<CausalOperationId, ActiveOperation>();

  const reportSinkError = (error: unknown): void => {
    reportIsolatedSinkError(options.onSinkError, error);
  };

  const emit = (record: CausalTelemetryRecord): void => {
    try {
      options.sink(record);
    } catch (error) {
      reportSinkError(error);
    }
  };

  return {
    startOperation(name, operationOptions = {}) {
      const id = createOperationId();
      const startedAt = operationOptions.timestamp ?? clock();
      if (!Number.isFinite(startedAt)) {
        throw new RangeError("Telemetry timestamps must be finite.");
      }
      const operation = { id };
      active.set(id, { name, startedAt });
      emit({
        protocolVersion: OBSERVABILITY_PROTOCOL_VERSION,
        type: "operation-started",
        operationId: id,
        name,
        timestamp: startedAt,
        causes: [
          ...new Set((operationOptions.causes ?? []).map((cause) => cause.id)),
        ],
        attributes: {
          ...(operationOptions.attributes ?? {}),
          ...resourceAttributes,
        },
      });
      return operation;
    },

    finishOperation(operation, operationOptions = {}) {
      const running = active.get(operation.id);
      if (running === undefined) return;
      const endedAt = operationOptions.timestamp ?? clock();
      const duration =
        operationOptions.duration ?? Math.max(0, endedAt - running.startedAt);
      if (!Number.isFinite(endedAt)) {
        throw new RangeError("Telemetry timestamps must be finite.");
      }
      if (!Number.isFinite(duration) || duration < 0) {
        throw new RangeError(
          "Telemetry operation durations must be finite and non-negative.",
        );
      }
      active.delete(operation.id);
      emit({
        protocolVersion: OBSERVABILITY_PROTOCOL_VERSION,
        type: "operation-finished",
        operationId: operation.id,
        name: running.name,
        timestamp: endedAt,
        duration,
        status: operationOptions.status ?? "ok",
        attributes: {
          ...(operationOptions.attributes ?? {}),
          ...resourceAttributes,
        },
      });
    },
  };
}

/**
 * Samples once for a complete causal session. Returning `undefined` lets a
 * renderer stay on its zero-instrumentation path and never breaks a retained
 * graph by sampling individual operations independently.
 */
export function createSampledCausalTelemetry(
  options: SampledCausalTelemetryOptions,
): CausalTelemetry | undefined {
  if (
    !Number.isFinite(options.sampleRate) ||
    options.sampleRate < 0 ||
    options.sampleRate > 1
  ) {
    throw new RangeError("Telemetry sampleRate must be between 0 and 1.");
  }

  // Construct before sampling so invalid resource configuration fails
  // deterministically rather than only for the sessions that happen to win.
  const telemetry = createCausalTelemetry(options);
  if (options.sampleRate === 0) return undefined;
  if (options.sampleRate === 1) return telemetry;

  const decision = (options.random ?? Math.random)();
  if (!Number.isFinite(decision) || decision < 0 || decision >= 1) {
    throw new RangeError(
      "Telemetry random source must return a number from 0 (inclusive) to 1 (exclusive).",
    );
  }
  return decision < options.sampleRate ? telemetry : undefined;
}

/** Returns a low-cardinality error classification without recording messages. */
export function telemetryErrorAttributes(error: unknown): TelemetryAttributes {
  if (error instanceof Error) {
    const type = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(error.name)
      ? error.name
      : "Error";
    return { "error.type": type };
  }
  return { "error.type": typeof error };
}

/** Fans records out without allowing one failing sink to starve the others. */
export function createCausalTelemetryFanout(
  options: CausalTelemetryFanoutOptions,
): CausalTelemetrySink {
  return (record) => {
    for (const [sinkIndex, sink] of options.sinks.entries()) {
      try {
        sink(record);
      } catch (error) {
        reportIsolatedSinkError(options.onSinkError, { error, sinkIndex });
      }
    }
  };
}

export { type CausalTelemetryAuthorizedRelease } from "./release.js";

export {
  CAUSAL_DEBUG_OPERATION_NAMES,
  CAUSAL_DEBUG_SNAPSHOT_KIND,
  CAUSAL_DEBUG_SNAPSHOT_MAX_ATTRIBUTES,
  CAUSAL_DEBUG_SNAPSHOT_MAX_ATTRIBUTE_STRING_LENGTH,
  CAUSAL_DEBUG_SNAPSHOT_MAX_CAUSES,
  CAUSAL_DEBUG_SNAPSHOT_MAX_OPERATIONS,
  CAUSAL_DEBUG_SNAPSHOT_SCHEMA_VERSION,
  createCausalDebugSnapshot,
  parseCausalDebugSnapshot,
  type CausalDebugSnapshot,
  type CreateCausalDebugSnapshotOptions,
} from "./debug-snapshot.js";

export {
  DEFAULT_CAUSAL_TIMELINE_CAPACITY,
  createCausalTimeline,
  explainCausalTimelineSnapshot,
  groupCausalTimelineSnapshot,
  type CausalTimeline,
  type CausalTimelineExplanation,
  type CausalTimelineGroup,
  type CausalTimelineOperation,
  type CausalTimelineOptions,
  type CausalTimelineSnapshot,
} from "./timeline.js";

export {
  SOLID_DIAGNOSTICS_DEBUG_KIND,
  SOLID_DIAGNOSTICS_DEBUG_MAX_CAUSES,
  SOLID_DIAGNOSTICS_DEBUG_MAX_CAUSE_DEPTH,
  SOLID_DIAGNOSTICS_DEBUG_MAX_CAUSE_RECORDS,
  SOLID_DIAGNOSTICS_DEBUG_MAX_DEPENDENCIES,
  SOLID_DIAGNOSTICS_DEBUG_MAX_NAME_LENGTH,
  SOLID_DIAGNOSTICS_DEBUG_MAX_RECORDS,
  SOLID_DIAGNOSTICS_DEBUG_MAX_SERIALIZED_BYTES,
  SOLID_DIAGNOSTICS_DEBUG_SCHEMA_VERSION,
  createSolidDiagnosticsDebugEnvelope,
  parseSolidDiagnosticsDebugEnvelope,
  serializeSolidDiagnosticsDebugEnvelope,
  type CreateSolidDiagnosticsDebugEnvelopeOptions,
  type SolidDiagnosticsDebugCause,
  type SolidDiagnosticsDebugDiagnostic,
  type SolidDiagnosticsDebugEnvelope,
  type SolidDiagnosticsDebugRerun,
  type SolidDiagnosticsDebugScopeCost,
  type SolidDiagnosticsDebugWriteCost,
} from "./diagnostics-debug.js";

export {
  NATIVE_SOLID_DIAGNOSTICS_CORRELATION_KIND,
  NATIVE_SOLID_DIAGNOSTICS_CORRELATION_MODE,
  NATIVE_SOLID_DIAGNOSTICS_CORRELATION_SCHEMA_VERSION,
  NATIVE_SOLID_DIAGNOSTICS_CORRELATION_WINDOW_TOLERANCE_MS,
  correlateNativeSolidDiagnostics,
  type CorrelateNativeSolidDiagnosticsOptions,
  type NativeSolidDiagnosticsCorrelatedOutput,
  type NativeSolidDiagnosticsCorrelation,
} from "./diagnostics-correlation.js";

export {
  DEFAULT_SENTRY_MAX_ACTIVE_SPANS,
  DEFAULT_SENTRY_MAX_CAUSE_IDS,
  createSentryCausalExporter,
  type SentryCausalExporter,
  type SentryCausalExporterOptions,
  type SentryCausalExporterSnapshot,
  type SentrySpanLike,
  type SentrySpanStatus,
  type SentryTracingApi,
} from "./sentry.js";

export {
  DEFAULT_OPEN_TELEMETRY_MAX_ACTIVE_SPANS,
  DEFAULT_OPEN_TELEMETRY_MAX_CAUSE_IDS,
  createOpenTelemetryCausalExporter,
  type OpenTelemetryCausalExporter,
  type OpenTelemetryCausalExporterOptions,
  type OpenTelemetryCausalExporterSnapshot,
  type OpenTelemetrySpanLike,
  type OpenTelemetrySpanStatus,
  type OpenTelemetryTracingApi,
} from "./opentelemetry.js";
