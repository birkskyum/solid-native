import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  createHash,
  generateKeyPairSync,
  sign as signEd25519,
  verify as verifyEd25519,
} from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  assembleNativeDeviceProofSignature,
  createNativeDeviceProofIngestion,
  createNativeDeviceProofSignature,
  createNativeDeviceProofSigningRequest,
  createNativeReleaseDeviceCorrelation,
  createNativeReleaseManifest,
  createNativeReleaseSignature,
  formatNativeDeviceProofIngestion,
  formatNativeDeviceProofSignatureVerification,
  nativeDeviceProofProfileFingerprint,
  formatNativeReleaseDeviceCorrelation,
  inspectNativeDeviceProofProfile,
  nativeDeviceProofTrustPolicyFingerprint,
  parseNativeDeviceProofReceipt,
  readNativeDeviceProofReceipt,
  readNativeDeviceProofSignature,
  readNativeDeviceProofSigningRequest,
  readNativeDeviceProofTrustPolicy,
  verifyNativeDeviceProofSignature,
  writeNativeBundleManifest,
} from "../dist/index.js";

const RETAINED_PROOF = fileURLToPath(
  new URL(
    "../../../apps/native-e2e/device-proofs/android-solid-release-pixel-9a-024de1d.json",
    import.meta.url,
  ),
);
const PORTABLE_RETAINED_PROOF = fileURLToPath(
  new URL(
    "../../../apps/native-e2e/device-proofs/android-solid-release-pixel-9a-9f067da.json",
    import.meta.url,
  ),
);
const PORTABLE_RETAINED_PROOF_SHA256 =
  "665049c82c79414e36fc26498d65aaf6380d1530966fa78fc6bd60b42fdddde7";
const PORTABLE_RETAINED_PROFILE =
  "sha256:f2b45f73e953ca0b7459314a7deba3acb8fc1c329d72ea70ced2729e8546a309";
const RETAINED_PROOF_SHA256 =
  "000f358ee4118723333051119706f690c8ca5249c3568029fa758b3e5fc37e27";
const RETAINED_SOURCE_REVISION = "024de1df3558d1c910ea9add17fba0f448fd7749";
const RETAINED_NATIVE_FINGERPRINT =
  "sha256:69e24aee8f270bfd9c31e2b0ef7953073008b04f7b1165d8abe6735721a6a13f";
const RETAINED_APPLICATION_SHA256 =
  "d6732daf9b2a15a5d1f121c942bafe37bedce8898e1a889f40aad385c8e2b1e9";
const RETAINED_MEASURED_AT = "2026-08-24T19:33:41.764Z";
const execFileAsync = promisify(execFile);
const CLI = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
const NATIVE_E2E_ROOT = fileURLToPath(
  new URL("../../../apps/native-e2e/", import.meta.url),
);

