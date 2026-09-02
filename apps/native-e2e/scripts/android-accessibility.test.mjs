import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("physical Android accessibility proof keeps its cross-layer contract aligned", async () => {
  const [application, instrumentation, runner, packageManifest] =
    await Promise.all([
      readFile(new URL("accessibility.tsx", directory), "utf8"),
      readFile(
        new URL(
          "android/app/src/androidTest/java/dev/solidnative/e2e/SolidNativeAccessibilityPhysicalTest.kt",
          directory,
        ),
        "utf8",
      ),
      readFile(
        new URL("scripts/android-accessibility-test.sh", directory),
        "utf8",
      ),
      readFile(new URL("package.json", directory), "utf8").then(JSON.parse),
    ]);

  for (const value of [
    "Solid Native accessibility ready",
    "Refresh native accessibility preferences",
    "Commit native accessibility preference",
    "Announce Solid Native accessibility proof",
    "Dispose Solid Native accessibility proof",
  ]) {
    assert.ok(application.includes(value), `Application is missing ${value}.`);
    assert.ok(
      instrumentation.includes(value),
      `Instrumentation is missing ${value}.`,
    );
  }
  assert.equal(
    packageManifest.scripts["android:accessibility:test"],
    "sh scripts/android-accessibility-test.sh && node scripts/verify-solid-runtime-sourcemap.mjs android/app/build/generated/sourcemaps/react/solidRelease/index.android.bundle.map && node scripts/verify-accessibility-sourcemap.mjs android/app/build/generated/sourcemaps/react/solidRelease/index.android.bundle.map",
  );
  assert.match(
    application,
    /createReactNativeAccessibilityService\(\)[\s\S]*createCausalTelemetry[\s\S]*platform\.accessibility\.preference[\s\S]*OUTPUT_COMPUTATION_NAME[\s\S]*commit\.sequence[\s\S]*createAccessibilityPreferences\(service/u,
  );
  assert.match(
    application,
    /Object\.keys\(record\.attributes\)[\s\S]*!name\.toLowerCase\(\)\.includes\("preference"\)[\s\S]*!name\.toLowerCase\(\)\.includes\("enabled"\)/u,
  );
  assert.match(
    instrumentation,
    /transition_animation_scale[\s\S]*high_text_contrast_enabled[\s\S]*COMMIT_LABEL[\s\S]*CAUSALITY_MARKER/u,
  );
  assert.match(
    instrumentation,
    /executeAndWaitForEvent[\s\S]*ANNOUNCE_LABEL[\s\S]*TYPE_ANNOUNCEMENT[\s\S]*APP_ID[\s\S]*READY_TEXT[\s\S]*ANNOUNCED_MARKER[\s\S]*DISPOSE_LABEL/u,
  );
  assert.match(runner, /ENTRY_FILE=accessibility\.tsx/u);
  assert.match(runner, /assembleSolidReleaseAndroidTest/u);
  assert.match(runner, /trap cleanup EXIT HUP INT TERM/u);
  for (const value of ["original_transition_scale", "original_high_contrast"]) {
    assert.ok(runner.includes(value), `Runner does not preserve ${value}.`);
  }
  assert.match(
    runner,
    /restore_device_settings[\s\S]*restored[\s\S]*uninstall "\$package_name"[\s\S]*pidof "\$package_name"[\s\S]*pm path "\$package_name"/u,
  );
});
