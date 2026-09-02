import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  defaultNativeIosLogCommandRunner,
  type NativeIosLogCommandResult,
  type NativeIosLogCommandRunner,
} from "./ios-logs.js";

const COMMAND_TIMEOUT_MS = 12_000;
const CORE_DEVICE_TIMEOUT_SECONDS = 10;
const MAX_RESULT_BYTES = 1024 * 1024;

export type NativeIosRunDestinationSelector = Readonly<{
  kind: "device" | "udid";
  value: string;
}>;

export interface NativeIosDeviceLockState {
  readonly deviceIdentifier: string;
  readonly passcodeRequired: boolean;
  readonly unlockedSinceBoot: boolean;
}

export type NativeIosRunPreflightResult =
  | Readonly<{
      destination: "device";
      lockState: NativeIosDeviceLockState;
    }>
  | Readonly<{
      destination: "simulator";
      deviceIdentifier: string;
    }>;

export interface NativeIosRunPreflightOptions {
  readonly selector: NativeIosRunDestinationSelector;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly dependencies?: Partial<{
    readonly hostPlatform: NodeJS.Platform;
    readonly runCommand: NativeIosLogCommandRunner;
  }>;
}

export type NativeIosRunPreflight = (
  options: NativeIosRunPreflightOptions,
) => Promise<NativeIosRunPreflightResult>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertBoundedResult(source: string, label: string): void {
  if (Buffer.byteLength(source, "utf8") > MAX_RESULT_BYTES) {
    throw new RangeError(
      `${label} exceeds ${String(MAX_RESULT_BYTES)} UTF-8 bytes.`,
    );
  }
}

function parseJson(source: string, label: string): unknown {
  assertBoundedResult(source, label);
  try {
    return JSON.parse(source);
  } catch {
    throw new TypeError(`${label} is not valid JSON.`);
  }
}

function boundedIdentifier(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > 256 ||
    /[\0\r\n]/u.test(value)
  ) {
    throw new TypeError(
      `${label} must be 1-256 characters without nulls or line breaks.`,
    );
  }
  return value;
}

export function parseNativeIosDeviceLockState(
  source: string,
): NativeIosDeviceLockState {
  const document = parseJson(source, "CoreDevice lock-state result");
  if (
    !isRecord(document) ||
    !isRecord(document.info) ||
    document.info.outcome !== "success" ||
    "error" in document ||
    !isRecord(document.result) ||
    typeof document.result.passcodeRequired !== "boolean" ||
    typeof document.result.unlockedSinceBoot !== "boolean"
  ) {
    throw new TypeError(
      "CoreDevice did not return a successful, complete iOS lock state.",
    );
  }
  return {
    deviceIdentifier: boundedIdentifier(
      document.result.deviceIdentifier,
      "CoreDevice device identifier",
    ),
    passcodeRequired: document.result.passcodeRequired,
    unlockedSinceBoot: document.result.unlockedSinceBoot,
  };
}

export function parseNativeIosSimulatorIdentifiers(
  source: string,
): Set<string> {
  const document = parseJson(source, "CoreSimulator device result");
  if (!isRecord(document) || !isRecord(document.devices)) {
    throw new TypeError(
      "CoreSimulator did not return a complete device inventory.",
    );
  }
  const identifiers = new Set<string>();
  for (const devices of Object.values(document.devices)) {
    if (!Array.isArray(devices)) {
      throw new TypeError(
        "CoreSimulator did not return a complete device inventory.",
      );
    }
    for (const device of devices) {
      if (!isRecord(device)) {
        throw new TypeError(
          "CoreSimulator returned an invalid device inventory entry.",
        );
      }
      identifiers.add(
        boundedIdentifier(device.udid, "CoreSimulator device identifier"),
      );
    }
  }
  return identifiers;
}

