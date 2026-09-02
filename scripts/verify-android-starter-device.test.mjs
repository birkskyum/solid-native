import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  isSuccessfulAdbPackageOperation,
  parseAndroidStarterUiDocument,
  preflightPackedStarterAndroidDevice,
  verifyAndroidStarterUiDocument,
  verifyPackedStarterOnAndroid,
} from "./verify-android-starter-device.mjs";

const serial = "physical-serial";
const packageName = "dev.solidnative.packedstarter.gateabcdef";

function node({
  bounds = "[0,0][100,100]",
  clickable = false,
  contentDescription = "",
  enabled = true,
  packageName: nodePackage = packageName,
  text = "",
} = {}) {
  return `<node text="${text}" content-desc="${contentDescription}" package="${nodePackage}" clickable="${String(clickable)}" enabled="${String(enabled)}" bounds="${bounds}" />`;
}

function uiDocument(count) {
  return `<?xml version="1.0" encoding="UTF-8"?><hierarchy rotation="0">${node({ text: "Packed Starter" })}${node({ text: "Solid owns this native Fabric tree directly." })}${node({ bounds: "[100,400][900,560]", clickable: true, contentDescription: "Increment counter" })}${node({ contentDescription: `Press count: ${String(count)}` })}</hierarchy>`;
}

function successfulResult(stdout = "") {
  return { status: 0, stderr: "", stdout };
}

async function temporaryApk(t) {
  const directory = await mkdtemp(
    path.join(tmpdir(), "solid-native-starter-device-test-"),
  );
  t.after(() => rm(directory, { force: true, recursive: true }));
  const apkPath = path.join(directory, "starter.apk");
  await writeFile(apkPath, "an apk-shaped test fixture");
  return apkPath;
}

function fakeDevice({
  apkPackageName = packageName,
  installOutput = "Performing Streamed Install\nSuccess\n",
  keyguard = false,
  preinstalled = false,
  uninstallOutput = "Success\n",
} = {}) {
  const state = {
    installed: preinstalled,
    installCalls: 0,
    running: false,
    setting: "0",
    tapped: false,
    uninstallCalls: 0,
  };
  const calls = [];
  return {
    aapt2Command: "aapt2-test",
    calls,
    state,
    wait() {},
    runCommand(command, arguments_) {
      calls.push({ arguments_, command });
      if (command === "aapt2-test") {
        assert.equal(arguments_[0], "dump");
        assert.equal(arguments_[1], "packagename");
        return successfulResult(`${apkPackageName}\n`);
      }
      assert.equal(command, "adb");
      assert.deepEqual(arguments_.slice(0, 2), ["-s", serial]);
      const args = arguments_.slice(2);
      if (args[0] === "get-state") return successfulResult("device\n");
      if (args.join(" ") === "shell getprop ro.kernel.qemu") {
        return successfulResult("\n");
      }
      if (args.join(" ") === "shell getprop ro.product.model") {
        return successfulResult("Pixel Test\n");
      }
      if (args.slice(0, 3).join(" ") === "shell pm path") {
        return successfulResult(
          state.installed ? `package:/data/app/${packageName}/base.apk\n` : "",
        );
      }
      if (
        args.join(" ") === "shell settings get global stay_on_while_plugged_in"
      ) {
        return successfulResult(`${state.setting}\n`);
      }
      if (
        args.slice(0, 5).join(" ") ===
        "shell settings put global stay_on_while_plugged_in"
      ) {
        state.setting = args[5];
        return successfulResult();
      }
      if (args[0] === "install") {
        state.installCalls += 1;
        state.installed = true;
        return successfulResult(installOutput);
      }
      if (args[0] === "uninstall") {
        state.uninstallCalls += 1;
        state.installed = false;
        return successfulResult(uninstallOutput);
      }
      if (args.slice(0, 4).join(" ") === "shell am start -W") {
        state.running = true;
        return successfulResult(
          `Status: ok\nActivity: ${packageName}/.MainActivity\n`,
        );
      }
      if (args.slice(0, 3).join(" ") === "shell am force-stop") {
        state.running = false;
        return successfulResult();
      }
      if (args.slice(0, 2).join(" ") === "shell pidof") {
        return state.running
          ? successfulResult("4242\n")
          : { status: 1, stderr: "", stdout: "" };
      }
      if (args.slice(0, 3).join(" ") === "shell uiautomator dump") {
        return successfulResult("UI hierchary dumped\n");
      }
      if (args.slice(0, 2).join(" ") === "exec-out cat") {
        return successfulResult(uiDocument(state.tapped ? 1 : 0));
      }
      if (args.slice(0, 3).join(" ") === "shell input tap") {
        state.tapped = true;
        return successfulResult();
      }
      if (args.join(" ") === "shell dumpsys window policy") {
        return successfulResult(
          `KeyguardServiceDelegate\n  showing=${String(keyguard)}\n`,
        );
      }
      if (
        args.slice(0, 4).join(" ") === "shell input keyevent KEYCODE_WAKEUP" ||
        args.slice(0, 3).join(" ") === "shell wm dismiss-keyguard" ||
        args.slice(0, 4).join(" ") === "shell cmd statusbar collapse" ||
        args.slice(0, 3).join(" ") === "shell rm -f"
      ) {
        return successfulResult();
      }
      assert.fail(`Unexpected fake adb arguments: ${args.join(" ")}`);
    },
  };
}

