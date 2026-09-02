import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { constants, createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  formatNativeAndroidBundleSigningReport,
  verifyNativeAndroidBundleSigning,
  type NativeAndroidBundleSigningReport,
  type VerifyNativeAndroidBundleSigningOptions,
} from "./android-bundle-signing.js";
import {
  formatNativeAndroidApkSigningReport,
  verifyNativeAndroidApkSigning,
  type NativeAndroidApkSigningReport,
  type VerifyNativeAndroidApkSigningOptions,
} from "./android-apk-signing.js";
import {
  formatNativeBundleVerification,
  readNativeBundleManifest,
  verifyNativeBundleManifest,
} from "./bundle-artifacts.js";
import {
  createNativeFingerprint,
  type NativeFingerprintReport,
} from "./fingerprint.js";
import {
  inspectAndroidEmbeddedHermesBundle,
  inspectIOSEmbeddedHermesBundle,
  type NativeEmbeddedBundleArtifact,
} from "./native-archive.js";
import { VERIFIED_HERMES_BYTECODE_VERSION } from "./versions.js";

export interface NativeReleaseArtifact {
  readonly name: string;
  readonly bytes: number;
  readonly sha256: string;
}

export type NativeReleaseArtifactSigning =
  | Readonly<{
      scheme: "android-jar";
      certificateSha256: string;
    }>
  | Readonly<{
      scheme: "android-apk";
      certificateSha256s: readonly string[];
    }>;

export interface NativeReleaseManifest {
  readonly schemaVersion: 0;
  readonly algorithm: "sha256";
  readonly trust: "unsigned";
  readonly projectName: string;
  readonly platform: "android" | "ios";
  readonly release: string;
  readonly channel: string;
  readonly sourceRevision: string;
  readonly runtime: NativeFingerprintReport["runtime"];
  readonly nativeCompatibilityFingerprint: string;
  readonly bundleFingerprint: string;
  readonly artifact: NativeReleaseArtifact;
  readonly artifactSigning?: NativeReleaseArtifactSigning;
  readonly embeddedBundle?: NativeEmbeddedBundleArtifact;
  readonly releaseFingerprint: string;
}

export interface NativeReleaseDependencies {
  readonly verifyAndroidApkSigning?: (
    options: VerifyNativeAndroidApkSigningOptions,
  ) => Promise<NativeAndroidApkSigningReport>;
  readonly verifyAndroidBundleSigning?: (
    options: VerifyNativeAndroidBundleSigningOptions,
  ) => Promise<NativeAndroidBundleSigningReport>;
}

interface CreateNativeReleaseBaseOptions {
  readonly cwd?: string;
  readonly bundleManifestPath: string;
  readonly artifactPath: string;
  readonly release: string;
  readonly channel: string;
  readonly sourceRevision: string;
  readonly outputPath?: string;
  readonly inspectEmbeddedBundle?: boolean;
  readonly dependencies?: NativeReleaseDependencies;
}

export type CreateNativeReleaseOptions = CreateNativeReleaseBaseOptions &
  (
    | Readonly<{
        androidSigningCertificateSha256s: readonly string[];
        androidUploadCertificateSha256?: never;
      }>
    | Readonly<{
        androidSigningCertificateSha256s?: never;
        androidUploadCertificateSha256: string;
      }>
    | Readonly<{
        androidSigningCertificateSha256s?: undefined;
        androidUploadCertificateSha256?: undefined;
      }>
  );

export interface CreateNativeReleaseResult {
  readonly manifestPath: string;
  readonly manifest: NativeReleaseManifest;
}

export interface VerifyNativeReleaseOptions {
  readonly cwd?: string;
  readonly manifestPath: string;
  readonly bundleManifestPath: string;
  readonly artifactPath: string;
  readonly dependencies?: NativeReleaseDependencies;
}

export interface NativeReleaseVerificationCheck {
  readonly id:
    | "artifact"
    | "artifact-signing"
    | "bundle"
    | "embedded-bundle"
    | "fingerprint"
    | "native";
  readonly status: "pass" | "fail";
  readonly message: string;
}

export interface NativeReleaseVerificationReport {
  readonly schemaVersion: 0;
  readonly ok: boolean;
  readonly manifestPath: string;
  readonly releaseFingerprint: string;
  readonly checks: readonly NativeReleaseVerificationCheck[];
}

