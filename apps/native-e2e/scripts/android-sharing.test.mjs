import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("physical Android sharing proof keeps its cross-layer contract aligned", async () => {
  const [
    application,
    capture,
    instrumentation,
    runner,
    testManifest,
    manifest,
  ] = await Promise.all([
    readFile(new URL("sharing.tsx", directory), "utf8"),
    readFile(
      new URL(
        "android/app/src/androidTest/java/dev/solidnative/e2e/SolidNativeShareCaptureActivity.java",
        directory,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "android/app/src/androidTest/java/dev/solidnative/e2e/SolidNativeSharingPhysicalTest.kt",
        directory,
      ),
      "utf8",
    ),
    readFile(new URL("scripts/android-sharing-test.sh", directory), "utf8"),
    readFile(
      new URL("android/app/src/androidTest/AndroidManifest.xml", directory),
      "utf8",
    ),
    readFile(new URL("package.json", directory), "utf8").then(JSON.parse),
  ]);

  for (const value of [
    "Solid Native sharing ready",
    "Share message and URL",
    "Share URL only",
    "Combined share result: presented",
    "URL-only share result: presented",
    "Dispose Solid Native sharing proof",
  ]) {
    assert.ok(application.includes(value), `Application is missing ${value}.`);
    assert.ok(
      instrumentation.includes(value),
      `Instrumentation is missing ${value}.`,
    );
  }
  for (const value of [
    "Private Solid Native sharing proof",
    "https://solid-native.dev/private-proof",
    "Private Solid Native subject",
  ]) {
    assert.ok(application.includes(value), `Application is missing ${value}.`);
    assert.ok(capture.includes(value), `Capture target is missing ${value}.`);
  }
  assert.equal(
    manifest.scripts["android:sharing:test"],
    "sh scripts/android-sharing-test.sh && node scripts/verify-solid-runtime-sourcemap.mjs android/app/build/generated/sourcemaps/react/solidRelease/index.android.bundle.map && node scripts/verify-sharing-sourcemap.mjs android/app/build/generated/sourcemaps/react/solidRelease/index.android.bundle.map",
  );
  assert.match(
    application,
    /createReactNativeShareService\(\)[\s\S]*createShareController\(service\)/u,
  );
  assert.match(
    application,
    /platform\.share\.presented[\s\S]*SOLID_NATIVE_SHARING_COMBINED_CAUSALITY_SUCCEEDED[\s\S]*SOLID_NATIVE_SHARING_URL_ONLY_CAUSALITY_SUCCEEDED/u,
  );
  assert.match(
    capture,
    /Intent\.ACTION_SEND[\s\S]*Intent\.EXTRA_SUBJECT[\s\S]*PRIVATE_MESSAGE \+ "\\n" \+ PRIVATE_URL[\s\S]*COMBINED_RESULT_TEXT[\s\S]*PRIVATE_URL\.equals\(message\)[\s\S]*URL_ONLY_RESULT_TEXT/u,
  );
  assert.match(
    testManifest,
    /SolidNativeShareCaptureActivity[\s\S]*android:exported="true"[\s\S]*android\.intent\.action\.SEND[\s\S]*text\/plain/u,
  );
  assert.match(
    instrumentation,
    /SHARE_COMBINED_LABEL[\s\S]*COMBINED_RESULT_TEXT[\s\S]*SHARE_URL_ONLY_LABEL[\s\S]*URL_ONLY_RESULT_TEXT[\s\S]*KEYCODE_BACK/u,
  );
  assert.match(runner, /ENTRY_FILE=sharing\.tsx/u);
  assert.match(runner, /assembleSolidReleaseAndroidTest/u);
  assert.match(runner, /trap cleanup EXIT HUP INT TERM/u);
  assert.match(runner, /marker_deadline=.*30/u);
  assert.match(runner, /SOLID_NATIVE_SHARING_TEARDOWN_SUCCEEDED/u);
  assert.match(
    runner,
    /am force-stop "\$app_id"[\s\S]*uninstall "\$package_name"[\s\S]*pidof "\$package_name"[\s\S]*pm path "\$package_name"[\s\S]*Verified native Android sharesheet/u,
  );
});
