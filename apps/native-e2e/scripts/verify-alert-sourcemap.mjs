import fs from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_SOURCE_PATTERNS = Object.freeze([
  /\/apps\/native-e2e\/alert\.tsx$/u,
  /\/packages\/dialogs\/dist\/index\.js$/u,
  /\/packages\/dialogs\/dist\/react-native-adapter\.js$/u,
  /\/packages\/dialogs\/dist\/react-native\.js$/u,
  /\/packages\/dialogs\/dist\/solid\.js$/u,
]);

function collectSources(map) {
  if (Array.isArray(map?.sources)) return map.sources;
  if (!Array.isArray(map?.sections)) {
    throw new Error("The bundle source map has neither sources nor sections.");
  }
  return map.sections.flatMap((section) => collectSources(section?.map));
}

export function assertAlertBundle(map) {
  const sources = collectSources(map).filter(
    (source) => typeof source === "string",
  );
  const matchedSources = [];
  for (const pattern of REQUIRED_SOURCE_PATTERNS) {
    const matches = sources.filter((source) => pattern.test(source));
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one alert proof source ${String(pattern)}, found ${JSON.stringify(matches)}.`,
      );
    }
    matchedSources.push(matches[0]);
  }
  const unexpectedDialogSources = sources.filter(
    (source) =>
      source.includes("/packages/dialogs/") && !matchedSources.includes(source),
  );
  if (unexpectedDialogSources.length > 0) {
    throw new Error(
      `The alert proof retained unexpected dialog package sources: ${JSON.stringify(unexpectedDialogSources)}.`,
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
  const evidence = assertAlertBundle(map);
  console.log(
    `Verified the complete Solid-owned alert seam in ${absolutePath}: ${JSON.stringify(evidence)}.`,
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main();
}
