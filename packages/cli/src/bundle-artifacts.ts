import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { validateCanonicalNativeSourceMap } from "./source-map.js";

export interface NativeBundleArtifact {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface NativeBundleManifest {
  readonly schemaVersion: 0;
  readonly algorithm: "sha256";
  readonly trust: "unsigned";
  readonly platform: "android" | "ios";
  readonly mode: "production";
  readonly minified: boolean;
  readonly entryPoint: string;
  readonly artifacts: Readonly<{
    bundle: NativeBundleArtifact;
    sourceMap: NativeBundleArtifact;
    assets: readonly NativeBundleArtifact[];
  }>;
  readonly bundleFingerprint: string;
}

export interface WriteNativeBundleManifestOptions {
  readonly platform: "android" | "ios";
  readonly entryPoint: string;
  readonly outputDirectory: string;
  readonly bundlePath: string;
  readonly sourceMapPath: string;
  readonly assetsDirectory: string;
  readonly manifestPath: string;
  readonly minified?: boolean;
}

export interface NativeBundleVerificationCheck {
  readonly id: "assets" | "bundle" | "fingerprint" | "source-map";
  readonly status: "pass" | "fail";
  readonly message: string;
}

export interface NativeBundleVerificationReport {
  readonly schemaVersion: 0;
  readonly ok: boolean;
  readonly manifestPath: string;
  readonly platform: "android" | "ios";
  readonly bundleFingerprint: string;
  readonly checks: readonly NativeBundleVerificationCheck[];
}

const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024;
const MAX_ASSET_COUNT = 4_096;
const MAX_ASSET_DIRECTORIES = 4_096;
const MAX_TOTAL_ASSET_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_ASSET_DEPTH = 32;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
}

function artifactLabel(root: string, target: string): string {
  if (!isWithin(root, target) || root === target) {
    throw new TypeError(`Bundle artifact ${target} escapes ${root}.`);
  }
  return path.relative(root, target).replaceAll(path.sep, "/");
}

async function digestArtifact(
  absolutePath: string,
  label: string,
): Promise<NativeBundleArtifact> {
  let before;
  try {
    before = await lstat(absolutePath);
  } catch {
    throw new TypeError(`Bundle artifact ${label} is missing or unreadable.`);
  }
  if (!before.isFile()) {
    throw new TypeError(`Bundle artifact ${label} is not a regular file.`);
  }
  if (before.size === 0 || before.size > MAX_ARTIFACT_BYTES) {
    throw new TypeError(
      `Bundle artifact ${label} must contain 1-${MAX_ARTIFACT_BYTES} bytes.`,
    );
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
    throw new TypeError(`Bundle artifact ${label} changed while being hashed.`);
  }
  return {
    path: label,
    bytes: before.size,
    sha256: hash.digest("hex"),
  };
}

async function collectAssetPaths(
  directory: string,
  depth = 0,
  state: { readonly paths: string[]; directories: number } = {
    paths: [],
    directories: 0,
  },
): Promise<readonly string[]> {
  if (depth > MAX_ASSET_DEPTH) {
    throw new TypeError(
      `Bundle assets exceed the ${MAX_ASSET_DEPTH}-directory depth limit.`,
    );
  }
  state.directories += 1;
  if (state.directories > MAX_ASSET_DIRECTORIES) {
    throw new TypeError(
      `Bundle assets exceed the ${MAX_ASSET_DIRECTORIES}-directory limit.`,
    );
  }
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => compareNames(left.name, right.name));
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectAssetPaths(absolutePath, depth + 1, state);
      continue;
    }
    if (!entry.isFile()) {
      throw new TypeError(
        `Bundle asset ${absolutePath} must be a regular file or directory.`,
      );
    }
    if (state.paths.length >= MAX_ASSET_COUNT) {
      throw new TypeError(
        `Bundle assets exceed the ${MAX_ASSET_COUNT}-file limit.`,
      );
    }
    state.paths.push(absolutePath);
  }
  return state.paths.sort(compareNames);
}

function digestValue(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function portableEntryPoint(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  if (
    normalized.length === 0 ||
    normalized.length > 4_096 ||
    normalized.includes("\0") ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized) ||
    normalized.split("/").includes("..")
  ) {
    throw new TypeError(
      "The bundle entry point must be a bounded project-relative path.",
    );
  }
  return normalized;
}

