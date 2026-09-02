import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("keeps the physical iOS memory-warning proof cross-layer complete", async () => {
  const [
    application,
    appDelegate,
    automation,
    runner,
    manifest,
    platformServices,
  ] = await Promise.all([
    readFile(new URL("memory-warning.tsx", directory), "utf8"),
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
    readFile(new URL("scripts/ios-memory-warning-test.sh", directory), "utf8"),
    readFile(new URL("package.json", directory), "utf8"),
    readFile(
      new URL(
        "../../packages/runtime/src/react-native-platform-services.ts",
        directory,
      ),
      "utf8",
    ),
  ]);

  assert.match(application, /createMemoryWarningCount\(props\.platform\)/u);
  assert.match(
    application,
    /createEffect\(warningCount, \(count\) => \{/u,
    "the proof must use Solid 2's separate compute and effect phases",
  );
  assert.match(application, /platform\.memory-warning\.output/u);
  assert.match(
    application,
    /platform\.memory-warning[\s\S]*solid-native\.computation[\s\S]*solid-native\.mount[\s\S]*solid-native\.frame/u,
  );
  assert.match(
    application,
    /SOLID_NATIVE_MEMORY_WARNING_CAUSALITY_SUCCEEDED[\s\S]*setStatus\(SUCCEEDED_TEXT\)[\s\S]*flushMounted\(\)/u,
  );
  assert.match(
    application,
    /Dispose Solid Native memory-warning proof[\s\S]*application\.dispose\(\)[\s\S]*SOLID_NATIVE_MEMORY_WARNING_TEARDOWN_SUCCEEDED/u,
  );
  assert.match(
    platformServices,
    /solidNativePlatform === undefined[\s\S]*appStateEmitter\.addListener\("memoryWarning", listener\)/u,
  );
  assert.match(
    appDelegate,
    /#if SOLID_NATIVE_MEMORY_WARNING_PROOF[\s\S]*memory-warning-proof[\s\S]*UIApplication\.didReceiveMemoryWarningNotification[\s\S]*#endif/u,
  );

  assert.match(
    automation,
    /testMemoryWarningOnPhysicalDevice[\s\S]*Solid Native memory-warning proof ready[\s\S]*XCUIDevice\.shared\.system\.open\(warningURL\)/u,
  );
  assert.match(
    automation,
    /Solid Native memory-warning causal proof succeeded[\s\S]*Memory warnings 1[\s\S]*Dispose Solid Native memory-warning proof/u,
  );

  assert.match(runner, /ENTRY_FILE=memory-warning\.tsx/u);
  assert.match(runner, /testMemoryWarningOnPhysicalDevice/u);
  assert.match(runner, /SOLID_NATIVE_MEMORY_WARNING_PROOF/u);
  assert.doesNotMatch(runner, /--console/u);
  assert.doesNotMatch(runner, /sendMemoryWarning/u);
  assert.match(runner, /start_solid_native_ios_process_guard/u);
  assert.match(runner, /verify-solid-runtime-sourcemap\.mjs/u);
  assert.match(
    manifest,
    /"ios:memory-warning:test": "sh scripts\/ios-memory-warning-test\.sh"/u,
  );
});
