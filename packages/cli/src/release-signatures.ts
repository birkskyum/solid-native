import {
  createHash,
  randomUUID,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  formatNativeReleaseVerification,
  nativeReleaseFingerprintMatches,
  readNativeReleaseManifest,
  verifyNativeReleaseManifest,
  type NativeReleaseManifest,
  type NativeReleaseVerificationReport,
} from "./release.js";
import {
  publicEd25519KeyFromSpki,
  readDetachedEd25519Signature,
  readEd25519PrivateKey,
  readEd25519PublicKey,
  readStableRegularFile,
} from "./signature-utilities.js";

export interface NativeReleaseSignature {
  readonly schemaVersion: 0;
  readonly algorithm: "ed25519";
  readonly keyId: string;
  readonly releaseFingerprint: string;
  readonly signature: string;
}

interface CreateNativeReleaseSignatureBaseOptions {
  readonly cwd?: string;
  readonly manifestPath: string;
  readonly privateKeyPath: string;
  readonly keyId: string;
  readonly outputPath?: string;
}

type NativeReleaseSigningInputOptions =
  | {
      readonly bundleManifestPath: string;
      readonly artifactPath: string;
    }
  | {
      readonly bundleManifestPath?: never;
      readonly artifactPath?: never;
    };

export type CreateNativeReleaseSignatureOptions =
  CreateNativeReleaseSignatureBaseOptions & NativeReleaseSigningInputOptions;

export interface CreateNativeReleaseSignatureResult {
  readonly signaturePath: string;
  readonly signature: NativeReleaseSignature;
  readonly verification?: NativeReleaseVerificationReport;
}

export interface NativeReleaseSigningRequest {
  readonly schemaVersion: 0;
  readonly algorithm: "ed25519";
  readonly keyId: string;
  readonly releaseFingerprint: string;
  /** Canonical contextual signing payload as unpadded base64url. */
  readonly payloadBase64url: string;
  /** Lowercase hexadecimal SHA-256 of the decoded signing payload. */
  readonly payloadSha256: string;
}

interface CreateNativeReleaseSigningRequestBaseOptions {
  readonly cwd?: string;
  readonly manifestPath: string;
  readonly keyId: string;
  readonly outputPath?: string;
}

export type CreateNativeReleaseSigningRequestOptions =
  CreateNativeReleaseSigningRequestBaseOptions &
    NativeReleaseSigningInputOptions;

export interface CreateNativeReleaseSigningRequestResult {
  readonly requestPath: string;
  readonly request: NativeReleaseSigningRequest;
  readonly verification?: NativeReleaseVerificationReport;
}

export interface AssembleNativeReleaseSignatureOptions {
  readonly cwd?: string;
  readonly requestPath: string;
  readonly detachedSignaturePath: string;
  readonly publicKeyPath: string;
  readonly outputPath?: string;
}

export interface AssembleNativeReleaseSignatureResult {
  readonly requestPath: string;
  readonly signaturePath: string;
  readonly signature: NativeReleaseSignature;
}

interface VerifyNativeReleaseSignatureBaseOptions {
  readonly cwd?: string;
  readonly manifestPath: string;
  readonly signaturePath: string;
}

type VerifyNativeReleaseSignatureTrustOptions =
  | {
      readonly publicKeyPath: string;
      readonly expectedKeyId: string;
      readonly policy: NativeReleaseAuthorizationPolicy;
      readonly trustPolicyPath?: never;
    }
  | {
      readonly trustPolicyPath: string;
      readonly minimumTrustPolicySequence?: number;
      readonly publicKeyPath?: never;
      readonly expectedKeyId?: never;
      readonly policy?: never;
    };

export type VerifyNativeReleaseSignatureWithInputsOptions =
  VerifyNativeReleaseSignatureBaseOptions &
    VerifyNativeReleaseSignatureTrustOptions & {
      readonly bundleManifestPath: string;
      readonly artifactPath: string;
      readonly envelopeOnly?: false;
    };

export type VerifyNativeReleaseSignatureEnvelopeOnlyOptions =
  VerifyNativeReleaseSignatureBaseOptions &
    VerifyNativeReleaseSignatureTrustOptions & {
      readonly bundleManifestPath?: never;
      readonly artifactPath?: never;
      /** Explicitly authenticate only the envelope without build inputs. */
      readonly envelopeOnly: true;
    };

export type VerifyNativeReleaseSignatureOptions =
  | VerifyNativeReleaseSignatureWithInputsOptions
  | VerifyNativeReleaseSignatureEnvelopeOnlyOptions;

export interface NativeReleaseAuthorizationPolicy {
  /** Stable application identity from a separately trusted policy source. */
  readonly projectName: string;
  readonly platform: "android" | "ios";
  readonly channel: string;
  readonly release?: string;
  readonly sourceRevision?: string;
  readonly releaseFingerprint?: string;
  readonly bundleFingerprint?: string;
  readonly nativeCompatibilityFingerprint?: string;
  /** Lowercase hexadecimal SHA-256 of the final native artifact. */
  readonly artifactSha256?: string;
}

