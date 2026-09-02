import { spawnSync } from "node:child_process";

const SIGNALS = ["SIGHUP", "SIGINT", "SIGTERM"];

function runAdb(serial, arguments_, spawn) {
  const result = spawn("adb", ["-s", serial, ...arguments_], {
    encoding: "utf8",
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(
      `adb ${arguments_.join(" ")} failed${detail ? `: ${detail}` : "."}`,
    );
  }
  return result.stdout.trim();
}

function validateTargets(serial, bundleIdentifiers) {
  if (typeof serial !== "string" || serial === "") {
    throw new TypeError("Android cleanup requires a device serial.");
  }
  if (
    !Array.isArray(bundleIdentifiers) ||
    bundleIdentifiers.length === 0 ||
    bundleIdentifiers.some(
      (bundleIdentifier) =>
        typeof bundleIdentifier !== "string" || bundleIdentifier === "",
    )
  ) {
    throw new TypeError("Android cleanup requires application bundle IDs.");
  }
  return [...new Set(bundleIdentifiers)];
}

function stopAndroidProcess(serial, bundleIdentifier, spawn) {
  runAdb(serial, ["shell", "am", "force-stop", bundleIdentifier], spawn);
  const remaining = spawn(
    "adb",
    ["-s", serial, "shell", "pidof", bundleIdentifier],
    { encoding: "utf8" },
  );
  if (remaining.error !== undefined) throw remaining.error;
  if (remaining.status === 0 && remaining.stdout.trim() !== "") {
    throw new Error(
      `Android process ${bundleIdentifier} remained alive after force-stop.`,
    );
  }
  if (remaining.status !== 0 && remaining.status !== 1) {
    const detail = (remaining.stderr || remaining.stdout).trim();
    throw new Error(
      `Could not verify Android process cleanup${detail ? `: ${detail}` : "."}`,
    );
  }
}

export function stopAndroidProcesses(
  serial,
  bundleIdentifiers,
  spawn = spawnSync,
) {
  const targets = validateTargets(serial, bundleIdentifiers);
  const failures = [];
  for (const bundleIdentifier of targets) {
    try {
      stopAndroidProcess(serial, bundleIdentifier, spawn);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      "Multiple Android test processes could not be stopped.",
    );
  }
}

export function installAndroidProcessCleanup(
  serial,
  bundleIdentifiers,
  spawn = spawnSync,
) {
  const targets = validateTargets(serial, bundleIdentifiers);
  let active = true;
  const cleanup = (failClosed) => {
    if (!active) return;
    try {
      stopAndroidProcesses(serial, targets, spawn);
      active = false;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (failClosed) throw error;
      process.stderr.write(`Android runner cleanup failed: ${message}\n`);
    }
  };
  const onExit = () => cleanup(false);
  const signalHandlers = new Map();
  process.once("exit", onExit);
  for (const signal of SIGNALS) {
    const handler = () => {
      cleanup(false);
      process.removeListener("exit", onExit);
      for (const [registeredSignal, registeredHandler] of signalHandlers) {
        process.removeListener(registeredSignal, registeredHandler);
      }
      process.kill(process.pid, signal);
    };
    signalHandlers.set(signal, handler);
    process.once(signal, handler);
  }
  return () => {
    cleanup(true);
    process.removeListener("exit", onExit);
    for (const [signal, handler] of signalHandlers) {
      process.removeListener(signal, handler);
    }
  };
}
