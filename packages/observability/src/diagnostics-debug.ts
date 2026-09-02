export const SOLID_DIAGNOSTICS_DEBUG_SCHEMA_VERSION = 0 as const;
export const SOLID_DIAGNOSTICS_DEBUG_KIND =
  "solid-native.solid-diagnostics-debug" as const;
export const SOLID_DIAGNOSTICS_DEBUG_MAX_RECORDS = 256;
export const SOLID_DIAGNOSTICS_DEBUG_MAX_DEPENDENCIES = 64;
export const SOLID_DIAGNOSTICS_DEBUG_MAX_CAUSES = 32;
export const SOLID_DIAGNOSTICS_DEBUG_MAX_CAUSE_DEPTH = 8;
export const SOLID_DIAGNOSTICS_DEBUG_MAX_CAUSE_RECORDS = 4_096;
export const SOLID_DIAGNOSTICS_DEBUG_MAX_NAME_LENGTH = 128;
export const SOLID_DIAGNOSTICS_DEBUG_MAX_SERIALIZED_BYTES = 1_048_576;

export interface SolidDiagnosticsDebugDiagnostic {
  readonly sequence: number;
  readonly code: string;
  readonly kind: string;
  readonly severity: "warn" | "error";
  readonly ownerName?: string;
  readonly nodeName?: string;
}

export interface SolidDiagnosticsDebugCause {
  readonly sequence: number;
  readonly kind: "write" | "derived" | "async" | "refresh";
  readonly name: string;
  readonly causes?: readonly SolidDiagnosticsDebugCause[];
}

export interface SolidDiagnosticsDebugRerun {
  readonly run: number;
  readonly nodeRuns: number;
  readonly nodeKind: "effect" | "memo";
  readonly nodeName: string;
  readonly causes: readonly SolidDiagnosticsDebugCause[];
  readonly dependencyCount: number;
  readonly dependenciesAdded: readonly string[];
  readonly dependenciesRemoved: readonly string[];
  readonly selfMilliseconds: number;
  readonly totalMilliseconds: number;
  readonly changed: boolean;
  readonly phase: "plain" | "transition" | "optimistic";
  readonly held: boolean;
}

export interface SolidDiagnosticsDebugScopeCost {
  readonly name: string;
  readonly kind: "effect" | "memo";
  readonly runs: number;
  readonly selfMilliseconds: number;
  readonly wastedMilliseconds: number;
  readonly overlayMilliseconds: number;
}

export interface SolidDiagnosticsDebugWriteCost {
  readonly name: string;
  readonly runs: number;
  readonly downstreamMilliseconds: number;
}

/**
 * Explicit local-development envelope. It intentionally omits diagnostic
 * messages/data, owner IDs, reactive values, source stacks, and rendered
 * content even though Solid's in-process channels may retain them.
 */
export interface SolidDiagnosticsDebugEnvelope {
  readonly schemaVersion: typeof SOLID_DIAGNOSTICS_DEBUG_SCHEMA_VERSION;
  readonly kind: typeof SOLID_DIAGNOSTICS_DEBUG_KIND;
  readonly capturedAt: string;
  readonly durationMilliseconds: number;
  readonly truncated: boolean;
  readonly droppedDiagnostics: number;
  readonly diagnostics: readonly SolidDiagnosticsDebugDiagnostic[];
  readonly reruns: readonly SolidDiagnosticsDebugRerun[];
  readonly scopeCosts: readonly SolidDiagnosticsDebugScopeCost[];
  readonly writeCosts: readonly SolidDiagnosticsDebugWriteCost[];
}

export interface CreateSolidDiagnosticsDebugEnvelopeOptions {
  readonly capturedAt: string;
  readonly durationMilliseconds: number;
  readonly droppedDiagnostics?: number;
  readonly diagnostics: readonly unknown[];
  readonly reruns: readonly unknown[];
  readonly costs: unknown;
}

interface NormalizationState {
  truncated: boolean;
  causeRecords: number;
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a finite non-negative number.`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer.`);
  }
  return value as number;
}

function positiveInteger(value: unknown, name: string): number {
  const result = nonNegativeInteger(value, name);
  if (result === 0) throw new TypeError(`${name} must be positive.`);
  return result;
}

