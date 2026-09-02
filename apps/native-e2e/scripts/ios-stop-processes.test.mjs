import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_IOS_PROCESS_GUARD_TIMEOUT_MILLISECONDS,
  describeCoreDeviceFailure,
  findSolidNativeProcesses,
  spawnSolidNativeProcessLeaseWatchdog,
  spawnSolidNativeProcessWatchdog,
  stopAllSolidNativeProcessGenerations,
  stopSolidNativeProcesses,
  stopSolidNativeProcessesAfterLease,
  stopSolidNativeProcessesWhenParentExits,
} from "./ios-stop-processes.mjs";

test("finds every Solid Native app and test-runner process", () => {
  assert.deepEqual(
    findSolidNativeProcesses({
      result: {
        runningProcesses: [
          { executable: "file:///sbin/launchd", processIdentifier: 1 },
          {
            executable:
              "file:///private/var/containers/Bundle/Application/OLD/SolidNativeE2E.app/SolidNativeE2E",
            processIdentifier: 101,
          },
          {
            executable:
              "file:///private/var/containers/Bundle/Application/NEW/SolidNativeE2E.app/SolidNativeE2E",
            processIdentifier: 202,
          },
          {
            executable:
              "file:///private/var/containers/Bundle/Application/TEST/SolidNativeE2EUITests-Runner.app/SolidNativeE2EUITests-Runner",
            processIdentifier: 303,
          },
        ],
      },
    }),
    [
      {
        executable:
          "file:///private/var/containers/Bundle/Application/OLD/SolidNativeE2E.app/SolidNativeE2E",
        processIdentifier: 101,
      },
      {
        executable:
          "file:///private/var/containers/Bundle/Application/NEW/SolidNativeE2E.app/SolidNativeE2E",
        processIdentifier: 202,
      },
      {
        executable:
          "file:///private/var/containers/Bundle/Application/TEST/SolidNativeE2EUITests-Runner.app/SolidNativeE2EUITests-Runner",
        processIdentifier: 303,
      },
    ],
  );
});

test("does not match a different executable or a suffix prefix", () => {
  assert.deepEqual(
    findSolidNativeProcesses({
      result: {
        runningProcesses: [
          {
            executable: "file:///Applications/Other.app/SolidNativeE2E",
            processIdentifier: 101,
          },
          {
            executable:
              "file:///Applications/SolidNativeE2E.app/SolidNativeE2E-helper",
            processIdentifier: 202,
          },
          {
            executable:
              "file:///Applications/SolidNativeE2EUITests-Runner.app/SolidNativeE2EUITests-Runner-helper",
            processIdentifier: 303,
          },
        ],
      },
    }),
    [],
  );
});

test("rejects malformed CoreDevice results before terminating anything", () => {
  assert.throws(
    () => findSolidNativeProcesses({ result: {} }),
    /runningProcesses/u,
  );
  assert.throws(
    () =>
      findSolidNativeProcesses({
        result: {
          runningProcesses: [
            {
              executable:
                "file:///Applications/SolidNativeE2E.app/SolidNativeE2E",
              processIdentifier: "101",
            },
          ],
        },
      }),
    /invalid SolidNativeE2E process identifier/u,
  );
});

test("turns CoreDevice connection failures into device-state remediations", () => {
  assert.match(
    describeCoreDeviceFailure({
      stderr:
        "Failed to mount image: kAMDMobileImageMounterDeviceLocked: The device is locked.",
    }),
    /Unlock it and keep its display awake/u,
  );
  assert.match(
    describeCoreDeviceFailure({
      message:
        "The tunnel was interrupted while establishing connectivity: Operation timed out",
    }),
    /Connect the phone by USB/u,
  );
  assert.match(
    describeCoreDeviceFailure({
      stderr:
        "The tunnel connection failed. (com.apple.dt.RemotePairingError error 4)",
    }),
    /Connect the phone by USB/u,
  );
  assert.match(
    describeCoreDeviceFailure({
      stderr: "Developer Mode is disabled for this device",
    }),
    /Enable it in Privacy & Security/u,
  );
  assert.equal(
    describeCoreDeviceFailure(new Error("unclassified CoreDevice failure")),
    "unclassified CoreDevice failure",
  );
});

