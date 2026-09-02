import assert from "node:assert/strict";
import { isAbsolute } from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  createSolidNativeFullReloadPattern,
  createSolidNativeMetroResolver,
  solidNativeTransformWorkerPath,
} = require("@solid-native/metro");

test("exports a resolvable Metro transform worker", () => {
  assert.equal(isAbsolute(solidNativeTransformWorkerPath), true);
  assert.deepEqual(
    Object.keys(require(solidNativeTransformWorkerPath)).sort(),
    ["getCacheKey", "transform"],
  );
});

test("canonicalizes Metro imports onto one browser Solid runtime", () => {
  const resolveRequest = createSolidNativeMetroResolver(
    fileURLToPath(new URL("../../../apps/native-e2e", import.meta.url)),
  );
  const requested = [];
  const context = {
    dev: false,
    resolveRequest(_context, moduleName) {
      requested.push(moduleName);
      return moduleName;
    },
  };

  resolveRequest(context, "solid-js", "android");
  resolveRequest(context, "@solidjs/signals", "android");
  resolveRequest(context, "@solid-native/renderer", "android");

  assert.match(requested[0], /solid-js\/dist\/solid\.js$/);
  assert.match(requested[1], /@solidjs\/signals\/dist\/prod\/index\.js$/);
  assert.equal(requested[2], "@solid-native/renderer");

  const developmentContext = { ...context, dev: true };
  resolveRequest(developmentContext, "solid-js", "ios");
  resolveRequest(developmentContext, "@solidjs/signals", "ios");

  assert.match(requested[3], /solid-js\/dist\/dev\.js$/);
  assert.match(requested[4], /@solidjs\/signals\/dist\/dev\.js$/);
});

test("loads the diagnostic root only for development bundles", () => {
  const resolveRequest = createSolidNativeMetroResolver(
    fileURLToPath(new URL("../../../apps/native-e2e", import.meta.url)),
  );
  const productionRoot = fileURLToPath(
    new URL("../../devtools/dist/root.js", import.meta.url),
  );
  const context = {
    dev: false,
    resolveRequest(_context, moduleName) {
      assert.equal(moduleName, "@solid-native/devtools/root");
      return { type: "sourceFile", filePath: productionRoot };
    },
  };

  assert.deepEqual(
    resolveRequest(context, "@solid-native/devtools/root", "android"),
    { type: "sourceFile", filePath: productionRoot },
  );
  assert.deepEqual(
    resolveRequest(
      { ...context, dev: true },
      "@solid-native/devtools/root",
      "ios",
    ),
    {
      type: "sourceFile",
      filePath: fileURLToPath(
        new URL("../../devtools/dist/root-development.js", import.meta.url),
      ),
    },
  );
  assert.throws(
    () =>
      resolveRequest(
        {
          dev: true,
          resolveRequest: () => "@solid-native/devtools/root",
        },
        "@solid-native/devtools/root",
        "android",
      ),
    /reviewed production shim/u,
  );
});

test("loads Solid diagnostics capture only for development bundles", () => {
  const resolveRequest = createSolidNativeMetroResolver(
    fileURLToPath(new URL("../../../apps/native-e2e", import.meta.url)),
  );
  const productionService = fileURLToPath(
    new URL("../../devtools/dist/solid-diagnostics.js", import.meta.url),
  );
  const context = {
    dev: false,
    resolveRequest(_context, moduleName) {
      assert.equal(moduleName, "@solid-native/devtools/solid-diagnostics");
      return { type: "sourceFile", filePath: productionService };
    },
  };

  assert.deepEqual(
    resolveRequest(
      context,
      "@solid-native/devtools/solid-diagnostics",
      "android",
    ),
    { type: "sourceFile", filePath: productionService },
  );
  assert.deepEqual(
    resolveRequest(
      { ...context, dev: true },
      "@solid-native/devtools/solid-diagnostics",
      "ios",
    ),
    {
      type: "sourceFile",
      filePath: fileURLToPath(
        new URL(
          "../../devtools/dist/solid-diagnostics-development.js",
          import.meta.url,
        ),
      ),
    },
  );
});

test("instruments native networking only for development bundles", () => {
  const resolveRequest = createSolidNativeMetroResolver(
    fileURLToPath(new URL("../../../apps/native-e2e", import.meta.url)),
  );
  const productionService = fileURLToPath(
    new URL("../../devtools/dist/network-service.js", import.meta.url),
  );
  const context = {
    dev: false,
    resolveRequest(_context, moduleName) {
      assert.equal(moduleName, "@solid-native/devtools/network-service");
      return { type: "sourceFile", filePath: productionService };
    },
  };

  assert.deepEqual(
    resolveRequest(context, "@solid-native/devtools/network-service", "ios"),
    { type: "sourceFile", filePath: productionService },
  );
  assert.deepEqual(
    resolveRequest(
      { ...context, dev: true },
      "@solid-native/devtools/network-service",
      "android",
    ),
    {
      type: "sourceFile",
      filePath: fileURLToPath(
        new URL(
          "../../devtools/dist/network-service-development.js",
          import.meta.url,
        ),
      ),
    },
  );
});

test("forces application modules outside node_modules through full reload", () => {
  const projectRoot = fileURLToPath(
    new URL("../../../apps/native-e2e", import.meta.url),
  );
  const pattern = createSolidNativeFullReloadPattern(projectRoot);

  assert.match(`${projectRoot}/index.js`, pattern);
  assert.match(`${projectRoot}/src/App.tsx`, pattern);
  assert.doesNotMatch(`${projectRoot}/src/README.md`, pattern);
  assert.doesNotMatch(
    `${projectRoot}/node_modules/example/src/Component.tsx`,
    pattern,
  );
  assert.doesNotMatch(`${projectRoot}-sibling/src/App.tsx`, pattern);
  const specialRoot = `${projectRoot}/Project (draft) [1]`;
  assert.match(
    `${specialRoot}/src/App.tsx`,
    createSolidNativeFullReloadPattern(specialRoot),
  );
  assert.throws(
    () => createSolidNativeFullReloadPattern("relative/project"),
    /absolute path/,
  );
});
