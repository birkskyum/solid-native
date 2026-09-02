import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

import {
  inspectNativeDeviceProofProfile,
  parseNativeDeviceProofReceipt,
  readNativeDeviceProofReceipt,
  type NativeAndroidDeviceProofReceiptV1,
  type NativeDeviceProofFileFact,
  type NativeDeviceProofProfile,
} from "./device-proof-signatures.js";
import {
  createNativeFingerprint,
  type NativeFingerprintReport,
} from "./fingerprint.js";
import { readStableRegularFile } from "./signature-utilities.js";
import { verifyNativeSourceMapPolicy } from "./source-map.js";

export interface NativeAndroidDeviceProofCommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly errorCode?: string;
}

export type NativeAndroidDeviceProofCommandRunner = (
  command: string,
  args: readonly string[],
  context: Readonly<{
    cwd: string;
    timeoutMs: number;
  }>,
) => Promise<NativeAndroidDeviceProofCommandResult>;

export interface NativeAndroidDeviceProofDependencies {
  readonly createFingerprint: (cwd: string) => Promise<NativeFingerprintReport>;
  readonly now: () => Date;
  readonly runCommand: NativeAndroidDeviceProofCommandRunner;
}

export interface CreateNativeAndroidDeviceProofOptions {
  readonly cwd?: string;
  readonly serial: string;
  /** Canonical UTC time captured immediately before instrumentation started. */
  readonly notBefore: string;
  readonly applicationBundlePath: string;
  readonly sourceMapPath: string;
  readonly applicationApkPath: string;
  readonly instrumentationApkPath: string;
  readonly generatedBindingsPath: string;
  readonly instrumentationResultsDirectory: string;
  readonly instrumentationClass: string;
  readonly instrumentationTest: string;
  readonly requiredSources: readonly string[];
  readonly forbiddenSourceFragments?: readonly string[];
  readonly outputPath: string;
  readonly dependencies?: Partial<NativeAndroidDeviceProofDependencies>;
}

export interface CreateNativeAndroidDeviceProofResult {
  readonly receiptPath: string;
  readonly receiptSha256: string;
  readonly receipt: NativeAndroidDeviceProofReceiptV1;
  readonly profile: NativeDeviceProofProfile;
}

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_BINDING_BYTES = 16 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 512 * 1024 * 1024;
const MAX_SOURCE_MAP_BYTES = 512 * 1024 * 1024;
const MAX_APK_BYTES = 1024 * 1024 * 1024;
const MAX_INSTRUMENTATION_SECONDS = 20 * 60;
const RESULT_FRESHNESS_TOLERANCE_MS = 2_000;
const COMMAND_TIMEOUT_MS = 15_000;
const REVISION_PATTERN = /^[a-f0-9]{7,64}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const INSTRUMENTATION_CLASS_PATTERN =
  /^(?:[A-Za-z_$][A-Za-z0-9_$]*\.)+[A-Za-z_$][A-Za-z0-9_$]*$/u;
const INSTRUMENTATION_TEST_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/u;

function boundedString(
  value: unknown,
  label: string,
  maximumLength = 512,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    /\p{Cc}/u.test(value)
  ) {
    throw new TypeError(`${label} must be a bounded printable string.`);
  }
  return value;
}

function canonicalTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} is invalid.`);
  let canonical: string;
  try {
    canonical = new Date(value).toISOString();
  } catch {
    throw new TypeError(`${label} is invalid.`);
  }
  if (canonical !== value) {
    throw new TypeError(`${label} must be canonical UTC.`);
  }
  return value;
}

function safeInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value;
}

function sha256(bytes: NodeJS.ArrayBufferView | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function decodeXmlAttribute(value: string, label: string): string {
  const decoded = value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
  if (decoded.includes("&")) {
    throw new TypeError(`${label} contains an unsupported XML entity.`);
  }
  return boundedString(decoded, label);
}

function xmlAttribute(tag: string, attribute: string, label: string): string {
  const matches = [
    ...tag.matchAll(new RegExp(`\\s${attribute}="([^"]*)"`, "gu")),
  ];
  if (matches.length !== 1) {
    throw new TypeError(`${label} must appear exactly once.`);
  }
  return decodeXmlAttribute(matches[0]![1]!, label);
}

