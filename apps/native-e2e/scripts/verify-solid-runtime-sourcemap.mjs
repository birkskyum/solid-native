import fs from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SOLID_RUNTIME_PATTERN = /\/solid-js\/dist\/(solid|dev|server)\.(js|cjs)$/;
const SIGNALS_RUNTIME_PATTERN =
  /\/@solidjs\/signals\/dist\/(prod\/index\.js|dev\.js|node\.cjs)$/;
const SOLID_DIAGNOSTICS_PATTERN = /\/@solidjs\/diagnostics\//;
const SOLID_NATIVE_DEVELOPMENT_DIAGNOSTICS_PATTERN =
  /\/packages\/devtools\/(src|dist)\/solid-diagnostics-development\.(ts|js)$/;
const SAFE_AREA_REACT_WRAPPER_PATTERN =
  /\/node_modules\/react-native-safe-area-context\/(src|lib)\//;
const REACT_NATIVE_LINKING_FACADE_PATTERN =
  /\/node_modules\/react-native\/Libraries\/Linking\/Linking\.js$/;
const REACT_NATIVE_PACKAGE_BARREL_PATTERN =
  /\/node_modules\/react-native\/index\.js$/;
const VISION_CAMERA_REACT_SURFACE_PATTERN =
  /\/node_modules\/react-native-vision-camera\/(src\/(index\.ts|hooks\/|views\/Camera\.tsx)|lib\/(module|commonjs)\/(index\.js|hooks\/|views\/Camera\.js))/;
const NITRO_MODULES_PACKAGE_BARREL_PATTERN =
  /\/node_modules\/react-native-nitro-modules\/(src\/index\.ts|lib\/(module|commonjs)\/index\.js)$/;

function collectSources(map) {
  if (Array.isArray(map?.sources)) return map.sources;
  if (!Array.isArray(map?.sections)) {
    throw new Error("The bundle source map has neither sources nor sections.");
  }
  return map.sections.flatMap((section) => collectSources(section?.map));
}

export function assertSingleSolidRuntime(map) {
  const sources = collectSources(map);
  const solidRuntimes = [
    ...new Set(
      sources.filter(
        (source) =>
          typeof source === "string" && SOLID_RUNTIME_PATTERN.test(source),
      ),
    ),
  ];
  const signalsRuntimes = [
    ...new Set(
      sources.filter(
        (source) =>
          typeof source === "string" && SIGNALS_RUNTIME_PATTERN.test(source),
      ),
    ),
  ];
  if (solidRuntimes.length !== 1 || signalsRuntimes.length !== 1) {
    throw new Error(
      `Expected exactly one Solid runtime and one signals runtime, found ${JSON.stringify(
        {
          signalsRuntimes,
          solidRuntimes,
        },
      )}.`,
    );
  }
  const [solidRuntime] = solidRuntimes;
  const [signalsRuntime] = signalsRuntimes;
  const isProductionPair =
    solidRuntime.endsWith("/solid.js") &&
    signalsRuntime.endsWith("/prod/index.js");
  const isDevelopmentPair =
    solidRuntime.endsWith("/dev.js") && signalsRuntime.endsWith("/dev.js");
  if (!isProductionPair && !isDevelopmentPair) {
    throw new Error(
      `The bundle contains an incompatible Solid runtime pair: ${JSON.stringify(
        {
          signalsRuntime,
          solidRuntime,
        },
      )}.`,
    );
  }
  return { signalsRuntime, solidRuntime };
}

export function assertNoSafeAreaReactWrapper(map) {
  const wrapperSources = [
    ...new Set(
      collectSources(map).filter(
        (source) =>
          typeof source === "string" &&
          SAFE_AREA_REACT_WRAPPER_PATTERN.test(source),
      ),
    ),
  ];
  if (wrapperSources.length > 0) {
    throw new Error(
      `The Solid Native bundle imported the react-native-safe-area-context React wrapper: ${JSON.stringify(wrapperSources)}.`,
    );
  }
}

export function assertNoSolidDevelopmentDiagnostics(map) {
  const diagnosticSources = [
    ...new Set(
      collectSources(map).filter(
        (source) =>
          typeof source === "string" && SOLID_DIAGNOSTICS_PATTERN.test(source),
      ),
    ),
    ...new Set(
      collectSources(map).filter(
        (source) =>
          typeof source === "string" &&
          SOLID_NATIVE_DEVELOPMENT_DIAGNOSTICS_PATTERN.test(source),
      ),
    ),
  ];
  if (diagnosticSources.length > 0) {
    throw new Error(
      `The production Solid Native bundle retained development-only Solid diagnostics: ${JSON.stringify(diagnosticSources)}.`,
    );
  }
}

export function assertNoReactNativeLinkingFacade(map) {
  const facadeSources = [
    ...new Set(
      collectSources(map).filter(
        (source) =>
          typeof source === "string" &&
          REACT_NATIVE_LINKING_FACADE_PATTERN.test(source),
      ),
    ),
  ];
  if (facadeSources.length > 0) {
    throw new Error(
      `The Solid Native bundle imported React Native's Linking JavaScript facade: ${JSON.stringify(facadeSources)}.`,
    );
  }
}

export function assertNoReactNativePackageBarrels(map) {
  const facadeSources = [
    ...new Set(
      collectSources(map).filter(
        (source) =>
          typeof source === "string" &&
          (REACT_NATIVE_PACKAGE_BARREL_PATTERN.test(source) ||
            VISION_CAMERA_REACT_SURFACE_PATTERN.test(source) ||
            NITRO_MODULES_PACKAGE_BARREL_PATTERN.test(source)),
      ),
    ),
  ];
  if (facadeSources.length > 0) {
    throw new Error(
      `The Solid Native bundle evaluated a React-facing package barrel or camera surface: ${JSON.stringify(facadeSources)}.`,
    );
  }
}

function main() {
  const sourceMapPath = process.argv[2];
  if (sourceMapPath === undefined) {
    throw new Error("Pass the generated Metro source-map path.");
  }
  const absolutePath = resolve(sourceMapPath);
  const map = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  const runtimes = assertSingleSolidRuntime(map);
  assertNoSolidDevelopmentDiagnostics(map);
  assertNoSafeAreaReactWrapper(map);
  assertNoReactNativeLinkingFacade(map);
  assertNoReactNativePackageBarrels(map);
  console.log(
    `Verified one Solid reactive runtime, no development diagnostics, and no reviewed React-facing platform facade in ${absolutePath}: ${JSON.stringify(runtimes)}.`,
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main();
}
