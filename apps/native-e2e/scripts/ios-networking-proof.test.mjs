import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createIOSNetworkingProofOrigin } from "./ios-networking-proof.mjs";

const directory = new URL("../", import.meta.url);

test("creates only bounded tokenized Mac-local iOS proof origins", () => {
  assert.equal(
    createIOSNetworkingProofOrigin(
      "MacBook-Pro",
      49_152,
      "/0123456789abcdef0123456789abcdef0123",
    ),
    "http://macbook-pro.local:49152/0123456789abcdef0123456789abcdef0123",
  );
  assert.equal(
    createIOSNetworkingProofOrigin(
      "192.168.1.145",
      49_152,
      "/0123456789abcdef0123456789abcdef0123",
    ),
    "http://192.168.1.145:49152/0123456789abcdef0123456789abcdef0123",
  );
  assert.throws(
    () =>
      createIOSNetworkingProofOrigin(
        "nested.host",
        49_152,
        "/0123456789abcdef0123456789abcdef0123",
      ),
    /local address/u,
  );
  assert.throws(
    () =>
      createIOSNetworkingProofOrigin(
        "8.8.8.8",
        49_152,
        "/0123456789abcdef0123456789abcdef0123",
      ),
    /local address/u,
  );
  assert.throws(
    () =>
      createIOSNetworkingProofOrigin(
        "127.0.0.1",
        49_152,
        "/0123456789abcdef0123456789abcdef0123",
      ),
    /local address/u,
  );
  assert.throws(
    () =>
      createIOSNetworkingProofOrigin(
        "MacBook-Pro",
        80,
        "/0123456789abcdef0123456789abcdef0123",
      ),
    /non-privileged/u,
  );
  assert.throws(
    () => createIOSNetworkingProofOrigin("MacBook-Pro", 49_152, "/short"),
    /144-bit/u,
  );
});

test("keeps the physical iOS networking proof cross-layer complete", async () => {
  const [
    application,
    automation,
    orchestrator,
    runner,
    project,
    testInfo,
    info,
    manifest,
  ] = await Promise.all([
    readFile(new URL("networking.tsx", directory), "utf8"),
    readFile(
      new URL(
        "ios/SolidNativeE2EUITests/SolidNativeNetworkingUITests.swift",
        directory,
      ),
      "utf8",
    ),
    readFile(new URL("scripts/ios-networking-proof.mjs", directory), "utf8"),
    readFile(new URL("scripts/ios-networking-test.sh", directory), "utf8"),
    readFile(
      new URL("ios/SolidNativeE2E.xcodeproj/project.pbxproj", directory),
      "utf8",
    ),
    readFile(
      new URL("ios/SolidNativeE2EUITests/Info.plist", directory),
      "utf8",
    ),
    readFile(new URL("ios/SolidNativeE2E/Info.plist", directory), "utf8"),
    readFile(new URL("package.json", directory), "utf8"),
  ]);

  assert.match(application, /getReactNativePlatformServices/u);
  assert.match(application, /getInitialURL\(\)/u);
  assert.match(
    application,
    /dev\.solidnative\.networking:\/\/networking\/proof/u,
  );
  assert.match(application, /IOS_LOCAL_HOST\.test\(origin\.hostname\)/u);
  assert.match(application, /isPrivateIPv4Address\(origin\.hostname\)/u);
  assert.match(application, /IOS_RUN_PATH\.test\(origin\.pathname\)/u);
  assert.match(application, /deviceServerOrigin/u);
  assert.doesNotMatch(application, /const DEVICE_SERVER_ORIGIN/u);

  assert.match(automation, /SolidNativeNetworkingOrigin/u);
  assert.match(automation, /application\.open\(proofURL\)/u);
  assert.match(
    automation,
    /application\.alerts\.firstMatch[\s\S]*localNetworkAlert\.buttons\["Allow"\]/u,
  );
  assert.doesNotMatch(
    automation,
    /XCUIApplication\(bundleIdentifier: "com\.apple\.springboard"\)/u,
  );
  for (const label of [
    "Solid Native networking ready",
    "Run native networking protocol proof",
    "Networking proof complete (2 SSE events, JSON 2, failure, cancellation)",
    "Start owner-disposal network request",
    "Owner-disposal request active",
    "Dispose active networking owner",
  ]) {
    assert.ok(application.includes(label), label);
    assert.ok(automation.includes(label), label);
  }

  assert.match(orchestrator, /randomBytes\(18\)/u);
  assert.match(orchestrator, /host: "0\.0\.0\.0"/u);
  assert.match(orchestrator, /SOLID_NATIVE_IOS_NETWORKING_ORIGIN/u);
  assert.match(orchestrator, /SOLID_NATIVE_IOS_NETWORKING_HOST/u);
  assert.match(orchestrator, /assertNetworkingServerEvidence/u);
  assert.match(orchestrator, /summarizeNetworkingServerEvidence/u);
  assert.match(runner, /ENTRY_FILE=networking\.tsx/u);
  assert.match(runner, /SOLID_NATIVE_NETWORKING_ORIGIN=/u);
  assert.match(runner, /SOURCEMAP_FILE=/u);
  assert.match(runner, /clean build-for-testing/u);
  assert.match(runner, /test-without-building/u);
  assert.match(runner, /Privacy-safe iOS Networking ABI diagnostic/u);
  assert.match(runner, /tuple must contain two or three elements/u);
  assert.match(runner, /timeout flag has unsupported kind/u);
  assert.match(runner, /verify-networking-sourcemap\.mjs/u);
  assert.match(runner, /codesign --verify --deep --strict "\$APP_PATH"/u);
  assert.match(
    runner,
    /codesign --verify --deep --strict "\$TEST_BUNDLE_PATH"/u,
  );
  assert.match(runner, /device uninstall app[\s\S]*INSTALL_ATTEMPTED=0/u);
  assert.match(
    runner,
    /testNativeNetworkingProtocolsAndOwnerTeardownOnPhysicalDevice/u,
  );
  assert.match(runner, /SOLID_NATIVE_NETWORKING_TEARDOWN_SUCCEEDED/u);

  assert.match(project, /SolidNativeNetworkingUITests\.swift in Sources/u);
  assert.match(project, /INFOPLIST_FILE = SolidNativeE2EUITests\/Info\.plist/u);
  assert.match(
    testInfo,
    /<key>SolidNativeNetworkingOrigin<\/key>\s*<string>\$\(SOLID_NATIVE_NETWORKING_ORIGIN\)<\/string>/u,
  );
  assert.match(info, /NSAllowsArbitraryLoads<\/key>\s*<false\/>/u);
  assert.match(info, /NSAllowsLocalNetworking<\/key>\s*<true\/>/u);
  assert.match(info, /NSLocalNetworkUsageDescription/u);
  assert.match(manifest, /"ios:networking:test"/u);
});
