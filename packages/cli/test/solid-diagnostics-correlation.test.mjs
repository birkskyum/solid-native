import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { correlateNativeSolidDiagnostics as correlateObservabilitySolidDiagnostics } from "@solid-native/observability";

import {
  correlateNativeSolidDiagnostics,
  correlateNativeSolidDiagnosticsFiles,
  createNativeCausalDebugReport,
  createNativeCausalDebugReportFile,
  formatNativeSolidDiagnosticsCorrelation,
} from "../dist/index.js";

const execFileAsync = promisify(execFile);
const CAPTURED_AT = "2026-08-27T12:00:00.000Z";
const STARTED_AT = Date.parse(CAPTURED_AT);

test("reuses the renderer-independent observability correlation API", () => {
  assert.equal(
    correlateNativeSolidDiagnostics,
    correlateObservabilitySolidDiagnostics,
  );
});

function rerun(nodeName, causeName, run = 1) {
  return {
    run,
    nodeRuns: run,
    nodeKind: "effect",
    nodeName,
    causes: [{ sequence: run, kind: "write", name: causeName }],
    dependencyCount: 1,
    dependenciesAdded: [],
    dependenciesRemoved: [],
    selfMilliseconds: 0.1,
    totalMilliseconds: 0.2,
    changed: true,
    phase: "plain",
    held: false,
  };
}

function diagnostics() {
  return {
    schemaVersion: 0,
    kind: "solid-native.solid-diagnostics-debug",
    capturedAt: CAPTURED_AT,
    durationMilliseconds: 1_200,
    truncated: false,
    droppedDiagnostics: 0,
    diagnostics: [],
    reruns: [
      rerun("assistant.output", "assistant.chunk", 1),
      rerun("assistant.output", "assistant.chunk", 2),
      rerun("unmatched.output", "unmatched.write", 1),
      { ...rerun("derived.memo", "assistant.chunk", 1), nodeKind: "memo" },
    ],
    scopeCosts: [],
    writeCosts: [],
  };
}

function finishedOperation(operationId, name, causes, startedAt, attributes) {
  return {
    operationId,
    name,
    causes,
    startedAt,
    startAttributes: attributes,
    finishedAt: startedAt + 1,
    duration: 1,
    status: "ok",
    finishAttributes: {},
  };
}

function snapshot() {
  return {
    kind: "solid-native.causal-debug-snapshot",
    schemaVersion: 0,
    capturedAt: STARTED_AT + 1_500,
    operations: [
      finishedOperation(
        "old-computation",
        "solid-native.computation",
        [],
        STARTED_AT - 1_000,
        {
          "computation.kind": "native-output",
          "computation.name": "assistant.output",
        },
      ),
      finishedOperation(
        "computation-1",
        "solid-native.computation",
        [],
        STARTED_AT + 100,
        {
          "computation.kind": "native-output",
          "computation.name": "assistant.output",
        },
      ),
      finishedOperation(
        "commit-1",
        "solid-native.commit",
        ["computation-1"],
        STARTED_AT + 110,
        { "commit.sequence": 2 },
      ),
      finishedOperation(
        "mount-1",
        "solid-native.mount",
        ["commit-1"],
        STARTED_AT + 115,
        { "commit.sequence": 2 },
      ),
      finishedOperation(
        "frame-1",
        "solid-native.frame",
        ["mount-1"],
        STARTED_AT + 130,
        { "commit.sequence": 2 },
      ),
    ],
    activeOperationCount: 0,
    evictedOperationCount: 0,
    discardedRecordCount: 0,
  };
}

