import assert from "node:assert/strict";
import test from "node:test";

import {
  parseProductTelemetryProof,
  parseProductTelemetryVariantLog,
} from "./parse-product-telemetry-proof.mjs";

function metricUpdate(eventIndex, variant) {
  const processed = eventIndex + 1;
  const alertVisible = processed % 5 === 0;
  const previousAlertVisible = (processed - 1) % 5 === 0;
  return {
    schemaVersion: 0,
    variant,
    eventIndex,
    processed,
    activeOrder: `ORD-${String(1001 + (eventIndex % 12))}`,
    alertVisible,
    alertComputation: alertVisible !== previousAlertVisible,
    observedSequence: eventIndex,
    commitSequence: eventIndex + 1,
    hostRevision: eventIndex + 1,
    handlerToCommitMilliseconds: 1,
    handlerToMountMilliseconds: 3,
    handlerToFrameMilliseconds: 5,
    commitToMountMilliseconds: 2,
    commitToFrameMilliseconds: 4,
    mountToFrameMilliseconds: 2,
    telemetryEnabled: variant === "observed",
    causalChainValidated: variant === "observed",
  };
}

function proofLog(overrides = {}, variant = "observed") {
  const updates = Array.from({ length: 30 }, (_, index) =>
    metricUpdate(index + 1, variant),
  );
  const result = {
    schemaVersion: 0,
    benchmark: "causal-telemetry-product-workload",
    interpretation: "functional-proof",
    variant,
    workload: "order-dashboard",
    input: "androidx-touchscreen-injection",
    updateCount: 30,
    validatedInteractionCount: variant === "observed" ? 30 : 0,
    alertComputationInteractionCount: variant === "observed" ? 12 : 0,
    finalProcessed: 31,
    finalActiveOrder: "ORD-1007",
    finalAlertVisible: false,
    telemetryRecordCount: variant === "observed" ? 400 : 0,
    telemetryEnabled: variant === "observed",
    payloadValuesRetained: false,
    runtime: {
      name: "fabric-jsi",
      version: "0.87.0",
      hostContractVersion: 1,
      platform: "android",
    },
    ...overrides,
  };
  const physical = {
    schemaVersion: 0,
    variant,
    workload: "order-dashboard",
    input: "androidx-touchscreen-injection",
    initialCount: 1,
    finalCount: 31,
    updateCount: 30,
    rowCount: 12,
    finalActiveOrder: "ORD-1007",
    activeOrderAssertions: 30,
    alertAppearances: 6,
    alertDisposals: 6,
    completionMilliseconds: Array.from({ length: 30 }, () => 10),
    completionP50Milliseconds: 10,
    completionP95Milliseconds: 10,
    completionMaxMilliseconds: 10,
    frameMetrics: {
      schemaVersion: 1,
      manufacturer: "Google",
      model: "Pixel",
      sdk: 37,
      osRelease: "17",
      frames: 30,
      deadlineMisses: 0,
      frozenFrames: 0,
      p50Milliseconds: 4,
      p95Milliseconds: 8,
      maxMilliseconds: 10,
      droppedReports: 0,
    },
  };
  return [
    ...updates.map(
      (update) =>
        `I/ReactNativeJS: SOLID_NATIVE_PRODUCT_TELEMETRY_UPDATE ${JSON.stringify(update)}`,
    ),
    `I/ReactNativeJS: SOLID_NATIVE_PRODUCT_TELEMETRY_RESULT ${JSON.stringify(result)}`,
    `I/SOLID_NATIVE: SOLID_NATIVE_MATCHED_PRODUCT_RESULT ${JSON.stringify(physical)}`,
  ].join("\n");
}

test("parses a complete physical product telemetry proof", () => {
  const proof = parseProductTelemetryProof(proofLog());
  assert.equal(proof.updates.length, 30);
  assert.equal(proof.result.validatedInteractionCount, 30);
  assert.equal(proof.physicalEvidence.activeOrderAssertions, 30);
});

test("parses the matched telemetry-disabled product workload", () => {
  const proof = parseProductTelemetryVariantLog(
    proofLog({}, "baseline"),
    "baseline",
  );
  assert.equal(proof.updates.length, 30);
  assert.equal(proof.result.telemetryRecordCount, 0);
  assert.equal(proof.result.validatedInteractionCount, 0);
  assert.equal(proof.physicalEvidence.variant, "baseline");
});

test("rejects incomplete or weakened product telemetry proof", () => {
  assert.throws(
    () =>
      parseProductTelemetryProof(proofLog().split("\n").slice(1).join("\n")),
    /omitted causal or physical evidence/u,
  );
  assert.throws(
    () =>
      parseProductTelemetryProof(
        proofLog({ alertComputationInteractionCount: 11 }),
      ),
    /result is incompatible/u,
  );
  assert.throws(
    () =>
      parseProductTelemetryProof(
        proofLog().replace(
          '"causalChainValidated":true',
          '"causalChainValidated":false',
        ),
      ),
    /update is incompatible/u,
  );
  assert.throws(
    () =>
      parseProductTelemetryVariantLog(
        proofLog({ telemetryRecordCount: 1 }, "baseline"),
        "baseline",
      ),
    /result is incompatible/u,
  );
  assert.throws(
    () => parseProductTelemetryVariantLog(proofLog(), "baseline"),
    /incompatible/u,
  );
});
