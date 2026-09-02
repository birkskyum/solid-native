import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  isResourceRecordingStarted,
  isTransientResourceRecordingStartFailure,
  readIosReloadConfiguration,
  waitForPromiseWithin,
} from "./ios-reload-soak.mjs";

test("cancels a process timeout when the process settles first", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timeoutHandle = Object.freeze({ timeout: true });
  let scheduledMilliseconds;
  let clearedHandle;
  globalThis.setTimeout = (_callback, milliseconds) => {
    scheduledMilliseconds = milliseconds;
    return timeoutHandle;
  };
  globalThis.clearTimeout = (handle) => {
    clearedHandle = handle;
  };
  try {
    assert.equal(
      await waitForPromiseWithin(Promise.resolve("settled"), 120_000),
      "settled",
    );
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
  assert.equal(scheduledMilliseconds, 120_000);
  assert.equal(clearedHandle, timeoutHandle);
});

test("accepts only known xctrace recording acknowledgements", () => {
  assert.equal(isResourceRecordingStarted("Recording started"), true);
  assert.equal(
    isResourceRecordingStarted(
      "Starting recording with the Activity Monitor template. Attaching to: Solid Native E2E (16442).",
    ),
    true,
  );
  assert.equal(isResourceRecordingStarted("Starting recording"), false);
  assert.equal(
    isTransientResourceRecordingStartFailure(
      "Cannot find process for provided pid: 16466\n",
    ),
    true,
  );
  assert.equal(
    isTransientResourceRecordingStartFailure(
      "Cannot find process for provided pid: not-a-pid",
    ),
    false,
  );
  assert.equal(
    isTransientResourceRecordingStartFailure("Permission denied"),
    false,
  );
});

test("accepts a bounded explicit physical-iOS reload configuration", () => {
  assert.deepEqual(
    readIosReloadConfiguration({
      SOLID_NATIVE_IOS_DESTINATION: "CORE-DEVICE-ID",
      SOLID_NATIVE_IOS_RELOAD_DERIVED_DATA: "/tmp/solid-native-ios-reload",
      SOLID_NATIVE_IOS_RELOAD_BUNDLE_ID: "dev.solidnative.reload",
      SOLID_NATIVE_IOS_RELOAD_CYCLES: "7",
      SOLID_NATIVE_IOS_RELOAD_DEVICE_MODEL: "iPhone 17 Pro",
      SOLID_NATIVE_IOS_RELOAD_METRO_HOST: "192.168.1.87",
      SOLID_NATIVE_IOS_RELOAD_METRO_PORT: "8192",
      SOLID_NATIVE_IOS_RELOAD_OS_VERSION: "26.6",
      SOLID_NATIVE_IOS_RELOAD_TRACE_DEVICE: "00008150-001155E01191401C",
      SOLID_NATIVE_IOS_RELOAD_TRACE_TIMEOUT_SECONDS: "240",
      SOLID_NATIVE_IOS_RELOAD_TIMEOUT_MS: "45000",
      SOLID_NATIVE_IOS_TEAM: "ABCDE12345",
    }),
    {
      bundleIdentifier: "dev.solidnative.reload",
      cycles: 7,
      device: "CORE-DEVICE-ID",
      derivedDataPath: "/tmp/solid-native-ios-reload",
      developmentTeam: "ABCDE12345",
      deviceModel: "iPhone 17 Pro",
      metroHost: "192.168.1.87",
      metroPort: 8_192,
      mode: "metro",
      osVersion: "26.6",
      reloadTimeoutMs: 45_000,
      traceDevice: "00008150-001155E01191401C",
      traceTimeoutSeconds: 240,
    },
  );

  const bundled = readIosReloadConfiguration({
    SOLID_NATIVE_IOS_DESTINATION: "CORE-DEVICE-ID",
    SOLID_NATIVE_IOS_RELOAD_DERIVED_DATA: "/tmp/solid-native-ios-reload",
    SOLID_NATIVE_IOS_RELOAD_BUNDLE_ID: "dev.solidnative.reload",
    SOLID_NATIVE_IOS_RELOAD_DEVICE_MODEL: "iPhone 17 Pro",
    SOLID_NATIVE_IOS_RELOAD_MODE: "bundled",
    SOLID_NATIVE_IOS_RELOAD_OS_VERSION: "26.6",
    SOLID_NATIVE_IOS_RELOAD_TRACE_DEVICE: "00008150-001155E01191401C",
    SOLID_NATIVE_IOS_TEAM: "ABCDE12345",
  });
  assert.equal(bundled.mode, "bundled");
  assert.equal(bundled.metroHost, undefined);
});

