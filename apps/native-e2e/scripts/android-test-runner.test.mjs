import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("leases and restores wired stay-awake state around the physical Android proof", async () => {
  const [manifest, runner, preflight] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8").then(
      JSON.parse,
    ),
    readFile(new URL("./android-test.sh", import.meta.url), "utf8"),
    readFile(new URL("./android-device-preflight.sh", import.meta.url), "utf8"),
  ]);

  assert.equal(manifest.scripts["android:test"], "sh scripts/android-test.sh");
  assert.equal(
    manifest.scripts["android:proof:verify"],
    "pnpm --filter @solid-native/cli build && node ../../packages/cli/dist/bin.js device-proof profile build/device-proofs/android-solid-release.json",
  );
  assert.match(
    runner,
    /device_count[\s\S]*Expected exactly one authorized Android device/u,
  );
  assert.match(
    runner,
    /android-device-preflight\.sh[\s\S]*solid_native_android_lease_stay_awake/u,
  );
  assert.match(
    runner,
    /trap 'solid_native_android_restore_stay_awake "\$serial"' EXIT HUP INT TERM/u,
  );
  assert.match(
    preflight,
    /settings get global stay_on_while_plugged_in[\s\S]*solid_native_android_restore_stay_awake\(\)[\s\S]*settings (?:delete|put) global stay_on_while_plugged_in/u,
  );
  const leaseIndex = runner.indexOf("solid_native_android_lease_stay_awake");
  const gradleIndex = runner.indexOf(":app:connectedSolidReleaseAndroidTest");
  const sourcePolicyIndex = runner.indexOf("bundle sources");
  const verifyIndex = runner.lastIndexOf("verify-solid-runtime-sourcemap.mjs");
  const receiptIndex = runner.lastIndexOf("device-proof create-android");
  const releaseIndex = runner.lastIndexOf(
    "solid_native_android_restore_stay_awake",
  );
  assert.ok(leaseIndex !== -1 && leaseIndex < gradleIndex);
  assert.ok(sourcePolicyIndex !== -1 && sourcePolicyIndex < gradleIndex);
  assert.ok(
    gradleIndex < verifyIndex &&
      verifyIndex < receiptIndex &&
      receiptIndex < releaseIndex,
  );
  assert.match(
    runner,
    /--require "app:\/\/\/apps\/native-e2e\/adapters\/NotifeeApiModule\.ts"[\s\S]*--require "app:\/\/\/apps\/native-e2e\/generated\/SolidNativeBindings\.ts"[\s\S]*--require "app:\/\/\/packages\/notifications\/dist\/notify-kit-10\.js"[\s\S]*--forbid-containing "\/node_modules\/react-native-notify-kit\/"/u,
  );
  assert.match(
    preflight,
    /solid_native_android_prepare_device\(\)[\s\S]*input keyevent KEYCODE_WAKEUP[\s\S]*wm dismiss-keyguard[\s\S]*cmd statusbar collapse[\s\S]*KeyguardServiceDelegate[\s\S]*is locked; unlock it before running/u,
  );
  const preparationCalls =
    runner.match(/^solid_native_android_prepare_device .*$/gmu) ?? [];
  assert.equal(preparationCalls.length, 2);
  assert.ok(
    runner.lastIndexOf("solid_native_android_prepare_device") <
      runner.indexOf("proof_started_at="),
  );
  assert.match(
    runner,
    /-Pandroid\.testInstrumentationRunnerArguments\.class=dev\.solidnative\.e2e\.SolidNativePhysicalTest#testPhysicalRendererUpdate/u,
  );
  assert.match(
    runner,
    /proof_started_at=\$\(node -e '[^']*toISOString\(\)[^']*'\)[\s\S]*connectedSolidReleaseAndroidTest[\s\S]*device-proof create-android[\s\S]*--serial "\$serial"[\s\S]*--not-before "\$proof_started_at"[\s\S]*--bundle "\$application_bundle"[\s\S]*--source-map "\$source_map"[\s\S]*--apk "\$application_apk"[\s\S]*--instrumentation-apk "\$instrumentation_apk"[\s\S]*--instrumentation-class "dev\.solidnative\.e2e\.SolidNativePhysicalTest"[\s\S]*--instrumentation-test "testPhysicalRendererUpdate"[\s\S]*--output "\$receipt_path"/u,
  );
  assert.match(
    runner,
    /package-owned producer never overwrites evidence[\s\S]*rm -f "\$receipt_path"/u,
  );
});
