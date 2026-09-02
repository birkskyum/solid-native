import { open } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

import {
  CAUSAL_DEBUG_OPERATION_NAMES,
  explainCausalTimelineSnapshot,
  groupCausalTimelineSnapshot,
  parseCausalDebugSnapshot,
  type CausalDebugSnapshot,
  type CausalOperationName,
  type CausalTimelineGroup,
  type CausalTimelineOperation,
  type TelemetryAttributes,
} from "@solid-native/observability";

export const NATIVE_CAUSAL_DEBUG_MAX_INPUT_BYTES = 16_777_216;
/** @deprecated Use the transport-neutral input limit. */
export const NATIVE_CAUSAL_DEBUG_MAX_FILE_BYTES =
  NATIVE_CAUSAL_DEBUG_MAX_INPUT_BYTES;
export const NATIVE_CAUSAL_TRACE_MAX_FLOW_COUNT = 50_000;

export interface NativeCausalDebugOperationSummary {
  readonly operationId: string;
  readonly name: CausalOperationName;
  readonly status: "active" | "ok" | "error" | "cancelled";
  readonly causes: readonly string[];
  readonly startedAt: number;
  readonly finishedAt?: number;
  readonly duration?: number;
  readonly attributes?: Readonly<{
    readonly start: TelemetryAttributes;
    readonly finish?: TelemetryAttributes;
  }>;
}

export interface NativeCausalDebugSelection {
  readonly target: NativeCausalDebugOperationSummary;
  /** Local retained-component identity, not a distributed trace ID. */
  readonly groupId: string;
  readonly ancestors: readonly NativeCausalDebugOperationSummary[];
  readonly descendants: readonly NativeCausalDebugOperationSummary[];
  readonly unresolvedCauseIds: readonly string[];
}

export interface NativeCausalDebugGroupSummary {
  /** Earliest retained operation ID; local identity, not a distributed trace ID. */
  readonly groupId: string;
  readonly operationIds: readonly string[];
  readonly operationNames: readonly CausalOperationName[];
  readonly entryOperationIds: readonly string[];
  readonly terminalOperationIds: readonly string[];
  readonly unresolvedCauseIds: readonly string[];
  readonly operationCount: number;
  readonly activeOperationCount: number;
  readonly okOperationCount: number;
  readonly errorOperationCount: number;
  readonly cancelledOperationCount: number;
  readonly startedAt: number;
  readonly finishedAt?: number;
  readonly duration?: number;
}

export interface NativeCausalDebugInspection {
  readonly kind: "solid-native.causal-debug-inspection";
  readonly schemaVersion: 1;
  readonly capturedAt: number;
  readonly operationCount: number;
  readonly groupCount: number;
  readonly activeOperationCount: number;
  readonly evictedOperationCount: number;
  readonly discardedRecordCount: number;
  readonly operationCounts: Readonly<Record<CausalOperationName, number>>;
  readonly statusCounts: Readonly<{
    readonly active: number;
    readonly ok: number;
    readonly error: number;
    readonly cancelled: number;
  }>;
  readonly groups: readonly NativeCausalDebugGroupSummary[];
  readonly selection?: NativeCausalDebugSelection;
}

export interface InspectNativeCausalDebugSnapshotOptions {
  readonly operationId?: string;
  readonly includeAttributes?: boolean;
}

export interface CreateNativeCausalTraceOptions {
  readonly includeAttributes?: boolean;
}

export interface InspectNativeCausalDebugFileOptions extends InspectNativeCausalDebugSnapshotOptions {
  readonly snapshotPath: string;
  readonly cwd?: string;
}

export interface CreateNativeCausalTraceFileOptions extends CreateNativeCausalTraceOptions {
  readonly snapshotPath: string;
  readonly cwd?: string;
}

export type NativeCausalDebugInputStream = AsyncIterable<Uint8Array | string>;

export type NativeCausalTraceArgument = boolean | number | string;
export type NativeCausalTraceArguments = Readonly<
  Record<string, NativeCausalTraceArgument>
>;

interface NativeCausalTraceEventBase {
  readonly name: string;
  readonly cat: string;
  readonly pid: 1;
  readonly tid: number;
  readonly args: NativeCausalTraceArguments;
}

