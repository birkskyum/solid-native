import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { crc32 } from "node:zlib";

import {
  applyNativeCreateTemplate,
  assembleNativeReleaseSignature,
  canonicalizeNativeSourceMap,
  checkNativeBundleSources,
  checkNativeCompatibilityCatalog,
  checkNativeSolidBindingGeneration,
  createNativeAdapterScaffoldPlan,
  createNativeCompatibilityEvidenceReport,
  createNativeReleaseManifest,
  createNativeReleaseSignature,
  createNativeReleaseSigningRequest,
  createNativeSymbolicationHandoff,
  createNativeBuildPlan,
  createNativeBundlePlan,
  createNativeCreatePlan,
  createNativeGeneratePlan,
  createNativeSolidBindingAudit,
  createNativeRunPlan,
  createNativeStartPlan,
  executeNativeBuildPlan,
  executeNativeAdapterScaffoldPlan,
  executeNativeBundlePlan,
  executeNativeCreatePlan,
  defaultNativeRunExecutor,
  executeNativeGeneratePlan,
  executeNativeRunPlan,
  executeNativeStartPlan,
  formatNativeBuildPlan,
  formatNativeBundlePlan,
  formatNativeBundleVerification,
  formatNativeCreatePlan,
  formatNativeCreateSuccess,
  formatDoctorReport,
  formatNativeGeneratePlan,
  generateNativeSolidBindingSource,
  formatNativeRunPlan,
  formatNativeReleaseVerification,
  formatNativeReleaseSignatureVerification,
  formatNativeSourceMapPolicyReport,
  formatNativeSymbolicationHandoff,
  formatNativeStartPlan,
  nativeReleaseTrustPolicyFingerprint,
  parseNativeCompatibilityCatalog,
  runDoctor,
  readNativeReleaseSigningRequest,
  readNativeReleaseTrustPolicy,
  readNativeBundleManifest,
  validateCanonicalNativeSourceMap,
  verifyNativeBundleManifest,
  verifyNativeReleaseManifest,
  verifyNativeReleaseSignature,
  writeNativeBundleManifest,
} from "../dist/index.js";

const execFileAsync = promisify(execFile);

function portableSourceMap(sourceContent = "source") {
  return JSON.stringify({
    version: 3,
    sources: ["app:///index.tsx"],
    sourcesContent: [sourceContent],
    names: [],
    mappings: "",
  });
}

async function writeStoredZip(filePath, entries) {
  const localRecords = [];
  const centralRecords = [];
  let localOffset = 0;
  for (const [entryPath, contents] of entries) {
    const name = Buffer.from(entryPath, "utf8");
    const bytes = Buffer.from(contents);
    const checksum = Number(crc32(bytes)) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    localRecords.push(local, name, bytes);
    centralRecords.push(central, name);
    localOffset += local.length + name.length + bytes.length;
  }
  const centralDirectory = Buffer.concat(centralRecords);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  await writeFile(
    filePath,
    Buffer.concat([...localRecords, centralDirectory, end]),
  );
}

