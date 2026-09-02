import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("physical iOS localization proof keeps its cross-layer contract aligned", async () => {
  const [application, automation, runner, infoPlist, manifest] =
    await Promise.all([
      readFile(new URL("localization.tsx", directory), "utf8"),
      readFile(
        new URL(
          "ios/SolidNativeE2EUITests/SolidNativeE2EUITests.swift",
          directory,
        ),
        "utf8",
      ),
      readFile(new URL("scripts/ios-localization-test.sh", directory), "utf8"),
      readFile(new URL("ios/SolidNativeE2E/Info.plist", directory), "utf8"),
      readFile(new URL("package.json", directory), "utf8").then(JSON.parse),
    ]);

  for (const value of [
    "Solid Native localization ready",
    "Localization leading marker",
    "Localization trailing marker",
    "Dispose Solid Native localization proof",
    "Locale ${localization.localeTag}",
    "Direction ${localization.layoutDirection}",
  ]) {
    assert.ok(application.includes(value), `Application is missing ${value}.`);
  }
  assert.match(
    automation,
    /func testNativeLocalizationStartupSnapshotsAndPhysicalLayoutOnPhysicalDevice\(\)[\s\S]*-AppleLanguages[\s\S]*-AppleLocale[\s\S]*languageTag: "en-US"[\s\S]*localeIdentifier: "en_US"[\s\S]*expectedDirection: "ltr"[\s\S]*leadingShouldBeLeft: true[\s\S]*languageTag: "ar-SA"[\s\S]*localeIdentifier: "ar_SA"[\s\S]*expectedDirection: "rtl"[\s\S]*leadingShouldBeLeft: false/u,
  );
  assert.match(
    automation,
    /leading\.frame\.midX[\s\S]*trailing\.frame\.midX[\s\S]*XCTAssertLessThan[\s\S]*XCTAssertGreaterThan/u,
  );
  assert.match(
    infoPlist,
    /CFBundleLocalizations[\s\S]*<string>en<\/string>[\s\S]*<string>ar<\/string>/u,
  );
  assert.match(runner, /ENTRY_FILE=localization\.tsx/u);
  assert.match(runner, /clean build-for-testing/u);
  assert.match(runner, /test-without-building/u);
  assert.match(runner, /start_solid_native_ios_process_guard/u);
  assert.match(runner, /ios-device-preflight\.mjs/u);
  assert.match(runner, /verify-solid-runtime-sourcemap\.mjs/u);
  assert.match(runner, /verify-localization-sourcemap\.mjs/u);
  assert.match(runner, /codesign --verify --deep --strict "\$APP_PATH"/u);
  assert.match(
    runner,
    /SOLID_NATIVE_LOCALIZATION_READY', 'en-US', 'ltr', true[\s\S]*SOLID_NATIVE_LOCALIZATION_READY', 'ar-SA', 'rtl', true/u,
  );
  assert.doesNotMatch(
    runner,
    /defaults write|AppleLanguages.*device|set-device-locale/u,
  );
  assert.match(runner, /device uninstall app[\s\S]*INSTALL_ATTEMPTED=0/u);
  assert.equal(
    manifest.scripts["ios:localization:test"],
    "sh scripts/ios-localization-test.sh",
  );
});
