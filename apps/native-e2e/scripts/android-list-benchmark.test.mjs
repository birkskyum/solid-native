import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseListBenchmarkLog,
  parseReactNativeListBenchmarkLog,
  summarizeListSamples,
} from "./android-list-benchmark.mjs";
import {
  summarizeMatchedListSamples,
  summarizePairedListSamples,
} from "./android-list-matched-benchmark.mjs";

function frameFixture(overrides = {}) {
  return {
    schemaVersion: 1,
    manufacturer: "Google",
    model: "Pixel 9a",
    sdk: 37,
    osRelease: "17",
    frames: 75,
    deadlineMisses: 0,
    frozenFrames: 0,
    p50Milliseconds: 6,
    p95Milliseconds: 11.5,
    maxMilliseconds: 13.25,
    droppedReports: 0,
    ...overrides,
  };
}

function scrollFixture(overrides = {}) {
  return {
    schemaVersion: 0,
    itemCount: 1_000,
    activeRowCount: 12,
    maximumMountedRows: 12,
    ownerCreations: 27,
    ownerDisposals: 15,
    scrollOffset: 960,
    listSequence: 19,
    sequence: 20,
    hostRevision: 84,
    measuredHeight: 392,
    platform: "android",
    runtime: "react-native-fabric",
    runtimeVersion: "0.87.0",
    ...overrides,
  };
}

function imperativeFixture(overrides = {}) {
  return {
    schemaVersion: 0,
    index: 950,
    itemIndex: 900,
    viewPosition: 0.5,
    expectedOffset: 53_032,
    scrollOffset: 53_032,
    activeRowCount: 11,
    ownerCreations: 48,
    ownerDisposals: 37,
    beforeSequence: 42,
    windowSequence: 43,
    structuralCommitCount: 2,
    commandSequence: 45,
    commandPriority: "normal",
    sequence: 47,
    hostRevision: 106,
    measuredHeight: 392,
    ...overrides,
  };
}

function prependFixture(overrides = {}) {
  return {
    schemaVersion: 0,
    prependCount: 50,
    anchorKey: "item-14",
    beforeOffset: 792,
    expectedOffset: 3_592,
    scrollOffset: 3_592,
    activeRowCount: 12,
    beforeSequence: 40,
    prependSequence: 41,
    structuralCommitCount: 1,
    sequence: 42,
    hostRevision: 100,
    ...overrides,
  };
}

function teardownFixture(overrides = {}) {
  return {
    schemaVersion: 0,
    ownerCreations: 48,
    ownerDisposals: 48,
    activeRowCount: 0,
    rootDisposed: true,
    surfaceReady: false,
    ...overrides,
  };
}

function logs(overrides = {}) {
  const frameMetrics = overrides.frameMetrics ?? frameFixture();
  const scroll = overrides.scroll ?? scrollFixture();
  const prepend = overrides.prepend ?? prependFixture();
  const imperative = overrides.imperative ?? imperativeFixture();
  const teardown = overrides.teardown ?? teardownFixture();
  return [
    `I/ReactNativeJS: SOLID_NATIVE_VIRTUALIZED_LIST_SUCCEEDED ${JSON.stringify(scroll)}`,
    `I/SOLID_NATIVE: SOLID_NATIVE_VIRTUALIZED_LIST_FRAME_METRICS ${JSON.stringify(frameMetrics)}`,
    `I/ReactNativeJS: SOLID_NATIVE_VIRTUALIZED_LIST_PREPEND_SUCCEEDED ${JSON.stringify(prepend)}`,
    `I/ReactNativeJS: SOLID_NATIVE_VIRTUALIZED_LIST_IMPERATIVE_SUCCEEDED ${JSON.stringify(imperative)}`,
    `I/ReactNativeJS: SOLID_NATIVE_VIRTUALIZED_LIST_TEARDOWN_SUCCEEDED ${JSON.stringify(teardown)}`,
  ].join("\n");
}

function reactScrollFixture(overrides = {}) {
  return {
    schemaVersion: 0,
    variant: "react-native-flat-list",
    itemCount: 1_000,
    scrollOffset: 355,
    visibleRowCount: 8,
    mountedRowCount: 21,
    containsFirstRow: false,
    runtime: "react-native-fabric",
    runtimeVersion: "0.87.0",
    platform: "android",
    ...overrides,
  };
}

function reactImperativeFixture(overrides = {}) {
  return {
    schemaVersion: 0,
    variant: "react-native-flat-list",
    index: 950,
    itemIndex: 900,
    viewPosition: 0.5,
    expectedOffset: 53_032,
    scrollOffset: 53_032,
    visibleRowCount: 8,
    mountedRowCount: 21,
    ...overrides,
  };
}