function portableArtifactPath(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must declare a relative path.`);
  }
  const normalized = value.replaceAll("\\", "/");
  if (
    normalized.length === 0 ||
    normalized.length > 4_096 ||
    normalized.includes("\0") ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized) ||
    normalized
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new TypeError(`${label} must remain inside the bundle directory.`);
  }
  return normalized;
}

function parseArtifact(value: unknown, label: string): NativeBundleArtifact {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an artifact record.`);
  }
  const artifactPath = portableArtifactPath(value.path, label);
  if (
    typeof value.bytes !== "number" ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes <= 0 ||
    value.bytes > MAX_ARTIFACT_BYTES
  ) {
    throw new TypeError(`${label} has an invalid byte count.`);
  }
  if (
    typeof value.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.sha256)
  ) {
    throw new TypeError(`${label} has an invalid SHA-256 digest.`);
  }
  return { path: artifactPath, bytes: value.bytes, sha256: value.sha256 };
}

function parseManifest(value: unknown): NativeBundleManifest {
  if (!isRecord(value)) {
    throw new TypeError("The bundle manifest must contain an object.");
  }
  if (
    value.schemaVersion !== 0 ||
    value.algorithm !== "sha256" ||
    value.trust !== "unsigned" ||
    (value.platform !== "android" && value.platform !== "ios") ||
    value.mode !== "production" ||
    typeof value.minified !== "boolean" ||
    typeof value.entryPoint !== "string" ||
    typeof value.bundleFingerprint !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(value.bundleFingerprint) ||
    !isRecord(value.artifacts) ||
    !Array.isArray(value.artifacts.assets)
  ) {
    throw new TypeError("The bundle manifest has an invalid schema.");
  }
  const entryPoint = portableEntryPoint(value.entryPoint);
  if (entryPoint !== value.entryPoint) {
    throw new TypeError("The bundle manifest entry point is not canonical.");
  }
  if (value.artifacts.assets.length > MAX_ASSET_COUNT) {
    throw new TypeError(
      `The bundle manifest exceeds the ${MAX_ASSET_COUNT}-asset limit.`,
    );
  }
  const bundle = parseArtifact(value.artifacts.bundle, "Bundle");
  const sourceMap = parseArtifact(value.artifacts.sourceMap, "Source map");
  const assets = value.artifacts.assets.map((artifact, index) =>
    parseArtifact(artifact, `Asset ${index}`),
  );
  const assetPaths = assets.map((artifact) => artifact.path);
  if (
    bundle.path === sourceMap.path ||
    bundle.path.startsWith("assets/") ||
    sourceMap.path.startsWith("assets/") ||
    assetPaths.some((assetPath) => !assetPath.startsWith("assets/")) ||
    new Set(assetPaths).size !== assetPaths.length ||
    assetPaths.some(
      (assetPath, index) => index > 0 && assetPaths[index - 1]! >= assetPath,
    )
  ) {
    throw new TypeError(
      "Bundle manifest asset paths must be unique, sorted, and inside assets/.",
    );
  }
  return {
    schemaVersion: 0,
    algorithm: "sha256",
    trust: "unsigned",
    platform: value.platform,
    mode: "production",
    minified: value.minified,
    entryPoint,
    artifacts: { bundle, sourceMap, assets },
    bundleFingerprint: value.bundleFingerprint,
  };
}

function artifactMatches(
  expected: NativeBundleArtifact,
  actual: NativeBundleArtifact,
): boolean {
  return (
    expected.path === actual.path &&
    expected.bytes === actual.bytes &&
    expected.sha256 === actual.sha256
  );
}

function manifestPayload(
  manifest: NativeBundleManifest,
): Omit<NativeBundleManifest, "bundleFingerprint"> {
  return {
    schemaVersion: manifest.schemaVersion,
    algorithm: manifest.algorithm,
    trust: manifest.trust,
    platform: manifest.platform,
    mode: manifest.mode,
    minified: manifest.minified,
    entryPoint: manifest.entryPoint,
    artifacts: manifest.artifacts,
  };
}

function artifactAbsolutePath(outputDirectory: string, label: string): string {
  const target = path.resolve(outputDirectory, ...label.split("/"));
  if (!isWithin(outputDirectory, target) || target === outputDirectory) {
    throw new TypeError(
      `Bundle artifact ${label} escapes its output directory.`,
    );
  }
  return target;
}

