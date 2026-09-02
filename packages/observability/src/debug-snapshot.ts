import type {
  CausalOperationId,
  CausalOperationName,
  TelemetryAttribute,
  TelemetryAttributes,
} from "./index.js";
import type {
  CausalTimelineOperation,
  CausalTimelineSnapshot,
} from "./timeline.js";

export const CAUSAL_DEBUG_SNAPSHOT_KIND =
  "solid-native.causal-debug-snapshot" as const;
export const CAUSAL_DEBUG_SNAPSHOT_SCHEMA_VERSION = 0 as const;
export const CAUSAL_DEBUG_SNAPSHOT_MAX_OPERATIONS = 10_000;
export const CAUSAL_DEBUG_SNAPSHOT_MAX_CAUSES = 256;
export const CAUSAL_DEBUG_SNAPSHOT_MAX_ATTRIBUTES = 128;
export const CAUSAL_DEBUG_SNAPSHOT_MAX_ATTRIBUTE_STRING_LENGTH = 2_048;
export const CAUSAL_DEBUG_OPERATION_NAMES = Object.freeze([
  "solid-native.command",
  "solid-native.commit",
  "solid-native.computation",
  "solid-native.event",
  "solid-native.frame",
  "solid-native.measure",
  "solid-native.mount",
  "solid-native.owner",
  "solid-native.surface",
  "solid-native.task",
] satisfies readonly CausalOperationName[]);

export interface CausalDebugSnapshot extends CausalTimelineSnapshot {
  readonly kind: typeof CAUSAL_DEBUG_SNAPSHOT_KIND;
  readonly schemaVersion: typeof CAUSAL_DEBUG_SNAPSHOT_SCHEMA_VERSION;
  readonly capturedAt: number;
}

export interface CreateCausalDebugSnapshotOptions {
  /** Epoch milliseconds. Defaults to `Date.now()`. */
  readonly capturedAt?: number;
}

