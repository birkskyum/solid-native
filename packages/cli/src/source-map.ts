import { randomUUID } from "node:crypto";
import { lstat, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_SOURCE_MAP_BYTES = 256 * 1024 * 1024;
const MAX_SOURCE_MAP_DEPTH = 8;
const MAX_SOURCE_MAP_NAMES = 1_000_000;
const MAX_SOURCE_MAP_SECTIONS = 65_536;
const MAX_SOURCE_MAP_SOURCES = 262_144;
const MAX_SOURCE_IDENTITY_LENGTH = 16_384;
const SOURCE_MAP_MAPPINGS_PATTERN = /^[A-Za-z0-9+/,;]*$/u;
const URI_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/u;

interface SourceMapState {
  names: number;
  sections: number;
  sources: number;
}

export interface NativeSourceMapPolicyCheck {
  readonly kind: "required-source" | "forbidden-fragment";
  readonly pattern: string;
  readonly matches: number;
  readonly status: "pass" | "fail";
}

export interface NativeSourceMapPolicyReport {
  readonly schemaVersion: 0;
  readonly ok: boolean;
  readonly sourceMapPath: string;
  readonly sourceCount: number;
  readonly checks: readonly NativeSourceMapPolicyCheck[];
}

export interface VerifyNativeSourceMapPolicyOptions {
  readonly sourceMapPath: string;
  readonly sourceRoot: string;
  readonly requiredSources?: readonly string[];
  readonly forbiddenSourceFragments?: readonly string[];
}

export interface CanonicalNativeSourceMap {
  readonly map: Readonly<Record<string, unknown>>;
  readonly sourceCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
}

function isAbsolutePath(value: string): boolean {
  return path.isAbsolute(value) || path.win32.isAbsolute(value);
}

function validatePortableIdentity(value: string, label: string): string {
  if (
    value.length === 0 ||
    value.length > MAX_SOURCE_IDENTITY_LENGTH ||
    value.includes("\0")
  ) {
    throw new TypeError(
      `${label} must be a bounded non-empty source identity.`,
    );
  }
  const normalized = value.replaceAll("\\", "/");
  if (normalized.split("/").includes("..")) {
    throw new TypeError(`${label} escapes its portable source root.`);
  }
  return normalized;
}

function portableSourcePath(
  source: string,
  sourceRoot: string,
  portableOnly: boolean,
): string {
  const validated = validatePortableIdentity(source, "Source map input");
  if (validated.startsWith("file:")) {
    if (portableOnly) {
      throw new TypeError(
        `Source map input ${source} is not a canonical portable identity.`,
      );
    }
    try {
      return portableSourcePath(fileURLToPath(source), sourceRoot, false);
    } catch (error) {
      if (
        error instanceof TypeError &&
        /escapes|canonical/u.test(error.message)
      ) {
        throw error;
      }
      throw new TypeError(
        `Source map input ${source} is not a valid file URL.`,
      );
    }
  }
  if (!isAbsolutePath(source)) {
    if (portableOnly && validated !== source) {
      throw new TypeError(
        `Source map input ${source} is not a canonical portable identity.`,
      );
    }
    return validated;
  }
  if (portableOnly) {
    throw new TypeError(
      `Source map input ${source} is not a canonical portable identity.`,
    );
  }
  if (!isWithin(sourceRoot, source)) {
    throw new TypeError(
      `Source map input ${source} escapes the reviewed source root ${sourceRoot}.`,
    );
  }
  const relative = path.relative(sourceRoot, source).replaceAll(path.sep, "/");
  return `app:///${relative}`;
}

function normalizeGeneratedFile(
  value: unknown,
  portableOnly: boolean,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new TypeError("The Metro source map has an invalid file identity.");
  }
  const normalized = validatePortableIdentity(value, "Source map file");
  const fileName = normalized.slice(normalized.lastIndexOf("/") + 1);
  if (fileName === "" || fileName === ".") {
    throw new TypeError("The Metro source map has an invalid file identity.");
  }
  if (portableOnly && fileName !== value) {
    throw new TypeError(
      "The Metro source map file identity is not canonical and portable.",
    );
  }
  return fileName;
}

