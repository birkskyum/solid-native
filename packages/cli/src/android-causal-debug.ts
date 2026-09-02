import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { TextDecoder } from "node:util";

import { type CausalDebugSnapshot } from "@solid-native/observability";

import {
  NATIVE_CAUSAL_DEBUG_MAX_INPUT_BYTES,
  parseNativeCausalDebugSnapshotBytes,
} from "./causal-debug.js";
import {
  parseNativeSolidDiagnosticsControlBytes,
  parseNativeSolidDiagnosticsDebugBytes,
} from "./solid-diagnostics-debug.js";

export const NATIVE_ANDROID_CAUSAL_DEBUG_DEFAULT_TIMEOUT_MS = 5_000;
export const NATIVE_ANDROID_CAUSAL_DEBUG_MAX_TIMEOUT_MS = 30_000;
export const NATIVE_ANDROID_CAUSAL_DEBUG_REQUEST_EVENT =
  "solidnative.DEBUG_SNAPSHOT_REQUEST" as const;
export const NATIVE_ANDROID_SOLID_DIAGNOSTICS_DEFAULT_DURATION_MS = 1_000;
export const NATIVE_ANDROID_SOLID_DIAGNOSTICS_MAX_DURATION_MS = 30_000;

const OPERATION_CAUSAL_SNAPSHOT = "causal-snapshot" as const;
const OPERATION_SOLID_DIAGNOSTICS_BEGIN = "solid-diagnostics-begin" as const;
const OPERATION_SOLID_DIAGNOSTICS_END = "solid-diagnostics-end" as const;

type NativeAndroidDebugOperation =
  | typeof OPERATION_CAUSAL_SNAPSHOT
  | typeof OPERATION_SOLID_DIAGNOSTICS_BEGIN
  | typeof OPERATION_SOLID_DIAGNOSTICS_END;

const PACKAGE_NAME_PATTERN =
  /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/u;
const REQUEST_ID_PATTERN = /^[a-f0-9]{32}$/u;
const POLL_INTERVAL_MS = 50;
const COMMAND_TIMEOUT_MS = 5_000;

export interface NativeAndroidCausalDebugCommandResult {
  readonly exitCode: number | null;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  readonly timedOut: boolean;
  readonly errorCode?: string;
}

export type NativeAndroidCausalDebugCommandRunner = (
  command: string,
  args: readonly string[],
  options: Readonly<{ timeoutMs: number }>,
) => Promise<NativeAndroidCausalDebugCommandResult>;

export interface NativeAndroidCausalDebugDependencies {
  readonly createRequestId: () => string;
  readonly now: () => number;
  readonly runCommand: NativeAndroidCausalDebugCommandRunner;
  readonly wait: (milliseconds: number) => Promise<void>;
}

export interface CaptureNativeAndroidCausalDebugSnapshotOptions {
  readonly packageName: string;
  readonly serial: string;
  readonly timeoutMs?: number;
  readonly dependencies?: Partial<NativeAndroidCausalDebugDependencies>;
}

export interface CaptureNativeAndroidSolidDiagnosticsOptions extends CaptureNativeAndroidCausalDebugSnapshotOptions {
  readonly durationMs?: number;
}

interface CaptureNativeAndroidDebugResponseOptions extends CaptureNativeAndroidCausalDebugSnapshotOptions {
  readonly operation: NativeAndroidDebugOperation;
  readonly requestId?: string;
  readonly sessionId?: string;
}

interface NativeAndroidDebugResponse {
  readonly requestId: string;
  readonly bytes: Uint8Array;
}

function boundedIdentifier(
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

function timeoutMilliseconds(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > NATIVE_ANDROID_CAUSAL_DEBUG_MAX_TIMEOUT_MS
  ) {
    throw new TypeError(
      `Android causal-debug timeout must be a safe integer from 1 through ${NATIVE_ANDROID_CAUSAL_DEBUG_MAX_TIMEOUT_MS} milliseconds.`,
    );
  }
  return value as number;
}

function durationMilliseconds(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > NATIVE_ANDROID_SOLID_DIAGNOSTICS_MAX_DURATION_MS
  ) {
    throw new TypeError(
      `Android Solid diagnostics duration must be a safe integer from 1 through ${NATIVE_ANDROID_SOLID_DIAGNOSTICS_MAX_DURATION_MS} milliseconds.`,
    );
  }
  return value as number;
}