async function fixture(t) {
  const directory = await mkdtemp(
    path.join(tmpdir(), "solid-native-device-proof-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPath = path.join(directory, "device-proof-private.pem");
  const publicKeyPath = path.join(directory, "device-proof-public.pem");
  const proofPath = path.join(directory, "android-device-proof.json");
  await Promise.all([
    writeFile(
      privateKeyPath,
      privateKey.export({ format: "pem", type: "pkcs8" }),
      { mode: 0o600 },
    ),
    writeFile(
      publicKeyPath,
      publicKey.export({ format: "pem", type: "spki" }),
      { mode: 0o644 },
    ),
    writeFile(proofPath, await readFile(RETAINED_PROOF)),
  ]);
  return {
    directory,
    privateKey,
    privateKeyPath,
    proofPath,
    publicKey,
    publicKeyPath,
  };
}

async function portableReceipt() {
  const receipt = JSON.parse(await readFile(RETAINED_PROOF, "utf8"));
  const legacySourceMap = receipt.bundle;
  receipt.schemaVersion = 1;
  receipt.bundle = {
    bytes: 43,
    sha256: "b".repeat(64),
  };
  receipt.sourceMap = {
    ...legacySourceMap,
    checks: [
      {
        kind: "required-source",
        matches: 1,
        pattern: "app:///src/physical-device-test.tsx",
      },
      {
        kind: "forbidden-fragment",
        matches: 0,
        pattern: "/node_modules/react/",
      },
    ],
  };
  receipt.instrumentation.className =
    "com.example.product.SolidNativeReleaseTest";
  receipt.instrumentation.testName = "testProductionRenderer";
  return receipt;
}

async function correlationFixture(t) {
  const context = await fixture(t);
  const assetsDirectory = path.join(context.directory, "assets");
  const bundlePath = path.join(context.directory, "index.android.bundle");
  const sourceMapPath = `${bundlePath}.map`;
  const bundleManifestPath = path.join(
    context.directory,
    "solid-native-bundle.json",
  );
  const artifactPath = path.join(context.directory, "app-release.apk");
  const releaseManifestPath = path.join(
    context.directory,
    "solid-native-release.json",
  );
  const releasePrivateKeyPath = path.join(
    context.directory,
    "release-private.pem",
  );
  const releasePublicKeyPath = path.join(
    context.directory,
    "release-public.pem",
  );
  const releaseSignaturePath = path.join(context.directory, "release.sig.json");
  const releaseTrustPolicyPath = path.join(
    context.directory,
    "release-trust-policy.json",
  );
  const deviceTrustPolicyPath = path.join(
    context.directory,
    "device-trust-policy.json",
  );
  const sourceRevision = "0123456789abcdef0123456789abcdef01234567";
  const bundleBytes = Buffer.from("globalThis.__correlatedRelease = true;\n");
  const artifactBytes = Buffer.from("correlated Android artifact bytes\n");
  await mkdir(assetsDirectory);
  await Promise.all([
    writeFile(bundlePath, bundleBytes),
    writeFile(
      sourceMapPath,
      JSON.stringify({
        version: 3,
        sources: ["app:///index.tsx"],
        sourcesContent: [bundleBytes.toString("utf8")],
        names: [],
        mappings: "",
      }),
    ),
    writeFile(artifactPath, artifactBytes),
  ]);
  const bundleManifest = await writeNativeBundleManifest({
    platform: "android",
    entryPoint: "index.tsx",
    outputDirectory: context.directory,
    bundlePath,
    sourceMapPath,
    assetsDirectory,
    manifestPath: bundleManifestPath,
  });
  const release = await createNativeReleaseManifest({
    cwd: NATIVE_E2E_ROOT,
    bundleManifestPath,
    artifactPath,
    release: "3.0.0-correlation.1",
    channel: "device-lab",
    sourceRevision,
    outputPath: releaseManifestPath,
  });

  const receipt = await portableReceipt();
  receipt.source.revision = sourceRevision;
  receipt.nativeCompatibility.fingerprint =
    release.manifest.nativeCompatibilityFingerprint;
  receipt.bundle = {
    bytes: bundleManifest.artifacts.bundle.bytes,
    sha256: bundleManifest.artifacts.bundle.sha256,
  };
  receipt.sourceMap.bytes = bundleManifest.artifacts.sourceMap.bytes;
  receipt.sourceMap.sha256 = bundleManifest.artifacts.sourceMap.sha256;
  receipt.artifacts.applicationApk = {
    bytes: artifactBytes.length,
    sha256: createHash("sha256").update(artifactBytes).digest("hex"),
  };
  await writeFile(context.proofPath, `${JSON.stringify(receipt, null, 2)}\n`);

  const { privateKey: releasePrivateKey, publicKey: releasePublicKey } =
    generateKeyPairSync("ed25519");
  await Promise.all([
    writeFile(
      releasePrivateKeyPath,
      releasePrivateKey.export({ format: "pem", type: "pkcs8" }),
      { mode: 0o600 },
    ),
    writeFile(
      releasePublicKeyPath,
      releasePublicKey.export({ format: "pem", type: "spki" }),
    ),
    writeFile(
      releaseTrustPolicyPath,
      `${JSON.stringify({
        schemaVersion: 0,
        policySequence: 4,
        projectName: release.manifest.projectName,
        platform: "android",
        channel: release.manifest.channel,
        keys: [
          {
            keyId: "release-correlation-2026-08",
            algorithm: "ed25519",
            publicKeySpki: releasePublicKey
              .export({ format: "der", type: "spki" })
              .toString("base64url"),
            status: "active",
          },
        ],
      })}\n`,
    ),
    writeFile(
      deviceTrustPolicyPath,
      `${JSON.stringify({
        schemaVersion: 1,
        policySequence: 3,
        projectName: release.manifest.projectName,
        proof: "solid-native-android-release-device",
        profileFingerprint: nativeDeviceProofProfileFingerprint(
          parseNativeDeviceProofReceipt(receipt),
        ),
        keys: [
          {
            keyId: "device-correlation-2026-08",
            algorithm: "ed25519",
            publicKeySpki: context.publicKey
              .export({ format: "der", type: "spki" })
              .toString("base64url"),
            status: "active",
          },
        ],
      })}\n`,
    ),
  ]);
  const releaseSignature = await createNativeReleaseSignature({
    cwd: NATIVE_E2E_ROOT,
    manifestPath: releaseManifestPath,
    bundleManifestPath,
    artifactPath,
    privateKeyPath: releasePrivateKeyPath,
    keyId: "release-correlation-2026-08",
    outputPath: releaseSignaturePath,
  });
  const deviceSignature = await createNativeDeviceProofSignature({
    proofPath: context.proofPath,
    privateKeyPath: context.privateKeyPath,
    keyId: "device-correlation-2026-08",
    projectName: release.manifest.projectName,
  });

  return {
    ...context,
    receipt,
    release,
    releaseTrustPolicyPath,
    deviceTrustPolicyPath,
    releaseOptions: {
      cwd: NATIVE_E2E_ROOT,
      manifestPath: releaseManifestPath,
      signaturePath: releaseSignature.signaturePath,
      bundleManifestPath,
      artifactPath,
      publicKeyPath: releasePublicKeyPath,
      expectedKeyId: "release-correlation-2026-08",
      policy: {
        projectName: release.manifest.projectName,
        platform: "android",
        channel: release.manifest.channel,
      },
    },
    deviceProofOptions: {
      proofPath: context.proofPath,
      signaturePath: deviceSignature.signaturePath,
      publicKeyPath: context.publicKeyPath,
      expectedKeyId: "device-correlation-2026-08",
      projectName: release.manifest.projectName,
      expectedProfileFingerprint: nativeDeviceProofProfileFingerprint(
        parseNativeDeviceProofReceipt(receipt),
      ),
    },
  };
}

test("strictly parses the retained clean physical Android proof", async () => {
  const source = await readFile(RETAINED_PROOF);
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    RETAINED_PROOF_SHA256,
  );
  const receipt = parseNativeDeviceProofReceipt(
    JSON.parse(source.toString("utf8")),
  );
  assert.equal(receipt.source.dirty, false);
  assert.equal(receipt.device.kind, "physical");
  assert.equal(receipt.device.model, "Pixel 9a");
  assert.equal(receipt.measuredAt, RETAINED_MEASURED_AT);
  assert.equal(receipt.bundle.sourceCount, 664);
  assert.deepEqual(await readNativeDeviceProofReceipt(RETAINED_PROOF), receipt);

  const unknownField = structuredClone(receipt);
  unknownField.localPath = "/private/build/app.apk";
  assert.throws(
    () => parseNativeDeviceProofReceipt(unknownField),
    /unexpected or missing fields/u,
  );
  const sourcePolicyDrift = structuredClone(receipt);
  sourcePolicyDrift.bundle.checks[0].matches = 2;
  assert.throws(
    () => parseNativeDeviceProofReceipt(sourcePolicyDrift),
    /source policy drifted/u,
  );
});

test("retains the current schema-1 physical Android proof", async () => {
  const source = await readFile(PORTABLE_RETAINED_PROOF);
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    PORTABLE_RETAINED_PROOF_SHA256,
  );
  const receipt = parseNativeDeviceProofReceipt(
    JSON.parse(source.toString("utf8")),
  );
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(
    receipt.source.revision,
    "9f067dad306842b42155a237b1a9e61f73e18243",
  );
  assert.equal(receipt.source.dirty, false);
  assert.equal(receipt.device.model, "Pixel 9a");
  assert.equal(
    receipt.bundle.sha256,
    "b25177d6870c2a5e17f6cbb3ff6e6fce2ea0b72c84f0d3ee8d0250d49eae460d",
  );
  assert.equal(
    receipt.sourceMap.sha256,
    "c66a99e8dd8a05baa6c4db0131b08dc9e1415ac93c23c9475ecab68b3d157a04",
  );
  assert.equal(receipt.sourceMap.sourceCount, 664);
  assert.equal(
    nativeDeviceProofProfileFingerprint(receipt),
    PORTABLE_RETAINED_PROFILE,
  );
  assert.deepEqual(
    await readNativeDeviceProofReceipt(PORTABLE_RETAINED_PROOF),
    receipt,
  );
});

test("parses portable receipts under an order-independent verification profile", async () => {
  const portable = await portableReceipt();
  const receipt = parseNativeDeviceProofReceipt(portable);
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(
    receipt.instrumentation.className,
    "com.example.product.SolidNativeReleaseTest",
  );
  const profileFingerprint = nativeDeviceProofProfileFingerprint(receipt);
  assert.match(profileFingerprint, /^sha256:[a-f0-9]{64}$/u);

  const reordered = structuredClone(portable);
  reordered.sourceMap.checks.reverse();
  assert.equal(
    nativeDeviceProofProfileFingerprint(
      parseNativeDeviceProofReceipt(reordered),
    ),
    profileFingerprint,
  );
  for (const invalid of [
    { ...portable, sourceMap: { ...portable.sourceMap, checks: [] } },
    {
      ...portable,
      sourceMap: {
        ...portable.sourceMap,
        checks: [portable.sourceMap.checks[0], portable.sourceMap.checks[0]],
      },
    },
    {
      ...portable,
      sourceMap: {
        ...portable.sourceMap,
        checks: [
          {
            kind: "required-source",
            matches: 0,
            pattern: "app:///src/physical-device-test.tsx",
          },
        ],
      },
    },
    {
      ...portable,
      sourceMap: {
        ...portable.sourceMap,
        checks: [portable.sourceMap.checks[1]],
      },
    },
    {
      ...portable,
      instrumentation: {
        ...portable.instrumentation,
        className: "not-a-java-class",
      },
    },
  ]) {
    assert.throws(
      () => parseNativeDeviceProofReceipt(invalid),
      /source policy|source check|test identity/u,
    );
  }
});