test("follows replacement iOS process generations until the device stays clean", async () => {
  const original = {
    executable: "file:///Apps/OLD/SolidNativeE2E.app/SolidNativeE2E",
    processIdentifier: 101,
  };
  const replacement = {
    executable: "file:///Apps/NEW/SolidNativeE2E.app/SolidNativeE2E",
    processIdentifier: 202,
  };
  const snapshots = [[original], [], [replacement], [], [], [], []];
  const stops = [];
  const waits = [];
  const terminated = await stopAllSolidNativeProcessGenerations("device-id", {
    read(device) {
      assert.equal(device, "device-id");
      return snapshots.shift();
    },
    stop(device, identifiers) {
      stops.push({ device, identifiers });
    },
    wait(milliseconds) {
      waits.push(milliseconds);
    },
  });

  assert.deepEqual(stops, [
    { device: "device-id", identifiers: [101] },
    { device: "device-id", identifiers: [202] },
  ]);
  assert.deepEqual(waits, [250, 250, 250, 250]);
  assert.deepEqual(terminated, [original, replacement]);
  assert.equal(snapshots.length, 0);
});

test("fails closed when an iOS application keeps relaunching", async () => {
  let nextProcessIdentifier = 100;
  const stopped = [];
  await assert.rejects(
    stopAllSolidNativeProcessGenerations("device-id", {
      read() {
        return [
          {
            executable: "file:///Apps/LOOP/SolidNativeE2E.app/SolidNativeE2E",
            processIdentifier: nextProcessIdentifier++,
          },
        ];
      },
      stop(_device, identifiers) {
        stopped.push(...identifiers);
      },
      wait() {
        throw new Error("A non-empty process generation must not wait.");
      },
    }),
    /kept relaunching/u,
  );
  assert.equal(stopped.length, 24);
});

test("retries transient CoreDevice cleanup before reporting success", async () => {
  const attempts = [];
  const waits = [];
  const stopped = await stopSolidNativeProcesses("device-id", {
    stop(device) {
      attempts.push(device);
      if (attempts.length < 3) {
        throw new Error("The tunnel was interrupted");
      }
      return [{ processIdentifier: 101 }];
    },
    wait(milliseconds) {
      waits.push(milliseconds);
    },
  });

  assert.deepEqual(attempts, ["device-id", "device-id", "device-id"]);
  assert.deepEqual(waits, [500, 500]);
  assert.deepEqual(stopped, [{ processIdentifier: 101 }]);
});

test("fails closed after bounded iOS cleanup retries", async () => {
  const attempts = [];
  const waits = [];
  await assert.rejects(
    stopSolidNativeProcesses("device-id", {
      attempts: 2,
      retryDelayMilliseconds: 25,
      stop(device) {
        attempts.push(device);
        throw new Error("device is locked");
      },
      wait(milliseconds) {
        waits.push(milliseconds);
      },
    }),
    /could not verify iOS process cleanup after 2 attempts.*Unlock it/iu,
  );
  assert.deepEqual(attempts, ["device-id", "device-id"]);
  assert.deepEqual(waits, [25]);

  await assert.rejects(
    stopSolidNativeProcesses("device-id", { attempts: 0 }),
    /retry count/u,
  );
  await assert.rejects(
    stopSolidNativeProcesses("device-id", { retryDelayMilliseconds: 5_001 }),
    /retry delay/u,
  );
  await assert.rejects(
    stopSolidNativeProcesses("device-id", { stop: null }),
    /retry lifecycle/u,
  );
});

test("reaps device processes after an abruptly orphaned physical runner", async () => {
  const liveness = [true, true, false];
  const observedParents = [];
  const waits = [];
  const stops = [];

  const stopped = await stopSolidNativeProcessesWhenParentExits(
    "device-id",
    812,
    {
      parentProcessIsAlive(parent) {
        observedParents.push(parent);
        return liveness.shift();
      },
      wait(milliseconds) {
        waits.push(milliseconds);
      },
      stop(device) {
        stops.push(device);
        return [101, 202];
      },
    },
  );

  assert.deepEqual(observedParents, [812, 812, 812]);
  assert.deepEqual(waits, [250, 250]);
  assert.deepEqual(stops, ["device-id"]);
  assert.deepEqual(stopped, [101, 202]);
});

test("reaps device processes when a live physical runner exceeds its lease", async () => {
  let monotonicMilliseconds = 1_000;
  const waits = [];
  const stops = [];

  const stopped = await stopSolidNativeProcessesWhenParentExits(
    "device-id",
    812,
    {
      maximumRuntimeMilliseconds: 600,
      parentProcessIsAlive() {
        return true;
      },
      now() {
        return monotonicMilliseconds;
      },
      wait(milliseconds) {
        waits.push(milliseconds);
        monotonicMilliseconds += milliseconds;
      },
      stop(device) {
        stops.push(device);
        return [101];
      },
    },
  );

  assert.deepEqual(waits, [250, 250, 100]);
  assert.deepEqual(stops, ["device-id"]);
  assert.deepEqual(stopped, [101]);
});

