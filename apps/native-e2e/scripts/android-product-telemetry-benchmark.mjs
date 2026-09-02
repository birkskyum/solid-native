import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { installAndroidProcessCleanup } from "./android-process-cleanup.mjs";
import {
  createBalancedPairOrders,
  readBenchmarkOrderSeed,
  summarizePairedMetric,
} from "./benchmark-statistics.mjs";
import { readNativeCompatibilityIdentity } from "./native-benchmark-environment.mjs";
import { parseProductTelemetryVariantLog } from "./parse-product-telemetry-proof.mjs";

const TEST_CLASS =
  "dev.solidnative.e2e.SolidNativePhysicalTest#testPhysicalRendererUpdate";
const FAILURE_MARKER = "SOLID_NATIVE_PRODUCT_WORKLOAD_FAILED";
const PROOF_RESULT_MARKER = "SOLID_NATIVE_PRODUCT_TELEMETRY_RESULT";
const EXPECTED_UPDATE_COUNT = 30;
const EVENT_METRICS = [
  "handlerToCommitMilliseconds",
  "handlerToMountMilliseconds",
  "handlerToFrameMilliseconds",
  "commitToMountMilliseconds",
  "commitToFrameMilliseconds",
  "mountToFrameMilliseconds",
];
const PROCESS_METRICS = [
  "completionP50Milliseconds",
  "completionP95Milliseconds",
  "completionMaxMilliseconds",
  "frames",
  "deadlineMisses",
  "frameP50Milliseconds",
  "frameP95Milliseconds",
  "frameMaxMilliseconds",
];
const VARIANTS = Object.freeze({
  baseline: Object.freeze({
    appId: "dev.solidnative.telemetry.baseline",
    testRunner:
      "dev.solidnative.telemetry.baseline.test/androidx.test.runner.AndroidJUnitRunner",
    entryFile: "product-workload-baseline.ts",
    gradleVariant: "SolidTelemetryBaselineRelease",
    apkVariant: "solidTelemetryBaseline",
  }),
  observed: Object.freeze({
    appId: "dev.solidnative.telemetry.observed",
    testRunner:
      "dev.solidnative.telemetry.observed.test/androidx.test.runner.AndroidJUnitRunner",
    entryFile: "product-workload-observed.ts",
    gradleVariant: "SolidTelemetryObservedRelease",
    apkVariant: "solidTelemetryObserved",
  }),
});

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

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

function variantEntries() {
  return Object.entries(VARIANTS);
}

function apkPaths(appDirectory, configuration) {
  const base = path.join(appDirectory, "android/app/build/outputs/apk");
  return {
    application: path.join(
      base,
      configuration.apkVariant,
      "release",
      `app-${configuration.apkVariant}-release.apk`,
    ),
    test: path.join(
      base,
      "androidTest",
      configuration.apkVariant,
      "release",
      `app-${configuration.apkVariant}-release-androidTest.apk`,
    ),
    sourceMap: path.join(
      appDirectory,
      "android/app/build/generated/sourcemaps/react",
      `${configuration.apkVariant}Release`,
      "index.android.bundle.map",
    ),
  };
}

function buildAndInstall(appDirectory, serial) {
  for (const [variant, configuration] of variantEntries()) {
    run(
      "sh",
      [
        "scripts/android-gradle.sh",
        `:app:assemble${configuration.gradleVariant}`,
        `:app:assemble${configuration.gradleVariant}AndroidTest`,
        "--console=plain",
      ],
      {
        cwd: appDirectory,
        env: { ...process.env, ENTRY_FILE: configuration.entryFile },
      },
    );
    const apks = apkPaths(appDirectory, configuration);
    run(process.execPath, [
      path.join(appDirectory, "scripts/verify-solid-runtime-sourcemap.mjs"),
      apks.sourceMap,
    ]);
    run("adb", ["-s", serial, "install", "-r", apks.application]);
    run("adb", ["-s", serial, "install", "-r", "-t", apks.test]);
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
        `Android did not register the ${variant} product-telemetry runner.`,
      );
    }
  }
}

async function readSettledLogs(adb, variant, timeoutSeconds) {
  const deadline = performance.now() + timeoutSeconds * 1_000;
  let logs = "";
  while (performance.now() < deadline) {
    logs = adb(
      "logcat",
      "-d",
      "-v",
      "brief",
      "SOLID_NATIVE:I",
      "ReactNativeJS:I",
      "*:S",
    );
    if (logs.includes(FAILURE_MARKER)) {
      throw new Error(`${variant} reported a runtime failure:\n${logs}`);
    }
    if (logs.includes(PROOF_RESULT_MARKER)) return logs;
    await delay(100);
  }
  throw new Error(
    `${variant} did not settle its product telemetry proof within ${String(timeoutSeconds)} seconds.\n${logs}`,
  );
}

