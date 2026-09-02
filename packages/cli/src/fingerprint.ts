import { createHash } from "node:crypto";
import { access, readFile, readdir, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import {
  VERIFIED_HERMES_COMPILER_VERSION,
  VERIFIED_REACT_NATIVE_VERSION,
  VERIFIED_SOLID_VERSION,
} from "./versions.js";

export type NativeFingerprintPlatform = "all" | "android" | "ios";

export interface NativeFingerprintOptions {
  readonly cwd?: string;
  readonly platform?: NativeFingerprintPlatform;
}

export interface NativeFingerprintInput {
  /** Stable project-relative label. File contents are never included. */
  readonly path: string;
  readonly sha256: string;
}

export interface NativeTargetFingerprint {
  readonly platform: Exclude<NativeFingerprintPlatform, "all">;
  readonly fingerprint: string;
  readonly inputs: readonly NativeFingerprintInput[];
}

export interface NativeFingerprintReport {
  readonly schemaVersion: 0;
  readonly algorithm: "sha256";
  readonly projectRoot: string;
  readonly projectName: string;
  readonly runtime: Readonly<{
    reactNative: string;
    hermesCompiler: string;
    solid: string;
    solidNativeCore: string;
    solidNativeFabricHost: string;
    solidNativeRuntime: string;
    solidNativeMetro: string;
    solidNativeCompiler: string;
  }>;
  readonly targets: readonly NativeTargetFingerprint[];
}

interface FingerprintManifest {
  readonly name?: string;
  readonly version?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

interface InputPath {
  readonly label: string;
  readonly absolutePath: string;
}

interface InstalledPackage {
  readonly root: string;
  readonly version: string;
}

const MAX_FINGERPRINT_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_INSTALLED_PACKAGE_INPUTS = 1_024;
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".gradle",
  "Pods",
  "build",
  "DerivedData",
  "node_modules",
]);

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringRecord(
  value: unknown,
): Readonly<Record<string, string>> | undefined {
  if (!isRecord(value)) return undefined;
  const result: Record<string, string> = {};
  for (const [name, entry] of Object.entries(value)) {
    if (typeof entry === "string") result[name] = entry;
  }
  return result;
}

