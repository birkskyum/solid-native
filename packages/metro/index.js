"use strict";

const path = require("node:path");

const solidNativeTransformWorkerPath = require.resolve("./transform-worker");
const SOLID_NATIVE_DEVELOPMENT_ENTRY_POINTS = new Map([
  [
    "@solid-native/devtools/network-service",
    {
      productionFile: "network-service.js",
      developmentFile: "network-service-development.js",
    },
  ],
  [
    "@solid-native/devtools/root",
    {
      productionFile: "root.js",
      developmentFile: "root-development.js",
    },
  ],
  [
    "@solid-native/devtools/solid-diagnostics",
    {
      productionFile: "solid-diagnostics.js",
      developmentFile: "solid-diagnostics-development.js",
    },
  ],
]);

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Prevents Metro's React Refresh heuristics from treating exported Solid
 * component functions as React refresh boundaries. Until Solid Native owns a
 * renderer-aware HMR protocol, application source changes must restart the
 * complete JavaScript/native surface lifecycle instead of retaining stale
 * Solid owners.
 */
function createSolidNativeFullReloadPattern(projectRoot) {
  if (typeof projectRoot !== "string" || !path.isAbsolute(projectRoot)) {
    throw new TypeError(
      "The Solid Native Metro project root must be an absolute path.",
    );
  }
  const escapedRoot = path
    .normalize(projectRoot)
    .split(path.sep)
    .map(escapeRegularExpression)
    .join("[\\\\/]");
  return new RegExp(
    `^${escapedRoot}[\\\\/](?!node_modules[\\\\/]|.*[\\\\/]node_modules[\\\\/]).+\\.[cm]?[jt]sx?$`,
  );
}

function resolvePackageRoot(packageName, projectRoot) {
  return path.dirname(
    require.resolve(`${packageName}/package.json`, { paths: [projectRoot] }),
  );
}

/**
 * Pins every Metro import/require edge to one browser Solid runtime. Without
 * this resolver, Metro can honor both halves of Solid's conditional exports
 * and bundle ESM plus CommonJS signal graphs into the same application.
 */
function createSolidNativeMetroResolver(projectRoot) {
  const solidRoot = resolvePackageRoot("solid-js", projectRoot);
  const signalsRoot = resolvePackageRoot("@solidjs/signals", solidRoot);
  return (context, moduleName, platform) => {
    let canonicalModule = moduleName;
    if (moduleName === "solid-js") {
      canonicalModule = path.join(
        solidRoot,
        "dist",
        context.dev ? "dev.js" : "solid.js",
      );
    } else if (moduleName === "@solidjs/signals") {
      canonicalModule = path.join(
        signalsRoot,
        "dist",
        context.dev ? "dev.js" : path.join("prod", "index.js"),
      );
    }
    const resolution = context.resolveRequest(
      context,
      canonicalModule,
      platform,
    );
    const developmentEntry =
      SOLID_NATIVE_DEVELOPMENT_ENTRY_POINTS.get(moduleName);
    if (developmentEntry === undefined || !context.dev) {
      return resolution;
    }
    if (
      resolution === null ||
      typeof resolution !== "object" ||
      resolution.type !== "sourceFile" ||
      typeof resolution.filePath !== "string" ||
      path.basename(resolution.filePath) !== developmentEntry.productionFile
    ) {
      throw new Error(
        `${moduleName} did not resolve to its reviewed production shim.`,
      );
    }
    return {
      ...resolution,
      filePath: path.join(
        path.dirname(resolution.filePath),
        developmentEntry.developmentFile,
      ),
    };
  };
}

module.exports = {
  createSolidNativeFullReloadPattern,
  createSolidNativeMetroResolver,
  solidNativeTransformWorkerPath,
};