function xmlInteger(
  tag: string,
  attribute: string,
  label: string,
  minimum: number,
  maximum: number,
): number {
  const value = xmlAttribute(tag, attribute, label);
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new TypeError(`${label} must be an integer.`);
  }
  return safeInteger(Number(value), label, minimum, maximum);
}

function uniqueXmlTag(source: string, tagName: string): string {
  const matches = [
    ...source.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, "gu")),
  ];
  if (matches.length !== 1) {
    throw new TypeError(`${tagName} must appear exactly once.`);
  }
  return matches[0]![0];
}

export function parseNativeAndroidInstrumentationResult(
  source: string,
  expectedClass: string,
  expectedTest: string,
): Readonly<{
  className: string;
  durationSeconds: number;
  reportedAt: string;
  testName: string;
}> {
  if (
    typeof source !== "string" ||
    Buffer.byteLength(source, "utf8") === 0 ||
    Buffer.byteLength(source, "utf8") > MAX_TEXT_BYTES
  ) {
    throw new TypeError("Android instrumentation XML is empty or oversized.");
  }
  if (/<!\s*(?:DOCTYPE|ENTITY)/iu.test(source)) {
    throw new TypeError(
      "Android instrumentation XML cannot declare a document type or entity.",
    );
  }
  const className = boundedString(
    expectedClass,
    "Android instrumentation class",
    255,
  );
  const testName = boundedString(
    expectedTest,
    "Android instrumentation test",
    128,
  );
  if (
    !INSTRUMENTATION_CLASS_PATTERN.test(className) ||
    !INSTRUMENTATION_TEST_PATTERN.test(testName)
  ) {
    throw new TypeError("Android instrumentation identity is invalid.");
  }
  const suites = uniqueXmlTag(source, "testsuites");
  const suite = uniqueXmlTag(source, "testsuite");
  const testCase = uniqueXmlTag(source, "testcase");
  for (const [tag, label] of [
    [suites, "testsuites"],
    [suite, "testsuite"],
  ] as const) {
    if (
      xmlInteger(tag, "tests", `${label}.tests`, 0, 1) !== 1 ||
      xmlInteger(tag, "failures", `${label}.failures`, 0, 1) !== 0 ||
      xmlInteger(tag, "errors", `${label}.errors`, 0, 1) !== 0 ||
      xmlInteger(tag, "skipped", `${label}.skipped`, 0, 1) !== 0
    ) {
      throw new TypeError(`${label} did not report one passing test.`);
    }
  }
  if (/<(?:failure|error|skipped)\b/iu.test(source)) {
    throw new TypeError(
      "Android instrumentation XML contains a non-passing result element.",
    );
  }
  if (
    xmlAttribute(suite, "name", "testsuite.name") !== className ||
    xmlAttribute(testCase, "classname", "testcase.classname") !== className ||
    xmlAttribute(testCase, "name", "testcase.name") !== testName
  ) {
    throw new TypeError("Android instrumentation ran an unexpected test.");
  }
  const durationSeconds = Number(
    xmlAttribute(testCase, "time", "testcase.time"),
  );
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    durationSeconds > MAX_INSTRUMENTATION_SECONDS
  ) {
    throw new TypeError("Android instrumentation duration is invalid.");
  }
  const timestamp = xmlAttribute(suite, "timestamp", "testsuite.timestamp");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/u.test(timestamp)) {
    throw new TypeError("Android instrumentation timestamp is invalid.");
  }
  const reportedAt = new Date(`${timestamp}Z`);
  if (!Number.isFinite(reportedAt.getTime())) {
    throw new TypeError("Android instrumentation timestamp is not real UTC.");
  }
  return Object.freeze({
    className,
    durationSeconds,
    reportedAt: reportedAt.toISOString(),
    testName,
  });
}

