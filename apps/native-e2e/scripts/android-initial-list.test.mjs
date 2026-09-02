import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("physical Android initial-list proof keeps its cross-layer contract aligned", async () => {
  const [application, instrumentation, runner] = await Promise.all([
    readFile(new URL("list-initial.tsx", directory), "utf8"),
    readFile(
      new URL(
        "android/app/src/androidTest/java/dev/solidnative/e2e/SolidNativePhysicalTest.kt",
        directory,
      ),
      "utf8",
    ),
    readFile(
      new URL("scripts/android-initial-list-test.sh", directory),
      "utf8",
    ),
  ]);

  assert.match(
    application,
    /initialScrollKey=\{items\[INITIAL_INDEX\]!\.id\}/u,
  );
  assert.match(application, /initial\?\.sequence !== 1/u);
  assert.match(application, /activeKeys\.has\("initial-0"\)/u);
  assert.match(application, /SOLID_NATIVE_INITIAL_VIRTUALIZED_LIST_READY/u);
  assert.match(
    application,
    /SOLID_NATIVE_INITIAL_VIRTUALIZED_LIST_TEARDOWN_SUCCEEDED/u,
  );
  assert.match(instrumentation, /testPhysicalInitialVirtualizedList/u);
  assert.match(
    instrumentation,
    /nativeScrollY[\s\S]*INITIAL_VIRTUALIZED_LIST_INDEX[\s\S]*INITIAL_VIRTUALIZED_LIST_ITEM_SIZE/u,
  );
  assert.match(
    instrumentation,
    /SOLID_NATIVE_INITIAL_VIRTUALIZED_LIST_NATIVE_SUCCEEDED/u,
  );
  assert.match(runner, /ENTRY_FILE=list-initial\.tsx/u);
  assert.match(runner, /android-device-preflight\.sh/u);
  assert.match(runner, /solid_native_android_lease_stay_awake/u);
  assert.match(runner, /testPhysicalInitialVirtualizedList/u);
  assert.match(runner, /SOLID_NATIVE_INITIAL_VIRTUALIZED_LIST_READY/u);
  assert.match(
    runner,
    /SOLID_NATIVE_INITIAL_VIRTUALIZED_LIST_NATIVE_SUCCEEDED/u,
  );
  assert.match(
    runner,
    /SOLID_NATIVE_INITIAL_VIRTUALIZED_LIST_TEARDOWN_SUCCEEDED/u,
  );
});
