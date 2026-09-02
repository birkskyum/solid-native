import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createAndroidStarterGatePackageName,
  preflightPackedStarterAndroidDevice,
  verifyPackedStarterOnAndroid,
} from "./verify-android-starter-device.mjs";
import {
  createIOSStarterGateBundleIdentifier,
  preflightPackedStarterIOSDevice,
  verifyPackedStarterOnIOS,
} from "./verify-ios-starter-device.mjs";

const workspaceRoot = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
);
const packagesRoot = path.join(workspaceRoot, "packages");
const projectName = "PackedStarter";
const defaultPackageName = "dev.solidnative.packedstarter";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function formatStarterVerificationError(error) {
  const seen = new Set();
  const boundedMessage = (value) =>
    String(value).replaceAll("\0", "").slice(0, 4_096);
  const format = (value, depth) => {
    if (!(value instanceof Error)) return boundedMessage(value);
    const root = boundedMessage(value.message);
    if (!(value instanceof AggregateError)) return root;
    if (seen.has(value)) return `${root}\n- [circular aggregate error]`;
    if (depth >= 4) return `${root}\n- [nested error details truncated]`;
    seen.add(value);
    const formatted = [
      root,
      ...value.errors.slice(0, 8).map((nested) => {
        const detail = format(nested, depth + 1).replaceAll("\n", "\n  ");
        return `- ${detail}`;
      }),
    ].join("\n");
    seen.delete(value);
    return formatted;
  };
  return format(error, 0);
}

function usage() {
  return `Usage: pnpm run starter:verify -- [options]

Create and verify a fresh application from the repository's packed artifacts.
This opt-in gate is not part of hosted CI.

Options:
  --platform android|ios|all  Platforms to diagnose and bundle
                              (default: all on macOS, android elsewhere)
  --native-build             Also compile Android Release and/or an unsigned
                              generic-device iOS Release build
  --android-device SERIAL    Also install the packed Release starter on one
                              unlocked physical Android device, verify its
                              accessibility tree and Solid counter update, then
                              remove its collision-free gate package
  --ios-device ID           Also signed-build, install, launch, and remove the
                              packed Release starter on one unlocked physical
                              iPhone (requires --ios-team)
  --ios-team TEAM           Apple development team identifier used only with
                              --ios-device
  --keep                     Preserve the temporary project after success
  --output PATH              Use and preserve a new explicit output directory
  --help                     Print this help
`;
}

export function parseArguments(arguments_, hostPlatform = process.platform) {
  let platform = hostPlatform === "darwin" ? "all" : "android";
  let nativeBuild = false;
  let androidDevice;
  let iosDevice;
  let iosTeam;
  let keep = false;
  let output;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--") continue;
    if (argument === "--help") return { help: true };
    if (argument === "--native-build") {
      nativeBuild = true;
      continue;
    }
    if (argument === "--android-device") {
      androidDevice = arguments_[index + 1];
      index += 1;
      invariant(
        androidDevice !== undefined &&
          /^[^\0-\x1f\x7f]{1,256}$/u.test(androidDevice) &&
          !androidDevice.startsWith("--"),
        "--android-device requires a serial.",
      );
      nativeBuild = true;
      continue;
    }
    if (argument === "--ios-device") {
      iosDevice = arguments_[index + 1];
      index += 1;
      invariant(
        iosDevice !== undefined &&
          /^[^\0-\x1f\x7f]{1,256}$/u.test(iosDevice) &&
          !iosDevice.startsWith("--"),
        "--ios-device requires a CoreDevice identifier or hardware UDID.",
      );
      nativeBuild = true;
      continue;
    }
    if (argument === "--ios-team") {
      iosTeam = arguments_[index + 1];
      index += 1;
      invariant(
        iosTeam !== undefined && /^[A-Z0-9]{10}$/u.test(iosTeam),
        "--ios-team requires a 10-character Apple development team identifier.",
      );
      continue;
    }
    if (argument === "--keep") {
      keep = true;
      continue;
    }
    if (argument === "--platform") {
      platform = arguments_[index + 1];
      index += 1;
      invariant(platform !== undefined, "--platform requires a value.");
      continue;
    }
    if (argument === "--output") {
      output = arguments_[index + 1];
      index += 1;
      invariant(output !== undefined, "--output requires a path.");
      keep = true;
      continue;
    }
    throw new Error(`Unknown option ${JSON.stringify(argument)}.`);
  }
  invariant(
    platform === "android" || platform === "ios" || platform === "all",
    "--platform must be android, ios, or all.",
  );
  invariant(
    hostPlatform === "darwin" || platform === "android",
    "iOS starter verification requires macOS.",
  );
  invariant(
    androidDevice === undefined || platform !== "ios",
    "--android-device requires the android or all platform selection.",
  );
  invariant(
    iosDevice === undefined || platform !== "android",
    "--ios-device requires the ios or all platform selection.",
  );
  invariant(
    (iosDevice === undefined) === (iosTeam === undefined),
    "--ios-device and --ios-team must be supplied together.",
  );
  return {
    androidDevice,
    help: false,
    keep,
    nativeBuild,
    output,
    platform,
    iosDevice,
    iosTeam,
  };
}

