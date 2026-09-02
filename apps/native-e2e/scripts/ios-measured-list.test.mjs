import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("physical iOS measured-list proof keeps its cross-layer contract aligned", async () => {
  const [application, automation, runner, manifest] = await Promise.all([
    readFile(new URL("list-measured.tsx", directory), "utf8"),
    readFile(
      new URL(
        "ios/SolidNativeE2EUITests/SolidNativeE2EUITests.swift",
        directory,
      ),
      "utf8",
    ),
    readFile(new URL("scripts/ios-measured-list-test.sh", directory), "utf8"),
    readFile(new URL("package.json", directory), "utf8").then(JSON.parse),
  ]);

  assert.match(application, /estimatedItemSize=\{ESTIMATED_ITEM_SIZE\}/u);
  assert.match(application, /recycleRowViews/u);
  assert.match(
    application,
    /SHORT_ITEM_SIZE = 40;[\s\S]*TALL_ITEM_SIZE = 80;/u,
  );
  assert.match(automation, /testMeasuredVirtualizedListOnPhysicalDevice/u);
  assert.match(automation, /firstRow\.frame\.height, 40/u);
  assert.match(automation, /secondRow\.frame\.height, 80/u);
  assert.match(automation, /firstRow\.frame\.maxY, secondRow\.frame\.minY/u);
  assert.match(automation, /thenDragTo: dragEnd/u);
  assert.match(automation, /rowLabels\.count, 15/u);
  assert.match(runner, /ENTRY_FILE=list-measured\.tsx/u);
  assert.match(runner, /testMeasuredVirtualizedListOnPhysicalDevice/u);
  assert.match(runner, /start_solid_native_ios_process_guard/u);
  assert.match(runner, /ios-device-preflight\.mjs/u);
  assert.match(runner, /verify-solid-runtime-sourcemap\.mjs/u);
  assert.match(runner, /SOLID_NATIVE_MEASURED_VIRTUALIZED_LIST_READY/u);
  assert.match(runner, /SOLID_NATIVE_MEASURED_VIRTUALIZED_LIST_SUCCEEDED/u);
  assert.equal(
    manifest.scripts["ios:list:measured:test"],
    "sh scripts/ios-measured-list-test.sh",
  );
});