function commandFailure(
  operation: string,
  result: NativeIosLogCommandResult,
): TypeError {
  if (result.timedOut) {
    return new TypeError(
      `${operation} did not finish within ${String(COMMAND_TIMEOUT_MS / 1_000)} seconds. Connect the iPhone by USB, unlock it, confirm Trust if prompted, and wait until Xcode shows it online.`,
    );
  }
  if (result.errorCode === "ENOENT") {
    return new TypeError(
      "Could not start xcrun. Install Xcode and select its developer directory before running an iOS application.",
    );
  }
  const combined = `${result.stderr}\n${result.stdout}`;
  if (/Developer Mode[^\n]*disabled/iu.test(combined)) {
    return new TypeError(
      "Developer Mode is disabled on the iPhone. Enable it in Privacy & Security before running a physical application.",
    );
  }
  if (
    /tunnel (?:connection )?failed|tunnel was interrupted|RemotePairingError|Network\.NWError|Operation timed out/iu.test(
      combined,
    )
  ) {
    return new TypeError(
      "CoreDevice could not establish the iPhone developer-services tunnel. Connect the phone by USB, unlock it, confirm Trust if prompted, and wait until Xcode shows it online.",
    );
  }
  if (/kAMDMobileImageMounterDeviceLocked|device is locked/iu.test(combined)) {
    return lockedDeviceFailure();
  }
  const detail = combined
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return new TypeError(
    detail === undefined
      ? `${operation} failed without diagnostic output.`
      : `${operation} failed: ${detail}`,
  );
}

function lockedDeviceFailure(): TypeError {
  return new TypeError(
    "The iPhone is locked. Unlock it and keep its display awake before Solid Native starts the physical build.",
  );
}

async function runCommand(
  runner: NativeIosLogCommandRunner,
  cwd: string,
  env: NodeJS.ProcessEnv,
  args: readonly string[],
  operation: string,
): Promise<NativeIosLogCommandResult> {
  const result = await runner("xcrun", args, {
    cwd,
    env,
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  if (result.exitCode !== 0 || result.timedOut) {
    throw commandFailure(operation, result);
  }
  return result;
}

async function readRequiredResult(
  filePath: string,
  label: string,
): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    throw new TypeError(`${label} succeeded without writing its JSON result.`);
  }
}

/**
 * Resolves an explicit React Native iOS destination and rejects a locked
 * physical device before Metro, CocoaPods, or Xcode starts.
 */
export async function preflightNativeIosRunDestination(
  options: NativeIosRunPreflightOptions,
): Promise<NativeIosRunPreflightResult> {
  if (options.selector.kind !== "device" && options.selector.kind !== "udid") {
    throw new TypeError(
      "An iOS run destination selector must use device or udid.",
    );
  }
  const selector = {
    kind: options.selector.kind,
    value: boundedIdentifier(
      options.selector.value,
      "iOS run destination selector",
    ),
  } as const;
  const hostPlatform = options.dependencies?.hostPlatform ?? process.platform;
  if (hostPlatform !== "darwin") {
    throw new TypeError(
      `An iOS run preflight requires macOS and Xcode; received ${hostPlatform}.`,
    );
  }
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const runner =
    options.dependencies?.runCommand ?? defaultNativeIosLogCommandRunner;
  const directory = await mkdtemp(
    path.join(tmpdir(), "solid-native-ios-run-preflight-"),
  );
  try {
    if (selector.kind === "udid") {
      const simulatorResult = await runCommand(
        runner,
        cwd,
        env,
        ["simctl", "list", "devices", "available", "--json"],
        "CoreSimulator device lookup",
      );
      const simulatorIdentifiers = parseNativeIosSimulatorIdentifiers(
        simulatorResult.stdout,
      );
      if (simulatorIdentifiers.has(selector.value)) {
        return {
          destination: "simulator",
          deviceIdentifier: selector.value,
        };
      }
    }

    const lockStatePath = path.join(directory, "lock-state.json");
    await runCommand(
      runner,
      cwd,
      env,
      [
        "devicectl",
        "device",
        "info",
        "lockState",
        "--device",
        selector.value,
        "--quiet",
        "--timeout",
        String(CORE_DEVICE_TIMEOUT_SECONDS),
        "--json-output",
        lockStatePath,
      ],
      "CoreDevice lock-state lookup",
    );
    const lockState = parseNativeIosDeviceLockState(
      await readRequiredResult(lockStatePath, "CoreDevice lock-state lookup"),
    );
    if (lockState.passcodeRequired || !lockState.unlockedSinceBoot) {
      throw lockedDeviceFailure();
    }
    return { destination: "device", lockState };
  } finally {
    await rm(directory, { recursive: true });
  }
}
