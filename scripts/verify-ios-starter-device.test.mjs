import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseCoreDeviceSuccessDocument,
  parseIOSStarterDeviceInventory,
  preflightPackedStarterIOSDevice,
  verifyPackedStarterOnIOS,
} from "./verify-ios-starter-device.mjs";

const selector = "core-device-id";
const udid = "00008150-001155E01191401C";
const bundleIdentifier = "dev.solidnative.packedstarter.gateabcdef";
const teamIdentifier = "69458QJ6BS";
const applicationURL =
  "file:///private/var/containers/Bundle/Application/GATE/PackedStarter.app/";

function coreDeviceResult(result) {
  return { info: { outcome: "success" }, result };
}

function deviceEntry() {
  return {
    identifier: selector,
    deviceProperties: {
      developerModeStatus: "enabled",
      name: "Test Phone",
    },
    hardwareProperties: {
      marketingName: "iPhone Test Pro",
      platform: "iOS",
      reality: "physical",
      udid,
    },
  };
}

function outputPath(arguments_) {
  const index = arguments_.indexOf("--json-output");
  assert.ok(index >= 0);
  assert.equal(typeof arguments_[index + 1], "string");
  return arguments_[index + 1];
}

function successfulCommand(stdout = "", stderr = "") {
  return { status: 0, stderr, stdout };
}

async function temporaryApplication(t) {
  const directory = await mkdtemp(
    path.join(tmpdir(), "solid-native-ios-starter-device-test-"),
  );
  t.after(() => rm(directory, { force: true, recursive: true }));
  const applicationPath = path.join(directory, "PackedStarter.app");
  await mkdir(applicationPath);
  await writeFile(path.join(applicationPath, "Info.plist"), "test plist");
  return applicationPath;
}

function fakeDevice({
  locked = false,
  preinstalled = false,
  signedBundleIdentifier = bundleIdentifier,
  signedTeamIdentifier = teamIdentifier,
  failLaunch = false,
  processInventorySchema = "current",
  unavailable = false,
} = {}) {
  const state = {
    installCalls: 0,
    installed: preinstalled,
    launchCalls: 0,
    running: false,
    terminateCalls: 0,
    uninstallCalls: 0,
  };
  const calls = [];
  return {
    hostPlatform: "darwin",
    calls,
    state,
    wait() {},
    async runCommand(command, arguments_) {
      calls.push({ arguments_, command });
      if (command === "plutil") {
        return successfulCommand(`${signedBundleIdentifier}\n`);
      }
      if (command === "codesign") {
        return successfulCommand(
          "",
          `Identifier=${signedBundleIdentifier}\nTeamIdentifier=${signedTeamIdentifier}\n`,
        );
      }
      assert.equal(command, "xcrun");
      assert.equal(arguments_[0], "devicectl");
      let result;
      if (arguments_.slice(0, 3).join(" ") === "devicectl list devices") {
        result = coreDeviceResult({ devices: [deviceEntry()] });
      } else if (
        arguments_.slice(0, 4).join(" ") === "devicectl device info lockState"
      ) {
        if (unavailable) {
          return {
            status: 1,
            stderr: "CoreDeviceError: device unavailable",
            stdout: "",
          };
        }
        result = coreDeviceResult({
          deviceIdentifier: selector,
          passcodeRequired: locked,
          unlockedSinceBoot: true,
        });
      } else if (
        arguments_.slice(0, 4).join(" ") === "devicectl device info apps"
      ) {
        result = coreDeviceResult({
          apps: state.installed
            ? [
                {
                  builtByDeveloper: true,
                  bundleIdentifier,
                  name: "Packed Starter",
                  url: applicationURL,
                  version: "1.0",
                },
              ]
            : [],
        });
      } else if (
        arguments_.slice(0, 4).join(" ") === "devicectl device install app"
      ) {
        state.installCalls += 1;
        state.installed = true;
        result = coreDeviceResult({});
      } else if (
        arguments_.slice(0, 4).join(" ") === "devicectl device process launch"
      ) {
        state.launchCalls += 1;
        if (failLaunch) {
          return { status: 1, stderr: "launch failed", stdout: "" };
        }
        state.running = true;
        result = coreDeviceResult({
          deviceIdentifier: selector,
          process: {
            executable: `${applicationURL}PackedStarter`,
            processIdentifier: 4242,
          },
        });
      } else if (
        arguments_.slice(0, 4).join(" ") === "devicectl device info processes"
      ) {
        const processes = state.running
          ? [
              {
                executable: `${applicationURL}PackedStarter`,
                processIdentifier: 4242,
              },
            ]
          : [];
        result = coreDeviceResult(
          processInventorySchema === "legacy"
            ? { processes }
            : processInventorySchema === "ambiguous"
              ? { processes, runningProcesses: processes }
              : { runningProcesses: processes },
        );
      } else if (
        arguments_.slice(0, 4).join(" ") ===
        "devicectl device process terminate"
      ) {
        state.terminateCalls += 1;
        state.running = false;
        result = coreDeviceResult({});
      } else if (
        arguments_.slice(0, 4).join(" ") === "devicectl device uninstall app"
      ) {
        state.uninstallCalls += 1;
        state.installed = false;
        state.running = false;
        result = coreDeviceResult({});
      } else {
        assert.fail(`Unexpected fake command: ${arguments_.join(" ")}`);
      }
      await writeFile(outputPath(arguments_), JSON.stringify(result));
      return successfulCommand();
    },
  };
}

