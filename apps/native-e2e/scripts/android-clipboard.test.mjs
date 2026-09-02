import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("physical Android clipboard proof keeps its cross-layer contract aligned", async () => {
  const [application, instrumentation, runner, manifest] = await Promise.all([
    readFile(new URL("clipboard.tsx", directory), "utf8"),
    readFile(
      new URL(
        "android/app/src/androidTest/java/dev/solidnative/e2e/SolidNativeClipboardPhysicalTest.kt",
        directory,
      ),
      "utf8",
    ),
    readFile(new URL("scripts/android-clipboard-test.sh", directory), "utf8"),
    readFile(new URL("package.json", directory), "utf8").then(JSON.parse),
  ]);

  for (const value of [
    "Solid Native clipboard ready",
    "Private Solid Native clipboard write proof",
    "Private external clipboard read proof",
    "Write Solid Native clipboard proof",
    "Read Solid Native clipboard proof",
    "Clear native clipboard",
    "Dispose Solid Native clipboard proof",
    "Clipboard proof written",
    "External clipboard proof read",
    "Clipboard cleared",
  ]) {
    assert.ok(application.includes(value), `Application is missing ${value}.`);
    assert.ok(
      instrumentation.includes(value),
      `Instrumentation is missing ${value}.`,
    );
  }
  assert.equal(
    manifest.scripts["android:clipboard:test"],
    "sh scripts/android-clipboard-test.sh && node scripts/verify-solid-runtime-sourcemap.mjs android/app/build/generated/sourcemaps/react/solidRelease/index.android.bundle.map && node scripts/verify-clipboard-sourcemap.mjs android/app/build/generated/sourcemaps/react/solidRelease/index.android.bundle.map",
  );
  assert.match(
    application,
    /createReactNativeClipboardService\(\)[\s\S]*createClipboardController\(service\)/u,
  );
  assert.match(
    application,
    /PERMITTED_EVENT_ATTRIBUTES[\s\S]*PERMITTED_COMPUTATION_ATTRIBUTES[\s\S]*PERMITTED_OWNER_ATTRIBUTES[\s\S]*createCausalTelemetry[\s\S]*platform\.clipboard\.read[\s\S]*operation\.causes\.length !== 3[\s\S]*SOLID_NATIVE_CLIPBOARD_READ_CAUSALITY_SUCCEEDED/u,
  );
  assert.match(
    instrumentation,
    /readPrimaryClip\(\)[\s\S]*WRITE_LABEL[\s\S]*assertEquals\(WRITE_PROOF_TEXT, readClipboardText\(\)\)[\s\S]*writeClipboardText\(READ_PROOF_TEXT\)[\s\S]*READ_LABEL[\s\S]*CLEAR_LABEL[\s\S]*assertEquals\("", readClipboardText\(\)\)[\s\S]*finally[\s\S]*restorePrimaryClip\(originalClip\)/u,
  );
  assert.match(runner, /ENTRY_FILE=clipboard\.tsx/u);
  assert.match(runner, /assembleSolidReleaseAndroidTest/u);
  assert.match(runner, /trap cleanup EXIT HUP INT TERM/u);
  assert.match(runner, /marker_deadline=.*30/u);
  assert.match(runner, /SOLID_NATIVE_CLIPBOARD_TEARDOWN_SUCCEEDED/u);
  assert.match(
    runner,
    /am force-stop "\$app_id"[\s\S]*uninstall "\$package_name"[\s\S]*pidof "\$package_name"[\s\S]*pm path "\$package_name"[\s\S]*Verified independent Android clipboard/u,
  );
});