export interface NativeReleaseTrustedKey {
  readonly keyId: string;
  readonly algorithm: "ed25519";
  /** Canonical unpadded base64url SubjectPublicKeyInfo DER. */
  readonly publicKeySpki: string;
  readonly status: "active" | "revoked";
}

export interface NativeReleaseTrustPolicy extends NativeReleaseAuthorizationPolicy {
  readonly schemaVersion: 0;
  /** Monotonic deployment-controlled policy revision, starting at 1. */
  readonly policySequence: number;
  readonly keys: readonly NativeReleaseTrustedKey[];
}

export interface NativeAuthorizedRelease {
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

export interface NativeReleaseSignatureVerificationCheck {
  readonly id:
    "envelope" | "trust-policy" | "key" | "signature" | "policy" | "inputs";
  readonly status: "pass" | "fail";
  readonly message: string;
}

interface NativeReleaseSignatureVerificationReportBase {
  readonly schemaVersion: 0;
  readonly manifestPath: string;
  readonly signaturePath: string;
  readonly releaseFingerprint: string;
  readonly keyId: string;
  readonly policy: NativeReleaseAuthorizationPolicy;
  readonly trustPolicyPath?: string;
  readonly trustPolicyFingerprint?: string;
  readonly trustPolicySequence?: number;
  readonly inputVerification?: NativeReleaseVerificationReport;
  readonly checks: readonly NativeReleaseSignatureVerificationCheck[];
}

export type NativeReleaseSignatureVerificationReport =
  NativeReleaseSignatureVerificationReportBase &
    (
      | {
          readonly ok: true;
          readonly authorizedRelease: NativeAuthorizedRelease;
        }
      | {
          readonly ok: false;
          readonly authorizedRelease?: never;
        }
    );

const MAX_SIGNATURE_STATEMENT_BYTES = 64 * 1024;
const MAX_SIGNING_REQUEST_BYTES = 64 * 1024;
const MAX_TRUST_POLICY_BYTES = 64 * 1024;
const MAX_TRUST_POLICY_KEYS = 32;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/u;
const RELEASE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/u;
const CHANNEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const REVISION_PATTERN = /^[a-f0-9]{7,64}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]{86}$/u;
const SIGNATURE_CONTEXT = "solid-native.release-signature.v0\0";