export interface NativeCausalTraceMetadataEvent extends NativeCausalTraceEventBase {
  readonly ph: "M";
}

export interface NativeCausalTraceCompleteEvent extends NativeCausalTraceEventBase {
  readonly ph: "X";
  readonly ts: number;
  readonly dur: number;
}

export interface NativeCausalTraceInstantEvent extends NativeCausalTraceEventBase {
  readonly ph: "I";
  readonly ts: number;
  readonly s: "t";
}

export interface NativeCausalTraceFlowEvent extends NativeCausalTraceEventBase {
  readonly ph: "s" | "f";
  readonly ts: number;
  readonly id: number;
  readonly bp?: "e";
}

export type NativeCausalTraceEvent =
  | NativeCausalTraceMetadataEvent
  | NativeCausalTraceCompleteEvent
  | NativeCausalTraceInstantEvent
  | NativeCausalTraceFlowEvent;

/** A standards-based Chrome JSON event array that Perfetto can open directly. */
export type NativeCausalTrace = readonly NativeCausalTraceEvent[];

function validateIncludeAttributes(
  options: CreateNativeCausalTraceOptions,
): boolean {
  if (
    options.includeAttributes !== undefined &&
    typeof options.includeAttributes !== "boolean"
  ) {
    throw new TypeError("Causal debug includeAttributes must be a boolean.");
  }
  return options.includeAttributes === true;
}

function validateInspectionOptions(
  options: InspectNativeCausalDebugSnapshotOptions,
): Readonly<{ operationId?: string; includeAttributes: boolean }> {
  if (
    options.operationId !== undefined &&
    (typeof options.operationId !== "string" ||
      options.operationId.length === 0 ||
      options.operationId.length > 128 ||
      options.operationId.includes("\0"))
  ) {
    throw new TypeError(
      "Causal debug operationId must contain 1-128 characters without null bytes.",
    );
  }
  return Object.freeze({
    ...(options.operationId === undefined
      ? {}
      : { operationId: options.operationId }),
    includeAttributes: validateIncludeAttributes(options),
  });
}

function traceTimestamp(
  epochMilliseconds: number,
  originEpochMilliseconds: number,
  path: string,
): number {
  const microseconds = (epochMilliseconds - originEpochMilliseconds) * 1_000;
  if (!Number.isFinite(microseconds) || microseconds < 0) {
    throw new RangeError(
      `${path} cannot be represented as a non-negative Chrome trace timestamp.`,
    );
  }
  return microseconds;
}

function traceDuration(durationMilliseconds: number, path: string): number {
  const microseconds = durationMilliseconds * 1_000;
  if (!Number.isFinite(microseconds) || microseconds < 0) {
    throw new RangeError(
      `${path} cannot be represented as a Chrome trace duration.`,
    );
  }
  return microseconds;
}

function traceArguments(
  operation: CausalTimelineOperation,
  retainedOperationIds: ReadonlySet<string>,
  retainedGroupId: string,
  includeAttributes: boolean,
): NativeCausalTraceArguments {
  const args: Record<string, NativeCausalTraceArgument> = {
    operation_id: operation.operationId,
    retained_group_id: retainedGroupId,
    status: operation.status ?? "active",
    retained_cause_count: operation.causes.filter((causeId) =>
      retainedOperationIds.has(causeId),
    ).length,
    unresolved_cause_count: operation.causes.filter(
      (causeId) => !retainedOperationIds.has(causeId),
    ).length,
  };
  if (includeAttributes) {
    for (const key of Object.keys(operation.startAttributes).sort()) {
      const value = operation.startAttributes[key];
      if (value !== undefined) args[`start.${key}`] = value;
    }
    if (operation.finishAttributes !== undefined) {
      for (const key of Object.keys(operation.finishAttributes).sort()) {
        const value = operation.finishAttributes[key];
        if (value !== undefined) args[`finish.${key}`] = value;
      }
    }
  }
  return Object.freeze(args);
}

function frozenTraceEvent<T extends NativeCausalTraceEvent>(event: T): T {
  return Object.freeze(event);
}

interface NativeCausalTraceLane {
  readonly tid: number;
  readonly name: string;
}

