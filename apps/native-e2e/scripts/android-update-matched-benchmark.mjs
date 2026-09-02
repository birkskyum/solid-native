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

const TEST_CLASS =
  "dev.solidnative.e2e.SolidNativePhysicalTest#testPhysicalRendererUpdate";
const EXPECTED_UPDATE_COUNT = 30;
const EXPECTED_MINIMUM_FRAMES = 25;
const STEADY_WORKLOAD = Object.freeze({
  id: "steady-properties",
  benchmark: "android-matched-steady-property-updates",
  description: "property updates",
  environmentPrefix: "SOLID_NATIVE_ANDROID_UPDATE",
  evidenceMarker: "SOLID_NATIVE_MATCHED_UPDATE_RESULT ",
  resultMarker: "SOLID_NATIVE_ANDROID_UPDATE_MATCHED_RESULT",
  resultFile: "matched-update-result.json",
  solidEntryFile: "memory.tsx",
  controlEntryFile: "memory-control.ts",
  solidFailureMarker: "SOLID_NATIVE_MEMORY_FAILED",
  configuration: Object.freeze({
    completionBoundary: "touch-down-to-accessibility-visible-count",
    frameCapture: "window-frame-metrics-across-all-property-updates",
  }),
});
const PRODUCT_WORKLOAD = Object.freeze({
  id: "mixed-product",
  benchmark: "android-matched-mixed-product-workload",
  description: "mixed product workload",
  environmentPrefix: "SOLID_NATIVE_ANDROID_WORKLOAD",
  evidenceMarker: "SOLID_NATIVE_MATCHED_PRODUCT_RESULT ",
  resultMarker: "SOLID_NATIVE_ANDROID_WORKLOAD_MATCHED_RESULT",
  resultFile: "matched-product-workload-result.json",
  solidEntryFile: "product-workload.tsx",
  controlEntryFile: "product-workload-control.ts",
  solidFailureMarker: "SOLID_NATIVE_PRODUCT_WORKLOAD_FAILED",
  configuration: Object.freeze({
    workload: "order-dashboard",
    rowCount: 12,
    completionBoundary:
      "touch-down-to-accessibility-visible-summary-row-and-structural-state",
    frameCapture: "window-frame-metrics-across-all-mixed-workload-updates",
  }),
});

export function readMatchedUpdateWorkload(source) {
  if (source === undefined || source === "" || source === STEADY_WORKLOAD.id) {
    return STEADY_WORKLOAD;
  }
  if (source === PRODUCT_WORKLOAD.id) return PRODUCT_WORKLOAD;
  throw new RangeError(
    "SOLID_NATIVE_ANDROID_UPDATE_WORKLOAD must be steady-properties or mixed-product.",
  );
}

const workload = readMatchedUpdateWorkload(
  process.env.SOLID_NATIVE_ANDROID_UPDATE_WORKLOAD,
);
const VARIANTS = {
  "react-native": {
    appId: "dev.solidnative.memory.control",
    testRunner:
      "dev.solidnative.memory.control.test/androidx.test.runner.AndroidJUnitRunner",
    entryFile: workload.controlEntryFile,
    environment: { SOLID_NATIVE_REACT_CONTROL: "1" },
    tasks: [
      ":app:assembleReactMemoryControlRelease",
      ":app:assembleReactMemoryControlReleaseAndroidTest",
    ],
    applicationApk:
      "android/app/build/outputs/apk/reactMemoryControl/release/app-reactMemoryControl-release.apk",
    testApk:
      "android/app/build/outputs/apk/androidTest/reactMemoryControl/release/app-reactMemoryControl-release-androidTest.apk",
    failureMarker: "ReactNativeJS: Error",
  },
  "solid-native": {
    appId: "dev.solidnative.memory",
    testRunner:
      "dev.solidnative.memory.test/androidx.test.runner.AndroidJUnitRunner",
    entryFile: workload.solidEntryFile,
    environment: {},
    tasks: [
      ":app:assembleSolidMemoryRelease",
      ":app:assembleSolidMemoryReleaseAndroidTest",
    ],
    applicationApk:
      "android/app/build/outputs/apk/solidMemory/release/app-solidMemory-release.apk",
    testApk:
      "android/app/build/outputs/apk/androidTest/solidMemory/release/app-solidMemory-release-androidTest.apk",
    failureMarker: workload.solidFailureMarker,
  },
};
const METRICS = [
  "completionP50Milliseconds",
  "completionP95Milliseconds",
  "completionMaxMilliseconds",
  "frames",
  "deadlineMisses",
  "frameP50Milliseconds",
  "frameP95Milliseconds",
  "frameMaxMilliseconds",
];

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...options,
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