const MAX_RELEASE_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_RELEASE_ARTIFACT_BYTES = 8 * 1024 * 1024 * 1024;
const RELEASE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/u;
const CHANNEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const REVISION_PATTERN = /^[a-f0-9]{7,64}$/u;
const REVISION_INPUT_PATTERN = /^[A-Fa-f0-9]{7,64}$/u;
const SHA1_PATTERN = /^[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const IOS_EMBEDDED_BUNDLE_PATH = /^Payload\/[^/]{1,255}\.app\/main\.jsbundle$/u;
const HERMES_HEADER_BYTES = 32;
const HERMES_FOOTER_BYTES = 20;

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

function digestValue(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function assertToken(value: unknown, label: string, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new TypeError(`The release ${label} has an invalid format.`);
  }
  return value;
}

async function digestReleaseArtifact(
  artifactPath: string,
): Promise<NativeReleaseArtifact> {
  const absolutePath = path.resolve(artifactPath);
  let before;
  try {
    before = await lstat(absolutePath);
  } catch {
    throw new TypeError(
      `Release artifact ${absolutePath} is missing or unreadable.`,
    );
  }
  if (!before.isFile()) {
    throw new TypeError("The release artifact must be a regular file.");
  }
  if (before.size === 0 || before.size > MAX_RELEASE_ARTIFACT_BYTES) {
    throw new TypeError(
      `The release artifact must contain 1-${MAX_RELEASE_ARTIFACT_BYTES} bytes.`,
    );
  }
  const name = path.basename(absolutePath);
  if (name.length === 0 || name.length > 255 || /[\r\n\0]/u.test(name)) {
    throw new TypeError("The release artifact has an invalid file name.");
  }
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(absolutePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  const after = await lstat(absolutePath);
  if (
    !after.isFile() ||
    after.size !== before.size ||
    after.mtimeMs !== before.mtimeMs
  ) {
    throw new TypeError("The release artifact changed while being hashed.");
  }
  return { name, bytes: before.size, sha256: hash.digest("hex") };
}

interface HermesSourceBundle {
  readonly platform: "android" | "ios";
  readonly bytes: Buffer;
  readonly sourceSha1: string;
}

async function readHermesSourceBundle(
  bundleManifestPath: string,
): Promise<HermesSourceBundle> {
  const manifest = await readNativeBundleManifest(bundleManifestPath);
  if (manifest.minified) {
    throw new TypeError(
      `Embedded ${manifest.platform} verification requires a bundle created with --hermes-source.`,
    );
  }
  const sourcePath = path.resolve(
    path.dirname(bundleManifestPath),
    manifest.artifacts.bundle.path,
  );
  let handle: FileHandle;
  try {
    handle = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new TypeError("The Hermes source bundle is missing or unreadable.");
  }
  try {
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.size === 0 ||
      before.size > 256 * 1024 * 1024
    ) {
      throw new TypeError(
        "The Hermes source bundle must be a bounded regular file.",
      );
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      !after.isFile() ||
      bytes.length !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs
    ) {
      throw new TypeError("The Hermes source bundle changed while being read.");
    }
    return {
      platform: manifest.platform,
      bytes,
      sourceSha1: createHash("sha1").update(bytes).digest("hex"),
    };
  } finally {
    await handle.close();
  }
}

async function inspectEmbeddedBundle(
  cwd: string,
  artifactPath: string,
  bundleManifestPath: string,
): Promise<NativeEmbeddedBundleArtifact> {
  const source = await readHermesSourceBundle(bundleManifestPath);
  let embeddedBundle: NativeEmbeddedBundleArtifact;
  let iosCompilationSourceName: string | undefined;
  if (source.platform === "android") {
    embeddedBundle = await inspectAndroidEmbeddedHermesBundle(artifactPath);
  } else {
    const inspection = await inspectIOSEmbeddedHermesBundle(artifactPath);
    embeddedBundle = inspection.artifact;
    iosCompilationSourceName = inspection.compilationSourceName;
  }
  if (embeddedBundle.sourceSha1 !== source.sourceSha1) {
    throw new TypeError(
      "The embedded Hermes bytecode was not compiled from the reviewed bundle source.",
    );
  }
  const compiledSha256 = await compileHermesSourceBundle(
    cwd,
    source,
    iosCompilationSourceName,
  );
  if (!compiledSha256.includes(embeddedBundle.sha256)) {
    throw new TypeError(
      "The embedded Hermes bytecode does not match the pinned compiler output for the reviewed bundle source.",
    );
  }
  return embeddedBundle;
}

async function compileHermesSourceBundle(
  cwd: string,
  source: HermesSourceBundle,
  iosCompilationSourceName?: string,
): Promise<readonly string[]> {
  let compilerPackagePath: string;
  try {
    const require = createRequire(path.join(cwd, "package.json"));
    compilerPackagePath = require.resolve("hermes-compiler/package.json");
  } catch {
    throw new TypeError(
      "The application-local pinned Hermes compiler cannot be resolved.",
    );
  }
  const compilerDirectory =
    process.platform === "darwin"
      ? "osx-bin"
      : process.platform === "linux" && process.arch === "x64"
        ? "linux64-bin"
        : undefined;
  if (compilerDirectory === undefined) {
    throw new TypeError(
      `Hermes release linkage is not supported on ${process.platform}-${process.arch}.`,
    );
  }
  const compilerPath = path.join(
    path.dirname(compilerPackagePath),
    "hermesc",
    compilerDirectory,
    "hermesc",
  );
  const compilerMetadata = await lstat(compilerPath).catch(() => undefined);
  if (compilerMetadata?.isFile() !== true) {
    throw new TypeError("The application-local Hermes compiler is incomplete.");
  }
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "solid-native-hermes-"),
  );
  try {
    const sourceName =
      source.platform === "ios" && iosCompilationSourceName !== undefined
        ? syntheticIOSCompilationSourceName(
            Buffer.byteLength(iosCompilationSourceName, "utf8"),
          )
        : `index.${source.platform}.bundle`;
    const sourcePath = path.join(temporaryDirectory, sourceName);
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, source.bytes, { flag: "wx" });

    const compile = async (
      outputName: string,
      outputSourceMap: boolean,
    ): Promise<Buffer> => {
      const outputPath = path.join(temporaryDirectory, outputName);
      await new Promise<void>((resolve, reject) => {
        execFile(
          compilerPath,
          [
            "-w",
            "-emit-binary",
            "-max-diagnostic-width=80",
            "-out",
            outputPath,
            sourceName,
            "-O",
            ...(outputSourceMap ? ["-output-source-map"] : []),
          ],
          {
            cwd: temporaryDirectory,
            encoding: "utf8",
            maxBuffer: 1024 * 1024,
            timeout: 120_000,
          },
          (error, _stdout, stderr) => {
            if (error === null) {
              resolve();
              return;
            }
            reject(
              new TypeError(
                `The pinned Hermes compiler rejected the reviewed bundle source: ${stderr.trim() || error.message}`,
              ),
            );
          },
        );
      });
      return readFile(outputPath);
    };

    if (source.platform === "android") {
      const compiled = await compile("index.android.bundle.hbc", true);
      return [createHash("sha256").update(compiled).digest("hex")];
    }

    const sourceMapCompiled = await compile("index.ios.sourcemap.hbc", true);
    const candidates = [
      createHash("sha256").update(sourceMapCompiled).digest("hex"),
    ];
    if (iosCompilationSourceName !== undefined) {
      const compiled = await compile("index.ios.debug.hbc", false);
      candidates.push(
        digestIOSCompiledBundle(compiled, sourceName, iosCompilationSourceName),
      );
    }
    return candidates;
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

