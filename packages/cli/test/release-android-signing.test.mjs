import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createNativeReleaseManifest,
  nativeReleaseFingerprintMatches,
  readNativeReleaseManifest,
  verifyNativeReleaseManifest,
  writeNativeBundleManifest,
} from "../dist/index.js";

const UPLOAD_CERTIFICATE_SHA256 = "5a".repeat(32);
const NATIVE_E2E_CWD = fileURLToPath(
  new URL("../../../apps/native-e2e/", import.meta.url),
);

function portableSourceMap() {
  return JSON.stringify({
    version: 3,
    sources: ["app:///index.tsx"],
    sourcesContent: ["globalThis.__signedRelease = true;\n"],
    names: [],
    mappings: "",
  });
}

async function fixture(t, artifactName = "app-release.aab") {
  const directory = await mkdtemp(
    path.join(tmpdir(), "solid-native-signed-release-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const assetsDirectory = path.join(directory, "assets");
  const bundlePath = path.join(directory, "index.android.bundle");
  const sourceMapPath = `${bundlePath}.map`;
  const bundleManifestPath = path.join(directory, "solid-native-bundle.json");
  const artifactPath = path.join(directory, artifactName);
  const outputPath = path.join(directory, "solid-native-release.json");
  const artifactBytes = Buffer.from("signed Android App Bundle fixture\n");
  await mkdir(assetsDirectory);
  await Promise.all([
    writeFile(bundlePath, "globalThis.__signedRelease = true;\n"),
    writeFile(sourceMapPath, portableSourceMap()),
    writeFile(artifactPath, artifactBytes),
  ]);
  await writeNativeBundleManifest({
    platform: "android",
    entryPoint: "index.tsx",
    outputDirectory: directory,
    bundlePath,
    sourceMapPath,
    assetsDirectory,
    manifestPath: bundleManifestPath,
  });
  return {
    artifact: {
      name: path.basename(artifactPath),
      bytes: artifactBytes.length,
      sha256: createHash("sha256").update(artifactBytes).digest("hex"),
    },
    artifactPath,
    bundleManifestPath,
    directory,
    outputPath,
  };
}

function apkSigningReport(
  artifactPath,
  artifact,
  certificateSha256s,
  ok = true,
) {
  return {
    schemaVersion: 0,
    ok,
    artifactPath,
    artifact,
    signers: certificateSha256s.map((certificateSha256) => ({
      certificateSha256,
      debug: false,
    })),
    checks: [
      {
        id: "signature-integrity",
        status: ok ? "pass" : "fail",
        message: ok ? "complete signature" : "incomplete signature",
      },
      {
        id: "signer-certificate",
        status: "pass",
        message: "bounded signers",
      },
      {
        id: "debug-certificate",
        status: "pass",
        message: "not debug",
      },
      {
        id: "expected-certificate",
        status: "pass",
        message: "expected signers",
      },
    ],
  };
}

function signingReport(artifactPath, artifact, options = {}) {
  const certificateSha256 =
    options.certificateSha256 ?? UPLOAD_CERTIFICATE_SHA256;
  const ok = options.ok ?? true;
  return {
    schemaVersion: 0,
    ok,
    artifactPath,
    artifact: options.artifact ?? artifact,
    signers: [{ certificateSha256, debug: false }],
    checks: [
      {
        id: "signature-integrity",
        status: ok ? "pass" : "fail",
        message: ok ? "complete signature" : "incomplete signature",
      },
      {
        id: "signer-certificate",
        status: "pass",
        message: "one signer",
      },
      {
        id: "debug-certificate",
        status: "pass",
        message: "not debug",
      },
      {
        id: "expected-certificate",
        status: "pass",
        message: "expected signer",
      },
    ],
  };
}

test("binds and reverifies an Android upload certificate in the release envelope", async (t) => {
  const context = await fixture(t);
  const calls = [];
  const verifyAndroidBundleSigning = async (options) => {
    calls.push(options);
    return signingReport(context.artifactPath, context.artifact);
  };
  const createOptions = {
    cwd: NATIVE_E2E_CWD,
    artifactPath: context.artifactPath,
    bundleManifestPath: context.bundleManifestPath,
    release: "1.0.0+1",
    channel: "production",
    sourceRevision: "abcdef0123456789abcdef0123456789abcdef01",
    outputPath: context.outputPath,
    androidUploadCertificateSha256: UPLOAD_CERTIFICATE_SHA256.toUpperCase(),
    dependencies: { verifyAndroidBundleSigning },
  };

  const created = await createNativeReleaseManifest(createOptions);
  assert.deepEqual(created.manifest.artifactSigning, {
    scheme: "android-jar",
    certificateSha256: UPLOAD_CERTIFICATE_SHA256,
  });
  assert.equal(nativeReleaseFingerprintMatches(created.manifest), true);
  assert.equal(
    nativeReleaseFingerprintMatches({
      ...created.manifest,
      artifactSigning: {
        ...created.manifest.artifactSigning,
        certificateSha256: "6b".repeat(32),
      },
    }),
    false,
  );
  assert.deepEqual(
    (await readNativeReleaseManifest(context.outputPath)).artifactSigning,
    created.manifest.artifactSigning,
  );
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].expectedCertificateSha256,
    UPLOAD_CERTIFICATE_SHA256.toUpperCase(),
  );

  const verification = await verifyNativeReleaseManifest({
    cwd: createOptions.cwd,
    manifestPath: context.outputPath,
    bundleManifestPath: context.bundleManifestPath,
    artifactPath: context.artifactPath,
    dependencies: { verifyAndroidBundleSigning },
  });
  assert.equal(verification.ok, true);
  assert.deepEqual(
    verification.checks.map((entry) => [entry.id, entry.status]),
    [
      ["fingerprint", "pass"],
      ["artifact", "pass"],
      ["artifact-signing", "pass"],
      ["bundle", "pass"],
      ["native", "pass"],
    ],
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[1].expectedCertificateSha256, UPLOAD_CERTIFICATE_SHA256);

  const rejected = await verifyNativeReleaseManifest({
    cwd: createOptions.cwd,
    manifestPath: context.outputPath,
    bundleManifestPath: context.bundleManifestPath,
    artifactPath: context.artifactPath,
    dependencies: {
      async verifyAndroidBundleSigning() {
        return signingReport(context.artifactPath, context.artifact, {
          ok: false,
        });
      },
    },
  });
  assert.equal(rejected.ok, false);
  assert.equal(
    rejected.checks.find((entry) => entry.id === "artifact-signing")?.status,
    "fail",
  );

  const malformed = JSON.parse(await readFile(context.outputPath, "utf8"));
  malformed.artifactSigning.scheme = "unrecognized";
  await writeFile(context.outputPath, `${JSON.stringify(malformed)}\n`);
  await assert.rejects(
    readNativeReleaseManifest(context.outputPath),
    /invalid artifact-signing identity/u,
  );
});

