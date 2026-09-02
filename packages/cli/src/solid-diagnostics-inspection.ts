import { open } from "node:fs/promises";
import path from "node:path";

import {
  SOLID_DIAGNOSTICS_DEBUG_MAX_SERIALIZED_BYTES,
  parseSolidDiagnosticsDebugEnvelope,
  type SolidDiagnosticsDebugEnvelope,
  type SolidDiagnosticsDebugScopeCost,
  type SolidDiagnosticsDebugWriteCost,
} from "@solid-native/observability";

import { parseNativeSolidDiagnosticsDebugBytes } from "./solid-diagnostics-debug.js";

export const NATIVE_SOLID_DIAGNOSTICS_INSPECTION_KIND =
  "solid-native.solid-diagnostics-debug-inspection" as const;
export const NATIVE_SOLID_DIAGNOSTICS_INSPECTION_SCHEMA_VERSION = 0 as const;
export const NATIVE_SOLID_DIAGNOSTICS_INSPECTION_MAX_RANKED_COSTS = 20;
export const NATIVE_SOLID_DIAGNOSTICS_MAX_INPUT_CHUNKS = 4_096;

export type NativeSolidDiagnosticsInputStream = AsyncIterable<
  Uint8Array | string
>;

export interface NativeSolidDiagnosticsInspection {
  readonly schemaVersion: typeof NATIVE_SOLID_DIAGNOSTICS_INSPECTION_SCHEMA_VERSION;
  readonly kind: typeof NATIVE_SOLID_DIAGNOSTICS_INSPECTION_KIND;
  readonly capturedAt: string;
  readonly durationMilliseconds: number;
  readonly truncated: boolean;
  readonly droppedDiagnostics: number;
  readonly diagnosticCount: number;
  readonly diagnosticCodeCounts: Readonly<Record<string, number>>;
  readonly warnDiagnosticCount: number;
  readonly errorDiagnosticCount: number;
  readonly rerunCount: number;
  readonly changedRerunCount: number;
  readonly unchangedRerunCount: number;
  readonly heldRerunCount: number;
  readonly causeCount: number;
  readonly totalScopeRuns: number;
  readonly totalScopeSelfMilliseconds: number;
  readonly totalWastedMilliseconds: number;
  readonly totalOverlayMilliseconds: number;
  readonly totalWriteRuns: number;
  readonly totalDownstreamMilliseconds: number;
  readonly hottestScopes: readonly SolidDiagnosticsDebugScopeCost[];
  readonly hottestWrites: readonly SolidDiagnosticsDebugWriteCost[];
}

export interface InspectNativeSolidDiagnosticsFileOptions {
  readonly artifactPath: string;
  readonly cwd?: string;
}

function finiteSum(values: readonly number[], label: string): number {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isFinite(total)) {
      throw new RangeError(
        `${label} cannot be represented as a finite number.`,
      );
    }
  }
  return total;
}

function safeIntegerSum(values: readonly number[], label: string): number {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isSafeInteger(total)) {
      throw new RangeError(`${label} exceeds the safe-integer range.`);
    }
  }
  return total;
}

