import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const MAX_COMMAND_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_UI_DOCUMENT_BYTES = 2 * 1024 * 1024;
const MAX_APK_BYTES = 2 * 1024 * 1024 * 1024;
const UI_ATTEMPTS = 12;
const UI_SETTLE_MILLISECONDS = 250;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
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

function validatePackageName(value) {
  invariant(
    typeof value === "string" &&
      value.length <= 200 &&
      /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){2,}$/u.test(value),
    "The Android starter package name is invalid.",
  );
  return value;
}

function defaultCommandRunner(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: options.cwd,
    encoding: "utf8",
    env: process.env,
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
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

function outputBytes(result) {
  return (
    Buffer.byteLength(result.stdout, "utf8") +
    Buffer.byteLength(result.stderr, "utf8")
  );
}

export function isSuccessfulAdbPackageOperation(source) {
  if (typeof source !== "string") return false;
  const lines = source
    .replaceAll("\r", "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return (
    lines.length > 0 &&
    lines.length <= 32 &&
    lines.every(
      (line) =>
        Buffer.byteLength(line, "utf8") <= 512 && !/[\0-\x1f\x7f]/u.test(line),
    ) &&
    lines.at(-1) === "Success" &&
    lines
      .slice(0, -1)
      .every(
        (line) =>
          !/^(?:error|failure)(?:\b|:|\[)/iu.test(line) &&
          !/\bINSTALL_FAILED_/u.test(line),
      )
  );
}

function commandError(label, result) {
  if (result.error instanceof Error) {
    return new Error(`${label} could not start: ${result.error.message}`);
  }
  const detail = `${result.stderr}\n${result.stdout}`
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return new Error(
    detail === undefined
      ? `${label} failed with exit status ${String(result.status)}.`
      : `${label} failed: ${detail}`,
  );
}

function exactAttribute(tag, attribute) {
  const expression = new RegExp(`(?:^|\\s)${attribute}="([^"]*)"`, "gu");
  const matches = [...tag.matchAll(expression)];
  invariant(
    matches.length === 1,
    `Android UI node ${attribute} must appear exactly once.`,
  );
  return decodeXmlAttribute(matches[0][1], `Android UI node ${attribute}`);
}

function decodeXmlAttribute(source, label) {
  invariant(
    !/&(?!(?:quot|apos|lt|gt|amp|#\d+|#x[\da-fA-F]+);)/u.test(source),
    `${label} contains an unsupported XML entity.`,
  );
  const decoded = source.replace(
    /&(?:quot|apos|lt|gt|amp|#\d+|#x[\da-fA-F]+);/gu,
    (entity) => {
      if (entity === "&quot;") return '"';
      if (entity === "&apos;") return "'";
      if (entity === "&lt;") return "<";
      if (entity === "&gt;") return ">";
      if (entity === "&amp;") return "&";
      const hexadecimal = entity.startsWith("&#x");
      const codePoint = Number.parseInt(
        entity.slice(hexadecimal ? 3 : 2, -1),
        hexadecimal ? 16 : 10,
      );
      invariant(
        Number.isInteger(codePoint) &&
          codePoint >= 0 &&
          codePoint <= 0x10ffff &&
          !(codePoint >= 0xd800 && codePoint <= 0xdfff),
        `${label} contains an invalid numeric XML entity.`,
      );
      return String.fromCodePoint(codePoint);
    },
  );
  invariant(
    !/[\0-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(decoded),
    `${label} contains a control character.`,
  );
  return decoded;
}

function booleanAttribute(tag, attribute) {
  const value = exactAttribute(tag, attribute);
  invariant(
    value === "true" || value === "false",
    `Android UI node ${attribute} must be boolean.`,
  );
  return value === "true";
}

function boundsAttribute(tag) {
  const source = exactAttribute(tag, "bounds");
  const match = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/u.exec(source);
  invariant(match !== null, "Android UI node bounds are invalid.");
  const [left, top, right, bottom] = match
    .slice(1)
    .map((value) => Number(value));
  invariant(
    [left, top, right, bottom].every(Number.isSafeInteger) &&
      left >= 0 &&
      top >= 0 &&
      right >= left &&
      bottom >= top &&
      right <= 100_000 &&
      bottom <= 100_000,
    "Android UI node bounds are empty or out of range.",
  );
  return Object.freeze({ bottom, left, right, top });
}

export function parseAndroidStarterUiDocument(source) {
  invariant(
    typeof source === "string" &&
      Buffer.byteLength(source, "utf8") > 0 &&
      Buffer.byteLength(source, "utf8") <= MAX_UI_DOCUMENT_BYTES,
    "The Android UI document is empty or oversized.",
  );
  invariant(
    !/<!(?:DOCTYPE|ENTITY)/iu.test(source),
    "The Android UI document cannot declare a document type or entity.",
  );
  invariant(
    /<hierarchy\b[^>]*>/u.test(source) && /<\/hierarchy>/u.test(source),
    "The Android UI document is incomplete.",
  );
  const tags = [...source.matchAll(/<node\b[^>]*>/gu)].map((match) => match[0]);
  invariant(
    tags.length > 0 && tags.length <= 10_000,
    "The Android UI document has an invalid node count.",
  );
  return Object.freeze(
    tags.map((tag) =>
      Object.freeze({
        bounds: boundsAttribute(tag),
        clickable: booleanAttribute(tag, "clickable"),
        contentDescription: exactAttribute(tag, "content-desc"),
        enabled: booleanAttribute(tag, "enabled"),
        packageName: exactAttribute(tag, "package"),
        text: exactAttribute(tag, "text"),
      }),
    ),
  );
}

function oneNode(nodes, predicate, label) {
  const matches = nodes.filter(predicate);
  invariant(matches.length === 1, `Expected exactly one ${label} UI node.`);
  return matches[0];
}

export function verifyAndroidStarterUiDocument(
  source,
  packageName,
  expectedCount,
) {
  validatePackageName(packageName);
  invariant(
    expectedCount === 0 || expectedCount === 1,
    "The starter UI count must be zero or one.",
  );
  const nodes = parseAndroidStarterUiDocument(source);
  const applicationNodes = nodes.filter(
    (node) => node.packageName === packageName,
  );
  invariant(
    applicationNodes.length > 0,
    "The Android UI document does not belong to the packed starter.",
  );
  oneNode(
    applicationNodes,
    (node) => node.text === "Packed Starter",
    "packed starter title",
  );
  oneNode(
    applicationNodes,
    (node) => node.text === "Solid owns this native Fabric tree directly.",
    "Solid-owned Fabric description",
  );
  oneNode(
    applicationNodes,
    (node) =>
      node.text === `Press count: ${String(expectedCount)}` ||
      node.contentDescription === `Press count: ${String(expectedCount)}`,
    "starter counter",
  );
  const increment = oneNode(
    applicationNodes,
    (node) => node.contentDescription === "Increment counter",
    "increment action",
  );
  invariant(
    increment.clickable &&
      increment.enabled &&
      increment.bounds.right > increment.bounds.left &&
      increment.bounds.bottom > increment.bounds.top,
    "The packed starter increment action is not enabled and clickable.",
  );
  invariant(
    !applicationNodes.some((node) =>
      node.text.includes("Solid Native could not start"),
    ),
    "The packed starter displayed its native startup failure view.",
  );
  return increment.bounds;
}

function normalizeCommandResult(result, label) {
  const normalized = {
    error: result?.error,
    status: result?.status ?? null,
    stderr: String(result?.stderr ?? ""),
    stdout: String(result?.stdout ?? ""),
  };
  invariant(
    outputBytes(normalized) <= MAX_COMMAND_OUTPUT_BYTES,
    `${label} returned oversized output.`,
  );
  return normalized;
}

function runAdb(
  dependencies,
  serial,
  arguments_,
  label,
  allowedStatuses = [0],
) {
  const result = normalizeCommandResult(
    dependencies.runCommand("adb", ["-s", serial, ...arguments_]),
    label,
  );
  if (result.error !== undefined || !allowedStatuses.includes(result.status)) {
    throw commandError(label, result);
  }
  return result.stdout.replaceAll("\r", "");
}

function currentPackagePath(dependencies, serial, packageName) {
  return runAdb(
    dependencies,
    serial,
    ["shell", "pm", "path", packageName],
    "Android package lookup",
    [0, 1],
  ).trim();
}

function currentProcessIdentifiers(dependencies, serial, packageName) {
  return runAdb(
    dependencies,
    serial,
    ["shell", "pidof", packageName],
    "Android process lookup",
    [0, 1],
  ).trim();
}

function readStayAwakeSetting(dependencies, serial) {
  const value = runAdb(
    dependencies,
    serial,
    ["shell", "settings", "get", "global", "stay_on_while_plugged_in"],
    "Android stay-awake lookup",
  ).trim();
  invariant(
    value === "null" || /^(?:0|[1-9]\d*)$/u.test(value),
    "Android returned an invalid stay-awake setting.",
  );
  return value;
}

function writeStayAwakeSetting(dependencies, serial, value) {
  if (value === "null") {
    runAdb(
      dependencies,
      serial,
      ["shell", "settings", "delete", "global", "stay_on_while_plugged_in"],
      "Android stay-awake restoration",
    );
    return;
  }
  runAdb(
    dependencies,
    serial,
    ["shell", "settings", "put", "global", "stay_on_while_plugged_in", value],
    "Android stay-awake update",
  );
}

function prepareDevice(dependencies, serial) {
  runAdb(
    dependencies,
    serial,
    ["shell", "input", "keyevent", "KEYCODE_WAKEUP"],
    "Android wake request",
  );
  runAdb(
    dependencies,
    serial,
    ["shell", "wm", "dismiss-keyguard"],
    "Android keyguard dismissal",
  );
  runAdb(
    dependencies,
    serial,
    ["shell", "cmd", "statusbar", "collapse"],
    "Android status-bar collapse",
    [0, 1],
  );
  dependencies.wait(1_000);
  assertDeviceUnlocked(dependencies, serial);
}

function assertDeviceUnlocked(dependencies, serial) {
  const policy = runAdb(
    dependencies,
    serial,
    ["shell", "dumpsys", "window", "policy"],
    "Android keyguard lookup",
  );
  const delegate = policy.indexOf("KeyguardServiceDelegate");
  const showing =
    delegate === -1
      ? null
      : /(?:^|\s)showing=(true|false)\b/u.exec(
          policy.slice(delegate, delegate + 4_096),
        );
  invariant(
    showing?.[1] === "false",
    `Android device ${serial} is locked; unlock it before running the packed starter hardware gate.`,
  );
}

function deviceDependencies(options) {
  return {
    aapt2Command: options.dependencies?.aapt2Command,
    runCommand: options.dependencies?.runCommand ?? defaultCommandRunner,
    wait: options.dependencies?.wait ?? defaultWait,
  };
}

async function executableExists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function resolveAapt2Command(dependencies) {
  if (dependencies.aapt2Command !== undefined) {
    return boundedArgument(dependencies.aapt2Command, "aapt2 command");
  }
  const roots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    path.join(homedir(), "Library", "Android", "sdk"),
    path.join(homedir(), "Android", "Sdk"),
  ].filter((candidate, index, candidates) =>
    candidate === undefined ? false : candidates.indexOf(candidate) === index,
  );
  const executable = process.platform === "win32" ? "aapt2.exe" : "aapt2";
  for (const root of roots) {
    const buildTools = path.join(root, "build-tools");
    let versions;
    try {
      versions = await readdir(buildTools, { withFileTypes: true });
    } catch {
      continue;
    }
    versions.sort((left, right) =>
      right.name.localeCompare(left.name, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
    for (const version of versions) {
      if (!version.isDirectory()) continue;
      const candidate = path.join(buildTools, version.name, executable);
      if (await executableExists(candidate)) return candidate;
    }
  }
  return executable;
}

async function verifyApkPackageIdentity(dependencies, apkPath, packageName) {
  const command = await resolveAapt2Command(dependencies);
  const result = normalizeCommandResult(
    dependencies.runCommand(command, ["dump", "packagename", apkPath]),
    "Packed starter APK identity lookup",
  );
  if (result.error !== undefined || result.status !== 0) {
    throw commandError("Packed starter APK identity lookup", result);
  }
  const embeddedPackageName = result.stdout.trim();
  invariant(
    embeddedPackageName === packageName,
    `Refusing to install an APK for unexpected package ${JSON.stringify(embeddedPackageName)}; expected ${packageName}.`,
  );
}

function inspectDevice(dependencies, serial, packageName) {
  invariant(
    runAdb(
      dependencies,
      serial,
      ["get-state"],
      "Android device state",
    ).trim() === "device",
    `Android device ${serial} is unavailable or unauthorized.`,
  );
  invariant(
    runAdb(
      dependencies,
      serial,
      ["shell", "getprop", "ro.kernel.qemu"],
      "Android hardware lookup",
    ).trim() !== "1",
    "The packed starter hardware gate requires a physical Android device.",
  );
  invariant(
    currentPackagePath(dependencies, serial, packageName) === "",
    `Refusing to replace an installed Android package ${packageName}.`,
  );
}

function captureUiDocument(dependencies, serial, devicePath) {
  try {
    runAdb(
      dependencies,
      serial,
      ["shell", "uiautomator", "dump", devicePath],
      "Android UI capture",
    );
    return runAdb(
      dependencies,
      serial,
      ["exec-out", "cat", devicePath],
      "Android UI document read",
    );
  } finally {
    runAdb(
      dependencies,
      serial,
      ["shell", "rm", "-f", devicePath],
      "Android UI document cleanup",
    );
  }
}

function awaitUiState(
  dependencies,
  serial,
  devicePath,
  packageName,
  expectedCount,
) {
  let lastError;
  for (let attempt = 0; attempt < UI_ATTEMPTS; attempt += 1) {
    try {
      return verifyAndroidStarterUiDocument(
        captureUiDocument(dependencies, serial, devicePath),
        packageName,
        expectedCount,
      );
    } catch (error) {
      lastError = error;
      if (attempt + 1 < UI_ATTEMPTS) {
        dependencies.wait(UI_SETTLE_MILLISECONDS);
      }
    }
  }
  throw new Error(
    `The packed starter did not expose count ${String(expectedCount)} through Android accessibility: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

function cleanupInstalledApplication(
  dependencies,
  serial,
  packageName,
  installAttempted,
) {
  if (!installAttempted) return;
  if (currentPackagePath(dependencies, serial, packageName) === "") return;
  runAdb(
    dependencies,
    serial,
    ["shell", "am", "force-stop", packageName],
    "Packed starter process cleanup",
    [0, 1],
  );
  const uninstall = runAdb(
    dependencies,
    serial,
    ["uninstall", packageName],
    "Packed starter package cleanup",
  );
  invariant(
    isSuccessfulAdbPackageOperation(uninstall),
    "Android did not acknowledge packed starter package cleanup.",
  );
  invariant(
    currentProcessIdentifiers(dependencies, serial, packageName) === "",
    "The packed starter process survived cleanup.",
  );
  invariant(
    currentPackagePath(dependencies, serial, packageName) === "",
    "The packed starter package survived cleanup.",
  );
}

export function createAndroidStarterGatePackageName() {
  return `dev.solidnative.packedstarter.gate${randomBytes(6).toString("hex")}`;
}

export function preflightPackedStarterAndroidDevice(options) {
  const serial = boundedArgument(options.serial, "Android device serial");
  const packageName = validatePackageName(options.packageName);
  const dependencies = deviceDependencies(options);
  inspectDevice(dependencies, serial, packageName);
  assertDeviceUnlocked(dependencies, serial);
  return Object.freeze({ packageName, serial });
}

export async function verifyPackedStarterOnAndroid(options) {
  const serial = boundedArgument(options.serial, "Android device serial");
  const packageName = validatePackageName(options.packageName);
  const apkPath = options.apkPath;
  invariant(
    typeof apkPath === "string" && apkPath.length > 0,
    "The packed starter APK path is required.",
  );
  const apk = await stat(apkPath);
  invariant(
    apk.isFile() && apk.size > 0 && apk.size <= MAX_APK_BYTES,
    "The packed starter APK is empty, oversized, or not a file.",
  );
  const dependencies = deviceDependencies(options);
  await verifyApkPackageIdentity(dependencies, apkPath, packageName);
  const devicePath = `/data/local/tmp/solid-native-packed-starter-${process.pid}-${randomBytes(6).toString("hex")}.xml`;
  let installAttempted = false;
  let leasedStayAwake;
  let failure;
  let result;
  try {
    inspectDevice(dependencies, serial, packageName);
    leasedStayAwake = readStayAwakeSetting(dependencies, serial);
    writeStayAwakeSetting(dependencies, serial, "3");
    prepareDevice(dependencies, serial);

    installAttempted = true;
    const install = runAdb(
      dependencies,
      serial,
      ["install", apkPath],
      "Packed starter APK installation",
    );
    invariant(
      isSuccessfulAdbPackageOperation(install),
      "Android did not acknowledge packed starter APK installation.",
    );
    const launch = runAdb(
      dependencies,
      serial,
      [
        "shell",
        "am",
        "start",
        "-W",
        "-n",
        `${packageName}/${packageName}.MainActivity`,
      ],
      "Packed starter launch",
    );
    invariant(
      /(?:^|\n)Status:\s*ok\s*(?:\n|$)/u.test(launch) &&
        launch.includes(packageName),
      "Android did not acknowledge the exact packed starter Activity launch.",
    );
    const initialActionBounds = awaitUiState(
      dependencies,
      serial,
      devicePath,
      packageName,
      0,
    );
    const x = Math.floor(
      (initialActionBounds.left + initialActionBounds.right) / 2,
    );
    const y = Math.floor(
      (initialActionBounds.top + initialActionBounds.bottom) / 2,
    );
    runAdb(
      dependencies,
      serial,
      ["shell", "input", "tap", String(x), String(y)],
      "Packed starter physical press",
    );
    awaitUiState(dependencies, serial, devicePath, packageName, 1);
    const processIdentifiers = currentProcessIdentifiers(
      dependencies,
      serial,
      packageName,
    );
    invariant(
      /^\d+(?:\s+\d+)*$/u.test(processIdentifiers),
      "The packed starter process was not alive after its Solid update.",
    );
    const model = boundedArgument(
      runAdb(
        dependencies,
        serial,
        ["shell", "getprop", "ro.product.model"],
        "Android model lookup",
      ).trim(),
      "Android device model",
    );
    result = Object.freeze({ model, packageName, serial });
  } catch (error) {
    failure = error;
  }

  const cleanupErrors = [];
  try {
    cleanupInstalledApplication(
      dependencies,
      serial,
      packageName,
      installAttempted,
    );
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (leasedStayAwake !== undefined) {
    try {
      writeStayAwakeSetting(dependencies, serial, leasedStayAwake);
      invariant(
        readStayAwakeSetting(dependencies, serial) === leasedStayAwake,
        "The packed starter gate did not restore Android's stay-awake setting.",
      );
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (failure !== undefined && cleanupErrors.length > 0) {
    throw new AggregateError(
      [failure, ...cleanupErrors],
      "The packed starter hardware gate and its cleanup failed.",
    );
  }
  if (failure !== undefined) throw failure;
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      "The packed starter hardware gate could not clean up safely.",
    );
  }
  invariant(result !== undefined, "The packed starter hardware gate failed.");
  return result;
}
