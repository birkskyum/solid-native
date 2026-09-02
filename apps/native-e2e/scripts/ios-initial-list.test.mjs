import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("physical iOS initial-list proof keeps its cross-layer contract aligned", async () => {
  const [application, automation, runner, manifest] = await Promise.all([
    readFile(new URL("list-initial.tsx", directory), "utf8"),
    readFile(
      new URL(
        "ios/SolidNativeE2EUITests/SolidNativeE2EUITests.swift",
        directory,
      ),
      "utf8",
    ),
    readFile(new URL("scripts/ios-initial-list-test.sh", directory), "utf8"),
    readFile(new URL("package.json", directory), "utf8").then(JSON.parse),
  ]);

  assert.match(
    application,
    /initialScrollKey=\{items\[INITIAL_INDEX\]!\.id\}/u,
  );
  assert.match(application, /initial\?\.sequence !== 1/u);
  assert.match(
    application,
    /<Pressable[\s\S]*accessible[\s\S]*accessibilityRole="button"[\s\S]*accessibilityLabel=\{DISPOSE_LABEL\}/u,
  );
  assert.doesNotMatch(application, /\.scrollTo(?:Index|Key|Offset|End)?\(/u);
  assert.match(automation, /testInitialVirtualizedListOnPhysicalDevice/u);
  assert.match(automation, /Set\(\(100\.\.\.106\)\.map/u);
  assert.match(automation, /Initial virtualized row 0/u);
  assert.match(automation, /target\.frame\.minY,[\s\S]*list\.frame\.minY/u);
  assert.match(runner, /ENTRY_FILE=list-initial\.tsx/u);
  assert.match(runner, /testInitialVirtualizedListOnPhysicalDevice/u);
  assert.match(runner, /start_solid_native_ios_process_guard/u);
  assert.match(runner, /ios-device-preflight\.mjs/u);
  assert.match(runner, /verify-solid-runtime-sourcemap\.mjs/u);
  assert.match(runner, /SOLID_NATIVE_INITIAL_VIRTUALIZED_LIST_READY/u);
  assert.match(
    runner,
    /SOLID_NATIVE_INITIAL_VIRTUALIZED_LIST_TEARDOWN_SUCCEEDED/u,
  );
  assert.equal(
    manifest.scripts["ios:list:initial:test"],
    "sh scripts/ios-initial-list-test.sh",
  );
});