const RELEASE_AUTHORIZATION_REQUIRED_KEYS = [
  "projectName",
  "platform",
  "channel",
] as const;
const RELEASE_AUTHORIZATION_ALLOWED_KEYS: readonly string[] = [
  ...RELEASE_AUTHORIZATION_REQUIRED_KEYS,
  "release",
  "sourceRevision",
  "releaseFingerprint",
  "bundleFingerprint",
  "nativeCompatibilityFingerprint",
  "artifactSha256",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function assertKeyId(value: unknown, label: string): string {
  if (typeof value !== "string" || !KEY_ID_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a static key identifier.`);
  }
  return value;
}

function assertPolicyToken(
  value: unknown,
  label: string,
  pattern: RegExp,
): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new TypeError(`The release authorization ${label} is invalid.`);
  }
  return value;
}

function optionalPolicyToken(
  value: unknown,
  label: string,
  pattern: RegExp,
): string | undefined {
  return value === undefined
    ? undefined
    : assertPolicyToken(value, label, pattern);
}

function parseReleaseAuthorizationPolicy(
  value: unknown,
): NativeReleaseAuthorizationPolicy {
  if (
    !isRecord(value) ||
    !RELEASE_AUTHORIZATION_REQUIRED_KEYS.every((key) =>
      Object.hasOwn(value, key),
    ) ||
    !Object.keys(value).every((key) =>
      RELEASE_AUTHORIZATION_ALLOWED_KEYS.includes(key),
    ) ||
    typeof value.projectName !== "string" ||
    value.projectName.length === 0 ||
    value.projectName.length > 214 ||
    /[\r\n\0]/u.test(value.projectName) ||
    (value.platform !== "android" && value.platform !== "ios")
  ) {
    throw new TypeError("The release authorization policy is invalid.");
  }
  const release = optionalPolicyToken(
    value.release,
    "release identifier",
    RELEASE_PATTERN,
  );
  const sourceRevision = optionalPolicyToken(
    value.sourceRevision,
    "source revision",
    REVISION_PATTERN,
  );
  const releaseFingerprint = optionalPolicyToken(
    value.releaseFingerprint,
    "release fingerprint",
    FINGERPRINT_PATTERN,
  );
  const bundleFingerprint = optionalPolicyToken(
    value.bundleFingerprint,
    "bundle fingerprint",
    FINGERPRINT_PATTERN,
  );
  const nativeCompatibilityFingerprint = optionalPolicyToken(
    value.nativeCompatibilityFingerprint,
    "native compatibility fingerprint",
    FINGERPRINT_PATTERN,
  );
  const artifactSha256 = optionalPolicyToken(
    value.artifactSha256,
    "artifact SHA-256",
    SHA256_PATTERN,
  );
  return {
    projectName: value.projectName,
    platform: value.platform,
    channel: assertPolicyToken(value.channel, "channel", CHANNEL_PATTERN),
    ...(release === undefined ? {} : { release }),
    ...(sourceRevision === undefined ? {} : { sourceRevision }),
    ...(releaseFingerprint === undefined ? {} : { releaseFingerprint }),
    ...(bundleFingerprint === undefined ? {} : { bundleFingerprint }),
    ...(nativeCompatibilityFingerprint === undefined
      ? {}
      : { nativeCompatibilityFingerprint }),
    ...(artifactSha256 === undefined ? {} : { artifactSha256 }),
  };
}

function parseNativeReleaseTrustPolicy(
  value: unknown,
): NativeReleaseTrustPolicy {
  const allowedKeys = [
    "schemaVersion",
    "policySequence",
    "keys",
    ...RELEASE_AUTHORIZATION_ALLOWED_KEYS,
  ];
  if (
    !isRecord(value) ||
    value.schemaVersion !== 0 ||
    typeof value.policySequence !== "number" ||
    !Number.isSafeInteger(value.policySequence) ||
    value.policySequence <= 0 ||
    !Array.isArray(value.keys) ||
    value.keys.length === 0 ||
    value.keys.length > MAX_TRUST_POLICY_KEYS ||
    !Object.keys(value).every((key) => allowedKeys.includes(key))
  ) {
    throw new TypeError("The release trust policy has an invalid schema.");
  }
  const authorization = parseReleaseAuthorizationPolicy(
    Object.fromEntries(
      RELEASE_AUTHORIZATION_ALLOWED_KEYS.filter((key) =>
        Object.hasOwn(value, key),
      ).map((key) => [key, value[key]]),
    ),
  );
  const keyIds = new Set<string>();
  const publicKeys = new Set<string>();
  const keys = value.keys
    .map((entry, index): NativeReleaseTrustedKey => {
      if (
        !isRecord(entry) ||
        !hasExactKeys(entry, [
          "keyId",
          "algorithm",
          "publicKeySpki",
          "status",
        ]) ||
        entry.algorithm !== "ed25519" ||
        typeof entry.publicKeySpki !== "string" ||
        (entry.status !== "active" && entry.status !== "revoked")
      ) {
        throw new TypeError(
          `Release trust policy key ${String(index)} has an invalid schema.`,
        );
      }
      const keyId = assertKeyId(
        entry.keyId,
        `Release trust policy key ${String(index)} ID`,
      );
      if (keyIds.has(keyId)) {
        throw new TypeError(
          `Release trust policy key ID ${keyId} is duplicated.`,
        );
      }
      keyIds.add(keyId);
      publicEd25519KeyFromSpki(
        entry.publicKeySpki,
        `Release trust policy key ${keyId}`,
      );
      if (publicKeys.has(entry.publicKeySpki)) {
        throw new TypeError(
          `Release trust policy key ${keyId} duplicates another public key.`,
        );
      }
      publicKeys.add(entry.publicKeySpki);
      return Object.freeze({
        keyId,
        algorithm: "ed25519",
        publicKeySpki: entry.publicKeySpki,
        status: entry.status,
      });
    })
    .sort((left, right) =>
      left.keyId < right.keyId ? -1 : left.keyId > right.keyId ? 1 : 0,
    );
  return Object.freeze({
    schemaVersion: 0,
    policySequence: value.policySequence,
    ...authorization,
    keys: Object.freeze(keys),
  });
}

function fingerprintParsedReleaseTrustPolicy(
  policy: NativeReleaseTrustPolicy,
): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(policy), "utf8")
    .digest("hex")}`;
}

export function nativeReleaseTrustPolicyFingerprint(
  policy: NativeReleaseTrustPolicy,
): string {
  return fingerprintParsedReleaseTrustPolicy(
    parseNativeReleaseTrustPolicy(policy),
  );
}

function releaseAuthorizationMismatches(
  manifest: NativeReleaseManifest,
  policy: NativeReleaseAuthorizationPolicy,
): readonly string[] {
  const actual = {
    projectName: manifest.projectName,
    platform: manifest.platform,
    channel: manifest.channel,
    release: manifest.release,
    sourceRevision: manifest.sourceRevision,
    releaseFingerprint: manifest.releaseFingerprint,
    bundleFingerprint: manifest.bundleFingerprint,
    nativeCompatibilityFingerprint: manifest.nativeCompatibilityFingerprint,
    artifactSha256: manifest.artifact.sha256,
  };
  return Object.entries(policy)
    .filter(
      ([key, expected]) => actual[key as keyof typeof actual] !== expected,
    )
    .map(([key]) => key);
}

export async function readNativeReleaseTrustPolicy(
  policyPath: string,
): Promise<NativeReleaseTrustPolicy> {
  if (typeof policyPath !== "string" || policyPath.length === 0) {
    throw new TypeError("The release trust policy path must be a string.");
  }
  const file = await readStableRegularFile(
    policyPath,
    "Release trust policy",
    MAX_TRUST_POLICY_BYTES,
  );
  try {
    return parseNativeReleaseTrustPolicy(
      JSON.parse(file.bytes.toString("utf8")),
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new TypeError(
        `The release trust policy is not valid JSON: ${error.message}`,
      );
    }
    throw error;
  }
}

function signaturePayload(
  statement: Omit<NativeReleaseSignature, "signature">,
): Buffer {
  return Buffer.from(
    `${SIGNATURE_CONTEXT}${JSON.stringify(statement)}`,
    "utf8",
  );
}

function signingStatement(
  keyId: unknown,
  releaseFingerprint: string,
): Omit<NativeReleaseSignature, "signature"> {
  return {
    schemaVersion: 0,
    algorithm: "ed25519",
    keyId: assertKeyId(keyId, "The signing key ID"),
    releaseFingerprint,
  };
}

function signingRequestForStatement(
  statement: Omit<NativeReleaseSignature, "signature">,
): NativeReleaseSigningRequest {
  const payload = signaturePayload(statement);
  return Object.freeze({
    ...statement,
    payloadBase64url: payload.toString("base64url"),
    payloadSha256: createHash("sha256").update(payload).digest("hex"),
  });
}

function parseNativeReleaseSigningRequest(
  value: unknown,
): NativeReleaseSigningRequest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "algorithm",
      "keyId",
      "releaseFingerprint",
      "payloadBase64url",
      "payloadSha256",
    ]) ||
    value.schemaVersion !== 0 ||
    value.algorithm !== "ed25519" ||
    typeof value.releaseFingerprint !== "string" ||
    !FINGERPRINT_PATTERN.test(value.releaseFingerprint) ||
    typeof value.payloadBase64url !== "string" ||
    typeof value.payloadSha256 !== "string" ||
    !SHA256_PATTERN.test(value.payloadSha256)
  ) {
    throw new TypeError("The release signing request has an invalid schema.");
  }
  const statement = signingStatement(value.keyId, value.releaseFingerprint);
  const expected = signingRequestForStatement(statement);
  if (
    value.payloadBase64url !== expected.payloadBase64url ||
    value.payloadSha256 !== expected.payloadSha256
  ) {
    throw new TypeError(
      "The release signing request payload does not match its statement.",
    );
  }
  return expected;
}

