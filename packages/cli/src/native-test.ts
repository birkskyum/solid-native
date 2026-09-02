import { createRequire } from "node:module";
import { access, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

export const NATIVE_TEST_MAX_FILE_COUNT = 1_024;
export const NATIVE_TEST_MAX_DIRECTORY_COUNT = 4_096;
export const NATIVE_TEST_MAX_DIRECTORY_ENTRY_COUNT = 16_384;

export type NativeTestRuntime = "development" | "production";

const TEST_FILE_PATTERN = /\.(?:test|spec)\.(?:[cm]?js|[cm]?ts|tsx)$/u;
const TEST_SOURCE_PATTERN = /\.(?:[cm]?js|[cm]?ts|tsx)$/u;
const IGNORED_TEST_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  "android",
  "build",
  "coverage",
  "dist",
  "ios",
  "node_modules",
]);

export interface NativeTestPlan {
  readonly schemaVersion: 0;
  readonly operation: "test";
  readonly projectRoot: string;
  readonly testFiles: readonly string[];
  readonly registerPath: string;
  readonly runtime: NativeTestRuntime;
  readonly testNamePattern?: string;
  readonly watch: boolean;
  readonly command: string;
  readonly args: readonly string[];
}

export interface NativeTestOptions {
  readonly cwd?: string;
  readonly paths?: readonly string[];
  readonly runtime?: NativeTestRuntime;
  readonly testNamePattern?: string;
  readonly watch?: boolean;
  readonly dependencies?: Partial<NativeTestDependencies>;
}

export type NativeTestExecutor = (
  plan: NativeTestPlan,
  context: { readonly env: NodeJS.ProcessEnv },
) => Promise<number>;

export interface NativeTestDirectoryEntry {
  readonly name: string;
  readonly isDirectory: boolean;
  readonly isFile: boolean;
  readonly isSymbolicLink: boolean;
}

export interface NativeTestDependencies {
  readonly pathExists: (target: string) => Promise<boolean>;
  readonly readDirectory: (
    target: string,
  ) => Promise<readonly NativeTestDirectoryEntry[]>;
  readonly inspectPath: (
    target: string,
  ) => Promise<"directory" | "file" | "other">;
  readonly realPath: (target: string) => Promise<string>;
  readonly resolveRegister: (projectRoot: string) => string;
}

