import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseTelemetryBenchmarkLog,
  parseTelemetryEventLog,
  parseTelemetryEventLogs,
  parseTelemetryEventReadyLog,
  summarizePairedMetric,
} from "./android-telemetry-benchmark.mjs";
import {
  createBalancedPairOrders,
  readBenchmarkOrderSeed,
} from "./benchmark-statistics.mjs";

function fixture(overrides = {}) {
  return {
    schemaVersion: 0,
    benchmark: "causal-telemetry-shadow-commit",
    interpretation: "diagnostic-only",
    variant: "observed",
    warmupIterations: 100,
    measuredIterations: 1_000,
    durationMilliseconds: 12.5,
    microsecondsPerCommit: 12.5,
    telemetryRecordCount: 4_008,
    finalSequence: 1_102,
    finalHostRevision: 1_102,
    finalRevisionMounted: true,
    runtime: {
      name: "react-native-fabric",
      version: "0.87.0",
      hostContractVersion: 1,
      platform: "android",
    },
    ...overrides,
  };
}

function eventFixture(overrides = {}) {
  return {
    schemaVersion: 0,
    benchmark: "causal-telemetry-event-path",
    interpretation: "diagnostic-only",
    variant: "observed",
    warmupIterations: 100,
    measuredIterations: 1_000,
    eventIndex: 1,
    eventName: "press",
    eventPriority: "discrete",
    nativeEventTimestamp: 12_345.5,
    observedSequence: 1_102,
    commitSequence: 1_103,
    hostRevision: 1_103,
    handlerToCommitMilliseconds: 0.5,
    handlerToMountMilliseconds: 2,
    handlerToFrameMilliseconds: 8.3,
    commitToMountMilliseconds: 1.5,
    commitToFrameMilliseconds: 7.8,
    mountToFrameMilliseconds: 6.3,
    telemetryRecordCount: 8_740,
    finalRevisionMounted: true,
    runtime: fixture().runtime,
    ...overrides,
  };
}

test("parses a validated Android telemetry benchmark result", () => {
  const payload = fixture();
  const logs =
    `I/ReactNativeJS: before\n` +
    `I/ReactNativeJS: SOLID_NATIVE_TELEMETRY_BENCHMARK_RESULT ${JSON.stringify(payload)}\n`;
  assert.deepEqual(parseTelemetryBenchmarkLog(logs, "observed"), payload);
  assert.equal(
    parseTelemetryBenchmarkLog("I/ReactNativeJS: pending", "observed"),
    undefined,
  );
});

test("rejects incompatible or internally invalid benchmark results", () => {
  for (const payload of [
    fixture({ variant: "baseline" }),
    fixture({ finalRevisionMounted: false }),
    fixture({ microsecondsPerCommit: Number.NaN }),
    fixture({ telemetryRecordCount: 0 }),
    fixture({ finalSequence: 1_101 }),
    fixture({ microsecondsPerCommit: 12.6 }),
    fixture({ runtime: { ...fixture().runtime, hostContractVersion: 0 } }),
  ]) {
    assert.throws(
      () =>
        parseTelemetryBenchmarkLog(
          `SOLID_NATIVE_TELEMETRY_BENCHMARK_RESULT ${JSON.stringify(payload)}`,
          "observed",
        ),
      /incompatible result|invalid measurements|must be finite/,
    );
  }
});

test("parses a mounted Android telemetry event path and its target", () => {
  const ready = {
    schemaVersion: 0,
    variant: "observed",
    observedSequence: 1_102,
    bounds: { pageX: 20, pageY: 30, width: 200, height: 48 },
  };
  const result = eventFixture();
  assert.deepEqual(
    parseTelemetryEventReadyLog(
      `SOLID_NATIVE_TELEMETRY_EVENT_BENCHMARK_READY ${JSON.stringify(ready)}`,
      "observed",
    ),
    ready,
  );
  assert.deepEqual(
    parseTelemetryEventLog(
      `SOLID_NATIVE_TELEMETRY_EVENT_BENCHMARK_RESULT ${JSON.stringify(result)}`,
      "observed",
    ),
    result,
  );
  assert.equal(parseTelemetryEventLog("pending", "observed"), undefined);
});

test("parses every contiguous result in a sustained telemetry event path", () => {
  const first = eventFixture();
  const second = eventFixture({
    eventIndex: 2,
    nativeEventTimestamp: 12_400.5,
    observedSequence: 1_103,
    commitSequence: 1_104,
    hostRevision: 1_104,
    telemetryRecordCount: 8_748,
  });
  const logs =
    `SOLID_NATIVE_TELEMETRY_EVENT_BENCHMARK_RESULT ${JSON.stringify(first)}\n` +
    `SOLID_NATIVE_TELEMETRY_EVENT_BENCHMARK_RESULT ${JSON.stringify(second)}\n`;

  assert.deepEqual(parseTelemetryEventLogs(logs, "observed"), [first, second]);
  assert.deepEqual(parseTelemetryEventLog(logs, "observed"), second);
});

