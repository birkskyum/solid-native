import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { TextDecoder } from "node:util";

import {
  SOLID_DIAGNOSTICS_DEBUG_MAX_SERIALIZED_BYTES,
  type CausalDebugSnapshot,
  type SolidDiagnosticsDebugEnvelope,
} from "@solid-native/observability";

import {
  NATIVE_CAUSAL_DEBUG_MAX_INPUT_BYTES,
  parseNativeCausalDebugSnapshotBytes,
} from "./causal-debug.js";
import {
  parseNativeSolidDiagnosticsControlBytes,
  parseNativeSolidDiagnosticsDebugBytes,
} from "./solid-diagnostics-debug.js";

export const NATIVE_IOS_CAUSAL_DEBUG_DEFAULT_TIMEOUT_MS = 10_000;
export const NATIVE_IOS_CAUSAL_DEBUG_MIN_TIMEOUT_MS = 5_000;
export const NATIVE_IOS_CAUSAL_DEBUG_MAX_TIMEOUT_MS = 30_000;
export const NATIVE_IOS_CAUSAL_DEBUG_URL_SCHEME = "solid-native-debug" as const;
export const NATIVE_IOS_SOLID_DIAGNOSTICS_DEFAULT_DURATION_MS = 1_000;
export const NATIVE_IOS_SOLID_DIAGNOSTICS_MAX_DURATION_MS = 30_000;

const OPERATION_CAUSAL_SNAPSHOT = "causal-snapshot" as const;
const OPERATION_SOLID_DIAGNOSTICS_BEGIN = "solid-diagnostics-begin" as const;
const OPERATION_SOLID_DIAGNOSTICS_END = "solid-diagnostics-end" as const;

type NativeIosDebugOperation =
  | typeof OPERATION_CAUSAL_SNAPSHOT
  | typeof OPERATION_SOLID_DIAGNOSTICS_BEGIN
  | typeof OPERATION_SOLID_DIAGNOSTICS_END;

const BUNDLE_IDENTIFIER_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9][A-Za-z0-9-]*)+$/u;
const REQUEST_ID_PATTERN = /^[a-f0-9]{32}$/u;
const POLL_INTERVAL_MS = 100;
const COMMAND_TIMEOUT_MS = 5_000;
const CORE_DEVICE_RESULT_MAX_BYTES = 1_048_576;

export interface NativeIosCausalDebugCommandResult {
  readonly exitCode: number | null;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  readonly timedOut: boolean;
  readonly errorCode?: string;
}

export type NativeIosCausalDebugCommandRunner = (
  command: string,
  args: readonly string[],
  options: Readonly<{ timeoutMs: number }>,
) => Promise<NativeIosCausalDebugCommandResult>;

export interface NativeIosCausalDebugDependencies {
  readonly createRequestId: () => string;
  readonly now: () => number;
  readonly runCommand: NativeIosCausalDebugCommandRunner;
  readonly wait: (milliseconds: number) => Promise<void>;
}

export interface CaptureNativeIosCausalDebugSnapshotOptions {
  readonly bundleIdentifier: string;
  readonly device: string;
  readonly timeoutMs?: number;
  readonly dependencies?: Partial<NativeIosCausalDebugDependencies>;
}

export interface CaptureNativeIosSolidDiagnosticsOptions extends CaptureNativeIosCausalDebugSnapshotOptions {
  readonly durationMs?: number;
}

interface CaptureNativeIosDebugResponseOptions extends CaptureNativeIosCausalDebugSnapshotOptions {
  readonly operation: NativeIosDebugOperation;
  readonly requestId?: string;
  readonly sessionId?: string;
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
    (value as number) < NATIVE_IOS_CAUSAL_DEBUG_MIN_TIMEOUT_MS ||
    (value as number) > NATIVE_IOS_CAUSAL_DEBUG_MAX_TIMEOUT_MS
  ) {
    throw new TypeError(
      `iOS causal-debug timeout must be a safe integer from ${NATIVE_IOS_CAUSAL_DEBUG_MIN_TIMEOUT_MS} through ${NATIVE_IOS_CAUSAL_DEBUG_MAX_TIMEOUT_MS} milliseconds.`,
    );
  }
  return value as number;
}

