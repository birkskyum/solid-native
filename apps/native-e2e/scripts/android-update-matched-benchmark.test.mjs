import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseMatchedProductWorkloadLog,
  parseMatchedUpdateLog,
  readMatchedUpdateWorkload,
  summarizeMatchedUpdateSamples,
} from "./android-update-matched-benchmark.mjs";
import { createBalancedPairOrders } from "./benchmark-statistics.mjs";

function fixture(overrides = {}) {
  const completionMilliseconds = Array.from(
    { length: 30 },
    (_, index) => 51 + index,
  );
  return {
    schemaVersion: 0,
    variant: "solid-native",
    input: "androidx-touchscreen-injection",
    initialCount: 1,
    finalCount: 31,
    updateCount: 30,
    completionMilliseconds,
    completionP50Milliseconds: 65,
    completionP95Milliseconds: 79,
    completionMaxMilliseconds: 80,
    frameMetrics: {
      schemaVersion: 1,
      manufacturer: "Google",
      model: "Pixel 9a",
      sdk: 37,
      osRelease: "17",
      frames: 60,
      deadlineMisses: 0,
      frozenFrames: 0,
      p50Milliseconds: 4.5,
      p95Milliseconds: 7.25,
      maxMilliseconds: 9.5,
      droppedReports: 0,
    },
    ...overrides,
  };
}

test("parses complete matched Android property-update evidence", () => {
  const result = fixture();
  assert.deepEqual(
    parseMatchedUpdateLog(
      `I/SOLID_NATIVE: SOLID_NATIVE_MATCHED_UPDATE_RESULT ${JSON.stringify(result)}`,
      "solid-native",
    ),
    result,
  );
  assert.equal(parseMatchedUpdateLog("pending", "solid-native"), undefined);
});

test("rejects incompatible or internally invalid property-update evidence", () => {
  for (const result of [
    fixture({ variant: "react-native" }),
    fixture({ finalCount: 30 }),
    fixture({ completionMilliseconds: [1] }),
    fixture({ completionP50Milliseconds: 64 }),
    fixture({ frameMetrics: { ...fixture().frameMetrics, frames: 24 } }),
    fixture({ frameMetrics: { ...fixture().frameMetrics, frozenFrames: 1 } }),
    fixture({ frameMetrics: { ...fixture().frameMetrics, droppedReports: 1 } }),
  ]) {
    assert.throws(
      () =>
        parseMatchedUpdateLog(
          `SOLID_NATIVE_MATCHED_UPDATE_RESULT ${JSON.stringify(result)}`,
          "solid-native",
        ),
      /incompatible|internally invalid/u,
    );
  }
});

test("parses complete mixed product-workload evidence", () => {
  const result = fixture({
    workload: "order-dashboard",
    rowCount: 12,
    finalActiveOrder: "ORD-1007",
    activeOrderAssertions: 30,
    alertAppearances: 6,
    alertDisposals: 6,
  });
  assert.deepEqual(
    parseMatchedProductWorkloadLog(
      `SOLID_NATIVE_MATCHED_PRODUCT_RESULT ${JSON.stringify(result)}`,
      "solid-native",
    ),
    result,
  );
  assert.equal(
    parseMatchedProductWorkloadLog("pending", "solid-native"),
    undefined,
  );
});

test("rejects incomplete mixed product-workload evidence", () => {
  const complete = {
    workload: "order-dashboard",
    rowCount: 12,
    finalActiveOrder: "ORD-1007",
    activeOrderAssertions: 30,
    alertAppearances: 6,
    alertDisposals: 6,
  };
  for (const override of [
    { rowCount: 11 },
    { finalActiveOrder: "ORD-1006" },
    { activeOrderAssertions: 29 },
    { alertAppearances: 5 },
    { alertDisposals: 5 },
  ]) {
    assert.throws(
      () =>
        parseMatchedProductWorkloadLog(
          `SOLID_NATIVE_MATCHED_PRODUCT_RESULT ${JSON.stringify(
            fixture({ ...complete, ...override }),
          )}`,
          "solid-native",
        ),
      /product workload result is incompatible/u,
    );
  }
});

