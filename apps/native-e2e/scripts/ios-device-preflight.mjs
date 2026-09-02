import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describeCoreDeviceFailure } from "./ios-stop-processes.mjs";

const execFileAsync = promisify(execFile);
const defaultUnlockPollMilliseconds = 10_000;

export class IOSDeviceLockedError extends Error {
  constructor() {
    super(
      "The iOS device is locked. Unlock it and keep its display awake before starting physical device work.",
    );
    this.name = "IOSDeviceLockedError";
  }
}

export class IOSTransientLockStateError extends Error {
  constructor(cause) {
    super(
      "CoreDevice's bounded iOS lock-state query timed out before returning authoritative state.",
      { cause },
    );
    this.name = "IOSTransientLockStateError";
  }
}

function isTransientLockStateFailure(error) {
  if (error === null || typeof error !== "object") return false;
  return [error.message, error.stderr, error.stdout]
    .filter((value) => typeof value === "string")
    .some((value) =>
      /Command timeout of 10(?:\.0)? seconds exceeded\. Assuming command got stuck and aborting\.|com\.apple\.mobiledevice error -402653181 \(0xE8000003\)/u.test(
        value,
      ),
    );
}

export function assertUnlockedIOSDevice(document) {
  const result = document?.result;
  if (
    result === null ||
    typeof result !== "object" ||
    typeof result.deviceIdentifier !== "string" ||
    result.deviceIdentifier.trim() === "" ||
    typeof result.passcodeRequired !== "boolean" ||
    typeof result.unlockedSinceBoot !== "boolean"
  ) {
    throw new Error("CoreDevice returned an invalid iOS lock-state document.");
  }
  if (result.passcodeRequired || !result.unlockedSinceBoot) {
    throw new IOSDeviceLockedError();
  }
  return result.deviceIdentifier;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitForIOSDeviceReady(
  device,
  {
    timeoutMilliseconds,
    pollMilliseconds = defaultUnlockPollMilliseconds,
    attempt = assertIOSDeviceReady,
    sleep = delay,
    now = Date.now,
    onWaiting = () => undefined,
  } = {},
) {
  if (
    !Number.isSafeInteger(timeoutMilliseconds) ||
    timeoutMilliseconds <= 0 ||
    timeoutMilliseconds > 600_000
  ) {
    throw new RangeError(
      "The iOS unlock wait must be from 1 through 600000 milliseconds.",
    );
  }
  if (
    !Number.isSafeInteger(pollMilliseconds) ||
    pollMilliseconds <= 0 ||
    pollMilliseconds > timeoutMilliseconds
  ) {
    throw new RangeError(
      "The iOS unlock poll interval must be positive and within the wait bound.",
    );
  }
  if (
    typeof attempt !== "function" ||
    typeof sleep !== "function" ||
    typeof now !== "function" ||
    typeof onWaiting !== "function"
  ) {
    throw new TypeError("The iOS unlock wait dependencies are invalid.");
  }

  const startedAt = now();
  const deadline = startedAt + timeoutMilliseconds;
  let announced = false;
  let lastError;
  while (true) {
    try {
      return await attempt(device);
    } catch (error) {
      if (
        !(error instanceof IOSDeviceLockedError) &&
        !(error instanceof IOSTransientLockStateError)
      ) {
        throw error;
      }
      lastError = error;
      const currentTime = now();
      if (!Number.isFinite(currentTime) || currentTime >= deadline) {
        throw new Error(
          `The iOS device did not become authoritatively unlocked within ${String(Math.ceil(timeoutMilliseconds / 1_000))} seconds.`,
          { cause: lastError },
        );
      }
      if (!announced) {
        announced = true;
        onWaiting(
          `Waiting up to ${String(Math.ceil(timeoutMilliseconds / 1_000))} seconds for the iOS device to become authoritatively unlocked before device installation.`,
        );
      }
      await sleep(Math.min(pollMilliseconds, deadline - currentTime));
    }
  }
}

function parseCliArguments(arguments_) {
  if (arguments_.length === 1) {
    return { device: arguments_[0], waitMilliseconds: undefined };
  }
  if (
    arguments_.length === 3 &&
    arguments_[1] === "--wait-seconds" &&
    /^\d+$/u.test(arguments_[2] ?? "")
  ) {
    const seconds = Number(arguments_[2]);
    if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 600) {
      throw new RangeError(
        "The iOS unlock wait must be from 1 through 600 seconds.",
      );
    }
    return { device: arguments_[0], waitMilliseconds: seconds * 1_000 };
  }
  throw new Error(
    "Usage: node ios-device-preflight.mjs DEVICE [--wait-seconds SECONDS]",
  );
}

export async function assertIOSDeviceReady(
  device,
  { run = execFileAsync } = {},
) {
  if (typeof device !== "string" || device.trim() === "") {
    throw new TypeError("The iOS device preflight requires an identifier.");
  }
  if (typeof run !== "function") {
    throw new TypeError("The iOS device preflight runner is invalid.");
  }

  const directory = await mkdtemp(
    path.join(tmpdir(), "solid-native-ios-device-preflight-"),
  );
  const outputPath = path.join(directory, "lock-state.json");
  try {
    try {
      await run("xcrun", [
        "devicectl",
        "device",
        "info",
        "lockState",
        "--device",
        device,
        "--timeout",
        "10",
        "--json-output",
        outputPath,
        "--quiet",
      ]);
    } catch (error) {
      if (isTransientLockStateFailure(error)) {
        throw new IOSTransientLockStateError(error);
      }
      throw new Error(describeCoreDeviceFailure(error), { cause: error });
    }
    return assertUnlockedIOSDevice(
      JSON.parse(await readFile(outputPath, "utf8")),
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  path.resolve(invokedPath) === fileURLToPath(import.meta.url)
) {
  try {
    const options = parseCliArguments(process.argv.slice(2));
    const identifier =
      options.waitMilliseconds === undefined
        ? await assertIOSDeviceReady(options.device)
        : await waitForIOSDeviceReady(options.device, {
            timeoutMilliseconds: options.waitMilliseconds,
            onWaiting: (message) => console.error(message),
          });
    console.log(`Verified that iOS device ${identifier} is unlocked.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
