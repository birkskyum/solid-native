import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("physical Android pull-to-refresh keeps its cross-layer contract aligned", async () => {
  const [application, instrumentation, runner, manifest] = await Promise.all([
    readFile(new URL("refreshable-scroll-view.tsx", directory), "utf8"),
    readFile(
      new URL(
        "android/app/src/androidTest/java/dev/solidnative/e2e/SolidNativeRefreshableScrollViewPhysicalTest.kt",
        directory,
      ),
      "utf8",
    ),
    readFile(
      new URL("scripts/android-refreshable-scroll-view-test.sh", directory),
      "utf8",
    ),
    readFile(new URL("package.json", directory), "utf8").then(JSON.parse),
  ]);

  for (const value of [
    "Solid Native pull to refresh ready",
    "Rejected native refresh 1",
    "Accepted native refresh 2",
    "Completed native refresh 2",
    "Dispose Solid Native pull to refresh proof",
  ]) {
    assert.ok(application.includes(value), `Application is missing ${value}.`);
    assert.ok(
      instrumentation.includes(value),
      `Instrumentation is missing ${value}.`,
    );
  }
  assert.match(application, /<RefreshableScrollView/u);
  assert.match(application, /refreshing=\{refreshing\(\)\}/u);
  assert.match(application, /setRefreshing\(true\)/u);
  assert.match(application, /setRefreshing\(false\)/u);
  assert.match(
    application,
    /backingScrollView\?\.nativeNode\.componentName === "ScrollView"/u,
  );
  assert.match(application, /backingScrollView === retainedBackingScrollView/u);
  assert.match(instrumentation, /ReactSwipeRefreshLayout/u);
  assert.match(instrumentation, /ReactScrollView/u);
  assert.match(instrumentation, /injectPull\(retainedTree\.refreshControl\)/u);
  assert.match(instrumentation, /assertSame\([\s\S]*retained\.refreshControl/u);
  assert.match(instrumentation, /assertSame\([\s\S]*retained\.scrollView/u);
  assert.match(instrumentation, /waitForLogMarker\([\s\S]*TEARDOWN_MARKER/u);
  assert.match(runner, /ENTRY_FILE=refreshable-scroll-view\.tsx/u);
  assert.match(runner, /assembleSolidReleaseAndroidTest/u);
  assert.match(runner, /trap cleanup EXIT HUP INT TERM/u);
  assert.match(runner, /SOLID_NATIVE_REFRESHABLE_SCROLL_FAILED/u);
  assert.match(runner, /SOLID_NATIVE_REFRESHABLE_SCROLL_IDENTITY_SUCCEEDED/u);
  assert.match(runner, /SOLID_NATIVE_REFRESHABLE_SCROLL_TEARDOWN_SUCCEEDED/u);
  assert.match(
    manifest.scripts["android:refresh:test"],
    /verify-refreshable-scroll-view-sourcemap\.mjs/u,
  );
});