function operationTraceDurationMilliseconds(
  operation: CausalTimelineOperation,
  capturedAt: number,
): number {
  if (operation.duration !== undefined) return operation.duration;
  const duration = capturedAt - operation.startedAt;
  if (!Number.isFinite(duration) || duration < 0) {
    throw new RangeError(
      `Active causal operation ${JSON.stringify(operation.operationId)} starts after the snapshot capture time.`,
    );
  }
  return duration;
}

function createTraceLanes(
  operations: readonly CausalTimelineOperation[],
  capturedAt: number,
): Readonly<{
  lanes: readonly NativeCausalTraceLane[];
  threadByOperationId: ReadonlyMap<string, number>;
}> {
  const lanes: NativeCausalTraceLane[] = [];
  const threadByOperationId = new Map<string, number>();
  let nextThreadId = 1;
  for (const name of CAUSAL_DEBUG_OPERATION_NAMES) {
    const ordered = operations
      .map((operation, index) => ({ operation, index }))
      .filter(({ operation }) => operation.name === name)
      .sort(
        (left, right) =>
          left.operation.startedAt - right.operation.startedAt ||
          left.index - right.index,
      );
    const availableAt: number[] = [];
    for (const { operation } of ordered) {
      const duration = operationTraceDurationMilliseconds(
        operation,
        capturedAt,
      );
      const endsAt = operation.startedAt + duration;
      if (!Number.isFinite(endsAt)) {
        throw new RangeError(
          `Causal operation ${JSON.stringify(operation.operationId)} end time cannot be represented in a Chrome trace.`,
        );
      }
      let laneIndex = availableAt.findIndex(
        (candidate) => candidate <= operation.startedAt,
      );
      if (laneIndex === -1) {
        laneIndex = availableAt.length;
        availableAt.push(endsAt);
        const tid = nextThreadId;
        nextThreadId += 1;
        lanes.push(
          Object.freeze({
            tid,
            name: laneIndex === 0 ? name : `${name} #${laneIndex + 1}`,
          }),
        );
      } else {
        availableAt[laneIndex] = endsAt;
      }
      const lane = lanes[lanes.length - availableAt.length + laneIndex];
      if (lane === undefined) {
        throw new TypeError("Causal trace lane assignment failed.");
      }
      threadByOperationId.set(operation.operationId, lane.tid);
    }
  }
  return Object.freeze({
    lanes: Object.freeze(lanes),
    threadByOperationId,
  });
}

/**
 * Validates one detached snapshot and converts it to a deterministic Chrome
 * JSON trace. Perfetto renders the retained cause relationships as flow arrows.
 */
