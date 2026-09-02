import {
  CAUSAL_DEBUG_OPERATION_NAMES,
  groupCausalTimelineSnapshot,
  parseCausalDebugSnapshot,
  type CausalDebugSnapshot,
  type CausalOperationName,
  type CausalTimelineOperation,
} from "@solid-native/observability";

import { readNativeCausalDebugSnapshotFile } from "./causal-debug.js";

export interface NativeCausalDebugComparisonOptions {
  /**
   * Marks a p95 duration increase above this percentage as a regression.
   * Duration changes remain informational when the threshold is omitted.
   */
  readonly maxP95RegressionPercent?: number;
}

export interface NativeCausalDebugComparisonFileOptions extends NativeCausalDebugComparisonOptions {
  readonly baselinePath: string;
  readonly candidatePath: string;
  readonly cwd?: string;
}

export interface NativeCausalDebugStatusCounts {
  readonly active: number;
  readonly ok: number;
  readonly error: number;
  readonly cancelled: number;
}

export interface NativeCausalDebugComparisonSnapshotSummary {
  readonly capturedAt: number;
  readonly operationCount: number;
  readonly groupCount: number;
  readonly isolatedGroupCount: number;
  readonly largestGroupOperationCount: number;
  readonly activeOperationCount: number;
  readonly evictedOperationCount: number;
  readonly discardedRecordCount: number;
  readonly unresolvedCauseCount: number;
  readonly statusCounts: NativeCausalDebugStatusCounts;
  readonly operationCounts: Readonly<Record<CausalOperationName, number>>;
}

export interface NativeCausalDebugDurationDistribution {
  /** Only successfully completed operations contribute duration samples. */
  readonly sampleCount: number;
  readonly total: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

export interface NativeCausalDebugOperationComparison {
  readonly baselineCount: number;
  readonly candidateCount: number;
  readonly countDelta: number;
  readonly baselineErrorCount: number;
  readonly candidateErrorCount: number;
  readonly errorCountDelta: number;
  readonly baselineDuration?: NativeCausalDebugDurationDistribution;
  readonly candidateDuration?: NativeCausalDebugDurationDistribution;
  readonly p95Delta?: number;
  readonly p95DeltaPercent?: number;
  readonly p95Regression: boolean;
}

export type NativeCausalDebugRegressionMetric =
  | "error-count"
  | "evicted-operation-count"
  | "discarded-record-count"
  | "unresolved-cause-count"
  | "retained-group-count"
  | "p95-duration";

export interface NativeCausalDebugRegression {
  readonly metric: NativeCausalDebugRegressionMetric;
  readonly baselineValue: number;
  readonly candidateValue: number;
  readonly operationName?: CausalOperationName;
  readonly thresholdPercent?: number;
  readonly deltaPercent?: number;
}

export interface NativeCausalDebugComparison {
  readonly kind: "solid-native.causal-debug-comparison";
  readonly schemaVersion: 1;
  readonly ok: boolean;
  readonly maxP95RegressionPercent?: number;
  readonly baseline: NativeCausalDebugComparisonSnapshotSummary;
  readonly candidate: NativeCausalDebugComparisonSnapshotSummary;
  readonly operations: Readonly<
    Record<CausalOperationName, NativeCausalDebugOperationComparison>
  >;
  readonly regressions: readonly NativeCausalDebugRegression[];
}

function comparisonOptions(
  options: NativeCausalDebugComparisonOptions,
): Readonly<{ maxP95RegressionPercent?: number }> {
  const threshold = options.maxP95RegressionPercent;
  if (
    threshold !== undefined &&
    (typeof threshold !== "number" ||
      !Number.isFinite(threshold) ||
      threshold < 0 ||
      threshold > 10_000)
  ) {
    throw new TypeError(
      "Causal debug maxP95RegressionPercent must be a finite number from 0 through 10000.",
    );
  }
  return Object.freeze(
    threshold === undefined ? {} : { maxP95RegressionPercent: threshold },
  );
}

function finiteDelta(
  candidate: number,
  baseline: number,
  path: string,
): number {
  const delta = candidate - baseline;
  if (!Number.isFinite(delta)) {
    throw new RangeError(`${path} delta cannot be represented as a number.`);
  }
  return delta;
}

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.ceil(sorted.length * fraction) - 1]!;
}

