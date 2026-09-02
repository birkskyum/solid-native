import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("physical iOS Pressable proof keeps its cross-layer contract aligned", async () => {
  const [application, automation, runner, manifest] = await Promise.all([
    readFile(new URL("pressable.tsx", directory), "utf8"),
    readFile(
      new URL(
        "ios/SolidNativeE2EUITests/SolidNativeE2EUITests.swift",
        directory,
      ),
      "utf8",
    ),
    readFile(new URL("scripts/ios-pressable-test.sh", directory), "utf8"),
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
    assert.ok(automation.includes(value), `XCTest is missing ${value}.`);
  }
  assert.match(automation, /func testPressableOnPhysicalDevice\(\)/u);
  assert.match(automation, /application\.scrollViews\.firstMatch/u);
  assert.match(
    automation,
    /retentionStart\.press\([\s\S]*withVelocity: \.slow[\s\S]*Retention in=2 out=2 move=/u,
  );
  assert.match(
    automation,
    /Cancellation in=1 out=1 move=\[0-9\]\+ press=0[\s\S]*cancellation\.tap\(\)[\s\S]*Cancellation in=2 out=2/u,
  );
  assert.match(
    automation,
    /scrollStart\.press\([\s\S]*Scroll in=1 out=1 move=\[0-9\]\+ press=0 y=\[1-9\]\[0-9\]\*/u,
  );
  assert.match(runner, /ENTRY_FILE=pressable\.tsx/u);
  assert.match(runner, /testPressableOnPhysicalDevice/u);
  assert.match(runner, /start_solid_native_ios_process_guard/u);
  assert.match(runner, /ios-device-preflight\.mjs/u);
  assert.match(runner, /verify-solid-runtime-sourcemap\.mjs/u);
  assert.match(runner, /verify-pressable-sourcemap\.mjs/u);
  assert.match(runner, /PlistBuddy[\s\S]*CFBundleIdentifier/u);
  assert.match(runner, /codesign --verify --deep --strict "\$APP_PATH"/u);
  assert.match(
    runner,
    /codesign --verify --deep --strict "\$TEST_BUNDLE_PATH"/u,
  );
  assert.match(runner, /SOLID_NATIVE_PRESSABLE_SCENARIOS_SUCCEEDED/u);
  assert.match(runner, /SOLID_NATIVE_PRESSABLE_TEARDOWN_SUCCEEDED/u);
  assert.ok(
    runner.indexOf("ios-device-preflight.mjs") < runner.indexOf("xcodebuild"),
  );
  assert.match(runner, /clean build-for-testing/u);
  assert.match(
    runner,
    /build-for-testing[\s\S]*verify-pressable-sourcemap\.mjs[\s\S]*codesign --verify[\s\S]*start_solid_native_ios_process_guard[\s\S]*test-without-building/u,
  );
  assert.equal(
    manifest.scripts["ios:pressable:test"],
    "sh scripts/ios-pressable-test.sh",
  );
});
