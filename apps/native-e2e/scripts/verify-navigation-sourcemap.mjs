import fs from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ENTRYPOINTS = Object.freeze({
  "navigation-restoration.tsx":
    /\/apps\/native-e2e\/navigation-restoration\.tsx$/u,
  "tabs.tsx": /\/apps\/native-e2e\/tabs\.tsx$/u,
});

const REQUIRED_SHARED_SOURCE_PATTERNS = Object.freeze([
  /\/apps\/native-e2e\/generated\/SolidNativeBindings\.ts$/u,
  /\/packages\/core\/dist\/index\.js$/u,
  /\/packages\/navigation\/dist\/error-reporting\.js$/u,
  /\/packages\/navigation\/dist\/index\.js$/u,
  /\/packages\/navigation\/dist\/tanstack-matches\.js$/u,
  /\/packages\/navigation\/dist\/tanstack-router\.js$/u,
]);

const REACT_NATIVE_SCREENS_JAVASCRIPT_PATTERN =
  /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?react-native-screens\/(?:src|lib)\//u;

function collectSources(map) {
  if (Array.isArray(map?.sources)) return map.sources;
  if (!Array.isArray(map?.sections)) {
    throw new Error("The bundle source map has neither sources nor sections.");
  }
  return map.sections.flatMap((section) => collectSources(section?.map));
}

function navigationEntrypoint(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError("Pass a supported navigation entrypoint.");
  }
  const entrypoint = basename(value);
  if (!Object.hasOwn(ENTRYPOINTS, entrypoint)) {
    throw new Error(`Unsupported navigation entrypoint: ${entrypoint}.`);
  }
  return entrypoint;
}

export function assertNavigationBundle(map, requestedEntrypoint) {
  const entrypoint = navigationEntrypoint(requestedEntrypoint);
  const sources = collectSources(map).filter(
    (source) => typeof source === "string",
  );
  const matchedSources = [];
  for (const pattern of [
    ENTRYPOINTS[entrypoint],
    ...REQUIRED_SHARED_SOURCE_PATTERNS,
  ]) {
    const matches = sources.filter((source) => pattern.test(source));
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one Solid-owned navigation source ${String(pattern)}, found ${JSON.stringify(matches)}.`,
      );
    }
    matchedSources.push(matches[0]);
  }

  const unexpectedNavigationSources = sources.filter(
    (source) =>
      source.includes("/packages/navigation/") &&
      !matchedSources.includes(source),
  );
  if (unexpectedNavigationSources.length > 0) {
    throw new Error(
      `The navigation proof retained unexpected navigation package sources: ${JSON.stringify(unexpectedNavigationSources)}.`,
    );
  }

  const screensJavaScriptSources = sources.filter((source) =>
    REACT_NATIVE_SCREENS_JAVASCRIPT_PATTERN.test(source),
  );
  if (screensJavaScriptSources.length > 0) {
    throw new Error(
      `The navigation proof evaluated react-native-screens JavaScript instead of using the generated native component seam: ${JSON.stringify(screensJavaScriptSources)}.`,
    );
  }

  return Object.freeze({
    entrypoint,
    sources: Object.freeze([...matchedSources]),
  });
}

function main() {
  const sourceMapPath = process.argv[2];
  const entrypoint = process.argv[3];
  if (sourceMapPath === undefined || entrypoint === undefined) {
    throw new Error(
      "Pass the generated Metro source-map path and navigation entrypoint.",
    );
  }
  const absolutePath = resolve(sourceMapPath);
  const map = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  const evidence = assertNavigationBundle(map, entrypoint);
  console.log(
    `Verified the direct Solid-owned ${evidence.entrypoint} navigation seam in ${absolutePath}: ${JSON.stringify(evidence.sources)}.`,
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main();
}
