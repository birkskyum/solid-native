import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assertDevtoolsBundle } from "./verify-devtools-sourcemap.mjs";

const directory = new URL("../", import.meta.url);

test("physical Android development overlay keeps its cross-layer contract aligned", async () => {
  const [application, instrumentation, runner, manifest] = await Promise.all([
    readFile(new URL("devtools.tsx", directory), "utf8"),
    readFile(
      new URL(
        "android/app/src/androidTest/java/dev/solidnative/e2e/SolidNativeDevtoolsPhysicalTest.kt",
        directory,
      ),
      "utf8",
    ),
    readFile(new URL("scripts/android-devtools-test.sh", directory), "utf8"),
    readFile(new URL("package.json", directory), "utf8").then(JSON.parse),
  ]);

  for (const value of [
    "Solid Native development overlay ready",
    "Report async development error",
    "Physical async failure",
    "Async overlay recovered",
    "Report guarded Hermes error",
    "Physical guarded Hermes failure",
    "Runtime overlay recovered",
    "Throw Solid render error",
    "Physical Solid render failure",
    "Render overlay recovered",
    "Exercise Solid diagnostics capture",
    "solid-native.devtools.diagnostics.counter",
    "solid-native.devtools.diagnostics.output",
    "solid-native.event",
    "solid-native.commit",
    "Dismiss development error",
    "Retry failed Solid subtree",
    "Dispose development overlay proof",
  ]) {
    if (
      value !== "Dismiss development error" &&
      value !== "Retry failed Solid subtree"
    ) {
      assert.ok(
        application.includes(value),
        `Application is missing ${value}.`,
      );
    }
    assert.ok(
      instrumentation.includes(value),
      `Instrumentation is missing ${value}.`,
    );
  }
  assert.equal(
    manifest.scripts["android:devtools:test"],
    "sh scripts/android-devtools-test.sh && node scripts/verify-devtools-sourcemap.mjs build/devtools/index.android.bundle.map",
  );
  assert.equal(manifest.dependencies["@solid-native/devtools"], "workspace:^");
  assert.match(
    application,
    /installReactNativeDevelopmentErrorBridge\(errors\)/u,
  );
  assert.match(application, /createCausalTimeline\(\{ capacity: 200 \}\)/u);
  assert.match(application, /createCausalTelemetry/u);
  assert.match(application, /createDevelopmentNetworkInspector\(\)/u);
  assert.match(
    application,
    /<DevelopmentNetworkPanel inspector=\{networkInspector\}>/u,
  );
  assert.match(
    application,
    /<DevelopmentCausalPanel[\s\S]*timeline=\{causalTimeline\}[\s\S]*solidDiagnostics=\{solidDiagnostics\}/u,
  );
  assert.match(application, /createDevelopmentSolidDiagnosticsController/u);
  assert.match(
    application,
    /<CausalComputation name=\{DIAGNOSTICS_OUTPUT_NAME\}>/u,
  );
  assert.match(application, /telemetry,/u);
  assert.match(application, /source: "async"/u);
  assert.match(application, /snapshot\.source === "runtime"/u);
  assert.match(application, /setRenderFailure\(true\)/u);
  assert.match(application, /errorUtils\.reportError/u);
  assert.match(
    instrumentation,
    /OPEN_NETWORK_LABEL[\s\S]*NETWORK_TITLE[\s\S]*CLOSE_NETWORK_LABEL[\s\S]*OPEN_NETWORK_LABEL[\s\S]*NETWORK_TITLE[\s\S]*CLOSE_NETWORK_LABEL[\s\S]*OPEN_CAUSAL_LABEL[\s\S]*GROUP_CAUSAL_LABEL[\s\S]*CAUSAL_FILTER_LABEL[\s\S]*SINGLE_MATCHING_GROUP_TEXT[\s\S]*INSPECT_CAUSAL_GROUP_PREFIX[\s\S]*SELECTED_TRACE_GROUP_TEXT[\s\S]*INSPECT_CAUSAL_PREFIX[\s\S]*CAUSAL_COMMIT_NAME[\s\S]*RETAINED_CAUSES_PREFIX[\s\S]*INSPECT_CAUSAL_PREFIX[\s\S]*CAUSAL_EVENT_NAME[\s\S]*RETAINED_EFFECTS_PREFIX[\s\S]*BACK_TO_CAUSAL_GROUP_LABEL[\s\S]*BACK_TO_CAUSAL_GROUPS_LABEL[\s\S]*CLEAR_CAUSAL_LABEL[\s\S]*EMPTY_CAUSAL_TEXT[\s\S]*CLOSE_CAUSAL_LABEL[\s\S]*START_SOLID_CAPTURE_LABEL[\s\S]*STOP_SOLID_CAPTURE_TEXT[\s\S]*DIAGNOSTICS_BUTTON_LABEL[\s\S]*DIAGNOSTICS_UPDATED_TEXT[\s\S]*STOP_SOLID_CAPTURE_LABEL[\s\S]*SOLID_CORRELATION_TITLE[\s\S]*DIAGNOSTICS_CORRELATION_ROW[\s\S]*ASYNC_BUTTON_LABEL/u,
  );
  assert.match(
    instrumentation,
    /performAction\(AccessibilityNodeInfo\.ACTION_SET_TEXT, arguments\)/u,
  );
  assert.match(
    instrumentation,
    /ASYNC_BUTTON_LABEL[\s\S]*DISMISS_ERROR_LABEL[\s\S]*ASYNC_RECOVERED_TEXT[\s\S]*RUNTIME_BUTTON_LABEL[\s\S]*RUNTIME_ERROR_TEXT[\s\S]*RUNTIME_RECOVERED_TEXT[\s\S]*RENDER_BUTTON_LABEL[\s\S]*RETRY_ERROR_LABEL[\s\S]*RENDER_RECOVERED_TEXT/u,
  );
  assert.match(
    instrumentation,
    /tapControl\(DISPOSE_LABEL\)[\s\S]*waitForTeardownAcknowledgement\(\)[\s\S]*TEARDOWN_MARKER/u,
  );
  assert.match(runner, /assembleSolidDevtoolsDebug/u);
  assert.match(runner, /assembleSolidDevtoolsReleaseAndroidTest/u);
  assert.match(runner, /devtools\.map\?platform=android&dev=true/u);
  assert.match(runner, /reverse --remove/u);
  assert.match(runner, /trap cleanup EXIT HUP INT TERM/u);
  assert.match(runner, /SOLID_NATIVE_DEVTOOLS_TEARDOWN_SUCCEEDED/u);
  assert.match(runner, /SOLID_NATIVE_DEVTOOLS_BRIDGE_REMOVED/u);
  assert.match(runner, /SOLID_NATIVE_DEVTOOLS_CAUSAL_SEEDED/u);
  assert.match(
    runner,
    /am force-stop "\$app_id"[\s\S]*uninstall "\$package_name"[\s\S]*pidof "\$app_id"[\s\S]*pm path "\$package_name"[\s\S]*Verified repeated network and causal panel ownership, causal grouping, on-device Solid\/native correlation/u,
  );
});

test("accepts only the complete development-overlay package seam", () => {
  const sources = [
    "/workspace/apps/native-e2e/devtools.tsx",
    "/workspace/packages/devtools/dist/index.js",
    "/workspace/packages/devtools/dist/react-native.js",
    "/workspace/packages/devtools/dist/network.js",
    "/workspace/packages/devtools/dist/solid.js",
    "/workspace/packages/devtools/dist/causal-solid.js",
    "/workspace/packages/devtools/dist/solid-diagnostics-development.js",
    "/workspace/node_modules/solid-js/dist/dev.js",
    "/workspace/node_modules/@solidjs/signals/dist/dev.js",
  ];
  assert.deepEqual(assertDevtoolsBundle({ sources }), sources.slice(0, 7));
  assert.throws(
    () =>
      assertDevtoolsBundle({
        sources: sources.filter(
          (source) => !source.endsWith("/dist/causal-solid.js"),
        ),
      }),
    /Expected exactly one development-overlay proof source/u,
  );
  assert.throws(
    () =>
      assertDevtoolsBundle({
        sources: [...sources, "/workspace/packages/devtools/dist/private.js"],
      }),
    /unexpected devtools package sources/u,
  );
});