function clippedName(
  value: unknown,
  name: string,
  state: NormalizationState,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    /\p{Cc}/u.test(value)
  ) {
    throw new TypeError(
      `${name} must be a non-empty string without control characters.`,
    );
  }
  if (value.length <= SOLID_DIAGNOSTICS_DEBUG_MAX_NAME_LENGTH) return value;
  state.truncated = true;
  return value.slice(0, SOLID_DIAGNOSTICS_DEBUG_MAX_NAME_LENGTH);
}

function optionalName(
  value: unknown,
  name: string,
  state: NormalizationState,
): string | undefined {
  return value === undefined ? undefined : clippedName(value, name, state);
}

function exactName(value: unknown, name: string): string {
  const state: NormalizationState = { truncated: false, causeRecords: 0 };
  const result = clippedName(value, name, state);
  if (state.truncated) {
    throw new TypeError(
      `${name} must contain at most ${String(SOLID_DIAGNOSTICS_DEBUG_MAX_NAME_LENGTH)} characters.`,
    );
  }
  return result;
}

function strictRecord(
  value: unknown,
  allowedProperties: readonly string[],
  name: string,
): Record<string, unknown> {
  const result = record(value, name);
  const prototype = Object.getPrototypeOf(result) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${name} must be a plain object.`);
  }
  const allowed = new Set(allowedProperties);
  for (const property of Object.keys(result)) {
    if (!allowed.has(property)) {
      throw new TypeError(
        `${name} contains unknown property ${JSON.stringify(property)}.`,
      );
    }
  }
  for (const property of allowedProperties) {
    if (!Object.hasOwn(result, property)) {
      throw new TypeError(`${name}.${property} is required.`);
    }
  }
  return result;
}

function strictArray(
  value: unknown,
  maximum: number,
  name: string,
): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
  if (value.length > maximum) {
    throw new RangeError(
      `${name} must contain at most ${String(maximum)} records.`,
    );
  }
  return value;
}

function canonicalCapturedAt(value: unknown): string {
  let canonical = false;
  if (
    typeof value === "string" &&
    value.length === 24 &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  ) {
    try {
      canonical = new Date(value).toISOString() === value;
    } catch {
      // An impossible calendar date is not a canonical capture timestamp.
    }
  }
  if (!canonical) {
    throw new TypeError("Solid diagnostics capturedAt must be canonical UTC.");
  }
  return value as string;
}

function literal<T extends string>(
  value: unknown,
  values: readonly T[],
  name: string,
): T {
  if (typeof value === "string" && values.includes(value as T))
    return value as T;
  throw new TypeError(`${name} is invalid.`);
}

function boolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean")
    throw new TypeError(`${name} must be boolean.`);
  return value;
}

function boundedArray(
  value: unknown,
  maximum: number,
  name: string,
  state: NormalizationState,
): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
  if (value.length > maximum) state.truncated = true;
  return value.slice(0, maximum);
}

function normalizeCause(
  value: unknown,
  depth: number,
  state: NormalizationState,
  location: string,
): SolidDiagnosticsDebugCause {
  if (state.causeRecords >= SOLID_DIAGNOSTICS_DEBUG_MAX_CAUSE_RECORDS) {
    state.truncated = true;
    throw new RangeError("Solid diagnostics cause-record budget is exhausted.");
  }
  state.causeRecords += 1;
  const source = record(value, location);
  let causes: readonly SolidDiagnosticsDebugCause[] | undefined;
  if (source.causes !== undefined) {
    if (depth >= SOLID_DIAGNOSTICS_DEBUG_MAX_CAUSE_DEPTH) {
      state.truncated = true;
    } else {
      const entries = boundedArray(
        source.causes,
        SOLID_DIAGNOSTICS_DEBUG_MAX_CAUSES,
        `${location}.causes`,
        state,
      );
      const normalized: SolidDiagnosticsDebugCause[] = [];
      for (const [index, cause] of entries.entries()) {
        if (state.causeRecords >= SOLID_DIAGNOSTICS_DEBUG_MAX_CAUSE_RECORDS) {
          state.truncated = true;
          break;
        }
        normalized.push(
          normalizeCause(
            cause,
            depth + 1,
            state,
            `${location}.causes[${String(index)}]`,
          ),
        );
      }
      if (normalized.length > 0) causes = Object.freeze(normalized);
    }
  }
  return Object.freeze({
    sequence: positiveInteger(source.seq, `${location}.seq`),
    kind: literal(
      source.kind,
      ["write", "derived", "async", "refresh"],
      `${location}.kind`,
    ),
    name: clippedName(source.name, `${location}.name`, state),
    ...(causes === undefined ? {} : { causes }),
  });
}

function normalizeNames(
  value: unknown,
  location: string,
  state: NormalizationState,
): readonly string[] {
  return Object.freeze(
    boundedArray(
      value,
      SOLID_DIAGNOSTICS_DEBUG_MAX_DEPENDENCIES,
      location,
      state,
    ).map((entry, index) =>
      clippedName(entry, `${location}[${String(index)}]`, state),
    ),
  );
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

export function createSolidDiagnosticsDebugEnvelope(
  options: CreateSolidDiagnosticsDebugEnvelopeOptions,
): SolidDiagnosticsDebugEnvelope {
  if (options === null || typeof options !== "object") {
    throw new TypeError(
      "Solid diagnostics debug envelope options are required.",
    );
  }
  const capturedAt = canonicalCapturedAt(options.capturedAt);
  const state: NormalizationState = { truncated: false, causeRecords: 0 };
  const diagnostics = Object.freeze(
    boundedArray(
      options.diagnostics,
      SOLID_DIAGNOSTICS_DEBUG_MAX_RECORDS,
      "Solid diagnostics events",
      state,
    ).map((value, index): SolidDiagnosticsDebugDiagnostic => {
      const location = `Solid diagnostics event ${String(index)}`;
      const source = record(value, location);
      const ownerName = optionalName(
        source.ownerName,
        `${location}.ownerName`,
        state,
      );
      const nodeName = optionalName(
        source.nodeName,
        `${location}.nodeName`,
        state,
      );
      return Object.freeze({
        sequence: positiveInteger(source.sequence, `${location}.sequence`),
        code: clippedName(source.code, `${location}.code`, state),
        kind: clippedName(source.kind, `${location}.kind`, state),
        severity: literal(
          source.severity,
          ["warn", "error"],
          `${location}.severity`,
        ),
        ...(ownerName === undefined ? {} : { ownerName }),
        ...(nodeName === undefined ? {} : { nodeName }),
      });
    }),
  );
  const reruns = Object.freeze(
    boundedArray(
      options.reruns,
      SOLID_DIAGNOSTICS_DEBUG_MAX_RECORDS,
      "Solid diagnostics reruns",
      state,
    ).map((value, index): SolidDiagnosticsDebugRerun => {
      const location = `Solid diagnostics rerun ${String(index)}`;
      const source = record(value, location);
      const causes: SolidDiagnosticsDebugCause[] = [];
      for (const [causeIndex, cause] of boundedArray(
        source.causes,
        SOLID_DIAGNOSTICS_DEBUG_MAX_CAUSES,
        `${location}.causes`,
        state,
      ).entries()) {
        if (state.causeRecords >= SOLID_DIAGNOSTICS_DEBUG_MAX_CAUSE_RECORDS) {
          state.truncated = true;
          break;
        }
        causes.push(
          normalizeCause(
            cause,
            1,
            state,
            `${location}.causes[${String(causeIndex)}]`,
          ),
        );
      }
      return Object.freeze({
        run: positiveInteger(source.run, `${location}.run`),
        nodeRuns: positiveInteger(source.nodeRuns, `${location}.nodeRuns`),
        nodeKind: literal(
          source.nodeKind,
          ["effect", "memo"],
          `${location}.nodeKind`,
        ),
        nodeName: clippedName(source.nodeName, `${location}.nodeName`, state),
        causes: Object.freeze(causes),
        dependencyCount: nonNegativeInteger(
          source.depCount,
          `${location}.depCount`,
        ),
        dependenciesAdded: normalizeNames(
          source.depsAdded,
          `${location}.depsAdded`,
          state,
        ),
        dependenciesRemoved: normalizeNames(
          source.depsRemoved,
          `${location}.depsRemoved`,
          state,
        ),
        selfMilliseconds: finiteNumber(source.selfMs, `${location}.selfMs`),
        totalMilliseconds: finiteNumber(source.totalMs, `${location}.totalMs`),
        changed: boolean(source.changed, `${location}.changed`),
        phase: literal(
          source.phase,
          ["plain", "transition", "optimistic"],
          `${location}.phase`,
        ),
        held: boolean(source.held, `${location}.held`),
      });
    }),
  );
  const costs = record(options.costs, "Solid diagnostics costs");
  const scopeCosts = Object.freeze(
    boundedArray(
      costs.scopes,
      SOLID_DIAGNOSTICS_DEBUG_MAX_RECORDS,
      "Solid diagnostics scope costs",
      state,
    ).map((value, index): SolidDiagnosticsDebugScopeCost => {
      const location = `Solid diagnostics scope cost ${String(index)}`;
      const source = record(value, location);
      return Object.freeze({
        name: clippedName(source.name, `${location}.name`, state),
        kind: literal(source.kind, ["effect", "memo"], `${location}.kind`),
        runs: nonNegativeInteger(source.runs, `${location}.runs`),
        selfMilliseconds: finiteNumber(source.selfMs, `${location}.selfMs`),
        wastedMilliseconds: finiteNumber(
          source.wastedMs,
          `${location}.wastedMs`,
        ),
        overlayMilliseconds: finiteNumber(
          source.overlayMs,
          `${location}.overlayMs`,
        ),
      });
    }),
  );
  const writeCosts = Object.freeze(
    boundedArray(
      costs.writes,
      SOLID_DIAGNOSTICS_DEBUG_MAX_RECORDS,
      "Solid diagnostics write costs",
      state,
    ).map((value, index): SolidDiagnosticsDebugWriteCost => {
      const location = `Solid diagnostics write cost ${String(index)}`;
      const source = record(value, location);
      return Object.freeze({
        name: clippedName(source.name, `${location}.name`, state),
        runs: nonNegativeInteger(source.runs, `${location}.runs`),
        downstreamMilliseconds: finiteNumber(
          source.downstreamMs,
          `${location}.downstreamMs`,
        ),
      });
    }),
  );
  const droppedDiagnostics = nonNegativeInteger(
    options.droppedDiagnostics ?? 0,
    "Solid diagnostics droppedDiagnostics",
  );
  const envelope = Object.freeze({
    schemaVersion: SOLID_DIAGNOSTICS_DEBUG_SCHEMA_VERSION,
    kind: SOLID_DIAGNOSTICS_DEBUG_KIND,
    capturedAt,
    durationMilliseconds: finiteNumber(
      options.durationMilliseconds,
      "Solid diagnostics durationMilliseconds",
    ),
    truncated: state.truncated || droppedDiagnostics > 0,
    droppedDiagnostics,
    diagnostics,
    reruns,
    scopeCosts,
    writeCosts,
  });
  const json = JSON.stringify(envelope);
  if (utf8ByteLength(json) > SOLID_DIAGNOSTICS_DEBUG_MAX_SERIALIZED_BYTES) {
    throw new RangeError(
      `Solid diagnostics debug envelope exceeds ${String(SOLID_DIAGNOSTICS_DEBUG_MAX_SERIALIZED_BYTES)} UTF-8 bytes.`,
    );
  }
  return envelope;
}

export function serializeSolidDiagnosticsDebugEnvelope(
  envelope: SolidDiagnosticsDebugEnvelope,
): string {
  const json = JSON.stringify(parseSolidDiagnosticsDebugEnvelope(envelope));
  if (utf8ByteLength(json) > SOLID_DIAGNOSTICS_DEBUG_MAX_SERIALIZED_BYTES) {
    throw new RangeError(
      `Solid diagnostics debug envelope exceeds ${String(SOLID_DIAGNOSTICS_DEBUG_MAX_SERIALIZED_BYTES)} UTF-8 bytes.`,
    );
  }
  return json;
}

interface ParseState {
  causeRecords: number;
}

function parseCause(
  value: unknown,
  depth: number,
  state: ParseState,
  location: string,
): SolidDiagnosticsDebugCause {
  if (depth > SOLID_DIAGNOSTICS_DEBUG_MAX_CAUSE_DEPTH) {
    throw new RangeError(
      `${location} exceeds the Solid diagnostics cause depth limit.`,
    );
  }
  state.causeRecords += 1;
  if (state.causeRecords > SOLID_DIAGNOSTICS_DEBUG_MAX_CAUSE_RECORDS) {
    throw new RangeError(
      `Solid diagnostics causes exceed ${String(SOLID_DIAGNOSTICS_DEBUG_MAX_CAUSE_RECORDS)} records.`,
    );
  }
  const source = record(value, location);
  const properties = Object.hasOwn(source, "causes")
    ? ["sequence", "kind", "name", "causes"]
    : ["sequence", "kind", "name"];
  const strict = strictRecord(source, properties, location);
  let causes: readonly SolidDiagnosticsDebugCause[] | undefined;
  if (Object.hasOwn(strict, "causes")) {
    const entries = strictArray(
      strict.causes,
      SOLID_DIAGNOSTICS_DEBUG_MAX_CAUSES,
      `${location}.causes`,
    );
    if (entries.length === 0) {
      throw new TypeError(`${location}.causes must be omitted when empty.`);
    }
    causes = Object.freeze(
      entries.map((cause, index) =>
        parseCause(
          cause,
          depth + 1,
          state,
          `${location}.causes[${String(index)}]`,
        ),
      ),
    );
  }
  return Object.freeze({
    sequence: positiveInteger(strict.sequence, `${location}.sequence`),
    kind: literal(
      strict.kind,
      ["write", "derived", "async", "refresh"],
      `${location}.kind`,
    ),
    name: exactName(strict.name, `${location}.name`),
    ...(causes === undefined ? {} : { causes }),
  });
}

function parseNames(value: unknown, location: string): readonly string[] {
  return Object.freeze(
    strictArray(value, SOLID_DIAGNOSTICS_DEBUG_MAX_DEPENDENCIES, location).map(
      (entry, index) => exactName(entry, `${location}[${String(index)}]`),
    ),
  );
}

/** Strictly validates and deeply freezes one detached debug artifact. */
export function parseSolidDiagnosticsDebugEnvelope(
  value: unknown,
): SolidDiagnosticsDebugEnvelope {
  const source = strictRecord(
    value,
    [
      "schemaVersion",
      "kind",
      "capturedAt",
      "durationMilliseconds",
      "truncated",
      "droppedDiagnostics",
      "diagnostics",
      "reruns",
      "scopeCosts",
      "writeCosts",
    ],
    "Solid diagnostics debug envelope",
  );
  if (source.schemaVersion !== SOLID_DIAGNOSTICS_DEBUG_SCHEMA_VERSION) {
    throw new TypeError(
      "Solid diagnostics debug schemaVersion is unsupported.",
    );
  }
  if (source.kind !== SOLID_DIAGNOSTICS_DEBUG_KIND) {
    throw new TypeError("Solid diagnostics debug kind is invalid.");
  }
  const diagnostics = Object.freeze(
    strictArray(
      source.diagnostics,
      SOLID_DIAGNOSTICS_DEBUG_MAX_RECORDS,
      "Solid diagnostics debug diagnostics",
    ).map((value, index): SolidDiagnosticsDebugDiagnostic => {
      const location = `Solid diagnostics debug diagnostic ${String(index)}`;
      const candidate = record(value, location);
      const properties = ["sequence", "code", "kind", "severity"];
      if (Object.hasOwn(candidate, "ownerName")) properties.push("ownerName");
      if (Object.hasOwn(candidate, "nodeName")) properties.push("nodeName");
      const diagnostic = strictRecord(candidate, properties, location);
      const ownerName = Object.hasOwn(diagnostic, "ownerName")
        ? exactName(diagnostic.ownerName, `${location}.ownerName`)
        : undefined;
      const nodeName = Object.hasOwn(diagnostic, "nodeName")
        ? exactName(diagnostic.nodeName, `${location}.nodeName`)
        : undefined;
      return Object.freeze({
        sequence: positiveInteger(diagnostic.sequence, `${location}.sequence`),
        code: exactName(diagnostic.code, `${location}.code`),
        kind: exactName(diagnostic.kind, `${location}.kind`),
        severity: literal(
          diagnostic.severity,
          ["warn", "error"],
          `${location}.severity`,
        ),
        ...(ownerName === undefined ? {} : { ownerName }),
        ...(nodeName === undefined ? {} : { nodeName }),
      });
    }),
  );
  const state: ParseState = { causeRecords: 0 };
  const reruns = Object.freeze(
    strictArray(
      source.reruns,
      SOLID_DIAGNOSTICS_DEBUG_MAX_RECORDS,
      "Solid diagnostics debug reruns",
    ).map((value, index): SolidDiagnosticsDebugRerun => {
      const location = `Solid diagnostics debug rerun ${String(index)}`;
      const rerun = strictRecord(
        value,
        [
          "run",
          "nodeRuns",
          "nodeKind",
          "nodeName",
          "causes",
          "dependencyCount",
          "dependenciesAdded",
          "dependenciesRemoved",
          "selfMilliseconds",
          "totalMilliseconds",
          "changed",
          "phase",
          "held",
        ],
        location,
      );
      return Object.freeze({
        run: positiveInteger(rerun.run, `${location}.run`),
        nodeRuns: positiveInteger(rerun.nodeRuns, `${location}.nodeRuns`),
        nodeKind: literal(
          rerun.nodeKind,
          ["effect", "memo"],
          `${location}.nodeKind`,
        ),
        nodeName: exactName(rerun.nodeName, `${location}.nodeName`),
        causes: Object.freeze(
          strictArray(
            rerun.causes,
            SOLID_DIAGNOSTICS_DEBUG_MAX_CAUSES,
            `${location}.causes`,
          ).map((cause, causeIndex) =>
            parseCause(
              cause,
              1,
              state,
              `${location}.causes[${String(causeIndex)}]`,
            ),
          ),
        ),
        dependencyCount: nonNegativeInteger(
          rerun.dependencyCount,
          `${location}.dependencyCount`,
        ),
        dependenciesAdded: parseNames(
          rerun.dependenciesAdded,
          `${location}.dependenciesAdded`,
        ),
        dependenciesRemoved: parseNames(
          rerun.dependenciesRemoved,
          `${location}.dependenciesRemoved`,
        ),
        selfMilliseconds: finiteNumber(
          rerun.selfMilliseconds,
          `${location}.selfMilliseconds`,
        ),
        totalMilliseconds: finiteNumber(
          rerun.totalMilliseconds,
          `${location}.totalMilliseconds`,
        ),
        changed: boolean(rerun.changed, `${location}.changed`),
        phase: literal(
          rerun.phase,
          ["plain", "transition", "optimistic"],
          `${location}.phase`,
        ),
        held: boolean(rerun.held, `${location}.held`),
      });
    }),
  );
  const scopeCosts = Object.freeze(
    strictArray(
      source.scopeCosts,
      SOLID_DIAGNOSTICS_DEBUG_MAX_RECORDS,
      "Solid diagnostics debug scopeCosts",
    ).map((value, index): SolidDiagnosticsDebugScopeCost => {
      const location = `Solid diagnostics debug scopeCost ${String(index)}`;
      const cost = strictRecord(
        value,
        [
          "name",
          "kind",
          "runs",
          "selfMilliseconds",
          "wastedMilliseconds",
          "overlayMilliseconds",
        ],
        location,
      );
      return Object.freeze({
        name: exactName(cost.name, `${location}.name`),
        kind: literal(cost.kind, ["effect", "memo"], `${location}.kind`),
        runs: nonNegativeInteger(cost.runs, `${location}.runs`),
        selfMilliseconds: finiteNumber(
          cost.selfMilliseconds,
          `${location}.selfMilliseconds`,
        ),
        wastedMilliseconds: finiteNumber(
          cost.wastedMilliseconds,
          `${location}.wastedMilliseconds`,
        ),
        overlayMilliseconds: finiteNumber(
          cost.overlayMilliseconds,
          `${location}.overlayMilliseconds`,
        ),
      });
    }),
  );
  const writeCosts = Object.freeze(
    strictArray(
      source.writeCosts,
      SOLID_DIAGNOSTICS_DEBUG_MAX_RECORDS,
      "Solid diagnostics debug writeCosts",
    ).map((value, index): SolidDiagnosticsDebugWriteCost => {
      const location = `Solid diagnostics debug writeCost ${String(index)}`;
      const cost = strictRecord(
        value,
        ["name", "runs", "downstreamMilliseconds"],
        location,
      );
      return Object.freeze({
        name: exactName(cost.name, `${location}.name`),
        runs: nonNegativeInteger(cost.runs, `${location}.runs`),
        downstreamMilliseconds: finiteNumber(
          cost.downstreamMilliseconds,
          `${location}.downstreamMilliseconds`,
        ),
      });
    }),
  );
  const truncated = boolean(
    source.truncated,
    "Solid diagnostics debug truncated",
  );
  const droppedDiagnostics = nonNegativeInteger(
    source.droppedDiagnostics,
    "Solid diagnostics debug droppedDiagnostics",
  );
  if (droppedDiagnostics > 0 && !truncated) {
    throw new TypeError(
      "Solid diagnostics debug truncation state is inconsistent.",
    );
  }
  return Object.freeze({
    schemaVersion: SOLID_DIAGNOSTICS_DEBUG_SCHEMA_VERSION,
    kind: SOLID_DIAGNOSTICS_DEBUG_KIND,
    capturedAt: canonicalCapturedAt(source.capturedAt),
    durationMilliseconds: finiteNumber(
      source.durationMilliseconds,
      "Solid diagnostics debug durationMilliseconds",
    ),
    truncated,
    droppedDiagnostics,
    diagnostics,
    reruns,
    scopeCosts,
    writeCosts,
  });
}