function durationMilliseconds(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > NATIVE_IOS_SOLID_DIAGNOSTICS_MAX_DURATION_MS
  ) {
    throw new TypeError(
      `iOS Solid diagnostics duration must be a safe integer from 1 through ${NATIVE_IOS_SOLID_DIAGNOSTICS_MAX_DURATION_MS} milliseconds.`,
    );
  }
  return value as number;
}

function defaultRunCommand(
  command: string,
  args: readonly string[],
  options: Readonly<{ timeoutMs: number }>,
): Promise<NativeIosCausalDebugCommandResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      [...args],
      {
        encoding: "buffer",
        maxBuffer: 1_048_576,
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
  overrides: CaptureNativeIosCausalDebugSnapshotOptions["dependencies"],
): NativeIosCausalDebugDependencies {
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
  result: NativeIosCausalDebugCommandResult,
): TypeError {
  const detail = decode(
    result.stderr.byteLength === 0 ? result.stdout : result.stderr,
    `${label} diagnostic output`,
  ).trim();
  return new TypeError(`${label} failed${detail === "" ? "." : `: ${detail}`}`);
}

function parseCoreDeviceSuccess(bytes: Uint8Array, label: string): void {
  if (bytes.byteLength > CORE_DEVICE_RESULT_MAX_BYTES) {
    throw new RangeError(
      `${label} CoreDevice result exceeds ${CORE_DEVICE_RESULT_MAX_BYTES} bytes.`,
    );
  }
  let document: unknown;
  try {
    document = JSON.parse(decode(bytes, `${label} CoreDevice result`));
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError(`${label} returned invalid CoreDevice JSON.`);
  }
  if (
    typeof document !== "object" ||
    document === null ||
    !("info" in document) ||
    typeof document.info !== "object" ||
    document.info === null ||
    !("outcome" in document.info) ||
    document.info.outcome !== "success" ||
    "error" in document
  ) {
    throw new TypeError(
      `${label} did not return a successful CoreDevice result.`,
    );
  }
}

function captureRequestUrl(
  requestId: string,
  operation: NativeIosDebugOperation,
  sessionId: string | undefined,
): string {
  return `${NATIVE_IOS_CAUSAL_DEBUG_URL_SCHEME}://capture?requestId=${requestId}&operation=${operation}${sessionId === undefined ? "" : `&sessionId=${sessionId}`}`;
}

function acknowledgementUrl(requestId: string): string {
  return `${NATIVE_IOS_CAUSAL_DEBUG_URL_SCHEME}://ack?requestId=${requestId}`;
}