function syntheticIOSCompilationSourceName(byteLength: number): string {
  const suffix = "/main.jsbundle";
  let remaining = byteLength - Buffer.byteLength(suffix, "utf8");
  if (remaining < 1 || byteLength > 4_096) {
    throw new TypeError(
      "The embedded iOS Hermes compilation source name has an invalid size.",
    );
  }
  const segments: string[] = [];
  while (remaining > 100) {
    segments.push("x".repeat(100));
    remaining -= 101;
  }
  if (remaining < 1) {
    segments[segments.length - 1] += "x";
  } else {
    segments.push("x".repeat(remaining));
  }
  const sourceName = `${segments.join("/")}${suffix}`;
  if (Buffer.byteLength(sourceName, "utf8") !== byteLength) {
    throw new TypeError(
      "The embedded iOS Hermes compilation source name cannot be normalized safely.",
    );
  }
  return sourceName;
}

function digestIOSCompiledBundle(
  compiled: Buffer,
  syntheticSourceName: string,
  archivedSourceName: string,
): string {
  const synthetic = Buffer.from(syntheticSourceName);
  const archived = Buffer.from(archivedSourceName);
  if (synthetic.length !== archived.length) {
    throw new TypeError(
      "The embedded iOS Hermes compilation source name changed size during normalization.",
    );
  }
  const sourceOffset = compiled.indexOf(synthetic);
  const compilerChecksumMatches =
    compiled.length >= HERMES_HEADER_BYTES + HERMES_FOOTER_BYTES &&
    createHash("sha1")
      .update(compiled.subarray(0, -HERMES_FOOTER_BYTES))
      .digest()
      .equals(compiled.subarray(-HERMES_FOOTER_BYTES));
  if (
    sourceOffset === -1 ||
    compiled.indexOf(synthetic, sourceOffset + synthetic.length) !== -1 ||
    !compilerChecksumMatches
  ) {
    throw new TypeError(
      "The pinned Hermes compiler emitted invalid iOS source metadata.",
    );
  }
  const normalized = Buffer.from(compiled);
  archived.copy(normalized, sourceOffset);
  createHash("sha1")
    .update(normalized.subarray(0, -HERMES_FOOTER_BYTES))
    .digest()
    .copy(normalized, normalized.length - HERMES_FOOTER_BYTES);
  return createHash("sha256").update(normalized).digest("hex");
}

