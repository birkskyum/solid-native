import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  productTelemetryEventSamples,
  summarizeProductTelemetrySamples,
} from "./android-product-telemetry-benchmark.mjs";
import { createBalancedPairOrders } from "./benchmark-statistics.mjs";
import { parseProductTelemetryVariantLog } from "./parse-product-telemetry-proof.mjs";

const eventMetrics = {
  handlerToCommitMilliseconds: 1,
  handlerToMountMilliseconds: 3,
  handlerToFrameMilliseconds: 5,
  commitToMountMilliseconds: 2,
  commitToFrameMilliseconds: 4,
  mountToFrameMilliseconds: 2,
};

function processSample(sampleIndex, orderIndex, variant, offset) {
  return {
    sampleIndex,
    orderIndex,
    variant,
    completionP50Milliseconds: 10 + offset,
    completionP95Milliseconds: 12 + offset,
    completionMaxMilliseconds: 14 + offset,
    frames: 30,
    deadlineMisses: offset,
    frameP50Milliseconds: 4 + offset,
    frameP95Milliseconds: 8 + offset,
    frameMaxMilliseconds: 10 + offset,
    updates: Array.from({ length: 30 }, (_, index) => ({
      eventIndex: index + 1,
      processed: index + 2,
      activeOrder: `ORD-${String(1001 + ((index + 1) % 12))}`,
      alertVisible: (index + 2) % 5 === 0,
      alertComputation: (index + 2) % 5 === 0 || (index + 1) % 5 === 0,
      hostRevision: index + 1,
      ...Object.fromEntries(
        Object.entries(eventMetrics).map(([metric, value]) => [
          metric,
          value + offset,
        ]),
      ),
    })),
  };
}

test("pairs every product interaction independently of process order", () => {
  const samples = [
    processSample(0, 0, "observed", 1),
    processSample(0, 1, "baseline", 0),
    processSample(1, 0, "baseline", 0),
    processSample(1, 1, "observed", 1),
  ];
  const events = productTelemetryEventSamples(samples);
  assert.equal(events.length, 120);
  assert.equal(new Set(events.map((event) => event.sampleIndex)).size, 60);
  assert.equal(
    events.filter((event) => event.variant === "baseline").length,
    60,
  );
  const summary = summarizeProductTelemetrySamples(samples);
  assert.equal(summary.event.handlerToFrameMilliseconds.baseline.count, 60);
  assert.equal(summary.event.handlerToFrameMilliseconds.observed.count, 60);
  assert.equal(summary.event.handlerToFrameMilliseconds.pairedDelta.median, 1);
  assert.equal(summary.process.completionP50Milliseconds.baseline.count, 2);
  assert.equal(summary.process.completionP50Milliseconds.pairedDelta.median, 1);
});

test("rejects incomplete product telemetry pairs", () => {
  assert.throws(
    () =>
      summarizeProductTelemetrySamples([processSample(0, 0, "baseline", 0)]),
    /pair is incomplete/u,
  );
});

test("retains a validated clean Pixel product-telemetry corpus", async () => {
  const result = JSON.parse(
    await readFile(
      new URL(
        "../../../docs/benchmark-results/android-product-telemetry-pixel-9a-2026-08-24.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );

  assert.equal(result.schemaVersion, 0);
  assert.equal(result.benchmark, "android-causal-telemetry-product-workload");
  assert.equal(result.interpretation, "diagnostic-only");
  assert.equal(result.environment.dirty, false);
  assert.equal(result.environment.deviceModel, "Pixel 9a");
  assert.equal(result.environment.lowPowerMode, "0");
  assert.match(result.environment.revision, /^[a-f\d]{40}$/u);
  assert.match(
    result.environment.nativeCompatibilityFingerprint,
    /^sha256:[a-f\d]{64}$/u,
  );
  assert.ok(result.environment.nativeCompatibilityInputCount > 0);
  assert.equal(result.configuration.sampleCountPerVariant, 6);
  assert.equal(result.configuration.warmupPairs, 1);
  assert.equal(result.configuration.orderSeed, 20_260_824);
  assert.equal(result.configuration.updateCountPerProcess, 30);
  assert.equal(result.configuration.eventPairCount, 180);
  assert.deepEqual(
    result.configuration.variantOrders,
    createBalancedPairOrders(6, "baseline", "observed", 20_260_824),
  );
  assert.deepEqual(
    result.configuration.warmupVariantOrders,
    createBalancedPairOrders(
      1,
      "baseline",
      "observed",
      (20_260_824 ^ 0x9e37_79b9) >>> 0,
    ),
  );
  assert.equal(result.samples.length, 12);
  assert.equal(result.eventSamples.length, 360);
  assert.deepEqual(
    productTelemetryEventSamples(result.samples),
    result.eventSamples,
  );
  assert.deepEqual(summarizeProductTelemetrySamples(result.samples), {
    event: result.eventSummary,
    process: result.processSummary,
  });

  for (const sample of result.samples) {
    const observed = sample.variant === "observed";
    assert.ok(observed || sample.variant === "baseline");
    assert.equal(sample.initialThermalStatus, 0);
    assert.equal(sample.finalThermalStatus, 0);
    assert.equal(sample.updates.length, 30);
    assert.equal(sample.result.telemetryRecordCount, observed ? 396 : 0);
    assert.equal(sample.result.validatedInteractionCount, observed ? 30 : 0);
    assert.equal(
      sample.result.alertComputationInteractionCount,
      observed ? 12 : 0,
    );
    assert.equal(sample.result.payloadValuesRetained, false);
    assert.equal(sample.physicalEvidence.completionMilliseconds.length, 30);
    assert.equal(sample.physicalEvidence.frameMetrics.frozenFrames, 0);
    assert.equal(sample.physicalEvidence.frameMetrics.droppedReports, 0);
    const proofLog = [
      ...sample.updates.map(
        (update) =>
          `SOLID_NATIVE_PRODUCT_TELEMETRY_UPDATE ${JSON.stringify(update)}`,
      ),
      `SOLID_NATIVE_PRODUCT_TELEMETRY_RESULT ${JSON.stringify(sample.result)}`,
      `SOLID_NATIVE_MATCHED_PRODUCT_RESULT ${JSON.stringify(sample.physicalEvidence)}`,
    ].join("\n");
    assert.deepEqual(
      parseProductTelemetryVariantLog(proofLog, sample.variant),
      {
        updates: sample.updates,
        result: sample.result,
        physicalEvidence: sample.physicalEvidence,
      },
    );
  }
});
