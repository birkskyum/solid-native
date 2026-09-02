import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

const COMMAND_TIMEOUT_MS = 10_000;
const MAX_COMMAND_OUTPUT = 64 * 1024;
const ANDROID_PACKAGE_NAME =
  /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/u;
const PRINTABLE_LOGCAT_TIME = /^[\x20-\x7e]{1,128}$/u;

export interface NativeAndroidLogCommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly errorCode?: string;
}

export type NativeAndroidLogCommandRunner = (
  command: string,
  args: readonly string[],
  context: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly timeoutMs: number;
  },
) => Promise<NativeAndroidLogCommandResult>;

export interface NativeAndroidLogsDependencies {
  readonly runCommand: NativeAndroidLogCommandRunner;
}

export interface NativeAndroidLogsOptions {
  readonly packageName: string;
  readonly serial?: string;
  /** A logcat -T time or count. Defaults to one retained line before streaming. */
  readonly since?: string;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly dependencies?: Partial<NativeAndroidLogsDependencies>;
}

export interface NativeAndroidLogsPlan {
  readonly schemaVersion: 0;
  readonly operation: "logs";
  readonly platform: "android";
  readonly packageName: string;
  readonly serial: string;
  readonly uid: number;
  readonly since: string;
  readonly cwd: string;
  readonly command: "adb";
  readonly args: readonly string[];
}

export type NativeAndroidLogsExecutor = (
  plan: NativeAndroidLogsPlan,
  context: { readonly env: NodeJS.ProcessEnv },
) => Promise<number>;

function boundedCommandOutput(current: string, chunk: Buffer): string {
  return `${current}${chunk.toString("utf8")}`.slice(-MAX_COMMAND_OUTPUT);
}

