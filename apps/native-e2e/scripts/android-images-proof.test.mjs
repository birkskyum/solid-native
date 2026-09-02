import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("physical Android image proof keeps its cross-layer contract aligned", async () => {
  const [application, instrumentation, runner, server, manifest] =
    await Promise.all([
      readFile(new URL("images.tsx", directory), "utf8"),
      readFile(
        new URL(
          "android/app/src/androidTest/java/dev/solidnative/e2e/SolidNativeImagesPhysicalTest.kt",
          directory,
        ),
        "utf8",
      ),
      readFile(new URL("scripts/android-images-proof.mjs", directory), "utf8"),
      readFile(
        new URL("scripts/native-image-proof-server.mjs", directory),
        "utf8",
      ),
      readFile(new URL("package.json", directory), "utf8").then(JSON.parse),
    ]);

  for (const value of [
    "Solid Native images ready",
    "Run native image cache proof",
    "Start cancellable native image prefetch",
    "Cancel native image prefetch",
    "Start owner-disposal image prefetch",
    "Dispose active Solid Native image owner",
    "Native image cache proof complete",
    "Cancellable image prefetch active",
    "Native image prefetch cancelled",
    "Owner-disposal image prefetch active",
  ]) {
    assert.ok(application.includes(value), `Application is missing ${value}.`);
    assert.ok(
      instrumentation.includes(value),
      `Instrumentation is missing ${value}.`,
    );
  }
  assert.equal(
    manifest.scripts["android:images:test"],
    "node scripts/android-images-proof.mjs",
  );
  assert.match(
    application,
    /queryCache\(\[PREFETCH_URI, MISSING_URI\]\)[\s\S]*getDimensions\([\s\S]*X-Solid-Native-Image-Proof[\s\S]*prefetch\(PREFETCH_URI\)[\s\S]*queryCache\(\[[\s\S]*PREFETCH_URI,[\s\S]*MISSING_URI,[\s\S]*PREFETCH_URI/u,
  );
  assert.match(
    application,
    /platform\.image\.dimensions[\s\S]*platform\.image\.prefetch[\s\S]*platform\.image\.cache-query[\s\S]*A private image URI or request header escaped/u,
  );
  assert.match(
    application,
    /service\.prefetch\(CANCELLATION_URI\)[\s\S]*ImagePrefetchCancelledError[\s\S]*cancellationHandle\.cancel\(\)/u,
  );
  assert.match(
    application,
    /images\.prefetch\(OWNER_DISPOSAL_URI\)[\s\S]*ImageOwnerDisposedError/u,
  );
  assert.match(
    instrumentation,
    /RUN_LABEL[\s\S]*COMPLETE_TEXT[\s\S]*START_CANCELLATION_LABEL[\s\S]*CANCEL_LABEL[\s\S]*CANCELLED_TEXT[\s\S]*START_OWNER_DISPOSAL_LABEL[\s\S]*DISPOSE_LABEL[\s\S]*waitForNodeToDisappear/u,
  );
  assert.match(runner, /ENTRY_FILE: "images\.tsx"/u);
  assert.match(runner, /createImageProofServer\(\)/u);
  assert.match(
    runner,
    /reverse[\s\S]*DEVICE_PORT[\s\S]*proofServer\.hostPort/u,
  );
  assert.match(runner, /assertImageServerEvidence/u);
  assert.match(
    runner,
    /force-stop[\s\S]*uninstall[\s\S]*pidof[\s\S]*pm[\s\S]*path[\s\S]*reverse tunnel survived cleanup/u,
  );
  assert.match(
    server,
    /dimensions\.png[\s\S]*prefetch\.png[\s\S]*cancel\.png[\s\S]*dispose\.png[\s\S]*missing\.png/u,
  );
});