async function captureNativeIosDebugResponse<Result>(
  options: CaptureNativeIosDebugResponseOptions,
  parse: (bytes: Uint8Array) => Result,
): Promise<Result> {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("iOS causal-debug capture options are required.");
  }
  const bundleIdentifier = boundedIdentifier(
    options.bundleIdentifier,
    "iOS bundle identifier",
    255,
  );
  if (!BUNDLE_IDENTIFIER_PATTERN.test(bundleIdentifier)) {
    throw new TypeError("iOS bundle identifier is invalid.");
  }
  const device = boundedIdentifier(
    options.device,
    "iOS device identifier",
    256,
  );
  const timeoutMs = timeoutMilliseconds(
    options.timeoutMs ?? NATIVE_IOS_CAUSAL_DEBUG_DEFAULT_TIMEOUT_MS,
  );
  const dependency = dependencies(options.dependencies);
  const requestId = options.requestId ?? dependency.createRequestId();
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new TypeError(
      "iOS causal-debug request IDs must contain exactly 32 lowercase hexadecimal characters.",
    );
  }
  const sessionId = options.sessionId;
  if (
    options.operation === OPERATION_SOLID_DIAGNOSTICS_END
      ? typeof sessionId !== "string" || !REQUEST_ID_PATTERN.test(sessionId)
      : sessionId !== undefined
  ) {
    throw new TypeError(
      "iOS native-debug session IDs must bind diagnostics end to one begin request.",
    );
  }
  const startedAt = dependency.now();
  if (!Number.isFinite(startedAt) || startedAt < 0) {
    throw new TypeError("iOS causal-debug clock returned an invalid time.");
  }

  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "solid-native-ios-debug-"),
  );
  const responsePath = path.join(temporaryDirectory, `${requestId}.json`);
  let commandIndex = 0;
  let requested = false;
  let captured = false;
  const runDevicectl = async (
    args: readonly string[],
    commandTimeoutMs: number,
    trailingArguments: readonly string[] = [],
  ) => {
    const resultPath = path.join(
      temporaryDirectory,
      `devicectl-${String(commandIndex)}.json`,
    );
    commandIndex += 1;
    const result = await dependency.runCommand(
      "xcrun",
      [
        "devicectl",
        ...args,
        "--quiet",
        "--timeout",
        String(
          Math.max(
            NATIVE_IOS_CAUSAL_DEBUG_MIN_TIMEOUT_MS / 1_000,
            Math.ceil(commandTimeoutMs / 1_000),
          ),
        ),
        "--json-output",
        resultPath,
        ...trailingArguments,
      ],
      {
        timeoutMs:
          Math.max(NATIVE_IOS_CAUSAL_DEBUG_MIN_TIMEOUT_MS, commandTimeoutMs) +
          1_000,
      },
    );
    if (result.exitCode === 0 && !result.timedOut) {
      parseCoreDeviceSuccess(
        new Uint8Array(await readFile(resultPath)),
        "iOS causal-debug command",
      );
    }
    return result;
  };
  const launch = (url: string, commandTimeoutMs = COMMAND_TIMEOUT_MS) =>
    runDevicectl(
      ["device", "process", "launch", "--device", device, "--payload-url", url],
      commandTimeoutMs,
      [bundleIdentifier],
    );

  try {
    const request = await launch(
      captureRequestUrl(requestId, options.operation, sessionId),
      Math.min(COMMAND_TIMEOUT_MS, timeoutMs),
    );
    if (request.exitCode !== 0 || request.timedOut) {
      throw commandFailure("iOS causal-debug snapshot request", request);
    }
    requested = true;

    while (true) {
      await rm(responsePath, { force: true });
      const now = dependency.now();
      if (!Number.isFinite(now) || now < startedAt) {
        throw new TypeError("iOS causal-debug clock returned an invalid time.");
      }
      const remaining = timeoutMs - (now - startedAt);
      if (remaining <= 0) {
        throw new TypeError(
          `The debuggable iOS application did not publish causal-debug request ${requestId} within ${timeoutMs} milliseconds.`,
        );
      }
      const response = await runDevicectl(
        [
          "device",
          "copy",
          "from",
          "--device",
          device,
          "--source",
          `Library/Caches/solid-native-debug/${requestId}.json`,
          "--destination",
          responsePath,
          "--domain-type",
          "appDataContainer",
          "--domain-identifier",
          bundleIdentifier,
        ],
        Math.min(COMMAND_TIMEOUT_MS, remaining),
      );
      if (response.exitCode === 0 && !response.timedOut) {
        const file = await stat(responsePath);
        if (!file.isFile()) {
          throw new TypeError(
            "The iOS causal-debug response is not a regular file.",
          );
        }
        const maximumResponseBytes =
          options.operation === OPERATION_CAUSAL_SNAPSHOT
            ? NATIVE_CAUSAL_DEBUG_MAX_INPUT_BYTES
            : SOLID_DIAGNOSTICS_DEBUG_MAX_SERIALIZED_BYTES;
        if (file.size === 0 || file.size > maximumResponseBytes) {
          throw new RangeError(
            `The iOS native debug response must contain 1-${String(maximumResponseBytes)} bytes.`,
          );
        }
        const snapshot = parse(new Uint8Array(await readFile(responsePath)));
        captured = true;
        return snapshot;
      }
      const afterCopy = dependency.now();
      if (!Number.isFinite(afterCopy) || afterCopy < startedAt) {
        throw new TypeError("iOS causal-debug clock returned an invalid time.");
      }
      if (afterCopy - startedAt >= timeoutMs) {
        throw new TypeError(
          `The debuggable iOS application did not publish causal-debug request ${requestId} within ${timeoutMs} milliseconds.`,
        );
      }
      await dependency.wait(
        Math.min(POLL_INTERVAL_MS, timeoutMs - (afterCopy - startedAt)),
      );
    }
  } finally {
    let acknowledgementError: unknown;
    if (requested) {
      try {
        const acknowledgement = await launch(acknowledgementUrl(requestId));
        if (acknowledgement.exitCode !== 0 || acknowledgement.timedOut) {
          throw commandFailure(
            "iOS causal-debug snapshot acknowledgement",
            acknowledgement,
          );
        }
      } catch (error) {
        acknowledgementError = error;
      }
    }
    await rm(temporaryDirectory, { force: true, recursive: true });
    if (captured && acknowledgementError !== undefined) {
      throw acknowledgementError;
    }
  }
}

