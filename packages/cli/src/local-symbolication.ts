import path from "node:path";

import {
  AnyMap,
  isIgnored,
  originalPositionFor,
  type SectionedSourceMapInput,
} from "@jridgewell/trace-mapping";

import { readCanonicalNativeSourceMap } from "./source-map.js";

export const NATIVE_SYMBOLICATION_MAX_LOCATIONS = 1_024;

export interface NativeGeneratedSourceLocation {
  /** One-based generated line, matching JavaScript stack traces. */
  readonly line: number;
  /** One-based generated column, matching JavaScript stack traces. */
  readonly column: number;
}

export interface NativeOriginalSourceLocation {
  readonly source: string;
  /** One-based original line. */
  readonly line: number;
  /** One-based original column. */
  readonly column: number;
  readonly name?: string;
  readonly ignored: boolean;
}

export interface NativeSymbolicatedSourceLocation {
  readonly generated: NativeGeneratedSourceLocation;
  readonly original?: NativeOriginalSourceLocation;
}

export interface NativeSourceLocationSymbolication {
  readonly kind: "solid-native.source-location-symbolication";
  readonly schemaVersion: 0;
  readonly sourceCount: number;
  readonly locations: readonly NativeSymbolicatedSourceLocation[];
}

export interface SymbolicateNativeSourceLocationsOptions {
  readonly sourceMapPath: string;
  readonly locations: readonly NativeGeneratedSourceLocation[];
  readonly cwd?: string;
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError(`${path} must be a positive safe integer.`);
  }
  return value as number;
}

function generatedLocations(
  value: readonly NativeGeneratedSourceLocation[],
): readonly NativeGeneratedSourceLocation[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("Symbolication locations must be a non-empty array.");
  }
  if (value.length > NATIVE_SYMBOLICATION_MAX_LOCATIONS) {
    throw new RangeError(
      `Symbolication cannot contain more than ${NATIVE_SYMBOLICATION_MAX_LOCATIONS} locations.`,
    );
  }
  return Object.freeze(
    value.map((item, index) => {
      if (item === null || typeof item !== "object" || Array.isArray(item)) {
        throw new TypeError(
          `Symbolication locations[${index}] must be a plain object.`,
        );
      }
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(
          `Symbolication locations[${index}] must be a plain object.`,
        );
      }
      const keys = Object.keys(item);
      if (
        keys.length !== 2 ||
        !Object.hasOwn(item, "line") ||
        !Object.hasOwn(item, "column")
      ) {
        throw new TypeError(
          `Symbolication locations[${index}] must contain only line and column.`,
        );
      }
      return Object.freeze({
        line: positiveInteger(
          item.line,
          `Symbolication locations[${index}].line`,
        ),
        column: positiveInteger(
          item.column,
          `Symbolication locations[${index}].column`,
        ),
      });
    }),
  );
}

/** Resolves explicit one-based generated positions through one canonical map. */
export async function symbolicateNativeSourceLocations(
  options: SymbolicateNativeSourceLocationsOptions,
): Promise<NativeSourceLocationSymbolication> {
  if (
    typeof options.sourceMapPath !== "string" ||
    options.sourceMapPath.length === 0
  ) {
    throw new TypeError(
      "Symbolication sourceMapPath must be a non-empty string.",
    );
  }
  const locations = generatedLocations(options.locations);
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const sourceMap = await readCanonicalNativeSourceMap(
    path.resolve(cwd, options.sourceMapPath),
  );
  const trace = AnyMap(
    sourceMap.map as unknown as SectionedSourceMapInput,
    null,
  );
  return Object.freeze({
    kind: "solid-native.source-location-symbolication",
    schemaVersion: 0,
    sourceCount: sourceMap.sourceCount,
    locations: Object.freeze(
      locations.map((generated) => {
        const mapped = originalPositionFor(trace, {
          line: generated.line,
          column: generated.column - 1,
        });
        if (
          mapped.source === null ||
          mapped.line === null ||
          mapped.column === null
        ) {
          return Object.freeze({ generated });
        }
        return Object.freeze({
          generated,
          original: Object.freeze({
            source: mapped.source,
            line: mapped.line,
            column: mapped.column + 1,
            ...(mapped.name === null ? {} : { name: mapped.name }),
            ignored: isIgnored(trace, mapped.source),
          }),
        });
      }),
    ),
  });
}

export function formatNativeSourceLocationSymbolication(
  result: NativeSourceLocationSymbolication,
): string {
  const terminalField = (value: string): string =>
    JSON.stringify(value).slice(1, -1);
  return [
    `PASS Solid Native local symbolication (${result.sourceCount} portable sources)`,
    ...result.locations.map(({ generated, original }) => {
      const input = `${generated.line}:${generated.column}`;
      if (original === undefined) return `${input} -> <unmapped>`;
      const name =
        original.name === undefined ? "" : ` (${terminalField(original.name)})`;
      const ignored = original.ignored ? " [ignored]" : "";
      return `${input} -> ${terminalField(original.source)}:${original.line}:${original.column}${name}${ignored}`;
    }),
  ].join("\n");
}
