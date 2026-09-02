import fs from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_SOURCE_PATTERNS = Object.freeze([
  /\/apps\/native-e2e\/networking\.tsx$/u,
  /\/packages\/networking\/dist\/index\.js$/u,
  /\/packages\/networking\/dist\/json\.js$/u,
  /\/packages\/networking\/dist\/react-native-adapter\.js$/u,
  /\/packages\/networking\/dist\/react-native\.js$/u,
  /\/packages\/networking\/dist\/server-events\.js$/u,
  /\/packages\/networking\/dist\/solid\.js$/u,
  /\/packages\/networking\/dist\/solid-server-events\.js$/u,
]);

const COMMON_REACT_NATIVE_BOOTSTRAP_SOURCES = Object.freeze([
  "/Libraries/Network/fetch.js",
  "/Libraries/Network/XMLHttpRequest.js",
]);

const PLATFORM_REACT_NATIVE_BOOTSTRAP_SOURCES = Object.freeze({
  android: Object.freeze([
    "/Libraries/Network/RCTNetworking.android.js",
    "/Libraries/Network/NativeNetworkingAndroid.js",
    "/src/private/specs_DEPRECATED/modules/NativeNetworkingAndroid.js",
  ]),
  ios: Object.freeze([
    "/Libraries/Network/RCTNetworking.ios.js",
    "/Libraries/Network/NativeNetworkingIOS.js",
    "/src/private/specs_DEPRECATED/modules/NativeNetworkingIOS.js",
  ]),
});

function collectSources(map) {
  if (Array.isArray(map?.sources)) return map.sources;
  if (!Array.isArray(map?.sections)) {
    throw new Error("The bundle source map has neither sources nor sections.");
  }
  return map.sections.flatMap((section) => collectSources(section?.map));
}

export function assertNetworkingBundle(map) {
  const sources = collectSources(map).filter(
    (source) => typeof source === "string",
  );
  const matchedSources = [];
  for (const pattern of REQUIRED_SOURCE_PATTERNS) {
    const matches = sources.filter((source) => pattern.test(source));
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one networking proof source ${String(pattern)}, found ${JSON.stringify(matches)}.`,
      );
    }
    matchedSources.push(matches[0]);
  }
  const unexpectedPackageSources = sources.filter(
    (source) =>
      source.includes("/packages/networking/") &&
      !matchedSources.includes(source),
  );
  if (unexpectedPackageSources.length > 0) {
    throw new Error(
      `The networking proof retained unexpected package sources: ${JSON.stringify(unexpectedPackageSources)}.`,
    );
  }
  const platformMatches = Object.fromEntries(
    Object.entries(PLATFORM_REACT_NATIVE_BOOTSTRAP_SOURCES).map(
      ([platform, suffixes]) => [
        platform,
        sources.filter((source) =>
          suffixes.some((suffix) => source.endsWith(suffix)),
        ),
      ],
    ),
  );
  const platforms = Object.entries(platformMatches)
    .filter(([, matches]) => matches.length > 0)
    .map(([platform]) => platform);
  if (platforms.length !== 1) {
    throw new Error(
      `Expected exactly one React Native platform networking bootstrap, found ${JSON.stringify(platformMatches)}.`,
    );
  }
  const platform = platforms[0];
  const expectedBootstrapSources = [
    ...COMMON_REACT_NATIVE_BOOTSTRAP_SOURCES,
    ...PLATFORM_REACT_NATIVE_BOOTSTRAP_SOURCES[platform],
  ];
  for (const suffix of expectedBootstrapSources) {
    const matches = sources.filter((source) => source.endsWith(suffix));
    if (matches.length !== 1) {
      throw new Error(
        `Expected one pinned React Native setup-env source ${suffix}, found ${JSON.stringify(matches)}.`,
      );
    }
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
  const evidence = assertNetworkingBundle(map);
  console.log(
    `Verified the complete owner-safe incremental networking seam in ${absolutePath}: ${JSON.stringify(evidence)}.`,
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main();
}