export async function readNativeReleaseSigningRequest(
  requestPath: string,
): Promise<NativeReleaseSigningRequest> {
  if (typeof requestPath !== "string" || requestPath.length === 0) {
    throw new TypeError("The release signing request path must be a string.");
  }
  const file = await readStableRegularFile(
    requestPath,
    "Release signing request",
    MAX_SIGNING_REQUEST_BYTES,
  );
  try {
    return parseNativeReleaseSigningRequest(
      JSON.parse(file.bytes.toString("utf8")),
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new TypeError(
        `The release signing request is not valid JSON: ${error.message}`,
      );
    }
    throw error;
  }
}

function parseNativeReleaseSignature(value: unknown): NativeReleaseSignature {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "algorithm",
      "keyId",
      "releaseFingerprint",
      "signature",
    ]) ||
    value.schemaVersion !== 0 ||
    value.algorithm !== "ed25519" ||
    typeof value.keyId !== "string" ||
    typeof value.releaseFingerprint !== "string" ||
    !FINGERPRINT_PATTERN.test(value.releaseFingerprint) ||
    typeof value.signature !== "string" ||
    !BASE64URL_PATTERN.test(value.signature)
  ) {
    throw new TypeError("The release signature has an invalid schema.");
  }
  const signatureBytes = Buffer.from(value.signature, "base64url");
  if (
    signatureBytes.length !== 64 ||
    signatureBytes.toString("base64url") !== value.signature
  ) {
    throw new TypeError("The release signature is not canonical base64url.");
  }
  return {
    schemaVersion: 0,
    algorithm: "ed25519",
    keyId: assertKeyId(value.keyId, "The release signature key ID"),
    releaseFingerprint: value.releaseFingerprint,
    signature: value.signature,
  };
}

async function readNativeReleaseSignature(
  signaturePath: string,
): Promise<NativeReleaseSignature> {
  const file = await readStableRegularFile(
    signaturePath,
    "Release signature",
    MAX_SIGNATURE_STATEMENT_BYTES,
  );
  try {
    return parseNativeReleaseSignature(JSON.parse(file.bytes.toString("utf8")));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new TypeError(
        `The release signature is not valid JSON: ${error.message}`,
      );
    }
    throw error;
  }
}

function check(
  id: NativeReleaseSignatureVerificationCheck["id"],
  pass: boolean,
  success: string,
  failure: string,
): NativeReleaseSignatureVerificationCheck {
  return {
    id,
    status: pass ? "pass" : "fail",
    message: pass ? success : failure,
  };
}

