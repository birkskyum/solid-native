import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("physical Android Linking proof keeps its cross-layer contract aligned", async () => {
  const [application, instrumentation, runner, manifest, packageManifest] =
    await Promise.all([
      readFile(new URL("linking.tsx", directory), "utf8"),
      readFile(
        new URL(
          "android/app/src/androidTest/java/dev/solidnative/e2e/SolidNativeLinkingPhysicalTest.kt",
          directory,
        ),
        "utf8",
      ),
      readFile(new URL("scripts/android-linking-test.sh", directory), "utf8"),
      readFile(
        new URL("android/app/src/main/AndroidManifest.xml", directory),
        "utf8",
      ),
      readFile(new URL("package.json", directory), "utf8").then(JSON.parse),
    ]);

  for (const value of [
    "dev.solidnative.e2e://navigation/outbound-link-proof",
    "Solid Native linking ready",
    "Native URL delivery: waiting",
    "Native URL delivery: received",
    "Open registered application URL",
    "Commit native URL delivery",
    "Open application settings",
    "Dispose Solid Native linking proof",
  ]) {
    assert.ok(application.includes(value), `Application is missing ${value}.`);
    assert.ok(
      instrumentation.includes(value),
      `Instrumentation is missing ${value}.`,
    );
  }
  assert.match(
    manifest,
    /android:launchMode="singleTask"[\s\S]*android:name="android\.intent\.action\.VIEW"[\s\S]*android:host="navigation"[\s\S]*android:scheme="\$\{applicationId\}"/u,
  );
  assert.match(
    application,
    /platform\.canOpenURL\(SELF_URL\)[\s\S]*platform\.openURL\(SELF_URL\)/u,
  );
  assert.match(
    application,
    /createNativeEventAccessor<NativeURLEvent, boolean>[\s\S]*name: "platform\.url\.open"[\s\S]*event\.url === SELF_URL/u,
  );
  assert.match(
    application,
    /platform\.openSettings\(\)[\s\S]*SOLID_NATIVE_LINKING_SETTINGS_SUCCEEDED/u,
  );
  assert.match(
    application,
    /!JSON\.stringify\(records\)\.includes\(SELF_URL\)/u,
  );
  assert.match(
    instrumentation,
    /waitForIntentData\(activity, SELF_URL\)[\s\S]*waitForActivePackage\(SETTINGS_PACKAGE\)[\s\S]*waitForText\(APP_LABEL\)[\s\S]*KEYCODE_BACK[\s\S]*waitForActivePackage\(APP_ID\)/u,
  );
  assert.match(runner, /ENTRY_FILE=linking\.tsx/u);
  assert.match(runner, /trap cleanup EXIT HUP INT TERM/u);
  assert.match(
    runner,
    /leave_settings_if_focused[\s\S]*uninstall "\$package_name"[\s\S]*pm path "\$package_name"/u,
  );
  assert.equal(
    packageManifest.scripts["android:linking:test"],
    "sh scripts/android-linking-test.sh && node scripts/verify-solid-runtime-sourcemap.mjs android/app/build/generated/sourcemaps/react/solidRelease/index.android.bundle.map && node scripts/verify-linking-sourcemap.mjs android/app/build/generated/sourcemaps/react/solidRelease/index.android.bundle.map",
  );
});