function manifestPayload(
  manifest: NativeReleaseManifest,
): Omit<NativeReleaseManifest, "releaseFingerprint"> {
  return {
    schemaVersion: manifest.schemaVersion,
    algorithm: manifest.algorithm,
    trust: manifest.trust,
    projectName: manifest.projectName,
    platform: manifest.platform,
    release: manifest.release,
    channel: manifest.channel,
    sourceRevision: manifest.sourceRevision,
    runtime: manifest.runtime,
    nativeCompatibilityFingerprint: manifest.nativeCompatibilityFingerprint,
    bundleFingerprint: manifest.bundleFingerprint,
    artifact: manifest.artifact,
    ...(manifest.artifactSigning === undefined
      ? {}
      : { artifactSigning: manifest.artifactSigning }),
    ...(manifest.embeddedBundle === undefined
      ? {}
      : { embeddedBundle: manifest.embeddedBundle }),
  };
}

function parseRuntime(value: unknown): NativeFingerprintReport["runtime"] {
  if (!isRecord(value)) {
    throw new TypeError(
      "The release manifest has an invalid runtime identity.",
    );
  }
  const names = [
    "reactNative",
    "hermesCompiler",
    "solid",
    "solidNativeCore",
    "solidNativeFabricHost",
    "solidNativeRuntime",
    "solidNativeMetro",
    "solidNativeCompiler",
  ] as const;
  if (!hasExactKeys(value, names)) {
    throw new TypeError(
      "The release manifest has an invalid runtime identity.",
    );
  }
  const runtime: Record<string, string> = {};
  for (const name of names) {
    const entry = value[name];
    if (typeof entry !== "string" || entry.length === 0 || entry.length > 128) {
      throw new TypeError(
        `The release manifest has an invalid ${name} runtime identity.`,
      );
    }
    runtime[name] = entry;
  }
  return runtime as unknown as NativeFingerprintReport["runtime"];
}

function parseEmbeddedBundle(
  value: unknown,
  platform: "android" | "ios",
): NativeEmbeddedBundleArtifact {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "path",
      "format",
      "bytecodeVersion",
      "bytes",
      "sha256",
      "sourceSha1",
    ]) ||
    typeof value.path !== "string" ||
    (platform === "android"
      ? value.path !== "assets/index.android.bundle" &&
        value.path !== "base/assets/index.android.bundle"
      : !IOS_EMBEDDED_BUNDLE_PATH.test(value.path)) ||
    value.format !== "hermes-bytecode" ||
    value.bytecodeVersion !== VERIFIED_HERMES_BYTECODE_VERSION ||
    typeof value.bytes !== "number" ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 32 ||
    value.bytes > 256 * 1024 * 1024 ||
    typeof value.sha256 !== "string" ||
    !SHA256_PATTERN.test(value.sha256) ||
    typeof value.sourceSha1 !== "string" ||
    !SHA1_PATTERN.test(value.sourceSha1)
  ) {
    throw new TypeError(
      "The release manifest has an invalid embedded bundle identity.",
    );
  }
  return {
    path: value.path,
    format: "hermes-bytecode",
    bytecodeVersion: VERIFIED_HERMES_BYTECODE_VERSION,
    bytes: value.bytes,
    sha256: value.sha256,
    sourceSha1: value.sourceSha1,
  };
}

function parseArtifactSigning(
  value: unknown,
  platform: "android" | "ios",
): NativeReleaseArtifactSigning {
  if (platform !== "android" || !isRecord(value)) {
    throw new TypeError(
      "The release manifest has an invalid artifact-signing identity.",
    );
  }
  if (
    value.scheme === "android-jar" &&
    hasExactKeys(value, ["scheme", "certificateSha256"]) &&
    typeof value.certificateSha256 === "string" &&
    SHA256_PATTERN.test(value.certificateSha256)
  ) {
    return {
      scheme: "android-jar",
      certificateSha256: value.certificateSha256,
    };
  }
  if (
    value.scheme === "android-apk" &&
    hasExactKeys(value, ["scheme", "certificateSha256s"]) &&
    Array.isArray(value.certificateSha256s) &&
    value.certificateSha256s.length >= 1 &&
    value.certificateSha256s.length <= 8 &&
    value.certificateSha256s.every(
      (entry) => typeof entry === "string" && SHA256_PATTERN.test(entry),
    ) &&
    new Set(value.certificateSha256s).size ===
      value.certificateSha256s.length &&
    value.certificateSha256s.every(
      (entry, index, values) => index === 0 || values[index - 1]! < entry,
    )
  ) {
    return {
      scheme: "android-apk",
      certificateSha256s: value.certificateSha256s,
    };
  }
  throw new TypeError(
    "The release manifest has an invalid artifact-signing identity.",
  );
}

