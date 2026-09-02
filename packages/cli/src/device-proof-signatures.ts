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
  readDetachedEd25519Signature,
  readEd25519PrivateKey,
  readEd25519PublicKey,
  readStableRegularFile,
  publicEd25519KeyFromSpki,
} from "./signature-utilities.js";

export interface NativeDeviceProofSourcePolicyCheck {
  readonly kind: "required-source" | "forbidden-fragment";
  readonly matches: number;
  readonly pattern: string;
}

export interface NativeDeviceProofFileFact {
  readonly bytes: number;
  readonly sha256: string;
}

interface NativeAndroidDeviceProofReceiptBase {
  readonly proof: "solid-native-android-release-device";
  readonly status: "passed";
  readonly measuredAt: string;
  readonly source: Readonly<{
    revision: string;
    dirty: boolean;
  }>;
  readonly device: Readonly<{
    kind: "physical";
    serialSha256: string;
    manufacturer: string;
    model: string;
    product: string;
    abi: string;
    osVersion: string;
    sdkLevel: number;
    buildFingerprintSha256: string;
    batteryLevel: number;
    batteryTemperatureCelsius: number;
    lowPowerMode: boolean;
  }>;
  readonly nativeCompatibility: Readonly<{
    fingerprint: string;
    inputCount: number;
  }>;
  readonly generatedBindings: Readonly<{
    bytes: number;
    fileSha256: string;
    manifestSha256: string;
  }>;
  readonly artifacts: Readonly<{
    applicationApk: NativeDeviceProofFileFact;
    instrumentationApk: NativeDeviceProofFileFact;
  }>;
  readonly instrumentation: Readonly<{
    className: string;
    durationSeconds: number;
    reportedAt: string;
    testName: string;
    resultBytes: number;
    resultSha256: string;
    exitCodeSha256: string;
  }>;
}

export interface NativeDeviceProofSourceMapFact {
  readonly bytes: number;
  readonly sha256: string;
  readonly sourceCount: number;
  readonly checks: readonly NativeDeviceProofSourcePolicyCheck[];
}

/** Legacy receipt whose `bundle` field contains source-map, not bundle, bytes. */
export interface NativeAndroidDeviceProofReceiptV0 extends NativeAndroidDeviceProofReceiptBase {
  readonly schemaVersion: 0;
  readonly bundle: NativeDeviceProofSourceMapFact;
}

/** Portable receipt with distinct JavaScript-bundle and source-map identities. */
export interface NativeAndroidDeviceProofReceiptV1 extends NativeAndroidDeviceProofReceiptBase {
  readonly schemaVersion: 1;
  readonly bundle: NativeDeviceProofFileFact;
  readonly sourceMap: NativeDeviceProofSourceMapFact;
}

export type NativeAndroidDeviceProofReceipt =
  NativeAndroidDeviceProofReceiptV0 | NativeAndroidDeviceProofReceiptV1;

export interface NativeDeviceProofSignature {
  readonly schemaVersion: 0;
  readonly algorithm: "ed25519";
  readonly keyId: string;
  readonly projectName: string;
  readonly proofSha256: string;
  readonly signature: string;
}

export interface CreateNativeDeviceProofSignatureOptions {
  readonly cwd?: string;
  readonly proofPath: string;
  readonly privateKeyPath: string;
  readonly keyId: string;
  /** Separately governed application identity included in the signed payload. */
  readonly projectName: string;
  readonly outputPath?: string;
}

export interface CreateNativeDeviceProofSignatureResult {
  readonly proofPath: string;
  readonly signaturePath: string;
  readonly signature: NativeDeviceProofSignature;
  readonly receipt: NativeAndroidDeviceProofReceipt;
}

export interface NativeDeviceProofSigningRequest {
  readonly schemaVersion: 0;
  readonly algorithm: "ed25519";
  readonly keyId: string;
  readonly projectName: string;
  readonly proofSha256: string;
  /** Canonical contextual signing payload as unpadded base64url. */
  readonly payloadBase64url: string;
  /** Lowercase hexadecimal SHA-256 of the decoded signing payload. */
  readonly payloadSha256: string;
}

export interface CreateNativeDeviceProofSigningRequestOptions {
  readonly cwd?: string;
  readonly proofPath: string;
  readonly keyId: string;
  readonly projectName: string;
  readonly outputPath?: string;
}

export interface CreateNativeDeviceProofSigningRequestResult {
  readonly proofPath: string;
  readonly requestPath: string;
  readonly request: NativeDeviceProofSigningRequest;
  readonly receipt: NativeAndroidDeviceProofReceipt;
}

export interface AssembleNativeDeviceProofSignatureOptions {
  readonly cwd?: string;
  readonly requestPath: string;
  readonly detachedSignaturePath: string;
  readonly publicKeyPath: string;
  readonly outputPath?: string;
}

export interface AssembleNativeDeviceProofSignatureResult {
  readonly requestPath: string;
  readonly signaturePath: string;
  readonly signature: NativeDeviceProofSignature;
}

interface VerifyNativeDeviceProofSignatureBaseOptions {
  readonly cwd?: string;
  readonly proofPath: string;
  readonly signaturePath: string;
  /** Optional exact digest of the receipt bytes, including the sha256: prefix. */
  readonly expectedProofSha256?: string;
  readonly expectedSourceRevision?: string;
  readonly expectedNativeCompatibilityFingerprint?: string;
  /** Optional lowercase SHA-256 of the application APK. */
  readonly expectedApplicationArtifactSha256?: string;
  /** Exact verified instrumentation/source-policy profile. Required for portable schema 1. */
  readonly expectedProfileFingerprint?: string;
  /** Inclusive canonical UTC lower bound for the signed measurement time. */
  readonly minimumMeasuredAt?: string;
  /** Inclusive canonical UTC upper bound for the signed measurement time. */
  readonly maximumMeasuredAt?: string;
}

export interface VerifyNativeDeviceProofSignatureWithPinnedKeyOptions extends VerifyNativeDeviceProofSignatureBaseOptions {
  readonly publicKeyPath: string;
  readonly expectedKeyId: string;
  /** Separately trusted application identity expected in the signed payload. */
  readonly projectName: string;
  readonly trustPolicyPath?: never;
  readonly minimumTrustPolicySequence?: never;
}

export interface VerifyNativeDeviceProofSignatureWithTrustPolicyOptions extends VerifyNativeDeviceProofSignatureBaseOptions {
  readonly trustPolicyPath: string;
  readonly minimumTrustPolicySequence?: number;
  readonly publicKeyPath?: never;
  readonly expectedKeyId?: never;
  readonly projectName?: never;
}

export type VerifyNativeDeviceProofSignatureOptions =
  | VerifyNativeDeviceProofSignatureWithPinnedKeyOptions
  | VerifyNativeDeviceProofSignatureWithTrustPolicyOptions;

export interface NativeDeviceProofTrustedKey {
  readonly keyId: string;
  readonly algorithm: "ed25519";
  readonly publicKeySpki: string;
  readonly status: "active" | "revoked";
}

interface NativeDeviceProofTrustPolicyBase {
  readonly policySequence: number;
  readonly projectName: string;
  readonly proof: "solid-native-android-release-device";
  readonly keys: readonly NativeDeviceProofTrustedKey[];
}

export interface NativeDeviceProofTrustPolicyV0 extends NativeDeviceProofTrustPolicyBase {
  readonly schemaVersion: 0;
}

export interface NativeDeviceProofTrustPolicyV1 extends NativeDeviceProofTrustPolicyBase {
  readonly schemaVersion: 1;
  readonly profileFingerprint: string;
}

export type NativeDeviceProofTrustPolicy =
  NativeDeviceProofTrustPolicyV0 | NativeDeviceProofTrustPolicyV1;

