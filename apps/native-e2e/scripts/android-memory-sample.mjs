import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { readNativeCompatibilityIdentity } from "./native-benchmark-environment.mjs";

const KIBIBYTES_PER_MEBIBYTE = 1024;
const SIGNALS = ["SIGHUP", "SIGINT", "SIGTERM"];
const VARIANTS = {
  solid: {
    bundleIdentifier: "dev.solidnative.memory",
    activity: "dev.solidnative.memory/dev.solidnative.e2e.MainActivity",
  },
  control: {
    bundleIdentifier: "dev.solidnative.memory.control",
    activity: "dev.solidnative.memory.control/dev.solidnative.e2e.MainActivity",
  },
};

function readNonNegativeInteger(name, fallback) {
  const source = process.env[name];
  if (source === undefined) return fallback;
  const value = Number(source);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer.`);
  }
  return value;
}

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, { encoding: "utf8" });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(
      `${command} ${arguments_.join(" ")} failed${detail ? `: ${detail}` : "."}`,
    );
  }
  return result.stdout.trim();
}

function tryRun(command, arguments_) {
  try {
    return run(command, arguments_);
  } catch {
    return "unknown";
  }
}

function readThermalStatus(serial) {
  const source = tryRun("adb", [
    "-s",
    serial,
    "shell",
    "dumpsys",
    "thermalservice",
  ]);
  const status = /^Thermal Status:\s+(\d+)$/m.exec(source)?.[1];
  return status === undefined ? "unknown" : Number(status);
}

function resolveSerial() {
  const configured = process.env.SOLID_NATIVE_ANDROID_SERIAL;
  if (configured !== undefined && configured !== "") return configured;
  const devices = run("adb", ["devices"])
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
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

export function parseMemory(source) {
  const totalPss = /TOTAL PSS:\s+([\d,]+)/.exec(source)?.[1];
  const totalRss = /TOTAL RSS:\s+([\d,]+)/.exec(source)?.[1];
  if (totalPss === undefined || totalRss === undefined) {
    throw new Error("dumpsys meminfo did not report TOTAL PSS and TOTAL RSS.");
  }
  const totalPssKiB = Number(totalPss.replaceAll(",", ""));
  const totalRssKiB = Number(totalRss.replaceAll(",", ""));
  if (
    !Number.isSafeInteger(totalPssKiB) ||
    totalPssKiB < 0 ||
    !Number.isSafeInteger(totalRssKiB) ||
    totalRssKiB < 0
  ) {
    throw new Error("dumpsys meminfo reported invalid memory totals.");
  }
  return {
    totalPssKiB,
    totalRssKiB,
  };
}

export function parseProcessStat(source) {
  const commandEnd = source.lastIndexOf(") ");
  if (commandEnd < 0) {
    throw new Error("/proc/<pid>/stat omitted the process command boundary.");
  }
  const fields = source
    .slice(commandEnd + 2)
    .trim()
    .split(/\s+/u);
  const userCpuTicks = Number(fields[11]);
  const systemCpuTicks = Number(fields[12]);
  const threadCount = Number(fields[17]);
  const startTimeTicks = Number(fields[19]);
  if (
    !Number.isSafeInteger(userCpuTicks) ||
    userCpuTicks < 0 ||
    !Number.isSafeInteger(systemCpuTicks) ||
    systemCpuTicks < 0 ||
    !Number.isSafeInteger(threadCount) ||
    threadCount <= 0 ||
    !Number.isSafeInteger(startTimeTicks) ||
    startTimeTicks <= 0
  ) {
    throw new Error("/proc/<pid>/stat contained invalid process counters.");
  }
  return {
    cpuTimeTicks: userCpuTicks + systemCpuTicks,
    threadCount,
    startTimeTicks,
  };
}

export function parseProcessStatus(source) {
  const voluntaryContextSwitches = /^voluntary_ctxt_switches:\s+(\d+)$/mu.exec(
    source,
  )?.[1];
  const involuntaryContextSwitches =
    /^nonvoluntary_ctxt_switches:\s+(\d+)$/mu.exec(source)?.[1];
  if (
    voluntaryContextSwitches === undefined ||
    involuntaryContextSwitches === undefined
  ) {
    throw new Error("/proc/<pid>/status omitted context-switch counters.");
  }
  const voluntary = Number(voluntaryContextSwitches);
  const involuntary = Number(involuntaryContextSwitches);
  if (
    !Number.isSafeInteger(voluntary) ||
    voluntary < 0 ||
    !Number.isSafeInteger(involuntary) ||
    involuntary < 0
  ) {
    throw new Error("/proc/<pid>/status contained invalid process counters.");
  }
  return {
    voluntaryMainThreadContextSwitches: voluntary,
    involuntaryMainThreadContextSwitches: involuntary,
  };
}

function round(value, places = 3) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function summarize(samples, field) {
  const values = samples.map((sample) => sample[field]);
  const meanTime =
    samples.reduce((total, sample) => total + sample.elapsedSeconds, 0) /
    samples.length;
  const meanValue =
    values.reduce((total, value) => total + value, 0) / values.length;
  let numerator = 0;
  let denominator = 0;
  for (const sample of samples) {
    const timeDelta = sample.elapsedSeconds - meanTime;
    numerator += timeDelta * (sample[field] - meanValue);
    denominator += timeDelta * timeDelta;
  }
  const kibPerSecond = denominator === 0 ? 0 : numerator / denominator;
  const first = values[0];
  const last = values.at(-1);
  if (first === undefined || last === undefined) {
    throw new Error("The sample set is incomplete.");
  }
  return {
    firstKiB: first,
    lastKiB: last,
    minimumKiB: Math.min(...values),
    maximumKiB: Math.max(...values),
    deltaKiB: last - first,
    leastSquaresKiBPerSecond: round(kibPerSecond),
    leastSquaresMiBPerMinute: round(
      (kibPerSecond * 60) / KIBIBYTES_PER_MEBIBYTE,
      6,
    ),
  };
}

function percentile(values, percentileValue) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1),
  );
  const value = sorted[index];
  if (value === undefined) throw new Error("The percentile set is empty.");
  return value;
}

function requireMonotonic(samples, field) {
  let previous;
  for (const sample of samples) {
    const value = sample[field];
    if (previous !== undefined && value < previous) {
      throw new Error(`Android's ${field} counter moved backwards.`);
    }
    previous = value;
  }
}

