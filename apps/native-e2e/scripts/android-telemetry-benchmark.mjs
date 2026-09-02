import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
  createBalancedPairOrders,
  readBenchmarkOrderSeed,
  summarizePairedMetric,
} from "./benchmark-statistics.mjs";
import { installAndroidProcessCleanup } from "./android-process-cleanup.mjs";
import { readNativeCompatibilityIdentity } from "./native-benchmark-environment.mjs";

export { summarizePairedMetric } from "./benchmark-statistics.mjs";

const RESULT_MARKER = "SOLID_NATIVE_TELEMETRY_BENCHMARK_RESULT ";
const EVENT_READY_MARKER = "SOLID_NATIVE_TELEMETRY_EVENT_BENCHMARK_READY ";
const EVENT_RESULT_MARKER = "SOLID_NATIVE_TELEMETRY_EVENT_BENCHMARK_RESULT ";
const FAILURE_MARKER = "SOLID_NATIVE_TELEMETRY_BENCHMARK_FAILED";
const EVENT_METRICS = [
  "handlerToCommitMilliseconds",
  "handlerToMountMilliseconds",
  "handlerToFrameMilliseconds",
  "commitToMountMilliseconds",
  "commitToFrameMilliseconds",
  "mountToFrameMilliseconds",
];
const VARIANTS = {
  baseline: {
    bundleIdentifier: "dev.solidnative.telemetry.baseline",
    activity:
      "dev.solidnative.telemetry.baseline/dev.solidnative.e2e.MainActivity",
  },
  observed: {
    bundleIdentifier: "dev.solidnative.telemetry.observed",
    activity:
      "dev.solidnative.telemetry.observed/dev.solidnative.e2e.MainActivity",
  },
};

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

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function readPositiveInteger(name, fallback, maximum) {
  const source = process.env[name];
  if (source === undefined) return fallback;
  const value = Number(source);
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new RangeError(
      `${name} must be a positive integer no greater than ${String(maximum)}.`,
    );
  }
  return value;
}

