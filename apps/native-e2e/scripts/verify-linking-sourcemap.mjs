import fs from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_SOURCE_PATTERNS = Object.freeze([
  /\/apps\/native-e2e\/linking\.tsx$/u,
  /\/packages\/core\/dist\/index\.js$/u,
  /\/packages\/observability\/dist\/index\.js$/u,
  /\/packages\/runtime\/dist\/index\.js$/u,
  /\/packages\/runtime\/dist\/platform-services\.js$/u,
  /\/packages\/runtime\/dist\/react-native-platform-services\.js$/u,
  /\/react-native\/Libraries\/EventEmitter\/NativeEventEmitter\.js$/u,
  /\/react-native\/Libraries\/TurboModule\/TurboModuleRegistry\.js$/u,
]);

const FORBIDDEN_SOURCE_PATTERNS = Object.freeze([
  /\/react-native\/Libraries\/Linking\/Linking\.js$/u,
  /\/packages\/navigation\//u,
]);

function collectSources(map) {
  if (Array.isArray(map?.sources)) return map.sources;
  if (!Array.isArray(map?.sections)) {
    throw new Error("The bundle source map has neither sources nor sections.");
  }
  return map.sections.flatMap((section) => collectSources(section?.map));
}

export function assertLinkingBundle(map) {
  const sources = collectSources(map).filter(
    (source) => typeof source === "string",
  );
  const matchedSources = [];
  for (const pattern of REQUIRED_SOURCE_PATTERNS) {
    const matches = sources.filter((source) => pattern.test(source));
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one direct-Linking proof source ${String(pattern)}, found ${JSON.stringify(matches)}.`,
      );
    }
    matchedSources.push(matches[0]);
  }
  const unexpectedPlatformSources = sources.filter(
    (source) =>
      (source.includes("/packages/core/") ||
        source.includes("/packages/runtime/")) &&
      !matchedSources.includes(source),
  );
  if (unexpectedPlatformSources.length > 0) {
    throw new Error(
      `The direct-Linking proof retained unexpected platform package sources: ${JSON.stringify(unexpectedPlatformSources)}.`,
    );
  }
  const forbiddenSources = sources.filter((source) =>
    FORBIDDEN_SOURCE_PATTERNS.some((pattern) => pattern.test(source)),
  );
  if (forbiddenSources.length > 0) {
    throw new Error(
      `The direct-Linking proof evaluated a forbidden facade or navigation layer: ${JSON.stringify(forbiddenSources)}.`,
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
  const evidence = assertLinkingBundle(map);
  console.log(
    `Verified the complete direct-TurboModule Linking seam in ${absolutePath}: ${JSON.stringify(evidence)}.`,
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main();
}
