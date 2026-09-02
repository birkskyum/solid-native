import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseReloadMarkers,
  summarizeReloadResources,
} from "./android-reload-soak.mjs";

const settledMarker = Object.freeze({
  surface: 11,
  sequence: 1,
  workletSequence: 1,
  activeUIWorkletCount: 1,
  pendingUIWorkletFrameCount: 0,
});

test("parses every complete settled runtime-reload marker", () => {
  const source = [
    `ReactNativeJS: 'SOLID_NATIVE_RELOAD_MOUNTED', '${JSON.stringify(settledMarker)}'`,
    "unrelated native log",
    `SOLID_NATIVE_RELOAD_MOUNTED ${JSON.stringify({ ...settledMarker, surface: 12 })}`,
  ].join("\n");
  assert.deepEqual(parseReloadMarkers(source), [
    settledMarker,
    { ...settledMarker, surface: 12 },
  ]);
});

test("rejects stale, active, or partial runtime-reload evidence", () => {
  for (const marker of [
    { ...settledMarker, pendingUIWorkletFrameCount: 1 },
    { ...settledMarker, activeUIWorkletCount: 2 },
    { ...settledMarker, sequence: 2 },
    { ...settledMarker, workletSequence: 2 },
    {
      surface: settledMarker.surface,
      sequence: settledMarker.sequence,
    },
  ]) {
    assert.throws(
      () =>
        parseReloadMarkers(
          `SOLID_NATIVE_RELOAD_MOUNTED ${JSON.stringify(marker)}`,
        ),
      /complete known schema|one settled worklet/u,
    );
  }
});

test("summarizes bounded process-resource evidence without inventing a leak verdict", () => {
  assert.deepEqual(
    summarizeReloadResources([
      { threadCount: 20, totalPssKiB: 100_000, totalRssKiB: 120_000 },
      { threadCount: 22, totalPssKiB: 104_000, totalRssKiB: 125_000 },
      { threadCount: 21, totalPssKiB: 102_000, totalRssKiB: 123_000 },
    ]),
    {
      firstThreadCount: 20,
      lastThreadCount: 21,
      minimumThreadCount: 20,
      maximumThreadCount: 22,
      threadCountDelta: 1,
      firstTotalPssKiB: 100_000,
      lastTotalPssKiB: 102_000,
      maximumTotalPssKiB: 104_000,
      totalPssDeltaKiB: 2_000,
      firstTotalRssKiB: 120_000,
      lastTotalRssKiB: 123_000,
      maximumTotalRssKiB: 125_000,
      totalRssDeltaKiB: 3_000,
    },
  );
  assert.throws(() => summarizeReloadResources([]), /at least two/u);
});

test("cleans the app, reverse tunnel, and Metro before publishing reload success", async () => {
  const source = await readFile(
    new URL("./android-reload-soak.mjs", import.meta.url),
    "utf8",
  );
  const resultMarker = source.lastIndexOf("SOLID_NATIVE_ANDROID_RELOAD_RESULT");
  assert.ok(resultMarker > 0);
  for (const cleanup of [
    "await stopMetro(metro.child);",
    'adb.run("reverse", "--remove"',
    "stopAndroidProcesses(serial, [APP_ID]);",
    "cleaned = true;",
  ]) {
    const cleanupIndex = source.lastIndexOf(cleanup, resultMarker);
    assert.ok(cleanupIndex >= 0, `Missing pre-result cleanup: ${cleanup}`);
    assert.ok(cleanupIndex < resultMarker, cleanup);
  }
});
