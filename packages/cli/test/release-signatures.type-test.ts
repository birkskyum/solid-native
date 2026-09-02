import type {
  CreateNativeSymbolicationHandoffOptions,
  CreateNativeReleaseSignatureOptions,
  CreateNativeReleaseSigningRequestOptions,
  NativeAuthorizedRelease,
  NativeReleaseSignatureVerificationReport,
  VerifyNativeReleaseSignatureOptions,
} from "../src/index.js";
import type { CausalTelemetryAuthorizedRelease } from "../../observability/src/index.js";

const directSigningWithInputs: CreateNativeReleaseSignatureOptions = {
  manifestPath: "release.json",
  privateKeyPath: "private.pem",
  keyId: "production-1",
  bundleManifestPath: "bundle.json",
  artifactPath: "app.ipa",
};
const externalSigningEnvelopeOnly: CreateNativeReleaseSigningRequestOptions = {
  manifestPath: "release.json",
  keyId: "production-1",
};
// @ts-expect-error Signing preparation requires both release input paths.
const externalSigningMissingArtifact: CreateNativeReleaseSigningRequestOptions =
  {
    manifestPath: "release.json",
    keyId: "production-1",
    bundleManifestPath: "bundle.json",
  };

declare const baseOptions: {
  readonly cwd: string;
  readonly manifestPath: string;
  readonly signaturePath: string;
  readonly publicKeyPath: string;
  readonly expectedKeyId: string;
  readonly policy: {
    readonly projectName: string;
    readonly platform: "ios";
    readonly channel: string;
  };
};

const verifiedInputs: VerifyNativeReleaseSignatureOptions = {
  ...baseOptions,
  bundleManifestPath: "bundle.json",
  artifactPath: "app.ipa",
};
const explicitVerifiedInputs: VerifyNativeReleaseSignatureOptions = {
  ...verifiedInputs,
  envelopeOnly: false,
};
const envelopeOnly: VerifyNativeReleaseSignatureOptions = {
  ...baseOptions,
  envelopeOnly: true,
};
const symbolicationInputs: CreateNativeSymbolicationHandoffOptions =
  verifiedInputs;
// @ts-expect-error Symbolication requires verified bundle and native inputs.
const envelopeOnlySymbolication: CreateNativeSymbolicationHandoffOptions =
  envelopeOnly;
const trustPolicyEnvelopeOnly: VerifyNativeReleaseSignatureOptions = {
  cwd: "/app",
  manifestPath: "release.json",
  signaturePath: "release.sig.json",
  trustPolicyPath: "release-trust-policy.json",
  minimumTrustPolicySequence: 3,
  envelopeOnly: true,
};

// @ts-expect-error An evidence mode must be selected explicitly.
const missingMode: VerifyNativeReleaseSignatureOptions = baseOptions;
// @ts-expect-error Input verification requires both paths.
const missingArtifact: VerifyNativeReleaseSignatureOptions = {
  ...baseOptions,
  bundleManifestPath: "bundle.json",
};
// @ts-expect-error Envelope-only mode cannot carry build inputs.
const conflictingMode: VerifyNativeReleaseSignatureOptions = {
  ...verifiedInputs,
  envelopeOnly: true,
};
// @ts-expect-error False is meaningful only alongside paired build inputs.
const falseWithoutInputs: VerifyNativeReleaseSignatureOptions = {
  ...baseOptions,
  envelopeOnly: false,
};
// @ts-expect-error Trust-policy and individually pinned trust inputs are exclusive.
const conflictingTrust: VerifyNativeReleaseSignatureOptions = {
  ...baseOptions,
  trustPolicyPath: "release-trust-policy.json",
  envelopeOnly: true,
};
// @ts-expect-error A verifier must select a complete trust mode.
const missingTrust: VerifyNativeReleaseSignatureOptions = {
  cwd: "/app",
  manifestPath: "release.json",
  signaturePath: "release.sig.json",
  envelopeOnly: true,
};
const minimumWithoutPolicy: VerifyNativeReleaseSignatureOptions = {
  ...baseOptions,
  // @ts-expect-error A minimum policy sequence is meaningful only with a policy file.
  minimumTrustPolicySequence: 3,
  envelopeOnly: true,
};

declare const report: NativeReleaseSignatureVerificationReport;
if (report.ok) {
  const authorized: NativeAuthorizedRelease = report.authorizedRelease;
  void authorized.inputsVerified;
  if (authorized.inputsVerified) {
    const telemetryRelease: CausalTelemetryAuthorizedRelease = authorized;
    void telemetryRelease;
  }
} else {
  const absent: undefined = report.authorizedRelease;
  void absent;
}

void explicitVerifiedInputs;
void symbolicationInputs;
void envelopeOnlySymbolication;
void directSigningWithInputs;
void externalSigningEnvelopeOnly;
void externalSigningMissingArtifact;
void envelopeOnly;
void trustPolicyEnvelopeOnly;
void missingMode;
void missingArtifact;
void conflictingMode;
void falseWithoutInputs;
void conflictingTrust;
void missingTrust;
void minimumWithoutPolicy;
