import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  auditNativeReactNativeUpgrade,
  formatNativeReactNativeUpgradeReport,
} from "../dist/index.js";

const execFileAsync = promisify(execFile);

async function temporaryDirectory(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "solid-native-upgrade-"));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

async function writeJson(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
}

async function installManifest(project, packageName, manifest) {
  const packageRoot = path.join(project, "node_modules", packageName);
  await writeJson(path.join(packageRoot, "package.json"), {
    name: packageName,
    ...manifest,
  });
  return packageRoot;
}

async function writeUpgradeProject(
  project,
  {
    reactNativeVersion,
    runtimeVersion = reactNativeVersion.replace(/[-+].*$/u, ""),
    hermesVersion,
    bytecodeVersion,
    boundaryVersion = reactNativeVersion,
    declaredHermesVersion = hermesVersion,
    headerSource = `// UIManager ${reactNativeVersion}\n`,
    additionalHeaders = [],
  },
) {
  const codegenVersion = reactNativeVersion;
  const gradlePluginVersion = reactNativeVersion;
  await writeJson(path.join(project, "package.json"), {
    name: `fixture-${runtimeVersion.replaceAll(".", "-")}`,
    dependencies: {
      "@solid-native/fabric-host": "0.0.0",
      react: "19.2.3",
      "react-native": reactNativeVersion,
    },
    devDependencies: {
      "@react-native/codegen": codegenVersion,
      "@react-native/gradle-plugin": gradlePluginVersion,
      "hermes-compiler": declaredHermesVersion,
    },
  });
  await writeFile(
    path.join(project, "pnpm-lock.yaml"),
    `lockfileVersion: '9.0'\n# ${reactNativeVersion}\n`,
  );

  const reactNative = await installManifest(project, "react-native", {
    version: reactNativeVersion,
    dependencies: {
      "@react-native/codegen": codegenVersion,
      "@react-native/gradle-plugin": gradlePluginVersion,
      "hermes-compiler": hermesVersion,
    },
    peerDependencies: { react: "^19.2.3" },
  });
  const [major, minor, patch] = runtimeVersion.split(".");
  await mkdir(path.join(reactNative, "ReactCommon", "cxxreact"), {
    recursive: true,
  });
  await writeFile(
    path.join(reactNative, "ReactCommon", "cxxreact", "ReactNativeVersion.h"),
    `#define REACT_NATIVE_VERSION_MAJOR ${major}\n#define REACT_NATIVE_VERSION_MINOR ${minor}\n#define REACT_NATIVE_VERSION_PATCH ${patch}\n`,
  );
  await mkdir(
    path.join(reactNative, "ReactCommon", "react", "renderer", "uimanager"),
    { recursive: true },
  );
  await writeFile(
    path.join(
      reactNative,
      "ReactCommon",
      "react",
      "renderer",
      "uimanager",
      "UIManager.h",
    ),
    headerSource,
  );
  for (const header of additionalHeaders) {
    const target = path.join(reactNative, "ReactCommon", ...header.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `// ${header} ${reactNativeVersion}\n`);
  }

  const compiler = await installManifest(project, "hermes-compiler", {
    version: hermesVersion,
  });
  await Promise.all([
    mkdir(path.join(compiler, "hermesc", "osx-bin"), { recursive: true }),
    mkdir(path.join(compiler, "hermesc", "linux64-bin"), {
      recursive: true,
    }),
    mkdir(path.join(compiler, "hermesc", "win64-bin"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(compiler, "hermesc", "osx-bin", "hermesc"), ""),
    writeFile(path.join(compiler, "hermesc", "linux64-bin", "hermesc"), ""),
    writeFile(path.join(compiler, "hermesc", "win64-bin", "hermesc.exe"), ""),
  ]);
  await Promise.all([
    installManifest(project, "react", { version: "19.2.3" }),
    installManifest(project, "@react-native/codegen", {
      version: codegenVersion,
    }),
    installManifest(project, "@react-native/gradle-plugin", {
      version: gradlePluginVersion,
    }),
    installManifest(project, "metro-transform-worker", { version: "0.87.0" }),
  ]);

  const fabricHost = await installManifest(
    project,
    "@solid-native/fabric-host",
    {
      version: "0.0.0",
      exports: {
        "./react-native-boundary": "./native/react-native-boundary.json",
      },
    },
  );
  await writeJson(
    path.join(fabricHost, "native", "react-native-boundary.json"),
    {
      schemaVersion: 1,
      reactNativeVersion: boundaryVersion,
      nativeHeaders: [
        "react/renderer/uimanager/UIManager.h",
        "fbjni/fbjni.h",
        ...additionalHeaders,
      ],
      generatedCodegenHeaders: ["FixtureSpec/FixtureSpec.h"],
      androidImports: ["com.facebook.react.ReactHost"],
      cocoapods: [{ name: "React-Fabric/core", version: "= 0.87.0" }],
      androidCmake: {
        reactNativeIncludeDirectories: ["${REACT_ANDROID_DIR}/../ReactCommon"],
        inheritedCompileOptions: ["${folly_FLAGS}"],
      },
    },
  );
  return { bytecodeVersion, hermesVersion };
}

function compilerRunner(projects) {
  return async (_compilerPath, cwd) => {
    const project = projects.get(cwd);
    assert.ok(project, `Unexpected compiler cwd ${cwd}`);
    return {
      exitCode: 0,
      stdout: `Hermes release version: ${project.hermesVersion}\nHBC bytecode version: ${project.bytecodeVersion}\n`,
      stderr: "",
    };
  };
}

test("audits an isolated React Native candidate without promoting it", async (t) => {
  const root = await temporaryDirectory(t);
  const source = path.join(root, "source");
  const candidate = path.join(root, "candidate");
  const sourceIdentity = await writeUpgradeProject(source, {
    reactNativeVersion: "0.87.0",
    hermesVersion: "250829098.0.16",
    bytecodeVersion: 98,
  });
  const candidateIdentity = await writeUpgradeProject(candidate, {
    reactNativeVersion: "0.88.0-nightly-20260825-5a29c68af",
    runtimeVersion: "0.88.0",
    hermesVersion: "260318099.0.1",
    bytecodeVersion: 99,
    additionalHeaders: ["react/renderer/core/NewCandidateAPI.h"],
  });

  const report = await auditNativeReactNativeUpgrade({
    cwd: source,
    candidate,
    dependencies: {
      hostPlatform: "darwin",
      runCompiler: compilerRunner(
        new Map([
          [source, sourceIdentity],
          [candidate, candidateIdentity],
        ]),
      ),
    },
  });

  assert.equal(report.ok, true);
  assert.equal(report.candidateSupported, false);
  assert.equal(report.promotionReady, false);
  assert.equal(report.source?.packageVersion, "0.87.0");
  assert.equal(
    report.candidate?.packageVersion,
    "0.88.0-nightly-20260825-5a29c68af",
  );
  assert.equal(report.candidate?.runtimeVersion, "0.88.0");
  assert.equal(report.candidate?.hermesBytecodeVersion, 99);
  assert.deepEqual(report.boundary?.changedHeaders, [
    "react/renderer/uimanager/UIManager.h",
  ]);
  assert.deepEqual(report.boundary?.externalHeaders, ["fbjni/fbjni.h"]);
  assert.deepEqual(report.boundary?.addedHeaders, [
    "react/renderer/core/NewCandidateAPI.h",
  ]);
  assert.deepEqual(report.boundary?.missingHeaders, []);
  assert.ok(report.qualificationGates.length >= 7);
  assert.match(
    formatNativeReactNativeUpgradeReport(report),
    /Backend promotion remains false/u,
  );
});

test("rejects a guessed Hermes compiler instead of trusting a native build", async (t) => {
  const root = await temporaryDirectory(t);
  const source = path.join(root, "source");
  const candidate = path.join(root, "candidate");
  const sourceIdentity = await writeUpgradeProject(source, {
    reactNativeVersion: "0.87.0",
    hermesVersion: "250829098.0.16",
    bytecodeVersion: 98,
  });
  const candidateIdentity = await writeUpgradeProject(candidate, {
    reactNativeVersion: "0.88.0",
    hermesVersion: "260318099.0.1",
    declaredHermesVersion: "250829098.0.17",
    bytecodeVersion: 99,
  });

  const report = await auditNativeReactNativeUpgrade({
    cwd: source,
    candidate,
    dependencies: {
      hostPlatform: "darwin",
      runCompiler: compilerRunner(
        new Map([
          [source, sourceIdentity],
          [candidate, candidateIdentity],
        ]),
      ),
    },
  });

  assert.equal(report.ok, false);
  assert.match(
    report.checks.find((entry) => entry.id === "candidate.hermes.pair")
      ?.message,
    /requires 260318099\.0\.1.*declares 250829098\.0\.17/u,
  );
});

test("requires the candidate Fabric boundary to name the exact package release", async (t) => {
  const root = await temporaryDirectory(t);
  const source = path.join(root, "source");
  const candidate = path.join(root, "candidate");
  const sourceIdentity = await writeUpgradeProject(source, {
    reactNativeVersion: "0.87.0",
    hermesVersion: "250829098.0.16",
    bytecodeVersion: 98,
  });
  const candidateIdentity = await writeUpgradeProject(candidate, {
    reactNativeVersion: "0.88.0-nightly-20260825-5a29c68af",
    runtimeVersion: "0.88.0",
    hermesVersion: "260318099.0.1",
    bytecodeVersion: 99,
    boundaryVersion: "0.88.0",
  });

  const report = await auditNativeReactNativeUpgrade({
    cwd: source,
    candidate,
    dependencies: {
      hostPlatform: "darwin",
      runCompiler: compilerRunner(
        new Map([
          [source, sourceIdentity],
          [candidate, candidateIdentity],
        ]),
      ),
    },
  });

  assert.equal(report.ok, false);
  assert.match(
    report.checks.find(
      (entry) => entry.id === "candidate.fabric-boundary.version",
    )?.message,
    /declares React Native 0\.88\.0.*installs 0\.88\.0-nightly/u,
  );
});

test("exposes the read-only upgrade command and requires a candidate", async () => {
  const bin = new URL("../dist/bin.js", import.meta.url);
  const help = await execFileAsync(process.execPath, [
    bin.pathname,
    "upgrade",
    "--help",
  ]);
  assert.match(help.stdout, /upgrade react-native --candidate PATH/u);
  await assert.rejects(
    execFileAsync(process.execPath, [bin.pathname, "upgrade", "react-native"]),
    (error) => {
      assert.match(
        error.stderr,
        /upgrade react-native requires --candidate PATH/u,
      );
      return true;
    },
  );
});