function parseReleaseManifest(value: unknown): NativeReleaseManifest {
  const manifestKeys = [
    "schemaVersion",
    "algorithm",
    "trust",
    "projectName",
    "platform",
    "release",
    "channel",
    "sourceRevision",
    "runtime",
    "nativeCompatibilityFingerprint",
    "bundleFingerprint",
    "artifact",
    "releaseFingerprint",
    ...(isRecord(value) && Object.hasOwn(value, "artifactSigning")
      ? ["artifactSigning"]
      : []),
    ...(isRecord(value) && Object.hasOwn(value, "embeddedBundle")
      ? ["embeddedBundle"]
      : []),
  ];
  if (
    !isRecord(value) ||
    !hasExactKeys(value, manifestKeys) ||
    value.schemaVersion !== 0 ||
    value.algorithm !== "sha256" ||
    value.trust !== "unsigned" ||
    (value.platform !== "android" && value.platform !== "ios") ||
    typeof value.projectName !== "string" ||
    value.projectName.length === 0 ||
    value.projectName.length > 214 ||
    /[\r\n\0]/u.test(value.projectName) ||
    typeof value.release !== "string" ||
    typeof value.channel !== "string" ||
    typeof value.sourceRevision !== "string" ||
    typeof value.nativeCompatibilityFingerprint !== "string" ||
    !FINGERPRINT_PATTERN.test(value.nativeCompatibilityFingerprint) ||
    typeof value.bundleFingerprint !== "string" ||
    !FINGERPRINT_PATTERN.test(value.bundleFingerprint) ||
    typeof value.releaseFingerprint !== "string" ||
    !FINGERPRINT_PATTERN.test(value.releaseFingerprint) ||
    !isRecord(value.artifact)
  ) {
    throw new TypeError("The release manifest has an invalid schema.");
  }
  const release = assertToken(value.release, "identifier", RELEASE_PATTERN);
  const channel = assertToken(value.channel, "channel", CHANNEL_PATTERN);
  const sourceRevision = assertToken(
    value.sourceRevision,
    "source revision",
    REVISION_PATTERN,
  );
  if (
    !hasExactKeys(value.artifact, ["name", "bytes", "sha256"]) ||
    typeof value.artifact.name !== "string" ||
    value.artifact.name.length === 0 ||
    value.artifact.name.length > 255 ||
    /[\\/\r\n\0]/u.test(value.artifact.name) ||
    typeof value.artifact.bytes !== "number" ||
    !Number.isSafeInteger(value.artifact.bytes) ||
    value.artifact.bytes <= 0 ||
    value.artifact.bytes > MAX_RELEASE_ARTIFACT_BYTES ||
    typeof value.artifact.sha256 !== "string" ||
    !SHA256_PATTERN.test(value.artifact.sha256)
  ) {
    throw new TypeError(
      "The release manifest has an invalid artifact identity.",
    );
  }
  if (value.artifactSigning !== undefined) {
    const artifactSigning = parseArtifactSigning(
      value.artifactSigning,
      value.platform,
    );
    const expectedExtension =
      artifactSigning.scheme === "android-jar" ? ".aab" : ".apk";
    if (path.extname(value.artifact.name).toLowerCase() !== expectedExtension) {
      throw new TypeError(
        `The release manifest can bind ${artifactSigning.scheme} signing only to an ${expectedExtension} artifact.`,
      );
    }
  }
  return {
    schemaVersion: 0,
    algorithm: "sha256",
    trust: "unsigned",
    projectName: value.projectName,
    platform: value.platform,
    release,
    channel,
    sourceRevision,
    runtime: parseRuntime(value.runtime),
    nativeCompatibilityFingerprint: value.nativeCompatibilityFingerprint,
    bundleFingerprint: value.bundleFingerprint,
    artifact: {
      name: value.artifact.name,
      bytes: value.artifact.bytes,
      sha256: value.artifact.sha256,
    },
    ...(value.artifactSigning === undefined
      ? {}
      : {
          artifactSigning: parseArtifactSigning(
            value.artifactSigning,
            value.platform,
          ),
        }),
    ...(value.embeddedBundle === undefined
      ? {}
      : {
          embeddedBundle: parseEmbeddedBundle(
            value.embeddedBundle,
            value.platform,
          ),
        }),
    releaseFingerprint: value.releaseFingerprint,
  };
}

