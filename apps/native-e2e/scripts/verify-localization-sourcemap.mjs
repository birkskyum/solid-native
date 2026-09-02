import fs from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_SOURCE_PATTERNS = Object.freeze([
  /\/apps\/native-e2e\/localization\.tsx$/u,
  /\/packages\/localization\/dist\/index\.js$/u,
  /\/packages\/localization\/dist\/react-native-adapter\.js$/u,
  /\/packages\/localization\/dist\/react-native\.js$/u,
]);

const FORBIDDEN_REACT_NATIVE_FACADES = Object.freeze([
  "/Libraries/ReactNative/I18nManager.js",
  "/Libraries/ReactNative/NativeI18nManager.js",
  "/src/private/specs_DEPRECATED/modules/NativeI18nManager.js",
]);

function collectSources(map) {
  if (Array.isArray(map?.sources)) return map.sources;
  if (!Array.isArray(map?.sections)) {
    throw new Error("The bundle source map has neither sources nor sections.");
  }
  return map.sections.flatMap((section) => collectSources(section?.map));
}

export function assertLocalizationBundle(map) {
  const sources = collectSources(map).filter(
    (source) => typeof source === "string",
  );
  const matchedSources = [];
  for (const pattern of REQUIRED_SOURCE_PATTERNS) {
    const matches = sources.filter((source) => pattern.test(source));
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one localization proof source ${String(pattern)}, found ${JSON.stringify(matches)}.`,
      );
    }
    matchedSources.push(matches[0]);
  }
  const unexpectedPackageSources = sources.filter(
    (source) =>
      source.includes("/packages/localization/") &&
      !matchedSources.includes(source),
  );
  if (unexpectedPackageSources.length > 0) {
    throw new Error(
      `The localization proof retained unexpected package sources: ${JSON.stringify(unexpectedPackageSources)}.`,
    );
  }
  const forbiddenFacades = sources.filter((source) =>
    FORBIDDEN_REACT_NATIVE_FACADES.some((suffix) => source.endsWith(suffix)),
  );
  if (forbiddenFacades.length > 0) {
    throw new Error(
      `The localization proof retained React Native I18n facades: ${JSON.stringify(forbiddenFacades)}.`,
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
  const evidence = assertLocalizationBundle(map);
  console.log(
    `Verified the complete read-only localization seam in ${absolutePath}: ${JSON.stringify(evidence)}.`,
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main();
}
