import { open } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

import { parse as parseStackTrace } from "stacktrace-parser";

import {
  symbolicateNativeSourceLocations,
  type NativeGeneratedSourceLocation,
  type NativeOriginalSourceLocation,
} from "./local-symbolication.js";

export const NATIVE_STACK_MAX_INPUT_BYTES = 1_048_576;
export const NATIVE_STACK_MAX_INPUT_CHUNKS = 4_096;
export const NATIVE_STACK_MAX_LINES = 4_096;
export const NATIVE_STACK_MAX_FRAMES = 1_024;
export const NATIVE_STACK_MAX_METHOD_NAME_CHARACTERS = 1_024;
export const NATIVE_STACK_MAX_SKIPPED_FRAMES = 1_000_000;

export type NativeStackTraceDialect = "hermes" | "javascript";

export interface NativeParsedStackFrame {
  readonly index: number;
  readonly methodName: string;
  readonly generated: NativeGeneratedSourceLocation;
  readonly columnInferred: boolean;
}

export interface NativeParsedStackTrace {
  readonly dialect: NativeStackTraceDialect;
  readonly inputFrameCount: number;
  readonly omittedFrameCount: number;
  readonly frames: readonly NativeParsedStackFrame[];
}

export interface NativeSymbolicatedStackFrame extends NativeParsedStackFrame {
  readonly original?: NativeOriginalSourceLocation;
}

export interface NativeStackTraceSymbolication {
  readonly kind: "solid-native.stack-trace-symbolication";
  readonly schemaVersion: 0;
  readonly dialect: NativeStackTraceDialect;
  readonly sourceCount: number;
  readonly inputFrameCount: number;
  readonly omittedFrameCount: number;
  readonly frames: readonly NativeSymbolicatedStackFrame[];
}

export interface SymbolicateNativeStackTraceOptions {
  readonly sourceMapPath: string;
  readonly stack: string;
  readonly cwd?: string;
}

export interface SymbolicateNativeStackTraceFileOptions {
  readonly sourceMapPath: string;
  readonly stackPath: string;
  readonly cwd?: string;
}

export type NativeStackTraceInputStream = AsyncIterable<Uint8Array | string>;

export interface SymbolicateNativeStackTraceStreamOptions {
  readonly sourceMapPath: string;
  readonly stream: NativeStackTraceInputStream;
  readonly cwd?: string;
}

const HERMES_FRAME =
  /^ {4}at (.+?)(?: \((native)\)?| \((address at )?(.*?):(\d+):(\d+)\))$/u;
const HERMES_SKIPPED = /^ {4}\.\.\. skipping (\d+) frames$/u;
const HERMES_COMPONENT_FRAME = /^ {4}at .*$/u;

function safeInteger(value: string, path: string, minimum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new TypeError(
      `${path} must be a safe integer of at least ${minimum}.`,
    );
  }
  return parsed;
}

function methodName(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > NATIVE_STACK_MAX_METHOD_NAME_CHARACTERS ||
    /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value)
  ) {
    throw new TypeError(
      `${path} must contain 1-${NATIVE_STACK_MAX_METHOD_NAME_CHARACTERS} characters without control or bidirectional formatting characters.`,
    );
  }
  return value;
}

function checkedLines(stack: string): readonly string[] {
  if (typeof stack !== "string") {
    throw new TypeError("Native stack trace must be a string.");
  }
  if (Buffer.byteLength(stack, "utf8") > NATIVE_STACK_MAX_INPUT_BYTES) {
    throw new RangeError(
      `Native stack trace exceeds ${NATIVE_STACK_MAX_INPUT_BYTES} bytes.`,
    );
  }
  const encoded = Buffer.from(stack, "utf8");
  if (decodeStackBytes(encoded) !== stack) {
    throw new TypeError(
      "Native stack trace must contain valid Unicode scalar values.",
    );
  }
  const lines = stack.split(/\r?\n/u);
  if (lines.length > NATIVE_STACK_MAX_LINES) {
    throw new RangeError(
      `Native stack trace exceeds ${NATIVE_STACK_MAX_LINES} lines.`,
    );
  }
  return lines;
}

