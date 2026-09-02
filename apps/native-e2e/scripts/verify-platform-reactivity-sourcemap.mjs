import fs from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_SOURCE_PATTERNS = Object.freeze([
  /\/apps\/native-e2e\/platform-reactivity\.tsx$/u,
  /\/packages\/core\/dist\/index\.js$/u,
  /\/packages\/runtime\/dist\/index\.js$/u,
  /\/packages\/runtime\/dist\/platform-services\.js$/u,
  /\/packages\/runtime\/dist\/react-native-platform-services\.js$/u,
  /\/react-native\/Libraries\/Utilities\/Appearance\.js$/u,
  /\/react-native\/Libraries\/Utilities\/Dimensions\.js$/u,
]);

const FORBIDDEN_REACT_HOOK_PATTERNS = Object.freeze([
  /\/react-native\/Libraries\/Utilities\/useColorScheme\.js$/u,
  /\/react-native\/Libraries\/Utilities\/useWindowDimensions\.js$/u,
]);

function collectSources(map) {
  if (Array.isArray(map?.sources)) return map.sources;
  if (!Array.isArray(map?.sections)) {
    throw new Error("The bundle source map has neither sources nor sections.");
  }
  return map.sections.flatMap((section) => collectSources(section?.map));
}

export function assertPlatformReactivityBundle(map) {
  const sources = collectSources(map).filter(
    (source) => typeof source === "string",
  );
  const matchedSources = [];
  for (const pattern of REQUIRED_SOURCE_PATTERNS) {
    const matches = sources.filter((source) => pattern.test(source));
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one platform-reactivity proof source ${String(pattern)}, found ${JSON.stringify(matches)}.`,
      );
    }
    matchedSources.push(matches[0]);
  }
  const unexpectedPackageSources = sources.filter(
    (source) =>
      (source.includes("/packages/core/") ||
        source.includes("/packages/runtime/")) &&
      !matchedSources.includes(source),
  );
  if (unexpectedPackageSources.length > 0) {
    throw new Error(
      `The platform-reactivity proof retained unexpected package sources: ${JSON.stringify(unexpectedPackageSources)}.`,
    );
  }
  const forbiddenHooks = sources.filter((source) =>
    FORBIDDEN_REACT_HOOK_PATTERNS.some((pattern) => pattern.test(source)),
  );
  if (forbiddenHooks.length > 0) {
    throw new Error(
      `The platform-reactivity proof evaluated React Native appearance or dimensions hooks: ${JSON.stringify(forbiddenHooks)}.`,
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
  const evidence = assertPlatformReactivityBundle(map);
  console.log(
    `Verified the complete hook-free Solid platform-reactivity seam in ${absolutePath}: ${JSON.stringify(evidence)}.`,
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main();
}