async function writeStoredZip64(filePath, entryPath, contents) {
  const name = Buffer.from(entryPath, "utf8");
  const bytes = Buffer.from(contents);
  const checksum = Number(crc32(bytes)) >>> 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(45, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(bytes.length, 18);
  local.writeUInt32LE(bytes.length, 22);
  local.writeUInt16LE(name.length, 26);

  const zip64Extra = Buffer.alloc(28);
  zip64Extra.writeUInt16LE(0x0001, 0);
  zip64Extra.writeUInt16LE(24, 2);
  zip64Extra.writeBigUInt64LE(BigInt(bytes.length), 4);
  zip64Extra.writeBigUInt64LE(BigInt(bytes.length), 12);
  zip64Extra.writeBigUInt64LE(0n, 20);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(45, 4);
  central.writeUInt16LE(45, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(0xffffffff, 20);
  central.writeUInt32LE(0xffffffff, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(zip64Extra.length, 30);
  central.writeUInt32LE(0xffffffff, 42);

  const centralOffset = local.length + name.length + bytes.length;
  const centralDirectory = Buffer.concat([central, name, zip64Extra]);
  const zip64EndOffset = centralOffset + centralDirectory.length;
  const zip64End = Buffer.alloc(56);
  zip64End.writeUInt32LE(0x06064b50, 0);
  zip64End.writeBigUInt64LE(44n, 4);
  zip64End.writeUInt16LE(45, 12);
  zip64End.writeUInt16LE(45, 14);
  zip64End.writeBigUInt64LE(1n, 24);
  zip64End.writeBigUInt64LE(1n, 32);
  zip64End.writeBigUInt64LE(BigInt(centralDirectory.length), 40);
  zip64End.writeBigUInt64LE(BigInt(centralOffset), 48);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeBigUInt64LE(BigInt(zip64EndOffset), 8);
  locator.writeUInt32LE(1, 16);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0xffff, 8);
  end.writeUInt16LE(0xffff, 10);
  end.writeUInt32LE(0xffffffff, 12);
  end.writeUInt32LE(0xffffffff, 16);
  await writeFile(
    filePath,
    Buffer.concat([
      local,
      name,
      bytes,
      centralDirectory,
      zip64End,
      locator,
      end,
    ]),
  );
}

async function temporaryProject(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "solid-native-doctor-"));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

function commandResult(stdout = "", stderr = "") {
  return { exitCode: 0, stdout, stderr, timedOut: false };
}

function reactNativeBoundaryFixture(reactNativeVersion = "0.87.0") {
  return {
    schemaVersion: 1,
    reactNativeVersion,
    nativeHeaders: ["react/renderer/uimanager/UIManager.h"],
    generatedCodegenHeaders: [],
    androidImports: [],
    cocoapods: [],
    androidCmake: {
      reactNativeIncludeDirectories: ["${REACT_ANDROID_DIR}/src/main/jni"],
      inheritedCompileOptions: ["${folly_FLAGS}"],
    },
  };
}

async function installSolidNativePair(
  project,
  {
    version = "0.0.0",
    fabricHostExports = {
      "./android-gradle": "./native/android/solid-native.gradle",
      "./ios-podspec": "./native/SolidNativeFabric.podspec",
      "./react-native-boundary": "./native/react-native-boundary.json",
    },
  } = {},
) {
  const core = path.join(project, "node_modules", "@solid-native", "core");
  const fabricHost = path.join(
    project,
    "node_modules",
    "@solid-native",
    "fabric-host",
  );
  const runtime = path.join(
    project,
    "node_modules",
    "@solid-native",
    "runtime",
  );
  await Promise.all([
    mkdir(core, { recursive: true }),
    mkdir(path.join(fabricHost, "native", "android"), { recursive: true }),
    mkdir(runtime, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(core, "package.json"),
      JSON.stringify({ name: "@solid-native/core", version }),
    ),
    writeFile(
      path.join(fabricHost, "package.json"),
      JSON.stringify({
        name: "@solid-native/fabric-host",
        version,
        exports: fabricHostExports,
      }),
    ),
    writeFile(
      path.join(fabricHost, "native", "android", "solid-native.gradle"),
      "",
    ),
    writeFile(path.join(fabricHost, "native", "SolidNativeFabric.podspec"), ""),
    writeFile(
      path.join(fabricHost, "native", "react-native-boundary.json"),
      JSON.stringify(reactNativeBoundaryFixture()),
    ),
    writeFile(
      path.join(runtime, "package.json"),
      JSON.stringify({ name: "@solid-native/runtime", version }),
    ),
  ]);
}

async function installSolidNativeMetro(project, version = "0.0.0") {
  const metro = path.join(project, "node_modules", "@solid-native", "metro");
  await mkdir(metro, { recursive: true });
  await writeFile(
    path.join(metro, "package.json"),
    JSON.stringify({ name: "@solid-native/metro", version }),
  );
}

async function installReactNativeHermesPair(
  project,
  {
    reactNativeVersion = "0.87.0",
    requiredCompilerVersion = "250829098.0.16",
    installedCompilerVersion = requiredCompilerVersion,
  } = {},
) {
  const reactNative = path.join(project, "node_modules", "react-native");
  const compiler = path.join(project, "node_modules", "hermes-compiler");
  const binaries = [
    path.join(compiler, "hermesc", "osx-bin", "hermesc"),
    path.join(compiler, "hermesc", "linux64-bin", "hermesc"),
    path.join(compiler, "hermesc", "win64-bin", "hermesc.exe"),
  ];
  await Promise.all([
    mkdir(reactNative, { recursive: true }),
    ...binaries.map((binary) =>
      mkdir(path.dirname(binary), { recursive: true }),
    ),
  ]);
  await Promise.all([
    writeFile(
      path.join(reactNative, "package.json"),
      JSON.stringify({
        name: "react-native",
        version: reactNativeVersion,
        dependencies: { "hermes-compiler": requiredCompilerVersion },
      }),
    ),
    writeFile(
      path.join(compiler, "package.json"),
      JSON.stringify({
        name: "hermes-compiler",
        version: installedCompilerVersion,
      }),
    ),
    ...binaries.map((binary) =>
      writeFile(
        binary,
        `#!/bin/sh\necho 'Hermes release version: ${installedCompilerVersion}'\necho 'HBC bytecode version: 98'\n`,
      ),
    ),
  ]);
  await Promise.all(binaries.map((binary) => chmod(binary, 0o755)));
}

async function installNavigationBackendFixture(project) {
  const navigation = path.join(
    project,
    "node_modules",
    "@solid-native",
    "navigation",
  );
  const screens = path.join(project, "node_modules", "react-native-screens");
  const patchRelativePath = "patches/react-native-screens@4.27.0.patch";
  const installedSources = [
    {
      path: "android/src/main/java/example/TabsScreen.kt",
      source: "patched tabs screen\n",
    },
    {
      path: "ios/example/RNSTabBarAppearanceCoordinator.mm",
      source: "patched tabs coordinator\n",
    },
  ];
  const patchSource = "reviewed react-native-screens patch\n";
  await Promise.all([
    mkdir(path.join(navigation, "backend"), { recursive: true }),
    mkdir(path.join(navigation, "patches"), { recursive: true }),
    ...installedSources.map((entry) =>
      mkdir(path.dirname(path.join(screens, entry.path)), { recursive: true }),
    ),
  ]);
  const contract = {
    schemaVersion: 1,
    packageName: "react-native-screens",
    packageVersion: "4.27.0",
    reactNativeVersion: "0.87.0",
    patch: {
      path: patchRelativePath,
      sha256: createHash("sha256").update(patchSource).digest("hex"),
    },
    installedFiles: installedSources.map((entry) => ({
      path: entry.path,
      sha256: createHash("sha256").update(entry.source).digest("hex"),
    })),
  };
  await Promise.all([
    writeFile(
      path.join(navigation, "package.json"),
      JSON.stringify({
        name: "@solid-native/navigation",
        version: "0.0.0",
        exports: {
          "./react-native-screens-backend":
            "./backend/react-native-screens-4.27.0.json",
        },
      }),
    ),
    writeFile(
      path.join(navigation, "backend", "react-native-screens-4.27.0.json"),
      JSON.stringify(contract),
    ),
    writeFile(path.join(navigation, patchRelativePath), patchSource),
    writeFile(
      path.join(screens, "package.json"),
      JSON.stringify({ name: "react-native-screens", version: "4.27.0" }),
    ),
    ...installedSources.map((entry) =>
      writeFile(path.join(screens, entry.path), entry.source),
    ),
  ]);
  return path.join(screens, installedSources[0].path);
}

async function installVerifiedJavaScriptApplication(project) {
  await Promise.all([
    installSolidNativeMetro(project),
    writeFile(
      path.join(project, "metro.config.js"),
      "solidNativeTransformWorkerPath\ncreateSolidNativeMetroResolver\ncreateSolidNativeFullReloadPattern\nunstable_forceFullRefreshPatterns\n",
    ),
    writeFile(
      path.join(project, "index.tsx"),
      'import { startNativeApplication } from "@solid-native/runtime";\nstartNativeApplication(() => null);\n',
    ),
  ]);
}

const verifiedApplicationDependencies = {
  "@solid-native/core": "0.0.0",
  "@solid-native/fabric-host": "0.0.0",
  "@solid-native/metro": "0.0.0",
  "@solid-native/runtime": "0.0.0",
  "react-native": "0.87.0",
  "solid-js": "2.0.0-rc.3",
};

const verifiedApplicationDevDependencies = {
  "@react-native/codegen": "0.87.0",
  "@react-native/gradle-plugin": "0.87.0",
  "hermes-compiler": "250829098.0.16",
};

async function writeGeneratedReactNativeProject(
  project,
  { packageName = "dev.solidnative.demo", projectName = "DemoApp" } = {},
) {
  const androidPackage = path.join(
    project,
    "android",
    "app",
    "src",
    "main",
    "java",
    ...packageName.split("."),
  );
  const iosApplication = path.join(project, "ios", projectName);
  await Promise.all([
    mkdir(androidPackage, { recursive: true }),
    mkdir(iosApplication, { recursive: true }),
    mkdir(path.join(project, "__tests__"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(project, ".gitignore"),
      "/node_modules/\n/android/app/build/\n/ios/build/\n",
    ),
    writeFile(
      path.join(project, "package.json"),
      JSON.stringify({
        name: packageName,
        version: "0.0.1",
        private: true,
        scripts: {
          android: "react-native run-android",
          ios: "react-native run-ios",
          lint: "eslint .",
          start: "react-native start",
          test: "jest",
        },
        dependencies: {
          react: "19.2.3",
          "react-native": "0.87.0",
          "@react-native/new-app-screen": "0.87.0",
          "react-native-safe-area-context": "^5.5.2",
        },
        devDependencies: {
          "@react-native-community/cli": "20.2.0",
          "@react-native-community/cli-platform-android": "20.2.0",
          "@react-native-community/cli-platform-ios": "20.2.0",
          "@react-native/babel-preset": "0.87.0",
          "@react-native/metro-config": "0.87.0",
          "@react-native/typescript-config": "0.87.0",
          "@react-native/jest-preset": "0.87.0",
          "@types/jest": "^29.0.0",
          jest: "^29.0.0",
          typescript: "^6.0.0",
        },
      }),
    ),
    writeFile(
      path.join(project, "android", "app", "build.gradle"),
      [
        'apply plugin: "com.android.application"',
        'apply plugin: "org.jetbrains.kotlin.android"',
        'apply plugin: "com.facebook.react"',
        "",
        "react { autolinkLibrariesWithApp() }",
        "",
        "android {",
        '    namespace "dev.solidnative.demo"',
        "}",
        "",
        "dependencies {",
        '    implementation("com.facebook.react:react-android")',
        "}",
        "",
      ].join("\n"),
    ),
    writeFile(
      path.join(project, "android", "gradle.properties"),
      "newArchEnabled=true\nhermesEnabled=true\nedgeToEdgeEnabled=true\n",
    ),
    writeFile(
      path.join(androidPackage, "MainApplication.kt"),
      `package ${packageName}\nclass MainApplication { fun host() = getDefaultReactHost() }\n`,
    ),
    writeFile(
      path.join(androidPackage, "MainActivity.kt"),
      `package ${packageName}\nclass MainActivity : ReactActivity()\n`,
    ),
    writeFile(
      path.join(project, "ios", "Podfile"),
      [
        "platform :ios, min_ios_version_supported",
        `target '${projectName}' do`,
        "  config = use_native_modules!",
        "  use_react_native!",
        "end",
        "",
      ].join("\n"),
    ),
    writeFile(
      path.join(iosApplication, "AppDelegate.swift"),
      "import UIKit\nlet factory = RCTReactNativeFactory()\n",
    ),
    writeFile(
      path.join(iosApplication, "Info.plist"),
      "<plist>\n\t<key>NSLocationWhenInUseUsageDescription</key>\n\t<string></string>\n</plist>\n",
    ),
    writeFile(
      path.join(project, "App.tsx"),
      "export default function App() {}\n",
    ),
    writeFile(path.join(project, "jest.config.js"), "module.exports = {};\n"),
    writeFile(path.join(project, ".eslintrc.js"), "module.exports = {};\n"),
    writeFile(path.join(project, ".prettierrc.js"), "module.exports = {};\n"),
    writeFile(
      path.join(project, "__tests__", "App.test.tsx"),
      "test('app', () => {});\n",
    ),
  ]);
}

test("accepts a fully configured device-verified application", async (t) => {
  const project = await temporaryProject(t);
  const sdk = path.join(project, "android-sdk");
  await Promise.all([
    mkdir(path.join(project, "specs"), { recursive: true }),
    mkdir(path.join(project, "ios", "DoctorFixture"), { recursive: true }),
    mkdir(path.join(project, "android", "app", "src", "main", "jni"), {
      recursive: true,
    }),
    mkdir(
      path.join(
        project,
        "android",
        "app",
        "src",
        "main",
        "java",
        "dev",
        "fixture",
      ),
      { recursive: true },
    ),
    mkdir(path.join(project, "node_modules", "@solid-native", "core"), {
      recursive: true,
    }),
    mkdir(path.join(project, "node_modules", "@solid-native", "metro"), {
      recursive: true,
    }),
    mkdir(
      path.join(
        project,
        "node_modules",
        "@solid-native",
        "fabric-host",
        "native",
        "android",
      ),
      { recursive: true },
    ),
    mkdir(path.join(sdk, "platform-tools"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(project, "package.json"),
      JSON.stringify({
        name: "doctor-fixture",
        packageManager: "pnpm@9.15.0",
        codegenConfig: {
          name: "SolidNativeAppSpec",
          type: "modules",
          jsSrcsDir: "specs",
          android: { javaPackageName: "dev.solidnative.runtime" },
          ios: {
            modulesProvider: {
              SolidNativeDebug: "SolidNativeDebugModule",
            },
          },
        },
        dependencies: {
          "@solid-native/core": "0.0.0",
          "@solid-native/fabric-host": "0.0.0",
          "@solid-native/metro": "0.0.0",
          "@solid-native/runtime": "0.0.0",
          "react-native": "0.87.0",
          "solid-js": "2.0.0-rc.3",
        },
        devDependencies: {
          "@react-native/codegen": "0.87.0",
          "@react-native/gradle-plugin": "0.87.0",
          "hermes-compiler": "250829098.0.16",
        },
      }),
    ),
    writeFile(
      path.join(
        project,
        "node_modules",
        "@solid-native",
        "core",
        "package.json",
      ),
      JSON.stringify({ name: "@solid-native/core", version: "0.0.0" }),
    ),
    writeFile(
      path.join(
        project,
        "node_modules",
        "@solid-native",
        "metro",
        "package.json",
      ),
      JSON.stringify({ name: "@solid-native/metro", version: "0.0.0" }),
    ),
    writeFile(
      path.join(
        project,
        "node_modules",
        "@solid-native",
        "fabric-host",
        "package.json",
      ),
      JSON.stringify({
        name: "@solid-native/fabric-host",
        version: "0.0.0",
        exports: {
          "./android-gradle": "./native/android/solid-native.gradle",
          "./ios-podspec": "./native/SolidNativeFabric.podspec",
          "./react-native-boundary": "./native/react-native-boundary.json",
        },
      }),
    ),
    writeFile(
      path.join(
        project,
        "node_modules",
        "@solid-native",
        "fabric-host",
        "native",
        "android",
        "solid-native.gradle",
      ),
      "",
    ),
    writeFile(
      path.join(
        project,
        "node_modules",
        "@solid-native",
        "fabric-host",
        "native",
        "react-native-boundary.json",
      ),
      JSON.stringify(reactNativeBoundaryFixture()),
    ),
    writeFile(
      path.join(
        project,
        "node_modules",
        "@solid-native",
        "fabric-host",
        "native",
        "SolidNativeFabric.podspec",
      ),
      "",
    ),
    mkdir(path.join(project, "node_modules", "@solid-native", "runtime"), {
      recursive: true,
    }).then(() =>
      writeFile(
        path.join(
          project,
          "node_modules",
          "@solid-native",
          "runtime",
          "package.json",
        ),
        JSON.stringify({ name: "@solid-native/runtime", version: "0.0.0" }),
      ),
    ),
    writeFile(
      path.join(project, "ios", "Podfile"),
      [
        'require.resolve("@solid-native/fabric-host/ios-podspec")',
        "pod 'SolidNativeFabric', :path => solid_native_fabric_host_native_path",
        "use_react_native!",
      ].join("\n"),
    ),
    writeFile(
      path.join(project, "metro.config.js"),
      "solidNativeTransformWorkerPath\ncreateSolidNativeMetroResolver\ncreateSolidNativeFullReloadPattern\nunstable_forceFullRefreshPatterns\n",
    ),
    writeFile(
      path.join(project, "index.tsx"),
      'import { startNativeApplication } from "@solid-native/runtime";\nstartNativeApplication(() => null);\n',
    ),
    writeFile(path.join(project, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n"),
    writeFile(
      path.join(project, "ios", "DoctorFixture", "AppDelegate.swift"),
      "import SolidNativeFabric\nSolidNativeFabricApplication.start()\nSolidNativeDebugRequest.handle(url: url)\n",
    ),
    writeFile(
      path.join(project, "android", "gradle.properties"),
      "newArchEnabled=true\nhermesEnabled=true\n",
    ),
    writeFile(path.join(project, "android", "gradlew"), "#!/bin/sh\n"),
    writeFile(
      path.join(project, "android", "app", "build.gradle"),
      [
        "require.resolve('@solid-native/fabric-host/android-gradle')",
        "android {",
        "  signingConfigs {",
        "    release {}",
        "  }",
        "  buildTypes {",
        "    release {",
        "      signingConfig signingConfigs.release",
        "    }",
        "  }",
        "}",
        "",
      ].join("\n"),
    ),
    writeFile(
      path.join(
        project,
        "android",
        "app",
        "src",
        "main",
        "jni",
        "CMakeLists.txt",
      ),
      'include("SolidNativeRuntime.cmake")\nsolid_native_configure_android_target(appmodules)\n',
    ),
    writeFile(
      path.join(project, "android", "app", "src", "main", "jni", "OnLoad.cpp"),
      "void JNI_OnLoad() { registerSolidNativeBindingsInstaller(); }\n",
    ),
    writeFile(
      path.join(
        project,
        "android",
        "app",
        "src",
        "main",
        "java",
        "dev",
        "fixture",
        "MainApplication.kt",
      ),
      "val bindingsInstaller = SolidNativeBindingsInstaller()\nval packages = listOf(SolidNativePackage())\nfun onTrimMemory(level: Int) = SolidNativeMemoryWarning.handleTrimMemory(level)\nfun onLowMemory() = SolidNativeMemoryWarning.handleLowMemory()\n",
    ),
    writeFile(
      path.join(project, "specs", "NativeSolidNativeDebug.ts"),
      'import type { TurboModule } from "react-native";\nimport { TurboModuleRegistry } from "react-native";\nexport type NativeDebugRequest = { requestId: string; operation: string; sessionId?: string };\nexport interface Spec extends TurboModule {}\nexport default TurboModuleRegistry.getEnforcing<Spec>("SolidNativeDebug");\n',
    ),
    writeFile(
      path.join(project, "specs", "NativeSolidNativePlatformAndroid.ts"),
      'import type { TurboModule } from "react-native";\nimport { TurboModuleRegistry } from "react-native";\nexport interface Spec extends TurboModule { readonly onMemoryWarning: unknown; }\nexport default TurboModuleRegistry.getEnforcing<Spec>(\n  "SolidNativePlatformAndroid",\n);\n',
    ),
    writeFile(
      path.join(
        project,
        "android",
        "app",
        "src",
        "main",
        "java",
        "dev",
        "fixture",
        "MainActivity.kt",
      ),
      "SolidNativeSurface.start(activity, reactHost, bindingsInstaller)\n",
    ),
    writeFile(path.join(sdk, "platform-tools", "adb"), ""),
  ]);

  await installReactNativeHermesPair(project);

  const report = await runDoctor({
    cwd: project,
    env: { ANDROID_HOME: sdk },
    dependencies: {
      hostPlatform: "darwin",
      homeDirectory: project,
      nodeVersion: "22.14.0",
      async runCommand(command) {
        switch (path.basename(command)) {
          case "hermesc":
            return commandResult(
              "Hermes release version: 250829098.0.16\nHBC bytecode version: 98",
            );
          case "java":
            return commandResult("", 'openjdk version "21.0.2"');
          case "adb":
            return commandResult("Android Debug Bridge version 1.0.41");
          case "xcodebuild":
            return commandResult("Xcode 26.6\nBuild version 17F113");
          case "pod":
            return commandResult("1.16.2");
          default:
            throw new Error(`Unexpected command ${command}`);
        }
      },
    },
  });

  assert.equal(report.ok, true);
  assert.equal(report.summary.fail, 0);
  assert.equal(report.summary.warn, 0);
  assert.deepEqual(
    report.checks.map((entry) => entry.id),
    [
      "runtime.node",
      "project.manifest",
      "project.solid-native",
      "project.solid-native-installation",
      "project.react-native",
      "project.solid-runtime",
      "project.native-build-toolchain",
      "project.hermes-pair",
      "project.oxc-metro",
      "project.javascript-bootstrap",
      "project.hermes-bytecode",
      "project.package-manager",
      "project.lockfile",
      "ios.project",
      "ios.podfile",
      "ios.runtime-pod",
      "ios.runtime-bootstrap",
      "ios.runtime-debug-url",
      "ios.runtime-codegen",
      "ios.xcode",
      "ios.cocoapods",
      "android.project",
      "android.fabric",
      "android.hermes",
      "android.gradle-wrapper",
      "android.runtime-gradle",
      "android.release-signing",
      "android.runtime-cmake",
      "android.runtime-jni",
      "android.runtime-bootstrap",
      "android.runtime-package",
      "android.memory-pressure",
      "android.runtime-codegen",
      "android.runtime-surface",
      "android.sdk",
      "android.java",
      "android.adb",
    ],
  );
});

test("distinguishes development and distribution Android signing", async (t) => {
  const project = await temporaryProject(t);
  const applicationBuild = path.join(
    project,
    "android",
    "app",
    "build.gradle.kts",
  );
  await mkdir(path.dirname(applicationBuild), { recursive: true });
  await Promise.all([
    writeFile(
      path.join(project, "package.json"),
      JSON.stringify({ name: "android-signing-fixture" }),
    ),
    writeFile(
      path.join(project, "android", "gradle.properties"),
      "newArchEnabled=true\nhermesEnabled=true\n",
    ),
  ]);

  const inspectSigning = async (buildSource) => {
    await writeFile(
      applicationBuild,
      `require.resolve("@solid-native/fabric-host/android-gradle")\n${buildSource}`,
    );
    const report = await runDoctor({
      cwd: project,
      platform: "android",
      env: {},
      dependencies: {
        hostPlatform: "linux",
        homeDirectory: project,
        nodeVersion: "22.14.0",
        async runCommand(command) {
          return path.basename(command) === "java"
            ? commandResult("", 'openjdk version "21.0.2"')
            : commandResult("Android Debug Bridge version 1.0.41");
        },
      },
    });
    return report.checks.find(
      (entry) => entry.id === "android.release-signing",
    );
  };

  const debug = await inspectSigning(`android {
    buildTypes {
      release {
        signingConfig signingConfigs.debug
      }
    }
  }`);
  assert.equal(debug?.status, "warn");
  assert.match(debug?.message ?? "", /local development, not Play/u);
  assert.match(debug?.remediation ?? "", /Do not commit private keys/u);

  const distribution = await inspectSigning(`android {
    buildTypes {
      getByName("release") {
        // signingConfig = signingConfigs.getByName("debug")
        signingConfig = signingConfigs.getByName("upload")
      }
    }
  }`);
  assert.equal(distribution?.status, "pass");
  assert.match(distribution?.message ?? "", /signingConfigs\.upload/u);
  assert.match(distribution?.message ?? "", /delivery-pipeline/u);

  const ambiguous = await inspectSigning(`android {
    buildTypes {
      release {
        signingConfig = signingConfigs["debug"]
        signingConfig = signingConfigs["upload"]
      }
    }
  }`);
  assert.equal(ambiguous?.status, "warn");
  assert.match(ambiguous?.message ?? "", /ambiguous/u);

  const missing = await inspectSigning(`android {
    buildTypes {
      release {
        minifyEnabled = true
      }
    }
  }`);
  assert.equal(missing?.status, "warn");
  assert.match(missing?.message ?? "", /does not expose/u);
});

test("rejects an incomplete Solid compiler and application bootstrap", async (t) => {
  const project = await temporaryProject(t);
  await writeFile(
    path.join(project, "package.json"),
    JSON.stringify({
      packageManager: "pnpm@9.15.0",
      dependencies: {
        "@solid-native/core": "0.0.0",
        "@solid-native/fabric-host": "0.0.0",
        "@solid-native/runtime": "0.0.0",
        "react-native": "0.87.0",
        "solid-js": "^2.0.0",
      },
    }),
  );

  const report = await runDoctor({
    cwd: project,
    platform: "ios",
    dependencies: {
      hostPlatform: "linux",
      nodeVersion: "26.3.0",
    },
  });
  const applicationChecks = report.checks.filter((entry) =>
    [
      "project.solid-runtime",
      "project.native-build-toolchain",
      "project.oxc-metro",
      "project.javascript-bootstrap",
      "project.lockfile",
    ].includes(entry.id),
  );

  assert.deepEqual(
    applicationChecks.map((entry) => entry.status),
    ["fail", "fail", "fail", "fail", "fail"],
  );
  for (const entry of applicationChecks) assert.ok(entry.remediation, entry.id);
});

test("rejects a React Native/Hermes compiler mismatch before native build", async (t) => {
  const project = await temporaryProject(t);
  const cli = path.join(project, "node_modules", "react-native", "cli.js");
  await Promise.all([
    mkdir(path.dirname(cli), { recursive: true }),
    mkdir(path.join(project, "android"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(project, "package.json"),
      JSON.stringify({
        dependencies: verifiedApplicationDependencies,
        devDependencies: verifiedApplicationDevDependencies,
      }),
    ),
    writeFile(cli, ""),
  ]);
  await Promise.all([
    installSolidNativePair(project),
    installVerifiedJavaScriptApplication(project),
    installReactNativeHermesPair(project, {
      requiredCompilerVersion: "260318099.0.1",
      installedCompilerVersion: "250829098.0.16",
    }),
  ]);

  await assert.rejects(
    createNativeBuildPlan({ cwd: project, platform: "android" }),
    /requires hermes-compiler 260318099\.0\.1 but the application resolves 250829098\.0\.16/u,
  );
});

test("rejects a compiler that reports the wrong Hermes bytecode format", async (t) => {
  const project = await temporaryProject(t);
  await writeFile(
    path.join(project, "package.json"),
    JSON.stringify({
      dependencies: verifiedApplicationDependencies,
      devDependencies: verifiedApplicationDevDependencies,
    }),
  );
  await Promise.all([
    installSolidNativePair(project),
    installVerifiedJavaScriptApplication(project),
    installReactNativeHermesPair(project),
  ]);

  const report = await runDoctor({
    cwd: project,
    platform: "android",
    dependencies: {
      hostPlatform: "darwin",
      nodeVersion: "26.3.0",
      async runCommand(command) {
        assert.equal(path.basename(command), "hermesc");
        return commandResult(
          "Hermes release version: 250829098.0.16\nHBC bytecode version: 99",
        );
      },
    },
  });
  const pair = report.checks.find(
    (entry) => entry.id === "project.hermes-pair",
  );
  const bytecode = report.checks.find(
    (entry) => entry.id === "project.hermes-bytecode",
  );
  assert.equal(pair?.status, "pass");
  assert.equal(bytecode?.status, "fail");
  assert.match(bytecode?.message ?? "", /emits HBC 99.*HBC 98/u);
  assert.match(bytecode?.remediation ?? "", /aborts at application launch/u);
});

test("reports a missing host Hermes compiler binary", async (t) => {
  const project = await temporaryProject(t);
  await writeFile(
    path.join(project, "package.json"),
    JSON.stringify({
      dependencies: verifiedApplicationDependencies,
      devDependencies: verifiedApplicationDevDependencies,
    }),
  );
  await Promise.all([
    installSolidNativePair(project),
    installVerifiedJavaScriptApplication(project),
    installReactNativeHermesPair(project),
  ]);
  await rm(
    path.join(
      project,
      "node_modules",
      "hermes-compiler",
      "hermesc",
      "osx-bin",
      "hermesc",
    ),
  );

  const report = await runDoctor({
    cwd: project,
    platform: "android",
    dependencies: { hostPlatform: "darwin", nodeVersion: "26.3.0" },
  });
  const pair = report.checks.find(
    (entry) => entry.id === "project.hermes-pair",
  );
  const bytecode = report.checks.find(
    (entry) => entry.id === "project.hermes-bytecode",
  );
  assert.equal(pair?.status, "fail");
  assert.match(pair?.message ?? "", /does not contain the darwin compiler/u);
  assert.equal(bytecode?.status, "skip");
});

test("verifies the installed native navigation backend bytes", async (t) => {
  const project = await temporaryProject(t);
  await writeFile(
    path.join(project, "package.json"),
    JSON.stringify({
      dependencies: {
        "@solid-native/navigation": "0.0.0",
        "react-native": "0.87.0",
        "react-native-screens": "4.27.0",
      },
    }),
  );
  const patchedFile = await installNavigationBackendFixture(project);
  const dependencies = {
    hostPlatform: "linux",
    nodeVersion: "26.3.0",
    async runCommand() {
      return commandResult();
    },
  };

  const passing = await runDoctor({
    cwd: project,
    platform: "ios",
    dependencies,
  });
  const passingBackend = passing.checks.find(
    (entry) => entry.id === "project.navigation-backend",
  );
  assert.equal(passingBackend?.status, "pass");
  assert.match(passingBackend?.message ?? "", /all 2 reviewed patched/u);

  await writeFile(patchedFile, "unpatched upstream tabs screen\n");
  const failing = await runDoctor({
    cwd: project,
    platform: "ios",
    dependencies,
  });
  const failingBackend = failing.checks.find(
    (entry) => entry.id === "project.navigation-backend",
  );
  assert.equal(failingBackend?.status, "fail");
  assert.match(
    failingBackend?.message ?? "",
    /does not match the reviewed patched backend/u,
  );
  assert.match(
    failingBackend?.remediation ?? "",
    /@solid-native\/navigation\/react-native-screens-patch/u,
  );
});

test("rejects Metro wiring that leaves Solid modules to React Refresh", async (t) => {
  const project = await temporaryProject(t);
  await Promise.all([
    writeFile(
      path.join(project, "package.json"),
      JSON.stringify({
        packageManager: "pnpm@9.15.0",
        dependencies: verifiedApplicationDependencies,
        devDependencies: verifiedApplicationDevDependencies,
      }),
    ),
    writeFile(path.join(project, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n"),
    writeFile(
      path.join(project, "metro.config.js"),
      "solidNativeTransformWorkerPath\ncreateSolidNativeMetroResolver\n",
    ),
    writeFile(
      path.join(project, "index.tsx"),
      'import { startNativeApplication } from "@solid-native/runtime";\nstartNativeApplication(() => null);\n',
    ),
    installSolidNativePair(project),
    installSolidNativeMetro(project),
  ]);

  const report = await runDoctor({
    cwd: project,
    dependencies: { hostPlatform: "linux", nodeVersion: "22.14.0" },
  });
  const metro = report.checks.find((entry) => entry.id === "project.oxc-metro");
  assert.equal(metro?.status, "fail");
  assert.match(metro?.message ?? "", /safe full-reload policy/);
  assert.match(metro?.remediation ?? "", /React Refresh/);
});

test("reports actionable backend and host failures", async (t) => {
  const project = await temporaryProject(t);
  await mkdir(path.join(project, "ios"));
  await Promise.all([
    writeFile(
      path.join(project, "package.json"),
      JSON.stringify({
        name: "broken-fixture",
        packageManager: "yarn@4.0.0",
        dependencies: {
          "@solid-native/core": "0.0.0",
          "@solid-native/fabric-host": "0.0.0",
          "react-native": "^0.87.0",
        },
      }),
    ),
    writeFile(path.join(project, "ios", "Podfile"), ""),
  ]);

  const report = await runDoctor({
    cwd: project,
    platform: "ios",
    dependencies: {
      hostPlatform: "linux",
      nodeVersion: "20.19.0",
    },
  });

  assert.equal(report.ok, false);
  assert.deepEqual(
    report.checks
      .filter((entry) => entry.status === "fail")
      .map((entry) => entry.id),
    [
      "runtime.node",
      "project.solid-native",
      "project.react-native",
      "ios.runtime-pod",
      "ios.runtime-bootstrap",
      "ios.runtime-debug-url",
      "ios.runtime-codegen",
      "ios.xcode",
    ],
  );
  assert.equal(report.summary.warn, 1);
  assert.match(
    report.checks.find((entry) => entry.id === "project.react-native")
      ?.remediation,
    /exactly 0\.87\.0/u,
  );
});

test("rejects the legacy iOS smoke bootstrap for production runs", async (t) => {
  const project = await temporaryProject(t);
  await mkdir(path.join(project, "ios", "Fixture"), { recursive: true });
  await Promise.all([
    writeFile(
      path.join(project, "package.json"),
      JSON.stringify({
        dependencies: {
          "@solid-native/core": "0.0.0",
          "@solid-native/fabric-host": "0.0.0",
          "@solid-native/runtime": "0.0.0",
          "react-native": "0.87.0",
        },
      }),
    ),
    writeFile(
      path.join(project, "ios", "Podfile"),
      'require.resolve("@solid-native/fabric-host/ios-podspec")\npod "SolidNativeFabric"\n',
    ),
    writeFile(
      path.join(project, "ios", "Fixture", "AppDelegate.swift"),
      "import SolidNativeFabric\nSolidNativeFabricSmokeApplication.start()\n",
    ),
  ]);

  const report = await runDoctor({
    cwd: project,
    platform: "ios",
    dependencies: {
      hostPlatform: "linux",
      nodeVersion: "26.3.0",
    },
  });
  const bootstrap = report.checks.find(
    (entry) => entry.id === "ios.runtime-bootstrap",
  );

  assert.equal(bootstrap?.status, "fail");
  assert.match(bootstrap?.message, /SolidNativeFabricApplication/u);
});

test("rejects an Android project with an incomplete native startup chain", async (t) => {
  const project = await temporaryProject(t);
  const sdk = path.join(project, "android-sdk");
  await Promise.all([
    mkdir(path.join(project, "android", "app", "src", "main"), {
      recursive: true,
    }),
    mkdir(path.join(sdk, "platform-tools"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(project, "package.json"),
      JSON.stringify({
        packageManager: "pnpm@9.15.0",
        dependencies: {
          "@solid-native/core": "0.0.0",
          "@solid-native/fabric-host": "0.0.0",
          "@solid-native/runtime": "0.0.0",
          "react-native": "0.87.0",
        },
      }),
    ),
    writeFile(
      path.join(project, "android", "gradle.properties"),
      "newArchEnabled=true\nhermesEnabled=true\n",
    ),
    writeFile(path.join(project, "android", "gradlew"), "#!/bin/sh\n"),
    writeFile(path.join(project, "android", "app", "build.gradle"), ""),
    writeFile(path.join(sdk, "platform-tools", "adb"), ""),
  ]);

  const report = await runDoctor({
    cwd: project,
    platform: "android",
    env: { ANDROID_HOME: sdk },
    dependencies: {
      nodeVersion: "26.3.0",
      async runCommand(command) {
        return path.basename(command) === "java"
          ? commandResult("", 'openjdk version "21.0.2"')
          : commandResult("Android Debug Bridge version 1.0.41");
      },
    },
  });

  assert.equal(report.ok, false);
  assert.deepEqual(
    report.checks
      .filter(
        (entry) =>
          entry.status === "fail" && entry.id.startsWith("android.runtime-"),
      )
      .map((entry) => entry.id),
    [
      "android.runtime-gradle",
      "android.runtime-cmake",
      "android.runtime-jni",
      "android.runtime-bootstrap",
      "android.runtime-package",
      "android.runtime-codegen",
      "android.runtime-surface",
    ],
  );
  for (const entry of report.checks.filter((check) =>
    check.id.startsWith("android.runtime-"),
  )) {
    assert.ok(entry.remediation, entry.id);
  }
});

test("rejects mismatched declared Solid Native releases", async (t) => {
  const project = await temporaryProject(t);
  await writeFile(
    path.join(project, "package.json"),
    JSON.stringify({
      packageManager: "pnpm@9.15.0",
      dependencies: {
        "@solid-native/core": "0.4.0",
        "@solid-native/fabric-host": "0.4.0",
        "@solid-native/runtime": "0.5.0",
        "react-native": "0.87.0",
      },
    }),
  );

  const report = await runDoctor({
    cwd: project,
    platform: "android",
    dependencies: { nodeVersion: "26.3.0" },
  });
  const pair = report.checks.find(
    (entry) => entry.id === "project.solid-native",
  );

  assert.equal(pair?.status, "fail");
  assert.match(pair?.message, /0\.4\.0.*0\.5\.0.*do not match/u);
});

test("rejects an installed Fabric Host missing its platform export", async (t) => {
  const project = await temporaryProject(t);
  const core = path.join(project, "node_modules", "@solid-native", "core");
  const fabricHost = path.join(
    project,
    "node_modules",
    "@solid-native",
    "fabric-host",
  );
  const runtime = path.join(
    project,
    "node_modules",
    "@solid-native",
    "runtime",
  );
  await Promise.all([
    mkdir(core, { recursive: true }),
    mkdir(fabricHost, { recursive: true }),
    mkdir(runtime, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(project, "package.json"),
      JSON.stringify({
        packageManager: "pnpm@9.15.0",
        dependencies: {
          "@solid-native/core": "0.4.0",
          "@solid-native/fabric-host": "0.4.0",
          "@solid-native/runtime": "0.4.0",
          "react-native": "0.87.0",
        },
      }),
    ),
    writeFile(
      path.join(core, "package.json"),
      JSON.stringify({ name: "@solid-native/core", version: "0.4.0" }),
    ),
    writeFile(
      path.join(fabricHost, "package.json"),
      JSON.stringify({
        name: "@solid-native/fabric-host",
        version: "0.4.0",
        exports: { ".": "./dist/index.js" },
      }),
    ),
    writeFile(
      path.join(runtime, "package.json"),
      JSON.stringify({ name: "@solid-native/runtime", version: "0.4.0" }),
    ),
  ]);

  const report = await runDoctor({
    cwd: project,
    platform: "android",
    dependencies: { nodeVersion: "26.3.0" },
  });
  const installation = report.checks.find(
    (entry) => entry.id === "project.solid-native-installation",
  );

  assert.equal(installation?.status, "fail");
  assert.match(installation?.message, /does not expose \.\/android-gradle/u);
});

test("rejects a missing or incompatible installed React Native boundary", async (t) => {
  const packageManifest = {
    packageManager: "pnpm@9.15.0",
    dependencies: {
      "@solid-native/core": "0.4.0",
      "@solid-native/fabric-host": "0.4.0",
      "@solid-native/runtime": "0.4.0",
      "react-native": "0.87.0",
    },
  };

  const missing = await temporaryProject(t);
  await writeFile(
    path.join(missing, "package.json"),
    JSON.stringify(packageManifest),
  );
  await installSolidNativePair(missing, {
    version: "0.4.0",
    fabricHostExports: {
      "./android-gradle": "./native/android/solid-native.gradle",
      "./ios-podspec": "./native/SolidNativeFabric.podspec",
    },
  });
  const missingReport = await runDoctor({
    cwd: missing,
    platform: "android",
    dependencies: { nodeVersion: "26.3.0" },
  });
  assert.match(
    missingReport.checks.find(
      (entry) => entry.id === "project.solid-native-installation",
    )?.message,
    /does not expose \.\/react-native-boundary/u,
  );

  const incompatible = await temporaryProject(t);
  await writeFile(
    path.join(incompatible, "package.json"),
    JSON.stringify(packageManifest),
  );
  await installSolidNativePair(incompatible, { version: "0.4.0" });
  await writeFile(
    path.join(
      incompatible,
      "node_modules",
      "@solid-native",
      "fabric-host",
      "native",
      "react-native-boundary.json",
    ),
    JSON.stringify(reactNativeBoundaryFixture("0.88.0")),
  );
  const incompatibleReport = await runDoctor({
    cwd: incompatible,
    platform: "android",
    dependencies: { nodeVersion: "26.3.0" },
  });
  assert.match(
    incompatibleReport.checks.find(
      (entry) => entry.id === "project.solid-native-installation",
    )?.message,
    /does not contain the verified React Native 0\.87\.0 boundary inventory/u,
  );
});

test("matches the React Native 0.87 Node.js engine range", async (t) => {
  const project = await temporaryProject(t);
  const versions = new Map([
    ["22.12.0", false],
    ["22.13.0", true],
    ["23.11.1", false],
    ["24.2.0", false],
    ["24.3.0", true],
    ["25.8.0", false],
    ["26.0.0", true],
    ["invalid", false],
  ]);

  for (const [nodeVersion, expected] of versions) {
    const report = await runDoctor({
      cwd: project,
      platform: "ios",
      dependencies: {
        hostPlatform: "linux",
        nodeVersion,
      },
    });
    assert.equal(
      report.checks.find((entry) => entry.id === "runtime.node")?.status,
      expected ? "pass" : "fail",
      nodeVersion,
    );
  }
});

test("discovers the project manifest from a nested working directory", async (t) => {
  const project = await temporaryProject(t);
  const nested = path.join(project, "packages", "app", "src");
  await mkdir(nested, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(project, "package.json"),
      JSON.stringify({ name: "workspace", packageManager: "pnpm@9.15.0" }),
    ),
    writeFile(path.join(project, "pnpm-workspace.yaml"), "packages: []\n"),
  ]);

  const report = await runDoctor({
    cwd: nested,
    dependencies: { nodeVersion: "26.3.0" },
  });

  assert.equal(report.ok, true);
  assert.equal(report.projectRoot, project);
  assert.equal(report.summary.skip, 4);
  assert.match(formatDoctorReport(report), /Ready: 4 passed/u);
});

test("inherits the pinned package manager from a monorepo root", async (t) => {
  const workspace = await temporaryProject(t);
  const project = path.join(workspace, "apps", "native");
  await mkdir(project, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(workspace, "package.json"),
      JSON.stringify({ name: "root", packageManager: "pnpm@9.15.0" }),
    ),
    writeFile(
      path.join(project, "package.json"),
      JSON.stringify({
        name: "native",
        dependencies: {
          "@solid-native/core": "0.0.0",
          "@solid-native/fabric-host": "0.0.0",
          "@solid-native/runtime": "0.0.0",
          "react-native": "0.87.0",
        },
      }),
    ),
  ]);

  const report = await runDoctor({
    cwd: project,
    dependencies: { nodeVersion: "26.3.0" },
  });
  const packageManager = report.checks.find(
    (entry) => entry.id === "project.package-manager",
  );
  assert.equal(packageManager?.status, "pass");
  assert.match(packageManager?.message, /from .*package\.json/u);
});

test("exposes stable help and version entry points", async () => {
  const bin = new URL("../dist/bin.js", import.meta.url);
  const [{ stdout: help }, { stdout: version }] = await Promise.all([
    execFileAsync(process.execPath, [bin.pathname, "--help"]),
    execFileAsync(process.execPath, [bin.pathname, "--version"]),
  ]);
  assert.match(help, /solid-native create/u);
  assert.match(help, /solid-native add navigation/u);
  assert.match(help, /solid-native build/u);
  assert.match(help, /solid-native bundle/u);
  assert.match(help, /solid-native doctor/u);
  assert.match(help, /release verify-android-signing/u);
  assert.match(help, /--android-upload-certificate-sha256/u);
  assert.match(help, /--android-signing-certificate-sha256/u);
  assert.match(help, /solid-native fingerprint/u);
  assert.match(help, /solid-native logs android/u);
  assert.match(help, /solid-native compatibility evidence/u);
  assert.match(help, /solid-native release/u);
  assert.match(help, /solid-native start/u);
  assert.equal(version, "0.0.0\n");
});

test("builds a fail-closed React Native 0.87 create plan", async (t) => {
  const creationRoot = await temporaryProject(t);
  const targetDirectory = path.join(creationRoot, "custom", "demo");
  const plan = await createNativeCreatePlan({
    cwd: creationRoot,
    directory: path.join("custom", "demo"),
    packageName: "dev.example.demo",
    projectName: "DemoApp",
    skipInstall: true,
    title: "Solid Demo",
    dependencies: {
      reactNativeCommunityCli: path.join(creationRoot, "rnc-cli.js"),
    },
  });

  assert.equal(plan.operation, "create");
  assert.equal(plan.targetDirectory, targetDirectory);
  assert.equal(plan.packageManager, "pnpm@9.15.0");
  assert.equal(plan.installCommand, undefined);
  assert.deepEqual(plan.args.slice(1, 7), [
    "init",
    "DemoApp",
    "--version",
    "0.87.0",
    "--directory",
    targetDirectory,
  ]);
  assert.deepEqual(plan.args.slice(-4), [
    "--replace-directory",
    "false",
    "--install-pods",
    "false",
  ]);
  assert.match(formatNativeCreatePlan(plan), /--skip-install/u);
  assert.equal(
    formatNativeCreateSuccess(plan),
    `Created DemoApp at ${targetDirectory}.\n\nNext:\n  cd ${targetDirectory}\n  pnpm install\n  pnpm run doctor\n  pnpm start`,
  );

  await mkdir(targetDirectory, { recursive: true });
  await assert.rejects(
    createNativeCreatePlan({
      cwd: creationRoot,
      directory: targetDirectory,
      projectName: "DemoApp",
      dependencies: { reactNativeCommunityCli: "/fixture/rnc-cli.js" },
    }),
    /Refusing to replace the existing create target/u,
  );
  await assert.rejects(
    createNativeCreatePlan({
      cwd: creationRoot,
      projectName: "../escape",
      dependencies: { reactNativeCommunityCli: "/fixture/rnc-cli.js" },
    }),
    /project name must be/u,
  );
  await assert.rejects(
    createNativeCreatePlan({
      cwd: creationRoot,
      packageName: "Not a bundle id",
      projectName: "DemoApp",
      dependencies: { reactNativeCommunityCli: "/fixture/rnc-cli.js" },
    }),
    /reverse-DNS identifier/u,
  );
});

test("replaces the upstream React root with an inspectable Solid Native shell", async (t) => {
  const root = await temporaryProject(t);
  const project = path.join(root, "DemoApp");
  await writeGeneratedReactNativeProject(project);
  const plan = {
    schemaVersion: 0,
    operation: "create",
    projectName: "DemoApp",
    packageName: "dev.solidnative.demo",
    title: 'Solid </Text>{"owned"}',
    targetDirectory: project,
    packageManager: "pnpm@9.15.0",
    projectRoot: root,
    command: process.execPath,
    args: [],
  };

  await applyNativeCreateTemplate(plan);
  const manifest = JSON.parse(
    await readFile(path.join(project, "package.json"), "utf8"),
  );
  assert.equal(manifest.name, "demo-app");
  assert.equal(manifest.packageManager, "pnpm@9.15.0");
  assert.equal(manifest.dependencies["react-native"], "0.87.0");
  assert.equal(manifest.dependencies["@solid-native/accessibility"], "0.0.0");
  assert.equal(manifest.dependencies["@solid-native/animation"], "0.0.0");
  assert.equal(manifest.dependencies["@solid-native/core"], "0.0.0");
  assert.equal(manifest.dependencies["@solid-native/devtools"], "0.0.0");
  assert.equal(manifest.dependencies["@solid-native/dialogs"], "0.0.0");
  assert.equal(manifest.dependencies["@solid-native/fabric-host"], "0.0.0");
  assert.equal(manifest.dependencies["@solid-native/networking"], "0.0.0");
  assert.equal(manifest.dependencies["@solid-native/observability"], "0.0.0");
  assert.equal(manifest.dependencies["@solid-native/sharing"], "0.0.0");
  assert.equal(
    manifest.dependencies["react-native-safe-area-context"],
    "5.8.1",
  );
  assert.equal(manifest.dependencies["solid-js"], "2.0.0-rc.3");
  assert.equal(
    manifest.devDependencies["@react-native/gradle-plugin"],
    "0.87.0",
  );
  assert.equal(manifest.devDependencies["@react-native/codegen"], "0.87.0");
  assert.equal(manifest.devDependencies["hermes-compiler"], "250829098.0.16");
  assert.equal(manifest.devDependencies["@solid-native/testing"], "0.0.0");
  assert.equal(manifest.devDependencies["@types/node"], "^22.10.0");
  assert.equal(
    manifest.dependencies["@react-native/new-app-screen"],
    undefined,
  );
  assert.equal(manifest.scripts.test, "solid-native test");
  assert.equal(manifest.scripts["build:android"], "solid-native build android");
  assert.equal(manifest.scripts["build:ios"], "solid-native build ios");
  assert.equal(
    manifest.scripts["bundle:android"],
    "solid-native bundle android",
  );
  assert.equal(manifest.scripts["bundle:ios"], "solid-native bundle ios");
  assert.equal(manifest.scripts.fingerprint, "solid-native fingerprint");
  assert.equal(manifest.scripts.release, "solid-native release");
  assert.equal(manifest.scripts.start, "solid-native start");
  assert.deepEqual(manifest.codegenConfig, {
    name: "SolidNativeAppSpec",
    type: "modules",
    jsSrcsDir: "specs",
    android: { javaPackageName: "dev.solidnative.runtime" },
    ios: {
      modulesProvider: {
        SolidNativeDebug: "SolidNativeDebugModule",
      },
    },
  });

  const [
    main,
    app,
    appTest,
    tsconfig,
    gitIgnore,
    appBuild,
    mainApplication,
    mainActivity,
    podfile,
    delegate,
    infoPlist,
    cmake,
    debugSpec,
    platformSpec,
    readme,
  ] = await Promise.all([
    readFile(path.join(project, "src", "main.tsx"), "utf8"),
    readFile(path.join(project, "src", "App.tsx"), "utf8"),
    readFile(path.join(project, "test", "App.test.tsx"), "utf8"),
    readFile(path.join(project, "tsconfig.json"), "utf8").then(JSON.parse),
    readFile(path.join(project, ".gitignore"), "utf8"),
    readFile(path.join(project, "android", "app", "build.gradle"), "utf8"),
    readFile(
      path.join(
        project,
        "android/app/src/main/java/dev/solidnative/demo/MainApplication.kt",
      ),
      "utf8",
    ),
    readFile(
      path.join(
        project,
        "android/app/src/main/java/dev/solidnative/demo/MainActivity.kt",
      ),
      "utf8",
    ),
    readFile(path.join(project, "ios", "Podfile"), "utf8"),
    readFile(path.join(project, "ios", "DemoApp", "AppDelegate.swift"), "utf8"),
    readFile(path.join(project, "ios", "DemoApp", "Info.plist"), "utf8"),
    readFile(
      path.join(project, "android/app/src/main/jni/CMakeLists.txt"),
      "utf8",
    ),
    readFile(path.join(project, "specs", "NativeSolidNativeDebug.ts"), "utf8"),
    readFile(
      path.join(project, "specs", "NativeSolidNativePlatformAndroid.ts"),
      "utf8",
    ),
    readFile(path.join(project, "README.md"), "utf8"),
  ]);
  assert.match(main, /startNativeApplication/u);
  assert.doesNotMatch(main, /installReactNativeFatalErrorHandler/u);
  assert.match(main, /causalTimeline=\{causalTimeline\}/u);
  assert.match(main, /DevelopmentRoot/u);
  assert.match(main, /createInspectableNetworkService/u);
  assert.match(main, /networkInspector=\{network\.inspector\}/u);
  assert.match(main, /<App network=\{network\.service\}/u);
  assert.match(main, /createReactNativeCausalDebugTransport/u);
  assert.match(main, /createDevelopmentSolidDiagnosticsController/u);
  assert.match(
    main,
    /const solidDiagnostics =[\s\S]*createDevelopmentSolidDiagnosticsController\(\)[\s\S]*createReactNativeCausalDebugTransport\(causalTimeline,[\s\S]*solidDiagnostics,[\s\S]*solidDiagnostics=\{solidDiagnostics\}/u,
  );
  assert.match(main, /__DEV__/u);
  assert.match(
    readme,
    /Release bundles resolve the same import to a pass-through root/u,
  );
  assert.match(readme, /First run and first edit/u);
  assert.match(readme, /Edit `src\/App\.tsx`/u);
  assert.match(
    readme,
    /--device CORE_DEVICE_ID[\s\S]*checks CoreDevice before[\s\S]*Xcode/u,
  );
  assert.match(
    readme,
    /outputs\/bundle\/release\/app-release\.aab[\s\S]*build:android[\s\S]*bundle[\s\S]*--tasks assembleRelease/u,
  );
  assert.match(
    readme,
    /development-signed and must not be uploaded to Play[\s\S]*Never commit the[\s\S]*keystore or its credentials/u,
  );
  assert.match(readme, /doctor --platform android --strict/u);
  assert.match(
    readme,
    /release -- create[\s\S]*--android-upload-certificate-sha256/u,
  );
  assert.doesNotMatch(readme, /outputs\/apk\/release\/app-release\.apk/u);
  assert.match(readme, /pnpm run doctor[\s\S]*pnpm check/u);
  assert.match(readme, /pnpm start[\s\S]*pnpm android/u);
  assert.match(
    readme,
    /capture-android dev\.solidnative\.demo --serial DEVICE_SERIAL/u,
  );
  assert.match(
    readme,
    /diagnostics-android dev\.solidnative\.demo --serial DEVICE_SERIAL/u,
  );
  assert.match(
    readme,
    /capture-ios dev\.solidnative\.demo --device CORE_DEVICE_ID/u,
  );
  assert.match(
    readme,
    /diagnostics-ios dev\.solidnative\.demo --device CORE_DEVICE_ID/u,
  );
  assert.match(
    readme,
    /report-android dev\.solidnative\.demo --serial DEVICE_SERIAL/u,
  );
  assert.match(
    readme,
    /report-ios dev\.solidnative\.demo --device CORE_DEVICE_ID/u,
  );
  assert.match(readme, /debug diagnostics-inspect solid-diagnostics\.json/u);
  assert.match(
    debugSpec,
    /NativeDebugRequest[\s\S]*operation: string[\s\S]*sessionId\?: string[\s\S]*TurboModuleRegistry\.getEnforcing<Spec>\("SolidNativeDebug"\)/u,
  );
  assert.match(
    platformSpec,
    /onMemoryWarning[\s\S]*TurboModuleRegistry\.getEnforcing<Spec>\([\s\S]*"SolidNativePlatformAndroid"/u,
  );
  assert.match(app, /Solid owns this native Fabric tree directly/u);
  assert.match(
    app,
    /import \{ Button, StyleSheet, Text, View \} from "@solid-native\/core"/u,
  );
  assert.match(app, /const styles = StyleSheet\.create\(/u);
  assert.doesNotMatch(app, /StyleSheet[^\n]*from "react-native"/u);
  assert.match(app, /<Button/u);
  assert.doesNotMatch(app, /<Pressable/u);
  assert.match(appTest, /captureNativeDiagnostics/u);
  assert.match(appTest, /expectRerunBudget/u);
  assert.match(appTest, /expectNativeCommitBudget/u);
  assert.match(appTest, /commitCheckpoint/u);
  assert.match(appTest, /getMutation/u);
  assert.match(appTest, /Press count: 1/u);
  assert.match(appTest, /findByText/u);
  assert.match(appTest, /Native chunk 1: 12 characters/u);
  assert.match(appTest, /cancellationCount/u);
  assert.match(appTest, /\.\.\/src\/App\.tsx/u);
  assert.equal(tsconfig.compilerOptions.allowImportingTsExtensions, true);
  assert.deepEqual(tsconfig.compilerOptions.types, ["react-native", "node"]);
  assert.ok(tsconfig.include.includes("test/**/*.tsx"));
  assert.match(app, /createNativeViewAnimation/u);
  assert.match(app, /createNetworkController/u);
  assert.match(app, /Check native network/u);
  assert.match(app, /maxResponseCharacters: 131_072/u);
  assert.match(app, /\{"Press count: " \+ String\(count\(\)\)\}/u);
  assert.doesNotMatch(app, /Press count:\s*\{count\(\)\}/u);
  assert.match(app, /ref=\{cardAnimation\.ref\}/u);
  assert.match(app, /cardAnimation\.animate/u);
  assert.match(gitIgnore, /^\/build\/solid-native-codegen\/$/mu);
  assert.match(app, /\{"Solid <\/Text>\{\\"owned\\"\}"\}/u);
  assert.doesNotMatch(app, />\s*Solid <\/Text>/u);
  assert.match(appBuild, /@solid-native\/fabric-host\/android-gradle/u);
  assert.match(appBuild, /src\/main\/jni\/CMakeLists\.txt/u);
  assert.match(
    mainApplication,
    /bindingsInstaller = solidNativeBindingsInstaller/u,
  );
  assert.match(
    mainApplication,
    /onTrimMemory\(level: Int\)[\s\S]*SolidNativeMemoryWarning\.handleTrimMemory\(level\)[\s\S]*onLowMemory\(\)[\s\S]*SolidNativeMemoryWarning\.handleLowMemory\(\)/u,
  );
  assert.match(mainActivity, /SolidNativeSurface\.start/u);
  assert.match(mainActivity, /SolidNativeStartupFailureView\.show/u);
  assert.match(mainActivity, /surface-start-failed/u);
  assert.match(mainActivity, /surface-publish-failed/u);
  assert.match(
    mainActivity,
    /onConfigurationChanged\(newConfig: Configuration\)[\s\S]*reactHost\.onConfigurationChanged\(this\)/u,
  );
  assert.match(podfile, /@solid-native\/fabric-host\/ios-podspec/u);
  assert.match(delegate, /SolidNativeFabricApplication\.start/u);
  assert.match(delegate, /SolidNativeStartupFailureView\.show/u);
  assert.match(delegate, /status\.hasSuffix\("-failed"\)/u);
  assert.doesNotMatch(infoPlist, /NSLocationWhenInUseUsageDescription/u);
  assert.match(
    infoPlist,
    /<key>UIViewControllerBasedStatusBarAppearance<\/key>\s*<false\/>/u,
  );
  assert.match(cmake, /SOLID_NATIVE_CCACHE_STATUS/u);
  assert.match(cmake, /solid_native_configure_android_target/u);
  await assert.rejects(readFile(path.join(project, "App.tsx")), /ENOENT/u);
  await assert.rejects(
    readFile(path.join(project, "__tests__", "App.test.tsx")),
    /ENOENT/u,
  );

  await Promise.all([
    installSolidNativePair(project),
    installSolidNativeMetro(project),
    writeFile(path.join(project, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n"),
  ]);
  const report = await runDoctor({
    cwd: project,
    platform: "ios",
    dependencies: {
      hostPlatform: "darwin",
      nodeVersion: "26.3.0",
      async runCommand(command) {
        return path.basename(command) === "xcodebuild"
          ? commandResult("Xcode 26.6\nBuild version 17F113")
          : commandResult("1.16.2");
      },
    },
  });
  for (const checkId of [
    "project.solid-runtime",
    "project.native-build-toolchain",
    "project.oxc-metro",
    "project.javascript-bootstrap",
    "project.lockfile",
  ]) {
    assert.equal(
      report.checks.find((entry) => entry.id === checkId)?.status,
      "pass",
      checkId,
    );
  }
});

test("transforms before installing and preserves the package-manager exit code", async (t) => {
  const root = await temporaryProject(t);
  const target = path.join(root, "ExecutedApp");
  const plan = await createNativeCreatePlan({
    cwd: root,
    directory: target,
    packageName: "dev.solidnative.executed",
    projectName: "ExecutedApp",
    dependencies: {
      reactNativeCommunityCli: path.join(root, "rnc-cli.js"),
    },
  });
  const calls = [];
  const exitCode = await executeNativeCreatePlan(plan, {
    env: { SOLID_NATIVE_CREATE_TEST: "1" },
    async executor(command, context) {
      calls.push({ command, context });
      if (calls.length === 1) {
        await writeGeneratedReactNativeProject(target, {
          packageName: "dev.solidnative.executed",
          projectName: "ExecutedApp",
        });
        return 0;
      }
      assert.match(
        await readFile(path.join(target, "src", "main.tsx"), "utf8"),
        /startNativeApplication/u,
      );
      return 17;
    },
  });

  assert.equal(exitCode, 17);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].command.projectRoot, root);
  assert.equal(calls[0].context.output, "quiet-on-success");
  assert.equal(calls[1].command.projectRoot, target);
  assert.equal(calls[1].command.command, "pnpm");
  assert.equal(calls[1].context.env.SOLID_NATIVE_CREATE_TEST, "1");
  assert.equal(calls[1].context.output, "inherit");
});

test("refuses template drift before rewriting generated files", async (t) => {
  const root = await temporaryProject(t);
  const project = path.join(root, "DriftedApp");
  await writeGeneratedReactNativeProject(project, {
    packageName: "dev.solidnative.drifted",
    projectName: "DriftedApp",
  });
  const manifestPath = path.join(project, "package.json");
  const manifestBefore = await readFile(manifestPath, "utf8");
  await writeFile(
    path.join(project, "android", "app", "build.gradle"),
    'apply plugin: "com.android.application"\n',
  );

  await assert.rejects(
    applyNativeCreateTemplate({
      schemaVersion: 0,
      operation: "create",
      projectName: "DriftedApp",
      packageName: "dev.solidnative.drifted",
      title: "Drifted",
      targetDirectory: project,
      packageManager: "pnpm@9.15.0",
      projectRoot: root,
      command: process.execPath,
      args: [],
    }),
    /template changed android\/app\/build.gradle/u,
  );
  assert.equal(await readFile(manifestPath, "utf8"), manifestBefore);
});

test("removes only its new upstream scaffold when conversion fails", async (t) => {
  const root = await temporaryProject(t);
  const target = path.join(root, "DriftedCreate");
  const plan = await createNativeCreatePlan({
    cwd: root,
    directory: target,
    packageName: "dev.solidnative.driftedcreate",
    projectName: "DriftedCreate",
    skipInstall: true,
    dependencies: {
      reactNativeCommunityCli: path.join(root, "rnc-cli.js"),
    },
  });

  await assert.rejects(
    executeNativeCreatePlan(plan, {
      async executor() {
        await writeGeneratedReactNativeProject(target, {
          packageName: "dev.solidnative.driftedcreate",
          projectName: "DriftedCreate",
        });
        await writeFile(
          path.join(target, "android", "app", "build.gradle"),
          'apply plugin: "com.android.application"\n',
        );
        return 0;
      },
    }),
    /template changed android\/app\/build\.gradle/u,
  );
  await assert.rejects(readFile(path.join(target, "package.json")), /ENOENT/u);
});

test("removes a partial new scaffold after the upstream command fails", async (t) => {
  const root = await temporaryProject(t);
  const target = path.join(root, "PartialCreate");
  const plan = await createNativeCreatePlan({
    cwd: root,
    directory: target,
    projectName: "PartialCreate",
    skipInstall: true,
    dependencies: {
      reactNativeCommunityCli: path.join(root, "rnc-cli.js"),
    },
  });

  const exitCode = await executeNativeCreatePlan(plan, {
    async executor() {
      await mkdir(target);
      await writeFile(path.join(target, "partial.txt"), "partial\n");
      return 19;
    },
  });

  assert.equal(exitCode, 19);
  await assert.rejects(readFile(path.join(target, "partial.txt")), /ENOENT/u);
});

test("rechecks create ownership immediately before scaffolding", async (t) => {
  const root = await temporaryProject(t);
  const target = path.join(root, "ClaimedCreate");
  const plan = await createNativeCreatePlan({
    cwd: root,
    directory: target,
    projectName: "ClaimedCreate",
    skipInstall: true,
    dependencies: {
      reactNativeCommunityCli: path.join(root, "rnc-cli.js"),
    },
  });
  await mkdir(target);
  let executed = false;

  await assert.rejects(
    executeNativeCreatePlan(plan, {
      async executor() {
        executed = true;
        return 0;
      },
    }),
    /Refusing to replace the existing create target/u,
  );
  assert.equal(executed, false);
});

test("prints a machine-readable create plan without touching the target", async (t) => {
  const root = await temporaryProject(t);
  const target = path.join(root, "GeneratedDemo");
  const bin = new URL("../dist/bin.js", import.meta.url);
  const { stdout } = await execFileAsync(process.execPath, [
    bin.pathname,
    "create",
    "GeneratedDemo",
    "--directory",
    target,
    "--package-name",
    "dev.example.generated",
    "--skip-install",
    "--dry-run",
    "--json",
  ]);
  const plan = JSON.parse(stdout);
  assert.equal(plan.operation, "create");
  assert.equal(plan.targetDirectory, target);
  assert.equal(plan.packageName, "dev.example.generated");
  await assert.rejects(readFile(path.join(target, "package.json")), /ENOENT/u);
});

test("uses distinct exit codes for failed diagnostics and invalid input", async (t) => {
  const directory = await temporaryProject(t);
  const bin = new URL("../dist/bin.js", import.meta.url);
  await assert.rejects(
    execFileAsync(process.execPath, [
      bin.pathname,
      "doctor",
      "--cwd",
      directory,
      "--json",
    ]),
    (error) => {
      assert.equal(error.code, 1);
      const report = JSON.parse(error.stdout);
      assert.equal(report.ok, false);
      assert.equal(report.checks[1]?.id, "project.manifest");
      return true;
    },
  );
  await assert.rejects(
    execFileAsync(process.execPath, [bin.pathname, "doctor", "--wat"]),
    (error) => {
      assert.equal(error.code, 2);
      assert.match(error.stderr, /Unknown doctor option --wat/u);
      return true;
    },
  );
});

test("strict doctor turns warnings into a CI failure without changing its report", async (t) => {
  const directory = await temporaryProject(t);
  const bin = new URL("../dist/bin.js", import.meta.url);
  await writeFile(
    path.join(directory, "package.json"),
    JSON.stringify({ name: "warning-only-fixture" }),
  );
  await writeFile(
    path.join(directory, "pnpm-workspace.yaml"),
    "packages: []\n",
  );

  const ordinary = await execFileAsync(process.execPath, [
    bin.pathname,
    "doctor",
    "--cwd",
    directory,
    "--json",
  ]);
  const ordinaryReport = JSON.parse(ordinary.stdout);
  assert.equal(ordinaryReport.ok, true);
  assert.equal(ordinaryReport.summary.warn, 1);
  assert.equal(ordinaryReport.summary.fail, 0);

  await assert.rejects(
    execFileAsync(process.execPath, [
      bin.pathname,
      "doctor",
      "--cwd",
      directory,
      "--strict",
      "--json",
    ]),
    (error) => {
      assert.equal(error.code, 1);
      assert.deepEqual(JSON.parse(error.stdout), ordinaryReport);
      assert.equal(error.stderr, "");
      return true;
    },
  );
});

test("builds non-launching Release plans through the pinned native CLI", async (t) => {
  const project = await temporaryProject(t);
  const cli = path.join(project, "node_modules", "react-native", "cli.js");
  const sdk = path.join(project, "android-sdk");
  await Promise.all([
    mkdir(path.dirname(cli), { recursive: true }),
    mkdir(path.join(project, "ios"), { recursive: true }),
    mkdir(path.join(project, "android"), { recursive: true }),
    mkdir(sdk, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(project, "package.json"),
      JSON.stringify({
        dependencies: verifiedApplicationDependencies,
        devDependencies: verifiedApplicationDevDependencies,
      }),
    ),
    writeFile(cli, ""),
  ]);
  await Promise.all([
    installSolidNativePair(project),
    installVerifiedJavaScriptApplication(project),
    installReactNativeHermesPair(project),
  ]);

  const ios = await createNativeBuildPlan({ cwd: project, platform: "ios" });
  const android = await createNativeBuildPlan({
    cwd: project,
    platform: "android",
    forwardedArgs: ["--tasks", "bundleRelease", "--extra-params=-Pci=true"],
    env: { ANDROID_HOME: sdk },
  });
  assert.deepEqual(ios.args, [cli, "build-ios", "--mode", "Release"]);
  assert.deepEqual(android.args, [
    cli,
    "build-android",
    "--tasks",
    "bundleRelease",
    "--extra-params=-Pci=true",
  ]);
  assert.equal(android.operation, "build");
  assert.match(formatNativeBuildPlan(ios), /build-ios --mode Release/u);

  let executionEnvironment;
  const exitCode = await executeNativeBuildPlan(android, {
    env: { SOLID_NATIVE_BUILD_TEST: "1" },
    async executor(_plan, context) {
      executionEnvironment = context.env;
      return 19;
    },
  });
  assert.equal(exitCode, 19);
  assert.equal(executionEnvironment.SOLID_NATIVE_BUILD_TEST, "1");
});

test("prints a machine-readable local Release build plan", async () => {
  const bin = new URL("../dist/bin.js", import.meta.url);
  const { stdout } = await execFileAsync(process.execPath, [
    bin.pathname,
    "build",
    "android",
    "--cwd",
    path.resolve("../../apps/native-e2e"),
    "--dry-run",
    "--json",
  ]);
  const plan = JSON.parse(stdout);
  assert.equal(plan.operation, "build");
  assert.equal(plan.platform, "android");
  assert.deepEqual(plan.args.slice(-3), ["build-android", "--mode", "Release"]);
});

test("builds and canonicalizes an inspectable production bundle", async (t) => {
  const project = await temporaryProject(t);
  const cli = path.join(project, "node_modules", "react-native", "cli.js");
  await Promise.all([
    mkdir(path.dirname(cli), { recursive: true }),
    mkdir(path.join(project, "android"), { recursive: true }),
    mkdir(path.join(project, "ios"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(project, "package.json"),
      JSON.stringify({
        dependencies: verifiedApplicationDependencies,
        devDependencies: verifiedApplicationDevDependencies,
      }),
    ),
    writeFile(path.join(project, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n"),
    writeFile(cli, ""),
  ]);
  await Promise.all([
    installSolidNativePair(project),
    installVerifiedJavaScriptApplication(project),
    installReactNativeHermesPair(project),
  ]);

  const plan = await createNativeBundlePlan({
    cwd: project,
    platform: "android",
    outputDirectory: "release artifacts",
    forwardedArgs: ["--max-workers", "2"],
  });
  assert.equal(plan.operation, "bundle");
  assert.equal(plan.sourceRoot, project);
  assert.equal(plan.entryPoint, "index.tsx");
  assert.equal(
    plan.bundlePath,
    path.join(project, "release artifacts", "index.android.bundle"),
  );
  assert.deepEqual(plan.args.slice(-2), ["--max-workers", "2"]);
  assert.match(formatNativeBundlePlan(plan), /--dev false --minify true/u);
  assert.equal(plan.minified, true);
  assert.equal(plan.hermesSource, false);

  const hermesSourcePlan = await createNativeBundlePlan({
    cwd: project,
    platform: "android",
    outputDirectory: "hermes source",
    hermesSource: true,
  });
  assert.equal(hermesSourcePlan.minified, false);
  assert.equal(hermesSourcePlan.hermesSource, true);
  assert.equal(
    hermesSourcePlan.sourceMapPath,
    path.join(project, "hermes source", "index.android.bundle.packager.map"),
  );
  assert.match(
    formatNativeBundlePlan(hermesSourcePlan),
    /--dev false --minify false/u,
  );
  const iosHermesSourcePlan = await createNativeBundlePlan({
    cwd: project,
    platform: "ios",
    outputDirectory: "ios hermes source",
    hermesSource: true,
  });
  assert.equal(iosHermesSourcePlan.minified, false);
  assert.equal(iosHermesSourcePlan.hermesSource, true);
  assert.equal(
    iosHermesSourcePlan.sourceMapPath,
    path.join(project, "ios hermes source", "index.ios.bundle.packager.map"),
  );

  const exitCode = await executeNativeBundlePlan(plan, {
    env: { SOLID_NATIVE_BUNDLE_TEST: "1" },
    async executor(receivedPlan, context) {
      assert.equal(receivedPlan, plan);
      assert.equal(context.env.SOLID_NATIVE_BUNDLE_TEST, "1");
      await mkdir(path.join(receivedPlan.assetsDirectory, "drawable"), {
        recursive: true,
      });
      await Promise.all([
        writeFile(receivedPlan.bundlePath, "globalThis.__bundle = true;\n"),
        writeFile(path.join(receivedPlan.assetsDirectory, "Z.bin"), "upper"),
        writeFile(path.join(receivedPlan.assetsDirectory, "a.bin"), "lower"),
        writeFile(path.join(receivedPlan.assetsDirectory, "ä.bin"), "umlaut"),
        writeFile(
          path.join(receivedPlan.assetsDirectory, "drawable", "icon.bin"),
          "asset",
        ),
        writeFile(
          receivedPlan.sourceMapPath,
          JSON.stringify({
            version: 3,
            sections: [
              {
                offset: { line: 0, column: 0 },
                map: {
                  version: 3,
                  sources: [path.join(project, "index.tsx"), "__prelude__"],
                  sourcesContent: ["source", "prelude"],
                  names: [],
                  mappings: "",
                },
              },
            ],
          }),
        ),
      ]);
      return 0;
    },
  });
  assert.equal(exitCode, 0);
  const sourceMap = JSON.parse(await readFile(plan.sourceMapPath, "utf8"));
  assert.deepEqual(sourceMap.sections[0].map.sources, [
    "app:///index.tsx",
    "__prelude__",
  ]);
  assert.doesNotMatch(JSON.stringify(sourceMap), new RegExp(project, "u"));
  const manifest = JSON.parse(await readFile(plan.manifestPath, "utf8"));
  assert.equal(manifest.schemaVersion, 0);
  assert.equal(manifest.trust, "unsigned");
  assert.equal(manifest.minified, true);
  assert.equal(manifest.entryPoint, "index.tsx");
  assert.match(manifest.bundleFingerprint, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(manifest.artifacts.bundle.bytes, 28);
  assert.deepEqual(
    manifest.artifacts.assets.map((artifact) => artifact.path),
    [
      "assets/Z.bin",
      "assets/a.bin",
      "assets/drawable/icon.bin",
      "assets/ä.bin",
    ],
  );
  assert.ok(
    [
      manifest.artifacts.bundle,
      manifest.artifacts.sourceMap,
      ...manifest.artifacts.assets,
    ].every((artifact) => /^[a-f0-9]{64}$/u.test(artifact.sha256)),
  );
  const verification = await verifyNativeBundleManifest(plan.manifestPath);
  assert.equal(verification.ok, true);
  assert.deepEqual(
    verification.checks.map((check) => [check.id, check.status]),
    [
      ["fingerprint", "pass"],
      ["bundle", "pass"],
      ["source-map", "pass"],
      ["assets", "pass"],
    ],
  );
  assert.match(
    formatNativeBundleVerification(verification),
    /Integrity only: this manifest remains unsigned/u,
  );
  const bin = new URL("../dist/bin.js", import.meta.url);
  const { stdout: verificationOutput } = await execFileAsync(process.execPath, [
    bin.pathname,
    "bundle",
    "verify",
    plan.manifestPath,
    "--json",
  ]);
  assert.equal(JSON.parse(verificationOutput).ok, true);
  const repeatedManifest = await writeNativeBundleManifest(plan);
  assert.deepEqual(repeatedManifest, manifest);
  await writeFile(plan.bundlePath, "globalThis.__bundle = 'changed';\n");
  const tamperedBundle = await verifyNativeBundleManifest(plan.manifestPath);
  assert.equal(tamperedBundle.ok, false);
  assert.equal(
    tamperedBundle.checks.find((check) => check.id === "bundle").status,
    "fail",
  );
  const changedManifest = await writeNativeBundleManifest(plan);
  assert.notEqual(
    changedManifest.bundleFingerprint,
    manifest.bundleFingerprint,
  );
  await assert.rejects(
    writeNativeBundleManifest({ ...plan, entryPoint: "../outside.tsx" }),
    /project-relative path/u,
  );
  await writeFile(
    path.join(plan.assetsDirectory, "drawable", "icon.bin"),
    "tampered asset",
  );
  const tamperedAsset = await verifyNativeBundleManifest(plan.manifestPath);
  assert.equal(tamperedAsset.ok, false);
  assert.equal(
    tamperedAsset.checks.find((check) => check.id === "assets").status,
    "fail",
  );
  await writeNativeBundleManifest(plan);
  await writeFile(path.join(plan.assetsDirectory, "stale.bin"), "stale");
  const staleAsset = await verifyNativeBundleManifest(plan.manifestPath);
  assert.equal(staleAsset.ok, false);
  assert.equal(
    staleAsset.checks.find((check) => check.id === "assets").status,
    "fail",
  );
  await assert.rejects(
    execFileAsync(process.execPath, [
      bin.pathname,
      "bundle",
      "verify",
      plan.manifestPath,
      "--json",
    ]),
    (error) => error.code === 1 && JSON.parse(error.stdout).ok === false,
  );

  await assert.rejects(
    createNativeBundlePlan({
      cwd: project,
      platform: "android",
      forwardedArgs: ["--config", "other.config.js"],
    }),
    /--config is owned by solid-native bundle/u,
  );
});

test("rejects source-map identities outside the reviewed workspace", async (t) => {
  const project = await temporaryProject(t);
  const sourceMap = path.join(project, "bundle.map");
  await writeFile(
    sourceMap,
    JSON.stringify({
      version: 3,
      sources: [path.join(path.dirname(project), "outside.ts")],
      sourcesContent: ["outside"],
      names: [],
      mappings: "",
    }),
  );
  await assert.rejects(
    canonicalizeNativeSourceMap(sourceMap, project),
    /escapes the reviewed source root/u,
  );
});

test("enforces reusable production source-map policies", async (t) => {
  const project = await temporaryProject(t);
  const sourceMap = path.join(project, "build", "bundle.map");
  const requiredSources = [
    "app:///src/adapters/RNAsyncStorage.ts",
    "app:///src/generated/SolidNativeBindings.ts",
    "app:///packages/storage/async-storage-3.js",
  ];
  const forbiddenFragment =
    "/node_modules/@react-native-async-storage/async-storage/";
  await mkdir(path.dirname(sourceMap), { recursive: true });
  await Promise.all([
    writeFile(
      path.join(project, "package.json"),
      JSON.stringify({ name: "source-map-policy-fixture" }),
    ),
    writeFile(path.join(project, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n"),
  ]);
  const writeMap = async (sources) =>
    writeFile(
      sourceMap,
      JSON.stringify({
        version: 3,
        sources: sources.map((source) => path.join(project, source)),
        sourcesContent: sources.map(() => "source"),
        names: [],
        mappings: "",
      }),
    );
  await writeMap([
    "src/adapters/RNAsyncStorage.ts",
    "src/generated/SolidNativeBindings.ts",
    "packages/storage/async-storage-3.js",
    "node_modules/@react-native-async-storage/async-storage/src/index.ts",
  ]);

  const failed = await checkNativeBundleSources({
    cwd: project,
    forbiddenSourceFragments: [forbiddenFragment],
    requiredSources,
    sourceMapPath: sourceMap,
  });
  assert.equal(failed.ok, false);
  assert.deepEqual(
    failed.checks.map((check) => [check.kind, check.status, check.matches]),
    [
      ["required-source", "pass", 1],
      ["required-source", "pass", 1],
      ["required-source", "pass", 1],
      ["forbidden-fragment", "fail", 1],
    ],
  );
  assert.match(
    formatNativeSourceMapPolicyReport(failed),
    /FAIL source-map policy/u,
  );

  await writeMap([
    "src/adapters/RNAsyncStorage.ts",
    "src/generated/SolidNativeBindings.ts",
    "packages/storage/async-storage-3.js",
  ]);
  const passed = await checkNativeBundleSources({
    cwd: project,
    forbiddenSourceFragments: [forbiddenFragment],
    requiredSources,
    sourceMapPath: sourceMap,
  });
  assert.equal(passed.ok, true);
  assert.equal(passed.sourceCount, 3);
  assert.equal(Object.isFrozen(passed), true);
  assert.equal(Object.isFrozen(passed.checks), true);

  const bin = new URL("../dist/bin.js", import.meta.url);
  const { stdout } = await execFileAsync(process.execPath, [
    bin.pathname,
    "bundle",
    "sources",
    sourceMap,
    "--cwd",
    project,
    ...requiredSources.flatMap((source) => ["--require", source]),
    "--forbid-containing",
    forbiddenFragment,
    "--json",
  ]);
  assert.equal(JSON.parse(stdout).ok, true);

  await writeMap([
    "src/adapters/RNAsyncStorage.ts",
    "src/adapters/RNAsyncStorage.ts",
    "src/generated/SolidNativeBindings.ts",
    "packages/storage/async-storage-3.js",
  ]);
  await assert.rejects(
    execFileAsync(process.execPath, [
      bin.pathname,
      "bundle",
      "sources",
      sourceMap,
      "--cwd",
      project,
      ...requiredSources.flatMap((source) => ["--require", source]),
      "--json",
    ]),
    (error) =>
      error.code === 1 && JSON.parse(error.stdout).checks[0].matches === 2,
  );
  await assert.rejects(
    checkNativeBundleSources({ cwd: project, sourceMapPath: sourceMap }),
    /requires at least one required source or forbidden fragment/u,
  );
  await assert.rejects(
    checkNativeBundleSources({
      cwd: project,
      requiredSources: [requiredSources[0], requiredSources[0]],
      sourceMapPath: sourceMap,
    }),
    /cannot contain duplicate entries/u,
  );
});

test("requires bounded portable symbolication-ready source maps", async (t) => {
  const project = await temporaryProject(t);
  const sourceMap = path.join(project, "bundle.map");
  const validMap = {
    version: 3,
    file: path.join(project, "generated", "index.android.bundle"),
    sourceRoot: project,
    sources: ["src/App.tsx"],
    sourcesContent: ["export const App = () => null;"],
    names: ["App"],
    mappings: "AAAA",
    x_google_ignoreList: [0],
  };
  await writeFile(sourceMap, JSON.stringify(validMap));
  await assert.rejects(
    validateCanonicalNativeSourceMap(sourceMap),
    /file identity is not canonical and portable/u,
  );
  assert.equal(await canonicalizeNativeSourceMap(sourceMap, project), 1);
  const canonical = JSON.parse(await readFile(sourceMap, "utf8"));
  assert.equal(canonical.file, "index.android.bundle");
  assert.equal(canonical.sourceRoot, undefined);
  assert.deepEqual(canonical.sources, ["app:///src/App.tsx"]);
  const canonicalBytes = await readFile(sourceMap, "utf8");
  assert.equal(await validateCanonicalNativeSourceMap(sourceMap), 1);
  assert.equal(await readFile(sourceMap, "utf8"), canonicalBytes);

  for (const [name, value, pattern] of [
    [
      "missing source content",
      { ...validMap, sourceRoot: undefined, sourcesContent: undefined },
      /embed one source-content string/u,
    ],
    [
      "nullable source content",
      { ...validMap, sourceRoot: undefined, sourcesContent: [null] },
      /embed one source-content string/u,
    ],
    [
      "invalid names",
      { ...validMap, sourceRoot: undefined, names: [1] },
      /invalid names array/u,
    ],
    [
      "invalid mappings",
      { ...validMap, sourceRoot: undefined, mappings: "AAAA=" },
      /invalid VLQ mappings/u,
    ],
    [
      "truncated VLQ mappings",
      { ...validMap, sourceRoot: undefined, mappings: "g" },
      /invalid VLQ mappings/u,
    ],
    [
      "out-of-range VLQ source",
      { ...validMap, sourceRoot: undefined, mappings: "ACAA" },
      /invalid VLQ mappings/u,
    ],
    [
      "invalid ignore list",
      { ...validMap, sourceRoot: undefined, x_google_ignoreList: [1] },
      /invalid x_google_ignoreList/u,
    ],
    [
      "path traversal",
      {
        ...validMap,
        sourceRoot: undefined,
        sources: ["../outside.ts"],
      },
      /escapes its portable source root/u,
    ],
    [
      "relative source root",
      { ...validMap, sourceRoot: "src" },
      /sourceRoot must be an absolute path/u,
    ],
    [
      "mixed indexed map",
      {
        version: 3,
        sources: ["app:///index.tsx"],
        sections: [],
      },
      /exactly one of sources or sections/u,
    ],
    [
      "duplicate section offsets",
      {
        version: 3,
        sections: [
          { offset: { line: 0, column: 0 }, map: validMap },
          { offset: { line: 0, column: 0 }, map: validMap },
        ],
      },
      /strictly increasing/u,
    ],
    [
      "remote section",
      {
        version: 3,
        sections: [{ offset: { line: 0, column: 0 }, url: "remote.map" }],
      },
      /one inline map/u,
    ],
  ]) {
    await writeFile(sourceMap, JSON.stringify(value));
    await assert.rejects(
      canonicalizeNativeSourceMap(sourceMap, project),
      pattern,
      name,
    );
  }

  let nested = { ...validMap, sourceRoot: undefined };
  for (let depth = 0; depth < 10; depth += 1) {
    nested = {
      version: 3,
      sections: [{ offset: { line: 0, column: 0 }, map: nested }],
    };
  }
  await writeFile(sourceMap, JSON.stringify(nested));
  await assert.rejects(
    canonicalizeNativeSourceMap(sourceMap, project),
    /nesting limit/u,
  );
});

test("rejects a digest-matching bundle manifest with an unusable source map", async (t) => {
  const outputDirectory = await temporaryProject(t);
  const assetsDirectory = path.join(outputDirectory, "assets");
  const bundlePath = path.join(outputDirectory, "index.android.bundle");
  const sourceMapPath = `${bundlePath}.map`;
  const manifestPath = path.join(outputDirectory, "solid-native-bundle.json");
  const bundleContents = "globalThis.__bundle = true;\n";
  const sourceMapContents = JSON.stringify({
    version: 3,
    sources: ["app:///index.tsx"],
    names: [],
    mappings: "AAAA",
  });
  await mkdir(assetsDirectory);
  await Promise.all([
    writeFile(bundlePath, bundleContents),
    writeFile(sourceMapPath, sourceMapContents),
  ]);
  const payload = {
    schemaVersion: 0,
    algorithm: "sha256",
    trust: "unsigned",
    platform: "android",
    mode: "production",
    minified: true,
    entryPoint: "index.tsx",
    artifacts: {
      bundle: {
        path: "index.android.bundle",
        bytes: Buffer.byteLength(bundleContents),
        sha256: createHash("sha256").update(bundleContents).digest("hex"),
      },
      sourceMap: {
        path: "index.android.bundle.map",
        bytes: Buffer.byteLength(sourceMapContents),
        sha256: createHash("sha256").update(sourceMapContents).digest("hex"),
      },
      assets: [],
    },
  };
  await writeFile(
    manifestPath,
    JSON.stringify({
      ...payload,
      bundleFingerprint: `sha256:${createHash("sha256")
        .update(JSON.stringify(payload))
        .digest("hex")}`,
    }),
  );

  const verification = await verifyNativeBundleManifest(manifestPath);
  assert.equal(verification.ok, false);
  assert.deepEqual(
    verification.checks.map((check) => [check.id, check.status]),
    [
      ["fingerprint", "pass"],
      ["bundle", "pass"],
      ["source-map", "fail"],
      ["assets", "pass"],
    ],
  );
  assert.match(
    verification.checks.find((check) => check.id === "source-map").message,
    /embed one source-content string/u,
  );
  await assert.rejects(
    writeNativeBundleManifest({
      platform: "android",
      entryPoint: "index.tsx",
      outputDirectory,
      bundlePath,
      sourceMapPath,
      assetsDirectory,
      manifestPath,
    }),
    /embed one source-content string/u,
  );
});

test("prints a machine-readable production bundle plan without writing", async () => {
  const bin = new URL("../dist/bin.js", import.meta.url);
  const { stdout } = await execFileAsync(process.execPath, [
    bin.pathname,
    "bundle",
    "ios",
    "--cwd",
    path.resolve("../../apps/native-e2e"),
    "--output",
    "/tmp/solid-native-bundle-plan",
    "--dry-run",
    "--json",
  ]);
  const plan = JSON.parse(stdout);
  assert.equal(plan.operation, "bundle");
  assert.equal(plan.platform, "ios");
  assert.equal(
    plan.bundlePath,
    "/tmp/solid-native-bundle-plan/index.ios.bundle",
  );
  assert.equal(
    plan.manifestPath,
    "/tmp/solid-native-bundle-plan/solid-native-bundle.json",
  );
  const { stdout: hermesSourceOutput } = await execFileAsync(process.execPath, [
    bin.pathname,
    "bundle",
    "android",
    "--cwd",
    path.resolve("../../apps/native-e2e"),
    "--output",
    "/tmp/solid-native-hermes-source-plan",
    "--hermes-source",
    "--dry-run",
    "--json",
  ]);
  const hermesSourcePlan = JSON.parse(hermesSourceOutput);
  assert.equal(hermesSourcePlan.hermesSource, true);
  assert.equal(hermesSourcePlan.minified, false);
  assert.equal(
    hermesSourcePlan.sourceMapPath,
    "/tmp/solid-native-hermes-source-plan/index.android.bundle.packager.map",
  );
});

test("binds and verifies an unsigned release envelope", async (t) => {
  const outputDirectory = await temporaryProject(t);
  const assetsDirectory = path.join(outputDirectory, "assets");
  const bundlePath = path.join(outputDirectory, "index.android.bundle");
  const sourceMapPath = `${bundlePath}.map`;
  const bundleManifestPath = path.join(
    outputDirectory,
    "solid-native-bundle.json",
  );
  const artifactPath = path.join(outputDirectory, "app-release.apk");
  const releaseManifestPath = path.join(
    outputDirectory,
    "solid-native-release.json",
  );
  await mkdir(assetsDirectory);
  await Promise.all([
    writeFile(bundlePath, "globalThis.__release = true;\n"),
    writeFile(sourceMapPath, portableSourceMap()),
    writeFile(artifactPath, "native artifact bytes\n"),
  ]);
  await writeNativeBundleManifest({
    platform: "android",
    entryPoint: "index.tsx",
    outputDirectory,
    bundlePath,
    sourceMapPath,
    assetsDirectory,
    manifestPath: bundleManifestPath,
  });
  const cwd = path.resolve("../../apps/native-e2e");
  const sourceRevision = "ABCDEF0123456789ABCDEF0123456789ABCDEF01";
  const options = {
    cwd,
    bundleManifestPath,
    artifactPath,
    release: "1.2.3+42",
    channel: "production",
    sourceRevision,
    outputPath: releaseManifestPath,
  };
  const created = await createNativeReleaseManifest(options);
  assert.equal(created.manifestPath, releaseManifestPath);
  assert.equal(created.manifest.platform, "android");
  assert.equal(created.manifest.release, "1.2.3+42");
  assert.equal(created.manifest.sourceRevision, sourceRevision.toLowerCase());
  assert.equal(created.manifest.artifact.name, "app-release.apk");
  assert.match(
    created.manifest.nativeCompatibilityFingerprint,
    /^sha256:[a-f0-9]{64}$/u,
  );
  assert.match(created.manifest.releaseFingerprint, /^sha256:[a-f0-9]{64}$/u);
  assert.ok(!JSON.stringify(created.manifest).includes(cwd));
  assert.ok(!JSON.stringify(created.manifest).includes(outputDirectory));

  const repeated = await createNativeReleaseManifest(options);
  assert.deepEqual(repeated.manifest, created.manifest);
  if (process.platform !== "win32") {
    const realOutputDirectory = path.join(outputDirectory, "release-output");
    const linkedOutputDirectory = path.join(outputDirectory, "release-link");
    await mkdir(realOutputDirectory);
    await symlink(realOutputDirectory, linkedOutputDirectory, "dir");
    const linkedOutput = await createNativeReleaseManifest({
      ...options,
      outputPath: path.join(linkedOutputDirectory, "release.json"),
    });
    assert.equal(
      JSON.parse(await readFile(linkedOutput.manifestPath, "utf8"))
        .releaseFingerprint,
      created.manifest.releaseFingerprint,
    );
  }
  const bin = new URL("../dist/bin.js", import.meta.url);
  const cliManifestPath = path.join(outputDirectory, "cli-release.json");
  const { stdout: createOutput } = await execFileAsync(process.execPath, [
    bin.pathname,
    "release",
    "create",
    "--bundle",
    bundleManifestPath,
    "--artifact",
    artifactPath,
    "--release",
    "1.2.3+42",
    "--channel",
    "production",
    "--revision",
    sourceRevision,
    "--cwd",
    cwd,
    "--output",
    cliManifestPath,
    "--json",
  ]);
  assert.equal(
    JSON.parse(createOutput).manifest.releaseFingerprint,
    created.manifest.releaseFingerprint,
  );
  const verificationOptions = {
    cwd,
    manifestPath: releaseManifestPath,
    bundleManifestPath,
    artifactPath,
  };
  const verification = await verifyNativeReleaseManifest(verificationOptions);
  assert.equal(verification.ok, true);
  assert.deepEqual(
    verification.checks.map((entry) => [entry.id, entry.status]),
    [
      ["fingerprint", "pass"],
      ["artifact", "pass"],
      ["bundle", "pass"],
      ["native", "pass"],
    ],
  );
  assert.match(
    formatNativeReleaseVerification(verification),
    /verify a trusted signature/u,
  );
  const { stdout } = await execFileAsync(process.execPath, [
    bin.pathname,
    "release",
    "verify",
    releaseManifestPath,
    "--bundle",
    bundleManifestPath,
    "--artifact",
    artifactPath,
    "--cwd",
    cwd,
    "--json",
  ]);
  assert.equal(JSON.parse(stdout).ok, true);

  const tamperedManifest = JSON.parse(
    await readFile(releaseManifestPath, "utf8"),
  );
  tamperedManifest.channel = "staging";
  await writeFile(
    releaseManifestPath,
    `${JSON.stringify(tamperedManifest, null, 2)}\n`,
  );
  const invalidEnvelope =
    await verifyNativeReleaseManifest(verificationOptions);
  assert.equal(invalidEnvelope.ok, false);
  assert.equal(
    invalidEnvelope.checks.find((entry) => entry.id === "fingerprint").status,
    "fail",
  );
  tamperedManifest.untrustedExtension = true;
  await writeFile(
    releaseManifestPath,
    `${JSON.stringify(tamperedManifest, null, 2)}\n`,
  );
  await assert.rejects(
    verifyNativeReleaseManifest(verificationOptions),
    /release manifest has an invalid schema/u,
  );
  await createNativeReleaseManifest(options);

  await writeFile(artifactPath, "tampered native artifact\n");
  const tampered = await verifyNativeReleaseManifest(verificationOptions);
  assert.equal(tampered.ok, false);
  assert.equal(
    tampered.checks.find((entry) => entry.id === "artifact").status,
    "fail",
  );
  await assert.rejects(
    execFileAsync(process.execPath, [
      bin.pathname,
      "release",
      "verify",
      releaseManifestPath,
      "--bundle",
      bundleManifestPath,
      "--artifact",
      artifactPath,
      "--cwd",
      cwd,
      "--json",
    ]),
    (error) => {
      assert.equal(error.code, 1);
      assert.equal(JSON.parse(error.stdout).ok, false);
      return true;
    },
  );
  await assert.rejects(
    createNativeReleaseManifest({ ...options, channel: "invalid channel" }),
    /release channel has an invalid format/u,
  );
});

test(
  "links archived Android Hermes bytecode to its exact reviewed source",
  {
    skip:
      process.platform !== "darwin" &&
      !(process.platform === "linux" && process.arch === "x64"),
  },
  async (t) => {
    const outputDirectory = await temporaryProject(t);
    const assetsDirectory = path.join(outputDirectory, "assets");
    const bundlePath = path.join(outputDirectory, "index.android.bundle");
    const sourceMapPath = `${bundlePath}.packager.map`;
    const bundleManifestPath = path.join(
      outputDirectory,
      "solid-native-bundle.json",
    );
    const artifactPath = path.join(outputDirectory, "app-release.apk");
    const compiledBundlePath = path.join(outputDirectory, "compiled.hbc");
    const releaseManifestPath = path.join(
      outputDirectory,
      "solid-native-release.json",
    );
    const source =
      "globalThis.__linkedRelease = true;\n//# sourceMappingURL=index.android.bundle.packager.map\n";
    await mkdir(assetsDirectory);
    await Promise.all([
      writeFile(bundlePath, source),
      writeFile(
        sourceMapPath,
        JSON.stringify({
          version: 3,
          sources: ["app:///index.tsx"],
          sourcesContent: [source],
          names: [],
          mappings: "",
        }),
      ),
    ]);
    const manifestOptions = {
      platform: "android",
      entryPoint: "index.tsx",
      outputDirectory,
      bundlePath,
      sourceMapPath,
      assetsDirectory,
      manifestPath: bundleManifestPath,
      minified: false,
    };
    await writeNativeBundleManifest(manifestOptions);
    const compilerDirectory =
      process.platform === "darwin" ? "osx-bin" : "linux64-bin";
    const compilerPath = path.resolve(
      "../../apps/native-e2e/node_modules/hermes-compiler/hermesc",
      compilerDirectory,
      "hermesc",
    );
    await execFileAsync(compilerPath, [
      "-w",
      "-emit-binary",
      "-max-diagnostic-width=80",
      "-out",
      compiledBundlePath,
      bundlePath,
      "-O",
      "-output-source-map",
    ]);
    const compiledBundle = await readFile(compiledBundlePath);
    await writeStoredZip(artifactPath, [
      ["assets/index.android.bundle", compiledBundle],
    ]);

    const cwd = path.resolve("../../apps/native-e2e");
    const bin = new URL("../dist/bin.js", import.meta.url);
    const { stdout } = await execFileAsync(process.execPath, [
      bin.pathname,
      "release",
      "create",
      "--bundle",
      bundleManifestPath,
      "--artifact",
      artifactPath,
      "--release",
      "1.2.3+linked",
      "--channel",
      "internal",
      "--revision",
      "0123456789abcdef0123456789abcdef01234567",
      "--inspect-embedded-bundle",
      "--cwd",
      cwd,
      "--output",
      releaseManifestPath,
      "--json",
    ]);
    const created = JSON.parse(stdout).manifest;
    assert.equal(created.embeddedBundle.path, "assets/index.android.bundle");
    assert.equal(created.embeddedBundle.format, "hermes-bytecode");
    assert.equal(created.embeddedBundle.bytecodeVersion, 98);
    assert.equal(created.embeddedBundle.bytes, compiledBundle.length);
    assert.match(created.embeddedBundle.sourceSha1, /^[a-f0-9]{40}$/u);
    assert.match(created.embeddedBundle.sha256, /^[a-f0-9]{64}$/u);

    const verification = await verifyNativeReleaseManifest({
      cwd,
      manifestPath: releaseManifestPath,
      bundleManifestPath,
      artifactPath,
    });
    assert.equal(verification.ok, true);
    assert.deepEqual(
      verification.checks.map((entry) => [entry.id, entry.status]),
      [
        ["fingerprint", "pass"],
        ["artifact", "pass"],
        ["embedded-bundle", "pass"],
        ["bundle", "pass"],
        ["native", "pass"],
      ],
    );

    const linkageOptions = {
      cwd,
      bundleManifestPath,
      artifactPath,
      release: "1.2.3+linked",
      channel: "internal",
      sourceRevision: "0123456789abcdef0123456789abcdef01234567",
      inspectEmbeddedBundle: true,
      outputPath: releaseManifestPath,
    };
    await writeStoredZip64(
      artifactPath,
      "assets/index.android.bundle",
      compiledBundle,
    );
    assert.equal(
      (await createNativeReleaseManifest(linkageOptions)).manifest
        .embeddedBundle.path,
      "assets/index.android.bundle",
    );
    const validZip64 = await readFile(artifactPath);
    const centralSignature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
    const centralOffset = validZip64.indexOf(centralSignature);
    assert.notEqual(centralOffset, -1);
    const centralNameBytes = validZip64.readUInt16LE(centralOffset + 28);
    const zip64ExtraOffset = centralOffset + 46 + centralNameBytes;
    const missingEntryMetadata = Buffer.from(validZip64);
    missingEntryMetadata.writeUInt16LE(0x0002, zip64ExtraOffset);
    await writeFile(artifactPath, missingEntryMetadata);
    await assert.rejects(
      createNativeReleaseManifest(linkageOptions),
      /entry is missing required ZIP64 metadata/u,
    );
    const unsafeEntryOffset = Buffer.from(validZip64);
    unsafeEntryOffset.writeBigUInt64LE(
      BigInt(Number.MAX_SAFE_INTEGER) + 1n,
      zip64ExtraOffset + 20,
    );
    await writeFile(artifactPath, unsafeEntryOffset);
    await assert.rejects(
      createNativeReleaseManifest(linkageOptions),
      /local-header offset exceeds the safe integer range/u,
    );
    const malformedZip64 = Buffer.from(validZip64);
    malformedZip64.writeUInt32LE(2, malformedZip64.length - 26);
    await writeFile(artifactPath, malformedZip64);
    await assert.rejects(
      createNativeReleaseManifest(linkageOptions),
      /ZIP64 locator is malformed/u,
    );
    await writeStoredZip(artifactPath, [
      ["assets/index.android.bundle", compiledBundle],
    ]);

    await writeFile(
      bundlePath,
      "globalThis.__linkedRelease = false;\n//# sourceMappingURL=index.android.bundle.packager.map\n",
    );
    await writeNativeBundleManifest(manifestOptions);
    await assert.rejects(
      createNativeReleaseManifest({
        cwd,
        bundleManifestPath,
        artifactPath,
        release: "1.2.3+linked",
        channel: "internal",
        sourceRevision: "0123456789abcdef0123456789abcdef01234567",
        inspectEmbeddedBundle: true,
        outputPath: releaseManifestPath,
      }),
      /was not compiled from the reviewed bundle source/u,
    );

    await writeFile(bundlePath, source);
    await writeNativeBundleManifest(manifestOptions);
    await writeStoredZip(artifactPath, [
      ["assets/index.android.bundle", compiledBundle],
      ["assets/index.android.bundle", compiledBundle],
    ]);
    await assert.rejects(
      createNativeReleaseManifest({
        cwd,
        bundleManifestPath,
        artifactPath,
        release: "1.2.3+linked",
        channel: "internal",
        sourceRevision: "0123456789abcdef0123456789abcdef01234567",
        inspectEmbeddedBundle: true,
        outputPath: releaseManifestPath,
      }),
      /must contain exactly one Hermes bundle; found 2/u,
    );
  },
);

test(
  "links archived iOS Hermes bytecode across Xcode source paths",
  { skip: process.platform !== "darwin" },
  async (t) => {
    const outputDirectory = await temporaryProject(t);
    const assetsDirectory = path.join(outputDirectory, "assets");
    const bundlePath = path.join(outputDirectory, "index.ios.bundle");
    const sourceMapPath = `${bundlePath}.packager.map`;
    const bundleManifestPath = path.join(
      outputDirectory,
      "solid-native-bundle.json",
    );
    const artifactPath = path.join(outputDirectory, "SolidNative.ipa");
    const releaseManifestPath = path.join(
      outputDirectory,
      "solid-native-release.json",
    );
    const nativeBuildDirectory = path.join(
      outputDirectory,
      "DerivedData",
      "Build",
      "Products",
      "Release-iphoneos",
    );
    const nativeSourcePath = path.join(nativeBuildDirectory, "main.jsbundle");
    const nativeBundlePath = path.join(outputDirectory, "native-main.hbc");
    const source = "globalThis.__linkedIOSRelease = true;\n";
    await Promise.all([
      mkdir(assetsDirectory),
      mkdir(nativeBuildDirectory, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(bundlePath, source),
      writeFile(nativeSourcePath, source),
      writeFile(
        sourceMapPath,
        JSON.stringify({
          version: 3,
          sources: ["app:///index.tsx"],
          sourcesContent: [source],
          names: [],
          mappings: "",
        }),
      ),
    ]);
    const manifestOptions = {
      platform: "ios",
      entryPoint: "index.tsx",
      outputDirectory,
      bundlePath,
      sourceMapPath,
      assetsDirectory,
      manifestPath: bundleManifestPath,
      minified: false,
    };
    await writeNativeBundleManifest(manifestOptions);
    const compilerPath = path.resolve(
      "../../apps/native-e2e/node_modules/hermes-compiler/hermesc/osx-bin/hermesc",
    );
    await execFileAsync(compilerPath, [
      "-emit-binary",
      "-max-diagnostic-width=80",
      "-O",
      "-out",
      nativeBundlePath,
      nativeSourcePath,
    ]);
    const nativeBundle = await readFile(nativeBundlePath);
    await writeStoredZip(artifactPath, [
      ["Payload/SolidNative.app/main.jsbundle", nativeBundle],
    ]);

    const cwd = path.resolve("../../apps/native-e2e");
    const options = {
      cwd,
      bundleManifestPath,
      artifactPath,
      release: "1.2.3+ios-linked",
      channel: "internal",
      sourceRevision: "0123456789abcdef0123456789abcdef01234567",
      inspectEmbeddedBundle: true,
      outputPath: releaseManifestPath,
    };
    const created = await createNativeReleaseManifest(options);
    assert.equal(
      created.manifest.embeddedBundle.path,
      "Payload/SolidNative.app/main.jsbundle",
    );
    assert.equal(
      created.manifest.embeddedBundle.sha256,
      createHash("sha256").update(nativeBundle).digest("hex"),
    );
    assert.doesNotMatch(JSON.stringify(created.manifest), /DerivedData/u);
    assert.equal(
      (
        await verifyNativeReleaseManifest({
          cwd,
          manifestPath: releaseManifestPath,
          bundleManifestPath,
          artifactPath,
        })
      ).ok,
      true,
    );

    const sourceMapBundlePath = path.join(
      outputDirectory,
      "native-main-sourcemap.hbc",
    );
    await execFileAsync(compilerPath, [
      "-emit-binary",
      "-max-diagnostic-width=80",
      "-O",
      "-output-source-map",
      "-out",
      sourceMapBundlePath,
      nativeSourcePath,
    ]);
    await writeStoredZip64(
      artifactPath,
      "Payload/SolidNative.app/main.jsbundle",
      await readFile(sourceMapBundlePath),
    );
    const sourceMapCreated = await createNativeReleaseManifest(options);
    assert.equal(
      (
        await verifyNativeReleaseManifest({
          cwd,
          manifestPath: sourceMapCreated.manifestPath,
          bundleManifestPath,
          artifactPath,
        })
      ).ok,
      true,
    );

    const corruptedBundle = Buffer.from(nativeBundle);
    corruptedBundle[100] ^= 0x01;
    await writeStoredZip(artifactPath, [
      ["Payload/SolidNative.app/main.jsbundle", corruptedBundle],
    ]);
    await assert.rejects(
      createNativeReleaseManifest(options),
      /Hermes bytecode does not match its internal checksum/u,
    );

    await writeStoredZip(artifactPath, [
      ["Payload/SolidNative.app/main.jsbundle", nativeBundle],
      ["Payload/Other.app/main.jsbundle", nativeBundle],
    ]);
    await assert.rejects(
      createNativeReleaseManifest(options),
      /iOS release artifact must contain exactly one Hermes bundle; found 2/u,
    );
  },
);

test("signs and verifies a release with an externally pinned Ed25519 key", async (t) => {
  const outputDirectory = await temporaryProject(t);
  const assetsDirectory = path.join(outputDirectory, "assets");
  const bundlePath = path.join(outputDirectory, "index.ios.bundle");
  const sourceMapPath = `${bundlePath}.map`;
  const bundleManifestPath = path.join(
    outputDirectory,
    "solid-native-bundle.json",
  );
  const artifactPath = path.join(outputDirectory, "app-release.ipa");
  const releaseManifestPath = path.join(
    outputDirectory,
    "solid-native-release.json",
  );
  const privateKeyPath = path.join(outputDirectory, "release-private.pem");
  const publicKeyPath = path.join(outputDirectory, "release-public.pem");
  const signaturePath = path.join(outputDirectory, "release.sig.json");
  const trustPolicyPath = path.join(
    outputDirectory,
    "release-trust-policy.json",
  );
  await mkdir(assetsDirectory);
  await Promise.all([
    writeFile(bundlePath, "globalThis.__signedRelease = true;\n"),
    writeFile(sourceMapPath, portableSourceMap()),
    writeFile(artifactPath, "signed native artifact bytes\n"),
  ]);
  await writeNativeBundleManifest({
    platform: "ios",
    entryPoint: "index.tsx",
    outputDirectory,
    bundlePath,
    sourceMapPath,
    assetsDirectory,
    manifestPath: bundleManifestPath,
  });
  const cwd = path.resolve("../../apps/native-e2e");
  const createdRelease = await createNativeReleaseManifest({
    cwd,
    bundleManifestPath,
    artifactPath,
    release: "2.0.0-rc.1+7",
    channel: "internal",
    sourceRevision: "0123456789abcdef0123456789abcdef01234567",
    outputPath: releaseManifestPath,
  });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });
  await Promise.all([
    writeFile(privateKeyPath, privateKey, { mode: 0o600 }),
    writeFile(publicKeyPath, publicKey),
  ]);
  const signatureOptions = {
    cwd,
    manifestPath: releaseManifestPath,
    privateKeyPath,
    keyId: "internal-2026-08",
    artifactPath,
    bundleManifestPath,
    outputPath: signaturePath,
  };
  await writeFile(artifactPath, "tampered native artifact bytes\n");
  await assert.rejects(
    createNativeReleaseSignature(signatureOptions),
    /release inputs failed verification; refusing to sign/u,
  );
  await assert.rejects(
    createNativeReleaseSigningRequest({
      cwd,
      manifestPath: releaseManifestPath,
      keyId: "internal-2026-08",
      artifactPath,
      bundleManifestPath,
      outputPath: path.join(outputDirectory, "rejected.signing-request.json"),
    }),
    /release inputs failed verification; refusing to prepare a signing request/u,
  );
  await writeFile(artifactPath, "signed native artifact bytes\n");
  const created = await createNativeReleaseSignature(signatureOptions);
  assert.equal(created.signature.algorithm, "ed25519");
  assert.equal(created.signature.keyId, "internal-2026-08");
  assert.match(created.signature.signature, /^[A-Za-z0-9_-]{86}$/u);
  assert.equal(created.verification.ok, true);
  assert.ok(!JSON.stringify(created.signature).includes(outputDirectory));
  const repeated = await createNativeReleaseSignature(signatureOptions);
  assert.deepEqual(repeated.signature, created.signature);
  const signingRequestPath = path.join(
    outputDirectory,
    "release.signing-request.json",
  );
  const detachedSignaturePath = path.join(
    outputDirectory,
    "release.detached-signature.bin",
  );
  const assembledSignaturePath = path.join(
    outputDirectory,
    "release.assembled.sig.json",
  );
  const signingRequest = await createNativeReleaseSigningRequest({
    cwd,
    manifestPath: releaseManifestPath,
    keyId: "internal-2026-08",
    artifactPath,
    bundleManifestPath,
    outputPath: signingRequestPath,
  });
  assert.equal(signingRequest.verification.ok, true);
  assert.equal(signingRequest.request.algorithm, "ed25519");
  assert.equal(Object.isFrozen(signingRequest.request), true);
  assert.equal(signingRequest.request.keyId, "internal-2026-08");
  assert.equal(
    signingRequest.request.releaseFingerprint,
    createdRelease.manifest.releaseFingerprint,
  );
  const signingPayload = Buffer.from(
    signingRequest.request.payloadBase64url,
    "base64url",
  );
  assert.equal(
    createHash("sha256").update(signingPayload).digest("hex"),
    signingRequest.request.payloadSha256,
  );
  assert.deepEqual(
    await readNativeReleaseSigningRequest(signingRequestPath),
    signingRequest.request,
  );
  assert.equal(
    Object.isFrozen(await readNativeReleaseSigningRequest(signingRequestPath)),
    true,
  );
  const envelopeSigningRequest = await createNativeReleaseSigningRequest({
    cwd,
    manifestPath: releaseManifestPath,
    keyId: "internal-2026-08",
    outputPath: path.join(
      outputDirectory,
      "envelope-only.signing-request.json",
    ),
  });
  assert.equal(envelopeSigningRequest.verification, undefined);
  assert.deepEqual(envelopeSigningRequest.request, signingRequest.request);
  await assert.rejects(
    createNativeReleaseSigningRequest({
      cwd,
      manifestPath: releaseManifestPath,
      keyId: "internal-2026-08",
      bundleManifestPath,
    }),
    /require both a bundle manifest and native artifact/u,
  );
  await assert.rejects(
    createNativeReleaseSigningRequest({
      cwd,
      manifestPath: releaseManifestPath,
      keyId: "internal-2026-08",
      outputPath: releaseManifestPath,
    }),
    /must not overwrite a release input/u,
  );
  const detachedSignature = sign(null, signingPayload, privateKey);
  await writeFile(detachedSignaturePath, detachedSignature);
  const assembled = await assembleNativeReleaseSignature({
    cwd,
    requestPath: signingRequestPath,
    detachedSignaturePath,
    publicKeyPath,
    outputPath: assembledSignaturePath,
  });
  assert.deepEqual(assembled.signature, created.signature);
  assert.deepEqual(
    JSON.parse(await readFile(assembledSignaturePath, "utf8")),
    created.signature,
  );
  const base64urlSignaturePath = path.join(
    outputDirectory,
    "release.detached-signature.txt",
  );
  const base64urlAssembledPath = path.join(
    outputDirectory,
    "release.base64url.sig.json",
  );
  await writeFile(
    base64urlSignaturePath,
    `${detachedSignature.toString("base64url")}\n`,
  );
  assert.deepEqual(
    (
      await assembleNativeReleaseSignature({
        cwd,
        requestPath: signingRequestPath,
        detachedSignaturePath: base64urlSignaturePath,
        publicKeyPath,
        outputPath: base64urlAssembledPath,
      })
    ).signature,
    created.signature,
  );
  const malformedSigningRequestPath = path.join(
    outputDirectory,
    "malformed.signing-request.json",
  );
  await writeFile(
    malformedSigningRequestPath,
    `${JSON.stringify({
      ...signingRequest.request,
      payloadSha256: "0".repeat(64),
    })}\n`,
  );
  await assert.rejects(
    readNativeReleaseSigningRequest(malformedSigningRequestPath),
    /payload does not match its statement/u,
  );
  await writeFile(
    malformedSigningRequestPath,
    `${JSON.stringify({ ...signingRequest.request, unexpected: true })}\n`,
  );
  await assert.rejects(
    readNativeReleaseSigningRequest(malformedSigningRequestPath),
    /invalid schema/u,
  );
  const { publicKey: assemblyWrongPublicKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { format: "pem", type: "spki" },
  });
  const assemblyWrongPublicKeyPath = path.join(
    outputDirectory,
    "assembly-wrong-public.pem",
  );
  await writeFile(assemblyWrongPublicKeyPath, assemblyWrongPublicKey);
  await assert.rejects(
    assembleNativeReleaseSignature({
      cwd,
      requestPath: signingRequestPath,
      detachedSignaturePath,
      publicKeyPath: assemblyWrongPublicKeyPath,
      outputPath: path.join(outputDirectory, "wrong-key.sig.json"),
    }),
    /does not authenticate the release signing request/u,
  );
  await assert.rejects(
    assembleNativeReleaseSignature({
      cwd,
      requestPath: signingRequestPath,
      detachedSignaturePath,
      publicKeyPath,
      outputPath: detachedSignaturePath,
    }),
    /must not overwrite an assembly input/u,
  );
  const malformedDetachedSignaturePath = path.join(
    outputDirectory,
    "malformed.detached-signature.bin",
  );
  await writeFile(malformedDetachedSignaturePath, Buffer.alloc(63));
  await assert.rejects(
    assembleNativeReleaseSignature({
      cwd,
      requestPath: signingRequestPath,
      detachedSignaturePath: malformedDetachedSignaturePath,
      publicKeyPath,
      outputPath: path.join(outputDirectory, "malformed.sig.json"),
    }),
    /64 raw bytes or canonical base64url/u,
  );
  const offlineSignaturePath = path.join(
    outputDirectory,
    "offline-release.sig.json",
  );
  const offline = await createNativeReleaseSignature({
    cwd,
    manifestPath: releaseManifestPath,
    privateKeyPath,
    keyId: "internal-2026-08",
    outputPath: offlineSignaturePath,
  });
  assert.equal(offline.verification, undefined);
  assert.deepEqual(offline.signature, created.signature);

  const baseVerificationOptions = {
    cwd,
    manifestPath: releaseManifestPath,
    signaturePath,
    publicKeyPath,
    expectedKeyId: "internal-2026-08",
    policy: {
      projectName: createdRelease.manifest.projectName,
      platform: createdRelease.manifest.platform,
      channel: createdRelease.manifest.channel,
      release: createdRelease.manifest.release,
      sourceRevision: createdRelease.manifest.sourceRevision,
      releaseFingerprint: createdRelease.manifest.releaseFingerprint,
      bundleFingerprint: createdRelease.manifest.bundleFingerprint,
      nativeCompatibilityFingerprint:
        createdRelease.manifest.nativeCompatibilityFingerprint,
      artifactSha256: createdRelease.manifest.artifact.sha256,
    },
  };
  const verificationOptions = {
    ...baseVerificationOptions,
    bundleManifestPath,
    artifactPath,
  };
  const envelopeVerificationOptions = {
    ...baseVerificationOptions,
    envelopeOnly: true,
  };
  const verification = await verifyNativeReleaseSignature(verificationOptions);
  assert.equal(verification.ok, true);
  assert.equal(verification.inputVerification.ok, true);
  const authorizedRelease = {
    schemaVersion: 0,
    projectName: createdRelease.manifest.projectName,
    platform: createdRelease.manifest.platform,
    release: createdRelease.manifest.release,
    channel: createdRelease.manifest.channel,
    sourceRevision: createdRelease.manifest.sourceRevision,
    releaseFingerprint: createdRelease.manifest.releaseFingerprint,
    bundleFingerprint: createdRelease.manifest.bundleFingerprint,
    nativeCompatibilityFingerprint:
      createdRelease.manifest.nativeCompatibilityFingerprint,
    artifactSha256: createdRelease.manifest.artifact.sha256,
    authenticatedKeyId: "internal-2026-08",
    inputsVerified: true,
  };
  assert.deepEqual(verification.authorizedRelease, authorizedRelease);
  assert.equal(Object.isFrozen(verification.authorizedRelease), true);
  assert.deepEqual(
    verification.checks.map((entry) => [entry.id, entry.status]),
    [
      ["envelope", "pass"],
      ["key", "pass"],
      ["signature", "pass"],
      ["policy", "pass"],
      ["inputs", "pass"],
    ],
  );
  assert.match(
    formatNativeReleaseSignatureVerification(verification),
    /pinned public key/u,
  );
  const envelopeVerification = await verifyNativeReleaseSignature(
    envelopeVerificationOptions,
  );
  assert.equal(envelopeVerification.ok, true);
  assert.equal(envelopeVerification.inputVerification, undefined);
  assert.deepEqual(envelopeVerification.authorizedRelease, {
    ...authorizedRelease,
    inputsVerified: false,
  });
  assert.match(
    formatNativeReleaseSignatureVerification(envelopeVerification),
    /envelope only/u,
  );

  const publicKeySpki = createPublicKey(publicKey)
    .export({ format: "der", type: "spki" })
    .toString("base64url");
  const trustPolicy = {
    schemaVersion: 0,
    policySequence: 1,
    ...baseVerificationOptions.policy,
    keys: [
      {
        keyId: "internal-2026-08",
        algorithm: "ed25519",
        publicKeySpki,
        status: "active",
      },
    ],
  };
  await writeFile(trustPolicyPath, `${JSON.stringify(trustPolicy, null, 2)}\n`);
  const parsedTrustPolicy = await readNativeReleaseTrustPolicy(trustPolicyPath);
  assert.deepEqual(parsedTrustPolicy, trustPolicy);
  assert.equal(Object.isFrozen(parsedTrustPolicy), true);
  assert.equal(Object.isFrozen(parsedTrustPolicy.keys), true);
  assert.equal(Object.isFrozen(parsedTrustPolicy.keys[0]), true);
  const trustPolicyFingerprint =
    nativeReleaseTrustPolicyFingerprint(parsedTrustPolicy);
  assert.match(trustPolicyFingerprint, /^sha256:[a-f\d]{64}$/u);
  const { publicKey: nextPublicKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { format: "pem", type: "spki" },
  });
  const nextPublicKeySpki = createPublicKey(nextPublicKey)
    .export({ format: "der", type: "spki" })
    .toString("base64url");
  const nextKey = {
    keyId: "production-2026-09",
    algorithm: "ed25519",
    publicKeySpki: nextPublicKeySpki,
    status: "active",
  };
  assert.equal(
    nativeReleaseTrustPolicyFingerprint({
      ...trustPolicy,
      keys: [nextKey, trustPolicy.keys[0]],
    }),
    nativeReleaseTrustPolicyFingerprint({
      ...trustPolicy,
      keys: [trustPolicy.keys[0], nextKey],
    }),
  );
  assert.notEqual(
    nativeReleaseTrustPolicyFingerprint({
      ...trustPolicy,
      policySequence: 2,
    }),
    trustPolicyFingerprint,
  );

  const trustVerification = await verifyNativeReleaseSignature({
    cwd,
    manifestPath: releaseManifestPath,
    signaturePath,
    trustPolicyPath,
    bundleManifestPath,
    artifactPath,
  });
  assert.equal(trustVerification.ok, true);
  assert.equal(trustVerification.inputVerification.ok, true);
  assert.equal(trustVerification.trustPolicyPath, trustPolicyPath);
  assert.equal(trustVerification.trustPolicySequence, 1);
  assert.equal(
    trustVerification.trustPolicyFingerprint,
    trustPolicyFingerprint,
  );
  assert.deepEqual(trustVerification.policy, baseVerificationOptions.policy);
  const trustPolicyAuthorizedRelease = {
    ...authorizedRelease,
    trustPolicyFingerprint,
    trustPolicySequence: 1,
  };
  assert.deepEqual(
    trustVerification.authorizedRelease,
    trustPolicyAuthorizedRelease,
  );
  assert.ok(!JSON.stringify(trustVerification).includes(publicKeySpki));
  assert.match(
    trustVerification.checks.find((entry) => entry.id === "key").message,
    /active in the release trust policy/u,
  );

  const symbolication = await createNativeSymbolicationHandoff({
    cwd,
    manifestPath: releaseManifestPath,
    signaturePath,
    trustPolicyPath,
    bundleManifestPath,
    artifactPath,
  });
  assert.equal(symbolication.schemaVersion, 0);
  assert.equal(symbolication.kind, "solid-native.symbolication-handoff");
  assert.equal(symbolication.algorithm, "sha256");
  assert.equal(symbolication.entryPoint, "index.tsx");
  assert.equal(symbolication.minified, true);
  assert.deepEqual(
    symbolication.authorizedRelease,
    trustPolicyAuthorizedRelease,
  );
  assert.equal(symbolication.artifacts.bundle.localPath, bundlePath);
  assert.equal(symbolication.artifacts.sourceMap.localPath, sourceMapPath);
  assert.equal(
    symbolication.artifacts.sourceMap.sha256,
    (await readNativeBundleManifest(bundleManifestPath)).artifacts.sourceMap
      .sha256,
  );
  assert.equal(Object.isFrozen(symbolication), true);
  assert.equal(Object.isFrozen(symbolication.artifacts), true);
  assert.equal(Object.isFrozen(symbolication.artifacts.sourceMap), true);
  assert.equal(Object.isFrozen(symbolication.authorizedRelease), true);
  assert.match(
    formatNativeSymbolicationHandoff(symbolication),
    /selected backend/u,
  );
  await writeFile(sourceMapPath, portableSourceMap("tampered"));
  await assert.rejects(
    createNativeSymbolicationHandoff({
      cwd,
      manifestPath: releaseManifestPath,
      signaturePath,
      trustPolicyPath,
      bundleManifestPath,
      artifactPath,
    }),
    /unauthorized release/u,
  );
  await writeFile(sourceMapPath, portableSourceMap());

  const rollbackVerification = await verifyNativeReleaseSignature({
    cwd,
    manifestPath: releaseManifestPath,
    signaturePath,
    trustPolicyPath,
    minimumTrustPolicySequence: 2,
    envelopeOnly: true,
  });
  assert.equal(rollbackVerification.ok, false);
  assert.equal(rollbackVerification.authorizedRelease, undefined);
  assert.match(
    rollbackVerification.checks.find((entry) => entry.id === "trust-policy")
      .message,
    /below the required minimum 2/u,
  );
  await assert.rejects(
    verifyNativeReleaseSignature({
      ...envelopeVerificationOptions,
      minimumTrustPolicySequence: 1,
    }),
    /minimum release trust policy sequence requires a trust policy file/u,
  );
  await assert.rejects(
    verifyNativeReleaseSignature({
      cwd,
      manifestPath: releaseManifestPath,
      signaturePath,
      trustPolicyPath,
      minimumTrustPolicySequence: 0,
      envelopeOnly: true,
    }),
    /minimum release trust policy sequence must be a positive safe integer/u,
  );

  const revokedTrustPolicy = {
    ...trustPolicy,
    keys: [{ ...trustPolicy.keys[0], status: "revoked" }],
  };
  await writeFile(
    trustPolicyPath,
    `${JSON.stringify(revokedTrustPolicy, null, 2)}\n`,
  );
  const revokedVerification = await verifyNativeReleaseSignature({
    cwd,
    manifestPath: releaseManifestPath,
    signaturePath,
    trustPolicyPath,
    envelopeOnly: true,
  });
  assert.equal(revokedVerification.ok, false);
  assert.equal(revokedVerification.authorizedRelease, undefined);
  assert.equal(
    revokedVerification.checks.find((entry) => entry.id === "key").status,
    "fail",
  );
  assert.equal(
    revokedVerification.checks.find((entry) => entry.id === "signature").status,
    "pass",
  );
  assert.match(
    revokedVerification.checks.find((entry) => entry.id === "key").message,
    /revoked/u,
  );

  await writeFile(
    trustPolicyPath,
    `${JSON.stringify(
      {
        ...trustPolicy,
        keys: [{ ...trustPolicy.keys[0], keyId: "next-2026-09" }],
      },
      null,
      2,
    )}\n`,
  );
  const unknownKeyVerification = await verifyNativeReleaseSignature({
    cwd,
    manifestPath: releaseManifestPath,
    signaturePath,
    trustPolicyPath,
    envelopeOnly: true,
  });
  assert.equal(unknownKeyVerification.ok, false);
  assert.match(
    unknownKeyVerification.checks.find((entry) => entry.id === "key").message,
    /absent/u,
  );

  for (const malformedPolicy of [
    { ...trustPolicy, unexpected: true },
    { ...trustPolicy, policySequence: 0 },
    { ...trustPolicy, keys: [] },
    { ...trustPolicy, keys: [trustPolicy.keys[0], trustPolicy.keys[0]] },
    {
      ...trustPolicy,
      keys: [
        trustPolicy.keys[0],
        { ...trustPolicy.keys[0], keyId: "duplicate-material" },
      ],
    },
    {
      ...trustPolicy,
      keys: [{ ...trustPolicy.keys[0], publicKeySpki: "not-a-key" }],
    },
  ]) {
    await writeFile(
      trustPolicyPath,
      `${JSON.stringify(malformedPolicy, null, 2)}\n`,
    );
    await assert.rejects(
      readNativeReleaseTrustPolicy(trustPolicyPath),
      /trust policy|duplicate|SPKI|Ed25519/u,
    );
  }
  await writeFile(trustPolicyPath, `${JSON.stringify(trustPolicy, null, 2)}\n`);
  await assert.rejects(
    verifyNativeReleaseSignature(baseVerificationOptions),
    /release inputs or explicit envelope-only mode/u,
  );
  await assert.rejects(
    verifyNativeReleaseSignature({
      ...baseVerificationOptions,
      bundleManifestPath,
    }),
    /both a bundle manifest and native artifact/u,
  );
  await assert.rejects(
    verifyNativeReleaseSignature({
      ...verificationOptions,
      envelopeOnly: true,
    }),
    /cannot also verify release inputs/u,
  );
  await assert.rejects(
    verifyNativeReleaseSignature({
      ...baseVerificationOptions,
      envelopeOnly: "yes",
    }),
    /must be a boolean/u,
  );

  const bin = new URL("../dist/bin.js", import.meta.url);
  const cliSignaturePath = path.join(outputDirectory, "cli-release.sig.json");
  const { stdout: signOutput } = await execFileAsync(process.execPath, [
    bin.pathname,
    "release",
    "sign",
    releaseManifestPath,
    "--key",
    privateKeyPath,
    "--key-id",
    "internal-2026-08",
    "--bundle",
    bundleManifestPath,
    "--artifact",
    artifactPath,
    "--cwd",
    cwd,
    "--output",
    cliSignaturePath,
    "--json",
  ]);
  assert.equal(
    JSON.parse(signOutput).signature.signature,
    created.signature.signature,
  );
  assert.equal(JSON.parse(signOutput).verification.ok, true);
  const cliSigningRequestPath = path.join(
    outputDirectory,
    "cli-release.signing-request.json",
  );
  const cliDetachedSignaturePath = path.join(
    outputDirectory,
    "cli-release.detached-signature.bin",
  );
  const cliAssembledSignaturePath = path.join(
    outputDirectory,
    "cli-release.assembled.sig.json",
  );
  const { stdout: signingRequestOutput } = await execFileAsync(
    process.execPath,
    [
      bin.pathname,
      "release",
      "signing-request",
      releaseManifestPath,
      "--key-id",
      "internal-2026-08",
      "--bundle",
      bundleManifestPath,
      "--artifact",
      artifactPath,
      "--cwd",
      cwd,
      "--output",
      cliSigningRequestPath,
      "--json",
    ],
  );
  const cliSigningRequest = JSON.parse(signingRequestOutput);
  assert.equal(cliSigningRequest.verification.ok, true);
  assert.deepEqual(cliSigningRequest.request, signingRequest.request);
  await writeFile(
    cliDetachedSignaturePath,
    sign(
      null,
      Buffer.from(cliSigningRequest.request.payloadBase64url, "base64url"),
      privateKey,
    ),
  );
  const { stdout: assembledOutput } = await execFileAsync(process.execPath, [
    bin.pathname,
    "release",
    "assemble-signature",
    cliSigningRequestPath,
    "--signature",
    cliDetachedSignaturePath,
    "--public-key",
    publicKeyPath,
    "--cwd",
    cwd,
    "--output",
    cliAssembledSignaturePath,
    "--json",
  ]);
  assert.deepEqual(JSON.parse(assembledOutput).signature, created.signature);
  await assert.rejects(
    execFileAsync(process.execPath, [
      bin.pathname,
      "release",
      "assemble-signature",
      cliSigningRequestPath,
      "--signature",
      cliDetachedSignaturePath,
    ]),
    (error) => error.code === 2 && /requires --public-key/u.test(error.stderr),
  );
  await assert.rejects(
    execFileAsync(process.execPath, [
      bin.pathname,
      "release",
      "sign",
      releaseManifestPath,
      "--key",
      privateKeyPath,
      "--key-id",
      "internal-2026-08",
      "--bundle",
      bundleManifestPath,
    ]),
    (error) =>
      error.code === 2 &&
      /--artifact and --bundle together/u.test(error.stderr),
  );
  const { stdout: verifyOutput } = await execFileAsync(process.execPath, [
    bin.pathname,
    "release",
    "verify-signature",
    cliSignaturePath,
    "--manifest",
    releaseManifestPath,
    "--public-key",
    publicKeyPath,
    "--key-id",
    "internal-2026-08",
    "--project",
    createdRelease.manifest.projectName,
    "--platform",
    createdRelease.manifest.platform,
    "--channel",
    createdRelease.manifest.channel,
    "--release",
    createdRelease.manifest.release,
    "--revision",
    createdRelease.manifest.sourceRevision,
    "--release-fingerprint",
    createdRelease.manifest.releaseFingerprint,
    "--bundle-fingerprint",
    createdRelease.manifest.bundleFingerprint,
    "--native-fingerprint",
    createdRelease.manifest.nativeCompatibilityFingerprint,
    "--artifact-sha256",
    createdRelease.manifest.artifact.sha256,
    "--bundle",
    bundleManifestPath,
    "--artifact",
    artifactPath,
    "--cwd",
    cwd,
    "--json",
  ]);
  const cliVerification = JSON.parse(verifyOutput);
  assert.equal(cliVerification.ok, true);
  assert.equal(cliVerification.inputVerification.ok, true);
  assert.deepEqual(cliVerification.policy, verificationOptions.policy);
  assert.deepEqual(cliVerification.authorizedRelease, authorizedRelease);
  const { stdout: trustPolicyOutput } = await execFileAsync(process.execPath, [
    bin.pathname,
    "release",
    "verify-signature",
    cliSignaturePath,
    "--manifest",
    releaseManifestPath,
    "--trust-policy",
    trustPolicyPath,
    "--minimum-policy-sequence",
    "1",
    "--bundle",
    bundleManifestPath,
    "--artifact",
    artifactPath,
    "--cwd",
    cwd,
    "--json",
  ]);
  const cliTrustPolicyVerification = JSON.parse(trustPolicyOutput);
  assert.equal(cliTrustPolicyVerification.ok, true);
  assert.equal(cliTrustPolicyVerification.trustPolicyPath, trustPolicyPath);
  assert.equal(cliTrustPolicyVerification.trustPolicySequence, 1);
  assert.equal(
    cliTrustPolicyVerification.trustPolicyFingerprint,
    trustPolicyFingerprint,
  );
  assert.deepEqual(
    cliTrustPolicyVerification.authorizedRelease,
    trustPolicyAuthorizedRelease,
  );
  const { stdout: symbolicationOutput } = await execFileAsync(
    process.execPath,
    [
      bin.pathname,
      "release",
      "symbolication",
      cliSignaturePath,
      "--manifest",
      releaseManifestPath,
      "--trust-policy",
      trustPolicyPath,
      "--minimum-policy-sequence",
      "1",
      "--bundle",
      bundleManifestPath,
      "--artifact",
      artifactPath,
      "--cwd",
      cwd,
      "--json",
    ],
  );
  const cliSymbolication = JSON.parse(symbolicationOutput);
  assert.equal(cliSymbolication.kind, "solid-native.symbolication-handoff");
  assert.deepEqual(
    cliSymbolication.authorizedRelease,
    trustPolicyAuthorizedRelease,
  );
  assert.equal(cliSymbolication.artifacts.sourceMap.localPath, sourceMapPath);
  await assert.rejects(
    execFileAsync(process.execPath, [
      bin.pathname,
      "release",
      "symbolication",
      cliSignaturePath,
      "--manifest",
      releaseManifestPath,
      "--trust-policy",
      trustPolicyPath,
      "--envelope-only",
    ]),
    (error) =>
      error.code === 2 &&
      /symbolication does not support --envelope-only/u.test(error.stderr),
  );
  await assert.rejects(
    execFileAsync(process.execPath, [
      bin.pathname,
      "release",
      "verify-signature",
      cliSignaturePath,
      "--manifest",
      releaseManifestPath,
      "--trust-policy",
      trustPolicyPath,
      "--public-key",
      publicKeyPath,
      "--envelope-only",
    ]),
    (error) =>
      error.code === 2 &&
      /cannot be combined with pinned key or scope options/u.test(error.stderr),
  );
  const { stdout: envelopeOutput } = await execFileAsync(process.execPath, [
    bin.pathname,
    "release",
    "verify-signature",
    cliSignaturePath,
    "--manifest",
    releaseManifestPath,
    "--public-key",
    publicKeyPath,
    "--key-id",
    "internal-2026-08",
    "--project",
    createdRelease.manifest.projectName,
    "--platform",
    createdRelease.manifest.platform,
    "--channel",
    createdRelease.manifest.channel,
    "--envelope-only",
    "--cwd",
    cwd,
    "--json",
  ]);
  const cliEnvelopeVerification = JSON.parse(envelopeOutput);
  assert.equal(cliEnvelopeVerification.ok, true);
  assert.equal(cliEnvelopeVerification.inputVerification, undefined);
  assert.equal(cliEnvelopeVerification.authorizedRelease.inputsVerified, false);
  await assert.rejects(
    execFileAsync(process.execPath, [
      bin.pathname,
      "release",
      "verify-signature",
      cliSignaturePath,
      "--manifest",
      releaseManifestPath,
      "--public-key",
      publicKeyPath,
      "--key-id",
      "internal-2026-08",
    ]),
    (error) =>
      error.code === 2 &&
      /requires --project, --platform, --channel/u.test(error.stderr),
  );
  await assert.rejects(
    execFileAsync(process.execPath, [
      bin.pathname,
      "release",
      "verify-signature",
      cliSignaturePath,
      "--manifest",
      releaseManifestPath,
      "--public-key",
      publicKeyPath,
      "--key-id",
      "internal-2026-08",
      "--project",
      createdRelease.manifest.projectName,
      "--platform",
      createdRelease.manifest.platform,
      "--channel",
      createdRelease.manifest.channel,
    ]),
    (error) =>
      error.code === 2 &&
      /requires --artifact and --bundle or --envelope-only/u.test(error.stderr),
  );

  await writeFile(artifactPath, "tampered after signing\n");
  const wrongInputs = await verifyNativeReleaseSignature(verificationOptions);
  assert.equal(wrongInputs.ok, false);
  assert.equal(wrongInputs.authorizedRelease, undefined);
  assert.equal(wrongInputs.inputVerification.ok, false);
  assert.equal(
    wrongInputs.checks.find((entry) => entry.id === "inputs").status,
    "fail",
  );
  await writeFile(artifactPath, "signed native artifact bytes\n");

  const wrongProject = await verifyNativeReleaseSignature({
    ...envelopeVerificationOptions,
    policy: {
      ...verificationOptions.policy,
      projectName: `${verificationOptions.policy.projectName}-other`,
    },
  });
  assert.equal(wrongProject.ok, false);
  assert.equal(wrongProject.authorizedRelease, undefined);
  assert.match(
    wrongProject.checks.find((entry) => entry.id === "policy").message,
    /projectName/u,
  );
  const differentHex = (value) =>
    `${value.startsWith("a") ? "b" : "a"}${value.slice(1)}`;
  for (const [field, value] of [
    ["platform", "android"],
    ["channel", "production"],
    ["release", "2.0.0-rc.1+8"],
    ["sourceRevision", differentHex(createdRelease.manifest.sourceRevision)],
    [
      "releaseFingerprint",
      `sha256:${differentHex(createdRelease.manifest.releaseFingerprint.slice(7))}`,
    ],
    [
      "bundleFingerprint",
      `sha256:${differentHex(createdRelease.manifest.bundleFingerprint.slice(7))}`,
    ],
    [
      "nativeCompatibilityFingerprint",
      `sha256:${differentHex(createdRelease.manifest.nativeCompatibilityFingerprint.slice(7))}`,
    ],
    ["artifactSha256", differentHex(createdRelease.manifest.artifact.sha256)],
  ]) {
    const denied = await verifyNativeReleaseSignature({
      ...envelopeVerificationOptions,
      policy: { ...verificationOptions.policy, [field]: value },
    });
    assert.equal(denied.ok, false, field);
    assert.match(
      denied.checks.find((entry) => entry.id === "policy").message,
      new RegExp(field, "u"),
    );
  }
  for (const policy of [
    {
      platform: createdRelease.manifest.platform,
      channel: createdRelease.manifest.channel,
    },
    { ...verificationOptions.policy, unexpected: true },
    { ...verificationOptions.policy, channel: "unsafe channel" },
    { ...verificationOptions.policy, sourceRevision: "ABCDEF0" },
    { ...verificationOptions.policy, artifactSha256: "a".repeat(63) },
  ]) {
    await assert.rejects(
      verifyNativeReleaseSignature({ ...verificationOptions, policy }),
      /release authorization/u,
    );
  }

  const wrongIdentity = await verifyNativeReleaseSignature({
    ...envelopeVerificationOptions,
    expectedKeyId: "production-2026-08",
  });
  assert.equal(wrongIdentity.ok, false);
  assert.equal(wrongIdentity.authorizedRelease, undefined);
  assert.equal(
    wrongIdentity.checks.find((entry) => entry.id === "key").status,
    "fail",
  );
  const wrongPublicKeyPath = path.join(outputDirectory, "wrong-public.pem");
  const { publicKey: wrongPublicKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { format: "pem", type: "spki" },
  });
  await writeFile(wrongPublicKeyPath, wrongPublicKey);
  const wrongKey = await verifyNativeReleaseSignature({
    ...envelopeVerificationOptions,
    publicKeyPath: wrongPublicKeyPath,
  });
  assert.equal(wrongKey.ok, false);
  assert.equal(wrongKey.authorizedRelease, undefined);
  assert.equal(
    wrongKey.checks.find((entry) => entry.id === "signature").status,
    "fail",
  );

  const originalManifest = await readFile(releaseManifestPath, "utf8");
  const invalidEnvelopeManifest = JSON.parse(originalManifest);
  invalidEnvelopeManifest.releaseFingerprint = `sha256:${differentHex(
    invalidEnvelopeManifest.releaseFingerprint.slice(7),
  )}`;
  await writeFile(
    releaseManifestPath,
    `${JSON.stringify(invalidEnvelopeManifest, null, 2)}\n`,
  );
  const invalidEnvelope = await verifyNativeReleaseSignature({
    ...envelopeVerificationOptions,
    policy: {
      projectName: verificationOptions.policy.projectName,
      platform: verificationOptions.policy.platform,
      channel: verificationOptions.policy.channel,
    },
  });
  assert.equal(invalidEnvelope.ok, false);
  assert.equal(invalidEnvelope.authorizedRelease, undefined);
  assert.equal(
    invalidEnvelope.checks.find((entry) => entry.id === "envelope").status,
    "fail",
  );
  await writeFile(releaseManifestPath, originalManifest);

  const tamperedSignature = JSON.parse(await readFile(signaturePath, "utf8"));
  tamperedSignature.untrustedExtension = true;
  await writeFile(
    signaturePath,
    `${JSON.stringify(tamperedSignature, null, 2)}\n`,
  );
  await assert.rejects(
    verifyNativeReleaseSignature(envelopeVerificationOptions),
    /release signature has an invalid schema/u,
  );
  delete tamperedSignature.untrustedExtension;
  const firstCharacter = tamperedSignature.signature.at(0);
  tamperedSignature.signature = `${firstCharacter === "A" ? "B" : "A"}${tamperedSignature.signature.slice(1)}`;
  await writeFile(
    signaturePath,
    `${JSON.stringify(tamperedSignature, null, 2)}\n`,
  );
  const invalidSignature = await verifyNativeReleaseSignature(
    envelopeVerificationOptions,
  );
  assert.equal(invalidSignature.ok, false);
  assert.equal(invalidSignature.authorizedRelease, undefined);
  assert.equal(
    invalidSignature.checks.find((entry) => entry.id === "signature").status,
    "fail",
  );
  await assert.rejects(
    execFileAsync(process.execPath, [
      bin.pathname,
      "release",
      "verify-signature",
      signaturePath,
      "--manifest",
      releaseManifestPath,
      "--public-key",
      publicKeyPath,
      "--key-id",
      "internal-2026-08",
      "--project",
      createdRelease.manifest.projectName,
      "--platform",
      createdRelease.manifest.platform,
      "--channel",
      createdRelease.manifest.channel,
      "--envelope-only",
      "--cwd",
      cwd,
      "--json",
    ]),
    (error) => {
      assert.equal(error.code, 1);
      assert.equal(JSON.parse(error.stdout).ok, false);
      return true;
    },
  );

  if (process.platform !== "win32") {
    const linkedPrivateKeyPath = path.join(
      outputDirectory,
      "linked-private.pem",
    );
    await symlink(privateKeyPath, linkedPrivateKeyPath);
    await assert.rejects(
      createNativeReleaseSignature({
        ...signatureOptions,
        privateKeyPath: linkedPrivateKeyPath,
      }),
      /Private key .* is missing or unreadable/u,
    );
    await chmod(privateKeyPath, 0o644);
    await assert.rejects(
      createNativeReleaseSignature(signatureOptions),
      /must not be readable or writable by group or other users/u,
    );
  }
});

test("builds transparent application-local iOS and Android run plans", async (t) => {
  const project = await temporaryProject(t);
  const cli = path.join(project, "node_modules", "react-native", "cli.js");
  await Promise.all([
    mkdir(path.dirname(cli), { recursive: true }),
    mkdir(path.join(project, "ios"), { recursive: true }),
    mkdir(path.join(project, "android"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(project, "package.json"),
      JSON.stringify({
        dependencies: verifiedApplicationDependencies,
        devDependencies: verifiedApplicationDevDependencies,
      }),
    ),
    writeFile(cli, ""),
  ]);
  await Promise.all([
    installSolidNativePair(project),
    installVerifiedJavaScriptApplication(project),
    installReactNativeHermesPair(project),
  ]);

  const ios = await createNativeRunPlan({
    cwd: path.join(project, "ios"),
    platform: "ios",
    forwardedArgs: ["--device", "Birk's iPhone", "--mode", "Release"],
  });
  const android = await createNativeRunPlan({
    cwd: project,
    platform: "android",
    forwardedArgs: ["--device", "Pixel_9a"],
    env: { ANDROID_HOME: "/fixture/android-sdk" },
  });
  const automaticAndroid = await createNativeRunPlan({
    cwd: project,
    platform: "android",
    env: { ANDROID_HOME: "/fixture/android-sdk" },
  });
  const deprecatedAndroidSelector = await createNativeRunPlan({
    cwd: project,
    platform: "android",
    forwardedArgs: ["--device", "ignored-device", "--deviceId=legacy-device"],
    env: { ANDROID_HOME: "/fixture/android-sdk" },
  });
  const repeatedAndroidSelector = await createNativeRunPlan({
    cwd: project,
    platform: "android",
    forwardedArgs: ["--device", "first-device", "--device=last-device"],
    env: { ANDROID_HOME: "/fixture/android-sdk" },
  });
  const interactiveAndroid = await createNativeRunPlan({
    cwd: project,
    platform: "android",
    forwardedArgs: ["--device", "ignored-device", "--list-devices"],
    env: { ANDROID_HOME: "/fixture/android-sdk" },
  });
  const shortInteractiveAndroid = await createNativeRunPlan({
    cwd: project,
    platform: "android",
    forwardedArgs: ["-i"],
    env: { ANDROID_HOME: "/fixture/android-sdk" },
  });
  assert.deepEqual(ios.args, [
    cli,
    "run-ios",
    "--device",
    "Birk's iPhone",
    "--mode",
    "Release",
  ]);
  assert.deepEqual(ios.iosDestinationPreflight, {
    kind: "device",
    value: "Birk's iPhone",
  });
  assert.equal(ios.operation, "run");
  assert.deepEqual(android.args, [cli, "run-android", "--device", "Pixel_9a"]);
  assert.deepEqual(android.androidDestinationPreflight, {
    kind: "device",
    value: "Pixel_9a",
  });
  assert.deepEqual(automaticAndroid.androidDestinationPreflight, {
    kind: "automatic",
  });
  assert.deepEqual(deprecatedAndroidSelector.androidDestinationPreflight, {
    kind: "deviceId",
    value: "legacy-device",
  });
  assert.deepEqual(repeatedAndroidSelector.androidDestinationPreflight, {
    kind: "device",
    value: "last-device",
  });
  assert.equal(interactiveAndroid.androidDestinationPreflight, undefined);
  assert.equal(shortInteractiveAndroid.androidDestinationPreflight, undefined);
  await assert.rejects(
    createNativeRunPlan({
      cwd: project,
      platform: "android",
      forwardedArgs: ["--device"],
      env: { ANDROID_HOME: "/fixture/android-sdk" },
    }),
    /--device requires a device serial/u,
  );
  assert.match(formatNativeRunPlan(ios), /'Birk'\\''s iPhone'/u);

  let executed;
  const androidLifecycle = [];
  const exitCode = await executeNativeRunPlan(android, {
    env: { SOLID_NATIVE_TEST: "1" },
    async androidPreflight(options) {
      androidLifecycle.push({ operation: "preflight", options });
      return {
        destination: "device",
        serial: "Pixel_9a",
        originalStayAwake: "7",
      };
    },
    async executor(plan, context) {
      androidLifecycle.push({ operation: "run" });
      executed = { plan, context };
      return 23;
    },
    async androidRestore(options) {
      androidLifecycle.push({ operation: "restore", options });
    },
  });
  assert.equal(exitCode, 23);
  assert.equal(executed.plan, android);
  assert.equal(executed.context.env.SOLID_NATIVE_TEST, "1");
  assert.deepEqual(
    androidLifecycle.map(({ operation }) => operation),
    ["preflight", "run", "restore"],
  );
  assert.equal(androidLifecycle[0].options.cwd, project);
  assert.equal(androidLifecycle[2].options.result.originalStayAwake, "7");

  let automaticExecutionPlan;
  await executeNativeRunPlan(automaticAndroid, {
    async androidPreflight() {
      return { destination: "emulator", serial: "emulator-5554" };
    },
    async executor(executedPlan) {
      automaticExecutionPlan = executedPlan;
      return 0;
    },
  });
  assert.notEqual(automaticExecutionPlan, automaticAndroid);
  assert.deepEqual(automaticExecutionPlan.args, [
    cli,
    "run-android",
    "--device",
    "emulator-5554",
  ]);
  assert.deepEqual(automaticAndroid.args, [cli, "run-android"]);

  const failedLifecycle = [];
  await assert.rejects(
    executeNativeRunPlan(android, {
      async androidPreflight() {
        failedLifecycle.push("preflight");
        return {
          destination: "device",
          serial: "Pixel_9a",
          originalStayAwake: "0",
        };
      },
      async executor() {
        failedLifecycle.push("run");
        throw new TypeError("Gradle fixture failed");
      },
      async androidRestore() {
        failedLifecycle.push("restore");
      },
    }),
    /Gradle fixture failed/u,
  );
  assert.deepEqual(failedLifecycle, ["preflight", "run", "restore"]);

  await assert.rejects(
    executeNativeRunPlan(android, {
      async androidPreflight() {
        return {
          destination: "device",
          serial: "Pixel_9a",
          originalStayAwake: "0",
        };
      },
      async executor() {
        throw new TypeError("run failure");
      },
      async androidRestore() {
        throw new TypeError("restore failure");
      },
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.match(error.message, /run failed[\s\S]*could not be restored/u);
      assert.deepEqual(
        error.errors.map((entry) => entry.message),
        ["run failure", "restore failure"],
      );
      return true;
    },
  );
});

test("preflights an explicit iOS destination before starting React Native", async (t) => {
  const project = await temporaryProject(t);
  const cli = path.join(project, "node_modules", "react-native", "cli.js");
  await Promise.all([
    mkdir(path.dirname(cli), { recursive: true }),
    mkdir(path.join(project, "ios"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(project, "package.json"),
      JSON.stringify({
        dependencies: verifiedApplicationDependencies,
        devDependencies: verifiedApplicationDevDependencies,
      }),
    ),
    writeFile(cli, ""),
  ]);
  await Promise.all([
    installSolidNativePair(project),
    installVerifiedJavaScriptApplication(project),
    installReactNativeHermesPair(project),
  ]);
  const plan = await createNativeRunPlan({
    cwd: project,
    platform: "ios",
    forwardedArgs: ["--udid", "physical-id", "--mode", "Release"],
  });
  assert.deepEqual(plan.iosDestinationPreflight, {
    kind: "udid",
    value: "physical-id",
  });

  const calls = [];
  const exitCode = await executeNativeRunPlan(plan, {
    env: { SOLID_NATIVE_TEST: "1" },
    async iosPreflight(options) {
      calls.push({ operation: "preflight", options });
      return {
        destination: "device",
        lockState: {
          deviceIdentifier: "physical-id",
          passcodeRequired: false,
          unlockedSinceBoot: true,
        },
      };
    },
    async executor(executedPlan, context) {
      calls.push({ operation: "run", executedPlan, context });
      return 29;
    },
  });
  assert.equal(exitCode, 29);
  assert.equal(calls[0].operation, "preflight");
  assert.equal(calls[0].options.cwd, project);
  assert.equal(calls[0].options.env.SOLID_NATIVE_TEST, "1");
  assert.equal(calls[1].operation, "run");

  let started = false;
  await assert.rejects(
    executeNativeRunPlan(plan, {
      async iosPreflight() {
        throw new TypeError("locked fixture");
      },
      async executor() {
        started = true;
        return 0;
      },
    }),
    /locked fixture/u,
  );
  assert.equal(started, false);

  const simulator = await createNativeRunPlan({
    cwd: project,
    platform: "ios",
    forwardedArgs: ["--simulator", "iPhone 17 Pro"],
  });
  assert.equal(simulator.iosDestinationPreflight, undefined);
});

test("carries Android Studio's SDK and JDK into execution as visible defaults", async (t) => {
  const project = await temporaryProject(t);
  const cli = path.join(project, "node_modules", "react-native", "cli.js");
  const sdk = path.join(project, "Library", "Android", "sdk");
  const javaHome = path.join(
    project,
    "Applications",
    "Android Studio.app",
    "Contents",
    "jbr",
    "Contents",
    "Home",
  );
  await Promise.all([
    mkdir(path.dirname(cli), { recursive: true }),
    mkdir(path.join(project, "android"), { recursive: true }),
    mkdir(sdk, { recursive: true }),
    mkdir(path.join(javaHome, "bin"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(project, "package.json"),
      JSON.stringify({
        dependencies: verifiedApplicationDependencies,
        devDependencies: verifiedApplicationDevDependencies,
      }),
    ),
    writeFile(cli, ""),
    writeFile(path.join(javaHome, "bin", "java"), ""),
  ]);
  await Promise.all([
    installSolidNativePair(project),
    installVerifiedJavaScriptApplication(project),
    installReactNativeHermesPair(project),
  ]);

  const plan = await createNativeRunPlan({
    cwd: project,
    platform: "android",
    env: {},
    dependencies: {
      homeDirectory: project,
      hostPlatform: "darwin",
    },
  });
  assert.deepEqual(plan.androidDestinationPreflight, { kind: "automatic" });
  assert.deepEqual(plan.environmentDefaults, {
    ANDROID_HOME: sdk,
    JAVA_HOME: javaHome,
  });
  assert.ok(formatNativeRunPlan(plan).startsWith(`ANDROID_HOME=${sdk} `));
  assert.match(
    formatNativeRunPlan(plan),
    new RegExp(`JAVA_HOME='${javaHome}'`),
  );

  let executionEnvironment;
  let executionPlan;
  await executeNativeRunPlan(plan, {
    env: { SOLID_NATIVE_TEST: "1" },
    async androidPreflight() {
      return { destination: "emulator", serial: "fixture-emulator" };
    },
    async executor(executedPlan, context) {
      executionPlan = executedPlan;
      executionEnvironment = context.env;
      return 0;
    },
  });
  assert.deepEqual(executionPlan.args, [
    cli,
    "run-android",
    "--device",
    "fixture-emulator",
  ]);
  assert.equal(executionEnvironment.ANDROID_HOME, sdk);
  assert.equal(executionEnvironment.JAVA_HOME, javaHome);
  assert.equal(executionEnvironment.SOLID_NATIVE_TEST, "1");

  await executeNativeRunPlan(plan, {
    env: { ANDROID_HOME: "/explicit/home" },
    async androidPreflight() {
      return { destination: "emulator", serial: "fixture-emulator" };
    },
    async executor(_plan, context) {
      executionEnvironment = context.env;
      return 0;
    },
  });
  assert.equal(executionEnvironment.ANDROID_HOME, "/explicit/home");
  assert.equal(executionEnvironment.JAVA_HOME, javaHome);

  const explicit = await createNativeRunPlan({
    cwd: project,
    platform: "android",
    env: {
      ANDROID_SDK_ROOT: "/explicit/sdk",
      JAVA_HOME: "/explicit/java",
    },
    dependencies: {
      homeDirectory: project,
      hostPlatform: "darwin",
    },
  });
  assert.equal(explicit.environmentDefaults, undefined);
});

test("rejects run plans outside the verified backend contract", async (t) => {
  const project = await temporaryProject(t);
  await Promise.all([
    mkdir(path.join(project, "android")),
    writeFile(
      path.join(project, "package.json"),
      JSON.stringify({
        dependencies: {
          "@solid-native/core": "0.0.0",
          "@solid-native/fabric-host": "0.0.0",
          "@solid-native/runtime": "0.0.0",
          "react-native": "^0.87.0",
        },
      }),
    ),
  ]);
  await assert.rejects(
    createNativeRunPlan({ cwd: project, platform: "android" }),
    /only exact 0\.87\.0 is device-verified/u,
  );
});

test("rejects run plans from an incomplete installed Fabric Host", async (t) => {
  const project = await temporaryProject(t);
  const cli = path.join(project, "node_modules", "react-native", "cli.js");
  await Promise.all([
    mkdir(path.dirname(cli), { recursive: true }),
    mkdir(path.join(project, "android"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(project, "package.json"),
      JSON.stringify({
        dependencies: {
          "@solid-native/core": "0.0.0",
          "@solid-native/fabric-host": "0.0.0",
          "@solid-native/runtime": "0.0.0",
          "react-native": "0.87.0",
        },
      }),
    ),
    writeFile(cli, ""),
  ]);
  await installSolidNativePair(project, { fabricHostExports: {} });

  await assert.rejects(
    createNativeRunPlan({ cwd: project, platform: "android" }),
    /does not expose \.\/android-gradle/u,
  );
});

test("rejects run, build, bundle, and start plans with an incomplete Solid compiler chain", async (t) => {
  const project = await temporaryProject(t);
  const cli = path.join(project, "node_modules", "react-native", "cli.js");
  await Promise.all([
    mkdir(path.dirname(cli), { recursive: true }),
    mkdir(path.join(project, "android"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(project, "package.json"),
      JSON.stringify({
        dependencies: {
          "@solid-native/core": "0.0.0",
          "@solid-native/fabric-host": "0.0.0",
          "@solid-native/runtime": "0.0.0",
          "react-native": "0.87.0",
        },
      }),
    ),
    writeFile(cli, ""),
  ]);
  await installSolidNativePair(project);

  for (const createPlan of [
    createNativeRunPlan,
    createNativeBuildPlan,
    createNativeBundlePlan,
    createNativeStartPlan,
  ]) {
    await assert.rejects(
      createPlan({ cwd: project, platform: "android" }),
      /Solid runtime: solid-js is not declared/u,
    );
  }
});

test("prints machine-readable Android and physical iOS run plans", async () => {
  const bin = new URL("../dist/bin.js", import.meta.url);
  const cwd = path.resolve("../../apps/native-e2e");
  const { stdout: androidOutput } = await execFileAsync(process.execPath, [
    bin.pathname,
    "run",
    "android",
    "--cwd",
    cwd,
    "--dry-run",
    "--json",
    "--",
    "--device",
    "Pixel_9a",
  ]);
  const android = JSON.parse(androidOutput);
  assert.equal(android.platform, "android");
  assert.deepEqual(android.args.slice(-2), ["--device", "Pixel_9a"]);
  assert.equal(android.iosDestinationPreflight, undefined);

  const { stdout: iosOutput } = await execFileAsync(process.execPath, [
    bin.pathname,
    "run",
    "ios",
    "--cwd",
    cwd,
    "--dry-run",
    "--json",
    "--",
    "--udid=physical-id",
  ]);
  const ios = JSON.parse(iosOutput);
  assert.equal(ios.platform, "ios");
  assert.deepEqual(ios.iosDestinationPreflight, {
    kind: "udid",
    value: "physical-id",
  });
});

test("builds inspectable application-local Codegen plans", async (t) => {
  const project = await temporaryProject(t);
  const cli = path.join(project, "node_modules", "react-native", "cli.js");
  await Promise.all([
    mkdir(path.dirname(cli), { recursive: true }),
    mkdir(path.join(project, "ios"), { recursive: true }),
    mkdir(path.join(project, "android"), { recursive: true }),
    mkdir(path.join(project, "specs"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(project, "package.json"),
      JSON.stringify({
        codegenConfig: {
          name: "FixtureSpec",
          type: "components",
          jsSrcsDir: "specs",
        },
        dependencies: {
          "@solid-native/core": "0.0.0",
          "@solid-native/fabric-host": "0.0.0",
          "@solid-native/runtime": "0.0.0",
          "react-native": "0.87.0",
        },
      }),
    ),
    writeFile(cli, ""),
    writeFile(
      path.join(project, "specs", "FixtureViewNativeComponent.ts"),
      `import type { HostComponent, ViewProps } from "react-native";
import codegenNativeComponent from "react-native/Libraries/Utilities/codegenNativeComponent";
interface NativeProps extends ViewProps { readonly label?: string; }
export default codegenNativeComponent<NativeProps>("FixtureView") as HostComponent<NativeProps>;
`,
    ),
  ]);

  const defaultPlan = await createNativeGeneratePlan({
    cwd: project,
    platform: "android",
  });
  const defaultOutputPath = path.join(project, "build", "solid-native-codegen");
  assert.equal(defaultPlan.outputPath, defaultOutputPath);
  assert.deepEqual(defaultPlan.args.slice(-2), [
    "--outputPath",
    defaultOutputPath,
  ]);
  await assert.rejects(
    createNativeGeneratePlan({
      cwd: project,
      outputPath: ".",
      platform: "android",
    }),
    /must be a directory inside the application root/u,
  );
  await assert.rejects(
    createNativeGeneratePlan({
      cwd: project,
      outputPath: "../outside",
      platform: "android",
    }),
    /must be a directory inside the application root/u,
  );
  await assert.rejects(
    createNativeGeneratePlan({
      cwd: project,
      outputPath: "generated",
      platform: "android",
    }),
    /native Codegen output and Solid binding output must not overlap/u,
  );
  const externalOutput = await mkdtemp(
    path.join(tmpdir(), "solid-native-codegen-output-"),
  );
  t.after(async () => {
    await rm(externalOutput, { force: true, recursive: true });
  });
  await Promise.all([
    symlink(externalOutput, path.join(project, "linked-native-output"), "dir"),
    symlink(externalOutput, path.join(project, "linked-solid-output"), "dir"),
  ]);
  await assert.rejects(
    createNativeGeneratePlan({
      cwd: project,
      outputPath: "linked-native-output/artifacts",
      platform: "android",
    }),
    /native Codegen output must remain inside the application root after resolving symlinks/u,
  );
  await assert.rejects(
    createNativeGeneratePlan({
      cwd: project,
      platform: "android",
      solidOutputPath: "linked-solid-output/FixtureSpec.ts",
    }),
    /Solid binding output must remain inside the application root after resolving symlinks/u,
  );

  const plan = await createNativeGeneratePlan({
    cwd: path.join(project, "ios"),
    outputPath: "generated native",
    platform: "ios",
    source: "app",
    verbose: true,
  });
  const outputPath = path.join(project, "generated native");
  assert.deepEqual(plan, {
    schemaVersion: 0,
    operation: "generate",
    platform: "ios",
    source: "app",
    projectRoot: project,
    command: process.execPath,
    args: [
      cli,
      "codegen",
      "--path",
      project,
      "--platform",
      "ios",
      "--source",
      "app",
      "--outputPath",
      outputPath,
      "--verbose",
    ],
    outputPath,
    solidBindings: {
      kind: "components",
      inputs: [
        {
          origin: "application",
          kind: "components",
          libraryName: "FixtureSpec",
          packageName: "application",
          sourcePath: path.join(project, "specs"),
        },
      ],
      outputPath: path.join(project, "generated", "FixtureSpec.ts"),
    },
  });
  assert.match(formatNativeGeneratePlan(plan), /generated native'/u);
  await assert.rejects(
    createNativeGeneratePlan({
      cwd: project,
      platform: "ios",
      solidOutputPath: "../outside.ts",
    }),
    /output must be a \.ts file inside the application root/u,
  );
  await assert.rejects(
    createNativeGeneratePlan({
      cwd: project,
      generateSolidBindings: false,
      platform: "ios",
      solidOutputPath: "generated/fixture.ts",
    }),
    /cannot be combined with disabled Solid binding generation/u,
  );

  let executed;
  await mkdir(plan.outputPath, { recursive: true });
  await mkdir(path.dirname(plan.solidBindings.outputPath), {
    recursive: true,
  });
  await writeFile(path.join(plan.outputPath, "last-good.cpp"), "last-good\n");
  await writeFile(plan.solidBindings.outputPath, "preserved-on-failure\n");
  const exitCode = await executeNativeGeneratePlan(plan, {
    env: { SOLID_NATIVE_CODEGEN_TEST: "1" },
    async executor(receivedPlan, context) {
      executed = { context, plan: receivedPlan };
      await mkdir(receivedPlan.outputPath, { recursive: true });
      await writeFile(
        path.join(receivedPlan.outputPath, "partial.cpp"),
        "partial\n",
      );
      return 19;
    },
  });
  assert.equal(exitCode, 19);
  assert.notEqual(executed.plan, plan);
  assert.match(
    executed.plan.outputPath,
    /generated native\.solid-native-[0-9a-f-]+\.tmp$/u,
  );
  assert.equal(
    executed.plan.args[executed.plan.args.indexOf("--outputPath") + 1],
    executed.plan.outputPath,
  );
  assert.equal(executed.context.env.SOLID_NATIVE_CODEGEN_TEST, "1");
  assert.equal(
    await readFile(path.join(plan.outputPath, "last-good.cpp"), "utf8"),
    "last-good\n",
  );
  await assert.rejects(
    readFile(path.join(plan.outputPath, "partial.cpp")),
    /ENOENT/u,
  );
  assert.equal(
    await readFile(plan.solidBindings.outputPath, "utf8"),
    "preserved-on-failure\n",
  );

  let backupCollision;
  await assert.rejects(
    executeNativeGeneratePlan(plan, {
      async executor(receivedPlan) {
        const transactionId = /\.solid-native-([0-9a-f-]+)\.tmp$/u.exec(
          receivedPlan.outputPath,
        )?.[1];
        assert.ok(transactionId);
        await mkdir(receivedPlan.outputPath, { recursive: true });
        await writeFile(
          path.join(receivedPlan.outputPath, "unpublished.cpp"),
          "unpublished\n",
        );
        backupCollision = `${plan.solidBindings.outputPath}.solid-native-${transactionId}.bak`;
        await mkdir(backupCollision);
        return 0;
      },
    }),
    /EISDIR|ENOTEMPTY|EEXIST/u,
  );
  assert.equal(
    await readFile(path.join(plan.outputPath, "last-good.cpp"), "utf8"),
    "last-good\n",
  );
  assert.equal(
    await readFile(plan.solidBindings.outputPath, "utf8"),
    "preserved-on-failure\n",
  );
  await rm(backupCollision, { recursive: true });

  assert.equal(
    await executeNativeGeneratePlan(plan, {
      async executor(receivedPlan) {
        await mkdir(receivedPlan.outputPath, { recursive: true });
        await writeFile(
          path.join(receivedPlan.outputPath, "fresh.cpp"),
          "fresh\n",
        );
        return 0;
      },
    }),
    0,
  );
  assert.equal(
    await readFile(path.join(plan.outputPath, "fresh.cpp"), "utf8"),
    "fresh\n",
  );
  await assert.rejects(
    readFile(path.join(plan.outputPath, "last-good.cpp")),
    /ENOENT/u,
  );
  const solidModule = await readFile(plan.solidBindings.outputPath, "utf8");
  assert.match(solidModule, /FixtureViewNativeComponent/u);
  assert.match(solidModule, /FixtureViewNativeDescriptor/u);
  assert.doesNotMatch(solidModule, /from ["']react(?:-native)?["']/u);
});

test("generates raw TurboModule and mixed Solid bindings", async (t) => {
  const project = await temporaryProject(t);
  const cli = path.join(project, "node_modules", "react-native", "cli.js");
  const specs = path.join(project, "specs");
  await Promise.all([
    mkdir(path.dirname(cli), { recursive: true }),
    mkdir(path.join(project, "ios"), { recursive: true }),
    mkdir(path.join(project, "android"), { recursive: true }),
    mkdir(specs, { recursive: true }),
  ]);
  const manifest = (type) =>
    JSON.stringify({
      codegenConfig: {
        name: "MixedFixtureSpec",
        type,
        jsSrcsDir: "specs",
      },
      dependencies: {
        "@solid-native/core": "0.0.0",
        "@solid-native/fabric-host": "0.0.0",
        "@solid-native/runtime": "0.0.0",
        "react-native": "0.87.0",
      },
    });
  await Promise.all([
    writeFile(path.join(project, "package.json"), manifest("all")),
    writeFile(cli, ""),
    writeFile(
      path.join(specs, "FixtureViewNativeComponent.ts"),
      `import type { HostComponent, ViewProps } from "react-native";
import codegenNativeComponent from "react-native/Libraries/Utilities/codegenNativeComponent";
interface NativeProps extends ViewProps { readonly label?: string; }
export default codegenNativeComponent<NativeProps>("FixtureView") as HostComponent<NativeProps>;
`,
    ),
    writeFile(
      path.join(specs, "NativeFixtureModule.ts"),
      `import type { TurboModule } from "react-native";
import { TurboModuleRegistry } from "react-native";
export interface Spec extends TurboModule {
  readonly read: (key: string) => Promise<Object>;
}
export default TurboModuleRegistry.get<Spec>("FixtureModule");
`,
    ),
  ]);

  const mixedPlan = await createNativeGeneratePlan({
    cwd: project,
    platform: "android",
  });
  assert.equal(mixedPlan.solidBindings.kind, "all");
  assert.equal(
    await executeNativeGeneratePlan(mixedPlan, {
      async executor() {
        return 0;
      },
    }),
    0,
  );
  const mixedSource = await readFile(
    mixedPlan.solidBindings.outputPath,
    "utf8",
  );
  assert.match(mixedSource, /FixtureViewNativeComponent/u);
  assert.match(mixedSource, /FixtureModuleNativeModule/u);
  assert.match(mixedSource, /unknownValueMembers: \["read"\]/u);

  await writeFile(path.join(project, "package.json"), manifest("modules"));
  const modulePlan = await createNativeGeneratePlan({
    cwd: project,
    platform: "android",
    solidOutputPath: "generated/modules.ts",
  });
  assert.equal(modulePlan.solidBindings.kind, "modules");
  assert.equal(
    await executeNativeGeneratePlan(modulePlan, {
      async executor() {
        return 0;
      },
    }),
    0,
  );
  const moduleSource = await readFile(
    modulePlan.solidBindings.outputPath,
    "utf8",
  );
  assert.match(moduleSource, /FixtureModuleNativeModule/u);
  assert.doesNotMatch(moduleSource, /FixtureViewNativeComponent/u);
  assert.doesNotMatch(moduleSource, /from ["']react(?:-native)?["']/u);
});

test("combines explicitly selected dependency Codegen into one Solid module", async (t) => {
  const project = await temporaryProject(t);
  const cli = path.join(project, "node_modules", "react-native", "cli.js");
  const applicationSpecs = path.join(project, "specs");
  const packageName = "@fixture/native-storage";
  const dependencyRoot = path.join(project, "node_modules", packageName);
  const dependencySpecs = path.join(dependencyRoot, "src");
  await Promise.all([
    mkdir(path.dirname(cli), { recursive: true }),
    mkdir(path.join(project, "ios"), { recursive: true }),
    mkdir(path.join(project, "android"), { recursive: true }),
    mkdir(applicationSpecs, { recursive: true }),
    mkdir(dependencySpecs, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(project, "package.json"),
      JSON.stringify({
        name: "dependency-codegen-app",
        codegenConfig: {
          name: "ApplicationSpec",
          type: "components",
          jsSrcsDir: "specs",
        },
        dependencies: {
          "@solid-native/core": "0.0.0",
          "@solid-native/fabric-host": "0.0.0",
          "@solid-native/runtime": "0.0.0",
          [packageName]: "1.0.0",
          "react-native": "0.87.0",
        },
      }),
    ),
    writeFile(cli, ""),
    writeFile(
      path.join(applicationSpecs, "FixtureViewNativeComponent.ts"),
      `import type { HostComponent, ViewProps } from "react-native";
import codegenNativeComponent from "react-native/Libraries/Utilities/codegenNativeComponent";
interface NativeProps extends ViewProps { readonly label?: string; }
export default codegenNativeComponent<NativeProps>("FixtureView") as HostComponent<NativeProps>;
`,
    ),
    writeFile(
      path.join(dependencyRoot, "package.json"),
      JSON.stringify({
        name: packageName,
        version: "1.0.0",
        codegenConfig: {
          name: "FixtureStorageSpec",
          type: "modules",
          jsSrcsDir: "src",
        },
      }),
    ),
    writeFile(
      path.join(dependencySpecs, "NativeFixtureStorage.ts"),
      `import type { TurboModule } from "react-native";
import { TurboModuleRegistry } from "react-native";
export interface Spec extends TurboModule {
  readonly read: (key: string) => Promise<string>;
}
export default TurboModuleRegistry.get<Spec>("FixtureStorage");
`,
    ),
  ]);

  const plan = await createNativeGeneratePlan({
    cwd: project,
    platform: "android",
    solidLibraries: [packageName],
  });
  assert.equal(plan.solidBindings.kind, "all");
  assert.deepEqual(plan.solidBindings.inputs, [
    {
      origin: "application",
      kind: "components",
      libraryName: "ApplicationSpec",
      packageName: "dependency-codegen-app",
      sourcePath: applicationSpecs,
    },
    {
      origin: "dependency",
      kind: "modules",
      libraryName: "FixtureStorageSpec",
      packageName,
      packageVersion: "1.0.0",
      sourcePath: dependencySpecs,
    },
  ]);
  assert.equal(
    plan.solidBindings.outputPath,
    path.join(project, "generated", "SolidNativeBindings.ts"),
  );
  assert.equal(
    await executeNativeGeneratePlan(plan, {
      async executor() {
        return 0;
      },
    }),
    0,
  );
  const generated = await readFile(plan.solidBindings.outputPath, "utf8");
  assert.match(generated, /FixtureViewNativeComponent/u);
  assert.match(generated, /FixtureStorageNativeModule/u);
  assert.match(generated, /SOLID_NATIVE_BINDING_MANIFEST/u);
  assert.match(generated, /"packageVersion":"1\.0\.0"/u);
  assert.match(generated, /bindingSha256: "[a-f0-9]{64}"/u);
  assert.equal(generated.includes(project), false);
  assert.doesNotMatch(generated, /from ["']react(?:-native)?["']/u);
  const audit = createNativeSolidBindingAudit(plan.solidBindings, {
    platform: "android",
  });
  assert.deepEqual(
    audit.components.map((descriptor) => descriptor.name),
    ["FixtureView"],
  );
  assert.deepEqual(
    audit.modules.map((descriptor) => descriptor.name),
    ["FixtureStorage"],
  );
  assert.deepEqual(audit.interfaceOnlyComponents, []);
  assert.equal("sourcePath" in audit.inputs[1], false);
  assert.ok(Object.isFrozen(audit));
  assert.ok(Object.isFrozen(audit.inputs[1]));
  await mkdir(path.join(project, "proof"));
  const proofPath = path.join(project, "proof", "android-device.sh");
  const catalogPath = path.join(project, "solid-native.compatibility.json");
  const compatibilityCatalog = {
    schemaVersion: 0,
    packages: [
      {
        packageName,
        packageVersion: "1.0.0",
        libraryName: "FixtureStorageSpec",
        codegenKind: "modules",
        claims: [
          {
            kind: "module",
            name: "FixtureStorage",
            platform: "android",
            evidenceLevel: "device-verified",
            evidence: [
              {
                path: "proof/android-device.sh",
                sha256:
                  "28d3b9e880a77975493dc7e359144c0295a4f694cfe0af4f928c22307bc5c320",
              },
            ],
          },
        ],
      },
    ],
  };
  await writeFile(proofPath, "exit 0\n");
  const evidenceReport = await createNativeCompatibilityEvidenceReport({
    cwd: project,
    paths: ["proof/android-device.sh"],
  });
  assert.deepEqual(evidenceReport.evidence, [
    {
      path: "proof/android-device.sh",
      sha256:
        "28d3b9e880a77975493dc7e359144c0295a4f694cfe0af4f928c22307bc5c320",
    },
  ]);
  assert.ok(Object.isFrozen(evidenceReport));
  assert.ok(Object.isFrozen(evidenceReport.evidence));
  assert.ok(Object.isFrozen(evidenceReport.evidence[0]));
  await assert.rejects(
    createNativeCompatibilityEvidenceReport({
      cwd: project,
      paths: ["proof/android-device.sh", "proof/android-device.sh"],
    }),
    /requested more than once/u,
  );
  await writeFile(catalogPath, JSON.stringify(compatibilityCatalog));
  const catalogReport = await checkNativeCompatibilityCatalog({
    cwd: project,
    platform: "android",
  });
  assert.equal(catalogReport.ok, true);
  assert.equal(catalogReport.catalogFile, "solid-native.compatibility.json");
  assert.deepEqual(catalogReport.summary, {
    consistent: 1,
    failed: 0,
    unclaimed: 0,
  });
  assert.equal(catalogReport.claims[0].status, "consistent");
  // Package-isolated auditing prevents the application's FixtureView from
  // being attributed to this dependency.
  assert.deepEqual(catalogReport.unclaimedSurfaces, []);

  await writeFile(
    catalogPath,
    JSON.stringify({
      ...compatibilityCatalog,
      packages: [
        {
          ...compatibilityCatalog.packages[0],
          claims: [
            {
              kind: "component",
              name: "FixtureView",
              platform: "android",
              evidenceLevel: "schema-discovered",
              evidence: [],
            },
          ],
        },
      ],
    }),
  );
  const misattributed = await checkNativeCompatibilityCatalog({
    cwd: project,
    platform: "android",
  });
  assert.equal(misattributed.claims[0].status, "surface-missing");
  assert.equal(misattributed.unclaimedSurfaces[0].name, "FixtureStorage");

  await writeFile(catalogPath, JSON.stringify(compatibilityCatalog));
  const externalProofRoot = await mkdtemp(
    path.join(tmpdir(), "solid-native-compatibility-proof-"),
  );
  t.after(async () => {
    await rm(externalProofRoot, { force: true, recursive: true });
  });
  const externalProof = path.join(externalProofRoot, "android-device.sh");
  await writeFile(externalProof, "exit 0\n");
  await rm(proofPath);
  await symlink(externalProof, proofPath);
  await assert.rejects(
    createNativeCompatibilityEvidenceReport({
      cwd: project,
      paths: ["proof/android-device.sh"],
    }),
    /after resolving symlinks/u,
  );
  const escapedEvidence = await checkNativeCompatibilityCatalog({
    cwd: project,
    platform: "android",
  });
  assert.equal(escapedEvidence.claims[0].status, "evidence-missing");
  await rm(proofPath);
  await writeFile(proofPath, "exit 0\n");

  await writeFile(proofPath, "exit 1\n");
  const changedEvidence = await checkNativeCompatibilityCatalog({
    cwd: project,
    platform: "android",
  });
  assert.equal(changedEvidence.ok, false);
  assert.equal(changedEvidence.claims[0].status, "evidence-mismatch");
  assert.match(changedEvidence.claims[0].message, /SHA-256 digest/u);
  await writeFile(proofPath, "exit 0\n");

  const adapterPlan = await createNativeAdapterScaffoldPlan({
    cwd: project,
    moduleName: "FixtureStorage",
    packageName,
    platform: "android",
  });
  assert.equal(adapterPlan.operation, "adapter-create");
  assert.equal(
    adapterPlan.outputPath,
    path.join(project, "adapters", "FixtureStorage.ts"),
  );
  assert.equal(adapterPlan.bindingsImport, "../generated/SolidNativeBindings");
  assert.match(adapterPlan.source, /interface FixtureStorageAdapterPolicy/u);
  assert.match(adapterPlan.source, /policy\.methods\["read"\]/u);
  await assert.rejects(
    createNativeAdapterScaffoldPlan({
      cwd: project,
      moduleName: "FixtureStorage",
      packageName,
      platform: "android",
      outputPath: "generated/SolidNativeBindings.ts",
    }),
    /must differ from its generated binding module/u,
  );
  await executeNativeAdapterScaffoldPlan(adapterPlan);
  const adapterSource = await readFile(adapterPlan.outputPath, "utf8");
  assert.equal(adapterSource, adapterPlan.source);
  await assert.rejects(
    executeNativeAdapterScaffoldPlan(adapterPlan),
    /refusing to overwrite application-owned policy code/u,
  );
  assert.equal(await readFile(adapterPlan.outputPath, "utf8"), adapterSource);
  assert.deepEqual(
    await checkNativeSolidBindingGeneration(plan.solidBindings),
    {
      schemaVersion: 0,
      ok: true,
      outputPath: plan.solidBindings.outputPath,
      status: "match",
    },
  );
  await writeFile(plan.solidBindings.outputPath, "stale\n");
  assert.equal(
    (await checkNativeSolidBindingGeneration(plan.solidBindings)).status,
    "stale",
  );
  await assert.rejects(
    executeNativeAdapterScaffoldPlan({
      ...adapterPlan,
      outputPath: path.join(project, "adapters", "StaleFixtureStorage.ts"),
    }),
    /Generated Solid bindings are stale/u,
  );
  assert.equal(
    (
      await checkNativeSolidBindingGeneration(plan.solidBindings, {
        async readTextFile() {
          const error = new Error("missing");
          error.code = "ENOENT";
          throw error;
        },
      })
    ).status,
    "missing",
  );
  const initialFingerprint = /bindingSha256: "([a-f0-9]{64})"/u.exec(
    generated,
  )?.[1];
  await writeFile(
    path.join(dependencyRoot, "package.json"),
    JSON.stringify({
      name: packageName,
      version: "1.0.1",
      codegenConfig: {
        name: "FixtureStorageSpec",
        type: "modules",
        jsSrcsDir: "src",
      },
    }),
  );
  const versionChangedPlan = await createNativeGeneratePlan({
    cwd: project,
    platform: "android",
    solidLibraries: [packageName],
  });
  const versionChanged = generateNativeSolidBindingSource(
    versionChangedPlan.solidBindings,
  );
  assert.match(versionChanged, /"packageVersion":"1\.0\.1"/u);
  assert.notEqual(
    /bindingSha256: "([a-f0-9]{64})"/u.exec(versionChanged)?.[1],
    initialFingerprint,
  );
  const driftedCatalog = await checkNativeCompatibilityCatalog({
    cwd: project,
    platform: "android",
  });
  assert.equal(driftedCatalog.ok, false);
  assert.equal(driftedCatalog.claims[0].status, "input-mismatch");

  await assert.rejects(
    createNativeGeneratePlan({
      cwd: project,
      platform: "android",
      solidLibraries: ["undeclared-native-library"],
    }),
    /must be declared in the application package\.json/u,
  );
  await assert.rejects(
    createNativeGeneratePlan({
      cwd: project,
      platform: "android",
      solidLibraries: [packageName, packageName],
    }),
    /requested more than once/u,
  );

  await rm(path.join(dependencySpecs, "NativeFixtureStorage.ts"));
  await assert.rejects(
    createNativeGeneratePlan({
      cwd: project,
      platform: "android",
      solidLibraries: [packageName],
    }),
    /declares a modules config[\s\S]*exposes no matching Codegen surface[\s\S]*legacy native module/u,
  );
  await writeFile(
    path.join(dependencySpecs, "NativeFixtureStorage.ts"),
    `import type { TurboModule } from "react-native";
import { TurboModuleRegistry } from "react-native";
export interface Spec extends TurboModule {
  readonly read: (key: string) => Promise<string>;
}
export default TurboModuleRegistry.get<Spec>("FixtureStorage");
`,
  );

  await Promise.all([
    symlink(applicationSpecs, path.join(dependencyRoot, "linked-specs"), "dir"),
    writeFile(
      path.join(dependencyRoot, "package.json"),
      JSON.stringify({
        name: packageName,
        version: "1.0.0",
        codegenConfig: {
          name: "FixtureStorageSpec",
          type: "modules",
          jsSrcsDir: "linked-specs",
        },
      }),
    ),
  ]);
  await assert.rejects(
    createNativeGeneratePlan({
      cwd: project,
      platform: "android",
      solidLibraries: [packageName],
    }),
    /after resolving symlinks/u,
  );
});

test("rejects ambiguous or unsafe compatibility catalog claims", () => {
  const base = {
    schemaVersion: 0,
    packages: [
      {
        packageName: "fixture-native",
        packageVersion: "1.0.0",
        libraryName: "FixtureSpec",
        codegenKind: "components",
        claims: [
          {
            kind: "component",
            name: "FixtureView",
            platform: "android",
            evidenceLevel: "schema-discovered",
            evidence: [],
          },
        ],
      },
    ],
  };
  assert.ok(
    Object.isFrozen(parseNativeCompatibilityCatalog(JSON.stringify(base))),
  );
  assert.throws(
    () =>
      parseNativeCompatibilityCatalog(
        JSON.stringify({ ...base, unsupported: true }),
      ),
    /unknown field unsupported/u,
  );
  assert.throws(
    () =>
      parseNativeCompatibilityCatalog(
        JSON.stringify({
          ...base,
          packages: [
            {
              ...base.packages[0],
              claims: [
                {
                  ...base.packages[0].claims[0],
                  kind: "interface-only-component",
                  evidenceLevel: "binding-generated",
                  evidence: [
                    {
                      path: "generated/Fixture.ts",
                      sha256:
                        "0000000000000000000000000000000000000000000000000000000000000000",
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    /cannot claim a generated binding for an interface-only component/u,
  );
  assert.throws(
    () =>
      parseNativeCompatibilityCatalog(
        JSON.stringify({
          ...base,
          packages: [
            {
              ...base.packages[0],
              claims: [
                {
                  ...base.packages[0].claims[0],
                  evidenceLevel: "device-verified",
                  evidence: [
                    {
                      path: "../escaped-proof.sh",
                      sha256:
                        "0000000000000000000000000000000000000000000000000000000000000000",
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    /application-relative path/u,
  );
  assert.throws(
    () =>
      parseNativeCompatibilityCatalog(
        JSON.stringify({
          ...base,
          packages: [
            {
              ...base.packages[0],
              claims: [
                {
                  ...base.packages[0].claims[0],
                  evidenceLevel: "native-integrated",
                  evidence: [
                    {
                      path: "adapters/Fixture.ts",
                      sha256: "NOT-A-DIGEST",
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    /sha256 is invalid/u,
  );
});

test("prints a machine-readable Codegen plan without generating", async () => {
  const bin = new URL("../dist/bin.js", import.meta.url);
  const { stdout } = await execFileAsync(process.execPath, [
    bin.pathname,
    "generate",
    "--cwd",
    path.resolve("../../apps/native-e2e"),
    "--platform",
    "android",
    "--output",
    ".solid-native/codegen",
    "--dry-run",
    "--json",
  ]);
  const plan = JSON.parse(stdout);
  assert.equal(plan.operation, "generate");
  assert.equal(plan.platform, "android");
  assert.equal(
    plan.outputPath,
    path.resolve("../../apps/native-e2e/.solid-native/codegen"),
  );
  assert.equal(
    plan.solidBindings.outputPath,
    path.resolve("../../apps/native-e2e/generated/SolidNativeE2ESpec.ts"),
  );

  const withDependency = await execFileAsync(process.execPath, [
    bin.pathname,
    "generate",
    "--cwd",
    path.resolve("../../apps/native-e2e"),
    "--platform",
    "android",
    "--solid-library",
    "@react-native-async-storage/async-storage",
    "--solid-library",
    "react-native-notify-kit",
    "--dry-run",
    "--json",
  ]);
  const dependencyPlan = JSON.parse(withDependency.stdout);
  assert.equal(dependencyPlan.solidBindings.kind, "all");
  assert.deepEqual(
    dependencyPlan.solidBindings.inputs.map((input) => input.packageName),
    [
      "@solid-native/native-e2e",
      "@react-native-async-storage/async-storage",
      "react-native-notify-kit",
    ],
  );
  assert.equal(
    dependencyPlan.solidBindings.outputPath,
    path.resolve("../../apps/native-e2e/generated/SolidNativeBindings.ts"),
  );
  const checked = await execFileAsync(process.execPath, [
    bin.pathname,
    "generate",
    "--cwd",
    path.resolve("../../apps/native-e2e"),
    "--platform",
    "android",
    "--solid-library",
    "@react-native-async-storage/async-storage",
    "--solid-library",
    "react-native-notify-kit",
    "--check",
    "--json",
  ]);
  assert.deepEqual(JSON.parse(checked.stdout), {
    schemaVersion: 0,
    ok: true,
    outputPath: path.resolve(
      "../../apps/native-e2e/generated/SolidNativeBindings.ts",
    ),
    status: "match",
  });
  await assert.rejects(
    execFileAsync(process.execPath, [
      bin.pathname,
      "generate",
      "--cwd",
      path.resolve("../../apps/native-e2e"),
      "--check",
      "--dry-run",
    ]),
    /mutually exclusive/u,
  );

  const withoutSolid = await execFileAsync(process.execPath, [
    bin.pathname,
    "generate",
    "--cwd",
    path.resolve("../../apps/native-e2e"),
    "--platform",
    "android",
    "--no-solid",
    "--dry-run",
    "--json",
  ]);
  assert.equal(JSON.parse(withoutSolid.stdout).solidBindings, undefined);

  const adapter = await execFileAsync(process.execPath, [
    bin.pathname,
    "adapter",
    "create",
    "RNAsyncStorage",
    "--cwd",
    path.resolve("../../apps/native-e2e"),
    "--library",
    "@react-native-async-storage/async-storage",
    "--platform",
    "android",
    "--dry-run",
    "--json",
  ]);
  const adapterPlan = JSON.parse(adapter.stdout);
  assert.equal(adapterPlan.operation, "adapter-create");
  assert.equal(adapterPlan.packageVersion, "3.1.1");
  assert.equal(adapterPlan.moduleName, "RNAsyncStorage");
  assert.equal(adapterPlan.bindingsImport, "../generated/SolidNativeBindings");
  assert.match(
    adapterPlan.source,
    /Native method outputs intentionally remain unknown/u,
  );
  assert.doesNotMatch(adapterPlan.source, /@solid-native\/core/u);
});

test("audits the pinned react-native-screens surface without evaluating wrappers", async () => {
  const bin = new URL("../dist/bin.js", import.meta.url);
  const application = path.resolve("../../apps/native-e2e");
  const { stdout } = await execFileAsync(process.execPath, [
    bin.pathname,
    "generate",
    "--cwd",
    application,
    "--platform",
    "all",
    "--solid-library",
    "react-native-screens",
    "--audit",
    "--json",
  ]);
  const audit = JSON.parse(stdout);

  assert.deepEqual(audit.inputs, [
    {
      origin: "application",
      kind: "all",
      libraryName: "SolidNativeE2ESpec",
      packageName: "@solid-native/native-e2e",
      packageVersion: "0.0.0",
    },
    {
      origin: "dependency",
      kind: "all",
      libraryName: "rnscreens",
      packageName: "react-native-screens",
      packageVersion: "4.27.0",
    },
  ]);
  assert.deepEqual(
    audit.components.map((component) => component.name),
    [
      "RNSFormSheetContentWrapper",
      "RNSScreenContainer",
      "RNSScreenContentWrapper",
      "RNSScreenFooter",
      "RNSScreenNavigationContainer",
      "RNSScreenStack",
      "RNSScrollToTopGuard",
      "RNSScrollViewMarker",
      "RNSSearchBar",
      "RNSSplitHost",
      "RNSStackHeaderItemSpacerIOS",
      "RNSStackHost",
      "RNSTabsBottomAccessoryContent",
      "RNSTabsScreenAndroid",
      "RNSTabsScreenIOS",
      "SolidNativeGeneratedView",
    ],
  );
  assert.deepEqual(audit.interfaceOnlyComponents, [
    "RNSFormSheetHost",
    "RNSFullWindowOverlay",
    "RNSModalScreen",
    "RNSSafeAreaView",
    "RNSScreen",
    "RNSScreenStackHeaderConfig",
    "RNSScreenStackHeaderSubview",
    "RNSSplitScreen",
    "RNSStackHeaderConfigAndroid",
    "RNSStackHeaderConfigIOS",
    "RNSStackHeaderItemIOS",
    "RNSStackHeaderSubviewAndroid",
    "RNSStackScreen",
    "RNSTabsBottomAccessory",
    "RNSTabsHostAndroid",
    "RNSTabsHostIOS",
  ]);
  assert.deepEqual(
    audit.modules.map((module) => ({
      name: module.name,
      unknownValueMembers: module.unknownValueMembers,
    })),
    [
      { name: "RNSModule", unknownValueMembers: [] },
      { name: "SolidNativeDebug", unknownValueMembers: [] },
      { name: "SolidNativePlatformAndroid", unknownValueMembers: [] },
    ],
  );
  assert.deepEqual(audit.platformExcludedComponents, []);
  assert.deepEqual(audit.platformExcludedModules, []);
  assert.equal(stdout.includes(application), false);

  const checked = await execFileAsync(process.execPath, [
    bin.pathname,
    "compatibility",
    "check",
    "--cwd",
    application,
    "--json",
  ]);
  const catalog = JSON.parse(checked.stdout);
  assert.equal(catalog.ok, true);
  assert.equal(catalog.catalogFile, "solid-native.compatibility.json");
  assert.equal(catalog.summary.consistent, 19);
  assert.equal(catalog.summary.failed, 0);
  assert.equal(catalog.summary.unclaimed, 38);
  const evidenceOutput = await execFileAsync(process.execPath, [
    bin.pathname,
    "compatibility",
    "evidence",
    "scripts/android-navigation-restoration-test.sh",
    "--cwd",
    application,
    "--json",
  ]);
  const evidence = JSON.parse(evidenceOutput.stdout);
  assert.deepEqual(evidence.evidence, [
    {
      path: "scripts/android-navigation-restoration-test.sh",
      sha256:
        "a5a8e431d397282ad84ac8a1287f989a8f3ba3cfb4236d32dbbb1978f0fbd88b",
    },
  ]);
  assert.deepEqual(
    catalog.claims.map((claim) => ({
      level: claim.evidenceLevel,
      name: claim.name,
      platform: claim.platform,
      status: claim.status,
    })),
    [
      {
        level: "native-integrated",
        name: "RNAsyncStorage",
        platform: "android",
        status: "consistent",
      },
      {
        level: "binding-generated",
        name: "RNAsyncStorage",
        platform: "ios",
        status: "consistent",
      },
      {
        level: "device-verified",
        name: "NotifeeApiModule",
        platform: "android",
        status: "consistent",
      },
      {
        level: "device-verified",
        name: "NotifeeApiModule",
        platform: "ios",
        status: "consistent",
      },
      {
        level: "device-verified",
        name: "RNSScreenStack",
        platform: "android",
        status: "consistent",
      },
      {
        level: "device-verified",
        name: "RNSTabsScreenAndroid",
        platform: "android",
        status: "consistent",
      },
      {
        level: "device-verified",
        name: "RNSScreen",
        platform: "android",
        status: "consistent",
      },
      {
        level: "device-verified",
        name: "RNSScreenStackHeaderConfig",
        platform: "android",
        status: "consistent",
      },
      {
        level: "device-verified",
        name: "RNSScreenStackHeaderSubview",
        platform: "android",
        status: "consistent",
      },
      {
        level: "device-verified",
        name: "RNSTabsHostAndroid",
        platform: "android",
        status: "consistent",
      },
      {
        level: "schema-discovered",
        name: "RNSModule",
        platform: "android",
        status: "consistent",
      },
      {
        level: "device-verified",
        name: "RNSScreenStack",
        platform: "ios",
        status: "consistent",
      },
      {
        level: "native-integrated",
        name: "RNSTabsScreenIOS",
        platform: "ios",
        status: "consistent",
      },
      {
        level: "native-integrated",
        name: "RNSModalScreen",
        platform: "ios",
        status: "consistent",
      },
      {
        level: "device-verified",
        name: "RNSScreen",
        platform: "ios",
        status: "consistent",
      },
      {
        level: "device-verified",
        name: "RNSScreenStackHeaderConfig",
        platform: "ios",
        status: "consistent",
      },
      {
        level: "device-verified",
        name: "RNSScreenStackHeaderSubview",
        platform: "ios",
        status: "consistent",
      },
      {
        level: "native-integrated",
        name: "RNSTabsHostIOS",
        platform: "ios",
        status: "consistent",
      },
      {
        level: "schema-discovered",
        name: "RNSModule",
        platform: "ios",
        status: "consistent",
      },
    ],
  );
});

test("starts the application-local verified Solid Metro server transparently", async (t) => {
  const project = await temporaryProject(t);
  const cli = path.join(project, "node_modules", "react-native", "cli.js");
  await mkdir(path.dirname(cli), { recursive: true });
  await Promise.all([
    writeFile(
      path.join(project, "package.json"),
      JSON.stringify({
        dependencies: verifiedApplicationDependencies,
        devDependencies: verifiedApplicationDevDependencies,
      }),
    ),
    writeFile(cli, ""),
  ]);
  await Promise.all([
    installSolidNativePair(project),
    installVerifiedJavaScriptApplication(project),
    installReactNativeHermesPair(project),
  ]);

  const plan = await createNativeStartPlan({
    cwd: project,
    forwardedArgs: ["--port", "9090", "--reset-cache"],
  });
  assert.deepEqual(plan, {
    schemaVersion: 0,
    operation: "start",
    projectRoot: project,
    command: process.execPath,
    args: [cli, "start", "--port", "9090", "--reset-cache"],
  });
  assert.match(formatNativeStartPlan(plan), /start --port 9090 --reset-cache/u);

  let executed;
  const exitCode = await executeNativeStartPlan(plan, {
    env: { SOLID_NATIVE_START_TEST: "1" },
    async executor(receivedPlan, context) {
      executed = { context, plan: receivedPlan };
      return 17;
    },
  });
  assert.equal(exitCode, 17);
  assert.equal(executed.plan, plan);
  assert.equal(executed.context.env.SOLID_NATIVE_START_TEST, "1");
});

test("prints a machine-readable Metro start plan without listening", async () => {
  const bin = new URL("../dist/bin.js", import.meta.url);
  const { stdout } = await execFileAsync(process.execPath, [
    bin.pathname,
    "start",
    "--cwd",
    path.resolve("../../apps/native-e2e"),
    "--dry-run",
    "--json",
    "--",
    "--port",
    "9090",
  ]);
  const plan = JSON.parse(stdout);
  assert.equal(plan.operation, "start");
  assert.deepEqual(plan.args.slice(-3), ["start", "--port", "9090"]);
});

test("forwards termination to an active native process", async () => {
  // Run the signal assertion in a child so a regression exercises only that
  // process's signal disposition, never the Node test coordinator's.
  const indexURL = new URL("../dist/index.js", import.meta.url).href;
  const nativeProcessSource =
    process.platform === "win32"
      ? 'process.on("SIGTERM", () => process.exit(7)); setInterval(() => {}, 1000)'
      : `
          const { spawn } = require("node:child_process");
          spawn(process.execPath, ["--eval", "setInterval(() => {}, 1000)"], {
            stdio: "inherit",
          });
          process.on("SIGTERM", () => process.exit(7));
          setInterval(() => {}, 1000);
        `;
  const source = `
    import { defaultNativeRunExecutor } from ${JSON.stringify(indexURL)};
    const execution = defaultNativeRunExecutor({
      schemaVersion: 0,
      operation: "run",
      platform: "android",
      projectRoot: process.cwd(),
      command: process.execPath,
      args: ["--eval", ${JSON.stringify(nativeProcessSource)}],
    }, { env: process.env });
    setTimeout(() => process.kill(process.pid, "SIGTERM"), 100);
    process.stdout.write(String(await execution));
  `;
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--input-type=module", "--eval", source],
    { timeout: 5_000 },
  );
  assert.equal(stdout, "143");

  const listenerCounts = Object.fromEntries(
    ["SIGHUP", "SIGINT", "SIGTERM"].map((signal) => [
      signal,
      process.listenerCount(signal),
    ]),
  );
  const exitCode = await defaultNativeRunExecutor(
    {
      schemaVersion: 0,
      operation: "run",
      platform: "android",
      projectRoot: process.cwd(),
      command: process.execPath,
      args: ["--eval", "process.exit(7)"],
    },
    { env: process.env },
  );
  assert.equal(exitCode, 7);
  for (const [signal, count] of Object.entries(listenerCounts)) {
    assert.equal(process.listenerCount(signal), count);
  }
});
