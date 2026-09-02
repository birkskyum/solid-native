import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
  parseListBenchmarkLog,
  parseReactNativeListBenchmarkLog,
} from "./android-list-benchmark.mjs";
import {
  createBalancedPairOrders,
  readBenchmarkOrderSeed,
  summarizePairedMetric,
} from "./benchmark-statistics.mjs";
import { installAndroidProcessCleanup } from "./android-process-cleanup.mjs";
import { readNativeCompatibilityIdentity } from "./native-benchmark-environment.mjs";

const TEST_CLASS =
  "dev.solidnative.e2e.SolidNativePhysicalTest#testPhysicalRendererUpdate";
const VARIANT_CONFIGURATIONS = {
  "react-native-flat-list": {
    appId: "dev.solidnative.list.control",
    testRunner:
      "dev.solidnative.list.control.test/androidx.test.runner.AndroidJUnitRunner",
    entryFile: "list-control.ts",
    environment: { SOLID_NATIVE_REACT_CONTROL: "1" },
    tasks: [
      ":app:assembleReactListControlRelease",
      ":app:assembleReactListControlReleaseAndroidTest",
    ],
    applicationApk:
      "android/app/build/outputs/apk/reactListControl/release/app-reactListControl-release.apk",
    testApk:
      "android/app/build/outputs/apk/androidTest/reactListControl/release/app-reactListControl-release-androidTest.apk",
    failureMarker: "SOLID_NATIVE_REACT_LIST_FAILED",
    parse: parseReactNativeListBenchmarkLog,
  },
  "solid-native-virtualized-list": {
    appId: "dev.solidnative.list",
    testRunner:
      "dev.solidnative.list.test/androidx.test.runner.AndroidJUnitRunner",
    entryFile: "list.tsx",
    environment: {},
    tasks: [
      ":app:assembleSolidListRelease",
      ":app:assembleSolidListReleaseAndroidTest",
    ],
    applicationApk:
      "android/app/build/outputs/apk/solidList/release/app-solidList-release.apk",
    testApk:
      "android/app/build/outputs/apk/androidTest/solidList/release/app-solidList-release-androidTest.apk",
    failureMarker: "SOLID_NATIVE_VIRTUALIZED_LIST_FAILED",
    parse: parseListBenchmarkLog,
  },
  "solid-native-virtualized-list-recycling": {
    appId: "dev.solidnative.list.recycling",
    testRunner:
      "dev.solidnative.list.recycling.test/androidx.test.runner.AndroidJUnitRunner",
    entryFile: "list.tsx",
    environment: {},
    tasks: [
      ":app:assembleSolidListRecyclingRelease",
      ":app:assembleSolidListRecyclingReleaseAndroidTest",
    ],
    applicationApk:
      "android/app/build/outputs/apk/solidListRecycling/release/app-solidListRecycling-release.apk",
    testApk:
      "android/app/build/outputs/apk/androidTest/solidListRecycling/release/app-solidListRecycling-release-androidTest.apk",
    failureMarker: "SOLID_NATIVE_VIRTUALIZED_LIST_FAILED",
    requiredMarker: "SOLID_NATIVE_VIEW_RECYCLING_SUCCEEDED",
    parse: parseListBenchmarkLog,
  },
};
const METRICS = [
  "frames",
  "deadlineMisses",
  "p50Milliseconds",
  "p95Milliseconds",
  "maxMilliseconds",
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

function readInteger(name, fallback, { maximum, minimum }) {
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

function resolveComparison() {
  const mode = process.env.SOLID_NATIVE_ANDROID_LIST_COMPARISON ?? "renderer";
  if (mode === "renderer") {
    return {
      mode,
      benchmark: "android-matched-virtualized-list-frames",
      baseline: "react-native-flat-list",
      observed: "solid-native-virtualized-list",
    };
  }
  if (mode === "view-recycling") {
    return {
      mode,
      benchmark: "android-paired-solid-list-view-recycling-frames",
      baseline: "solid-native-virtualized-list",
      observed: "solid-native-virtualized-list-recycling",
    };
  }
  throw new Error(
    "SOLID_NATIVE_ANDROID_LIST_COMPARISON must be renderer or view-recycling.",
  );
}

function comparisonEntries(comparison) {
  return [comparison.baseline, comparison.observed].map((variant) => {
    const configuration = VARIANT_CONFIGURATIONS[variant];
    if (configuration === undefined) throw new Error("Unknown list variant.");
    return [variant, configuration];
  });
}

function buildAndInstall(appDirectory, serial, comparison) {
  for (const [variant, configuration] of comparisonEntries(comparison)) {
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
        `Android did not register the ${variant} instrumentation runner.`,
      );
    }
  }
}