function durationDistribution(
  operations: readonly CausalTimelineOperation[],
): NativeCausalDebugDurationDistribution | undefined {
  const durations = operations
    .flatMap((operation) =>
      operation.status !== "ok" || operation.duration === undefined
        ? []
        : [operation.duration],
    )
    .sort((left, right) => left - right);
  if (durations.length === 0) return undefined;
  let total = 0;
  for (const duration of durations) {
    total += duration;
    if (!Number.isFinite(total)) {
      throw new RangeError(
        "Causal debug duration total cannot be represented as a number.",
      );
    }
  }
  return Object.freeze({
    sampleCount: durations.length,
    total,
    p50: percentile(durations, 0.5),
    p95: percentile(durations, 0.95),
    max: durations[durations.length - 1]!,
  });
}

function snapshotSummary(
  snapshot: CausalDebugSnapshot,
): NativeCausalDebugComparisonSnapshotSummary {
  const groups = groupCausalTimelineSnapshot(snapshot);
  const operationCounts = Object.fromEntries(
    CAUSAL_DEBUG_OPERATION_NAMES.map((name) => [name, 0]),
  ) as Record<CausalOperationName, number>;
  const statusCounts = { active: 0, ok: 0, error: 0, cancelled: 0 };
  const retainedIds = new Set(
    snapshot.operations.map((operation) => operation.operationId),
  );
  let unresolvedCauseCount = 0;
  for (const operation of snapshot.operations) {
    operationCounts[operation.name] += 1;
    statusCounts[operation.status ?? "active"] += 1;
    unresolvedCauseCount += operation.causes.filter(
      (causeId) => !retainedIds.has(causeId),
    ).length;
  }
  return Object.freeze({
    capturedAt: snapshot.capturedAt,
    operationCount: snapshot.operations.length,
    groupCount: groups.length,
    isolatedGroupCount: groups.filter((group) => group.operations.length === 1)
      .length,
    largestGroupOperationCount: groups.reduce(
      (maximum, group) => Math.max(maximum, group.operations.length),
      0,
    ),
    activeOperationCount: snapshot.activeOperationCount,
    evictedOperationCount: snapshot.evictedOperationCount,
    discardedRecordCount: snapshot.discardedRecordCount,
    unresolvedCauseCount,
    statusCounts: Object.freeze(statusCounts),
    operationCounts: Object.freeze(operationCounts),
  });
}

function errorCount(operations: readonly CausalTimelineOperation[]): number {
  return operations.filter((operation) => operation.status === "error").length;
}

function frozenRegression(
  regression: NativeCausalDebugRegression,
): NativeCausalDebugRegression {
  return Object.freeze(regression);
}

/**
 * Compares two validated snapshots without reading application-authored
 * attributes or assuming that operation IDs are stable between executions.
 */
