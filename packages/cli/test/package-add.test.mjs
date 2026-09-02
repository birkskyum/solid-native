import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  createNativePackageAddPlan,
  executeNativePackageAddPlan,
  formatNativePackageAddPlan,
} from "../dist/index.js";

const execFileAsync = promisify(execFile);

async function temporaryProject(t, manifest = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "solid-native-add-"));
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify(
      {
        name: "fixture",
        private: true,
        packageManager: "pnpm@9.15.0",
        dependencies: {
          "@solid-native/core": "0.0.0",
          "react-native": "0.87.0",
        },
        ...manifest,
      },
      null,
      2,
    )}\n`,
  );
  return root;
}

function digest(source) {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

async function installNavigationFixture(projectRoot, version, patchSource) {
  const coreRoot = path.join(
    projectRoot,
    "node_modules",
    "@solid-native",
    "core",
  );
  const packageRoot = path.join(
    projectRoot,
    "node_modules",
    "@solid-native",
    "navigation",
  );
  const screensRoot = path.join(
    projectRoot,
    "node_modules",
    "react-native-screens",
  );
  const installedBackendSource = "verified installed navigation backend\n";
  await mkdir(coreRoot, { recursive: true });
  await mkdir(path.join(packageRoot, "backend"), { recursive: true });
  await mkdir(path.join(packageRoot, "patches"), { recursive: true });
  await mkdir(path.join(screensRoot, "native"), { recursive: true });
  await writeFile(
    path.join(coreRoot, "package.json"),
    `${JSON.stringify({ name: "@solid-native/core", version })}\n`,
  );
  await writeFile(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify({
      name: "@solid-native/navigation",
      version,
    })}\n`,
  );
  await writeFile(
    path.join(packageRoot, "backend", "react-native-screens-4.27.0.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      packageName: "react-native-screens",
      packageVersion: "4.27.0",
      reactNativeVersion: "0.87.0",
      patch: {
        path: "patches/react-native-screens@4.27.0.patch",
        sha256: digest(patchSource),
      },
      installedFiles: [
        {
          path: "native/verified.txt",
          sha256: digest(installedBackendSource),
        },
      ],
    })}\n`,
  );
  await writeFile(
    path.join(packageRoot, "patches", "react-native-screens@4.27.0.patch"),
    patchSource,
  );
  await writeFile(
    path.join(screensRoot, "package.json"),
    `${JSON.stringify({ name: "react-native-screens", version: "4.27.0" })}\n`,
  );
  await writeFile(
    path.join(screensRoot, "native", "verified.txt"),
    installedBackendSource,
  );
}

test("plans the exact reviewed navigation installation without mutation", async (t) => {
  const project = await temporaryProject(t);
  const nested = path.join(project, "src", "screens");
  await mkdir(nested, { recursive: true });
  const plan = await createNativePackageAddPlan({
    capability: "navigation",
    cwd: nested,
  });

  assert.equal(plan.operation, "add");
  assert.equal(plan.installMode, "add");
  assert.equal(plan.projectRoot, await realpath(project));
  assert.equal(plan.packageManager, "pnpm@9.15.0");
  assert.deepEqual(plan.packages, [
    { name: "@solid-native/navigation", version: "0.0.0" },
    { name: "react-native-screens", version: "4.27.0" },
  ]);
  assert.deepEqual(plan.installCommand.args, [
    "add",
    "--save-exact",
    "--ignore-workspace-root-check",
    "@solid-native/navigation@0.0.0",
    "react-native-screens@4.27.0",
  ]);
  assert.deepEqual(plan.finalizeCommand.args, [
    "install",
    "--no-frozen-lockfile",
  ]);
  assert.match(
    formatNativePackageAddPlan(plan),
    /pnpm add --save-exact --ignore-workspace-root-check @solid-native\/navigation@0\.0\.0 react-native-screens@4\.27\.0[\s\S]*patches\/react-native-screens@4\.27\.0\.patch[\s\S]*pnpm install --no-frozen-lockfile/u,
  );
  const unchanged = JSON.parse(
    await readFile(path.join(project, "package.json"), "utf8"),
  );
  assert.equal(unchanged.dependencies["@solid-native/navigation"], undefined);
});

test("installs and reapplies the content-addressed navigation patch", async (t) => {
  const project = await temporaryProject(t, {
    pnpm: {
      onlyBuiltDependencies: ["react-native-screens"],
      patchedDependencies: {
        "another-package@1.0.0": "patches/another.patch",
      },
    },
  });
  const plan = await createNativePackageAddPlan({
    capability: "navigation",
    cwd: project,
  });
  await chmod(path.join(project, "package.json"), 0o600);
  assert.equal(plan.installMode, "add");
  assert.deepEqual(plan.installCommand.args, [
    "add",
    "--save-exact",
    "--ignore-workspace-root-check",
    "@solid-native/navigation@0.0.0",
    "react-native-screens@4.27.0",
  ]);
  const commands = [];
  const patchSource =
    "diff --git a/native b/native\nverified navigation patch\n";
  const exitCode = await executeNativePackageAddPlan(plan, {
    executor: async (command) => {
      commands.push(command);
      if (commands.length === 1) {
        const manifestPath = path.join(project, "package.json");
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        manifest.dependencies["@solid-native/navigation"] = "0.0.0";
        manifest.dependencies["react-native-screens"] = "4.27.0";
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        await installNavigationFixture(project, "0.0.0", patchSource);
      } else {
        const manifest = JSON.parse(
          await readFile(path.join(project, "package.json"), "utf8"),
        );
        assert.deepEqual(manifest.pnpm.onlyBuiltDependencies, [
          "react-native-screens",
        ]);
        assert.equal(
          manifest.pnpm.patchedDependencies["another-package@1.0.0"],
          "patches/another.patch",
        );
        assert.equal(
          manifest.pnpm.patchedDependencies["react-native-screens@4.27.0"],
          "patches/react-native-screens@4.27.0.patch",
        );
        assert.equal(
          await readFile(plan.patch.targetPath, "utf8"),
          patchSource,
        );
      }
      return 0;
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(commands.length, 2);
  assert.equal(
    (await stat(path.join(project, "package.json"))).mode & 0o777,
    0o600,
  );

  const secondPass = await executeNativePackageAddPlan(plan, {
    executor: async () => 0,
  });
  assert.equal(secondPass, 0);
  assert.equal(await readFile(plan.patch.targetPath, "utf8"), patchSource);
});

test("fails closed on dependency, package-manager, and patch conflicts", async (t) => {
  const wrongManager = await temporaryProject(t, {
    packageManager: "npm@11.0.0",
  });
  await assert.rejects(
    createNativePackageAddPlan({
      capability: "navigation",
      cwd: wrongManager,
    }),
    /requires pnpm@9\.15\.0/u,
  );

  const conflictingDependency = await temporaryProject(t, {
    dependencies: {
      "@solid-native/core": "0.0.0",
      "@solid-native/navigation": "latest",
      "react-native": "0.87.0",
    },
  });
  await assert.rejects(
    createNativePackageAddPlan({
      capability: "navigation",
      cwd: conflictingDependency,
    }),
    /must be an exact application dependency at 0\.0\.0/u,
  );

  const conflictingPatch = await temporaryProject(t, {
    dependencies: {
      "@solid-native/core": "0.0.0",
      "@solid-native/navigation": "0.0.0",
      "react-native": "0.87.0",
      "react-native-screens": "4.27.0",
    },
  });
  const plan = await createNativePackageAddPlan({
    capability: "navigation",
    cwd: conflictingPatch,
  });
  await mkdir(path.dirname(plan.patch.targetPath), { recursive: true });
  await writeFile(plan.patch.targetPath, "application-owned different patch\n");
  await installNavigationFixture(conflictingPatch, "0.0.0", "verified patch\n");
  let calls = 0;
  await assert.rejects(
    executeNativePackageAddPlan(plan, {
      executor: async () => {
        calls += 1;
        return 0;
      },
    }),
    /Refusing to overwrite the different application-owned patch/u,
  );
  assert.equal(calls, 1);
});

test("rejects redirected targets and tampered executable plans", async (t) => {
  const project = await temporaryProject(t, {
    dependencies: {
      "@solid-native/core": "0.0.0",
      "@solid-native/navigation": "0.0.0",
      "react-native": "0.87.0",
      "react-native-screens": "4.27.0",
    },
  });
  const plan = await createNativePackageAddPlan({
    capability: "navigation",
    cwd: project,
  });
  assert.equal(plan.installMode, "install");
  assert.deepEqual(plan.installCommand.args, [
    "install",
    "--no-frozen-lockfile",
  ]);
  let calls = 0;
  await assert.rejects(
    executeNativePackageAddPlan(
      {
        ...plan,
        patch: {
          ...plan.patch,
          targetPath: path.join(tmpdir(), "escape.patch"),
        },
      },
      {
        executor: async () => {
          calls += 1;
          return 0;
        },
      },
    ),
    /package-add plan is invalid/u,
  );
  assert.equal(calls, 0);

  await assert.rejects(
    executeNativePackageAddPlan(
      {
        ...plan,
        packages: [
          { name: "@solid-native/navigation", version: "9.9.9" },
          plan.packages[1],
        ],
      },
      {
        executor: async () => {
          calls += 1;
          return 0;
        },
      },
    ),
    /package-add plan is invalid/u,
  );
  assert.equal(calls, 0);

  const patchSource = "verified patch\n";
  await installNavigationFixture(project, "0.0.0", patchSource);
  await mkdir(path.dirname(plan.patch.targetPath), { recursive: true });
  const externalPatch = path.join(project, "external.patch");
  await writeFile(externalPatch, patchSource);
  await symlink(externalPatch, plan.patch.targetPath);
  await assert.rejects(
    executeNativePackageAddPlan(plan, {
      executor: async () => {
        calls += 1;
        return 0;
      },
    }),
    /patch target must be a regular file/u,
  );
  assert.equal(calls, 1);
});

test("does not report success when pnpm leaves unpatched native bytes", async (t) => {
  const project = await temporaryProject(t, {
    dependencies: {
      "@solid-native/core": "0.0.0",
      "@solid-native/navigation": "0.0.0",
      "react-native": "0.87.0",
      "react-native-screens": "4.27.0",
    },
  });
  const plan = await createNativePackageAddPlan({
    capability: "navigation",
    cwd: project,
  });
  await installNavigationFixture(project, "0.0.0", "verified patch\n");
  let calls = 0;
  await assert.rejects(
    executeNativePackageAddPlan(plan, {
      executor: async () => {
        calls += 1;
        if (calls === 2) {
          await writeFile(
            path.join(
              project,
              "node_modules",
              "react-native-screens",
              "native",
              "verified.txt",
            ),
            "unpatched backend\n",
          );
        }
        return 0;
      },
    }),
    /did not apply the verified navigation patch/u,
  );
  assert.equal(calls, 2);
});

test("exposes a non-mutating machine-readable navigation recipe", async (t) => {
  const project = await temporaryProject(t, {
    dependencies: {
      "@solid-native/core": "0.0.0",
      "react-native": "0.87.0",
    },
  });
  const bin = new URL("../dist/bin.js", import.meta.url);
  const { stdout } = await execFileAsync(process.execPath, [
    bin.pathname,
    "add",
    "navigation",
    "--cwd",
    project,
    "--dry-run",
    "--json",
  ]);
  const plan = JSON.parse(stdout);
  assert.equal(plan.operation, "add");
  assert.equal(plan.capability, "navigation");
  assert.equal(plan.packages[0].version, "0.0.0");
  await assert.rejects(
    readFile(
      path.join(project, "patches", "react-native-screens@4.27.0.patch"),
      "utf8",
    ),
    /ENOENT/u,
  );
});
