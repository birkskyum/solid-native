import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("physical iOS development overlay keeps its cross-layer contract aligned", async () => {
  const [application, appDelegate, automation, runner, manifest] =
    await Promise.all([
      readFile(new URL("devtools.tsx", directory), "utf8"),
      readFile(
        new URL("ios/SolidNativeE2E/AppDelegate.swift", directory),
        "utf8",
      ),
      readFile(
        new URL(
          "ios/SolidNativeE2EUITests/SolidNativeE2EUITests.swift",
          directory,
        ),
        "utf8",
      ),
      readFile(new URL("scripts/ios-devtools-test.sh", directory), "utf8"),
      readFile(new URL("package.json", directory), "utf8").then(JSON.parse),
    ]);

  for (const value of [
    "Solid Native development overlay ready",
    "Exercise Solid diagnostics capture",
    "solid-native.devtools.diagnostics.counter",
    "solid-native.devtools.diagnostics.output",
    "Report async development error",
    "Physical async failure",
    "Async overlay recovered",
    "Report guarded Hermes error",
    "Physical guarded Hermes failure",
    "Runtime overlay recovered",
    "Throw Solid render error",
    "Physical Solid render failure",
    "Render overlay recovered",
    "Dispose development overlay proof",
  ]) {
    assert.ok(application.includes(value), `Application is missing ${value}.`);
    assert.ok(automation.includes(value), `XCTest is missing ${value}.`);
  }

  for (const value of [
    "Open network inspector (0 retained requests)",
    "Close network inspector",
    "Native network",
    "Open causal trace inspector",
    "Close causal trace inspector",
    "Causal trace",
    "Start Solid diagnostics capture",
    "Stop Solid diagnostics capture",
    "Dismiss development error",
    "Retry failed Solid subtree",
  ]) {
    assert.ok(automation.includes(value), `XCTest is missing ${value}.`);
  }

  assert.match(
    automation,
    /testDevelopmentOverlayOnPhysicalDevice[\s\S]*--solid-native-use-bundled-development/u,
  );
  assert.match(
    automation,
    /0\.\.<2[\s\S]*Open network inspector[\s\S]*Close network inspector/u,
  );
  assert.match(
    automation,
    /Start Solid diagnostics capture[\s\S]*Exercise Solid diagnostics capture[\s\S]*Stop Solid diagnostics capture[\s\S]*native correlation/u,
  );
  assert.match(
    automation,
    /Report async development error[\s\S]*Report guarded Hermes error[\s\S]*Throw Solid render error[\s\S]*Retry failed Solid subtree[\s\S]*Dispose development overlay proof/u,
  );
  assert.match(
    appDelegate,
    /--solid-native-use-bundled-development[\s\S]*main[\s\S]*jsbundle/u,
  );

  assert.match(runner, /ios-device-preflight\.mjs/u);
  assert.match(
    runner,
    /ios-device-preflight\.mjs[\s\S]*pnpm[\s\S]*xcodebuild/u,
  );
  assert.match(runner, /-configuration Debug/u);
  assert.match(runner, /ENTRY_FILE=devtools\.tsx/u);
  assert.match(runner, /SOURCEMAP_FILE=/u);
  assert.match(runner, /testDevelopmentOverlayOnPhysicalDevice/u);
  assert.match(runner, /start_solid_native_ios_process_guard/u);
  assert.match(runner, /verify-devtools-sourcemap\.mjs/u);
  assert.match(runner, /SOLID_NATIVE_DEVTOOLS_BRIDGE_REMOVED/u);
  assert.match(runner, /SOLID_NATIVE_DEVTOOLS_TEARDOWN_SUCCEEDED/u);
  assert.doesNotMatch(runner, /--console/u);
  assert.equal(
    manifest.scripts["ios:devtools:test"],
    "sh scripts/ios-devtools-test.sh",
  );
});
