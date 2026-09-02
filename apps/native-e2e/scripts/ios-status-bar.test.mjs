import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("physical iOS status-bar proof keeps its cross-layer contract aligned", async () => {
  const [application, automation, runner, infoPlist, manifest] =
    await Promise.all([
      readFile(new URL("status-bar.tsx", directory), "utf8"),
      readFile(
        new URL(
          "ios/SolidNativeE2EUITests/SolidNativeE2EUITests.swift",
          directory,
        ),
        "utf8",
      ),
      readFile(new URL("scripts/ios-status-bar-test.sh", directory), "utf8"),
      readFile(new URL("ios/SolidNativeE2E/Info.plist", directory), "utf8"),
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
    assert.ok(automation.includes(value), `XCTest is missing ${value}.`);
  }
  assert.equal(
    manifest.scripts["ios:status-bar:test"],
    "sh scripts/ios-status-bar-test.sh",
  );
  assert.match(application, /<StatusBar[\s\S]*barStyle="dark-content"/u);
  assert.match(
    application,
    /<Show when=\{overlayMounted\(\)\}>[\s\S]*<StatusBar[\s\S]*barStyle="light-content"[\s\S]*hidden=\{overlayHidden\(\)\}/u,
  );
  assert.match(
    application,
    /event\.name"\] === "press"[\s\S]*STATUS_COMPUTATION_NAME/u,
  );
  assert.match(
    application,
    /CausalComputation name=\{STATUS_COMPUTATION_NAME\}[\s\S]*SOLID_NATIVE_STATUS_BAR_CHILD_MOUNTED/u,
  );
  assert.match(
    automation,
    /func testStatusBarOwnerStackOnPhysicalDevice\(\)[\s\S]*application\.screenshot\(\)[\s\S]*statusBarPixelCounts/u,
  );
  assert.match(
    automation,
    /initialPixels\.dark[\s\S]*lightPixels\.light[\s\S]*hiddenPixels\.dark[\s\S]*restoredPixels\.dark/u,
  );
  assert.match(runner, /ENTRY_FILE=status-bar\.tsx/u);
  assert.match(runner, /clean build-for-testing/u);
  assert.match(runner, /test-without-building/u);
  assert.match(runner, /start_solid_native_ios_process_guard/u);
  assert.match(runner, /ios-device-preflight\.mjs/u);
  assert.match(runner, /verify-solid-runtime-sourcemap\.mjs/u);
  assert.match(runner, /UIViewControllerBasedStatusBarAppearance/u);
  assert.match(runner, /codesign --verify --deep --strict "\$APP_PATH"/u);
  assert.match(
    runner,
    /codesign --verify --deep --strict "\$TEST_BUNDLE_PATH"/u,
  );
  assert.match(runner, /SOLID_NATIVE_STATUS_BAR_PARENT_RESTORED/u);
  assert.match(infoPlist, /UIViewControllerBasedStatusBarAppearance/u);
  assert.ok(
    runner.indexOf("ios-device-preflight.mjs") < runner.indexOf("xcodebuild"),
  );
});
