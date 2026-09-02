import assert from "node:assert/strict";
import test from "node:test";

import { SOLID_DIAGNOSTICS_DEBUG_MAX_RECORDS } from "@solid-native/observability";

import { createDevelopmentSolidDiagnosticsController as createProductionController } from "../dist/solid-diagnostics.js";
import { createDevelopmentSolidDiagnosticsControllerWithDependencies } from "../dist/solid-diagnostics-development.js";

function diagnostic(sequence) {
  return {
    sequence,
    code: "STRICT_READ_UNTRACKED",
    kind: "strict-read",
    severity: "warn",
    message: "private",
  };
}

function fakeDevelopmentSurface() {
  const state = {
    listener: undefined,
    enableOptions: undefined,
    enableCount: 0,
    disableCount: 0,
    unsubscribeCount: 0,
  };
  return {
    state,
    surface: {
      diagnostics: {
        subscribe(listener) {
          state.listener = listener;
          return () => {
            state.unsubscribeCount += 1;
            if (state.listener === listener) state.listener = undefined;
          };
        },
      },
      attribution: {
        enable(options) {
          state.enableCount += 1;
          state.enableOptions = options;
        },
        disable() {
          state.disableCount += 1;
        },
        history() {
          return [];
        },
        costs() {
          return { scopes: [], writes: [] };
        },
      },
    },
  };
}

test("keeps the production Solid diagnostics controller inert", () => {
  const controller = createProductionController();
  assert.equal(controller.available, false);
  assert.equal(controller.active, false);
  assert.throws(() => controller.begin(), /development bundle/u);
  assert.throws(() => controller.end(), /development bundle/u);
  controller.dispose();
});

test("captures one exclusive bounded Solid diagnostics session", () => {
  const fake = fakeDevelopmentSurface();
  const times = [10, 15];
  let flushCount = 0;
  const controller =
    createDevelopmentSolidDiagnosticsControllerWithDependencies({
      dev: fake.surface,
      flush: () => {
        flushCount += 1;
        fake.state.listener(
          diagnostic(SOLID_DIAGNOSTICS_DEBUG_MAX_RECORDS + 2),
        );
      },
      monotonicNow: () => times.shift(),
      wallClockNow: () => new Date("2026-08-27T01:02:03.004Z"),
    });
  assert.equal(controller.available, true);
  assert.equal(controller.active, false);
  controller.begin();
  assert.equal(controller.active, true);
  assert.deepEqual(fake.state.enableOptions, {
    historyLimit: SOLID_DIAGNOSTICS_DEBUG_MAX_RECORDS,
    log: false,
    stacks: false,
  });
  assert.throws(() => controller.begin(), /already active/u);
  for (
    let sequence = 1;
    sequence <= SOLID_DIAGNOSTICS_DEBUG_MAX_RECORDS + 1;
    sequence += 1
  ) {
    fake.state.listener(diagnostic(sequence));
  }
  const envelope = controller.end();
  assert.equal(controller.active, false);
  assert.equal(flushCount, 1);
  assert.equal(fake.state.disableCount, 1);
  assert.equal(fake.state.unsubscribeCount, 1);
  assert.equal(envelope.durationMilliseconds, 5);
  assert.equal(envelope.droppedDiagnostics, 2);
  assert.equal(
    envelope.diagnostics.length,
    SOLID_DIAGNOSTICS_DEBUG_MAX_RECORDS,
  );
  assert.equal(envelope.diagnostics[0].sequence, 3);
  assert.equal(
    envelope.diagnostics.at(-1).sequence,
    SOLID_DIAGNOSTICS_DEBUG_MAX_RECORDS + 2,
  );
  assert.throws(() => controller.end(), /No Solid diagnostics/u);
});

test("cleans failed and disposed Solid diagnostics sessions", () => {
  const fake = fakeDevelopmentSurface();
  const controller =
    createDevelopmentSolidDiagnosticsControllerWithDependencies({
      dev: fake.surface,
      flush: () => {
        throw new Error("flush failed");
      },
      monotonicNow: () => 10,
      wallClockNow: () => new Date("2026-08-27T00:00:00.000Z"),
    });
  controller.begin();
  assert.throws(() => controller.end(), /flush failed/u);
  assert.equal(controller.active, false);
  assert.equal(fake.state.disableCount, 1);
  assert.equal(fake.state.unsubscribeCount, 1);
  controller.begin();
  controller.dispose();
  controller.dispose();
  assert.equal(fake.state.disableCount, 2);
  assert.equal(fake.state.unsubscribeCount, 2);

  assert.throws(
    () =>
      createDevelopmentSolidDiagnosticsControllerWithDependencies({
        dev: undefined,
        flush() {},
        monotonicNow: () => 0,
        wallClockNow: () => new Date(0),
      }),
    /development Solid runtime/u,
  );
});
