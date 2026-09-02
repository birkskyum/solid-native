import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createNativeCausalDebugReport } from "../../../packages/cli/dist/index.js";

import { verifyNativeCausalDebugPhysicalProof } from "./causal-debug-physical-proof.mjs";
import {
  verifyNativeSolidDiagnosticsCorrelationPhysicalProof,
  verifyNativeSolidDiagnosticsPhysicalProof,
  verifyNativeSolidDiagnosticsReportPhysicalProof,
} from "./solid-diagnostics-physical-proof.mjs";

function operation(operationId, name, causes, startedAt, startAttributes = {}) {
  return {
    operationId,
    name,
    causes,
    startedAt,
    startAttributes,
    finishedAt: startedAt + 1,
    duration: 1,
    status: "ok",
    finishAttributes: {},
  };
}

function correlatedSnapshot() {
  const startedAt = Date.parse("2026-08-27T12:00:00.000Z");
  return {
    kind: "solid-native.causal-debug-snapshot",
    schemaVersion: 0,
    capturedAt: startedAt + 1_500,
    operations: [
      operation("surface", "solid-native.surface", [], startedAt - 100),
      operation(
        "computation",
        "solid-native.computation",
        ["surface"],
        startedAt + 100,
        {
          "computation.kind": "native-output",
          "computation.name": "solid-native.diagnostics.output",
        },
      ),
      operation(
        "commit",
        "solid-native.commit",
        ["computation"],
        startedAt + 110,
      ),
      operation("mount", "solid-native.mount", ["commit"], startedAt + 120),
      operation("frame", "solid-native.frame", ["mount"], startedAt + 130),
    ],
    activeOperationCount: 0,
    evictedOperationCount: 0,
    discardedRecordCount: 0,
  };
}

function snapshot() {
  return {
    kind: "solid-native.causal-debug-snapshot",
    schemaVersion: 0,
    capturedAt: 10,
    operations: [
      operation("surface", "solid-native.surface", [], 1),
      operation("commit", "solid-native.commit", ["surface"], 3),
      operation("mount", "solid-native.mount", ["commit"], 5),
      operation("frame", "solid-native.frame", ["mount"], 7),
    ],
    activeOperationCount: 0,
    evictedOperationCount: 0,
    discardedRecordCount: 0,
  };
}

test("verifies a retained physical surface-to-frame causal chain", () => {
  assert.deepEqual(verifyNativeCausalDebugPhysicalProof(snapshot()), {
    operationCount: 4,
    activeOperationCount: 0,
    slices: 4,
    flows: 6,
  });

  const severed = snapshot();
  severed.operations.at(-1).causes = [];
  assert.throws(
    () => verifyNativeCausalDebugPhysicalProof(severed),
    /surface-to-commit-to-mount-to-frame/u,
  );
});

function diagnosticsEnvelope() {
  return {
    schemaVersion: 0,
    kind: "solid-native.solid-diagnostics-debug",
    capturedAt: "2026-08-27T12:00:00.000Z",
    durationMilliseconds: 1_200,
    truncated: false,
    droppedDiagnostics: 0,
    diagnostics: [],
    reruns: [
      {
        run: 1,
        nodeRuns: 1,
        nodeKind: "effect",
        nodeName: "solid-native.diagnostics.output",
        causes: [
          {
            sequence: 1,
            kind: "write",
            name: "solid-native.diagnostics.counter",
          },
        ],
        dependencyCount: 1,
        dependenciesAdded: [],
        dependenciesRemoved: [],
        selfMilliseconds: 0.1,
        totalMilliseconds: 0.2,
        changed: true,
        phase: "plain",
        held: false,
      },
    ],
    scopeCosts: [
      {
        name: "solid-native.diagnostics.output",
        kind: "effect",
        runs: 1,
        selfMilliseconds: 0.1,
        wastedMilliseconds: 0,
        overlayMilliseconds: 0,
      },
    ],
    writeCosts: [
      {
        name: "solid-native.diagnostics.counter",
        runs: 1,
        downstreamMilliseconds: 0.2,
      },
    ],
  };
}

test("verifies a value-free physical Solid diagnostics attribution", () => {
  assert.deepEqual(
    verifyNativeSolidDiagnosticsPhysicalProof(diagnosticsEnvelope()),
    {
      durationMilliseconds: 1_200,
      diagnosticCount: 0,
      rerunCount: 1,
      changedRerunCount: 1,
      causeCount: 1,
      totalScopeRuns: 1,
      totalWriteRuns: 1,
    },
  );
  const severed = diagnosticsEnvelope();
  severed.reruns[0].causes = [];
  assert.throws(
    () => verifyNativeSolidDiagnosticsPhysicalProof(severed),
    /write-to-rerun proof/u,
  );
});