function pushFrame(
  frames: NativeParsedStackFrame[],
  frame: NativeParsedStackFrame,
): void {
  if (frames.length >= NATIVE_STACK_MAX_FRAMES) {
    throw new RangeError(
      `Native stack trace exceeds ${NATIVE_STACK_MAX_FRAMES} usable frames.`,
    );
  }
  frames.push(Object.freeze(frame));
}

function parseHermesStack(
  lines: readonly string[],
): NativeParsedStackTrace | undefined {
  let entries: Array<
    Readonly<{
      frame: RegExpExecArray | null;
      skipped: RegExpExecArray | null;
    }>
  > = [];
  let sawHermesEntry = false;
  let sawHermesSignal = false;
  for (const line of lines) {
    if (line === "") continue;
    const frame = HERMES_FRAME.exec(line);
    const skipped = HERMES_SKIPPED.exec(line);
    if (frame !== null || skipped !== null) {
      sawHermesEntry = true;
      sawHermesSignal ||=
        skipped !== null ||
        frame?.[2] === "native" ||
        frame?.[3] === "address at ";
      entries.push({ frame, skipped });
      continue;
    }
    if (HERMES_COMPONENT_FRAME.test(line)) continue;
    // Match the pinned Hermes parser: a later message invalidates earlier
    // entries, leaving only frames following the final message line.
    entries = [];
  }
  // Plain source-location frames overlap the generic JavaScript dialect. Use
  // the Hermes parser only when text carries at least one Hermes-specific
  // marker so V8/JSC stacks retain their own parsing semantics.
  if (!sawHermesEntry || !sawHermesSignal) return undefined;

  const frames: NativeParsedStackFrame[] = [];
  let inputFrameCount = 0;
  let omittedFrameCount = 0;
  for (const entry of entries) {
    if (entry.skipped !== null) {
      const skipped = safeInteger(
        entry.skipped[1]!,
        "Hermes skipped frame count",
        0,
      );
      omittedFrameCount += skipped;
      if (omittedFrameCount > NATIVE_STACK_MAX_SKIPPED_FRAMES) {
        throw new RangeError(
          `Hermes stack trace exceeds ${NATIVE_STACK_MAX_SKIPPED_FRAMES} omitted frames.`,
        );
      }
      continue;
    }
    const match = entry.frame!;
    const index = inputFrameCount;
    inputFrameCount += 1;
    if (inputFrameCount > NATIVE_STACK_MAX_FRAMES) {
      throw new RangeError(
        `Native stack trace exceeds ${NATIVE_STACK_MAX_FRAMES} frames.`,
      );
    }
    if (match[2] === "native") {
      omittedFrameCount += 1;
      continue;
    }
    const address = match[3] === "address at ";
    const sourceURL = match[4]!;
    if (address && sourceURL === "InternalBytecode.js") {
      omittedFrameCount += 1;
      continue;
    }
    const line = safeInteger(match[5]!, "Hermes frame line", 1);
    const rawColumn = safeInteger(
      match[6]!,
      "Hermes frame column or bytecode offset",
      address ? 0 : 1,
    );
    pushFrame(frames, {
      index,
      methodName: methodName(match[1], `Hermes frames[${index}].methodName`),
      generated: Object.freeze({
        line,
        column: address ? rawColumn + 1 : rawColumn,
      }),
      columnInferred: false,
    });
  }
  if (frames.length === 0) {
    throw new TypeError(
      "Hermes stack trace contains no source-map-compatible frames.",
    );
  }
  return Object.freeze({
    dialect: "hermes",
    inputFrameCount,
    omittedFrameCount,
    frames: Object.freeze(frames),
  });
}

