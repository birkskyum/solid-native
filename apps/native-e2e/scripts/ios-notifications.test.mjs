import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("physical iOS notification proof keeps its cross-layer contract aligned", async () => {
  const [application, automation, runner, manifest] = await Promise.all([
    readFile(new URL("notifications.tsx", directory), "utf8"),
    readFile(
      new URL(
        "ios/SolidNativeE2EUITests/SolidNativeE2EUITests.swift",
        directory,
      ),
      "utf8",
    ),
    readFile(new URL("scripts/ios-notifications-test.sh", directory), "utf8"),
    readFile(new URL("package.json", directory), "utf8").then(JSON.parse),
  ]);

  for (const value of [
    "Solid Native notifications ready",
    "Authorize local notifications",
    "Native notification permission authorized",
    "Display local native notification",
    "Native notification delivery observed",
    "Cancel local native notification",
    "Native notification cancelled",
    "Dispose Solid Native notification proof",
  ]) {
    assert.ok(application.includes(value), `Application is missing ${value}.`);
    assert.ok(automation.includes(value), `XCTest is missing ${value}.`);
  }
  assert.match(
    application,
    /createGeneratedNotifyKitNotificationService[\s\S]*platform\.notification\.delivered[\s\S]*NOTIFICATION_COMPUTATION_NAME/u,
  );
  assert.match(application, /createNotificationEvent\(service/u);
  assert.match(
    application,
    /PERMITTED_EVENT_ATTRIBUTES[\s\S]*PERMITTED_COMPUTATION_ATTRIBUTES[\s\S]*PERMITTED_OWNER_ATTRIBUTES[\s\S]*operation\.causes\.length !== 3[\s\S]*getDisplayedNotificationIds/u,
  );
  assert.match(
    automation,
    /func testNativeNotificationDeliveryCancellationAndTeardownOnPhysicalDevice\(\) throws[\s\S]*com\.apple\.springboard[\s\S]*Authorize local notifications[\s\S]*buttons\["Allow"\][\s\S]*Native notification permission authorized[\s\S]*Display local native notification[\s\S]*Native notification delivery observed[\s\S]*Cancel local native notification/u,
  );
  assert.match(runner, /ENTRY_FILE=notifications\.tsx/u);
  assert.match(runner, /clean build-for-testing/u);
  assert.match(runner, /test-without-building/u);
  assert.match(runner, /start_solid_native_ios_process_guard/u);
  assert.match(runner, /ios-device-preflight\.mjs/u);
  assert.match(runner, /verify-solid-runtime-sourcemap\.mjs/u);
  assert.match(runner, /verify-notifications-sourcemap\.mjs/u);
  assert.match(runner, /device uninstall app/u);
  assert.match(runner, /codesign --verify --deep --strict "\$APP_PATH"/u);
  assert.match(
    runner,
    /codesign --verify --deep --strict "\$TEST_BUNDLE_PATH"/u,
  );
  assert.equal(
    manifest.scripts["ios:notifications:test"],
    "sh scripts/ios-notifications-test.sh",
  );
});
