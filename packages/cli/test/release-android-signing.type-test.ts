import type {
  CreateNativeReleaseOptions,
  NativeReleaseArtifactSigning,
} from "../src/index.js";

const base = {
  artifactPath: "app-release.apk",
  bundleManifestPath: "solid-native-bundle.json",
  release: "1.0.0+1",
  channel: "production",
  sourceRevision: "abcdef0",
} as const;

const apkSigning: NativeReleaseArtifactSigning = {
  scheme: "android-apk",
  certificateSha256s: ["ab".repeat(32)],
};
const bundleSigning: NativeReleaseArtifactSigning = {
  scheme: "android-jar",
  certificateSha256: "cd".repeat(32),
};
const apkCreate: CreateNativeReleaseOptions = {
  ...base,
  androidSigningCertificateSha256s: ["ab".repeat(32)],
};

// @ts-expect-error Android APK and AAB signing policies are mutually exclusive.
const conflictingCreate: CreateNativeReleaseOptions = {
  ...base,
  androidSigningCertificateSha256s: ["ab".repeat(32)],
  androidUploadCertificateSha256: "cd".repeat(32),
};
const malformedApkSigning: NativeReleaseArtifactSigning = {
  scheme: "android-apk",
  // @ts-expect-error APK signing identities carry a complete certificate set.
  certificateSha256: "ab".repeat(32),
};
const malformedBundleSigning: NativeReleaseArtifactSigning = {
  scheme: "android-jar",
  // @ts-expect-error AAB signing identities carry exactly one upload certificate.
  certificateSha256s: ["ab".repeat(32)],
};

void apkSigning;
void bundleSigning;
void apkCreate;
void conflictingCreate;
void malformedApkSigning;
void malformedBundleSigning;
