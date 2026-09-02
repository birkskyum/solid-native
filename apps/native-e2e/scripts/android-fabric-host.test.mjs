import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("physical framework-free Fabric Host proof keeps its layers aligned", async () => {
  const [application, instrumentation, manifest, runner] = await Promise.all([
    readFile(new URL("fabric-host.ts", directory), "utf8"),
    readFile(
      new URL(
        "android/app/src/androidTest/java/dev/solidnative/e2e/FabricHostPhysicalTest.kt",
        directory,
      ),
      "utf8",
    ),
    readFile(new URL("package.json", directory), "utf8").then(JSON.parse),
    readFile(new URL("scripts/android-fabric-host-test.sh", directory), "utf8"),
  ]);

  for (const value of [
    "Framework-free Fabric Host",
    "Fabric Host mounted without a framework renderer",
    "Physical press updated Fabric through NativeHost",
    "Update framework-free Fabric tree",
    "Dispose framework-free Fabric tree",
  ]) {
    assert.ok(application.includes(value), `Application is missing ${value}.`);
    assert.ok(
      instrumentation.includes(value),
      `Instrumentation is missing ${value}.`,
    );
  }

  assert.match(application, /from "@solid-native\/fabric-host"/u);
  assert.match(application, /await waitForNativeSurface\(/u);
  assert.doesNotMatch(application, /async function waitForSurface/u);
  assert.doesNotMatch(
    application,
    /(?:solid-js|@solid-native\/(?:core|navigation|renderer|runtime))/u,
  );
  assert.match(application, /type: "update-text"/u);
  assert.match(application, /host\.subscribe\(/u);
  assert.match(application, /host\.subscribeLifecycle/u);
  assert.match(application, /await host\.destroySurface\(surface\)/u);
  assert.match(instrumentation, /activity\.isFinishing/u);
  assert.match(instrumentation, /logcat -d -v brief -s ReactNativeJS:I/u);
  assert.match(runner, /ENTRY_FILE=fabric-host\.ts/u);
  assert.match(runner, /assembleSolidReleaseAndroidTest/u);
  assert.match(runner, /trap cleanup EXIT HUP INT TERM/u);
  assert.match(runner, /SOLID_NATIVE_FABRIC_HOST_FAILED/u);
  assert.match(runner, /finish_cleanup/u);
  assert.ok(
    runner.lastIndexOf("finish_cleanup") <
      runner.lastIndexOf("Verified framework-free Fabric Host mount"),
  );
  assert.equal(
    manifest.scripts["android:fabric-host:test"],
    "sh scripts/android-fabric-host-test.sh && node scripts/verify-framework-free-fabric-host-sourcemap.mjs android/app/build/generated/sourcemaps/react/solidRelease/index.android.bundle.map",
  );
});