async function runVariant(serial, variant, timeoutSeconds) {
  const configuration = VARIANTS[variant];
  if (configuration === undefined) {
    throw new Error("Unknown product telemetry variant.");
  }
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
      configuration.testRunner,
    ],
    { timeout: timeoutSeconds * 1_000 },
  );
  const instrumentationDurationMilliseconds = performance.now() - startedAt;
  if (
    !/^OK \(1 test\)$/mu.test(instrumentation) ||
    !/^INSTRUMENTATION_CODE: -1$/mu.test(instrumentation)
  ) {
    throw new Error(
      `${variant} instrumentation did not report one passing test:\n${instrumentation}`,
    );
  }
  const logs = await readSettledLogs(adb, variant, timeoutSeconds);
  const proof = parseProductTelemetryVariantLog(logs, variant);
  const evidence = proof.physicalEvidence;
  return {
    variant,
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
    updates: proof.updates,
    result: proof.result,
    physicalEvidence: evidence,
  };
}

function summarizeMetrics(samples, metrics) {
  return Object.fromEntries(
    metrics.map((metric) => [metric, summarizePairedMetric(samples, metric)]),
  );
}

export function productTelemetryEventSamples(processSamples) {
  return processSamples.flatMap((sample) =>
    sample.updates.map((update) => ({
      sampleIndex:
        sample.sampleIndex * EXPECTED_UPDATE_COUNT + update.eventIndex - 1,
      processPairIndex: sample.sampleIndex,
      orderIndex: sample.orderIndex,
      variant: sample.variant,
      eventIndex: update.eventIndex,
      processed: update.processed,
      activeOrder: update.activeOrder,
      alertVisible: update.alertVisible,
      alertComputation: update.alertComputation,
      hostRevision: update.hostRevision,
      ...Object.fromEntries(
        EVENT_METRICS.map((metric) => [metric, update[metric]]),
      ),
    })),
  );
}

export function summarizeProductTelemetrySamples(processSamples) {
  if (processSamples.length === 0) {
    throw new Error("The Android product telemetry benchmark has no samples.");
  }
  return {
    event: summarizeMetrics(
      productTelemetryEventSamples(processSamples),
      EVENT_METRICS,
    ),
    process: summarizeMetrics(processSamples, PROCESS_METRICS),
  };
}

