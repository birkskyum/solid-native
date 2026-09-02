import path from "node:path";

import {
  readNativeBundleManifest,
  verifyNativeBundleManifest,
} from "./bundle-artifacts.js";
import {
  createNativeDeviceProofIngestion,
  type NativeDeviceProofIngestion,
  type VerifyNativeDeviceProofSignatureOptions,
} from "./device-proof-signatures.js";
import {
  formatNativeReleaseSignatureVerification,
  verifyNativeReleaseSignature,
  type NativeAuthorizedRelease,
  type VerifyNativeReleaseSignatureWithInputsOptions,
} from "./release-signatures.js";

type ReleaseDerivedDeviceProofConstraint =
  | "expectedApplicationArtifactSha256"
  | "expectedNativeCompatibilityFingerprint"
  | "expectedSourceRevision";

export type VerifyCorrelatedNativeDeviceProofOptions =
  VerifyNativeDeviceProofSignatureOptions extends infer Options
    ? Options extends VerifyNativeDeviceProofSignatureOptions
      ? Omit<Options, ReleaseDerivedDeviceProofConstraint>
      : never
    : never;

export interface CreateNativeReleaseDeviceCorrelationOptions {
  /** Requires complete release inputs; envelope-only authorization is rejected. */
  readonly release: VerifyNativeReleaseSignatureWithInputsOptions;
  /** Uses an independent device-lab trust domain. Release lineage is derived. */
  readonly deviceProof: VerifyCorrelatedNativeDeviceProofOptions;
}

export interface NativeReleaseDeviceCorrelationIdentity {
  readonly projectName: string;
  readonly platform: "android";
  readonly sourceRevision: string;
  readonly nativeCompatibilityFingerprint: string;
  readonly bundleFingerprint: string;
  readonly javascriptBundleSha256: string;
  readonly sourceMapSha256: string;
  readonly applicationArtifactSha256: string;
}

export interface NativeReleaseDeviceCorrelation {
  readonly schemaVersion: 0;
  readonly kind: "solid-native.release-device-correlation";
  readonly identity: NativeReleaseDeviceCorrelationIdentity;
  readonly authorizedRelease: NativeAuthorizedRelease & {
    readonly platform: "android";
    readonly inputsVerified: true;
  };
  readonly deviceProofIngestion: NativeDeviceProofIngestion;
}

const RELEASE_DERIVED_DEVICE_PROOF_CONSTRAINTS = [
  "expectedApplicationArtifactSha256",
  "expectedNativeCompatibilityFingerprint",
  "expectedSourceRevision",
] as const satisfies readonly ReleaseDerivedDeviceProofConstraint[];

/**
 * Independently authenticates a complete Android release and physical-device
 * receipt, then requires both trust domains to describe one exact rollout.
 * The returned descriptor is path-free and does not grant release authority to
 * device evidence.
 */
