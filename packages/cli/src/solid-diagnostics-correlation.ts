import { open } from "node:fs/promises";
import path from "node:path";

import {
  SOLID_DIAGNOSTICS_DEBUG_MAX_SERIALIZED_BYTES,
  correlateNativeSolidDiagnostics,
  type CorrelateNativeSolidDiagnosticsOptions,
  type NativeSolidDiagnosticsCorrelation,
} from "@solid-native/observability";

import { readNativeCausalDebugSnapshotFile } from "./causal-debug.js";
import { parseNativeSolidDiagnosticsDebugBytes } from "./solid-diagnostics-debug.js";

export {
  NATIVE_SOLID_DIAGNOSTICS_CORRELATION_KIND,
  NATIVE_SOLID_DIAGNOSTICS_CORRELATION_MODE,
  NATIVE_SOLID_DIAGNOSTICS_CORRELATION_SCHEMA_VERSION,
  NATIVE_SOLID_DIAGNOSTICS_CORRELATION_WINDOW_TOLERANCE_MS,
  correlateNativeSolidDiagnostics,
  type CorrelateNativeSolidDiagnosticsOptions,
  type NativeSolidDiagnosticsCorrelatedOutput,
  type NativeSolidDiagnosticsCorrelation,
} from "@solid-native/observability";

export interface CorrelateNativeSolidDiagnosticsFilesOptions extends CorrelateNativeSolidDiagnosticsOptions {
  readonly diagnosticsPath: string;
  readonly snapshotPath: string;
  readonly cwd?: string;
}

async function readDiagnosticsArtifact(filePath: string): Promise<Uint8Array> {
  const handle = await open(filePath, "r");
  try {
    const file = await handle.stat();
    if (!file.isFile()) {
      throw new TypeError(
        "The Solid diagnostics correlation artifact path must be a file.",
      );
    }
    if (file.size > SOLID_DIAGNOSTICS_DEBUG_MAX_SERIALIZED_BYTES) {
      throw new RangeError(
        `The Solid diagnostics artifact exceeds ${String(SOLID_DIAGNOSTICS_DEBUG_MAX_SERIALIZED_BYTES)} bytes.`,
      );
    }
    const buffer = Buffer.allocUnsafe(
      SOLID_DIAGNOSTICS_DEBUG_MAX_SERIALIZED_BYTES + 1,
    );
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        null,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > SOLID_DIAGNOSTICS_DEBUG_MAX_SERIALIZED_BYTES) {
      throw new RangeError(
        `The Solid diagnostics artifact exceeds ${String(SOLID_DIAGNOSTICS_DEBUG_MAX_SERIALIZED_BYTES)} bytes.`,
      );
    }
    return buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

export async function readNativeSolidDiagnosticsDebugFile(
  artifactPath: string,
  cwd = process.cwd(),
) {
  if (typeof artifactPath !== "string" || artifactPath.length === 0) {
    throw new TypeError(
      "Solid diagnostics artifactPath must be a non-empty string.",
    );
  }
  if (typeof cwd !== "string" || cwd.length === 0) {
    throw new TypeError("Solid diagnostics artifact cwd must be a path.");
  }
  return parseNativeSolidDiagnosticsDebugBytes(
    await readDiagnosticsArtifact(path.resolve(cwd, artifactPath)),
  );
}

export async function correlateNativeSolidDiagnosticsFiles(
  options: CorrelateNativeSolidDiagnosticsFilesOptions,
): Promise<NativeSolidDiagnosticsCorrelation> {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("Solid diagnostics correlation options are required.");
  }
  if (
    typeof options.diagnosticsPath !== "string" ||
    options.diagnosticsPath.length === 0 ||
    typeof options.snapshotPath !== "string" ||
    options.snapshotPath.length === 0
  ) {
    throw new TypeError(
      "Solid diagnostics correlation requires diagnosticsPath and snapshotPath.",
    );
  }
  const cwd = options.cwd ?? process.cwd();
  if (typeof cwd !== "string" || cwd.length === 0) {
    throw new TypeError("Solid diagnostics correlation cwd must be a path.");
  }
  const [diagnostics, snapshot] = await Promise.all([
    readNativeSolidDiagnosticsDebugFile(options.diagnosticsPath, cwd),
    readNativeCausalDebugSnapshotFile(options.snapshotPath, cwd),
  ]);
  return correlateNativeSolidDiagnostics(diagnostics, snapshot, options);
}

function milliseconds(value: number): string {
  return `${value.toFixed(3)} ms`;
}

export function formatNativeSolidDiagnosticsCorrelation(
  correlation: NativeSolidDiagnosticsCorrelation,
): string {
  const lines = [
    "Solid Native diagnostics/native correlation",
    `Mode: ${correlation.correlationMode} (exact per-rerun join: no)`,
    `Window: ${milliseconds(correlation.diagnosticsDurationMilliseconds)} (${correlation.captureWindowFullyObserved ? "fully observed" : "snapshot captured before window end"})`,
    `Outputs: ${String(correlation.correlatedOutputCount)} correlated, ${String(correlation.completeOutputCount)} with complete native frame chains, ${String(correlation.unmatchedOutputNames.length)} unmatched`,
  ];
  for (const output of correlation.outputs) {
    lines.push(
      `  ${output.name}: ${String(output.rerunCount)} reruns (${String(output.changedRerunCount)} changed), ${String(output.nativeComputationOperationIds.length)} native computations, ${String(output.nativeCommitOperationIds.length)} commits, ${String(output.nativeMountOperationIds.length)} mounts, ${String(output.nativeFrameOperationIds.length)} frames${output.causeNames.length === 0 ? "" : `; causes: ${output.causeNames.join(", ")}`}`,
    );
  }
  return lines.join("\n");
}
