import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("physical Android localization proof keeps its cross-layer contract aligned", async () => {
  const [application, instrumentation, runner, nativeSurface, manifest] =
    await Promise.all([
      readFile(new URL("localization.tsx", directory), "utf8"),
      readFile(
        new URL(
          "android/app/src/androidTest/java/dev/solidnative/e2e/SolidNativeLocalizationPhysicalTest.kt",
          directory,
        ),
        "utf8",
      ),
      readFile(
        new URL("scripts/android-localization-test.sh", directory),
        "utf8",
      ),
      readFile(
        new URL(
          "../../packages/fabric-host/native/android/java/dev/solidnative/runtime/SolidNativeSurface.kt",
          directory,
        ),
        "utf8",
      ),
      readFile(new URL("package.json", directory), "utf8").then(JSON.parse),
    ]);

  for (const value of [
    "Solid Native localization ready",
    "Localization leading marker",
    "Localization trailing marker",
    "Dispose Solid Native localization proof",
  ]) {
    assert.ok(application.includes(value), `Application is missing ${value}.`);
    assert.ok(
      instrumentation.includes(value),
      `Instrumentation is missing ${value}.`,
    );
  }
  assert.equal(
    manifest.scripts["android:localization:test"],
    "sh scripts/android-localization-test.sh && node scripts/verify-solid-runtime-sourcemap.mjs android/app/build/generated/sourcemaps/react/solidRelease/index.android.bundle.map && node scripts/verify-localization-sourcemap.mjs android/app/build/generated/sourcemaps/react/solidRelease/index.android.bundle.map",
  );
  assert.match(
    application,
    /getReactNativeLocalizationSnapshot\(\)[\s\S]*localization\.localeTag[\s\S]*localization\.layoutDirection[\s\S]*localization\.swapsLeftAndRightInRTL/u,
  );
  assert.match(
    application,
    /flexDirection: "row"[\s\S]*LEADING_MARKER_LABEL[\s\S]*TRAILING_MARKER_LABEL/u,
  );
  assert.match(
    instrumentation,
    /testLTRStartupSnapshotAndPhysicalLayout[\s\S]*testRTLStartupSnapshotAndPhysicalLayout[\s\S]*activity\.resources\.configuration\.locales[\s\S]*decorView\.layoutDirection/u,
  );
  assert.match(
    instrumentation,
    /leadingBounds\.centerX\(\) < trailingBounds\.centerX\(\)[\s\S]*leadingBounds\.centerX\(\) > trailingBounds\.centerX\(\)/u,
  );
  assert.match(runner, /ENTRY_FILE=localization\.tsx/u);
  assert.match(runner, /set-app-localeconfig[\s\S]*en-US,ar-SA/u);
  assert.match(
    runner,
    /run_locale_phase en-US ltr testLTRStartupSnapshotAndPhysicalLayout[\s\S]*run_locale_phase ar-SA rtl testRTLStartupSnapshotAndPhysicalLayout/u,
  );
  assert.doesNotMatch(runner, /settings put global|set-device-locale/u);
  assert.match(runner, /trap cleanup EXIT HUP INT TERM/u);
  assert.match(
    nativeSurface,
    /synchronizeLayoutDirection\(activity\)[\s\S]*reactHost\.createSurface/u,
  );
  assert.match(
    nativeSurface,
    /ConfigurationCompat\.getLocales\(activity\.resources\.configuration\)[\s\S]*ApplicationInfo\.FLAG_SUPPORTS_RTL[\s\S]*TextUtilsCompat\.getLayoutDirectionFromLocale\(locale\)[\s\S]*I18nUtil\.instance\.allowRTL\(activity, isRTL\)[\s\S]*I18nUtil\.instance\.forceRTL\(activity, isRTL\)/u,
  );
  assert.match(
    runner,
    /am force-stop[\s\S]*uninstall[\s\S]*pidof[\s\S]*pm path[\s\S]*Verified scoped en-US\/LTR/u,
  );
});
