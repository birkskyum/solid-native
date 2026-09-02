import os from "node:os";
import { performance } from "node:perf_hooks";

import {
  CORE_COMPONENT_DESCRIPTORS,
  Text,
  VirtualizedList,
} from "@solid-native/core";
import { createComponent, mount } from "@solid-native/renderer";
import { onCleanup } from "solid-js";

import { InMemoryHost } from "../dist/index.js";

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

function summarize(durations, iterations) {
  const sorted = durations.toSorted((left, right) => left - right);
  const median = quantile(sorted, 0.5);
  const p95 = quantile(sorted, 0.95);
  return {
    sampleCount: sorted.length,
    iterationsPerSample: iterations,
    samplesMilliseconds: durations.map((duration) => round(duration, 6)),
    minimumBatchMilliseconds: round(sorted[0]),
    medianBatchMilliseconds: round(median),
    p95BatchMilliseconds: round(p95),
    maximumBatchMilliseconds: round(sorted.at(-1)),
    meanBatchMilliseconds: round(
      sorted.reduce((total, duration) => total + duration, 0) / sorted.length,
    ),
    medianMicrosecondsPerWindowShift: round((median * 1_000) / iterations),
    medianWindowShiftsPerSecond: round((iterations * 1_000) / median),
  };
}

async function measureSample(configuration) {
  const host = new InMemoryHost({ descriptors: CORE_COMPONENT_DESCRIPTORS });
  const items = Array.from({ length: configuration.itemCount }, (_, index) => ({
    id: `item-${String(index)}`,
  }));
  let ownerCreations = 0;
  let ownerDisposals = 0;
  const application = mount(
    () =>
      createComponent(VirtualizedList, {
        data: items,
        itemSize: configuration.itemSize,
        viewportSize: configuration.viewportSize,
        overscan: configuration.overscan,
        keyExtractor: (item) => item.id,
        renderItem({ item, index }) {
          ownerCreations++;
          onCleanup(() => {
            ownerDisposals++;
          });
          return createComponent(Text, {
            get children() {
              return `${item().id}:${String(index())}`;
            },
          });
        },
      }),
    host,
    {
      surface: { name: "virtualized-list-benchmark" },
      autoCommit: false,
    },
  );
  await application.root.flush();
  const initialSnapshot = host.getSurfaceSnapshot(application.root.surfaceId);
  const scrollView = initialSnapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "ScrollView",
  );
  if (scrollView === undefined) {
    throw new Error("The list benchmark did not mount its ScrollView.");
  }

  const shiftWindow = async (iteration) => {
    host.injectEvent({
      surface: application.root.surfaceId,
      target: scrollView.node,
      name: "scroll",
      payload: {
        contentOffset: {
          x: 0,
          y: iteration * configuration.itemSize,
        },
      },
      priority: "continuous",
      bubbles: true,
      coalescible: true,
    });
    if ((await application.root.flush()) === undefined) {
      throw new Error("A virtualized window shift did not produce a commit.");
    }
  };

  for (
    let iteration = 1;
    iteration <= configuration.warmupIterations;
    iteration++
  ) {
    await shiftWindow(iteration);
  }
  const startedAt = performance.now();
  for (let iteration = 1; iteration <= configuration.iterations; iteration++) {
    await shiftWindow(configuration.warmupIterations + iteration);
  }
  const duration = performance.now() - startedAt;

  const finalSnapshot = host.getSurfaceSnapshot(application.root.surfaceId);
  const content = finalSnapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "ScrollContentView",
  );
  if (content === undefined) {
    throw new Error("The list benchmark lost its content container.");
  }
  const maximumMountedRows =
    Math.ceil(configuration.viewportSize / configuration.itemSize) +
    configuration.overscan * 2;
  const mountedRows = content.children.length;
  const expectedNodeCount = 3 + mountedRows * 3;
  const totalIterations =
    configuration.warmupIterations + configuration.iterations;
  if (
    mountedRows > maximumMountedRows ||
    finalSnapshot.nodes.length !== expectedNodeCount ||
    ownerCreations - ownerDisposals !== mountedRows ||
    host.commits.length !== totalIterations + 1
  ) {
    throw new Error(
      "The list benchmark did not retain a bounded, ownership-safe window.",
    );
  }

  await application.dispose();
  if (ownerDisposals !== ownerCreations) {
    throw new Error("The list benchmark leaked Solid row owners.");
  }
  return { duration, maximumMountedRows };
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
  const configuration = {
    warmupIterations: readPositiveInteger(
      "SOLID_NATIVE_LIST_BENCH_WARMUP",
      100,
    ),
    iterations: readPositiveInteger(
      "SOLID_NATIVE_LIST_BENCH_ITERATIONS",
      1_000,
    ),
    sampleCount: readPositiveInteger("SOLID_NATIVE_LIST_BENCH_SAMPLES", 12),
    itemCount: readPositiveInteger("SOLID_NATIVE_LIST_BENCH_ITEMS", 10_000),
    itemSize: readPositiveInteger("SOLID_NATIVE_LIST_BENCH_ITEM_SIZE", 50),
    viewportSize: readPositiveInteger(
      "SOLID_NATIVE_LIST_BENCH_VIEWPORT_SIZE",
      600,
    ),
    overscan: readPositiveInteger("SOLID_NATIVE_LIST_BENCH_OVERSCAN", 2),
  };
  const requiredItems =
    configuration.warmupIterations +
    configuration.iterations +
    Math.ceil(configuration.viewportSize / configuration.itemSize) +
    configuration.overscan;
  if (configuration.itemCount <= requiredItems) {
    throw new RangeError(
      `SOLID_NATIVE_LIST_BENCH_ITEMS must be greater than ${String(requiredItems)} for the requested forward-only run.`,
    );
  }

  const durations = [];
  let maximumMountedRows = 0;
  for (let sample = 0; sample < configuration.sampleCount; sample++) {
    globalThis.gc?.();
    const result = await measureSample(configuration);
    durations.push(result.duration);
    maximumMountedRows = Math.max(
      maximumMountedRows,
      result.maximumMountedRows,
    );
  }
  const cpu = os.cpus()[0];
  const result = {
    schemaVersion: 0,
    benchmark: "virtualized-list-window-churn",
    measuredAt: new Date().toISOString(),
    interpretation: "javascript-in-memory-diagnostic-only",
    configuration: {
      ...configuration,
      maximumMountedRows,
    },
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      cpuModel: cpu?.model ?? "unknown",
      logicalCpuCount: os.cpus().length,
    },
    summary: summarize(durations, configuration.iterations),
  };

  if (jsonOnly) {
    console.log(JSON.stringify(result));
    return;
  }
  console.log("VirtualizedList fixed-extent window churn");
  console.log(
    `${String(configuration.itemCount)} logical items; at most ${String(maximumMountedRows)} mounted rows`,
  );
  console.log(
    `Median ${result.summary.medianMicrosecondsPerWindowShift.toFixed(3)} µs/window shift; ` +
      `p95 batch ${result.summary.p95BatchMilliseconds.toFixed(3)} ms`,
  );
  console.log(
    "This excludes Hermes, JSI, Fabric, layout, platform mount, scrolling, and frames.",
  );
  console.log(`SOLID_NATIVE_LIST_BENCHMARK_RESULT ${JSON.stringify(result)}`);
}

await main();
