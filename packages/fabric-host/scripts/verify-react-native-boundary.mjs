import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const nativeRoot = join(packageRoot, "native");
const manifestPath = join(nativeRoot, "react-native-boundary.json");

const reactNativeHeader =
  /^(?:React\/|ReactCommon\/|React_RCTAppDelegate\/|cxxreact\/|fbjni\/|folly\/|jsi\/|react\/)/u;
const generatedCodegenHeader = /^SolidNative(?:App|E2E)Spec\//u;

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return filesBelow(path);
      return entry.isFile() && /\.(?:cpp|h|kt|mm)$/u.test(entry.name)
        ? [path]
        : [];
    }),
  );
  return nested.flat().sort();
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sorted(values) {
  return [...values].sort(compareText);
}

function packagePath(path) {
  return relative(packageRoot, path).split(sep).join("/");
}

async function supportedReactNativeVersion() {
  const packageManifest = JSON.parse(
    await readFile(join(packageRoot, "package.json"), "utf8"),
  );
  const version =
    packageManifest.dependencies?.["@react-native/normalize-colors"];
  assert.match(
    version ?? "",
    /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u,
    "Fabric Host must exactly pin its React Native normalization dependency.",
  );
  return version;
}

async function nativeImports() {
  const headers = new Set();
  const generatedHeaders = new Set();
  const androidImports = new Set();
  for (const path of await filesBelow(nativeRoot)) {
    const source = await readFile(path, "utf8");
    for (const match of source.matchAll(
      /^\s*#(?:include|import)\s*[<"]([^>"]+)[>"]/gmu,
    )) {
      const specifier = match[1];
      if (reactNativeHeader.test(specifier)) headers.add(specifier);
      if (generatedCodegenHeader.test(specifier)) {
        generatedHeaders.add(specifier);
      }
    }
    for (const match of source.matchAll(
      /^\s*import\s+(com\.facebook\.[^\s]+)\s*$/gmu,
    )) {
      androidImports.add(match[1]);
    }
  }
  return {
    nativeHeaders: sorted(headers),
    generatedCodegenHeaders: sorted(generatedHeaders),
    androidImports: sorted(androidImports),
  };
}

async function podDependencies(reactNativeVersion) {
  const source = await readFile(
    join(nativeRoot, "SolidNativeFabric.podspec"),
    "utf8",
  );
  return [
    ...source.matchAll(/spec\.dependency\s+"([^"]+)"(?:,\s*"([^"]+)")?/gu),
  ]
    .map((match) => ({
      name: match[1],
      version:
        match[2] === "= #{react_native_release}"
          ? `= ${reactNativeVersion}`
          : (match[2] ?? null),
    }))
    .sort((left, right) => compareText(left.name, right.name));
}

async function androidCmakeInputs() {
  const source = await readFile(
    join(nativeRoot, "android/SolidNativeRuntime.cmake"),
    "utf8",
  );
  return {
    reactNativeIncludeDirectories: sorted(
      new Set(
        [...source.matchAll(/"(\$\{REACT_ANDROID_DIR\}[^"]*)"/gu)].map(
          (match) => match[1],
        ),
      ),
    ),
    inheritedCompileOptions: source.includes("${folly_FLAGS}")
      ? ["${folly_FLAGS}"]
      : [],
  };
}

