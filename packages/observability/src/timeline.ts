import type {
  CausalOperationFinished,
  CausalOperationId,
  CausalOperationName,
  CausalTelemetryRecord,
  CausalTelemetrySink,
  TelemetryAttributes,
} from "./index.js";

export const DEFAULT_CAUSAL_TIMELINE_CAPACITY = 1_000;

export interface CausalTimelineOperation {
  readonly operationId: CausalOperationId;
  readonly name: CausalOperationName;
  readonly causes: readonly CausalOperationId[];
  readonly startedAt: number;
  readonly startAttributes: TelemetryAttributes;
  readonly finishedAt?: number;
  readonly duration?: number;
  readonly status?: CausalOperationFinished["status"];
  readonly finishAttributes?: TelemetryAttributes;
}

export interface CausalTimelineSnapshot {
  readonly operations: readonly CausalTimelineOperation[];
  readonly activeOperationCount: number;
  readonly evictedOperationCount: number;
  readonly discardedRecordCount: number;
}

export interface CausalTimelineExplanation {
  readonly target: CausalTimelineOperation;
  /** Retained transitive causes in timeline order, excluding the target. */
  readonly ancestors: readonly CausalTimelineOperation[];
  /** Retained transitive effects in timeline order, excluding the target. */
  readonly descendants: readonly CausalTimelineOperation[];
  /** Cause IDs referenced by the explanation but absent from the timeline. */
  readonly unresolvedCauseIds: readonly CausalOperationId[];
}

/** One retained weakly connected component of the causal operation graph. */
export interface CausalTimelineGroup {
  /** Earliest retained operation ID; local identity, not a distributed trace ID. */
  readonly groupId: CausalOperationId;
  readonly operations: readonly CausalTimelineOperation[];
  /** Retained operations with no retained incoming edge in this group. */
  readonly entryOperationIds: readonly CausalOperationId[];
  /** Retained operations with no retained outgoing edge in this group. */
  readonly terminalOperationIds: readonly CausalOperationId[];
  /** External or evicted cause IDs referenced by operations in this group. */
  readonly unresolvedCauseIds: readonly CausalOperationId[];
  readonly activeOperationCount: number;
  readonly errorOperationCount: number;
  readonly cancelledOperationCount: number;
  readonly startedAt: number;
  readonly finishedAt?: number;
  readonly duration?: number;
}

export interface CausalTimeline {
  readonly sink: CausalTelemetrySink;
  snapshot(): CausalTimelineSnapshot;
  explain(
    operationId: CausalOperationId,
  ): CausalTimelineExplanation | undefined;
  clear(): void;
}

export interface CausalTimelineOptions {
  readonly capacity?: number;
}

interface TimelineFinish {
  readonly timestamp: number;
  readonly duration: number;
  readonly status: CausalOperationFinished["status"];
  readonly attributes: TelemetryAttributes;
}

interface TimelineEntry {
  readonly operationId: CausalOperationId;
  readonly name: CausalOperationName;
  readonly causes: readonly CausalOperationId[];
  readonly startedAt: number;
  readonly attributes: TelemetryAttributes;
  finish?: TimelineFinish;
}

function snapshotOperation(entry: TimelineEntry): CausalTimelineOperation {
  const base = {
    operationId: entry.operationId,
    name: entry.name,
    causes: [...entry.causes],
    startedAt: entry.startedAt,
    startAttributes: { ...entry.attributes },
  };
  if (entry.finish === undefined) return base;
  return {
    ...base,
    finishedAt: entry.finish.timestamp,
    duration: entry.finish.duration,
    status: entry.finish.status,
    finishAttributes: { ...entry.finish.attributes },
  };
}

function copyOperation(
  operation: CausalTimelineOperation,
): CausalTimelineOperation {
  return {
    operationId: operation.operationId,
    name: operation.name,
    causes: [...operation.causes],
    startedAt: operation.startedAt,
    startAttributes: { ...operation.startAttributes },
    ...(operation.finishedAt === undefined
      ? {}
      : { finishedAt: operation.finishedAt }),
    ...(operation.duration === undefined
      ? {}
      : { duration: operation.duration }),
    ...(operation.status === undefined ? {} : { status: operation.status }),
    ...(operation.finishAttributes === undefined
      ? {}
      : { finishAttributes: { ...operation.finishAttributes } }),
  };
}

