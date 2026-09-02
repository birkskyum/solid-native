import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const COMMAND_TIMEOUT_MS = 15_000;
const CORE_DEVICE_TIMEOUT_SECONDS = 12;
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024;
const MAX_CORE_DEVICE_RESULT_BYTES = 1024 * 1024;
const PROCESS_POLL_INTERVAL_MS = 250;
const PROCESS_CLEAN_STABILITY_POLLS = 4;
const MAX_PROCESS_POLLS = 12;
const IOS_BUNDLE_IDENTIFIER =
  /^[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9][A-Za-z0-9-]*)+$/u;

export interface NativeIosProcessCommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly errorCode?: string;
}

export type NativeIosProcessCommandRunner = (
  command: string,
  args: readonly string[],
  context: Readonly<{
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
  }>,
) => Promise<NativeIosProcessCommandResult>;

export interface NativeIosProcessDependencies {
  readonly hostPlatform: NodeJS.Platform;
  readonly runCommand: NativeIosProcessCommandRunner;
  readonly wait: (milliseconds: number) => Promise<void>;
}

export interface NativeIosProcessOptions {
  readonly bundleIdentifier: string;
  readonly device: string;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly dependencies?: Partial<NativeIosProcessDependencies>;
}

export interface NativeIosProcessApplication {
  readonly bundleIdentifier: string;
  readonly name: string;
  readonly version: string;
  readonly builtByDeveloper: true;
}

export interface NativeIosApplicationProcessStatus {
  readonly schemaVersion: 0;
  readonly operation: "status";
  readonly platform: "ios";
  readonly bundleIdentifier: string;
  readonly device: string;
  readonly application: NativeIosProcessApplication;
  readonly running: boolean;
  readonly processCount: number;
  readonly processIdentifiers: readonly number[];
}

export interface NativeIosApplicationProcessStop {
  readonly schemaVersion: 0;
  readonly operation: "stop";
  readonly platform: "ios";
  readonly bundleIdentifier: string;
  readonly device: string;
  readonly application: NativeIosProcessApplication;
  readonly running: false;
  readonly stoppedProcessCount: number;
  readonly stoppedProcessIdentifiers: readonly number[];
}

export interface NativeIosProcessTarget {
  readonly application: NativeIosProcessApplication;
  readonly installationUrl: string;
}

function boundedOutput(current: string, chunk: string): string {
  const combined = `${current}${chunk}`;
  return Buffer.byteLength(combined, "utf8") <= MAX_COMMAND_OUTPUT_BYTES
    ? combined
    : Buffer.from(combined, "utf8")
        .subarray(-MAX_COMMAND_OUTPUT_BYTES)
        .toString("utf8");
}

export const defaultNativeIosProcessCommandRunner: NativeIosProcessCommandRunner =
  (command, args, context) =>
    new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      execFile(
        command,
        [...args],
        {
          cwd: context.cwd,
          encoding: "utf8",
          env: context.env,
          maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
          timeout: context.timeoutMs,
        },
        (error, commandStdout, commandStderr) => {
          stdout = boundedOutput(stdout, commandStdout);
          stderr = boundedOutput(stderr, commandStderr);
          const commandError = error as
            (NodeJS.ErrnoException & { readonly killed?: boolean }) | null;
          resolve({
            exitCode:
              commandError === null
                ? 0
                : typeof commandError.code === "number"
                  ? commandError.code
                  : null,
            stdout,
            stderr,
            timedOut: commandError?.killed === true,
            ...(typeof commandError?.code === "string"
              ? { errorCode: commandError.code }
              : {}),
          });
        },
      );
    });

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedString(
  value: unknown,
  label: string,
  maximumLength: number,
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

function assertBundleIdentifier(
  bundleIdentifier: unknown,
): asserts bundleIdentifier is string {
  if (
    typeof bundleIdentifier !== "string" ||
    bundleIdentifier.length > 255 ||
    !IOS_BUNDLE_IDENTIFIER.test(bundleIdentifier)
  ) {
    throw new TypeError(
      `iOS process control requires a valid dotted bundle identifier, received ${JSON.stringify(bundleIdentifier)}.`,
    );
  }
}

function assertDevice(device: unknown): asserts device is string {
  if (
    typeof device !== "string" ||
    device.length === 0 ||
    device.length > 256 ||
    /\s|\0/u.test(device)
  ) {
    throw new TypeError(
      "iOS device identifiers must be 1-256 non-whitespace characters.",
    );
  }
}

function parseCoreDeviceDocument(source: string, label: string) {
  if (Buffer.byteLength(source, "utf8") > MAX_CORE_DEVICE_RESULT_BYTES) {
    throw new RangeError(
      `${label} exceeds ${String(MAX_CORE_DEVICE_RESULT_BYTES)} bytes.`,
    );
  }
  let document: unknown;
  try {
    document = JSON.parse(source);
  } catch {
    throw new TypeError(`${label} is not valid JSON.`);
  }
  if (
    !isRecord(document) ||
    !isRecord(document.info) ||
    document.info.outcome !== "success" ||
    "error" in document ||
    !isRecord(document.result)
  ) {
    throw new TypeError(`${label} did not report a successful result.`);
  }
  return document.result;
}

function normalizeApplicationUrl(value: unknown): string {
  const source = boundedString(value, "iOS application URL", 2_048);
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new TypeError("CoreDevice returned an invalid iOS application URL.");
  }
  if (
    url.protocol !== "file:" ||
    url.hostname !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    !url.pathname.startsWith("/") ||
    !url.pathname.endsWith(".app/")
  ) {
    throw new TypeError("CoreDevice returned an unsafe iOS application URL.");
  }
  return url.href;
}

function normalizeExecutableUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(
      "CoreDevice returned an invalid process executable URL.",
    );
  }
  if (
    url.protocol !== "file:" ||
    url.hostname !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    !url.pathname.startsWith("/")
  ) {
    throw new TypeError(
      "CoreDevice returned an unsafe process executable URL.",
    );
  }
  return url.href;
}

export function parseNativeIosProcessTarget(
  source: string,
  bundleIdentifier: string,
): NativeIosProcessTarget {
  assertBundleIdentifier(bundleIdentifier);
  const result = parseCoreDeviceDocument(
    source,
    "CoreDevice installed-application result",
  );
  if (!Array.isArray(result.apps)) {
    throw new TypeError(
      "CoreDevice installed-application result omitted result.apps.",
    );
  }
  const matches = result.apps.filter(
    (entry) => isRecord(entry) && entry.bundleIdentifier === bundleIdentifier,
  );
  if (matches.length !== 1 || !isRecord(matches[0])) {
    throw new TypeError(
      `iOS application ${bundleIdentifier} is not installed exactly once on the selected device.`,
    );
  }
  const application = matches[0];
  if (application.builtByDeveloper !== true) {
    throw new TypeError(
      `iOS application ${bundleIdentifier} is not a developer-installed application.`,
    );
  }
  return Object.freeze({
    application: Object.freeze({
      bundleIdentifier,
      name: boundedString(application.name, "iOS application name", 256),
      version: boundedString(
        application.version,
        "iOS application version",
        128,
      ),
      builtByDeveloper: true as const,
    }),
    installationUrl: normalizeApplicationUrl(application.url),
  });
}

export function parseNativeIosApplicationProcesses(
  source: string,
  installationUrl: string,
): readonly number[] {
  const normalizedInstallationUrl = normalizeApplicationUrl(installationUrl);
  const result = parseCoreDeviceDocument(
    source,
    "CoreDevice running-process result",
  );
  if (!Array.isArray(result.runningProcesses)) {
    throw new TypeError(
      "CoreDevice running-process result omitted result.runningProcesses.",
    );
  }
  const identifiers = new Set<number>();
  for (const process of result.runningProcesses) {
    if (
      !isRecord(process) ||
      typeof process.executable !== "string" ||
      !process.executable.startsWith(normalizedInstallationUrl)
    ) {
      continue;
    }
    const executableUrl = normalizeExecutableUrl(process.executable);
    if (
      executableUrl === normalizedInstallationUrl ||
      !executableUrl.startsWith(normalizedInstallationUrl)
    ) {
      throw new TypeError(
        "CoreDevice returned a process executable outside the selected application.",
      );
    }
    if (
      !Number.isSafeInteger(process.processIdentifier) ||
      (process.processIdentifier as number) <= 0
    ) {
      throw new TypeError(
        "CoreDevice returned an invalid application process identifier.",
      );
    }
    if (identifiers.has(process.processIdentifier as number)) {
      throw new TypeError(
        "CoreDevice returned a duplicate application process identifier.",
      );
    }
    identifiers.add(process.processIdentifier as number);
  }
  return Object.freeze([...identifiers].sort((left, right) => left - right));
}