function reactPrependFixture(overrides = {}) {
  return {
    schemaVersion: 0,
    variant: "react-native-flat-list",
    prependCount: 50,
    anchorKey: "item-7",
    beforeOffset: 355,
    expectedOffset: 3_155,
    scrollOffset: 3_155,
    visibleRowCount: 8,
    mountedRowCount: 21,
    ...overrides,
  };
}

function reactLogs(overrides = {}) {
  const frameMetrics = overrides.frameMetrics ?? frameFixture();
  const scroll = overrides.scroll ?? reactScrollFixture();
  const prepend = overrides.prepend ?? reactPrependFixture();
  const imperative = overrides.imperative ?? reactImperativeFixture();
  return [
    `I/ReactNativeJS: SOLID_NATIVE_REACT_LIST_SUCCEEDED ${JSON.stringify(scroll)}`,
    `I/SOLID_NATIVE: SOLID_NATIVE_REACT_LIST_FRAME_METRICS ${JSON.stringify(frameMetrics)}`,
    `I/ReactNativeJS: SOLID_NATIVE_REACT_LIST_PREPEND_SUCCEEDED ${JSON.stringify(prepend)}`,
    `I/ReactNativeJS: SOLID_NATIVE_REACT_LIST_IMPERATIVE_SUCCEEDED ${JSON.stringify(imperative)}`,
  ].join("\n");
}

test("parses complete physical list frame and lifecycle evidence", () => {
  assert.deepEqual(parseListBenchmarkLog(logs()), {
    frameMetrics: frameFixture(),
    scroll: scrollFixture(),
    prepend: prependFixture(),
    imperative: imperativeFixture(),
    teardown: teardownFixture(),
  });
  assert.equal(parseListBenchmarkLog("I/ReactNativeJS: ready"), undefined);
  assert.equal(
    parseListBenchmarkLog(
      logs({
        scroll: scrollFixture({ measuredHeight: 391.999_969_482_421_9 }),
        imperative: imperativeFixture({
          measuredHeight: 391.999_969_482_421_9,
        }),
      }),
    )?.scroll.measuredHeight,
    391.999_969_482_421_9,
  );
});

test("rejects incomplete or internally invalid physical list evidence", () => {
  assert.throws(
    () =>
      parseListBenchmarkLog(
        `SOLID_NATIVE_VIRTUALIZED_LIST_FRAME_METRICS ${JSON.stringify(frameFixture())}`,
      ),
    /marker set is incomplete/,
  );
  for (const source of [
    logs({ frameMetrics: frameFixture({ frozenFrames: 1 }) }),
    logs({ frameMetrics: frameFixture({ p95Milliseconds: 5 }) }),
    logs({ scroll: scrollFixture({ ownerDisposals: 14 }) }),
    logs({ scroll: scrollFixture({ measuredHeight: 390.9 }) }),
    logs({ prepend: prependFixture({ scrollOffset: 3_500 }) }),
    logs({ prepend: prependFixture({ prependSequence: 42 }) }),
    logs({ prepend: prependFixture({ structuralCommitCount: 0 }) }),
    logs({ prepend: prependFixture({ structuralCommitCount: 5 }) }),
    logs({ imperative: imperativeFixture({ commandSequence: 23 }) }),
    logs({ imperative: imperativeFixture({ windowSequence: 23 }) }),
    logs({ imperative: imperativeFixture({ hostRevision: 84 }) }),
    logs({ imperative: imperativeFixture({ scrollOffset: 50_200 }) }),
    logs({ imperative: imperativeFixture({ measuredHeight: 393.1 }) }),
    logs({ teardown: teardownFixture({ ownerDisposals: 37 }) }),
  ]) {
    assert.throws(() => parseListBenchmarkLog(source), /invalid evidence/);
  }
});

test("parses a matched React Native FlatList control", () => {
  assert.deepEqual(parseReactNativeListBenchmarkLog(reactLogs()), {
    frameMetrics: frameFixture(),
    scroll: reactScrollFixture(),
    prepend: reactPrependFixture(),
    imperative: reactImperativeFixture(),
  });
  assert.equal(
    parseReactNativeListBenchmarkLog("I/ReactNativeJS: ready"),
    undefined,
  );
});

