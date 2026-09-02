import { spawn, type ChildProcess } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const COMMAND_TIMEOUT_MS = 12_000;
const CORE_DEVICE_TIMEOUT_SECONDS = 10;
const MAX_COMMAND_OUTPUT = 64 * 1024;
const MAX_CORE_DEVICE_RESULT_BYTES = 1024 * 1024;
const IOS_BUNDLE_IDENTIFIER =
  /^[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9][A-Za-z0-9-]*)+$/u;

export interface NativeIosLogCommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly errorCode?: string;
}

export type NativeIosLogCommandRunner = (
  command: string,
  args: readonly string[],
  context: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly timeoutMs: number;
  },
) => Promise<NativeIosLogCommandResult>;

export interface NativeIosLogsDependencies {
  readonly hostPlatform: NodeJS.Platform;
  readonly runCommand: NativeIosLogCommandRunner;
}

export interface NativeIosLogsOptions {
  readonly bundleIdentifier: string;
  readonly device: string;
  /** Required acknowledgement that CoreDevice replaces the application process. */
  readonly restart: true;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly dependencies?: Partial<NativeIosLogsDependencies>;
}

export interface NativeIosInstalledApplication {
  readonly bundleIdentifier: string;
  readonly name: string;
  readonly version: string;
  readonly builtByDeveloper: true;
}

export interface NativeIosLogsPlan {
  readonly schemaVersion: 0;
  readonly operation: "logs";
  readonly platform: "ios";
  readonly bundleIdentifier: string;
  readonly device: string;
  readonly application: NativeIosInstalledApplication;
  readonly restartsApplication: true;
  readonly includesHistoricalLogs: false;
  readonly cwd: string;
  readonly command: "xcrun";
  readonly args: readonly string[];
}

export type NativeIosLogsExecutor = (
  plan: NativeIosLogsPlan,
  context: { readonly env: NodeJS.ProcessEnv },
) => Promise<number>;

function boundedCommandOutput(current: string, chunk: Buffer): string {
  return `${current}${chunk.toString("utf8")}`.slice(-MAX_COMMAND_OUTPUT);
}

export const defaultNativeIosLogCommandRunner: NativeIosLogCommandRunner = (
  command,
  args,
  context,
) =>
  new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const child = spawn(command, [...args], {
      cwd: context.cwd,
      env: context.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = boundedCommandOutput(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = boundedCommandOutput(stderr, chunk);
    });
    const finish = (result: NativeIosLogCommandResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, context.timeoutMs);
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish({
        exitCode: null,
        stdout,
        stderr: `${stderr}${error.message}`,
        timedOut: false,
        ...(error.code === undefined ? {} : { errorCode: error.code }),
      });
    });
    child.on("close", (exitCode) => {
      finish({ exitCode, stdout, stderr, timedOut });
    });
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
    /[\0\r\n]/u.test(value)
  ) {
    throw new TypeError(
      `${label} must be 1-${String(maximumLength)} characters without control line breaks.`,
    );
  }
  return value;
}