export const defaultNativeAndroidLogCommandRunner: NativeAndroidLogCommandRunner =
  (command, args, context) =>
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
      const finish = (result: NativeAndroidLogCommandResult): void => {
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

function commandFailure(
  operation: string,
  result: NativeAndroidLogCommandResult,
): TypeError {
  if (result.timedOut) {
    return new TypeError(
      `${operation} did not finish within ${String(COMMAND_TIMEOUT_MS / 1_000)} seconds.`,
    );
  }
  if (result.errorCode === "ENOENT") {
    return new TypeError(
      `${operation} could not start adb. Install Android platform-tools and put adb on PATH.`,
    );
  }
  const detail = `${result.stderr}\n${result.stdout}`
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return new TypeError(
    detail === undefined
      ? `${operation} failed without diagnostic output.`
      : `${operation} failed: ${detail}`,
  );
}

function assertCommandPassed(
  operation: string,
  result: NativeAndroidLogCommandResult,
): void {
  if (result.exitCode !== 0 || result.timedOut) {
    throw commandFailure(operation, result);
  }
}

export function parseAuthorizedAndroidDevices(
  output: string,
): readonly string[] {
  const devices: string[] = [];
  const seen = new Set<string>();
  for (const line of output.split(/\r?\n/u)) {
    const match = /^(\S+)\s+device(?:\s|$)/u.exec(line.trim());
    const serial = match?.[1];
    if (serial !== undefined && !seen.has(serial)) {
      seen.add(serial);
      devices.push(serial);
    }
  }
  return devices;
}

export function parseAndroidPackageUid(
  output: string,
  packageName: string,
): number | undefined {
  const matches: number[] = [];
  for (const line of output.split(/\r?\n/u)) {
    const match = /^package:(\S+)\s+uid:(\d+)$/u.exec(line.trim());
    if (match?.[1] !== packageName) continue;
    const uid = Number(match[2]);
    if (Number.isSafeInteger(uid) && uid > 0) matches.push(uid);
  }
  return matches.length === 1 ? matches[0] : undefined;
}

function assertPackageName(packageName: string): void {
  if (!ANDROID_PACKAGE_NAME.test(packageName) || packageName.length > 255) {
    throw new TypeError(
      `Android logs require a valid dotted application package, received ${JSON.stringify(packageName)}.`,
    );
  }
}

function assertSerial(serial: string): void {
  if (serial.length === 0 || serial.length > 256 || /[\s\0]/u.test(serial)) {
    throw new TypeError(
      "Android device serials must be 1-256 non-whitespace characters.",
    );
  }
}

function assertSince(since: string): void {
  if (!PRINTABLE_LOGCAT_TIME.test(since)) {
    throw new TypeError(
      "Android log history must be a 1-128 character printable logcat -T time or count.",
    );
  }
}

async function runAdb(
  runner: NativeAndroidLogCommandRunner,
  cwd: string,
  env: NodeJS.ProcessEnv,
  args: readonly string[],
  operation: string,
): Promise<NativeAndroidLogCommandResult> {
  const result = await runner("adb", args, {
    cwd,
    env,
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  assertCommandPassed(operation, result);
  return result;
}

export async function createNativeAndroidLogsPlan(
  options: NativeAndroidLogsOptions,
): Promise<NativeAndroidLogsPlan> {
  assertPackageName(options.packageName);
  const since = options.since ?? "1";
  assertSince(since);
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const runner =
    options.dependencies?.runCommand ?? defaultNativeAndroidLogCommandRunner;

  let serial = options.serial;
  if (serial === undefined) {
    const result = await runAdb(
      runner,
      cwd,
      env,
      ["devices"],
      "Android device discovery",
    );
    const devices = parseAuthorizedAndroidDevices(result.stdout);
    if (devices.length !== 1) {
      throw new TypeError(
        `Expected exactly one authorized Android device; found ${String(devices.length)}. Pass --serial ID when more than one device is attached.`,
      );
    }
    serial = devices[0];
  }
  if (serial === undefined) {
    throw new TypeError("Android device discovery returned no serial.");
  }
  assertSerial(serial);
  const state = await runAdb(
    runner,
    cwd,
    env,
    ["-s", serial, "get-state"],
    `Android device ${serial}`,
  );
  if (state.stdout.trim() !== "device") {
    throw new TypeError(
      `Android device ${serial} is unavailable or not authorized.`,
    );
  }
  const packageResult = await runAdb(
    runner,
    cwd,
    env,
    [
      "-s",
      serial,
      "shell",
      "cmd",
      "package",
      "list",
      "packages",
      "-U",
      options.packageName,
    ],
    `Android package lookup for ${options.packageName}`,
  );
  const uid = parseAndroidPackageUid(packageResult.stdout, options.packageName);
  if (uid === undefined) {
    throw new TypeError(
      `Android package ${options.packageName} is not installed exactly once on ${serial}.`,
    );
  }
  return {
    schemaVersion: 0,
    operation: "logs",
    platform: "android",
    packageName: options.packageName,
    serial,
    uid,
    since,
    cwd,
    command: "adb",
    args: [
      "-s",
      serial,
      "logcat",
      `--uid=${String(uid)}`,
      "-v",
      "threadtime",
      "-T",
      since,
    ],
  };
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
      // Fall through when the detached process group has already exited.
    }
  }
  if (!child.killed) child.kill(signal);
}

export const defaultNativeAndroidLogsExecutor: NativeAndroidLogsExecutor = (
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

export function executeNativeAndroidLogsPlan(
  plan: NativeAndroidLogsPlan,
  options: {
    readonly env?: NodeJS.ProcessEnv;
    readonly executor?: NativeAndroidLogsExecutor;
  } = {},
): Promise<number> {
  return (options.executor ?? defaultNativeAndroidLogsExecutor)(plan, {
    env: options.env ?? process.env,
  });
}

function quoteArgument(argument: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/u.test(argument)
    ? argument
    : `'${argument.replaceAll("'", `'\\''`)}'`;
}

export function formatNativeAndroidLogsPlan(
  plan: NativeAndroidLogsPlan,
): string {
  return [plan.command, ...plan.args].map(quoteArgument).join(" ");
}
