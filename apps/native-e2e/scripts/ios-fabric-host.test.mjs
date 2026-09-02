import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("physical framework-free iOS Fabric Host proof keeps its layers aligned", async () => {
  const [application, automation, runner, manifest] = await Promise.all([
    readFile(new URL("fabric-host.ts", directory), "utf8"),
    readFile(
      new URL(
        "ios/SolidNativeE2EUITests/SolidNativeNetworkingUITests.swift",
        directory,
      ),
      "utf8",
    ),
    readFile(new URL("scripts/ios-fabric-host-test.sh", directory), "utf8"),
    readFile(new URL("package.json", directory), "utf8").then(JSON.parse),
  ]);

  for (const value of [
    "Framework-free Fabric Host",
    "Fabric Host mounted without a framework renderer",
    "Physical press updated Fabric through NativeHost",
    "Update framework-free Fabric tree",
    "Dispose framework-free Fabric tree",
  ]) {
    assert.ok(application.includes(value), `Application is missing ${value}.`);
    assert.ok(automation.includes(value), `XCTest is missing ${value}.`);
  }
  assert.match(
    application,
    /host\.platform === "android" \|\| host\.platform === "ios"/u,
  );
  assert.match(application, /await waitForNativeSurface\(/u);
  assert.doesNotMatch(application, /async function waitForSurface/u);
  assert.match(
    automation,
    /func testFrameworkFreeFabricHostOnPhysicalDevice\(\)/u,
  );
  assert.match(runner, /ENTRY_FILE=fabric-host\.ts/u);
  assert.match(runner, /configuration Release/u);
  assert.match(runner, /verify-framework-free-fabric-host-sourcemap\.mjs/u);
  assert.doesNotMatch(runner, /verify-solid-runtime-sourcemap\.mjs/u);
  assert.match(runner, /start_solid_native_ios_process_guard/u);
  assert.match(runner, /node "\$APP_DIR\/scripts\/ios-device-preflight\.mjs"/u);
  assert.match(runner, /node "\$APP_DIR\/scripts\/ios-host-preflight\.mjs"/u);
  assert.match(runner, /SOLID_NATIVE_IOS_FABRIC_HOST_UNLOCK_WAIT_SECONDS/u);
  assert.match(runner, /--wait-seconds "\$UNLOCK_WAIT_SECONDS"/u);
  assert.match(runner, /Refusing to replace an installed iOS application/u);
  assert.match(runner, /PlistBuddy[\s\S]*CFBundleIdentifier/u);
  assert.match(runner, /codesign --verify --deep --strict "\$APP_PATH"/u);
  assert.match(
    runner,
    /codesign --verify --deep --strict "\$TEST_BUNDLE_PATH"/u,
  );
  assert.match(runner, /SOLID_NATIVE_FABRIC_HOST_FRAME_SUCCEEDED/u);
  assert.match(runner, /device uninstall app/u);
  assert.match(runner, /The disposable iOS framework-free Fabric Host/u);
  assert.equal(
    manifest.scripts["ios:fabric-host:test"],
    "sh scripts/ios-fabric-host-test.sh",
  );
});