function displayCommand(command, arguments_) {
  return [command, ...arguments_]
    .map((argument) =>
      /^[A-Za-z0-9_./:=@+-]+$/u.test(argument)
        ? argument
        : JSON.stringify(argument),
    )
    .join(" ");
}

function runCommand(command, arguments_, options = {}) {
  process.stdout.write(`\n$ ${displayCommand(command, arguments_)}\n`);
  const environment = { ...process.env, NO_COLOR: "1", ...options.env };
  delete environment.FORCE_COLOR;
  const capture = options.capture === true;
  const result = spawnSync(command, arguments_, {
    cwd: options.cwd,
    encoding: capture ? "utf8" : undefined,
    env: environment,
    maxBuffer: capture ? 16 * 1024 * 1024 : undefined,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  const capturedOutput = capture
    ? [result.stderr, result.stdout]
        .map((value) => String(value ?? "").trim())
        .filter((value) => value !== "")
        .join("\n")
    : "";
  invariant(
    result.status === 0,
    `${displayCommand(command, arguments_)} failed: ${
      result.error?.message ??
      (capturedOutput || `process exited ${String(result.status)}`)
    }`,
  );
  return {
    stderr: String(result.stderr ?? ""),
    stdout: String(result.stdout ?? ""),
  };
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function createVerificationRoot(output) {
  if (output === undefined) {
    return mkdtemp(path.join(tmpdir(), "solid-native-external-starter-"));
  }
  const target = path.resolve(output);
  invariant(
    !(await pathExists(target)),
    `Refusing to replace existing output directory ${target}.`,
  );
  const relative = path.relative(workspaceRoot, target);
  invariant(
    relative === ".." || relative.startsWith(`..${path.sep}`),
    "The external starter output must remain outside the source workspace.",
  );
  await mkdir(target, { recursive: true });
  return target;
}

async function distributablePackageDirectories() {
  const entries = await readdir(packagesRoot, { withFileTypes: true });
  const directories = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(packagesRoot, entry.name);
    const manifestPath = path.join(directory, "package.json");
    if (!(await pathExists(manifestPath))) continue;
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (manifest.exports !== undefined || manifest.files !== undefined) {
      directories.push(directory);
    }
  }
  directories.sort();
  invariant(directories.length > 0, "No distributable packages were found.");
  return directories;
}

async function packPackages(destination) {
  await mkdir(destination);
  const packages = [];
  for (const directory of await distributablePackageDirectories()) {
    const manifest = JSON.parse(
      await readFile(path.join(directory, "package.json"), "utf8"),
    );
    const packed = runCommand(
      "pnpm",
      ["--dir", directory, "pack", "--pack-destination", destination, "--json"],
      { capture: true, cwd: workspaceRoot },
    );
    const outputStart = packed.stdout.indexOf("{");
    const outputEnd = packed.stdout.lastIndexOf("}");
    invariant(
      outputStart !== -1 && outputEnd >= outputStart,
      `${manifest.name} returned invalid pack metadata.`,
    );
    const metadata = JSON.parse(
      packed.stdout.slice(outputStart, outputEnd + 1),
    );
    invariant(
      metadata.name === manifest.name && metadata.version === manifest.version,
      `${manifest.name} packed with an unexpected identity.`,
    );
    packages.push({
      archivePath: path.resolve(metadata.filename),
      name: manifest.name,
      version: manifest.version,
    });
  }
  return packages;
}

function localPackageOverrides(packages) {
  return Object.fromEntries(
    packages.map(({ archivePath, name }) => [name, `file:${archivePath}`]),
  );
}

async function writePnpmWorkspace(directory, overrides) {
  const serializedOverrides = Object.entries(overrides)
    .map(
      ([name, archivePath]) =>
        `  ${JSON.stringify(name)}: ${JSON.stringify(archivePath)}`,
    )
    .join("\n");
  await writeFile(
    path.join(directory, "pnpm-workspace.yaml"),
    `packages:\n  - "."\noverrides:\n${serializedOverrides}\n`,
  );
}

async function installPackedCli(driverDirectory, overrides) {
  await mkdir(driverDirectory);
  const cliArchive = overrides["@solid-native/cli"];
  invariant(
    cliArchive !== undefined,
    "The packed package set omitted the CLI.",
  );
  await writeFile(
    path.join(driverDirectory, "package.json"),
    `${JSON.stringify(
      {
        name: "solid-native-packed-starter-driver",
        private: true,
        packageManager: "pnpm@9.15.0",
        dependencies: { "@solid-native/cli": cliArchive },
        pnpm: { overrides },
      },
      null,
      2,
    )}\n`,
  );
  await writePnpmWorkspace(driverDirectory, overrides);
  runCommand("pnpm", ["install", "--config.engine-strict=true"], {
    cwd: driverDirectory,
  });
}

async function createPackedApplication(
  driverDirectory,
  applicationRoot,
  packageName,
) {
  runCommand(
    "pnpm",
    [
      "exec",
      "solid-native",
      "create",
      projectName,
      "--directory",
      applicationRoot,
      "--package-name",
      packageName,
      "--title",
      "Packed Starter",
      "--skip-install",
    ],
    { cwd: driverDirectory },
  );
}

async function installPackedApplication(applicationRoot, overrides) {
  const manifestPath = path.join(applicationRoot, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.dependencies["@solid-native/navigation"] = "0.0.0";
  manifest.dependencies["react-native-screens"] = "4.27.0";
  manifest.pnpm = { ...manifest.pnpm, overrides };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writePnpmWorkspace(applicationRoot, overrides);
  runCommand("pnpm", ["install", "--config.engine-strict=true"], {
    cwd: applicationRoot,
  });
  runCommand("pnpm", ["exec", "solid-native", "add", "navigation"], {
    cwd: applicationRoot,
  });
  const configuredManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  invariant(
    configuredManifest.dependencies?.["@solid-native/navigation"] === "0.0.0" &&
      configuredManifest.dependencies?.["react-native-screens"] === "4.27.0",
    "The packed navigation recipe did not retain its exact package identities.",
  );
  const patchRelativePath =
    configuredManifest.pnpm?.patchedDependencies?.[
      "react-native-screens@4.27.0"
    ];
  invariant(
    patchRelativePath === "patches/react-native-screens@4.27.0.patch",
    "The packed navigation recipe did not configure its application-owned patch.",
  );
  const contract = JSON.parse(
    await readFile(
      path.join(
        applicationRoot,
        "node_modules",
        "@solid-native",
        "navigation",
        "backend",
        "react-native-screens-4.27.0.json",
      ),
      "utf8",
    ),
  );
  const patch = await readFile(path.join(applicationRoot, patchRelativePath));
  invariant(
    contract.patch?.sha256 === createHash("sha256").update(patch).digest("hex"),
    "The packed navigation recipe copied a patch that does not match its shipped backend contract.",
  );
}

function selectedPlatforms(platform) {
  return platform === "all" ? ["android", "ios"] : [platform];
}

function bundleManifest(applicationRoot, platform) {
  return platform === "android"
    ? path.join(
        applicationRoot,
        "android",
        "app",
        "build",
        "solid-native-bundle",
        "solid-native-bundle.json",
      )
    : path.join(
        applicationRoot,
        "ios",
        "build",
        "solid-native-bundle",
        "solid-native-bundle.json",
      );
}

function verifyApplication(applicationRoot, platforms) {
  runCommand("pnpm", ["run", "check"], { cwd: applicationRoot });
  runCommand("pnpm", ["run", "test"], { cwd: applicationRoot });
  for (const platform of platforms) {
    runCommand("pnpm", ["run", "doctor", "--platform", platform], {
      cwd: applicationRoot,
    });
    runCommand("pnpm", ["run", `bundle:${platform}`], {
      cwd: applicationRoot,
    });
    runCommand(
      "pnpm",
      [
        "exec",
        "solid-native",
        "bundle",
        "verify",
        bundleManifest(applicationRoot, platform),
      ],
      { cwd: applicationRoot },
    );
  }
}

export function createIOSNativeBuildArguments(applicationRoot, options) {
  const common = [
    "-workspace",
    path.join(applicationRoot, "ios", `${projectName}.xcworkspace`),
    "-scheme",
    projectName,
    "-configuration",
    "Release",
    "-quiet",
  ];
  if (options.iosDevice === undefined) {
    return [
      ...common,
      "-destination",
      "generic/platform=iOS",
      "-derivedDataPath",
      path.join(applicationRoot, "build", "ios-derived-data"),
      "CODE_SIGNING_ALLOWED=NO",
      "CODE_SIGNING_REQUIRED=NO",
      "build",
    ];
  }
  invariant(
    typeof options.iosDestination === "string" &&
      options.iosDestination.length > 0,
    "A physical iOS build requires its resolved hardware UDID.",
  );
  invariant(
    typeof options.iosTeam === "string" &&
      /^[A-Z0-9]{10}$/u.test(options.iosTeam),
    "A physical iOS build requires its Apple development team identifier.",
  );
  return [
    ...common,
    "-destination",
    `id=${options.iosDestination}`,
    "-derivedDataPath",
    path.join(applicationRoot, "build", "ios-device-derived-data"),
    `DEVELOPMENT_TEAM=${options.iosTeam}`,
    "CODE_SIGN_STYLE=Automatic",
    "-allowProvisioningUpdates",
    "build",
  ];
}

function buildNativeApplication(applicationRoot, platforms, options) {
  if (platforms.includes("android")) {
    runCommand(
      "pnpm",
      options.androidDevice === undefined
        ? ["run", "build:android"]
        : ["run", "build:android", "--", "--tasks", "assembleRelease"],
      {
        cwd: applicationRoot,
      },
    );
  }
  if (platforms.includes("ios")) {
    runCommand("bundle", ["install"], { cwd: applicationRoot });
    runCommand("bundle", ["exec", "pod", "install"], {
      cwd: path.join(applicationRoot, "ios"),
    });
    runCommand(
      "xcodebuild",
      createIOSNativeBuildArguments(applicationRoot, options),
      { cwd: applicationRoot },
    );
  }
}

function androidReleaseApk(applicationRoot) {
  return path.join(
    applicationRoot,
    "android",
    "app",
    "build",
    "outputs",
    "apk",
    "release",
    "app-release.apk",
  );
}

function iosReleaseApplication(applicationRoot) {
  return path.join(
    applicationRoot,
    "build",
    "ios-device-derived-data",
    "Build",
    "Products",
    "Release-iphoneos",
    `${projectName}.app`,
  );
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage()}`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  const packageName =
    options.iosDevice !== undefined
      ? createIOSStarterGateBundleIdentifier()
      : options.androidDevice !== undefined
        ? createAndroidStarterGatePackageName()
        : defaultPackageName;
  if (options.androidDevice !== undefined) {
    preflightPackedStarterAndroidDevice({
      packageName,
      serial: options.androidDevice,
    });
  }
  let iosDevicePreflight;
  if (options.iosDevice !== undefined) {
    iosDevicePreflight = await preflightPackedStarterIOSDevice({
      bundleIdentifier: packageName,
      device: options.iosDevice,
    });
  }
  const verificationRoot = await createVerificationRoot(options.output);
  const applicationRoot = path.join(verificationRoot, "application");
  let succeeded = false;
  try {
    runCommand("pnpm", ["build"], { cwd: workspaceRoot });
    const packages = await packPackages(
      path.join(verificationRoot, "packages"),
    );
    const overrides = localPackageOverrides(packages);
    await installPackedCli(path.join(verificationRoot, "driver"), overrides);
    await createPackedApplication(
      path.join(verificationRoot, "driver"),
      applicationRoot,
      packageName,
    );
    await installPackedApplication(applicationRoot, overrides);
    const platforms = selectedPlatforms(options.platform);
    verifyApplication(applicationRoot, platforms);
    if (options.nativeBuild) {
      buildNativeApplication(applicationRoot, platforms, {
        androidDevice: options.androidDevice,
        iosDestination: iosDevicePreflight?.udid,
        iosDevice: options.iosDevice,
        iosTeam: options.iosTeam,
      });
    }
    let androidDeviceResult;
    if (options.androidDevice !== undefined) {
      androidDeviceResult = await verifyPackedStarterOnAndroid({
        apkPath: androidReleaseApk(applicationRoot),
        packageName,
        serial: options.androidDevice,
      });
    }
    let iosDeviceResult;
    if (options.iosDevice !== undefined) {
      iosDeviceResult = await verifyPackedStarterOnIOS({
        applicationPath: iosReleaseApplication(applicationRoot),
        bundleIdentifier: packageName,
        device: options.iosDevice,
        teamIdentifier: options.iosTeam,
      });
    }
    succeeded = true;
    process.stdout.write(
      `\nVerified ${packages.length} packed packages through a fresh ${platforms.join(" + ")} starter${
        options.nativeBuild ? " with native Release compilation" : ""
      }${
        androidDeviceResult === undefined
          ? ""
          : ` and a cleaned physical ${androidDeviceResult.model} interaction`
      }${
        iosDeviceResult === undefined
          ? ""
          : ` and a cleaned signed ${iosDeviceResult.model} launch`
      }.\n`,
    );
  } finally {
    if (succeeded && !options.keep) {
      await rm(verificationRoot, { force: true, recursive: true });
      process.stdout.write(`Removed temporary gate ${verificationRoot}.\n`);
    } else {
      process.stdout.write(
        `Retained external starter at ${verificationRoot}.\n`,
      );
    }
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  path.resolve(invokedPath) === fileURLToPath(import.meta.url)
) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`\n${formatStarterVerificationError(error)}\n`);
    process.exitCode = 1;
  }
}