test("accepts bounded modern ADB package acknowledgements", () => {
  assert.equal(isSuccessfulAdbPackageOperation("Success\n"), true);
  assert.equal(
    isSuccessfulAdbPackageOperation("Performing Streamed Install\nSuccess\n"),
    true,
  );
  assert.equal(
    isSuccessfulAdbPackageOperation(
      "Performing Incremental Install\nSuccess\n",
    ),
    true,
  );
  assert.equal(
    isSuccessfulAdbPackageOperation("Failure [INSTALL_FAILED_TEST]\nSuccess\n"),
    false,
  );
  assert.equal(
    isSuccessfulAdbPackageOperation("Success\ntrailing output\n"),
    false,
  );
  assert.equal(
    isSuccessfulAdbPackageOperation("Performing Streamed Install\n"),
    false,
  );
});

test("parses and verifies the packed starter accessibility contract", () => {
  const parsed = parseAndroidStarterUiDocument(uiDocument(0));
  assert.equal(parsed.length, 4);
  assert.deepEqual(
    verifyAndroidStarterUiDocument(uiDocument(0), packageName, 0),
    { bottom: 560, left: 100, right: 900, top: 400 },
  );
  assert.throws(
    () =>
      parseAndroidStarterUiDocument(
        `<!DOCTYPE hierarchy><hierarchy>${node()}</hierarchy>`,
      ),
    /cannot declare/u,
  );
  assert.throws(
    () => verifyAndroidStarterUiDocument(uiDocument(0), packageName, 1),
    /starter counter/u,
  );
});

test("keeps the generated application aligned with the hardware contract", async () => {
  const template = await readFile(
    new URL(
      "../packages/cli/templates/react-native-0.87/src/App.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(template, /Solid owns this native Fabric tree directly\./u);
  assert.match(template, /accessibilityLabel="Increment counter"/u);
  assert.match(template, /<Button/u);
  assert.doesNotMatch(template, /<Pressable/u);
  assert.match(
    template,
    /accessibilityLabel=\{`Press count: \$\{count\(\)\}`\}/u,
  );
});

test("installs, exercises, and removes one collision-free packed starter", async (t) => {
  const apkPath = await temporaryApk(t);
  const device = fakeDevice();
  const result = await verifyPackedStarterOnAndroid({
    apkPath,
    packageName,
    serial,
    dependencies: device,
  });

  assert.deepEqual(result, {
    model: "Pixel Test",
    packageName,
    serial,
  });
  assert.equal(device.state.installCalls, 1);
  assert.equal(device.state.uninstallCalls, 1);
  assert.equal(device.state.installed, false);
  assert.equal(device.state.running, false);
  assert.equal(device.state.setting, "0");
  assert.equal(device.state.tapped, true);
});

test("preflights an unlocked physical device without changing it", () => {
  const device = fakeDevice();
  assert.deepEqual(
    preflightPackedStarterAndroidDevice({
      packageName,
      serial,
      dependencies: device,
    }),
    { packageName, serial },
  );
  assert.equal(device.state.installCalls, 0);
  assert.equal(device.state.uninstallCalls, 0);
  assert.equal(device.state.setting, "0");
  assert.equal(
    device.calls.some(({ arguments_ }) =>
      arguments_.includes("KEYCODE_WAKEUP"),
    ),
    false,
  );
});

test("restores the device lease when the secure keyguard stays active", async (t) => {
  const apkPath = await temporaryApk(t);
  const device = fakeDevice({ keyguard: true });

  await assert.rejects(
    verifyPackedStarterOnAndroid({
      apkPath,
      packageName,
      serial,
      dependencies: device,
    }),
    /is locked; unlock it/u,
  );
  assert.equal(device.state.installCalls, 0);
  assert.equal(device.state.uninstallCalls, 0);
  assert.equal(device.state.setting, "0");
});

test("refuses to replace an existing package", async (t) => {
  const apkPath = await temporaryApk(t);
  const device = fakeDevice({ preinstalled: true });

  await assert.rejects(
    verifyPackedStarterOnAndroid({
      apkPath,
      packageName,
      serial,
      dependencies: device,
    }),
    /Refusing to replace an installed Android package/u,
  );
  assert.equal(device.state.installCalls, 0);
  assert.equal(device.state.uninstallCalls, 0);
  assert.equal(device.state.installed, true);
});

test("refuses an APK whose embedded package cannot be cleaned safely", async (t) => {
  const apkPath = await temporaryApk(t);
  const device = fakeDevice({ apkPackageName: "dev.unexpected.application" });

  await assert.rejects(
    verifyPackedStarterOnAndroid({
      apkPath,
      packageName,
      serial,
      dependencies: device,
    }),
    /Refusing to install an APK for unexpected package/u,
  );
  assert.equal(device.state.installCalls, 0);
  assert.equal(device.state.uninstallCalls, 0);
  assert.equal(
    device.calls.some(({ command }) => command === "adb"),
    false,
  );
});