export function summarizeProcessor(
  samples,
  durationSeconds,
  clockTicksPerSecond,
) {
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    !Number.isSafeInteger(clockTicksPerSecond) ||
    clockTicksPerSecond <= 0
  ) {
    throw new Error("The Android processor sample duration is invalid.");
  }
  for (const field of [
    "cpuTimeTicks",
    "voluntaryMainThreadContextSwitches",
    "involuntaryMainThreadContextSwitches",
  ]) {
    requireMonotonic(samples, field);
  }
  const first = samples[0];
  const last = samples.at(-1);
  if (first === undefined || last === undefined) {
    throw new Error("The Android processor sample set is incomplete.");
  }
  const cpuPercentSamples = samples
    .map((sample) => sample.cpuPercent)
    .filter((value) => value !== null);
  if (cpuPercentSamples.length < 1) {
    throw new Error("Android produced no post-warmup CPU percentage samples.");
  }
  const cpuTimeSeconds =
    (last.cpuTimeTicks - first.cpuTimeTicks) / clockTicksPerSecond;
  const voluntaryMainThreadContextSwitches =
    last.voluntaryMainThreadContextSwitches -
    first.voluntaryMainThreadContextSwitches;
  const involuntaryMainThreadContextSwitches =
    last.involuntaryMainThreadContextSwitches -
    first.involuntaryMainThreadContextSwitches;
  const mainThreadContextSwitches =
    voluntaryMainThreadContextSwitches + involuntaryMainThreadContextSwitches;
  const threadCounts = samples.map((sample) => sample.threadCount);
  return {
    cpuPercentSampleCount: cpuPercentSamples.length,
    meanCpuPercent: round(
      cpuPercentSamples.reduce((total, value) => total + value, 0) /
        cpuPercentSamples.length,
      6,
    ),
    p95CpuPercent: round(percentile(cpuPercentSamples, 0.95), 6),
    maximumCpuPercent: round(Math.max(...cpuPercentSamples), 6),
    cpuTimeSeconds: round(cpuTimeSeconds, 6),
    cpuTimeEquivalentPercent: round(
      (cpuTimeSeconds / durationSeconds) * 100,
      6,
    ),
    mainThreadContextSwitches,
    mainThreadContextSwitchesPerSecond: round(
      mainThreadContextSwitches / durationSeconds,
      6,
    ),
    voluntaryMainThreadContextSwitches,
    involuntaryMainThreadContextSwitches,
    minimumThreadCount: Math.min(...threadCounts),
    maximumThreadCount: Math.max(...threadCounts),
  };
}