test("rejects unbounded or unprintable physical-iOS reload inputs", () => {
  const base = {
    SOLID_NATIVE_IOS_DESTINATION: "CORE-DEVICE-ID",
    SOLID_NATIVE_IOS_RELOAD_DERIVED_DATA: "/tmp/solid-native-ios-reload",
    SOLID_NATIVE_IOS_RELOAD_BUNDLE_ID: "dev.solidnative.reload",
    SOLID_NATIVE_IOS_RELOAD_DEVICE_MODEL: "iPhone 17 Pro",
    SOLID_NATIVE_IOS_RELOAD_METRO_HOST: "192.168.1.87",
    SOLID_NATIVE_IOS_RELOAD_OS_VERSION: "26.6",
    SOLID_NATIVE_IOS_RELOAD_TRACE_DEVICE: "00008150-001155E01191401C",
    SOLID_NATIVE_IOS_TEAM: "ABCDE12345",
  };
  for (const environment of [
    { ...base, SOLID_NATIVE_IOS_RELOAD_CYCLES: "0" },
    { ...base, SOLID_NATIVE_IOS_RELOAD_CYCLES: "101" },
    { ...base, SOLID_NATIVE_IOS_RELOAD_TIMEOUT_MS: "999" },
    { ...base, SOLID_NATIVE_IOS_RELOAD_METRO_HOST: "host/path" },
    { ...base, SOLID_NATIVE_IOS_RELOAD_MODE: "unknown" },
    { ...base, SOLID_NATIVE_IOS_RELOAD_METRO_PORT: "80" },
    { ...base, SOLID_NATIVE_IOS_RELOAD_TRACE_DEVICE: "BAD DEVICE" },
    { ...base, SOLID_NATIVE_IOS_RELOAD_TRACE_TIMEOUT_SECONDS: "10" },
    { ...base, SOLID_NATIVE_IOS_TEAM: "BAD TEAM" },
    { ...base, SOLID_NATIVE_IOS_DESTINATION: "BAD\nDEVICE" },
    { ...base, SOLID_NATIVE_IOS_DESTINATION: "BAD DEVICE" },
    { ...base, SOLID_NATIVE_IOS_RELOAD_BUNDLE_ID: "" },
    { ...base, SOLID_NATIVE_IOS_RELOAD_BUNDLE_ID: "not-a-bundle" },
  ]) {
    assert.throws(
      () => readIosReloadConfiguration(environment),
      /bounded printable|safe integer|dotted bundle|whitespace|IPv4 address|alphanumeric|either metro/u,
    );
  }
});

test("cleans the app and both host processes before publishing iOS reload success", async () => {
  const source = await readFile(
    new URL("./ios-reload-soak.mjs", import.meta.url),
    "utf8",
  );
  const resultMarker = source.lastIndexOf("SOLID_NATIVE_IOS_RELOAD_RESULT");
  assert.ok(resultMarker > 0);
  const cleanupIndex = source.lastIndexOf("await cleanup();", resultMarker);
  assert.ok(cleanupIndex >= 0 && cleanupIndex < resultMarker);
  for (const cleanup of [
    "stopNativeIosApplicationProcesses",
    "await stopChild(consoleProcess);",
    "await stopChild(permissionPreflight);",
    "await stopChild(metro);",
  ]) {
    assert.match(source, new RegExp(cleanup.replace(/[()]/gu, "\\$&"), "u"));
  }
});