function explainOperations(
  operations: readonly CausalTimelineOperation[],
  operationId: CausalOperationId,
): CausalTimelineExplanation | undefined {
  const operationsById = new Map(
    operations.map((operation) => [operation.operationId, operation]),
  );
  const childrenById = new Map<CausalOperationId, CausalOperationId[]>();
  for (const operation of operations) {
    for (const causeId of operation.causes) {
      const children = childrenById.get(causeId) ?? [];
      children.push(operation.operationId);
      childrenById.set(causeId, children);
    }
  }

  const target = operationsById.get(operationId);
  if (target === undefined) return undefined;

  const ancestorIds = new Set<CausalOperationId>();
  const pendingCauses = [...target.causes];
  for (let index = 0; index < pendingCauses.length; index++) {
    const causeId = pendingCauses[index];
    if (causeId === undefined || ancestorIds.has(causeId)) continue;
    const cause = operationsById.get(causeId);
    if (cause === undefined) continue;
    if (causeId === operationId) continue;
    ancestorIds.add(causeId);
    pendingCauses.push(...cause.causes);
  }

  const descendantIds = new Set<CausalOperationId>();
  const pendingChildren = [...(childrenById.get(operationId) ?? [])];
  for (let index = 0; index < pendingChildren.length; index++) {
    const childId = pendingChildren[index];
    if (
      childId === undefined ||
      childId === operationId ||
      descendantIds.has(childId)
    ) {
      continue;
    }
    descendantIds.add(childId);
    pendingChildren.push(...(childrenById.get(childId) ?? []));
  }

  const includedIds = new Set([operationId, ...ancestorIds, ...descendantIds]);
  const unresolvedCauseIds = new Set<CausalOperationId>();
  for (const operation of operations) {
    if (!includedIds.has(operation.operationId)) continue;
    for (const causeId of operation.causes) {
      if (!operationsById.has(causeId)) unresolvedCauseIds.add(causeId);
    }
  }

  const select = (ids: ReadonlySet<CausalOperationId>) =>
    operations.filter((operation) => ids.has(operation.operationId));
  return {
    target,
    ancestors: select(ancestorIds),
    descendants: select(descendantIds),
    unresolvedCauseIds: [...unresolvedCauseIds],
  };
}

/** Explains a selected operation from a detached local-debugger snapshot. */
export function explainCausalTimelineSnapshot(
  snapshot: CausalTimelineSnapshot,
  operationId: CausalOperationId,
): CausalTimelineExplanation | undefined {
  return explainOperations(snapshot.operations.map(copyOperation), operationId);
}

/**
 * Groups a detached snapshot into retained causal components. Operations that
 * share the same unresolved cause remain together after that cause is evicted.
 */