export async function createNativeReleaseSigningRequest(
  options: CreateNativeReleaseSigningRequestOptions,
): Promise<CreateNativeReleaseSigningRequestResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const manifestPath = path.resolve(cwd, options.manifestPath);
  if (
    (options.bundleManifestPath === undefined) !==
    (options.artifactPath === undefined)
  ) {
    throw new TypeError(
      "Verified release signing requests require both a bundle manifest and native artifact.",
    );
  }
  const bundleManifestPath =
    options.bundleManifestPath === undefined
      ? undefined
      : path.resolve(cwd, options.bundleManifestPath);
  const artifactPath =
    options.artifactPath === undefined
      ? undefined
      : path.resolve(cwd, options.artifactPath);
  let verification: NativeReleaseVerificationReport | undefined;
  if (bundleManifestPath !== undefined && artifactPath !== undefined) {
    verification = await verifyNativeReleaseManifest({
      cwd,
      manifestPath,
      bundleManifestPath,
      artifactPath,
    });
    if (!verification.ok) {
      throw new TypeError(
        `The release inputs failed verification; refusing to prepare a signing request.\n${formatNativeReleaseVerification(verification)}`,
      );
    }
  }
  const manifest = await readNativeReleaseManifest(manifestPath);
  if (!nativeReleaseFingerprintMatches(manifest)) {
    throw new TypeError(
      "The release manifest fingerprint is invalid; refusing to prepare a signing request.",
    );
  }
  if (
    verification !== undefined &&
    verification.releaseFingerprint !== manifest.releaseFingerprint
  ) {
    throw new TypeError(
      "The release manifest changed after its inputs were verified.",
    );
  }
  const request = signingRequestForStatement(
    signingStatement(options.keyId, manifest.releaseFingerprint),
  );
  const requestPath = path.resolve(
    cwd,
    options.outputPath ?? `${manifestPath}.signing-request.json`,
  );
  if (
    requestPath === manifestPath ||
    requestPath === bundleManifestPath ||
    requestPath === artifactPath
  ) {
    throw new TypeError(
      "The release signing request must not overwrite a release input.",
    );
  }
  const parentMetadata = await stat(path.dirname(requestPath)).catch(
    () => undefined,
  );
  if (parentMetadata?.isDirectory() !== true) {
    throw new TypeError(
      "The release signing request output directory does not exist.",
    );
  }
  const finalManifest = await readNativeReleaseManifest(manifestPath);
  if (
    !nativeReleaseFingerprintMatches(finalManifest) ||
    JSON.stringify(finalManifest) !== JSON.stringify(manifest)
  ) {
    throw new TypeError(
      "The release manifest changed while preparing its signing request.",
    );
  }
  const temporaryPath = `${requestPath}.solid-native-${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(request, null, 2)}\n`, {
      flag: "wx",
      mode: 0o644,
    });
    await rename(temporaryPath, requestPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return {
    requestPath,
    request,
    ...(verification === undefined ? {} : { verification }),
  };
}

export async function createNativeReleaseSignature(
  options: CreateNativeReleaseSignatureOptions,
): Promise<CreateNativeReleaseSignatureResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const manifestPath = path.resolve(cwd, options.manifestPath);
  const privateKeyPath = path.resolve(cwd, options.privateKeyPath);
  if (
    (options.bundleManifestPath === undefined) !==
    (options.artifactPath === undefined)
  ) {
    throw new TypeError(
      "Verified release signing requires both a bundle manifest and native artifact.",
    );
  }
  const bundleManifestPath =
    options.bundleManifestPath === undefined
      ? undefined
      : path.resolve(cwd, options.bundleManifestPath);
  const artifactPath =
    options.artifactPath === undefined
      ? undefined
      : path.resolve(cwd, options.artifactPath);
  let verification: NativeReleaseVerificationReport | undefined;
  if (bundleManifestPath !== undefined && artifactPath !== undefined) {
    verification = await verifyNativeReleaseManifest({
      cwd,
      manifestPath,
      bundleManifestPath,
      artifactPath,
    });
    if (!verification.ok) {
      throw new TypeError(
        `The release inputs failed verification; refusing to sign them.\n${formatNativeReleaseVerification(verification)}`,
      );
    }
  }
  const manifest = await readNativeReleaseManifest(manifestPath);
  if (!nativeReleaseFingerprintMatches(manifest)) {
    throw new TypeError(
      "The release manifest fingerprint is invalid; refusing to sign it.",
    );
  }
  if (
    verification !== undefined &&
    verification.releaseFingerprint !== manifest.releaseFingerprint
  ) {
    throw new TypeError(
      "The release manifest changed after its inputs were verified.",
    );
  }
  const privateKey = await readEd25519PrivateKey(privateKeyPath);
  const statement = signingStatement(
    options.keyId,
    manifest.releaseFingerprint,
  );
  const signature: NativeReleaseSignature = {
    ...statement,
    signature: sign(null, signaturePayload(statement), privateKey).toString(
      "base64url",
    ),
  };
  const signaturePath = path.resolve(
    cwd,
    options.outputPath ?? `${manifestPath}.sig.json`,
  );
  if (
    signaturePath === manifestPath ||
    signaturePath === privateKeyPath ||
    signaturePath === bundleManifestPath ||
    signaturePath === artifactPath
  ) {
    throw new TypeError(
      "The release signature must not overwrite a signing input.",
    );
  }
  const parentMetadata = await stat(path.dirname(signaturePath)).catch(
    () => undefined,
  );
  if (parentMetadata?.isDirectory() !== true) {
    throw new TypeError(
      "The release signature output directory does not exist.",
    );
  }
  const finalManifest = await readNativeReleaseManifest(manifestPath);
  if (
    !nativeReleaseFingerprintMatches(finalManifest) ||
    JSON.stringify(finalManifest) !== JSON.stringify(manifest)
  ) {
    throw new TypeError("The release manifest changed while being signed.");
  }
  const temporaryPath = `${signaturePath}.solid-native-${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(signature, null, 2)}\n`, {
      flag: "wx",
      mode: 0o644,
    });
    await rename(temporaryPath, signaturePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return {
    signaturePath,
    signature,
    ...(verification === undefined ? {} : { verification }),
  };
}

