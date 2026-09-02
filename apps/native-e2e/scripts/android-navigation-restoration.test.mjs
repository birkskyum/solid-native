import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("physical navigation keeps its cross-layer contracts aligned", async () => {
  const [application, instrumentation, runner, preflight, manifest] =
    await Promise.all([
      readFile(new URL("navigation-restoration.tsx", directory), "utf8"),
      readFile(
        new URL(
          "android/app/src/androidTest/java/dev/solidnative/e2e/SolidNativePhysicalTest.kt",
          directory,
        ),
        "utf8",
      ),
      readFile(
        new URL("scripts/android-navigation-restoration-test.sh", directory),
        "utf8",
      ),
      readFile(
        new URL("scripts/android-device-preflight.sh", directory),
        "utf8",
      ),
      readFile(new URL("package.json", directory), "utf8").then(JSON.parse),
    ]);

  const applicationCycles = Number(
    application.match(/const CHURN_CYCLES = (\d+);/u)?.[1],
  );
  const instrumentationCycles = Number(
    instrumentation.match(/NAVIGATION_PROCESS_CHURN_CYCLES = (\d+)/u)?.[1],
  );
  assert.ok(applicationCycles >= 30);
  assert.equal(instrumentationCycles, applicationCycles);

  assert.match(application, /CHURN_CYCLES \+ 1/u);
  assert.match(application, /SOLID_NATIVE_NAVIGATION_PROCESS_CHURN_SUCCEEDED/u);
  assert.match(application, /createTanStackNativeMemoryPolicy/u);
  assert.match(application, /createNativeScrollRestorationFromStorage/u);
  assert.match(application, /createNativeScrollRestorationPersistence/u);
  assert.match(application, /<TanStackNativeScrollView/u);
  assert.match(application, /scrollRestoration=\{scrollRestoration\}/u);
  assert.match(
    application,
    /historySource: launch\.source[\s\S]*SOLID_NATIVE_NAVIGATION_PROCESS_DURABLE_SCROLL_CAPTURE_SUCCEEDED[\s\S]*SOLID_NATIVE_NAVIGATION_PROCESS_DURABLE_SCROLL_RESTORATION_SUCCEEDED/u,
  );
  assert.match(
    application,
    /rootCreations === 1[\s\S]*SOLID_NATIVE_NAVIGATION_PROCESS_SCROLL_CAPTURE_SUCCEEDED[\s\S]*rootCreations === 2[\s\S]*SOLID_NATIVE_NAVIGATION_PROCESS_SCROLL_RESTORATION_SUCCEEDED/u,
  );
  assert.match(
    application,
    /onMemoryPressure\(warningCount\)[\s\S]*applicationPressureCache\.clear\(\)/u,
  );
  assert.match(
    application,
    /memoryPolicy === undefined \? \{\} : \{ memoryPolicy \}/u,
  );
  assert.match(
    application,
    /shouldPreloadRestoredEntry[\s\S]*restorationPreloadPolicySignal = signal/u,
  );
  assert.match(
    application,
    /memoryPressureProofCompleted !== \(mode === "pressure"\)/u,
  );
  assert.match(
    application,
    /memoryRecoveryProofCompleted !== \(mode === "pressure"\)/u,
  );
  assert.match(
    application,
    /SOLID_NATIVE_NAVIGATION_PROCESS_FOCUS_TASK_SUCCEEDED/u,
  );
  assert.match(application, /<TanStackNativeLink/u);
  assert.match(application, /await delay\(75\)/u);
  assert.match(
    application,
    /SOLID_NATIVE_NAVIGATION_PROCESS_LINK_CAUSALITY_SUCCEEDED/u,
  );
  assert.match(application, /"task.name"\] === "navigation.link"/u);
  assert.match(application, /"resource\.runtime\.host_contract_version"/u);
  assert.match(application, /finalCommit\.attributes\["commit.priority"\]/u);
  assert.match(
    application,
    /throw tanStackRedirect\(\{ to: "\/login", replace: true \}\)/u,
  );
  assert.match(
    application,
    /interruptNavigation\(\{[\s\S]*?to: "\/home",[\s\S]*?replace: true,[\s\S]*?\}\)/u,
  );
  assert.match(
    application,
    /SOLID_NATIVE_NAVIGATION_PROCESS_PRODUCT_INTERRUPTION_SUCCEEDED/u,
  );
  assert.match(
    application,
    /<TanStackNativeScrollView[\s\S]*?<View style=\{\{ height: ROOT_SCROLL_TARGET \}\} \/>[\s\S]*?\{rootContent\}[\s\S]*?<View style=\{\{ height: 960 \}\} \/>[\s\S]*?<\/TanStackNativeScrollView>/u,
  );
  assert.match(application, /focusTaskTransitionAborts/u);
  assert.match(instrumentation, /AccessibilityService\.GLOBAL_ACTION_BACK/u);
  assert.match(
    instrumentation,
    /testNavigationProcessRestore[\s\S]*waitForAccessibilityFocus\(accessibilityFocusEvents, NAVIGATION_PROCESS_ROOT_CONTENT\)/u,
  );
  assert.match(
    instrumentation,
    /testNavigationProcessSeed[\s\S]*rootScrollView\.scrollTo\(0, scrollTarget\)[\s\S]*NAVIGATION_PROCESS_DURABLE_SCROLL_CAPTURE_MARKER/u,
  );
  assert.match(
    instrumentation,
    /testNavigationProcessRestore[\s\S]*waitForNavigationProcessScrollOffset\(restoredRootScrollView, restoredScrollTarget\)[\s\S]*NAVIGATION_PROCESS_DURABLE_SCROLL_RESTORATION_MARKER/u,
  );
  assert.match(
    instrumentation,
    /testNavigationProcessChurn[\s\S]*accessibilityFocusEvents\.clear\(\)[\s\S]*waitForAccessibilityFocus\(accessibilityFocusEvents, NAVIGATION_PROCESS_DETAIL_CONTENT\)[\s\S]*accessibilityFocusEvents\.clear\(\)[\s\S]*AccessibilityService\.GLOBAL_ACTION_BACK[\s\S]*waitForAccessibilityFocus\(accessibilityFocusEvents, NAVIGATION_PROCESS_ROOT_CONTENT\)/u,
  );
  assert.match(instrumentation, /retainedStack ===/u);
  assert.match(
    instrumentation,
    /testNavigationProcessMemoryPressure[\s\S]*NAVIGATION_PROCESS_UI_HIDDEN[\s\S]*NAVIGATION_PROCESS_RUNNING_CRITICAL/u,
  );
  assert.match(
    instrumentation,
    /testNavigationProcessMemoryPressure[\s\S]*rootScrollView\.scrollTo\(0, scrollTarget\)[\s\S]*rootScrollView\.parent == null[\s\S]*restoredRootScrollView !== rootScrollView[\s\S]*waitForNavigationProcessScrollOffset\(restoredRootScrollView, scrollTarget\)/u,
  );
  const pressureTestStart = instrumentation.indexOf(
    "private fun testNavigationProcessMemoryPressure()",
  );
  const pressureTestEnd = instrumentation.indexOf(
    "private fun testNavigationProcessChurn()",
    pressureTestStart,
  );
  assert.ok(pressureTestStart >= 0 && pressureTestStart < pressureTestEnd);
  assert.doesNotMatch(
    instrumentation.slice(pressureTestStart, pressureTestEnd),
    /restoredRootScrollView\.scrollTo\(0, 0\)/u,
  );
  assert.match(
    instrumentation,
    /retainedScreens\.all \{ retained -> screens\.any \{ it === retained \} \}/u,
  );
  assert.match(
    instrumentation,
    /waitForNavigationProcessScreens\(activity, 1\)\.single\(\) === rootScreen/u,
  );
  assert.match(
    instrumentation,
    /testNavigationProcessProductInterruption[\s\S]*pendingRouteScreen[\s\S]*AccessibilityService\.GLOBAL_ACTION_BACK[\s\S]*waitForNavigationProcessScreens\(activity, 1\)\.single\(\) === loginScreen/u,
  );
  assert.match(runner, /\. "\$script_dir\/android-device-preflight\.sh"/u);
  assert.match(runner, /solid_native_android_lease_stay_awake/u);
  assert.match(runner, /solid_native_android_prepare_device/u);
  assert.match(runner, /solid_native_android_restore_stay_awake/u);
  assert.match(preflight, /input keyevent KEYCODE_WAKEUP/u);
  assert.match(preflight, /KeyguardServiceDelegate/u);
  assert.match(runner, /bundle sources/u);
  assert.match(runner, /--forbid-containing/u);
  assert.ok(
    runner.indexOf("bundle sources") < runner.indexOf('install -r "$app_apk"'),
  );
  assert.equal(
    manifest.scripts["android:navigation:restoration:test"],
    "sh scripts/android-navigation-restoration-test.sh",
  );
  assert.match(runner, /verify-solid-runtime-sourcemap\.mjs/u);
  assert.match(
    runner,
    /verify-navigation-sourcemap\.mjs[\s\S]*navigation-restoration\.tsx/u,
  );
  assert.ok(
    runner.indexOf("verify-navigation-sourcemap.mjs") <
      runner.indexOf('install -r "$app_apk"'),
  );

  const seed = runner.indexOf("run_phase seed");
  const restore = runner.indexOf("run_phase restore");
  const pressure = runner.indexOf("run_phase pressure");
  const churn = runner.indexOf("run_phase churn");
  const product = runner.indexOf("run_phase product");
  const cold = runner.indexOf("run_phase cold");
  const cleanup = runner.lastIndexOf("finish_cleanup");
  const success = runner.lastIndexOf(
    "Verified single-stack navigation and durable scroll restoration",
  );
  assert.ok(seed >= 0 && seed < restore && restore < pressure);
  assert.match(
    runner.slice(seed, restore),
    /SOLID_NATIVE_NAVIGATION_PROCESS_DURABLE_SCROLL_CAPTURE_SUCCEEDED/u,
  );
  assert.match(
    runner.slice(restore, pressure),
    /SOLID_NATIVE_NAVIGATION_PROCESS_DURABLE_SCROLL_RESTORATION_SUCCEEDED/u,
  );
  assert.ok(pressure < churn);
  assert.ok(churn < product && product < cold);
  assert.match(
    runner.slice(pressure, churn),
    /SOLID_NATIVE_NAVIGATION_PROCESS_SCROLL_CAPTURE_SUCCEEDED[\s\S]*SOLID_NATIVE_NAVIGATION_PROCESS_MEMORY_PRESSURE_SUCCEEDED[\s\S]*SOLID_NATIVE_NAVIGATION_PROCESS_MEMORY_RECOVERY_SUCCEEDED[\s\S]*SOLID_NATIVE_NAVIGATION_PROCESS_SCROLL_RESTORATION_SUCCEEDED/u,
  );
  assert.match(
    runner.slice(churn, product),
    /SOLID_NATIVE_NAVIGATION_PROCESS_CHURN_SUCCEEDED/u,
  );
  assert.match(
    runner.slice(product, cold),
    /SOLID_NATIVE_NAVIGATION_PROCESS_PRODUCT_AUTH_REDIRECT_SUCCEEDED[\s\S]*SOLID_NATIVE_NAVIGATION_PROCESS_PRODUCT_INTERRUPTION_SUCCEEDED/u,
  );
  assert.equal(
    [
      ...runner.matchAll(
        /SOLID_NATIVE_NAVIGATION_PROCESS_FOCUS_TASK_SUCCEEDED/gu,
      ),
    ].length,
    6,
  );
  assert.equal(
    [
      ...runner.matchAll(
        /SOLID_NATIVE_NAVIGATION_PROCESS_LINK_CAUSALITY_SUCCEEDED/gu,
      ),
    ].length,
    3,
  );
  assert.match(
    runner.slice(success),
    /durable scroll restoration[\s\S]*balanced focus-task lifecycles in all six fresh processes/u,
  );
  assert.ok(cold < cleanup && cleanup < success);
});