function sourceRootPath(
  value: unknown,
  sourceRoot: string,
): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string") {
    throw new TypeError("The Metro source map has an invalid sourceRoot.");
  }
  let resolved = value;
  if (value.startsWith("file:")) {
    try {
      resolved = fileURLToPath(value);
    } catch {
      throw new TypeError("The Metro source map has an invalid sourceRoot.");
    }
  }
  if (!isAbsolutePath(resolved) || !isWithin(sourceRoot, resolved)) {
    throw new TypeError(
      "The Metro source map sourceRoot must be an absolute path inside the reviewed source root.",
    );
  }
  return resolved;
}

function validateIgnoreList(
  value: unknown,
  name: string,
  sourceCount: number,
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new TypeError(`The Metro source map has an invalid ${name}.`);
  }
  let previous = -1;
  for (const index of value) {
    if (
      typeof index !== "number" ||
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= sourceCount ||
      index <= previous
    ) {
      throw new TypeError(`The Metro source map has an invalid ${name}.`);
    }
    previous = index;
  }
}

function base64Value(code: number): number {
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 97 + 26;
  if (code >= 48 && code <= 57) return code - 48 + 52;
  if (code === 43) return 62;
  if (code === 47) return 63;
  return -1;
}

function validateMappings(
  mappings: string,
  sourceCount: number,
  nameCount: number,
): void {
  let generatedColumn = 0;
  let sourceIndex = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let nameIndex = 0;
  let segmentStarted = false;
  let segmentRequired = false;
  let vlqContinues = false;
  let rawValue = 0;
  let shift = 0;
  const fields: number[] = [];

  const invalid = (): never => {
    throw new TypeError("The Metro source map has invalid VLQ mappings.");
  };
  const finishSegment = (): void => {
    if (fields.length !== 1 && fields.length !== 4 && fields.length !== 5) {
      invalid();
    }
    const generatedDelta = fields[0]!;
    if (generatedDelta < 0) invalid();
    generatedColumn += generatedDelta;
    if (!Number.isSafeInteger(generatedColumn)) invalid();
    if (fields.length >= 4) {
      sourceIndex += fields[1]!;
      originalLine += fields[2]!;
      originalColumn += fields[3]!;
      if (
        sourceIndex < 0 ||
        sourceIndex >= sourceCount ||
        originalLine < 0 ||
        originalColumn < 0 ||
        !Number.isSafeInteger(sourceIndex) ||
        !Number.isSafeInteger(originalLine) ||
        !Number.isSafeInteger(originalColumn)
      ) {
        invalid();
      }
    }
    if (fields.length === 5) {
      nameIndex += fields[4]!;
      if (
        nameIndex < 0 ||
        nameIndex >= nameCount ||
        !Number.isSafeInteger(nameIndex)
      ) {
        invalid();
      }
    }
    fields.length = 0;
    segmentStarted = false;
  };

  for (let index = 0; index < mappings.length; index += 1) {
    const code = mappings.charCodeAt(index);
    if (code === 44 || code === 59) {
      if (vlqContinues || segmentRequired || (code === 44 && !segmentStarted)) {
        invalid();
      }
      if (segmentStarted) finishSegment();
      if (code === 59) generatedColumn = 0;
      else segmentRequired = true;
      continue;
    }
    const digit = base64Value(code);
    if (digit < 0) invalid();
    segmentRequired = false;
    segmentStarted = true;
    const payload = digit & 31;
    if (shift > 50) invalid();
    rawValue += payload * 2 ** shift;
    if (!Number.isSafeInteger(rawValue)) invalid();
    if ((digit & 32) !== 0) {
      vlqContinues = true;
      shift += 5;
      continue;
    }
    const magnitude = Math.floor(rawValue / 2);
    fields.push(rawValue % 2 === 0 ? magnitude : -magnitude);
    if (fields.length > 5) invalid();
    rawValue = 0;
    shift = 0;
    vlqContinues = false;
  }
  if (vlqContinues || segmentRequired) {
    invalid();
  }
  if (segmentStarted) finishSegment();
}