export function createNativeCausalTrace(
  value: unknown,
  options: CreateNativeCausalTraceOptions = {},
): NativeCausalTrace {
  const includeAttributes = validateIncludeAttributes(options);
  const snapshot = parseCausalDebugSnapshot(value);
  const originEpochMilliseconds = snapshot.operations.reduce(
    (origin, operation) => Math.min(origin, operation.startedAt),
    snapshot.capturedAt,
  );
  const operationIds = new Set(
    snapshot.operations.map((operation) => operation.operationId),
  );
  const groups = groupCausalTimelineSnapshot(snapshot);
  const groupIdByOperationId = new Map(
    groups.flatMap((group) =>
      group.operations.map(
        (operation) =>
          [operation.operationId, group.groupId] satisfies [string, string],
      ),
    ),
  );
  let retainedFlowCount = 0;
  for (const operation of snapshot.operations) {
    for (const causeId of operation.causes) {
      if (!operationIds.has(causeId)) continue;
      retainedFlowCount += 1;
      if (retainedFlowCount > NATIVE_CAUSAL_TRACE_MAX_FLOW_COUNT) {
        throw new RangeError(
          `The causal debug trace exceeds ${NATIVE_CAUSAL_TRACE_MAX_FLOW_COUNT} retained flows.`,
        );
      }
    }
  }
  const operationById = new Map(
    snapshot.operations.map((operation) => [operation.operationId, operation]),
  );
  const { lanes, threadByOperationId } = createTraceLanes(
    snapshot.operations,
    snapshot.capturedAt,
  );

  const events: NativeCausalTraceEvent[] = [
    frozenTraceEvent({
      name: "process_name",
      cat: "__metadata",
      ph: "M",
      pid: 1,
      tid: 0,
      args: Object.freeze({ name: "Solid Native causal trace" }),
    }),
    frozenTraceEvent({
      name: "thread_name",
      cat: "__metadata",
      ph: "M",
      pid: 1,
      tid: 0,
      args: Object.freeze({ name: "Snapshot" }),
    }),
  ];
  for (const lane of lanes) {
    events.push(
      frozenTraceEvent({
        name: "thread_name",
        cat: "__metadata",
        ph: "M",
        pid: 1,
        tid: lane.tid,
        args: Object.freeze({ name: lane.name }),
      }),
    );
  }

  events.push(
    frozenTraceEvent({
      name: "causal-debug-snapshot",
      cat: "solid-native.snapshot",
      ph: "I",
      pid: 1,
      tid: 0,
      ts: traceTimestamp(
        snapshot.capturedAt,
        originEpochMilliseconds,
        "Causal debug snapshot capturedAt",
      ),
      s: "t",
      args: Object.freeze({
        captured_at_epoch_ms: snapshot.capturedAt,
        operation_count: snapshot.operations.length,
        retained_group_count: groups.length,
        active_operation_count: snapshot.activeOperationCount,
        evicted_operation_count: snapshot.evictedOperationCount,
        discarded_record_count: snapshot.discardedRecordCount,
      }),
    }),
  );

  for (const group of groups) {
    const okOperationCount = group.operations.filter(
      (operation) => operation.status === "ok",
    ).length;
    events.push(
      frozenTraceEvent({
        name: "retained-causal-group",
        cat: "solid-native.group",
        ph: "I",
        pid: 1,
        tid: 0,
        ts: traceTimestamp(
          group.startedAt,
          originEpochMilliseconds,
          `Causal group ${JSON.stringify(group.groupId)} startedAt`,
        ),
        s: "t",
        args: Object.freeze({
          group_id: group.groupId,
          group_id_scope: "local-retained-component",
          operation_count: group.operations.length,
          active_operation_count: group.activeOperationCount,
          ok_operation_count: okOperationCount,
          error_operation_count: group.errorOperationCount,
          cancelled_operation_count: group.cancelledOperationCount,
          entry_operation_count: group.entryOperationIds.length,
          terminal_operation_count: group.terminalOperationIds.length,
          unresolved_cause_count: group.unresolvedCauseIds.length,
          ...(group.duration === undefined
            ? {}
            : { duration_ms: group.duration }),
        }),
      }),
    );
  }

  for (const operation of snapshot.operations) {
    const tid = threadByOperationId.get(operation.operationId);
    if (tid === undefined) {
      throw new TypeError(
        `Causal operation ${JSON.stringify(operation.name)} has no trace lane.`,
      );
    }
    const groupId = groupIdByOperationId.get(operation.operationId);
    if (groupId === undefined) {
      throw new TypeError(
        `Causal operation ${JSON.stringify(operation.operationId)} has no retained trace group.`,
      );
    }
    const base = {
      name: operation.name,
      cat: "solid-native.operation",
      pid: 1 as const,
      tid,
      ts: traceTimestamp(
        operation.startedAt,
        originEpochMilliseconds,
        `Causal operation ${JSON.stringify(operation.operationId)} startedAt`,
      ),
      args: traceArguments(operation, operationIds, groupId, includeAttributes),
    };
    events.push(
      frozenTraceEvent({
        ...base,
        ph: "X",
        dur: traceDuration(
          operationTraceDurationMilliseconds(operation, snapshot.capturedAt),
          `Causal operation ${JSON.stringify(operation.operationId)} duration`,
        ),
      }),
    );
  }

  let flowId = 1;
  for (const effect of snapshot.operations) {
    const effectTid = threadByOperationId.get(effect.operationId);
    if (effectTid === undefined) continue;
    for (const causeId of effect.causes) {
      const cause = operationById.get(causeId);
      if (cause === undefined) continue;
      const causeTid = threadByOperationId.get(cause.operationId);
      if (causeTid === undefined) continue;
      const args = Object.freeze({
        cause_operation_id: cause.operationId,
        effect_operation_id: effect.operationId,
      });
      events.push(
        frozenTraceEvent({
          name: "causes",
          cat: "solid-native.causality",
          ph: "s",
          pid: 1,
          tid: causeTid,
          ts: traceTimestamp(
            cause.startedAt,
            originEpochMilliseconds,
            `Causal operation ${JSON.stringify(cause.operationId)} startedAt`,
          ),
          id: flowId,
          args,
        }),
        frozenTraceEvent({
          name: "causes",
          cat: "solid-native.causality",
          ph: "f",
          pid: 1,
          tid: effectTid,
          ts: traceTimestamp(
            effect.startedAt,
            originEpochMilliseconds,
            `Causal operation ${JSON.stringify(effect.operationId)} startedAt`,
          ),
          id: flowId,
          bp: "e",
          args,
        }),
      );
      flowId += 1;
    }
  }
  return Object.freeze(events);
}

