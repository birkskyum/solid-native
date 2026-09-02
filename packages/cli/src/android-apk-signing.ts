import { X509Certificate } from "node:crypto";
import { constants } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import {
  assertNativeAndroidSigningSnapshotUnchanged,
  assertNativeAndroidSigningToolCompleted,
  createNativeAndroidSigningSnapshot,
  defaultNativeAndroidSigningCommandRunner,
  isNativeAndroidDebugCertificateSubject,
  nativeAndroidSigningCommandOutput,
  normalizeNativeAndroidCertificateSha256,
  NATIVE_ANDROID_SIGNING_MAX_TOOL_OUTPUT_BYTES,
  NATIVE_ANDROID_SIGNING_TOOL_TIMEOUT_MS,
  removeNativeAndroidSigningSnapshot,
  type NativeAndroidSigningArtifact,
  type NativeAndroidSigningCommandResult,
  type NativeAndroidSigningCommandRunner,
} from "./android-signing-shared.js";

export type NativeAndroidApkSigningCommandResult =
  NativeAndroidSigningCommandResult;
export type NativeAndroidApkSigningCommandRunner =
  NativeAndroidSigningCommandRunner;
export const defaultNativeAndroidApkSigningCommandRunner =
  defaultNativeAndroidSigningCommandRunner;

export interface NativeAndroidApkSigner {
  readonly certificateSha256: string;
  readonly debug: boolean;
}

export interface NativeAndroidApkSigningCheck {
  readonly id:
    | "signature-integrity"
    | "signer-certificate"
    | "debug-certificate"
    | "expected-certificate";
  readonly status: "pass" | "fail" | "skip";
  readonly message: string;
}

export interface NativeAndroidApkSigningReport {
  readonly schemaVersion: 0;
  readonly ok: boolean;
  readonly artifactPath: string;
  readonly artifact: NativeAndroidSigningArtifact;
  readonly signers: readonly NativeAndroidApkSigner[];
  readonly checks: readonly NativeAndroidApkSigningCheck[];
}

export interface VerifyNativeAndroidApkSigningOptions {
  readonly artifactPath: string;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly expectedCertificateSha256s?: readonly string[];
  readonly dependencies?: Readonly<{
    runCommand?: NativeAndroidApkSigningCommandRunner;
    resolveApkSignerCommand?: (env: NodeJS.ProcessEnv) => Promise<string>;
  }>;
}

const MAX_BUILD_TOOLS_DIRECTORIES = 256;
const MAX_APK_SIGNERS = 8;
const STABLE_BUILD_TOOLS_VERSION = /^(\d+)\.(\d+)\.(\d+)$/u;
const NUMBER_OF_SIGNERS = /^Number of signers:\s*([0-9]+)\s*$/mu;
const CERTIFICATE_DN = /^(.+?) certificate DN:\s*(.+)\s*$/u;
const CERTIFICATE_SHA256 =
  /^(.+?) certificate SHA-256 digest:\s*([A-Fa-f0-9:]+)\s*$/u;
const BEGIN_CERTIFICATE = "-----BEGIN CERTIFICATE-----";
const END_CERTIFICATE = "-----END CERTIFICATE-----";

type BuildToolsVersion = readonly [number, number, number];

function buildToolsVersion(value: string): BuildToolsVersion | undefined {
  const match = STABLE_BUILD_TOOLS_VERSION.exec(value);
  if (match === null) return undefined;
  const version = match.slice(1).map(Number) as unknown as BuildToolsVersion;
  return version.every(Number.isSafeInteger) ? version : undefined;
}

