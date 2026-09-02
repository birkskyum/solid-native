import type {
  CreateNativeReleaseDeviceCorrelationOptions,
  NativeReleaseDeviceCorrelation,
  VerifyCorrelatedNativeDeviceProofOptions,
} from "../src/index.js";

const deviceProof: VerifyCorrelatedNativeDeviceProofOptions = {
  proofPath: "device-proof.json",
  signaturePath: "device-proof.sig.json",
  trustPolicyPath: "device-proof-trust-policy.json",
  minimumTrustPolicySequence: 3,
  expectedProofSha256: `sha256:${"0".repeat(64)}`,
  minimumMeasuredAt: "2026-08-24T00:00:00.000Z",
  maximumMeasuredAt: "2026-08-25T00:00:00.000Z",
};

const options: CreateNativeReleaseDeviceCorrelationOptions = {
  release: {
    manifestPath: "release.json",
    signaturePath: "release.sig.json",
    bundleManifestPath: "bundle.json",
    artifactPath: "app.apk",
    trustPolicyPath: "release-trust-policy.json",
    minimumTrustPolicySequence: 4,
  },
  deviceProof,
};

const callerChosenLineage: VerifyCorrelatedNativeDeviceProofOptions = {
  proofPath: "device-proof.json",
  signaturePath: "device-proof.sig.json",
  trustPolicyPath: "device-proof-trust-policy.json",
  // @ts-expect-error Release lineage is derived inside the correlator.
  expectedSourceRevision: "0123456789abcdef",
};

declare const correlation: NativeReleaseDeviceCorrelation;
const platform: "android" = correlation.authorizedRelease.platform;
const inputsVerified: true = correlation.authorizedRelease.inputsVerified;
const bundleSha256: string = correlation.identity.javascriptBundleSha256;
const sourceMapSha256: string = correlation.identity.sourceMapSha256;
void correlation.deviceProofIngestion.authenticatedProof;
void options;
void callerChosenLineage;
void platform;
void inputsVerified;
void bundleSha256;
void sourceMapSha256;
