import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  access,
  link,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  SOLID_NATIVE_CLI_VERSION,
  VERIFIED_REACT_NATIVE_PACKAGE_VERSION,
  VERIFIED_REACT_NATIVE_SCREENS_VERSION,
} from "./versions.js";

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_BACKEND_CONTRACT_BYTES = 32 * 1024;
const MAX_PATCH_BYTES = 1024 * 1024;
const MAX_INSTALLED_BACKEND_FILE_BYTES = 2 * 1024 * 1024;
const MAX_INSTALLED_BACKEND_FILES = 16;
const PACKAGE_MANAGER = "pnpm@9.15.0";
const NAVIGATION_PACKAGE = "@solid-native/navigation";
const SCREENS_PACKAGE = "react-native-screens";
const NAVIGATION_BACKEND_CONTRACT = `backend/react-native-screens-${VERIFIED_REACT_NATIVE_SCREENS_VERSION}.json`;
const NAVIGATION_PATCH_RELATIVE_PATH = `patches/react-native-screens@${VERIFIED_REACT_NATIVE_SCREENS_VERSION}.patch`;
const NAVIGATION_PATCH_KEY = `${SCREENS_PACKAGE}@${VERIFIED_REACT_NATIVE_SCREENS_VERSION}`;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const EXACT_VERSION_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

export type NativePackageAddCapability = "navigation";

export interface NativePackageAddCommand {
  readonly projectRoot: string;
  readonly command: "pnpm";
  readonly args: readonly string[];
}

export interface NativePackageAddPlan {
  readonly schemaVersion: 0;
  readonly operation: "add";
  readonly capability: NativePackageAddCapability;
  readonly installMode: "add" | "install";
  readonly projectRoot: string;
  readonly packageManager: typeof PACKAGE_MANAGER;
  readonly packages: readonly [
    Readonly<{ name: typeof NAVIGATION_PACKAGE; version: string }>,
    Readonly<{
      name: typeof SCREENS_PACKAGE;
      version: typeof VERIFIED_REACT_NATIVE_SCREENS_VERSION;
    }>,
  ];
  readonly installCommand: NativePackageAddCommand;
  readonly patch: Readonly<{
    packageName: typeof SCREENS_PACKAGE;
    packageVersion: typeof VERIFIED_REACT_NATIVE_SCREENS_VERSION;
    key: string;
    sourcePackage: typeof NAVIGATION_PACKAGE;
    sourceContractPath: string;
    targetPath: string;
  }>;
  readonly finalizeCommand: NativePackageAddCommand;
}

export interface NativePackageAddOptions {
  readonly capability: NativePackageAddCapability;
  readonly cwd?: string;
}

export type NativePackageAddExecutor = (
  command: NativePackageAddCommand,
  context: Readonly<{ env: NodeJS.ProcessEnv }>,
) => Promise<number>;

interface JsonObject {
  [name: string]: unknown;
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function readBoundedText(
  target: string,
  maximumBytes: number,
  label: string,
): Promise<string> {
  const source = await readFile(target);
  if (source.byteLength > maximumBytes) {
    throw new TypeError(
      `${label} exceeds the ${String(maximumBytes)}-byte limit.`,
    );
  }
  return source.toString("utf8");
}

async function readBoundedBytes(
  target: string,
  maximumBytes: number,
  label: string,
): Promise<Buffer> {
  const source = await readFile(target);
  if (source.byteLength > maximumBytes) {
    throw new TypeError(
      `${label} exceeds the ${String(maximumBytes)}-byte limit.`,
    );
  }
  return source;
}

function parseObject(source: string, label: string): JsonObject {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new TypeError(`${label} is not valid JSON: ${message}`);
  }
  if (!isObject(value)) {
    throw new TypeError(`${label} must contain an object.`);
  }
  return value;
}