function parseJavaScriptStack(
  stack: string,
  lines: readonly string[],
): NativeParsedStackTrace {
  const parsed = parseStackTrace(stack);
  if (parsed.length > NATIVE_STACK_MAX_FRAMES) {
    throw new RangeError(
      `Native stack trace exceeds ${NATIVE_STACK_MAX_FRAMES} frames.`,
    );
  }
  const frames: NativeParsedStackFrame[] = [];
  let omittedFrameCount = 0;
  for (const [index, frame] of parsed.entries()) {
    if (frame.file === null || frame.lineNumber === null) {
      omittedFrameCount += 1;
      continue;
    }
    const line = frame.lineNumber;
    const column = frame.column ?? 1;
    if (
      !Number.isSafeInteger(line) ||
      line < 1 ||
      !Number.isSafeInteger(column) ||
      column < 1
    ) {
      throw new TypeError(
        `JavaScript stack frames[${index}] returned an invalid location.`,
      );
    }
    pushFrame(frames, {
      index,
      methodName: methodName(
        frame.methodName,
        `JavaScript stack frames[${index}].methodName`,
      ),
      generated: Object.freeze({ line, column }),
      columnInferred: frame.column === null || frame.column === undefined,
    });
  }
  if (parsed.length === 0 && lines.some((line) => line.trim() !== "")) {
    throw new TypeError(
      "Native stack trace contains no supported Hermes or JavaScript frames.",
    );
  }
  if (frames.length === 0) {
    throw new TypeError(
      "Native stack trace contains no source-map-compatible frames.",
    );
  }
  return Object.freeze({
    dialect: "javascript",
    inputFrameCount: parsed.length,
    omittedFrameCount,
    frames: Object.freeze(frames),
  });
}

/** Parses the exact pinned Hermes dialect, then React Native's generic stack dialect. */
export function parseNativeStackTrace(stack: string): NativeParsedStackTrace {
  const lines = checkedLines(stack);
  return parseHermesStack(lines) ?? parseJavaScriptStack(stack, lines);
}

/** Maps a bounded parsed stack without retaining its raw message or file URLs. */
export async function symbolicateNativeStackTrace(
  options: SymbolicateNativeStackTraceOptions,
): Promise<NativeStackTraceSymbolication> {
  const parsed = parseNativeStackTrace(options.stack);
  const locations = await symbolicateNativeSourceLocations({
    sourceMapPath: options.sourceMapPath,
    locations: parsed.frames.map(({ generated }) => generated),
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  });
  return Object.freeze({
    kind: "solid-native.stack-trace-symbolication",
    schemaVersion: 0,
    dialect: parsed.dialect,
    sourceCount: locations.sourceCount,
    inputFrameCount: parsed.inputFrameCount,
    omittedFrameCount: parsed.omittedFrameCount,
    frames: Object.freeze(
      parsed.frames.map((frame, index) =>
        Object.freeze({
          ...frame,
          ...(locations.locations[index]?.original === undefined
            ? {}
            : { original: locations.locations[index].original }),
        }),
      ),
    ),
  });
}

function decodeStackBytes(bytes: Uint8Array): string {
  if (bytes.byteLength > NATIVE_STACK_MAX_INPUT_BYTES) {
    throw new RangeError(
      `Native stack trace exceeds ${NATIVE_STACK_MAX_INPUT_BYTES} bytes.`,
    );
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new TypeError("Native stack trace must be valid UTF-8.");
  }
}

async function readStackFile(filePath: string): Promise<string> {
  const handle = await open(filePath, "r");
  try {
    const file = await handle.stat();
    if (!file.isFile()) {
      throw new TypeError("Native stack trace path must be a file.");
    }
    if (file.size > NATIVE_STACK_MAX_INPUT_BYTES) {
      throw new RangeError(
        `Native stack trace exceeds ${NATIVE_STACK_MAX_INPUT_BYTES} bytes.`,
      );
    }
    const buffer = Buffer.allocUnsafe(NATIVE_STACK_MAX_INPUT_BYTES + 1);
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
    return decodeStackBytes(buffer.subarray(0, offset));
  } finally {
    await handle.close();
  }
}