export async function assembleNativeReleaseSignature(
  options: AssembleNativeReleaseSignatureOptions,
): Promise<AssembleNativeReleaseSignatureResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const requestPath = path.resolve(cwd, options.requestPath);
  const detachedSignaturePath = path.resolve(
    cwd,
    options.detachedSignaturePath,
  );
  const publicKeyPath = path.resolve(cwd, options.publicKeyPath);
  const signaturePath = path.resolve(
    cwd,
    options.outputPath ?? `${requestPath}.sig.json`,
  );
  if (
    signaturePath === requestPath ||
    signaturePath === detachedSignaturePath ||
    signaturePath === publicKeyPath
  ) {
    throw new TypeError(
      "The assembled release signature must not overwrite an assembly input.",
    );
  }
  const [request, detachedSignature, publicKey] = await Promise.all([
    readNativeReleaseSigningRequest(requestPath),
    readDetachedEd25519Signature(detachedSignaturePath),
    readEd25519PublicKey(publicKeyPath),
  ]);
  const statement = signingStatement(request.keyId, request.releaseFingerprint);
  const payload = signaturePayload(statement);
  if (!verify(null, payload, publicKey, detachedSignature.bytes)) {
    throw new TypeError(
      "The detached Ed25519 signature does not authenticate the release signing request with the supplied public key.",
    );
  }
  const signature = parseNativeReleaseSignature({
    ...statement,
    signature: detachedSignature.base64url,
  });
  const parentMetadata = await stat(path.dirname(signaturePath)).catch(
    () => undefined,
  );
  if (parentMetadata?.isDirectory() !== true) {
    throw new TypeError(
      "The assembled release signature output directory does not exist.",
    );
  }
  const temporaryPath = `${signaturePath}.solid-native-${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(signature, null, 2)}\n`, {
      flag: "wx",
      mode: 0o644,
    });
    await rename(temporaryPath, signaturePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return { requestPath, signaturePath, signature };
}

