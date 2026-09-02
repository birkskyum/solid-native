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

export type NativeAndroidBundleSigningCommandResult =
  NativeAndroidSigningCommandResult;
export type NativeAndroidBundleSigningCommandRunner =
  NativeAndroidSigningCommandRunner;

export interface VerifyNativeAndroidBundleSigningOptions {
  readonly artifactPath: string;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly expectedCertificateSha256?: string;
  readonly dependencies?: Readonly<{
    runCommand?: NativeAndroidBundleSigningCommandRunner;
  }>;
}

export interface NativeAndroidBundleSigner {
  readonly certificateSha256: string;
  readonly debug: boolean;
}

export interface NativeAndroidBundleSigningCheck {
  readonly id:
    | "signature-integrity"
    | "signer-certificate"
    | "debug-certificate"
    | "expected-certificate";
  readonly status: "pass" | "fail" | "skip";
  readonly message: string;
}

export interface NativeAndroidBundleSigningReport {
  readonly schemaVersion: 0;
  readonly ok: boolean;
  readonly artifactPath: string;
  readonly artifact: NativeAndroidSigningArtifact;
  readonly signers: readonly NativeAndroidBundleSigner[];
  readonly checks: readonly NativeAndroidBundleSigningCheck[];
}

const KEYTOOL_SHA256_PATTERN =
  /^\s*SHA256:\s*((?:[A-Fa-f0-9]{2}:){31}[A-Fa-f0-9]{2})\s*$/mu;

function onlyExpectedStrictSignerErrors(source: string): boolean {
  const normalized = source.replaceAll("\r\n", "\n");
  const errorSection =
    /(?:^|\n)Error:\s*\n([\s\S]*?)(?=\n\n(?:Warning:|$))/u.exec(
      normalized,
    )?.[1];
  if (errorSection === undefined) return false;
  const errors = errorSection
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return (
    errors.length > 0 &&
    errors.every(
      (line) =>
        /^This jar contains entries whose certificate chain is invalid\. Reason: .+$/u.test(
          line,
        ) ||
        line ===
          "This jar contains entries whose signer certificate is self-signed.",
    )
  );
}