function runVariant(serial, variant, timeoutSeconds, comparison) {
  const configuration = VARIANT_CONFIGURATIONS[variant];
  if (configuration === undefined) throw new Error("Unknown list variant.");
  const adb = (...arguments_) => run("adb", ["-s", serial, ...arguments_]);
  for (const [, candidate] of comparisonEntries(comparison)) {
    adb("shell", "am", "force-stop", candidate.appId);
  }
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
  if (!/^OK \(1 test\)$/m.test(instrumentation)) {
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
    throw new Error(`${variant} reported a JavaScript failure:\n${logs}`);
  }
  if (
    configuration.requiredMarker !== undefined &&
    !logs.includes(configuration.requiredMarker)
  ) {
    throw new Error(
      `${variant} emitted no ${configuration.requiredMarker} native identity proof.`,
    );
  }
  const evidence = configuration.parse(logs);
  if (evidence === undefined) {
    throw new Error(`${variant} emitted no benchmark evidence.`);
  }
  return {
    variant,
    pairVariant: variant === comparison.baseline ? "baseline" : "observed",
    instrumentationDurationMilliseconds,
    initialThermalStatus,
    finalThermalStatus: thermalStatus(serial),
    frames: evidence.frameMetrics.frames,
    deadlineMisses: evidence.frameMetrics.deadlineMisses,
    p50Milliseconds: evidence.frameMetrics.p50Milliseconds,
    p95Milliseconds: evidence.frameMetrics.p95Milliseconds,
    maxMilliseconds: evidence.frameMetrics.maxMilliseconds,
    evidence,
  };
}

export function summarizePairedListSamples(samples) {
  if (samples.length === 0) {
    throw new Error("The matched Android list benchmark has no samples.");
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
          baseline: paired.baseline,
          observed: paired.observed,
          pairedDeltaObservedMinusBaseline: paired.pairedDelta,
          differenceOfMediansObservedMinusBaseline: paired.differenceOfMedians,
          relativeDifferenceOfMediansPercent:
            paired.relativeDifferenceOfMediansPercent,
        },
      ];
    }),
  );
}

export function summarizeMatchedListSamples(samples) {
  return Object.fromEntries(
    Object.entries(summarizePairedListSamples(samples)).map(
      ([metric, summary]) => [
        metric,
        {
          reactNative: summary.baseline,
          solidNative: summary.observed,
          pairedDeltaSolidMinusReact: summary.pairedDeltaObservedMinusBaseline,
          differenceOfMediansSolidMinusReact:
            summary.differenceOfMediansObservedMinusBaseline,
          relativeDifferenceOfMediansPercent:
            summary.relativeDifferenceOfMediansPercent,
        },
      ],
    ),
  );
}

