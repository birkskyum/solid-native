import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("physical Android alert proof keeps its cross-layer contract aligned", async () => {
  const [application, instrumentation, runner, manifest] = await Promise.all([
    readFile(new URL("alert.tsx", directory), "utf8"),
    readFile(
      new URL(
        "android/app/src/androidTest/java/dev/solidnative/e2e/SolidNativeAlertPhysicalTest.kt",
        directory,
      ),
      "utf8",
    ),
    readFile(new URL("scripts/android-alert-test.sh", directory), "utf8"),
    readFile(new URL("package.json", directory), "utf8").then(JSON.parse),
  ]);

  for (const value of [
    "Solid Native alert ready",
    "Show destructive native alert",
    "Delete local draft?",
    "Delete",
    "Alert result: delete",
    "Show cancellable native alert",
    "Dismiss this alert",
    "Alert result: dismissed",
    "Dispose Solid Native alert proof",
  ]) {
    assert.ok(application.includes(value), `Application is missing ${value}.`);
    assert.ok(
      instrumentation.includes(value),
      `Instrumentation is missing ${value}.`,
    );
  }
  assert.equal(
    manifest.scripts["android:alert:test"],
    "sh scripts/android-alert-test.sh && node scripts/verify-solid-runtime-sourcemap.mjs android/app/build/generated/sourcemaps/react/solidRelease/index.android.bundle.map && node scripts/verify-alert-sourcemap.mjs android/app/build/generated/sourcemaps/react/solidRelease/index.android.bundle.map",
  );
  assert.match(
    application,
    /createReactNativeAlertService\(\)[\s\S]*createAlertController\(service\)/u,
  );
  assert.match(
    application,
    /platform\.alert\.button[\s\S]*platform\.alert\.dismissed/u,
  );
  assert.match(
    instrumentation,
    /DELETE_ALERT_TITLE[\s\S]*tapText\(DELETE_BUTTON_TEXT\)[\s\S]*DELETE_RESULT_TEXT[\s\S]*DISMISS_ALERT_TITLE[\s\S]*KEYCODE_BACK[\s\S]*DISMISSED_RESULT_TEXT/u,
  );
  assert.match(instrumentation, /equals\(text, ignoreCase = true\)/u);
  assert.match(runner, /ENTRY_FILE=alert\.tsx/u);
  assert.match(runner, /assembleSolidReleaseAndroidTest/u);
  assert.match(runner, /trap cleanup EXIT HUP INT TERM/u);
  assert.match(runner, /marker_deadline=.*30/u);
  assert.match(runner, /SOLID_NATIVE_ALERT_TEARDOWN_SUCCEEDED/u);
  assert.match(
    runner,
    /am force-stop "\$app_id"[\s\S]*uninstall "\$package_name"[\s\S]*pidof "\$app_id"[\s\S]*pm path "\$package_name"[\s\S]*Verified native Android alert/u,
  );
});