test("rejects incomplete or invalid React Native FlatList control evidence", () => {
  assert.throws(
    () =>
      parseReactNativeListBenchmarkLog(
        `SOLID_NATIVE_REACT_LIST_FRAME_METRICS ${JSON.stringify(frameFixture())}`,
      ),
    /marker set is incomplete/,
  );
  for (const source of [
    reactLogs({ frameMetrics: frameFixture({ frozenFrames: 1 }) }),
    reactLogs({ scroll: reactScrollFixture({ mountedRowCount: 51 }) }),
    reactLogs({ scroll: reactScrollFixture({ containsFirstRow: true }) }),
    reactLogs({ prepend: reactPrependFixture({ anchorKey: "prepended-1" }) }),
    reactLogs({ prepend: reactPrependFixture({ scrollOffset: 3_100 }) }),
    reactLogs({ imperative: reactImperativeFixture({ index: 899 }) }),
    reactLogs({ imperative: reactImperativeFixture({ scrollOffset: 50_200 }) }),
  ]) {
    assert.throws(
      () => parseReactNativeListBenchmarkLog(source),
      /invalid evidence/,
    );
  }
});

test("keeps the matched keyed-prepend workload aligned across both Android variants", async () => {
  const directory = new URL("../", import.meta.url);
  const [control, instrumentation, parser, matchedRunner] = await Promise.all([
    readFile(new URL("list-control.ts", directory), "utf8"),
    readFile(
      new URL(
        "android/app/src/androidTest/java/dev/solidnative/e2e/SolidNativePhysicalTest.kt",
        directory,
      ),
      "utf8",
    ),
    readFile(new URL("scripts/android-list-benchmark.mjs", directory), "utf8"),
    readFile(
      new URL("scripts/android-list-matched-benchmark.mjs", directory),
      "utf8",
    ),
  ]);

  assert.match(
    control,
    /maintainVisibleContentPosition: \{ minIndexForVisible: 0 \}/u,
  );
  assert.match(control, /SOLID_NATIVE_REACT_LIST_PREPEND_SUCCEEDED/u);
  assert.match(
    control,
    /index: IMPERATIVE_LOGICAL_INDEX,[\s\S]*itemIndex: IMPERATIVE_ITEM_INDEX/u,
  );
  assert.match(instrumentation, /REACT_LIST_PREPEND_LABEL/u);
  assert.match(instrumentation, /REACT_LIST_PREPEND_SUCCEEDED_TEXT/u);
  assert.match(parser, /PREPEND_MARKER/u);
  assert.match(parser, /REACT_PREPEND_MARKER/u);
  assert.match(matchedRunner, /prependCount: 50/u);
  assert.match(matchedRunner, /imperativeExpectedOffset: 53_032/u);
});

test("summarizes repeated list samples on one device and runtime", () => {
  const first = {
    sampleIndex: 0,
    instrumentationDurationMilliseconds: 1_000,
    ...parseListBenchmarkLog(logs()),
  };
  const second = {
    sampleIndex: 1,
    instrumentationDurationMilliseconds: 1_200,
    ...parseListBenchmarkLog(
      logs({
        frameMetrics: frameFixture({
          frames: 77,
          deadlineMisses: 1,
          p50Milliseconds: 7,
          p95Milliseconds: 12.5,
          maxMilliseconds: 15.25,
        }),
      }),
    ),
  };
  const summary = summarizeListSamples([first, second]);
  assert.equal(summary.frames.median, 76);
  assert.equal(summary.deadlineMisses.mean, 0.5);
  assert.equal(summary.p50Milliseconds.p95, 6.95);
  assert.equal(summary.p95Milliseconds.median, 12);
  assert.equal(summary.maxMilliseconds.maximum, 15.25);
  assert.equal(summary.instrumentationDurationMilliseconds.median, 1_100);
});

test("rejects noncontiguous or cross-device list samples", () => {
  const sample = {
    sampleIndex: 0,
    instrumentationDurationMilliseconds: 1_000,
    ...parseListBenchmarkLog(logs()),
  };
  assert.throws(
    () => summarizeListSamples([{ ...sample, sampleIndex: 1 }]),
    /inconsistent devices or runtimes/,
  );
  assert.throws(
    () =>
      summarizeListSamples([
        sample,
        {
          ...sample,
          sampleIndex: 1,
          frameMetrics: frameFixture({ model: "Different phone" }),
        },
      ]),
    /inconsistent devices or runtimes/,
  );
});

test("summarizes alternating React Native and Solid Native list pairs", () => {
  const summary = summarizeMatchedListSamples([
    {
      sampleIndex: 0,
      pairVariant: "baseline",
      frames: 70,
      deadlineMisses: 0,
      p50Milliseconds: 6,
      p95Milliseconds: 12,
      maxMilliseconds: 14,
    },
    {
      sampleIndex: 0,
      pairVariant: "observed",
      frames: 72,
      deadlineMisses: 0,
      p50Milliseconds: 5,
      p95Milliseconds: 10,
      maxMilliseconds: 12,
    },
    {
      sampleIndex: 1,
      pairVariant: "observed",
      frames: 74,
      deadlineMisses: 0,
      p50Milliseconds: 5.5,
      p95Milliseconds: 11,
      maxMilliseconds: 13,
    },
    {
      sampleIndex: 1,
      pairVariant: "baseline",
      frames: 71,
      deadlineMisses: 0,
      p50Milliseconds: 6.5,
      p95Milliseconds: 13,
      maxMilliseconds: 15,
    },
  ]);
  assert.equal(summary.p95Milliseconds.reactNative.median, 12.5);
  assert.equal(summary.p95Milliseconds.solidNative.median, 10.5);
  assert.equal(summary.p95Milliseconds.pairedDeltaSolidMinusReact.median, -2);
  assert.equal(summary.frames.differenceOfMediansSolidMinusReact, 2.5);
});

