import {
  parseCausalDebugSnapshot,
  type CausalDebugSnapshot,
} from "./debug-snapshot.js";
import {
  parseSolidDiagnosticsDebugEnvelope,
  type SolidDiagnosticsDebugCause,
} from "./diagnostics-debug.js";
import type { CausalTimelineOperation } from "./timeline.js";

export const NATIVE_SOLID_DIAGNOSTICS_CORRELATION_KIND =
  "solid-native.solid-diagnostics-correlation" as const;
export const NATIVE_SOLID_DIAGNOSTICS_CORRELATION_SCHEMA_VERSION = 0 as const;
export const NATIVE_SOLID_DIAGNOSTICS_CORRELATION_MODE =
  "static-name-and-capture-window" as const;
export const NATIVE_SOLID_DIAGNOSTICS_CORRELATION_WINDOW_TOLERANCE_MS = 250;

export interface NativeSolidDiagnosticsCorrelatedOutput {
  readonly name: string;
  readonly rerunCount: number;
  readonly changedRerunCount: number;
  readonly causeNames: readonly string[];
  readonly nativeComputationOperationIds: readonly string[];
  readonly nativeCommitOperationIds: readonly string[];
  readonly nativeMountOperationIds: readonly string[];
  readonly nativeFrameOperationIds: readonly string[];
  readonly completeNativeFrameChainCount: number;
}

export interface NativeSolidDiagnosticsCorrelation {
  readonly schemaVersion: typeof NATIVE_SOLID_DIAGNOSTICS_CORRELATION_SCHEMA_VERSION;
  readonly kind: typeof NATIVE_SOLID_DIAGNOSTICS_CORRELATION_KIND;
  readonly correlationMode: typeof NATIVE_SOLID_DIAGNOSTICS_CORRELATION_MODE;
  readonly exactPerRerunJoin: false;
  readonly diagnosticsCapturedAt: string;
  readonly diagnosticsDurationMilliseconds: number;
  readonly captureWindowStartedAt: number;
  readonly captureWindowFinishedAt: number;
  readonly causalSnapshotCapturedAt: number;
  readonly captureWindowFullyObserved: boolean;
  readonly causalEvictedOperationCount: number;
  readonly causalDiscardedRecordCount: number;
  readonly rerunCount: number;
  readonly namedEffectRerunCount: number;
  readonly correlatedOutputCount: number;
  readonly completeOutputCount: number;
  readonly unmatchedOutputNames: readonly string[];
  readonly outputs: readonly NativeSolidDiagnosticsCorrelatedOutput[];
}

export interface CorrelateNativeSolidDiagnosticsOptions {
  readonly windowToleranceMilliseconds?: number;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function correlationTolerance(
  options: CorrelateNativeSolidDiagnosticsOptions,
): number {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("Solid diagnostics correlation options are required.");
  }
  const tolerance =
    options.windowToleranceMilliseconds ??
    NATIVE_SOLID_DIAGNOSTICS_CORRELATION_WINDOW_TOLERANCE_MS;
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 10_000) {
    throw new TypeError(
      "Solid diagnostics correlation window tolerance must be a finite number from 0 through 10000 milliseconds.",
    );
  }
  return tolerance;
}

function collectCauseNames(
  causes: readonly SolidDiagnosticsDebugCause[],
  names: Set<string>,
): void {
  for (const cause of causes) {
    names.add(cause.name);
    if (cause.causes !== undefined) collectCauseNames(cause.causes, names);
  }
}

function operationDescendants(
  operationId: string,
  operationById: ReadonlyMap<string, CausalTimelineOperation>,
  childrenById: ReadonlyMap<string, readonly string[]>,
): readonly CausalTimelineOperation[] {
  const descendantIds = new Set<string>();
  const pending = [...(childrenById.get(operationId) ?? [])];
  for (let index = 0; index < pending.length; index += 1) {
    const candidate = pending[index];
    if (
      candidate === undefined ||
      candidate === operationId ||
      descendantIds.has(candidate)
    ) {
      continue;
    }
    descendantIds.add(candidate);
    pending.push(...(childrenById.get(candidate) ?? []));
  }
  return Object.freeze(
    [...descendantIds]
      .map((id) => operationById.get(id))
      .filter(
        (operation): operation is CausalTimelineOperation =>
          operation !== undefined,
      ),
  );
}

/**
 * Correlates Solid's value-free attribution output with native causal work by
 * stable computation name and a bounded wall-clock window. Solid does not yet
 * expose a per-rerun correlation token, so this result deliberately never
 * claims an exact one-to-one rerun join.
 */
