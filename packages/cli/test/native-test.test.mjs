import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createNativeTestPlan,
  executeNativeTestPlan,
  formatNativeTestPlan,
} from "../dist/index.js";

async function temporaryProject(t) {
  const root = await mkdtemp(path.join(tmpdir(), "solid-native-test-plan-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await Promise.all([
    writeFile(path.join(root, "package.json"), '{"private":true}\n'),
    mkdir(path.join(root, "test", "nested"), { recursive: true }),
  ]);
  return root;
}

test("discovers bounded TSX tests and creates the OXC Node plan", async (t) => {
  const project = await temporaryProject(t);
  const first = path.join(project, "test", "App.test.tsx");
  const second = path.join(project, "test", "nested", "feature.spec.ts");
  await Promise.all([
    writeFile(first, "export {};\n"),
    writeFile(second, "export {};\n"),
    writeFile(path.join(project, "test", "helper.ts"), "export {};\n"),
    mkdir(path.join(project, "test", "node_modules"), { recursive: true }).then(
      () =>
        writeFile(
          path.join(project, "test", "node_modules", "hidden.test.ts"),
          "throw new Error('must not run');\n",
        ),
    ),
  ]);

  const plan = await createNativeTestPlan({
    cwd: path.join(project, "test", "nested"),
    dependencies: {
      resolveRegister: () => "/fixture/testing/register.js",
    },
  });

  assert.equal(plan.operation, "test");
  assert.equal(plan.projectRoot, project);
  assert.equal(plan.runtime, "development");
  assert.deepEqual(plan.testFiles, [first, second]);
  assert.deepEqual(plan.args.slice(0, 6), [
    "--conditions=browser",
    "--conditions=development",
    "--enable-source-maps",
    "--import",
    "/fixture/testing/register.js",
    "--test",
  ]);
  assert.match(formatNativeTestPlan(plan), /--conditions=browser/u);
  assert.match(formatNativeTestPlan(plan), /--conditions=development/u);
});

test("supports an explicit production Solid runtime", async (t) => {
  const project = await temporaryProject(t);
  const source = path.join(project, "test", "App.test.tsx");
  await writeFile(source, "export {};\n");
  const plan = await createNativeTestPlan({
    cwd: project,
    runtime: "production",
    dependencies: {
      resolveRegister: () => "/fixture/testing/register.js",
    },
  });

  assert.equal(plan.runtime, "production");
  assert.equal(plan.args.includes("--conditions=development"), false);
  assert.match(formatNativeTestPlan(plan), /--conditions=browser/u);
});

test("accepts an explicit source and preserves the test process status", async (t) => {
  const project = await temporaryProject(t);
  const source = path.join(project, "test", "focused.tsx");
  await writeFile(source, "export {};\n");
  const plan = await createNativeTestPlan({
    cwd: project,
    paths: ["test/focused.tsx"],
    dependencies: {
      resolveRegister: () => "/fixture/testing/register.js",
    },
  });
  let executed = false;
  const exitCode = await executeNativeTestPlan(plan, {
    env: { FIXTURE: "yes" },
    executor(received, context) {
      executed = true;
      assert.equal(received, plan);
      assert.equal(context.env.FIXTURE, "yes");
      return Promise.resolve(7);
    },
  });
  assert.equal(executed, true);
  assert.equal(exitCode, 7);
});

test("creates inspectable watch and test-name-filter plans", async (t) => {
  const project = await temporaryProject(t);
  const source = path.join(project, "test", "focused.tsx");
  await writeFile(source, "export {};\n");
  const plan = await createNativeTestPlan({
    cwd: project,
    paths: ["test/focused.tsx"],
    testNamePattern: "counter (increments|resets)",
    watch: true,
    dependencies: {
      resolveRegister: () => "/fixture/testing/register.js",
    },
  });

  assert.equal(plan.watch, true);
  assert.equal(plan.testNamePattern, "counter (increments|resets)");
  assert.deepEqual(plan.args.slice(-3), [
    "--watch",
    "--test-name-pattern=counter (increments|resets)",
    source,
  ]);
  assert.match(formatNativeTestPlan(plan), /'--test-name-pattern=counter/u);
});

test("rejects missing, external, empty, and unresolved test selections", async (t) => {
  const project = await temporaryProject(t);
  await assert.rejects(
    createNativeTestPlan({
      cwd: project,
      runtime: "invalid",
      dependencies: { resolveRegister: () => "/fixture/register.js" },
    }),
    /runtime must be development or production/u,
  );
  await assert.rejects(
    createNativeTestPlan({
      cwd: project,
      testNamePattern: "(",
      dependencies: { resolveRegister: () => "/fixture/register.js" },
    }),
    /not a valid regular expression/u,
  );
  await assert.rejects(
    createNativeTestPlan({
      cwd: project,
      paths: [""],
      dependencies: { resolveRegister: () => "/fixture/register.js" },
    }),
    /1-4096 character/u,
  );
  await assert.rejects(
    createNativeTestPlan({
      cwd: project,
      paths: ["../outside.test.ts"],
      dependencies: { resolveRegister: () => "/fixture/register.js" },
    }),
    /must stay inside/u,
  );
  await assert.rejects(
    createNativeTestPlan({
      cwd: project,
      paths: ["missing.test.ts"],
      dependencies: { resolveRegister: () => "/fixture/register.js" },
    }),
    /does not exist/u,
  );
  await assert.rejects(
    createNativeTestPlan({
      cwd: project,
      dependencies: { resolveRegister: () => "/fixture/register.js" },
    }),
    /No \*\.test or \*\.spec/u,
  );
  const source = path.join(project, "test", "App.test.tsx");
  await writeFile(source, "export {};\n");
  await assert.rejects(
    createNativeTestPlan({
      cwd: project,
      dependencies: {
        resolveRegister() {
          throw new Error("missing");
        },
      },
    }),
    /Install @solid-native\/testing/u,
  );
});