test("strictly parses successful CoreDevice device inventory", () => {
  const result = parseCoreDeviceSuccessDocument(
    JSON.stringify(coreDeviceResult({ devices: [deviceEntry()] })),
    "test result",
  );
  assert.deepEqual(parseIOSStarterDeviceInventory(result, udid), {
    coreDeviceIdentifier: selector,
    model: "iPhone Test Pro",
    udid,
  });
  assert.throws(
    () => parseCoreDeviceSuccessDocument("{}", "test result"),
    /successful, complete/u,
  );
  assert.throws(
    () =>
      parseIOSStarterDeviceInventory(
        { devices: [{ ...deviceEntry(), hardwareProperties: {} }] },
        selector,
      ),
    /physical iPhone with Developer Mode enabled/u,
  );
});

test("preflights an unlocked physical iPhone without mutation", async () => {
  const device = fakeDevice();
  const result = await preflightPackedStarterIOSDevice({
    bundleIdentifier,
    device: selector,
    dependencies: device,
  });

  assert.deepEqual(result, {
    bundleIdentifier,
    coreDeviceIdentifier: selector,
    model: "iPhone Test Pro",
    selector,
    udid,
  });
  assert.equal(device.state.installCalls, 0);
  assert.equal(device.state.launchCalls, 0);
  assert.equal(device.state.uninstallCalls, 0);
});

test("installs, launches, terminates, and removes a signed starter", async (t) => {
  const applicationPath = await temporaryApplication(t);
  const device = fakeDevice();
  const result = await verifyPackedStarterOnIOS({
    applicationPath,
    bundleIdentifier,
    device: selector,
    teamIdentifier,
    dependencies: device,
  });

  assert.deepEqual(result, {
    bundleIdentifier,
    coreDeviceIdentifier: selector,
    model: "iPhone Test Pro",
    selector,
    teamIdentifier,
    udid,
  });
  assert.equal(device.state.installCalls, 1);
  assert.equal(device.state.launchCalls, 1);
  assert.equal(device.state.terminateCalls, 1);
  assert.equal(device.state.uninstallCalls, 1);
  assert.equal(device.state.installed, false);
  assert.equal(device.state.running, false);
});

test("retains compatibility with the legacy CoreDevice process inventory", async (t) => {
  const applicationPath = await temporaryApplication(t);
  const device = fakeDevice({ processInventorySchema: "legacy" });

  await verifyPackedStarterOnIOS({
    applicationPath,
    bundleIdentifier,
    device: selector,
    teamIdentifier,
    dependencies: device,
  });

  assert.equal(device.state.terminateCalls, 1);
  assert.equal(device.state.uninstallCalls, 1);
  assert.equal(device.state.installed, false);
  assert.equal(device.state.running, false);
});

test("fails closed on ambiguous CoreDevice process inventories", async (t) => {
  const applicationPath = await temporaryApplication(t);
  const device = fakeDevice({ processInventorySchema: "ambiguous" });

  await assert.rejects(
    verifyPackedStarterOnIOS({
      applicationPath,
      bundleIdentifier,
      device: selector,
      teamIdentifier,
      dependencies: device,
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.ok(
        error.errors.some((cause) =>
          /invalid process inventory/u.test(cause.message),
        ),
      );
      return true;
    },
  );
  assert.equal(device.state.uninstallCalls, 1);
  assert.equal(device.state.installed, false);
  assert.equal(device.state.running, false);
});

test("refuses a locked iPhone and an installed bundle before mutation", async () => {
  const locked = fakeDevice({ locked: true });
  await assert.rejects(
    preflightPackedStarterIOSDevice({
      bundleIdentifier,
      device: selector,
      dependencies: locked,
    }),
    /iPhone is locked/u,
  );
  assert.equal(locked.state.installCalls, 0);

  const collision = fakeDevice({ preinstalled: true });
  await assert.rejects(
    preflightPackedStarterIOSDevice({
      bundleIdentifier,
      device: selector,
      dependencies: collision,
    }),
    /Refusing to replace installed iOS application/u,
  );
  assert.equal(collision.state.uninstallCalls, 0);
  assert.equal(collision.state.installed, true);
});

test("gives an actionable unavailable-device preflight failure", async () => {
  const device = fakeDevice({ unavailable: true });
  await assert.rejects(
    preflightPackedStarterIOSDevice({
      bundleIdentifier,
      device: selector,
      dependencies: device,
    }),
    /Connect the iPhone by USB, unlock it, confirm Trust/u,
  );
  assert.equal(device.state.installCalls, 0);
});

test("rejects mismatched signing identity before contacting a device", async (t) => {
  const applicationPath = await temporaryApplication(t);
  const device = fakeDevice({ signedTeamIdentifier: "AAAAAAAAAA" });
  await assert.rejects(
    verifyPackedStarterOnIOS({
      applicationPath,
      bundleIdentifier,
      device: selector,
      teamIdentifier,
      dependencies: device,
    }),
    /does not belong to the requested development team/u,
  );
  assert.equal(
    device.calls.some(({ command }) => command === "xcrun"),
    false,
  );
});

test("uninstalls a partial gate when launch fails", async (t) => {
  const applicationPath = await temporaryApplication(t);
  const device = fakeDevice({ failLaunch: true });
  await assert.rejects(
    verifyPackedStarterOnIOS({
      applicationPath,
      bundleIdentifier,
      device: selector,
      teamIdentifier,
      dependencies: device,
    }),
    /launch failed/u,
  );
  assert.equal(device.state.installCalls, 1);
  assert.equal(device.state.uninstallCalls, 1);
  assert.equal(device.state.installed, false);
});
