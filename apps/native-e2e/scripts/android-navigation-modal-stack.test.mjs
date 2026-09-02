import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("physical nested modal routing keeps its cross-layer contract aligned", async () => {
  const [application, instrumentation, runner] = await Promise.all([
    readFile(new URL("navigation-modal-stack.tsx", directory), "utf8"),
    readFile(
      new URL(
        "android/app/src/androidTest/java/dev/solidnative/e2e/SolidNativeModalStackPhysicalTest.kt",
        directory,
      ),
      "utf8",
    ),
    readFile(
      new URL("scripts/android-navigation-modal-stack-test.sh", directory),
      "utf8",
    ),
  ]);

  for (const value of [
    "Solid Native nested modal root",
    "Solid Native nested modal level one",
    "Solid Native nested modal level two",
    "Open first nested native modal",
    "Open second nested native modal",
    "Close nested native modals through application history",
    "Dispose nested native modal proof",
    "First modal retained after one Android platform Back",
    "Android platform Back closed both modal levels exactly",
    "Application multi-pop closed both modal levels exactly",
  ]) {
    assert.ok(application.includes(value), `Application is missing ${value}.`);
    assert.ok(
      instrumentation.includes(value),
      `Instrumentation is missing ${value}.`,
    );
  }

  assert.match(application, /history\.back\(2\)/u);
  assert.match(application, /hiddenBeforeDisposal\.join\(","\) === "0,1,2,3"/u);
  assert.match(application, /disposalOrder\.join\(","\) === "2,1,4,3"/u);
  assert.match(instrumentation, /AccessibilityService\.GLOBAL_ACTION_BACK/gmu);
  assert.match(instrumentation, /logcat -d -v brief -s ReactNativeJS:I/u);
  assert.match(instrumentation, /TEARDOWN_MARKER/u);
  assert.match(instrumentation, /activity\.isFinishing/u);
  assert.match(runner, /ENTRY_FILE=navigation-modal-stack\.tsx/u);
  assert.match(runner, /assembleSolidNavigationReleaseAndroidTest/u);
  assert.match(runner, /\. "\$script_dir\/android-device-preflight\.sh"/u);
  assert.match(runner, /solid_native_android_lease_stay_awake/u);
  assert.match(runner, /solid_native_android_prepare_device/u);
  assert.match(runner, /solid_native_android_restore_stay_awake/u);
  assert.match(runner, /trap cleanup EXIT HUP INT TERM/u);
  assert.match(runner, /SOLID_NATIVE_NAVIGATION_MODAL_STACK_FAILED/u);
  assert.match(runner, /finish_cleanup/u);
  assert.ok(
    runner.lastIndexOf("finish_cleanup") <
      runner.lastIndexOf("Verified two-level Solid-owned native Modal routing"),
  );
});
