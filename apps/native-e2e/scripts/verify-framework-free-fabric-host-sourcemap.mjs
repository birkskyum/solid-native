import fs from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_SOURCE_PATTERNS = [
  /\/packages\/fabric-host\/(?:src|dist)\//u,
  /\/packages\/host-contract\/(?:src|dist)\//u,
];
const FORBIDDEN_SOURCE_PATTERNS = [
  /\/node_modules\/\.pnpm\/solid-js@/u,
  /\/node_modules\/\.pnpm\/@solidjs\+/u,
  /\/packages\/renderer\/(?:src|dist)\//u,
  /\/packages\/runtime\/(?:src|dist)\//u,
  /\/packages\/core\/(?:src|dist)\//u,
  /\/packages\/navigation\/(?:src|dist)\//u,
];

function collectSources(map) {
  if (Array.isArray(map?.sources)) return map.sources;
  if (!Array.isArray(map?.sections)) {
    throw new Error("The bundle source map has neither sources nor sections.");
  }
  return map.sections.flatMap((section) => collectSources(section?.map));
}

export function assertFrameworkFreeFabricHostBundle(map) {
  const sources = [
    ...new Set(
      collectSources(map).filter((source) => typeof source === "string"),
    ),
  ];
  for (const pattern of REQUIRED_SOURCE_PATTERNS) {
    if (!sources.some((source) => pattern.test(source))) {
      throw new Error(
        `The framework-free bundle omitted required source ${String(pattern)}.`,
      );
    }
  }
  const forbidden = sources.filter((source) =>
    FORBIDDEN_SOURCE_PATTERNS.some((pattern) => pattern.test(source)),
  );
  if (forbidden.length > 0) {
    throw new Error(
      `The framework-free Fabric Host bundle retained framework sources: ${JSON.stringify(forbidden)}.`,
    );
  }
  return {
    fabricHostSources: sources.filter((source) =>
      REQUIRED_SOURCE_PATTERNS[0].test(source),
    ),
    hostContractSources: sources.filter((source) =>
      REQUIRED_SOURCE_PATTERNS[1].test(source),
    ),
  };
}

function main() {
  const sourceMapPath = process.argv[2];
  if (sourceMapPath === undefined) {
    throw new Error("Pass the generated Metro source-map path.");
  }
  const absolutePath = resolve(sourceMapPath);
  const map = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  const evidence = assertFrameworkFreeFabricHostBundle(map);
  console.log(
    `Verified a framework-free Fabric Host bundle in ${absolutePath}: ${JSON.stringify(evidence)}.`,
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main();
}