function rewriteSourceMap(
  value: unknown,
  sourceRoot: string,
  state: SourceMapState,
  depth: number,
  portableOnly: boolean,
): Record<string, unknown> {
  if (!isRecord(value) || value.version !== 3) {
    throw new TypeError("The Metro source map must use source-map schema 3.");
  }
  if (depth > MAX_SOURCE_MAP_DEPTH) {
    throw new TypeError(
      `The Metro source map exceeds the ${MAX_SOURCE_MAP_DEPTH}-level nesting limit.`,
    );
  }
  const file = normalizeGeneratedFile(value.file, portableOnly);
  if (file === undefined) delete value.file;
  else value.file = file;

  const hasSources = value.sources !== undefined;
  const hasSections = value.sections !== undefined;
  if (hasSources === hasSections) {
    throw new TypeError(
      "The Metro source map must contain exactly one of sources or sections.",
    );
  }

  if (hasSections) {
    if (
      value.sourceRoot !== undefined ||
      value.sourcesContent !== undefined ||
      value.names !== undefined ||
      value.mappings !== undefined
    ) {
      throw new TypeError(
        "The indexed Metro source map cannot mix section and flat-map fields.",
      );
    }
    if (!Array.isArray(value.sections) || value.sections.length === 0) {
      throw new TypeError("The indexed Metro source map has invalid sections.");
    }
    state.sections += value.sections.length;
    if (state.sections > MAX_SOURCE_MAP_SECTIONS) {
      throw new TypeError(
        `The Metro source map exceeds the ${MAX_SOURCE_MAP_SECTIONS}-section limit.`,
      );
    }
    let previousLine = -1;
    let previousColumn = -1;
    for (const section of value.sections) {
      if (
        !isRecord(section) ||
        Object.keys(section).length !== 2 ||
        !Object.hasOwn(section, "offset") ||
        !Object.hasOwn(section, "map") ||
        !isRecord(section.offset) ||
        Object.keys(section.offset).length !== 2 ||
        !Object.hasOwn(section.offset, "line") ||
        !Object.hasOwn(section.offset, "column") ||
        typeof section.offset.line !== "number" ||
        !Number.isSafeInteger(section.offset.line) ||
        section.offset.line < 0 ||
        typeof section.offset.column !== "number" ||
        !Number.isSafeInteger(section.offset.column) ||
        section.offset.column < 0
      ) {
        throw new TypeError(
          "Every indexed Metro source-map section must contain one inline map and a non-negative line/column offset.",
        );
      }
      if (
        section.offset.line < previousLine ||
        (section.offset.line === previousLine &&
          section.offset.column <= previousColumn)
      ) {
        throw new TypeError(
          "Indexed Metro source-map section offsets must be strictly increasing.",
        );
      }
      previousLine = section.offset.line;
      previousColumn = section.offset.column;
      section.map = rewriteSourceMap(
        section.map,
        sourceRoot,
        state,
        depth + 1,
        portableOnly,
      );
    }
    return value;
  }

  if (!Array.isArray(value.sources) || value.sources.length === 0) {
    throw new TypeError("The Metro source map has an invalid sources array.");
  }
  if (!value.sources.every((source) => typeof source === "string")) {
    throw new TypeError("The Metro source map has an invalid sources array.");
  }
  if (
    !Array.isArray(value.sourcesContent) ||
    value.sourcesContent.length !== value.sources.length ||
    !value.sourcesContent.every((content) => typeof content === "string")
  ) {
    throw new TypeError(
      "The Metro source map must embed one source-content string for every source.",
    );
  }
  if (
    !Array.isArray(value.names) ||
    !value.names.every((name) => typeof name === "string")
  ) {
    throw new TypeError("The Metro source map has an invalid names array.");
  }
  if (
    typeof value.mappings !== "string" ||
    !SOURCE_MAP_MAPPINGS_PATTERN.test(value.mappings)
  ) {
    throw new TypeError("The Metro source map has invalid VLQ mappings.");
  }
  validateMappings(value.mappings, value.sources.length, value.names.length);
  state.sources += value.sources.length;
  state.names += value.names.length;
  if (state.sources > MAX_SOURCE_MAP_SOURCES) {
    throw new TypeError(
      `The Metro source map exceeds the ${MAX_SOURCE_MAP_SOURCES}-source limit.`,
    );
  }
  if (state.names > MAX_SOURCE_MAP_NAMES) {
    throw new TypeError(
      `The Metro source map exceeds the ${MAX_SOURCE_MAP_NAMES}-name limit.`,
    );
  }
  validateIgnoreList(
    value.x_google_ignoreList,
    "x_google_ignoreList",
    value.sources.length,
  );
  validateIgnoreList(value.ignoreList, "ignoreList", value.sources.length);

  if (portableOnly && value.sourceRoot !== undefined) {
    throw new TypeError(
      "The canonical Metro source map must not retain sourceRoot.",
    );
  }
  const declaredRoot = sourceRootPath(value.sourceRoot, sourceRoot);
  value.sources = value.sources.map((source) => {
    const resolved =
      declaredRoot !== undefined &&
      !isAbsolutePath(source) &&
      !URI_SCHEME_PATTERN.test(source)
        ? path.resolve(declaredRoot, source)
        : source;
    return portableSourcePath(resolved, sourceRoot, portableOnly);
  });
  delete value.sourceRoot;
  return value;
}

