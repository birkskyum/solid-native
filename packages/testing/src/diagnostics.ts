import {
  assertBudget,
  captureArtifact,
  type CaptureOptions,
  type DiagnosticsArtifact,
  type DiagnosticCode,
  type ScenarioBudget,
} from "@solidjs/diagnostics";
import type {
  CommitPriority,
  HostCommit,
  HostMutation,
} from "@solid-native/host-contract";

import {
  renderNative,
  type NativeTestRender,
  type RenderNativeOptions,
} from "./index.js";

export const NATIVE_DIAGNOSTICS_ARTIFACT_FORMAT_VERSION = 0 as const;
export const NATIVE_DIAGNOSTICS_DEFAULT_MAX_RENDERS = 8;
export const NATIVE_DIAGNOSTICS_MAX_RENDERS = 32;
export const NATIVE_DIAGNOSTICS_DEFAULT_MAX_COMMITS_PER_RENDER = 100;
export const NATIVE_DIAGNOSTICS_MAX_COMMITS_PER_RENDER = 1_000;
export const NATIVE_DIAGNOSTICS_MAX_LABEL_LENGTH = 128;
export const NATIVE_DIAGNOSTICS_BUDGET_FORMAT_VERSION = 1 as const;
export const NATIVE_DIAGNOSTICS_MAX_BUDGET_FILE_BYTES = 1_048_576;
export const NATIVE_DIAGNOSTICS_MAX_BUDGET_SCENARIOS = 256;
export const NATIVE_DIAGNOSTICS_MAX_BUDGET_SCOPES = 256;
export const NATIVE_DIAGNOSTICS_MAX_ALLOWED_CODES = 128;

export type NativeDiagnosticsMutationKind = HostMutation["type"];

export interface NativeDiagnosticsCommitRecord {
  readonly sequence: number;
  readonly priority: CommitPriority;
  readonly mutationCount: number;
  readonly mutationCounts: Readonly<
    Partial<Record<NativeDiagnosticsMutationKind, number>>
  >;
  readonly causalOperationId?: string;
}

export interface NativeDiagnosticsRenderArtifact {
  readonly renderId: number;
  readonly surfaceName: string;
  readonly commitCount: number;
  readonly mutationCount: number;
  readonly commits: readonly NativeDiagnosticsCommitRecord[];
}

/**
 * One serializable development artifact joining Solid diagnostics and exact
 * deterministic native transactions without retaining props or event values.
 */
export interface NativeDiagnosticsArtifact {
  readonly formatVersion: typeof NATIVE_DIAGNOSTICS_ARTIFACT_FORMAT_VERSION;
  readonly solid: DiagnosticsArtifact;
  readonly renderCount: number;
  readonly commitCount: number;
  readonly mutationCount: number;
  readonly renders: readonly NativeDiagnosticsRenderArtifact[];
}

export interface NativeDiagnosticsScenario {
  render(
    code: () => unknown,
    options?: RenderNativeOptions,
  ): Promise<NativeTestRender>;
}

export interface CaptureNativeDiagnosticsOptions extends CaptureOptions {
  /** Maximum renders a scenario may create. Defaults to 8; maximum 32. */
  readonly maxRenders?: number;
  /** Maximum commits retained for each render. Defaults to 100; maximum 1,000. */
  readonly maxCommitsPerRender?: number;
}

export interface CaptureNativeDiagnosticsResult<T> {
  readonly result: T;
  readonly artifact: NativeDiagnosticsArtifact;
}

export interface NativeCommitBudget {
  readonly maxCommits?: number;
  readonly maxMutations?: number;
  readonly maxCommitsPerRender?: number;
  readonly maxMutationsPerCommit?: number;
}

/**
 * A checked-in definition of done for one Solid Native diagnostics scenario.
 * Solid's official bounds remain top-level; native transaction bounds occupy
 * one explicit namespace so the file stays compatible with the upstream
 * format instead of shadowing its fields.
 */
export interface NativeDiagnosticsScenarioBudget extends ScenarioBudget {
  readonly native?: NativeCommitBudget;
}

export interface NativeDiagnosticsBudgetFile {
  readonly formatVersion: typeof NATIVE_DIAGNOSTICS_BUDGET_FORMAT_VERSION;
  readonly scenarios: Readonly<Record<string, NativeDiagnosticsScenarioBudget>>;
}

