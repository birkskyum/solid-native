import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import test from "node:test";

import {
  parseNativeIosDeviceLockState,
  parseNativeIosSimulatorIdentifiers,
  preflightNativeIosRunDestination,
} from "../dist/index.js";

const successfulLockState = (overrides = {}) => ({
  info: { outcome: "success" },
  result: {
    deviceIdentifier: "physical-id",
    passcodeRequired: false,
    unlockedSinceBoot: true,
    ...overrides,
  },
});

const successfulCommand = (overrides = {}) => ({
  exitCode: 0,
  stdout: "",
  stderr: "",
  timedOut: false,
  ...overrides,
});

function jsonOutputPath(args) {
  const index = args.indexOf("--json-output");
  assert.ok(index >= 0);
  assert.equal(typeof args[index + 1], "string");
  return args[index + 1];
}

test("strictly parses CoreDevice and CoreSimulator preflight results", () => {
  assert.deepEqual(
    parseNativeIosDeviceLockState(JSON.stringify(successfulLockState())),
    {
      deviceIdentifier: "physical-id",
      passcodeRequired: false,
      unlockedSinceBoot: true,
    },
  );
  assert.deepEqual(
    [
      ...parseNativeIosSimulatorIdentifiers(
        JSON.stringify({
          devices: {
            "runtime-a": [{ udid: "simulator-a" }],
            "runtime-b": [{ udid: "simulator-b" }],
          },
        }),
      ),
    ],
    ["simulator-a", "simulator-b"],
  );
  assert.throws(
    () => parseNativeIosDeviceLockState("{}"),
    /successful, complete iOS lock state/u,
  );
  assert.throws(
    () => parseNativeIosSimulatorIdentifiers('{"devices":[]}'),
    /complete device inventory/u,
  );
});

test("accepts an unlocked explicit physical device", async () => {
  const calls = [];
  const result = await preflightNativeIosRunDestination({
    selector: { kind: "device", value: "Birk's iPhone" },
    dependencies: {
      hostPlatform: "darwin",
      async runCommand(command, args) {
        calls.push({ command, args });
        await writeFile(
          jsonOutputPath(args),
          JSON.stringify(successfulLockState()),
        );
        return successfulCommand();
      },
    },
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.slice(0, 4), [
    "devicectl",
    "device",
    "info",
    "lockState",
  ]);
  assert.deepEqual(result, {
    destination: "device",
    lockState: {
      deviceIdentifier: "physical-id",
      passcodeRequired: false,
      unlockedSinceBoot: true,
    },
  });
});

test("rejects a locked physical device before native execution", async () => {
  await assert.rejects(
    preflightNativeIosRunDestination({
      selector: { kind: "device", value: "physical-id" },
      dependencies: {
        hostPlatform: "darwin",
        async runCommand(_command, args) {
          await writeFile(
            jsonOutputPath(args),
            JSON.stringify(successfulLockState({ passcodeRequired: true })),
          );
          return successfulCommand();
        },
      },
    }),
    /iPhone is locked[\s\S]*before Solid Native starts the physical build/u,
  );
});

test("preserves simulator runs selected through udid", async () => {
  let calls = 0;
  const result = await preflightNativeIosRunDestination({
    selector: { kind: "udid", value: "simulator-id" },
    dependencies: {
      hostPlatform: "darwin",
      async runCommand(command, args) {
        calls += 1;
        assert.equal(command, "xcrun");
        assert.deepEqual(args, [
          "simctl",
          "list",
          "devices",
          "available",
          "--json",
        ]);
        return successfulCommand({
          stdout: JSON.stringify({
            devices: { runtime: [{ udid: "simulator-id" }] },
          }),
        });
      },
    },
  });

  assert.equal(calls, 1);
  assert.deepEqual(result, {
    destination: "simulator",
    deviceIdentifier: "simulator-id",
  });
});

test("resolves a physical udid before checking its lock state", async () => {
  const calls = [];
  const result = await preflightNativeIosRunDestination({
    selector: { kind: "udid", value: "physical-id" },
    dependencies: {
      hostPlatform: "darwin",
      async runCommand(_command, args) {
        calls.push(args);
        if (args[0] === "simctl") {
          return successfulCommand({
            stdout: JSON.stringify({ devices: { runtime: [] } }),
          });
        }
        await writeFile(
          jsonOutputPath(args),
          JSON.stringify(successfulLockState()),
        );
        return successfulCommand();
      },
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], "simctl");
  assert.equal(calls[1][0], "devicectl");
  assert.equal(result.destination, "device");
});

test("classifies CoreDevice tunnel failures", async () => {
  await assert.rejects(
    preflightNativeIosRunDestination({
      selector: { kind: "device", value: "physical-id" },
      dependencies: {
        hostPlatform: "darwin",
        async runCommand() {
          return successfulCommand({
            exitCode: 1,
            stderr: "RemotePairingError: tunnel connection failed",
          });
        },
      },
    }),
    /developer-services tunnel[\s\S]*USB/u,
  );
});
