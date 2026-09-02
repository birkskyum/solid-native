import os from "node:os";
import { performance } from "node:perf_hooks";

import { CORE_COMPONENT_DESCRIPTORS, Text } from "@solid-native/core";
import {
  DEFAULT_CAUSAL_TIMELINE_CAPACITY,
  createCausalTelemetry,
  createCausalTimeline,
} from "@solid-native/observability";
import { createComponent, createSignal, mount } from "@solid-native/renderer";

import { InMemoryHost } from "../dist/index.js";

const MODES = ["disabled", "noop-sink", "resource-noop-sink", "local-timeline"];

function readPositiveInteger(name, fallback) {
  const source = process.env[name];
  if (source === undefined) return fallback;
  const value = Number(source);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
  return value;
}

function quantile(sorted, probability) {
  if (sorted.length === 0) throw new Error("Cannot summarize zero samples.");
  const position = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  if (lower === undefined || upper === undefined) {
    throw new Error("The benchmark sample set is incomplete.");
  }
  return lower + (upper - lower) * (position - lowerIndex);
}

function round(value, places = 3) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function summarize(durations, iterations, disabledMedian) {
  const sorted = durations.toSorted((left, right) => left - right);
  const median = quantile(sorted, 0.5);
  const p95 = quantile(sorted, 0.95);
  const mean =
    sorted.reduce((total, duration) => total + duration, 0) / sorted.length;
  return {
    sampleCount: sorted.length,
    iterationsPerSample: iterations,
    samplesMilliseconds: durations.map((duration) => round(duration, 6)),
    medianBatchMilliseconds: round(median),
    p95BatchMilliseconds: round(p95),
    meanBatchMilliseconds: round(mean),
    minBatchMilliseconds: round(sorted[0]),
    maxBatchMilliseconds: round(sorted.at(-1)),
    medianMicrosecondsPerCommit: round((median * 1_000) / iterations),
    medianCommitsPerSecond: round((iterations * 1_000) / median),
    medianDeltaMicrosecondsPerCommit:
      disabledMedian === undefined
        ? 0
        : round(((median - disabledMedian) * 1_000) / iterations),
    relativeMedianDeltaPercent:
      disabledMedian === undefined
        ? 0
        : round((median / disabledMedian - 1) * 100),
  };
}

function createTelemetry(mode, metadata) {
  if (mode === "disabled") return undefined;
  if (mode === "noop-sink") {
    return createCausalTelemetry({ sink() {} });
  }
  if (mode === "resource-noop-sink") {
    return createCausalTelemetry({
      sink() {},
      resource: {
        runtimeName: "react-native-fabric",
        runtimeVersion: "0.87.0",
        hostContractVersion: 1,
        platform: "benchmark",
        buildFingerprint: "local:benchmark",
      },
    });
  }
  const timeline = createCausalTimeline();
  metadata.timeline = timeline;
  return createCausalTelemetry({ sink: timeline.sink });
}

async function measureMode(mode, warmupIterations, iterations) {
  const metadata = { timeline: undefined };
  const telemetry = createTelemetry(mode, metadata);
  const host = new InMemoryHost({ descriptors: CORE_COMPONENT_DESCRIPTORS });
  const [value, setValue] = createSignal(0);
  let nextValue = 0;
  const application = mount(
    () =>
      createComponent(Text, {
        get children() {
          return `Value ${String(value())}`;
        },
      }),
    host,
    {
      surface: { name: `causal-overhead-${mode}` },
      autoCommit: false,
      ...(telemetry === undefined ? {} : { telemetry }),
    },
  );
  await application.root.flush();

  const update = async () => {
    setValue(++nextValue);
    const commit = await application.root.flush();
    if (commit === undefined) {
      throw new Error("A benchmark signal update did not produce a commit.");
    }
  };

  for (let index = 0; index < warmupIterations; index++) await update();
  const startedAt = performance.now();
  for (let index = 0; index < iterations; index++) await update();
  const duration = performance.now() - startedAt;

  const snapshot = host.getSurfaceSnapshot(application.root.surfaceId);
  const text = snapshot.nodes.find((node) => node.kind === "text");
  if (text?.text !== `Value ${String(nextValue)}`) {
    throw new Error("The benchmark did not observe the final signal value.");
  }
  if (host.commits.length !== 1 + warmupIterations + iterations) {
    throw new Error(
      "The benchmark did not produce one commit per signal update.",
    );
  }
  if (metadata.timeline !== undefined) {
    const timelineSnapshot = metadata.timeline.snapshot();
    if (timelineSnapshot.operations.length === 0) {
      throw new Error("The benchmark timeline did not retain operations.");
    }
  }

  await application.dispose();
  return duration;
}