export class NativeDiagnosticsAssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativeDiagnosticsAssertionError";
  }
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  name: string,
): number {
  const candidate = value ?? fallback;
  if (
    !Number.isSafeInteger(candidate) ||
    candidate < 1 ||
    candidate > maximum
  ) {
    throw new RangeError(
      `${name} must be a safe integer from 1 through ${String(maximum)}.`,
    );
  }
  return candidate;
}

function boundedLabel(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > NATIVE_DIAGNOSTICS_MAX_LABEL_LENGTH ||
    value.includes("\0")
  ) {
    throw new RangeError(
      `${name} must contain 1-${String(NATIVE_DIAGNOSTICS_MAX_LABEL_LENGTH)} characters without null bytes.`,
    );
  }
  return value;
}

function summarizeCommit(commit: HostCommit): NativeDiagnosticsCommitRecord {
  const counts: Partial<Record<NativeDiagnosticsMutationKind, number>> = {};
  for (const mutation of commit.mutations) {
    counts[mutation.type] = (counts[mutation.type] ?? 0) + 1;
  }
  return Object.freeze({
    sequence: commit.sequence,
    priority: commit.priority,
    mutationCount: commit.mutations.length,
    mutationCounts: Object.freeze(
      Object.fromEntries(
        Object.entries(counts).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
    ),
    ...(commit.causalContext === undefined
      ? {}
      : { causalOperationId: commit.causalContext.operationId }),
  });
}

function summarizeRender(
  render: NativeTestRender,
  renderId: number,
  surfaceName: string,
  maximumCommits: number,
): NativeDiagnosticsRenderArtifact {
  const commits = render.commits;
  if (commits.length > maximumCommits) {
    throw new RangeError(
      `Native diagnostics render ${String(renderId)} produced ${String(commits.length)} commits; maximum ${String(maximumCommits)}.`,
    );
  }
  const records = Object.freeze(commits.map(summarizeCommit));
  return Object.freeze({
    renderId,
    surfaceName,
    commitCount: records.length,
    mutationCount: records.reduce(
      (total, commit) => total + commit.mutationCount,
      0,
    ),
    commits: records,
  });
}

/**
 * Captures one successful native test scenario through Solid's official
 * development Diagnostics channels. Every render is disposed in reverse order
 * before capture closes, so owner cleanup and its final native commit are part
 * of the artifact.
 */
export async function captureNativeDiagnostics<T>(
  scenario: (context: NativeDiagnosticsScenario) => T | Promise<T>,
  options: CaptureNativeDiagnosticsOptions = {},
): Promise<CaptureNativeDiagnosticsResult<T>> {
  if (typeof scenario !== "function") {
    throw new TypeError("Native diagnostics scenario must be a function.");
  }
  if (options === null || typeof options !== "object") {
    throw new TypeError("Native diagnostics options must be an object.");
  }
  const scenarioName =
    options.scenario === undefined
      ? undefined
      : boundedLabel(options.scenario, "Native diagnostics scenario");
  const maxRenders = boundedInteger(
    options.maxRenders,
    NATIVE_DIAGNOSTICS_DEFAULT_MAX_RENDERS,
    NATIVE_DIAGNOSTICS_MAX_RENDERS,
    "Native diagnostics maxRenders",
  );
  const maxCommitsPerRender = boundedInteger(
    options.maxCommitsPerRender,
    NATIVE_DIAGNOSTICS_DEFAULT_MAX_COMMITS_PER_RENDER,
    NATIVE_DIAGNOSTICS_MAX_COMMITS_PER_RENDER,
    "Native diagnostics maxCommitsPerRender",
  );
  const renders: Array<{
    readonly render: NativeTestRender;
    readonly surfaceName: string;
  }> = [];
  const capture = await captureArtifact(
    async () => {
      let result: T | undefined;
      let scenarioFailure: unknown;
      let scenarioFailed = false;
      try {
        result = await scenario({
          async render(code, renderOptions = {}) {
            if (renders.length >= maxRenders) {
              throw new RangeError(
                `Native diagnostics scenarios may create at most ${String(maxRenders)} renders.`,
              );
            }
            const surfaceName = boundedLabel(
              renderOptions.surface?.name ?? "test",
              "Native diagnostics surface name",
            );
            const render = await renderNative(code, renderOptions);
            renders.push({
              render,
              surfaceName,
            });
            return render;
          },
        });
      } catch (error) {
        scenarioFailed = true;
        scenarioFailure = error;
      }
      const cleanupFailures: unknown[] = [];
      for (const entry of renders.slice().reverse()) {
        try {
          await entry.render.cleanup();
        } catch (error) {
          cleanupFailures.push(error);
        }
      }
      const failures = [
        ...(scenarioFailed ? [scenarioFailure] : []),
        ...cleanupFailures,
      ];
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) {
        throw new AggregateError(
          failures,
          "Native diagnostics scenario and cleanup failed.",
        );
      }
      return result as T;
    },
    {
      ...(scenarioName === undefined ? {} : { scenario: scenarioName }),
      ...(options.attribution === undefined
        ? {}
        : { attribution: options.attribution }),
      ...(options.autoFlush === undefined
        ? {}
        : { autoFlush: options.autoFlush }),
    },
  );
  const renderArtifacts = Object.freeze(
    renders.map((entry, index) =>
      summarizeRender(
        entry.render,
        index + 1,
        entry.surfaceName,
        maxCommitsPerRender,
      ),
    ),
  );
  const artifact = Object.freeze({
    formatVersion: NATIVE_DIAGNOSTICS_ARTIFACT_FORMAT_VERSION,
    solid: capture.artifact,
    renderCount: renderArtifacts.length,
    commitCount: renderArtifacts.reduce(
      (total, render) => total + render.commitCount,
      0,
    ),
    mutationCount: renderArtifacts.reduce(
      (total, render) => total + render.mutationCount,
      0,
    ),
    renders: renderArtifacts,
  });
  return Object.freeze({ result: capture.result, artifact });
}

