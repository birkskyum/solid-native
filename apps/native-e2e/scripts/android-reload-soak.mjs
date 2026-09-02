import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { parseMemory, parseProcessStat } from "./android-memory-sample.mjs";
import { readNativeCompatibilityIdentity } from "./native-benchmark-environment.mjs";
import { stopAndroidProcesses } from "./android-process-cleanup.mjs";

const APP_ID = "dev.solidnative.e2e";
const ACTIVITY = `${APP_ID}/dev.solidnative.e2e.MainActivity`;
const DEVICE_METRO_PORT = 8081;
const DEFAULT_HOST_METRO_PORT = 8091;
const DEFAULT_RELOAD_CYCLES = 20;
const DEFAULT_WARMUP_CYCLES = 3;
const DEFAULT_RELOAD_TIMEOUT_MS = 30_000;
const MAX_RELOAD_CYCLES = 100;
const MAX_RELOAD_TIMEOUT_MS = 120_000;
const SIGNALS = ["SIGHUP", "SIGINT", "SIGTERM"];
const MARKER = "SOLID_NATIVE_RELOAD_MOUNTED";
const FAILURE_MARKER = "SOLID_NATIVE_RELOAD_FAILED";

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function readBoundedInteger(name, fallback, minimum, maximum) {
  const source = process.env[name];
  if (source === undefined || source === "") return fallback;
  const value = Number(source);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(
      `${name} must be a safe integer from ${String(minimum)} through ${String(maximum)}.`,
    );
  }
  return value;
}

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(
      `${command} ${arguments_.join(" ")} failed${detail ? `: ${detail}` : "."}`,
    );
  }
  return result.stdout.trim();
}

function runStreaming(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: options.cwd,
    env: options.env,
    stdio: "inherit",
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${arguments_.join(" ")} exited with status ${String(result.status)}.`,
    );
  }
}

function tryRun(command, arguments_, options = {}) {
  try {
    return run(command, arguments_, options);
  } catch {
    return undefined;
  }
}

function resolveSerial() {
  const configured = process.env.SOLID_NATIVE_ANDROID_SERIAL;
  if (configured !== undefined && configured !== "") return configured;
  const devices = run("adb", ["devices"])
    .split(/\r?\n/u)
    .slice(1)
    .map((line) => line.trim().split(/\s+/u))
    .filter(([, state]) => state === "device")
    .map(([serial]) => serial)
    .filter((serial) => serial !== undefined);
  if (devices.length !== 1) {
    throw new Error(
      `Expected exactly one authorized Android device; found ${String(devices.length)}. ` +
        "Set SOLID_NATIVE_ANDROID_SERIAL when more than one device is attached.",
    );
  }
  const serial = devices[0];
  if (serial === undefined) throw new Error("The Android serial is missing.");
  return serial;
}

function positiveSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return value;
}

function nonNegativeSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer.`);
  }
  return value;
}

export function parseReloadMarkers(source) {
  const markers = [];
  const pattern = new RegExp(
    `${MARKER}['\"]?\\s*,?\\s*['\"]?(\\{[^\\r\\n]*?\\})['\"]?`,
    "gu",
  );
  for (const match of source.matchAll(pattern)) {
    const payload = JSON.parse(match[1]);
    if (
      payload === null ||
      typeof payload !== "object" ||
      Array.isArray(payload)
    ) {
      throw new Error(
        "The development reload marker payload is not an object.",
      );
    }
    const keys = Object.keys(payload).sort();
    const expectedKeys = [
      "activeUIWorkletCount",
      "pendingUIWorkletFrameCount",
      "sequence",
      "surface",
      "workletSequence",
    ];
    if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
      throw new Error(
        "The development reload marker does not contain the complete known schema.",
      );
    }
    const marker = Object.freeze({
      surface: positiveSafeInteger(payload.surface, "Reload surface"),
      sequence: positiveSafeInteger(payload.sequence, "Reload commit sequence"),
      workletSequence: positiveSafeInteger(
        payload.workletSequence,
        "Reload worklet sequence",
      ),
      activeUIWorkletCount: nonNegativeSafeInteger(
        payload.activeUIWorkletCount,
        "Reload active worklet count",
      ),
      pendingUIWorkletFrameCount: nonNegativeSafeInteger(
        payload.pendingUIWorkletFrameCount,
        "Reload pending frame count",
      ),
    });
    if (
      marker.sequence !== 1 ||
      marker.workletSequence !== 1 ||
      marker.activeUIWorkletCount !== 1 ||
      marker.pendingUIWorkletFrameCount !== 0
    ) {
      throw new Error(
        `The replacement runtime did not publish one settled worklet: ${JSON.stringify(marker)}.`,
      );
    }
    markers.push(marker);
  }
  return Object.freeze(markers);
}

