import { gunzipSync } from "node:zlib";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const workspaceRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packagesRoot = join(workspaceRoot, "packages");
const supportedNodeRange = "^22.13.0 || ^24.3.0 || >=26.0.0";

const solidPeerPackages = new Set([
  "@solid-native/accessibility",
  "@solid-native/animation",
  "@solid-native/camera",
  "@solid-native/clipboard",
  "@solid-native/core",
  "@solid-native/dialogs",
  "@solid-native/devtools",
  "@solid-native/images",
  "@solid-native/navigation",
  "@solid-native/networking",
  "@solid-native/notifications",
  "@solid-native/renderer",
  "@solid-native/runtime",
  "@solid-native/secure-storage",
  "@solid-native/sharing",
  "@solid-native/testing",
  "@solid-native/vibration",
]);

const requiredPackageFiles = new Map([
  [
    "@solid-native/navigation",
    [
      "backend/react-native-screens-4.27.0.json",
      "patches/react-native-screens@4.27.0.patch",
    ],
  ],
  [
    "@solid-native/devtools",
    ["dist/network-service-development.js", "dist/root-development.js"],
  ],
  ["@solid-native/react-native-compat", ["dist/index.d.ts", "dist/index.js"]],
  [
    "@solid-native/fabric-host",
    [
      "dist/native-binding.d.ts",
      "dist/native-binding.js",
      "dist/native-fabric-host.d.ts",
      "dist/native-fabric-host.js",
      "dist/native-transaction.d.ts",
      "dist/native-transaction.js",
      "dist/react-native-0.87.d.ts",
      "dist/react-native-0.87.js",
      "native/SolidNativeFabric.podspec",
      "native/react-native-boundary.json",
      "scripts/verify-react-native-boundary.mjs",
      "native/android/SolidNativeBindingsInstaller.cpp",
      "native/android/SolidNativeBindingsInstaller.h",
      "native/android/SolidNativeRuntime.cmake",
      "native/android/java/dev/solidnative/runtime/SolidNativeBindingsInstaller.kt",
      "native/android/java/dev/solidnative/runtime/SolidNativeSurface.kt",
      "native/android/java/dev/solidnative/runtime/SolidNativeStartupFailureView.kt",
      "native/android/solid-native.gradle",
      "native/fabric/SolidNativeFabricApplication.h",
      "native/fabric/SolidNativeFabricApplication.mm",
      "native/fabric/SolidNativeStartupFailureView.h",
      "native/fabric/SolidNativeStartupFailureView.mm",
      "native/fabric/SolidNativeFabricApi.cpp",
      "native/fabric/SolidNativeFabricApi.h",
      "native/fabric/SolidNativeFabricJSIBinding.mm",
      "native/fabric/SolidNativeFabricJSIBinding.h",
      "native/fabric/SolidNativeFabricSmokeApplication.h",
      "native/fabric/SolidNativeFabricSmokeApplication.mm",
      "native/fabric/SolidNativeFabricSurface.h",
      "native/fabric/SolidNativeFabricSurface.mm",
      "native/fabric/SolidNativeFabricTransactionCoordinator.cpp",
      "native/fabric/SolidNativeFabricTransactionCoordinator.h",
      "native/fabric/SolidNativeFabricTransactionCoordinatorApple.mm",
      "native/worklets/SolidNativeUIWorklet.cpp",
      "native/worklets/SolidNativeUIWorklet.h",
    ],
  ],
  [
    "@solid-native/cli",
    [
      "templates/react-native-0.87/README.md",
      "templates/react-native-0.87/android/CMakeLists.txt",
      "templates/react-native-0.87/android/MainActivity.kt",
      "templates/react-native-0.87/android/MainApplication.kt",
      "templates/react-native-0.87/android/OnLoad.cpp",
      "templates/react-native-0.87/index.js",
      "templates/react-native-0.87/ios/AppDelegate.swift",
      "templates/react-native-0.87/metro.config.js",
      "templates/react-native-0.87/src/App.tsx",
      "templates/react-native-0.87/src/main.tsx",
      "templates/react-native-0.87/test/App.test.tsx",
    ],
  ],
]);

const forbiddenPackageFiles = new Map([
  [
    "@solid-native/runtime",
    [
      "dist/native-binding.d.ts",
      "dist/native-binding.js",
      "dist/native-fabric-host.d.ts",
      "dist/native-fabric-host.js",
      "dist/native-transaction.d.ts",
      "dist/native-transaction.js",
      "dist/react-native-0.87.d.ts",
      "dist/react-native-0.87.js",
      "native/SolidNativeFabric.podspec",
      "native/android/solid-native.gradle",
    ],
  ],
]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function decodeTarString(bytes) {
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end === -1 ? bytes.length : end).toString("utf8");
}