function compareBuildToolsVersion(
  left: Readonly<{ name: string; version: BuildToolsVersion }>,
  right: Readonly<{ name: string; version: BuildToolsVersion }>,
): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = (right.version[index] ?? 0) - (left.version[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

async function apkSignerFromSdk(sdkRoot: string): Promise<string | undefined> {
  const buildTools = path.join(path.resolve(sdkRoot), "build-tools");
  const entries = await readdir(buildTools, { withFileTypes: true }).catch(
    () => undefined,
  );
  if (entries === undefined) return undefined;
  if (entries.length > MAX_BUILD_TOOLS_DIRECTORIES) {
    throw new TypeError(
      `Android SDK build-tools contains more than ${MAX_BUILD_TOOLS_DIRECTORIES} entries.`,
    );
  }
  const versions = entries
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const version = buildToolsVersion(entry.name);
      return version === undefined ? [] : [{ name: entry.name, version }];
    })
    .sort(compareBuildToolsVersion);
  const executable =
    process.platform === "win32" ? "apksigner.bat" : "apksigner";
  for (const entry of versions) {
    const candidate = path.join(buildTools, entry.name, executable);
    const mode = process.platform === "win32" ? constants.F_OK : constants.X_OK;
    if (
      await access(candidate, mode).then(
        () => true,
        () => false,
      )
    ) {
      return candidate;
    }
  }
  return undefined;
}

export async function resolveNativeAndroidApkSignerCommand(
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const explicitRoots = [env.ANDROID_HOME, env.ANDROID_SDK_ROOT].filter(
    (value): value is string => value !== undefined && value.length > 0,
  );
  if (
    explicitRoots.length === 2 &&
    path.resolve(explicitRoots[0]!) !== path.resolve(explicitRoots[1]!)
  ) {
    throw new TypeError(
      "ANDROID_HOME and ANDROID_SDK_ROOT identify different Android SDK directories.",
    );
  }
  const sdkRoot = explicitRoots[0];
  if (sdkRoot !== undefined) {
    const command = await apkSignerFromSdk(sdkRoot);
    if (command === undefined) {
      throw new TypeError(
        `No stable apksigner executable was found beneath ${path.resolve(sdkRoot)}/build-tools.`,
      );
    }
    return command;
  }
  const defaultRoot =
    process.platform === "darwin"
      ? path.join(homedir(), "Library", "Android", "sdk")
      : process.platform === "win32" && env.LOCALAPPDATA !== undefined
        ? path.join(env.LOCALAPPDATA, "Android", "Sdk")
        : path.join(homedir(), "Android", "Sdk");
  return (await apkSignerFromSdk(defaultRoot)) ?? "apksigner";
}

function normalizeExpectedCertificateSet(
  values: readonly string[] | undefined,
): readonly string[] | undefined {
  if (values === undefined) return undefined;
  if (values.length === 0 || values.length > MAX_APK_SIGNERS) {
    throw new TypeError(
      `Expected Android APK signing certificates must contain 1-${MAX_APK_SIGNERS} SHA-256 values.`,
    );
  }
  const normalized = values.map(normalizeNativeAndroidCertificateSha256).sort();
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError(
      "Expected Android APK signing certificates must not contain duplicates.",
    );
  }
  return normalized;
}

interface PendingCertificate {
  readonly label: string;
  readonly subject: string;
  sha256?: string;
}

