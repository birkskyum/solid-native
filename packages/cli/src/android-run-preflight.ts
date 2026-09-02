import path from "node:path";

import {
  defaultNativeAndroidLogCommandRunner,
  parseAuthorizedAndroidDevices,
  type NativeAndroidLogCommandResult,
  type NativeAndroidLogCommandRunner,
} from "./android-logs.js";
import {
  acquireNativeAndroidRunLease,
  assertNativeAndroidRunLease,
  prepareNativeAndroidRunLease,
  releaseNativeAndroidRunLease,
  type NativeAndroidRunLease,
  type NativeAndroidRunLeaseDependencies,
} from "./android-run-lease.js";

export type { NativeAndroidRunLease } from "./android-run-lease.js";

const COMMAND_TIMEOUT_MS = 10_000;
const SERIAL_PATTERN = /^[^\0-\x20\x7f]{1,256}$/u;
const STAY_AWAKE_PATTERN = /^(?:null|\d{1,10})$/u;

export type NativeAndroidRunDestinationSelector =
  | Readonly<{ kind: "automatic" }>
  | Readonly<{
      kind: "device" | "deviceId";
      value: string;
    }>;

export type NativeAndroidRunPreflightResult =
  | Readonly<{
      destination: "device";
      serial: string;
      originalStayAwake: string;
      lease: NativeAndroidRunLease;
    }>
  | Readonly<{
      destination: "emulator";
      serial: string;
    }>;

export interface NativeAndroidRunPreflightDependencies extends NativeAndroidRunLeaseDependencies {
  readonly runCommand: NativeAndroidLogCommandRunner;
}

export interface NativeAndroidRunPreflightOptions {
  readonly selector: NativeAndroidRunDestinationSelector;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly dependencies?: Partial<NativeAndroidRunPreflightDependencies>;
}

export interface NativeAndroidRunRestoreOptions {
  readonly result: NativeAndroidRunPreflightResult;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly dependencies?: Partial<NativeAndroidRunPreflightDependencies>;
}

export type NativeAndroidRunPreflight = (
  options: NativeAndroidRunPreflightOptions,
) => Promise<NativeAndroidRunPreflightResult>;

export type NativeAndroidRunRestore = (
  options: NativeAndroidRunRestoreOptions,
) => Promise<void>;

function boundedSerial(value: unknown): string {
  if (typeof value !== "string" || !SERIAL_PATTERN.test(value)) {
    throw new TypeError(
      "Android run destination must be 1-256 non-whitespace characters without control bytes.",
    );
  }
  return value;
}