function formatMiB(kibibytes) {
  return `${(kibibytes / KIBIBYTES_PER_MEBIBYTE).toFixed(2)} MiB`;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function stopAndroidProcess(serial, bundleIdentifier) {
  run("adb", ["-s", serial, "shell", "am", "force-stop", bundleIdentifier]);
  const remaining = spawnSync(
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

function installProcessCleanup(serial, bundleIdentifier) {
  let active = true;
  const cleanup = (failClosed) => {
    if (!active) return;
    try {
      stopAndroidProcess(serial, bundleIdentifier);
      active = false;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (failClosed) throw error;
      process.stderr.write(`Android sampler cleanup failed: ${message}\n`);
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

async function main() {
  const [variant, ...unknownArguments] = process.argv.slice(2);
  if (
    variant === undefined ||
    !(variant in VARIANTS) ||
    unknownArguments.length > 0
  ) {
    throw new Error("Usage: node android-memory-sample.mjs solid|control");
  }
  const configuration = VARIANTS[variant];
  if (configuration === undefined) throw new Error("Unknown memory variant.");
  const durationSeconds = readNonNegativeInteger(
    "SOLID_NATIVE_ANDROID_MEMORY_DURATION",
    60,
  );
  const settleSeconds = readNonNegativeInteger(
    "SOLID_NATIVE_ANDROID_MEMORY_SETTLE",
    5,
  );
  const warmupSeconds = readNonNegativeInteger(
    "SOLID_NATIVE_ANDROID_MEMORY_WARMUP",
    5,
  );
  if (durationSeconds < 10) {
    throw new RangeError(
      "SOLID_NATIVE_ANDROID_MEMORY_DURATION must be at least 10 seconds.",
    );
  }
  if (warmupSeconds >= durationSeconds) {
    throw new RangeError(
      "SOLID_NATIVE_ANDROID_MEMORY_WARMUP must be shorter than the duration.",
    );
  }
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = path.resolve(scriptDirectory, "../../..");
  const projectRoot = path.resolve(scriptDirectory, "..");
  const nativeCompatibility = readNativeCompatibilityIdentity(
    repositoryRoot,
    projectRoot,
    "android",
  );

  run("adb", ["version"]);
  const serial = resolveSerial();
  const adb = (...arguments_) => run("adb", ["-s", serial, ...arguments_]);
  if (adb("get-state") !== "device") {
    throw new Error(`Android device ${serial} is unavailable or unauthorized.`);
  }

  stopAndroidProcess(serial, configuration.bundleIdentifier);
  adb("shell", "am", "start", "-S", "-W", "-n", configuration.activity);
  const finishProcessCleanup = installProcessCleanup(
    serial,
    configuration.bundleIdentifier,
  );
  const processIdentifier = adb(
    "shell",
    "pidof",
    configuration.bundleIdentifier,
  )
    .split(/\s+/)[0]
    ?.trim();
  if (processIdentifier === undefined || !/^\d+$/.test(processIdentifier)) {
    throw new Error(
      `The ${variant} process did not remain alive after cold launch.`,
    );
  }
  const clockTicksPerSecond = Number(adb("shell", "getconf", "CLK_TCK"));
  if (!Number.isSafeInteger(clockTicksPerSecond) || clockTicksPerSecond <= 0) {
    throw new Error("Android getconf returned an invalid CLK_TCK value.");
  }

  const deviceModel = adb("shell", "getprop", "ro.product.model");
  const osVersion = adb("shell", "getprop", "ro.build.version.release");
  const sdkLevel = adb("shell", "getprop", "ro.build.version.sdk");
  const initialThermalStatus = readThermalStatus(serial);
  const lowPowerMode = tryRun("adb", [
    "-s",
    serial,
    "shell",
    "settings",
    "get",
    "global",
    "low_power",
  ]);

  await delay(settleSeconds * 1_000);
  const samples = [];
  const startedAt = performance.now();
  while (true) {
    const sampledAt = performance.now();
    const elapsedSeconds = (sampledAt - startedAt) / 1_000;
    const memory = parseMemory(
      adb("shell", "dumpsys", "meminfo", "--local", "-s", processIdentifier),
    );
    const processStat = parseProcessStat(
      adb("shell", "cat", `/proc/${processIdentifier}/stat`),
    );
    const processStatus = parseProcessStatus(
      adb("shell", "cat", `/proc/${processIdentifier}/status`),
    );
    const previous = samples.at(-1);
    if (
      previous !== undefined &&
      previous.startTimeTicks !== processStat.startTimeTicks
    ) {
      throw new Error("The Android target process restarted during sampling.");
    }
    const elapsedDelta =
      previous === undefined ? 0 : elapsedSeconds - previous.elapsedSeconds;
    const cpuTickDelta =
      previous === undefined
        ? 0
        : processStat.cpuTimeTicks - previous.cpuTimeTicks;
    if (cpuTickDelta < 0) {
      throw new Error("Android's cpuTimeTicks counter moved backwards.");
    }
    const cpuPercent =
      previous === undefined || elapsedDelta <= 0
        ? null
        : (cpuTickDelta / clockTicksPerSecond / elapsedDelta) * 100;
    samples.push({
      elapsedSeconds: round(elapsedSeconds, 6),
      cpuPercent: cpuPercent === null ? null : round(cpuPercent, 6),
      ...processStat,
      ...processStatus,
      ...memory,
    });
    if (elapsedSeconds >= durationSeconds) break;
    const sampleDuration = performance.now() - sampledAt;
    await delay(Math.max(0, 1_000 - sampleDuration));
  }

  const measuredSamples = samples.filter(
    (sample) => sample.elapsedSeconds >= warmupSeconds,
  );
  if (measuredSamples.length < 2) {
    throw new Error("The sampler retained fewer than two post-warmup samples.");
  }
  finishProcessCleanup();
  const totalPss = summarize(measuredSamples, "totalPssKiB");
  const totalRss = summarize(measuredSamples, "totalRssKiB");
  const duration =
    (measuredSamples.at(-1)?.elapsedSeconds ?? 0) -
    (measuredSamples[0]?.elapsedSeconds ?? 0);
  const processor = summarizeProcessor(
    measuredSamples,
    duration,
    clockTicksPerSecond,
  );
  const revision = run("git", ["-C", repositoryRoot, "rev-parse", "HEAD"]);
  const dirty =
    run("git", ["-C", repositoryRoot, "status", "--porcelain"]) !== "";
  const finalThermalStatus = readThermalStatus(serial);
  const result = {
    schemaVersion: 1,
    benchmark: "android-idle-process-resources",
    measuredAt: new Date().toISOString(),
    interpretation: "diagnostic-only",
    configuration: {
      variant,
      bundleIdentifier: configuration.bundleIdentifier,
      settleSeconds,
      warmupSeconds,
      sampleCount: measuredSamples.length,
      clockTicksPerSecond,
      durationSeconds: round(duration, 6),
    },
    environment: {
      revision,
      dirty,
      nativeCompatibilityFingerprint: nativeCompatibility.fingerprint,
      nativeCompatibilityInputCount: nativeCompatibility.inputCount,
      deviceModel,
      osVersion,
      sdkLevel,
      initialThermalStatus,
      finalThermalStatus,
      lowPowerMode,
    },
    processor,
    totalPss,
    totalRss,
    samples: measuredSamples,
  };

  const outputRoot = process.env.SOLID_NATIVE_ANDROID_MEMORY_OUTPUT_DIR;
  if (outputRoot !== undefined && outputRoot !== "") {
    const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
    const outputDirectory = path.resolve(outputRoot, `${variant}-${timestamp}`);
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(
      path.join(outputDirectory, "resource-result.json"),
      `${JSON.stringify(result, undefined, 2)}\n`,
      "utf8",
    );
    console.log(`Retained Android resource samples at ${outputDirectory}`);
  }

  console.log(
    `Android idle memory (${variant}): ${String(measuredSamples.length)} ` +
      `samples across ${result.configuration.durationSeconds.toFixed(1)} s`,
  );
  console.log(
    `Total PSS: ${formatMiB(totalPss.firstKiB)} → ` +
      `${formatMiB(totalPss.lastKiB)}; ` +
      `slope ${totalPss.leastSquaresMiBPerMinute.toFixed(3)} MiB/min`,
  );
  console.log(
    `Total RSS: ${formatMiB(totalRss.firstKiB)} → ` +
      `${formatMiB(totalRss.lastKiB)}; ` +
      `slope ${totalRss.leastSquaresMiBPerMinute.toFixed(3)} MiB/min`,
  );
  console.log(
    `CPU: ${processor.meanCpuPercent.toFixed(3)}% mean, ` +
      `${processor.p95CpuPercent.toFixed(3)}% p95, ` +
      `${processor.mainThreadContextSwitchesPerSecond.toFixed(3)} ` +
      "main-thread context switches/s",
  );
  console.log(
    "Short idle CPU, context-switch, thermal, and memory samples are diagnostic evidence, not a general energy or leak verdict.",
  );
  console.log(`SOLID_NATIVE_ANDROID_MEMORY_RESULT ${JSON.stringify(result)}`);
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  path.resolve(invokedPath) === fileURLToPath(import.meta.url)
) {
  await main();
}