export interface NativeDeviceProofVerificationPolicy {
  readonly projectName: string;
  readonly expectedProofSha256?: string;
  readonly expectedSourceRevision?: string;
  readonly expectedNativeCompatibilityFingerprint?: string;
  readonly expectedApplicationArtifactSha256?: string;
  readonly expectedProfileFingerprint?: string;
  readonly minimumMeasuredAt?: string;
  readonly maximumMeasuredAt?: string;
}

export interface NativeDeviceProofProfile {
  readonly schemaVersion: 0;
  readonly kind: "solid-native.android-device-proof-profile";
  readonly proof: "solid-native-android-release-device";
  readonly receiptSchemaVersion: 0 | 1;
  readonly profileFingerprint: string;
  readonly instrumentation: Readonly<{
    readonly className: string;
    readonly testName: string;
  }>;
  readonly sourcePolicy: readonly NativeDeviceProofSourcePolicyCheck[];
}

export interface NativeAuthenticatedDeviceProof {
  readonly schemaVersion: 0;
  readonly projectName: string;
  readonly proof: "solid-native-android-release-device";
  readonly proofSha256: string;
  readonly receiptSchemaVersion: 0 | 1;
  readonly profileFingerprint: string;
  readonly sourceRevision: string;
  readonly measuredAt: string;
  readonly nativeCompatibilityFingerprint: string;
  readonly applicationArtifactSha256: string;
  readonly deviceModel: string;
  readonly authenticatedKeyId: string;
  readonly trustPolicyFingerprint?: string;
  readonly trustPolicySequence?: number;
}

export interface NativeDeviceProofSignatureVerificationCheck {
  readonly id:
    | "proof"
    | "trust-policy"
    | "key"
    | "signature"
    | "policy"
    | "profile"
    | "lineage"
    | "time-policy";
  readonly status: "pass" | "fail";
  readonly message: string;
}

interface NativeDeviceProofSignatureVerificationReportBase {
  readonly schemaVersion: 0;
  readonly proofPath: string;
  readonly signaturePath: string;
  readonly proofSha256: string;
  readonly keyId: string;
  readonly projectName: string;
  readonly policy: NativeDeviceProofVerificationPolicy;
  readonly trustPolicyPath?: string;
  readonly trustPolicyFingerprint?: string;
  readonly trustPolicySequence?: number;
  readonly checks: readonly NativeDeviceProofSignatureVerificationCheck[];
}

export type NativeDeviceProofSignatureVerificationReport =
  NativeDeviceProofSignatureVerificationReportBase &
    (
      | {
          readonly ok: true;
          readonly authenticatedProof: NativeAuthenticatedDeviceProof;
        }
      | {
          readonly ok: false;
          readonly authenticatedProof?: never;
        }
    );

export type CreateNativeDeviceProofIngestionOptions =
  VerifyNativeDeviceProofSignatureOptions;

export interface NativeDeviceProofIngestion {
  readonly schemaVersion: 0;
  readonly kind: "solid-native.device-proof-ingestion";
  /** Exact successful verifier lineage; never interchangeable with a release. */
  readonly authenticatedProof: NativeAuthenticatedDeviceProof;
  readonly verificationPolicy: NativeDeviceProofVerificationPolicy;
  readonly environment: Readonly<{
    readonly platform: "android";
    readonly device: Readonly<{
      readonly kind: "physical";
      readonly manufacturer: string;
      readonly model: string;
      readonly product: string;
      readonly abi: string;
      readonly osVersion: string;
      readonly sdkLevel: number;
      readonly buildFingerprintSha256: string;
      readonly batteryLevel: number;
      readonly batteryTemperatureCelsius: number;
      readonly lowPowerMode: boolean;
    }>;
  }>;
  readonly inputs: Readonly<{
    readonly nativeCompatibility: NativeAndroidDeviceProofReceipt["nativeCompatibility"];
    readonly generatedBindings: NativeAndroidDeviceProofReceipt["generatedBindings"];
    /** Present only when the receipt independently identified JavaScript bytes. */
    readonly bundle?: NativeDeviceProofFileFact;
    readonly sourceMap: Readonly<{
      readonly bytes: number;
      readonly sha256: string;
      readonly sourceCount: number;
    }>;
    readonly artifacts: NativeAndroidDeviceProofReceipt["artifacts"];
  }>;
  readonly execution: NativeAndroidDeviceProofReceipt["instrumentation"];
}

const MAX_PROOF_BYTES = 1024 * 1024;
const MAX_SIGNATURE_BYTES = 64 * 1024;
const MAX_SIGNING_REQUEST_BYTES = 64 * 1024;
const MAX_TRUST_POLICY_BYTES = 64 * 1024;
const MAX_TRUST_POLICY_KEYS = 32;
const MAX_SOURCE_POLICY_CHECKS = 64;
const MAX_APK_BYTES = 1024 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 512 * 1024 * 1024;
const MAX_SOURCE_MAP_BYTES = 512 * 1024 * 1024;
const MAX_BINDING_BYTES = 16 * 1024 * 1024;
const MAX_INSTRUMENTATION_BYTES = 1024 * 1024;
const MAX_INSTRUMENTATION_SECONDS = 20 * 60;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/u;
const REVISION_PATTERN = /^[a-f0-9]{7,64}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const BASE64URL_SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/u;
const INSTRUMENTATION_CLASS_PATTERN =
  /^(?:[A-Za-z_$][A-Za-z0-9_$]*\.)+[A-Za-z_$][A-Za-z0-9_$]*$/u;
const INSTRUMENTATION_TEST_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/u;
const SIGNATURE_CONTEXT = "solid-native.device-proof-signature.v0\0";

const ANDROID_SOURCE_POLICY: readonly NativeDeviceProofSourcePolicyCheck[] =
  Object.freeze([
    Object.freeze({
      kind: "required-source",
      matches: 1,
      pattern: "app:///apps/native-e2e/adapters/NotifeeApiModule.ts",
    }),
    Object.freeze({
      kind: "required-source",
      matches: 1,
      pattern: "app:///apps/native-e2e/generated/SolidNativeBindings.ts",
    }),
    Object.freeze({
      kind: "required-source",
      matches: 1,
      pattern: "app:///packages/notifications/dist/notify-kit-10.js",
    }),
    Object.freeze({
      kind: "forbidden-fragment",
      matches: 0,
      pattern: "/node_modules/react-native-notify-kit/",
    }),
  ]);

function record(
  value: unknown,
  location: string,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${location} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${location} must be a plain object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  location: string,
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new TypeError(`${location} has unexpected or missing fields.`);
  }
}

function boundedString(
  value: unknown,
  location: string,
  maximumLength = 1024,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    /[\r\n\0]/u.test(value)
  ) {
    throw new TypeError(`${location} is invalid.`);
  }
  return value;
}

function integer(
  value: unknown,
  location: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new TypeError(`${location} is invalid.`);
  }
  return value;
}

function finiteNumber(
  value: unknown,
  location: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new TypeError(`${location} is invalid.`);
  }
  return value;
}

function sha256(value: unknown, location: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${location} is not a lowercase SHA-256 digest.`);
  }
  return value;
}

function sourceRevision(value: unknown, location: string): string {
  if (typeof value !== "string" || !REVISION_PATTERN.test(value)) {
    throw new TypeError(`${location} is not a lowercase source revision.`);
  }
  return value;
}

function fingerprint(value: unknown, location: string): string {
  if (typeof value !== "string" || !FINGERPRINT_PATTERN.test(value)) {
    throw new TypeError(`${location} is not a SHA-256 fingerprint.`);
  }
  return value;
}

function canonicalTimestamp(value: unknown, location: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${location} is invalid.`);
  }
  let canonical: string;
  try {
    canonical = new Date(value).toISOString();
  } catch {
    throw new TypeError(`${location} is invalid.`);
  }
  if (canonical !== value) {
    throw new TypeError(`${location} must be canonical UTC.`);
  }
  return value;
}

