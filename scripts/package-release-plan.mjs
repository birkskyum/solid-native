import { access, readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const internalPackagePrefix = "@solid-native/";
const dependencyFields = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
];
const orderedDependencyFields = ["dependencies", "optionalDependencies"];

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function publicationCandidate(manifest) {
  return manifest.exports !== undefined || manifest.files !== undefined;
}

function addBlocker(blockers, id, message, packages = undefined) {
  blockers.push({
    id,
    message,
    ...(packages === undefined ? {} : { packages: sorted(packages) }),
  });
}

function createReleaseWaves(packageRecords, structuralBlockers) {
  const packageNames = new Set(
    packageRecords.map(({ manifest }) => manifest.name),
  );
  const dependenciesByPackage = new Map();
  const dependantsByPackage = new Map(
    [...packageNames].map((packageName) => [packageName, new Set()]),
  );

  for (const { manifest } of packageRecords) {
    const orderedDependencies = new Set();
    for (const field of dependencyFields) {
      for (const [dependency, range] of Object.entries(manifest[field] ?? {})) {
        if (!dependency.startsWith(internalPackagePrefix)) continue;
        if (!packageNames.has(dependency)) {
          addBlocker(
            structuralBlockers,
            "dependency.internal-missing",
            `${manifest.name} references missing internal package ${dependency} in ${field}.`,
          );
          continue;
        }
        if (typeof range !== "string" || !range.startsWith("workspace:")) {
          addBlocker(
            structuralBlockers,
            "dependency.internal-range",
            `${manifest.name} must use the workspace protocol for ${dependency} in ${field}.`,
          );
        }
        if (orderedDependencyFields.includes(field)) {
          orderedDependencies.add(dependency);
        }
      }
    }
    dependenciesByPackage.set(manifest.name, orderedDependencies);
    for (const dependency of orderedDependencies) {
      dependantsByPackage.get(dependency)?.add(manifest.name);
    }
  }

  const remainingDependencyCounts = new Map(
    [...dependenciesByPackage].map(([packageName, dependencies]) => [
      packageName,
      dependencies.size,
    ]),
  );
  let currentWave = sorted(
    [...remainingDependencyCounts]
      .filter(([, count]) => count === 0)
      .map(([packageName]) => packageName),
  );
  const waves = [];
  const released = new Set();

  while (currentWave.length > 0) {
    waves.push(currentWave);
    const nextWave = new Set();
    for (const packageName of currentWave) {
      released.add(packageName);
      for (const dependant of dependantsByPackage.get(packageName) ?? []) {
        const count = remainingDependencyCounts.get(dependant);
        if (count === undefined) continue;
        const nextCount = count - 1;
        remainingDependencyCounts.set(dependant, nextCount);
        if (nextCount === 0) nextWave.add(dependant);
      }
    }
    currentWave = sorted(nextWave);
  }

  const cycle = sorted(
    [...packageNames].filter((packageName) => !released.has(packageName)),
  );
  if (cycle.length > 0) {
    addBlocker(
      structuralBlockers,
      "dependency.cycle",
      "Runtime package dependencies contain a publication-order cycle.",
      cycle,
    );
  }

  return waves;
}

