import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("physical iOS clipboard proof keeps its cross-layer contract aligned", async () => {
  const [application, nativeSource, automation, runner, manifest] =
    await Promise.all([
      readFile(new URL("clipboard.tsx", directory), "utf8"),
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
      readFile(new URL("scripts/ios-clipboard-test.sh", directory), "utf8"),
      readFile(new URL("package.json", directory), "utf8").then(JSON.parse),
    ]);

  for (const value of [
    "Solid Native clipboard ready",
    "Write Solid Native clipboard proof",
    "Read Solid Native clipboard proof",
    "Clear native clipboard",
    "Dispose Solid Native clipboard proof",
    "Clipboard proof written",
    "External clipboard proof read",
    "Clipboard cleared",
  ]) {
    assert.ok(application.includes(value), `Application is missing ${value}.`);
    assert.ok(automation.includes(value), `XCTest is missing ${value}.`);
  }
  for (const value of [
    "Private Solid Native clipboard write proof",
    "Private external clipboard read proof",
  ]) {
    assert.ok(application.includes(value), `Application is missing ${value}.`);
    assert.ok(
      nativeSource.includes(value),
      `Native source is missing ${value}.`,
    );
  }
  for (const value of [
    "--solid-native-clipboard-source",
    "Clipboard source ready",
    "Capture and seed external clipboard proof",
    "External clipboard proof seeded",
    "Verify Solid Native clipboard write proof",
    "Solid Native clipboard write verified",
    "Verify native clipboard cleared",
    "Native clipboard clear verified",
    "Restore original clipboard",
    "Original clipboard restored",
  ]) {
    assert.ok(
      nativeSource.includes(value),
      `Native source is missing ${value}.`,
    );
    assert.ok(automation.includes(value), `XCTest is missing ${value}.`);
  }
  assert.ok(
    nativeSource.includes("--solid-native-clipboard-restore"),
    "Native source is missing the cleanup-only restoration mode.",
  );
  assert.match(
    application,
    /createReactNativeClipboardService\(\)[\s\S]*createClipboardController\(service\)/u,
  );
  assert.match(
    application,
    /PERMITTED_EVENT_ATTRIBUTES[\s\S]*PERMITTED_COMPUTATION_ATTRIBUTES[\s\S]*PERMITTED_OWNER_ATTRIBUTES[\s\S]*platform\.clipboard\.read[\s\S]*operation\.causes\.length !== 3[\s\S]*SOLID_NATIVE_CLIPBOARD_READ_CAUSALITY_SUCCEEDED/u,
  );
  assert.match(
    nativeSource,
    /let originalItems = UIPasteboard\.general\.items[\s\S]*NSKeyedArchiver\.archivedData[\s\S]*archive\.write\(to: url, options: \.atomic\)[\s\S]*UIPasteboard\.general\.string = externalProof[\s\S]*unarchiveTopLevelObjectWithData[\s\S]*UIPasteboard\.general\.items = originalItems[\s\S]*removeItem\(at: url\)/u,
  );
  assert.match(
    automation,
    /func testNativeClipboardBoundaryCausalityAndTeardownOnPhysicalDevice\(\) throws[\s\S]*XCUIApplication\(bundleIdentifier: "dev\.solidnative\.clipboardsource"\)[\s\S]*source\.launchArguments = \["--solid-native-clipboard-source"\][\s\S]*defer[\s\S]*restoreOriginalClipboardIfNeeded\(\)[\s\S]*Read Solid Native clipboard proof[\s\S]*Verify Solid Native clipboard write proof[\s\S]*Clear native clipboard[\s\S]*Verify native clipboard cleared[\s\S]*Dispose Solid Native clipboard proof/u,
  );
  assert.doesNotMatch(automation, /UIPasteboard/u);
  assert.match(
    automation,
    /springboard\.buttons\[label\][\s\S]*"Allow Paste"/u,
  );
  assert.match(runner, /ENTRY_FILE=clipboard\.tsx/u);
  assert.match(runner, /clean build-for-testing/u);
  assert.match(
    runner,
    /SOURCE_BUNDLE_IDENTIFIER=dev\.solidnative\.clipboardsource/u,
  );
  assert.match(
    runner,
    /SKIP_BUNDLING=1 xcodebuild[\s\S]*SOLID_NATIVE_APP_BUNDLE_ID="\$SOURCE_BUNDLE_IDENTIFIER"[\s\S]*build/u,
  );
  assert.match(
    runner,
    /\[ -e "\$SOURCE_APP_PATH\/main\.jsbundle" \][\s\S]*native-only iOS clipboard source unexpectedly contains a JavaScript bundle/u,
  );
  assert.match(runner, /test-without-building/u);
  assert.match(runner, /start_solid_native_ios_process_guard/u);
  assert.match(runner, /ios-device-preflight\.mjs/u);
  assert.match(runner, /verify-solid-runtime-sourcemap\.mjs/u);
  assert.match(runner, /verify-clipboard-sourcemap\.mjs/u);
  assert.match(runner, /device uninstall app/u);
  assert.match(runner, /device install app[\s\S]*"\$SOURCE_APP_PATH"/u);
  assert.match(
    runner,
    /restore_clipboard_source[\s\S]*--solid-native-clipboard-restore/u,
  );
  assert.match(
    runner,
    /Could not relaunch the clipboard source[\s\S]*preserving the helper installation for recovery/u,
  );
  assert.match(runner, /codesign --verify --deep --strict "\$APP_PATH"/u);
  assert.match(
    runner,
    /codesign --verify --deep --strict "\$SOURCE_APP_PATH"/u,
  );
  assert.match(
    runner,
    /codesign --verify --deep --strict "\$TEST_BUNDLE_PATH"/u,
  );
  assert.equal(
    manifest.scripts["ios:clipboard:test"],
    "sh scripts/ios-clipboard-test.sh",
  );
});