test("selects only documented matched Android workloads", () => {
  assert.equal(readMatchedUpdateWorkload(undefined).id, "steady-properties");
  assert.equal(readMatchedUpdateWorkload("").id, "steady-properties");
  assert.equal(
    readMatchedUpdateWorkload("steady-properties").id,
    "steady-properties",
  );
  assert.equal(readMatchedUpdateWorkload("mixed-product").id, "mixed-product");
  assert.throws(
    () => readMatchedUpdateWorkload("synthetic"),
    /must be steady-properties or mixed-product/u,
  );
});

test("normalizes the interactive Android window before every sample", async () => {
  const source = await readFile(
    new URL("./android-update-matched-benchmark.mjs", import.meta.url),
    "utf8",
  );
  const launch = source.indexOf('adb("shell", "am", "force-stop"');
  const instrument = source.indexOf('"instrument",', launch);
  assert.ok(launch >= 0 && instrument > launch);
  for (const command of [
    'adb("shell", "input", "keyevent", "KEYCODE_WAKEUP")',
    'adb("shell", "wm", "dismiss-keyguard")',
    'adb("shell", "cmd", "statusbar", "collapse")',
  ]) {
    const index = source.indexOf(command, launch);
    assert.ok(index > launch && index < instrument, command);
  }
});

test("summarizes seed-paired React and Solid update samples", () => {
  const samples = [
    {
      sampleIndex: 0,
      pairVariant: "baseline",
      completionP50Milliseconds: 70,
      completionP95Milliseconds: 80,
      completionMaxMilliseconds: 90,
      frames: 60,
      deadlineMisses: 1,
      frameP50Milliseconds: 5,
      frameP95Milliseconds: 8,
      frameMaxMilliseconds: 10,
    },
    {
      sampleIndex: 0,
      pairVariant: "observed",
      completionP50Milliseconds: 60,
      completionP95Milliseconds: 70,
      completionMaxMilliseconds: 80,
      frames: 50,
      deadlineMisses: 0,
      frameP50Milliseconds: 4,
      frameP95Milliseconds: 6,
      frameMaxMilliseconds: 8,
    },
    {
      sampleIndex: 1,
      pairVariant: "observed",
      completionP50Milliseconds: 65,
      completionP95Milliseconds: 75,
      completionMaxMilliseconds: 85,
      frames: 52,
      deadlineMisses: 1,
      frameP50Milliseconds: 4.5,
      frameP95Milliseconds: 7,
      frameMaxMilliseconds: 9,
    },
    {
      sampleIndex: 1,
      pairVariant: "baseline",
      completionP50Milliseconds: 75,
      completionP95Milliseconds: 85,
      completionMaxMilliseconds: 95,
      frames: 62,
      deadlineMisses: 2,
      frameP50Milliseconds: 5.5,
      frameP95Milliseconds: 9,
      frameMaxMilliseconds: 11,
    },
  ];

  const summary = summarizeMatchedUpdateSamples(samples);
  assert.equal(summary.frameP95Milliseconds.reactNative.median, 8.5);
  assert.equal(summary.frameP95Milliseconds.solidNative.median, 6.5);
  assert.equal(
    summary.frameP95Milliseconds.pairedDeltaSolidMinusReact.median,
    -2,
  );
  assert.equal(
    summary.completionP50Milliseconds.pairedDeltaSolidMinusReact.median,
    -10,
  );
});