export function parseNativeAndroidApkSigners(
  source: string,
): readonly NativeAndroidApkSigner[] {
  if (
    Buffer.byteLength(source) > NATIVE_ANDROID_SIGNING_MAX_TOOL_OUTPUT_BYTES
  ) {
    throw new TypeError(
      "Android apksigner output exceeds the supported bound.",
    );
  }
  const normalized = source.replaceAll("\r\n", "\n");
  const declaredMatches = [
    ...normalized.matchAll(new RegExp(NUMBER_OF_SIGNERS, "gmu")),
  ];
  if (declaredMatches.length !== 1) {
    throw new TypeError(
      "Android apksigner must return exactly one bounded signer count.",
    );
  }
  const declaredMatch = declaredMatches[0]!;
  const declared = Number(declaredMatch[1]);
  if (
    !Number.isSafeInteger(declared) ||
    declared < 1 ||
    declared > MAX_APK_SIGNERS
  ) {
    throw new TypeError(
      `Android APK signer count must be between 1 and ${MAX_APK_SIGNERS}.`,
    );
  }

  const signers: NativeAndroidApkSigner[] = [];
  let pending: PendingCertificate | undefined;
  let pem: string[] | undefined;
  for (const line of normalized.split("\n")) {
    if (pem !== undefined) {
      pem.push(line);
      if (line !== END_CERTIFICATE) continue;
      if (pending?.sha256 === undefined) {
        throw new TypeError(
          "Android apksigner returned an unrecognized certificate report.",
        );
      }
      let certificate: X509Certificate;
      try {
        certificate = new X509Certificate(pem.join("\n"));
      } catch {
        throw new TypeError(
          "Android apksigner returned an invalid PEM certificate.",
        );
      }
      const actualSha256 = normalizeNativeAndroidCertificateSha256(
        certificate.fingerprint256,
      );
      if (actualSha256 !== pending.sha256) {
        throw new TypeError(
          "Android apksigner certificate bytes do not match its reported SHA-256.",
        );
      }
      if (pending.label !== "Source Stamp Signer") {
        if (!pending.label.includes("Signer")) {
          throw new TypeError(
            "Android apksigner returned an unrecognized signer label.",
          );
        }
        signers.push({
          certificateSha256: actualSha256,
          debug:
            isNativeAndroidDebugCertificateSubject(pending.subject) ||
            isNativeAndroidDebugCertificateSubject(certificate.subject),
        });
      }
      pending = undefined;
      pem = undefined;
      continue;
    }
    const dn = CERTIFICATE_DN.exec(line);
    if (dn !== null) {
      if (
        pending !== undefined ||
        dn[1]!.length > 256 ||
        dn[2]!.length > 2_048
      ) {
        throw new TypeError(
          "Android apksigner returned an unrecognized certificate report.",
        );
      }
      pending = { label: dn[1]!, subject: dn[2]! };
      continue;
    }
    const digest = CERTIFICATE_SHA256.exec(line);
    if (digest !== null) {
      if (
        pending === undefined ||
        pending.label !== digest[1] ||
        pending.sha256 !== undefined
      ) {
        throw new TypeError(
          "Android apksigner returned an unrecognized certificate digest.",
        );
      }
      pending.sha256 = normalizeNativeAndroidCertificateSha256(digest[2]!);
      continue;
    }
    if (line === BEGIN_CERTIFICATE) {
      if (pending?.sha256 === undefined) {
        throw new TypeError(
          "Android apksigner returned a certificate without an identity.",
        );
      }
      pem = [line];
    }
  }
  if (
    pending !== undefined ||
    pem !== undefined ||
    signers.length !== declared
  ) {
    throw new TypeError(
      `Android apksigner declared ${declared} signer(s) but returned ${signers.length} complete signing certificate(s).`,
    );
  }
  const fingerprints = signers.map((signer) => signer.certificateSha256);
  if (new Set(fingerprints).size !== fingerprints.length) {
    throw new TypeError(
      "Android apksigner returned duplicate signing certificates.",
    );
  }
  return signers.sort((left, right) =>
    left.certificateSha256 < right.certificateSha256
      ? -1
      : left.certificateSha256 > right.certificateSha256
        ? 1
        : 0,
  );
}

function sameCertificateSet(
  signers: readonly NativeAndroidApkSigner[],
  expected: readonly string[],
): boolean {
  return (
    signers.length === expected.length &&
    signers.every(
      (signer, index) => signer.certificateSha256 === expected[index],
    )
  );
}

