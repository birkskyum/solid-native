import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const policyPath = join(
  workspaceRoot,
  "docs",
  "dependency-license-policy.json",
);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function compareInventoryEntries(left, right) {
  const leftKey = `${left.name}\0${left.version}\0${left.license}`;
  const rightKey = `${right.name}\0${right.version}\0${right.license}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function readPnpmLicenseInventory() {
  const environment = { ...process.env, NO_COLOR: "1" };
  delete environment.FORCE_COLOR;
  const result = spawnSync("pnpm", ["licenses", "list", "--json"], {
    cwd: workspaceRoot,
    encoding: "utf8",
    env: environment,
  });
  invariant(
    result.status === 0,
    `pnpm licenses failed: ${result.error?.message ?? result.stderr.trim()}`,
  );
  return JSON.parse(result.stdout);
}

function normalizeInventory(rawInventory) {
  invariant(
    rawInventory !== null &&
      typeof rawInventory === "object" &&
      !Array.isArray(rawInventory),
    "pnpm licenses returned an invalid inventory.",
  );
  const entries = [];
  for (const [license, packages] of Object.entries(rawInventory)) {
    invariant(
      license.trim() !== "",
      "A dependency reported an empty license expression.",
    );
    invariant(
      Array.isArray(packages),
      `License group ${license} is not an array.`,
    );
    for (const dependency of packages) {
      invariant(
        dependency !== null && typeof dependency === "object",
        `License group ${license} contains an invalid dependency.`,
      );
      invariant(
        typeof dependency.name === "string" && dependency.name !== "",
        `License group ${license} contains a dependency without a name.`,
      );
      invariant(
        dependency.license === license,
        `${dependency.name} reports ${String(dependency.license)} inside ${license}.`,
      );
      invariant(
        Array.isArray(dependency.versions) && dependency.versions.length > 0,
        `${dependency.name} has no installed versions.`,
      );
      for (const version of dependency.versions) {
        invariant(
          typeof version === "string" && version !== "",
          `${dependency.name} has an invalid installed version.`,
        );
        entries.push({ name: dependency.name, version, license });
      }
    }
  }
  entries.sort(compareInventoryEntries);
  for (let index = 1; index < entries.length; index += 1) {
    invariant(
      compareInventoryEntries(entries[index - 1], entries[index]) !== 0,
      `Duplicate dependency inventory entry ${JSON.stringify(entries[index])}.`,
    );
  }
  return entries;
}

function summarizeInventory(entries) {
  const licenseCounts = {};
  for (const entry of entries) {
    licenseCounts[entry.license] = (licenseCounts[entry.license] ?? 0) + 1;
  }
  const sortedLicenseCounts = Object.fromEntries(
    Object.entries(licenseCounts).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  );
  return {
    entryCount: entries.length,
    inventorySha256: createHash("sha256")
      .update(JSON.stringify(entries))
      .digest("hex"),
    licenseCounts: sortedLicenseCounts,
  };
}

const json = process.argv.slice(2).includes("--json");
const unknownArguments = process.argv
  .slice(2)
  .filter((argument) => argument !== "--json");
invariant(
  unknownArguments.length === 0,
  `Unknown license inventory option ${String(unknownArguments[0])}.`,
);

const policy = JSON.parse(await readFile(policyPath, "utf8"));
invariant(
  policy.schemaVersion === 1,
  "Unsupported dependency license policy schema.",
);
const entries = normalizeInventory(readPnpmLicenseInventory());
const summary = summarizeInventory(entries);
invariant(
  summary.entryCount === policy.reviewedPackageVersions,
  `Dependency inventory contains ${summary.entryCount} package versions; policy reviews ${String(policy.reviewedPackageVersions)}.`,
);
invariant(
  JSON.stringify(summary.licenseCounts) ===
    JSON.stringify(policy.licenseCounts),
  `Dependency license counts changed. Actual: ${JSON.stringify(summary.licenseCounts)}.`,
);
invariant(
  summary.inventorySha256 === policy.inventorySha256,
  `Dependency license fingerprint changed to ${summary.inventorySha256}. Review the normalized inventory before updating ${policyPath}.`,
);

if (json) {
  process.stdout.write(
    `${JSON.stringify({ schemaVersion: 1, ...summary, entries }, null, 2)}\n`,
  );
} else {
  process.stdout.write(
    `Verified ${summary.entryCount} dependency package versions across ${Object.keys(summary.licenseCounts).length} reviewed license expressions.\n`,
  );
}
