import fs from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_SOURCE_PATTERNS = Object.freeze([
  /\/apps\/native-e2e\/secure-storage\.tsx$/u,
  /\/packages\/secure-storage\/dist\/index\.js$/u,
  /\/packages\/secure-storage\/dist\/keychain-10\.js$/u,
  /\/packages\/secure-storage\/dist\/react-native\.js$/u,
  /\/packages\/secure-storage\/dist\/solid\.js$/u,
]);

const FORBIDDEN_KEYCHAIN_FACADES = Object.freeze([
  "/react-native-keychain/src/index.ts",
  "/react-native-keychain/src/enums.ts",
  "/react-native-keychain/lib/commonjs/index.js",
  "/react-native-keychain/lib/commonjs/enums.js",
  "/react-native-keychain/lib/module/index.js",
  "/react-native-keychain/lib/module/enums.js",
]);

function collectSources(map) {
  if (Array.isArray(map?.sources)) return map.sources;
  if (!Array.isArray(map?.sections)) {
    throw new Error("The bundle source map has neither sources nor sections.");
  }
  return map.sections.flatMap((section) => collectSources(section?.map));
}

export function assertSecureStorageBundle(map) {
  const sources = collectSources(map).filter(
    (source) => typeof source === "string",
  );
  const matchedSources = [];
  for (const pattern of REQUIRED_SOURCE_PATTERNS) {
    const matches = sources.filter((source) => pattern.test(source));
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one secure-storage proof source ${String(pattern)}, found ${JSON.stringify(matches)}.`,
      );
    }
    matchedSources.push(matches[0]);
  }
  const unexpectedPackageSources = sources.filter(
    (source) =>
      source.includes("/packages/secure-storage/") &&
      !matchedSources.includes(source),
  );
  if (unexpectedPackageSources.length > 0) {
    throw new Error(
      `The secure-storage proof retained unexpected package sources: ${JSON.stringify(unexpectedPackageSources)}.`,
    );
  }
  const forbiddenFacades = sources.filter((source) =>
    FORBIDDEN_KEYCHAIN_FACADES.some((suffix) => source.endsWith(suffix)),
  );
  if (forbiddenFacades.length > 0) {
    throw new Error(
      `The secure-storage proof retained React-facing keychain facades: ${JSON.stringify(forbiddenFacades)}.`,
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
  const evidence = assertSecureStorageBundle(map);
  console.log(
    `Verified the complete owner-safe secure-storage seam in ${absolutePath}: ${JSON.stringify(evidence)}.`,
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main();
}