async function boundarySnapshot() {
  const reactNativeVersion = await supportedReactNativeVersion();
  const imports = await nativeImports();
  const snapshot = {
    schemaVersion: 1,
    reactNativeVersion,
    ...imports,
    cocoapods: await podDependencies(reactNativeVersion),
    androidCmake: await androidCmakeInputs(),
  };

  const apiHeader = await readFile(
    join(nativeRoot, "fabric/SolidNativeFabricApi.h"),
    "utf8",
  );
  assert.match(
    apiHeader,
    /ReactNativeVersion\s*=\s*\n?\s*SOLID_NATIVE_REACT_NATIVE_RUNTIME_VERSION/u,
    "The Fabric adapter must publish the manifest-selected runtime identity.",
  );
  for (const part of ["MAJOR", "MINOR", "PATCH"]) {
    assert.match(
      apiHeader,
      new RegExp(
        `REACT_NATIVE_VERSION_${part} != SOLID_NATIVE_REACT_NATIVE_VERSION_${part}`,
        "u",
      ),
      `The Fabric adapter does not guard the ${part.toLowerCase()} React Native version part.`,
    );
  }
  const podspec = await readFile(
    join(nativeRoot, "SolidNativeFabric.podspec"),
    "utf8",
  );
  assert.match(
    podspec,
    /react-native-boundary\.json[\s\S]*GCC_PREPROCESSOR_DEFINITIONS/u,
    "The iOS build does not derive its compile guard from the boundary manifest.",
  );
  const androidGradle = await readFile(
    join(nativeRoot, "android/solid-native.gradle"),
    "utf8",
  );
  for (const part of ["MAJOR", "MINOR", "PATCH"]) {
    assert.match(
      androidGradle,
      new RegExp(`-DSOLID_NATIVE_REACT_NATIVE_VERSION_${part}=`, "u"),
      `The Android build does not pass the ${part.toLowerCase()} boundary version to CMake.`,
    );
  }
  for (const dependency of snapshot.cocoapods) {
    if (dependency.version === null) continue;
    assert.equal(
      dependency.version,
      `= ${reactNativeVersion}`,
      `CocoaPods dependency ${dependency.name} is not pinned to React Native ${reactNativeVersion}.`,
    );
  }
  assert.ok(
    snapshot.androidCmake.reactNativeIncludeDirectories.length > 0,
    "The Android adapter does not declare its React Native CMake include roots.",
  );
  for (const applicationSource of [
    "SolidNativeFabricApplication.mm",
    "SolidNativeFabricSmokeApplication.mm",
  ]) {
    const source = await readFile(
      join(nativeRoot, "fabric", applicationSource),
      "utf8",
    );
    const interopIndex = source.indexOf("RCTEnableTurboModuleInterop(YES)");
    const hostIndex = source.indexOf("[[RCTHost alloc]");
    assert.ok(
      interopIndex >= 0 && hostIndex > interopIndex,
      `${applicationSource} must enable bridgeless legacy-module interop before RCTHost snapshots registered modules.`,
    );
  }
  const productionApplication = await readFile(
    join(nativeRoot, "fabric/SolidNativeFabricApplication.mm"),
    "utf8",
  );
  assert.match(
    productionApplication,
    /hostDidStart:[\s\S]*markSurfaceReloading[\s\S]*dispatch_async\(dispatch_get_main_queue\(\)[\s\S]*rebindToCurrentHostAfterJSRuntimeReload[\s\S]*prepareSurfaceForJSIOwnership/u,
    "The iOS host must hide and republish its empty Fabric surface around a development runtime reload.",
  );
  const productionBinding = await readFile(
    join(nativeRoot, "fabric/SolidNativeFabricJSIBinding.mm"),
    "utf8",
  );
  assert.match(
    productionBinding,
    /installEmptySurfaceStopCompatibility[\s\S]*RN\$stopSurface[\s\S]*isUndefined\(\)[\s\S]*createFromHostFunction/u,
    "The iOS binding must preserve a renderer-owned stop hook and complete React Native's missing empty-surface stop lifecycle.",
  );
  const productionSurface = await readFile(
    join(nativeRoot, "fabric/SolidNativeFabricSurface.mm"),
    "utf8",
  );
  assert.match(
    productionSurface,
    /initWithSurfacePresenter:host\.surfacePresenter[\s\S]*moduleName:@""/u,
    "The package-owned empty iOS surface must have one explicit start owner.",
  );
  assert.doesNotMatch(
    productionSurface,
    /\[host createSurfaceWithModuleName:/u,
    "The package-owned empty iOS surface must not inherit RCTHost's second buffered start.",
  );
  assert.match(
    productionSurface,
    /SolidNativeFabricContainerView[\s\S]*layoutSubviews[\s\S]*updateLayoutConstraintsForView:self[\s\S]*didMoveToWindow[\s\S]*updateLayoutConstraintsForView:self/u,
    "The package-owned iOS view must forward UIKit size and window changes into its Fabric surface.",
  );
  assert.match(
    productionSurface,
    /SolidNativeFabricContainerView[\s\S]*traitCollectionDidChange:[\s\S]*RCTUserInterfaceStyleDidChangeNotification[\s\S]*RCTUserInterfaceStyleDidChangeNotificationTraitCollectionKey/u,
    "The package-owned iOS view must forward UIKit trait changes into React Native's Appearance module.",
  );
  assert.match(
    productionSurface,
    /updateLayoutConstraintsForView:[\s\S]*setMinimumSize:size[\s\S]*maximumSize:size[\s\S]*viewportOffset:viewportOffset/u,
    "The package-owned iOS surface must keep Fabric root constraints aligned with its current UIKit viewport.",
  );
  const emptyOwnership = productionSurface.indexOf(
    "prepareEmptySurfaceForJSIOwnershipWithCompletion",
  );
  const emptyStart = productionSurface.indexOf(
    "[_surface start]",
    emptyOwnership,
  );
  const surfaceViewSynchronization = productionSurface.indexOf(
    "[self synchronizeSurfaceView]",
    emptyOwnership,
  );
  const emptyTransaction = productionSurface.indexOf(
    "NSDictionary<NSString *, id> *transaction",
    emptyOwnership,
  );
  assert.ok(
    emptyOwnership >= 0 &&
      surfaceViewSynchronization > emptyOwnership &&
      emptyStart > emptyOwnership &&
      emptyStart > surfaceViewSynchronization &&
      emptyTransaction > emptyStart,
    "The package-owned empty iOS surface must replace RN's reset view and start without waiting for AppRegistry or JavaScript bundle completion.",
  );
  return snapshot;
}

const snapshot = await boundarySnapshot();
if (process.argv.includes("--print")) {
  process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
} else {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.deepEqual(
    manifest,
    snapshot,
    `${packagePath(manifestPath)} does not match the native React Native dependency surface. Run this verifier with --print, review every upstream boundary change, and update the manifest deliberately.`,
  );
  console.log(
    `Verified the React Native ${snapshot.reactNativeVersion} native boundary: ${snapshot.nativeHeaders.length} headers, ${snapshot.androidImports.length} Android imports, and ${snapshot.cocoapods.length} CocoaPods dependencies.`,
  );
}
