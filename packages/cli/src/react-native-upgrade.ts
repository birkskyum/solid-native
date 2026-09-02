import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { REACT_NATIVE_0_87_RELEASE } from "@solid-native/react-native-compat";

export type NativeReactNativeUpgradeCheckStatus = "pass" | "warn" | "fail";

export interface NativeReactNativeUpgradeCheck {
  readonly id: string;
  readonly label: string;
  readonly status: NativeReactNativeUpgradeCheckStatus;
  readonly message: string;
  readonly remediation?: string;
}

export interface NativeReactNativeUpgradeIdentity {
  readonly projectRoot: string;
  readonly packageVersion: string;
  readonly runtimeVersion: string;
  readonly hermesCompilerVersion: string;
  readonly hermesBytecodeVersion: number;
  readonly reactVersion: string;
  readonly reactPeerRange: string;
  readonly codegenVersion: string;
  readonly gradlePluginVersion: string;
  readonly metroTransformWorkerVersion?: string;
  readonly lockfilePath: string;
  readonly lockfileSha256: string;
}

export type NativeReactNativeHeaderDeltaStatus =
  | "changed"
  | "unchanged"
  | "moved"
  | "added"
  | "external"
  | "missing"
  | "ambiguous";

export interface NativeReactNativeHeaderDelta {
  readonly header: string;
  readonly status: NativeReactNativeHeaderDeltaStatus;
  readonly sourcePaths: readonly string[];
  readonly candidatePaths: readonly string[];
}

export interface NativeReactNativeBoundaryAudit {
  readonly manifestPath: string;
  readonly reactNativeVersion: string;
  readonly nativeHeaderCount: number;
  readonly generatedCodegenHeaderCount: number;
  readonly androidImportCount: number;
  readonly cocoapodCount: number;
  readonly headerDeltas: readonly NativeReactNativeHeaderDelta[];
  readonly addedHeaders: readonly string[];
  readonly removedHeaders: readonly string[];
  readonly changedHeaders: readonly string[];
  readonly unchangedHeaders: readonly string[];
  readonly movedHeaders: readonly string[];
  readonly externalHeaders: readonly string[];
  readonly missingHeaders: readonly string[];
  readonly ambiguousHeaders: readonly string[];
}

export interface NativeReactNativeQualificationGate {
  readonly id: string;
  readonly scope: "repository" | "android" | "ios" | "cross-platform";
  readonly description: string;
  readonly commands: readonly string[];
}

export interface NativeReactNativeUpgradeReport {
  readonly schemaVersion: 0;
  readonly operation: "upgrade-react-native";
  readonly ok: boolean;
  /** True only for the release line already in the device-verified matrix. */
  readonly candidateSupported: boolean;
  /** An audit cannot promote a backend; every listed qualification gate remains. */
  readonly promotionReady: false;
  readonly source?: NativeReactNativeUpgradeIdentity;
  readonly candidate?: NativeReactNativeUpgradeIdentity;
  readonly boundary?: NativeReactNativeBoundaryAudit;
  readonly checks: readonly NativeReactNativeUpgradeCheck[];
  readonly summary: Readonly<{ pass: number; warn: number; fail: number }>;
  readonly qualificationGates: readonly NativeReactNativeQualificationGate[];
}

interface UpgradeManifest {
  readonly name?: string;
  readonly version?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly exports?: Readonly<Record<string, unknown>>;
}

interface BoundaryManifest {
  readonly schemaVersion: 1;
  readonly reactNativeVersion: string;
  readonly nativeHeaders: readonly string[];
  readonly generatedCodegenHeaders: readonly string[];
  readonly androidImports: readonly string[];
  readonly cocoapods: readonly unknown[];
  readonly androidCmake: Readonly<{
    reactNativeIncludeDirectories: readonly string[];
    inheritedCompileOptions: readonly string[];
  }>;
}

interface InstalledManifest {
  readonly manifestPath: string;
  readonly packageRoot: string;
  readonly manifest: UpgradeManifest;
}

interface CompilerResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface NativeReactNativeUpgradeDependencies {
  readonly hostPlatform: NodeJS.Platform;
  readonly pathExists: (target: string) => Promise<boolean>;
  readonly readTextFile: (target: string) => Promise<string>;
  readonly runCompiler: (
    compilerPath: string,
    cwd: string,
  ) => Promise<CompilerResult>;
}

export interface NativeReactNativeUpgradeOptions {
  readonly cwd?: string;
  readonly candidate: string;
  readonly dependencies?: Partial<NativeReactNativeUpgradeDependencies>;
}

interface InspectedProject {
  readonly root: string;
  readonly manifest: UpgradeManifest;
  readonly reactNative: InstalledManifest;
  readonly identity?: NativeReactNativeUpgradeIdentity;
}

const EXACT_VERSION =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const MAX_COMPILER_OUTPUT = 64 * 1024;
const COMPILER_TIMEOUT_MS = 8_000;
const EXTERNAL_NATIVE_HEADER_PREFIXES = Object.freeze(["fbjni/", "folly/"]);