function stringRecord(value: unknown, label: string): Record<string, string> {
  if (value === undefined) return {};
  if (!isObject(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const result: Record<string, string> = {};
  for (const [name, entry] of Object.entries(value)) {
    if (typeof entry !== "string") {
      throw new TypeError(`${label}.${name} must be a string.`);
    }
    result[name] = entry;
  }
  return result;
}

function declaredDependency(
  manifest: JsonObject,
  packageName: string,
): Readonly<{ section: string; version: string }> | undefined {
  const matches = ["dependencies", "devDependencies", "peerDependencies"]
    .map((section) => ({
      section,
      version: stringRecord(manifest[section], `package.json ${section}`)[
        packageName
      ],
    }))
    .filter(
      (entry): entry is { section: string; version: string } =>
        entry.version !== undefined,
    );
  if (matches.length > 1) {
    throw new TypeError(
      `${packageName} is declared in multiple package.json dependency sections.`,
    );
  }
  return matches[0];
}

function assertDeclaration(
  manifest: JsonObject,
  packageName: string,
  expectedVersion: string,
): void {
  const declaration = declaredDependency(manifest, packageName);
  if (declaration === undefined) return;
  if (
    declaration.section !== "dependencies" ||
    declaration.version !== expectedVersion
  ) {
    throw new TypeError(
      `${packageName} must be an exact application dependency at ${expectedVersion}; found ${declaration.version} in ${declaration.section}.`,
    );
  }
}

async function findProjectRoot(start: string): Promise<string | undefined> {
  let current = await realpath(path.resolve(start));
  while (true) {
    if (await pathExists(path.join(current, "package.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

async function findPackageManager(start: string): Promise<string | undefined> {
  let current = start;
  while (true) {
    const manifestPath = path.join(current, "package.json");
    if (await pathExists(manifestPath)) {
      const manifest = parseObject(
        await readBoundedText(
          manifestPath,
          MAX_MANIFEST_BYTES,
          `${manifestPath}`,
        ),
        manifestPath,
      );
      if (typeof manifest.packageManager === "string") {
        return manifest.packageManager;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function containedPath(root: string, candidate: string, label: string): string {
  const relative = path.relative(root, candidate);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new TypeError(`${label} must stay inside ${root}.`);
  }
  return candidate;
}

async function regularContainedFile(
  root: string,
  candidate: string,
  label: string,
): Promise<string> {
  containedPath(root, candidate, label);
  const status = await lstat(candidate);
  if (status.isSymbolicLink() || !status.isFile()) {
    throw new TypeError(`${label} must be a regular file.`);
  }
  const canonical = await realpath(candidate);
  containedPath(root, canonical, label);
  if (canonical !== candidate) {
    throw new TypeError(
      `${label} must not be redirected through a symbolic link.`,
    );
  }
  return canonical;
}

function sha256(source: string): string {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

function sha256Bytes(source: Uint8Array): string {
  return createHash("sha256").update(source).digest("hex");
}

/** Creates an inspectable exact-package plan without changing the application. */
export async function createNativePackageAddPlan(
  options: NativePackageAddOptions,
): Promise<NativePackageAddPlan> {
  if (options.capability !== "navigation") {
    throw new TypeError(
      `Unsupported Solid Native capability ${String(options.capability)}.`,
    );
  }
  const projectRoot = await findProjectRoot(options.cwd ?? process.cwd());
  if (projectRoot === undefined) {
    throw new TypeError("No package.json was found at or above the target.");
  }
  const manifestPath = path.join(projectRoot, "package.json");
  const manifest = parseObject(
    await readBoundedText(
      manifestPath,
      MAX_MANIFEST_BYTES,
      "Application package.json",
    ),
    "Application package.json",
  );
  const packageManager = await findPackageManager(projectRoot);
  if (packageManager !== PACKAGE_MANAGER) {
    throw new TypeError(
      `solid-native add requires ${PACKAGE_MANAGER}; found ${packageManager ?? "no packageManager declaration"}.`,
    );
  }
  const reactNative = declaredDependency(manifest, "react-native");
  if (
    reactNative?.section !== "dependencies" ||
    reactNative.version !== VERIFIED_REACT_NATIVE_PACKAGE_VERSION
  ) {
    throw new TypeError(
      `solid-native add requires react-native ${VERIFIED_REACT_NATIVE_PACKAGE_VERSION} as an exact application dependency.`,
    );
  }
  const solidNativeVersion = SOLID_NATIVE_CLI_VERSION;
  if (!EXACT_VERSION_PATTERN.test(solidNativeVersion)) {
    throw new TypeError(
      "The Solid Native recipe version must be one exact semantic version.",
    );
  }
  const core = declaredDependency(manifest, "@solid-native/core");
  if (
    core?.section !== "dependencies" ||
    (core.version !== solidNativeVersion &&
      core.version !== `^${solidNativeVersion}`)
  ) {
    throw new TypeError(
      `solid-native add requires @solid-native/core ${solidNativeVersion} (or its compatible caret declaration) in application dependencies.`,
    );
  }
  assertDeclaration(manifest, NAVIGATION_PACKAGE, solidNativeVersion);
  assertDeclaration(
    manifest,
    SCREENS_PACKAGE,
    VERIFIED_REACT_NATIVE_SCREENS_VERSION,
  );
  const installMode =
    declaredDependency(manifest, NAVIGATION_PACKAGE) !== undefined &&
    declaredDependency(manifest, SCREENS_PACKAGE) !== undefined
      ? "install"
      : "add";

  const targetPath = containedPath(
    projectRoot,
    path.resolve(projectRoot, NAVIGATION_PATCH_RELATIVE_PATH),
    "Navigation patch target",
  );
  return {
    schemaVersion: 0,
    operation: "add",
    capability: options.capability,
    installMode,
    projectRoot,
    packageManager: PACKAGE_MANAGER,
    packages: [
      { name: NAVIGATION_PACKAGE, version: solidNativeVersion },
      {
        name: SCREENS_PACKAGE,
        version: VERIFIED_REACT_NATIVE_SCREENS_VERSION,
      },
    ],
    installCommand: {
      projectRoot,
      command: "pnpm",
      args:
        installMode === "add"
          ? [
              "add",
              "--save-exact",
              "--ignore-workspace-root-check",
              `${NAVIGATION_PACKAGE}@${solidNativeVersion}`,
              `${SCREENS_PACKAGE}@${VERIFIED_REACT_NATIVE_SCREENS_VERSION}`,
            ]
          : ["install", "--no-frozen-lockfile"],
    },
    patch: {
      packageName: SCREENS_PACKAGE,
      packageVersion: VERIFIED_REACT_NATIVE_SCREENS_VERSION,
      key: NAVIGATION_PATCH_KEY,
      sourcePackage: NAVIGATION_PACKAGE,
      sourceContractPath: NAVIGATION_BACKEND_CONTRACT,
      targetPath,
    },
    finalizeCommand: {
      projectRoot,
      command: "pnpm",
      args: ["install", "--no-frozen-lockfile"],
    },
  };
}

function parseNavigationContract(source: string): Readonly<{
  patchPath: string;
  patchSha256: string;
  installedFiles: readonly Readonly<{ path: string; sha256: string }>[];
}> {
  const contract = parseObject(source, "Navigation backend contract");
  const patch = contract.patch;
  if (
    contract.schemaVersion !== 1 ||
    contract.packageName !== SCREENS_PACKAGE ||
    contract.packageVersion !== VERIFIED_REACT_NATIVE_SCREENS_VERSION ||
    contract.reactNativeVersion !== VERIFIED_REACT_NATIVE_PACKAGE_VERSION ||
    !isObject(patch) ||
    patch.path !== NAVIGATION_PATCH_RELATIVE_PATH ||
    typeof patch.sha256 !== "string" ||
    !SHA256_PATTERN.test(patch.sha256) ||
    !Array.isArray(contract.installedFiles) ||
    contract.installedFiles.length === 0 ||
    contract.installedFiles.length > MAX_INSTALLED_BACKEND_FILES
  ) {
    throw new TypeError(
      "The installed navigation backend contract does not match the verified Solid Native recipe.",
    );
  }
  const seenPaths = new Set<string>();
  const installedFiles = contract.installedFiles.map((entry, index) => {
    if (
      !isObject(entry) ||
      typeof entry.path !== "string" ||
      entry.path.length === 0 ||
      path.isAbsolute(entry.path) ||
      entry.path.split(/[\\/]/u).includes("..") ||
      typeof entry.sha256 !== "string" ||
      !SHA256_PATTERN.test(entry.sha256) ||
      seenPaths.has(entry.path)
    ) {
      throw new TypeError(
        `Navigation backend installed file ${String(index)} is invalid.`,
      );
    }
    seenPaths.add(entry.path);
    return { path: entry.path, sha256: entry.sha256 };
  });
  return {
    patchPath: patch.path,
    patchSha256: patch.sha256,
    installedFiles,
  };
}

async function installPatchFile(
  projectRoot: string,
  targetPath: string,
  source: string,
  expectedSha256: string,
): Promise<void> {
  if (sha256(source) !== expectedSha256) {
    throw new TypeError(
      "The installed navigation patch does not match its backend contract digest.",
    );
  }
  await mkdir(path.dirname(targetPath), { recursive: true });
  const targetParent = await realpath(path.dirname(targetPath));
  if (targetParent !== path.dirname(targetPath)) {
    throw new TypeError(
      `The application navigation patch directory must not be redirected through a symbolic link: ${path.dirname(targetPath)}.`,
    );
  }
  containedPath(projectRoot, targetParent, "Navigation patch directory");
  if (await pathExists(targetPath)) {
    const targetStatus = await lstat(targetPath);
    if (targetStatus.isSymbolicLink() || !targetStatus.isFile()) {
      throw new TypeError(
        `The application navigation patch target must be a regular file: ${targetPath}.`,
      );
    }
    const existing = await readBoundedText(
      targetPath,
      MAX_PATCH_BYTES,
      "Existing application navigation patch",
    );
    if (sha256(existing) !== expectedSha256) {
      throw new TypeError(
        `Refusing to overwrite the different application-owned patch at ${targetPath}.`,
      );
    }
    return;
  }
  const temporaryPath = `${targetPath}.solid-native-${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, source, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o644,
    });
    await link(temporaryPath, targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "EEXIST") {
      const targetStatus = await lstat(targetPath);
      if (targetStatus.isSymbolicLink() || !targetStatus.isFile()) {
        throw new TypeError(
          `The application navigation patch target must be a regular file: ${targetPath}.`,
        );
      }
      const existing = await readBoundedText(
        targetPath,
        MAX_PATCH_BYTES,
        "Existing application navigation patch",
      );
      if (sha256(existing) === expectedSha256) return;
      throw new TypeError(
        `Refusing to overwrite the different application-owned patch at ${targetPath}.`,
      );
    }
    throw error;
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function updateApplicationManifest(
  plan: NativePackageAddPlan,
): Promise<void> {
  const manifestPath = path.join(plan.projectRoot, "package.json");
  const manifestStatus = await lstat(manifestPath);
  if (manifestStatus.isSymbolicLink() || !manifestStatus.isFile()) {
    throw new TypeError(
      "The application package.json must be a regular file before solid-native add can update it.",
    );
  }
  const original = await readBoundedText(
    manifestPath,
    MAX_MANIFEST_BYTES,
    "Application package.json",
  );
  const manifest = parseObject(original, "Application package.json");
  assertDeclaration(manifest, NAVIGATION_PACKAGE, plan.packages[0].version);
  assertDeclaration(
    manifest,
    SCREENS_PACKAGE,
    VERIFIED_REACT_NATIVE_SCREENS_VERSION,
  );
  const navigation = declaredDependency(manifest, NAVIGATION_PACKAGE);
  const screens = declaredDependency(manifest, SCREENS_PACKAGE);
  if (
    navigation?.section !== "dependencies" ||
    navigation.version !== plan.packages[0].version ||
    screens?.section !== "dependencies" ||
    screens.version !== VERIFIED_REACT_NATIVE_SCREENS_VERSION
  ) {
    throw new TypeError(
      "The package manager did not install the exact navigation recipe dependencies.",
    );
  }
  const pnpm = manifest.pnpm;
  if (pnpm !== undefined && !isObject(pnpm)) {
    throw new TypeError("package.json pnpm must be an object.");
  }
  const patchedDependencies = pnpm?.patchedDependencies;
  const existingPatches = stringRecord(
    patchedDependencies,
    "package.json pnpm.patchedDependencies",
  );
  const existingPatch = existingPatches[plan.patch.key];
  if (
    existingPatch !== undefined &&
    existingPatch !== NAVIGATION_PATCH_RELATIVE_PATH
  ) {
    throw new TypeError(
      `Refusing to replace the existing ${plan.patch.key} patch mapping ${existingPatch}.`,
    );
  }
  manifest.pnpm = {
    ...(pnpm ?? {}),
    patchedDependencies: {
      ...existingPatches,
      [plan.patch.key]: NAVIGATION_PATCH_RELATIVE_PATH,
    },
  };
  const next = `${JSON.stringify(manifest, null, 2)}\n`;
  if (next === original) return;
  const temporaryPath = `${manifestPath}.solid-native-${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, next, {
      encoding: "utf8",
      flag: "wx",
      mode: manifestStatus.mode & 0o777,
    });
    const current = await readFile(manifestPath, "utf8");
    if (current !== original) {
      throw new TypeError(
        "package.json changed while solid-native add was configuring the navigation patch; no manifest update was written.",
      );
    }
    await rename(temporaryPath, manifestPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function installedPackageRoot(
  projectRoot: string,
  packageName: string,
  expectedVersion: string,
): Promise<string> {
  const packageRoot = await realpath(
    path.join(projectRoot, "node_modules", packageName),
  );
  const manifestPath = await regularContainedFile(
    packageRoot,
    path.join(packageRoot, "package.json"),
    `Installed ${packageName} package.json`,
  );
  const manifest = parseObject(
    await readBoundedText(
      manifestPath,
      MAX_MANIFEST_BYTES,
      `Installed ${packageName} package.json`,
    ),
    `Installed ${packageName} package.json`,
  );
  if (manifest.name !== packageName || manifest.version !== expectedVersion) {
    throw new TypeError(
      `The installed ${packageName} identity does not match ${expectedVersion}.`,
    );
  }
  return packageRoot;
}

async function loadNavigationContract(
  navigationPackageRoot: string,
  relativePath: string,
): Promise<ReturnType<typeof parseNavigationContract>> {
  const contractPath = await regularContainedFile(
    navigationPackageRoot,
    path.resolve(navigationPackageRoot, relativePath),
    "Navigation backend contract",
  );
  return parseNavigationContract(
    await readBoundedText(
      contractPath,
      MAX_BACKEND_CONTRACT_BYTES,
      "Navigation backend contract",
    ),
  );
}

async function configureNavigationPatch(
  plan: NativePackageAddPlan,
): Promise<void> {
  await installedPackageRoot(
    plan.projectRoot,
    "@solid-native/core",
    plan.packages[0].version,
  );
  const navigationPackageRoot = await installedPackageRoot(
    plan.projectRoot,
    NAVIGATION_PACKAGE,
    plan.packages[0].version,
  );
  await installedPackageRoot(
    plan.projectRoot,
    SCREENS_PACKAGE,
    VERIFIED_REACT_NATIVE_SCREENS_VERSION,
  );
  const contract = await loadNavigationContract(
    navigationPackageRoot,
    plan.patch.sourceContractPath,
  );
  const patchPath = await regularContainedFile(
    navigationPackageRoot,
    path.resolve(navigationPackageRoot, contract.patchPath),
    "Navigation patch source",
  );
  const patchSource = await readBoundedText(
    patchPath,
    MAX_PATCH_BYTES,
    "Installed navigation patch",
  );
  await installPatchFile(
    plan.projectRoot,
    plan.patch.targetPath,
    patchSource,
    contract.patchSha256,
  );
  await updateApplicationManifest(plan);
}

async function verifyInstalledNavigationBackend(
  plan: NativePackageAddPlan,
): Promise<void> {
  await installedPackageRoot(
    plan.projectRoot,
    "@solid-native/core",
    plan.packages[0].version,
  );
  const navigationPackageRoot = await installedPackageRoot(
    plan.projectRoot,
    NAVIGATION_PACKAGE,
    plan.packages[0].version,
  );
  const screensPackageRoot = await installedPackageRoot(
    plan.projectRoot,
    SCREENS_PACKAGE,
    VERIFIED_REACT_NATIVE_SCREENS_VERSION,
  );
  const contract = await loadNavigationContract(
    navigationPackageRoot,
    plan.patch.sourceContractPath,
  );
  const applicationPatchPath = await regularContainedFile(
    plan.projectRoot,
    plan.patch.targetPath,
    "Application navigation patch",
  );
  const applicationPatch = await readBoundedText(
    applicationPatchPath,
    MAX_PATCH_BYTES,
    "Application navigation patch",
  );
  if (sha256(applicationPatch) !== contract.patchSha256) {
    throw new TypeError(
      "The application navigation patch changed before backend verification.",
    );
  }
  const mismatches: string[] = [];
  for (const entry of contract.installedFiles) {
    const installedPath = await regularContainedFile(
      screensPackageRoot,
      path.resolve(screensPackageRoot, entry.path),
      `Installed ${SCREENS_PACKAGE} file ${entry.path}`,
    );
    const source = await readBoundedBytes(
      installedPath,
      MAX_INSTALLED_BACKEND_FILE_BYTES,
      `Installed ${SCREENS_PACKAGE} file ${entry.path}`,
    );
    if (sha256Bytes(source) !== entry.sha256) mismatches.push(entry.path);
  }
  if (mismatches.length > 0) {
    throw new TypeError(
      `The package manager did not apply the verified navigation patch to: ${mismatches.join(", ")}.`,
    );
  }
}

export const defaultNativePackageAddExecutor: NativePackageAddExecutor = (
  command,
  context,
) =>
  new Promise((resolve, reject) => {
    const forwardedSignals = new Map<NodeJS.Signals, () => void>();
    let forwardedSignal: NodeJS.Signals | undefined;
    const child = spawn(command.command, [...command.args], {
      cwd: command.projectRoot,
      env: context.env,
      stdio: "inherit",
    });
    const removeSignalHandlers = (): void => {
      for (const [signal, handler] of forwardedSignals) {
        process.removeListener(signal, handler);
      }
      forwardedSignals.clear();
    };
    for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"] as const) {
      const handler = (): void => {
        forwardedSignal ??= signal;
        child.kill(signal);
      };
      forwardedSignals.set(signal, handler);
      process.on(signal, handler);
    }
    child.once("error", (error) => {
      removeSignalHandlers();
      reject(error);
    });
    child.once("close", (exitCode, signal) => {
      removeSignalHandlers();
      if (forwardedSignal !== undefined) {
        resolve(
          forwardedSignal === "SIGHUP"
            ? 129
            : forwardedSignal === "SIGINT"
              ? 130
              : 143,
        );
        return;
      }
      if (exitCode !== null) {
        resolve(exitCode);
        return;
      }
      resolve(signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1);
    });
  });

function assertNativePackageAddPlan(plan: NativePackageAddPlan): void {
  const version = plan.packages[0]?.version;
  const expectedTarget = path.resolve(
    plan.projectRoot,
    NAVIGATION_PATCH_RELATIVE_PATH,
  );
  const expectedInstallArgs = [
    "add",
    "--save-exact",
    "--ignore-workspace-root-check",
    `${NAVIGATION_PACKAGE}@${version}`,
    `${SCREENS_PACKAGE}@${VERIFIED_REACT_NATIVE_SCREENS_VERSION}`,
  ];
  const expectedExistingInstallArgs = ["install", "--no-frozen-lockfile"];
  if (
    plan.schemaVersion !== 0 ||
    plan.operation !== "add" ||
    plan.capability !== "navigation" ||
    (plan.installMode !== "add" && plan.installMode !== "install") ||
    plan.packageManager !== PACKAGE_MANAGER ||
    !path.isAbsolute(plan.projectRoot) ||
    version === undefined ||
    version !== SOLID_NATIVE_CLI_VERSION ||
    plan.packages.length !== 2 ||
    plan.packages[0].name !== NAVIGATION_PACKAGE ||
    plan.packages[1].name !== SCREENS_PACKAGE ||
    plan.packages[1].version !== VERIFIED_REACT_NATIVE_SCREENS_VERSION ||
    plan.patch.packageName !== SCREENS_PACKAGE ||
    plan.patch.packageVersion !== VERIFIED_REACT_NATIVE_SCREENS_VERSION ||
    plan.patch.key !== NAVIGATION_PATCH_KEY ||
    plan.patch.sourcePackage !== NAVIGATION_PACKAGE ||
    plan.patch.sourceContractPath !== NAVIGATION_BACKEND_CONTRACT ||
    plan.patch.targetPath !== expectedTarget ||
    plan.installCommand.projectRoot !== plan.projectRoot ||
    plan.installCommand.command !== "pnpm" ||
    JSON.stringify(plan.installCommand.args) !==
      JSON.stringify(
        plan.installMode === "add"
          ? expectedInstallArgs
          : expectedExistingInstallArgs,
      ) ||
    plan.finalizeCommand.projectRoot !== plan.projectRoot ||
    plan.finalizeCommand.command !== "pnpm" ||
    JSON.stringify(plan.finalizeCommand.args) !==
      JSON.stringify(["install", "--no-frozen-lockfile"])
  ) {
    throw new TypeError("The Solid Native package-add plan is invalid.");
  }
}

/** Installs, configures, and reapplies one reviewed package recipe. */
export async function executeNativePackageAddPlan(
  plan: NativePackageAddPlan,
  options: Readonly<{
    env?: NodeJS.ProcessEnv;
    executor?: NativePackageAddExecutor;
  }> = {},
): Promise<number> {
  assertNativePackageAddPlan(plan);
  if ((await realpath(plan.projectRoot)) !== plan.projectRoot) {
    throw new TypeError(
      "The Solid Native package-add project root is not canonical.",
    );
  }
  const executor = options.executor ?? defaultNativePackageAddExecutor;
  const context = { env: options.env ?? process.env };
  const installStatus = await executor(plan.installCommand, context);
  if (installStatus !== 0) return installStatus;
  await configureNavigationPatch(plan);
  const finalizeStatus = await executor(plan.finalizeCommand, context);
  if (finalizeStatus !== 0) return finalizeStatus;
  await verifyInstalledNavigationBackend(plan);
  return 0;
}

export function formatNativePackageAddPlan(plan: NativePackageAddPlan): string {
  const quote = (value: string): string =>
    /^[A-Za-z0-9_./:@^+=,-]+$/u.test(value)
      ? value
      : `'${value.replaceAll("'", `'\\''`)}'`;
  const formatCommand = (command: NativePackageAddCommand): string =>
    [command.command, ...command.args].map(quote).join(" ");
  return `${formatCommand(plan.installCommand)}\nCopy verified patch to ${quote(path.relative(plan.projectRoot, plan.patch.targetPath))}\n${formatCommand(plan.finalizeCommand)}`;
}