function optionalBudget(
  value: number | undefined,
  name: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }
  return value;
}

function budgetRecord(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertBudgetKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  name: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new TypeError(
        `${name} contains unknown field ${JSON.stringify(key)}.`,
      );
    }
  }
}

function budgetInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer.`);
  }
  return value as number;
}

function budgetMilliseconds(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a finite non-negative number.`);
  }
  return value;
}

function budgetName(value: unknown, name: string): string {
  const label = boundedLabel(value, name);
  if (/\p{Cc}/u.test(label)) {
    throw new TypeError(`${name} must not contain control characters.`);
  }
  return label;
}

function parseNativeCommitBudget(
  value: unknown,
  location: string,
): NativeCommitBudget {
  const record = budgetRecord(value, location);
  assertBudgetKeys(
    record,
    new Set([
      "maxCommits",
      "maxMutations",
      "maxCommitsPerRender",
      "maxMutationsPerCommit",
    ]),
    location,
  );
  const result: {
    maxCommits?: number;
    maxMutations?: number;
    maxCommitsPerRender?: number;
    maxMutationsPerCommit?: number;
  } = {};
  for (const field of [
    "maxCommits",
    "maxMutations",
    "maxCommitsPerRender",
    "maxMutationsPerCommit",
  ] as const) {
    if (record[field] !== undefined) {
      result[field] = budgetInteger(record[field], `${location}.${field}`);
    }
  }
  return Object.freeze(result);
}

