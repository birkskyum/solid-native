import fs from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_SOURCE_PATTERNS = Object.freeze([
  /\/apps\/native-e2e\/devtools\.tsx$/u,
  /\/packages\/devtools\/dist\/index\.js$/u,
  /\/packages\/devtools\/dist\/react-native\.js$/u,
  /\/packages\/devtools\/dist\/network\.js$/u,
  /\/packages\/devtools\/dist\/solid\.js$/u,
  /\/packages\/devtools\/dist\/causal-solid\.js$/u,
  /\/packages\/devtools\/dist\/solid-diagnostics-development\.js$/u,
]);
const SOLID_DEVELOPMENT_RUNTIME_PATTERN = /\/solid-js\/dist\/dev\.js$/u;
const SIGNALS_DEVELOPMENT_RUNTIME_PATTERN =
  /\/@solidjs\/signals\/dist\/dev\.js$/u;

function collectSources(map) {
  if (Array.isArray(map?.sources)) return map.sources;
  if (!Array.isArray(map?.sections)) {
    throw new Error("The bundle source map has neither sources nor sections.");
  }
  return map.sections.flatMap((section) => collectSources(section?.map));
}

export function assertDevtoolsBundle(map) {
  const sources = collectSources(map).filter(
    (source) => typeof source === "string",
  );
  for (const pattern of [
    SOLID_DEVELOPMENT_RUNTIME_PATTERN,
    SIGNALS_DEVELOPMENT_RUNTIME_PATTERN,
  ]) {
    const matches = [
      ...new Set(sources.filter((source) => pattern.test(source))),
    ];
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one development runtime source ${String(pattern)}, found ${JSON.stringify(matches)}.`,
      );
    }
  }
  const matchedSources = [];
  for (const pattern of REQUIRED_SOURCE_PATTERNS) {
    const matches = sources.filter((source) => pattern.test(source));
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one development-overlay proof source ${String(pattern)}, found ${JSON.stringify(matches)}.`,
      );
    }
    matchedSources.push(matches[0]);
  }
  const unexpectedDevtoolsSources = sources.filter(
    (source) =>
      source.includes("/packages/devtools/") &&
      !matchedSources.includes(source),
  );
  if (unexpectedDevtoolsSources.length > 0) {
    throw new Error(
      `The development-overlay proof retained unexpected devtools package sources: ${JSON.stringify(unexpectedDevtoolsSources)}.`,
    );
  }
  return Object.freeze([...matchedSources]);
}

function main() {
  const sourceMapPath = process.argv[2];
  if (sourceMapPath === undefined) {
    throw new Error("Pass the generated Metro source-map path.");
  }
  const absolutePath = resolve(sourceMapPath);
  const map = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  const evidence = assertDevtoolsBundle(map);
  console.log(
    `Verified the complete Solid-owned development-overlay seam in ${absolutePath}: ${JSON.stringify(evidence)}.`,
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main();
}
