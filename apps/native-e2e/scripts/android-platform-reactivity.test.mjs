import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("physical Android platform-reactivity proof keeps its cross-layer contract aligned", async () => {
  const [application, instrumentation, runner, packageManifest] =
    await Promise.all([
      readFile(new URL("platform-reactivity.tsx", directory), "utf8"),
      readFile(
        new URL(
          "android/app/src/androidTest/java/dev/solidnative/e2e/SolidNativePlatformReactivityPhysicalTest.kt",
          directory,
        ),
        "utf8",
      ),
      readFile(
        new URL("scripts/android-platform-reactivity-test.sh", directory),
        "utf8",
      ),
      readFile(new URL("package.json", directory), "utf8").then(JSON.parse),
    ]);

  for (const value of [
    "Solid Native platform reactivity ready",
    "Commit native platform change",
    "Dispose Solid Native platform reactivity proof",
  ]) {
    assert.ok(application.includes(value), `Application is missing ${value}.`);
    assert.ok(
      instrumentation.includes(value),
      `Instrumentation is missing ${value}.`,
    );
  }
  assert.equal(
    packageManifest.scripts["android:platform-reactivity:test"],
    "sh scripts/android-platform-reactivity-test.sh && node scripts/verify-solid-runtime-sourcemap.mjs android/app/build/generated/sourcemaps/react/solidRelease/index.android.bundle.map && node scripts/verify-platform-reactivity-sourcemap.mjs android/app/build/generated/sourcemaps/react/solidRelease/index.android.bundle.map",
  );
  assert.match(
    application,
    /createWindowDimensions\(platform\)[\s\S]*createColorScheme\(platform\)/u,
  );
  assert.ok(application.includes('eventName: "platform.window.dimensions"'));
  assert.ok(application.includes('eventName: "platform.appearance.change"'));
  assert.match(
    application,
    /PERMITTED_EVENT_ATTRIBUTES[\s\S]*PERMITTED_COMPUTATION_ATTRIBUTES[\s\S]*matches\.length === 1/u,
  );
  assert.match(
    instrumentation,
    /SCREEN_ORIENTATION_LANDSCAPE[\s\S]*SCREEN_ORIENTATION_PORTRAIT[\s\S]*WINDOW_CAUSALITY_MARKER/u,
  );
  assert.match(
    instrumentation,
    /setNightMode\(if \(originalNightEnabled\)[\s\S]*APPEARANCE_CAUSALITY_MARKER[\s\S]*setNightMode\(originalNightMode\)/u,
  );
  assert.ok(instrumentation.includes('readShell("cmd uimode night $mode")'));
  assert.match(runner, /ENTRY_FILE=platform-reactivity\.tsx/u);
  assert.match(runner, /trap cleanup EXIT HUP INT TERM/u);
  assert.match(
    runner,
    /original_night_mode=\$\(read_night_mode\)[\s\S]*restore_device_state[\s\S]*read_night_mode[\s\S]*uninstall "\$package_name"/u,
  );
});
