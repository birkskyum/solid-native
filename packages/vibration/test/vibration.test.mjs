import assert from "node:assert/strict";
import test from "node:test";

import {
  VIBRATION_DEFAULT_DURATION_MS,
  VIBRATION_MAX_DURATION_MS,
  VIBRATION_MAX_PATTERN_CYCLE_MS,
  VIBRATION_MAX_PATTERN_SEGMENTS,
  createVibrationService,
} from "../dist/index.js";

function memoryAdapter(platform = "android") {
  return {
    platform,
    cancellations: 0,
    requests: [],
    startVibration(request) {
      this.requests.push(request);
    },
    cancelVibration() {
      this.cancellations++;
    },
  };
}

test("normalizes bounded pulses and patterns", () => {
  const adapter = memoryAdapter();
  const service = createVibrationService(adapter);
  const defaultHandle = service.vibrate();
  assert.deepEqual(adapter.requests[0], {
    kind: "pulse",
    durationMs: VIBRATION_DEFAULT_DURATION_MS,
  });
  assert.ok(Object.isFrozen(adapter.requests[0]));
  assert.ok(Object.isFrozen(defaultHandle));

  const patternHandle = service.vibrate({
    pattern: [
      { delayMs: 0, durationMs: 60 },
      { delayMs: 90, durationMs: 120 },
    ],
    repeat: true,
  });
  assert.equal(adapter.cancellations, 1);
  assert.deepEqual(adapter.requests[1], {
    kind: "pattern",
    pattern: [
      { delayMs: 0, durationMs: 60 },
      { delayMs: 90, durationMs: 120 },
    ],
    repeat: true,
  });
  assert.ok(Object.isFrozen(adapter.requests[1]));
  assert.ok(Object.isFrozen(adapter.requests[1].pattern));
  assert.ok(Object.isFrozen(adapter.requests[1].pattern[0]));
  patternHandle.cancel();
  patternHandle.cancel();
  assert.equal(adapter.cancellations, 2);
});

test("stale leases cannot cancel newer process-wide feedback", () => {
  const adapter = memoryAdapter();
  const service = createVibrationService(adapter);
  const first = service.vibrate({ durationMs: 20 });
  const second = service.vibrate({ durationMs: 30 });
  assert.equal(adapter.cancellations, 1);
  first.cancel();
  assert.equal(adapter.cancellations, 1);
  second.cancel();
  assert.equal(adapter.cancellations, 2);

  const third = service.vibrate({ durationMs: 40 });
  service.cancel();
  service.cancel();
  third.cancel();
  assert.equal(adapter.cancellations, 3);
});

test("rejects malformed adapters and requests before cancelling active work", () => {
  assert.throws(() => createVibrationService(null), /plain object/u);
  assert.throws(
    () =>
      createVibrationService({
        platform: "web",
        startVibration() {},
        cancelVibration() {},
      }),
    /android or ios/u,
  );
  assert.throws(
    () => createVibrationService({ platform: "ios", startVibration() {} }),
    /startVibration.*cancelVibration/u,
  );

  const adapter = memoryAdapter();
  const service = createVibrationService(adapter);
  service.vibrate({ durationMs: 20 });
  const invalidRequests = [
    null,
    { durationMs: 0 },
    { durationMs: VIBRATION_MAX_DURATION_MS + 1 },
    { durationMs: 10, repeat: true },
    { durationMs: 10, pattern: [{ delayMs: 0, durationMs: 10 }] },
    { pattern: [] },
    { pattern: [{ delayMs: -1, durationMs: 10 }] },
    { pattern: [{ delayMs: 0, durationMs: 0 }] },
    { pattern: [{ delayMs: 0.5, durationMs: 10 }] },
    { pattern: [{ delayMs: 0, durationMs: 10 }], repeat: "yes" },
    {
      pattern: Array.from(
        { length: VIBRATION_MAX_PATTERN_SEGMENTS + 1 },
        () => ({ delayMs: 0, durationMs: 1 }),
      ),
    },
    {
      pattern: Array.from({ length: 6 }, () => ({
        delayMs: 0,
        durationMs: VIBRATION_MAX_PATTERN_CYCLE_MS / 5,
      })),
    },
  ];
  for (const request of invalidRequests) {
    assert.throws(() => service.vibrate(request));
  }
  assert.equal(adapter.cancellations, 0);
  assert.equal(adapter.requests.length, 1);
});

test("clears a failed lease before surfacing native cancellation errors", () => {
  let cancellationCalls = 0;
  const service = createVibrationService({
    platform: "android",
    startVibration() {},
    cancelVibration() {
      cancellationCalls++;
      throw new Error("native cancellation failed");
    },
  });
  const handle = service.vibrate({ durationMs: 20 });
  assert.throws(() => handle.cancel(), /native cancellation failed/u);
  service.cancel();
  handle.cancel();
  assert.equal(cancellationCalls, 1);
});
