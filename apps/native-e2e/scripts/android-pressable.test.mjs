import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("physical Android Pressable proof keeps its cross-layer contract aligned", async () => {
  const [application, instrumentation, runner, manifest] = await Promise.all([
    readFile(new URL("pressable.tsx", directory), "utf8"),
    readFile(
      new URL(
        "android/app/src/androidTest/java/dev/solidnative/e2e/SolidNativePressablePhysicalTest.kt",
        directory,
      ),
      "utf8",
    ),
    readFile(new URL("scripts/android-pressable-test.sh", directory), "utf8"),
    readFile(new URL("package.json", directory), "utf8").then(JSON.parse),
  ]);

  for (const value of [
    "Solid Native Pressable ready",
    "Diagonal retained-region Pressable",
    "Cancellation recovery Pressable",
    "Native foreground ripple Pressable",
    "Scroll takeover Pressable",
    "Dispose Solid Native Pressable proof",
  ]) {
    assert.ok(application.includes(value), `Application is missing ${value}.`);
    assert.ok(
      instrumentation.includes(value),
      `Instrumentation is missing ${value}.`,
    );
  }
  assert.equal(
    manifest.scripts["android:pressable:test"],
    "sh scripts/android-pressable-test.sh",
  );
  assert.match(
    application,
    /pressRetentionOffset=\{32\}[\s\S]*android_ripple=\{\{[\s\S]*foreground: true[\s\S]*radius: 36[\s\S]*pressRetentionOffset=\{96\}/u,
  );
  assert.match(
    application,
    /contentContainerStyle=\{\{ minHeight: 420, padding: 8 \}\}[\s\S]*flexGrow: 0[\s\S]*flexShrink: 0[\s\S]*height: 160/u,
  );
  assert.match(
    instrumentation,
    /verifyDiagonalRetainedRegion\(activity\)[\s\S]*verifyCancellationAndRecovery\(activity\)[\s\S]*verifyNativeRipple\(activity\)[\s\S]*verifyScrollViewTakeover\(activity\)/u,
  );
  assert.match(
    instrumentation,
    /bounds\.right \+ 16f \* density[\s\S]*bounds\.right \+ 48f \* density[\s\S]*MotionEvent\.ACTION_CANCEL/u,
  );
  assert.match(
    instrumentation,
    /moveGesture\([\s\S]*RETENTION_MOVE_STEPS[\s\S]*RETENTION_BOUNDARY_STEPS/u,
  );
  assert.match(
    instrumentation,
    /try \{[\s\S]*verifyDiagonalRetainedRegion\(activity\)[\s\S]*finally \{[\s\S]*cancelActiveGesture\(\)/u,
  );
  assert.match(
    instrumentation,
    /nativeForegroundRipple\(target\)[\s\S]*ripple\.radius[\s\S]*meanColorDelta\(before, during, bounds\)[\s\S]*findAncestorScrollView\(target\)[\s\S]*waitForScrollOffset\(scrollView\)/u,
  );
  assert.match(runner, /ENTRY_FILE=pressable\.tsx/u);
  assert.match(runner, /assembleSolidReleaseAndroidTest/u);
  assert.match(runner, /verify-solid-runtime-sourcemap\.mjs/u);
  assert.match(runner, /verify-pressable-sourcemap\.mjs/u);
  assert.ok(
    runner.indexOf("verify-pressable-sourcemap.mjs") <
      runner.indexOf('install -r "$app_apk"'),
  );
  assert.match(runner, /trap cleanup EXIT HUP INT TERM/u);
  assert.match(runner, /SOLID_NATIVE_PRESSABLE_SCENARIOS_SUCCEEDED/u);
  assert.match(
    runner,
    /uninstall "\$package_name"[\s\S]*pidof "\$package_name"[\s\S]*pm path "\$package_name"[\s\S]*Verified Android Pressable/u,
  );
});