export function parseNativeAndroidBatteryState(source: string): Readonly<{
  level: number;
  temperatureCelsius: number;
}> {
  if (
    typeof source !== "string" ||
    Buffer.byteLength(source, "utf8") > 64 * 1024
  ) {
    throw new TypeError("Android battery state is oversized.");
  }
  const field = (name: string): number => {
    const matches = [
      ...source.matchAll(new RegExp(`^\\s*${name}:\\s*(-?\\d+)\\s*$`, "gmu")),
    ];
    if (matches.length !== 1) {
      throw new TypeError(`Android battery ${name} is missing or duplicated.`);
    }
    return Number(matches[0]![1]!);
  };
  return Object.freeze({
    level: safeInteger(field("level"), "Android battery level", 0, 100),
    temperatureCelsius:
      safeInteger(
        field("temperature"),
        "Android battery temperature",
        -500,
        1_500,
      ) / 10,
  });
}

async function defaultRunCommand(
  command: string,
  args: readonly string[],
  context: Readonly<{ cwd: string; timeoutMs: number }>,
): Promise<NativeAndroidDeviceProofCommandResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      [...args],
      {
        cwd: context.cwd,
        encoding: "utf8",
        maxBuffer: MAX_TEXT_BYTES,
        timeout: context.timeoutMs,
      },
      (error, stdout, stderr) => {
        const errorCode =
          error === null ? undefined : (error as NodeJS.ErrnoException).code;
        resolve({
          exitCode:
            error === null
              ? 0
              : typeof errorCode === "number"
                ? errorCode
                : null,
          stdout,
          stderr,
          timedOut: error?.killed === true,
          ...(typeof errorCode === "string" ? { errorCode } : {}),
        });
      },
    );
  });
}

function dependencies(
  overrides: CreateNativeAndroidDeviceProofOptions["dependencies"],
): NativeAndroidDeviceProofDependencies {
  return {
    createFingerprint:
      overrides?.createFingerprint ??
      ((cwd) => createNativeFingerprint({ cwd, platform: "android" })),
    now: overrides?.now ?? (() => new Date()),
    runCommand: overrides?.runCommand ?? defaultRunCommand,
  };
}

async function run(
  command: string,
  args: readonly string[],
  cwd: string,
  runCommand: NativeAndroidDeviceProofCommandRunner,
): Promise<string> {
  const result = await runCommand(command, args, {
    cwd,
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  if (result.exitCode !== 0 || result.timedOut) {
    const detail = (result.stderr || result.stdout).trim();
    throw new TypeError(
      `${command} ${args.join(" ")} failed${detail === "" ? "." : `: ${detail}`}`,
    );
  }
  return result.stdout.replaceAll("\r", "").trim();
}

async function stableDigest(
  filePath: string,
  label: string,
  maximumBytes: number,
): Promise<NativeDeviceProofFileFact> {
  let handle;
  try {
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new TypeError(`${label} ${filePath} is missing or unreadable.`);
  }
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size === 0 || before.size > maximumBytes) {
      throw new TypeError(
        `${label} must be a 1-${String(maximumBytes)} byte regular file.`,
      );
    }
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < before.size) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, before.size - position),
        position,
      );
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await handle.stat();
    if (
      position !== before.size ||
      !after.isFile() ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    ) {
      throw new TypeError(`${label} changed while being hashed.`);
    }
    return Object.freeze({
      bytes: before.size,
      sha256: hash.digest("hex"),
    });
  } finally {
    await handle.close();
  }
}

function sameFact(
  left: NativeDeviceProofFileFact,
  right: NativeDeviceProofFileFact,
): boolean {
  return left.bytes === right.bytes && left.sha256 === right.sha256;
}

function androidFingerprintTarget(
  report: NativeFingerprintReport,
): NativeFingerprintReport["targets"][number] {
  const target = report.targets.find(
    (candidate) => candidate.platform === "android",
  );
  if (target === undefined || report.targets.length !== 1) {
    throw new TypeError(
      "Android device proof requires one Android compatibility fingerprint.",
    );
  }
  return target;
}