function parseScenarioBudget(
  value: unknown,
  location: string,
): NativeDiagnosticsScenarioBudget {
  const record = budgetRecord(value, location);
  assertBudgetKeys(
    record,
    new Set([
      "allow",
      "maxReruns",
      "maxWastedRuns",
      "maxWastedMs",
      "scopes",
      "native",
    ]),
    location,
  );
  let allow: DiagnosticCode[] | undefined;
  if (record.allow !== undefined) {
    if (
      !Array.isArray(record.allow) ||
      record.allow.length > NATIVE_DIAGNOSTICS_MAX_ALLOWED_CODES
    ) {
      throw new TypeError(
        `${location}.allow must contain at most ${String(NATIVE_DIAGNOSTICS_MAX_ALLOWED_CODES)} diagnostic codes.`,
      );
    }
    allow = record.allow.map((code, index) =>
      budgetName(code, `${location}.allow[${String(index)}]`),
    ) as DiagnosticCode[];
    if (new Set(allow).size !== allow.length) {
      throw new TypeError(`${location}.allow must not contain duplicates.`);
    }
    Object.freeze(allow);
  }
  let scopes: Readonly<Record<string, number>> | undefined;
  if (record.scopes !== undefined) {
    const scopeRecord = budgetRecord(record.scopes, `${location}.scopes`);
    const entries = Object.entries(scopeRecord);
    if (entries.length > NATIVE_DIAGNOSTICS_MAX_BUDGET_SCOPES) {
      throw new TypeError(
        `${location}.scopes exceeds ${String(NATIVE_DIAGNOSTICS_MAX_BUDGET_SCOPES)} entries.`,
      );
    }
    const normalized = Object.create(null) as Record<string, number>;
    for (const [rawName, maximum] of entries) {
      const name = budgetName(rawName, `${location}.scopes key`);
      if (name.length > 2 && name.startsWith("/") && name.endsWith("/")) {
        try {
          new RegExp(name.slice(1, -1));
        } catch {
          throw new TypeError(
            `${location}.scopes contains invalid regular expression ${JSON.stringify(name)}.`,
          );
        }
      }
      normalized[name] = budgetInteger(
        maximum,
        `${location}.scopes[${JSON.stringify(name)}]`,
      );
    }
    scopes = Object.freeze(normalized);
  }
  return Object.freeze({
    ...(allow === undefined ? {} : { allow }),
    ...(record.maxReruns === undefined
      ? {}
      : {
          maxReruns: budgetInteger(record.maxReruns, `${location}.maxReruns`),
        }),
    ...(record.maxWastedRuns === undefined
      ? {}
      : {
          maxWastedRuns: budgetInteger(
            record.maxWastedRuns,
            `${location}.maxWastedRuns`,
          ),
        }),
    ...(record.maxWastedMs === undefined
      ? {}
      : {
          maxWastedMs: budgetMilliseconds(
            record.maxWastedMs,
            `${location}.maxWastedMs`,
          ),
        }),
    ...(scopes === undefined ? {} : { scopes }),
    ...(record.native === undefined
      ? {}
      : {
          native: parseNativeCommitBudget(record.native, `${location}.native`),
        }),
  });
}

/**
 * Parses the shared Solid/native checked-in budget format without filesystem
 * access. The input, scenario count, names, arrays, scope maps, regular
 * expressions, numeric bounds, and accepted fields are all bounded before the
 * resulting deeply frozen policy is returned.
 */