test("rejects an invalid physical-runner parent before polling", async () => {
  await assert.rejects(
    stopSolidNativeProcessesWhenParentExits("device-id", 0),
    /positive parent PID/u,
  );
  await assert.rejects(
    stopSolidNativeProcessesWhenParentExits("device-id", 812, {
      maximumRuntimeMilliseconds: 0,
    }),
    /positive integer of at most 3600000 milliseconds/u,
  );
  await assert.rejects(
    stopSolidNativeProcessesWhenParentExits("device-id", 812, {
      maximumRuntimeMilliseconds: 3_600_001,
    }),
    /positive integer of at most 3600000 milliseconds/u,
  );
  await assert.rejects(
    stopSolidNativeProcessesWhenParentExits("device-id", 812, {
      now: null,
    }),
    /watchdog lifecycle is invalid/u,
  );
  await assert.rejects(
    stopSolidNativeProcessesWhenParentExits("device-id", 812, {
      now: () => Number.NaN,
    }),
    /watchdog clock is invalid/u,
  );
});

test("launches the orphan watchdog in a detached process session", () => {
  const launches = [];
  let unreferenced = 0;
  const processIdentifier = spawnSolidNativeProcessWatchdog(
    "device-id",
    812,
    DEFAULT_IOS_PROCESS_GUARD_TIMEOUT_MILLISECONDS,
    (command, arguments_, options) => {
      launches.push({ command, arguments_, options });
      return {
        pid: 913,
        unref() {
          unreferenced++;
        },
      };
    },
  );

  assert.equal(processIdentifier, 913);
  assert.equal(unreferenced, 1);
  assert.equal(launches.length, 1);
  assert.equal(launches[0].command, process.execPath);
  assert.deepEqual(launches[0].arguments_.slice(1), [
    "--watch-parent",
    "812",
    String(DEFAULT_IOS_PROCESS_GUARD_TIMEOUT_MILLISECONDS),
    "device-id",
  ]);
  assert.deepEqual(launches[0].options, {
    detached: true,
    stdio: "ignore",
  });
});

test("leases exact device processes through a detached timeout watchdog", () => {
  const launches = [];
  let unreferenced = 0;
  const processIdentifier = spawnSolidNativeProcessLeaseWatchdog(
    "device-id",
    [202, 101, 202],
    90_000,
    (command, arguments_, options) => {
      launches.push({ command, arguments_, options });
      return {
        pid: 914,
        unref() {
          unreferenced++;
        },
      };
    },
  );

  assert.equal(processIdentifier, 914);
  assert.equal(unreferenced, 1);
  assert.equal(launches.length, 1);
  assert.equal(launches[0].command, process.execPath);
  assert.deepEqual(launches[0].arguments_.slice(1), [
    "--stop-after",
    "90000",
    "device-id",
    "202",
    "101",
  ]);
  assert.deepEqual(launches[0].options, {
    detached: true,
    stdio: "ignore",
  });
});

test("stops only leased device process identifiers at the deadline", async () => {
  const waits = [];
  const stops = [];
  const stopped = await stopSolidNativeProcessesAfterLease(
    "device-id",
    [101, 202],
    {
      maximumRuntimeMilliseconds: 90_000,
      wait(milliseconds) {
        waits.push(milliseconds);
      },
      stop(device, identifiers) {
        stops.push({ device, identifiers });
        return [101];
      },
    },
  );

  assert.deepEqual(waits, [90_000]);
  assert.deepEqual(stops, [{ device: "device-id", identifiers: [101, 202] }]);
  assert.deepEqual(stopped, [101]);
});

test("rejects invalid persistent-launch leases before spawning or waiting", async () => {
  assert.throws(
    () => spawnSolidNativeProcessLeaseWatchdog("device-id", [], 90_000),
    /at least one positive process identifier/u,
  );
  assert.throws(
    () => spawnSolidNativeProcessLeaseWatchdog("device-id", [0], 90_000),
    /positive process identifiers/u,
  );
  await assert.rejects(
    stopSolidNativeProcessesAfterLease("device-id", [101], {
      maximumRuntimeMilliseconds: 0,
    }),
    /positive integer of at most 3600000 milliseconds/u,
  );
  await assert.rejects(
    stopSolidNativeProcessesAfterLease("device-id", [101], { wait: null }),
    /lease lifecycle is invalid/u,
  );
});
