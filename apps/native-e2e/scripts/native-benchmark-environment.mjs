import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHA256_FINGERPRINT = /^sha256:[a-f\d]{64}$/u;
const SHA256_DIGEST = /^[a-f\d]{64}$/u;

export function parseNativeCompatibilityIdentity(source, expectedPlatform) {
  let report;
  try {
    report = JSON.parse(source);
  } catch (error) {
    throw new Error("The native compatibility fingerprint is not valid JSON.", {
      cause: error,
    });
  }
  const target = report?.targets?.[0];
  if (
    report === null ||
    typeof report !== "object" ||
    report.schemaVersion !== 0 ||
    typeof report.projectName !== "string" ||
    report.projectName === "" ||
    !Array.isArray(report.targets) ||
    report.targets.length !== 1 ||
    target === null ||
    typeof target !== "object" ||
    target.platform !== expectedPlatform ||
    typeof target.fingerprint !== "string" ||
    !SHA256_FINGERPRINT.test(target.fingerprint) ||
    !Array.isArray(target.inputs) ||
    target.inputs.length === 0 ||
    target.inputs.some(
      (input) =>
        input === null ||
        typeof input !== "object" ||
        typeof input.path !== "string" ||
        input.path === "" ||
        typeof input.sha256 !== "string" ||
        !SHA256_DIGEST.test(input.sha256),
    )
  ) {
    throw new Error(
      `The native compatibility fingerprint omitted a valid ${expectedPlatform} target.`,
    );
  }
  return Object.freeze({
    fingerprint: target.fingerprint,
    inputCount: target.inputs.length,
  });
}

export function readNativeCompatibilityIdentity(
  repositoryRoot,
  projectRoot,
  platform,
  spawn = spawnSync,
) {
  const cli = path.join(repositoryRoot, "packages/cli/dist/bin.js");
  const result = spawn(
    process.execPath,
    [
      cli,
      "fingerprint",
      "--cwd",
      projectRoot,
      "--platform",
      platform,
      "--json",
    ],
    { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
  );
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(
      `Could not compute the ${platform} native compatibility fingerprint${
        detail ? `: ${detail}` : "."
      } Build @solid-native/cli before running physical benchmarks.`,
    );
  }
  return parseNativeCompatibilityIdentity(result.stdout, platform);
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  path.resolve(invokedPath) === fileURLToPath(import.meta.url)
) {
  const [repositoryRoot, projectRoot, platform, ...unknownArguments] =
    process.argv.slice(2);
  if (
    repositoryRoot === undefined ||
    projectRoot === undefined ||
    (platform !== "android" && platform !== "ios") ||
    unknownArguments.length > 0
  ) {
    throw new Error(
      "Usage: node native-benchmark-environment.mjs <repository-root> <project-root> <android|ios>",
    );
  }
  const identity = readNativeCompatibilityIdentity(
    repositoryRoot,
    projectRoot,
    platform,
  );
  process.stdout.write(
    `${identity.fingerprint}\t${String(identity.inputCount)}\n`,
  );
}
