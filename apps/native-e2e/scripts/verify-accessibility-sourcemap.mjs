import fs from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_SOURCE_PATTERNS = Object.freeze([
  /\/apps\/native-e2e\/accessibility\.tsx$/u,
  /\/packages\/accessibility\/dist\/index\.js$/u,
  /\/packages\/accessibility\/dist\/react-native-adapter\.js$/u,
  /\/packages\/accessibility\/dist\/react-native\.js$/u,
  /\/packages\/accessibility\/dist\/solid\.js$/u,
]);

function collectSources(map) {
  if (Array.isArray(map?.sources)) return map.sources;
  if (!Array.isArray(map?.sections)) {
    throw new Error("The bundle source map has neither sources nor sections.");
  }
  return map.sections.flatMap((section) => collectSources(section?.map));
}

export function assertAccessibilityBundle(map) {
  const sources = collectSources(map).filter(
    (source) => typeof source === "string",
  );
  const matchedSources = [];
  for (const pattern of REQUIRED_SOURCE_PATTERNS) {
    const matches = sources.filter((source) => pattern.test(source));
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one accessibility proof source ${String(pattern)}, found ${JSON.stringify(matches)}.`,
      );
    }
    matchedSources.push(matches[0]);
  }
  const unexpectedAccessibilitySources = sources.filter(
    (source) =>
      source.includes("/packages/accessibility/") &&
      !matchedSources.includes(source),
  );
  if (unexpectedAccessibilitySources.length > 0) {
    throw new Error(
      `The accessibility proof retained unexpected package sources: ${JSON.stringify(unexpectedAccessibilitySources)}.`,
    );
  }
  const forbiddenFacadeSources = sources.filter((source) =>
    source.includes(
      "/react-native/Libraries/Components/AccessibilityInfo/AccessibilityInfo.js",
    ),
  );
  if (forbiddenFacadeSources.length > 0) {
    throw new Error(
      `The accessibility proof evaluated React Native's AccessibilityInfo facade: ${JSON.stringify(forbiddenFacadeSources)}.`,
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
  const evidence = assertAccessibilityBundle(map);
  console.log(
    `Verified the complete Solid-owned accessibility seam in ${absolutePath}: ${JSON.stringify(evidence)}.`,
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main();
}