function defaultRunCommand(
  command: string,
  args: readonly string[],
  options: Readonly<{ timeoutMs: number }>,
): Promise<NativeAndroidCausalDebugCommandResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      [...args],
      {
        encoding: "buffer",
        maxBuffer: NATIVE_CAUSAL_DEBUG_MAX_INPUT_BYTES + 1,
        timeout: options.timeoutMs,
      },
      (error, stdout, stderr) => {
        const commandError = error as
          (NodeJS.ErrnoException & { readonly killed?: boolean }) | null;
        resolve({
          exitCode:
            commandError === null
              ? 0
              : typeof commandError.code === "number"
                ? commandError.code
                : null,
          stdout: new Uint8Array(stdout),
          stderr: new Uint8Array(stderr),
          timedOut: commandError?.killed === true,
          ...(typeof commandError?.code === "string"
            ? { errorCode: commandError.code }
            : {}),
        });
      },
    );
  });
}

function dependencies(
  overrides: CaptureNativeAndroidCausalDebugSnapshotOptions["dependencies"],
): NativeAndroidCausalDebugDependencies {
  return {
    createRequestId:
      overrides?.createRequestId ?? (() => randomBytes(16).toString("hex")),
    now: overrides?.now ?? (() => Date.now()),
    runCommand: overrides?.runCommand ?? defaultRunCommand,
    wait:
      overrides?.wait ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds))),
  };
}

function decode(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new TypeError(`${label} must be valid UTF-8.`);
  }
}

function commandFailure(
  label: string,
  result: NativeAndroidCausalDebugCommandResult,
): TypeError {
  const detail = decode(
    result.stderr.byteLength === 0 ? result.stdout : result.stderr,
    `${label} diagnostic output`,
  ).trim();
  return new TypeError(`${label} failed${detail === "" ? "." : `: ${detail}`}`);
}

async function captureNativeAndroidDebugResponse(
  options: CaptureNativeAndroidDebugResponseOptions,
): Promise<NativeAndroidDebugResponse> {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("Android causal-debug capture options are required.");
  }
  const packageName = boundedIdentifier(
    options.packageName,
    "Android application ID",
    255,
  );
  if (!PACKAGE_NAME_PATTERN.test(packageName)) {
    throw new TypeError("Android application ID is invalid.");
  }
  const serial = boundedIdentifier(
    options.serial,
    "Android device serial",
    256,
  );
  const timeoutMs = timeoutMilliseconds(
    options.timeoutMs ?? NATIVE_ANDROID_CAUSAL_DEBUG_DEFAULT_TIMEOUT_MS,
  );
  const dependency = dependencies(options.dependencies);
  const requestId = options.requestId ?? dependency.createRequestId();
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new TypeError(
      "Android causal-debug request IDs must contain exactly 32 lowercase hexadecimal characters.",
    );
  }
  const sessionId = options.sessionId;
  if (
    options.operation === OPERATION_SOLID_DIAGNOSTICS_END
      ? typeof sessionId !== "string" || !REQUEST_ID_PATTERN.test(sessionId)
      : sessionId !== undefined
  ) {
    throw new TypeError(
      "Android native-debug session IDs must bind diagnostics end to one begin request.",
    );
  }
  const startedAt = dependency.now();
  if (!Number.isFinite(startedAt) || startedAt < 0) {
    throw new TypeError("Android causal-debug clock returned an invalid time.");
  }

  const adb = (...args: readonly string[]) =>
    dependency.runCommand("adb", ["-s", serial, ...args], {
      timeoutMs: Math.min(COMMAND_TIMEOUT_MS, timeoutMs),
    });
  const state = await adb("get-state");
  if (
    state.exitCode !== 0 ||
    state.timedOut ||
    decode(state.stdout, "adb device state").trim() !== "device"
  ) {
    throw commandFailure("Android device connection", state);
  }

  const appData = await adb("shell", "run-as", packageName, "pwd");
  if (appData.exitCode !== 0 || appData.timedOut) {
    throw new TypeError(
      `Android application ${JSON.stringify(packageName)} must be installed as a debuggable build on the selected device.`,
    );
  }

  const currentUser = await adb("shell", "am", "get-current-user");
  const userId = decode(currentUser.stdout, "Android current user").trim();
  if (
    currentUser.exitCode !== 0 ||
    currentUser.timedOut ||
    !/^(?:0|[1-9][0-9]{0,9})$/u.test(userId)
  ) {
    throw commandFailure("Android current-user lookup", currentUser);
  }

  const responsePath = `cache/solid-native-debug/${requestId}.json`;
  const action = `${packageName}.${NATIVE_ANDROID_CAUSAL_DEBUG_REQUEST_EVENT}`;
  const request = await adb(
    "shell",
    "run-as",
    packageName,
    "am",
    "broadcast",
    "--user",
    userId,
    "-a",
    action,
    "--es",
    "requestId",
    requestId,
    "--es",
    "operation",
    options.operation,
    ...(sessionId === undefined ? [] : ["--es", "sessionId", sessionId]),
    "-p",
    packageName,
  );
  if (request.exitCode !== 0 || request.timedOut) {
    throw commandFailure("Android causal-debug snapshot request", request);
  }

  try {
    while (true) {
      const response = await adb(
        "exec-out",
        "run-as",
        packageName,
        "cat",
        responsePath,
      );
      if (response.exitCode === 0 && !response.timedOut) {
        if (
          response.stdout.byteLength === 0 ||
          response.stdout.byteLength > NATIVE_CAUSAL_DEBUG_MAX_INPUT_BYTES
        ) {
          throw new RangeError(
            `The native Android debug response must contain 1-${String(NATIVE_CAUSAL_DEBUG_MAX_INPUT_BYTES)} bytes.`,
          );
        }
        return { requestId, bytes: response.stdout };
      }
      const now = dependency.now();
      if (!Number.isFinite(now) || now < startedAt) {
        throw new TypeError(
          "Android causal-debug clock returned an invalid time.",
        );
      }
      if (now - startedAt >= timeoutMs) {
        throw new TypeError(
          `The debuggable Android application did not publish causal-debug request ${requestId} within ${timeoutMs} milliseconds.`,
        );
      }
      await dependency.wait(
        Math.min(POLL_INTERVAL_MS, timeoutMs - (now - startedAt)),
      );
    }
  } finally {
    await adb("shell", "run-as", packageName, "rm", "-f", responsePath);
  }
}

