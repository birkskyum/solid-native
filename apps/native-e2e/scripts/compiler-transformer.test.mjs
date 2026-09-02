import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";

const require = createRequire(import.meta.url);
delete process.env.SOLID_NATIVE_REACT_CONTROL;
const applicationRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const { getDefaultConfig } = require("@react-native/metro-config");
const worker = require("@solid-native/metro/transform-worker");
const vlq = require("vlq");

test("does not expose a Babel Solid compiler fallback", () => {
  assert.throws(
    () => require.resolve("babel-preset-solid"),
    (error) => error?.code === "MODULE_NOT_FOUND",
  );
});

function decodeFunctionMap(functionMap) {
  const mappings = [];
  let line = 1;
  let nameIndex = 0;
  for (const lineMappings of functionMap.mappings.split(";")) {
    let column = 0;
    for (const mapping of lineMappings.split(",")) {
      if (mapping === "") continue;
      const [columnDelta, nameDelta, lineDelta = 0] = vlq.decode(mapping);
      line += lineDelta;
      nameIndex += nameDelta;
      column += columnDelta;
      mappings.push({ line, column, name: functionMap.names[nameIndex] });
    }
  }
  return mappings;
}

test("runs Solid universal OXC before Metro and composes source maps", async () => {
  const filename = join(applicationRoot, "fixture.tsx");
  const source = `/** @jsxImportSource @solid-native/core */
import { Text } from "@solid-native/core";
type Props = { count: number };
export const Counter = (props: Props) => <Text>solid-native:source-map-probe {props.count}</Text>;
`;
  const config = getDefaultConfig(applicationRoot);
  const result = await worker.transform(
    config.transformer,
    applicationRoot,
    filename,
    Buffer.from(source),
    {
      dev: false,
      experimentalImportSupport: false,
      inlineRequires: false,
      inlinePlatform: true,
      minify: false,
      platform: "android",
      type: "module",
      unstable_transformProfile: "hermes-stable",
    },
  );

  const output = result.output[0].data;
  assert.doesNotMatch(output.code, /<Text>/);
  assert.equal(
    result.dependencies.some(
      (dependency) => dependency.name === "@solid-native/renderer",
    ),
    true,
  );
  const probeOffset = output.code.indexOf("solid-native:source-map-probe");
  assert.notEqual(probeOffset, -1);
  const precedingCode = output.code.slice(0, probeOffset);
  const generatedLine = precedingCode.split("\n").length;
  const generatedColumn = probeOffset - precedingCode.lastIndexOf("\n") - 1;
  const map = new TraceMap({
    version: 3,
    sources: [filename],
    sourcesContent: [source],
    names: output.map.names,
    mappings: output.map.mappings,
  });
  const original = originalPositionFor(map, {
    line: generatedLine,
    column: generatedColumn,
  });
  assert.equal(original.line, 4);
  assert.equal(original.source, filename);
  assert.equal(
    decodeFunctionMap(output.functionMap).some(
      (mapping) => mapping.name === "Counter" && mapping.line === 4,
    ),
    true,
  );
  assert.match(
    worker.getCacheKey(config.transformer, { projectRoot: applicationRoot }),
    /^[a-f0-9]{64}$/,
  );
  const solidCacheKey = worker.getCacheKey(config.transformer, {
    projectRoot: applicationRoot,
  });
  process.env.SOLID_NATIVE_REACT_CONTROL = "1";
  try {
    assert.notEqual(
      worker.getCacheKey(config.transformer, { projectRoot: applicationRoot }),
      solidCacheKey,
    );
  } finally {
    delete process.env.SOLID_NATIVE_REACT_CONTROL;
  }
});