function commandFailure(
  operation: string,
  result: NativeAndroidLogCommandResult,
): TypeError {
  if (result.timedOut) {
    return new TypeError(
      `${operation} did not finish within ${String(COMMAND_TIMEOUT_MS / 1_000)} seconds. Confirm adb is responsive and the Android device is wired and authorized.`,
    );
  }
  if (result.errorCode === "ENOENT") {
    return new TypeError(
      "Could not start adb. Install Android platform-tools or configure the Android SDK before running a physical application.",
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

async function runAdb(
  runner: NativeAndroidLogCommandRunner,
  cwd: string,
  env: NodeJS.ProcessEnv,
  args: readonly string[],
  operation: string,
): Promise<string> {
  const result = await runner("adb", args, {
    cwd,
    env,
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  if (result.exitCode !== 0 || result.timedOut) {
    throw commandFailure(operation, result);
  }
  return result.stdout.trim();
}

function parseStayAwake(value: string): string {
  if (!STAY_AWAKE_PATTERN.test(value)) {
    throw new TypeError(
      `Android returned an invalid stay-awake setting ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

export function parseNativeAndroidKeyguardShowing(source: string): boolean {
  const states = [...source.matchAll(/\bshowing=(true|false)\b/gu)].map(
    (match) => match[1],
  );
  if (states.length === 0) {
    throw new TypeError(
      "Android window policy did not expose a recognizable keyguard state.",
    );
  }
  return states.includes("true");
}

async function restoreStayAwake(
  runner: NativeAndroidLogCommandRunner,
  cwd: string,
  env: NodeJS.ProcessEnv,
  serial: string,
  originalStayAwake: string,
): Promise<void> {
  const settingArgs =
    originalStayAwake === "null"
      ? [
          "-s",
          serial,
          "shell",
          "settings",
          "delete",
          "global",
          "stay_on_while_plugged_in",
        ]
      : [
          "-s",
          serial,
          "shell",
          "settings",
          "put",
          "global",
          "stay_on_while_plugged_in",
          originalStayAwake,
        ];
  await runAdb(
    runner,
    cwd,
    env,
    settingArgs,
    `Android device ${serial} stay-awake restoration`,
  );
}

/**
 * Validates one explicit Android run target before Gradle starts. Physical
 * devices receive a reversible USB stay-awake lease for the build/install
 * window; emulators only receive availability validation.
 */
export async function preflightNativeAndroidRunDestination(
  options: NativeAndroidRunPreflightOptions,
): Promise<NativeAndroidRunPreflightResult> {
  if (
    options.selector.kind !== "automatic" &&
    options.selector.kind !== "device" &&
    options.selector.kind !== "deviceId"
  ) {
    throw new TypeError(
      "An Android run destination selector must use automatic, device, or deviceId.",
    );
  }
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const runner =
    options.dependencies?.runCommand ?? defaultNativeAndroidLogCommandRunner;
  let serial: string;
  if (options.selector.kind === "automatic") {
    const devices = parseAuthorizedAndroidDevices(
      await runAdb(
        runner,
        cwd,
        env,
        ["devices", "-l"],
        "Android run destination discovery",
      ),
    );
    if (devices.length === 0) {
      throw new TypeError(
        "No authorized Android device or emulator is available. Connect one target or use --list-devices.",
      );
    }
    if (devices.length !== 1) {
      const preview = devices.slice(0, 8).join(", ");
      throw new TypeError(
        `Found ${String(devices.length)} authorized Android targets (${preview}). Pass --device SERIAL or use --list-devices before Gradle starts.`,
      );
    }
    serial = boundedSerial(devices[0]);
  } else {
    serial = boundedSerial(options.selector.value);
  }
  const state = await runAdb(
    runner,
    cwd,
    env,
    ["-s", serial, "get-state"],
    `Android device ${serial}`,
  );
  if (state !== "device") {
    throw new TypeError(
      `Android device ${serial} is unavailable or not authorized.`,
    );
  }
  const qemu = await Promise.all(
    ["ro.kernel.qemu", "ro.boot.qemu"].map((property) =>
      runAdb(
        runner,
        cwd,
        env,
        ["-s", serial, "shell", "getprop", property],
        `Android device ${serial} type lookup`,
      ),
    ),
  );
  if (!qemu.every((value) => value === "" || value === "0" || value === "1")) {
    throw new TypeError(
      `Android device ${serial} returned an invalid emulator identity ${JSON.stringify(qemu)}.`,
    );
  }
  if (qemu.includes("1")) return { destination: "emulator", serial };

  const lease = await acquireNativeAndroidRunLease(
    serial,
    (originalStayAwake) =>
      restoreStayAwake(
        runner,
        cwd,
        env,
        serial,
        parseStayAwake(originalStayAwake),
      ),
    options.dependencies,
  );
  let originalStayAwake: string | undefined;
  let leaseAttempted = false;
  try {
    originalStayAwake = parseStayAwake(
      await runAdb(
        runner,
        cwd,
        env,
        [
          "-s",
          serial,
          "shell",
          "settings",
          "get",
          "global",
          "stay_on_while_plugged_in",
        ],
        `Android device ${serial} stay-awake lookup`,
      ),
    );
    await prepareNativeAndroidRunLease(
      serial,
      lease,
      originalStayAwake,
      options.dependencies,
    );
    // Compensate even when adb reports that the mutating command failed: a
    // remote shell can change the setting before returning a non-zero status.
    leaseAttempted = true;
    await runAdb(
      runner,
      cwd,
      env,
      [
        "-s",
        serial,
        "shell",
        "settings",
        "put",
        "global",
        "stay_on_while_plugged_in",
        "3",
      ],
      `Android device ${serial} stay-awake lease`,
    );
    await runAdb(
      runner,
      cwd,
      env,
      ["-s", serial, "shell", "input", "keyevent", "KEYCODE_WAKEUP"],
      `Android device ${serial} wake-up`,
    );
    await runAdb(
      runner,
      cwd,
      env,
      ["-s", serial, "shell", "wm", "dismiss-keyguard"],
      `Android device ${serial} keyguard dismissal`,
    );
    const policy = await runAdb(
      runner,
      cwd,
      env,
      ["-s", serial, "shell", "dumpsys", "window", "policy"],
      `Android device ${serial} keyguard lookup`,
    );
    if (parseNativeAndroidKeyguardShowing(policy)) {
      throw new TypeError(
        `Android device ${serial} is locked. Unlock it before Solid Native starts the physical build; the CLI keeps an unlocked USB device awake until run-android exits.`,
      );
    }
    return {
      destination: "device",
      serial,
      originalStayAwake,
      lease,
    };
  } catch (error) {
    let cleanupError: unknown;
    try {
      if (leaseAttempted && originalStayAwake !== undefined) {
        await restoreStayAwake(runner, cwd, env, serial, originalStayAwake);
      }
      await releaseNativeAndroidRunLease(serial, lease, options.dependencies);
    } catch (cleanupFailure) {
      cleanupError = cleanupFailure;
    }
    if (cleanupError !== undefined) {
      throw new AggregateError(
        [error, cleanupError],
        `Android device ${serial} preflight failed and its device lease could not be cleaned up.`,
      );
    }
    throw error;
  }
}

/** Restores a physical Android run target after run-android exits or throws. */
export async function restoreNativeAndroidRunDestination(
  options: NativeAndroidRunRestoreOptions,
): Promise<void> {
  if (options.result.destination === "emulator") return;
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const runner =
    options.dependencies?.runCommand ?? defaultNativeAndroidLogCommandRunner;
  const serial = boundedSerial(options.result.serial);
  await assertNativeAndroidRunLease(
    serial,
    options.result.lease,
    options.dependencies,
  );
  await restoreStayAwake(
    runner,
    cwd,
    env,
    serial,
    parseStayAwake(options.result.originalStayAwake),
  );
  await releaseNativeAndroidRunLease(
    serial,
    options.result.lease,
    options.dependencies,
  );
}
