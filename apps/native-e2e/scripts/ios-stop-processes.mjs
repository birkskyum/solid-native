import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const executableSuffixes = [
  "/SolidNativeE2E.app/SolidNativeE2E",
  "/SolidNativeE2EUITests-Runner.app/SolidNativeE2EUITests-Runner",
];

export function findSolidNativeProcesses(document) {
  const processes = document?.result?.runningProcesses;
  if (!Array.isArray(processes)) {
    throw new Error(
      "CoreDevice returned no result.runningProcesses process list.",
    );
  }

  return processes
    .filter(
      (process) =>
        typeof process?.executable === "string" &&
        executableSuffixes.some((suffix) =>
          process.executable.endsWith(suffix),
        ),
    )
    .map((process) => {
      if (
        !Number.isSafeInteger(process.processIdentifier) ||
        process.processIdentifier <= 0
      ) {
        throw new Error(
          "CoreDevice returned an invalid SolidNativeE2E process identifier.",
        );
      }
      return {
        executable: process.executable,
        processIdentifier: process.processIdentifier,
      };
    });
}

function coreDeviceErrorText(error) {
  if (error === null || typeof error !== "object") return String(error);
  return [error.message, error.stderr, error.stdout]
    .filter((value) => typeof value === "string" && value.trim() !== "")
    .join("\n");
}

export function describeCoreDeviceFailure(error) {
  const detail = coreDeviceErrorText(error);
  if (/kAMDMobileImageMounterDeviceLocked|device is locked/iu.test(detail)) {
    return (
      "The iOS device is locked. Unlock it and keep its display awake while " +
      "Xcode mounts developer services and runs the physical test."
    );
  }
  if (
    /tunnel (?:connection )?failed|tunnel was interrupted|RemotePairingError|Network\.NWError|Operation timed out/iu.test(
      detail,
    )
  ) {
    return (
      "CoreDevice could not establish the iOS developer-services tunnel. " +
      "Connect the phone by USB, unlock it, confirm Trust if prompted, and " +
      "wait until Xcode shows the device online."
    );
  }
  if (/Developer Mode[^\n]*disabled/iu.test(detail)) {
    return "Developer Mode is disabled on the iOS device. Enable it in Privacy & Security before running physical tests.";
  }
  return detail || "CoreDevice failed without diagnostic output.";
}

async function queryProcesses(device, directory, attempt) {
  const outputPath = path.join(directory, `processes-${attempt}.json`);
  try {
    await execFileAsync("xcrun", [
      "devicectl",
      "device",
      "info",
      "processes",
      "--device",
      device,
      "--json-output",
      outputPath,
      "--quiet",
    ]);
  } catch (error) {
    throw new Error(describeCoreDeviceFailure(error), { cause: error });
  }
  return findSolidNativeProcesses(
    JSON.parse(await readFile(outputPath, "utf8")),
  );
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const PARENT_WATCH_INTERVAL_MILLISECONDS = 250;
const PROCESS_CLEAN_STABILITY_POLLS = 4;
const MAXIMUM_PROCESS_CLEAN_POLLS = 24;
const PROCESS_CLEANUP_RETRY_ATTEMPTS = 3;
const PROCESS_CLEANUP_RETRY_DELAY_MILLISECONDS = 500;
export const DEFAULT_IOS_PROCESS_GUARD_TIMEOUT_MILLISECONDS = 20 * 60 * 1_000;
const MAXIMUM_IOS_PROCESS_GUARD_TIMEOUT_MILLISECONDS = 60 * 60 * 1_000;

function processIsAlive(processIdentifier) {
  try {
    process.kill(processIdentifier, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

function positiveParentProcessIdentifier(value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("The iOS process watchdog requires a positive parent PID.");
  }
  return value;
}

function positiveGuardTimeout(value) {
  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > MAXIMUM_IOS_PROCESS_GUARD_TIMEOUT_MILLISECONDS
  ) {
    throw new Error(
      "The iOS process watchdog timeout must be a positive integer of at most 3600000 milliseconds.",
    );
  }
  return value;
}

function processIdentifiers(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(
      "The iOS process lease requires at least one positive process identifier.",
    );
  }
  const identifiers = new Set();
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(
        "The iOS process lease requires positive process identifiers.",
      );
    }
    identifiers.add(value);
  }
  return [...identifiers];
}