export function groupCausalTimelineSnapshot(
  snapshot: CausalTimelineSnapshot,
): readonly CausalTimelineGroup[] {
  const operations = snapshot.operations.map(copyOperation);
  if (operations.length === 0) return [];

  const parents = operations.map((_operation, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parents[root] !== root) root = parents[root] as number;
    while (parents[index] !== index) {
      const next = parents[index] as number;
      parents[index] = root;
      index = next;
    }
    return root;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    if (leftRoot < rightRoot) parents[rightRoot] = leftRoot;
    else parents[leftRoot] = rightRoot;
  };

  const operationIndexById = new Map(
    operations.map((operation, index) => [operation.operationId, index]),
  );
  const firstConsumerByUnresolvedCause = new Map<CausalOperationId, number>();
  for (const [operationIndex, operation] of operations.entries()) {
    for (const causeId of operation.causes) {
      const causeIndex = operationIndexById.get(causeId);
      if (causeIndex !== undefined) {
        union(operationIndex, causeIndex);
        continue;
      }
      const firstConsumer = firstConsumerByUnresolvedCause.get(causeId);
      if (firstConsumer === undefined) {
        firstConsumerByUnresolvedCause.set(causeId, operationIndex);
      } else {
        union(operationIndex, firstConsumer);
      }
    }
  }

  const indicesByGroup = new Map<number, number[]>();
  for (const operationIndex of operations.keys()) {
    const root = find(operationIndex);
    const indices = indicesByGroup.get(root) ?? [];
    indices.push(operationIndex);
    indicesByGroup.set(root, indices);
  }

  return [...indicesByGroup.values()].map((indices) => {
    const groupedOperations = indices.map(
      (operationIndex) => operations[operationIndex] as CausalTimelineOperation,
    );
    const groupedIds = new Set(
      groupedOperations.map((operation) => operation.operationId),
    );
    const referencedIds = new Set<CausalOperationId>();
    const unresolvedCauseIds = new Set<CausalOperationId>();
    let activeOperationCount = 0;
    let errorOperationCount = 0;
    let cancelledOperationCount = 0;
    let startedAt = Number.POSITIVE_INFINITY;
    let finishedAt = Number.NEGATIVE_INFINITY;
    for (const operation of groupedOperations) {
      startedAt = Math.min(startedAt, operation.startedAt);
      if (operation.finishedAt === undefined) activeOperationCount++;
      else finishedAt = Math.max(finishedAt, operation.finishedAt);
      if (operation.status === "error") errorOperationCount++;
      if (operation.status === "cancelled") cancelledOperationCount++;
      for (const causeId of operation.causes) {
        if (groupedIds.has(causeId)) referencedIds.add(causeId);
        else unresolvedCauseIds.add(causeId);
      }
    }
    const entryOperationIds = groupedOperations
      .filter((operation) =>
        operation.causes.every((causeId) => !groupedIds.has(causeId)),
      )
      .map((operation) => operation.operationId);
    const terminalOperationIds = groupedOperations
      .filter((operation) => !referencedIds.has(operation.operationId))
      .map((operation) => operation.operationId);
    const complete = activeOperationCount === 0;
    return {
      groupId: (groupedOperations[0] as CausalTimelineOperation).operationId,
      operations: groupedOperations,
      entryOperationIds,
      terminalOperationIds,
      unresolvedCauseIds: [...unresolvedCauseIds],
      activeOperationCount,
      errorOperationCount,
      cancelledOperationCount,
      startedAt,
      ...(complete
        ? {
            finishedAt,
            duration: Math.max(0, finishedAt - startedAt),
          }
        : {}),
    };
  });
}

/** Creates a bounded, privacy-preserving timeline suitable for local tools. */
export function createCausalTimeline(
  options: CausalTimelineOptions = {},
): CausalTimeline {
  const capacity = options.capacity ?? DEFAULT_CAUSAL_TIMELINE_CAPACITY;
  if (!Number.isSafeInteger(capacity) || capacity <= 0) {
    throw new RangeError(
      "Causal timeline capacity must be a positive integer.",
    );
  }

  const entries = new Map<CausalOperationId, TimelineEntry>();
  let evictedOperationCount = 0;
  let discardedRecordCount = 0;

  const sink = (record: CausalTelemetryRecord): void => {
    if (record.type === "operation-started") {
      if (entries.has(record.operationId)) {
        discardedRecordCount++;
        return;
      }
      while (entries.size >= capacity) {
        const oldest = entries.keys().next();
        if (!oldest.done) {
          entries.delete(oldest.value);
          evictedOperationCount++;
        }
      }
      entries.set(record.operationId, {
        operationId: record.operationId,
        name: record.name,
        causes: [...record.causes],
        startedAt: record.timestamp,
        attributes: { ...record.attributes },
      });
      return;
    }

    const entry = entries.get(record.operationId);
    if (
      entry === undefined ||
      entry.finish !== undefined ||
      entry.name !== record.name
    ) {
      discardedRecordCount++;
      return;
    }
    entry.finish = {
      timestamp: record.timestamp,
      duration: record.duration,
      status: record.status,
      attributes: { ...record.attributes },
    };
  };

  return {
    sink,
    snapshot() {
      let activeOperationCount = 0;
      const operations: CausalTimelineOperation[] = [];
      for (const entry of entries.values()) {
        if (entry.finish === undefined) activeOperationCount++;
        operations.push(snapshotOperation(entry));
      }
      return {
        operations,
        activeOperationCount,
        evictedOperationCount,
        discardedRecordCount,
      };
    },
    explain(operationId) {
      const operations = [...entries.values()].map(snapshotOperation);
      return explainOperations(operations, operationId);
    },
    clear() {
      entries.clear();
      evictedOperationCount = 0;
      discardedRecordCount = 0;
    },
  };
}
