import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("physical Android safe-area proof keeps its cross-layer contract aligned", async () => {
  const [application, instrumentation, runner, manifest] = await Promise.all([
    readFile(new URL("safe-area.tsx", directory), "utf8"),
    readFile(
      new URL(
        "android/app/src/androidTest/java/dev/solidnative/e2e/SolidNativeSafeAreaPhysicalTest.kt",
        directory,
      ),
      "utf8",
    ),
    readFile(new URL("scripts/android-safe-area-test.sh", directory), "utf8"),
    readFile(new URL("package.json", directory), "utf8").then(JSON.parse),
  ]);

  for (const value of [
    "Solid Native safe area ready",
    "Solid Native safe area top anchor",
    "Solid Native safe area bottom anchor",
    "Dispose Solid Native safe area proof",
  ]) {
    assert.ok(application.includes(value), `Application is missing ${value}.`);
    assert.ok(
      instrumentation.includes(value),
      `Instrumentation is missing ${value}.`,
    );
  }
  assert.equal(
    manifest.dependencies["react-native-safe-area-context"],
    "5.8.1",
  );
  assert.match(application, /<SafeAreaProvider/u);
  assert.match(application, /<SafeAreaView/u);
  assert.match(application, /useSafeAreaInsets\(\)/u);
  assert.match(application, /useSafeAreaFrame\(\)/u);
  assert.match(instrumentation, /NativeSafeAreaProvider/u);
  assert.match(instrumentation, /NativeSafeAreaView/u);
  assert.match(
    instrumentation,
    /WindowInsets\.Type\.statusBars\(\)[\s\S]*WindowInsets\.Type\.displayCutout\(\)[\s\S]*WindowInsets\.Type\.navigationBars\(\)/u,
  );
  assert.match(instrumentation, /appliedTop - expectedTop/u);
  assert.match(instrumentation, /appliedBottom - expectedBottom/u);
  assert.match(runner, /ENTRY_FILE=safe-area\.tsx/u);
  assert.match(runner, /assembleSolidReleaseAndroidTest/u);
  assert.match(runner, /trap cleanup EXIT HUP INT TERM/u);
  assert.match(runner, /marker_deadline=.*date \+%s/u);
  assert.match(runner, /sleep 0\.1/u);
  assert.match(runner, /SOLID_NATIVE_SAFE_AREA_FAILED/u);
  assert.match(runner, /SOLID_NATIVE_SAFE_AREA_TEARDOWN_SUCCEEDED/u);
});