export function summarizeReloadResources(samples) {
  if (!Array.isArray(samples) || samples.length < 2) {
    throw new Error("The reload soak requires at least two resource samples.");
  }
  const first = samples[0];
  const last = samples.at(-1);
  if (first === undefined || last === undefined) {
    throw new Error("The reload resource samples are incomplete.");
  }
  const threadCounts = samples.map((sample) =>
    positiveSafeInteger(sample.threadCount, "Reload thread count"),
  );
  const pssValues = samples.map((sample) =>
    nonNegativeSafeInteger(sample.totalPssKiB, "Reload PSS"),
  );
  const rssValues = samples.map((sample) =>
    nonNegativeSafeInteger(sample.totalRssKiB, "Reload RSS"),
  );
  return Object.freeze({
    firstThreadCount: threadCounts[0],
    lastThreadCount: threadCounts.at(-1),
    minimumThreadCount: Math.min(...threadCounts),
    maximumThreadCount: Math.max(...threadCounts),
    threadCountDelta: threadCounts.at(-1) - threadCounts[0],
    firstTotalPssKiB: pssValues[0],
    lastTotalPssKiB: pssValues.at(-1),
    maximumTotalPssKiB: Math.max(...pssValues),
    totalPssDeltaKiB: pssValues.at(-1) - pssValues[0],
    firstTotalRssKiB: rssValues[0],
    lastTotalRssKiB: rssValues.at(-1),
    maximumTotalRssKiB: Math.max(...rssValues),
    totalRssDeltaKiB: rssValues.at(-1) - rssValues[0],
  });
}

function readThermalStatus(adb) {
  const source = tryRun(
    "adb",
    adb.arguments(["shell", "dumpsys", "thermalservice"]),
  );
  const status = /^Thermal Status:\s+(\d+)$/mu.exec(source ?? "")?.[1];
  return status === undefined ? "unknown" : Number(status);
}

function readLogcat(adb) {
  return adb.run("logcat", "-d", "-v", "raw", "ReactNativeJS:V", "*:S");
}

async function waitForReloadMarker(adb, expectedCount, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (true) {
    const logcat = readLogcat(adb);
    if (logcat.includes(FAILURE_MARKER)) {
      throw new Error(
        `The replacement runtime emitted ${FAILURE_MARKER}:\n${logcat.slice(-8_192)}`,
      );
    }
    const markers = parseReloadMarkers(logcat);
    if (markers.length >= expectedCount) return markers;
    if (performance.now() >= deadline) {
      throw new Error(
        `Timed out waiting for development reload marker ${String(expectedCount)}; observed ${String(markers.length)}.`,
      );
    }
    await delay(100);
  }
}