function readScenario() {
  const scenario =
    process.env.SOLID_NATIVE_ANDROID_TELEMETRY_SCENARIO ?? "shadow-commit";
  if (
    scenario !== "shadow-commit" &&
    scenario !== "event-path" &&
    scenario !== "sustained-event"
  ) {
    throw new RangeError(
      "SOLID_NATIVE_ANDROID_TELEMETRY_SCENARIO must be shadow-commit, event-path, or sustained-event.",
    );
  }
  return scenario;
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

function thermalStatus(serial) {
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

function displayDensity(serial) {
  const source = run("adb", ["-s", serial, "shell", "wm", "density"]);
  const density =
    /Override density:\s+(\d+)/.exec(source)?.[1] ??
    /Physical density:\s+(\d+)/.exec(source)?.[1];
  const value = Number(density);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Android did not report a valid display density.");
  }
  return value;
}

function finiteNumber(record, name) {
  const value = record[name];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Telemetry benchmark ${name} must be finite.`);
  }
  return value;
}

export function parseTelemetryBenchmarkLog(source, expectedVariant) {
  const markerIndex = source.lastIndexOf(RESULT_MARKER);
  if (markerIndex === -1) return undefined;
  const line = source
    .slice(markerIndex + RESULT_MARKER.length)
    .split(/\r?\n/)[0];
  if (line === undefined || line.trim() === "") {
    throw new Error("The telemetry benchmark result marker has no payload.");
  }
  const result = JSON.parse(line);
  if (
    result === null ||
    typeof result !== "object" ||
    result.schemaVersion !== 0 ||
    result.benchmark !== "causal-telemetry-shadow-commit" ||
    result.interpretation !== "diagnostic-only" ||
    result.variant !== expectedVariant ||
    result.finalRevisionMounted !== true ||
    result.runtime?.platform !== "android"
  ) {
    throw new Error("The telemetry benchmark emitted an incompatible result.");
  }
  const warmupIterations = finiteNumber(result, "warmupIterations");
  const measuredIterations = finiteNumber(result, "measuredIterations");
  const durationMilliseconds = finiteNumber(result, "durationMilliseconds");
  const microsecondsPerCommit = finiteNumber(result, "microsecondsPerCommit");
  const telemetryRecordCount = finiteNumber(result, "telemetryRecordCount");
  const finalSequence = finiteNumber(result, "finalSequence");
  const finalHostRevision = finiteNumber(result, "finalHostRevision");
  const hostContractVersion = finiteNumber(
    result.runtime,
    "hostContractVersion",
  );
  const expectedMicrosecondsPerCommit =
    (durationMilliseconds * 1_000) / measuredIterations;
  if (
    !Number.isSafeInteger(warmupIterations) ||
    warmupIterations < 0 ||
    !Number.isSafeInteger(measuredIterations) ||
    measuredIterations <= 0 ||
    durationMilliseconds <= 0 ||
    microsecondsPerCommit <= 0 ||
    Math.abs(microsecondsPerCommit - expectedMicrosecondsPerCommit) > 1e-6 ||
    !Number.isSafeInteger(telemetryRecordCount) ||
    telemetryRecordCount < 0 ||
    !Number.isSafeInteger(finalSequence) ||
    finalSequence !== warmupIterations + measuredIterations + 2 ||
    !Number.isSafeInteger(finalHostRevision) ||
    finalHostRevision <= 0 ||
    !Number.isSafeInteger(hostContractVersion) ||
    hostContractVersion <= 0 ||
    typeof result.runtime.name !== "string" ||
    result.runtime.name === "" ||
    typeof result.runtime.version !== "string" ||
    result.runtime.version === "" ||
    (expectedVariant === "baseline" && telemetryRecordCount !== 0) ||
    (expectedVariant === "observed" &&
      telemetryRecordCount < measuredIterations * 4)
  ) {
    throw new Error("The telemetry benchmark emitted invalid measurements.");
  }
  return result;
}

function parseMarkedJson(source, marker) {
  const markerIndex = source.lastIndexOf(marker);
  if (markerIndex === -1) return undefined;
  const line = source.slice(markerIndex + marker.length).split(/\r?\n/)[0];
  if (line === undefined || line.trim() === "") {
    throw new Error("The telemetry benchmark marker has no payload.");
  }
  return JSON.parse(line);
}

export function parseTelemetryEventReadyLog(source, expectedVariant) {
  const result = parseMarkedJson(source, EVENT_READY_MARKER);
  if (
    result === undefined ||
    result === null ||
    typeof result !== "object" ||
    result.schemaVersion !== 0 ||
    result.variant !== expectedVariant ||
    !Number.isSafeInteger(result.observedSequence) ||
    result.observedSequence <= 0 ||
    result.bounds === null ||
    typeof result.bounds !== "object"
  ) {
    if (result === undefined) return undefined;
    throw new Error(
      "The telemetry event target emitted an incompatible result.",
    );
  }
  const pageX = finiteNumber(result.bounds, "pageX");
  const pageY = finiteNumber(result.bounds, "pageY");
  const width = finiteNumber(result.bounds, "width");
  const height = finiteNumber(result.bounds, "height");
  if (pageX < 0 || pageY < 0 || width <= 0 || height <= 0) {
    throw new Error("The telemetry event target emitted invalid bounds.");
  }
  return result;
}

function validateTelemetryEventResult(result, expectedVariant) {
  if (
    result === null ||
    typeof result !== "object" ||
    result.schemaVersion !== 0 ||
    result.benchmark !== "causal-telemetry-event-path" ||
    result.interpretation !== "diagnostic-only" ||
    result.variant !== expectedVariant ||
    result.eventName !== "press" ||
    result.eventPriority !== "discrete" ||
    result.finalRevisionMounted !== true ||
    result.runtime?.platform !== "android"
  ) {
    throw new Error(
      "The telemetry event benchmark emitted an incompatible result.",
    );
  }
  const warmupIterations = finiteNumber(result, "warmupIterations");
  const measuredIterations = finiteNumber(result, "measuredIterations");
  const eventIndex = finiteNumber(result, "eventIndex");
  const nativeEventTimestamp = finiteNumber(result, "nativeEventTimestamp");
  const observedSequence = finiteNumber(result, "observedSequence");
  const commitSequence = finiteNumber(result, "commitSequence");
  const hostRevision = finiteNumber(result, "hostRevision");
  const telemetryRecordCount = finiteNumber(result, "telemetryRecordCount");
  const metricValues = Object.fromEntries(
    EVENT_METRICS.map((metric) => [metric, finiteNumber(result, metric)]),
  );
  const hostContractVersion = finiteNumber(
    result.runtime,
    "hostContractVersion",
  );
  if (
    !Number.isSafeInteger(warmupIterations) ||
    warmupIterations < 0 ||
    !Number.isSafeInteger(measuredIterations) ||
    measuredIterations <= 0 ||
    !Number.isSafeInteger(eventIndex) ||
    eventIndex <= 0 ||
    nativeEventTimestamp < 0 ||
    !Number.isSafeInteger(observedSequence) ||
    observedSequence <= 0 ||
    !Number.isSafeInteger(commitSequence) ||
    commitSequence !== observedSequence + 1 ||
    !Number.isSafeInteger(hostRevision) ||
    hostRevision <= 0 ||
    !Number.isSafeInteger(telemetryRecordCount) ||
    telemetryRecordCount < 0 ||
    metricValues.handlerToCommitMilliseconds < 0 ||
    metricValues.handlerToMountMilliseconds <
      metricValues.handlerToCommitMilliseconds ||
    metricValues.handlerToFrameMilliseconds <
      metricValues.handlerToMountMilliseconds ||
    metricValues.commitToMountMilliseconds < 0 ||
    metricValues.commitToFrameMilliseconds <
      metricValues.commitToMountMilliseconds ||
    metricValues.mountToFrameMilliseconds < 0 ||
    Math.abs(
      metricValues.commitToMountMilliseconds +
        metricValues.mountToFrameMilliseconds -
        metricValues.commitToFrameMilliseconds,
    ) > 1e-6 ||
    Math.abs(
      metricValues.handlerToCommitMilliseconds +
        metricValues.commitToMountMilliseconds -
        metricValues.handlerToMountMilliseconds,
    ) > 0.25 ||
    Math.abs(
      metricValues.handlerToCommitMilliseconds +
        metricValues.commitToFrameMilliseconds -
        metricValues.handlerToFrameMilliseconds,
    ) > 0.25 ||
    !Number.isSafeInteger(hostContractVersion) ||
    hostContractVersion <= 0 ||
    typeof result.runtime.name !== "string" ||
    result.runtime.name === "" ||
    typeof result.runtime.version !== "string" ||
    result.runtime.version === "" ||
    (expectedVariant === "baseline" && telemetryRecordCount !== 0) ||
    (expectedVariant === "observed" && telemetryRecordCount === 0)
  ) {
    throw new Error(
      "The telemetry event benchmark emitted invalid measurements.",
    );
  }
  return result;
}

export function parseTelemetryEventLogs(source, expectedVariant) {
  const results = [];
  for (const line of source.split(/\r?\n/u)) {
    const markerIndex = line.indexOf(EVENT_RESULT_MARKER);
    if (markerIndex === -1) continue;
    const payload = line.slice(markerIndex + EVENT_RESULT_MARKER.length).trim();
    if (payload === "") {
      throw new Error("The telemetry event benchmark emitted an empty result.");
    }
    results.push(
      validateTelemetryEventResult(JSON.parse(payload), expectedVariant),
    );
  }
  return results;
}

export function parseTelemetryEventLog(source, expectedVariant) {
  return parseTelemetryEventLogs(source, expectedVariant).at(-1);
}

async function runVariant(serial, variant, timeoutSeconds) {
  const configuration = VARIANTS[variant];
  if (configuration === undefined)
    throw new Error("Unknown benchmark variant.");
  const adb = (...arguments_) => run("adb", ["-s", serial, ...arguments_]);
  for (const candidate of Object.values(VARIANTS)) {
    adb("shell", "am", "force-stop", candidate.bundleIdentifier);
  }
  adb("logcat", "-c");
  const initialThermalStatus = thermalStatus(serial);
  adb("shell", "am", "start", "-S", "-W", "-n", configuration.activity);
  const deadline = performance.now() + timeoutSeconds * 1_000;
  let logs = "";
  while (performance.now() < deadline) {
    logs = adb("logcat", "-d", "-v", "brief", "ReactNativeJS:I", "*:S");
    if (logs.includes(FAILURE_MARKER)) {
      throw new Error(`The ${variant} telemetry benchmark failed:\n${logs}`);
    }
    const result = parseTelemetryBenchmarkLog(logs, variant);
    if (result !== undefined) {
      return {
        ...result,
        initialThermalStatus,
        finalThermalStatus: thermalStatus(serial),
      };
    }
    await delay(100);
  }
  throw new Error(
    `The ${variant} telemetry benchmark timed out after ${String(timeoutSeconds)} seconds.\n${logs}`,
  );
}

async function runEventVariant(
  serial,
  variant,
  timeoutSeconds,
  eventIterations,
) {
  const configuration = VARIANTS[variant];
  if (configuration === undefined)
    throw new Error("Unknown benchmark variant.");
  const adb = (...arguments_) => run("adb", ["-s", serial, ...arguments_]);
  for (const candidate of Object.values(VARIANTS)) {
    adb("shell", "am", "force-stop", candidate.bundleIdentifier);
  }
  adb("logcat", "-c");
  const initialThermalStatus = thermalStatus(serial);
  adb("shell", "am", "start", "-S", "-W", "-n", configuration.activity);
  const readyDeadline = performance.now() + timeoutSeconds * 1_000;
  let logs = "";
  let ready;
  while (performance.now() < readyDeadline) {
    logs = adb("logcat", "-d", "-v", "brief", "ReactNativeJS:I", "*:S");
    if (logs.includes(FAILURE_MARKER)) {
      throw new Error(`The ${variant} telemetry benchmark failed:\n${logs}`);
    }
    ready = parseTelemetryEventReadyLog(logs, variant);
    if (ready !== undefined) break;
    await delay(100);
  }
  if (ready === undefined) {
    throw new Error(
      `The ${variant} telemetry event target timed out after ${String(timeoutSeconds)} seconds.\n${logs}`,
    );
  }

  const densityDpi = displayDensity(serial);
  const densityScale = densityDpi / 160;
  const tapX = Math.round(
    (ready.bounds.pageX + ready.bounds.width / 2) * densityScale,
  );
  const tapY = Math.round(
    (ready.bounds.pageY + ready.bounds.height / 2) * densityScale,
  );
  const events = [];
  for (let eventIndex = 1; eventIndex <= eventIterations; eventIndex++) {
    adb("shell", "input", "tap", String(tapX), String(tapY));
    const resultDeadline = performance.now() + timeoutSeconds * 1_000;
    let result;
    while (performance.now() < resultDeadline) {
      logs = adb("logcat", "-d", "-v", "brief", "ReactNativeJS:I", "*:S");
      if (logs.includes(FAILURE_MARKER)) {
        throw new Error(`The ${variant} telemetry benchmark failed:\n${logs}`);
      }
      const results = parseTelemetryEventLogs(logs, variant);
      if (
        results.some(
          (candidate, resultIndex) => candidate.eventIndex !== resultIndex + 1,
        )
      ) {
        throw new Error(
          "The telemetry event benchmark emitted duplicate or noncontiguous event indices.",
        );
      }
      result = results[eventIndex - 1];
      if (result !== undefined) break;
      await delay(25);
    }
    if (result === undefined) {
      throw new Error(
        `The ${variant} telemetry event benchmark timed out waiting for event ` +
          `${String(eventIndex)} of ${String(eventIterations)} after ` +
          `${String(timeoutSeconds)} seconds.\n${logs}`,
      );
    }
    const expectedObservedSequence = ready.observedSequence + eventIndex - 1;
    if (
      result.eventIndex !== eventIndex ||
      result.observedSequence !== expectedObservedSequence ||
      result.commitSequence !== expectedObservedSequence + 1
    ) {
      throw new Error(
        "The telemetry event benchmark did not measure the requested contiguous press.",
      );
    }
    events.push(result);
  }
  const finalThermalStatus = thermalStatus(serial);
  return events.map((result) => ({
    ...result,
    input: "adb-touchscreen-tap",
    densityDpi,
    initialThermalStatus,
    finalThermalStatus,
  }));
}

async function main() {
  const unknownArguments = process.argv.slice(2);
  if (unknownArguments.length > 0) {
    throw new Error("The Android telemetry benchmark accepts no arguments.");
  }
  run("adb", ["version"]);
  const serial = resolveSerial();
  const adb = (...arguments_) => run("adb", ["-s", serial, ...arguments_]);
  if (adb("get-state") !== "device") {
    throw new Error(`Android device ${serial} is unavailable or unauthorized.`);
  }
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = path.resolve(scriptDirectory, "../../..");
  const projectRoot = path.resolve(scriptDirectory, "..");
  const nativeCompatibility = readNativeCompatibilityIdentity(
    repositoryRoot,
    projectRoot,
    "android",
  );
  for (const [variant, configuration] of Object.entries(VARIANTS)) {
    const packagePath = adb(
      "shell",
      "pm",
      "path",
      configuration.bundleIdentifier,
    );
    if (!packagePath.startsWith("package:")) {
      throw new Error(
        `The ${variant} telemetry benchmark is not installed. Run ` +
          `pnpm --filter @solid-native/native-e2e android:telemetry:install:${variant}.`,
      );
    }
  }
  const finishProcessCleanup = installAndroidProcessCleanup(
    serial,
    Object.values(VARIANTS).map(
      (configuration) => configuration.bundleIdentifier,
    ),
  );
  const sampleCount = readPositiveInteger(
    "SOLID_NATIVE_ANDROID_TELEMETRY_SAMPLES",
    6,
    100,
  );
  const timeoutSeconds = readPositiveInteger(
    "SOLID_NATIVE_ANDROID_TELEMETRY_TIMEOUT",
    30,
    600,
  );
  const scenario = readScenario();
  const eventScenario =
    scenario === "event-path" || scenario === "sustained-event";
  const eventsPerProcess =
    scenario === "sustained-event"
      ? readPositiveInteger(
          "SOLID_NATIVE_ANDROID_TELEMETRY_EVENT_ITERATIONS",
          30,
          200,
        )
      : 1;
  const orderSeed = readBenchmarkOrderSeed(
    process.env.SOLID_NATIVE_ANDROID_TELEMETRY_ORDER_SEED,
    "SOLID_NATIVE_ANDROID_TELEMETRY_ORDER_SEED",
  );
  const variantOrders = createBalancedPairOrders(
    sampleCount,
    "baseline",
    "observed",
    orderSeed,
  );
  const samples = [];
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
    const order = variantOrders[sampleIndex];
    if (order === undefined) {
      throw new Error("The telemetry benchmark order is incomplete.");
    }
    for (const [orderIndex, variant] of order.entries()) {
      if (eventScenario) {
        const eventSamples = await runEventVariant(
          serial,
          variant,
          timeoutSeconds,
          eventsPerProcess,
        );
        for (const sample of eventSamples) {
          samples.push({
            sampleIndex: sampleIndex * eventsPerProcess + sample.eventIndex - 1,
            processPairIndex: sampleIndex,
            orderIndex,
            ...sample,
          });
        }
      } else {
        const sample = await runVariant(serial, variant, timeoutSeconds);
        samples.push({ sampleIndex, orderIndex, ...sample });
      }
    }
  }
  finishProcessCleanup();

  const reference = samples[0];
  if (
    reference === undefined ||
    samples.some(
      (sample) =>
        sample.warmupIterations !== reference.warmupIterations ||
        sample.measuredIterations !== reference.measuredIterations ||
        (scenario === "shadow-commit" &&
          sample.finalSequence !== reference.finalSequence) ||
        (eventScenario &&
          sample.observedSequence - sample.eventIndex !==
            reference.observedSequence - reference.eventIndex) ||
        sample.runtime.name !== reference.runtime.name ||
        sample.runtime.version !== reference.runtime.version ||
        sample.runtime.hostContractVersion !==
          reference.runtime.hostContractVersion,
    )
  ) {
    throw new Error("Telemetry benchmark samples used inconsistent runtimes.");
  }
  const summary = eventScenario
    ? Object.fromEntries(
        EVENT_METRICS.map((metric) => [
          metric,
          summarizePairedMetric(samples, metric),
        ]),
      )
    : {
        microsecondsPerCommit: summarizePairedMetric(
          samples,
          "microsecondsPerCommit",
        ),
      };
  const result = {
    schemaVersion: 0,
    benchmark: `android-causal-telemetry-${scenario}`,
    measuredAt: new Date().toISOString(),
    interpretation: "diagnostic-only",
    configuration: {
      sampleCount,
      order: "seeded-balanced",
      orderSeed,
      variantOrders,
      ...(eventScenario
        ? {
            input: "adb-touchscreen-tap",
            processPairCount: sampleCount,
            eventsPerProcess,
            eventPairCount: sampleCount * eventsPerProcess,
          }
        : {}),
      warmupIterations: reference.warmupIterations,
      measuredIterations: reference.measuredIterations,
    },
    environment: {
      revision: run("git", ["-C", repositoryRoot, "rev-parse", "HEAD"]),
      dirty: run("git", ["-C", repositoryRoot, "status", "--porcelain"]) !== "",
      nativeCompatibilityFingerprint: nativeCompatibility.fingerprint,
      nativeCompatibilityInputCount: nativeCompatibility.inputCount,
      deviceModel: adb("shell", "getprop", "ro.product.model"),
      osVersion: adb("shell", "getprop", "ro.build.version.release"),
      sdkLevel: adb("shell", "getprop", "ro.build.version.sdk"),
      densityDpi: displayDensity(serial),
      lowPowerMode: tryRun("adb", [
        "-s",
        serial,
        "shell",
        "settings",
        "get",
        "global",
        "low_power",
      ]),
    },
    summary,
    samples,
  };

  const outputRoot = process.env.SOLID_NATIVE_ANDROID_TELEMETRY_OUTPUT_DIR;
  if (outputRoot !== undefined && outputRoot !== "") {
    const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
    const outputDirectory = path.resolve(outputRoot, timestamp);
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(
      path.join(outputDirectory, `telemetry-${scenario}-result.json`),
      `${JSON.stringify(result, undefined, 2)}\n`,
      "utf8",
    );
    console.log(`Retained Android telemetry samples at ${outputDirectory}`);
  }
  console.log(
    eventScenario
      ? `Android causal telemetry ${scenario}: ${String(sampleCount)} seed-balanced ` +
          `process pairs, ${String(eventsPerProcess)} event pairs per process`
      : `Android causal telemetry ${scenario}: ${String(sampleCount)} seed-balanced samples per variant`,
  );
  if (eventScenario) {
    const handlerToFrame = summary.handlerToFrameMilliseconds;
    console.log(
      `Handler to next-vsync baseline ${handlerToFrame.baseline.median.toFixed(3)} ms; ` +
        `observed ${handlerToFrame.observed.median.toFixed(3)} ms; paired median delta ` +
        `${handlerToFrame.pairedDelta.median.toFixed(3)} ms`,
    );
    console.log(
      "This event-to-next-vsync measurement does not prove compositor presentation or product performance.",
    );
    console.log(
      `SOLID_NATIVE_ANDROID_TELEMETRY_EVENT_RESULT ${JSON.stringify(result)}`,
    );
  } else {
    const microsecondsPerCommit = summary.microsecondsPerCommit;
    console.log(
      `Baseline ${microsecondsPerCommit.baseline.median.toFixed(3)} µs/commit; observed ` +
        `${microsecondsPerCommit.observed.median.toFixed(3)} µs/commit; paired median delta ` +
        `${microsecondsPerCommit.pairedDelta.median.toFixed(3)} µs`,
    );
    console.log(
      "This shadow-commit measurement is diagnostic evidence, not a UI-frame or product performance claim.",
    );
    console.log(
      `SOLID_NATIVE_ANDROID_TELEMETRY_RESULT ${JSON.stringify(result)}`,
    );
  }
}

const scriptPath = fileURLToPath(import.meta.url);
if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === scriptPath
) {
  await main();
}