export function parseNativeIosInstalledApplication(
  source: string,
  bundleIdentifier: string,
): NativeIosInstalledApplication {
  if (Buffer.byteLength(source, "utf8") > MAX_CORE_DEVICE_RESULT_BYTES) {
    throw new RangeError(
      `CoreDevice application result exceeds ${String(MAX_CORE_DEVICE_RESULT_BYTES)} bytes.`,
    );
  }
  let document: unknown;
  try {
    document = JSON.parse(source);
  } catch {
    throw new TypeError("CoreDevice returned invalid application JSON.");
  }
  if (
    !isRecord(document) ||
    !isRecord(document.info) ||
    document.info.outcome !== "success" ||
    "error" in document ||
    !isRecord(document.result) ||
    !Array.isArray(document.result.apps)
  ) {
    throw new TypeError(
      "CoreDevice did not return a successful installed-application result.",
    );
  }
  const matches = document.result.apps.filter(
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
  return {
    bundleIdentifier,
    name: boundedString(application.name, "iOS application name", 256),
    version: boundedString(application.version, "iOS application version", 128),
    builtByDeveloper: true,
  };
}

function assertBundleIdentifier(bundleIdentifier: string): void {
  if (
    bundleIdentifier.length > 255 ||
    !IOS_BUNDLE_IDENTIFIER.test(bundleIdentifier)
  ) {
    throw new TypeError(
      `iOS logs require a valid dotted bundle identifier, received ${JSON.stringify(bundleIdentifier)}.`,
    );
  }
}

function assertDevice(device: string): void {
  if (device.length === 0 || device.length > 256 || /[\s\0]/u.test(device)) {
    throw new TypeError(
      "iOS device identifiers must be 1-256 non-whitespace characters.",
    );
  }
}

function commandFailure(result: NativeIosLogCommandResult): TypeError {
  if (result.timedOut) {
    return new TypeError(
      `CoreDevice application lookup did not finish within ${String(COMMAND_TIMEOUT_MS / 1_000)} seconds. Confirm the iPhone is wired, unlocked, and trusted.`,
    );
  }
  if (result.errorCode === "ENOENT") {
    return new TypeError(
      "Could not start xcrun. Install Xcode and select its developer directory before streaming iOS logs.",
    );
  }
  const detail = `${result.stderr}\n${result.stdout}`
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return new TypeError(
    detail === undefined
      ? "CoreDevice application lookup failed without diagnostic output."
      : `CoreDevice application lookup failed: ${detail}`,
  );
}

/** Performs read-only CoreDevice discovery and creates an explicit restart plan. */
export async function createNativeIosLogsPlan(
  options: NativeIosLogsOptions,
): Promise<NativeIosLogsPlan> {
  assertBundleIdentifier(options.bundleIdentifier);
  assertDevice(options.device);
  if (options.restart !== true) {
    throw new TypeError(
      "iOS console streaming requires restart: true because CoreDevice can connect standard streams only while launching the application.",
    );
  }
  const hostPlatform = options.dependencies?.hostPlatform ?? process.platform;
  if (hostPlatform !== "darwin") {
    throw new TypeError(
      `iOS console streaming requires macOS and Xcode; received ${hostPlatform}.`,
    );
  }
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const runner =
    options.dependencies?.runCommand ?? defaultNativeIosLogCommandRunner;
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "solid-native-ios-logs-"),
  );
  const resultPath = path.join(temporaryDirectory, "applications.json");
  try {
    const result = await runner(
      "xcrun",
      [
        "devicectl",
        "device",
        "info",
        "apps",
        "--device",
        options.device,
        "--bundle-id",
        options.bundleIdentifier,
        "--quiet",
        "--timeout",
        String(CORE_DEVICE_TIMEOUT_SECONDS),
        "--json-output",
        resultPath,
      ],
      { cwd, env, timeoutMs: COMMAND_TIMEOUT_MS },
    );
    if (result.exitCode !== 0 || result.timedOut) throw commandFailure(result);
    let source: string;
    try {
      source = await readFile(resultPath, "utf8");
    } catch {
      throw new TypeError(
        "CoreDevice application lookup succeeded without writing its required JSON result.",
      );
    }
    const application = parseNativeIosInstalledApplication(
      source,
      options.bundleIdentifier,
    );
    return {
      schemaVersion: 0,
      operation: "logs",
      platform: "ios",
      bundleIdentifier: options.bundleIdentifier,
      device: options.device,
      application,
      restartsApplication: true,
      includesHistoricalLogs: false,
      cwd,
      command: "xcrun",
      args: [
        "devicectl",
        "device",
        "process",
        "launch",
        "--device",
        options.device,
        "--terminate-existing",
        "--console",
        "--quiet",
        options.bundleIdentifier,
      ],
    };
  } finally {
    await rm(temporaryDirectory, { recursive: true });
  }
}

const FORWARDED_SIGNALS = ["SIGHUP", "SIGINT", "SIGTERM"] as const;

function signalExitCode(signal: NodeJS.Signals | null): number {
  switch (signal) {
    case "SIGHUP":
      return 129;
    case "SIGINT":
      return 130;
    case "SIGTERM":
      return 143;
    default:
      return 1;
  }
}

function forwardSignal(child: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform !== "win32" && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall through after a concurrent CoreDevice exit.
    }
  }
  if (!child.killed) child.kill(signal);
}

export const defaultNativeIosLogsExecutor: NativeIosLogsExecutor = (
  plan,
  context,
) =>
  new Promise((resolve, reject) => {
    const child = spawn(plan.command, [...plan.args], {
      cwd: plan.cwd,
      detached: process.platform !== "win32",
      env: context.env,
      stdio: "inherit",
    });
    let forwardedSignal: NodeJS.Signals | undefined;
    const handlers = new Map<NodeJS.Signals, () => void>();
    const removeHandlers = (): void => {
      for (const [signal, handler] of handlers) {
        process.removeListener(signal, handler);
      }
      handlers.clear();
    };
    for (const signal of FORWARDED_SIGNALS) {
      const handler = (): void => {
        forwardedSignal ??= signal;
        forwardSignal(child, signal);
      };
      handlers.set(signal, handler);
      process.on(signal, handler);
    }
    child.once("error", (error) => {
      removeHandlers();
      reject(error);
    });
    child.once("close", (exitCode, signal) => {
      removeHandlers();
      resolve(
        forwardedSignal === undefined
          ? (exitCode ?? signalExitCode(signal))
          : signalExitCode(forwardedSignal),
      );
    });
  });

export function executeNativeIosLogsPlan(
  plan: NativeIosLogsPlan,
  options: {
    readonly env?: NodeJS.ProcessEnv;
    readonly executor?: NativeIosLogsExecutor;
  } = {},
): Promise<number> {
  return (options.executor ?? defaultNativeIosLogsExecutor)(plan, {
    env: options.env ?? process.env,
  });
}

function quoteArgument(argument: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/u.test(argument)
    ? argument
    : `'${argument.replaceAll("'", `'\\''`)}'`;
}

export function formatNativeIosLogsPlan(plan: NativeIosLogsPlan): string {
  return [plan.command, ...plan.args].map(quoteArgument).join(" ");
}
