import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("physical Android vibration proof keeps its cross-layer contract aligned", async () => {
  const [application, instrumentation, runner, manifest] = await Promise.all([
    readFile(new URL("vibration.tsx", directory), "utf8"),
    readFile(
      new URL(
        "android/app/src/androidTest/java/dev/solidnative/e2e/SolidNativeVibrationPhysicalTest.kt",
        directory,
      ),
      "utf8",
    ),
    readFile(new URL("scripts/android-vibration-test.sh", directory), "utf8"),
    readFile(new URL("package.json", directory), "utf8").then(JSON.parse),
  ]);

  for (const value of [
    "Solid Native vibration ready",
    "Start repeating native vibration",
    "Cancel native vibration",
    "Dispose Solid Native vibration proof",
    "Repeating vibration active",
    "Vibration cancelled",
  ]) {
    assert.ok(application.includes(value), `Application is missing ${value}.`);
    assert.ok(
      instrumentation.includes(value),
      `Instrumentation is missing ${value}.`,
    );
  }
  assert.equal(
    manifest.scripts["android:vibration:test"],
    "sh scripts/android-vibration-test.sh && node scripts/verify-solid-runtime-sourcemap.mjs android/app/build/generated/sourcemaps/react/solidRelease/index.android.bundle.map && node scripts/verify-vibration-sourcemap.mjs android/app/build/generated/sourcemaps/react/solidRelease/index.android.bundle.map",
  );
  assert.match(
    application,
    /createReactNativeVibrationService\(\)[\s\S]*createVibrationController\(service\)[\s\S]*durationMs: 80[\s\S]*delayMs: 160[\s\S]*durationMs: 140[\s\S]*repeat: true/u,
  );
  assert.match(
    instrumentation,
    /START_LABEL[\s\S]*waitForExpectedVibration\(\)[\s\S]*CANCEL_LABEL[\s\S]*waitForVibrationStopped\(\)[\s\S]*START_LABEL[\s\S]*waitForExpectedVibration\(\)[\s\S]*DISPOSE_LABEL[\s\S]*waitForVibrationStopped\(\)/u,
  );
  for (const value of [
    "status = running",
    "durationMs = -1",
    "duration=0",
    "duration=80",
    "duration=160",
    "duration=140",
    "repeat=0",
    "opPkg=$APP_ID",
  ]) {
    assert.ok(
      instrumentation.includes(value),
      `Instrumentation does not inspect ${value}.`,
    );
  }
  assert.match(runner, /ENTRY_FILE=vibration\.tsx/u);
  assert.match(runner, /assembleSolidReleaseAndroidTest/u);
  assert.match(
    runner,
    /original_vibrate_setting=.*settings get system vibrate_on/u,
  );
  assert.match(runner, /trap cleanup EXIT HUP INT TERM/u);
  assert.match(
    runner,
    /settings put system vibrate_on 1[\s\S]*restore_vibrate_setting[\s\S]*restored_vibrate_setting[\s\S]*original_vibrate_setting/u,
  );
  assert.match(runner, /SOLID_NATIVE_VIBRATION_TEARDOWN_SUCCEEDED/u);
  assert.match(
    runner,
    /uninstall "\$package_name"[\s\S]*pidof "\$package_name"[\s\S]*pm path "\$package_name"[\s\S]*Verified Android repeating-waveform/u,
  );
});