function tryRun(command, arguments_) {
  try {
    return run(command, arguments_);
  } catch {
    return "unknown";
  }
}

function readInteger(name, fallback, { minimum, maximum }) {
  const source = process.env[name];
  if (source === undefined) return fallback;
  const value = Number(source);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(
      `${name} must be an integer from ${String(minimum)} through ${String(maximum)}.`,
    );
  }
  return value;
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

function thermalStatus(serial) {
  const source = tryRun("adb", [
    "-s",
    serial,
    "shell",
    "dumpsys",
    "thermalservice",
  ]);
  const status = /^Thermal Status:\s+(\d+)$/mu.exec(source)?.[1];
  return status === undefined ? "unknown" : Number(status);
}

function finiteNumber(record, name) {
  const value = record?.[name];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Android matched update ${name} must be finite.`);
  }
  return value;
}

function nonNegativeInteger(record, name) {
  const value = finiteNumber(record, name);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `Android matched update ${name} must be a non-negative integer.`,
    );
  }
  return value;
}

function nearestRank(values, percentile) {
  const index = Math.ceil(percentile * values.length) - 1;
  return values[index];
}

function parseMatchedUpdateEvidence(source, expectedVariant, marker) {
  const markerIndex = source.lastIndexOf(marker);
  if (markerIndex === -1) return undefined;
  const line = source.slice(markerIndex + marker.length).split(/\r?\n/u)[0];
  if (line === undefined || line.trim() === "") {
    throw new Error("The Android matched update marker has no payload.");
  }
  const result = JSON.parse(line);
  if (
    result === null ||
    typeof result !== "object" ||
    result.schemaVersion !== 0 ||
    result.variant !== expectedVariant ||
    result.input !== "androidx-touchscreen-injection" ||
    result.initialCount !== 1 ||
    result.updateCount !== EXPECTED_UPDATE_COUNT ||
    result.finalCount !== result.initialCount + result.updateCount ||
    !Array.isArray(result.completionMilliseconds) ||
    result.completionMilliseconds.length !== result.updateCount ||
    result.frameMetrics === null ||
    typeof result.frameMetrics !== "object" ||
    result.frameMetrics.schemaVersion !== 1
  ) {
    throw new Error("The Android matched update result is incompatible.");
  }

  const completionMilliseconds = result.completionMilliseconds.map(
    (value, index) => {
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        throw new Error(
          `Android matched update completion ${String(index)} must be positive and finite.`,
        );
      }
      return value;
    },
  );
  const completionP50Milliseconds = finiteNumber(
    result,
    "completionP50Milliseconds",
  );
  const completionP95Milliseconds = finiteNumber(
    result,
    "completionP95Milliseconds",
  );
  const completionMaxMilliseconds = finiteNumber(
    result,
    "completionMaxMilliseconds",
  );
  const frames = nonNegativeInteger(result.frameMetrics, "frames");
  const deadlineMisses = nonNegativeInteger(
    result.frameMetrics,
    "deadlineMisses",
  );
  const frozenFrames = nonNegativeInteger(result.frameMetrics, "frozenFrames");
  const droppedReports = nonNegativeInteger(
    result.frameMetrics,
    "droppedReports",
  );
  const frameP50Milliseconds = finiteNumber(
    result.frameMetrics,
    "p50Milliseconds",
  );
  const frameP95Milliseconds = finiteNumber(
    result.frameMetrics,
    "p95Milliseconds",
  );
  const frameMaxMilliseconds = finiteNumber(
    result.frameMetrics,
    "maxMilliseconds",
  );
  const orderedCompletion = [...completionMilliseconds].sort(
    (left, right) => left - right,
  );
  if (
    Math.abs(completionP50Milliseconds - nearestRank(orderedCompletion, 0.5)) >
      1e-6 ||
    Math.abs(completionP95Milliseconds - nearestRank(orderedCompletion, 0.95)) >
      1e-6 ||
    Math.abs(completionMaxMilliseconds - orderedCompletion.at(-1)) > 1e-6 ||
    completionP50Milliseconds <= 0 ||
    completionP95Milliseconds < completionP50Milliseconds ||
    completionMaxMilliseconds < completionP95Milliseconds ||
    frames < EXPECTED_MINIMUM_FRAMES ||
    deadlineMisses > frames ||
    frozenFrames !== 0 ||
    droppedReports !== 0 ||
    frameP50Milliseconds < 0 ||
    frameP95Milliseconds < frameP50Milliseconds ||
    frameMaxMilliseconds < frameP95Milliseconds ||
    typeof result.frameMetrics.manufacturer !== "string" ||
    result.frameMetrics.manufacturer === "" ||
    typeof result.frameMetrics.model !== "string" ||
    result.frameMetrics.model === "" ||
    !Number.isSafeInteger(result.frameMetrics.sdk) ||
    result.frameMetrics.sdk <= 0 ||
    typeof result.frameMetrics.osRelease !== "string" ||
    result.frameMetrics.osRelease === ""
  ) {
    throw new Error("The Android matched update result is internally invalid.");
  }
  return result;
}

export function parseMatchedUpdateLog(source, expectedVariant) {
  return parseMatchedUpdateEvidence(
    source,
    expectedVariant,
    STEADY_WORKLOAD.evidenceMarker,
  );
}

export function parseMatchedProductWorkloadLog(source, expectedVariant) {
  const result = parseMatchedUpdateEvidence(
    source,
    expectedVariant,
    PRODUCT_WORKLOAD.evidenceMarker,
  );
  if (result === undefined) return undefined;
  if (
    result.workload !== PRODUCT_WORKLOAD.configuration.workload ||
    result.rowCount !== PRODUCT_WORKLOAD.configuration.rowCount ||
    result.finalActiveOrder !== "ORD-1007" ||
    result.activeOrderAssertions !== EXPECTED_UPDATE_COUNT ||
    result.alertAppearances !== 6 ||
    result.alertDisposals !== 6
  ) {
    throw new Error(
      "The Android matched product workload result is incompatible.",
    );
  }
  return result;
}

function variantEntries() {
  return Object.entries(VARIANTS);
}

function buildAndInstall(appDirectory, serial) {
  for (const [variant, configuration] of variantEntries()) {
    run(
      "sh",
      ["scripts/android-gradle.sh", ...configuration.tasks, "--console=plain"],
      {
        cwd: appDirectory,
        env: {
          ...process.env,
          ENTRY_FILE: configuration.entryFile,
          ...configuration.environment,
        },
      },
    );
    run("adb", [
      "-s",
      serial,
      "install",
      "-r",
      path.join(appDirectory, configuration.applicationApk),
    ]);
    run("adb", [
      "-s",
      serial,
      "install",
      "-r",
      "-t",
      path.join(appDirectory, configuration.testApk),
    ]);
    const instrumentation = run("adb", [
      "-s",
      serial,
      "shell",
      "pm",
      "list",
      "instrumentation",
    ]);
    if (
      !instrumentation.includes(
        `instrumentation:${configuration.testRunner} (target=${configuration.appId})`,
      )
    ) {
      throw new Error(
        `Android did not register the ${variant} matched update runner.`,
      );
    }
  }
}

function runVariant(serial, variant, timeoutSeconds) {
  const configuration = VARIANTS[variant];
  if (configuration === undefined)
    throw new Error("Unknown matched update variant.");
  const adb = (...arguments_) => run("adb", ["-s", serial, ...arguments_]);
  for (const [, candidate] of variantEntries()) {
    adb("shell", "am", "force-stop", candidate.appId);
  }
  adb("shell", "input", "keyevent", "KEYCODE_WAKEUP");
  adb("shell", "wm", "dismiss-keyguard");
  adb("shell", "cmd", "statusbar", "collapse");
  adb("logcat", "-c");
  const initialThermalStatus = thermalStatus(serial);
  const startedAt = performance.now();
  const instrumentation = run(
    "adb",
    [
      "-s",
      serial,
      "shell",
      "am",
      "instrument",
      "-w",
      "-r",
      "-e",
      "class",
      TEST_CLASS,
      "-e",
      "solidNativeMatchedUpdateScenario",
      workload.id,
      configuration.testRunner,
    ],
    { timeout: timeoutSeconds * 1_000 },
  );
  const instrumentationDurationMilliseconds = performance.now() - startedAt;
  if (!/^OK \(1 test\)$/mu.test(instrumentation)) {
    throw new Error(
      `${variant} instrumentation did not report one passing test:\n${instrumentation}`,
    );
  }
  const logs = adb(
    "logcat",
    "-d",
    "-v",
    "brief",
    "SOLID_NATIVE:I",
    "ReactNativeJS:I",
    "*:S",
  );
  if (logs.includes(configuration.failureMarker)) {
    throw new Error(`${variant} reported a runtime failure:\n${logs}`);
  }
  const evidence =
    workload.id === PRODUCT_WORKLOAD.id
      ? parseMatchedProductWorkloadLog(logs, variant)
      : parseMatchedUpdateLog(logs, variant);
  if (evidence === undefined) {
    throw new Error(`${variant} emitted no matched update evidence.`);
  }
  return {
    variant,
    pairVariant: variant === "react-native" ? "baseline" : "observed",
    instrumentationDurationMilliseconds,
    initialThermalStatus,
    finalThermalStatus: thermalStatus(serial),
    completionP50Milliseconds: evidence.completionP50Milliseconds,
    completionP95Milliseconds: evidence.completionP95Milliseconds,
    completionMaxMilliseconds: evidence.completionMaxMilliseconds,
    frames: evidence.frameMetrics.frames,
    deadlineMisses: evidence.frameMetrics.deadlineMisses,
    frameP50Milliseconds: evidence.frameMetrics.p50Milliseconds,
    frameP95Milliseconds: evidence.frameMetrics.p95Milliseconds,
    frameMaxMilliseconds: evidence.frameMetrics.maxMilliseconds,
    evidence,
  };
}

export function summarizeMatchedUpdateSamples(samples) {
  if (samples.length === 0) {
    throw new Error("The matched Android update benchmark has no samples.");
  }
  return Object.fromEntries(
    METRICS.map((metric) => {
      const paired = summarizePairedMetric(
        samples.map((sample) => ({
          sampleIndex: sample.sampleIndex,
          variant: sample.pairVariant,
          [metric]: sample[metric],
        })),
        metric,
      );
      return [
        metric,
        {
          reactNative: paired.baseline,
          solidNative: paired.observed,
          pairedDeltaSolidMinusReact: paired.pairedDelta,
          differenceOfMediansSolidMinusReact: paired.differenceOfMedians,
          relativeDifferenceOfMediansPercent:
            paired.relativeDifferenceOfMediansPercent,
        },
      ];
    }),
  );
}

async function main() {
  if (process.argv.length > 2) {
    throw new Error(
      "The matched Android update benchmark accepts no arguments; select its workload through the documented environment variable.",
    );
  }
  run("adb", ["version"]);
  const serial = resolveSerial();
  const adb = (...arguments_) => run("adb", ["-s", serial, ...arguments_]);
  if (adb("get-state") !== "device") {
    throw new Error(`Android device ${serial} is unavailable or unauthorized.`);
  }
  const sampleCount = readInteger(`${workload.environmentPrefix}_SAMPLES`, 6, {
    minimum: 1,
    maximum: 100,
  });
  const warmupPairCount = readInteger(
    `${workload.environmentPrefix}_WARMUP_PAIRS`,
    1,
    { minimum: 0, maximum: 20 },
  );
  const timeoutSeconds = readInteger(
    `${workload.environmentPrefix}_TIMEOUT`,
    90,
    { minimum: 1, maximum: 600 },
  );
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const appDirectory = path.resolve(scriptDirectory, "..");
  const repositoryRoot = path.resolve(appDirectory, "../..");
  const nativeCompatibility = readNativeCompatibilityIdentity(
    repositoryRoot,
    appDirectory,
    "android",
  );
  const finishProcessCleanup = installAndroidProcessCleanup(
    serial,
    variantEntries().map(([, configuration]) => configuration.appId),
  );
  const orderSeed = readBenchmarkOrderSeed(
    process.env[`${workload.environmentPrefix}_ORDER_SEED`],
    `${workload.environmentPrefix}_ORDER_SEED`,
  );
  const warmupVariantOrders =
    warmupPairCount === 0
      ? []
      : createBalancedPairOrders(
          warmupPairCount,
          "react-native",
          "solid-native",
          (orderSeed ^ 0x9e37_79b9) >>> 0,
        );
  const variantOrders = createBalancedPairOrders(
    sampleCount,
    "react-native",
    "solid-native",
    orderSeed,
  );
  buildAndInstall(appDirectory, serial);

  for (let warmupIndex = 0; warmupIndex < warmupPairCount; warmupIndex++) {
    const order = warmupVariantOrders[warmupIndex];
    if (order === undefined) {
      throw new Error("The matched update warmup order is incomplete.");
    }
    for (const variant of order) {
      const sample = runVariant(serial, variant, timeoutSeconds);
      console.log(
        `Matched ${workload.description} warmup ${String(warmupIndex + 1)}/${String(warmupPairCount)} ` +
          `${variant}: frame p95 ${sample.frameP95Milliseconds.toFixed(3)} ms`,
      );
    }
  }

  const samples = [];
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
    const order = variantOrders[sampleIndex];
    if (order === undefined) {
      throw new Error("The matched update benchmark order is incomplete.");
    }
    for (const [orderIndex, variant] of order.entries()) {
      const sample = runVariant(serial, variant, timeoutSeconds);
      samples.push({ sampleIndex, orderIndex, ...sample });
      console.log(
        `Matched ${workload.description} pair ${String(sampleIndex + 1)}/${String(sampleCount)} ${variant}: ` +
          `frame p95 ${sample.frameP95Milliseconds.toFixed(3)} ms, ` +
          `${String(sample.deadlineMisses)} deadline misses`,
      );
    }
  }
  finishProcessCleanup();

  const first = samples[0];
  if (
    first === undefined ||
    samples.some(
      (sample) =>
        sample.evidence.frameMetrics.manufacturer !==
          first.evidence.frameMetrics.manufacturer ||
        sample.evidence.frameMetrics.model !==
          first.evidence.frameMetrics.model ||
        sample.evidence.frameMetrics.sdk !== first.evidence.frameMetrics.sdk ||
        sample.evidence.frameMetrics.osRelease !==
          first.evidence.frameMetrics.osRelease,
    )
  ) {
    throw new Error(
      "Matched update samples used inconsistent physical devices.",
    );
  }

  const summary = summarizeMatchedUpdateSamples(samples);
  const result = {
    schemaVersion: 0,
    benchmark: workload.benchmark,
    measuredAt: new Date().toISOString(),
    interpretation: "diagnostic-only",
    configuration: {
      sampleCountPerVariant: sampleCount,
      warmupPairs: warmupPairCount,
      order: "seeded-balanced",
      orderSeed,
      warmupVariantOrders,
      variantOrders,
      baseline: "react-native",
      observed: "solid-native",
      input: "androidx-touchscreen-injection",
      updateCountPerProcess: EXPECTED_UPDATE_COUNT,
      ...workload.configuration,
    },
    environment: {
      revision: run("git", ["-C", repositoryRoot, "rev-parse", "HEAD"]),
      dirty: run("git", ["-C", repositoryRoot, "status", "--porcelain"]) !== "",
      nativeCompatibilityFingerprint: nativeCompatibility.fingerprint,
      nativeCompatibilityInputCount: nativeCompatibility.inputCount,
      manufacturer: first.evidence.frameMetrics.manufacturer,
      deviceModel: first.evidence.frameMetrics.model,
      osVersion: first.evidence.frameMetrics.osRelease,
      sdkLevel: first.evidence.frameMetrics.sdk,
      cpuAbi: adb("shell", "getprop", "ro.product.cpu.abi"),
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

  const outputRoot = process.env[`${workload.environmentPrefix}_OUTPUT_DIR`];
  if (outputRoot !== undefined && outputRoot !== "") {
    const timestamp = new Date().toISOString().replaceAll(/[:.]/gu, "-");
    const outputDirectory = path.resolve(outputRoot, timestamp);
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(
      path.join(outputDirectory, workload.resultFile),
      `${JSON.stringify(result, undefined, 2)}\n`,
      "utf8",
    );
    console.log(
      `Retained matched Android ${workload.description} samples at ${outputDirectory}`,
    );
  }
  const frameP95 = summary.frameP95Milliseconds;
  console.log(
    `Paired Android ${workload.description}: ${String(sampleCount)} seed-balanced pairs; ` +
      `React Native frame-p95 median ${frameP95.reactNative.median.toFixed(3)} ms, ` +
      `Solid Native ${frameP95.solidNative.median.toFixed(3)} ms, paired median delta ` +
      `${frameP95.pairedDeltaSolidMinusReact.median.toFixed(3)} ms`,
  );
  console.log(
    "Accessibility completion includes input injection and all configured state-observation overhead; Window frame duration is not compositor presentation.",
  );
  console.log(`${workload.resultMarker} ${JSON.stringify(result)}`);
}

const scriptPath = fileURLToPath(import.meta.url);
if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === scriptPath
) {
  await main();
}