async function readSourceMap(
  sourceMapPath: string,
): Promise<Record<string, unknown>> {
  let metadata;
  try {
    metadata = await lstat(sourceMapPath);
  } catch {
    throw new TypeError(
      `Metro source map ${sourceMapPath} is missing or unreadable.`,
    );
  }
  if (!metadata.isFile()) {
    throw new TypeError("The Metro source-map output is not a regular file.");
  }
  if (metadata.size === 0 || metadata.size > MAX_SOURCE_MAP_BYTES) {
    throw new TypeError(
      `The Metro source map must contain 1-${MAX_SOURCE_MAP_BYTES} bytes.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(sourceMapPath, "utf8"));
  } catch (error) {
    throw new TypeError(
      `The Metro source map is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const after = await lstat(sourceMapPath).catch(() => undefined);
  if (
    after?.isFile() !== true ||
    after.size !== metadata.size ||
    after.mtimeMs !== metadata.mtimeMs
  ) {
    throw new TypeError("The Metro source map changed while being read.");
  }
  if (!isRecord(parsed)) {
    throw new TypeError("The Metro source map must contain an object.");
  }
  return parsed;
}

export async function canonicalizeNativeSourceMap(
  sourceMapPath: string,
  sourceRoot: string,
): Promise<number> {
  const normalizedRoot = path.resolve(sourceRoot);
  if (normalizedRoot === path.parse(normalizedRoot).root) {
    throw new TypeError(
      "The source-map trust root cannot be the filesystem root.",
    );
  }
  const parsed = await readSourceMap(sourceMapPath);
  const state: SourceMapState = { names: 0, sections: 0, sources: 0 };
  const rewritten = rewriteSourceMap(parsed, normalizedRoot, state, 0, false);
  const temporaryPath = `${sourceMapPath}.solid-native-${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(rewritten)}\n`, {
      flag: "wx",
    });
    await rename(temporaryPath, sourceMapPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return state.sources;
}

/** Validates a previously canonicalized map without mutating it. */
export async function readCanonicalNativeSourceMap(
  sourceMapPath: string,
): Promise<CanonicalNativeSourceMap> {
  const absolutePath = path.resolve(sourceMapPath);
  const parsed = await readSourceMap(absolutePath);
  const state: SourceMapState = { names: 0, sections: 0, sources: 0 };
  const map = rewriteSourceMap(
    parsed,
    path.dirname(absolutePath),
    state,
    0,
    true,
  );
  return Object.freeze({ map, sourceCount: state.sources });
}

/** Validates a previously canonicalized map without mutating it. */
export async function validateCanonicalNativeSourceMap(
  sourceMapPath: string,
): Promise<number> {
  return (await readCanonicalNativeSourceMap(sourceMapPath)).sourceCount;
}

function collectSourceIdentities(
  value: Readonly<Record<string, unknown>>,
): string[] {
  if (Array.isArray(value.sources)) {
    return value.sources.filter(
      (source): source is string => typeof source === "string",
    );
  }
  if (!Array.isArray(value.sections)) return [];
  return value.sections.flatMap((section) => {
    if (!isRecord(section) || !isRecord(section.map)) return [];
    return collectSourceIdentities(section.map);
  });
}

function policyPatterns(
  values: readonly string[] | undefined,
  label: string,
): readonly string[] {
  const patterns = values ?? [];
  if (patterns.length > 256) {
    throw new TypeError(`${label} cannot contain more than 256 entries.`);
  }
  const seen = new Set<string>();
  return Object.freeze(
    patterns.map((value) => {
      const normalized = validatePortableIdentity(value, label);
      if (normalized !== value) {
        throw new TypeError(`${label} must use canonical forward slashes.`);
      }
      if (seen.has(normalized)) {
        throw new TypeError(`${label} cannot contain duplicate entries.`);
      }
      seen.add(normalized);
      return normalized;
    }),
  );
}

/**
 * Validates a raw or canonical Metro map and checks its normalized source graph.
 * Required identities must occur exactly once; forbidden fragments must not
 * occur at all. Policy mismatches are reported rather than thrown.
 */
export async function verifyNativeSourceMapPolicy(
  options: VerifyNativeSourceMapPolicyOptions,
): Promise<NativeSourceMapPolicyReport> {
  const normalizedRoot = path.resolve(options.sourceRoot);
  if (normalizedRoot === path.parse(normalizedRoot).root) {
    throw new TypeError(
      "The source-map policy trust root cannot be the filesystem root.",
    );
  }
  const requiredSources = policyPatterns(
    options.requiredSources,
    "Required source identity",
  );
  const forbiddenFragments = policyPatterns(
    options.forbiddenSourceFragments,
    "Forbidden source fragment",
  );
  if (requiredSources.length === 0 && forbiddenFragments.length === 0) {
    throw new TypeError(
      "A source-map policy requires at least one required source or forbidden fragment.",
    );
  }
  const sourceMapPath = path.resolve(options.sourceMapPath);
  if (!isWithin(normalizedRoot, sourceMapPath)) {
    throw new TypeError(
      `The source map ${sourceMapPath} escapes the reviewed source root ${normalizedRoot}.`,
    );
  }
  const parsed = await readSourceMap(sourceMapPath);
  const state: SourceMapState = { names: 0, sections: 0, sources: 0 };
  const normalized = rewriteSourceMap(parsed, normalizedRoot, state, 0, false);
  const sources = collectSourceIdentities(normalized);
  const checks: NativeSourceMapPolicyCheck[] = [
    ...requiredSources.map((pattern) => {
      const matches = sources.filter((source) => source === pattern).length;
      return Object.freeze({
        kind: "required-source" as const,
        pattern,
        matches,
        status: matches === 1 ? ("pass" as const) : ("fail" as const),
      });
    }),
    ...forbiddenFragments.map((pattern) => {
      const matches = sources.filter((source) =>
        source.includes(pattern),
      ).length;
      return Object.freeze({
        kind: "forbidden-fragment" as const,
        pattern,
        matches,
        status: matches === 0 ? ("pass" as const) : ("fail" as const),
      });
    }),
  ];
  return Object.freeze({
    schemaVersion: 0 as const,
    ok: checks.every((check) => check.status === "pass"),
    sourceMapPath,
    sourceCount: state.sources,
    checks: Object.freeze(checks),
  });
}

export function formatNativeSourceMapPolicyReport(
  report: NativeSourceMapPolicyReport,
): string {
  const lines = report.checks.map((check) => {
    const expectation = check.kind === "required-source" ? "exactly 1" : "0";
    return `${check.status === "pass" ? "PASS" : "FAIL"} ${check.kind} ${check.pattern}: ${String(check.matches)} match(es), expected ${expectation}`;
  });
  lines.push(
    `${report.ok ? "PASS" : "FAIL"} source-map policy: ${String(report.sourceCount)} source entries in ${report.sourceMapPath}`,
  );
  return lines.join("\n");
}