export async function verifyNativeReleaseSignature(
  options: VerifyNativeReleaseSignatureOptions,
): Promise<NativeReleaseSignatureVerificationReport> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const manifestPath = path.resolve(cwd, options.manifestPath);
  const signaturePath = path.resolve(cwd, options.signaturePath);
  const uncheckedMode = options as unknown as {
    readonly bundleManifestPath?: unknown;
    readonly artifactPath?: unknown;
    readonly envelopeOnly?: unknown;
  };
  const { bundleManifestPath, artifactPath, envelopeOnly } = uncheckedMode;
  if (envelopeOnly !== undefined && typeof envelopeOnly !== "boolean") {
    throw new TypeError(
      "Release signature envelope-only mode must be a boolean.",
    );
  }
  if (
    (bundleManifestPath !== undefined &&
      typeof bundleManifestPath !== "string") ||
    (artifactPath !== undefined && typeof artifactPath !== "string")
  ) {
    throw new TypeError(
      "Release signature input paths must be strings when supplied.",
    );
  }
  if ((bundleManifestPath === undefined) !== (artifactPath === undefined)) {
    throw new TypeError(
      "Release signature input verification requires both a bundle manifest and native artifact.",
    );
  }
  if (
    envelopeOnly === true &&
    (bundleManifestPath !== undefined || artifactPath !== undefined)
  ) {
    throw new TypeError(
      "Envelope-only signature verification cannot also verify release inputs.",
    );
  }
  if (
    envelopeOnly !== true &&
    bundleManifestPath === undefined &&
    artifactPath === undefined
  ) {
    throw new TypeError(
      "Release signature verification requires release inputs or explicit envelope-only mode.",
    );
  }
  const uncheckedTrust = options as unknown as {
    readonly expectedKeyId?: unknown;
    readonly minimumTrustPolicySequence?: unknown;
    readonly policy?: unknown;
    readonly publicKeyPath?: unknown;
    readonly trustPolicyPath?: unknown;
  };
  const {
    expectedKeyId: uncheckedExpectedKeyId,
    minimumTrustPolicySequence: uncheckedMinimumTrustPolicySequence,
    policy: uncheckedPolicy,
    publicKeyPath: uncheckedPublicKeyPath,
    trustPolicyPath: uncheckedTrustPolicyPath,
  } = uncheckedTrust;
  if (
    uncheckedMinimumTrustPolicySequence !== undefined &&
    (typeof uncheckedMinimumTrustPolicySequence !== "number" ||
      !Number.isSafeInteger(uncheckedMinimumTrustPolicySequence) ||
      uncheckedMinimumTrustPolicySequence <= 0)
  ) {
    throw new TypeError(
      "The minimum release trust policy sequence must be a positive safe integer.",
    );
  }
  if (
    uncheckedTrustPolicyPath !== undefined &&
    typeof uncheckedTrustPolicyPath !== "string"
  ) {
    throw new TypeError("The release trust policy path must be a string.");
  }
  const pinnedTrustSupplied =
    uncheckedExpectedKeyId !== undefined ||
    uncheckedPolicy !== undefined ||
    uncheckedPublicKeyPath !== undefined;
  if (uncheckedTrustPolicyPath !== undefined && pinnedTrustSupplied) {
    throw new TypeError(
      "Release signature verification cannot combine a trust policy file with pinned-key options.",
    );
  }
  if (
    uncheckedTrustPolicyPath === undefined &&
    uncheckedMinimumTrustPolicySequence !== undefined
  ) {
    throw new TypeError(
      "A minimum release trust policy sequence requires a trust policy file.",
    );
  }
  if (
    uncheckedTrustPolicyPath === undefined &&
    (uncheckedExpectedKeyId === undefined ||
      uncheckedPolicy === undefined ||
      typeof uncheckedPublicKeyPath !== "string")
  ) {
    throw new TypeError(
      "Release signature verification requires a trust policy file or complete pinned-key options.",
    );
  }
  const inputVerificationPromise =
    bundleManifestPath === undefined || artifactPath === undefined
      ? Promise.resolve(undefined)
      : verifyNativeReleaseManifest({
          cwd,
          manifestPath,
          bundleManifestPath: path.resolve(cwd, bundleManifestPath),
          artifactPath: path.resolve(cwd, artifactPath),
        });
  const [manifest, signatureStatement, inputVerification] = await Promise.all([
    readNativeReleaseManifest(manifestPath),
    readNativeReleaseSignature(signaturePath),
    inputVerificationPromise,
  ]);
  let policy: NativeReleaseAuthorizationPolicy;
  let publicKey: KeyObject | undefined;
  let keyAuthorized: boolean;
  let keySuccess: string;
  let keyFailure: string;
  let trustPolicyPath: string | undefined;
  let trustPolicyFingerprint: string | undefined;
  let trustPolicySequence: number | undefined;
  let trustPolicySequenceAccepted = true;
  if (uncheckedTrustPolicyPath !== undefined) {
    trustPolicyPath = path.resolve(cwd, uncheckedTrustPolicyPath);
    const trustPolicy = await readNativeReleaseTrustPolicy(trustPolicyPath);
    const {
      schemaVersion: _schemaVersion,
      policySequence,
      keys,
      ...authorization
    } = trustPolicy;
    policy = authorization;
    trustPolicySequence = policySequence;
    trustPolicyFingerprint = fingerprintParsedReleaseTrustPolicy(trustPolicy);
    trustPolicySequenceAccepted =
      uncheckedMinimumTrustPolicySequence === undefined ||
      policySequence >= uncheckedMinimumTrustPolicySequence;
    const trustedKey = keys.find(
      (entry) => entry.keyId === signatureStatement.keyId,
    );
    publicKey =
      trustedKey === undefined
        ? undefined
        : publicEd25519KeyFromSpki(
            trustedKey.publicKeySpki,
            `Release trust policy key ${trustedKey.keyId}`,
          );
    keyAuthorized = trustedKey?.status === "active";
    keySuccess = "The authenticated key is active in the release trust policy.";
    keyFailure =
      trustedKey?.status === "revoked"
        ? "The authenticated key is revoked by the release trust policy."
        : "The authenticated key is absent from the release trust policy.";
  } else {
    const expectedKeyId = assertKeyId(
      uncheckedExpectedKeyId,
      "The expected signing key ID",
    );
    policy = parseReleaseAuthorizationPolicy(uncheckedPolicy);
    publicKey = await readEd25519PublicKey(
      path.resolve(cwd, uncheckedPublicKeyPath as string),
    );
    keyAuthorized = signatureStatement.keyId === expectedKeyId;
    keySuccess = "The authenticated key ID matches the pinned key identity.";
    keyFailure =
      "The authenticated key ID does not match the pinned key identity.";
  }
  const policyMismatches = releaseAuthorizationMismatches(manifest, policy);
  const unsignedStatement = {
    schemaVersion: signatureStatement.schemaVersion,
    algorithm: signatureStatement.algorithm,
    keyId: signatureStatement.keyId,
    releaseFingerprint: signatureStatement.releaseFingerprint,
  };
  const checks: NativeReleaseSignatureVerificationCheck[] = [
    check(
      "envelope",
      nativeReleaseFingerprintMatches(manifest) &&
        manifest.releaseFingerprint === signatureStatement.releaseFingerprint,
      "The signed release fingerprint matches the canonical envelope.",
      "The signed release fingerprint does not match the canonical envelope.",
    ),
    ...(trustPolicyPath === undefined
      ? []
      : [
          check(
            "trust-policy",
            trustPolicySequenceAccepted,
            uncheckedMinimumTrustPolicySequence === undefined
              ? `The release trust policy sequence ${String(trustPolicySequence)} is valid.`
              : `The release trust policy sequence ${String(trustPolicySequence)} satisfies the required minimum ${String(uncheckedMinimumTrustPolicySequence)}.`,
            `The release trust policy sequence ${String(trustPolicySequence)} is below the required minimum ${String(uncheckedMinimumTrustPolicySequence)}.`,
          ),
        ]),
    check("key", keyAuthorized, keySuccess, keyFailure),
    check(
      "signature",
      publicKey !== undefined &&
        verify(
          null,
          signaturePayload(unsignedStatement),
          publicKey,
          Buffer.from(signatureStatement.signature, "base64url"),
        ),
      trustPolicyPath === undefined
        ? "The Ed25519 signature is valid for the pinned public key."
        : "The Ed25519 signature is valid for the trust-policy public key.",
      trustPolicyPath === undefined
        ? "The Ed25519 signature is invalid for the pinned public key."
        : "The Ed25519 signature is invalid for the trust-policy public key.",
    ),
    check(
      "policy",
      policyMismatches.length === 0,
      "The signed envelope matches the trusted release authorization policy.",
      `The signed envelope does not match release policy: ${policyMismatches.join(", ")}.`,
    ),
    ...(inputVerification === undefined
      ? []
      : [
          check(
            "inputs",
            inputVerification.ok &&
              inputVerification.releaseFingerprint ===
                manifest.releaseFingerprint,
            "The bundle, native artifact, embedded Hermes, and compatibility inputs match this signed envelope.",
            "The release inputs do not match this signed envelope.",
          ),
        ]),
  ];
  const ok = checks.every((entry) => entry.status === "pass");
  const authorizedRelease: NativeAuthorizedRelease | undefined = ok
    ? Object.freeze({
        schemaVersion: 0,
        projectName: manifest.projectName,
        platform: manifest.platform,
        release: manifest.release,
        channel: manifest.channel,
        sourceRevision: manifest.sourceRevision,
        releaseFingerprint: manifest.releaseFingerprint,
        bundleFingerprint: manifest.bundleFingerprint,
        nativeCompatibilityFingerprint: manifest.nativeCompatibilityFingerprint,
        artifactSha256: manifest.artifact.sha256,
        authenticatedKeyId: signatureStatement.keyId,
        inputsVerified: inputVerification !== undefined,
        ...(trustPolicyFingerprint === undefined
          ? {}
          : { trustPolicyFingerprint }),
        ...(trustPolicySequence === undefined ? {} : { trustPolicySequence }),
      })
    : undefined;
  const report = {
    schemaVersion: 0 as const,
    manifestPath,
    signaturePath,
    releaseFingerprint: signatureStatement.releaseFingerprint,
    keyId: signatureStatement.keyId,
    policy,
    ...(trustPolicyPath === undefined ? {} : { trustPolicyPath }),
    ...(trustPolicyFingerprint === undefined ? {} : { trustPolicyFingerprint }),
    ...(trustPolicySequence === undefined ? {} : { trustPolicySequence }),
    ...(inputVerification === undefined ? {} : { inputVerification }),
    checks,
  };
  return ok
    ? { ...report, ok: true, authorizedRelease: authorizedRelease! }
    : { ...report, ok: false };
}

export function formatNativeReleaseSignatureVerification(
  report: NativeReleaseSignatureVerificationReport,
): string {
  return [
    `${report.ok ? "PASS" : "FAIL"} Solid Native release signature ${report.releaseFingerprint}`,
    `Key: ${report.keyId}`,
    ...(report.trustPolicyPath === undefined
      ? []
      : [`Trust policy: ${report.trustPolicyPath}`]),
    ...(report.trustPolicyFingerprint === undefined ||
    report.trustPolicySequence === undefined
      ? []
      : [
          `Trust policy identity: ${report.trustPolicyFingerprint} (sequence ${String(report.trustPolicySequence)})`,
        ]),
    `Manifest: ${report.manifestPath}`,
    `Signature: ${report.signaturePath}`,
    ...report.checks.map(
      (entry) =>
        `${entry.status === "pass" ? "PASS" : "FAIL"} ${entry.id}: ${entry.message}`,
    ),
    ...(report.inputVerification === undefined
      ? ["Inputs: envelope only; native build inputs were not verified."]
      : ["", formatNativeReleaseVerification(report.inputVerification)]),
  ].join("\n");
}
