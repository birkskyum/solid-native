import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("physical Android measured-list proof keeps its cross-layer contract aligned", async () => {
  const [application, instrumentation, runner, manifest] = await Promise.all([
    readFile(new URL("list-measured.tsx", directory), "utf8"),
    readFile(
      new URL(
        "android/app/src/androidTest/java/dev/solidnative/e2e/SolidNativePhysicalTest.kt",
        directory,
      ),
      "utf8",
    ),
    readFile(
      new URL("scripts/android-measured-list-test.sh", directory),
      "utf8",
    ),
    readFile(new URL("package.json", directory), "utf8").then(JSON.parse),
  ]);

  for (const value of [
    "Solid Native measured VirtualizedList ready",
    "Solid Native measured VirtualizedList physical scroll mounted",
    "Measured virtualized row ",
  ]) {
    assert.ok(application.includes(value), `Application is missing ${value}.`);
    assert.ok(
      instrumentation.includes(value),
      `Instrumentation is missing ${value}.`,
    );
  }
  assert.match(application, /estimatedItemSize=\{ESTIMATED_ITEM_SIZE\}/u);
  assert.match(application, /recycleRowViews/u);
  assert.match(
    application,
    /SHORT_ITEM_SIZE = 40;[\s\S]*TALL_ITEM_SIZE = 80;/u,
  );
  assert.match(
    instrumentation,
    /firstBounds\.bottom - secondBounds\.top[\s\S]*secondBounds\.bottom - thirdBounds\.top/u,
  );
  assert.match(instrumentation, /swipeUp\(list\)/u);
  assert.match(
    instrumentation,
    /mountedRows <= MEASURED_VIRTUALIZED_MAXIMUM_MOUNTED_ROWS/u,
  );
  assert.match(
    instrumentation,
    /captureNativeRowWrappers[\s\S]*findNativeRowReuse/u,
  );
  assert.match(runner, /android-device-preflight\.sh/u);
  assert.match(runner, /ENTRY_FILE=list-measured\.tsx/u);
  assert.match(runner, /assembleSolidListReleaseAndroidTest/u);
  assert.match(runner, /trap cleanup EXIT HUP INT TERM/u);
  assert.match(runner, /SOLID_NATIVE_MEASURED_VIRTUALIZED_LIST_FAILED/u);
  assert.match(
    runner,
    /SOLID_NATIVE_MEASURED_VIRTUALIZED_LIST_NATIVE_SUCCEEDED/u,
  );
  assert.match(
    runner,
    /SOLID_NATIVE_MEASURED_VIRTUALIZED_LIST_RECYCLING_SUCCEEDED/u,
  );
  assert.equal(
    manifest.scripts["android:list:measured:test"],
    "sh scripts/android-measured-list-test.sh",
  );
});
