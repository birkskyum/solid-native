import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const COMMAND_TIMEOUT_MILLISECONDS = 20_000;
const CORE_DEVICE_TIMEOUT_SECONDS = 15;
const MAX_COMMAND_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_CORE_DEVICE_DOCUMENT_BYTES = 2 * 1024 * 1024;
const BUNDLE_IDENTIFIER =
  /^[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9][A-Za-z0-9-]*)+$/u;
const TEAM_IDENTIFIER = /^[A-Z0-9]{10}$/u;
const IOS_STARTER_GATE_BUNDLE_IDENTIFIER =
  "dev.solidnative.packedstarter.iosgate";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedArgument(value, label) {
  invariant(
    typeof value === "string" &&
      value.length > 0 &&
      value.length <= 256 &&
      !/[\0-\x1f\x7f]/u.test(value),
    `${label} must be 1-256 characters without control characters.`,
  );
  return value;
}

function boundedFilesystemPath(value, label) {
  invariant(
    typeof value === "string" &&
      value.length > 0 &&
      value.length <= 4_096 &&
      !/[\0\r\n]/u.test(value),
    `${label} must be 1-4096 characters without nulls or line breaks.`,
  );
  return value;
}

function validateBundleIdentifier(value) {
  invariant(
    typeof value === "string" &&
      value.length <= 255 &&
      BUNDLE_IDENTIFIER.test(value),
    "The iOS starter bundle identifier is invalid.",
  );
  return value;
}

function validateTeamIdentifier(value) {
  invariant(
    typeof value === "string" && TEAM_IDENTIFIER.test(value),
    "The Apple development team identifier must contain 10 uppercase letters or digits.",
  );
  return value;
}

function boundedResultString(value, label) {
  invariant(
    typeof value === "string" &&
      value.length > 0 &&
      value.length <= 512 &&
      !/[\0\r\n]/u.test(value),
    `${label} is missing, oversized, or malformed.`,
  );
  return value;
}

function defaultCommandRunner(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: COMMAND_TIMEOUT_MILLISECONDS,
  });
  return {
    error: result.error,
    status: result.status,
    stderr: String(result.stderr ?? ""),
    stdout: String(result.stdout ?? ""),
  };
}

function defaultWait(milliseconds) {
  Atomics.wait(
    new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)),
    0,
    0,
    milliseconds,
  );
}

function dependencies(options) {
  return {
    hostPlatform: options.dependencies?.hostPlatform ?? process.platform,
    runCommand: options.dependencies?.runCommand ?? defaultCommandRunner,
    wait: options.dependencies?.wait ?? defaultWait,
  };
}

function normalizeCommandResult(result, label) {
  const normalized = {
    error: result?.error,
    status: result?.status ?? null,
    stderr: String(result?.stderr ?? ""),
    stdout: String(result?.stdout ?? ""),
  };
  invariant(
    Buffer.byteLength(normalized.stdout, "utf8") +
      Buffer.byteLength(normalized.stderr, "utf8") <=
      MAX_COMMAND_OUTPUT_BYTES,
    `${label} returned oversized output.`,
  );
  return normalized;
}

function commandError(label, result) {
  if (result.error instanceof Error) {
    if (result.error.code === "ETIMEDOUT") {
      return new Error(
        `${label} timed out. Connect the iPhone by USB, unlock it, confirm Trust, and wait until Xcode shows it available.`,
      );
    }
    return new Error(`${label} could not start: ${result.error.message}`);
  }
  const combined = `${result.stderr}\n${result.stdout}`;
  const detail = combined
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (
    label.startsWith("CoreDevice") &&
    /CoreDevice|devicectl/iu.test(combined)
  ) {
    return new Error(
      `${label} could not inspect the iPhone. Connect the iPhone by USB, unlock it, confirm Trust, and wait until Xcode shows it available.${detail === undefined ? "" : ` ${detail}`}`,
    );
  }
  return new Error(
    detail === undefined
      ? `${label} failed with exit status ${String(result.status)}.`
      : `${label} failed: ${detail}`,
  );
}

async function runCommand(dependency, command, arguments_, label) {
  const result = normalizeCommandResult(
    await dependency.runCommand(command, arguments_),
    label,
  );
  if (result.error !== undefined || result.status !== 0) {
    throw commandError(label, result);
  }
  return result;
}