const QUALIFICATION_GATES = Object.freeze([
  {
    id: "repository",
    scope: "repository",
    description:
      "Rebuild the complete workspace, package artifacts, type checks, tests, and architecture/boundary verifiers from the candidate lockfile.",
    commands: ["pnpm ci:verify"],
  },
  {
    id: "android-release",
    scope: "android",
    description:
      "Compile and link a clean Android Release, then inspect the packaged Hermes bundle before launch.",
    commands: [
      "pnpm --filter @solid-native/native-e2e android:assemble",
      "pnpm --filter @solid-native/native-e2e bundle:verify:android",
    ],
  },
  {
    id: "ios-release",
    scope: "ios",
    description:
      "Regenerate CocoaPods and complete a signed, non-simulator iOS Release build.",
    commands: [
      "pnpm --filter @solid-native/native-e2e ios:pods",
      "pnpm --filter @solid-native/native-e2e ios:release",
    ],
  },
  {
    id: "ordinary-device-launches",
    scope: "cross-platform",
    description:
      "Cold-launch ordinary Release applications on physical Android and iOS devices and prove mount, measure, event delivery, quiescence, and teardown.",
    commands: [
      "pnpm --filter @solid-native/native-e2e android:launch:test",
      "pnpm --filter @solid-native/native-e2e ios:test",
    ],
  },
  {
    id: "navigation-restoration",
    scope: "cross-platform",
    description:
      "Rerun native stack, modal/sheet, tab, cold-link, and process-restoration proofs on both platforms.",
    commands: [
      "pnpm --filter @solid-native/native-e2e android:navigation:restoration:test",
      "pnpm --filter @solid-native/native-e2e android:navigation:modal-stack:test",
      "pnpm --filter @solid-native/native-e2e android:tabs:test",
      "pnpm --filter @solid-native/native-e2e ios:navigation:restoration:test",
      "pnpm --filter @solid-native/native-e2e ios:navigation:modal:test",
      "pnpm --filter @solid-native/native-e2e ios:navigation:sheet:test",
      "pnpm --filter @solid-native/native-e2e ios:tabs:test",
    ],
  },
  {
    id: "native-capabilities",
    scope: "cross-platform",
    description:
      "Exercise representative TurboModules, generated components, native resources, lifecycle, reload, cancellation, and memory-pressure behavior.",
    commands: [],
  },
  {
    id: "performance-and-memory",
    scope: "cross-platform",
    description:
      "Collect new matched performance, sustained telemetry, thermal, and memory evidence; do not inherit measurements from the prior backend.",
    commands: ["pnpm benchmark"],
  },
] as const satisfies readonly NativeReactNativeQualificationGate[]);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

function parseManifest(source: string, label: string): UpgradeManifest {
  const value: unknown = JSON.parse(source);
  if (!isRecord(value)) throw new TypeError(`${label} must contain an object.`);
  const dependencies = stringRecord(value.dependencies);
  const devDependencies = stringRecord(value.devDependencies);
  const peerDependencies = stringRecord(value.peerDependencies);
  return {
    ...(typeof value.name === "string" ? { name: value.name } : {}),
    ...(typeof value.version === "string" ? { version: value.version } : {}),
    ...(dependencies === undefined ? {} : { dependencies }),
    ...(devDependencies === undefined ? {} : { devDependencies }),
    ...(peerDependencies === undefined ? {} : { peerDependencies }),
    ...(isRecord(value.exports) ? { exports: value.exports } : {}),
  };
}

function declaredVersion(
  manifest: UpgradeManifest,
  packageName: string,
): string | undefined {
  return (
    manifest.dependencies?.[packageName] ??
    manifest.devDependencies?.[packageName] ??
    manifest.peerDependencies?.[packageName]
  );
}

async function defaultPathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function defaultRunCompiler(
  compilerPath: string,
  cwd: string,
): Promise<CompilerResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(compilerPath, ["-version"], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const append = (current: string, chunk: Buffer): string =>
      `${current}${chunk.toString("utf8")}`.slice(-MAX_COMPILER_OUTPUT);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    const finish = (result: CompilerResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({ exitCode: null, stdout, stderr: `${stderr}\nTimed out.` });
    }, COMPILER_TIMEOUT_MS);
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish({
        exitCode: null,
        stdout,
        stderr: `${stderr}\n${error.message}`,
      });
    });
    child.on("close", (exitCode) => finish({ exitCode, stdout, stderr }));
  });
}

function dependencies(
  overrides: NativeReactNativeUpgradeOptions["dependencies"],
): NativeReactNativeUpgradeDependencies {
  return {
    hostPlatform: overrides?.hostPlatform ?? process.platform,
    pathExists: overrides?.pathExists ?? defaultPathExists,
    readTextFile:
      overrides?.readTextFile ?? ((target) => readFile(target, "utf8")),
    runCompiler: overrides?.runCompiler ?? defaultRunCompiler,
  };
}