export async function createNativeReleaseDeviceCorrelation(
  options: CreateNativeReleaseDeviceCorrelationOptions,
): Promise<NativeReleaseDeviceCorrelation> {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("Release/device correlation options are required.");
  }
  if (
    typeof options.release !== "object" ||
    options.release === null ||
    typeof options.deviceProof !== "object" ||
    options.deviceProof === null
  ) {
    throw new TypeError(
      "Release/device correlation requires release and device-proof verification options.",
    );
  }
  for (const key of RELEASE_DERIVED_DEVICE_PROOF_CONSTRAINTS) {
    if (Object.hasOwn(options.deviceProof, key)) {
      throw new TypeError(
        `Device-proof ${key} is derived from the authorized release and must not be supplied.`,
      );
    }
  }

  const releaseVerification = await verifyNativeReleaseSignature(
    options.release,
  );
  if (
    !releaseVerification.ok ||
    !releaseVerification.authorizedRelease.inputsVerified
  ) {
    throw new TypeError(
      `Refusing to correlate an unauthorized or envelope-only release.\n${formatNativeReleaseSignatureVerification(releaseVerification)}`,
    );
  }
  const authorizedRelease = releaseVerification.authorizedRelease;
  if (authorizedRelease.platform !== "android") {
    throw new TypeError(
      "Physical Android device proofs can only be correlated with an authorized Android release.",
    );
  }

  const cwd = path.resolve(options.release.cwd ?? process.cwd());
  const bundleManifestPath = path.resolve(
    cwd,
    options.release.bundleManifestPath,
  );
  const [bundleManifest, bundleVerification] = await Promise.all([
    readNativeBundleManifest(bundleManifestPath),
    verifyNativeBundleManifest(bundleManifestPath),
  ]);
  if (
    !bundleVerification.ok ||
    bundleManifest.platform !== "android" ||
    bundleManifest.bundleFingerprint !== authorizedRelease.bundleFingerprint ||
    bundleVerification.bundleFingerprint !== authorizedRelease.bundleFingerprint
  ) {
    throw new TypeError(
      "Refusing to correlate because the authorized release bundle changed or has the wrong platform.",
    );
  }

  const deviceProofIngestion = await createNativeDeviceProofIngestion({
    ...options.deviceProof,
    expectedSourceRevision: authorizedRelease.sourceRevision,
    expectedNativeCompatibilityFingerprint:
      authorizedRelease.nativeCompatibilityFingerprint,
    expectedApplicationArtifactSha256: authorizedRelease.artifactSha256,
  } as VerifyNativeDeviceProofSignatureOptions);
  const authenticatedProof = deviceProofIngestion.authenticatedProof;
  if (authenticatedProof.projectName !== authorizedRelease.projectName) {
    throw new TypeError(
      "The authenticated device proof and authorized release have different project identities.",
    );
  }
  if (
    authenticatedProof.receiptSchemaVersion === 0 ||
    deviceProofIngestion.inputs.bundle === undefined
  ) {
    throw new TypeError(
      "Legacy device-proof receipts do not identify JavaScript bundle bytes and cannot be correlated with a release.",
    );
  }
  if (
    deviceProofIngestion.inputs.bundle.bytes !==
      bundleManifest.artifacts.bundle.bytes ||
    deviceProofIngestion.inputs.bundle.sha256 !==
      bundleManifest.artifacts.bundle.sha256
  ) {
    throw new TypeError(
      "The authenticated device proof and authorized release have different JavaScript bundle identities.",
    );
  }
  if (
    deviceProofIngestion.inputs.sourceMap.bytes !==
      bundleManifest.artifacts.sourceMap.bytes ||
    deviceProofIngestion.inputs.sourceMap.sha256 !==
      bundleManifest.artifacts.sourceMap.sha256
  ) {
    throw new TypeError(
      "The authenticated device proof and authorized release have different source-map identities.",
    );
  }

  const identity = Object.freeze({
    projectName: authorizedRelease.projectName,
    platform: "android" as const,
    sourceRevision: authorizedRelease.sourceRevision,
    nativeCompatibilityFingerprint:
      authorizedRelease.nativeCompatibilityFingerprint,
    bundleFingerprint: authorizedRelease.bundleFingerprint,
    javascriptBundleSha256: bundleManifest.artifacts.bundle.sha256,
    sourceMapSha256: bundleManifest.artifacts.sourceMap.sha256,
    applicationArtifactSha256: authorizedRelease.artifactSha256,
  });
  return Object.freeze({
    schemaVersion: 0,
    kind: "solid-native.release-device-correlation",
    identity,
    authorizedRelease:
      authorizedRelease as NativeReleaseDeviceCorrelation["authorizedRelease"],
    deviceProofIngestion,
  });
}

export function formatNativeReleaseDeviceCorrelation(
  correlation: NativeReleaseDeviceCorrelation,
): string {
  const release = correlation.authorizedRelease;
  const proof = correlation.deviceProofIngestion.authenticatedProof;
  return [
    `PASS Android release/device correlation ${release.releaseFingerprint}`,
    `Release: ${release.projectName}/${release.release} (${release.channel})`,
    `Source revision: ${correlation.identity.sourceRevision}`,
    `Native compatibility: ${correlation.identity.nativeCompatibilityFingerprint}`,
    `JavaScript bundle: ${correlation.identity.javascriptBundleSha256}`,
    `Source map: ${correlation.identity.sourceMapSha256}`,
    `Application artifact: ${correlation.identity.applicationArtifactSha256}`,
    `Physical execution: ${proof.deviceModel} at ${proof.measuredAt}`,
    `Device-proof profile: ${proof.profileFingerprint} (receipt schema ${String(proof.receiptSchemaVersion)})`,
    `Release key: ${release.authenticatedKeyId}`,
    `Device-proof key: ${proof.authenticatedKeyId}`,
  ].join("\n");
}
