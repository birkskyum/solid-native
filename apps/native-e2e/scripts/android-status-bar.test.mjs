import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("physical Android status-bar proof keeps its cross-layer contract aligned", async () => {
  const [application, instrumentation, runner, manifest] = await Promise.all([
    readFile(new URL("status-bar.tsx", directory), "utf8"),
    readFile(
      new URL(
        "android/app/src/androidTest/java/dev/solidnative/e2e/SolidNativeStatusBarPhysicalTest.kt",
        directory,
      ),
      "utf8",
    ),
    readFile(new URL("scripts/android-status-bar-test.sh", directory), "utf8"),
    readFile(new URL("package.json", directory), "utf8").then(JSON.parse),
  ]);

  for (const value of [
    "Solid Native status bar ready",
    "Mount light status bar owner",
    "Hide status bar from child owner",
    "Dispose child status bar owner",
    "Dispose Solid Native status bar proof",
  ]) {
    assert.ok(application.includes(value), `Application is missing ${value}.`);
    assert.ok(
      instrumentation.includes(value),
      `Instrumentation is missing ${value}.`,
    );
  }
  assert.equal(
    manifest.scripts["android:status-bar:test"],
    "sh scripts/android-status-bar-test.sh && node scripts/verify-solid-runtime-sourcemap.mjs android/app/build/generated/sourcemaps/react/solidRelease/index.android.bundle.map",
  );
  assert.match(application, /<StatusBar[\s\S]*barStyle="dark-content"/u);
  assert.match(
    application,
    /<Show when=\{overlayMounted\(\)\}>[\s\S]*<StatusBar[\s\S]*barStyle="light-content"[\s\S]*hidden=\{overlayHidden\(\)\}/u,
  );
  assert.match(
    instrumentation,
    /WindowInsets\.Type\.statusBars\(\)[\s\S]*APPEARANCE_LIGHT_STATUS_BARS/u,
  );
  assert.match(
    instrumentation,
    /visible = true, darkIcons = true[\s\S]*MOUNT_OVERLAY_LABEL[\s\S]*visible = true, darkIcons = false[\s\S]*HIDE_OVERLAY_LABEL[\s\S]*visible = false, darkIcons = false[\s\S]*DISPOSE_OVERLAY_LABEL[\s\S]*visible = true, darkIcons = true/u,
  );
  assert.match(runner, /ENTRY_FILE=status-bar\.tsx/u);
  assert.match(runner, /assembleSolidReleaseAndroidTest/u);
  assert.match(runner, /trap cleanup EXIT HUP INT TERM/u);
  assert.match(runner, /SOLID_NATIVE_STATUS_BAR_TEARDOWN_SUCCEEDED/u);
});
