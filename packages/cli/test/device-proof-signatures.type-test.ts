import type {
  AssembleNativeDeviceProofSignatureOptions,
  CreateNativeDeviceProofIngestionOptions,
  CreateNativeDeviceProofSignatureOptions,
  CreateNativeDeviceProofSigningRequestOptions,
  CreateNativeAndroidDeviceProofOptions,
  NativeAuthenticatedDeviceProof,
  NativeDeviceProofIngestion,
  NativeDeviceProofProfile,
  NativeDeviceProofSignatureVerificationReport,
  NativeDeviceProofTrustPolicyV1,
  NativeDeviceProofVerificationPolicy,
  VerifyNativeDeviceProofSignatureOptions,
} from "../src/index.js";

const production: CreateNativeAndroidDeviceProofOptions = {
  serial: "physical-device",
  notBefore: "2026-08-24T20:00:00.000Z",
  applicationBundlePath: "index.android.bundle",
  sourceMapPath: "index.android.bundle.map",
  applicationApkPath: "app-release.apk",
  instrumentationApkPath: "app-release-test.apk",
  generatedBindingsPath: "generated/SolidNativeBindings.ts",
  instrumentationResultsDirectory: "android-test-results",
  instrumentationClass: "com.example.SolidNativeReleaseTest",
  instrumentationTest: "testProductionRenderer",
  requiredSources: ["app:///src/physical-test.tsx"],
  outputPath: "android-device-proof.json",
};

const signing: CreateNativeDeviceProofSignatureOptions = {
  proofPath: "device-proof.json",
  privateKeyPath: "device-proof-private.pem",
  keyId: "device-lab-1",
  projectName: "solid-native",
};

const verification: VerifyNativeDeviceProofSignatureOptions = {
  proofPath: "device-proof.json",
  signaturePath: "device-proof.sig.json",
  publicKeyPath: "device-proof-public.pem",
  expectedKeyId: "device-lab-1",
  projectName: "solid-native",
};

const trustPolicyVerification: VerifyNativeDeviceProofSignatureOptions = {
  proofPath: "device-proof.json",
  signaturePath: "device-proof.sig.json",
  trustPolicyPath: "device-proof-trust-policy.json",
  minimumTrustPolicySequence: 4,
  expectedProofSha256: `sha256:${"0".repeat(64)}`,
  expectedSourceRevision: "0123456789abcdef",
  expectedNativeCompatibilityFingerprint: `sha256:${"1".repeat(64)}`,
  expectedApplicationArtifactSha256: "2".repeat(64),
  expectedProfileFingerprint: `sha256:${"3".repeat(64)}`,
  minimumMeasuredAt: "2026-08-24T00:00:00.000Z",
  maximumMeasuredAt: "2026-08-25T00:00:00.000Z",
};

const ingestionOptions: CreateNativeDeviceProofIngestionOptions =
  trustPolicyVerification;

const externalSigning: CreateNativeDeviceProofSigningRequestOptions = {
  proofPath: "device-proof.json",
  keyId: "device-lab-1",
  projectName: "solid-native",
};

const assembly: AssembleNativeDeviceProofSignatureOptions = {
  requestPath: "device-proof.signing-request.json",
  detachedSignaturePath: "device-proof-signature.bin",
  publicKeyPath: "device-proof-public.pem",
};

// @ts-expect-error A separately governed project identity is required when signing.
const signingWithoutProject: CreateNativeDeviceProofSignatureOptions = {
  proofPath: "device-proof.json",
  privateKeyPath: "device-proof-private.pem",
  keyId: "device-lab-1",
};

// @ts-expect-error Verification must pin the expected key identity.
const verificationWithoutKey: VerifyNativeDeviceProofSignatureOptions = {
  proofPath: "device-proof.json",
  signaturePath: "device-proof.sig.json",
  publicKeyPath: "device-proof-public.pem",
  projectName: "solid-native",
};

// @ts-expect-error Trust-policy and pinned-key verification are exclusive.
const conflictingTrustModes: VerifyNativeDeviceProofSignatureOptions = {
  ...verification,
  trustPolicyPath: "device-proof-trust-policy.json",
};

// @ts-expect-error A minimum sequence is meaningful only with a trust policy.
const minimumWithoutTrustPolicy: VerifyNativeDeviceProofSignatureOptions = {
  ...verification,
  minimumTrustPolicySequence: 4,
};

// @ts-expect-error Assembly must verify the detached bytes with a public key.
const assemblyWithoutPublicKey: AssembleNativeDeviceProofSignatureOptions = {
  requestPath: "device-proof.signing-request.json",
  detachedSignaturePath: "device-proof-signature.bin",
};

declare const report: NativeDeviceProofSignatureVerificationReport;
if (report.ok) {
  const authenticated: NativeAuthenticatedDeviceProof =
    report.authenticatedProof;
  void authenticated.sourceRevision;
} else {
  const absent: undefined = report.authenticatedProof;
  void absent;
}

declare const ingestion: NativeDeviceProofIngestion;
const ingestedProof: NativeAuthenticatedDeviceProof =
  ingestion.authenticatedProof;
const ingestionPolicy: NativeDeviceProofVerificationPolicy =
  ingestion.verificationPolicy;
declare const profile: NativeDeviceProofProfile;
const profilePolicy: NativeDeviceProofTrustPolicyV1 = {
  schemaVersion: 1,
  policySequence: 1,
  projectName: "solid-native",
  proof: "solid-native-android-release-device",
  profileFingerprint: profile.profileFingerprint,
  keys: [],
};

void signing;
void verification;
void trustPolicyVerification;
void ingestionOptions;
void externalSigning;
void assembly;
void signingWithoutProject;
void verificationWithoutKey;
void conflictingTrustModes;
void minimumWithoutTrustPolicy;
void assemblyWithoutPublicKey;
void ingestedProof;
void ingestionPolicy;
void profilePolicy;
void production;
