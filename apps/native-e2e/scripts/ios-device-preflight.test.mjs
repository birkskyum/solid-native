import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  IOSDeviceLockedError,
  IOSTransientLockStateError,
  assertIOSDeviceReady,
  assertUnlockedIOSDevice,
  waitForIOSDeviceReady,
} from "./ios-device-preflight.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

test("accepts only a currently unlocked iOS device", () => {
  assert.equal(
    assertUnlockedIOSDevice({
      result: {
        deviceIdentifier: "device-id",
        passcodeRequired: false,
        unlockedSinceBoot: true,
      },
    }),
    "device-id",
  );
  assert.throws(
    () =>
      assertUnlockedIOSDevice({
        result: {
          deviceIdentifier: "device-id",
          passcodeRequired: true,
          unlockedSinceBoot: true,
        },
      }),
    /locked[\s\S]*before starting physical device work/iu,
  );
  assert.throws(
    () =>
      assertUnlockedIOSDevice({
        result: {
          deviceIdentifier: "device-id",
          passcodeRequired: false,
          unlockedSinceBoot: false,
        },
      }),
    /locked/iu,
  );
  assert.throws(
    () => assertUnlockedIOSDevice({ result: { passcodeRequired: false } }),
    /invalid iOS lock-state document/u,
  );
});

test("waits only for bounded lock-state recovery", async () => {
  let attempts = 0;
  let currentTime = 1_000;
  const waits = [];
  const messages = [];
  const identifier = await waitForIOSDeviceReady("device-id", {
    timeoutMilliseconds: 5_000,
    pollMilliseconds: 1_000,
    now: () => currentTime,
    attempt: async () => {
      attempts += 1;
      if (attempts < 3) throw new IOSDeviceLockedError();
      return "device-id";
    },
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
      currentTime += milliseconds;
    },
    onWaiting: (message) => messages.push(message),
  });

  assert.equal(identifier, "device-id");
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [1_000, 1_000]);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /Waiting up to 5 seconds/u);

  attempts = 0;
  const transientIdentifier = await waitForIOSDeviceReady("device-id", {
    timeoutMilliseconds: 2_000,
    pollMilliseconds: 1_000,
    now: () => currentTime,
    attempt: async () => {
      attempts += 1;
      if (attempts === 1) throw new IOSTransientLockStateError();
      return "device-id";
    },
    sleep: async (milliseconds) => {
      currentTime += milliseconds;
    },
  });
  assert.equal(transientIdentifier, "device-id");

  await assert.rejects(
    waitForIOSDeviceReady("device-id", {
      timeoutMilliseconds: 2_000,
      pollMilliseconds: 1_000,
      now: () => currentTime,
      attempt: async () => {
        throw new Error("CoreDevice disconnected.");
      },
      sleep: async () => assert.fail("A non-lock failure was retried."),
    }),
    /CoreDevice disconnected/u,
  );
  await assert.rejects(
    waitForIOSDeviceReady("device-id", { timeoutMilliseconds: 0 }),
    /unlock wait/u,
  );
});

test("classifies only known bounded CoreDevice lock-query failures as transient", async () => {
  for (const stderr of [
    "ERROR: Command timeout of 10.0 seconds exceeded. Assuming command got stuck and aborting.",
    "ERROR: An unknown error occurred. (com.apple.dt.CoreDeviceError error -1 (0xFFFFFFFF))\nCould not allocate a resource. (com.apple.mobiledevice error -402653181 (0xE8000003))",
    "ERROR: Failed to allocate RSD device. (com.apple.mobiledevice error -402653181 (0xE8000003))",
  ]) {
    await assert.rejects(
      assertIOSDeviceReady("device-id", {
        run: async () => {
          throw { stderr };
        },
      }),
      IOSTransientLockStateError,
    );
  }
  await assert.rejects(
    assertIOSDeviceReady("device-id", {
      run: async () => {
        throw { stderr: "ERROR: tunnel connection failed" };
      },
    }),
    /developer-services tunnel/u,
  );
});

test("checks every direct physical iOS runner before expensive work", async () => {
  const scripts = await readdir(scriptDirectory);
  const runners = [];
  for (const script of scripts.filter((entry) => entry.endsWith(".sh"))) {
    if (
      script === "ios-process-guard.sh" ||
      script === "ios-process-lease.sh"
    ) {
      continue;
    }
    const source = await readFile(path.join(scriptDirectory, script), "utf8");
    const cleanupIndex = source.indexOf(
      'node "$APP_DIR/scripts/ios-stop-processes.mjs" "$SOLID_NATIVE_IOS_DESTINATION"',
    );
    if (cleanupIndex < 0) continue;
    runners.push(script);
    const preflightIndex = source.indexOf(
      'node "$APP_DIR/scripts/ios-device-preflight.mjs" "$SOLID_NATIVE_IOS_DESTINATION"',
    );
    assert.ok(preflightIndex > cleanupIndex, script);
    const buildIndex = source.indexOf("pnpm --dir");
    if (buildIndex >= 0) assert.ok(preflightIndex < buildIndex, script);
  }
  assert.ok(runners.length >= 17, runners.join(", "));
});
