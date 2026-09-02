import fs from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_SOURCE_PATTERNS = Object.freeze([
  /\/apps\/native-e2e\/clipboard\.tsx$/u,
  /\/packages\/clipboard\/dist\/index\.js$/u,
  /\/packages\/clipboard\/dist\/react-native-adapter\.js$/u,
  /\/packages\/clipboard\/dist\/react-native\.js$/u,
  /\/packages\/clipboard\/dist\/solid\.js$/u,
]);

const FORBIDDEN_REACT_NATIVE_FACADES = Object.freeze([
  "/Libraries/Components/Clipboard/Clipboard.js",
  "/Libraries/Components/Clipboard/NativeClipboard.js",
  "/src/private/specs_DEPRECATED/modules/NativeClipboard.js",
]);

function collectSources(map) {
  if (Array.isArray(map?.sources)) return map.sources;
  if (!Array.isArray(map?.sections)) {
    throw new Error("The bundle source map has neither sources nor sections.");
  }
  return map.sections.flatMap((section) => collectSources(section?.map));
}

export function assertClipboardBundle(map) {
  const sources = collectSources(map).filter(
    (source) => typeof source === "string",
  );
  const matchedSources = [];
  for (const pattern of REQUIRED_SOURCE_PATTERNS) {
    const matches = sources.filter((source) => pattern.test(source));
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one clipboard proof source ${String(pattern)}, found ${JSON.stringify(matches)}.`,
      );
    }
    matchedSources.push(matches[0]);
  }
  const unexpectedPackageSources = sources.filter(
    (source) =>
      source.includes("/packages/clipboard/") &&
      !matchedSources.includes(source),
  );
  if (unexpectedPackageSources.length > 0) {
    throw new Error(
      `The clipboard proof retained unexpected package sources: ${JSON.stringify(unexpectedPackageSources)}.`,
    );
  }
  const forbiddenFacades = sources.filter((source) =>
    FORBIDDEN_REACT_NATIVE_FACADES.some((suffix) => source.endsWith(suffix)),
  );
  if (forbiddenFacades.length > 0) {
    throw new Error(
      `The clipboard proof retained React Native clipboard facades: ${JSON.stringify(forbiddenFacades)}.`,
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
  const evidence = assertClipboardBundle(map);
  console.log(
    `Verified the complete owner-safe clipboard seam in ${absolutePath}: ${JSON.stringify(evidence)}.`,
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main();
}