test("rejects invalid Android telemetry event targets and measurements", () => {
  assert.throws(
    () =>
      parseTelemetryEventReadyLog(
        `SOLID_NATIVE_TELEMETRY_EVENT_BENCHMARK_READY ${JSON.stringify({
          schemaVersion: 0,
          variant: "observed",
          observedSequence: 1_102,
          bounds: { pageX: 20, pageY: 30, width: 0, height: 48 },
        })}`,
        "observed",
      ),
    /invalid bounds/,
  );

  for (const payload of [
    eventFixture({ variant: "baseline" }),
    eventFixture({ commitSequence: 1_104 }),
    eventFixture({ handlerToFrameMilliseconds: 1 }),
    eventFixture({ commitToFrameMilliseconds: 1 }),
    eventFixture({ mountToFrameMilliseconds: 4 }),
    eventFixture({ telemetryRecordCount: 0 }),
    eventFixture({ eventPriority: "default" }),
  ]) {
    assert.throws(
      () =>
        parseTelemetryEventLog(
          `SOLID_NATIVE_TELEMETRY_EVENT_BENCHMARK_RESULT ${JSON.stringify(payload)}`,
          "observed",
        ),
      /incompatible result|invalid measurements/,
    );
  }
});

test("summarizes complete benchmark pairs as distributions", () => {
  const samples = [
    { sampleIndex: 0, variant: "baseline", value: 10 },
    { sampleIndex: 0, variant: "observed", value: 15 },
    { sampleIndex: 1, variant: "observed", value: 30 },
    { sampleIndex: 1, variant: "baseline", value: 20 },
  ];

  assert.deepEqual(summarizePairedMetric(samples, "value"), {
    baseline: {
      count: 2,
      minimum: 10,
      p25: 12.5,
      median: 15,
      p75: 17.5,
      p95: 19.5,
      maximum: 20,
      mean: 15,
    },
    observed: {
      count: 2,
      minimum: 15,
      p25: 18.75,
      median: 22.5,
      p75: 26.25,
      p95: 29.25,
      maximum: 30,
      mean: 22.5,
    },
    pairedDelta: {
      count: 2,
      minimum: 5,
      p25: 6.25,
      median: 7.5,
      p75: 8.75,
      p95: 9.75,
      maximum: 10,
      mean: 7.5,
    },
    differenceOfMedians: 7.5,
    relativeDifferenceOfMediansPercent: 50,
  });
});

test("rejects incomplete, duplicate, noncontiguous, and nonfinite pairs", () => {
  const baseline = { sampleIndex: 0, variant: "baseline", value: 10 };
  const observed = { sampleIndex: 0, variant: "observed", value: 15 };

  for (const samples of [
    [baseline],
    [baseline, observed, observed],
    [
      { ...baseline, sampleIndex: 1 },
      { ...observed, sampleIndex: 1 },
    ],
    [baseline, { ...observed, value: Number.NaN }],
  ]) {
    assert.throws(
      () => summarizePairedMetric(samples, "value"),
      /cannot be paired|duplicate variant|incomplete|must be finite/,
    );
  }
});

test("creates reproducible seed-balanced physical benchmark orders", () => {
  const first = createBalancedPairOrders(7, "baseline", "observed", 42);
  const second = createBalancedPairOrders(7, "baseline", "observed", 42);
  assert.deepEqual(first, second);
  assert.equal(first.filter(([variant]) => variant === "baseline").length, 4);
  assert.equal(first.filter(([variant]) => variant === "observed").length, 3);
  assert.ok(first.every((order) => new Set(order).size === 2));
  assert.ok(Object.isFrozen(first));
  assert.ok(first.every(Object.isFrozen));
});

test("validates explicit order seeds and bounds generated pair plans", () => {
  assert.equal(readBenchmarkOrderSeed("0", "ORDER_SEED"), 0);
  assert.equal(
    readBenchmarkOrderSeed("4294967295", "ORDER_SEED"),
    4_294_967_295,
  );
  assert.equal(
    readBenchmarkOrderSeed(undefined, "ORDER_SEED", () => 812),
    812,
  );
  for (const source of ["", "-1", "1.5", "4294967296", "seed"]) {
    assert.throws(
      () => readBenchmarkOrderSeed(source, "ORDER_SEED"),
      /unsigned 32-bit integer/u,
    );
  }
  assert.throws(
    () => createBalancedPairOrders(0, "baseline", "observed", 1),
    /positive integer/u,
  );
  assert.throws(
    () => createBalancedPairOrders(2, "same", "same", 1),
    /distinct names/u,
  );
});