function commandFailure(
  label: string,
  result: NativeIosProcessCommandResult,
): TypeError {
  if (result.timedOut) {
    return new TypeError(
      `${label} did not finish within ${String(COMMAND_TIMEOUT_MS / 1_000)} seconds. Confirm the iPhone is wired, unlocked, and trusted.`,
    );
  }
  if (result.errorCode === "ENOENT") {
    return new TypeError(
      "Could not start xcrun. Install Xcode and select its developer directory before controlling an iOS process.",
    );
  }
  const detail = `${result.stderr}\n${result.stdout}`
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return new TypeError(
    detail === undefined
      ? `${label} failed without diagnostic output.`
      : `${label} failed: ${detail}`,
  );
}

function dependencies(
  overrides: NativeIosProcessOptions["dependencies"],
): NativeIosProcessDependencies {
  return {
    hostPlatform: overrides?.hostPlatform ?? process.platform,
    runCommand: overrides?.runCommand ?? defaultNativeIosProcessCommandRunner,
    wait:
      overrides?.wait ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds))),
  };
}

interface NativeIosProcessContext {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly device: string;
  readonly dependency: NativeIosProcessDependencies;
  readonly directory: string;
  nextResultIndex: number;
}

async function runCoreDevice(
  context: NativeIosProcessContext,
  label: string,
  args: readonly string[],
): Promise<NativeIosProcessCommandResult> {
  const result = await context.dependency.runCommand("xcrun", args, {
    cwd: context.cwd,
    env: context.env,
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  if (result.exitCode !== 0 || result.timedOut) {
    throw commandFailure(label, result);
  }
  return result;
}

async function queryCoreDevice(
  context: NativeIosProcessContext,
  subject: "apps" | "processes",
  extraArguments: readonly string[] = [],
): Promise<string> {
  const resultPath = path.join(
    context.directory,
    `${subject}-${String(context.nextResultIndex)}.json`,
  );
  context.nextResultIndex += 1;
  await runCoreDevice(
    context,
    `CoreDevice ${subject === "apps" ? "application lookup" : "process lookup"}`,
    [
      "devicectl",
      "device",
      "info",
      subject,
      "--device",
      context.device,
      ...extraArguments,
      "--quiet",
      "--timeout",
      String(CORE_DEVICE_TIMEOUT_SECONDS),
      "--json-output",
      resultPath,
    ],
  );
  let source: string;
  try {
    source = await readFile(resultPath, "utf8");
  } catch {
    throw new TypeError(
      `CoreDevice ${subject} lookup succeeded without its required JSON result.`,
    );
  }
  return source;
}

async function queryTarget(
  context: NativeIosProcessContext,
  bundleIdentifier: string,
): Promise<NativeIosProcessTarget> {
  return parseNativeIosProcessTarget(
    await queryCoreDevice(context, "apps", ["--bundle-id", bundleIdentifier]),
    bundleIdentifier,
  );
}

async function queryProcesses(
  context: NativeIosProcessContext,
  installationUrl: string,
): Promise<readonly number[]> {
  return parseNativeIosApplicationProcesses(
    await queryCoreDevice(context, "processes"),
    installationUrl,
  );
}

function assertUnchangedTarget(
  before: NativeIosProcessTarget,
  after: NativeIosProcessTarget,
): void {
  if (
    before.installationUrl !== after.installationUrl ||
    before.application.bundleIdentifier !==
      after.application.bundleIdentifier ||
    before.application.name !== after.application.name ||
    before.application.version !== after.application.version
  ) {
    throw new TypeError(
      "The selected iOS application changed while its process state was inspected.",
    );
  }
}

async function withContext<Result>(
  options: NativeIosProcessOptions,
  callback: (
    context: NativeIosProcessContext,
    target: NativeIosProcessTarget,
  ) => Promise<Result>,
): Promise<Result> {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("iOS process-control options are required.");
  }
  assertBundleIdentifier(options.bundleIdentifier);
  assertDevice(options.device);
  const dependency = dependencies(options.dependencies);
  if (dependency.hostPlatform !== "darwin") {
    throw new TypeError(
      `iOS process control requires macOS and Xcode; received ${dependency.hostPlatform}.`,
    );
  }
  if (
    typeof dependency.runCommand !== "function" ||
    typeof dependency.wait !== "function"
  ) {
    throw new TypeError("iOS process-control dependencies are invalid.");
  }
  const directory = await mkdtemp(
    path.join(tmpdir(), "solid-native-ios-process-"),
  );
  try {
    const context: NativeIosProcessContext = {
      cwd: path.resolve(options.cwd ?? process.cwd()),
      env: options.env ?? process.env,
      device: options.device,
      dependency,
      directory,
      nextResultIndex: 0,
    };
    return await callback(
      context,
      await queryTarget(context, options.bundleIdentifier),
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

/** Reads only the exact developer-installed application's process state. */
export async function readNativeIosApplicationProcessStatus(
  options: NativeIosProcessOptions,
): Promise<NativeIosApplicationProcessStatus> {
  return withContext(options, async (context, target) => {
    const processIdentifiers = await queryProcesses(
      context,
      target.installationUrl,
    );
    assertUnchangedTarget(
      target,
      await queryTarget(context, options.bundleIdentifier),
    );
    return Object.freeze({
      schemaVersion: 0 as const,
      operation: "status" as const,
      platform: "ios" as const,
      bundleIdentifier: options.bundleIdentifier,
      device: options.device,
      application: target.application,
      running: processIdentifiers.length > 0,
      processCount: processIdentifiers.length,
      processIdentifiers,
    });
  });
}

async function terminateProcess(
  context: NativeIosProcessContext,
  installationUrl: string,
  processIdentifier: number,
): Promise<void> {
  try {
    await runCoreDevice(context, "CoreDevice process termination", [
      "devicectl",
      "device",
      "process",
      "terminate",
      "--device",
      context.device,
      "--pid",
      String(processIdentifier),
      "--quiet",
      "--timeout",
      String(CORE_DEVICE_TIMEOUT_SECONDS),
    ]);
  } catch (error) {
    const remaining = await queryProcesses(context, installationUrl);
    if (!remaining.includes(processIdentifier)) return;
    throw new TypeError(
      `Could not terminate iOS application process ${String(processIdentifier)}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/**
 * Stops every observed generation of one exact developer-installed app, then
 * requires a full one-second clean window before reporting success.
 */
export async function stopNativeIosApplicationProcesses(
  options: NativeIosProcessOptions,
): Promise<NativeIosApplicationProcessStop> {
  return withContext(options, async (context, target) => {
    const stopped = new Set<number>();
    let cleanPolls = 0;
    for (let attempt = 0; attempt < MAX_PROCESS_POLLS; attempt += 1) {
      const processIdentifiers = await queryProcesses(
        context,
        target.installationUrl,
      );
      if (processIdentifiers.length === 0) {
        cleanPolls += 1;
        if (cleanPolls >= PROCESS_CLEAN_STABILITY_POLLS) {
          assertUnchangedTarget(
            target,
            await queryTarget(context, options.bundleIdentifier),
          );
          const stoppedProcessIdentifiers = Object.freeze(
            [...stopped].sort((left, right) => left - right),
          );
          return Object.freeze({
            schemaVersion: 0 as const,
            operation: "stop" as const,
            platform: "ios" as const,
            bundleIdentifier: options.bundleIdentifier,
            device: options.device,
            application: target.application,
            running: false as const,
            stoppedProcessCount: stoppedProcessIdentifiers.length,
            stoppedProcessIdentifiers,
          });
        }
      } else {
        cleanPolls = 0;
        for (const processIdentifier of processIdentifiers) {
          await terminateProcess(
            context,
            target.installationUrl,
            processIdentifier,
          );
          stopped.add(processIdentifier);
        }
      }
      if (attempt + 1 < MAX_PROCESS_POLLS) {
        await context.dependency.wait(PROCESS_POLL_INTERVAL_MS);
      }
    }
    throw new TypeError(
      `iOS application ${options.bundleIdentifier} kept relaunching during bounded process cleanup.`,
    );
  });
}

export function formatNativeIosApplicationProcessStatus(
  status: NativeIosApplicationProcessStatus,
): string {
  if (!status.running) {
    return `${status.bundleIdentifier} is not running on ${status.device}.`;
  }
  return `${status.bundleIdentifier} is running on ${status.device} with ${String(status.processCount)} ${status.processCount === 1 ? "process" : "processes"}: ${status.processIdentifiers.map((identifier) => String(identifier)).join(", ")}.`;
}

export function formatNativeIosApplicationProcessStop(
  result: NativeIosApplicationProcessStop,
): string {
  if (result.stoppedProcessCount === 0) {
    return `${result.bundleIdentifier} was already stopped on ${result.device}; verified a one-second clean window.`;
  }
  return `Stopped ${String(result.stoppedProcessCount)} ${result.stoppedProcessCount === 1 ? "process generation" : "process generations"} for ${result.bundleIdentifier} on ${result.device}; verified a one-second clean window.`;
}