function fileFact(
  value: unknown,
  location: string,
  maximumBytes: number,
): NativeDeviceProofFileFact {
  const source = record(value, location);
  exactKeys(source, ["bytes", "sha256"], location);
  return Object.freeze({
    bytes: integer(source.bytes, `${location}.bytes`, 1, maximumBytes),
    sha256: sha256(source.sha256, `${location}.sha256`),
  });
}

function projectName(value: unknown, location: string): string {
  return boundedString(value, location, 214);
}

function keyId(value: unknown, location: string): string {
  if (typeof value !== "string" || !KEY_ID_PATTERN.test(value)) {
    throw new TypeError(`${location} must be a static key identifier.`);
  }
  return value;
}

function parseNativeDeviceProofTrustPolicy(
  value: unknown,
): NativeDeviceProofTrustPolicy {
  const policy = record(value, "Device proof trust policy");
  const schemaVersion = policy.schemaVersion;
  exactKeys(
    policy,
    schemaVersion === 1
      ? [
          "keys",
          "policySequence",
          "profileFingerprint",
          "projectName",
          "proof",
          "schemaVersion",
        ]
      : ["keys", "policySequence", "projectName", "proof", "schemaVersion"],
    "Device proof trust policy",
  );
  if (
    (schemaVersion !== 0 && schemaVersion !== 1) ||
    policy.proof !== "solid-native-android-release-device" ||
    !Array.isArray(policy.keys) ||
    policy.keys.length === 0 ||
    policy.keys.length > MAX_TRUST_POLICY_KEYS
  ) {
    throw new TypeError("Device proof trust policy has an invalid schema.");
  }
  const parsedProjectName = projectName(
    policy.projectName,
    "Device proof trust policy project name",
  );
  const policySequence = integer(
    policy.policySequence,
    "Device proof trust policy sequence",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const keyIds = new Set<string>();
  const publicKeys = new Set<string>();
  const keys = policy.keys
    .map((value, index): NativeDeviceProofTrustedKey => {
      const entry = record(value, `Device proof trust policy key ${index}`);
      exactKeys(
        entry,
        ["algorithm", "keyId", "publicKeySpki", "status"],
        `Device proof trust policy key ${index}`,
      );
      if (
        entry.algorithm !== "ed25519" ||
        typeof entry.publicKeySpki !== "string" ||
        (entry.status !== "active" && entry.status !== "revoked")
      ) {
        throw new TypeError(
          `Device proof trust policy key ${index} has an invalid schema.`,
        );
      }
      const parsedKeyId = keyId(
        entry.keyId,
        `Device proof trust policy key ${index} ID`,
      );
      if (keyIds.has(parsedKeyId)) {
        throw new TypeError(
          `Device proof trust policy key ID ${parsedKeyId} is duplicated.`,
        );
      }
      keyIds.add(parsedKeyId);
      publicEd25519KeyFromSpki(
        entry.publicKeySpki,
        `Device proof trust policy key ${parsedKeyId}`,
      );
      if (publicKeys.has(entry.publicKeySpki)) {
        throw new TypeError(
          `Device proof trust policy key ${parsedKeyId} duplicates another public key.`,
        );
      }
      publicKeys.add(entry.publicKeySpki);
      return Object.freeze({
        keyId: parsedKeyId,
        algorithm: "ed25519",
        publicKeySpki: entry.publicKeySpki,
        status: entry.status,
      });
    })
    .sort((left, right) =>
      left.keyId < right.keyId ? -1 : left.keyId > right.keyId ? 1 : 0,
    );
  const common = {
    policySequence,
    projectName: parsedProjectName,
    proof: "solid-native-android-release-device",
    keys: Object.freeze(keys),
  } as const;
  return schemaVersion === 0
    ? Object.freeze({ schemaVersion: 0, ...common })
    : Object.freeze({
        schemaVersion: 1,
        ...common,
        profileFingerprint: fingerprint(
          policy.profileFingerprint,
          "Device proof trust policy profile fingerprint",
        ),
      });
}

function fingerprintParsedDeviceProofTrustPolicy(
  policy: NativeDeviceProofTrustPolicy,
): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(policy), "utf8")
    .digest("hex")}`;
}

export function nativeDeviceProofTrustPolicyFingerprint(
  policy: NativeDeviceProofTrustPolicy,
): string {
  return fingerprintParsedDeviceProofTrustPolicy(
    parseNativeDeviceProofTrustPolicy(policy),
  );
}

export async function readNativeDeviceProofTrustPolicy(
  policyPath: string,
): Promise<NativeDeviceProofTrustPolicy> {
  if (typeof policyPath !== "string" || policyPath.length === 0) {
    throw new TypeError("The device proof trust policy path must be a string.");
  }
  const file = await readStableRegularFile(
    path.resolve(policyPath),
    "Device proof trust policy",
    MAX_TRUST_POLICY_BYTES,
  );
  return parseNativeDeviceProofTrustPolicy(
    parseJson(file.bytes, "Device proof trust policy"),
  );
}

export function parseNativeDeviceProofReceipt(
  value: unknown,
): NativeAndroidDeviceProofReceipt {
  const receipt = record(value, "Device proof receipt");
  exactKeys(
    receipt,
    receipt.schemaVersion === 1
      ? [
          "artifacts",
          "bundle",
          "device",
          "generatedBindings",
          "instrumentation",
          "measuredAt",
          "nativeCompatibility",
          "proof",
          "schemaVersion",
          "source",
          "sourceMap",
          "status",
        ]
      : [
          "artifacts",
          "bundle",
          "device",
          "generatedBindings",
          "instrumentation",
          "measuredAt",
          "nativeCompatibility",
          "proof",
          "schemaVersion",
          "source",
          "status",
        ],
    "Device proof receipt",
  );
  if (
    (receipt.schemaVersion !== 0 && receipt.schemaVersion !== 1) ||
    receipt.proof !== "solid-native-android-release-device" ||
    receipt.status !== "passed"
  ) {
    throw new TypeError("Device proof receipt identity is invalid.");
  }
  const measuredAt = canonicalTimestamp(
    receipt.measuredAt,
    "Device proof receipt measuredAt",
  );

  const source = record(receipt.source, "Device proof receipt source");
  exactKeys(source, ["dirty", "revision"], "Device proof receipt source");
  if (
    typeof source.revision !== "string" ||
    !REVISION_PATTERN.test(source.revision) ||
    typeof source.dirty !== "boolean"
  ) {
    throw new TypeError("Device proof receipt source identity is invalid.");
  }

  const device = record(receipt.device, "Device proof receipt device");
  exactKeys(
    device,
    [
      "abi",
      "batteryLevel",
      "batteryTemperatureCelsius",
      "buildFingerprintSha256",
      "kind",
      "lowPowerMode",
      "manufacturer",
      "model",
      "osVersion",
      "product",
      "sdkLevel",
      "serialSha256",
    ],
    "Device proof receipt device",
  );
  if (device.kind !== "physical" || typeof device.lowPowerMode !== "boolean") {
    throw new TypeError(
      "Device proof receipt did not identify physical hardware.",
    );
  }
  const parsedDevice = Object.freeze({
    kind: "physical" as const,
    serialSha256: fingerprint(
      device.serialSha256,
      "Device proof receipt serial identity",
    ),
    manufacturer: boundedString(
      device.manufacturer,
      "Device proof receipt manufacturer",
    ),
    model: boundedString(device.model, "Device proof receipt model"),
    product: boundedString(device.product, "Device proof receipt product"),
    abi: boundedString(device.abi, "Device proof receipt ABI"),
    osVersion: boundedString(
      device.osVersion,
      "Device proof receipt OS version",
    ),
    sdkLevel: integer(
      device.sdkLevel,
      "Device proof receipt SDK level",
      1,
      999,
    ),
    buildFingerprintSha256: fingerprint(
      device.buildFingerprintSha256,
      "Device proof receipt build identity",
    ),
    batteryLevel: integer(
      device.batteryLevel,
      "Device proof receipt battery level",
      0,
      100,
    ),
    batteryTemperatureCelsius: finiteNumber(
      device.batteryTemperatureCelsius,
      "Device proof receipt battery temperature",
      -50,
      150,
    ),
    lowPowerMode: device.lowPowerMode,
  });

  const compatibility = record(
    receipt.nativeCompatibility,
    "Device proof receipt native compatibility",
  );
  exactKeys(
    compatibility,
    ["fingerprint", "inputCount"],
    "Device proof receipt native compatibility",
  );
  const parsedCompatibility = Object.freeze({
    fingerprint: fingerprint(
      compatibility.fingerprint,
      "Device proof receipt native compatibility fingerprint",
    ),
    inputCount: integer(
      compatibility.inputCount,
      "Device proof receipt native compatibility input count",
      1,
      10_000,
    ),
  });

  const bindings = record(
    receipt.generatedBindings,
    "Device proof receipt generated bindings",
  );
  exactKeys(
    bindings,
    ["bytes", "fileSha256", "manifestSha256"],
    "Device proof receipt generated bindings",
  );
  const parsedBindings = Object.freeze({
    bytes: integer(
      bindings.bytes,
      "Device proof receipt generated binding bytes",
      1,
      MAX_BINDING_BYTES,
    ),
    fileSha256: sha256(
      bindings.fileSha256,
      "Device proof receipt generated binding file digest",
    ),
    manifestSha256: sha256(
      bindings.manifestSha256,
      "Device proof receipt generated binding manifest digest",
    ),
  });

  const sourceMap = record(
    receipt.schemaVersion === 0 ? receipt.bundle : receipt.sourceMap,
    "Device proof receipt source map",
  );
  exactKeys(
    sourceMap,
    ["bytes", "checks", "sha256", "sourceCount"],
    "Device proof receipt source map",
  );
  if (
    !Array.isArray(sourceMap.checks) ||
    (receipt.schemaVersion === 0
      ? sourceMap.checks.length !== ANDROID_SOURCE_POLICY.length
      : sourceMap.checks.length === 0 ||
        sourceMap.checks.length > MAX_SOURCE_POLICY_CHECKS)
  ) {
    throw new TypeError("Device proof receipt source policy is invalid.");
  }
  const sourceCheckIdentities = new Set<string>();
  const checks = sourceMap.checks.map((value, index) => {
    const check = record(value, `Device proof receipt source check ${index}`);
    exactKeys(
      check,
      ["kind", "matches", "pattern"],
      `Device proof receipt source check ${index}`,
    );
    if (receipt.schemaVersion === 0) {
      const expected = ANDROID_SOURCE_POLICY[index]!;
      if (
        check.kind !== expected.kind ||
        check.matches !== expected.matches ||
        check.pattern !== expected.pattern
      ) {
        throw new TypeError("Device proof receipt source policy drifted.");
      }
      return expected;
    }
    if (
      check.kind !== "required-source" &&
      check.kind !== "forbidden-fragment"
    ) {
      throw new TypeError(
        `Device proof receipt source check ${index} has an invalid kind.`,
      );
    }
    const pattern = boundedString(
      check.pattern,
      `Device proof receipt source check ${index} pattern`,
      4_096,
    );
    if (/\p{Cc}/u.test(pattern)) {
      throw new TypeError(
        `Device proof receipt source check ${index} pattern contains control characters.`,
      );
    }
    const matches = integer(
      check.matches,
      `Device proof receipt source check ${index} matches`,
      0,
      1,
    );
    if (
      (check.kind === "required-source" &&
        (matches !== 1 ||
          !pattern.startsWith("app:///") ||
          pattern.includes("\\") ||
          pattern.split("/").includes(".."))) ||
      (check.kind === "forbidden-fragment" && matches !== 0)
    ) {
      throw new TypeError(
        `Device proof receipt source check ${index} did not prove its policy.`,
      );
    }
    const identity = `${check.kind}\0${pattern}`;
    if (sourceCheckIdentities.has(identity)) {
      throw new TypeError("Device proof receipt source policy is duplicated.");
    }
    sourceCheckIdentities.add(identity);
    return Object.freeze({ kind: check.kind, matches, pattern });
  });
  if (
    receipt.schemaVersion === 1 &&
    !checks.some((check) => check.kind === "required-source")
  ) {
    throw new TypeError(
      "Portable device proof source policy must require at least one exact source.",
    );
  }
  const parsedSourceMap = Object.freeze({
    bytes: integer(
      sourceMap.bytes,
      "Device proof receipt source map bytes",
      1,
      MAX_SOURCE_MAP_BYTES,
    ),
    sha256: sha256(sourceMap.sha256, "Device proof receipt source map digest"),
    sourceCount: integer(
      sourceMap.sourceCount,
      "Device proof receipt source count",
      1,
      100_000,
    ),
    checks: Object.freeze(checks),
  });
  const parsedBundle =
    receipt.schemaVersion === 1
      ? fileFact(
          receipt.bundle,
          "Device proof receipt JavaScript bundle",
          MAX_BUNDLE_BYTES,
        )
      : undefined;

  const artifacts = record(receipt.artifacts, "Device proof receipt artifacts");
  exactKeys(
    artifacts,
    ["applicationApk", "instrumentationApk"],
    "Device proof receipt artifacts",
  );
  const parsedArtifacts = Object.freeze({
    applicationApk: fileFact(
      artifacts.applicationApk,
      "Device proof receipt application APK",
      MAX_APK_BYTES,
    ),
    instrumentationApk: fileFact(
      artifacts.instrumentationApk,
      "Device proof receipt instrumentation APK",
      MAX_APK_BYTES,
    ),
  });

  const instrumentation = record(
    receipt.instrumentation,
    "Device proof receipt instrumentation",
  );
  exactKeys(
    instrumentation,
    [
      "className",
      "durationSeconds",
      "exitCodeSha256",
      "reportedAt",
      "resultBytes",
      "resultSha256",
      "testName",
    ],
    "Device proof receipt instrumentation",
  );
  if (
    receipt.schemaVersion === 0 &&
    (instrumentation.className !==
      "dev.solidnative.e2e.SolidNativePhysicalTest" ||
      instrumentation.testName !== "testPhysicalRendererUpdate")
  ) {
    throw new TypeError("Device proof receipt test identity is invalid.");
  }
  const className =
    receipt.schemaVersion === 0
      ? "dev.solidnative.e2e.SolidNativePhysicalTest"
      : boundedString(
          instrumentation.className,
          "Device proof receipt instrumentation class name",
          255,
        );
  const testName =
    receipt.schemaVersion === 0
      ? "testPhysicalRendererUpdate"
      : boundedString(
          instrumentation.testName,
          "Device proof receipt instrumentation test name",
          128,
        );
  if (
    !INSTRUMENTATION_CLASS_PATTERN.test(className) ||
    !INSTRUMENTATION_TEST_PATTERN.test(testName)
  ) {
    throw new TypeError("Device proof receipt test identity is invalid.");
  }
  const reportedAt = canonicalTimestamp(
    instrumentation.reportedAt,
    "Device proof receipt instrumentation reportedAt",
  );
  const parsedInstrumentation = Object.freeze({
    className,
    durationSeconds: finiteNumber(
      instrumentation.durationSeconds,
      "Device proof receipt instrumentation duration",
      Number.MIN_VALUE,
      MAX_INSTRUMENTATION_SECONDS,
    ),
    reportedAt,
    testName,
    resultBytes: integer(
      instrumentation.resultBytes,
      "Device proof receipt instrumentation result bytes",
      1,
      MAX_INSTRUMENTATION_BYTES,
    ),
    resultSha256: sha256(
      instrumentation.resultSha256,
      "Device proof receipt instrumentation result digest",
    ),
    exitCodeSha256: sha256(
      instrumentation.exitCodeSha256,
      "Device proof receipt instrumentation exit-code digest",
    ),
  });
  if (
    Date.parse(measuredAt) < Date.parse(reportedAt) ||
    Date.parse(measuredAt) - Date.parse(reportedAt) > 60 * 60 * 1000
  ) {
    throw new TypeError("Device proof receipt timestamps are inconsistent.");
  }

  const common = {
    proof: "solid-native-android-release-device",
    status: "passed",
    measuredAt,
    source: Object.freeze({
      revision: source.revision,
      dirty: source.dirty,
    }),
    device: parsedDevice,
    nativeCompatibility: parsedCompatibility,
    generatedBindings: parsedBindings,
    artifacts: parsedArtifacts,
    instrumentation: parsedInstrumentation,
  } as const;
  return receipt.schemaVersion === 0
    ? Object.freeze({
        schemaVersion: 0,
        ...common,
        bundle: parsedSourceMap,
      })
    : Object.freeze({
        schemaVersion: 1,
        ...common,
        bundle: parsedBundle!,
        sourceMap: parsedSourceMap,
      });
}

function inspectParsedDeviceProofProfile(
  receipt: NativeAndroidDeviceProofReceipt,
): NativeDeviceProofProfile {
  const sourceMap =
    receipt.schemaVersion === 0 ? receipt.bundle : receipt.sourceMap;
  const sourcePolicy = Object.freeze(
    [...sourceMap.checks].sort((left, right) => {
      const leftIdentity = `${left.kind}\0${left.pattern}`;
      const rightIdentity = `${right.kind}\0${right.pattern}`;
      return leftIdentity < rightIdentity
        ? -1
        : leftIdentity > rightIdentity
          ? 1
          : 0;
    }),
  );
  const instrumentation = Object.freeze({
    className: receipt.instrumentation.className,
    testName: receipt.instrumentation.testName,
  });
  const identity = {
    schemaVersion: 0 as const,
    kind: "solid-native.android-device-proof-profile" as const,
    proof: receipt.proof,
    instrumentation,
    sourcePolicy,
  };
  return Object.freeze({
    ...identity,
    receiptSchemaVersion: receipt.schemaVersion,
    profileFingerprint: `sha256:${createHash("sha256")
      .update(JSON.stringify(identity), "utf8")
      .digest("hex")}`,
  });
}

function fingerprintParsedDeviceProofProfile(
  receipt: NativeAndroidDeviceProofReceipt,
): string {
  return inspectParsedDeviceProofProfile(receipt).profileFingerprint;
}

export function inspectNativeDeviceProofProfile(
  receipt: NativeAndroidDeviceProofReceipt,
): NativeDeviceProofProfile {
  return inspectParsedDeviceProofProfile(
    parseNativeDeviceProofReceipt(receipt),
  );
}

export function nativeDeviceProofProfileFingerprint(
  receipt: NativeAndroidDeviceProofReceipt,
): string {
  return inspectNativeDeviceProofProfile(receipt).profileFingerprint;
}

function parseJson(bytes: Buffer, label: string): unknown {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new TypeError(
      `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function readProofFile(proofPath: string): Promise<
  Readonly<{
    bytes: Buffer;
    proofSha256: string;
    receipt: NativeAndroidDeviceProofReceipt;
  }>
