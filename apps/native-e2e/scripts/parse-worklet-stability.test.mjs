import assert from "node:assert/strict";
import test from "node:test";

import { parseWorkletStabilityLog } from "./parse-worklet-stability.mjs";

const result = {
  cadence: "high-refresh",
  frameCount: 601,
  intervalCount: 600,
  sampledIntervalCount: 600,
  droppedIntervalSampleCount: 0,
  firstFrameTimeMilliseconds: 100,
  lastFrameTimeMilliseconds: 5_100,
  minimumFrameIntervalMilliseconds: 8,
  maximumFrameIntervalMilliseconds: 9,
  meanFrameIntervalMilliseconds: 8.33,
  p50FrameIntervalMilliseconds: 8.3,
  p95FrameIntervalMilliseconds: 8.5,
  p99FrameIntervalMilliseconds: 8.7,
};

test("extracts normalized worklet stability JSON from Android and iOS logs", () => {
  const json = JSON.stringify(result);
  assert.deepEqual(
    parseWorkletStabilityLog(
      `ReactNativeJS: ${json}\nReactNativeJS: SOLID_NATIVE_UI_WORKLET_STABILITY_SUCCEEDED ${json}`,
    ),
    result,
  );
  assert.deepEqual(
    parseWorkletStabilityLog(
      `2026-08-21 SolidNativeE2E [javascript] 'SOLID_NATIVE_UI_WORKLET_STABILITY_SUCCEEDED', '${json}'`,
    ),
    result,
  );
});

test("rejects missing, malformed, or inconsistent stability evidence", () => {
  assert.throws(() => parseWorkletStabilityLog("ordinary log"), /omitted/);
  assert.throws(
    () =>
      parseWorkletStabilityLog(
        `SOLID_NATIVE_UI_WORKLET_STABILITY_SUCCEEDED nope`,
      ),
    /omitted JSON/,
  );
  assert.throws(
    () =>
      parseWorkletStabilityLog(
        `SOLID_NATIVE_UI_WORKLET_STABILITY_SUCCEEDED ${JSON.stringify({
          ...result,
          intervalCount: 599,
        })}`,
      ),
    /inconsistent/,
  );
});
