import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  correlateNativeSolidDiagnostics,
  inspectNativeSolidDiagnostics,
  parseNativeCausalDebugSnapshotBytes,
  parseNativeSolidDiagnosticsDebugBytes,
} from "../../../packages/cli/dist/index.js";

const EXPECTED_WRITE_NAME = "solid-native.diagnostics.counter";
const EXPECTED_SCOPE_NAME = "solid-native.diagnostics.output";

function hasCause(causes, name) {
  return causes.some(
    (cause) =>
      cause.name === name ||
      (cause.causes !== undefined && hasCause(cause.causes, name)),
  );
}

export function verifyNativeSolidDiagnosticsPhysicalProof(envelope) {
  const inspection = inspectNativeSolidDiagnostics(envelope);
  if (
    envelope.durationMilliseconds < 500 ||
    envelope.durationMilliseconds > 10_000 ||
    envelope.truncated ||
    envelope.droppedDiagnostics !== 0 ||
    envelope.reruns.length === 0 ||
    !envelope.reruns.some((rerun) =>
      hasCause(rerun.causes, EXPECTED_WRITE_NAME),
    ) ||
    !envelope.scopeCosts.some(
      (cost) => cost.name === EXPECTED_SCOPE_NAME && cost.runs > 0,
    ) ||
    !envelope.writeCosts.some(
      (cost) => cost.name === EXPECTED_WRITE_NAME && cost.runs > 0,
    ) ||
    inspection.rerunCount !== envelope.reruns.length ||
    inspection.totalScopeRuns <= 0 ||
    inspection.totalWriteRuns <= 0 ||
    inspection.causeCount <= 0
  ) {
    throw new Error(
      `The physical Solid diagnostics artifact omitted its named write-to-rerun proof: ${JSON.stringify(inspection)}.`,
    );
  }
  return Object.freeze({
    durationMilliseconds: envelope.durationMilliseconds,
    diagnosticCount: inspection.diagnosticCount,
    rerunCount: inspection.rerunCount,
    changedRerunCount: inspection.changedRerunCount,
    causeCount: inspection.causeCount,
    totalScopeRuns: inspection.totalScopeRuns,
    totalWriteRuns: inspection.totalWriteRuns,
  });
}

export function verifyNativeSolidDiagnosticsCorrelationPhysicalProof(
  envelope,
  snapshot,
) {
  const correlation = correlateNativeSolidDiagnostics(envelope, snapshot);
  const output = correlation.outputs.find(
    (candidate) => candidate.name === EXPECTED_SCOPE_NAME,
  );
  if (
    correlation.exactPerRerunJoin !== false ||
    !correlation.captureWindowFullyObserved ||
    correlation.causalEvictedOperationCount !== 0 ||
    correlation.causalDiscardedRecordCount !== 0 ||
    output === undefined ||
    output.rerunCount <= 0 ||
    !output.causeNames.includes(EXPECTED_WRITE_NAME) ||
    output.nativeComputationOperationIds.length <= 0 ||
    output.nativeCommitOperationIds.length <= 0 ||
    output.nativeMountOperationIds.length <= 0 ||
    output.nativeFrameOperationIds.length <= 0 ||
    output.completeNativeFrameChainCount <= 0
  ) {
    throw new Error(
      `The physical Solid diagnostics artifact omitted its named native frame correlation: ${JSON.stringify(correlation)}.`,
    );
  }
  return Object.freeze({
    correlationMode: correlation.correlationMode,
    exactPerRerunJoin: correlation.exactPerRerunJoin,
    outputName: output.name,
    nativeComputationCount: output.nativeComputationOperationIds.length,
    nativeCommitCount: output.nativeCommitOperationIds.length,
    nativeMountCount: output.nativeMountOperationIds.length,
    nativeFrameCount: output.nativeFrameOperationIds.length,
    completeNativeFrameChainCount: output.completeNativeFrameChainCount,
  });
}