test("summarizes generic paired list variants without renderer-specific labels", () => {
  const summary = summarizePairedListSamples([
    {
      sampleIndex: 0,
      pairVariant: "baseline",
      frames: 70,
      deadlineMisses: 0,
      p50Milliseconds: 6,
      p95Milliseconds: 12,
      maxMilliseconds: 14,
    },
    {
      sampleIndex: 0,
      pairVariant: "observed",
      frames: 72,
      deadlineMisses: 0,
      p50Milliseconds: 5,
      p95Milliseconds: 10,
      maxMilliseconds: 12,
    },
  ]);
  assert.equal(summary.p95Milliseconds.baseline.median, 12);
  assert.equal(summary.p95Milliseconds.observed.median, 10);
  assert.equal(
    summary.p95Milliseconds.pairedDeltaObservedMinusBaseline.median,
    -2,
  );
});

test("retains a validated clean Pixel matched-list corpus", async () => {
  const source = await readFile(
    new URL(
      "../../../docs/benchmark-results/android-matched-list-pixel-9a-2026-08-21.json",
      import.meta.url,
    ),
    "utf8",
  );
  const result = JSON.parse(source);

  assert.equal(result.schemaVersion, 0);
  assert.equal(result.benchmark, "android-matched-virtualized-list-frames");
  assert.equal(result.interpretation, "diagnostic-only");
  assert.equal(result.environment.dirty, false);
  assert.match(result.environment.revision, /^[a-f\d]{40}$/u);
  assert.match(
    result.environment.nativeCompatibilityFingerprint,
    /^sha256:[a-f\d]{64}$/u,
  );
  assert.equal(result.environment.nativeCompatibilityInputCount, 103);
  assert.equal(result.environment.deviceModel, "Pixel 9a");
  assert.equal(result.environment.osVersion, "17");
  assert.equal(result.environment.lowPowerMode, "0");
  assert.equal(result.configuration.sampleCountPerVariant, 6);
  assert.equal(result.configuration.warmupPairs, 1);
  assert.equal(result.configuration.order, "seeded-balanced");
  assert.equal(result.configuration.orderSeed, 20_260_821);
  assert.equal(result.samples.length, 12);

  for (let sampleIndex = 0; sampleIndex < 6; sampleIndex++) {
    const pair = result.samples.filter(
      (sample) => sample.sampleIndex === sampleIndex,
    );
    assert.deepEqual(
      pair.map((sample) => sample.orderIndex),
      [0, 1],
    );
    assert.deepEqual(
      pair.map((sample) => sample.variant),
      result.configuration.variantOrders[sampleIndex],
    );
  }

  assert.equal(
    result.configuration.variantOrders.filter(
      ([first]) => first === "react-native-flat-list",
    ).length,
    3,
  );
  for (const sample of result.samples) {
    assert.equal(sample.initialThermalStatus, 0);
    assert.equal(sample.finalThermalStatus, 0);
    assert.equal(sample.deadlineMisses, 0);
    assert.equal(sample.evidence.frameMetrics.frozenFrames, 0);
    assert.equal(sample.evidence.frameMetrics.droppedReports, 0);
    assert.equal(sample.evidence.imperative.scrollOffset, 50_232);
    if (sample.variant === "solid-native-virtualized-list") {
      assert.equal(sample.pairVariant, "observed");
      assert.equal(sample.evidence.scroll.maximumMountedRows, 12);
      assert.equal(sample.evidence.teardown.ownerCreations, 38);
      assert.equal(sample.evidence.teardown.ownerDisposals, 38);
      assert.equal(sample.evidence.teardown.activeRowCount, 0);
      assert.equal(sample.evidence.teardown.rootDisposed, true);
      assert.equal(sample.evidence.teardown.surfaceReady, false);
    } else {
      assert.equal(sample.variant, "react-native-flat-list");
      assert.equal(sample.pairVariant, "baseline");
    }
  }
  assert.deepEqual(summarizeMatchedListSamples(result.samples), result.summary);
});