export function parseNativeDiagnosticsBudgetFile(
  json: string,
): NativeDiagnosticsBudgetFile {
  if (typeof json !== "string") {
    throw new TypeError("Native diagnostics budget input must be a string.");
  }
  if (
    Buffer.byteLength(json, "utf8") > NATIVE_DIAGNOSTICS_MAX_BUDGET_FILE_BYTES
  ) {
    throw new TypeError(
      `Native diagnostics budget input exceeds ${String(NATIVE_DIAGNOSTICS_MAX_BUDGET_FILE_BYTES)} UTF-8 bytes.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new TypeError(
      `Native diagnostics budget input is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const root = budgetRecord(parsed, "Native diagnostics budget file");
  assertBudgetKeys(
    root,
    new Set(["formatVersion", "scenarios"]),
    "Native diagnostics budget file",
  );
  if (root.formatVersion !== NATIVE_DIAGNOSTICS_BUDGET_FORMAT_VERSION) {
    throw new TypeError(
      `Native diagnostics budget formatVersion must be ${String(NATIVE_DIAGNOSTICS_BUDGET_FORMAT_VERSION)}.`,
    );
  }
  const scenarioRecord = budgetRecord(
    root.scenarios,
    "Native diagnostics budget scenarios",
  );
  const entries = Object.entries(scenarioRecord);
  if (entries.length > NATIVE_DIAGNOSTICS_MAX_BUDGET_SCENARIOS) {
    throw new TypeError(
      `Native diagnostics budget exceeds ${String(NATIVE_DIAGNOSTICS_MAX_BUDGET_SCENARIOS)} scenarios.`,
    );
  }
  const scenarios = Object.create(null) as Record<
    string,
    NativeDiagnosticsScenarioBudget
  >;
  for (const [rawName, value] of entries) {
    const name = budgetName(rawName, "Native diagnostics scenario name");
    scenarios[name] = parseScenarioBudget(
      value,
      `Native diagnostics scenario ${JSON.stringify(name)}`,
    );
  }
  return Object.freeze({
    formatVersion: NATIVE_DIAGNOSTICS_BUDGET_FORMAT_VERSION,
    scenarios: Object.freeze(scenarios),
  });
}

/** Enforces Solid's official budget and the native transaction extension. */
export function assertNativeDiagnosticsBudget(
  artifact: NativeDiagnosticsArtifact,
  budget: NativeDiagnosticsScenarioBudget,
): void {
  if (artifact === null || typeof artifact !== "object") {
    throw new TypeError("A native diagnostics artifact is required.");
  }
  if (budget === null || typeof budget !== "object") {
    throw new TypeError("A native diagnostics scenario budget is required.");
  }
  assertBudget(artifact.solid, budget);
  if (budget.native !== undefined) {
    expectNativeCommitBudget(artifact, budget.native);
  }
}

/**
 * Selects the exact captured scenario from a checked-in policy and enforces
 * both halves. Missing names fail closed so a new scenario cannot silently run
 * without a reviewed budget.
 */
export function assertNativeDiagnosticsBudgetFile(
  artifact: NativeDiagnosticsArtifact,
  file: NativeDiagnosticsBudgetFile,
): void {
  if (file === null || typeof file !== "object") {
    throw new TypeError("A native diagnostics budget file is required.");
  }
  const scenario = artifact.solid.scenario;
  if (scenario === undefined || scenario.length === 0) {
    throw new NativeDiagnosticsAssertionError(
      "Native diagnostics budget files require a captured scenario name.",
    );
  }
  const budget = file.scenarios[scenario];
  if (budget === undefined) {
    const known = Object.keys(file.scenarios).sort();
    throw new NativeDiagnosticsAssertionError(
      `No native diagnostics budget is defined for scenario ${JSON.stringify(scenario)}. Known scenarios: [${known.join(", ")}].`,
    );
  }
  assertNativeDiagnosticsBudget(artifact, budget);
}

/** Gates native transaction volume alongside upstream rerun and waste budgets. */
export function expectNativeCommitBudget(
  artifact: NativeDiagnosticsArtifact,
  budget: NativeCommitBudget,
): void {
  if (artifact === null || typeof artifact !== "object") {
    throw new TypeError("A native diagnostics artifact is required.");
  }
  if (budget === null || typeof budget !== "object") {
    throw new TypeError("A native commit budget is required.");
  }
  const maxCommits = optionalBudget(budget.maxCommits, "maxCommits");
  const maxMutations = optionalBudget(budget.maxMutations, "maxMutations");
  const maxCommitsPerRender = optionalBudget(
    budget.maxCommitsPerRender,
    "maxCommitsPerRender",
  );
  const maxMutationsPerCommit = optionalBudget(
    budget.maxMutationsPerCommit,
    "maxMutationsPerCommit",
  );
  const failures: string[] = [];
  if (maxCommits !== undefined && artifact.commitCount > maxCommits) {
    failures.push(
      `commits ${String(artifact.commitCount)} > ${String(maxCommits)}`,
    );
  }
  if (maxMutations !== undefined && artifact.mutationCount > maxMutations) {
    failures.push(
      `mutations ${String(artifact.mutationCount)} > ${String(maxMutations)}`,
    );
  }
  for (const render of artifact.renders) {
    if (
      maxCommitsPerRender !== undefined &&
      render.commitCount > maxCommitsPerRender
    ) {
      failures.push(
        `render ${String(render.renderId)} commits ${String(render.commitCount)} > ${String(maxCommitsPerRender)}`,
      );
    }
    if (maxMutationsPerCommit !== undefined) {
      for (const commit of render.commits) {
        if (commit.mutationCount > maxMutationsPerCommit) {
          failures.push(
            `render ${String(render.renderId)} commit ${String(commit.sequence)} mutations ${String(commit.mutationCount)} > ${String(maxMutationsPerCommit)}`,
          );
        }
      }
    }
  }
  if (failures.length > 0) {
    throw new NativeDiagnosticsAssertionError(
      `Native commit budget exceeded: ${failures.join("; ")}.`,
    );
  }
}

export function serializeNativeDiagnosticsArtifact(
  artifact: NativeDiagnosticsArtifact,
): string {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

export {
  expectDiagnostic,
  expectNoDiagnostics,
  expectNoWaste,
  expectRerunBudget,
} from "@solidjs/diagnostics";