export async function verifyNativeAndroidApkSigning(
  options: VerifyNativeAndroidApkSigningOptions,
): Promise<NativeAndroidApkSigningReport> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const artifactPath = path.resolve(cwd, options.artifactPath);
  if (path.extname(artifactPath).toLowerCase() !== ".apk") {
    throw new TypeError(
      "Android APK signing verification requires an .apk file.",
    );
  }
  const artifactName = path.basename(artifactPath);
  if (
    artifactName.length === 0 ||
    artifactName.length > 255 ||
    /[\r\n\0]/u.test(artifactName)
  ) {
    throw new TypeError("The Android APK has an invalid file name.");
  }
  const expectedCertificateSha256s = normalizeExpectedCertificateSet(
    options.expectedCertificateSha256s,
  );
  const snapshot = await createNativeAndroidSigningSnapshot(
    artifactPath,
    artifactName,
    "Android APK",
  );
  try {
    const env = {
      ...process.env,
      ...options.env,
      LANG: "C",
      LC_ALL: "C",
    };
    const command = await (
      options.dependencies?.resolveApkSignerCommand ??
      resolveNativeAndroidApkSignerCommand
    )(env);
    const result = await (
      options.dependencies?.runCommand ??
      defaultNativeAndroidSigningCommandRunner
    )(
      command,
      ["verify", "--verbose", "--print-certs-pem", "--Werr", snapshot.path],
      { cwd, env, timeoutMs: NATIVE_ANDROID_SIGNING_TOOL_TIMEOUT_MS },
    );
    assertNativeAndroidSigningToolCompleted(
      "apksigner",
      result,
      "Android APK",
      "Install Android SDK Build Tools 24.0.3 or newer and set ANDROID_HOME or ANDROID_SDK_ROOT.",
    );
    const output = nativeAndroidSigningCommandOutput(result);
    const signatureVerified =
      result.exitCode === 0 &&
      /(?:^|\n)Verifies(?:\n|$)/u.test(output) &&
      !/(?:^|\n)DOES NOT VERIFY(?:\n|$)/u.test(output);
    const signers = signatureVerified
      ? parseNativeAndroidApkSigners(output)
      : [];
    const boundedSigners =
      signers.length >= 1 && signers.length <= MAX_APK_SIGNERS;
    const debugSigner = signers.some((signer) => signer.debug);
    const expectedSigner =
      expectedCertificateSha256s === undefined
        ? undefined
        : sameCertificateSet(signers, expectedCertificateSha256s);
    const checks: NativeAndroidApkSigningCheck[] = [
      {
        id: "signature-integrity",
        status: signatureVerified ? "pass" : "fail",
        message: signatureVerified
          ? "apksigner verified the APK for every Android version declared as supported by its manifest."
          : "apksigner did not verify the APK for every declared supported Android version.",
      },
      {
        id: "signer-certificate",
        status: boundedSigners ? "pass" : "fail",
        message: boundedSigners
          ? `The Android APK has ${signers.length} bounded signing certificate${signers.length === 1 ? "" : "s"}.`
          : "The Android APK has no bounded signing-certificate identity.",
      },
      {
        id: "debug-certificate",
        status: !boundedSigners ? "skip" : debugSigner ? "fail" : "pass",
        message: !boundedSigners
          ? "Debug-certificate rejection requires parsed APK signers."
          : debugSigner
            ? "The Android APK includes the Android Debug signing certificate."
            : "No Android APK signer is labeled as the Android Debug certificate.",
      },
      {
        id: "expected-certificate",
        status:
          expectedSigner === undefined
            ? "skip"
            : expectedSigner
              ? "pass"
              : "fail",
        message:
          expectedCertificateSha256s === undefined
            ? "No expected APK signing-certificate set was supplied."
            : expectedSigner
              ? "The Android APK signer set exactly matches the expected certificate SHA-256 values."
              : "The Android APK signer set does not exactly match the expected certificate SHA-256 values.",
      },
    ];
    await assertNativeAndroidSigningSnapshotUnchanged(
      artifactPath,
      snapshot,
      "Android APK",
    );
    return {
      schemaVersion: 0,
      ok: checks.every((entry) => entry.status !== "fail"),
      artifactPath,
      artifact: snapshot.artifact,
      signers,
      checks,
    };
  } finally {
    await removeNativeAndroidSigningSnapshot(snapshot);
  }
}

export function formatNativeAndroidApkSigningReport(
  report: NativeAndroidApkSigningReport,
): string {
  const status = { pass: "✓", fail: "✗", skip: "-" } as const;
  const lines = [
    "Android APK signing",
    `Artifact: ${report.artifact.name} (${report.artifact.bytes} bytes, sha256:${report.artifact.sha256})`,
    ...report.checks.map((entry) => `${status[entry.status]} ${entry.message}`),
    ...report.signers.map(
      (signer) =>
        `Signer: sha256:${signer.certificateSha256}${signer.debug ? " (Android Debug)" : ""}`,
    ),
    report.ok
      ? "Ready: the APK signature is non-debug and satisfies the requested local identity policy."
      : "Not ready: do not deliver this APK.",
  ];
  return lines.join("\n");
}