function containsPath(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

async function findProjectRoot(
  start: string,
  pathExists: NativeTestDependencies["pathExists"],
): Promise<string | undefined> {
  let current = path.resolve(start);
  for (;;) {
    if (await pathExists(path.join(current, "package.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

const defaultDependencies: NativeTestDependencies = {
  pathExists: async (target) => {
    try {
      await access(target);
      return true;
    } catch {
      return false;
    }
  },
  readDirectory: async (target) =>
    (await readdir(target, { withFileTypes: true })).map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
      isSymbolicLink: entry.isSymbolicLink(),
    })),
  inspectPath: async (target) => {
    const metadata = await stat(target);
    return metadata.isDirectory()
      ? "directory"
      : metadata.isFile()
        ? "file"
        : "other";
  },
  realPath: realpath,
  resolveRegister: (projectRoot) =>
    createRequire(
      path.join(projectRoot, ".solid-native-test-resolver.cjs"),
    ).resolve("@solid-native/testing/register"),
};

async function collectTestFiles(
  directory: string,
  dependencies: NativeTestDependencies,
  state: { directoryCount: number; files: Set<string> },
): Promise<void> {
  state.directoryCount += 1;
  if (state.directoryCount > NATIVE_TEST_MAX_DIRECTORY_COUNT) {
    throw new RangeError(
      `Solid Native test discovery exceeds ${String(NATIVE_TEST_MAX_DIRECTORY_COUNT)} directories. Pass narrower paths.`,
    );
  }
  const entries = [...(await dependencies.readDirectory(directory))].sort(
    (left, right) => left.name.localeCompare(right.name),
  );
  if (entries.length > NATIVE_TEST_MAX_DIRECTORY_ENTRY_COUNT) {
    throw new RangeError(
      `Solid Native test directory ${directory} exceeds ${String(NATIVE_TEST_MAX_DIRECTORY_ENTRY_COUNT)} entries. Pass narrower paths.`,
    );
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory) {
      if (IGNORED_TEST_DIRECTORIES.has(entry.name)) continue;
      await collectTestFiles(target, dependencies, state);
      continue;
    }
    if (!entry.isFile || !TEST_FILE_PATTERN.test(entry.name)) continue;
    state.files.add(target);
    if (state.files.size > NATIVE_TEST_MAX_FILE_COUNT) {
      throw new RangeError(
        `Solid Native test discovery exceeds ${String(NATIVE_TEST_MAX_FILE_COUNT)} files. Pass narrower paths.`,
      );
    }
  }
}

function quoteArgument(argument: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/u.test(argument)
    ? argument
    : `'${argument.replaceAll("'", `'\\''`)}'`;
}

export async function createNativeTestPlan(
  options: NativeTestOptions = {},
): Promise<NativeTestPlan> {
  const dependencies = { ...defaultDependencies, ...options.dependencies };
  const start = path.resolve(options.cwd ?? process.cwd());
  const projectRoot = await findProjectRoot(start, dependencies.pathExists);
  if (projectRoot === undefined) {
    throw new TypeError(`No package.json was found at or above ${start}.`);
  }
  const physicalProjectRoot = await dependencies.realPath(projectRoot);
  const runtime = options.runtime ?? "development";
  if (runtime !== "development" && runtime !== "production") {
    throw new TypeError(
      "Solid Native test runtime must be development or production.",
    );
  }
  if (options.watch !== undefined && typeof options.watch !== "boolean") {
    throw new TypeError("Solid Native test watch must be a boolean.");
  }
  const watch = options.watch ?? false;
  const testNamePattern = options.testNamePattern;
  if (
    testNamePattern !== undefined &&
    (typeof testNamePattern !== "string" ||
      testNamePattern.length === 0 ||
      testNamePattern.length > 4_096 ||
      testNamePattern.includes("\0"))
  ) {
    throw new TypeError(
      "Solid Native test name patterns must be 1-4096 character strings without null bytes.",
    );
  }
  if (testNamePattern !== undefined) {
    try {
      new RegExp(testNamePattern);
    } catch (error) {
      throw new TypeError(
        `Solid Native test name pattern is not a valid regular expression: ${testNamePattern}`,
        { cause: error },
      );
    }
  }
  const requestedPaths = options.paths ?? [];
  if (requestedPaths.length > NATIVE_TEST_MAX_FILE_COUNT) {
    throw new RangeError(
      `Solid Native test selection exceeds ${String(NATIVE_TEST_MAX_FILE_COUNT)} paths. Pass narrower paths.`,
    );
  }
  for (const target of requestedPaths) {
    if (
      typeof target !== "string" ||
      target.length === 0 ||
      target.length > 4_096 ||
      target.includes("\0")
    ) {
      throw new TypeError(
        "Solid Native test paths must be 1-4096 character strings without null bytes.",
      );
    }
  }
  const selectedPaths =
    requestedPaths.length === 0
      ? [path.join(projectRoot, "test")]
      : requestedPaths.map((target) => path.resolve(projectRoot, target));
  const discovery = { directoryCount: 0, files: new Set<string>() };
  for (const selectedPath of selectedPaths) {
    if (!containsPath(projectRoot, selectedPath)) {
      throw new TypeError(
        `Solid Native test paths must stay inside ${projectRoot}.`,
      );
    }
    if (!(await dependencies.pathExists(selectedPath))) {
      throw new TypeError(
        `Solid Native test path does not exist: ${selectedPath}`,
      );
    }
    const physicalPath = await dependencies.realPath(selectedPath);
    if (!containsPath(physicalProjectRoot, physicalPath)) {
      throw new TypeError(
        `Solid Native test path resolves outside ${projectRoot}: ${selectedPath}`,
      );
    }
    const kind = await dependencies.inspectPath(physicalPath);
    if (kind === "directory") {
      await collectTestFiles(selectedPath, dependencies, discovery);
      continue;
    }
    if (kind !== "file" || !TEST_SOURCE_PATTERN.test(physicalPath)) {
      throw new TypeError(
        `Solid Native test inputs must be JavaScript or TypeScript files: ${selectedPath}`,
      );
    }
    discovery.files.add(selectedPath);
  }
  const uniqueTestFiles = [...discovery.files].sort();
  if (uniqueTestFiles.length === 0) {
    throw new TypeError(
      `No *.test or *.spec JavaScript/TypeScript files were found beneath ${selectedPaths.join(", ")}.`,
    );
  }
  if (uniqueTestFiles.length > NATIVE_TEST_MAX_FILE_COUNT) {
    throw new RangeError(
      `Solid Native test selection exceeds ${String(NATIVE_TEST_MAX_FILE_COUNT)} files. Pass narrower paths.`,
    );
  }
  let registerPath: string;
  try {
    registerPath = dependencies.resolveRegister(projectRoot);
  } catch (error) {
    throw new TypeError(
      "Could not resolve @solid-native/testing/register from the application. Install @solid-native/testing as a development dependency.",
      { cause: error },
    );
  }
  const args = [
    "--conditions=browser",
    ...(runtime === "development" ? ["--conditions=development"] : []),
    "--enable-source-maps",
    "--import",
    registerPath,
    "--test",
    ...(watch ? ["--watch"] : []),
    ...(testNamePattern === undefined
      ? []
      : [`--test-name-pattern=${testNamePattern}`]),
    ...uniqueTestFiles,
  ];
  return {
    schemaVersion: 0,
    operation: "test",
    projectRoot,
    testFiles: uniqueTestFiles,
    registerPath,
    runtime,
    ...(testNamePattern === undefined ? {} : { testNamePattern }),
    watch,
    command: process.execPath,
    args,
  };
}

export function formatNativeTestPlan(plan: NativeTestPlan): string {
  return [plan.command, ...plan.args].map(quoteArgument).join(" ");
}