> {
  const file = await readStableRegularFile(
    proofPath,
    "Device proof receipt",
    MAX_PROOF_BYTES,
  );
  return Object.freeze({
    bytes: file.bytes,
    proofSha256: `sha256:${createHash("sha256").update(file.bytes).digest("hex")}`,
    receipt: parseNativeDeviceProofReceipt(
      parseJson(file.bytes, "Device proof receipt"),
    ),
  });
}

export async function readNativeDeviceProofReceipt(
  proofPath: string,
): Promise<NativeAndroidDeviceProofReceipt> {
  if (typeof proofPath !== "string" || proofPath.length === 0) {
    throw new TypeError("The device proof path must be a string.");
  }
  return (await readProofFile(path.resolve(proofPath))).receipt;
}

function signingStatement(
  signingKeyId: unknown,
  signingProjectName: unknown,
  proofSha256: string,
): Omit<NativeDeviceProofSignature, "signature"> {
  return Object.freeze({
    schemaVersion: 0,
    algorithm: "ed25519",
    keyId: keyId(signingKeyId, "The device-proof signing key ID"),
    projectName: projectName(
      signingProjectName,
      "The device-proof project name",
    ),
    proofSha256,
  });
}

function signaturePayload(
  statement: Omit<NativeDeviceProofSignature, "signature">,
): Buffer {
  return Buffer.from(
    `${SIGNATURE_CONTEXT}${JSON.stringify(statement)}`,
    "utf8",
  );
}