function parseManifest(source: string, location: string): FingerprintManifest {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new TypeError(
      `${location} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(value))
    throw new TypeError(`${location} must contain an object.`);
  const dependencies = stringRecord(value.dependencies);
  const devDependencies = stringRecord(value.devDependencies);
  const peerDependencies = stringRecord(value.peerDependencies);
  return {
    ...(typeof value.name === "string" ? { name: value.name } : {}),
    ...(typeof value.version === "string" ? { version: value.version } : {}),
    ...(dependencies === undefined ? {} : { dependencies }),
    ...(devDependencies === undefined ? {} : { devDependencies }),
    ...(peerDependencies === undefined ? {} : { peerDependencies }),
  };
}

function declaredVersion(
  manifest: FingerprintManifest,
  packageName: string,
): string | undefined {
  return (
    manifest.dependencies?.[packageName] ??
    manifest.devDependencies?.[packageName] ??
    manifest.peerDependencies?.[packageName]
  );
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function findProjectRoot(start: string): Promise<string> {
  let current = path.resolve(start);
  while (true) {
    if (await exists(path.join(current, "package.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) {
      throw new TypeError(`No package.json was found at or above ${start}.`);
    }
    current = parent;
  }
}

async function findAncestorFile(
  start: string,
  fileName: string,
): Promise<string | undefined> {
  let current = start;
  while (true) {
    const candidate = path.join(current, fileName);
    if (await exists(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

async function firstExisting(
  candidates: readonly string[],
): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return undefined;
}

async function findMatchingFile(
  directory: string,
  fileNames: ReadonlySet<string>,
  matches?: (source: string) => boolean,
  depth = 0,
): Promise<string | undefined> {
  if (depth > 12) return undefined;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return undefined;
  }
  entries.sort((left, right) => compareNames(left.name, right.name));
  for (const entry of entries) {
    if (!entry.isFile() || !fileNames.has(entry.name)) continue;
    const candidate = path.join(directory, entry.name);
    if (matches === undefined) return candidate;
    try {
      if (matches(await readFile(candidate, "utf8"))) return candidate;
    } catch {
      // Continue to another candidate; the final missing-input error is stable.
    }
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || IGNORED_DIRECTORIES.has(entry.name)) continue;
    const match = await findMatchingFile(
      path.join(directory, entry.name),
      fileNames,
      matches,
      depth + 1,
    );
    if (match !== undefined) return match;
  }
  return undefined;
}

async function installedPackage(
  projectRoot: string,
  packageName: string,
  declaration: string,
): Promise<InstalledPackage> {
  let current = projectRoot;
  while (true) {
    const manifestPath = path.join(
      current,
      "node_modules",
      packageName,
      "package.json",
    );
    if (await exists(manifestPath)) {
      const manifest = parseManifest(
        await readFile(manifestPath, "utf8"),
        manifestPath,
      );
      if (manifest.name !== packageName || manifest.version === undefined) {
        throw new TypeError(
          `Installed ${packageName} has an invalid package manifest.`,
        );
      }
      if (
        /^\d+\.\d+\.\d+(?:[-+].+)?$/u.test(declaration) &&
        declaration !== manifest.version
      ) {
        throw new TypeError(
          `${packageName} declares ${declaration} but ${manifest.version} is installed.`,
        );
      }
      return { root: path.dirname(manifestPath), version: manifest.version };
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new TypeError(
        `${packageName} is not installed at or above ${projectRoot}.`,
      );
    }
    current = parent;
  }
}

async function resolvedDependencyPackage(
  owner: InstalledPackage,
  packageName: string,
): Promise<InstalledPackage> {
  let entry: string;
  try {
    const ownerRoot = await realpath(owner.root);
    entry = createRequire(path.join(ownerRoot, "package.json")).resolve(
      packageName,
    );
  } catch {
    throw new TypeError(
      `${packageName} cannot be resolved from the installed package at ${owner.root}.`,
    );
  }
  let current = path.dirname(entry);
  while (true) {
    const manifestPath = path.join(current, "package.json");
    if (await exists(manifestPath)) {
      const manifest = parseManifest(
        await readFile(manifestPath, "utf8"),
        manifestPath,
      );
      if (manifest.name === packageName && manifest.version !== undefined) {
        return { root: current, version: manifest.version };
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new TypeError(
        `Resolved ${packageName} does not belong to a valid installed package.`,
      );
    }
    current = parent;
  }
}

function requireDeclaration(
  manifest: FingerprintManifest,
  packageName: string,
  expected?: string,
): string {
  const version = declaredVersion(manifest, packageName);
  if (version === undefined) {
    throw new TypeError(`${packageName} is not declared in package.json.`);
  }
  if (expected !== undefined && version !== expected) {
    throw new TypeError(
      `${packageName} is declared as ${version}; expected exact ${expected}.`,
    );
  }
  return version;
}

function projectLabel(projectRoot: string, absolutePath: string): string {
  return path.relative(projectRoot, absolutePath).replaceAll(path.sep, "/");
}

function requireInput(
  label: string,
  absolutePath: string | undefined,
): InputPath {
  if (absolutePath === undefined) {
    throw new TypeError(
      `Cannot fingerprint the application because ${label} is missing.`,
    );
  }
  return { label, absolutePath };
}

async function collectPackageInputs(
  packageRoot: string,
  packageName: string,
  directory = packageRoot,
  inputs: InputPath[] = [],
): Promise<readonly InputPath[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => compareNames(left.name, right.name));
  for (const entry of entries) {
    if (entry.name === "node_modules") continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectPackageInputs(
        packageRoot,
        packageName,
        absolutePath,
        inputs,
      );
      continue;
    }
    if (!entry.isFile()) continue;
    if (inputs.length >= MAX_INSTALLED_PACKAGE_INPUTS) {
      throw new TypeError(
        `${packageName} exceeds the ${MAX_INSTALLED_PACKAGE_INPUTS}-file fingerprint input limit.`,
      );
    }
    inputs.push({
      label: `installed/${packageName}/${path.relative(packageRoot, absolutePath).replaceAll(path.sep, "/")}`,
      absolutePath,
    });
  }
  return inputs;
}

async function commonInputs(
  projectRoot: string,
  packages: readonly (InstalledPackage & { readonly name: string })[],
): Promise<readonly InputPath[]> {
  const lockfile = await findAncestorFile(projectRoot, "pnpm-lock.yaml");
  const metroConfig = await firstExisting([
    path.join(projectRoot, "metro.config.js"),
    path.join(projectRoot, "metro.config.cjs"),
    path.join(projectRoot, "metro.config.mjs"),
  ]);
  if (metroConfig !== undefined) {
    const metroSource = await readFile(metroConfig, "utf8");
    if (
      !metroSource.includes("solidNativeTransformWorkerPath") ||
      !metroSource.includes("createSolidNativeMetroResolver")
    ) {
      throw new TypeError(
        `${projectLabel(projectRoot, metroConfig)} does not install the Solid OXC worker and resolver.`,
      );
    }
  }
  const bootstrap = await findMatchingFile(
    projectRoot,
    new Set([
      "index.js",
      "index.mjs",
      "index.ts",
      "index.tsx",
      "main.js",
      "main.mjs",
      "main.ts",
      "main.tsx",
    ]),
    (source) =>
      source.includes("@solid-native/runtime") &&
      (source.includes("startNativeApplication") ||
        (source.includes("createNativeFabricHost") &&
          source.includes("startApplication"))),
  );
  const projectInputs = [
    {
      label: "package.json",
      absolutePath: path.join(projectRoot, "package.json"),
    },
    requireInput("pnpm-lock.yaml", lockfile),
    requireInput(
      "a Metro configuration with the Solid OXC worker and resolver",
      metroConfig,
    ),
    requireInput("a Solid Native JavaScript bootstrap", bootstrap),
  ].map((input) => ({
    label:
      input.label === "pnpm-lock.yaml" || input.label === "package.json"
        ? input.label
        : projectLabel(projectRoot, input.absolutePath),
    absolutePath: input.absolutePath,
  }));
  const packageInputs = await Promise.all(
    packages.map((installed) =>
      collectPackageInputs(installed.root, installed.name),
    ),
  );
  return [...projectInputs, ...packageInputs.flat()];
}

async function androidInputs(
  projectRoot: string,
): Promise<readonly InputPath[]> {
  const android = path.join(projectRoot, "android");
  const applicationSource = path.join(android, "app", "src", "main");
  const mainApplication = await findMatchingFile(
    applicationSource,
    new Set(["MainApplication.java", "MainApplication.kt"]),
    (source) => source.includes("SolidNativeBindingsInstaller"),
  );
  const mainActivity = await findMatchingFile(
    applicationSource,
    new Set(["MainActivity.java", "MainActivity.kt"]),
    (source) => source.includes("SolidNativeSurface"),
  );
  const paths = [
    await firstExisting([
      path.join(android, "settings.gradle"),
      path.join(android, "settings.gradle.kts"),
    ]),
    await firstExisting([
      path.join(android, "build.gradle"),
      path.join(android, "build.gradle.kts"),
    ]),
    path.join(android, "gradle.properties"),
    path.join(android, "gradle", "wrapper", "gradle-wrapper.properties"),
    await firstExisting([
      path.join(android, "app", "build.gradle"),
      path.join(android, "app", "build.gradle.kts"),
    ]),
    path.join(android, "app", "proguard-rules.pro"),
    path.join(applicationSource, "AndroidManifest.xml"),
    path.join(applicationSource, "jni", "CMakeLists.txt"),
    path.join(applicationSource, "jni", "OnLoad.cpp"),
    mainApplication,
    mainActivity,
  ];
  const labels = [
    "Android settings",
    "Android root build file",
    "android/gradle.properties",
    "the Gradle wrapper properties",
    "the Android application build file",
    "android/app/proguard-rules.pro",
    "the Android application manifest",
    "the Solid Native CMake entrypoint",
    "the Solid Native JNI entrypoint",
    "the Solid Native MainApplication",
    "the Solid Native MainActivity",
  ];
  return paths.map((candidate, index) => {
    const input = requireInput(labels[index]!, candidate);
    return {
      label: projectLabel(projectRoot, input.absolutePath),
      absolutePath: input.absolutePath,
    };
  });
}

async function iosInputs(projectRoot: string): Promise<readonly InputPath[]> {
  const ios = path.join(projectRoot, "ios");
  const appDelegate = await findMatchingFile(
    ios,
    new Set(["AppDelegate.m", "AppDelegate.mm", "AppDelegate.swift"]),
    (source) => source.includes("SolidNativeFabricApplication"),
  );
  const infoPlist = await findMatchingFile(ios, new Set(["Info.plist"]));
  const projectFile = await findMatchingFile(ios, new Set(["project.pbxproj"]));
  const privacyManifest = await findMatchingFile(
    ios,
    new Set(["PrivacyInfo.xcprivacy"]),
  );
  const paths = [
    path.join(ios, "Podfile"),
    path.join(ios, "Podfile.lock"),
    projectFile,
    appDelegate,
    infoPlist,
    privacyManifest,
  ];
  const labels = [
    "ios/Podfile",
    "ios/Podfile.lock",
    "the iOS Xcode project",
    "the Solid Native AppDelegate",
    "the iOS Info.plist",
    "the iOS privacy manifest",
  ];
  return paths.map((candidate, index) => {
    const input = requireInput(labels[index]!, candidate);
    return {
      label: projectLabel(projectRoot, input.absolutePath),
      absolutePath: input.absolutePath,
    };
  });
}

async function digestInputs(
  inputs: readonly InputPath[],
): Promise<readonly NativeFingerprintInput[]> {
  const unique = new Map(inputs.map((input) => [input.label, input]));
  const sorted = [...unique.values()].sort((left, right) =>
    compareNames(left.label, right.label),
  );
  return Promise.all(
    sorted.map(async (input) => {
      let metadata;
      try {
        metadata = await stat(input.absolutePath);
      } catch {
        throw new TypeError(
          `Cannot fingerprint the application because ${input.label} is missing or unreadable.`,
        );
      }
      if (!metadata.isFile()) {
        throw new TypeError(`${input.label} is not a regular file.`);
      }
      if (metadata.size > MAX_FINGERPRINT_INPUT_BYTES) {
        throw new TypeError(
          `${input.label} exceeds the ${MAX_FINGERPRINT_INPUT_BYTES}-byte fingerprint input limit.`,
        );
      }
      const content = await readFile(input.absolutePath);
      return {
        path: input.label,
        sha256: createHash("sha256").update(content).digest("hex"),
      };
    }),
  );
}

function digestValue(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export async function createNativeFingerprint(
  options: NativeFingerprintOptions = {},
): Promise<NativeFingerprintReport> {
  const projectRoot = await findProjectRoot(options.cwd ?? process.cwd());
  const manifestPath = path.join(projectRoot, "package.json");
  const manifest = parseManifest(
    await readFile(manifestPath, "utf8"),
    manifestPath,
  );
  if (manifest.name === undefined || manifest.name.trim().length === 0) {
    throw new TypeError(
      "package.json must declare a non-empty application name.",
    );
  }
  requireDeclaration(manifest, "react-native", VERIFIED_REACT_NATIVE_VERSION);
  requireDeclaration(manifest, "solid-js", VERIFIED_SOLID_VERSION);
  requireDeclaration(
    manifest,
    "hermes-compiler",
    VERIFIED_HERMES_COMPILER_VERSION,
  );
  requireDeclaration(
    manifest,
    "@react-native/codegen",
    VERIFIED_REACT_NATIVE_VERSION,
  );
  requireDeclaration(
    manifest,
    "@react-native/gradle-plugin",
    VERIFIED_REACT_NATIVE_VERSION,
  );
  const coreDeclaration = requireDeclaration(manifest, "@solid-native/core");
  const fabricHostDeclaration = requireDeclaration(
    manifest,
    "@solid-native/fabric-host",
  );
  const runtimeDeclaration = requireDeclaration(
    manifest,
    "@solid-native/runtime",
  );
  const metroDeclaration = requireDeclaration(manifest, "@solid-native/metro");

  const [corePackage, fabricHostPackage, runtimePackage, metroPackage] =
    await Promise.all([
      installedPackage(projectRoot, "@solid-native/core", coreDeclaration),
      installedPackage(
        projectRoot,
        "@solid-native/fabric-host",
        fabricHostDeclaration,
      ),
      installedPackage(
        projectRoot,
        "@solid-native/runtime",
        runtimeDeclaration,
      ),
      installedPackage(projectRoot, "@solid-native/metro", metroDeclaration),
    ]);
  const compilerPackage = await resolvedDependencyPackage(
    metroPackage,
    "@solid-native/compiler",
  );
  if (
    corePackage.version !== fabricHostPackage.version ||
    corePackage.version !== runtimePackage.version
  ) {
    throw new TypeError(
      `Installed @solid-native/core ${corePackage.version}, @solid-native/fabric-host ${fabricHostPackage.version}, and @solid-native/runtime ${runtimePackage.version} do not match.`,
    );
  }
  const runtime = {
    reactNative: VERIFIED_REACT_NATIVE_VERSION,
    hermesCompiler: VERIFIED_HERMES_COMPILER_VERSION,
    solid: VERIFIED_SOLID_VERSION,
    solidNativeCore: corePackage.version,
    solidNativeFabricHost: fabricHostPackage.version,
    solidNativeRuntime: runtimePackage.version,
    solidNativeMetro: metroPackage.version,
    solidNativeCompiler: compilerPackage.version,
  };
  const common = await commonInputs(projectRoot, [
    { ...corePackage, name: "@solid-native/core" },
    { ...fabricHostPackage, name: "@solid-native/fabric-host" },
    { ...runtimePackage, name: "@solid-native/runtime" },
    { ...metroPackage, name: "@solid-native/metro" },
    { ...compilerPackage, name: "@solid-native/compiler" },
  ]);
  const requested = options.platform ?? "all";
  const platforms: readonly Exclude<NativeFingerprintPlatform, "all">[] =
    requested === "all" ? ["ios", "android"] : [requested];
  const targets: NativeTargetFingerprint[] = [];
  for (const platform of platforms) {
    const inputs = await digestInputs([
      ...common,
      ...(platform === "ios"
        ? await iosInputs(projectRoot)
        : await androidInputs(projectRoot)),
    ]);
    targets.push({
      platform,
      inputs,
      fingerprint: digestValue({
        schemaVersion: 0,
        projectName: manifest.name,
        platform,
        runtime,
        inputs,
      }),
    });
  }
  return {
    schemaVersion: 0,
    algorithm: "sha256",
    projectRoot,
    projectName: manifest.name,
    runtime,
    targets,
  };
}

export function formatNativeFingerprint(
  report: NativeFingerprintReport,
): string {
  return [
    `Solid Native compatibility fingerprint for ${report.projectName}`,
    `Project: ${report.projectRoot}`,
    ...report.targets.map(
      (target) =>
        `${target.platform}: ${target.fingerprint} (${target.inputs.length} inputs)`,
    ),
    "",
    "Unsigned local identity: sign it as delivery metadata before trusting it at runtime.",
  ].join("\n");
}
