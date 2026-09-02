import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("physical iOS Linking proof keeps its cross-layer contract aligned", async () => {
  const [application, appDelegate, automation, runner, infoPlist, manifest] =
    await Promise.all([
      readFile(new URL("linking.tsx", directory), "utf8"),
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
      readFile(new URL("scripts/ios-linking-test.sh", directory), "utf8"),
      readFile(new URL("ios/SolidNativeE2E/Info.plist", directory), "utf8"),
      readFile(new URL("package.json", directory), "utf8").then(JSON.parse),
    ]);

  assert.ok(
    application.includes(
      "dev.solidnative.linking://navigation/outbound-link-proof",
    ),
    "Application is missing the isolated iOS proof URL.",
  );
  for (const value of [
    "Solid Native linking ready",
    "Native URL delivery: waiting",
    "Native URL delivery: received",
    "Open registered application URL",
    "Commit native URL delivery",
    "Open application settings",
    "Dispose Solid Native linking proof",
  ]) {
    assert.ok(application.includes(value), `Application is missing ${value}.`);
    assert.ok(automation.includes(value), `XCTest is missing ${value}.`);
  }
  assert.match(
    application,
    /platform\.platform === "ios" \? IOS_SELF_URL : ANDROID_SELF_URL/u,
  );
  assert.match(
    application,
    /platform\.canOpenURL\(SELF_URL\)[\s\S]*platform\.openURL\(SELF_URL\)/u,
  );
  assert.match(
    application,
    /createNativeEventAccessor<NativeURLEvent, boolean>[\s\S]*name: "platform\.url\.open"[\s\S]*event\.url === SELF_URL/u,
  );
  assert.match(
    appDelegate,
    /RCTLinkingManager\.application\(application, open: url, options: options\)/u,
  );
  assert.match(infoPlist, /CFBundleURLTypes/u);
  assert.match(infoPlist, /LSApplicationQueriesSchemes/u);
  assert.match(
    automation,
    /func testOutboundApplicationURLAndSettingsHandoffsOnPhysicalDevice\(\)[\s\S]*XCUIApplication\(bundleIdentifier: "com\.apple\.Preferences"\)[\s\S]*application\.activate\(\)/u,
  );
  assert.match(
    automation,
    /Native URL delivery: received[\s\S]*Solid Native E2E[\s\S]*Native URL delivery: received/u,
  );
  assert.match(runner, /ENTRY_FILE=linking\.tsx/u);
  assert.match(runner, /clean build-for-testing/u);
  assert.match(runner, /test-without-building/u);
  assert.match(runner, /start_solid_native_ios_process_guard/u);
  assert.match(runner, /ios-device-preflight\.mjs/u);
  assert.match(runner, /verify-solid-runtime-sourcemap\.mjs/u);
  assert.match(runner, /verify-linking-sourcemap\.mjs/u);
  assert.match(runner, /CFBundleURLTypes:0:CFBundleURLSchemes:0/u);
  assert.match(runner, /LSApplicationQueriesSchemes:0/u);
  assert.match(runner, /codesign --verify --deep --strict "\$APP_PATH"/u);
  assert.match(
    runner,
    /codesign --verify --deep --strict "\$TEST_BUNDLE_PATH"/u,
  );
  assert.equal(
    manifest.scripts["ios:linking:test"],
    "sh scripts/ios-linking-test.sh",
  );
});
