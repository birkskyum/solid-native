import type { TelemetryAttributes } from "./index.js";

/**
 * Structural match for `@solid-native/cli`'s `NativeAuthorizedRelease`.
 * Production sessions require the verifier's input-complete form rather than
 * an envelope-only authorization.
 */
export interface CausalTelemetryAuthorizedRelease {
  readonly schemaVersion: 0;
  readonly projectName: string;
  readonly platform: "android" | "ios";
  readonly release: string;
  readonly channel: string;
  readonly sourceRevision: string;
  readonly releaseFingerprint: string;
  readonly bundleFingerprint: string;
  readonly nativeCompatibilityFingerprint: string;
  readonly artifactSha256: string;
  readonly authenticatedKeyId: string;
  readonly inputsVerified: boolean;
  readonly trustPolicyFingerprint?: string;
  readonly trustPolicySequence?: number;
}

const RELEASE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;
const RELEASE_CHANNEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SOURCE_REVISION_PATTERN = /^[a-f0-9]{7,64}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SHA256_FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SIGNING_KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/;
const AUTHORIZED_RELEASE_REQUIRED_KEYS = [
  "schemaVersion",
  "projectName",
  "platform",
  "release",
  "channel",
  "sourceRevision",
  "releaseFingerprint",
  "bundleFingerprint",
  "nativeCompatibilityFingerprint",
  "artifactSha256",
  "authenticatedKeyId",
  "inputsVerified",
] as const;
const AUTHORIZED_RELEASE_OPTIONAL_KEYS = [
  "trustPolicyFingerprint",
  "trustPolicySequence",
] as const;

function releaseIdentifier(
  name: string,
  value: unknown,
  pattern: RegExp,
  description: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new TypeError(`Telemetry ${name} must be ${description}.`);
  }
  return value;
}

export function createAuthorizedReleaseAttributes(
  release: CausalTelemetryAuthorizedRelease,
): TelemetryAttributes {
  if (
    typeof release !== "object" ||
    release === null ||
    Array.isArray(release)
  ) {
    throw new TypeError(
      "Telemetry authorizedRelease must be a verified release object.",
    );
  }
  const keys = Object.keys(release);
  if (
    !AUTHORIZED_RELEASE_REQUIRED_KEYS.every((key) =>
      Object.hasOwn(release, key),
    ) ||
    !keys.every(
      (key) =>
        (AUTHORIZED_RELEASE_REQUIRED_KEYS as readonly string[]).includes(key) ||
        (AUTHORIZED_RELEASE_OPTIONAL_KEYS as readonly string[]).includes(key),
    )
  ) {
    throw new TypeError(
      "Telemetry authorizedRelease must have the exact verifier output schema.",
    );
  }
  if (release.schemaVersion !== 0) {
    throw new TypeError("Telemetry authorizedRelease schemaVersion must be 0.");
  }
  if (
    typeof release.projectName !== "string" ||
    release.projectName.length === 0 ||
    release.projectName.length > 214 ||
    /[\r\n\0]/u.test(release.projectName)
  ) {
    throw new TypeError(
      "Telemetry authorizedRelease projectName must be a bounded static identity.",
    );
  }
  if (release.platform !== "android" && release.platform !== "ios") {
    throw new TypeError(
      "Telemetry authorizedRelease platform must be android or ios.",
    );
  }
  const releaseName = releaseIdentifier(
    "authorizedRelease.release",
    release.release,
    RELEASE_IDENTIFIER_PATTERN,
    "a static release identifier of 1 to 128 characters",
  )!;
  const channel = releaseIdentifier(
    "authorizedRelease.channel",
    release.channel,
    RELEASE_CHANNEL_PATTERN,
    "a static release channel of 1 to 64 characters",
  )!;
  const sourceRevision = releaseIdentifier(
    "authorizedRelease.sourceRevision",
    release.sourceRevision,
    SOURCE_REVISION_PATTERN,
    "a canonical lowercase hexadecimal revision of 7 to 64 characters",
  )!;
  const releaseFingerprint = releaseIdentifier(
    "authorizedRelease.releaseFingerprint",
    release.releaseFingerprint,
    SHA256_FINGERPRINT_PATTERN,
    "a canonical SHA-256 fingerprint",
  )!;
  const bundleFingerprint = releaseIdentifier(
    "authorizedRelease.bundleFingerprint",
    release.bundleFingerprint,
    SHA256_FINGERPRINT_PATTERN,
    "a canonical SHA-256 fingerprint",
  )!;
  const nativeCompatibilityFingerprint = releaseIdentifier(
    "authorizedRelease.nativeCompatibilityFingerprint",
    release.nativeCompatibilityFingerprint,
    SHA256_FINGERPRINT_PATTERN,
    "a canonical SHA-256 fingerprint",
  )!;
  const artifactSha256 = releaseIdentifier(
    "authorizedRelease.artifactSha256",
    release.artifactSha256,
    SHA256_PATTERN,
    "a canonical lowercase hexadecimal SHA-256",
  )!;
  const authenticatedKeyId = releaseIdentifier(
    "authorizedRelease.authenticatedKeyId",
    release.authenticatedKeyId,
    SIGNING_KEY_ID_PATTERN,
    "a static signing key identifier of 1 to 128 characters",
  )!;
  if (release.inputsVerified !== true) {
    throw new TypeError(
      "Telemetry authorizedRelease must include verified bundle and native artifact inputs.",
    );
  }
  if (
    (release.trustPolicyFingerprint === undefined) !==
    (release.trustPolicySequence === undefined)
  ) {
    throw new TypeError(
      "Telemetry authorizedRelease trust policy fingerprint and sequence must be supplied together.",
    );
  }
  const trustPolicyFingerprint = releaseIdentifier(
    "authorizedRelease.trustPolicyFingerprint",
    release.trustPolicyFingerprint,
    SHA256_FINGERPRINT_PATTERN,
    "a canonical SHA-256 fingerprint",
  );
  if (
    release.trustPolicySequence !== undefined &&
    (!Number.isSafeInteger(release.trustPolicySequence) ||
      release.trustPolicySequence < 1)
  ) {
    throw new TypeError(
      "Telemetry authorizedRelease trustPolicySequence must be a positive safe integer.",
    );
  }
  return Object.freeze({
    "resource.platform": release.platform,
    "resource.release.project_name": release.projectName,
    "resource.release": releaseName,
    "resource.release.channel": channel,
    "resource.source.revision": sourceRevision,
    "resource.release.fingerprint": releaseFingerprint,
    "resource.bundle.fingerprint": bundleFingerprint,
    "resource.native.compatibility_fingerprint": nativeCompatibilityFingerprint,
    "resource.release.artifact_sha256": artifactSha256,
    "resource.release.signing_key_id": authenticatedKeyId,
    "resource.release.inputs_verified": true,
    ...(trustPolicyFingerprint === undefined
      ? {}
      : {
          "resource.release.trust_policy_fingerprint": trustPolicyFingerprint,
          "resource.release.trust_policy_sequence":
            release.trustPolicySequence!,
        }),
  });
}