export async function symbolicateNativeStackTraceFile(
  options: SymbolicateNativeStackTraceFileOptions,
): Promise<NativeStackTraceSymbolication> {
  if (typeof options.stackPath !== "string" || options.stackPath.length === 0) {
    throw new TypeError("Native stackPath must be a non-empty string.");
  }
  const cwd = path.resolve(options.cwd ?? process.cwd());
  return symbolicateNativeStackTrace({
    sourceMapPath: options.sourceMapPath,
    stack: await readStackFile(path.resolve(cwd, options.stackPath)),
    cwd,
  });
}

export async function symbolicateNativeStackTraceStream(
  options: SymbolicateNativeStackTraceStreamOptions,
): Promise<NativeStackTraceSymbolication> {
  const { stream } = options;
  if (
    stream === null ||
    (typeof stream !== "object" && typeof stream !== "function") ||
    typeof stream[Symbol.asyncIterator] !== "function"
  ) {
    throw new TypeError("Native stack input stream must be async iterable.");
  }
  const chunks: Buffer[] = [];
  let byteLength = 0;
  let chunkCount = 0;
  for await (const chunk of stream) {
    chunkCount += 1;
    if (chunkCount > NATIVE_STACK_MAX_INPUT_CHUNKS) {
      throw new RangeError(
        `Native stack input exceeds ${NATIVE_STACK_MAX_INPUT_CHUNKS} chunks.`,
      );
    }
    let bytes: Buffer;
    if (typeof chunk === "string") {
      const encodedLength = Buffer.byteLength(chunk, "utf8");
      if (encodedLength > NATIVE_STACK_MAX_INPUT_BYTES - byteLength) {
        throw new RangeError(
          `Native stack trace exceeds ${NATIVE_STACK_MAX_INPUT_BYTES} bytes.`,
        );
      }
      bytes = Buffer.from(chunk, "utf8");
      if (decodeStackBytes(bytes) !== chunk) {
        throw new TypeError(
          "Native stack input strings must contain valid Unicode scalar values.",
        );
      }
    } else if (chunk instanceof Uint8Array) bytes = Buffer.from(chunk);
    else {
      throw new TypeError(
        "Native stack input chunks must be strings or Uint8Array values.",
      );
    }
    byteLength += bytes.byteLength;
    if (byteLength > NATIVE_STACK_MAX_INPUT_BYTES) {
      throw new RangeError(
        `Native stack trace exceeds ${NATIVE_STACK_MAX_INPUT_BYTES} bytes.`,
      );
    }
    chunks.push(bytes);
  }
  return symbolicateNativeStackTrace({
    sourceMapPath: options.sourceMapPath,
    stack: decodeStackBytes(Buffer.concat(chunks, byteLength)),
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  });
}

export function formatNativeStackTraceSymbolication(
  result: NativeStackTraceSymbolication,
): string {
  const terminalField = (value: string): string =>
    JSON.stringify(value).slice(1, -1);
  return [
    `PASS Solid Native ${result.dialect} stack symbolication (${result.sourceCount} portable sources)`,
    `Frames: ${result.frames.length} usable, ${result.omittedFrameCount} omitted`,
    ...result.frames.map((frame) => {
      const generated = `${frame.generated.line}:${frame.generated.column}`;
      const inferred = frame.columnInferred ? " [column inferred]" : "";
      const displayMethodName = terminalField(frame.methodName);
      if (frame.original === undefined) {
        return `#${frame.index} ${displayMethodName} ${generated} -> <unmapped>${inferred}`;
      }
      const name =
        frame.original.name === undefined
          ? ""
          : ` (${terminalField(frame.original.name)})`;
      const ignored = frame.original.ignored ? " [ignored]" : "";
      return `#${frame.index} ${displayMethodName} ${generated} -> ${terminalField(frame.original.source)}:${frame.original.line}:${frame.original.column}${name}${ignored}${inferred}`;
    }),
  ].join("\n");
}
