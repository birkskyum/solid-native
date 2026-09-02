import fs from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_SOURCE_PATTERNS = Object.freeze([
  /\/apps\/native-e2e\/notifications\.tsx$/u,
  /\/apps\/native-e2e\/adapters\/NotifeeApiModule\.ts$/u,
  /\/apps\/native-e2e\/generated\/SolidNativeBindings\.ts$/u,
  /\/packages\/notifications\/dist\/index\.js$/u,
  /\/packages\/notifications\/dist\/notify-kit-10\.js$/u,
  /\/packages\/notifications\/dist\/solid\.js$/u,
]);

function collectSources(map) {
  if (Array.isArray(map?.sources)) return map.sources;
  if (!Array.isArray(map?.sections)) {
    throw new Error("The bundle source map has neither sources nor sections.");
  }
  return map.sections.flatMap((section) => collectSources(section?.map));
}

export function assertNotificationsBundle(map) {
  const sources = collectSources(map).filter(
    (source) => typeof source === "string",
  );
  const matchedSources = [];
  for (const pattern of REQUIRED_SOURCE_PATTERNS) {
    const matches = sources.filter((source) => pattern.test(source));
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one notification proof source ${String(pattern)}, found ${JSON.stringify(matches)}.`,
      );
    }
    matchedSources.push(matches[0]);
  }
  const unexpectedPackageSources = sources.filter(
    (source) =>
      source.includes("/packages/notifications/") &&
      !matchedSources.includes(source),
  );
  if (unexpectedPackageSources.length > 0) {
    throw new Error(
      `The notification proof retained unexpected package sources: ${JSON.stringify(unexpectedPackageSources)}.`,
    );
  }
  const vendorFacades = sources.filter((source) =>
    source.includes("/node_modules/react-native-notify-kit/"),
  );
  if (vendorFacades.length > 0) {
    throw new Error(
      `The notification proof retained Notify Kit JavaScript facades: ${JSON.stringify(vendorFacades)}.`,
    );
  }
  return Object.freeze([...matchedSources]);
}

function main() {
  const sourceMapPath = process.argv[2];
  if (sourceMapPath === undefined) {
    throw new Error("Pass the generated Metro source-map path.");
  }
  const absolutePath = resolve(sourceMapPath);
  const map = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  const evidence = assertNotificationsBundle(map);
  console.log(
    `Verified the complete wrapper-free notification seam in ${absolutePath}: ${JSON.stringify(evidence)}.`,
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main();
}