test("selects the reload-only Metro root without changing normal iOS launches", async () => {
  const [appDelegate, automation, runner, testInfo] = await Promise.all([
    readFile(
      new URL("../ios/SolidNativeE2E/AppDelegate.swift", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../ios/SolidNativeE2EUITests/SolidNativeNetworkingUITests.swift",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("./ios-reload-soak.sh", import.meta.url), "utf8"),
    readFile(
      new URL("../ios/SolidNativeE2EUITests/Info.plist", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(appDelegate, /--solid-native-development-reload/u);
  assert.match(appDelegate, /--solid-native-metro-location=/u);
  assert.match(appDelegate, /useDevelopmentReload \? "dev-entry"/u);
  assert.match(
    appDelegate,
    /RCTBundleURLProvider\.jsBundleURL\([\s\S]*packagerHost: developmentMetroLocation/u,
  );
  assert.match(
    appDelegate,
    /--solid-native-bundled-reload[\s\S]*requestDevelopmentReload/u,
  );
  assert.match(automation, /testGrantLocalNetworkAccessForDevelopmentReload/u);
  assert.match(automation, /localNetworkAlert\.buttons\["Allow"\]/u);
  assert.match(automation, /staticTexts\["Solid Native development reload"\]/u);
  assert.match(testInfo, /SolidNativeReloadMetroLocation/u);
  assert.match(runner, /SOLID_NATIVE_IOS_RELOAD_METRO_PORT/u);
  assert.match(runner, /SOLID_NATIVE_IOS_RELOAD_UNLOCK_WAIT_SECONDS/u);
  assert.match(runner, /SKIP_BUNDLING=1/u);
  assert.match(runner, /route -n get default/u);
  assert.match(runner, /ipconfig getifaddr "\$PRIMARY_INTERFACE"/u);
  assert.match(runner, /SOLID_NATIVE_IOS_RELOAD_METRO_HOST/u);
  assert.match(runner, /SOLID_NATIVE_IOS_RELOAD_MODE/u);
  assert.match(
    runner,
    /ENTRY_FILE=dev-entry\.tsx FORCE_BUNDLING=1 build-for-testing/u,
  );
  assert.match(runner, /build-for-testing/u);
  assert.match(runner, /start_solid_native_ios_process_guard/u);
  assert.match(runner, /device info details/u);
  assert.match(runner, /SOLID_NATIVE_IOS_RELOAD_TRACE_DEVICE/u);
  const build = runner.indexOf("build-for-testing");
  const install = runner.indexOf("device install app", build);
  const lastDevicePreflight = runner.lastIndexOf(
    "ios-device-preflight.mjs",
    install,
  );
  const lastHostPreflight = runner.lastIndexOf(
    "ios-host-preflight.mjs",
    install,
  );
  assert.ok(
    build < lastDevicePreflight &&
      lastDevicePreflight < lastHostPreflight &&
      lastHostPreflight < install,
  );
  assert.match(
    runner.slice(lastDevicePreflight, install),
    /--wait-seconds "\$UNLOCK_WAIT_SECONDS"/u,
  );
});

test("uses the native logger for reload markers observed outside DevTools", async () => {
  const source = await readFile(
    new URL("../dev-entry.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /nativeLoggingHook\?:/u);
  assert.match(
    source,
    /writeNativeReloadLog\([\s\S]*SOLID_NATIVE_RELOAD_MOUNTED/u,
  );
  assert.match(
    source,
    /writeNativeReloadLog\([\s\S]*SOLID_NATIVE_RELOAD_FAILED/u,
  );
  const appDelegate = await readFile(
    new URL("../ios/SolidNativeE2E/AppDelegate.swift", import.meta.url),
    "utf8",
  );
  assert.match(
    appDelegate,
    /allowsBundledDevelopmentReload \|\| useDevelopmentReload[\s\S]*RCTSetLogFunction[\s\S]*message\.hasPrefix\("SOLID_NATIVE_RELOAD_"\)[\s\S]*NSLog\("%@", message\)/u,
  );
  const automation = await readFile(
    new URL(
      "../ios/SolidNativeE2EUITests/SolidNativeNetworkingUITests.swift",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(automation, /testActivateBundledDevelopmentReload/u);
  assert.match(
    automation,
    /--solid-native-use-bundled-development[\s\S]*--solid-native-bundled-reload[\s\S]*runningForeground[\s\S]*Solid Native development reload/u,
  );
  const bundledPreflight =
    /func testActivateBundledDevelopmentReload\(\) throws \{([\s\S]*?)\n  \}\n\n  func testGrantLocalNetworkAccessForDevelopmentReload/u.exec(
      automation,
    )?.[1];
  assert.ok(bundledPreflight);
  assert.doesNotMatch(bundledPreflight, /application\.terminate\(\)/u);
  assert.match(bundledPreflight, /--solid-native-memory-keep-awake/u);
  assert.match(
    await readFile(new URL("./ios-reload-soak.mjs", import.meta.url), "utf8"),
    /startIosBundledPreflight[\s\S]*testActivateBundledDevelopmentReload/u,
  );
});

test("prewarms the bounded iOS Metro bundle before permission automation", async () => {
  const source = await readFile(
    new URL("./ios-reload-soak.mjs", import.meta.url),
    "utf8",
  );
  const prewarm = source.indexOf("await prewarmIosDevelopmentBundle");
  const permission = source.indexOf("startIosLocalNetworkPreflight", prewarm);
  const measuredLaunch = source.indexOf("startIosConsole", permission);
  assert.ok(
    prewarm >= 0 && prewarm < permission && permission < measuredLaunch,
  );
  assert.match(source, /receivedBytes > 64 \* 1024 \* 1024/u);
  assert.match(
    source,
    /AbortSignal\.timeout\(configuration\.reloadTimeoutMs\)/u,
  );
});
