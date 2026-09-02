import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("physical iOS pull-to-refresh keeps its cross-layer contract aligned", async () => {
  const [application, automation, runner, manifest] = await Promise.all([
    readFile(new URL("refreshable-scroll-view.tsx", directory), "utf8"),
    readFile(
      new URL(
        "ios/SolidNativeE2EUITests/SolidNativeE2EUITests.swift",
        directory,
      ),
      "utf8",
    ),
    readFile(
      new URL("scripts/ios-refreshable-scroll-view-test.sh", directory),
      "utf8",
    ),
    readFile(new URL("package.json", directory), "utf8").then(JSON.parse),
  ]);

  assert.match(
    application,
    /binding\.platform === "android" \|\| binding\.platform === "ios"/u,
  );
  assert.match(application, /testID="solid-native-refreshable-scroll-view"/u);
  assert.match(application, /testID="solid-native-refresh-status"/u);
  assert.match(application, /backingScrollView === retainedBackingScrollView/u);
  for (const value of [
    "Solid Native pull to refresh ready",
    "Rejected native refresh 1",
    "Accepted native refresh 2",
    "Completed native refresh 2",
    "Dispose Solid Native pull to refresh proof",
  ]) {
    assert.ok(application.includes(value), `Application is missing ${value}.`);
  }
  for (const value of [
    "Solid Native pull to refresh ready",
    "Rejected native refresh 1",
    "Completed native refresh 2",
    "Dispose Solid Native pull to refresh proof",
  ]) {
    assert.ok(automation.includes(value), `XCTest is missing ${value}.`);
  }

  assert.match(automation, /testRefreshableScrollViewOnPhysicalDevice/u);
  assert.match(automation, /application\.scrollViews\.firstMatch/u);
  assert.match(
    automation,
    /XCTAssertEqual\(application\.scrollViews\.count, 1\)/u,
  );
  assert.match(automation, /func pullToRefresh\(\)/u);
  assert.match(automation, /pullToRefresh\(\)[\s\S]*pullToRefresh\(\)/u);
  assert.match(automation, /thenDragTo: dragEnd/u);
  assert.match(automation, /transient accepted label is sealed/u);
  assert.match(
    automation,
    /XCTAssertEqual\(scrollView\.frame, retainedFrame\)/u,
  );
  assert.match(runner, /ENTRY_FILE=refreshable-scroll-view\.tsx/u);
  assert.match(
    runner,
    /SOLID_NATIVE_IOS_REFRESH_BUNDLE_ID:-dev\.solidnative\.e2e/u,
  );
  assert.match(runner, /SOURCEMAP_FILE=/u);
  assert.match(runner, /testRefreshableScrollViewOnPhysicalDevice/u);
  assert.match(runner, /start_solid_native_ios_process_guard/u);
  assert.match(runner, /clean build-for-testing/u);
  assert.match(runner, /codesign --verify --deep --strict/u);
  assert.match(runner, /test-without-building/u);
  assert.match(runner, /verify-solid-runtime-sourcemap\.mjs/u);
  assert.match(runner, /verify-refreshable-scroll-view-sourcemap\.mjs/u);
  assert.match(runner, /SOLID_NATIVE_REFRESHABLE_SCROLL_IDENTITY_SUCCEEDED/u);
  assert.match(runner, /SOLID_NATIVE_REFRESHABLE_SCROLL_TEARDOWN_SUCCEEDED/u);
  assert.equal(
    manifest.scripts["ios:refresh:test"],
    "sh scripts/ios-refreshable-scroll-view-test.sh",
  );
});