async function freshInstrumentationResult(
  directory: string,
  notBeforeMilliseconds: number,
): Promise<string> {
  const directoryMetadata = await lstat(directory).catch(() => undefined);
  if (directoryMetadata === undefined || !directoryMetadata.isDirectory()) {
    throw new TypeError(
      "Android instrumentation results must be a real directory.",
    );
  }
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length > 64) {
    throw new TypeError(
      "Android instrumentation result directory is oversized.",
    );
  }
  const candidates: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^TEST-.+\.xml$/u.test(entry.name)) continue;
    const candidate = path.join(directory, entry.name);
    const metadata = await lstat(candidate);
    if (
      metadata.isFile() &&
      metadata.mtimeMs + RESULT_FRESHNESS_TOLERANCE_MS >= notBeforeMilliseconds
    ) {
      candidates.push(candidate);
    }
  }
  if (candidates.length !== 1) {
    throw new TypeError(
      `Expected one fresh Android instrumentation XML result; found ${String(candidates.length)}.`,
    );
  }
  return candidates[0]!;
}

async function atomicPublish(outputPath: string, bytes: Buffer): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.solid-native-${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, bytes, { flag: "wx" });
    try {
      await link(temporaryPath, outputPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new TypeError(
          `Device-proof receipt ${outputPath} already exists; evidence files are immutable.`,
        );
      }
      throw error;
    }
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

/**
 * Produces one schema-1 Android receipt from fresh Gradle instrumentation,
 * stable build artifacts, a clean Git snapshot, and live physical-device facts.
 */
