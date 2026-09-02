import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("keeps the physical Android memory-warning proof cross-layer complete", async () => {
  const [
    application,
    mainApplication,
    module,
    instrumentation,
    runner,
    manifest,
  ] = await Promise.all([
    readFile(new URL("memory-warning.tsx", directory), "utf8"),
    readFile(
      new URL(
        "android/app/src/main/java/dev/solidnative/e2e/MainApplication.kt",
        directory,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../../packages/fabric-host/native/android/java/dev/solidnative/runtime/SolidNativePlatformModule.kt",
        directory,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "android/app/src/androidTest/java/dev/solidnative/e2e/SolidNativeMemoryWarningPhysicalTest.kt",
        directory,
      ),
      "utf8",
    ),
    readFile(
      new URL("scripts/android-memory-warning-test.sh", directory),
      "utf8",
    ),
    readFile(new URL("package.json", directory), "utf8").then(JSON.parse),
  ]);

  assert.match(
    application,
    /binding\.platform === "ios" \|\| binding\.platform === "android"/u,
  );
  assert.match(application, /createMemoryWarningCount\(props\.platform\)/u);
  assert.match(application, /SOLID_NATIVE_MEMORY_WARNING_CAUSALITY_SUCCEEDED/u);
  assert.match(
    mainApplication,
    /onTrimMemory\(level: Int\)[\s\S]*SolidNativeMemoryWarning\.handleTrimMemory\(level\)[\s\S]*onLowMemory\(\)[\s\S]*SolidNativeMemoryWarning\.handleLowMemory\(\)/u,
  );
  assert.match(
    module,
    /NativeSolidNativePlatformAndroidSpec\(context\)[\s\S]*emitOnMemoryWarning\(event\)/u,
  );
  assert.match(module, /level in RUNNING_LOW\.\.RUNNING_CRITICAL/u);
  assert.match(
    instrumentation,
    /testMemoryWarningOnPhysicalDevice[\s\S]*onTrimMemory\(UI_HIDDEN\)[\s\S]*Memory warnings 0[\s\S]*onTrimMemory\(RUNNING_CRITICAL\)[\s\S]*Memory warnings 1[\s\S]*Dispose Solid Native memory-warning proof/u,
  );
  assert.match(
    instrumentation,
    /tapControl\(DISPOSE_LABEL\)[\s\S]*waitForTeardownAcknowledgement\(\)/u,
  );
  assert.match(runner, /ENTRY_FILE=memory-warning\.tsx/u);
  assert.match(runner, /SolidNativeMemoryWarningPhysicalTest/u);
  assert.match(runner, /trap cleanup EXIT HUP INT TERM/u);
  assert.match(runner, /marker_deadline=.*30/u);
  assert.match(runner, /SOLID_NATIVE_MEMORY_WARNING_TEARDOWN_REQUESTED/u);
  assert.match(runner, /SOLID_NATIVE_SURFACE_STATUS surface-stopped/u);
  assert.match(runner, /SOLID_NATIVE_MEMORY_WARNING_TEARDOWN_SUCCEEDED/u);
  assert.equal(
    manifest.scripts["android:memory-warning:test"],
    "sh scripts/android-memory-warning-test.sh && node scripts/verify-solid-runtime-sourcemap.mjs android/app/build/generated/sourcemaps/react/solidRelease/index.android.bundle.map",
  );
});
