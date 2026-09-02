import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseMemory,
  parseProcessStat,
  parseProcessStatus,
  summarizeProcessor,
} from "./android-memory-sample.mjs";

test("parses Android process memory and scheduler counters", () => {
  assert.deepEqual(parseMemory("TOTAL PSS: 12,345\nTOTAL RSS: 67,890\n"), {
    totalPssKiB: 12_345,
    totalRssKiB: 67_890,
  });
  assert.deepEqual(
    parseProcessStat(
      "9785 (idnative.memory) S 1 1 1 0 -1 0 0 0 0 0 24 11 0 0 0 -10 27 0 62723270",
    ),
    {
      cpuTimeTicks: 35,
      threadCount: 27,
      startTimeTicks: 62_723_270,
    },
  );
  assert.deepEqual(
    parseProcessStatus(
      "Threads:\t27\nvoluntary_ctxt_switches:\t436\nnonvoluntary_ctxt_switches:\t34\n",
    ),
    {
      voluntaryMainThreadContextSwitches: 436,
      involuntaryMainThreadContextSwitches: 34,
    },
  );
});

test("summarizes bounded Android idle processor work", () => {
  const samples = [
    {
      cpuPercent: null,
      cpuTimeTicks: 100,
      voluntaryMainThreadContextSwitches: 10,
      involuntaryMainThreadContextSwitches: 2,
      threadCount: 5,
    },
    {
      cpuPercent: 2,
      cpuTimeTicks: 102,
      voluntaryMainThreadContextSwitches: 12,
      involuntaryMainThreadContextSwitches: 3,
      threadCount: 6,
    },
    {
      cpuPercent: 3,
      cpuTimeTicks: 105,
      voluntaryMainThreadContextSwitches: 15,
      involuntaryMainThreadContextSwitches: 3,
      threadCount: 4,
    },
  ];
  assert.deepEqual(summarizeProcessor(samples, 2, 100), {
    cpuPercentSampleCount: 2,
    meanCpuPercent: 2.5,
    p95CpuPercent: 3,
    maximumCpuPercent: 3,
    cpuTimeSeconds: 0.05,
    cpuTimeEquivalentPercent: 2.5,
    mainThreadContextSwitches: 6,
    mainThreadContextSwitchesPerSecond: 3,
    voluntaryMainThreadContextSwitches: 5,
    involuntaryMainThreadContextSwitches: 1,
    minimumThreadCount: 4,
    maximumThreadCount: 6,
  });
  assert.throws(
    () =>
      summarizeProcessor(
        [samples[1], { ...samples[2], cpuTimeTicks: 101 }],
        1,
        100,
      ),
    /cpuTimeTicks counter moved backwards/u,
  );
});

test("stops the sampled Android process before reporting success", async () => {
  const source = await readFile(
    new URL("./android-memory-sample.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /const SIGNALS = \["SIGHUP", "SIGINT", "SIGTERM"\]/u);
  assert.match(source, /process\.once\("exit", onExit\)/u);
  assert.match(source, /"am",\s*"force-stop",\s*bundleIdentifier/u);
  assert.ok(
    source.indexOf("finishProcessCleanup();") <
      source.indexOf("SOLID_NATIVE_ANDROID_MEMORY_RESULT"),
    "The sampler reports success before process cleanup.",
  );
});