async function main() {
  if (process.argv.length > 2) {
    throw new Error(
      "The matched Android product telemetry benchmark accepts no arguments.",
    );
  }
  run("adb", ["version"]);
  const serial = resolveSerial();
  const adb = (...arguments_) => run("adb", ["-s", serial, ...arguments_]);
  if (adb("get-state") !== "device") {
    throw new Error(
      "The selected Android device is unavailable or unauthorized.",
    );
  }
  const sampleCount = readInteger(
    "SOLID_NATIVE_ANDROID_PRODUCT_TELEMETRY_SAMPLES",
    6,
    { minimum: 1, maximum: 100 },
  );
  const warmupPairCount = readInteger(
    "SOLID_NATIVE_ANDROID_PRODUCT_TELEMETRY_WARMUP_PAIRS",
    1,
    { minimum: 0, maximum: 20 },
  );
  const timeoutSeconds = readInteger(
    "SOLID_NATIVE_ANDROID_PRODUCT_TELEMETRY_TIMEOUT",
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
    process.env.SOLID_NATIVE_ANDROID_PRODUCT_TELEMETRY_ORDER_SEED,
    "SOLID_NATIVE_ANDROID_PRODUCT_TELEMETRY_ORDER_SEED",
  );
  const warmupVariantOrders =
    warmupPairCount === 0
      ? []
      : createBalancedPairOrders(
          warmupPairCount,
          "baseline",
          "observed",
          (orderSeed ^ 0x9e37_79b9) >>> 0,
        );
  const variantOrders = createBalancedPairOrders(
    sampleCount,
    "baseline",
    "observed",
    orderSeed,
  );
  buildAndInstall(appDirectory, serial);

  for (let warmupIndex = 0; warmupIndex < warmupPairCount; warmupIndex++) {
    const order = warmupVariantOrders[warmupIndex];
    if (order === undefined) {
      throw new Error("The product telemetry warmup order is incomplete.");
    }
    for (const variant of order) {
      const sample = await runVariant(serial, variant, timeoutSeconds);
      console.log(
        `Product telemetry warmup ${String(warmupIndex + 1)}/${String(warmupPairCount)} ${variant}: ` +
          `handler-to-frame median ${sample.updates
            .map((update) => update.handlerToFrameMilliseconds)
            .toSorted((left, right) => left - right)[14]
            ?.toFixed(3)} ms`,
      );
    }
  }

  const samples = [];
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
    const order = variantOrders[sampleIndex];
    if (order === undefined) {
      throw new Error("The product telemetry benchmark order is incomplete.");
    }
    for (const [orderIndex, variant] of order.entries()) {
      const sample = await runVariant(serial, variant, timeoutSeconds);
      samples.push({ sampleIndex, orderIndex, ...sample });
      console.log(
        `Product telemetry pair ${String(sampleIndex + 1)}/${String(sampleCount)} ${variant}: ` +
          `frame p95 ${sample.frameP95Milliseconds.toFixed(3)} ms, ` +
          `${String(sample.result.telemetryRecordCount)} telemetry records`,
      );
    }
  }
  finishProcessCleanup();

  const first = samples[0];
  if (
    first === undefined ||
    samples.some(
      (sample) =>
        sample.physicalEvidence.frameMetrics.manufacturer !==
          first.physicalEvidence.frameMetrics.manufacturer ||
        sample.physicalEvidence.frameMetrics.model !==
          first.physicalEvidence.frameMetrics.model ||
        sample.physicalEvidence.frameMetrics.sdk !==
          first.physicalEvidence.frameMetrics.sdk ||
        sample.physicalEvidence.frameMetrics.osRelease !==
          first.physicalEvidence.frameMetrics.osRelease ||
        sample.result.runtime.name !== first.result.runtime.name ||
        sample.result.runtime.version !== first.result.runtime.version ||
        sample.result.runtime.hostContractVersion !==
          first.result.runtime.hostContractVersion,
    )
  ) {
    throw new Error(
      "Product telemetry samples used inconsistent device or runtime identities.",
    );
  }

  const eventSamples = productTelemetryEventSamples(samples);
  const summary = summarizeProductTelemetrySamples(samples);
  const result = {
    schemaVersion: 0,
    benchmark: "android-causal-telemetry-product-workload",
    measuredAt: new Date().toISOString(),
    interpretation: "diagnostic-only",
    configuration: {
      sampleCountPerVariant: sampleCount,
      warmupPairs: warmupPairCount,
      order: "seeded-balanced",
      orderSeed,
      warmupVariantOrders,
      variantOrders,
      baseline: "solid-native-telemetry-disabled",
      observed: "solid-native-telemetry-enabled",
      input: "androidx-touchscreen-injection",
      workload: "order-dashboard",
      rowCount: 12,
      updateCountPerProcess: EXPECTED_UPDATE_COUNT,
      eventPairCount: sampleCount * EXPECTED_UPDATE_COUNT,
      completionBoundary:
        "touch-down-to-accessibility-visible-summary-row-and-structural-state",
      lifecycleBoundary:
        "javascript-handler-entry-to-native-commit-mount-and-frame-start",
      frameCapture: "window-frame-metrics-across-all-mixed-workload-updates",
    },
    environment: {
      revision: run("git", ["-C", repositoryRoot, "rev-parse", "HEAD"]),
      dirty: run("git", ["-C", repositoryRoot, "status", "--porcelain"]) !== "",
      nativeCompatibilityFingerprint: nativeCompatibility.fingerprint,
      nativeCompatibilityInputCount: nativeCompatibility.inputCount,
      manufacturer: first.physicalEvidence.frameMetrics.manufacturer,
      deviceModel: first.physicalEvidence.frameMetrics.model,
      osVersion: first.physicalEvidence.frameMetrics.osRelease,
      sdkLevel: first.physicalEvidence.frameMetrics.sdk,
      cpuAbi: adb("shell", "getprop", "ro.product.cpu.abi"),
      runtime: first.result.runtime,
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
    eventSummary: summary.event,
    processSummary: summary.process,
    eventSamples,
    samples,
  };

  const outputRoot =
    process.env.SOLID_NATIVE_ANDROID_PRODUCT_TELEMETRY_OUTPUT_DIR;
  if (outputRoot !== undefined && outputRoot !== "") {
    const timestamp = new Date().toISOString().replaceAll(/[:.]/gu, "-");
    const outputDirectory = path.resolve(outputRoot, timestamp);
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(
      path.join(outputDirectory, "product-telemetry-result.json"),
      `${JSON.stringify(result, undefined, 2)}\n`,
      "utf8",
    );
    console.log(
      `Retained matched Android product telemetry samples at ${outputDirectory}`,
    );
  }
  const handlerToFrame = summary.event.handlerToFrameMilliseconds;
  console.log(
    `Android product telemetry: ${String(sampleCount)} seed-balanced process pairs and ` +
      `${String(sampleCount * EXPECTED_UPDATE_COUNT)} event pairs; handler-to-frame median ` +
      `baseline ${handlerToFrame.baseline.median.toFixed(3)} ms, observed ` +
      `${handlerToFrame.observed.median.toFixed(3)} ms, paired median delta ` +
      `${handlerToFrame.pairedDelta.median.toFixed(3)} ms.`,
  );
  console.log(
    "Accessibility completion includes input injection and configured state-observation overhead; lifecycle frame start and Window frame duration are not compositor presentation.",
  );
  console.log(
    `SOLID_NATIVE_ANDROID_PRODUCT_TELEMETRY_RESULT ${JSON.stringify(result)}`,
  );
}

const scriptPath = fileURLToPath(import.meta.url);
if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === scriptPath
) {
  await main();
}