function signingRequestForStatement(
  statement: Omit<NativeDeviceProofSignature, "signature">,
): NativeDeviceProofSigningRequest {
  const payload = signaturePayload(statement);
  return Object.freeze({
    ...statement,
    payloadBase64url: payload.toString("base64url"),
    payloadSha256: createHash("sha256").update(payload).digest("hex"),
  });
}

function parseNativeDeviceProofSigningRequest(
  value: unknown,
): NativeDeviceProofSigningRequest {
  const request = record(value, "Device proof signing request");
  exactKeys(
    request,
    [
      "algorithm",
      "keyId",
      "payloadBase64url",
      "payloadSha256",
      "projectName",
      "proofSha256",
      "schemaVersion",
    ],
    "Device proof signing request",
  );
  if (
    request.schemaVersion !== 0 ||
    request.algorithm !== "ed25519" ||
    typeof request.proofSha256 !== "string" ||
    !FINGERPRINT_PATTERN.test(request.proofSha256) ||
    typeof request.payloadBase64url !== "string" ||
    typeof request.payloadSha256 !== "string" ||
    !SHA256_PATTERN.test(request.payloadSha256)
  ) {
    throw new TypeError("Device proof signing request has an invalid schema.");
  }
  const expected = signingRequestForStatement(
    signingStatement(request.keyId, request.projectName, request.proofSha256),
  );
  if (
    request.payloadBase64url !== expected.payloadBase64url ||
    request.payloadSha256 !== expected.payloadSha256
  ) {
    throw new TypeError(
      "Device proof signing request payload does not match its statement.",
    );
  }
  return expected;
}

export async function readNativeDeviceProofSigningRequest(
  requestPath: string,
): Promise<NativeDeviceProofSigningRequest> {
  if (typeof requestPath !== "string" || requestPath.length === 0) {
    throw new TypeError(
      "The device proof signing request path must be a string.",
    );
  }
  const file = await readStableRegularFile(
    path.resolve(requestPath),
    "Device proof signing request",
    MAX_SIGNING_REQUEST_BYTES,
  );
  return parseNativeDeviceProofSigningRequest(
    parseJson(file.bytes, "Device proof signing request"),
  );
}

function parseNativeDeviceProofSignature(
  value: unknown,
): NativeDeviceProofSignature {
  const signature = record(value, "Device proof signature");
  exactKeys(
    signature,
    [
      "algorithm",
      "keyId",
      "projectName",
      "proofSha256",
      "schemaVersion",
      "signature",
    ],
    "Device proof signature",
  );
  if (
    signature.schemaVersion !== 0 ||
    signature.algorithm !== "ed25519" ||
    typeof signature.proofSha256 !== "string" ||
    !FINGERPRINT_PATTERN.test(signature.proofSha256) ||
    typeof signature.signature !== "string" ||
    !BASE64URL_SIGNATURE_PATTERN.test(signature.signature)
  ) {
    throw new TypeError("Device proof signature has an invalid schema.");
  }
  const bytes = Buffer.from(signature.signature, "base64url");
  if (
    bytes.length !== 64 ||
    bytes.toString("base64url") !== signature.signature
  ) {
    throw new TypeError("Device proof signature is not canonical base64url.");
  }
  return Object.freeze({
    ...signingStatement(
      signature.keyId,
      signature.projectName,
      signature.proofSha256,
    ),
    signature: signature.signature,
  });
}

