import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("physical Android secure-storage proof keeps its cross-layer contract aligned", async () => {
  const [application, instrumentation, runner, sourceMapGate, manifest] =
    await Promise.all([
      readFile(new URL("secure-storage.tsx", directory), "utf8"),
      readFile(
        new URL(
          "android/app/src/androidTest/java/dev/solidnative/e2e/SolidNativeSecureStoragePhysicalTest.kt",
          directory,
        ),
        "utf8",
      ),
      readFile(
        new URL("scripts/android-secure-storage-test.sh", directory),
        "utf8",
      ),
      readFile(
        new URL("scripts/verify-secure-storage-sourcemap.mjs", directory),
        "utf8",
      ),
      readFile(new URL("package.json", directory), "utf8").then(JSON.parse),
    ]);

  for (const value of [
    "Solid Native secure storage ready",
    "Private Solid Native refresh token proof",
    "refresh-session",
    "Store encrypted session proof",
    "Restore encrypted session proof",
    "Delete encrypted session proof",
    "Dispose Solid Native secure storage proof",
    "Session proof stored in native secure storage",
    "Session proof restored from native secure storage",
    "Session proof deleted from native secure storage",
  ]) {
    assert.ok(application.includes(value), `Application is missing ${value}.`);
    assert.ok(
      instrumentation.includes(value),
      `Instrumentation is missing ${value}.`,
    );
  }
  assert.equal(manifest.dependencies["react-native-keychain"], "10.0.0");
  assert.equal(
    manifest.scripts["android:secure-storage:test"],
    "sh scripts/android-secure-storage-test.sh && node scripts/verify-solid-runtime-sourcemap.mjs android/app/build/generated/sourcemaps/react/solidRelease/index.android.bundle.map && node scripts/verify-secure-storage-sourcemap.mjs android/app/build/generated/sourcemaps/react/solidRelease/index.android.bundle.map",
  );
  assert.match(
    application,
    /createReactNativeSecureStorage[\s\S]*createSecureStorageController/u,
  );
  assert.match(
    application,
    /platform\.secure-storage\.read[\s\S]*event\.priority[\s\S]*commit\.priority[\s\S]*SOLID_NATIVE_SECURE_STORAGE_READ_CAUSALITY_SUCCEEDED/u,
  );
  for (const pattern of [
    /KeyStore\.getInstance\("AndroidKeyStore"\)/u,
    /containsAlias\(SERVICE\)/u,
    /getKey\(SERVICE, null\)/u,
    /key\?\.encoded/u,
    /encryptedBytes[\s\S]*contains\(PROOF_SECRET\)/u,
    /tapControl\(DELETE_LABEL\)[\s\S]*waitForPersistedService\(false\)/u,
  ]) {
    assert.match(instrumentation, pattern);
  }
  assert.match(runner, /ENTRY_FILE=secure-storage\.tsx/u);
  assert.match(runner, /assembleSolidReleaseAndroidTest/u);
  assert.match(runner, /trap cleanup EXIT HUP INT TERM/u);
  assert.match(runner, /SOLID_NATIVE_SECURE_STORAGE_TEARDOWN_SUCCEEDED/u);
  assert.match(
    sourceMapGate,
    /react-native-keychain\/src\/index\.ts[\s\S]*React-facing keychain facades/u,
  );
});