async function main() {
  if (process.argv.length > 2) {
    throw new Error("The matched Android list benchmark accepts no arguments.");
  }
  run("adb", ["version"]);
  const serial = resolveSerial();
  const adb = (...arguments_) => run("adb", ["-s", serial, ...arguments_]);
  if (adb("get-state") !== "device") {
    throw new Error(`Android device ${serial} is unavailable or unauthorized.`);
  }
  const sampleCount = readInteger("SOLID_NATIVE_ANDROID_LIST_SAMPLES", 6, {
    minimum: 1,
    maximum: 100,
  });
  const warmupPairCount = readInteger(
    "SOLID_NATIVE_ANDROID_LIST_WARMUP_PAIRS",
    1,
    { minimum: 0, maximum: 20 },
  );
  const timeoutSeconds = readInteger("SOLID_NATIVE_ANDROID_LIST_TIMEOUT", 60, {
    minimum: 1,
    maximum: 600,
  });
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const appDirectory = path.resolve(scriptDirectory, "..");
  const repositoryRoot = path.resolve(appDirectory, "../..");
  const comparison = resolveComparison();
  const nativeCompatibility = readNativeCompatibilityIdentity(
    repositoryRoot,
    appDirectory,
    "android",
  );
  const finishProcessCleanup = installAndroidProcessCleanup(
    serial,
    comparisonEntries(comparison).map(
      ([, configuration]) => configuration.appId,
    ),
  );
  const orderSeed = readBenchmarkOrderSeed(
    process.env.SOLID_NATIVE_ANDROID_LIST_ORDER_SEED,
    "SOLID_NATIVE_ANDROID_LIST_ORDER_SEED",
  );
  const warmupVariantOrders =
    warmupPairCount === 0
      ? []
      : createBalancedPairOrders(
          warmupPairCount,
          comparison.baseline,
          comparison.observed,
          (orderSeed ^ 0x9e37_79b9) >>> 0,
        );
  const variantOrders = createBalancedPairOrders(
    sampleCount,
    comparison.baseline,
    comparison.observed,
    orderSeed,
  );
  buildAndInstall(appDirectory, serial, comparison);

  for (let warmupIndex = 0; warmupIndex < warmupPairCount; warmupIndex++) {
    const order = warmupVariantOrders[warmupIndex];
    if (order === undefined) {
      throw new Error("The matched list warmup order is incomplete.");
    }
    for (const variant of order) {
      const sample = runVariant(serial, variant, timeoutSeconds, comparison);
      console.log(
        `Matched list warmup ${String(warmupIndex + 1)}/${String(warmupPairCount)} ${variant}: ` +
          `${String(sample.frames)} frames, p95 ${sample.p95Milliseconds.toFixed(3)} ms`,
      );
    }
  }

  const samples = [];
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
    const order = variantOrders[sampleIndex];
    if (order === undefined) {
      throw new Error("The matched list benchmark order is incomplete.");
    }
    for (const [orderIndex, variant] of order.entries()) {
      const sample = runVariant(serial, variant, timeoutSeconds, comparison);
      samples.push({ sampleIndex, orderIndex, ...sample });
      console.log(
        `Matched list pair ${String(sampleIndex + 1)}/${String(sampleCount)} ${variant}: ` +
          `${String(sample.frames)} frames, p95 ${sample.p95Milliseconds.toFixed(3)} ms, ` +
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
    throw new Error("Matched list samples used inconsistent physical devices.");
  }

  const summary =
    comparison.mode === "renderer"
      ? summarizeMatchedListSamples(samples)
      : summarizePairedListSamples(samples);
  const result = {
    schemaVersion: 0,
    benchmark: comparison.benchmark,
    measuredAt: new Date().toISOString(),
    interpretation: "diagnostic-only",
    configuration: {
      sampleCountPerVariant: sampleCount,
      warmupPairs: warmupPairCount,
      order: "seeded-balanced",
      orderSeed,
      warmupVariantOrders,
      variantOrders,
      baseline: comparison.baseline,
      observed: comparison.observed,
      input: "androidx-touchscreen-injection",
      frameCapture:
        "window-frame-metrics-from-gesture-through-settled-proof-status",
      itemCount: 1_000,
      itemSize: 56,
      viewportSize: 392,
      prependCount: 50,
      imperativeIndex: 950,
      imperativeItemIndex: 900,
      imperativeViewPosition: 0.5,
      imperativeExpectedOffset: 53_032,
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

  const outputRoot = process.env.SOLID_NATIVE_ANDROID_LIST_OUTPUT_DIR;
  if (outputRoot !== undefined && outputRoot !== "") {
    const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
    const outputDirectory = path.resolve(outputRoot, timestamp);
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(
      path.join(outputDirectory, "matched-list-frame-result.json"),
      `${JSON.stringify(result, undefined, 2)}\n`,
      "utf8",
    );
    console.log(`Retained matched Android list samples at ${outputDirectory}`);
  }
  const p95Summary = summary.p95Milliseconds;
  const baselineSummary = p95Summary.reactNative ?? p95Summary.baseline;
  const observedSummary = p95Summary.solidNative ?? p95Summary.observed;
  const pairedDelta =
    p95Summary.pairedDeltaSolidMinusReact ??
    p95Summary.pairedDeltaObservedMinusBaseline;
  console.log(
    `Paired Android list benchmark: ${String(sampleCount)} seed-balanced pairs; ` +
      `baseline p95 median ${baselineSummary.median.toFixed(3)} ms, ` +
      `observed p95 median ${observedSummary.median.toFixed(3)} ms, ` +
      `paired median delta ${pairedDelta.median.toFixed(3)} ms`,
  );
  console.log(
    "This Window frame-duration diagnostic does not prove compositor presentation or general application performance.",
  );
  console.log(
    `SOLID_NATIVE_ANDROID_LIST_MATCHED_RESULT ${JSON.stringify(result)}`,
  );
}

const scriptPath = fileURLToPath(import.meta.url);
if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === scriptPath
) {
  await main();
}