export function parseCoreDeviceSuccessDocument(source, label) {
  invariant(
    typeof source === "string" &&
      Buffer.byteLength(source, "utf8") > 0 &&
      Buffer.byteLength(source, "utf8") <= MAX_CORE_DEVICE_DOCUMENT_BYTES,
    `${label} is empty or oversized.`,
  );
  let document;
  try {
    document = JSON.parse(source);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
  invariant(
    isRecord(document) &&
      isRecord(document.info) &&
      document.info.outcome === "success" &&
      !("error" in document) &&
      isRecord(document.result),
    `${label} is not a successful, complete CoreDevice result.`,
  );
  return document.result;
}

let coreDeviceCommandSequence = 0;

async function runCoreDevice(
  dependency,
  temporaryDirectory,
  arguments_,
  label,
  trailingArguments = [],
) {
  const outputPath = path.join(
    temporaryDirectory,
    `core-device-${String(coreDeviceCommandSequence)}.json`,
  );
  coreDeviceCommandSequence += 1;
  await runCommand(
    dependency,
    "xcrun",
    [
      "devicectl",
      ...arguments_,
      "--quiet",
      "--timeout",
      String(CORE_DEVICE_TIMEOUT_SECONDS),
      "--json-output",
      outputPath,
      ...trailingArguments,
    ],
    label,
  );
  let source;
  try {
    source = await readFile(outputPath, "utf8");
  } catch {
    throw new Error(`${label} succeeded without writing its JSON result.`);
  }
  return parseCoreDeviceSuccessDocument(source, label);
}

export function parseIOSStarterDeviceInventory(result, selector) {
  invariant(
    isRecord(result) && Array.isArray(result.devices),
    "CoreDevice returned an invalid device inventory.",
  );
  const matches = result.devices.filter(
    (device) =>
      isRecord(device) &&
      (device.identifier === selector ||
        (isRecord(device.hardwareProperties) &&
          device.hardwareProperties.udid === selector)),
  );
  invariant(
    matches.length === 1 && isRecord(matches[0]),
    `CoreDevice could not resolve physical iOS device ${selector}.`,
  );
  const device = matches[0];
  invariant(
    isRecord(device.hardwareProperties) &&
      device.hardwareProperties.platform === "iOS" &&
      device.hardwareProperties.reality === "physical" &&
      isRecord(device.deviceProperties) &&
      device.deviceProperties.developerModeStatus === "enabled",
    "The packed starter iOS gate requires a physical iPhone with Developer Mode enabled.",
  );
  return Object.freeze({
    coreDeviceIdentifier: boundedResultString(
      device.identifier,
      "CoreDevice identifier",
    ),
    model: boundedResultString(
      device.hardwareProperties.marketingName,
      "iOS device model",
    ),
    udid: boundedResultString(
      device.hardwareProperties.udid,
      "iOS device UDID",
    ),
  });
}

function assertUnlockedDevice(result, expectedIdentifier) {
  invariant(
    isRecord(result) &&
      result.deviceIdentifier === expectedIdentifier &&
      typeof result.passcodeRequired === "boolean" &&
      typeof result.unlockedSinceBoot === "boolean",
    "CoreDevice returned an invalid iOS lock-state result.",
  );
  invariant(
    result.passcodeRequired === false && result.unlockedSinceBoot === true,
    "The iPhone is locked. Unlock it and keep its display awake before running the packed starter hardware gate.",
  );
}

function installedApplications(result, bundleIdentifier) {
  invariant(
    isRecord(result) && Array.isArray(result.apps),
    "CoreDevice returned an invalid installed-application result.",
  );
  const unexpected = result.apps.some(
    (application) =>
      !isRecord(application) ||
      application.bundleIdentifier !== bundleIdentifier,
  );
  invariant(
    !unexpected,
    "CoreDevice returned an application outside the exact bundle filter.",
  );
  return result.apps;
}

async function inspectDevice(
  dependency,
  temporaryDirectory,
  selector,
  bundleIdentifier,
) {
  invariant(
    dependency.hostPlatform === "darwin",
    `The packed starter iOS gate requires macOS and Xcode; received ${dependency.hostPlatform}.`,
  );
  const inventory = await runCoreDevice(
    dependency,
    temporaryDirectory,
    ["list", "devices"],
    "CoreDevice physical-device lookup",
  );
  const device = parseIOSStarterDeviceInventory(inventory, selector);
  const lockState = await runCoreDevice(
    dependency,
    temporaryDirectory,
    ["device", "info", "lockState", "--device", selector],
    "CoreDevice lock-state lookup",
  );
  assertUnlockedDevice(lockState, device.coreDeviceIdentifier);
  const applications = installedApplications(
    await runCoreDevice(
      dependency,
      temporaryDirectory,
      [
        "device",
        "info",
        "apps",
        "--device",
        selector,
        "--bundle-id",
        bundleIdentifier,
      ],
      "CoreDevice bundle collision lookup",
    ),
    bundleIdentifier,
  );
  invariant(
    applications.length === 0,
    `Refusing to replace installed iOS application ${bundleIdentifier}.`,
  );
  return device;
}

export function createIOSStarterGateBundleIdentifier() {
  return IOS_STARTER_GATE_BUNDLE_IDENTIFIER;
}

export async function preflightPackedStarterIOSDevice(options) {
  const selector = boundedArgument(options.device, "iOS device identifier");
  const bundleIdentifier = validateBundleIdentifier(options.bundleIdentifier);
  const dependency = dependencies(options);
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "solid-native-ios-starter-preflight-"),
  );
  try {
    const device = await inspectDevice(
      dependency,
      temporaryDirectory,
      selector,
      bundleIdentifier,
    );
    return Object.freeze({ bundleIdentifier, selector, ...device });
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

async function verifySignedApplication(
  dependency,
  applicationPath,
  bundleIdentifier,
  teamIdentifier,
) {
  const application = await stat(applicationPath);
  invariant(
    application.isDirectory() && applicationPath.endsWith(".app"),
    "The packed starter iOS application bundle is missing or invalid.",
  );
  const identifier = (
    await runCommand(
      dependency,
      "plutil",
      [
        "-extract",
        "CFBundleIdentifier",
        "raw",
        "-o",
        "-",
        path.join(applicationPath, "Info.plist"),
      ],
      "Packed starter iOS bundle identity lookup",
    )
  ).stdout.trim();
  invariant(
    identifier === bundleIdentifier,
    `Refusing to install an iOS application for unexpected bundle ${JSON.stringify(identifier)}; expected ${bundleIdentifier}.`,
  );
  const signature = await runCommand(
    dependency,
    "codesign",
    ["-d", "--verbose=4", applicationPath],
    "Packed starter iOS signature lookup",
  );
  const signatureOutput = `${signature.stderr}\n${signature.stdout}`;
  const identifiers = [
    ...signatureOutput.matchAll(/(?:^|\n)Identifier=([^\r\n]+)(?:\r?\n|$)/gu),
  ];
  const teams = [
    ...signatureOutput.matchAll(
      /(?:^|\n)TeamIdentifier=([^\r\n]+)(?:\r?\n|$)/gu,
    ),
  ];
  invariant(
    identifiers.length === 1 && identifiers[0][1] === bundleIdentifier,
    "The signed iOS application identity does not match its bundle metadata.",
  );
  invariant(
    teams.length === 1 && teams[0][1] === teamIdentifier,
    "The signed iOS application does not belong to the requested development team.",
  );
}

function launchedProcess(result, expectedDeviceIdentifier) {
  invariant(
    isRecord(result) &&
      result.deviceIdentifier === expectedDeviceIdentifier &&
      isRecord(result.process) &&
      Number.isSafeInteger(result.process.processIdentifier) &&
      result.process.processIdentifier > 0,
    "CoreDevice did not confirm the packed starter iOS process launch.",
  );
  return Object.freeze({
    executable: boundedResultString(
      result.process.executable,
      "Packed starter iOS executable URL",
    ),
    processIdentifier: result.process.processIdentifier,
  });
}

function processIsPresent(result, processIdentifier, applicationURL) {
  const processLists = [result?.runningProcesses, result?.processes].filter(
    Array.isArray,
  );
  invariant(
    isRecord(result) && processLists.length === 1,
    "CoreDevice returned an invalid process inventory.",
  );
  const matches = processLists[0].filter(
    (process) =>
      isRecord(process) && process.processIdentifier === processIdentifier,
  );
  if (matches.length === 0) return false;
  invariant(
    matches.length === 1 &&
      isRecord(matches[0]) &&
      typeof matches[0].executable === "string" &&
      matches[0].executable.startsWith(applicationURL),
    "CoreDevice reported an unexpected process for the packed starter PID.",
  );
  return true;
}

async function currentApplications(
  dependency,
  temporaryDirectory,
  selector,
  bundleIdentifier,
  label,
) {
  return installedApplications(
    await runCoreDevice(
      dependency,
      temporaryDirectory,
      [
        "device",
        "info",
        "apps",
        "--device",
        selector,
        "--bundle-id",
        bundleIdentifier,
      ],
      label,
    ),
    bundleIdentifier,
  );
}

export async function verifyPackedStarterOnIOS(options) {
  const selector = boundedArgument(options.device, "iOS device identifier");
  const bundleIdentifier = validateBundleIdentifier(options.bundleIdentifier);
  const teamIdentifier = validateTeamIdentifier(options.teamIdentifier);
  const applicationPath = path.resolve(
    boundedFilesystemPath(
      options.applicationPath,
      "iOS application bundle path",
    ),
  );
  const dependency = dependencies(options);
  invariant(
    dependency.hostPlatform === "darwin",
    `The packed starter iOS gate requires macOS and Xcode; received ${dependency.hostPlatform}.`,
  );
  await verifySignedApplication(
    dependency,
    applicationPath,
    bundleIdentifier,
    teamIdentifier,
  );

  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "solid-native-ios-starter-device-"),
  );
  let device;
  let installAttempted = false;
  let installedApplicationURL;
  let processIdentifier;
  let failure;
  try {
    device = await inspectDevice(
      dependency,
      temporaryDirectory,
      selector,
      bundleIdentifier,
    );
    installAttempted = true;
    await runCoreDevice(
      dependency,
      temporaryDirectory,
      ["device", "install", "app", "--device", selector],
      "Packed starter iOS installation",
      [applicationPath],
    );
    const installed = await currentApplications(
      dependency,
      temporaryDirectory,
      selector,
      bundleIdentifier,
      "Packed starter iOS installation lookup",
    );
    invariant(
      installed.length === 1 &&
        isRecord(installed[0]) &&
        installed[0].builtByDeveloper === true &&
        typeof installed[0].url === "string",
      "CoreDevice did not expose exactly one developer-installed packed starter.",
    );
    installedApplicationURL = installed[0].url.endsWith("/")
      ? installed[0].url
      : `${installed[0].url}/`;
    const process = launchedProcess(
      await runCoreDevice(
        dependency,
        temporaryDirectory,
        ["device", "process", "launch", "--device", selector],
        "Packed starter iOS launch",
        [bundleIdentifier],
      ),
      device.coreDeviceIdentifier,
    );
    processIdentifier = process.processIdentifier;
    invariant(
      process.executable.startsWith(installedApplicationURL),
      "CoreDevice launched an executable outside the packed starter bundle.",
    );
    dependency.wait(1_500);
    invariant(
      processIsPresent(
        await runCoreDevice(
          dependency,
          temporaryDirectory,
          ["device", "info", "processes", "--device", selector],
          "Packed starter iOS process lookup",
        ),
        processIdentifier,
        installedApplicationURL,
      ),
      "The packed starter iOS process did not remain alive after launch.",
    );
  } catch (error) {
    failure = error;
  }

  const cleanupErrors = [];
  if (processIdentifier !== undefined) {
    try {
      const processes = await runCoreDevice(
        dependency,
        temporaryDirectory,
        ["device", "info", "processes", "--device", selector],
        "Packed starter iOS process cleanup lookup",
      );
      if (
        processIsPresent(
          processes,
          processIdentifier,
          installedApplicationURL ?? "file:///",
        )
      ) {
        await runCoreDevice(
          dependency,
          temporaryDirectory,
          [
            "device",
            "process",
            "terminate",
            "--device",
            selector,
            "--pid",
            String(processIdentifier),
          ],
          "Packed starter iOS process cleanup",
        );
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (installAttempted) {
    try {
      const installed = await currentApplications(
        dependency,
        temporaryDirectory,
        selector,
        bundleIdentifier,
        "Packed starter iOS cleanup lookup",
      );
      if (installed.length > 0) {
        await runCoreDevice(
          dependency,
          temporaryDirectory,
          ["device", "uninstall", "app", "--device", selector],
          "Packed starter iOS package cleanup",
          [bundleIdentifier],
        );
      }
      invariant(
        (
          await currentApplications(
            dependency,
            temporaryDirectory,
            selector,
            bundleIdentifier,
            "Packed starter iOS cleanup verification",
          )
        ).length === 0,
        "The packed starter iOS application survived cleanup.",
      );
      if (processIdentifier !== undefined) {
        invariant(
          !processIsPresent(
            await runCoreDevice(
              dependency,
              temporaryDirectory,
              ["device", "info", "processes", "--device", selector],
              "Packed starter iOS process cleanup verification",
            ),
            processIdentifier,
            "file:///",
          ),
          "The packed starter iOS process survived cleanup.",
        );
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    await rm(temporaryDirectory, { force: true, recursive: true });
  } catch (error) {
    cleanupErrors.push(error);
  }

  if (failure !== undefined && cleanupErrors.length > 0) {
    throw new AggregateError(
      [failure, ...cleanupErrors],
      "The packed starter iOS gate and its cleanup failed.",
    );
  }
  if (failure !== undefined) throw failure;
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      "The packed starter iOS gate could not clean up safely.",
    );
  }
  invariant(device !== undefined, "The packed starter iOS gate failed.");
  return Object.freeze({
    bundleIdentifier,
    coreDeviceIdentifier: device.coreDeviceIdentifier,
    model: device.model,
    selector,
    teamIdentifier,
    udid: device.udid,
  });
}