test("requires explicit verification-profile trust for portable receipts", async (t) => {
  const context = await fixture(t);
  const portable = await portableReceipt();
  await writeFile(context.proofPath, `${JSON.stringify(portable, null, 2)}\n`);
  const profileFingerprint = nativeDeviceProofProfileFingerprint(
    parseNativeDeviceProofReceipt(portable),
  );
  const inspectedProfile = inspectNativeDeviceProofProfile(
    parseNativeDeviceProofReceipt(portable),
  );
  assert.equal(Object.isFrozen(inspectedProfile), true);
  assert.equal(Object.isFrozen(inspectedProfile.instrumentation), true);
  assert.equal(Object.isFrozen(inspectedProfile.sourcePolicy), true);
  assert.equal(inspectedProfile.profileFingerprint, profileFingerprint);
  const cliProfile = JSON.parse(
    (
      await execFileAsync(CLI, [
        "device-proof",
        "profile",
        context.proofPath,
        "--json",
      ])
    ).stdout,
  );
  assert.deepEqual(cliProfile, inspectedProfile);
  const created = await createNativeDeviceProofSignature({
    proofPath: context.proofPath,
    privateKeyPath: context.privateKeyPath,
    keyId: "portable-device-lab",
    projectName: "portable-product",
  });
  const pinnedOptions = {
    proofPath: context.proofPath,
    signaturePath: created.signaturePath,
    publicKeyPath: context.publicKeyPath,
    expectedKeyId: "portable-device-lab",
    projectName: "portable-product",
  };
  const unprofiled = await verifyNativeDeviceProofSignature(pinnedOptions);
  assert.equal(unprofiled.ok, false);
  assert.equal(
    unprofiled.checks.find((entry) => entry.id === "profile").status,
    "fail",
  );
  assert.equal(unprofiled.authenticatedProof, undefined);

  const profiled = await verifyNativeDeviceProofSignature({
    ...pinnedOptions,
    expectedProfileFingerprint: profileFingerprint,
  });
  assert.equal(profiled.ok, true);
  assert.equal(profiled.authenticatedProof.receiptSchemaVersion, 1);
  assert.equal(
    profiled.authenticatedProof.profileFingerprint,
    profileFingerprint,
  );
  assert.equal(profiled.policy.expectedProfileFingerprint, profileFingerprint);
  const cliProfiled = JSON.parse(
    (
      await execFileAsync(CLI, [
        "device-proof",
        "verify-signature",
        created.signaturePath,
        "--proof",
        context.proofPath,
        "--public-key",
        context.publicKeyPath,
        "--key-id",
        "portable-device-lab",
        "--project",
        "portable-product",
        "--profile-fingerprint",
        profileFingerprint,
        "--json",
      ])
    ).stdout,
  );
  assert.equal(cliProfiled.ok, true);
  assert.equal(
    cliProfiled.authenticatedProof.profileFingerprint,
    profileFingerprint,
  );

  const trustPolicyPath = path.join(
    context.directory,
    "portable-device-trust-policy.json",
  );
  const policy = {
    schemaVersion: 1,
    policySequence: 1,
    projectName: "portable-product",
    proof: "solid-native-android-release-device",
    profileFingerprint,
    keys: [
      {
        keyId: "portable-device-lab",
        algorithm: "ed25519",
        publicKeySpki: context.publicKey
          .export({ format: "der", type: "spki" })
          .toString("base64url"),
        status: "active",
      },
    ],
  };
  await writeFile(trustPolicyPath, `${JSON.stringify(policy)}\n`);
  const parsedPolicy = await readNativeDeviceProofTrustPolicy(trustPolicyPath);
  assert.equal(parsedPolicy.schemaVersion, 1);
  assert.equal(parsedPolicy.profileFingerprint, profileFingerprint);
  assert.match(
    nativeDeviceProofTrustPolicyFingerprint(parsedPolicy),
    /^sha256:[a-f0-9]{64}$/u,
  );
  const policyVerified = await verifyNativeDeviceProofSignature({
    proofPath: context.proofPath,
    signaturePath: created.signaturePath,
    trustPolicyPath,
    minimumTrustPolicySequence: 1,
  });
  assert.equal(policyVerified.ok, true);

  const legacyPolicyPath = path.join(
    context.directory,
    "legacy-device-trust-policy.json",
  );
  await writeFile(
    legacyPolicyPath,
    `${JSON.stringify({ ...policy, schemaVersion: 0, profileFingerprint: undefined })}\n`,
  );
  const legacyPolicyVerification = await verifyNativeDeviceProofSignature({
    proofPath: context.proofPath,
    signaturePath: created.signaturePath,
    trustPolicyPath: legacyPolicyPath,
  });
  assert.equal(legacyPolicyVerification.ok, false);
  assert.equal(
    legacyPolicyVerification.checks.find((entry) => entry.id === "profile")
      .status,
    "fail",
  );
  const legacyPolicyWithProfile = await verifyNativeDeviceProofSignature({
    proofPath: context.proofPath,
    signaturePath: created.signaturePath,
    trustPolicyPath: legacyPolicyPath,
    expectedProfileFingerprint: profileFingerprint,
  });
  assert.equal(legacyPolicyWithProfile.ok, true);
  await assert.rejects(
    verifyNativeDeviceProofSignature({
      proofPath: context.proofPath,
      signaturePath: created.signaturePath,
      trustPolicyPath,
      expectedProfileFingerprint: `sha256:${"0".repeat(64)}`,
    }),
    /explicit device-proof profile conflicts/u,
  );

  await writeFile(
    trustPolicyPath,
    `${JSON.stringify({ ...policy, profileFingerprint: undefined })}\n`,
  );
  await assert.rejects(
    readNativeDeviceProofTrustPolicy(trustPolicyPath),
    /unexpected or missing fields/u,
  );
  await writeFile(trustPolicyPath, `${JSON.stringify(policy)}\n`);

  const changedProfile = structuredClone(portable);
  changedProfile.instrumentation.testName = "testTrivialRenderer";
  await writeFile(
    context.proofPath,
    `${JSON.stringify(changedProfile, null, 2)}\n`,
  );
  const changedSignature = await createNativeDeviceProofSignature({
    proofPath: context.proofPath,
    privateKeyPath: context.privateKeyPath,
    keyId: "portable-device-lab",
    projectName: "portable-product",
  });
  const rejected = await verifyNativeDeviceProofSignature({
    proofPath: context.proofPath,
    signaturePath: changedSignature.signaturePath,
    trustPolicyPath,
  });
  assert.equal(rejected.ok, false);
  assert.equal(
    rejected.checks.find((entry) => entry.id === "profile").status,
    "fail",
  );
});