export function spawnSolidNativeProcessWatchdog(
  device,
  parentProcessIdentifier,
  maximumRuntimeMilliseconds = DEFAULT_IOS_PROCESS_GUARD_TIMEOUT_MILLISECONDS,
  spawnProcess = spawn,
) {
  const parent = positiveParentProcessIdentifier(parentProcessIdentifier);
  const timeout = positiveGuardTimeout(maximumRuntimeMilliseconds);
  if (typeof device !== "string" || device.trim() === "") {
    throw new Error("The iOS process watchdog requires a device identifier.");
  }
  if (typeof spawnProcess !== "function") {
    throw new TypeError("The iOS process watchdog launcher is invalid.");
  }
  const child = spawnProcess(
    process.execPath,
    [
      fileURLToPath(import.meta.url),
      "--watch-parent",
      String(parent),
      String(timeout),
      device,
    ],
    { detached: true, stdio: "ignore" },
  );
  if (!Number.isSafeInteger(child.pid) || child.pid <= 0) {
    throw new Error("The detached iOS process watchdog did not start.");
  }
  child.unref();
  return child.pid;
}

export function spawnSolidNativeProcessLeaseWatchdog(
  device,
  leasedProcessIdentifiers,
  maximumRuntimeMilliseconds = DEFAULT_IOS_PROCESS_GUARD_TIMEOUT_MILLISECONDS,
  spawnProcess = spawn,
) {
  const identifiers = processIdentifiers(leasedProcessIdentifiers);
  const timeout = positiveGuardTimeout(maximumRuntimeMilliseconds);
  if (typeof device !== "string" || device.trim() === "") {
    throw new Error("The iOS process lease requires a device identifier.");
  }
  if (typeof spawnProcess !== "function") {
    throw new TypeError("The iOS process lease launcher is invalid.");
  }
  const child = spawnProcess(
    process.execPath,
    [
      fileURLToPath(import.meta.url),
      "--stop-after",
      String(timeout),
      device,
      ...identifiers.map(String),
    ],
    { detached: true, stdio: "ignore" },
  );
  if (!Number.isSafeInteger(child.pid) || child.pid <= 0) {
    throw new Error("The detached iOS process lease did not start.");
  }
  child.unref();
  return child.pid;
}

export async function stopSolidNativeProcessesWhenParentExits(
  device,
  parentProcessIdentifier,
  {
    maximumRuntimeMilliseconds = DEFAULT_IOS_PROCESS_GUARD_TIMEOUT_MILLISECONDS,
    now = () => performance.now(),
    parentProcessIsAlive = processIsAlive,
    wait = delay,
    stop = stopSolidNativeProcesses,
  } = {},
) {
  const parent = positiveParentProcessIdentifier(parentProcessIdentifier);
  const timeout = positiveGuardTimeout(maximumRuntimeMilliseconds);
  if (typeof parentProcessIsAlive !== "function") {
    throw new TypeError("The iOS process watchdog liveness probe is invalid.");
  }
  if (
    typeof now !== "function" ||
    typeof wait !== "function" ||
    typeof stop !== "function"
  ) {
    throw new TypeError("The iOS process watchdog lifecycle is invalid.");
  }

  const startedAt = now();
  if (!Number.isFinite(startedAt)) {
    throw new TypeError("The iOS process watchdog clock is invalid.");
  }
  const deadline = startedAt + timeout;
  while (parentProcessIsAlive(parent)) {
    const remaining = deadline - now();
    if (!Number.isFinite(remaining)) {
      throw new TypeError("The iOS process watchdog clock is invalid.");
    }
    if (remaining <= 0) break;
    const interval = Math.min(PARENT_WATCH_INTERVAL_MILLISECONDS, remaining);
    await wait(interval);
  }
  return stop(device);
}

export async function stopSolidNativeProcessesAfterLease(
  device,
  leasedProcessIdentifiers,
  {
    maximumRuntimeMilliseconds = DEFAULT_IOS_PROCESS_GUARD_TIMEOUT_MILLISECONDS,
    wait = delay,
    stop = stopSolidNativeProcessIdentifiers,
  } = {},
) {
  const identifiers = processIdentifiers(leasedProcessIdentifiers);
  const timeout = positiveGuardTimeout(maximumRuntimeMilliseconds);
  if (typeof wait !== "function" || typeof stop !== "function") {
    throw new TypeError("The iOS process lease lifecycle is invalid.");
  }
  await wait(timeout);
  return stop(device, identifiers);
}