export async function createNativeAndroidDeviceProof(
  options: CreateNativeAndroidDeviceProofOptions,
): Promise<CreateNativeAndroidDeviceProofResult> {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("Android device-proof options are required.");
  }
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const serial = boundedString(options.serial, "Android device serial", 256);
  const notBefore = canonicalTimestamp(
    options.notBefore,
    "Android proof start time",
  );
  const instrumentationClass = boundedString(
    options.instrumentationClass,
    "Android instrumentation class",
    255,
  );
  const instrumentationTest = boundedString(
    options.instrumentationTest,
    "Android instrumentation test",
    128,
  );
  if (
    !INSTRUMENTATION_CLASS_PATTERN.test(instrumentationClass) ||
    !INSTRUMENTATION_TEST_PATTERN.test(instrumentationTest)
  ) {
    throw new TypeError("Android instrumentation identity is invalid.");
  }
  if (
    !Array.isArray(options.requiredSources) ||
    options.requiredSources.length === 0
  ) {
    throw new TypeError(
      "Android device proof requires at least one exact source identity.",
    );
  }
  const dependency = dependencies(options.dependencies);
  const current = dependency.now();
  if (!(current instanceof Date) || !Number.isFinite(current.getTime())) {
    throw new TypeError("Android device-proof clock returned an invalid time.");
  }
  const nowMilliseconds = current.getTime();
  const notBeforeMilliseconds = Date.parse(notBefore);
  if (
    notBeforeMilliseconds > nowMilliseconds + 60_000 ||
    nowMilliseconds - notBeforeMilliseconds >
      MAX_INSTRUMENTATION_SECONDS * 1_000
  ) {
    throw new TypeError(
      "Android proof start time is future-dated or outside the bounded instrumentation window.",
    );
  }

  const adb = (...args: readonly string[]): Promise<string> =>
    run("adb", ["-s", serial, ...args], cwd, dependency.runCommand);
  if ((await adb("get-state")) !== "device") {
    throw new TypeError("Android device is unavailable or unauthorized.");
  }
  const qemu = await Promise.all([
    adb("shell", "getprop", "ro.kernel.qemu"),
    adb("shell", "getprop", "ro.boot.qemu"),
  ]);
  if (!qemu.every((value) => value === "" || value === "0")) {
    throw new TypeError(
      "Android device proof cannot be produced from an emulator.",
    );
  }

  const repositoryRoot = path.resolve(
    await run(
      "git",
      ["-C", cwd, "rev-parse", "--show-toplevel"],
      cwd,
      dependency.runCommand,
    ),
  );
  if (repositoryRoot === path.parse(repositoryRoot).root) {
    throw new TypeError("Android device-proof repository root is invalid.");
  }
  const initialRevision = (
    await run(
      "git",
      ["-C", repositoryRoot, "rev-parse", "HEAD"],
      cwd,
      dependency.runCommand,
    )
  ).toLowerCase();
  if (!REVISION_PATTERN.test(initialRevision)) {
    throw new TypeError("Android device-proof Git revision is invalid.");
  }
  const initialStatus = await run(
    "git",
    [
      "-C",
      repositoryRoot,
      "status",
      "--porcelain=v1",
      "--untracked-files=normal",
    ],
    cwd,
    dependency.runCommand,
  );
  if (initialStatus !== "") {
    throw new TypeError(
      "Android device proof requires a clean source checkout.",
    );
  }

  const instrumentationResultsDirectory = path.resolve(
    cwd,
    options.instrumentationResultsDirectory,
  );
  const resultPath = await freshInstrumentationResult(
    instrumentationResultsDirectory,
    notBeforeMilliseconds,
  );
  const resultFile = await readStableRegularFile(
    resultPath,
    "Android instrumentation XML",
    MAX_TEXT_BYTES,
  );
  const instrumentation = parseNativeAndroidInstrumentationResult(
    resultFile.bytes.toString("utf8"),
    instrumentationClass,
    instrumentationTest,
  );
  const reportedAtMilliseconds = Date.parse(instrumentation.reportedAt);
  if (
    reportedAtMilliseconds + RESULT_FRESHNESS_TOLERANCE_MS <
      notBeforeMilliseconds ||
    reportedAtMilliseconds > nowMilliseconds + 60_000
  ) {
    throw new TypeError(
      "Android instrumentation XML is stale or future-dated.",
    );
  }
  const exitCodePath = path.join(
    instrumentationResultsDirectory,
    "test-result-exit-code.txt",
  );
  const exitMetadata = await lstat(exitCodePath).catch(() => undefined);
  if (
    exitMetadata === undefined ||
    !exitMetadata.isFile() ||
    exitMetadata.mtimeMs + RESULT_FRESHNESS_TOLERANCE_MS < notBeforeMilliseconds
  ) {
    throw new TypeError("Android instrumentation exit code is stale.");
  }
  const exitCodeFile = await readStableRegularFile(
    exitCodePath,
    "Android instrumentation exit code",
    32,
  );
  if (exitCodeFile.bytes.toString("utf8").trim() !== "0") {
    throw new TypeError("Android instrumentation exit code is nonzero.");
  }

  const applicationBundlePath = path.resolve(
    cwd,
    options.applicationBundlePath,
  );
  const sourceMapPath = path.resolve(cwd, options.sourceMapPath);
  const applicationApkPath = path.resolve(cwd, options.applicationApkPath);
  const instrumentationApkPath = path.resolve(
    cwd,
    options.instrumentationApkPath,
  );
  const generatedBindingsPath = path.resolve(
    cwd,
    options.generatedBindingsPath,
  );
  const sourceMapBefore = await stableDigest(
    sourceMapPath,
    "Production source map",
    MAX_SOURCE_MAP_BYTES,
  );
  const sourcePolicy = await verifyNativeSourceMapPolicy({
    sourceMapPath,
    sourceRoot: repositoryRoot,
    requiredSources: options.requiredSources,
    ...(options.forbiddenSourceFragments === undefined
      ? {}
      : { forbiddenSourceFragments: options.forbiddenSourceFragments }),
  });
  if (!sourcePolicy.ok) {
    throw new TypeError(
      "Android device-proof source-map policy did not pass every check.",
    );
  }
  const [bundle, sourceMap, applicationApk, instrumentationApk, bindings] =
    await Promise.all([
      stableDigest(
        applicationBundlePath,
        "Production JavaScript bundle",
        MAX_BUNDLE_BYTES,
      ),
      stableDigest(
        sourceMapPath,
        "Production source map",
        MAX_SOURCE_MAP_BYTES,
      ),
      stableDigest(applicationApkPath, "Application APK", MAX_APK_BYTES),
      stableDigest(
        instrumentationApkPath,
        "Instrumentation APK",
        MAX_APK_BYTES,
      ),
      stableDigest(
        generatedBindingsPath,
        "Generated Solid bindings",
        MAX_BINDING_BYTES,
      ),
    ]);
  if (!sameFact(sourceMapBefore, sourceMap)) {
    throw new TypeError(
      "Production source map changed during source-policy verification.",
    );
  }
  const bindingFile = await readStableRegularFile(
    generatedBindingsPath,
    "Generated Solid bindings",
    MAX_BINDING_BYTES,
  );
  if (
    bindingFile.bytes.length !== bindings.bytes ||
    sha256(bindingFile.bytes) !== bindings.sha256
  ) {
    throw new TypeError("Generated Solid bindings changed after hashing.");
  }
  const bindingMatches = [
    ...bindingFile.bytes
      .toString("utf8")
      .matchAll(/bindingSha256: "([a-f0-9]{64})"/gu),
  ];
  if (bindingMatches.length !== 1) {
    throw new TypeError(
      "Generated Solid bindings must expose exactly one bindingSha256.",
    );
  }
  const bindingManifestSha256 = bindingMatches[0]![1]!;
  if (!SHA256_PATTERN.test(bindingManifestSha256)) {
    throw new TypeError("Generated Solid binding identity is invalid.");
  }

  const fingerprintReport = await dependency.createFingerprint(cwd);
  const target = androidFingerprintTarget(fingerprintReport);

  const buildFingerprint = boundedString(
    await adb("shell", "getprop", "ro.build.fingerprint"),
    "Android build fingerprint",
    1_024,
  );
  const battery = parseNativeAndroidBatteryState(
    await adb("shell", "dumpsys", "battery"),
  );
  const lowPower = await adb("shell", "settings", "get", "global", "low_power");
  if (lowPower !== "0" && lowPower !== "1") {
    throw new TypeError("Android low-power mode must be 0 or 1.");
  }
  const device = Object.freeze({
    kind: "physical" as const,
    serialSha256: `sha256:${sha256(serial)}`,
    manufacturer: boundedString(
      await adb("shell", "getprop", "ro.product.manufacturer"),
      "Android manufacturer",
    ),
    model: boundedString(
      await adb("shell", "getprop", "ro.product.model"),
      "Android model",
    ),
    product: boundedString(
      await adb("shell", "getprop", "ro.product.name"),
      "Android product",
    ),
    abi: boundedString(
      await adb("shell", "getprop", "ro.product.cpu.abi"),
      "Android ABI",
    ),
    osVersion: boundedString(
      await adb("shell", "getprop", "ro.build.version.release"),
      "Android OS version",
    ),
    sdkLevel: safeInteger(
      Number(await adb("shell", "getprop", "ro.build.version.sdk")),
      "Android SDK level",
      1,
      999,
    ),
    buildFingerprintSha256: `sha256:${sha256(buildFingerprint)}`,
    batteryLevel: battery.level,
    batteryTemperatureCelsius: battery.temperatureCelsius,
    lowPowerMode: lowPower === "1",
  });
  if ((await adb("get-state")) !== "device") {
    throw new TypeError("Android device disconnected during proof creation.");
  }

  const [
    bundleAfter,
    sourceMapAfter,
    applicationAfter,
    instrumentationAfter,
    bindingsAfter,
    resultAfter,
    exitCodeAfter,
  ] = await Promise.all([
    stableDigest(
      applicationBundlePath,
      "Production JavaScript bundle",
      MAX_BUNDLE_BYTES,
    ),
    stableDigest(sourceMapPath, "Production source map", MAX_SOURCE_MAP_BYTES),
    stableDigest(applicationApkPath, "Application APK", MAX_APK_BYTES),
    stableDigest(instrumentationApkPath, "Instrumentation APK", MAX_APK_BYTES),
    stableDigest(
      generatedBindingsPath,
      "Generated Solid bindings",
      MAX_BINDING_BYTES,
    ),
    readStableRegularFile(
      resultPath,
      "Android instrumentation XML",
      MAX_TEXT_BYTES,
    ),
    readStableRegularFile(
      exitCodePath,
      "Android instrumentation exit code",
      32,
    ),
  ]);
  if (
    !sameFact(bundle, bundleAfter) ||
    !sameFact(sourceMap, sourceMapAfter) ||
    !sameFact(applicationApk, applicationAfter) ||
    !sameFact(instrumentationApk, instrumentationAfter) ||
    !sameFact(bindings, bindingsAfter) ||
    !resultAfter.bytes.equals(resultFile.bytes) ||
    !exitCodeAfter.bytes.equals(exitCodeFile.bytes)
  ) {
    throw new TypeError(
      "Android device-proof artifacts changed while evidence was collected.",
    );
  }
  const finalFingerprintReport = await dependency.createFingerprint(cwd);
  const finalTarget = androidFingerprintTarget(finalFingerprintReport);
  if (
    finalTarget.fingerprint !== target.fingerprint ||
    JSON.stringify(finalTarget.inputs) !== JSON.stringify(target.inputs)
  ) {
    throw new TypeError(
      "Android native compatibility identity changed while evidence was collected.",
    );
  }
  const finalRevision = (
    await run(
      "git",
      ["-C", repositoryRoot, "rev-parse", "HEAD"],
      cwd,
      dependency.runCommand,
    )
  ).toLowerCase();
  const finalStatus = await run(
    "git",
    [
      "-C",
      repositoryRoot,
      "status",
      "--porcelain=v1",
      "--untracked-files=normal",
    ],
    cwd,
    dependency.runCommand,
  );
  if (finalRevision !== initialRevision || finalStatus !== initialStatus) {
    throw new TypeError(
      "Android device-proof source changed while evidence was collected.",
    );
  }

  const measuredAt = dependency.now();
  if (
    !(measuredAt instanceof Date) ||
    !Number.isFinite(measuredAt.getTime()) ||
    measuredAt.getTime() < reportedAtMilliseconds ||
    measuredAt.getTime() - reportedAtMilliseconds > 60 * 60 * 1_000
  ) {
    throw new TypeError("Android device-proof measurement time is invalid.");
  }
  const receipt = parseNativeDeviceProofReceipt({
    schemaVersion: 1,
    proof: "solid-native-android-release-device",
    status: "passed",
    measuredAt: measuredAt.toISOString(),
    source: { revision: initialRevision, dirty: false },
    device,
    nativeCompatibility: {
      fingerprint: target.fingerprint,
      inputCount: target.inputs.length,
    },
    generatedBindings: {
      bytes: bindings.bytes,
      fileSha256: bindings.sha256,
      manifestSha256: bindingManifestSha256,
    },
    bundle,
    sourceMap: {
      bytes: sourceMap.bytes,
      sha256: sourceMap.sha256,
      sourceCount: sourcePolicy.sourceCount,
      checks: sourcePolicy.checks.map(({ kind, matches, pattern }) => ({
        kind,
        matches,
        pattern,
      })),
    },
    artifacts: { applicationApk, instrumentationApk },
    instrumentation: {
      ...instrumentation,
      resultBytes: resultFile.bytes.length,
      resultSha256: sha256(resultFile.bytes),
      exitCodeSha256: sha256(exitCodeFile.bytes),
    },
  });
  if (receipt.schemaVersion !== 1) {
    throw new TypeError(
      "Android device-proof producer emitted a legacy receipt.",
    );
  }
  const receiptBytes = Buffer.from(
    `${JSON.stringify(receipt, undefined, 2)}\n`,
    "utf8",
  );
  const receiptPath = path.resolve(cwd, options.outputPath);
  await atomicPublish(receiptPath, receiptBytes);
  const published = await readNativeDeviceProofReceipt(receiptPath);
  if (published.schemaVersion !== 1) {
    throw new TypeError("Published Android device proof changed schema.");
  }
  return Object.freeze({
    receiptPath,
    receiptSha256: `sha256:${sha256(receiptBytes)}`,
    receipt: published,
    profile: inspectNativeDeviceProofProfile(published),
  });
}