export async function readNativeDeviceProofSignature(
  signaturePath: string,
): Promise<NativeDeviceProofSignature> {
  if (typeof signaturePath !== "string" || signaturePath.length === 0) {
    throw new TypeError("The device proof signature path must be a string.");
  }
  const file = await readStableRegularFile(
    path.resolve(signaturePath),
    "Device proof signature",
    MAX_SIGNATURE_BYTES,
  );
  return parseNativeDeviceProofSignature(
    parseJson(file.bytes, "Device proof signature"),
  );
}

async function writeAtomicJson(
  outputPath: string,
  value: unknown,
  label: string,
): Promise<void> {
  const parent = await stat(path.dirname(outputPath)).catch(() => undefined);
  if (parent?.isDirectory() !== true) {
    throw new TypeError(`${label} output directory does not exist.`);
  }
  const temporary = `${outputPath}.solid-native-${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      flag: "wx",
      mode: 0o644,
    });
    await rename(temporary, outputPath);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function createNativeDeviceProofSigningRequest(
  options: CreateNativeDeviceProofSigningRequestOptions,
): Promise<CreateNativeDeviceProofSigningRequestResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const proofPath = path.resolve(cwd, options.proofPath);
  const requestPath = path.resolve(
    cwd,
    options.outputPath ?? `${proofPath}.signing-request.json`,
  );
  if (requestPath === proofPath) {
    throw new TypeError(
      "The device proof signing request must not overwrite the receipt.",
    );
  }
  const proof = await readProofFile(proofPath);
  if (proof.receipt.source.dirty) {
    throw new TypeError(
      "Refusing to prepare a signing request for a dirty-checkout device proof.",
    );
  }
  const request = signingRequestForStatement(
    signingStatement(options.keyId, options.projectName, proof.proofSha256),
  );
  const finalProof = await readProofFile(proofPath);
  if (
    finalProof.proofSha256 !== proof.proofSha256 ||
    !finalProof.bytes.equals(proof.bytes)
  ) {
    throw new TypeError(
      "The device proof changed while preparing its signing request.",
    );
  }
  await writeAtomicJson(requestPath, request, "Device proof signing request");
  return Object.freeze({
    proofPath,
    requestPath,
    request,
    receipt: proof.receipt,
  });
}

export async function createNativeDeviceProofSignature(
  options: CreateNativeDeviceProofSignatureOptions,
): Promise<CreateNativeDeviceProofSignatureResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const proofPath = path.resolve(cwd, options.proofPath);
  const privateKeyPath = path.resolve(cwd, options.privateKeyPath);
  const signaturePath = path.resolve(
    cwd,
    options.outputPath ?? `${proofPath}.sig.json`,
  );
  if (signaturePath === proofPath || signaturePath === privateKeyPath) {
    throw new TypeError(
      "The device proof signature must not overwrite a signing input.",
    );
  }
  const proof = await readProofFile(proofPath);
  if (proof.receipt.source.dirty) {
    throw new TypeError("Refusing to sign a dirty-checkout device proof.");
  }
  const statement = signingStatement(
    options.keyId,
    options.projectName,
    proof.proofSha256,
  );
  const privateKey = await readEd25519PrivateKey(privateKeyPath);
  const signature: NativeDeviceProofSignature = Object.freeze({
    ...statement,
    signature: sign(null, signaturePayload(statement), privateKey).toString(
      "base64url",
    ),
  });
  const finalProof = await readProofFile(proofPath);
  if (
    finalProof.proofSha256 !== proof.proofSha256 ||
    !finalProof.bytes.equals(proof.bytes)
  ) {
    throw new TypeError("The device proof changed while being signed.");
  }
  await writeAtomicJson(signaturePath, signature, "Device proof signature");
  return Object.freeze({
    proofPath,
    signaturePath,
    signature,
    receipt: proof.receipt,
  });
}

export async function assembleNativeDeviceProofSignature(
  options: AssembleNativeDeviceProofSignatureOptions,
): Promise<AssembleNativeDeviceProofSignatureResult> {
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
      "The assembled device proof signature must not overwrite an assembly input.",
    );
  }
  const [request, detachedSignature, publicKey] = await Promise.all([
    readNativeDeviceProofSigningRequest(requestPath),
    readDetachedEd25519Signature(detachedSignaturePath),
    readEd25519PublicKey(publicKeyPath),
  ]);
  const statement = signingStatement(
    request.keyId,
    request.projectName,
    request.proofSha256,
  );
  if (
    !verify(
      null,
      signaturePayload(statement),
      publicKey,
      detachedSignature.bytes,
    )
  ) {
    throw new TypeError(
      "The detached Ed25519 signature does not authenticate the device proof signing request with the supplied public key.",
    );
  }
  const signature = parseNativeDeviceProofSignature({
    ...statement,
    signature: detachedSignature.base64url,
  });
  const finalRequest = await readNativeDeviceProofSigningRequest(requestPath);
  if (JSON.stringify(finalRequest) !== JSON.stringify(request)) {
    throw new TypeError(
      "The device proof signing request changed while assembling its signature.",
    );
  }
  await writeAtomicJson(
    signaturePath,
    signature,
    "Assembled device proof signature",
  );
  return Object.freeze({ requestPath, signaturePath, signature });
}

function check(
  id: NativeDeviceProofSignatureVerificationCheck["id"],
  pass: boolean,
  success: string,
  failure: string,
): NativeDeviceProofSignatureVerificationCheck {
  return Object.freeze({
    id,
    status: pass ? "pass" : "fail",
    message: pass ? success : failure,
  });
}

export async function verifyNativeDeviceProofSignature(
  options: VerifyNativeDeviceProofSignatureOptions,
): Promise<NativeDeviceProofSignatureVerificationReport> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const proofPath = path.resolve(cwd, options.proofPath);
  const signaturePath = path.resolve(cwd, options.signaturePath);
  const unchecked = options as unknown as {
    readonly expectedKeyId?: unknown;
    readonly minimumTrustPolicySequence?: unknown;
    readonly projectName?: unknown;
    readonly publicKeyPath?: unknown;
    readonly trustPolicyPath?: unknown;
  };
  if (
    unchecked.minimumTrustPolicySequence !== undefined &&
    (typeof unchecked.minimumTrustPolicySequence !== "number" ||
      !Number.isSafeInteger(unchecked.minimumTrustPolicySequence) ||
      unchecked.minimumTrustPolicySequence <= 0)
  ) {
    throw new TypeError(
      "The minimum device-proof trust policy sequence must be a positive safe integer.",
    );
  }
  if (
    unchecked.trustPolicyPath !== undefined &&
    typeof unchecked.trustPolicyPath !== "string"
  ) {
    throw new TypeError("The device proof trust policy path must be a string.");
  }
  const pinnedTrustSupplied =
    unchecked.expectedKeyId !== undefined ||
    unchecked.projectName !== undefined ||
    unchecked.publicKeyPath !== undefined;
  if (unchecked.trustPolicyPath !== undefined && pinnedTrustSupplied) {
    throw new TypeError(
      "Device proof verification cannot combine a trust policy with pinned-key options.",
    );
  }
  if (
    unchecked.trustPolicyPath === undefined &&
    unchecked.minimumTrustPolicySequence !== undefined
  ) {
    throw new TypeError(
      "A minimum device-proof trust policy sequence requires a trust policy file.",
    );
  }
  if (
    unchecked.trustPolicyPath === undefined &&
    (unchecked.expectedKeyId === undefined ||
      unchecked.projectName === undefined ||
      typeof unchecked.publicKeyPath !== "string")
  ) {
    throw new TypeError(
      "Device proof verification requires a trust policy or complete pinned-key options.",
    );
  }
  const expectedProofSha256 =
    options.expectedProofSha256 === undefined
      ? undefined
      : fingerprint(
          options.expectedProofSha256,
          "The expected device-proof receipt fingerprint",
        );
  const expectedSourceRevision =
    options.expectedSourceRevision === undefined
      ? undefined
      : sourceRevision(
          options.expectedSourceRevision,
          "The expected device-proof source revision",
        );
  const expectedNativeCompatibilityFingerprint =
    options.expectedNativeCompatibilityFingerprint === undefined
      ? undefined
      : fingerprint(
          options.expectedNativeCompatibilityFingerprint,
          "The expected device-proof native compatibility fingerprint",
        );
  const expectedApplicationArtifactSha256 =
    options.expectedApplicationArtifactSha256 === undefined
      ? undefined
      : sha256(
          options.expectedApplicationArtifactSha256,
          "The expected device-proof application artifact digest",
        );
  let expectedProfileFingerprint =
    options.expectedProfileFingerprint === undefined
      ? undefined
      : fingerprint(
          options.expectedProfileFingerprint,
          "The expected device-proof verification profile fingerprint",
        );
  const minimumMeasuredAt =
    options.minimumMeasuredAt === undefined
      ? undefined
      : canonicalTimestamp(
          options.minimumMeasuredAt,
          "The minimum device-proof measurement time",
        );
  const maximumMeasuredAt =
    options.maximumMeasuredAt === undefined
      ? undefined
      : canonicalTimestamp(
          options.maximumMeasuredAt,
          "The maximum device-proof measurement time",
        );
  if (
    minimumMeasuredAt !== undefined &&
    maximumMeasuredAt !== undefined &&
    Date.parse(minimumMeasuredAt) > Date.parse(maximumMeasuredAt)
  ) {
    throw new TypeError(
      "The minimum device-proof measurement time must not be after the maximum.",
    );
  }
  const [proof, signature] = await Promise.all([
    readProofFile(proofPath),
    readNativeDeviceProofSignature(signaturePath),
  ]);
  let expectedProjectName: string;
  let publicKey: KeyObject | undefined;
  let keyAuthorized: boolean;
  let keySuccess: string;
  let keyFailure: string;
  let trustPolicyAccepted = true;
  let trustPolicyPath: string | undefined;
  let trustPolicyFingerprint: string | undefined;
  let trustPolicySequence: number | undefined;
  if (unchecked.trustPolicyPath !== undefined) {
    trustPolicyPath = path.resolve(cwd, unchecked.trustPolicyPath);
    const trustPolicy = await readNativeDeviceProofTrustPolicy(trustPolicyPath);
    expectedProjectName = trustPolicy.projectName;
    trustPolicySequence = trustPolicy.policySequence;
    trustPolicyFingerprint =
      fingerprintParsedDeviceProofTrustPolicy(trustPolicy);
    if (trustPolicy.schemaVersion === 1) {
      if (
        expectedProfileFingerprint !== undefined &&
        expectedProfileFingerprint !== trustPolicy.profileFingerprint
      ) {
        throw new TypeError(
          "The explicit device-proof profile conflicts with the trust policy.",
        );
      }
      expectedProfileFingerprint = trustPolicy.profileFingerprint;
    }
    trustPolicyAccepted =
      unchecked.minimumTrustPolicySequence === undefined ||
      trustPolicy.policySequence >= unchecked.minimumTrustPolicySequence;
    const trustedKey = trustPolicy.keys.find(
      (entry) => entry.keyId === signature.keyId,
    );
    publicKey =
      trustedKey === undefined
        ? undefined
        : publicEd25519KeyFromSpki(
            trustedKey.publicKeySpki,
            `Device proof trust policy key ${trustedKey.keyId}`,
          );
    keyAuthorized = trustedKey?.status === "active";
    keySuccess =
      "The authenticated key is active in the device proof trust policy.";
    keyFailure =
      trustedKey?.status === "revoked"
        ? "The authenticated key is revoked by the device proof trust policy."
        : "The authenticated key is absent from the device proof trust policy.";
  } else {
    const expectedKeyId = keyId(
      unchecked.expectedKeyId,
      "The expected device-proof key ID",
    );
    expectedProjectName = projectName(
      unchecked.projectName,
      "The expected device-proof project name",
    );
    publicKey = await readEd25519PublicKey(
      path.resolve(cwd, unchecked.publicKeyPath as string),
    );
    keyAuthorized = signature.keyId === expectedKeyId;
    keySuccess = "The authenticated key ID matches the pinned identity.";
    keyFailure = "The authenticated key ID does not match the pinned identity.";
  }
  const statement = signingStatement(
    signature.keyId,
    signature.projectName,
    signature.proofSha256,
  );
  const clean = !proof.receipt.source.dirty;
  const profileFingerprint = fingerprintParsedDeviceProofProfile(proof.receipt);
  const profileMatches =
    expectedProfileFingerprint === undefined
      ? proof.receipt.schemaVersion === 0
      : profileFingerprint === expectedProfileFingerprint;
  const projectMatches = signature.projectName === expectedProjectName;
  const digestMatches = signature.proofSha256 === proof.proofSha256;
  const lineageMismatch =
    expectedProofSha256 !== undefined &&
    proof.proofSha256 !== expectedProofSha256
      ? "The authenticated receipt digest does not match the required fingerprint."
      : expectedSourceRevision !== undefined &&
          proof.receipt.source.revision !== expectedSourceRevision
        ? "The authenticated source revision does not match the required revision."
        : expectedNativeCompatibilityFingerprint !== undefined &&
            proof.receipt.nativeCompatibility.fingerprint !==
              expectedNativeCompatibilityFingerprint
          ? "The authenticated native compatibility identity does not match the required fingerprint."
          : expectedApplicationArtifactSha256 !== undefined &&
              proof.receipt.artifacts.applicationApk.sha256 !==
                expectedApplicationArtifactSha256
            ? "The authenticated application APK does not match the required digest."
            : undefined;
  const lineageConstrained =
    expectedProofSha256 !== undefined ||
    expectedSourceRevision !== undefined ||
    expectedNativeCompatibilityFingerprint !== undefined ||
    expectedApplicationArtifactSha256 !== undefined;
  const measuredAtMilliseconds = Date.parse(proof.receipt.measuredAt);
  const timeConstrained =
    minimumMeasuredAt !== undefined || maximumMeasuredAt !== undefined;
  const timePolicyMatches =
    (minimumMeasuredAt === undefined ||
      measuredAtMilliseconds >= Date.parse(minimumMeasuredAt)) &&
    (maximumMeasuredAt === undefined ||
      measuredAtMilliseconds <= Date.parse(maximumMeasuredAt));
  const authentic =
    publicKey !== undefined &&
    verify(
      null,
      signaturePayload(statement),
      publicKey,
      Buffer.from(signature.signature, "base64url"),
    );
  const checks = Object.freeze([
    check(
      "proof",
      clean,
      "The strict device proof records a clean physical run.",
      "The device proof was produced from a dirty checkout.",
    ),
    check(
      "trust-policy",
      trustPolicyAccepted,
      trustPolicySequence === undefined
        ? "Device proof verification uses explicit pinned-key trust."
        : "The device proof trust policy sequence satisfies the minimum.",
      "The device proof trust policy sequence is older than the required minimum.",
    ),
    check("key", keyAuthorized, keySuccess, keyFailure),
    check(
      "signature",
      digestMatches && authentic,
      "The Ed25519 signature authenticates the exact device-proof bytes.",
      digestMatches
        ? "The Ed25519 signature is invalid for the supplied public key."
        : "The signed device-proof digest does not match the supplied receipt.",
    ),
    check(
      "policy",
      projectMatches,
      "The signed project identity matches the trusted policy input.",
      "The signed project identity does not match the trusted policy input.",
    ),
    check(
      "profile",
      profileMatches,
      expectedProfileFingerprint === undefined
        ? "The receipt uses the fixed legacy device-proof verification profile."
        : "The receipt instrumentation and source policy match the trusted verification profile.",
      expectedProfileFingerprint === undefined
        ? "Portable device-proof receipts require an explicitly trusted verification profile."
        : "The receipt instrumentation or source policy does not match the trusted verification profile.",
    ),
    check(
      "lineage",
      lineageMismatch === undefined,
      lineageConstrained
        ? "The authenticated device proof matches every supplied lineage constraint."
        : "No exact device-proof lineage constraints were supplied.",
      lineageMismatch ?? "The authenticated device proof lineage is invalid.",
    ),
    check(
      "time-policy",
      timePolicyMatches,
      timeConstrained
        ? "The signed device measurement satisfies the supplied time window."
        : "No device-proof measurement time window was supplied.",
      "The signed device measurement is outside the required time window.",
    ),
  ]);
  const ok = checks.every((entry) => entry.status === "pass");
  const policy = Object.freeze({
    projectName: expectedProjectName,
    ...(expectedProofSha256 === undefined ? {} : { expectedProofSha256 }),
    ...(expectedSourceRevision === undefined ? {} : { expectedSourceRevision }),
    ...(expectedNativeCompatibilityFingerprint === undefined
      ? {}
      : { expectedNativeCompatibilityFingerprint }),
    ...(expectedApplicationArtifactSha256 === undefined
      ? {}
      : { expectedApplicationArtifactSha256 }),
    ...(expectedProfileFingerprint === undefined
      ? {}
      : { expectedProfileFingerprint }),
    ...(minimumMeasuredAt === undefined ? {} : { minimumMeasuredAt }),
    ...(maximumMeasuredAt === undefined ? {} : { maximumMeasuredAt }),
  });
  const report = {
    schemaVersion: 0 as const,
    proofPath,
    signaturePath,
    proofSha256: proof.proofSha256,
    keyId: signature.keyId,
    projectName: expectedProjectName,
    policy,
    ...(trustPolicyPath === undefined ? {} : { trustPolicyPath }),
    ...(trustPolicyFingerprint === undefined ? {} : { trustPolicyFingerprint }),
    ...(trustPolicySequence === undefined ? {} : { trustPolicySequence }),
    checks,
  };
  if (!ok) return Object.freeze({ ...report, ok: false as const });
  return Object.freeze({
    ...report,
    ok: true as const,
    authenticatedProof: Object.freeze({
      schemaVersion: 0 as const,
      projectName: expectedProjectName,
      proof: proof.receipt.proof,
      proofSha256: proof.proofSha256,
      receiptSchemaVersion: proof.receipt.schemaVersion,
      profileFingerprint,
      sourceRevision: proof.receipt.source.revision,
      measuredAt: proof.receipt.measuredAt,
      nativeCompatibilityFingerprint:
        proof.receipt.nativeCompatibility.fingerprint,
      applicationArtifactSha256: proof.receipt.artifacts.applicationApk.sha256,
      deviceModel: proof.receipt.device.model,
      authenticatedKeyId: signature.keyId,
      ...(trustPolicyFingerprint === undefined
        ? {}
        : { trustPolicyFingerprint }),
      ...(trustPolicySequence === undefined ? {} : { trustPolicySequence }),
    }),
  });
}

/**
 * Repeats device-proof authentication and returns a path-free, uploader-neutral
 * descriptor derived only from the exact receipt snapshot that stayed present
 * after verification. The result is execution evidence, never release
 * authorization.
 */
export async function createNativeDeviceProofIngestion(
  options: CreateNativeDeviceProofIngestionOptions,
): Promise<NativeDeviceProofIngestion> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const proofPath = path.resolve(cwd, options.proofPath);
  const verification = await verifyNativeDeviceProofSignature({
    ...options,
    cwd,
    proofPath,
  });
  if (!verification.ok) {
    throw new TypeError(
      `Refusing to prepare ingestion from an unauthenticated device proof.\n${formatNativeDeviceProofSignatureVerification(verification)}`,
    );
  }

  // Repeat the bounded receipt read at the handoff boundary. This prevents a
  // mutable proof path from silently describing different bytes after trust
  // verification completed.
  const proof = await readProofFile(proofPath);
  if (proof.proofSha256 !== verification.authenticatedProof.proofSha256) {
    throw new TypeError(
      "Refusing to prepare ingestion because the authenticated device proof changed.",
    );
  }
  const receipt = proof.receipt;
  const sourceMap =
    receipt.schemaVersion === 0 ? receipt.bundle : receipt.sourceMap;
  return Object.freeze({
    schemaVersion: 0,
    kind: "solid-native.device-proof-ingestion",
    authenticatedProof: verification.authenticatedProof,
    verificationPolicy: verification.policy,
    environment: Object.freeze({
      platform: "android",
      device: Object.freeze({
        kind: receipt.device.kind,
        manufacturer: receipt.device.manufacturer,
        model: receipt.device.model,
        product: receipt.device.product,
        abi: receipt.device.abi,
        osVersion: receipt.device.osVersion,
        sdkLevel: receipt.device.sdkLevel,
        buildFingerprintSha256: receipt.device.buildFingerprintSha256,
        batteryLevel: receipt.device.batteryLevel,
        batteryTemperatureCelsius: receipt.device.batteryTemperatureCelsius,
        lowPowerMode: receipt.device.lowPowerMode,
      }),
    }),
    inputs: Object.freeze({
      nativeCompatibility: receipt.nativeCompatibility,
      generatedBindings: receipt.generatedBindings,
      ...(receipt.schemaVersion === 1 ? { bundle: receipt.bundle } : {}),
      sourceMap: Object.freeze({
        bytes: sourceMap.bytes,
        sha256: sourceMap.sha256,
        sourceCount: sourceMap.sourceCount,
      }),
      artifacts: receipt.artifacts,
    }),
    execution: receipt.instrumentation,
  });
}

export function formatNativeDeviceProofIngestion(
  ingestion: NativeDeviceProofIngestion,
): string {
  const proof = ingestion.authenticatedProof;
  return [
    `PASS device proof ingestion ${proof.proofSha256}`,
    `Project: ${proof.projectName}`,
    `Device: ${ingestion.environment.device.manufacturer} ${ingestion.environment.device.model} (${ingestion.environment.device.osVersion}, SDK ${String(ingestion.environment.device.sdkLevel)})`,
    `Native compatibility: ${proof.nativeCompatibilityFingerprint}`,
    `Application artifact: ${proof.applicationArtifactSha256}`,
    `Verification profile: ${proof.profileFingerprint} (receipt schema ${String(proof.receiptSchemaVersion)})`,
    `Execution: ${ingestion.execution.durationSeconds.toFixed(3)} seconds at ${proof.measuredAt}`,
    `Authenticated key: ${proof.authenticatedKeyId}`,
    ...(proof.trustPolicyFingerprint === undefined
      ? []
      : [
          `Trust policy: ${proof.trustPolicyFingerprint} (sequence ${String(proof.trustPolicySequence)})`,
        ]),
    "",
    "Transport and retention are intentionally delegated to the selected observability or device-lab backend.",
  ].join("\n");
}

export function formatNativeDeviceProofSignatureVerification(
  report: NativeDeviceProofSignatureVerificationReport,
): string {
  return [
    `${report.ok ? "PASS" : "FAIL"} device proof ${report.proofSha256}`,
    `Project: ${report.projectName}`,
    `Key: ${report.keyId}`,
    ...(report.ok
      ? [
          `Verification profile: ${report.authenticatedProof.profileFingerprint} (receipt schema ${String(report.authenticatedProof.receiptSchemaVersion)})`,
        ]
      : []),
    ...(report.trustPolicyFingerprint === undefined
      ? []
      : [
          `Trust policy: ${report.trustPolicyFingerprint}`,
          `Trust policy sequence: ${String(report.trustPolicySequence)}`,
        ]),
    ...report.checks.map(
      (entry) => `${entry.status.toUpperCase()} ${entry.id}: ${entry.message}`,
    ),
  ].join("\n");
}