test("signs exact clean proof bytes under a device-specific Ed25519 context", async (t) => {
  const context = await fixture(t);
  const first = await createNativeDeviceProofSignature({
    proofPath: context.proofPath,
    privateKeyPath: context.privateKeyPath,
    keyId: "device-lab-2026-08",
    projectName: "solid-native",
    outputPath: path.join(context.directory, "device-proof.sig.json"),
  });
  const second = await createNativeDeviceProofSignature({
    proofPath: context.proofPath,
    privateKeyPath: context.privateKeyPath,
    keyId: "device-lab-2026-08",
    projectName: "solid-native",
    outputPath: path.join(context.directory, "device-proof-2.sig.json"),
  });
  assert.deepEqual(first.signature, second.signature);
  assert.equal(first.signature.proofSha256, `sha256:${RETAINED_PROOF_SHA256}`);
  assert.equal(first.receipt.source.dirty, false);
  assert.ok(!JSON.stringify(first.signature).includes(context.directory));
  assert.deepEqual(
    await readNativeDeviceProofSignature(first.signaturePath),
    first.signature,
  );

  const releaseStatement = {
    schemaVersion: 0,
    algorithm: "ed25519",
    keyId: first.signature.keyId,
    releaseFingerprint: first.signature.proofSha256,
  };
  assert.equal(
    verifyEd25519(
      null,
      Buffer.from(
        `solid-native.release-signature.v0\0${JSON.stringify(releaseStatement)}`,
      ),
      context.publicKey,
      Buffer.from(first.signature.signature, "base64url"),
    ),
    false,
  );

  const dirty = JSON.parse(await readFile(context.proofPath, "utf8"));
  dirty.source.dirty = true;
  await writeFile(context.proofPath, `${JSON.stringify(dirty)}\n`);
  await assert.rejects(
    createNativeDeviceProofSignature({
      proofPath: context.proofPath,
      privateKeyPath: context.privateKeyPath,
      keyId: "device-lab-2026-08",
      projectName: "solid-native",
    }),
    /dirty-checkout/u,
  );
});