/** Requests, validates, acknowledges, and consumes one iOS app-private snapshot. */
export async function captureNativeIosCausalDebugSnapshot(
  options: CaptureNativeIosCausalDebugSnapshotOptions,
): Promise<CausalDebugSnapshot> {
  return captureNativeIosDebugResponse(
    { ...options, operation: OPERATION_CAUSAL_SNAPSHOT },
    parseNativeCausalDebugSnapshotBytes,
  );
}

/** Captures one bounded, value-free Solid attribution window on iOS. */
export async function captureNativeIosSolidDiagnostics(
  options: CaptureNativeIosSolidDiagnosticsOptions,
): Promise<SolidDiagnosticsDebugEnvelope> {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("iOS Solid diagnostics capture options are required.");
  }
  const durationMs = durationMilliseconds(
    options.durationMs ?? NATIVE_IOS_SOLID_DIAGNOSTICS_DEFAULT_DURATION_MS,
  );
  const dependency = dependencies(options.dependencies);
  const sharedOptions = {
    bundleIdentifier: options.bundleIdentifier,
    device: options.device,
    ...(options.timeoutMs === undefined
      ? {}
      : { timeoutMs: options.timeoutMs }),
    dependencies: dependency,
  } as const;
  const sessionId = dependency.createRequestId();
  let mayOwnSession = true;
  let ended = false;
  try {
    const begin = await captureNativeIosDebugResponse(
      {
        ...sharedOptions,
        operation: OPERATION_SOLID_DIAGNOSTICS_BEGIN,
        requestId: sessionId,
      },
      (bytes) =>
        parseNativeSolidDiagnosticsControlBytes(
          bytes,
          OPERATION_SOLID_DIAGNOSTICS_BEGIN,
        ),
    );
    if (!begin.ok) {
      mayOwnSession = false;
      throw new TypeError(
        `The iOS application rejected Solid diagnostics capture (${begin.error ?? "unknown"}).`,
      );
    }
    if (!begin.active) {
      throw new TypeError(
        "The iOS application acknowledged Solid diagnostics without activating capture.",
      );
    }
    await dependency.wait(durationMs);
    const envelope = await captureNativeIosDebugResponse(
      {
        ...sharedOptions,
        operation: OPERATION_SOLID_DIAGNOSTICS_END,
        sessionId,
      },
      parseNativeSolidDiagnosticsDebugBytes,
    );
    ended = true;
    return envelope;
  } finally {
    if (mayOwnSession && !ended) {
      try {
        await captureNativeIosDebugResponse(
          {
            ...sharedOptions,
            operation: OPERATION_SOLID_DIAGNOSTICS_END,
            sessionId,
          },
          (bytes) => bytes,
        );
      } catch {
        // Preserve the primary capture failure after a bounded best-effort stop.
      }
    }
  }
}