async function withProcessDirectory(callback) {
  const directory = await mkdtemp(
    path.join(tmpdir(), "solid-native-ios-processes-"),
  );
  try {
    return await callback(directory);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

async function terminateSolidNativeProcesses(device, directory, running) {
  const targetIdentifiers = new Set(
    running.map((process) => process.processIdentifier),
  );
  if (targetIdentifiers.size === 0) return [];

  for (const process of running) {
    try {
      await execFileAsync("xcrun", [
        "devicectl",
        "device",
        "process",
        "terminate",
        "--device",
        device,
        "--pid",
        String(process.processIdentifier),
        "--quiet",
      ]);
    } catch (error) {
      const remaining = await queryProcesses(
        device,
        directory,
        `terminate-${process.processIdentifier}`,
      );
      if (
        !remaining.some(
          (candidate) =>
            candidate.processIdentifier === process.processIdentifier,
        )
      ) {
        continue;
      }
      throw new Error(describeCoreDeviceFailure(error), { cause: error });
    }
  }

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const remaining = (await queryProcesses(device, directory, attempt)).filter(
      (process) => targetIdentifiers.has(process.processIdentifier),
    );
    if (remaining.length === 0) return running;
    if (attempt < 6) await delay(250);
  }
  throw new Error(
    "A targeted SolidNativeE2E process remained alive after CoreDevice reported termination.",
  );
}

export async function readSolidNativeProcesses(device) {
  if (typeof device !== "string" || device.trim() === "") {
    throw new Error(
      "Pass the connected device identifier or set SOLID_NATIVE_IOS_DESTINATION.",
    );
  }
  return withProcessDirectory((directory) =>
    queryProcesses(device, directory, "read"),
  );
}

export async function stopSolidNativeProcessIdentifiers(
  device,
  leasedProcessIdentifiers,
) {
  if (typeof device !== "string" || device.trim() === "") {
    throw new Error("The iOS process lease requires a device identifier.");
  }
  const identifiers = new Set(processIdentifiers(leasedProcessIdentifiers));
  return withProcessDirectory(async (directory) => {
    const running = (await queryProcesses(device, directory, 0)).filter(
      (process) => identifiers.has(process.processIdentifier),
    );
    return terminateSolidNativeProcesses(device, directory, running);
  });
}

/**
 * Broad cleanup must follow immediate replacement PIDs. CoreDevice can report
 * that the exact process it terminated is gone while iOS has already launched
 * another process for the same foreground application scene. Require a full
 * one-second clean stability window before reporting that every Solid Native
 * application and test runner is absent.
 */
export async function stopAllSolidNativeProcessGenerations(
  device,
  {
    read = readSolidNativeProcesses,
    stop = stopSolidNativeProcessIdentifiers,
    wait = delay,
  } = {},
) {
  if (typeof device !== "string" || device.trim() === "") {
    throw new Error(
      "Pass the connected device identifier or set SOLID_NATIVE_IOS_DESTINATION.",
    );
  }
  if (
    typeof read !== "function" ||
    typeof stop !== "function" ||
    typeof wait !== "function"
  ) {
    throw new TypeError("The iOS process cleanup lifecycle is invalid.");
  }

  const terminated = new Map();
  let consecutiveCleanPolls = 0;
  for (let attempt = 0; attempt < MAXIMUM_PROCESS_CLEAN_POLLS; attempt += 1) {
    const running = await read(device);
    if (!Array.isArray(running)) {
      throw new TypeError("The iOS process cleanup reader is invalid.");
    }
    if (running.length === 0) {
      consecutiveCleanPolls += 1;
      if (consecutiveCleanPolls >= PROCESS_CLEAN_STABILITY_POLLS) {
        return [...terminated.values()];
      }
      await wait(PARENT_WATCH_INTERVAL_MILLISECONDS);
      continue;
    }

    consecutiveCleanPolls = 0;
    const identifiers = [];
    for (const process of running) {
      if (
        !Number.isSafeInteger(process?.processIdentifier) ||
        process.processIdentifier <= 0 ||
        typeof process.executable !== "string"
      ) {
        throw new TypeError("The iOS process cleanup reader is invalid.");
      }
      identifiers.push(process.processIdentifier);
      terminated.set(process.processIdentifier, process);
    }
    await stop(device, identifiers);
  }

  const remaining = await read(device);
  throw new Error(
    `Solid Native iOS processes kept relaunching during cleanup${
      Array.isArray(remaining) && remaining.length > 0
        ? `: ${remaining.map((process) => String(process.processIdentifier)).join(", ")}`
        : "."
    }`,
  );
}

export async function stopSolidNativeProcesses(
  device,
  {
    attempts = PROCESS_CLEANUP_RETRY_ATTEMPTS,
    retryDelayMilliseconds = PROCESS_CLEANUP_RETRY_DELAY_MILLISECONDS,
    stop = stopAllSolidNativeProcessGenerations,
    wait = delay,
  } = {},
) {
  if (typeof device !== "string" || device.trim() === "") {
    throw new Error(
      "Pass the connected device identifier or set SOLID_NATIVE_IOS_DESTINATION.",
    );
  }
  if (!Number.isSafeInteger(attempts) || attempts <= 0 || attempts > 10) {
    throw new TypeError(
      "The iOS process cleanup retry count must be an integer from 1 through 10.",
    );
  }
  if (
    !Number.isSafeInteger(retryDelayMilliseconds) ||
    retryDelayMilliseconds < 0 ||
    retryDelayMilliseconds > 5_000
  ) {
    throw new TypeError(
      "The iOS process cleanup retry delay must be an integer from 0 through 5000 milliseconds.",
    );
  }
  if (typeof stop !== "function" || typeof wait !== "function") {
    throw new TypeError("The iOS process cleanup retry lifecycle is invalid.");
  }

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await stop(device);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await wait(retryDelayMilliseconds);
    }
  }

  throw new Error(
    `Solid Native could not verify iOS process cleanup after ${attempts} attempts: ${describeCoreDeviceFailure(lastError)}`,
    { cause: lastError },
  );
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  path.resolve(invokedPath) === fileURLToPath(import.meta.url)
) {
  try {
    const arguments_ = process.argv.slice(2);
    if (arguments_[0] === "--spawn-watchdog") {
      if (arguments_.length !== 4) {
        throw new Error(
          "Usage: ios-stop-processes.mjs --spawn-watchdog <pid> <timeout-ms> <device>",
        );
      }
      console.log(
        spawnSolidNativeProcessWatchdog(
          arguments_[3],
          Number(arguments_[1]),
          Number(arguments_[2]),
        ),
      );
    } else if (arguments_[0] === "--spawn-lease") {
      if (arguments_.length !== 3) {
        throw new Error(
          "Usage: ios-stop-processes.mjs --spawn-lease <timeout-ms> <device>",
        );
      }
      const running = await readSolidNativeProcesses(arguments_[2]);
      if (running.length === 0) {
        throw new Error(
          "Cannot lease an iOS launch because no Solid Native application process is running.",
        );
      }
      console.log(
        spawnSolidNativeProcessLeaseWatchdog(
          arguments_[2],
          running.map((process) => process.processIdentifier),
          Number(arguments_[1]),
        ),
      );
    } else if (arguments_[0] === "--watch-parent") {
      if (arguments_.length !== 4) {
        throw new Error(
          "Usage: ios-stop-processes.mjs --watch-parent <pid> <timeout-ms> <device>",
        );
      }
      await stopSolidNativeProcessesWhenParentExits(
        arguments_[3],
        Number(arguments_[1]),
        { maximumRuntimeMilliseconds: Number(arguments_[2]) },
      );
    } else if (arguments_[0] === "--stop-after") {
      if (arguments_.length < 4) {
        throw new Error(
          "Usage: ios-stop-processes.mjs --stop-after <timeout-ms> <device> <pid...>",
        );
      }
      await stopSolidNativeProcessesAfterLease(
        arguments_[2],
        arguments_.slice(3).map(Number),
        { maximumRuntimeMilliseconds: Number(arguments_[1]) },
      );
    } else {
      if (arguments_.length > 1) {
        throw new Error("Usage: ios-stop-processes.mjs [device]");
      }
      const stopped = await stopSolidNativeProcesses(
        arguments_[0] ?? process.env.SOLID_NATIVE_IOS_DESTINATION,
      );
      if (stopped.length === 0) {
        console.log(
          "No Solid Native application or test-runner device processes were running.",
        );
      } else {
        console.log(
          `Stopped ${stopped.length} Solid Native application/test device ${
            stopped.length === 1 ? "process" : "processes"
          }.`,
        );
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