const OPERATION_NAMES = new Set<CausalOperationName>(
  CAUSAL_DEBUG_OPERATION_NAMES,
);
const FINISH_STATUSES = new Set(["ok", "error", "cancelled"] as const);
const BASE_OPERATION_KEYS = new Set([
  "operationId",
  "name",
  "causes",
  "startedAt",
  "startAttributes",
]);
const FINISHED_OPERATION_KEYS = new Set([
  ...BASE_OPERATION_KEYS,
  "finishedAt",
  "duration",
  "status",
  "finishAttributes",
]);
const SNAPSHOT_KEYS = new Set([
  "kind",
  "schemaVersion",
  "capturedAt",
  "operations",
  "activeOperationCount",
  "evictedOperationCount",
  "discardedRecordCount",
]);

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must be a plain object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new TypeError(
        `${path} contains unknown field ${JSON.stringify(key)}.`,
      );
    }
  }
  for (const key of allowed) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${path} is missing field ${JSON.stringify(key)}.`);
    }
  }
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number.`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer.`);
  }
  return value as number;
}

function operationId(value: unknown, path: string): CausalOperationId {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    value.includes("\0")
  ) {
    throw new TypeError(
      `${path} must contain 1-128 characters without null bytes.`,
    );
  }
  return value;
}

function operationName(value: unknown, path: string): CausalOperationName {
  if (
    typeof value !== "string" ||
    !OPERATION_NAMES.has(value as CausalOperationName)
  ) {
    throw new TypeError(`${path} is not a supported causal operation name.`);
  }
  return value as CausalOperationName;
}

function attributes(value: unknown, path: string): TelemetryAttributes {
  const input = record(value, path);
  const keys = Object.keys(input);
  if (keys.length > CAUSAL_DEBUG_SNAPSHOT_MAX_ATTRIBUTES) {
    throw new RangeError(
      `${path} exceeds ${CAUSAL_DEBUG_SNAPSHOT_MAX_ATTRIBUTES} attributes.`,
    );
  }
  const output: Record<string, TelemetryAttribute> = {};
  for (const key of keys) {
    if (key.length === 0 || key.length > 128 || key.includes("\0")) {
      throw new TypeError(
        `${path} attribute names must contain 1-128 characters without null bytes.`,
      );
    }
    const item = input[key];
    if (typeof item === "number") {
      output[key] = finiteNumber(item, `${path}.${key}`);
      continue;
    }
    if (typeof item === "boolean") {
      output[key] = item;
      continue;
    }
    if (
      typeof item !== "string" ||
      item.length > CAUSAL_DEBUG_SNAPSHOT_MAX_ATTRIBUTE_STRING_LENGTH
    ) {
      throw new TypeError(
        `${path}.${key} must be a boolean, finite number, or string of at most ${CAUSAL_DEBUG_SNAPSHOT_MAX_ATTRIBUTE_STRING_LENGTH} characters.`,
      );
    }
    output[key] = item;
  }
  return Object.freeze(output);
}

function causes(value: unknown, path: string): readonly CausalOperationId[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  if (value.length > CAUSAL_DEBUG_SNAPSHOT_MAX_CAUSES) {
    throw new RangeError(
      `${path} exceeds ${CAUSAL_DEBUG_SNAPSHOT_MAX_CAUSES} cause IDs.`,
    );
  }
  const output = value.map((item, index) =>
    operationId(item, `${path}[${index}]`),
  );
  if (new Set(output).size !== output.length) {
    throw new TypeError(`${path} must not contain duplicate cause IDs.`);
  }
  return Object.freeze(output);
}

function parseOperation(
  value: unknown,
  index: number,
): CausalTimelineOperation {
  const path = `causal debug snapshot operations[${index}]`;
  const input = record(value, path);
  const hasFinishField = [
    "finishedAt",
    "duration",
    "status",
    "finishAttributes",
  ].some((key) => Object.hasOwn(input, key));
  exactKeys(
    input,
    hasFinishField ? FINISHED_OPERATION_KEYS : BASE_OPERATION_KEYS,
    path,
  );
  const base = {
    operationId: operationId(input.operationId, `${path}.operationId`),
    name: operationName(input.name, `${path}.name`),
    causes: causes(input.causes, `${path}.causes`),
    startedAt: finiteNumber(input.startedAt, `${path}.startedAt`),
    startAttributes: attributes(
      input.startAttributes,
      `${path}.startAttributes`,
    ),
  };
  if (!hasFinishField) return Object.freeze(base);

  const duration = finiteNumber(input.duration, `${path}.duration`);
  if (duration < 0) {
    throw new TypeError(`${path}.duration must be non-negative.`);
  }
  if (
    typeof input.status !== "string" ||
    !FINISH_STATUSES.has(input.status as "ok" | "error" | "cancelled")
  ) {
    throw new TypeError(`${path}.status is invalid.`);
  }
  return Object.freeze({
    ...base,
    finishedAt: finiteNumber(input.finishedAt, `${path}.finishedAt`),
    duration,
    status: input.status as "ok" | "error" | "cancelled",
    finishAttributes: attributes(
      input.finishAttributes,
      `${path}.finishAttributes`,
    ),
  });
}

/** Validates an untrusted native development-client snapshot handoff. */
export function parseCausalDebugSnapshot(value: unknown): CausalDebugSnapshot {
  const input = record(value, "causal debug snapshot");
  exactKeys(input, SNAPSHOT_KEYS, "causal debug snapshot");
  if (input.kind !== CAUSAL_DEBUG_SNAPSHOT_KIND) {
    throw new TypeError("The causal debug snapshot kind is invalid.");
  }
  if (input.schemaVersion !== CAUSAL_DEBUG_SNAPSHOT_SCHEMA_VERSION) {
    throw new TypeError(
      "The causal debug snapshot schema version is unsupported.",
    );
  }
  const capturedAt = finiteNumber(
    input.capturedAt,
    "causal debug snapshot capturedAt",
  );
  if (capturedAt < 0) {
    throw new TypeError(
      "The causal debug snapshot capturedAt must be non-negative.",
    );
  }
  if (!Array.isArray(input.operations)) {
    throw new TypeError(
      "The causal debug snapshot operations must be an array.",
    );
  }
  if (input.operations.length > CAUSAL_DEBUG_SNAPSHOT_MAX_OPERATIONS) {
    throw new RangeError(
      `The causal debug snapshot exceeds ${CAUSAL_DEBUG_SNAPSHOT_MAX_OPERATIONS} operations.`,
    );
  }
  const operations = input.operations.map(parseOperation);
  const operationIds = operations.map((operation) => operation.operationId);
  if (new Set(operationIds).size !== operationIds.length) {
    throw new TypeError(
      "The causal debug snapshot contains duplicate operation IDs.",
    );
  }
  const activeOperationCount = nonNegativeInteger(
    input.activeOperationCount,
    "causal debug snapshot activeOperationCount",
  );
  const actualActiveOperationCount = operations.filter(
    (operation) => operation.finishedAt === undefined,
  ).length;
  if (activeOperationCount !== actualActiveOperationCount) {
    throw new TypeError(
      "The causal debug snapshot activeOperationCount does not match its operations.",
    );
  }
  return Object.freeze({
    kind: CAUSAL_DEBUG_SNAPSHOT_KIND,
    schemaVersion: CAUSAL_DEBUG_SNAPSHOT_SCHEMA_VERSION,
    capturedAt,
    operations: Object.freeze(operations),
    activeOperationCount,
    evictedOperationCount: nonNegativeInteger(
      input.evictedOperationCount,
      "causal debug snapshot evictedOperationCount",
    ),
    discardedRecordCount: nonNegativeInteger(
      input.discardedRecordCount,
      "causal debug snapshot discardedRecordCount",
    ),
  });
}

/** Creates a portable, deeply frozen native development-client handoff. */
export function createCausalDebugSnapshot(
  snapshot: CausalTimelineSnapshot,
  options: CreateCausalDebugSnapshotOptions = {},
): CausalDebugSnapshot {
  return parseCausalDebugSnapshot({
    kind: CAUSAL_DEBUG_SNAPSHOT_KIND,
    schemaVersion: CAUSAL_DEBUG_SNAPSHOT_SCHEMA_VERSION,
    capturedAt: options.capturedAt ?? Date.now(),
    operations: snapshot.operations,
    activeOperationCount: snapshot.activeOperationCount,
    evictedOperationCount: snapshot.evictedOperationCount,
    discardedRecordCount: snapshot.discardedRecordCount,
  });
}
