import {
  type CausalDebugSnapshot,
  type SolidDiagnosticsDebugEnvelope,
} from "@solid-native/observability";

import {
  captureNativeAndroidCausalDebugSnapshot,
  captureNativeAndroidSolidDiagnostics,
  type CaptureNativeAndroidCausalDebugSnapshotOptions,
  type CaptureNativeAndroidSolidDiagnosticsOptions,
} from "./android-causal-debug.js";
import {
  createNativeCausalDebugReport,
  type CreateNativeCausalDebugReportOptions,
} from "./causal-debug-report.js";
import {
  captureNativeIosCausalDebugSnapshot,
  captureNativeIosSolidDiagnostics,
  type CaptureNativeIosCausalDebugSnapshotOptions,
  type CaptureNativeIosSolidDiagnosticsOptions,
} from "./ios-causal-debug.js";

type AndroidDiagnosticsCapture = (
  options: CaptureNativeAndroidSolidDiagnosticsOptions,
) => Promise<SolidDiagnosticsDebugEnvelope>;

type AndroidSnapshotCapture = (
  options: CaptureNativeAndroidCausalDebugSnapshotOptions,
) => Promise<CausalDebugSnapshot>;

type IosDiagnosticsCapture = (
  options: CaptureNativeIosSolidDiagnosticsOptions,
) => Promise<SolidDiagnosticsDebugEnvelope>;

type IosSnapshotCapture = (
  options: CaptureNativeIosCausalDebugSnapshotOptions,
) => Promise<CausalDebugSnapshot>;

type ReportCreator = (
  snapshot: unknown,
  options?: CreateNativeCausalDebugReportOptions,
) => string;

export interface NativeAndroidLiveCausalDebugReportDependencies {
  readonly captureDiagnostics: AndroidDiagnosticsCapture;
  readonly captureSnapshot: AndroidSnapshotCapture;
  readonly createReport: ReportCreator;
}

export interface NativeIosLiveCausalDebugReportDependencies {
  readonly captureDiagnostics: IosDiagnosticsCapture;
  readonly captureSnapshot: IosSnapshotCapture;
  readonly createReport: ReportCreator;
}

export interface CaptureNativeAndroidCausalDebugReportOptions extends Omit<
  CaptureNativeAndroidSolidDiagnosticsOptions,
  "dependencies"
> {
  /** Explicitly include application-authored causal attributes in the report. */
  readonly includeAttributes?: boolean;
  /** @internal Injectable orchestration boundary for deterministic tests. */
  readonly dependencies?: Partial<NativeAndroidLiveCausalDebugReportDependencies>;
}

export interface CaptureNativeIosCausalDebugReportOptions extends Omit<
  CaptureNativeIosSolidDiagnosticsOptions,
  "dependencies"
> {
  /** Explicitly include application-authored causal attributes in the report. */
  readonly includeAttributes?: boolean;
  /** @internal Injectable orchestration boundary for deterministic tests. */
  readonly dependencies?: Partial<NativeIosLiveCausalDebugReportDependencies>;
}

const defaultAndroidDependencies: NativeAndroidLiveCausalDebugReportDependencies =
  {
    captureDiagnostics: captureNativeAndroidSolidDiagnostics,
    captureSnapshot: captureNativeAndroidCausalDebugSnapshot,
    createReport: createNativeCausalDebugReport,
  };

const defaultIosDependencies: NativeIosLiveCausalDebugReportDependencies = {
  captureDiagnostics: captureNativeIosSolidDiagnostics,
  captureSnapshot: captureNativeIosCausalDebugSnapshot,
  createReport: createNativeCausalDebugReport,
};

function assertOptions(
  value: unknown,
  platform: "Android" | "iOS",
): asserts value is Readonly<{ includeAttributes?: boolean }> {
  if (typeof value !== "object" || value === null) {
    throw new TypeError(
      `${platform} causal debug report options are required.`,
    );
  }
  const includeAttributes = (value as { includeAttributes?: unknown })
    .includeAttributes;
  if (
    includeAttributes !== undefined &&
    typeof includeAttributes !== "boolean"
  ) {
    throw new TypeError(
      `${platform} causal debug report includeAttributes must be a boolean.`,
    );
  }
}

function resolveDependencies<T extends object>(
  defaults: T,
  overrides: Partial<T> | undefined,
  platform: "Android" | "iOS",
): T {
  if (
    overrides !== undefined &&
    (typeof overrides !== "object" || overrides === null)
  ) {
    throw new TypeError(
      `${platform} causal debug report dependencies must be an object.`,
    );
  }
  const resolved = { ...defaults, ...overrides };
  for (const [name, dependency] of Object.entries(resolved)) {
    if (typeof dependency !== "function") {
      throw new TypeError(
        `${platform} causal debug report dependency ${name} must be a function.`,
      );
    }
  }
  return resolved;
}

/**
 * Captures one Solid attribution window followed by the containing Android
 * causal timeline, then returns a validated self-contained offline report.
 */
export async function captureNativeAndroidCausalDebugReport(
  options: CaptureNativeAndroidCausalDebugReportOptions,
): Promise<string> {
  assertOptions(options, "Android");
  const dependency = resolveDependencies(
    defaultAndroidDependencies,
    options.dependencies,
    "Android",
  );
  const captureOptions = {
    packageName: options.packageName,
    serial: options.serial,
    ...(options.timeoutMs === undefined
      ? {}
      : { timeoutMs: options.timeoutMs }),
  } as const;
  const diagnostics = await dependency.captureDiagnostics({
    ...captureOptions,
    ...(options.durationMs === undefined
      ? {}
      : { durationMs: options.durationMs }),
  });
  const snapshot = await dependency.captureSnapshot(captureOptions);
  return dependency.createReport(snapshot, {
    diagnostics,
    ...(options.includeAttributes === undefined
      ? {}
      : { includeAttributes: options.includeAttributes }),
  });
}

/**
 * Captures one Solid attribution window followed by the containing iOS causal
 * timeline, then returns a validated self-contained offline report.
 */
export async function captureNativeIosCausalDebugReport(
  options: CaptureNativeIosCausalDebugReportOptions,
): Promise<string> {
  assertOptions(options, "iOS");
  const dependency = resolveDependencies(
    defaultIosDependencies,
    options.dependencies,
    "iOS",
  );
  const captureOptions = {
    bundleIdentifier: options.bundleIdentifier,
    device: options.device,
    ...(options.timeoutMs === undefined
      ? {}
      : { timeoutMs: options.timeoutMs }),
  } as const;
  const diagnostics = await dependency.captureDiagnostics({
    ...captureOptions,
    ...(options.durationMs === undefined
      ? {}
      : { durationMs: options.durationMs }),
  });
  const snapshot = await dependency.captureSnapshot(captureOptions);
  return dependency.createReport(snapshot, {
    diagnostics,
    ...(options.includeAttributes === undefined
      ? {}
      : { includeAttributes: options.includeAttributes }),
  });
}
