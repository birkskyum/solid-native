import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("physical iOS sharing proof keeps its cross-layer contract aligned", async () => {
  const [application, automation, runner, manifest] = await Promise.all([
    readFile(new URL("sharing.tsx", directory), "utf8"),
    readFile(
      new URL(
        "ios/SolidNativeE2EUITests/SolidNativeE2EUITests.swift",
        directory,
      ),
      "utf8",
    ),
    readFile(new URL("scripts/ios-sharing-test.sh", directory), "utf8"),
    readFile(new URL("package.json", directory), "utf8").then(JSON.parse),
  ]);

  for (const value of [
    "Solid Native sharing ready",
    "Share message and URL",
    "Share URL only",
    "Combined share result: completed",
    "URL-only share result: dismissed",
    "Dispose Solid Native sharing proof",
  ]) {
    assert.ok(application.includes(value), `Application is missing ${value}.`);
    assert.ok(automation.includes(value), `XCTest is missing ${value}.`);
  }
  assert.match(
    application,
    /service\.platform === "ios" \? "completed" : "presented"/u,
  );
  assert.match(
    application,
    /service\.platform === "ios" \? "dismissed" : "presented"/u,
  );
  assert.match(
    application,
    /operation\?\.causes\.includes\(record\.operationId\)[\s\S]*SHARE_COMPUTATION_NAME[\s\S]*PERMITTED_EVENT_ATTRIBUTES[\s\S]*PERMITTED_COMPUTATION_ATTRIBUTES/u,
  );
  assert.match(
    automation,
    /func testNativeShareSheetCompletionDismissalAndTeardownOnPhysicalDevice\(\)[\s\S]*application\.popovers\.firstMatch[\s\S]*sharePopover\.cells\["Copy"\][\s\S]*application\.otherElements\["PopoverDismissRegion"\][\s\S]*urlPopover\.swipeDown\(\)/u,
  );
  assert.match(runner, /ENTRY_FILE=sharing\.tsx/u);
  assert.match(runner, /clean build-for-testing/u);
  assert.match(runner, /test-without-building/u);
  assert.match(runner, /start_solid_native_ios_process_guard/u);
  assert.match(runner, /ios-device-preflight\.mjs/u);
  assert.match(runner, /verify-solid-runtime-sourcemap\.mjs/u);
  assert.match(runner, /verify-sharing-sourcemap\.mjs/u);
  assert.match(runner, /codesign --verify --deep --strict "\$APP_PATH"/u);
  assert.match(
    runner,
    /codesign --verify --deep --strict "\$TEST_BUNDLE_PATH"/u,
  );
  assert.equal(
    manifest.scripts["ios:sharing:test"],
    "sh scripts/ios-sharing-test.sh",
  );
});