function operationSummary(
  operation: CausalTimelineOperation,
  includeAttributes: boolean,
): NativeCausalDebugOperationSummary {
  return Object.freeze({
    operationId: operation.operationId,
    name: operation.name,
    status: operation.status ?? "active",
    causes: Object.freeze([...operation.causes]),
    startedAt: operation.startedAt,
    ...(operation.finishedAt === undefined
      ? {}
      : { finishedAt: operation.finishedAt }),
    ...(operation.duration === undefined
      ? {}
      : { duration: operation.duration }),
    ...(includeAttributes
      ? {
          attributes: Object.freeze({
            start: operation.startAttributes,
            ...(operation.finishAttributes === undefined
              ? {}
              : { finish: operation.finishAttributes }),
          }),
        }
      : {}),
  });
}

function groupSummary(
  group: CausalTimelineGroup,
): NativeCausalDebugGroupSummary {
  const okOperationCount = group.operations.reduce(
    (count, operation) => count + (operation.status === "ok" ? 1 : 0),
    0,
  );
  return Object.freeze({
    groupId: group.groupId,
    operationIds: Object.freeze(
      group.operations.map((operation) => operation.operationId),
    ),
    operationNames: Object.freeze(
      group.operations.map((operation) => operation.name),
    ),
    entryOperationIds: Object.freeze([...group.entryOperationIds]),
    terminalOperationIds: Object.freeze([...group.terminalOperationIds]),
    unresolvedCauseIds: Object.freeze([...group.unresolvedCauseIds]),
    operationCount: group.operations.length,
    activeOperationCount: group.activeOperationCount,
    okOperationCount,
    errorOperationCount: group.errorOperationCount,
    cancelledOperationCount: group.cancelledOperationCount,
    startedAt: group.startedAt,
    ...(group.finishedAt === undefined ? {} : { finishedAt: group.finishedAt }),
    ...(group.duration === undefined ? {} : { duration: group.duration }),
  });
}