async function waitForMetro(port, child, output) {
  const deadline = performance.now() + 30_000;
  while (true) {
    if (child.exitCode !== null) {
      throw new Error(
        `Metro exited before becoming ready with status ${String(child.exitCode)}:\n${output()}`,
      );
    }
    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/status`);
      if (
        response.ok &&
        (await response.text()).trim() === "packager-status:running"
      ) {
        return;
      }
    } catch {
      // Metro has not opened its listening socket yet.
    }
    if (performance.now() >= deadline) {
      throw new Error(`Metro did not become ready on port ${String(port)}.`);
    }
    await delay(100);
  }
}

function startMetro(projectRoot, repositoryRoot, port) {
  const executable = path.join(repositoryRoot, "packages/cli/dist/bin.js");
  const child = spawn(
    process.execPath,
    [executable, "start", "--cwd", projectRoot, "--", "--port", String(port)],
    {
      cwd: projectRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  const retain = (chunk, destination) => {
    const text = chunk.toString();
    output = `${output}${text}`.slice(-65_536);
    destination.write(text);
  };
  child.stdout?.on("data", (chunk) => retain(chunk, process.stdout));
  child.stderr?.on("data", (chunk) => retain(chunk, process.stderr));
  return { child, output: () => output };
}

async function stopMetro(child) {
  if (child === undefined || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  const graceful = await Promise.race([
    exited.then(() => true),
    delay(5_000).then(() => false),
  ]);
  if (graceful) return;
  child.kill("SIGKILL");
  await exited;
}

function sampleResources(adb, processIdentifier, cycle, startedAt) {
  const processStat = parseProcessStat(
    adb.run("shell", "cat", `/proc/${processIdentifier}/stat`),
  );
  const memory = parseMemory(
    adb.run("shell", "dumpsys", "meminfo", "--local", "-s", processIdentifier),
  );
  return Object.freeze({
    cycle,
    elapsedMilliseconds: Math.round(performance.now() - startedAt),
    ...processStat,
    ...memory,
  });
}

function installSignalCleanup(cleanup) {
  const handlers = new Map();
  for (const signal of SIGNALS) {
    const handler = () => {
      cleanup();
      for (const [registeredSignal, registeredHandler] of handlers) {
        process.removeListener(registeredSignal, registeredHandler);
      }
      process.kill(process.pid, signal);
    };
    handlers.set(signal, handler);
    process.once(signal, handler);
  }
  return () => {
    for (const [signal, handler] of handlers) {
      process.removeListener(signal, handler);
    }
  };
}

async function main() {
  if (process.argv.length > 2) {
    throw new Error("Usage: node android-reload-soak.mjs");
  }
  const cycles = readBoundedInteger(
    "SOLID_NATIVE_ANDROID_RELOAD_CYCLES",
    DEFAULT_RELOAD_CYCLES,
    1,
    MAX_RELOAD_CYCLES,
  );
  const reloadTimeoutMs = readBoundedInteger(
    "SOLID_NATIVE_ANDROID_RELOAD_TIMEOUT_MS",
    DEFAULT_RELOAD_TIMEOUT_MS,
    1_000,
    MAX_RELOAD_TIMEOUT_MS,
  );
  const hostMetroPort = readBoundedInteger(
    "SOLID_NATIVE_ANDROID_RELOAD_METRO_PORT",
    DEFAULT_HOST_METRO_PORT,
    1_024,
    65_535,
  );
  const warmupCycles = readBoundedInteger(
    "SOLID_NATIVE_ANDROID_RELOAD_WARMUP_CYCLES",
    Math.min(DEFAULT_WARMUP_CYCLES, cycles - 1),
    0,
    cycles - 1,
  );
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(scriptDirectory, "..");
  const repositoryRoot = path.resolve(projectRoot, "../..");
  const serial = resolveSerial();
  const adb = {
    arguments: (arguments_) => ["-s", serial, ...arguments_],
    run: (...arguments_) => run("adb", ["-s", serial, ...arguments_]),
  };
  if (adb.run("get-state") !== "device") {
    throw new Error(`Android device ${serial} is unavailable or unauthorized.`);
  }
  if (adb.run("shell", "getprop", "ro.kernel.qemu") === "1") {
    throw new Error(
      "The development reload soak requires a physical Android device.",
    );
  }
  const nativeCompatibility = readNativeCompatibilityIdentity(
    repositoryRoot,
    projectRoot,
    "android",
  );
  const deviceModel = adb.run("shell", "getprop", "ro.product.model");
  const osVersion = adb.run("shell", "getprop", "ro.build.version.release");
  const initialThermalStatus = readThermalStatus(adb);

  stopAndroidProcesses(serial, [APP_ID]);
  runStreaming("sh", ["scripts/android-gradle.sh", ":app:installSolidDebug"], {
    cwd: projectRoot,
  });
  stopAndroidProcesses(serial, [APP_ID]);

  let metro;
  let reverseInstalled = false;
  let cleaned = false;
  const cleanupSync = () => {
    if (cleaned) return;
    metro?.child.kill("SIGTERM");
    if (reverseInstalled) {
      tryRun(
        "adb",
        adb.arguments([
          "reverse",
          "--remove",
          `tcp:${String(DEVICE_METRO_PORT)}`,
        ]),
      );
      reverseInstalled = false;
    }
    try {
      stopAndroidProcesses(serial, [APP_ID]);
    } catch (error) {
      process.stderr.write(
        `Android reload cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  };
  const removeSignalCleanup = installSignalCleanup(cleanupSync);

  try {
    metro = startMetro(projectRoot, repositoryRoot, hostMetroPort);
    await waitForMetro(hostMetroPort, metro.child, metro.output);
    adb.run(
      "reverse",
      `tcp:${String(DEVICE_METRO_PORT)}`,
      `tcp:${String(hostMetroPort)}`,
    );
    reverseInstalled = true;
    adb.run("logcat", "-c");
    adb.run("shell", "am", "start", "-S", "-W", "-n", ACTIVITY);

    let markers = await waitForReloadMarker(adb, 1, reloadTimeoutMs);
    const processIdentifier = adb
      .run("shell", "pidof", APP_ID)
      .split(/\s+/u)[0];
    if (processIdentifier === undefined || !/^\d+$/u.test(processIdentifier)) {
      throw new Error(
        "The development application did not remain alive after launch.",
      );
    }
    const startedAt = performance.now();
    const samples = [sampleResources(adb, processIdentifier, 0, startedAt)];
    const startTimeTicks = samples[0].startTimeTicks;

    for (let cycle = 1; cycle <= cycles; cycle++) {
      const response = await fetch(
        `http://127.0.0.1:${String(hostMetroPort)}/reload`,
      );
      if (!response.ok || (await response.text()).trim() !== "OK") {
        throw new Error(`Metro rejected development reload ${String(cycle)}.`);
      }
      markers = await waitForReloadMarker(adb, cycle + 1, reloadTimeoutMs);
      const currentProcess = adb.run("shell", "pidof", APP_ID).split(/\s+/u)[0];
      if (currentProcess !== processIdentifier) {
        throw new Error(
          `Development reload ${String(cycle)} restarted the Android process.`,
        );
      }
      await delay(250);
      const sample = sampleResources(adb, processIdentifier, cycle, startedAt);
      if (sample.startTimeTicks !== startTimeTicks) {
        throw new Error(
          `Development reload ${String(cycle)} replaced the Android process lifetime.`,
        );
      }
      samples.push(sample);
      process.stdout.write(
        `Solid Native development reload ${String(cycle)}/${String(cycles)} settled with no pending native frame.\n`,
      );
    }

    const resources = Object.freeze({
      allCycles: summarizeReloadResources(samples),
      postWarmup: summarizeReloadResources(
        samples.filter((sample) => sample.cycle >= warmupCycles),
      ),
    });
    await stopMetro(metro.child);
    if (reverseInstalled) {
      adb.run("reverse", "--remove", `tcp:${String(DEVICE_METRO_PORT)}`);
      reverseInstalled = false;
    }
    stopAndroidProcesses(serial, [APP_ID]);
    cleaned = true;
    removeSignalCleanup();

    const result = Object.freeze({
      schemaVersion: 0,
      benchmark: "android-development-runtime-reload",
      interpretation: "diagnostic-only",
      measuredAt: new Date().toISOString(),
      configuration: {
        cycles,
        warmupCycles,
        reloadTimeoutMs,
        applicationId: APP_ID,
        deviceMetroPort: DEVICE_METRO_PORT,
        hostMetroPort,
      },
      environment: {
        serial,
        deviceModel,
        osVersion,
        initialThermalStatus,
        finalThermalStatus: readThermalStatus(adb),
        revision: run("git", ["-C", repositoryRoot, "rev-parse", "HEAD"]),
        dirty:
          run("git", ["-C", repositoryRoot, "status", "--porcelain"]) !== "",
        nativeCompatibilityFingerprint: nativeCompatibility.fingerprint,
        nativeCompatibilityInputCount: nativeCompatibility.inputCount,
      },
      processIdentifier,
      markerCount: markers.length,
      resources,
      samples,
    });
    const outputRoot = process.env.SOLID_NATIVE_ANDROID_RELOAD_OUTPUT_DIR;
    if (outputRoot !== undefined && outputRoot !== "") {
      const timestamp = new Date().toISOString().replaceAll(/[:.]/gu, "-");
      const outputDirectory = path.resolve(outputRoot, timestamp);
      await mkdir(outputDirectory, { recursive: true });
      await writeFile(
        path.join(outputDirectory, "reload-result.json"),
        `${JSON.stringify(result, undefined, 2)}\n`,
        "utf8",
      );
      console.log(`Retained Android reload evidence at ${outputDirectory}`);
    }
    console.log(
      `Verified ${String(cycles)} full Hermes runtime replacements in one Android process; ` +
        `post-warmup threads ${String(resources.postWarmup.firstThreadCount)} -> ` +
        `${String(resources.postWarmup.lastThreadCount)}, post-warmup PSS delta ` +
        `${String(resources.postWarmup.totalPssDeltaKiB)} KiB.`,
    );
    console.log(
      "Reload resource samples are diagnostic evidence, not a general memory-leak or energy verdict.",
    );
    console.log(`SOLID_NATIVE_ANDROID_RELOAD_RESULT ${JSON.stringify(result)}`);
  } finally {
    if (!cleaned) {
      removeSignalCleanup();
      cleanupSync();
      await stopMetro(metro?.child);
    }
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  path.resolve(invokedPath) === fileURLToPath(import.meta.url)
) {
  await main();
}