async function main() {
  const unknownArguments = process.argv
    .slice(2)
    .filter((value) => value !== "--json");
  if (unknownArguments.length > 0) {
    throw new Error(
      `Unknown benchmark arguments: ${unknownArguments.join(", ")}`,
    );
  }
  const jsonOnly = process.argv.includes("--json");
  const warmupIterations = readPositiveInteger(
    "SOLID_NATIVE_BENCH_WARMUP",
    250,
  );
  const iterations = readPositiveInteger(
    "SOLID_NATIVE_BENCH_ITERATIONS",
    1_000,
  );
  const sampleCount = readPositiveInteger("SOLID_NATIVE_BENCH_SAMPLES", 12);
  const durationsByMode = new Map(MODES.map((mode) => [mode, []]));

  for (let sample = 0; sample < sampleCount; sample++) {
    const rotatedModes = MODES.map(
      (_, index) => MODES[(sample + index) % MODES.length],
    );
    for (const mode of rotatedModes) {
      if (mode === undefined) throw new Error("The benchmark mode is missing.");
      globalThis.gc?.();
      const duration = await measureMode(mode, warmupIterations, iterations);
      durationsByMode.get(mode)?.push(duration);
    }
  }

  const disabledDurations = durationsByMode.get("disabled");
  if (disabledDurations === undefined) {
    throw new Error("The disabled benchmark samples are missing.");
  }
  const disabledMedian = quantile(
    disabledDurations.toSorted((left, right) => left - right),
    0.5,
  );
  const modes = MODES.map((mode) => {
    const durations = durationsByMode.get(mode);
    if (durations === undefined) {
      throw new Error(`The ${mode} benchmark samples are missing.`);
    }
    return {
      mode,
      ...summarize(
        durations,
        iterations,
        mode === "disabled" ? undefined : disabledMedian,
      ),
    };
  });
  const cpu = os.cpus()[0];
  const result = {
    schemaVersion: 0,
    benchmark: "causal-renderer-overhead",
    measuredAt: new Date().toISOString(),
    configuration: {
      warmupIterations,
      iterationsPerSample: iterations,
      sampleCount,
      timelineCapacity: DEFAULT_CAUSAL_TIMELINE_CAPACITY,
    },
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      cpuModel: cpu?.model ?? "unknown",
      logicalCpuCount: os.cpus().length,
    },
    modes,
  };

  if (jsonOnly) {
    console.log(JSON.stringify(result, undefined, 2));
    return;
  }
  console.log("Solid Native causal renderer overhead benchmark");
  console.log(
    `${String(sampleCount)} samples × ${String(iterations)} measured commits; ` +
      `${String(warmupIterations)} warmup commits per sample`,
  );
  console.table(
    modes.map((mode) => ({
      mode: mode.mode,
      "median µs/commit": mode.medianMicrosecondsPerCommit,
      "median delta µs": mode.medianDeltaMicrosecondsPerCommit,
      "p95 batch ms": mode.p95BatchMilliseconds,
      "median commits/s": mode.medianCommitsPerSecond,
      "relative median %": mode.relativeMedianDeltaPercent,
    })),
  );
  console.log(`SOLID_NATIVE_BENCHMARK_RESULT ${JSON.stringify(result)}`);
}

await main();