/** Validates and summarizes a detached causal graph without exposing attributes by default. */
export function inspectNativeCausalDebugSnapshot(
  value: unknown,
  rawOptions: InspectNativeCausalDebugSnapshotOptions = {},
): NativeCausalDebugInspection {
  const options = validateInspectionOptions(rawOptions);
  const snapshot = parseCausalDebugSnapshot(value);
  const groups = Object.freeze(
    groupCausalTimelineSnapshot(snapshot).map(groupSummary),
  );
  const operationCounts = Object.fromEntries(
    CAUSAL_DEBUG_OPERATION_NAMES.map((name) => [name, 0]),
  ) as Record<CausalOperationName, number>;
  const statusCounts = {
    active: 0,
    ok: 0,
    error: 0,
    cancelled: 0,
  };
  for (const operation of snapshot.operations) {
    operationCounts[operation.name] =
      (operationCounts[operation.name] ?? 0) + 1;
    statusCounts[operation.status ?? "active"] += 1;
  }

  let selection: NativeCausalDebugSelection | undefined;
  if (options.operationId !== undefined) {
    const explanation = explainCausalTimelineSnapshot(
      snapshot,
      options.operationId,
    );
    if (explanation === undefined) {
      throw new TypeError(
        `The causal debug snapshot does not contain operation ${JSON.stringify(options.operationId)}.`,
      );
    }
    const group = groups.find((candidate) =>
      candidate.operationIds.includes(explanation.target.operationId),
    );
    if (group === undefined) {
      throw new TypeError(
        `Causal operation ${JSON.stringify(explanation.target.operationId)} has no retained group.`,
      );
    }
    selection = Object.freeze({
      target: operationSummary(explanation.target, options.includeAttributes),
      groupId: group.groupId,
      ancestors: Object.freeze(
        explanation.ancestors.map((operation) =>
          operationSummary(operation, options.includeAttributes),
        ),
      ),
      descendants: Object.freeze(
        explanation.descendants.map((operation) =>
          operationSummary(operation, options.includeAttributes),
        ),
      ),
      unresolvedCauseIds: Object.freeze([...explanation.unresolvedCauseIds]),
    });
  }

  return Object.freeze({
    kind: "solid-native.causal-debug-inspection",
    schemaVersion: 1,
    capturedAt: snapshot.capturedAt,
    operationCount: snapshot.operations.length,
    groupCount: groups.length,
    activeOperationCount: snapshot.activeOperationCount,
    evictedOperationCount: snapshot.evictedOperationCount,
    discardedRecordCount: snapshot.discardedRecordCount,
    operationCounts: Object.freeze(operationCounts),
    statusCounts: Object.freeze(statusCounts),
    groups,
    ...(selection === undefined ? {} : { selection }),
  });
}

/** Strictly decodes and validates one bounded transport-delivered snapshot. */
export function parseNativeCausalDebugSnapshotBytes(
  bytes: Uint8Array,
): CausalDebugSnapshot {
  if (bytes.byteLength > NATIVE_CAUSAL_DEBUG_MAX_INPUT_BYTES) {
    throw new RangeError(
      `The causal debug snapshot exceeds ${NATIVE_CAUSAL_DEBUG_MAX_INPUT_BYTES} bytes.`,
    );
  }
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new TypeError("The causal debug snapshot must be valid UTF-8.");
  }
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    throw new TypeError("The causal debug snapshot must contain valid JSON.");
  }
  return parseCausalDebugSnapshot(value);
}

