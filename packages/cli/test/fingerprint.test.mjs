import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  createNativeFingerprint,
  formatNativeFingerprint,
} from "../dist/index.js";

const execFileAsync = promisify(execFile);

async function temporaryDirectory(t) {
  const directory = await mkdtemp(
    path.join(tmpdir(), "solid-native-fingerprint-"),
  );
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

async function writeFixture(project) {
  const files = new Map([
    [
      "package.json",
      `${JSON.stringify(
        {
          name: "fingerprint-fixture",
          packageManager: "pnpm@9.15.0",
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
        },
        null,
        2,
      )}\n`,
    ],
    ["pnpm-lock.yaml", "lockfileVersion: '9.0'\n"],
    [
      "metro.config.js",
      "solidNativeTransformWorkerPath\ncreateSolidNativeMetroResolver\ncreateSolidNativeFullReloadPattern\nunstable_forceFullRefreshPatterns\n",
    ],
    [
      "src/main.tsx",
      'import { startNativeApplication } from "@solid-native/runtime";\nstartNativeApplication(() => null);\n',
    ],
    ["src/App.tsx", "export const App = () => null;\n"],
    ["android/settings.gradle", "pluginManagement {}\n"],
    ["android/build.gradle", "plugins {}\n"],
    ["android/gradle.properties", "newArchEnabled=true\nhermesEnabled=true\n"],
    [
      "android/gradle/wrapper/gradle-wrapper.properties",
      "distributionUrl=https://example.invalid/gradle-9.4.1-bin.zip\n",
    ],
    [
      "android/app/build.gradle",
      "require.resolve('@solid-native/fabric-host/android-gradle')\n",
    ],
    ["android/app/proguard-rules.pro", "# application rules\n"],
    [
      "android/app/src/main/AndroidManifest.xml",
      '<manifest package="dev.solidnative.fingerprint" />\n',
    ],
    [
      "android/app/src/main/jni/CMakeLists.txt",
      "solid_native_configure_android_target(appmodules)\n",
    ],
    [
      "android/app/src/main/jni/OnLoad.cpp",
      "void JNI_OnLoad() { registerSolidNativeBindingsInstaller(); }\n",
    ],
    [
      "android/app/src/main/java/dev/fixture/MainApplication.kt",
      "val bindingsInstaller = SolidNativeBindingsInstaller()\n",
    ],
    [
      "android/app/src/main/java/dev/fixture/MainActivity.kt",
      "SolidNativeSurface.start(activity, reactHost, bindingsInstaller)\n",
    ],
    ["ios/Podfile", "pod 'SolidNativeFabric'\n"],
    ["ios/Podfile.lock", "PODS:\n  - SolidNativeFabric (0.0.0)\n"],
    [
      "ios/Fingerprint.xcodeproj/project.pbxproj",
      "// !$*UTF8*$!\nPRODUCT_BUNDLE_IDENTIFIER = dev.solidnative.fingerprint;\n",
    ],
    [
      "ios/Fingerprint/AppDelegate.swift",
      "import SolidNativeFabric\nSolidNativeFabricApplication.start()\n",
    ],
    ["ios/Fingerprint/Info.plist", "<plist><dict></dict></plist>\n"],
    ["ios/Fingerprint/PrivacyInfo.xcprivacy", "<plist><dict></dict></plist>\n"],
    [
      "node_modules/@solid-native/core/package.json",
      '{"name":"@solid-native/core","version":"0.0.0"}\n',
    ],
    ["node_modules/@solid-native/core/Z.js", "export const upper = true;\n"],
    ["node_modules/@solid-native/core/a.js", "export const lower = true;\n"],
    ["node_modules/@solid-native/core/ä.js", "export const umlaut = true;\n"],
    [
      "node_modules/@solid-native/fabric-host/package.json",
      '{"name":"@solid-native/fabric-host","version":"0.0.0"}\n',
    ],
    [
      "node_modules/@solid-native/fabric-host/native/fabric/SolidNativeFabricApi.cpp",
      "export const nativeAdapterFingerprint = true;\n",
    ],
    [
      "node_modules/@solid-native/runtime/package.json",
      '{"name":"@solid-native/runtime","version":"0.0.0"}\n',
    ],
    [
      "node_modules/@solid-native/metro/package.json",
      '{"name":"@solid-native/metro","version":"0.0.0"}\n',
    ],
    [
      "node_modules/@solid-native/compiler/package.json",
      '{"name":"@solid-native/compiler","version":"0.0.0","main":"index.js"}\n',
    ],
    [
      "node_modules/@solid-native/compiler/index.js",
      "export function transform() {}\n",
    ],
  ]);
  await Promise.all(
    [...files].map(async ([relativePath, source]) => {
      const target = path.join(project, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, source);
    }),
  );
}

function target(report, platform) {
  const value = report.targets.find((entry) => entry.platform === platform);
  assert.ok(value, platform);
  return value;
}

test("creates path-independent deterministic platform compatibility fingerprints", async (t) => {
  const firstProject = path.join(await temporaryDirectory(t), "first");
  const secondProject = path.join(await temporaryDirectory(t), "second");
  await Promise.all([writeFixture(firstProject), writeFixture(secondProject)]);

  const [first, repeated, second] = await Promise.all([
    createNativeFingerprint({ cwd: firstProject }),
    createNativeFingerprint({ cwd: firstProject }),
    createNativeFingerprint({ cwd: secondProject }),
  ]);
  assert.deepEqual(first.targets, repeated.targets);
  assert.deepEqual(first.targets, second.targets);
  assert.deepEqual(
    first.targets.map((entry) => entry.platform),
    ["ios", "android"],
  );
  for (const platform of ["ios", "android"]) {
    const result = target(first, platform);
    assert.match(result.fingerprint, /^sha256:[a-f0-9]{64}$/u);
    assert.deepEqual(
      result.inputs.map((input) => input.path),
      result.inputs.map((input) => input.path).toSorted(),
    );
    assert.ok(result.inputs.every((input) => !path.isAbsolute(input.path)));
  }
  assert.doesNotMatch(
    JSON.stringify(first.targets),
    /firstProject|\/private\//u,
  );
  assert.match(formatNativeFingerprint(first), /Unsigned local identity/u);
});

test("isolates native drift by platform and excludes ordinary application source", async (t) => {
  const project = await temporaryDirectory(t);
  await writeFixture(project);
  const before = await createNativeFingerprint({ cwd: project });

  await writeFile(
    path.join(project, "src", "App.tsx"),
    "export const App = () => 'ordinary source changed';\n",
  );
  const sourceChanged = await createNativeFingerprint({ cwd: project });
  assert.deepEqual(sourceChanged.targets, before.targets);

  await writeFile(
    path.join(project, "android/app/src/main/jni/OnLoad.cpp"),
    "void JNI_OnLoad() { registerSolidNativeBindingsInstaller(); /* changed */ }\n",
  );
  const nativeChanged = await createNativeFingerprint({ cwd: project });
  assert.equal(
    target(nativeChanged, "ios").fingerprint,
    target(before, "ios").fingerprint,
  );
  assert.notEqual(
    target(nativeChanged, "android").fingerprint,
    target(before, "android").fingerprint,
  );

  await writeFile(
    path.join(project, "node_modules/@solid-native/compiler/index.js"),
    "export function transform() { return 'repacked'; }\n",
  );
  const compilerChanged = await createNativeFingerprint({ cwd: project });
  assert.notEqual(
    target(compilerChanged, "ios").fingerprint,
    target(nativeChanged, "ios").fingerprint,
  );
  assert.notEqual(
    target(compilerChanged, "android").fingerprint,
    target(nativeChanged, "android").fingerprint,
  );
});

test("fails closed when a required compatibility input is absent", async (t) => {
  const project = await temporaryDirectory(t);
  await writeFixture(project);
  await rm(path.join(project, "ios", "Podfile.lock"));

  await assert.rejects(
    createNativeFingerprint({ cwd: project, platform: "ios" }),
    /ios\/Podfile\.lock is missing or unreadable/u,
  );
});

test("prints a single-platform machine-readable fingerprint", async () => {
  const bin = new URL("../dist/bin.js", import.meta.url);
  const { stdout } = await execFileAsync(process.execPath, [
    bin.pathname,
    "fingerprint",
    "--cwd",
    path.resolve("../../apps/native-e2e"),
    "--platform",
    "android",
    "--json",
  ]);
  const report = JSON.parse(stdout);
  assert.equal(report.schemaVersion, 0);
  assert.equal(report.targets.length, 1);
  assert.equal(report.targets[0].platform, "android");
  assert.match(report.targets[0].fingerprint, /^sha256:[a-f0-9]{64}$/u);
});