export function parseNativeAndroidBundleSigners(
  source: string,
): readonly NativeAndroidBundleSigner[] {
  if (source.length > NATIVE_ANDROID_SIGNING_MAX_TOOL_OUTPUT_BYTES) {
    throw new TypeError("Android keytool output exceeds the supported bound.");
  }
  const chunks = source.split(/^Signer #\d+:\s*$/mu).slice(1);
  if (chunks.length === 0) return [];
  if (chunks.length > 8) {
    throw new TypeError("The Android App Bundle declares too many signers.");
  }
  return chunks.map((chunk) => {
    const leaf = chunk.split(/^Certificate #2:\s*$/mu, 1)[0] ?? "";
    const owner = /^Owner:\s*(.+)$/mu.exec(leaf)?.[1]?.trim();
    const fingerprint = KEYTOOL_SHA256_PATTERN.exec(leaf)?.[1];
    if (
      owner === undefined ||
      owner.length === 0 ||
      owner.length > 2_048 ||
      fingerprint === undefined
    ) {
      throw new TypeError(
        "Android keytool returned an unrecognized signer certificate report.",
      );
    }
    return {
      certificateSha256: normalizeNativeAndroidCertificateSha256(fingerprint),
      debug: isNativeAndroidDebugCertificateSubject(owner),
    };
  });
}

export const defaultNativeAndroidBundleSigningCommandRunner =
  defaultNativeAndroidSigningCommandRunner;

function jdkCommand(
  name: "jarsigner" | "keytool",
  env: NodeJS.ProcessEnv,
): string {
  const javaHome = env.JAVA_HOME;
  if (javaHome === undefined || javaHome.length === 0) return name;
  return path.join(
    javaHome,
    "bin",
    process.platform === "win32" ? `${name}.exe` : name,
  );
}

export async function verifyNativeAndroidBundleSigning(
  options: VerifyNativeAndroidBundleSigningOptions,
): Promise<NativeAndroidBundleSigningReport> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const artifactPath = path.resolve(cwd, options.artifactPath);
  if (path.extname(artifactPath).toLowerCase() !== ".aab") {
    throw new TypeError(
      "Android bundle signing verification requires an .aab file.",
    );
  }
  const artifactName = path.basename(artifactPath);
  if (
    artifactName.length === 0 ||
    artifactName.length > 255 ||
    /[\r\n\0]/u.test(artifactName)
  ) {
    throw new TypeError("The Android AAB has an invalid file name.");
  }
  const expectedCertificateSha256 =
    options.expectedCertificateSha256 === undefined
      ? undefined
      : normalizeNativeAndroidCertificateSha256(
          options.expectedCertificateSha256,
        );
  const snapshot = await createNativeAndroidSigningSnapshot(
    artifactPath,
    artifactName,
    "Android AAB",
  );
  try {
    const env = {
      ...process.env,
      ...options.env,
      LANG: "C",
      LC_ALL: "C",
    };
    const runCommand =
      options.dependencies?.runCommand ??
      defaultNativeAndroidBundleSigningCommandRunner;
    const commonJavaOptions = [
      "-J-Duser.language=en",
      "-J-Duser.country=US",
    ] as const;
    const [jarVerification, certificateInspection] = await Promise.all([
      runCommand(
        jdkCommand("jarsigner", env),
        [...commonJavaOptions, "-verify", "-strict", snapshot.path],
        { cwd, env, timeoutMs: NATIVE_ANDROID_SIGNING_TOOL_TIMEOUT_MS },
      ),
      runCommand(
        jdkCommand("keytool", env),
        [...commonJavaOptions, "-printcert", "-jarfile", snapshot.path],
        { cwd, env, timeoutMs: NATIVE_ANDROID_SIGNING_TOOL_TIMEOUT_MS },
      ),
    ]);
    const jdkInstallHelp =
      "Install JDK 17+ and put its bin directory on PATH or set JAVA_HOME.";
    assertNativeAndroidSigningToolCompleted(
      "jarsigner",
      jarVerification,
      "Android AAB",
      jdkInstallHelp,
    );
    assertNativeAndroidSigningToolCompleted(
      "keytool",
      certificateInspection,
      "Android AAB",
      jdkInstallHelp,
    );
    const verificationOutput =
      nativeAndroidSigningCommandOutput(jarVerification);
    const strictExitAccepted =
      jarVerification.exitCode === 0 ||
      (jarVerification.exitCode === 4 &&
        onlyExpectedStrictSignerErrors(verificationOutput));
    const signatureVerified =
      strictExitAccepted &&
      /(?:^|\n)jar verified(?:, with signer errors)?\.(?:\n|$)/u.test(
        verificationOutput,
      ) &&
      !/(?:^|\n)jar is unsigned\.(?:\n|$)/u.test(verificationOutput);
    const signers =
      certificateInspection.exitCode === 0
        ? parseNativeAndroidBundleSigners(
            nativeAndroidSigningCommandOutput(certificateInspection),
          )
        : [];
    const singleSigner = signers.length === 1;
    const debugSigner = signers.some((signer) => signer.debug);
    const expectedSigner =
      expectedCertificateSha256 === undefined
        ? undefined
        : signers.some(
            (signer) => signer.certificateSha256 === expectedCertificateSha256,
          );
    const checks: NativeAndroidBundleSigningCheck[] = [
      {
        id: "signature-integrity",
        status: signatureVerified ? "pass" : "fail",
        message: signatureVerified
          ? "Strict jarsigner verification covered every Android App Bundle entry."
          : "Strict jarsigner verification did not establish a completely signed Android App Bundle.",
      },
      {
        id: "signer-certificate",
        status: singleSigner ? "pass" : "fail",
        message: singleSigner
          ? "The Android App Bundle has exactly one leaf signing certificate."
          : `Expected exactly one Android App Bundle signer; found ${signers.length}.`,
      },
      {
        id: "debug-certificate",
        status: !singleSigner ? "skip" : debugSigner ? "fail" : "pass",
        message: !singleSigner
          ? "Debug-certificate rejection requires exactly one parsed signer."
          : debugSigner
            ? "The Android App Bundle is signed by the Android Debug certificate."
            : "The Android App Bundle signer is not labeled as the Android Debug certificate.",
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
          expectedCertificateSha256 === undefined
            ? "No expected upload-certificate SHA-256 was supplied."
            : expectedSigner
              ? "The Android App Bundle signer matches the expected certificate SHA-256."
              : "The Android App Bundle signer does not match the expected certificate SHA-256.",
      },
    ];
    await assertNativeAndroidSigningSnapshotUnchanged(
      artifactPath,
      snapshot,
      "Android App Bundle",
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

export function formatNativeAndroidBundleSigningReport(
  report: NativeAndroidBundleSigningReport,
): string {
  const status = { pass: "✓", fail: "✗", skip: "-" } as const;
  const lines = [
    "Android App Bundle signing",
    `Artifact: ${report.artifact.name} (${report.artifact.bytes} bytes, sha256:${report.artifact.sha256})`,
    ...report.checks.map((entry) => `${status[entry.status]} ${entry.message}`),
    ...report.signers.map(
      (signer) =>
        `Signer: sha256:${signer.certificateSha256}${signer.debug ? " (Android Debug)" : ""}`,
    ),
    report.ok
      ? "Ready: the AAB signature is non-debug and satisfies the requested local identity policy."
      : "Not ready: do not deliver this AAB.",
  ];
  return lines.join("\n");
}