async function readBoundedSnapshotFile(filePath: string): Promise<Uint8Array> {
  const handle = await open(filePath, "r");
  try {
    const file = await handle.stat();
    if (!file.isFile()) {
      throw new TypeError("The causal debug snapshot path must be a file.");
    }
    if (file.size > NATIVE_CAUSAL_DEBUG_MAX_INPUT_BYTES) {
      throw new RangeError(
        `The causal debug snapshot exceeds ${NATIVE_CAUSAL_DEBUG_MAX_INPUT_BYTES} bytes.`,
      );
    }
    const buffer = Buffer.allocUnsafe(NATIVE_CAUSAL_DEBUG_MAX_INPUT_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        null,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > NATIVE_CAUSAL_DEBUG_MAX_INPUT_BYTES) {
      throw new RangeError(
        `The causal debug snapshot exceeds ${NATIVE_CAUSAL_DEBUG_MAX_INPUT_BYTES} bytes.`,
      );
    }
    return buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

export async function readNativeCausalDebugSnapshotFile(
  snapshotPath: string,
  cwd: string = process.cwd(),
): Promise<CausalDebugSnapshot> {
  if (typeof snapshotPath !== "string" || snapshotPath.length === 0) {
    throw new TypeError(
      "Causal debug snapshotPath must be a non-empty string.",
    );
  }
  const bytes = await readBoundedSnapshotFile(path.resolve(cwd, snapshotPath));
  return parseNativeCausalDebugSnapshotBytes(bytes);
}

/** Reads one bounded local handoff and returns a path-free inspection report. */
export async function inspectNativeCausalDebugFile(
  options: InspectNativeCausalDebugFileOptions,
): Promise<NativeCausalDebugInspection> {
  return inspectNativeCausalDebugSnapshot(
    await readNativeCausalDebugSnapshotFile(options.snapshotPath, options.cwd),
    options,
  );
}

/** Reads one bounded local handoff and converts it to a path-free trace. */
export async function createNativeCausalTraceFile(
  options: CreateNativeCausalTraceFileOptions,
): Promise<NativeCausalTrace> {
  return createNativeCausalTrace(
    await readNativeCausalDebugSnapshotFile(options.snapshotPath, options.cwd),
    options,
  );
}

export async function readNativeCausalDebugSnapshotStream(
  stream: NativeCausalDebugInputStream,
): Promise<CausalDebugSnapshot> {
  if (
    stream === null ||
    (typeof stream !== "object" && typeof stream !== "function") ||
    typeof stream[Symbol.asyncIterator] !== "function"
  ) {
    throw new TypeError("Causal debug input stream must be async iterable.");
  }
  const chunks: Buffer[] = [];
  let byteLength = 0;
  for await (const chunk of stream) {
    let bytes: Buffer;
    if (typeof chunk === "string") bytes = Buffer.from(chunk, "utf8");
    else if (chunk instanceof Uint8Array) bytes = Buffer.from(chunk);
    else {
      throw new TypeError(
        "Causal debug input stream chunks must be strings or Uint8Array values.",
      );
    }
    byteLength += bytes.byteLength;
    if (byteLength > NATIVE_CAUSAL_DEBUG_MAX_INPUT_BYTES) {
      throw new RangeError(
        `The causal debug snapshot exceeds ${NATIVE_CAUSAL_DEBUG_MAX_INPUT_BYTES} bytes.`,
      );
    }
    chunks.push(bytes);
  }
  return parseNativeCausalDebugSnapshotBytes(Buffer.concat(chunks, byteLength));
}

/** Consumes one bounded byte stream, suitable for a pipe from a device channel. */
export async function inspectNativeCausalDebugStream(
  stream: NativeCausalDebugInputStream,
  options: InspectNativeCausalDebugSnapshotOptions = {},
): Promise<NativeCausalDebugInspection> {
  return inspectNativeCausalDebugSnapshot(
    await readNativeCausalDebugSnapshotStream(stream),
    options,
  );
}

/** Consumes one bounded byte stream and returns a Perfetto-compatible trace. */
export async function createNativeCausalTraceStream(
  stream: NativeCausalDebugInputStream,
  options: CreateNativeCausalTraceOptions = {},
): Promise<NativeCausalTrace> {
  return createNativeCausalTrace(
    await readNativeCausalDebugSnapshotStream(stream),
    options,
  );
}

function formatCapturedAt(value: number): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

export function formatNativeCausalDebugInspection(
  inspection: NativeCausalDebugInspection,
): string {
  const operationCounts = Object.entries(inspection.operationCounts)
    .filter(([, count]) => count > 0)
    .map(([name, count]) => `${name}: ${String(count)}`)
    .join(", ");
  const lines = [
    "PASS Solid Native causal debug snapshot",
    `Captured: ${formatCapturedAt(inspection.capturedAt)}`,
    `Operations: ${inspection.operationCount} (${inspection.activeOperationCount} active, ${inspection.evictedOperationCount} evicted, ${inspection.discardedRecordCount} discarded records)`,
    `Groups: ${inspection.groupCount} retained causal ${inspection.groupCount === 1 ? "group" : "groups"}`,
    `Statuses: ${inspection.statusCounts.ok} ok, ${inspection.statusCounts.error} error, ${inspection.statusCounts.cancelled} cancelled, ${inspection.statusCounts.active} active`,
    `Kinds: ${operationCounts === "" ? "none" : operationCounts}`,
  ];
  if (inspection.selection !== undefined) {
    const selected = inspection.selection;
    lines.push(
      `Selected: ${selected.target.operationId} (${selected.target.name}, ${selected.target.status})`,
      `Selected group: ${selected.groupId}`,
      `Causal graph: ${selected.ancestors.length} retained ancestors, ${selected.descendants.length} retained descendants, ${selected.unresolvedCauseIds.length} unresolved causes`,
    );
    if (selected.target.attributes !== undefined) {
      lines.push(
        `Start attributes: ${JSON.stringify(selected.target.attributes.start)}`,
      );
      if (selected.target.attributes.finish !== undefined) {
        lines.push(
          `Finish attributes: ${JSON.stringify(selected.target.attributes.finish)}`,
        );
      }
    }
  }
  return lines.join("\n");
}