test("retains a validated clean Pixel telemetry corpus", async () => {
  const resultDirectory = new URL(
    "../../../docs/benchmark-results/",
    import.meta.url,
  );
  const shadow = JSON.parse(
    await readFile(
      new URL(
        "android-causal-telemetry-shadow-pixel-9a-2026-08-21.json",
        resultDirectory,
      ),
      "utf8",
    ),
  );
  const event = JSON.parse(
    await readFile(
      new URL(
        "android-causal-telemetry-event-pixel-9a-2026-08-21.json",
        resultDirectory,
      ),
      "utf8",
    ),
  );
  const sustained = JSON.parse(
    await readFile(
      new URL(
        "android-causal-telemetry-sustained-pixel-9a-2026-08-21.json",
        resultDirectory,
      ),
      "utf8",
    ),
  );

  for (const result of [shadow, event, sustained]) {
    assert.equal(result.schemaVersion, 0);
    assert.equal(result.interpretation, "diagnostic-only");
    assert.equal(result.environment.dirty, false);
    assert.equal(result.environment.deviceModel, "Pixel 9a");
    assert.match(result.environment.revision, /^[a-f\d]{40}$/u);
    assert.match(
      result.environment.nativeCompatibilityFingerprint,
      /^sha256:[a-f\d]{64}$/u,
    );
    assert.ok(result.environment.nativeCompatibilityInputCount > 0);
    assert.equal(result.configuration.orderSeed, 20_260_821);
    assert.deepEqual(
      result.configuration.variantOrders,
      createBalancedPairOrders(6, "baseline", "observed", 20_260_821),
    );
    assert.equal(
      result.samples.length,
      result.configuration.sampleCount *
        2 *
        (result.configuration.eventsPerProcess ?? 1),
    );
    assert.ok(
      result.samples.every(
        (sample) =>
          sample.initialThermalStatus === 0 && sample.finalThermalStatus === 0,
      ),
    );
  }
  assert.equal(
    shadow.environment.nativeCompatibilityFingerprint,
    event.environment.nativeCompatibilityFingerprint,
  );
  assert.equal(
    shadow.environment.nativeCompatibilityInputCount,
    event.environment.nativeCompatibilityInputCount,
  );

  for (const sample of shadow.samples) {
    assert.deepEqual(
      parseTelemetryBenchmarkLog(
        `SOLID_NATIVE_TELEMETRY_BENCHMARK_RESULT ${JSON.stringify(sample)}`,
        sample.variant,
      ),
      sample,
    );
  }
  assert.deepEqual(
    summarizePairedMetric(shadow.samples, "microsecondsPerCommit"),
    shadow.summary.microsecondsPerCommit,
  );

  for (const eventResult of [event, sustained]) {
    for (const sample of eventResult.samples) {
      assert.deepEqual(
        parseTelemetryEventLog(
          `SOLID_NATIVE_TELEMETRY_EVENT_BENCHMARK_RESULT ${JSON.stringify(sample)}`,
          sample.variant,
        ),
        sample,
      );
    }
    for (const metric of [
      "handlerToCommitMilliseconds",
      "handlerToMountMilliseconds",
      "handlerToFrameMilliseconds",
      "commitToMountMilliseconds",
      "commitToFrameMilliseconds",
      "mountToFrameMilliseconds",
    ]) {
      assert.deepEqual(
        summarizePairedMetric(eventResult.samples, metric),
        eventResult.summary[metric],
      );
    }
  }

  assert.equal(sustained.benchmark, "android-causal-telemetry-sustained-event");
  assert.equal(sustained.configuration.processPairCount, 6);
  assert.equal(sustained.configuration.eventsPerProcess, 30);
  assert.equal(sustained.configuration.eventPairCount, 180);
  for (const variant of ["baseline", "observed"]) {
    for (let processPairIndex = 0; processPairIndex < 6; processPairIndex++) {
      const processSamples = sustained.samples.filter(
        (sample) =>
          sample.variant === variant &&
          sample.processPairIndex === processPairIndex,
      );
      assert.equal(processSamples.length, 30);
      for (const [eventOffset, sample] of processSamples.entries()) {
        assert.equal(sample.eventIndex, eventOffset + 1);
        assert.equal(sample.sampleIndex, processPairIndex * 30 + eventOffset);
        assert.equal(sample.commitSequence, sample.observedSequence + 1);
      }
    }
  }
});