export function compareNativeCausalDebugSnapshots(
  baselineValue: unknown,
  candidateValue: unknown,
  rawOptions: NativeCausalDebugComparisonOptions = {},
): NativeCausalDebugComparison {
  const options = comparisonOptions(rawOptions);
  const baselineSnapshot = parseCausalDebugSnapshot(baselineValue);
  const candidateSnapshot = parseCausalDebugSnapshot(candidateValue);
  const baseline = snapshotSummary(baselineSnapshot);
  const candidate = snapshotSummary(candidateSnapshot);
  const regressions: NativeCausalDebugRegression[] = [];
  const operations = {} as Record<
    CausalOperationName,
    NativeCausalDebugOperationComparison
  >;

  for (const name of CAUSAL_DEBUG_OPERATION_NAMES) {
    const baselineOperations = baselineSnapshot.operations.filter(
      (operation) => operation.name === name,
    );
    const candidateOperations = candidateSnapshot.operations.filter(
      (operation) => operation.name === name,
    );
    const baselineErrors = errorCount(baselineOperations);
    const candidateErrors = errorCount(candidateOperations);
    if (candidateErrors > baselineErrors) {
      regressions.push(
        frozenRegression({
          metric: "error-count",
          operationName: name,
          baselineValue: baselineErrors,
          candidateValue: candidateErrors,
        }),
      );
    }
    const baselineDuration = durationDistribution(baselineOperations);
    const candidateDuration = durationDistribution(candidateOperations);
    let p95Delta: number | undefined;
    let p95DeltaPercent: number | undefined;
    let p95Regression = false;
    if (baselineDuration !== undefined && candidateDuration !== undefined) {
      p95Delta = finiteDelta(
        candidateDuration.p95,
        baselineDuration.p95,
        `${name} p95 duration`,
      );
      if (baselineDuration.p95 !== 0) {
        p95DeltaPercent = (p95Delta / baselineDuration.p95) * 100;
        if (!Number.isFinite(p95DeltaPercent)) {
          throw new RangeError(
            `${name} p95 duration percentage cannot be represented as a number.`,
          );
        }
      }
      if (
        options.maxP95RegressionPercent !== undefined &&
        p95Delta > 0 &&
        (p95DeltaPercent === undefined ||
          p95DeltaPercent > options.maxP95RegressionPercent)
      ) {
        p95Regression = true;
        regressions.push(
          frozenRegression({
            metric: "p95-duration",
            operationName: name,
            baselineValue: baselineDuration.p95,
            candidateValue: candidateDuration.p95,
            thresholdPercent: options.maxP95RegressionPercent,
            ...(p95DeltaPercent === undefined
              ? {}
              : { deltaPercent: p95DeltaPercent }),
          }),
        );
      }
    }
    operations[name] = Object.freeze({
      baselineCount: baselineOperations.length,
      candidateCount: candidateOperations.length,
      countDelta: candidateOperations.length - baselineOperations.length,
      baselineErrorCount: baselineErrors,
      candidateErrorCount: candidateErrors,
      errorCountDelta: candidateErrors - baselineErrors,
      ...(baselineDuration === undefined ? {} : { baselineDuration }),
      ...(candidateDuration === undefined ? {} : { candidateDuration }),
      ...(p95Delta === undefined ? {} : { p95Delta }),
      ...(p95DeltaPercent === undefined ? {} : { p95DeltaPercent }),
      p95Regression,
    });
  }

  for (const [metric, baselineValue, candidateValue] of [
    [
      "evicted-operation-count",
      baseline.evictedOperationCount,
      candidate.evictedOperationCount,
    ],
    [
      "discarded-record-count",
      baseline.discardedRecordCount,
      candidate.discardedRecordCount,
    ],
    [
      "unresolved-cause-count",
      baseline.unresolvedCauseCount,
      candidate.unresolvedCauseCount,
    ],
  ] as const) {
    if (candidateValue > baselineValue) {
      regressions.push(
        frozenRegression({ metric, baselineValue, candidateValue }),
      );
    }
  }

  const sameOperationShape = CAUSAL_DEBUG_OPERATION_NAMES.every(
    (name) =>
      baseline.operationCounts[name] === candidate.operationCounts[name],
  );
  if (sameOperationShape && candidate.groupCount > baseline.groupCount) {
    regressions.push(
      frozenRegression({
        metric: "retained-group-count",
        baselineValue: baseline.groupCount,
        candidateValue: candidate.groupCount,
      }),
    );
  }

  return Object.freeze({
    kind: "solid-native.causal-debug-comparison",
    schemaVersion: 1,
    ok: regressions.length === 0,
    ...(options.maxP95RegressionPercent === undefined
      ? {}
      : { maxP95RegressionPercent: options.maxP95RegressionPercent }),
    baseline,
    candidate,
    operations: Object.freeze(operations),
    regressions: Object.freeze(regressions),
  });
}

