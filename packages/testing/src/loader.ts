import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { compileSolidNativeModule } from "@solid-native/compiler";

const TEST_MODULE_EXTENSIONS = new Set([".ts", ".tsx", ".mts"]);
const TEST_MODULE_MAX_BYTES = 8 * 1_024 * 1_024;

interface NativeTestLoadContext {
  readonly format?: string | null;
  readonly importAttributes?: Readonly<Record<string, string>>;
}

interface NativeTestLoadResult {
  readonly format: string;
  readonly shortCircuit?: boolean;
  readonly source?: string | ArrayBuffer | ArrayBufferView;
}

type NextLoad = (
  url: string,
  context: NativeTestLoadContext,
) => Promise<NativeTestLoadResult>;

type NextLoadSync = (
  url: string,
  context: NativeTestLoadContext,
) => NativeTestLoadResult;

function sourceMapComment(map: unknown): string {
  const encoded = Buffer.from(JSON.stringify(map), "utf8").toString("base64");
  return `//# sourceMappingURL=data:application/json;charset=utf-8;base64,${encoded}`;
}

function shouldCompile(url: string): boolean {
  const parsed = new URL(url);
  return (
    parsed.protocol === "file:" &&
    TEST_MODULE_EXTENSIONS.has(
      parsed.pathname.slice(parsed.pathname.lastIndexOf(".")),
    )
  );
}

function compileBytes(url: string, bytes: Uint8Array): NativeTestLoadResult {
  const filename = fileURLToPath(new URL(url));
  if (bytes.byteLength > TEST_MODULE_MAX_BYTES) {
    throw new RangeError(
      `Solid Native test module ${filename} exceeds ${String(TEST_MODULE_MAX_BYTES)} bytes.`,
    );
  }
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const transformed = compileSolidNativeModule(source, filename);
  return {
    format: "module",
    shortCircuit: true,
    source: `${transformed.code}\n${sourceMapComment(transformed.map)}\n`,
  };
}

/** Node module hook used by the opt-in Solid Native test runner. */
export async function load(
  url: string,
  context: NativeTestLoadContext,
  nextLoad: NextLoad,
): Promise<NativeTestLoadResult> {
  if (!shouldCompile(url)) {
    return await nextLoad(url, context);
  }
  return compileBytes(url, await readFile(fileURLToPath(new URL(url))));
}

/** Same-thread hook used when the running Node release exposes registerHooks. */
export function loadSync(
  url: string,
  context: NativeTestLoadContext,
  nextLoad: NextLoadSync,
): NativeTestLoadResult {
  if (!shouldCompile(url)) return nextLoad(url, context);
  return compileBytes(url, readFileSync(fileURLToPath(new URL(url))));
}