test("retains a validated clean Pixel matched-update corpus", async () => {
  const result = JSON.parse(
    await readFile(
      new URL(
        "../../../docs/benchmark-results/android-matched-steady-updates-pixel-9a-2026-08-21.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );

  assert.equal(result.schemaVersion, 0);
  assert.equal(result.benchmark, "android-matched-steady-property-updates");
  assert.equal(result.interpretation, "diagnostic-only");
  assert.equal(result.environment.dirty, false);
  assert.equal(result.environment.deviceModel, "Pixel 9a");
  assert.match(result.environment.revision, /^[a-f\d]{40}$/u);
  assert.match(
    result.environment.nativeCompatibilityFingerprint,
    /^sha256:[a-f\d]{64}$/u,
  );
  assert.ok(result.environment.nativeCompatibilityInputCount > 0);
  assert.equal(result.configuration.sampleCountPerVariant, 6);
  assert.equal(result.configuration.warmupPairs, 1);
  assert.equal(result.configuration.orderSeed, 20_260_821);
  assert.equal(result.configuration.updateCountPerProcess, 30);
  assert.deepEqual(
    result.configuration.variantOrders,
    createBalancedPairOrders(6, "react-native", "solid-native", 20_260_821),
  );
  assert.deepEqual(
    result.configuration.warmupVariantOrders,
    createBalancedPairOrders(
      1,
      "react-native",
      "solid-native",
      (20_260_821 ^ 0x9e37_79b9) >>> 0,
    ),
  );
  assert.equal(result.samples.length, 12);
  assert.equal(
    result.samples.filter((sample) => sample.variant === "react-native").length,
    6,
  );
  assert.equal(
    result.samples.filter((sample) => sample.variant === "solid-native").length,
    6,
  );
  for (const sample of result.samples) {
    assert.equal(sample.initialThermalStatus, 0);
    assert.equal(sample.finalThermalStatus, 0);
    assert.equal(sample.evidence.completionMilliseconds.length, 30);
    assert.deepEqual(
      parseMatchedUpdateLog(
        `SOLID_NATIVE_MATCHED_UPDATE_RESULT ${JSON.stringify(sample.evidence)}`,
        sample.variant,
      ),
      sample.evidence,
    );
  }
  assert.deepEqual(
    summarizeMatchedUpdateSamples(result.samples),
    result.summary,
  );
});

test("retains a validated clean Pixel mixed-product corpus", async () => {
  const result = JSON.parse(
    await readFile(
      new URL(
        "../../../docs/benchmark-results/android-matched-product-workload-pixel-9a-2026-08-24.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );

  assert.equal(result.schemaVersion, 0);
  assert.equal(result.benchmark, "android-matched-mixed-product-workload");
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
  assert.equal(result.configuration.workload, "order-dashboard");
  assert.equal(result.configuration.rowCount, 12);
  assert.deepEqual(
    result.configuration.variantOrders,
    createBalancedPairOrders(6, "react-native", "solid-native", 20_260_824),
  );
  assert.deepEqual(
    result.configuration.warmupVariantOrders,
    createBalancedPairOrders(
      1,
      "react-native",
      "solid-native",
      (20_260_824 ^ 0x9e37_79b9) >>> 0,
    ),
  );
  assert.equal(result.samples.length, 12);
  assert.equal(
    result.samples.filter((sample) => sample.variant === "react-native").length,
    6,
  );
  assert.equal(
    result.samples.filter((sample) => sample.variant === "solid-native").length,
    6,
  );
  for (const sample of result.samples) {
    assert.equal(sample.initialThermalStatus, 0);
    assert.equal(sample.finalThermalStatus, 0);
    assert.equal(sample.evidence.completionMilliseconds.length, 30);
    assert.equal(sample.evidence.rowCount, 12);
    assert.equal(sample.evidence.activeOrderAssertions, 30);
    assert.equal(sample.evidence.alertAppearances, 6);
    assert.equal(sample.evidence.alertDisposals, 6);
    assert.equal(sample.evidence.frameMetrics.frozenFrames, 0);
    assert.equal(sample.evidence.frameMetrics.droppedReports, 0);
    assert.deepEqual(
      parseMatchedProductWorkloadLog(
        `SOLID_NATIVE_MATCHED_PRODUCT_RESULT ${JSON.stringify(sample.evidence)}`,
        sample.variant,
      ),
      sample.evidence,
    );
  }
  assert.deepEqual(
    summarizeMatchedUpdateSamples(result.samples),
    result.summary,
  );
});