/** Reads and compares two bounded local causal snapshot handoffs. */
export async function compareNativeCausalDebugFiles(
  options: NativeCausalDebugComparisonFileOptions,
): Promise<NativeCausalDebugComparison> {
  const [baseline, candidate] = await Promise.all([
    readNativeCausalDebugSnapshotFile(options.baselinePath, options.cwd),
    readNativeCausalDebugSnapshotFile(options.candidatePath, options.cwd),
  ]);
  return compareNativeCausalDebugSnapshots(baseline, candidate, options);
}

function duration(value: number): string {
  return `${value.toFixed(3)} ms`;
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(3)}`;
}

export function formatNativeCausalDebugComparison(
  comparison: NativeCausalDebugComparison,
): string {
  const lines = [
    `${comparison.ok ? "PASS" : "FAIL"} Solid Native causal debug comparison`,
    `Operations: ${comparison.baseline.operationCount} -> ${comparison.candidate.operationCount} (${comparison.candidate.operationCount - comparison.baseline.operationCount >= 0 ? "+" : ""}${comparison.candidate.operationCount - comparison.baseline.operationCount})`,
    `Statuses: errors ${comparison.baseline.statusCounts.error} -> ${comparison.candidate.statusCounts.error}, active ${comparison.baseline.statusCounts.active} -> ${comparison.candidate.statusCounts.active}, cancelled ${comparison.baseline.statusCounts.cancelled} -> ${comparison.candidate.statusCounts.cancelled}`,
    `Graph quality: groups ${comparison.baseline.groupCount} -> ${comparison.candidate.groupCount} (isolated ${comparison.baseline.isolatedGroupCount} -> ${comparison.candidate.isolatedGroupCount}, largest ${comparison.baseline.largestGroupOperationCount} -> ${comparison.candidate.largestGroupOperationCount}), unresolved ${comparison.baseline.unresolvedCauseCount} -> ${comparison.candidate.unresolvedCauseCount}, evicted ${comparison.baseline.evictedOperationCount} -> ${comparison.candidate.evictedOperationCount}, discarded ${comparison.baseline.discardedRecordCount} -> ${comparison.candidate.discardedRecordCount}`,
  ];
  const durations = CAUSAL_DEBUG_OPERATION_NAMES.flatMap((name) => {
    const operation = comparison.operations[name];
    if (
      operation.baselineDuration === undefined ||
      operation.candidateDuration === undefined ||
      operation.p95Delta === undefined
    ) {
      return [];
    }
    const percent =
      operation.p95DeltaPercent === undefined
        ? "baseline zero"
        : `${signed(operation.p95DeltaPercent)}%`;
    return [
      `${name}: p95 ${duration(operation.baselineDuration.p95)} -> ${duration(operation.candidateDuration.p95)} (${signed(operation.p95Delta)} ms, ${percent}; n=${operation.baselineDuration.sampleCount}->${operation.candidateDuration.sampleCount})${operation.p95Regression ? " [REGRESSION]" : ""}`,
    ];
  });
  lines.push(
    `Duration p95:${durations.length === 0 ? " no comparable samples" : ""}`,
  );
  lines.push(...durations.map((line) => `  ${line}`));
  if (comparison.regressions.length === 0) {
    lines.push("Regressions: none");
  } else {
    lines.push(`Regressions: ${comparison.regressions.length}`);
    for (const regression of comparison.regressions) {
      lines.push(
        `  ${regression.metric}${regression.operationName === undefined ? "" : ` (${regression.operationName})`}: ${regression.baselineValue} -> ${regression.candidateValue}`,
      );
    }
  }
  return lines.join("\n");
}