function readPackedManifest(archivePath) {
  const archive = gunzipSync(archivePath);
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = decodeTarString(header.subarray(0, 100));
    const prefix = decodeTarString(header.subarray(345, 500));
    const archiveName = prefix === "" ? name : `${prefix}/${name}`;
    const rawSize = decodeTarString(header.subarray(124, 136)).trim();
    const size = rawSize === "" ? 0 : Number.parseInt(rawSize, 8);
    invariant(
      Number.isSafeInteger(size),
      `Invalid tar entry size for ${archiveName}.`,
    );
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;
    invariant(
      contentEnd <= archive.length,
      `Truncated tar entry ${archiveName}.`,
    );
    if (archiveName === "package/package.json") {
      return JSON.parse(
        archive.subarray(contentStart, contentEnd).toString("utf8"),
      );
    }
    offset = contentStart + Math.ceil(size / 512) * 512;
  }
  throw new Error(
    `Packed artifact ${archivePath} omitted package/package.json.`,
  );
}

function collectExportTargets(value, location, targets) {
  if (typeof value === "string") {
    targets.push({ location, target: value });
    return;
  }
  invariant(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${location} must resolve to a string or condition object.`,
  );
  for (const [condition, nested] of Object.entries(value)) {
    collectExportTargets(nested, `${location}.${condition}`, targets);
  }
}

function containsTypesCondition(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.entries(value).some(
    ([condition, nested]) =>
      (condition === "types" && typeof nested === "string") ||
      containsTypesCondition(nested),
  );
}

function packageTypeEntrypoints(manifest) {
  invariant(
    manifest.exports !== null &&
      typeof manifest.exports === "object" &&
      !Array.isArray(manifest.exports),
    `${manifest.name}.exports must be an explicit subpath map.`,
  );
  const entrypoints = [];
  for (const [subpath, value] of Object.entries(manifest.exports)) {
    invariant(
      subpath === "." || subpath.startsWith("./"),
      `${manifest.name}.exports.${subpath} is not an explicit package subpath.`,
    );
    const targets = [];
    collectExportTargets(value, `${manifest.name}.exports.${subpath}`, targets);
    if (!targets.some(({ target }) => /\.[cm]?js$/u.test(target))) continue;
    invariant(
      containsTypesCondition(value),
      `${manifest.name}.exports.${subpath} exposes JavaScript without a types condition.`,
    );
    entrypoints.push(
      subpath === "." ? manifest.name : `${manifest.name}/${subpath.slice(2)}`,
    );
  }
  return entrypoints;
}

function packageRelativeTarget(packageDirectory, target, location) {
  invariant(target.startsWith("./"), `${location} must be package-relative.`);
  invariant(
    !target.includes("*"),
    `${location} cannot use an unverified wildcard.`,
  );
  const resolved = resolve(packageDirectory, target);
  const packageRelative = normalize(relative(packageDirectory, resolved));
  invariant(
    packageRelative !== "" &&
      packageRelative !== ".." &&
      !packageRelative.startsWith(
        `..${process.platform === "win32" ? "\\" : "/"}`,
      ),
    `${location} escapes its package directory.`,
  );
  return packageRelative.replaceAll("\\", "/");
}

function assertNoWorkspaceProtocol(value, location) {
  if (typeof value === "string") {
    invariant(
      !value.startsWith("workspace:"),
      `${location} retained an unpublished workspace protocol.`,
    );
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    assertNoWorkspaceProtocol(nested, `${location}.${key}`);
  }
}

function packPackage(packageDirectory, destination) {
  const environment = { ...process.env, NO_COLOR: "1" };
  delete environment.FORCE_COLOR;
  const result = spawnSync(
    "pnpm",
    [
      "--dir",
      packageDirectory,
      "pack",
      "--pack-destination",
      destination,
      "--json",
    ],
    { encoding: "utf8", env: environment },
  );
  invariant(
    result.status === 0,
    `pnpm pack failed for ${packageDirectory}: ${result.error?.message ?? result.stderr.trim()}`,
  );
  const outputStart = result.stdout.indexOf("{");
  const outputEnd = result.stdout.lastIndexOf("}");
  invariant(
    outputStart !== -1 && outputEnd >= outputStart,
    "pnpm pack returned invalid JSON.",
  );
  return JSON.parse(result.stdout.slice(outputStart, outputEnd + 1));
}

function runCommand(command, arguments_, options, failureMessage) {
  const environment = { ...process.env, NO_COLOR: "1" };
  delete environment.FORCE_COLOR;
  const result = spawnSync(command, arguments_, {
    ...options,
    encoding: "utf8",
    env: environment,
  });
  const output = [result.stderr, result.stdout]
    .map((value) => String(value ?? "").trim())
    .filter((value) => value !== "")
    .join("\n");
  invariant(
    result.status === 0,
    `${failureMessage}: ${result.error?.message ?? (output || `process exited ${String(result.status)}`)}`,
  );
  return {
    stderr: String(result.stderr ?? ""),
    stdout: String(result.stdout ?? ""),
  };
}

async function verifyConsumerInstallation(destination, packages) {
  const consumerDirectory = join(destination, "consumer");
  const consumerPatchDirectory = join(consumerDirectory, "patches");
  const screensPatchName = "react-native-screens@4.27.0.patch";
  await mkdir(consumerPatchDirectory, { recursive: true });
  await writeFile(
    join(consumerPatchDirectory, screensPatchName),
    await readFile(
      join(packagesRoot, "navigation", "patches", screensPatchName),
    ),
  );
  const localPackages = Object.fromEntries(
    packages.map(({ archivePath, name }) => [name, `file:${archivePath}`]),
  );
  await writeFile(
    join(consumerDirectory, "package.json"),
    `${JSON.stringify(
      {
        name: "solid-native-package-consumer",
        private: true,
        type: "module",
        packageManager: "pnpm@9.15.0",
        dependencies: {
          ...localPackages,
          "@types/node": "26.2.0",
          react: "19.2.3",
          "react-native": "0.87.0",
          "react-native-screens": "4.27.0",
          "solid-js": "2.0.0-rc.3",
          typescript: "5.9.3",
        },
        pnpm: {
          overrides: localPackages,
          patchedDependencies: {
            "react-native-screens@4.27.0": `patches/${screensPatchName}`,
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(consumerDirectory, "pnpm-workspace.yaml"),
    `packages:\n  - "."\noverrides:\n${Object.entries(localPackages)
      .map(
        ([name, archivePath]) =>
          `  ${JSON.stringify(name)}: ${JSON.stringify(archivePath)}`,
      )
      .join("\n")}\n`,
  );
  runCommand(
    "pnpm",
    ["install", "--offline", "--ignore-scripts", "--config.engine-strict=true"],
    { cwd: consumerDirectory },
    "Isolated package installation failed",
  );

  const cliPackage = packages.find(({ name }) => name === "@solid-native/cli");
  invariant(
    cliPackage !== undefined,
    "The packed package set omitted the CLI.",
  );
  const version = runCommand(
    "pnpm",
    ["exec", "solid-native", "--version"],
    { cwd: consumerDirectory },
    "Installed CLI version command failed",
  );
  invariant(
    version.stdout.trim() === cliPackage.version,
    `Installed CLI reported unexpected version ${JSON.stringify(version.stdout.trim())}.`,
  );
  runCommand(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { runDoctor } from "@solid-native/cli";
const report = await runDoctor({
  cwd: process.cwd(),
  platform: "android",
  dependencies: {
    hostPlatform: "linux",
    nodeVersion: process.versions.node,
    async runCommand() {
      return { exitCode: 1, stdout: "", stderr: "fixture", timedOut: false };
    },
  },
});
const backend = report.checks.find((entry) => entry.id === "project.navigation-backend");
if (backend?.status !== "pass") throw new Error(JSON.stringify(backend));`,
    ],
    { cwd: consumerDirectory },
    "Installed navigation backend contract verification failed",
  );
  const createTarget = join(destination, "PackedConsumerApp");
  const createPlanResult = runCommand(
    "pnpm",
    [
      "exec",
      "solid-native",
      "create",
      "PackedConsumerApp",
      "--directory",
      createTarget,
      "--package-name",
      "dev.solidnative.packedconsumer",
      "--skip-install",
      "--dry-run",
      "--json",
    ],
    { cwd: consumerDirectory },
    "Installed CLI create-plan command failed",
  );
  const createPlan = JSON.parse(createPlanResult.stdout);
  invariant(
    createPlan.operation === "create" &&
      createPlan.projectName === "PackedConsumerApp" &&
      createPlan.packageName === "dev.solidnative.packedconsumer" &&
      createPlan.targetDirectory === createTarget &&
      createPlan.installCommand === undefined,
    "Installed CLI returned an invalid create plan.",
  );
  await access(createTarget).then(
    () => {
      throw new Error("Installed CLI dry run created its target directory.");
    },
    () => undefined,
  );

  const entrypoints = packages.map(({ name }) => name);
  entrypoints.push(
    "@solid-native/accessibility/solid",
    "@solid-native/animation/solid",
    "@solid-native/animation/react-native",
    "@solid-native/camera/solid",
    "@solid-native/core/jsx-runtime",
    "@solid-native/core/jsx-dev-runtime",
    "@solid-native/devtools/solid",
    "@solid-native/devtools/root",
    "@solid-native/devtools/network",
    "@solid-native/devtools/network-service",
    "@solid-native/dialogs/solid",
    "@solid-native/images/solid",
    "@solid-native/networking/json",
    "@solid-native/networking/server-events",
    "@solid-native/networking/solid",
    "@solid-native/notifications/solid",
    "@solid-native/notifications/notify-kit-10",
    "@solid-native/secure-storage/keychain-10",
    "@solid-native/secure-storage/solid",
    "@solid-native/storage/async-storage-3",
    "@solid-native/metro/transform-worker",
    "@solid-native/renderer/jsx-runtime",
    "@solid-native/renderer/jsx-dev-runtime",
    "@solid-native/clipboard/solid",
    "@solid-native/sharing/solid",
    "@solid-native/vibration/solid",
  );
  const importProgram = `await Promise.all(${JSON.stringify(entrypoints)}.map((specifier) => import(specifier)));`;
  runCommand(
    process.execPath,
    ["--conditions=browser", "--input-type=module", "--eval", importProgram],
    { cwd: consumerDirectory },
    "Isolated package import failed",
  );

  const typeEntrypoints = packages.flatMap(
    ({ typeEntrypoints: packageEntrypoints }) => packageEntrypoints,
  );
  await writeFile(
    join(consumerDirectory, "consumer.ts"),
    `${typeEntrypoints
      .map(
        (specifier, index) =>
          `import type * as Package${index} from ${JSON.stringify(specifier)};`,
      )
      .join("\n")}

export type InstalledPackageSurfaces = [
${typeEntrypoints.map((_, index) => `  typeof Package${index},`).join("\n")}
];

import {
  createSolidNativeFullReloadPattern,
  createSolidNativeMetroResolver,
  solidNativeTransformWorkerPath,
} from "@solid-native/metro";

const metroResolver = createSolidNativeMetroResolver(process.cwd());
const fullReloadPattern = createSolidNativeFullReloadPattern(process.cwd());
metroResolver(
  {
    dev: false,
    resolveRequest(_context, moduleName) {
      return moduleName;
    },
  },
  "solid-js",
  "android",
);
void fullReloadPattern;
void solidNativeTransformWorkerPath;
`,
  );
  await writeFile(
    join(consumerDirectory, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          lib: ["ES2022", "DOM"],
          types: ["node"],
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          exactOptionalPropertyTypes: true,
          noUncheckedIndexedAccess: true,
          verbatimModuleSyntax: true,
        },
        include: ["consumer.ts"],
      },
      null,
      2,
    )}\n`,
  );
  runCommand(
    "pnpm",
    ["exec", "tsc", "--project", "tsconfig.json"],
    { cwd: consumerDirectory },
    "Isolated package type-check failed",
  );

  await writeFile(
    join(consumerDirectory, "consumer.test.tsx"),
    `/** @jsxImportSource @solid-native/core */
import assert from "node:assert/strict";
import test from "node:test";
import { Pressable, Text, View } from "@solid-native/core";
import { renderNative } from "@solid-native/testing";
import { createSignal } from "solid-js";

function Counter() {
  const [count, setCount] = createSignal(0);
  return <View>
    <Pressable accessibilityRole="button" accessibilityLabel="Increment" onPress={() => setCount(value => value + 1)}>
      <Text>Increment</Text>
    </Pressable>
    <Text>{"Count: " + String(count())}</Text>
  </View>;
}

test("runs packed Solid Native TSX", async () => {
  const screen = await renderNative(() => <Counter />);
  try {
    const checkpoint = screen.commitCheckpoint();
    await screen.press(screen.getByRole("button", { name: "Increment" }));
    assert.equal(screen.getByText("Count: 1").textContent, "Count: 1");
    const commit = screen.getCommit({
      afterSequence: checkpoint,
      priority: "user-blocking",
      mutationTypes: ["update-text"]
    });
    assert.equal(screen.getMutation({
      type: "update-text",
      afterSequence: checkpoint
    }).commit.sequence, commit.sequence);
  } finally {
    await screen.cleanup();
    screen.assertDisposed();
  }
});
`,
  );
  runCommand(
    "pnpm",
    ["exec", "solid-native", "test", "consumer.test.tsx"],
    { cwd: consumerDirectory },
    "Installed OXC TSX test command failed",
  );

  const nativeLayoutProgram = `
    const { access, readFile } = await import("node:fs/promises");
    const { spawnSync } = await import("node:child_process");
    const { createRequire } = await import("node:module");
    const { join, resolve } = await import("node:path");
    const require = createRequire(import.meta.url);
    const fabricHostRoot = resolve(require.resolve("@solid-native/fabric-host"), "../..");
    const androidGradle = require.resolve("@solid-native/fabric-host/android-gradle");
    const iosPodspec = require.resolve("@solid-native/fabric-host/ios-podspec");
    const reactNativeBoundary = require.resolve("@solid-native/fabric-host/react-native-boundary");
    await Promise.all([
      "native/android/SolidNativeRuntime.cmake",
      "native/android/java/dev/solidnative/runtime/SolidNativeBindingsInstaller.kt",
      "native/android/java/dev/solidnative/runtime/SolidNativeSurface.kt",
      "native/android/solid-native.gradle",
      "native/react-native-boundary.json"
    ].map((target) => access(join(fabricHostRoot, target))));
    if (androidGradle !== join(fabricHostRoot, "native/android/solid-native.gradle")) {
      throw new Error("Android Gradle integration resolved outside the Fabric Host package");
    }
    if (iosPodspec !== join(fabricHostRoot, "native/SolidNativeFabric.podspec")) {
      throw new Error("iOS podspec resolved outside the Fabric Host package");
    }
    if (reactNativeBoundary !== join(fabricHostRoot, "native/react-native-boundary.json")) {
      throw new Error("React Native boundary manifest resolved outside the Fabric Host package");
    }
    const boundary = JSON.parse(await readFile(reactNativeBoundary, "utf8"));
    if (boundary.schemaVersion !== 1 || boundary.reactNativeVersion !== "0.87.0") {
      throw new Error("Installed React Native boundary manifest is incompatible");
    }
    const boundaryVerification = spawnSync(
      process.execPath,
      [join(fabricHostRoot, "scripts/verify-react-native-boundary.mjs")],
      { encoding: "utf8" }
    );
    if (boundaryVerification.status !== 0) {
      throw new Error(
        "Installed React Native boundary verification failed: " +
          boundaryVerification.stderr.trim()
      );
    }
  `;
  runCommand(
    process.execPath,
    ["--input-type=module", "--eval", nativeLayoutProgram],
    { cwd: consumerDirectory },
    "Installed @solid-native/fabric-host native layout is not resolvable",
  );
}

async function verifyPackage(packageDirectory, destination) {
  const manifestPath = join(packageDirectory, "package.json");
  const sourceManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  invariant(
    sourceManifest.private === true,
    `${sourceManifest.name} must remain private until naming and licensing are settled.`,
  );
  invariant(
    sourceManifest.exports !== undefined,
    `${sourceManifest.name} has no exports map.`,
  );
  invariant(
    Array.isArray(sourceManifest.files),
    `${sourceManifest.name} has no files allowlist.`,
  );
  invariant(
    sourceManifest.engines?.node === supportedNodeRange,
    `${sourceManifest.name} does not declare the supported Node.js toolchain range.`,
  );
  const typeEntrypoints = packageTypeEntrypoints(sourceManifest);
  if (solidPeerPackages.has(sourceManifest.name)) {
    invariant(
      sourceManifest.peerDependencies?.["solid-js"] === "2.0.0-rc.3",
      `${sourceManifest.name} must require the device-verified Solid runtime as a peer.`,
    );
    invariant(
      sourceManifest.dependencies?.["solid-js"] === undefined,
      `${sourceManifest.name} must not install a private copy of the Solid runtime.`,
    );
  }

  const packed = packPackage(packageDirectory, destination);
  invariant(
    packed.name === sourceManifest.name,
    `${manifestPath} packed under the wrong name.`,
  );
  invariant(
    packed.version === sourceManifest.version,
    `${sourceManifest.name} packed under the wrong version.`,
  );
  invariant(
    Array.isArray(packed.files),
    `${sourceManifest.name} pack output omitted its file list.`,
  );
  const packedFiles = new Set(packed.files.map((file) => file.path));
  invariant(
    packedFiles.has("package.json"),
    `${sourceManifest.name} omitted package.json.`,
  );
  invariant(
    packedFiles.has("README.md"),
    `${sourceManifest.name} omitted README.md.`,
  );

  const targets = [];
  collectExportTargets(
    sourceManifest.exports,
    `${sourceManifest.name}.exports`,
    targets,
  );
  for (const { location, target } of targets) {
    const packageTarget = packageRelativeTarget(
      packageDirectory,
      target,
      location,
    );
    invariant(
      packedFiles.has(packageTarget),
      `${location} points to ${target}, which is absent from the packed artifact.`,
    );
  }
  if (sourceManifest.bin !== undefined) {
    const bins =
      typeof sourceManifest.bin === "string"
        ? { [sourceManifest.name]: sourceManifest.bin }
        : sourceManifest.bin;
    for (const [name, target] of Object.entries(bins)) {
      const packageTarget = packageRelativeTarget(
        packageDirectory,
        target,
        `${sourceManifest.name}.bin.${name}`,
      );
      invariant(
        packedFiles.has(packageTarget),
        `${sourceManifest.name} omitted executable ${packageTarget}.`,
      );
      const executable = await readFile(
        join(packageDirectory, packageTarget),
        "utf8",
      );
      invariant(
        executable.startsWith("#!/usr/bin/env node\n"),
        `${sourceManifest.name} executable ${packageTarget} has no portable Node shebang.`,
      );
    }
  }

  for (const required of requiredPackageFiles.get(sourceManifest.name) ?? []) {
    invariant(
      packedFiles.has(required),
      `${sourceManifest.name} omitted required package artifact ${required}.`,
    );
  }
  for (const forbidden of forbiddenPackageFiles.get(sourceManifest.name) ??
    []) {
    invariant(
      !packedFiles.has(forbidden),
      `${sourceManifest.name} retained moved package artifact ${forbidden}.`,
    );
  }

  const archive = await readFile(packed.filename);
  const packedManifest = readPackedManifest(archive);
  invariant(
    packedManifest.private === true,
    `${sourceManifest.name} lost its private publication guard while packing.`,
  );
  invariant(
    packedManifest.engines?.node === supportedNodeRange,
    `${sourceManifest.name} changed its Node.js range while packing.`,
  );
  if (solidPeerPackages.has(sourceManifest.name)) {
    invariant(
      packedManifest.peerDependencies?.["solid-js"] === "2.0.0-rc.3",
      `${sourceManifest.name} packed without its Solid runtime peer.`,
    );
    invariant(
      packedManifest.dependencies?.["solid-js"] === undefined,
      `${sourceManifest.name} packed a private Solid runtime dependency.`,
    );
  }
  assertNoWorkspaceProtocol(
    packedManifest,
    `${sourceManifest.name}.packedManifest`,
  );

  return {
    archivePath: packed.filename,
    fileCount: packedFiles.size,
    name: sourceManifest.name,
    typeEntrypoints,
    version: sourceManifest.version,
  };
}

const packageEntries = await readdir(packagesRoot, { withFileTypes: true });
const packageDirectories = [];
for (const entry of packageEntries) {
  if (!entry.isDirectory()) continue;
  const packageDirectory = join(packagesRoot, entry.name);
  const manifest = JSON.parse(
    await readFile(join(packageDirectory, "package.json"), "utf8"),
  );
  if (manifest.exports !== undefined || manifest.files !== undefined) {
    packageDirectories.push(packageDirectory);
  }
}
packageDirectories.sort();
invariant(
  packageDirectories.length > 0,
  "No distributable package artifacts were found.",
);

const destination = await mkdtemp(join(tmpdir(), "solid-native-packages-"));
let fileCount = 0;
try {
  const packedPackages = [];
  for (const packageDirectory of packageDirectories) {
    const packedPackage = await verifyPackage(packageDirectory, destination);
    packedPackages.push(packedPackage);
    fileCount += packedPackage.fileCount;
  }
  await verifyConsumerInstallation(destination, packedPackages);
} finally {
  await rm(destination, { force: true, recursive: true });
}

process.stdout.write(
  `Verified ${packageDirectories.length} private package artifacts (${fileCount} files) through an isolated runtime, type, and CLI consumer.\n`,
);