test("does not create an envelope for failed or mismatched Android signing proof", async (t) => {
  const context = await fixture(t);
  const createOptions = {
    cwd: NATIVE_E2E_CWD,
    artifactPath: context.artifactPath,
    bundleManifestPath: context.bundleManifestPath,
    release: "1.0.0+1",
    channel: "production",
    sourceRevision: "abcdef0123456789abcdef0123456789abcdef01",
    outputPath: context.outputPath,
    androidUploadCertificateSha256: UPLOAD_CERTIFICATE_SHA256,
  };
  await assert.rejects(
    createNativeReleaseManifest({
      ...createOptions,
      dependencies: {
        async verifyAndroidBundleSigning() {
          return signingReport(context.artifactPath, context.artifact, {
            ok: false,
          });
        },
      },
    }),
    /Not ready: do not deliver this AAB/u,
  );
  assert.equal(
    await lstat(context.outputPath).catch(() => undefined),
    undefined,
  );

  await assert.rejects(
    createNativeReleaseManifest({
      ...createOptions,
      dependencies: {
        async verifyAndroidBundleSigning() {
          return signingReport(context.artifactPath, context.artifact, {
            artifact: { ...context.artifact, sha256: "00".repeat(32) },
          });
        },
      },
    }),
    /changed between release hashing and signing verification/u,
  );
  assert.equal(
    await lstat(context.outputPath).catch(() => undefined),
    undefined,
  );
});

test("binds and reverifies an exact Android APK signer set", async (t) => {
  const context = await fixture(t, "app-release.apk");
  const rotatedCertificateSha256 = "3c".repeat(32);
  const certificateSha256s = [
    rotatedCertificateSha256,
    UPLOAD_CERTIFICATE_SHA256,
  ].sort();
  const calls = [];
  const verifyAndroidApkSigning = async (options) => {
    calls.push(options);
    return apkSigningReport(
      context.artifactPath,
      context.artifact,
      certificateSha256s,
    );
  };
  const createOptions = {
    cwd: NATIVE_E2E_CWD,
    artifactPath: context.artifactPath,
    bundleManifestPath: context.bundleManifestPath,
    release: "1.0.0+2",
    channel: "production",
    sourceRevision: "abcdef0123456789abcdef0123456789abcdef02",
    outputPath: context.outputPath,
    androidSigningCertificateSha256s: certificateSha256s,
    dependencies: { verifyAndroidApkSigning },
  };

  const created = await createNativeReleaseManifest(createOptions);
  assert.deepEqual(created.manifest.artifactSigning, {
    scheme: "android-apk",
    certificateSha256s,
  });
  assert.equal(nativeReleaseFingerprintMatches(created.manifest), true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].expectedCertificateSha256s, certificateSha256s);

  const verified = await verifyNativeReleaseManifest({
    cwd: createOptions.cwd,
    manifestPath: context.outputPath,
    bundleManifestPath: context.bundleManifestPath,
    artifactPath: context.artifactPath,
    dependencies: { verifyAndroidApkSigning },
  });
  assert.equal(verified.ok, true);
  assert.equal(
    verified.checks.find((entry) => entry.id === "artifact-signing")?.status,
    "pass",
  );
  assert.equal(calls.length, 2);

  const malformed = JSON.parse(await readFile(context.outputPath, "utf8"));
  malformed.artifactSigning.certificateSha256s.reverse();
  await writeFile(context.outputPath, `${JSON.stringify(malformed)}\n`);
  await assert.rejects(
    readNativeReleaseManifest(context.outputPath),
    /invalid artifact-signing identity/u,
  );
});

test("does not create an envelope for failed Android APK signing proof", async (t) => {
  const context = await fixture(t, "app-release.apk");
  await assert.rejects(
    createNativeReleaseManifest({
      cwd: NATIVE_E2E_CWD,
      artifactPath: context.artifactPath,
      bundleManifestPath: context.bundleManifestPath,
      release: "1.0.0+2",
      channel: "production",
      sourceRevision: "abcdef0123456789abcdef0123456789abcdef02",
      outputPath: context.outputPath,
      androidSigningCertificateSha256s: [UPLOAD_CERTIFICATE_SHA256],
      dependencies: {
        async verifyAndroidApkSigning() {
          return apkSigningReport(
            context.artifactPath,
            context.artifact,
            [UPLOAD_CERTIFICATE_SHA256],
            false,
          );
        },
      },
    }),
    /Not ready: do not deliver this APK/u,
  );
  assert.equal(
    await lstat(context.outputPath).catch(() => undefined),
    undefined,
  );
});