test("verifies the bounded Solid-rerun-to-native-frame correlation", () => {
  assert.deepEqual(
    verifyNativeSolidDiagnosticsCorrelationPhysicalProof(
      diagnosticsEnvelope(),
      correlatedSnapshot(),
    ),
    {
      correlationMode: "static-name-and-capture-window",
      exactPerRerunJoin: false,
      outputName: "solid-native.diagnostics.output",
      nativeComputationCount: 1,
      nativeCommitCount: 1,
      nativeMountCount: 1,
      nativeFrameCount: 1,
      completeNativeFrameChainCount: 1,
    },
  );
  const severed = correlatedSnapshot();
  severed.operations.at(-1).causes = [];
  assert.throws(
    () =>
      verifyNativeSolidDiagnosticsCorrelationPhysicalProof(
        diagnosticsEnvelope(),
        severed,
      ),
    /native frame correlation/u,
  );
});

test("verifies the locked live-device diagnostics report", () => {
  const report = createNativeCausalDebugReport(correlatedSnapshot(), {
    diagnostics: diagnosticsEnvelope(),
  });
  assert.deepEqual(verifyNativeSolidDiagnosticsReportPhysicalProof(report), {
    operationCount: 5,
    rerunCount: 1,
    correlatedOutputCount: 1,
    completeNativeFrameChainCount: 1,
    attributesIncluded: false,
  });
  assert.throws(
    () =>
      verifyNativeSolidDiagnosticsReportPhysicalProof(
        report.replace("connect-src 'none'", "connect-src https:"),
      ),
    /locked, encoded document boundary/u,
  );
});

test("uses a bundled development runtime only in the signed iOS proof build", async () => {
  const [manifest, runner, project, applicationDelegate] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8").then(
      JSON.parse,
    ),
    readFile(new URL("./ios-causal-debug-test.sh", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../ios/SolidNativeE2E.xcodeproj/project.pbxproj",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../ios/SolidNativeE2E/AppDelegate.swift", import.meta.url),
      "utf8",
    ),
  ]);

  assert.equal(
    manifest.scripts["ios:causal-debug:test"],
    "pnpm --filter @solid-native/cli build && sh scripts/ios-causal-debug-test.sh",
  );
  assert.match(runner, /-configuration Debug/u);
  assert.match(runner, /ENTRY_FILE=diagnostics\.tsx/u);
  assert.match(runner, /--solid-native-use-bundled-development/u);
  assert.match(runner, /debug capture-ios/u);
  assert.match(runner, /debug diagnostics-ios/u);
  assert.match(runner, /debug report-ios/u);
  assert.match(runner, /--output "\$REPORT_PATH"/u);
  assert.match(runner, /causal-debug-physical-proof\.mjs/u);
  assert.match(runner, /solid-diagnostics-physical-proof\.mjs/u);
  assert.match(runner, /"\$DIAGNOSTICS_PATH" "\$SNAPSHOT_PATH"/u);
  assert.match(
    runner,
    /--terminate-existing[\s\S]*attempt=1[\s\S]*attempt.*-le 20/u,
  );
  assert.match(runner, /trap cleanup EXIT/u);
  assert.doesNotMatch(project, /SOLID_NATIVE_CAUSAL_DEBUG_ENABLED/u);
  assert.match(
    applicationDelegate,
    /--solid-native-use-bundled-development[\s\S]*let bundleRoot = useBundledDevelopment[\s\S]*\? "diagnostics"/u,
  );
  assert.match(
    applicationDelegate,
    /if useBundledDevelopment \{[\s\S]*main[\s\S]*jsbundle/u,
  );
});

test("the Android causal runner leases wakefulness and rejects a secure lock", async () => {
  const runner = await readFile(
    new URL("./android-causal-debug-test.mjs", import.meta.url),
    "utf8",
  );
  assert.match(runner, /settings[\s\S]*stay_on_while_plugged_in[\s\S]*"3"/u);
  assert.match(runner, /KeyguardServiceDelegate[\s\S]*device is locked/u);
  assert.match(
    runner,
    /settings[\s\S]*(?:delete|put)[\s\S]*previousStayAwake/u,
  );
  assert.match(runner, /installSolidDiagnosticsDebug/u);
  assert.match(runner, /captureNativeAndroidSolidDiagnostics/u);
  assert.match(runner, /verifyNativeSolidDiagnosticsPhysicalProof/u);
  assert.match(runner, /verifyNativeSolidDiagnosticsCorrelationPhysicalProof/u);
  assert.match(runner, /debug["'],\s*["']report-android/u);
  assert.match(runner, /["']--output["'],\s*reportPath/u);
  assert.match(runner, /verifyNativeSolidDiagnosticsReportPhysicalProof/u);
});
