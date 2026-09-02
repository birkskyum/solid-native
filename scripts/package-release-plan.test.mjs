import assert from "node:assert/strict";
import test from "node:test";
import {
  createPackageReleasePlan,
  readPackageReleasePlan,
  renderPackageReleasePlan,
} from "./package-release-plan.mjs";

function record(name, dependencies = {}, manifest = {}) {
  return {
    directory: `/workspace/packages/${name.slice(name.indexOf("/") + 1)}`,
    readmePresent: true,
    manifest: {
      name,
      version: "1.0.0",
      description: `${name} fixture`,
      license: "MIT",
      repository: "https://example.test/repository.git",
      publishConfig: { access: "public" },
      exports: { ".": "./dist/index.js" },
      files: ["dist"],
      dependencies,
      ...manifest,
    },
  };
}

test("orders publishable packages into deterministic dependency waves", () => {
  const plan = createPackageReleasePlan([
    record("@solid-native/app", {
      "@solid-native/core": "workspace:^",
      "@solid-native/runtime": "workspace:*",
    }),
    record("@solid-native/runtime", {
      "@solid-native/core": "workspace:*",
    }),
    record("@solid-native/core"),
  ]);

  assert.equal(plan.ready, true);
  assert.deepEqual(plan.releaseWaves, [
    ["@solid-native/core"],
    ["@solid-native/runtime"],
    ["@solid-native/app"],
  ]);
  assert.deepEqual(plan.decisionBlockers, []);
  assert.deepEqual(plan.structuralBlockers, []);
});

test("reports guarded metadata separately from structural failures", () => {
  const plan = createPackageReleasePlan([
    record(
      "@solid-native/core",
      {},
      {
        version: "0.0.0",
        private: true,
        license: undefined,
        repository: undefined,
        publishConfig: undefined,
      },
    ),
    {
      ...record("@solid-native/runtime", {
        "@solid-native/core": "^1.0.0",
        "@solid-native/missing": "^1.0.0",
      }),
      readmePresent: false,
    },
  ]);

  assert.equal(plan.ready, false);
  assert.deepEqual(
    plan.decisionBlockers.map(({ id }) => id),
    [
      "publication.private",
      "publication.placeholder-version",
      "publication.license",
      "publication.repository",
      "publication.access",
    ],
  );
  assert.deepEqual(
    plan.structuralBlockers.map(({ id }) => id),
    [
      "package.readme-missing",
      "dependency.internal-range",
      "dependency.internal-missing",
    ],
  );
});

test("fails closed when runtime packages form a publication cycle", () => {
  const plan = createPackageReleasePlan([
    record("@solid-native/left", {
      "@solid-native/right": "workspace:*",
    }),
    record("@solid-native/right", {
      "@solid-native/left": "workspace:*",
    }),
  ]);

  assert.equal(plan.ready, false);
  assert.deepEqual(plan.releaseWaves, []);
  assert.deepEqual(plan.structuralBlockers, [
    {
      id: "dependency.cycle",
      message:
        "Runtime package dependencies contain a publication-order cycle.",
      packages: ["@solid-native/left", "@solid-native/right"],
    },
  ]);
});

test("the repository plan keeps publication guarded but structurally sound", async () => {
  const plan = await readPackageReleasePlan();
  assert.equal(plan.packageCount, 27);
  assert.equal(plan.ready, false);
  assert.equal(plan.releaseWaves.flat().length, plan.packageCount);
  assert.deepEqual(plan.structuralBlockers, []);
  assert.deepEqual(
    plan.decisionBlockers.map(({ id }) => id),
    [
      "publication.private",
      "publication.placeholder-version",
      "publication.license",
      "publication.repository",
      "publication.access",
    ],
  );
  assert.match(renderPackageReleasePlan(plan), /27 candidate packages/u);
});
