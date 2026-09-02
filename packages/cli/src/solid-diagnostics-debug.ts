import { TextDecoder } from "node:util";

import {
  SOLID_DIAGNOSTICS_DEBUG_MAX_SERIALIZED_BYTES,
  parseSolidDiagnosticsDebugEnvelope,
  type SolidDiagnosticsDebugEnvelope,
} from "@solid-native/observability";

export const NATIVE_SOLID_DIAGNOSTICS_CONTROL_KIND =
  "solid-native.solid-diagnostics-debug-control" as const;
export const NATIVE_SOLID_DIAGNOSTICS_CONTROL_SCHEMA_VERSION = 0 as const;

export type NativeSolidDiagnosticsOperation =
  "solid-diagnostics-begin" | "solid-diagnostics-end";

export interface NativeSolidDiagnosticsControl {
  readonly schemaVersion: typeof NATIVE_SOLID_DIAGNOSTICS_CONTROL_SCHEMA_VERSION;
  readonly kind: typeof NATIVE_SOLID_DIAGNOSTICS_CONTROL_KIND;
  readonly operation: NativeSolidDiagnosticsOperation;
  readonly ok: boolean;
  readonly active: boolean;
  readonly error?: "unavailable" | "invalid-state" | "capture-failed";
}

function decodeDocument(bytes: Uint8Array, label: string): unknown {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError(`${label} must be bytes.`);
  }
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > SOLID_DIAGNOSTICS_DEBUG_MAX_SERIALIZED_BYTES
  ) {
    throw new RangeError(
      `${label} must contain 1-${String(SOLID_DIAGNOSTICS_DEBUG_MAX_SERIALIZED_BYTES)} bytes.`,
    );
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new TypeError(`${label} must be valid UTF-8.`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new TypeError(`${label} must be valid JSON.`);
  }
}

function strictRecord(
  value: unknown,
  properties: readonly string[],
  label: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const result = value as Record<string, unknown>;
  const keys = Object.keys(result);
  if (
    keys.length !== properties.length ||
    keys.some((key) => !properties.includes(key)) ||
    properties.some((key) => !Object.hasOwn(result, key))
  ) {
    throw new TypeError(`${label} has an invalid property set.`);
  }
  return result;
}

export function parseNativeSolidDiagnosticsControlBytes(
  bytes: Uint8Array,
  expectedOperation: NativeSolidDiagnosticsOperation,
): NativeSolidDiagnosticsControl {
  if (
    expectedOperation !== "solid-diagnostics-begin" &&
    expectedOperation !== "solid-diagnostics-end"
  ) {
    throw new TypeError(
      "Expected Solid diagnostics control operation is invalid.",
    );
  }
  const document = decodeDocument(bytes, "Solid diagnostics control response");
  const candidate = document as Record<string, unknown>;
  const hasError =
    document !== null &&
    typeof document === "object" &&
    Object.hasOwn(candidate, "error");
  const source = strictRecord(
    document,
    [
      "schemaVersion",
      "kind",
      "operation",
      "ok",
      "active",
      ...(hasError ? ["error"] : []),
    ],
    "Solid diagnostics control response",
  );
  if (
    source.schemaVersion !== NATIVE_SOLID_DIAGNOSTICS_CONTROL_SCHEMA_VERSION
  ) {
    throw new TypeError(
      "Solid diagnostics control schemaVersion is unsupported.",
    );
  }
  if (source.kind !== NATIVE_SOLID_DIAGNOSTICS_CONTROL_KIND) {
    throw new TypeError("Solid diagnostics control kind is invalid.");
  }
  if (source.operation !== expectedOperation) {
    throw new TypeError(
      "Solid diagnostics control operation does not match the request.",
    );
  }
  if (typeof source.ok !== "boolean" || typeof source.active !== "boolean") {
    throw new TypeError("Solid diagnostics control state is invalid.");
  }
  const error = source.error;
  if (
    error !== undefined &&
    error !== "unavailable" &&
    error !== "invalid-state" &&
    error !== "capture-failed"
  ) {
    throw new TypeError("Solid diagnostics control error is invalid.");
  }
  if (
    (source.ok && error !== undefined) ||
    (!source.ok && error === undefined)
  ) {
    throw new TypeError("Solid diagnostics control outcome is inconsistent.");
  }
  return Object.freeze({
    schemaVersion: NATIVE_SOLID_DIAGNOSTICS_CONTROL_SCHEMA_VERSION,
    kind: NATIVE_SOLID_DIAGNOSTICS_CONTROL_KIND,
    operation: expectedOperation,
    ok: source.ok,
    active: source.active,
    ...(error === undefined ? {} : { error }),
  });
}

export function parseNativeSolidDiagnosticsDebugBytes(
  bytes: Uint8Array,
): SolidDiagnosticsDebugEnvelope {
  return parseSolidDiagnosticsDebugEnvelope(
    decodeDocument(bytes, "Solid diagnostics debug response"),
  );
}