export function verifyNativeSolidDiagnosticsReportPhysicalProof(report) {
  if (
    typeof report !== "string" ||
    !report.startsWith("<!doctype html>") ||
    !report.includes("connect-src 'none'") ||
    report.includes(EXPECTED_SCOPE_NAME) ||
    report.includes(EXPECTED_WRITE_NAME)
  ) {
    throw new Error(
      "The physical Solid diagnostics report omitted its locked, encoded document boundary.",
    );
  }
  const matches = [
    ...report.matchAll(
      /<div id="report-data" hidden>([A-Za-z0-9+/=]+)<\/div>/gu,
    ),
  ];
  if (matches.length !== 1 || matches[0]?.[1] === undefined) {
    throw new Error(
      "The physical Solid diagnostics report did not contain exactly one encoded payload.",
    );
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(matches[0][1], "base64").toString("utf8"));
  } catch {
    throw new Error(
      "The physical Solid diagnostics report payload was not valid encoded JSON.",
    );
  }
  const correlation = payload?.diagnosticsCorrelation;
  const output = correlation?.outputs?.find(
    (candidate) => candidate?.name === EXPECTED_SCOPE_NAME,
  );
  const operationIds = new Set(
    Array.isArray(payload?.operations)
      ? payload.operations.map((operation) => operation?.operationId)
      : [],
  );
  if (
    payload?.kind !== "solid-native.causal-debug-report" ||
    payload?.schemaVersion !== 1 ||
    correlation?.exactPerRerunJoin !== false ||
    correlation?.captureWindowFullyObserved !== true ||
    output === undefined ||
    !output.causeNames?.includes(EXPECTED_WRITE_NAME) ||
    output.completeNativeFrameChainCount <= 0 ||
    !output.nativeFrameOperationIds?.every((id) => operationIds.has(id)) ||
    payload.operations.some((operation) => operation?.attributes !== undefined)
  ) {
    throw new Error(
      `The physical Solid diagnostics report omitted its private native-frame correlation: ${JSON.stringify(correlation)}.`,
    );
  }
  return Object.freeze({
    operationCount: payload.operations.length,
    rerunCount: correlation.rerunCount,
    correlatedOutputCount: correlation.correlatedOutputCount,
    completeNativeFrameChainCount: output.completeNativeFrameChainCount,
    attributesIncluded: false,
  });
}

async function main() {
  if (process.argv.length === 4 && process.argv[2] === "--report") {
    const report = verifyNativeSolidDiagnosticsReportPhysicalProof(
      await readFile(path.resolve(process.argv[3]), "utf8"),
    );
    console.log(
      `SOLID_NATIVE_DIAGNOSTICS_REPORT_PROOF ${JSON.stringify(report)}`,
    );
    return;
  }
  if (process.argv.length !== 3 && process.argv.length !== 4) {
    throw new Error(
      "Usage: node solid-diagnostics-physical-proof.mjs ARTIFACT.json [SNAPSHOT.json] | --report REPORT.html",
    );
  }
  const source = await readFile(path.resolve(process.argv[2]));
  const envelope = parseNativeSolidDiagnosticsDebugBytes(source);
  const diagnostics = verifyNativeSolidDiagnosticsPhysicalProof(envelope);
  const snapshotPath = process.argv[3];
  const proof =
    snapshotPath === undefined
      ? diagnostics
      : {
          diagnostics,
          correlation: verifyNativeSolidDiagnosticsCorrelationPhysicalProof(
            envelope,
            parseNativeCausalDebugSnapshotBytes(
              await readFile(path.resolve(snapshotPath)),
            ),
          ),
        };
  console.log(`SOLID_NATIVE_DIAGNOSTICS_PROOF ${JSON.stringify(proof)}`);
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  path.resolve(invokedPath) === fileURLToPath(import.meta.url)
) {
  await main();
}