async function verifyArtifact(
  id: NativeBundleVerificationCheck["id"],
  label: string,
  expected: NativeBundleArtifact,
  outputDirectory: string,
): Promise<NativeBundleVerificationCheck> {
  try {
    const actual = await digestArtifact(
      artifactAbsolutePath(outputDirectory, expected.path),
      expected.path,
    );
    return artifactMatches(expected, actual)
      ? { id, status: "pass", message: `${label} matches its manifest digest.` }
      : {
          id,
          status: "fail",
          message: `${label} does not match its manifest digest.`,
        };
  } catch (error) {
    return {
      id,
      status: "fail",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function verifySourceMapArtifact(
  expected: NativeBundleArtifact,
  outputDirectory: string,
): Promise<NativeBundleVerificationCheck> {
  try {
    const sourceMapPath = artifactAbsolutePath(outputDirectory, expected.path);
    const sourceCount = await validateCanonicalNativeSourceMap(sourceMapPath);
    const digestCheck = await verifyArtifact(
      "source-map",
      "The canonical source map",
      expected,
      outputDirectory,
    );
    if (digestCheck.status === "fail") return digestCheck;
    return {
      id: "source-map",
      status: "pass",
      message: `The canonical source map matches its manifest digest and embeds ${String(sourceCount)} portable sources.`,
    };
  } catch (error) {
    return {
      id: "source-map",
      status: "fail",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function writeNativeBundleManifest(
  options: WriteNativeBundleManifestOptions,
): Promise<NativeBundleManifest> {
  if (options.platform !== "android" && options.platform !== "ios") {
    throw new TypeError("The bundle manifest requires android or ios.");
  }
  const entryPoint = portableEntryPoint(options.entryPoint);
  const outputDirectory = path.resolve(options.outputDirectory);
  if (outputDirectory === path.parse(outputDirectory).root) {
    throw new TypeError("The bundle output cannot be the filesystem root.");
  }
  const assetsDirectory = path.resolve(options.assetsDirectory);
  const manifestPath = path.resolve(options.manifestPath);
  if (
    !isWithin(outputDirectory, assetsDirectory) ||
    assetsDirectory === outputDirectory
  ) {
    throw new TypeError(
      "The bundle assets directory must remain inside its output directory.",
    );
  }
  if (
    !isWithin(outputDirectory, manifestPath) ||
    manifestPath === outputDirectory
  ) {
    throw new TypeError(
      "The bundle manifest path must remain inside its output directory.",
    );
  }
  const bundleLabel = artifactLabel(outputDirectory, options.bundlePath);
  const sourceMapLabel = artifactLabel(outputDirectory, options.sourceMapPath);
  const manifestLabel = artifactLabel(outputDirectory, manifestPath);
  if (
    bundleLabel === sourceMapLabel ||
    bundleLabel === manifestLabel ||
    sourceMapLabel === manifestLabel ||
    bundleLabel.startsWith("assets/") ||
    sourceMapLabel.startsWith("assets/") ||
    manifestLabel.startsWith("assets/")
  ) {
    throw new TypeError(
      "The bundle, source map, manifest, and asset tree must be distinct artifacts.",
    );
  }
  const [bundle, sourceMap, assetPaths] = await Promise.all([
    digestArtifact(options.bundlePath, bundleLabel),
    validateCanonicalNativeSourceMap(options.sourceMapPath).then(() =>
      digestArtifact(options.sourceMapPath, sourceMapLabel),
    ),
    collectAssetPaths(assetsDirectory),
  ]);
  const assets: NativeBundleArtifact[] = [];
  let totalAssetBytes = 0;
  for (const assetPath of assetPaths) {
    const artifact = await digestArtifact(
      assetPath,
      artifactLabel(outputDirectory, assetPath),
    );
    totalAssetBytes += artifact.bytes;
    if (totalAssetBytes > MAX_TOTAL_ASSET_BYTES) {
      throw new TypeError(
        `Bundle assets exceed the ${MAX_TOTAL_ASSET_BYTES}-byte total limit.`,
      );
    }
    assets.push(artifact);
  }
  const payload = {
    schemaVersion: 0 as const,
    algorithm: "sha256" as const,
    trust: "unsigned" as const,
    platform: options.platform,
    mode: "production" as const,
    minified: options.minified ?? true,
    entryPoint,
    artifacts: { bundle, sourceMap, assets },
  };
  const manifest: NativeBundleManifest = {
    ...payload,
    bundleFingerprint: digestValue(payload),
  };
  const temporaryPath = `${manifestPath}.solid-native-${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: "wx",
    });
    await rename(temporaryPath, manifestPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return manifest;
}

export async function readNativeBundleManifest(
  manifestLocation: string,
): Promise<NativeBundleManifest> {
  const manifestPath = path.resolve(manifestLocation);
  let metadata;
  try {
    metadata = await lstat(manifestPath);
  } catch {
    throw new TypeError(
      `Bundle manifest ${manifestPath} is missing or unreadable.`,
    );
  }
  if (
    !metadata.isFile() ||
    metadata.size === 0 ||
    metadata.size > MAX_MANIFEST_BYTES
  ) {
    throw new TypeError(
      `The bundle manifest must be a 1-${MAX_MANIFEST_BYTES} byte regular file.`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new TypeError(
      `The bundle manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parseManifest(value);
}

export async function verifyNativeBundleManifest(
  manifestLocation: string,
): Promise<NativeBundleVerificationReport> {
  const manifestPath = path.resolve(manifestLocation);
  const outputDirectory = path.dirname(manifestPath);
  if (outputDirectory === path.parse(outputDirectory).root) {
    throw new TypeError("The bundle output cannot be the filesystem root.");
  }
  const manifest = await readNativeBundleManifest(manifestPath);
  const expectedFingerprint = digestValue(manifestPayload(manifest));
  const checks: NativeBundleVerificationCheck[] = [
    expectedFingerprint === manifest.bundleFingerprint
      ? {
          id: "fingerprint",
          status: "pass",
          message:
            "The bundle fingerprint matches the canonical manifest payload.",
        }
      : {
          id: "fingerprint",
          status: "fail",
          message:
            "The bundle fingerprint does not match the canonical manifest payload.",
        },
  ];
  checks.push(
    ...(await Promise.all([
      verifyArtifact(
        "bundle",
        "The production bundle",
        manifest.artifacts.bundle,
        outputDirectory,
      ),
      verifySourceMapArtifact(manifest.artifacts.sourceMap, outputDirectory),
    ])),
  );
  try {
    const assetsDirectory = path.join(outputDirectory, "assets");
    const assetPaths = await collectAssetPaths(assetsDirectory);
    const labels = assetPaths.map((assetPath) =>
      artifactLabel(outputDirectory, assetPath),
    );
    const expectedLabels = manifest.artifacts.assets.map(
      (artifact) => artifact.path,
    );
    let assetsMatch =
      labels.length === expectedLabels.length &&
      labels.every((label, index) => label === expectedLabels[index]);
    let totalAssetBytes = 0;
    if (assetsMatch) {
      for (const [index, assetPath] of assetPaths.entries()) {
        const actual = await digestArtifact(assetPath, labels[index]!);
        totalAssetBytes += actual.bytes;
        if (
          totalAssetBytes > MAX_TOTAL_ASSET_BYTES ||
          !artifactMatches(manifest.artifacts.assets[index]!, actual)
        ) {
          assetsMatch = false;
          break;
        }
      }
    }
    checks.push(
      assetsMatch
        ? {
            id: "assets",
            status: "pass",
            message: `All ${labels.length} assets match the complete manifest set.`,
          }
        : {
            id: "assets",
            status: "fail",
            message: "The asset tree does not match the complete manifest set.",
          },
    );
  } catch (error) {
    checks.push({
      id: "assets",
      status: "fail",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return {
    schemaVersion: 0,
    ok: checks.every((check) => check.status === "pass"),
    manifestPath,
    platform: manifest.platform,
    bundleFingerprint: manifest.bundleFingerprint,
    checks,
  };
}

export function formatNativeBundleVerification(
  report: NativeBundleVerificationReport,
): string {
  return [
    `${report.ok ? "PASS" : "FAIL"} Solid Native bundle ${report.bundleFingerprint}`,
    `Manifest: ${report.manifestPath}`,
    ...report.checks.map(
      (check) =>
        `${check.status === "pass" ? "PASS" : "FAIL"} ${check.id}: ${check.message}`,
    ),
    "",
    "Integrity only: this manifest remains unsigned and does not prove provenance.",
  ].join("\n");
}