function causeCount(envelope: SolidDiagnosticsDebugEnvelope): number {
  let count = 0;
  const pending = envelope.reruns.flatMap((rerun) => [...rerun.causes]);
  while (pending.length > 0) {
    const cause = pending.pop();
    if (cause === undefined) continue;
    count += 1;
    if (cause.causes !== undefined) pending.push(...cause.causes);
  }
  return count;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function rankedScopes(
  costs: readonly SolidDiagnosticsDebugScopeCost[],
): readonly SolidDiagnosticsDebugScopeCost[] {
  return Object.freeze(
    [...costs]
      .sort(
        (left, right) =>
          right.selfMilliseconds - left.selfMilliseconds ||
          compareText(left.name, right.name) ||
          compareText(left.kind, right.kind),
      )
      .slice(0, NATIVE_SOLID_DIAGNOSTICS_INSPECTION_MAX_RANKED_COSTS),
  );
}

function rankedWrites(
  costs: readonly SolidDiagnosticsDebugWriteCost[],
): readonly SolidDiagnosticsDebugWriteCost[] {
  return Object.freeze(
    [...costs]
      .sort(
        (left, right) =>
          right.downstreamMilliseconds - left.downstreamMilliseconds ||
          compareText(left.name, right.name),
      )
      .slice(0, NATIVE_SOLID_DIAGNOSTICS_INSPECTION_MAX_RANKED_COSTS),
  );
}

/** Summarizes one detached value-free device artifact without adding data. */
export function inspectNativeSolidDiagnostics(
  value: unknown,
): NativeSolidDiagnosticsInspection {
  const envelope = parseSolidDiagnosticsDebugEnvelope(value);
  const codeCounts: Record<string, number> = Object.create(null) as Record<
    string,
    number
  >;
  let warnDiagnosticCount = 0;
  let errorDiagnosticCount = 0;
  for (const diagnostic of envelope.diagnostics) {
    codeCounts[diagnostic.code] = (codeCounts[diagnostic.code] ?? 0) + 1;
    if (diagnostic.severity === "warn") warnDiagnosticCount += 1;
    else errorDiagnosticCount += 1;
  }
  const diagnosticCodeCounts = Object.freeze(
    Object.fromEntries(
      Object.entries(codeCounts).sort(([left], [right]) =>
        compareText(left, right),
      ),
    ),
  );
  const changedRerunCount = envelope.reruns.filter(
    (rerun) => rerun.changed,
  ).length;
  const heldRerunCount = envelope.reruns.filter((rerun) => rerun.held).length;
  return Object.freeze({
    schemaVersion: NATIVE_SOLID_DIAGNOSTICS_INSPECTION_SCHEMA_VERSION,
    kind: NATIVE_SOLID_DIAGNOSTICS_INSPECTION_KIND,
    capturedAt: envelope.capturedAt,
    durationMilliseconds: envelope.durationMilliseconds,
    truncated: envelope.truncated,
    droppedDiagnostics: envelope.droppedDiagnostics,
    diagnosticCount: envelope.diagnostics.length,
    diagnosticCodeCounts,
    warnDiagnosticCount,
    errorDiagnosticCount,
    rerunCount: envelope.reruns.length,
    changedRerunCount,
    unchangedRerunCount: envelope.reruns.length - changedRerunCount,
    heldRerunCount,
    causeCount: causeCount(envelope),
    totalScopeRuns: safeIntegerSum(
      envelope.scopeCosts.map((cost) => cost.runs),
      "Solid diagnostics total scope runs",
    ),
    totalScopeSelfMilliseconds: finiteSum(
      envelope.scopeCosts.map((cost) => cost.selfMilliseconds),
      "Solid diagnostics total scope self time",
    ),
    totalWastedMilliseconds: finiteSum(
      envelope.scopeCosts.map((cost) => cost.wastedMilliseconds),
      "Solid diagnostics total wasted time",
    ),
    totalOverlayMilliseconds: finiteSum(
      envelope.scopeCosts.map((cost) => cost.overlayMilliseconds),
      "Solid diagnostics total overlay time",
    ),
    totalWriteRuns: safeIntegerSum(
      envelope.writeCosts.map((cost) => cost.runs),
      "Solid diagnostics total write runs",
    ),
    totalDownstreamMilliseconds: finiteSum(
      envelope.writeCosts.map((cost) => cost.downstreamMilliseconds),
      "Solid diagnostics total downstream time",
    ),
    hottestScopes: rankedScopes(envelope.scopeCosts),
    hottestWrites: rankedWrites(envelope.writeCosts),
  });
}

async function readBoundedArtifactFile(filePath: string): Promise<Uint8Array> {
  const handle = await open(filePath, "r");
  try {
    const file = await handle.stat();
    if (!file.isFile()) {
      throw new TypeError(
        "The Solid diagnostics artifact path must be a file.",
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

export async function inspectNativeSolidDiagnosticsFile(
  options: InspectNativeSolidDiagnosticsFileOptions,
): Promise<NativeSolidDiagnosticsInspection> {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("Solid diagnostics inspection options are required.");
  }
  if (
    typeof options.artifactPath !== "string" ||
    options.artifactPath.length === 0
  ) {
    throw new TypeError(
      "Solid diagnostics artifactPath must be a non-empty string.",
    );
  }
  const cwd = options.cwd ?? process.cwd();
  if (typeof cwd !== "string" || cwd.length === 0) {
    throw new TypeError("Solid diagnostics inspection cwd must be a path.");
  }
  return inspectNativeSolidDiagnostics(
    parseNativeSolidDiagnosticsDebugBytes(
      await readBoundedArtifactFile(path.resolve(cwd, options.artifactPath)),
    ),
  );
}

export async function inspectNativeSolidDiagnosticsStream(
  stream: NativeSolidDiagnosticsInputStream,
): Promise<NativeSolidDiagnosticsInspection> {
  if (
    stream === null ||
    (typeof stream !== "object" && typeof stream !== "function") ||
    typeof stream[Symbol.asyncIterator] !== "function"
  ) {
    throw new TypeError(
      "Solid diagnostics input stream must be async iterable.",
    );
  }
  const chunks: Buffer[] = [];
  let byteLength = 0;
  let chunkCount = 0;
  for await (const chunk of stream) {
    chunkCount += 1;
    if (chunkCount > NATIVE_SOLID_DIAGNOSTICS_MAX_INPUT_CHUNKS) {
      throw new RangeError(
        `Solid diagnostics input exceeds ${String(NATIVE_SOLID_DIAGNOSTICS_MAX_INPUT_CHUNKS)} chunks.`,
      );
    }
    let bytes: Buffer;
    if (typeof chunk === "string") bytes = Buffer.from(chunk, "utf8");
    else if (chunk instanceof Uint8Array) bytes = Buffer.from(chunk);
    else {
      throw new TypeError(
        "Solid diagnostics input chunks must be strings or Uint8Array values.",
      );
    }
    byteLength += bytes.byteLength;
    if (byteLength > SOLID_DIAGNOSTICS_DEBUG_MAX_SERIALIZED_BYTES) {
      throw new RangeError(
        `The Solid diagnostics artifact exceeds ${String(SOLID_DIAGNOSTICS_DEBUG_MAX_SERIALIZED_BYTES)} bytes.`,
      );
    }
    chunks.push(bytes);
  }
  return inspectNativeSolidDiagnostics(
    parseNativeSolidDiagnosticsDebugBytes(Buffer.concat(chunks, byteLength)),
  );
}

function milliseconds(value: number): string {
  return `${value.toFixed(3)} ms`;
}

export function formatNativeSolidDiagnosticsInspection(
  inspection: NativeSolidDiagnosticsInspection,
): string {
  const codes = Object.entries(inspection.diagnosticCodeCounts)
    .map(([code, count]) => `${code}: ${String(count)}`)
    .join(", ");
  const lines = [
    "PASS Solid Native diagnostics artifact",
    `Captured: ${inspection.capturedAt}`,
    `Window: ${milliseconds(inspection.durationMilliseconds)}${inspection.truncated ? " (truncated)" : ""}`,
    `Diagnostics: ${String(inspection.diagnosticCount)} (${String(inspection.warnDiagnosticCount)} warn, ${String(inspection.errorDiagnosticCount)} error, ${String(inspection.droppedDiagnostics)} dropped)`,
    `Codes: ${codes === "" ? "none" : codes}`,
    `Reruns: ${String(inspection.rerunCount)} (${String(inspection.changedRerunCount)} changed, ${String(inspection.unchangedRerunCount)} unchanged, ${String(inspection.heldRerunCount)} held, ${String(inspection.causeCount)} retained causes)`,
    `Scope cost: ${milliseconds(inspection.totalScopeSelfMilliseconds)} (${milliseconds(inspection.totalWastedMilliseconds)} wasted, ${milliseconds(inspection.totalOverlayMilliseconds)} overlay) across ${String(inspection.totalScopeRuns)} runs`,
    `Write cost: ${milliseconds(inspection.totalDownstreamMilliseconds)} downstream across ${String(inspection.totalWriteRuns)} runs`,
  ];
  if (inspection.hottestScopes.length > 0) {
    lines.push(
      "Hottest scopes:",
      ...inspection.hottestScopes.map(
        (cost) =>
          `  ${cost.kind} ${cost.name}: ${milliseconds(cost.selfMilliseconds)} self, ${String(cost.runs)} runs`,
      ),
    );
  }
  if (inspection.hottestWrites.length > 0) {
    lines.push(
      "Hottest writes:",
      ...inspection.hottestWrites.map(
        (cost) =>
          `  ${cost.name}: ${milliseconds(cost.downstreamMilliseconds)} downstream, ${String(cost.runs)} runs`,
      ),
    );
  }
  return lines.join("\n");
}
