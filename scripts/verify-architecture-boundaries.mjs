import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function readManifest(packageName) {
  return JSON.parse(
    await readFile(
      join(repositoryRoot, "packages", packageName, "package.json"),
      "utf8",
    ),
  );
}

function declaredDependencies(manifest) {
  return new Set(
    [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ].sort(),
  );
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return entry.isFile() && /\.(?:[cm]?[jt]s|tsx)$/u.test(entry.name)
        ? [path]
        : [];
    }),
  );
  return nested.flat();
}

async function importedSpecifiers(packageName) {
  const sourceRoot = join(repositoryRoot, "packages", packageName, "src");
  const imports = [];
  for (const path of await sourceFiles(sourceRoot)) {
    const source = await readFile(path, "utf8");
    const pattern =
      /(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\()\s*["']([^"']+)["']/gu;
    for (const match of source.matchAll(pattern)) {
      imports.push({ path, specifier: match[1] });
    }
  }
  return imports;
}

const hostContract = await readManifest("host-contract");
const reactNativeCompat = await readManifest("react-native-compat");
const fabricHost = await readManifest("fabric-host");
const renderer = await readManifest("renderer");
const runtime = await readManifest("runtime");
const reactNativeBoundary = JSON.parse(
  await readFile(
    join(
      repositoryRoot,
      "packages/fabric-host/native/react-native-boundary.json",
    ),
    "utf8",
  ),
);
const reactNativeCompatibilitySource = await readFile(
  join(repositoryRoot, "packages/react-native-compat/src/index.ts"),
  "utf8",
);
const supportedReactNativeVersion = /packageVersion:\s*"([^"]+)"/u.exec(
  reactNativeCompatibilitySource,
)?.[1];
assert.equal(
  reactNativeBoundary.reactNativeVersion,
  supportedReactNativeVersion,
  "Fabric Host and the React Native compatibility package must review the same release.",
);

assert.deepEqual(
  [...declaredDependencies(hostContract)],
  [],
  "The host contract must have no runtime or framework dependencies.",
);
assert.deepEqual(
  [...declaredDependencies(reactNativeCompat)],
  [],
  "The React Native compatibility contract must have no runtime or framework dependencies.",
);

const allowedFabricHostDependencies = new Set([
  "@react-native/normalize-colors",
  "@solid-native/host-contract",
  "@solid-native/react-native-compat",
]);
for (const dependency of declaredDependencies(fabricHost)) {
  assert.ok(
    allowedFabricHostDependencies.has(dependency),
    `The Fabric Host must not depend on ${dependency}.`,
  );
}

for (const { path, specifier } of await importedSpecifiers("fabric-host")) {
  if (specifier.startsWith(".")) continue;
  assert.ok(
    allowedFabricHostDependencies.has(specifier),
    `${path.slice(repositoryRoot.length + 1)} imports framework-facing module ${specifier}.`,
  );
}

const rendererDependencies = declaredDependencies(renderer);
assert.ok(rendererDependencies.has("@solid-native/host-contract"));
assert.ok(
  !rendererDependencies.has("@solid-native/fabric-host"),
  "The Solid renderer must target the host contract, not the Fabric implementation.",
);

const runtimeDependencies = declaredDependencies(runtime);
assert.ok(
  runtimeDependencies.has("@solid-native/fabric-host") &&
    runtimeDependencies.has("@solid-native/renderer"),
  "The Solid runtime facade must compose the renderer with Fabric Host.",
);

console.log(
  "Verified framework-neutral host boundaries and the dependency-free React Native compatibility contract.",
);
