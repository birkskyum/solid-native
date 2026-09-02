import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);
const helper = new URL("./android-device-preflight.sh", import.meta.url);

async function fakeAdb(t, { keyguard = "false", stayAwake = "0" } = {}) {
  const directory = await mkdtemp(
    path.join(tmpdir(), "solid-native-android-preflight-"),
  );
  t.after(() => rm(directory, { recursive: true }));
  const log = path.join(directory, "adb.log");
  const executable = path.join(directory, "adb");
  await writeFile(
    executable,
    `#!/bin/sh
printf '%s\\n' "$*" >>"$FAKE_ADB_LOG"
case "$*" in
  *"settings get global stay_on_while_plugged_in"*) printf '%s\\n' "$FAKE_STAY_AWAKE" ;;
  *"dumpsys window policy"*) printf 'KeyguardServiceDelegate\\n  showing=%s\\n' "$FAKE_KEYGUARD" ;;
esac
`,
  );
  await chmod(executable, 0o755);
  return {
    directory,
    env: {
      ...process.env,
      FAKE_ADB_LOG: log,
      FAKE_KEYGUARD: keyguard,
      FAKE_STAY_AWAKE: stayAwake,
      PATH: `${directory}${path.delimiter}${process.env.PATH ?? ""}`,
      SOLID_NATIVE_ANDROID_DEVICE_SETTLE_SECONDS: "0",
    },
    log,
  };
}

test("leases, prepares, and restores an unlocked USB device", async (t) => {
  const fake = await fakeAdb(t, { stayAwake: "7" });
  await execFileAsync(
    "sh",
    [
      "-c",
      `. "$1"; solid_native_android_lease_stay_awake SERIAL; solid_native_android_prepare_device SERIAL "physical proof"; solid_native_android_restore_stay_awake SERIAL`,
      "preflight-test",
      fileURLToPath(helper),
    ],
    { env: fake.env },
  );
  const calls = await readFile(fake.log, "utf8");
  assert.match(calls, /settings get global stay_on_while_plugged_in/u);
  assert.match(calls, /settings put global stay_on_while_plugged_in 3/u);
  assert.match(calls, /input keyevent KEYCODE_WAKEUP/u);
  assert.match(calls, /wm dismiss-keyguard/u);
  assert.match(calls, /cmd statusbar collapse/u);
  assert.match(calls, /dumpsys window policy/u);
  assert.match(calls, /settings put global stay_on_while_plugged_in 7/u);
});

test("fails closed when a secure keyguard remains visible", async (t) => {
  const fake = await fakeAdb(t, { keyguard: "true" });
  await assert.rejects(
    execFileAsync(
      "sh",
      [
        "-c",
        `. "$1"; solid_native_android_prepare_device PIXEL "navigation proof"`,
        "preflight-test",
        fileURLToPath(helper),
      ],
      { env: fake.env },
    ),
    (error) => {
      assert.match(
        error.stderr,
        /Android device PIXEL is locked; unlock it before running the navigation proof/u,
      );
      return true;
    },
  );
});

test("restores an absent stay-awake setting by deleting it", async (t) => {
  const fake = await fakeAdb(t, { stayAwake: "null" });
  await execFileAsync(
    "sh",
    [
      "-c",
      `. "$1"; solid_native_android_lease_stay_awake SERIAL; solid_native_android_restore_stay_awake SERIAL`,
      "preflight-test",
      fileURLToPath(helper),
    ],
    { env: fake.env },
  );
  assert.match(
    await readFile(fake.log, "utf8"),
    /settings delete global stay_on_while_plugged_in/u,
  );
});

test("long-running launch and navigation runners share the fail-closed preflight", async () => {
  const names = [
    "android-launch-test.sh",
    "android-release.sh",
    "android-test.sh",
    "android-tabs-test.sh",
    "android-navigation-restoration-test.sh",
    "android-navigation-modal-stack-test.sh",
  ];
  for (const name of names) {
    const source = await readFile(
      new URL(`./${name}`, import.meta.url),
      "utf8",
    );
    assert.match(
      source,
      /\. "\$script_dir\/android-device-preflight\.sh"/u,
      name,
    );
    assert.match(source, /solid_native_android_lease_stay_awake/u, name);
    assert.match(source, /solid_native_android_prepare_device/u, name);
    assert.match(source, /solid_native_android_restore_stay_awake/u, name);
  }
});

test("every physical Android instrumentation runner owns the shared device lease", async () => {
  const directory = new URL("./", import.meta.url);
  const names = (await readdir(directory)).filter(
    (name) => name.startsWith("android-") && name.endsWith(".sh"),
  );
  let physicalRunnerCount = 0;
  for (const name of names) {
    const source = await readFile(new URL(name, directory), "utf8");
    if (!/shell am instrument|connected[A-Za-z]+AndroidTest/u.test(source)) {
      continue;
    }
    physicalRunnerCount += 1;
    assert.match(
      source,
      /\. "\$script_dir\/android-device-preflight\.sh"/u,
      name,
    );
    assert.match(source, /solid_native_android_lease_stay_awake/u, name);
    assert.match(source, /solid_native_android_prepare_device/u, name);
    assert.match(source, /solid_native_android_restore_stay_awake/u, name);
    assert.doesNotMatch(source, /\bprepare_device_for_proof\b/u, name);
    const leaseIndex = source.indexOf("solid_native_android_lease_stay_awake");
    const buildIndex = source.indexOf("android-gradle.sh");
    const instrumentationIndexes = Array.from(
      source.matchAll(/shell am instrument|connected[A-Za-z]+AndroidTest/gmu),
      (match) => match.index,
    );
    const preparationIndexes = Array.from(
      source.matchAll(/solid_native_android_prepare_device/gmu),
      (match) => match.index,
    );
    assert.ok(buildIndex !== -1 && leaseIndex < buildIndex, name);
    assert.ok(preparationIndexes.length >= 2, name);
    let previousInstrumentationIndex = -1;
    for (const instrumentationIndex of instrumentationIndexes) {
      const precedingPreparation = preparationIndexes.findLast(
        (index) => index < instrumentationIndex,
      );
      assert.ok(
        precedingPreparation !== undefined &&
          precedingPreparation > previousInstrumentationIndex,
        `${name} must recheck the keyguard before each instrumentation command`,
      );
      previousInstrumentationIndex = instrumentationIndex;
    }
  }
  assert.equal(physicalRunnerCount, 25);
});
