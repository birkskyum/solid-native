import assert from "node:assert/strict";
import test from "node:test";

import { createVibrationService } from "../dist/index.js";
import {
  createAndroidVibrationAdapter,
  createIOSVibrationAdapter,
} from "../dist/react-native-adapter.js";

function nativeModule() {
  const module = {
    calls: [],
    cancel() {
      assert.equal(this, module);
      this.calls.push(["cancel"]);
    },
    vibrate(durationMs) {
      assert.equal(this, module);
      this.calls.push(["vibrate", durationMs]);
    },
    vibrateByPattern(pattern, repeatIndex) {
      assert.equal(this, module);
      this.calls.push(["pattern", pattern, repeatIndex]);
    },
  };
  return module;
}

test("translates portable patterns into one Android native waveform", () => {
  const module = nativeModule();
  const service = createVibrationService(createAndroidVibrationAdapter(module));
  service.vibrate({ durationMs: 75 });
  service.vibrate({
    pattern: [
      { delayMs: 0, durationMs: 40 },
      { delayMs: 80, durationMs: 120 },
    ],
    repeat: true,
  });
  assert.deepEqual(module.calls, [
    ["vibrate", 75],
    ["cancel"],
    ["pattern", [0, 40, 80, 120], 0],
  ]);
  assert.ok(Object.isFrozen(module.calls[2][1]));
  service.cancel();
  assert.deepEqual(module.calls.at(-1), ["cancel"]);

  service.vibrate({
    pattern: [{ delayMs: 10, durationMs: 20 }],
  });
  assert.deepEqual(module.calls.at(-1), ["pattern", [10, 20], -1]);
});

function manualScheduler() {
  const tasks = [];
  return {
    tasks,
    schedule(callback, delayMs) {
      const task = { callback, delayMs, cancelled: false };
      tasks.push(task);
      return () => {
        task.cancelled = true;
      };
    },
    runNext() {
      const task = tasks.find((candidate) => !candidate.cancelled);
      assert.ok(task);
      task.cancelled = true;
      task.callback();
      return task;
    },
  };
}

test("schedules fixed iOS pulses with portable segment timing", () => {
  const module = nativeModule();
  const scheduler = manualScheduler();
  const service = createVibrationService(
    createIOSVibrationAdapter(module, scheduler),
  );
  const handle = service.vibrate({
    pattern: [
      { delayMs: 0, durationMs: 40 },
      { delayMs: 80, durationMs: 120 },
    ],
    repeat: true,
  });
  assert.deepEqual(module.calls, [["vibrate", 40]]);
  assert.equal(scheduler.tasks[0].delayMs, 120);
  scheduler.runNext();
  assert.deepEqual(module.calls.at(-1), ["vibrate", 120]);
  assert.equal(scheduler.tasks[1].delayMs, 120);
  scheduler.runNext();
  assert.deepEqual(module.calls.at(-1), ["vibrate", 40]);
  assert.equal(scheduler.tasks[2].delayMs, 120);

  handle.cancel();
  assert.equal(scheduler.tasks[2].cancelled, true);
  assert.equal(
    module.calls.some(([name]) => name === "cancel"),
    false,
  );

  service.vibrate({ durationMs: 90 });
  assert.deepEqual(module.calls.at(-1), ["vibrate", 90]);
});

test("stops a non-repeating iOS pattern without leaving a timer", () => {
  const module = nativeModule();
  const scheduler = manualScheduler();
  const service = createVibrationService(
    createIOSVibrationAdapter(module, scheduler),
  );
  service.vibrate({
    pattern: [{ delayMs: 25, durationMs: 50 }],
  });
  assert.equal(module.calls.length, 0);
  assert.equal(scheduler.tasks[0].delayMs, 25);
  scheduler.runNext();
  assert.deepEqual(module.calls, [["vibrate", 50]]);
  assert.equal(scheduler.tasks.length, 1);
  service.cancel();
});

test("validates native module and scheduler seams", () => {
  assert.throws(
    () => createAndroidVibrationAdapter(null),
    /must be an object/u,
  );
  assert.throws(
    () => createAndroidVibrationAdapter({ vibrate() {}, cancel() {} }),
    /must provide vibrate.*vibrateByPattern.*cancel/u,
  );
  assert.throws(
    () => createIOSVibrationAdapter(nativeModule(), { schedule: true }),
    /must provide schedule/u,
  );
  const service = createVibrationService(
    createIOSVibrationAdapter(nativeModule(), {
      schedule() {
        return true;
      },
    }),
  );
  assert.throws(
    () =>
      service.vibrate({
        pattern: [{ delayMs: 1, durationMs: 20 }],
      }),
    /must return a cancellation function/u,
  );
});
