import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("physical iOS platform-reactivity proof keeps its cross-layer contract aligned", async () => {
  const [application, automation, runner, infoPlist, manifest] =
    await Promise.all([
      readFile(new URL("platform-reactivity.tsx", directory), "utf8"),
      readFile(
        new URL(
          "ios/SolidNativeE2EUITests/SolidNativeE2EUITests.swift",
          directory,
        ),
        "utf8",
      ),
      readFile(
        new URL("scripts/ios-platform-reactivity-test.sh", directory),
        "utf8",
      ),
      readFile(new URL("ios/SolidNativeE2E/Info.plist", directory), "utf8"),
      readFile(new URL("package.json", directory), "utf8").then(JSON.parse),
    ]);

  for (const value of [
    "Solid Native platform reactivity ready",
    "Commit native platform change",
    "Dispose Solid Native platform reactivity proof",
  ]) {
    assert.ok(application.includes(value), `Application is missing ${value}.`);
    assert.ok(automation.includes(value), `XCTest is missing ${value}.`);
  }
  assert.match(
    automation,
    /func testPlatformReactivityOnPhysicalDevice\(\)[\s\S]*device\.orientation = \.landscapeLeft[\s\S]*requireWindow\("landscape"[\s\S]*device\.orientation = \.portrait[\s\S]*requireWindow\("portrait"/u,
  );
  assert.match(
    automation,
    /device\.appearance = alternateAppearance[\s\S]*requireAppearance\(alternateAppearance\)[\s\S]*device\.appearance = originalAppearance[\s\S]*requireAppearance\(initialAppearance\)/u,
  );
  assert.match(
    automation,
    /defer \{[\s\S]*device\.appearance = originalAppearance[\s\S]*device\.orientation = restorationOrientation/u,
  );
  assert.match(runner, /ENTRY_FILE=platform-reactivity\.tsx/u);
  assert.match(runner, /clean build-for-testing/u);
  assert.match(runner, /test-without-building/u);
  assert.match(runner, /start_solid_native_ios_process_guard/u);
  assert.match(runner, /ios-device-preflight\.mjs/u);
  assert.match(runner, /verify-solid-runtime-sourcemap\.mjs/u);
  assert.match(runner, /verify-platform-reactivity-sourcemap\.mjs/u);
  assert.match(runner, /PlistBuddy[\s\S]*CFBundleIdentifier/u);
  assert.match(runner, /codesign --verify --deep --strict "\$APP_PATH"/u);
  assert.match(
    runner,
    /codesign --verify --deep --strict "\$TEST_BUNDLE_PATH"/u,
  );
  assert.match(runner, /SOLID_NATIVE_PLATFORM_WINDOW_CAUSALITY_SUCCEEDED/u);
  assert.match(runner, /SOLID_NATIVE_PLATFORM_APPEARANCE_CAUSALITY_SUCCEEDED/u);
  assert.match(infoPlist, /UIInterfaceOrientationLandscapeLeft/u);
  assert.match(infoPlist, /UIInterfaceOrientationLandscapeRight/u);
  assert.ok(
    runner.indexOf("ios-device-preflight.mjs") < runner.indexOf("xcodebuild"),
  );
  assert.equal(
    manifest.scripts["ios:platform-reactivity:test"],
    "sh scripts/ios-platform-reactivity-test.sh",
  );
});
