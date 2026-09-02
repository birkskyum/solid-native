"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { transform: transformSolid } = require("@dom-expressions/compiler");
const remapping = require("@jridgewell/remapping");
const { transformSync: transformOxc } = require("oxc-transform");

const SOLID_NATIVE_BUILT_INS = Object.freeze([
  "For",
  "Show",
  "Switch",
  "Match",
  "Loading",
  "Reveal",
  "Portal",
  "Repeat",
  "Dynamic",
  "Errored",
]);

function dependencyManifest(name) {
  let directory = path.dirname(require.resolve(name));
  for (;;) {
    const manifest = path.join(directory, "package.json");
    if (fs.existsSync(manifest)) return fs.readFileSync(manifest);
    const parent = path.dirname(directory);
    if (parent === directory) {
      throw new Error(`Could not locate the package manifest for ${name}.`);
    }
    directory = parent;
  }
}

const solidNativeCompilerCacheKey = crypto
  .createHash("sha256")
  .update(fs.readFileSync(__filename))
  .update(dependencyManifest("@dom-expressions/compiler"))
  .update(dependencyManifest("oxc-transform"))
  .digest("hex");

function sourceText(value) {
  if (typeof value !== "string") {
    throw new TypeError("Solid Native compiler source must be a string.");
  }
  return value;
}

function sourceFilename(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new TypeError(
      "Solid Native compiler filename must be a non-empty string without null bytes.",
    );
  }
  return value;
}

function parseSourceMap(map, compiler) {
  if (map === null || map === undefined) {
    throw new Error(`${compiler} did not return the requested source map.`);
  }
  return typeof map === "string" ? JSON.parse(map) : map;
}

function assertTransformSucceeded(result, filename) {
  const errors = result.errors ?? [];
  if (errors.length === 0) return;
  const details = errors
    .map((error) => error.message ?? error.toString())
    .join("\n");
  throw new Error(`OXC could not transform ${filename}:\n${details}`);
}

function transformSolidNativeJsx(source, filename) {
  const normalizedSource = sourceText(source);
  const normalizedFilename = sourceFilename(filename);
  const result = transformSolid(normalizedSource, {
    filename: normalizedFilename,
    moduleName: "@solid-native/renderer",
    generate: "universal",
    builtIns: SOLID_NATIVE_BUILT_INS,
    contextToCustomElements: true,
    wrapConditionals: true,
    sourceMap: true,
  });
  return Object.freeze({
    code: result.code,
    map: parseSourceMap(result.map, "@dom-expressions/compiler"),
  });
}

function compileSolidNativeModule(source, filename) {
  const normalizedFilename = sourceFilename(filename);
  const solid = transformSolidNativeJsx(source, normalizedFilename);
  const javascript = transformOxc(normalizedFilename, solid.code, {
    lang: normalizedFilename.endsWith("x") ? "tsx" : "ts",
    sourceType: "module",
    jsx: "preserve",
    sourcemap: true,
    target: "node22",
    typescript: {
      onlyRemoveTypeImports: true,
    },
  });
  assertTransformSucceeded(javascript, normalizedFilename);

  const map = remapping(
    [parseSourceMap(javascript.map, "oxc-transform"), solid.map],
    () => null,
  );
  return Object.freeze({ code: javascript.code, map });
}

module.exports = {
  SOLID_NATIVE_BUILT_INS,
  compileSolidNativeModule,
  solidNativeCompilerCacheKey,
  transformSolidNativeJsx,
};