export function correlateNativeSolidDiagnostics(
  diagnosticsValue: unknown,
  snapshotValue: unknown,
  options: CorrelateNativeSolidDiagnosticsOptions = {},
): NativeSolidDiagnosticsCorrelation {
  const diagnostics = parseSolidDiagnosticsDebugEnvelope(diagnosticsValue);
  const snapshot: CausalDebugSnapshot = parseCausalDebugSnapshot(snapshotValue);
  const tolerance = correlationTolerance(options);
  const captureWindowStartedAt = Date.parse(diagnostics.capturedAt);
  const captureWindowFinishedAt =
    captureWindowStartedAt + diagnostics.durationMilliseconds;
  if (!Number.isFinite(captureWindowFinishedAt)) {
    throw new RangeError(
      "Solid diagnostics correlation capture window cannot be represented.",
    );
  }

  const operationById = new Map(
    snapshot.operations.map((operation) => [operation.operationId, operation]),
  );
  const mutableChildrenById = new Map<string, string[]>();
  for (const operation of snapshot.operations) {
    for (const causeId of operation.causes) {
      const children = mutableChildrenById.get(causeId) ?? [];
      children.push(operation.operationId);
      mutableChildrenById.set(causeId, children);
    }
  }
  const childrenById = new Map<string, readonly string[]>(
    [...mutableChildrenById].map(([id, children]) => [
      id,
      Object.freeze(children),
    ]),
  );

  const namedEffectReruns = diagnostics.reruns.filter(
    (rerun) => rerun.nodeKind === "effect",
  );
  const outputNames = [
    ...new Set(namedEffectReruns.map((rerun) => rerun.nodeName)),
  ].sort(compareText);
  const outputs = outputNames.map(
    (name): NativeSolidDiagnosticsCorrelatedOutput => {
      const reruns = namedEffectReruns.filter(
        (rerun) => rerun.nodeName === name,
      );
      const causeNames = new Set<string>();
      for (const rerun of reruns) collectCauseNames(rerun.causes, causeNames);
      const nativeComputations = snapshot.operations.filter(
        (operation) =>
          operation.name === "solid-native.computation" &&
          operation.startAttributes["computation.kind"] === "native-output" &&
          operation.startAttributes["computation.name"] === name &&
          operation.status === "ok" &&
          operation.startedAt >= captureWindowStartedAt - tolerance &&
          operation.startedAt <= captureWindowFinishedAt + tolerance &&
          operation.startedAt <= snapshot.capturedAt,
      );
      const commits = new Map<string, CausalTimelineOperation>();
      const mounts = new Map<string, CausalTimelineOperation>();
      const frames = new Map<string, CausalTimelineOperation>();
      for (const computation of nativeComputations) {
        for (const descendant of operationDescendants(
          computation.operationId,
          operationById,
          childrenById,
        )) {
          if (
            descendant.name === "solid-native.commit" &&
            descendant.status === "ok" &&
            descendant.startedAt <= snapshot.capturedAt
          ) {
            commits.set(descendant.operationId, descendant);
          }
        }
      }
      for (const commit of commits.values()) {
        for (const descendant of operationDescendants(
          commit.operationId,
          operationById,
          childrenById,
        )) {
          if (
            descendant.name === "solid-native.mount" &&
            descendant.status === "ok" &&
            descendant.startedAt <= snapshot.capturedAt
          ) {
            mounts.set(descendant.operationId, descendant);
          }
        }
      }
      for (const mount of mounts.values()) {
        for (const descendant of operationDescendants(
          mount.operationId,
          operationById,
          childrenById,
        )) {
          if (
            descendant.name === "solid-native.frame" &&
            descendant.status === "ok" &&
            descendant.startedAt <= snapshot.capturedAt
          ) {
            frames.set(descendant.operationId, descendant);
          }
        }
      }
      return Object.freeze({
        name,
        rerunCount: reruns.length,
        changedRerunCount: reruns.filter((rerun) => rerun.changed).length,
        causeNames: Object.freeze([...causeNames].sort(compareText)),
        nativeComputationOperationIds: Object.freeze(
          nativeComputations.map((operation) => operation.operationId),
        ),
        nativeCommitOperationIds: Object.freeze([...commits.keys()]),
        nativeMountOperationIds: Object.freeze([...mounts.keys()]),
        nativeFrameOperationIds: Object.freeze([...frames.keys()]),
        completeNativeFrameChainCount: frames.size,
      });
    },
  );
  const unmatchedOutputNames = outputs
    .filter((output) => output.nativeComputationOperationIds.length === 0)
    .map((output) => output.name);
  return Object.freeze({
    schemaVersion: NATIVE_SOLID_DIAGNOSTICS_CORRELATION_SCHEMA_VERSION,
    kind: NATIVE_SOLID_DIAGNOSTICS_CORRELATION_KIND,
    correlationMode: NATIVE_SOLID_DIAGNOSTICS_CORRELATION_MODE,
    exactPerRerunJoin: false,
    diagnosticsCapturedAt: diagnostics.capturedAt,
    diagnosticsDurationMilliseconds: diagnostics.durationMilliseconds,
    captureWindowStartedAt,
    captureWindowFinishedAt,
    causalSnapshotCapturedAt: snapshot.capturedAt,
    captureWindowFullyObserved: snapshot.capturedAt >= captureWindowFinishedAt,
    causalEvictedOperationCount: snapshot.evictedOperationCount,
    causalDiscardedRecordCount: snapshot.discardedRecordCount,
    rerunCount: diagnostics.reruns.length,
    namedEffectRerunCount: namedEffectReruns.length,
    correlatedOutputCount: outputs.length - unmatchedOutputNames.length,
    completeOutputCount: outputs.filter(
      (output) => output.completeNativeFrameChainCount > 0,
    ).length,
    unmatchedOutputNames: Object.freeze(unmatchedOutputNames),
    outputs: Object.freeze(outputs),
  });
}
