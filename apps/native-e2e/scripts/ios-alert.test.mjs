import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("physical iOS alert proof keeps its cross-layer contract aligned", async () => {
  const [application, automation, runner, manifest] = await Promise.all([
    readFile(new URL("alert.tsx", directory), "utf8"),
    readFile(
      new URL(
        "ios/SolidNativeE2EUITests/SolidNativeE2EUITests.swift",
        directory,
      ),
      "utf8",
    ),
    readFile(new URL("scripts/ios-alert-test.sh", directory), "utf8"),
    readFile(new URL("package.json", directory), "utf8").then(JSON.parse),
  ]);

  for (const value of [
    "Solid Native alert ready",
    "Show destructive native alert",
    "Delete local draft?",
    "Delete",
    "Alert result: delete",
    "Show cancellable native alert",
    "Dismiss this alert",
    "Select Cancel to settle through UIKit.",
    "Alert result: cancel",
    "Dispose Solid Native alert proof",
  ]) {
    assert.ok(application.includes(value), `Application is missing ${value}.`);
    assert.ok(automation.includes(value), `XCTest is missing ${value}.`);
  }
  assert.match(
    application,
    /ALERT_COMPUTATION_NAME[\s\S]*PERMITTED_EVENT_ATTRIBUTES[\s\S]*PERMITTED_COMPUTATION_ATTRIBUTES/u,
  );
  assert.match(
    automation,
    /func testNativeAlertButtonCancellationAndTeardownOnPhysicalDevice\(\)[\s\S]*application\.alerts\["Delete local draft\?"\][\s\S]*buttons\["Delete"\][\s\S]*application\.alerts\["Dismiss this alert"\][\s\S]*buttons\["Cancel"\]/u,
  );
  assert.match(runner, /ENTRY_FILE=alert\.tsx/u);
  assert.match(runner, /clean build-for-testing/u);
  assert.match(runner, /test-without-building/u);
  assert.match(runner, /start_solid_native_ios_process_guard/u);
  assert.match(runner, /ios-device-preflight\.mjs/u);
  assert.match(runner, /verify-solid-runtime-sourcemap\.mjs/u);
  assert.match(runner, /verify-alert-sourcemap\.mjs/u);
  assert.match(runner, /codesign --verify --deep --strict "\$APP_PATH"/u);
  assert.match(
    runner,
    /codesign --verify --deep --strict "\$TEST_BUNDLE_PATH"/u,
  );
  assert.equal(
    manifest.scripts["ios:alert:test"],
    "sh scripts/ios-alert-test.sh",
  );
});