/** Requests, validates, and consumes one app-private snapshot from a debuggable Android app. */
export async function captureNativeAndroidCausalDebugSnapshot(
  options: CaptureNativeAndroidCausalDebugSnapshotOptions,
): Promise<CausalDebugSnapshot> {
  return parseNativeCausalDebugSnapshotBytes(
    (
      await captureNativeAndroidDebugResponse({
        ...options,
        operation: OPERATION_CAUSAL_SNAPSHOT,
      })
    ).bytes,
  );
}

/** Captures one bounded, value-free Solid attribution window on Android. */
export async function captureNativeAndroidSolidDiagnostics(
  options: CaptureNativeAndroidSolidDiagnosticsOptions,
): Promise<
  import("@solid-native/observability").SolidDiagnosticsDebugEnvelope
> {
  if (typeof options !== "object" || options === null) {
    throw new TypeError(
      "Android Solid diagnostics capture options are required.",
    );
  }
  const durationMs = durationMilliseconds(
    options.durationMs ?? NATIVE_ANDROID_SOLID_DIAGNOSTICS_DEFAULT_DURATION_MS,
  );
  const dependency = dependencies(options.dependencies);
  const sharedOptions = {
    packageName: options.packageName,
    serial: options.serial,
    ...(options.timeoutMs === undefined
      ? {}
      : { timeoutMs: options.timeoutMs }),
    dependencies: dependency,
  } as const;
  const sessionId = dependency.createRequestId();
  let mayOwnSession = true;
  let ended = false;
  try {
    const beginResponse = await captureNativeAndroidDebugResponse({
      ...sharedOptions,
      operation: OPERATION_SOLID_DIAGNOSTICS_BEGIN,
      requestId: sessionId,
    });
    const begin = parseNativeSolidDiagnosticsControlBytes(
      beginResponse.bytes,
      OPERATION_SOLID_DIAGNOSTICS_BEGIN,
    );
    if (!begin.ok) {
      mayOwnSession = false;
      throw new TypeError(
        `The Android application rejected Solid diagnostics capture (${begin.error ?? "unknown"}).`,
      );
    }
    if (!begin.active) {
      throw new TypeError(
        "The Android application acknowledged Solid diagnostics without activating capture.",
      );
    }
    await dependency.wait(durationMs);
    const envelope = parseNativeSolidDiagnosticsDebugBytes(
      (
        await captureNativeAndroidDebugResponse({
          ...sharedOptions,
          operation: OPERATION_SOLID_DIAGNOSTICS_END,
          sessionId,
        })
      ).bytes,
    );
    ended = true;
    return envelope;
  } finally {
    if (mayOwnSession && !ended) {
      try {
        await captureNativeAndroidDebugResponse({
          ...sharedOptions,
          operation: OPERATION_SOLID_DIAGNOSTICS_END,
          sessionId,
        });
      } catch {
        // Preserve the primary capture failure after a bounded best-effort stop.
      }
    }
  }
}
