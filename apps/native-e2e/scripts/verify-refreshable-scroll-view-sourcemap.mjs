import fs from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_SOURCE_PATTERNS = Object.freeze([
  /\/apps\/native-e2e\/refreshable-scroll-view\.tsx$/u,
  /\/packages\/core\/dist\/index\.js$/u,
]);

const FORBIDDEN_REACT_NATIVE_FACADES = Object.freeze([
  "/Libraries/Components/RefreshControl/RefreshControl.js",
  "/Libraries/Components/RefreshControl/AndroidSwipeRefreshLayoutNativeComponent.js",
  "/Libraries/Components/RefreshControl/PullToRefreshViewNativeComponent.js",
  "/Libraries/Components/ScrollView/ScrollView.js",
]);

function collectSources(map) {
  if (Array.isArray(map?.sources)) return map.sources;
  if (!Array.isArray(map?.sections)) {
    throw new Error("The bundle source map has neither sources nor sections.");
  }
  return map.sections.flatMap((section) => collectSources(section?.map));
}

export function assertRefreshableScrollViewBundle(map) {
  const sources = collectSources(map).filter(
    (source) => typeof source === "string",
  );
  const matchedSources = [];
  for (const pattern of REQUIRED_SOURCE_PATTERNS) {
    const matches = sources.filter((source) => pattern.test(source));
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one pull-to-refresh proof source ${String(pattern)}, found ${JSON.stringify(matches)}.`,
      );
    }
    matchedSources.push(matches[0]);
  }
  const forbiddenFacades = sources.filter((source) =>
    FORBIDDEN_REACT_NATIVE_FACADES.some((suffix) => source.endsWith(suffix)),
  );
  if (forbiddenFacades.length > 0) {
    throw new Error(
      `The pull-to-refresh proof retained React Native component facades: ${JSON.stringify(forbiddenFacades)}.`,
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
  const evidence = assertRefreshableScrollViewBundle(map);
  console.log(
    `Verified the direct Solid-owned pull-to-refresh seam in ${absolutePath}: ${JSON.stringify(evidence)}.`,
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main();
}
