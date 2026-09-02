import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("physical iOS safe-area proof keeps its cross-layer contract aligned", async () => {
  const [application, automation, runner, infoPlist, manifest] =
    await Promise.all([
      readFile(new URL("safe-area.tsx", directory), "utf8"),
      readFile(
        new URL(
          "ios/SolidNativeE2EUITests/SolidNativeE2EUITests.swift",
          directory,
        ),
        "utf8",
      ),
      readFile(new URL("scripts/ios-safe-area-test.sh", directory), "utf8"),
      readFile(new URL("ios/SolidNativeE2E/Info.plist", directory), "utf8"),
      readFile(new URL("package.json", directory), "utf8").then(JSON.parse),
    ]);

  for (const value of [
    "Solid Native safe area ready",
    "Solid Native safe area top anchor",
    "Solid Native safe area bottom anchor",
    "Commit native safe-area change",
    "Dispose Solid Native safe area proof",
  ]) {
    assert.ok(application.includes(value), `Application is missing ${value}.`);
    assert.ok(automation.includes(value), `XCTest is missing ${value}.`);
  }
  assert.equal(
    manifest.dependencies["react-native-safe-area-context"],
    "5.8.1",
  );
  assert.equal(
    manifest.scripts["ios:safe-area:test"],
    "sh scripts/ios-safe-area-test.sh",
  );
  assert.match(application, /<SafeAreaProvider/u);
  assert.match(application, /<SafeAreaView/u);
  assert.match(application, /useSafeAreaInsets\(\)/u);
  assert.match(application, /useSafeAreaFrame\(\)/u);
  assert.match(
    application,
    /CausalComputation name=\{METRICS_COMPUTATION_NAME\}/u,
  );
  assert.match(
    application,
    /attributes\["event\.name"\] === "insetsChange"[\s\S]*METRICS_COMPUTATION_NAME[\s\S]*SOLID_NATIVE_SAFE_AREA_CAUSALITY_SUCCEEDED/u,
  );
  assert.match(
    automation,
    /func testSafeAreaDeliveryAndRotationOnPhysicalDevice\(\)[\s\S]*topAnchor\.frame\.minY[\s\S]*portraitMetrics\.top/u,
  );
  assert.match(
    automation,
    /func testSafeAreaDeliveryAndRotationOnPhysicalDevice\(\)[\s\S]*bottomAnchor\.frame\.maxY[\s\S]*portraitMetrics\.bottom/u,
  );
  assert.match(
    automation,
    /device\.orientation = \.landscapeLeft[\s\S]*requireMetrics\([\s\S]*portrait: false[\s\S]*landscapeMetrics\.left \+ landscapeMetrics\.right/u,
  );
  assert.match(runner, /ENTRY_FILE=safe-area\.tsx/u);
  assert.match(runner, /clean build-for-testing/u);
  assert.match(runner, /test-without-building/u);
  assert.match(runner, /start_solid_native_ios_process_guard/u);
  assert.match(runner, /ios-device-preflight\.mjs/u);
  assert.match(runner, /verify-solid-runtime-sourcemap\.mjs/u);
  assert.match(runner, /PlistBuddy[\s\S]*CFBundleIdentifier/u);
  assert.match(runner, /codesign --verify --deep --strict "\$APP_PATH"/u);
  assert.match(
    runner,
    /codesign --verify --deep --strict "\$TEST_BUNDLE_PATH"/u,
  );
  assert.match(runner, /SOLID_NATIVE_SAFE_AREA_CAUSALITY_SUCCEEDED/u);
  assert.match(infoPlist, /UIInterfaceOrientationLandscapeLeft/u);
  assert.match(infoPlist, /UIInterfaceOrientationLandscapeRight/u);
  assert.ok(
    runner.indexOf("ios-device-preflight.mjs") < runner.indexOf("xcodebuild"),
  );
});