export async function readNativeReleaseManifest(
  manifestPath: string,
): Promise<NativeReleaseManifest> {
  let metadata;
  try {
    metadata = await lstat(manifestPath);
  } catch {
    throw new TypeError(
      `Release manifest ${manifestPath} is missing or unreadable.`,
    );
  }
  if (
    !metadata.isFile() ||
    metadata.size === 0 ||
    metadata.size > MAX_RELEASE_MANIFEST_BYTES
  ) {
    throw new TypeError(
      `The release manifest must be a 1-${MAX_RELEASE_MANIFEST_BYTES} byte regular file.`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new TypeError(
      `The release manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parseReleaseManifest(value);
}

export function nativeReleaseFingerprintMatches(
  manifest: NativeReleaseManifest,
): boolean {
  return digestValue(manifestPayload(manifest)) === manifest.releaseFingerprint;
}

function targetFingerprint(
  fingerprint: NativeFingerprintReport,
  platform: "android" | "ios",
): string {
  const target = fingerprint.targets.find(
    (entry) => entry.platform === platform,
  );
  if (target === undefined) {
    throw new TypeError(`The native fingerprint omitted ${platform}.`);
  }
  return target.fingerprint;
}

export async function createNativeReleaseManifest(
  options: CreateNativeReleaseOptions,
): Promise<CreateNativeReleaseResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const bundleManifestPath = path.resolve(cwd, options.bundleManifestPath);
  const bundle = await verifyNativeBundleManifest(bundleManifestPath);
  if (!bundle.ok) {
    throw new TypeError(formatNativeBundleVerification(bundle));
  }
  const fingerprint = await createNativeFingerprint({
    cwd,
    platform: bundle.platform,
  });
  const artifactPath = path.resolve(cwd, options.artifactPath);
  const artifact = await digestReleaseArtifact(artifactPath);
  let embeddedBundle: NativeEmbeddedBundleArtifact | undefined;
  if (options.inspectEmbeddedBundle === true) {
    embeddedBundle = await inspectEmbeddedBundle(
      cwd,
      artifactPath,
      bundleManifestPath,
    );
    const [finalArtifact, finalBundle] = await Promise.all([
      digestReleaseArtifact(artifactPath),
      verifyNativeBundleManifest(bundleManifestPath),
    ]);
    if (JSON.stringify(finalArtifact) !== JSON.stringify(artifact)) {
      throw new TypeError(
        "The release artifact changed while its embedded bundle was linked.",
      );
    }
    if (
      !finalBundle.ok ||
      finalBundle.bundleFingerprint !== bundle.bundleFingerprint
    ) {
      throw new TypeError(
        "The reviewed bundle changed while the release artifact was linked.",
      );
    }
  }
  let artifactSigning: NativeReleaseArtifactSigning | undefined;
  if (
    options.androidSigningCertificateSha256s !== undefined &&
    options.androidUploadCertificateSha256 !== undefined
  ) {
    throw new TypeError(
      "Android APK signing certificates and an AAB upload certificate cannot be bound to the same release.",
    );
  }
  if (options.androidSigningCertificateSha256s !== undefined) {
    if (bundle.platform !== "android") {
      throw new TypeError(
        "Android APK signing verification requires an Android bundle manifest.",
      );
    }
    const verifyAndroidSigning =
      options.dependencies?.verifyAndroidApkSigning ??
      verifyNativeAndroidApkSigning;
    const signing = await verifyAndroidSigning({
      artifactPath,
      cwd,
      expectedCertificateSha256s: options.androidSigningCertificateSha256s,
    });
    if (!signing.ok) {
      throw new TypeError(formatNativeAndroidApkSigningReport(signing));
    }
    if (
      path.resolve(signing.artifactPath) !== artifactPath ||
      JSON.stringify(signing.artifact) !== JSON.stringify(artifact)
    ) {
      throw new TypeError(
        "The Android APK changed between release hashing and signing verification.",
      );
    }
    if (signing.signers.length === 0) {
      throw new TypeError(
        "Android APK signing verification did not return a signing-certificate identity.",
      );
    }
    artifactSigning = parseArtifactSigning(
      {
        scheme: "android-apk",
        certificateSha256s: signing.signers
          .map((signer) => signer.certificateSha256)
          .sort(),
      },
      "android",
    );
    const finalArtifact = await digestReleaseArtifact(artifactPath);
    if (JSON.stringify(finalArtifact) !== JSON.stringify(artifact)) {
      throw new TypeError(
        "The Android APK changed while its signing identity was bound.",
      );
    }
  }
  if (options.androidUploadCertificateSha256 !== undefined) {
    if (bundle.platform !== "android") {
      throw new TypeError(
        "Android upload-certificate verification requires an Android bundle manifest.",
      );
    }
    const verifyAndroidSigning =
      options.dependencies?.verifyAndroidBundleSigning ??
      verifyNativeAndroidBundleSigning;
    const signing = await verifyAndroidSigning({
      artifactPath,
      cwd,
      expectedCertificateSha256: options.androidUploadCertificateSha256,
    });
    if (!signing.ok) {
      throw new TypeError(formatNativeAndroidBundleSigningReport(signing));
    }
    if (
      path.resolve(signing.artifactPath) !== artifactPath ||
      JSON.stringify(signing.artifact) !== JSON.stringify(artifact)
    ) {
      throw new TypeError(
        "The Android App Bundle changed between release hashing and signing verification.",
      );
    }
    const signer = signing.signers[0];
    if (signer === undefined) {
      throw new TypeError(
        "Android signing verification did not return the required upload certificate.",
      );
    }
    artifactSigning = parseArtifactSigning(
      {
        scheme: "android-jar",
        certificateSha256: signer.certificateSha256,
      },
      "android",
    );
    const finalArtifact = await digestReleaseArtifact(artifactPath);
    if (JSON.stringify(finalArtifact) !== JSON.stringify(artifact)) {
      throw new TypeError(
        "The Android App Bundle changed while its signing identity was bound.",
      );
    }
  }
  const release = assertToken(options.release, "identifier", RELEASE_PATTERN);
  const channel = assertToken(options.channel, "channel", CHANNEL_PATTERN);
  const sourceRevision = assertToken(
    options.sourceRevision,
    "source revision",
    REVISION_INPUT_PATTERN,
  ).toLowerCase();
  const payload = {
    schemaVersion: 0 as const,
    algorithm: "sha256" as const,
    trust: "unsigned" as const,
    projectName: fingerprint.projectName,
    platform: bundle.platform,
    release,
    channel,
    sourceRevision,
    runtime: fingerprint.runtime,
    nativeCompatibilityFingerprint: targetFingerprint(
      fingerprint,
      bundle.platform,
    ),
    bundleFingerprint: bundle.bundleFingerprint,
    artifact,
    ...(artifactSigning === undefined ? {} : { artifactSigning }),
    ...(embeddedBundle === undefined ? {} : { embeddedBundle }),
  };
  const manifest: NativeReleaseManifest = {
    ...payload,
    releaseFingerprint: digestValue(payload),
  };
  const manifestPath = path.resolve(
    cwd,
    options.outputPath ??
      path.join(path.dirname(bundleManifestPath), "solid-native-release.json"),
  );
  if (manifestPath === artifactPath || manifestPath === bundleManifestPath) {
    throw new TypeError(
      "The release manifest must not overwrite an input artifact or bundle manifest.",
    );
  }
  const parent = path.dirname(manifestPath);
  // Follow the parent directory itself so standard aliases such as macOS
  // `/tmp` -> `/private/tmp` remain valid output locations. The newly-created
  // manifest still uses an exclusive regular-file write in that directory.
  const parentMetadata = await stat(parent).catch(() => undefined);
  if (parentMetadata?.isDirectory() !== true) {
    throw new TypeError(
      "The release manifest output directory does not exist.",
    );
  }
  const temporaryPath = `${manifestPath}.solid-native-${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: "wx",
    });
    await rename(temporaryPath, manifestPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return { manifestPath, manifest };
}

function check(
  id: NativeReleaseVerificationCheck["id"],
  pass: boolean,
  success: string,
  failure: string,
): NativeReleaseVerificationCheck {
  return {
    id,
    status: pass ? "pass" : "fail",
    message: pass ? success : failure,
  };
}

export async function verifyNativeReleaseManifest(
  options: VerifyNativeReleaseOptions,
): Promise<NativeReleaseVerificationReport> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const manifestPath = path.resolve(cwd, options.manifestPath);
  const artifactPath = path.resolve(cwd, options.artifactPath);
  const bundleManifestPath = path.resolve(cwd, options.bundleManifestPath);
  const manifest = await readNativeReleaseManifest(manifestPath);
  const checks: NativeReleaseVerificationCheck[] = [
    check(
      "fingerprint",
      nativeReleaseFingerprintMatches(manifest),
      "The release fingerprint matches the canonical envelope.",
      "The release fingerprint does not match the canonical envelope.",
    ),
  ];
  try {
    const artifact = await digestReleaseArtifact(artifactPath);
    checks.push(
      check(
        "artifact",
        JSON.stringify(artifact) === JSON.stringify(manifest.artifact),
        "The final native artifact matches the release envelope.",
        "The final native artifact does not match the release envelope.",
      ),
    );
  } catch (error) {
    checks.push({
      id: "artifact",
      status: "fail",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  if (manifest.artifactSigning !== undefined) {
    try {
      if (manifest.artifactSigning.scheme === "android-jar") {
        const verifyAndroidSigning =
          options.dependencies?.verifyAndroidBundleSigning ??
          verifyNativeAndroidBundleSigning;
        const signing = await verifyAndroidSigning({
          artifactPath,
          cwd,
          expectedCertificateSha256: manifest.artifactSigning.certificateSha256,
        });
        checks.push(
          check(
            "artifact-signing",
            signing.ok &&
              path.resolve(signing.artifactPath) === artifactPath &&
              JSON.stringify(signing.artifact) ===
                JSON.stringify(manifest.artifact),
            "The Android App Bundle signature and upload certificate match the release envelope.",
            "The Android App Bundle signature does not match the release envelope.",
          ),
        );
      } else {
        const verifyAndroidSigning =
          options.dependencies?.verifyAndroidApkSigning ??
          verifyNativeAndroidApkSigning;
        const signing = await verifyAndroidSigning({
          artifactPath,
          cwd,
          expectedCertificateSha256s:
            manifest.artifactSigning.certificateSha256s,
        });
        checks.push(
          check(
            "artifact-signing",
            signing.ok &&
              path.resolve(signing.artifactPath) === artifactPath &&
              JSON.stringify(signing.artifact) ===
                JSON.stringify(manifest.artifact),
            "The Android APK signature and certificate set match the release envelope.",
            "The Android APK signature does not match the release envelope.",
          ),
        );
      }
    } catch (error) {
      checks.push({
        id: "artifact-signing",
        status: "fail",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (manifest.embeddedBundle !== undefined) {
    try {
      const embeddedBundle = await inspectEmbeddedBundle(
        cwd,
        artifactPath,
        bundleManifestPath,
      );
      checks.push(
        check(
          "embedded-bundle",
          JSON.stringify(embeddedBundle) ===
            JSON.stringify(manifest.embeddedBundle),
          "The archived Hermes bytecode matches the pinned compiler output for the reviewed bundle source.",
          "The archived Hermes bytecode does not match the release envelope.",
        ),
      );
    } catch (error) {
      checks.push({
        id: "embedded-bundle",
        status: "fail",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  try {
    const bundle = await verifyNativeBundleManifest(bundleManifestPath);
    checks.push(
      check(
        "bundle",
        bundle.ok &&
          bundle.platform === manifest.platform &&
          bundle.bundleFingerprint === manifest.bundleFingerprint,
        "The complete bundle artifact set matches the release envelope.",
        "The bundle artifact set does not match the release envelope.",
      ),
    );
  } catch (error) {
    checks.push({
      id: "bundle",
      status: "fail",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  try {
    const fingerprint = await createNativeFingerprint({
      cwd,
      platform: manifest.platform,
    });
    checks.push(
      check(
        "native",
        fingerprint.projectName === manifest.projectName &&
          JSON.stringify(fingerprint.runtime) ===
            JSON.stringify(manifest.runtime) &&
          targetFingerprint(fingerprint, manifest.platform) ===
            manifest.nativeCompatibilityFingerprint,
        "The current native compatibility inputs match the release envelope.",
        "The current native compatibility inputs do not match the release envelope.",
      ),
    );
  } catch (error) {
    checks.push({
      id: "native",
      status: "fail",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return {
    schemaVersion: 0,
    ok: checks.every((entry) => entry.status === "pass"),
    manifestPath,
    releaseFingerprint: manifest.releaseFingerprint,
    checks,
  };
}

export function formatNativeReleaseVerification(
  report: NativeReleaseVerificationReport,
): string {
  return [
    `${report.ok ? "PASS" : "FAIL"} Solid Native release ${report.releaseFingerprint}`,
    `Manifest: ${report.manifestPath}`,
    ...report.checks.map(
      (entry) =>
        `${entry.status === "pass" ? "PASS" : "FAIL"} ${entry.id}: ${entry.message}`,
    ),
    "",
    "Integrity only: verify a trusted signature before accepting this release.",
  ].join("\n");
}
