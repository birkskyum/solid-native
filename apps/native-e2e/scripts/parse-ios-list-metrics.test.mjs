import assert from "node:assert/strict";
import test from "node:test";

import { parseIOSListMetrics } from "./parse-ios-list-metrics.mjs";

const systemPrefix =
  "com.apple.dt.XCTMetric_OSSignpost-Scroll_DraggingAndDeceleration";
const appPrefix = "com.apple.dt.XCTMetric_Hitch-list";

function metric(identifier, measurement) {
  return {
    displayName: identifier,
    identifier,
    measurements: [measurement],
    unitOfMeasurement: "value",
  };
}

function completeResult() {
  return [
    {
      testIdentifier:
        "SolidNativeE2EUITests/testVirtualizedListOnPhysicalDevice()",
      testRuns: [
        {
          device: { deviceId: "iphone-id", deviceName: "Physical iPhone" },
          metrics: [
            metric(`${systemPrefix}.duration`, 2.24),
            metric(`${systemPrefix}.animation.hitch.number`, 1),
            metric(`${systemPrefix}.animation.hitch.time.ratio`, 7.43),
            metric(`${systemPrefix}.animation.frame.count`, 0),
            metric(`${systemPrefix}.animation.frame.rate`, 40.59),
            metric(`${systemPrefix}.animation.hitches.total.duration`, 16.67),
            metric(`${appPrefix}.time.ratio`, 0),
            metric(`${appPrefix}.total.duration`, 0),
            metric(`${appPrefix}.number`, 0),
          ],
        },
      ],
    },
  ];
}

test("parses complete iPhone list scroll and hitch metrics", () => {
  assert.deepEqual(parseIOSListMetrics(completeResult()), {
    schemaVersion: 0,
    deviceId: "iphone-id",
    deviceName: "Physical iPhone",
    durationSeconds: 2.24,
    systemAnimationHitches: 1,
    systemAnimationHitchTimeRatioMsPerSecond: 7.43,
    systemAnimationFrameCount: 0,
    systemAnimationFrameRate: 40.59,
    systemAnimationHitchDurationMilliseconds: 16.67,
    applicationHitchTimeRatioMsPerSecond: 0,
    applicationHitchDurationSeconds: 0,
    applicationHitches: 0,
  });
});

test("accepts an older iPhone result without app-targeted hitch metrics", () => {
  const result = completeResult();
  result[0].testRuns[0].metrics.splice(-3);
  const parsed = parseIOSListMetrics(result);
  assert.equal(parsed.systemAnimationFrameRate, 40.59);
  assert.equal("applicationHitches" in parsed, false);
});

test("rejects missing, duplicate, partial, or invalid iPhone list metrics", () => {
  const missing = completeResult();
  missing[0].testRuns[0].metrics.shift();
  assert.throws(() => parseIOSListMetrics(missing), /omitted metric/);

  const duplicate = completeResult();
  duplicate[0].testRuns[0].metrics.push(duplicate[0].testRuns[0].metrics[0]);
  assert.throws(() => parseIOSListMetrics(duplicate), /duplicated/);

  const partial = completeResult();
  partial[0].testRuns[0].metrics.pop();
  assert.throws(() => parseIOSListMetrics(partial), /incomplete/);

  const invalid = completeResult();
  invalid[0].testRuns[0].metrics[0].measurements = [0];
  assert.throws(() => parseIOSListMetrics(invalid), /positive duration/);
});