test("authenticates only matching proof, key, and project policy", async (t) => {
  const context = await fixture(t);
  const created = await createNativeDeviceProofSignature({
    proofPath: context.proofPath,
    privateKeyPath: context.privateKeyPath,
    keyId: "device-lab-2026-08",
    projectName: "solid-native",
  });
  const options = {
    proofPath: context.proofPath,
    signaturePath: created.signaturePath,
    publicKeyPath: context.publicKeyPath,
    expectedKeyId: "device-lab-2026-08",
    projectName: "solid-native",
    expectedProofSha256: `sha256:${RETAINED_PROOF_SHA256}`,
    expectedSourceRevision: RETAINED_SOURCE_REVISION,
    expectedNativeCompatibilityFingerprint: RETAINED_NATIVE_FINGERPRINT,
    expectedApplicationArtifactSha256: RETAINED_APPLICATION_SHA256,
    minimumMeasuredAt: "2026-08-24T19:33:41.000Z",
    maximumMeasuredAt: "2026-08-24T19:33:42.000Z",
  };
  const valid = await verifyNativeDeviceProofSignature(options);
  assert.equal(valid.ok, true);
  assert.equal(
    valid.authenticatedProof.sourceRevision,
    RETAINED_SOURCE_REVISION,
  );
  assert.equal(valid.authenticatedProof.deviceModel, "Pixel 9a");
  assert.equal(valid.authenticatedProof.receiptSchemaVersion, 0);
  assert.equal(
    valid.authenticatedProof.profileFingerprint,
    nativeDeviceProofProfileFingerprint(
      await readNativeDeviceProofReceipt(context.proofPath),
    ),
  );
  assert.deepEqual(valid.policy, {
    projectName: "solid-native",
    expectedProofSha256: `sha256:${RETAINED_PROOF_SHA256}`,
    expectedSourceRevision: RETAINED_SOURCE_REVISION,
    expectedNativeCompatibilityFingerprint: RETAINED_NATIVE_FINGERPRINT,
    expectedApplicationArtifactSha256: RETAINED_APPLICATION_SHA256,
    minimumMeasuredAt: "2026-08-24T19:33:41.000Z",
    maximumMeasuredAt: "2026-08-24T19:33:42.000Z",
  });
  assert.equal(Object.isFrozen(valid.policy), true);
  assert.match(
    formatNativeDeviceProofSignatureVerification(valid),
    /^PASS device proof/u,
  );

  const wrongKey = await verifyNativeDeviceProofSignature({
    ...options,
    expectedKeyId: "different-device-lab",
  });
  assert.equal(wrongKey.ok, false);
  assert.equal(wrongKey.authenticatedProof, undefined);
  assert.equal(
    wrongKey.checks.find((entry) => entry.id === "key").status,
    "fail",
  );
  const wrongProject = await verifyNativeDeviceProofSignature({
    ...options,
    projectName: "another-project",
  });
  assert.equal(wrongProject.ok, false);
  assert.equal(
    wrongProject.checks.find((entry) => entry.id === "policy").status,
    "fail",
  );

  const wrongArtifact = await verifyNativeDeviceProofSignature({
    ...options,
    expectedApplicationArtifactSha256: "0".repeat(64),
  });
  assert.equal(wrongArtifact.ok, false);
  assert.equal(wrongArtifact.authenticatedProof, undefined);
  assert.equal(
    wrongArtifact.checks.find((entry) => entry.id === "lineage").status,
    "fail",
  );
  assert.match(
    wrongArtifact.checks.find((entry) => entry.id === "lineage").message,
    /application APK/u,
  );
  const replayedReceipt = await verifyNativeDeviceProofSignature({
    ...options,
    expectedProofSha256: `sha256:${"0".repeat(64)}`,
  });
  assert.equal(replayedReceipt.ok, false);
  assert.equal(replayedReceipt.authenticatedProof, undefined);
  assert.match(
    replayedReceipt.checks.find((entry) => entry.id === "lineage").message,
    /receipt digest/u,
  );
  const stale = await verifyNativeDeviceProofSignature({
    ...options,
    minimumMeasuredAt: "2026-08-24T19:33:41.765Z",
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.authenticatedProof, undefined);
  assert.equal(
    stale.checks.find((entry) => entry.id === "time-policy").status,
    "fail",
  );
  await assert.rejects(
    verifyNativeDeviceProofSignature({
      ...options,
      minimumMeasuredAt: "2026-08-24T19:33:42.000Z",
      maximumMeasuredAt: "2026-08-24T19:33:41.000Z",
    }),
    /minimum device-proof measurement time must not be after/u,
  );
  await assert.rejects(
    verifyNativeDeviceProofSignature({
      ...options,
      minimumMeasuredAt: "2026-08-24T19:33:41Z",
    }),
    /must be canonical UTC/u,
  );

  const changed = JSON.parse(await readFile(context.proofPath, "utf8"));
  changed.device.model = "Pixel 9 Pro";
  await writeFile(context.proofPath, `${JSON.stringify(changed)}\n`);
  const tampered = await verifyNativeDeviceProofSignature(options);
  assert.equal(tampered.ok, false);
  assert.equal(
    tampered.checks.find((entry) => entry.id === "signature").status,
    "fail",
  );

  const linkedProof = path.join(context.directory, "linked-proof.json");
  await symlink(context.proofPath, linkedProof);
  await assert.rejects(
    readNativeDeviceProofReceipt(linkedProof),
    /missing or unreadable/u,
  );

  if (process.platform !== "win32") {
    await chmod(context.privateKeyPath, 0o644);
    await assert.rejects(
      createNativeDeviceProofSignature({
        proofPath: context.proofPath,
        privateKeyPath: context.privateKeyPath,
        keyId: "device-lab-2026-08",
        projectName: "solid-native",
      }),
      /group or other users/u,
    );
  }
});

test("prepares a path-free authenticated device-proof ingestion", async (t) => {
  const context = await fixture(t);
  const created = await createNativeDeviceProofSignature({
    proofPath: context.proofPath,
    privateKeyPath: context.privateKeyPath,
    keyId: "device-lab-ingestion",
    projectName: "solid-native",
  });
  const options = {
    proofPath: context.proofPath,
    signaturePath: created.signaturePath,
    publicKeyPath: context.publicKeyPath,
    expectedKeyId: "device-lab-ingestion",
    projectName: "solid-native",
  };
  const ingestion = await createNativeDeviceProofIngestion(options);
  assert.equal(ingestion.schemaVersion, 0);
  assert.equal(ingestion.kind, "solid-native.device-proof-ingestion");
  assert.equal(ingestion.environment.platform, "android");
  assert.equal(ingestion.environment.device.model, "Pixel 9a");
  assert.equal(ingestion.inputs.bundle, undefined);
  assert.equal(ingestion.inputs.sourceMap.sourceCount, 664);
  assert.equal(
    ingestion.inputs.artifacts.applicationApk.sha256,
    ingestion.authenticatedProof.applicationArtifactSha256,
  );
  assert.equal(ingestion.execution.durationSeconds, 31.318);
  assert.equal(Object.isFrozen(ingestion), true);
  assert.equal(Object.isFrozen(ingestion.environment), true);
  assert.equal(Object.isFrozen(ingestion.environment.device), true);
  assert.equal(Object.isFrozen(ingestion.inputs), true);
  assert.equal(Object.isFrozen(ingestion.authenticatedProof), true);
  assert.equal(Object.isFrozen(ingestion.verificationPolicy), true);
  assert.deepEqual(ingestion.verificationPolicy, {
    projectName: "solid-native",
  });
  const serialized = JSON.stringify(ingestion);
  assert.ok(!serialized.includes(context.directory));
  assert.ok(!serialized.includes("serialSha256"));
  assert.ok(!serialized.includes('"signature"'));
  assert.match(
    formatNativeDeviceProofIngestion(ingestion),
    /selected observability or device-lab backend/u,
  );

  const changed = JSON.parse(await readFile(context.proofPath, "utf8"));
  changed.device.model = "Pixel 9 Pro";
  await writeFile(context.proofPath, `${JSON.stringify(changed)}\n`);
  await assert.rejects(
    createNativeDeviceProofIngestion(options),
    /unauthenticated device proof/u,
  );
});

test("correlates independently trusted release and physical-device lineage", async (t) => {
  const context = await correlationFixture(t);
  const options = {
    release: context.releaseOptions,
    deviceProof: {
      ...context.deviceProofOptions,
      minimumMeasuredAt: "2026-08-24T19:33:41.000Z",
      maximumMeasuredAt: "2026-08-24T19:33:42.000Z",
    },
  };
  const correlation = await createNativeReleaseDeviceCorrelation(options);
  assert.equal(correlation.schemaVersion, 0);
  assert.equal(correlation.kind, "solid-native.release-device-correlation");
  assert.deepEqual(correlation.identity, {
    projectName: context.release.manifest.projectName,
    platform: "android",
    sourceRevision: context.release.manifest.sourceRevision,
    nativeCompatibilityFingerprint:
      context.release.manifest.nativeCompatibilityFingerprint,
    bundleFingerprint: context.release.manifest.bundleFingerprint,
    javascriptBundleSha256: context.receipt.bundle.sha256,
    sourceMapSha256: context.receipt.sourceMap.sha256,
    applicationArtifactSha256: context.release.manifest.artifact.sha256,
  });
  assert.equal(correlation.authorizedRelease.inputsVerified, true);
  assert.equal(
    correlation.deviceProofIngestion.authenticatedProof
      .applicationArtifactSha256,
    correlation.authorizedRelease.artifactSha256,
  );
  assert.deepEqual(correlation.deviceProofIngestion.verificationPolicy, {
    projectName: context.release.manifest.projectName,
    expectedSourceRevision: context.release.manifest.sourceRevision,
    expectedNativeCompatibilityFingerprint:
      context.release.manifest.nativeCompatibilityFingerprint,
    expectedApplicationArtifactSha256: context.release.manifest.artifact.sha256,
    expectedProfileFingerprint:
      context.deviceProofOptions.expectedProfileFingerprint,
    minimumMeasuredAt: "2026-08-24T19:33:41.000Z",
    maximumMeasuredAt: "2026-08-24T19:33:42.000Z",
  });
  assert.equal(Object.isFrozen(correlation), true);
  assert.equal(Object.isFrozen(correlation.identity), true);
  assert.equal(Object.isFrozen(correlation.authorizedRelease), true);
  assert.equal(Object.isFrozen(correlation.deviceProofIngestion), true);
  const serialized = JSON.stringify(correlation);
  assert.ok(!serialized.includes(context.directory));
  assert.ok(!serialized.includes("serialSha256"));
  assert.ok(!serialized.includes('"signature"'));
  assert.match(
    formatNativeReleaseDeviceCorrelation(correlation),
    /^PASS Android release\/device correlation/u,
  );

  const cliArguments = [
    "release",
    "correlate-device-proof",
    context.releaseOptions.signaturePath,
    "--manifest",
    context.releaseOptions.manifestPath,
    "--bundle",
    context.releaseOptions.bundleManifestPath,
    "--artifact",
    context.releaseOptions.artifactPath,
    "--trust-policy",
    context.releaseTrustPolicyPath,
    "--minimum-policy-sequence",
    "4",
    "--device-signature",
    context.deviceProofOptions.signaturePath,
    "--proof",
    context.deviceProofOptions.proofPath,
    "--device-trust-policy",
    context.deviceTrustPolicyPath,
    "--device-minimum-policy-sequence",
    "3",
    "--proof-sha256",
    correlation.deviceProofIngestion.authenticatedProof.proofSha256,
    "--minimum-measured-at",
    "2026-08-24T19:33:41.000Z",
    "--maximum-measured-at",
    "2026-08-24T19:33:42.000Z",
    "--cwd",
    NATIVE_E2E_ROOT,
    "--json",
  ];
  const cliCorrelation = JSON.parse(
    (await execFileAsync(CLI, cliArguments)).stdout,
  );
  assert.deepEqual(cliCorrelation.identity, correlation.identity);
  assert.equal(cliCorrelation.authorizedRelease.trustPolicySequence, 4);
  assert.equal(
    cliCorrelation.deviceProofIngestion.authenticatedProof.trustPolicySequence,
    3,
  );
  await assert.rejects(
    execFileAsync(CLI, [
      ...cliArguments.slice(0, -1),
      "--device-minimum-policy-sequence",
      "4",
      "--json",
    ]),
    /device proof trust policy sequence is older/u,
  );

  await assert.rejects(
    createNativeReleaseDeviceCorrelation({
      ...options,
      deviceProof: {
        ...options.deviceProof,
        expectedSourceRevision: context.release.manifest.sourceRevision,
      },
    }),
    /is derived from the authorized release/u,
  );

  const mismatchedReceipt = structuredClone(context.receipt);
  mismatchedReceipt.source.revision = "f".repeat(40);
  await writeFile(
    context.proofPath,
    `${JSON.stringify(mismatchedReceipt, null, 2)}\n`,
  );
  const mismatchedSignature = await createNativeDeviceProofSignature({
    proofPath: context.proofPath,
    privateKeyPath: context.privateKeyPath,
    keyId: "device-correlation-2026-08",
    projectName: context.release.manifest.projectName,
  });
  await assert.rejects(
    createNativeReleaseDeviceCorrelation({
      release: context.releaseOptions,
      deviceProof: {
        ...context.deviceProofOptions,
        signaturePath: mismatchedSignature.signaturePath,
      },
    }),
    /source revision does not match/u,
  );

  await writeFile(
    context.proofPath,
    `${JSON.stringify(context.receipt, null, 2)}\n`,
  );
  const crossProjectSignature = await createNativeDeviceProofSignature({
    proofPath: context.proofPath,
    privateKeyPath: context.privateKeyPath,
    keyId: "device-correlation-2026-08",
    projectName: "another-project",
  });
  await assert.rejects(
    createNativeReleaseDeviceCorrelation({
      release: context.releaseOptions,
      deviceProof: {
        ...context.deviceProofOptions,
        signaturePath: crossProjectSignature.signaturePath,
        projectName: "another-project",
      },
    }),
    /different project identities/u,
  );

  const crossBundleReceipt = structuredClone(context.receipt);
  crossBundleReceipt.bundle.sha256 = "a".repeat(64);
  await writeFile(
    context.proofPath,
    `${JSON.stringify(crossBundleReceipt, null, 2)}\n`,
  );
  const crossBundleSignature = await createNativeDeviceProofSignature({
    proofPath: context.proofPath,
    privateKeyPath: context.privateKeyPath,
    keyId: "device-correlation-2026-08",
    projectName: context.release.manifest.projectName,
  });
  await assert.rejects(
    createNativeReleaseDeviceCorrelation({
      release: context.releaseOptions,
      deviceProof: {
        ...context.deviceProofOptions,
        signaturePath: crossBundleSignature.signaturePath,
      },
    }),
    /different JavaScript bundle identities/u,
  );

  const crossSourceMapReceipt = structuredClone(context.receipt);
  crossSourceMapReceipt.sourceMap.sha256 = "c".repeat(64);
  await writeFile(
    context.proofPath,
    `${JSON.stringify(crossSourceMapReceipt, null, 2)}\n`,
  );
  const crossSourceMapSignature = await createNativeDeviceProofSignature({
    proofPath: context.proofPath,
    privateKeyPath: context.privateKeyPath,
    keyId: "device-correlation-2026-08",
    projectName: context.release.manifest.projectName,
  });
  await assert.rejects(
    createNativeReleaseDeviceCorrelation({
      release: context.releaseOptions,
      deviceProof: {
        ...context.deviceProofOptions,
        signaturePath: crossSourceMapSignature.signaturePath,
      },
    }),
    /different source-map identities/u,
  );

  const legacyReceipt = JSON.parse(await readFile(RETAINED_PROOF, "utf8"));
  legacyReceipt.source.revision = context.release.manifest.sourceRevision;
  legacyReceipt.nativeCompatibility.fingerprint =
    context.release.manifest.nativeCompatibilityFingerprint;
  legacyReceipt.artifacts.applicationApk =
    context.receipt.artifacts.applicationApk;
  await writeFile(
    context.proofPath,
    `${JSON.stringify(legacyReceipt, null, 2)}\n`,
  );
  const legacySignature = await createNativeDeviceProofSignature({
    proofPath: context.proofPath,
    privateKeyPath: context.privateKeyPath,
    keyId: "device-correlation-2026-08",
    projectName: context.release.manifest.projectName,
  });
  await assert.rejects(
    createNativeReleaseDeviceCorrelation({
      release: context.releaseOptions,
      deviceProof: {
        proofPath: context.proofPath,
        signaturePath: legacySignature.signaturePath,
        publicKeyPath: context.publicKeyPath,
        expectedKeyId: "device-correlation-2026-08",
        projectName: context.release.manifest.projectName,
      },
    }),
    /Legacy device-proof receipts do not identify JavaScript bundle bytes/u,
  );
});

test("assembles externally signed device proofs without reading private keys", async (t) => {
  const context = await fixture(t);
  const first = await createNativeDeviceProofSigningRequest({
    proofPath: context.proofPath,
    keyId: "device-hsm-2026-08",
    projectName: "solid-native",
    outputPath: path.join(context.directory, "device-proof.request.json"),
  });
  const second = await createNativeDeviceProofSigningRequest({
    proofPath: context.proofPath,
    keyId: "device-hsm-2026-08",
    projectName: "solid-native",
    outputPath: path.join(context.directory, "device-proof-2.request.json"),
  });
  assert.deepEqual(first.request, second.request);
  assert.deepEqual(
    await readNativeDeviceProofSigningRequest(first.requestPath),
    first.request,
  );
  const payload = Buffer.from(first.request.payloadBase64url, "base64url");
  assert.equal(
    createHash("sha256").update(payload).digest("hex"),
    first.request.payloadSha256,
  );
  assert.ok(
    payload
      .toString("utf8")
      .startsWith("solid-native.device-proof-signature.v0\0"),
  );
  const detachedSignature = signEd25519(null, payload, context.privateKey);
  const detachedSignaturePath = path.join(
    context.directory,
    "device-proof.detached-signature.bin",
  );
  await writeFile(detachedSignaturePath, detachedSignature);
  const assembled = await assembleNativeDeviceProofSignature({
    requestPath: first.requestPath,
    detachedSignaturePath,
    publicKeyPath: context.publicKeyPath,
    outputPath: path.join(context.directory, "device-proof.assembled.sig.json"),
  });
  const direct = await createNativeDeviceProofSignature({
    proofPath: context.proofPath,
    privateKeyPath: context.privateKeyPath,
    keyId: "device-hsm-2026-08",
    projectName: "solid-native",
    outputPath: path.join(context.directory, "device-proof.direct.sig.json"),
  });
  assert.deepEqual(assembled.signature, direct.signature);
  assert.equal(
    (
      await verifyNativeDeviceProofSignature({
        proofPath: context.proofPath,
        signaturePath: assembled.signaturePath,
        publicKeyPath: context.publicKeyPath,
        expectedKeyId: "device-hsm-2026-08",
        projectName: "solid-native",
      })
    ).ok,
    true,
  );

  const other = generateKeyPairSync("ed25519");
  const otherPublicKeyPath = path.join(context.directory, "other-public.pem");
  await writeFile(
    otherPublicKeyPath,
    other.publicKey.export({ format: "pem", type: "spki" }),
  );
  await assert.rejects(
    assembleNativeDeviceProofSignature({
      requestPath: first.requestPath,
      detachedSignaturePath,
      publicKeyPath: otherPublicKeyPath,
    }),
    /does not authenticate/u,
  );

  const tamperedRequest = JSON.parse(await readFile(first.requestPath, "utf8"));
  tamperedRequest.projectName = "wrong-project";
  await writeFile(first.requestPath, `${JSON.stringify(tamperedRequest)}\n`);
  await assert.rejects(
    readNativeDeviceProofSigningRequest(first.requestPath),
    /payload does not match/u,
  );
});

test("rotates and revokes device-lab keys through a monotonic trust policy", async (t) => {
  const context = await fixture(t);
  const created = await createNativeDeviceProofSignature({
    proofPath: context.proofPath,
    privateKeyPath: context.privateKeyPath,
    keyId: "device-lab-active",
    projectName: "solid-native",
  });
  const rotated = generateKeyPairSync("ed25519");
  const activeSpki = context.publicKey
    .export({ format: "der", type: "spki" })
    .toString("base64url");
  const rotatedSpki = rotated.publicKey
    .export({ format: "der", type: "spki" })
    .toString("base64url");
  const trustPolicyPath = path.join(
    context.directory,
    "device-proof-trust-policy.json",
  );
  const policy = {
    schemaVersion: 0,
    policySequence: 7,
    projectName: "solid-native",
    proof: "solid-native-android-release-device",
    keys: [
      {
        keyId: "device-lab-rotated",
        algorithm: "ed25519",
        publicKeySpki: rotatedSpki,
        status: "active",
      },
      {
        keyId: "device-lab-active",
        algorithm: "ed25519",
        publicKeySpki: activeSpki,
        status: "active",
      },
    ],
  };
  await writeFile(trustPolicyPath, `${JSON.stringify(policy)}\n`);
  const parsedPolicy = await readNativeDeviceProofTrustPolicy(trustPolicyPath);
  assert.deepEqual(
    parsedPolicy.keys.map((entry) => entry.keyId),
    ["device-lab-active", "device-lab-rotated"],
  );
  const policyFingerprint =
    nativeDeviceProofTrustPolicyFingerprint(parsedPolicy);
  assert.equal(
    policyFingerprint,
    nativeDeviceProofTrustPolicyFingerprint({
      ...parsedPolicy,
      keys: [...parsedPolicy.keys].reverse(),
    }),
  );
  const options = {
    proofPath: context.proofPath,
    signaturePath: created.signaturePath,
    trustPolicyPath,
    minimumTrustPolicySequence: 7,
  };
  const valid = await verifyNativeDeviceProofSignature(options);
  assert.equal(valid.ok, true);
  assert.equal(valid.trustPolicyFingerprint, policyFingerprint);
  assert.equal(valid.trustPolicySequence, 7);
  assert.equal(
    valid.authenticatedProof.trustPolicyFingerprint,
    policyFingerprint,
  );
  assert.equal(valid.authenticatedProof.trustPolicySequence, 7);

  const cliVerified = await execFileAsync(process.execPath, [
    CLI,
    "device-proof",
    "verify-signature",
    created.signaturePath,
    "--proof",
    context.proofPath,
    "--trust-policy",
    trustPolicyPath,
    "--minimum-policy-sequence",
    "7",
    "--json",
  ]);
  assert.equal(JSON.parse(cliVerified.stdout).ok, true);
  const cliIngestion = await execFileAsync(process.execPath, [
    CLI,
    "device-proof",
    "ingestion",
    created.signaturePath,
    "--proof",
    context.proofPath,
    "--trust-policy",
    trustPolicyPath,
    "--minimum-policy-sequence",
    "7",
    "--json",
  ]);
  const parsedIngestion = JSON.parse(cliIngestion.stdout);
  assert.equal(parsedIngestion.kind, "solid-native.device-proof-ingestion");
  assert.equal(
    parsedIngestion.authenticatedProof.trustPolicyFingerprint,
    policyFingerprint,
  );
  assert.equal(parsedIngestion.authenticatedProof.trustPolicySequence, 7);
  await assert.rejects(
    execFileAsync(process.execPath, [
      CLI,
      "device-proof",
      "verify-signature",
      created.signaturePath,
      "--proof",
      context.proofPath,
      "--trust-policy",
      trustPolicyPath,
      "--public-key",
      context.publicKeyPath,
    ]),
    (error) => error.code === 2 && /cannot be combined/u.test(error.stderr),
  );

  const rollback = await verifyNativeDeviceProofSignature({
    ...options,
    minimumTrustPolicySequence: 8,
  });
  assert.equal(rollback.ok, false);
  assert.equal(
    rollback.checks.find((entry) => entry.id === "trust-policy").status,
    "fail",
  );
  assert.equal(rollback.authenticatedProof, undefined);
  await assert.rejects(
    execFileAsync(process.execPath, [
      CLI,
      "device-proof",
      "verify-signature",
      created.signaturePath,
      "--proof",
      context.proofPath,
      "--trust-policy",
      trustPolicyPath,
      "--minimum-policy-sequence",
      "8",
      "--json",
    ]),
    (error) => {
      assert.equal(error.code, 1);
      const failed = JSON.parse(error.stdout);
      assert.equal(failed.ok, false);
      assert.equal(
        failed.checks.find((entry) => entry.id === "trust-policy").status,
        "fail",
      );
      assert.equal(failed.authenticatedProof, undefined);
      return true;
    },
  );
  await assert.rejects(
    execFileAsync(process.execPath, [
      CLI,
      "device-proof",
      "verify-signature",
      created.signaturePath,
      "--proof",
      context.proofPath,
      "--trust-policy",
      trustPolicyPath,
      "--minimum-policy-sequence",
      "0",
    ]),
    (error) => error.code === 2 && /positive safe integer/u.test(error.stderr),
  );

  policy.keys[1].status = "revoked";
  await writeFile(trustPolicyPath, `${JSON.stringify(policy)}\n`);
  const revoked = await verifyNativeDeviceProofSignature({
    ...options,
    minimumTrustPolicySequence: 7,
  });
  assert.equal(revoked.ok, false);
  assert.equal(
    revoked.checks.find((entry) => entry.id === "key").status,
    "fail",
  );
  assert.match(
    revoked.checks.find((entry) => entry.id === "key").message,
    /revoked/u,
  );

  policy.keys = policy.keys.slice(0, 1);
  await writeFile(trustPolicyPath, `${JSON.stringify(policy)}\n`);
  const unknown = await verifyNativeDeviceProofSignature(options);
  assert.equal(unknown.ok, false);
  assert.match(
    unknown.checks.find((entry) => entry.id === "key").message,
    /absent/u,
  );

  policy.projectName = "wrong-project";
  policy.keys.push({
    keyId: "device-lab-active",
    algorithm: "ed25519",
    publicKeySpki: activeSpki,
    status: "active",
  });
  await writeFile(trustPolicyPath, `${JSON.stringify(policy)}\n`);
  const wrongProject = await verifyNativeDeviceProofSignature(options);
  assert.equal(wrongProject.ok, false);
  assert.equal(
    wrongProject.checks.find((entry) => entry.id === "policy").status,
    "fail",
  );

  policy.keys.push({ ...policy.keys[1], keyId: "duplicate-public-key" });
  await writeFile(trustPolicyPath, `${JSON.stringify(policy)}\n`);
  await assert.rejects(
    readNativeDeviceProofTrustPolicy(trustPolicyPath),
    /duplicates another public key/u,
  );

  policy.projectName = "solid-native";
  policy.keys = [
    {
      keyId: "duplicated-id",
      algorithm: "ed25519",
      publicKeySpki: activeSpki,
      status: "active",
    },
    {
      keyId: "duplicated-id",
      algorithm: "ed25519",
      publicKeySpki: rotatedSpki,
      status: "active",
    },
  ];
  await writeFile(trustPolicyPath, `${JSON.stringify(policy)}\n`);
  await assert.rejects(
    readNativeDeviceProofTrustPolicy(trustPolicyPath),
    /key ID duplicated-id is duplicated/u,
  );

  policy.keys = [
    {
      keyId: "malformed-key",
      algorithm: "ed25519",
      publicKeySpki: "not-an-spki",
      status: "active",
    },
  ];
  await writeFile(trustPolicyPath, `${JSON.stringify(policy)}\n`);
  await assert.rejects(
    readNativeDeviceProofTrustPolicy(trustPolicyPath),
    /canonical base64url/u,
  );

  policy.policySequence = 0;
  policy.keys[0].publicKeySpki = activeSpki;
  await writeFile(trustPolicyPath, `${JSON.stringify(policy)}\n`);
  await assert.rejects(
    readNativeDeviceProofTrustPolicy(trustPolicyPath),
    /sequence is invalid/u,
  );

  policy.policySequence = 8;
  await writeFile(trustPolicyPath, `${JSON.stringify(policy)}\n`);
  const policySymlink = path.join(context.directory, "trust-policy-link.json");
  await symlink(trustPolicyPath, policySymlink);
  await assert.rejects(
    readNativeDeviceProofTrustPolicy(policySymlink),
    /missing or unreadable/u,
  );
});

test("exposes device-proof signing and fail-closed verification through the CLI", async (t) => {
  const context = await fixture(t);
  const signaturePath = path.join(
    context.directory,
    "cli-device-proof.sig.json",
  );
  const signed = await execFileAsync(process.execPath, [
    CLI,
    "device-proof",
    "sign",
    context.proofPath,
    "--key",
    context.privateKeyPath,
    "--key-id",
    "device-lab-2026-08",
    "--project",
    "solid-native",
    "--output",
    signaturePath,
    "--json",
  ]);
  const signingResult = JSON.parse(signed.stdout);
  assert.equal(
    signingResult.signature.proofSha256,
    `sha256:${RETAINED_PROOF_SHA256}`,
  );

  const verified = await execFileAsync(process.execPath, [
    CLI,
    "device-proof",
    "verify-signature",
    signaturePath,
    "--proof",
    context.proofPath,
    "--public-key",
    context.publicKeyPath,
    "--key-id",
    "device-lab-2026-08",
    "--project",
    "solid-native",
    "--proof-sha256",
    `sha256:${RETAINED_PROOF_SHA256}`,
    "--revision",
    RETAINED_SOURCE_REVISION,
    "--native-fingerprint",
    RETAINED_NATIVE_FINGERPRINT,
    "--artifact-sha256",
    RETAINED_APPLICATION_SHA256,
    "--minimum-measured-at",
    "2026-08-24T19:33:41.000Z",
    "--maximum-measured-at",
    "2026-08-24T19:33:42.000Z",
    "--json",
  ]);
  const report = JSON.parse(verified.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.authenticatedProof.projectName, "solid-native");
  assert.equal(report.policy.expectedSourceRevision, RETAINED_SOURCE_REVISION);
  assert.equal(
    report.checks.find((entry) => entry.id === "lineage").status,
    "pass",
  );
  assert.equal(
    report.checks.find((entry) => entry.id === "time-policy").status,
    "pass",
  );

  await assert.rejects(
    execFileAsync(process.execPath, [
      CLI,
      "device-proof",
      "verify-signature",
      signaturePath,
      "--proof",
      context.proofPath,
      "--public-key",
      context.publicKeyPath,
      "--key-id",
      "device-lab-2026-08",
      "--project",
      "wrong-project",
      "--json",
    ]),
    (error) => {
      assert.equal(error.code, 1);
      const failed = JSON.parse(error.stdout);
      assert.equal(failed.ok, false);
      assert.equal(failed.authenticatedProof, undefined);
      return true;
    },
  );
  await assert.rejects(
    execFileAsync(process.execPath, [
      CLI,
      "device-proof",
      "sign",
      context.proofPath,
      "--key",
      context.privateKeyPath,
      "--key-id",
      "device-lab-2026-08",
    ]),
    (error) => error.code === 2 && /requires --project/u.test(error.stderr),
  );
});

test("round-trips an external device-proof signer through the CLI", async (t) => {
  const context = await fixture(t);
  const requestPath = path.join(
    context.directory,
    "cli-device-proof.request.json",
  );
  const requested = await execFileAsync(process.execPath, [
    CLI,
    "device-proof",
    "signing-request",
    context.proofPath,
    "--key-id",
    "device-hsm-2026-08",
    "--project",
    "solid-native",
    "--output",
    requestPath,
    "--json",
  ]);
  const request = JSON.parse(requested.stdout).request;
  const detachedSignaturePath = path.join(
    context.directory,
    "cli-device-proof.detached-signature.txt",
  );
  await writeFile(
    detachedSignaturePath,
    `${signEd25519(
      null,
      Buffer.from(request.payloadBase64url, "base64url"),
      context.privateKey,
    ).toString("base64url")}\n`,
  );
  const signaturePath = path.join(
    context.directory,
    "cli-device-proof.assembled.sig.json",
  );
  const assembled = await execFileAsync(process.execPath, [
    CLI,
    "device-proof",
    "assemble-signature",
    requestPath,
    "--signature",
    detachedSignaturePath,
    "--public-key",
    context.publicKeyPath,
    "--output",
    signaturePath,
    "--json",
  ]);
  assert.equal(
    JSON.parse(assembled.stdout).signature.proofSha256,
    `sha256:${RETAINED_PROOF_SHA256}`,
  );
  const verified = await execFileAsync(process.execPath, [
    CLI,
    "device-proof",
    "verify-signature",
    signaturePath,
    "--proof",
    context.proofPath,
    "--public-key",
    context.publicKeyPath,
    "--key-id",
    "device-hsm-2026-08",
    "--project",
    "solid-native",
    "--json",
  ]);
  assert.equal(JSON.parse(verified.stdout).ok, true);

  await assert.rejects(
    execFileAsync(process.execPath, [
      CLI,
      "device-proof",
      "assemble-signature",
      requestPath,
      "--signature",
      detachedSignaturePath,
    ]),
    (error) => error.code === 2 && /requires --public-key/u.test(error.stderr),
  );
});