function reportPayload(report) {
  const encoded = /<div id="report-data" hidden>([^<]+)<\/div>/u.exec(
    report,
  )?.[1];
  assert.equal(typeof encoded, "string");
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

test("correlates named Solid reruns with complete native frame chains", () => {
  const correlation = correlateNativeSolidDiagnostics(
    diagnostics(),
    snapshot(),
    { windowToleranceMilliseconds: 0 },
  );

  assert.equal(correlation.exactPerRerunJoin, false);
  assert.equal(correlation.correlationMode, "static-name-and-capture-window");
  assert.equal(correlation.captureWindowFullyObserved, true);
  assert.equal(correlation.rerunCount, 4);
  assert.equal(correlation.namedEffectRerunCount, 3);
  assert.equal(correlation.correlatedOutputCount, 1);
  assert.equal(correlation.completeOutputCount, 1);
  assert.deepEqual(correlation.unmatchedOutputNames, ["unmatched.output"]);
  const output = correlation.outputs.find(
    (candidate) => candidate.name === "assistant.output",
  );
  assert.ok(output);
  assert.equal(output.rerunCount, 2);
  assert.deepEqual(output.causeNames, ["assistant.chunk"]);
  assert.deepEqual(output.nativeComputationOperationIds, ["computation-1"]);
  assert.deepEqual(output.nativeCommitOperationIds, ["commit-1"]);
  assert.deepEqual(output.nativeMountOperationIds, ["mount-1"]);
  assert.deepEqual(output.nativeFrameOperationIds, ["frame-1"]);
  assert.equal(output.completeNativeFrameChainCount, 1);
  assert.equal(Object.isFrozen(correlation), true);
  assert.match(
    formatNativeSolidDiagnosticsCorrelation(correlation),
    /exact per-rerun join: no[\s\S]*assistant\.output: 2 reruns[\s\S]*1 frames/u,
  );
});

test("reports partial windows and rejects invalid correlation tolerances", () => {
  const early = snapshot();
  early.capturedAt = STARTED_AT + 500;
  assert.equal(
    correlateNativeSolidDiagnostics(diagnostics(), early)
      .captureWindowFullyObserved,
    false,
  );
  assert.throws(
    () =>
      correlateNativeSolidDiagnostics(diagnostics(), snapshot(), {
        windowToleranceMilliseconds: -1,
      }),
    /window tolerance/u,
  );
  assert.throws(
    () => correlateNativeSolidDiagnostics(diagnostics(), snapshot(), null),
    /options are required/u,
  );
  const failed = snapshot();
  failed.operations.at(-1).status = "error";
  const failedCorrelation = correlateNativeSolidDiagnostics(
    diagnostics(),
    failed,
    { windowToleranceMilliseconds: 0 },
  );
  assert.equal(failedCorrelation.completeOutputCount, 0);
});

test("embeds the bounded correlation in the offline causal debugger", () => {
  const report = createNativeCausalDebugReport(snapshot(), {
    diagnostics: diagnostics(),
  });
  const payload = reportPayload(report);
  assert.equal(payload.diagnosticsCorrelation.completeOutputCount, 1);
  assert.equal(payload.diagnosticsCorrelation.exactPerRerunJoin, false);
  assert.match(report, /id="diagnostics-correlation"/u);
  assert.match(report, /Solid → native correlation/u);
  assert.doesNotMatch(report, /assistant\.chunk/u);
  const script = /<script>([\s\S]*?)<\/script>/u.exec(report)?.[1];
  assert.equal(typeof script, "string");
  assert.doesNotThrow(() => new Function(script));
});

test("correlates bounded files through the public CLI", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "solid-native-correlation-"),
  );
  const diagnosticsPath = path.join(directory, "diagnostics.json");
  const snapshotPath = path.join(directory, "snapshot.json");
  try {
    await Promise.all([
      writeFile(diagnosticsPath, JSON.stringify(diagnostics())),
      writeFile(snapshotPath, JSON.stringify(snapshot())),
    ]);
    const correlation = await correlateNativeSolidDiagnosticsFiles({
      diagnosticsPath,
      snapshotPath,
      windowToleranceMilliseconds: 0,
    });
    assert.equal(correlation.completeOutputCount, 1);
    const report = await createNativeCausalDebugReportFile({
      diagnosticsPath,
      snapshotPath,
    });
    assert.equal(
      reportPayload(report).diagnosticsCorrelation.completeOutputCount,
      1,
    );

    const cli = await execFileAsync(process.execPath, [
      new URL("../dist/bin.js", import.meta.url).pathname,
      "debug",
      "correlate",
      diagnosticsPath,
      snapshotPath,
      "--json",
    ]);
    const cliCorrelation = JSON.parse(cli.stdout);
    assert.equal(cliCorrelation.completeOutputCount, 1);
    assert.equal(cliCorrelation.exactPerRerunJoin, false);
    assert.equal(cli.stderr, "");

    const cliReport = await execFileAsync(process.execPath, [
      new URL("../dist/bin.js", import.meta.url).pathname,
      "debug",
      "report",
      snapshotPath,
      "--diagnostics",
      diagnosticsPath,
    ]);
    assert.equal(
      reportPayload(cliReport.stdout).diagnosticsCorrelation
        .completeOutputCount,
      1,
    );
    assert.equal(cliReport.stderr, "");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