async function findProjectRoot(
  start: string,
  pathExists: NativeReactNativeUpgradeDependencies["pathExists"],
): Promise<string> {
  let current = path.resolve(start);
  while (true) {
    if (await pathExists(path.join(current, "package.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) {
      throw new TypeError(`No package.json was found at or above ${start}.`);
    }
    current = parent;
  }
}

async function findAncestorFile(
  start: string,
  name: string,
  pathExists: NativeReactNativeUpgradeDependencies["pathExists"],
): Promise<string | undefined> {
  let current = path.resolve(start);
  while (true) {
    const candidate = path.join(current, name);
    if (await pathExists(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

async function findInstalledManifest(
  projectRoot: string,
  packageName: string,
  deps: NativeReactNativeUpgradeDependencies,
): Promise<InstalledManifest | undefined> {
  let current = projectRoot;
  while (true) {
    const manifestPath = path.join(
      current,
      "node_modules",
      packageName,
      "package.json",
    );
    if (await deps.pathExists(manifestPath)) {
      return {
        manifestPath,
        packageRoot: path.dirname(manifestPath),
        manifest: parseManifest(
          await deps.readTextFile(manifestPath),
          `${packageName}/package.json`,
        ),
      };
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function exactVersion(
  value: string | undefined,
  packageName: string,
  projectLabel: string,
  checks: NativeReactNativeUpgradeCheck[],
): value is string {
  if (value !== undefined && EXACT_VERSION.test(value)) return true;
  checks.push({
    id: `${projectLabel}.${packageName}.declaration`,
    label: `${projectLabel} ${packageName}`,
    status: "fail",
    message:
      value === undefined
        ? `${packageName} is not declared.`
        : `${packageName} is declared as ${value}, not an exact release.`,
    remediation: `Pin ${packageName} to one exact installed release for a reproducible backend audit.`,
  });
  return false;
}

function normalizedPackageVersion(value: string): string | undefined {
  return /^(\d+)\.(\d+)\.(\d+)/u.exec(value)?.slice(1, 4).join(".");
}

function parseRuntimeVersion(source: string): string | undefined {
  const major = /#define\s+REACT_NATIVE_VERSION_MAJOR\s+(\d+)/u.exec(
    source,
  )?.[1];
  const minor = /#define\s+REACT_NATIVE_VERSION_MINOR\s+(\d+)/u.exec(
    source,
  )?.[1];
  const patch = /#define\s+REACT_NATIVE_VERSION_PATCH\s+(\d+)/u.exec(
    source,
  )?.[1];
  return major === undefined || minor === undefined || patch === undefined
    ? undefined
    : `${major}.${minor}.${patch}`;
}

function hermesCompilerPath(
  compilerRoot: string,
  hostPlatform: NodeJS.Platform,
): string | undefined {
  const relative =
    hostPlatform === "darwin"
      ? ["hermesc", "osx-bin", "hermesc"]
      : hostPlatform === "linux"
        ? ["hermesc", "linux64-bin", "hermesc"]
        : hostPlatform === "win32"
          ? ["hermesc", "win64-bin", "hermesc.exe"]
          : undefined;
  return relative === undefined
    ? undefined
    : path.join(compilerRoot, ...relative);
}

function simpleSemverParts(value: string): readonly number[] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(value);
  if (match === null) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareParts(
  left: readonly number[],
  right: readonly number[],
): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function satisfiesSimplePeer(
  version: string,
  range: string,
): boolean | undefined {
  const observed = simpleSemverParts(version);
  if (observed === undefined) return undefined;
  if (EXACT_VERSION.test(range)) {
    const required = simpleSemverParts(range);
    return required === undefined
      ? undefined
      : compareParts(observed, required) === 0;
  }
  const caret = /^\^(\d+)\.(\d+)\.(\d+)$/u.exec(range);
  if (caret === null) return undefined;
  const required = [Number(caret[1]), Number(caret[2]), Number(caret[3])];
  if (compareParts(observed, required) < 0) return false;
  if ((required[0] ?? 0) > 0) return observed[0] === required[0];
  if ((required[1] ?? 0) > 0) {
    return observed[0] === 0 && observed[1] === required[1];
  }
  return observed[0] === 0 && observed[1] === 0 && observed[2] === required[2];
}

async function inspectProject(
  start: string,
  projectLabel: "source" | "candidate",
  deps: NativeReactNativeUpgradeDependencies,
  checks: NativeReactNativeUpgradeCheck[],
): Promise<InspectedProject | undefined> {
  const root = await findProjectRoot(start, deps.pathExists);
  const manifest = parseManifest(
    await deps.readTextFile(path.join(root, "package.json")),
    `${projectLabel} package.json`,
  );
  const declaredReactNative = declaredVersion(manifest, "react-native");
  const hasExactReactNative = exactVersion(
    declaredReactNative,
    "react-native",
    projectLabel,
    checks,
  );
  const reactNative = await findInstalledManifest(root, "react-native", deps);
  if (reactNative === undefined) {
    checks.push({
      id: `${projectLabel}.react-native.installation`,
      label: `${projectLabel} React Native installation`,
      status: "fail",
      message: "react-native is not installed for this project.",
      remediation:
        "Install the candidate lockfile before running the upgrade audit.",
    });
    return undefined;
  }
  const packageVersion = reactNative.manifest.version;
  if (
    !hasExactReactNative ||
    packageVersion === undefined ||
    packageVersion !== declaredReactNative
  ) {
    checks.push({
      id: `${projectLabel}.react-native.identity`,
      label: `${projectLabel} React Native identity`,
      status: "fail",
      message: `The application declares ${String(declaredReactNative)} and resolves ${String(packageVersion)}.`,
      remediation:
        "Reinstall from the candidate lockfile and require an exact declaration/install match.",
    });
    return { root, manifest, reactNative };
  }

  checks.push({
    id: `${projectLabel}.react-native.identity`,
    label: `${projectLabel} React Native identity`,
    status: "pass",
    message: `The exact ${packageVersion} package is declared and installed.`,
  });

  const runtimeHeader = path.join(
    reactNative.packageRoot,
    "ReactCommon",
    "cxxreact",
    "ReactNativeVersion.h",
  );
  let runtimeVersion: string | undefined;
  try {
    runtimeVersion = parseRuntimeVersion(
      await deps.readTextFile(runtimeHeader),
    );
  } catch {
    runtimeVersion = undefined;
  }
  const normalized = normalizedPackageVersion(packageVersion);
  if (runtimeVersion === undefined || normalized !== runtimeVersion) {
    checks.push({
      id: `${projectLabel}.react-native.runtime`,
      label: `${projectLabel} native runtime identity`,
      status: "fail",
      message:
        runtimeVersion === undefined
          ? "ReactNativeVersion.h is missing or unreadable."
          : `Package ${packageVersion} normalizes to ${String(normalized)}, but native headers expose ${runtimeVersion}.`,
      remediation:
        "Keep npm release and normalized native runtime identities separate and verify their intended pairing.",
    });
  } else {
    checks.push({
      id: `${projectLabel}.react-native.runtime`,
      label: `${projectLabel} native runtime identity`,
      status: "pass",
      message: `Package ${packageVersion} maps explicitly to native runtime ${runtimeVersion}.`,
    });
  }

  const requiredHermes = reactNative.manifest.dependencies?.["hermes-compiler"];
  const declaredHermes = declaredVersion(manifest, "hermes-compiler");
  const compiler = await findInstalledManifest(root, "hermes-compiler", deps);
  const installedHermes = compiler?.manifest.version;
  let bytecodeVersion: number | undefined;
  if (
    requiredHermes === undefined ||
    !EXACT_VERSION.test(requiredHermes) ||
    declaredHermes !== requiredHermes ||
    installedHermes !== requiredHermes ||
    compiler === undefined
  ) {
    checks.push({
      id: `${projectLabel}.hermes.pair`,
      label: `${projectLabel} Hermes pair`,
      status: "fail",
      message: `React Native requires ${String(requiredHermes)}, the app declares ${String(declaredHermes)}, and ${String(installedHermes)} is installed.`,
      remediation:
        "Directly pin the exact hermes-compiler dependency declared by the installed react-native package.",
    });
  } else {
    const compilerPath = hermesCompilerPath(
      compiler.packageRoot,
      deps.hostPlatform,
    );
    if (compilerPath === undefined || !(await deps.pathExists(compilerPath))) {
      checks.push({
        id: `${projectLabel}.hermes.pair`,
        label: `${projectLabel} Hermes pair`,
        status: "fail",
        message: `hermes-compiler ${installedHermes} does not provide a compiler for ${deps.hostPlatform}.`,
        remediation:
          "Install the complete compiler artifact on a supported host.",
      });
    } else {
      const result = await deps.runCompiler(compilerPath, root);
      const output = `${result.stdout}\n${result.stderr}`;
      const release = /Hermes release version:\s*([^\s]+)/u.exec(output)?.[1];
      const bytecode = /HBC bytecode version:\s*(\d+)/u.exec(output)?.[1];
      bytecodeVersion = bytecode === undefined ? undefined : Number(bytecode);
      if (
        result.exitCode !== 0 ||
        release !== installedHermes ||
        !Number.isSafeInteger(bytecodeVersion)
      ) {
        checks.push({
          id: `${projectLabel}.hermes.pair`,
          label: `${projectLabel} Hermes pair`,
          status: "fail",
          message: `hermesc reports release ${String(release)} and HBC ${String(bytecodeVersion)} for package ${installedHermes}.`,
          remediation:
            "Repair the compiler installation before any native build; successful compilation cannot prove bundle/runtime compatibility.",
        });
      } else {
        checks.push({
          id: `${projectLabel}.hermes.pair`,
          label: `${projectLabel} Hermes pair`,
          status: "pass",
          message: `React Native, hermes-compiler ${installedHermes}, and hermesc HBC ${String(bytecodeVersion)} form one exact pair.`,
        });
      }
    }
  }

  const declaredReact = declaredVersion(manifest, "react");
  const installedReactManifest = await findInstalledManifest(
    root,
    "react",
    deps,
  );
  const installedReact = installedReactManifest?.manifest.version;
  const reactPeerRange = reactNative.manifest.peerDependencies?.react;
  const peerSatisfied =
    installedReact === undefined || reactPeerRange === undefined
      ? false
      : satisfiesSimplePeer(installedReact, reactPeerRange);
  if (
    declaredReact === undefined ||
    !EXACT_VERSION.test(declaredReact) ||
    installedReact !== declaredReact ||
    reactPeerRange === undefined ||
    peerSatisfied === false
  ) {
    checks.push({
      id: `${projectLabel}.react.pair`,
      label: `${projectLabel} React peer`,
      status: "fail",
      message: `React Native requests ${String(reactPeerRange)}; the app declares ${String(declaredReact)} and resolves ${String(installedReact)}.`,
      remediation:
        "Pin one exact React release that satisfies the installed React Native peer range.",
    });
  } else {
    checks.push({
      id: `${projectLabel}.react.pair`,
      label: `${projectLabel} React peer`,
      status: peerSatisfied === undefined ? "warn" : "pass",
      message:
        peerSatisfied === undefined
          ? `React ${installedReact} is exact, but the audit cannot interpret peer range ${reactPeerRange}; review it explicitly.`
          : `React ${installedReact} satisfies the React Native ${reactPeerRange} peer contract.`,
    });
  }

  const companionVersions: Record<string, string> = {};
  for (const packageName of [
    "@react-native/codegen",
    "@react-native/gradle-plugin",
  ] as const) {
    const required = reactNative.manifest.dependencies?.[packageName];
    const declared = declaredVersion(manifest, packageName);
    const installed = await findInstalledManifest(root, packageName, deps);
    const installedVersion = installed?.manifest.version;
    if (
      required === undefined ||
      !EXACT_VERSION.test(required) ||
      declared !== required ||
      installedVersion !== required
    ) {
      checks.push({
        id: `${projectLabel}.${packageName}.pair`,
        label: `${projectLabel} ${packageName} pair`,
        status: "fail",
        message: `React Native requires ${String(required)}, the app declares ${String(declared)}, and ${String(installedVersion)} is installed.`,
        remediation: `Pin the exact ${packageName} release declared by the installed react-native package.`,
      });
    } else {
      companionVersions[packageName] = installedVersion;
      checks.push({
        id: `${projectLabel}.${packageName}.pair`,
        label: `${projectLabel} ${packageName} pair`,
        status: "pass",
        message: `${packageName} is exactly paired at ${installedVersion}.`,
      });
    }
  }

  const lockfilePath = await findAncestorFile(
    root,
    "pnpm-lock.yaml",
    deps.pathExists,
  );
  if (lockfilePath === undefined) {
    checks.push({
      id: `${projectLabel}.lockfile`,
      label: `${projectLabel} lockfile`,
      status: "fail",
      message: "No pnpm-lock.yaml exists at or above the project.",
      remediation:
        "Install and commit one candidate lockfile before comparing native compatibility.",
    });
  }

  const metro = await findInstalledManifest(
    root,
    "metro-transform-worker",
    deps,
  );
  if (
    runtimeVersion === undefined ||
    requiredHermes === undefined ||
    bytecodeVersion === undefined ||
    installedReact === undefined ||
    reactPeerRange === undefined ||
    companionVersions["@react-native/codegen"] === undefined ||
    companionVersions["@react-native/gradle-plugin"] === undefined ||
    lockfilePath === undefined
  ) {
    return { root, manifest, reactNative };
  }
  const lockfileSource = await deps.readTextFile(lockfilePath);
  return {
    root,
    manifest,
    reactNative,
    identity: {
      projectRoot: root,
      packageVersion,
      runtimeVersion,
      hermesCompilerVersion: requiredHermes,
      hermesBytecodeVersion: bytecodeVersion,
      reactVersion: installedReact,
      reactPeerRange,
      codegenVersion: companionVersions["@react-native/codegen"],
      gradlePluginVersion: companionVersions["@react-native/gradle-plugin"],
      ...(metro?.manifest.version === undefined
        ? {}
        : { metroTransformWorkerVersion: metro.manifest.version }),
      lockfilePath,
      lockfileSha256: createHash("sha256").update(lockfileSource).digest("hex"),
    },
  };
}

function parseStringArray(
  value: unknown,
  field: string,
  allowEmpty: boolean,
): readonly string[] {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.some((entry) => typeof entry !== "string" || entry.length === 0)
  ) {
    throw new TypeError(
      `${field} must be ${allowEmpty ? "an" : "a non-empty"} array of strings.`,
    );
  }
  return value as readonly string[];
}

function parseBoundaryManifest(source: string): BoundaryManifest {
  const value: unknown = JSON.parse(source);
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new TypeError("The React Native boundary must use schemaVersion 1.");
  }
  if (typeof value.reactNativeVersion !== "string") {
    throw new TypeError("reactNativeVersion must be a string.");
  }
  if (
    !Array.isArray(value.cocoapods) ||
    value.cocoapods.some(
      (entry) =>
        !isRecord(entry) ||
        typeof entry.name !== "string" ||
        (entry.version !== null && typeof entry.version !== "string"),
    ) ||
    !isRecord(value.androidCmake)
  ) {
    throw new TypeError(
      "cocoapods entries and androidCmake must describe the native build boundary.",
    );
  }
  return {
    schemaVersion: 1,
    reactNativeVersion: value.reactNativeVersion,
    nativeHeaders: parseStringArray(
      value.nativeHeaders,
      "nativeHeaders",
      false,
    ),
    generatedCodegenHeaders: parseStringArray(
      value.generatedCodegenHeaders,
      "generatedCodegenHeaders",
      true,
    ),
    androidImports: parseStringArray(
      value.androidImports,
      "androidImports",
      true,
    ),
    cocoapods: value.cocoapods,
    androidCmake: {
      reactNativeIncludeDirectories: parseStringArray(
        value.androidCmake.reactNativeIncludeDirectories,
        "androidCmake.reactNativeIncludeDirectories",
        false,
      ),
      inheritedCompileOptions: parseStringArray(
        value.androidCmake.inheritedCompileOptions,
        "androidCmake.inheritedCompileOptions",
        true,
      ),
    },
  };
}

async function readBoundary(
  project: InspectedProject,
  deps: NativeReactNativeUpgradeDependencies,
): Promise<{ readonly path: string; readonly manifest: BoundaryManifest }> {
  const fabricHost = await findInstalledManifest(
    project.root,
    "@solid-native/fabric-host",
    deps,
  );
  if (fabricHost === undefined) {
    throw new TypeError("@solid-native/fabric-host is not installed.");
  }
  const target = fabricHost.manifest.exports?.["./react-native-boundary"];
  if (typeof target !== "string" || !target.startsWith("./")) {
    throw new TypeError(
      "@solid-native/fabric-host does not expose ./react-native-boundary.",
    );
  }
  const manifestPath = path.resolve(fabricHost.packageRoot, target);
  const relative = path.relative(fabricHost.packageRoot, manifestPath);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`)
  ) {
    throw new TypeError("The React Native boundary export leaves its package.");
  }
  return {
    path: manifestPath,
    manifest: parseBoundaryManifest(await deps.readTextFile(manifestPath)),
  };
}

async function indexHeaderFiles(
  root: string,
  basenames: ReadonlySet<string>,
): Promise<ReadonlyMap<string, readonly string[]>> {
  const found = new Map<string, string[]>();
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > 24) return;
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") await visit(target, depth + 1);
      } else if (entry.isFile() && basenames.has(entry.name)) {
        const relative = path.relative(root, target).split(path.sep).join("/");
        const list = found.get(entry.name) ?? [];
        list.push(relative);
        found.set(entry.name, list);
      }
    }
  };
  await visit(root, 0);
  return found;
}

function bestHeaderMatches(
  header: string,
  index: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
  const basename = path.posix.basename(header);
  const candidates = index.get(basename) ?? [];
  const exactSuffix = candidates.filter(
    (candidate) => candidate === header || candidate.endsWith(`/${header}`),
  );
  return exactSuffix.length > 0 ? exactSuffix : candidates;
}

async function headerDigest(
  root: string,
  relativePath: string,
  deps: NativeReactNativeUpgradeDependencies,
): Promise<string> {
  return createHash("sha256")
    .update(await deps.readTextFile(path.join(root, relativePath)))
    .digest("hex");
}

async function auditBoundary(
  source: InspectedProject,
  candidate: InspectedProject,
  boundaryPath: string,
  sourceBoundary: BoundaryManifest,
  candidateBoundary: BoundaryManifest,
  deps: NativeReactNativeUpgradeDependencies,
): Promise<NativeReactNativeBoundaryAudit> {
  const addedHeaders = candidateBoundary.nativeHeaders.filter(
    (header) => !sourceBoundary.nativeHeaders.includes(header),
  );
  const removedHeaders = sourceBoundary.nativeHeaders.filter(
    (header) => !candidateBoundary.nativeHeaders.includes(header),
  );
  const basenames = new Set(
    candidateBoundary.nativeHeaders.map((header) =>
      path.posix.basename(header),
    ),
  );
  const [sourceIndex, candidateIndex] = await Promise.all([
    indexHeaderFiles(source.reactNative.packageRoot, basenames),
    indexHeaderFiles(candidate.reactNative.packageRoot, basenames),
  ]);
  const deltas: NativeReactNativeHeaderDelta[] = [];
  for (const header of candidateBoundary.nativeHeaders) {
    const sourcePaths = bestHeaderMatches(header, sourceIndex);
    const candidatePaths = bestHeaderMatches(header, candidateIndex);
    let status: NativeReactNativeHeaderDeltaStatus;
    if (addedHeaders.includes(header) && candidatePaths.length > 0) {
      status = "added";
    } else if (
      sourcePaths.length === 0 &&
      candidatePaths.length === 0 &&
      EXTERNAL_NATIVE_HEADER_PREFIXES.some((prefix) =>
        header.startsWith(prefix),
      )
    ) {
      status = "external";
    } else if (sourcePaths.length === 0 || candidatePaths.length === 0) {
      status = "missing";
    } else if (sourcePaths.length !== 1 || candidatePaths.length !== 1) {
      status = "ambiguous";
    } else {
      const [sourceDigest, candidateDigest] = await Promise.all([
        headerDigest(source.reactNative.packageRoot, sourcePaths[0]!, deps),
        headerDigest(
          candidate.reactNative.packageRoot,
          candidatePaths[0]!,
          deps,
        ),
      ]);
      status =
        sourceDigest !== candidateDigest
          ? "changed"
          : sourcePaths[0] !== candidatePaths[0]
            ? "moved"
            : "unchanged";
    }
    deltas.push({ header, status, sourcePaths, candidatePaths });
  }
  const headers = (
    status: NativeReactNativeHeaderDeltaStatus,
  ): readonly string[] =>
    deltas
      .filter((entry) => entry.status === status)
      .map((entry) => entry.header);
  return {
    manifestPath: boundaryPath,
    reactNativeVersion: candidateBoundary.reactNativeVersion,
    nativeHeaderCount: candidateBoundary.nativeHeaders.length,
    generatedCodegenHeaderCount:
      candidateBoundary.generatedCodegenHeaders.length,
    androidImportCount: candidateBoundary.androidImports.length,
    cocoapodCount: candidateBoundary.cocoapods.length,
    headerDeltas: deltas,
    addedHeaders,
    removedHeaders,
    changedHeaders: headers("changed"),
    unchangedHeaders: headers("unchanged"),
    movedHeaders: headers("moved"),
    externalHeaders: headers("external"),
    missingHeaders: headers("missing"),
    ambiguousHeaders: headers("ambiguous"),
  };
}

function compareIdentity(
  source: NativeReactNativeUpgradeIdentity,
  candidate: NativeReactNativeUpgradeIdentity,
  checks: NativeReactNativeUpgradeCheck[],
): void {
  checks.push(
    candidate.packageVersion === source.packageVersion
      ? {
          id: "upgrade.release-change",
          label: "Backend release change",
          status: "warn",
          message: `Source and candidate both use React Native ${candidate.packageVersion}; this is a consistency audit, not an upgrade.`,
        }
      : {
          id: "upgrade.release-change",
          label: "Backend release change",
          status: "pass",
          message: `The candidate changes React Native ${source.packageVersion} to ${candidate.packageVersion} and records runtime ${candidate.runtimeVersion} separately.`,
        },
  );
  if (
    source.hermesCompilerVersion === candidate.hermesCompilerVersion &&
    source.hermesBytecodeVersion === candidate.hermesBytecodeVersion
  ) {
    checks.push({
      id: "upgrade.hermes-change",
      label: "Hermes upgrade delta",
      status: "pass",
      message: `The candidate retains compiler ${candidate.hermesCompilerVersion} and HBC ${String(candidate.hermesBytecodeVersion)}.`,
    });
  } else {
    checks.push({
      id: "upgrade.hermes-change",
      label: "Hermes upgrade delta",
      status: "warn",
      message: `Hermes changes from ${source.hermesCompilerVersion}/HBC ${String(source.hermesBytecodeVersion)} to ${candidate.hermesCompilerVersion}/HBC ${String(candidate.hermesBytecodeVersion)}; native compilation alone cannot validate this pair.`,
      remediation:
        "Inspect the packaged bytecode and prove cold launch on both physical runtimes.",
    });
  }
}

function isVerifiedBackendIdentity(
  identity: NativeReactNativeUpgradeIdentity | undefined,
): boolean {
  return (
    identity?.packageVersion === REACT_NATIVE_0_87_RELEASE.packageVersion &&
    identity.runtimeVersion === REACT_NATIVE_0_87_RELEASE.runtimeVersion &&
    identity.hermesCompilerVersion ===
      REACT_NATIVE_0_87_RELEASE.hermesCompilerVersion &&
    identity.hermesBytecodeVersion ===
      REACT_NATIVE_0_87_RELEASE.hermesBytecodeVersion
  );
}

/**
 * Audits one already-installed React Native candidate without changing either
 * project. Passing means that the candidate is coherent enough to start the
 * listed qualification work; it never promotes a backend release.
 */
export async function auditNativeReactNativeUpgrade(
  options: NativeReactNativeUpgradeOptions,
): Promise<NativeReactNativeUpgradeReport> {
  const deps = dependencies(options.dependencies);
  const checks: NativeReactNativeUpgradeCheck[] = [];
  const sourceChecks: NativeReactNativeUpgradeCheck[] = [];
  const candidateChecks: NativeReactNativeUpgradeCheck[] = [];
  const [source, candidate] = await Promise.all([
    inspectProject(options.cwd ?? process.cwd(), "source", deps, sourceChecks),
    inspectProject(options.candidate, "candidate", deps, candidateChecks),
  ]);
  checks.push(...sourceChecks, ...candidateChecks);
  let boundary: NativeReactNativeBoundaryAudit | undefined;
  if (source?.identity !== undefined && candidate?.identity !== undefined) {
    checks.push(
      isVerifiedBackendIdentity(source.identity)
        ? {
            id: "source.supported-matrix",
            label: "Verified upgrade baseline",
            status: "pass",
            message: `The source is the device-verified React Native ${REACT_NATIVE_0_87_RELEASE.packageVersion} backend.`,
          }
        : {
            id: "source.supported-matrix",
            label: "Verified upgrade baseline",
            status: "fail",
            message: `The source is React Native ${source.identity.packageVersion} / runtime ${source.identity.runtimeVersion} / Hermes ${source.identity.hermesCompilerVersion} HBC ${String(source.identity.hermesBytecodeVersion)}, not the device-verified baseline.`,
            remediation: `Run the comparison from the verified React Native ${REACT_NATIVE_0_87_RELEASE.packageVersion} backend so the delta has a trusted anchor.`,
          },
    );
    compareIdentity(source.identity, candidate.identity, checks);
    try {
      const [sourceBoundary, candidateBoundary] = await Promise.all([
        readBoundary(source, deps),
        readBoundary(candidate, deps),
      ]);
      if (
        sourceBoundary.manifest.reactNativeVersion !==
        source.identity.packageVersion
      ) {
        checks.push({
          id: "source.fabric-boundary.version",
          label: "Source Fabric boundary version",
          status: "fail",
          message: `The source boundary declares React Native ${sourceBoundary.manifest.reactNativeVersion}, but the source installs ${source.identity.packageVersion}.`,
          remediation:
            "Repair the supported baseline boundary before comparing a candidate.",
        });
      } else {
        checks.push({
          id: "source.fabric-boundary.version",
          label: "Source Fabric boundary version",
          status: "pass",
          message: `The source Fabric boundary is assigned to React Native ${source.identity.packageVersion}.`,
        });
      }
      if (
        candidateBoundary.manifest.reactNativeVersion !==
        candidate.identity.packageVersion
      ) {
        checks.push({
          id: "candidate.fabric-boundary.version",
          label: "Candidate Fabric boundary version",
          status: "fail",
          message: `The boundary declares React Native ${candidateBoundary.manifest.reactNativeVersion}, but the candidate installs ${candidate.identity.packageVersion}.`,
          remediation:
            "Select or draft a version-specific Fabric adapter and regenerate its boundary manifest before compiling the candidate.",
        });
      } else {
        checks.push({
          id: "candidate.fabric-boundary.version",
          label: "Candidate Fabric boundary version",
          status: "pass",
          message: `The Fabric boundary is explicitly assigned to React Native ${candidate.identity.packageVersion}.`,
        });
      }
      boundary = await auditBoundary(
        source,
        candidate,
        candidateBoundary.path,
        sourceBoundary.manifest,
        candidateBoundary.manifest,
        deps,
      );
      if (boundary.missingHeaders.length > 0) {
        checks.push({
          id: "candidate.fabric-boundary.headers",
          label: "Candidate upstream header surface",
          status: "fail",
          message: `${String(boundary.missingHeaders.length)} of ${String(boundary.nativeHeaderCount)} imported upstream headers cannot be found in both release trees: ${boundary.missingHeaders.join(", ")}.`,
          remediation:
            "Update the adapter imports deliberately and regenerate the boundary inventory.",
        });
      } else {
        const changed = boundary.changedHeaders.length;
        const moved = boundary.movedHeaders.length;
        const added = boundary.addedHeaders.length;
        const removed = boundary.removedHeaders.length;
        const external = boundary.externalHeaders.length;
        const ambiguous = boundary.ambiguousHeaders.length;
        checks.push({
          id: "candidate.fabric-boundary.headers",
          label: "Candidate upstream header surface",
          status: ambiguous > 0 ? "warn" : "pass",
          message: `Found all React Native-owned imported headers; the adapter adds ${String(added)} and removes ${String(removed)}, ${String(changed)} retained headers changed upstream, ${String(moved)} moved, ${String(external)} come from external native dependencies, and ${String(ambiguous)} require disambiguation.`,
          ...(ambiguous === 0
            ? {}
            : {
                remediation:
                  "Inspect every ambiguous basename and use native compilation to resolve the actual include target.",
              }),
        });
      }
      checks.push({
        id: "candidate.fabric-boundary.review",
        label: "Fabric API review",
        status: "warn",
        message: `The manifest bounds ${String(boundary.nativeHeaderCount)} native headers, ${String(boundary.androidImportCount)} Android imports, ${String(boundary.cocoapodCount)} pods, and ${String(boundary.generatedCodegenHeaderCount)} generated headers; source presence is not an ABI or behavioral proof.`,
        remediation:
          "Review changed upstream implementations and complete every native and physical-device qualification gate below.",
      });
    } catch (error) {
      checks.push({
        id: "candidate.fabric-boundary",
        label: "Candidate Fabric boundary",
        status: "fail",
        message: error instanceof Error ? error.message : String(error),
        remediation:
          "Install a complete Fabric Host candidate with a valid exported React Native boundary manifest.",
      });
    }
  }

  const candidateSupported = isVerifiedBackendIdentity(candidate?.identity);
  checks.push(
    candidateSupported
      ? {
          id: "candidate.supported-matrix",
          label: "Supported backend matrix",
          status: "pass",
          message: `React Native ${REACT_NATIVE_0_87_RELEASE.packageVersion} is already in the device-verified backend matrix.`,
        }
      : {
          id: "candidate.supported-matrix",
          label: "Supported backend matrix",
          status: "warn",
          message: `The candidate is not the device-verified React Native ${REACT_NATIVE_0_87_RELEASE.packageVersion} backend. This audit does not add support.`,
          remediation:
            "Keep the candidate isolated until every qualification gate is complete and reviewed evidence is recorded.",
        },
  );

  const summary = {
    pass: checks.filter((entry) => entry.status === "pass").length,
    warn: checks.filter((entry) => entry.status === "warn").length,
    fail: checks.filter((entry) => entry.status === "fail").length,
  };
  return {
    schemaVersion: 0,
    operation: "upgrade-react-native",
    ok: summary.fail === 0,
    candidateSupported,
    promotionReady: false,
    ...(source?.identity === undefined ? {} : { source: source.identity }),
    ...(candidate?.identity === undefined
      ? {}
      : { candidate: candidate.identity }),
    ...(boundary === undefined ? {} : { boundary }),
    checks,
    summary,
    qualificationGates: QUALIFICATION_GATES,
  };
}

export function formatNativeReactNativeUpgradeReport(
  report: NativeReactNativeUpgradeReport,
): string {
  const symbols: Record<NativeReactNativeUpgradeCheckStatus, string> = {
    pass: "✓",
    warn: "!",
    fail: "✗",
  };
  const lines = [
    "Solid Native React Native upgrade audit",
    ...(report.source === undefined
      ? []
      : [
          `Source: ${report.source.packageVersion} (${report.source.projectRoot})`,
        ]),
    ...(report.candidate === undefined
      ? []
      : [
          `Candidate: ${report.candidate.packageVersion} / runtime ${report.candidate.runtimeVersion} (${report.candidate.projectRoot})`,
        ]),
    "",
    ...report.checks.flatMap((entry) => [
      `${symbols[entry.status]} ${entry.label}: ${entry.message}`,
      ...(entry.remediation === undefined
        ? []
        : [`  Next: ${entry.remediation}`]),
    ]),
    "",
    "Qualification gates (not executed by this audit):",
    ...report.qualificationGates.map(
      (gate) =>
        `- ${gate.id} [${gate.scope}]: ${gate.description}${gate.commands.length === 0 ? "" : `\n  ${gate.commands.join("\n  ")}`}`,
    ),
    "",
    `${report.ok ? "Audit ready" : "Audit blocked"}: ${String(report.summary.pass)} passed, ${String(report.summary.warn)} warnings, ${String(report.summary.fail)} failed. Backend promotion remains false.`,
  ];
  return lines.join("\n");
}