export function createPackageReleasePlan(packageRecords) {
  const decisionBlockers = [];
  const structuralBlockers = [];
  const packageNames = new Map();

  for (const { directory, manifest } of packageRecords) {
    if (typeof manifest.name !== "string" || manifest.name.length === 0) {
      addBlocker(
        structuralBlockers,
        "package.name-missing",
        `${directory} has no package name.`,
      );
      continue;
    }
    const previous = packageNames.get(manifest.name);
    if (previous !== undefined) {
      addBlocker(
        structuralBlockers,
        "package.name-duplicate",
        `${manifest.name} is declared by both ${previous} and ${directory}.`,
      );
    } else {
      packageNames.set(manifest.name, directory);
    }
  }

  const namedRecords = packageRecords.filter(
    ({ manifest }) =>
      typeof manifest.name === "string" && manifest.name.length > 0,
  );
  const privatePackages = namedRecords
    .filter(({ manifest }) => manifest.private === true)
    .map(({ manifest }) => manifest.name);
  const placeholderVersions = namedRecords
    .filter(({ manifest }) => manifest.version === "0.0.0")
    .map(({ manifest }) => manifest.name);
  const missingLicenses = namedRecords
    .filter(
      ({ manifest }) =>
        !(typeof manifest.license === "string" && manifest.license.length > 0),
    )
    .map(({ manifest }) => manifest.name);
  const missingRepositories = namedRecords
    .filter(
      ({ manifest }) =>
        manifest.repository === undefined || manifest.repository === null,
    )
    .map(({ manifest }) => manifest.name);
  const nonPublicAccess = namedRecords
    .filter(({ manifest }) => manifest.publishConfig?.access !== "public")
    .map(({ manifest }) => manifest.name);

  if (privatePackages.length > 0) {
    addBlocker(
      decisionBlockers,
      "publication.private",
      `${privatePackages.length} package${privatePackages.length === 1 ? " remains" : "s remain"} protected by private: true.`,
      privatePackages,
    );
  }
  if (placeholderVersions.length > 0) {
    addBlocker(
      decisionBlockers,
      "publication.placeholder-version",
      `${placeholderVersions.length} package${placeholderVersions.length === 1 ? " still uses" : "s still use"} the placeholder version 0.0.0.`,
      placeholderVersions,
    );
  }
  if (missingLicenses.length > 0) {
    addBlocker(
      decisionBlockers,
      "publication.license",
      `${missingLicenses.length} package${missingLicenses.length === 1 ? " needs" : "s need"} intentional license metadata.`,
      missingLicenses,
    );
  }
  if (missingRepositories.length > 0) {
    addBlocker(
      decisionBlockers,
      "publication.repository",
      `${missingRepositories.length} package${missingRepositories.length === 1 ? " needs" : "s need"} public repository metadata.`,
      missingRepositories,
    );
  }
  if (nonPublicAccess.length > 0) {
    addBlocker(
      decisionBlockers,
      "publication.access",
      `${nonPublicAccess.length} scoped package${nonPublicAccess.length === 1 ? " needs" : "s need"} explicit public registry access.`,
      nonPublicAccess,
    );
  }

  for (const { directory, manifest, readmePresent } of namedRecords) {
    if (
      typeof manifest.version !== "string" ||
      !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(manifest.version)
    ) {
      addBlocker(
        structuralBlockers,
        "package.version-invalid",
        `${manifest.name} has invalid version ${JSON.stringify(manifest.version)}.`,
      );
    }
    if (
      typeof manifest.description !== "string" ||
      manifest.description.trim() === ""
    ) {
      addBlocker(
        structuralBlockers,
        "package.description-missing",
        `${manifest.name} has no description.`,
      );
    }
    if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
      addBlocker(
        structuralBlockers,
        "package.files-missing",
        `${manifest.name} has no package files allowlist.`,
      );
    }
    if (manifest.exports === undefined) {
      addBlocker(
        structuralBlockers,
        "package.exports-missing",
        `${manifest.name} has no exports map.`,
      );
    }
    if (!readmePresent) {
      addBlocker(
        structuralBlockers,
        "package.readme-missing",
        `${manifest.name} has no README.md in ${directory}.`,
      );
    }
  }

  const releaseWaves = createReleaseWaves(namedRecords, structuralBlockers);
  return {
    schemaVersion: 1,
    ready: decisionBlockers.length === 0 && structuralBlockers.length === 0,
    packageCount: namedRecords.length,
    releaseWaves,
    decisionBlockers,
    structuralBlockers,
  };
}

export function renderPackageReleasePlan(plan) {
  const lines = [
    `Package publication readiness: ${plan.ready ? "READY" : "BLOCKED"}`,
    `${plan.packageCount} candidate package${plan.packageCount === 1 ? "" : "s"} in ${plan.releaseWaves.length} dependency wave${plan.releaseWaves.length === 1 ? "" : "s"}.`,
    "",
    "Release order:",
  ];
  for (const [index, wave] of plan.releaseWaves.entries()) {
    lines.push(`  ${String(index + 1)}. ${wave.join(", ")}`);
  }
  if (plan.releaseWaves.length === 0) lines.push("  (no acyclic release wave)");

  for (const [heading, blockers] of [
    ["Decisions required", plan.decisionBlockers],
    ["Structural blockers", plan.structuralBlockers],
  ]) {
    lines.push("", `${heading}:`);
    if (blockers.length === 0) {
      lines.push("  none");
      continue;
    }
    for (const blocker of blockers) lines.push(`  - ${blocker.message}`);
  }
  return `${lines.join("\n")}\n`;
}

async function pathExists(path) {
  return access(path).then(
    () => true,
    () => false,
  );
}

export async function readPackageReleasePlan(root = workspaceRoot) {
  const packagesRoot = join(root, "packages");
  const entries = await readdir(packagesRoot, { withFileTypes: true });
  const packageRecords = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = join(packagesRoot, entry.name);
    let manifest;
    try {
      manifest = JSON.parse(
        await readFile(join(directory, "package.json"), "utf8"),
      );
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (!publicationCandidate(manifest)) continue;
    packageRecords.push({
      directory,
      manifest,
      readmePresent: await pathExists(join(directory, "README.md")),
    });
  }
  packageRecords.sort((left, right) =>
    String(left.manifest.name).localeCompare(String(right.manifest.name)),
  );
  return createPackageReleasePlan(packageRecords);
}

function parseArguments(arguments_) {
  const options = { check: false, json: false };
  for (const argument of arguments_) {
    if (argument === "--check") options.check = true;
    else if (argument === "--json") options.json = true;
    else throw new Error(`Unknown argument ${argument}.`);
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const plan = await readPackageReleasePlan();
  process.stdout.write(
    options.json
      ? `${JSON.stringify(plan, null, 2)}\n`
      : renderPackageReleasePlan(plan),
  );
  if (options.check && !plan.ready) process.exitCode = 1;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
