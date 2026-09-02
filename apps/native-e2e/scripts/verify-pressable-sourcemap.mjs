import fs from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_SOURCE_PATTERNS = Object.freeze([
  /\/apps\/native-e2e\/pressable\.tsx$/u,
  /\/packages\/core\/dist\/index\.js$/u,
]);

const FORBIDDEN_REACT_PRESSABLE_SOURCES = Object.freeze([
  "/Libraries/Components/Pressable/Pressable.js",
  "/Libraries/Components/Pressable/useAndroidRippleForView.js",
  "/Libraries/Pressability/Pressability.js",
  "/Libraries/Pressability/usePressability.js",
]);

function collectSources(map) {
  if (Array.isArray(map?.sources)) return map.sources;
  if (!Array.isArray(map?.sections)) {
    throw new Error("The bundle source map has neither sources nor sections.");
  }
  return map.sections.flatMap((section) => collectSources(section?.map));
}

export function assertPressableBundle(map) {
  const sources = collectSources(map).filter(
    (source) => typeof source === "string",
  );
  const matchedSources = [];
  for (const pattern of REQUIRED_SOURCE_PATTERNS) {
    const matches = sources.filter((source) => pattern.test(source));
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one Pressable proof source ${String(pattern)}, found ${JSON.stringify(matches)}.`,
      );
    }
    matchedSources.push(matches[0]);
  }
  const forbidden = sources.filter((source) =>
    FORBIDDEN_REACT_PRESSABLE_SOURCES.some((suffix) => source.endsWith(suffix)),
  );
  if (forbidden.length > 0) {
    throw new Error(
      `The Solid Native Pressable proof retained React's Pressable implementation: ${JSON.stringify(forbidden)}.`,
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
  const evidence = assertPressableBundle(map);
  console.log(
    `Verified the React-free Solid Native Pressable proof in ${absolutePath}: ${JSON.stringify(evidence)}.`,
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main();
}
