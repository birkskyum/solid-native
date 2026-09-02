"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const remapping = require("@jridgewell/remapping");
const {
  GREATEST_LOWER_BOUND,
  TraceMap,
  originalPositionFor,
} = require("@jridgewell/trace-mapping");
const metroWorker = require("metro-transform-worker");
const {
  solidNativeCompilerCacheKey,
  transformSolidNativeJsx,
} = require("@solid-native/compiler");
const vlq = require("vlq");

const workerSource = fs.readFileSync(__filename);

function usesReactControl() {
  return process.env.SOLID_NATIVE_REACT_CONTROL === "1";
}

function shouldCompile(filename) {
  return (
    !usesReactControl() &&
    !filename.includes(`${path.sep}node_modules${path.sep}`) &&
    /\.[jt]sx$/.test(filename)
  );
}

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

function encodeFunctionMap(mappings) {
  const names = [];
  const nameIndexes = new Map();
  let encoded = "";
  let previousLine = 1;
  let previousColumn = 0;
  let previousNameIndex = 0;
  for (const [index, mapping] of mappings.entries()) {
    let nameIndex = nameIndexes.get(mapping.name);
    if (nameIndex === undefined) {
      nameIndex = names.length;
      nameIndexes.set(mapping.name, nameIndex);
      names.push(mapping.name);
    }
    const lineDelta = mapping.line - previousLine;
    const firstOnLine = index === 0 || lineDelta > 0;
    if (index > 0) encoded += lineDelta > 0 ? ";" : ",";
    if (firstOnLine) previousColumn = 0;
    const segment = [
      mapping.column - previousColumn,
      nameIndex - previousNameIndex,
    ];
    if (firstOnLine) segment.push(lineDelta);
    encoded += vlq.encode(segment);
    previousLine = mapping.line;
    previousColumn = mapping.column;
    previousNameIndex = nameIndex;
  }
  return { names, mappings: encoded };
}

function remapFunctionMap(functionMap, compilerMap) {
  if (functionMap === null || functionMap === undefined) return functionMap;
  const mappings = decodeFunctionMap(functionMap)
    .map((mapping) => {
      if (mapping.name === "<global>") {
        return { ...mapping, line: 1, column: 0 };
      }
      const original = originalPositionFor(compilerMap, {
        line: mapping.line,
        column: mapping.column,
        bias: GREATEST_LOWER_BOUND,
      });
      return original.line === null || original.column === null
        ? null
        : { ...mapping, line: original.line, column: original.column };
    })
    .filter((mapping) => mapping !== null)
    .sort((left, right) =>
      left.line === right.line
        ? left.column - right.column
        : left.line - right.line,
    )
    .filter(
      (mapping, index, all) =>
        index === all.length - 1 ||
        mapping.line !== all[index + 1].line ||
        mapping.column !== all[index + 1].column,
    );
  return encodeFunctionMap(mappings);
}

function composeOutputMap(output, filename, compiledSource, compilerMap) {
  if (!output.type.startsWith("js/")) return output;
  const metroMap = {
    version: 3,
    sources: [filename],
    sourcesContent: [compiledSource],
    names: output.data.map.names,
    mappings: output.data.map.mappings,
  };
  const map = remapping([metroMap, compilerMap], () => null);
  return {
    ...output,
    data: {
      ...output.data,
      map: { mappings: map.mappings, names: map.names },
      functionMap: remapFunctionMap(output.data.functionMap, compilerMap),
    },
  };
}

async function transform(config, projectRoot, filename, data, options) {
  if (!shouldCompile(filename)) {
    return metroWorker.transform(config, projectRoot, filename, data, options);
  }

  const result = transformSolidNativeJsx(data.toString("utf8"), filename);
  const transformed = await metroWorker.transform(
    config,
    projectRoot,
    filename,
    Buffer.from(result.code),
    options,
  );
  const compilerTraceMap = new TraceMap(result.map);
  return {
    ...transformed,
    output: transformed.output.map((output) =>
      composeOutputMap(output, filename, result.code, compilerTraceMap),
    ),
  };
}

function getCacheKey(config, options) {
  return crypto
    .createHash("sha256")
    .update(workerSource)
    .update(solidNativeCompilerCacheKey)
    .update(usesReactControl() ? "react-control" : "solid-oxc")
    .update(metroWorker.getCacheKey(config, options))
    .digest("hex");
}

module.exports = { getCacheKey, transform };
