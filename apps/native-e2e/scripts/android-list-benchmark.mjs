import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { installAndroidProcessCleanup } from "./android-process-cleanup.mjs";
import { summarizeDistribution } from "./benchmark-statistics.mjs";
import { readNativeCompatibilityIdentity } from "./native-benchmark-environment.mjs";

const APP_ID = "dev.solidnative.list";
const TEST_ID = "dev.solidnative.list.test";
const TEST_RUNNER = `${TEST_ID}/androidx.test.runner.AndroidJUnitRunner`;
const TEST_CLASS =
  "dev.solidnative.e2e.SolidNativePhysicalTest#testPhysicalRendererUpdate";
const FRAME_MARKER = "SOLID_NATIVE_VIRTUALIZED_LIST_FRAME_METRICS ";
const SCROLL_MARKER = "SOLID_NATIVE_VIRTUALIZED_LIST_SUCCEEDED ";
const PREPEND_MARKER = "SOLID_NATIVE_VIRTUALIZED_LIST_PREPEND_SUCCEEDED ";
const IMPERATIVE_MARKER = "SOLID_NATIVE_VIRTUALIZED_LIST_IMPERATIVE_SUCCEEDED ";
const TEARDOWN_MARKER = "SOLID_NATIVE_VIRTUALIZED_LIST_TEARDOWN_SUCCEEDED ";
const FAILURE_MARKER = "SOLID_NATIVE_VIRTUALIZED_LIST_FAILED";
const REACT_FRAME_MARKER = "SOLID_NATIVE_REACT_LIST_FRAME_METRICS ";
const REACT_SCROLL_MARKER = "SOLID_NATIVE_REACT_LIST_SUCCEEDED ";
const REACT_PREPEND_MARKER = "SOLID_NATIVE_REACT_LIST_PREPEND_SUCCEEDED ";
const REACT_IMPERATIVE_MARKER = "SOLID_NATIVE_REACT_LIST_IMPERATIVE_SUCCEEDED ";
const EXPECTED_ITEM_COUNT = 1_000;
const EXPECTED_PREPEND_COUNT = 50;
const EXPECTED_PREPEND_OFFSET_DELTA = 2_800;
const EXPECTED_MAXIMUM_MOUNTED_ROWS = 12;
const EXPECTED_IMPERATIVE_INDEX = 950;
const EXPECTED_IMPERATIVE_ITEM_INDEX = 900;
const EXPECTED_IMPERATIVE_OFFSET = 53_032;
const EXPECTED_VIEWPORT_HEIGHT = 392;
const VIEWPORT_HEIGHT_TOLERANCE = 1;

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

function readNonNegativeInteger(name, fallback, maximum) {
  const source = process.env[name];
  if (source === undefined) return fallback;
  const value = Number(source);
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(
      `${name} must be a non-negative integer no greater than ${String(maximum)}.`,
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

function markedJson(source, marker) {
  const markerIndex = source.lastIndexOf(marker);
  if (markerIndex === -1) return undefined;
  const line = source.slice(markerIndex + marker.length).split(/\r?\n/)[0];
  if (line === undefined || line.trim() === "") {
    throw new Error("The Android list benchmark marker has no payload.");
  }
  return JSON.parse(line);
}

function finiteNumber(record, name) {
  const value = record?.[name];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Android list benchmark ${name} must be finite.`);
  }
  return value;
}

function nonNegativeInteger(record, name) {
  const value = finiteNumber(record, name);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `Android list benchmark ${name} must be a non-negative integer.`,
    );
  }
  return value;
}

export function parseListBenchmarkLog(source) {
  const frameMetrics = markedJson(source, FRAME_MARKER);
  const scroll = markedJson(source, SCROLL_MARKER);
  const prepend = markedJson(source, PREPEND_MARKER);
  const imperative = markedJson(source, IMPERATIVE_MARKER);
  const teardown = markedJson(source, TEARDOWN_MARKER);
  if (
    frameMetrics === undefined &&
    scroll === undefined &&
    prepend === undefined &&
    imperative === undefined &&
    teardown === undefined
  ) {
    return undefined;
  }
  if (
    frameMetrics === undefined ||
    scroll === undefined ||
    prepend === undefined ||
    imperative === undefined ||
    teardown === undefined
  ) {
    throw new Error("The Android list benchmark marker set is incomplete.");
  }

  const frames = nonNegativeInteger(frameMetrics, "frames");
  const deadlineMisses = nonNegativeInteger(frameMetrics, "deadlineMisses");
  const frozenFrames = nonNegativeInteger(frameMetrics, "frozenFrames");
  const droppedReports = nonNegativeInteger(frameMetrics, "droppedReports");
  const p50Milliseconds = finiteNumber(frameMetrics, "p50Milliseconds");
  const p95Milliseconds = finiteNumber(frameMetrics, "p95Milliseconds");
  const maxMilliseconds = finiteNumber(frameMetrics, "maxMilliseconds");
  const activeRowCount = nonNegativeInteger(scroll, "activeRowCount");
  const maximumMountedRows = nonNegativeInteger(scroll, "maximumMountedRows");
  const ownerCreations = nonNegativeInteger(scroll, "ownerCreations");
  const ownerDisposals = nonNegativeInteger(scroll, "ownerDisposals");
  const scrollOffset = finiteNumber(scroll, "scrollOffset");
  const listSequence = nonNegativeInteger(scroll, "listSequence");
  const successSequence = nonNegativeInteger(scroll, "sequence");
  const hostRevision = nonNegativeInteger(scroll, "hostRevision");
  const measuredHeight = finiteNumber(scroll, "measuredHeight");
  const prependCount = nonNegativeInteger(prepend, "prependCount");
  const prependBeforeOffset = finiteNumber(prepend, "beforeOffset");
  const prependExpectedOffset = finiteNumber(prepend, "expectedOffset");
  const prependOffset = finiteNumber(prepend, "scrollOffset");
  const prependActiveRows = nonNegativeInteger(prepend, "activeRowCount");
  const prependBeforeSequence = nonNegativeInteger(prepend, "beforeSequence");
  const prependSequence = nonNegativeInteger(prepend, "prependSequence");
  const prependStructuralCommitCount = nonNegativeInteger(
    prepend,
    "structuralCommitCount",
  );
  const prependSuccessSequence = nonNegativeInteger(prepend, "sequence");
  const prependHostRevision = nonNegativeInteger(prepend, "hostRevision");
  const imperativeIndex = nonNegativeInteger(imperative, "index");
  const imperativeItemIndex = nonNegativeInteger(imperative, "itemIndex");
  const expectedOffset = finiteNumber(imperative, "expectedOffset");
  const imperativeOffset = finiteNumber(imperative, "scrollOffset");
  const imperativeActiveRows = nonNegativeInteger(imperative, "activeRowCount");
  const imperativeCreations = nonNegativeInteger(imperative, "ownerCreations");
  const imperativeDisposals = nonNegativeInteger(imperative, "ownerDisposals");
  const imperativeBeforeSequence = nonNegativeInteger(
    imperative,
    "beforeSequence",
  );
  const windowSequence = nonNegativeInteger(imperative, "windowSequence");
  const structuralCommitCount = nonNegativeInteger(
    imperative,
    "structuralCommitCount",
  );
  const commandSequence = nonNegativeInteger(imperative, "commandSequence");
  const imperativeSequence = nonNegativeInteger(imperative, "sequence");
  const imperativeHostRevision = nonNegativeInteger(imperative, "hostRevision");
  const imperativeMeasuredHeight = finiteNumber(imperative, "measuredHeight");
  const teardownCreations = nonNegativeInteger(teardown, "ownerCreations");
  const teardownDisposals = nonNegativeInteger(teardown, "ownerDisposals");
  const teardownActiveRows = nonNegativeInteger(teardown, "activeRowCount");

  if (
    frameMetrics.schemaVersion !== 1 ||
    typeof frameMetrics.manufacturer !== "string" ||
    frameMetrics.manufacturer === "" ||
    typeof frameMetrics.model !== "string" ||
    frameMetrics.model === "" ||
    !Number.isSafeInteger(frameMetrics.sdk) ||
    frameMetrics.sdk <= 0 ||
    typeof frameMetrics.osRelease !== "string" ||
    frameMetrics.osRelease === "" ||
    frames < 5 ||
    deadlineMisses > frames ||
    frozenFrames !== 0 ||
    droppedReports !== 0 ||
    p50Milliseconds < 0 ||
    p95Milliseconds < p50Milliseconds ||
    maxMilliseconds < p95Milliseconds ||
    scroll.schemaVersion !== 0 ||
    scroll.itemCount !== EXPECTED_ITEM_COUNT ||
    maximumMountedRows !== EXPECTED_MAXIMUM_MOUNTED_ROWS ||
    activeRowCount <= 0 ||
    activeRowCount > maximumMountedRows ||
    ownerCreations - ownerDisposals !== activeRowCount ||
    scrollOffset <= 0 ||
    listSequence <= 0 ||
    successSequence !== listSequence + 1 ||
    hostRevision <= 0 ||
    Math.abs(measuredHeight - EXPECTED_VIEWPORT_HEIGHT) >
      VIEWPORT_HEIGHT_TOLERANCE ||
    scroll.platform !== "android" ||
    scroll.runtime !== "react-native-fabric" ||
    typeof scroll.runtimeVersion !== "string" ||
    scroll.runtimeVersion === "" ||
    prepend.schemaVersion !== 0 ||
    prependCount !== EXPECTED_PREPEND_COUNT ||
    typeof prepend.anchorKey !== "string" ||
    !prepend.anchorKey.startsWith("item-") ||
    prependExpectedOffset !==
      prependBeforeOffset + EXPECTED_PREPEND_OFFSET_DELTA ||
    Math.abs(prependOffset - prependExpectedOffset) > 1 ||
    prependActiveRows <= 0 ||
    prependActiveRows > maximumMountedRows ||
    prependBeforeSequence < successSequence ||
    prependStructuralCommitCount < 1 ||
    prependStructuralCommitCount > 4 ||
    prependSequence !== prependBeforeSequence + prependStructuralCommitCount ||
    prependSuccessSequence !== prependSequence + 1 ||
    prependHostRevision <= hostRevision ||
    imperative.schemaVersion !== 0 ||
    imperativeIndex !== EXPECTED_IMPERATIVE_INDEX ||
    imperativeItemIndex !== EXPECTED_IMPERATIVE_ITEM_INDEX ||
    imperative.viewPosition !== 0.5 ||
    expectedOffset !== EXPECTED_IMPERATIVE_OFFSET ||
    Math.abs(imperativeOffset - expectedOffset) > 1 ||
    imperativeActiveRows <= 0 ||
    imperativeActiveRows > maximumMountedRows ||
    imperativeCreations - imperativeDisposals !== imperativeActiveRows ||
    imperativeBeforeSequence < prependSuccessSequence ||
    windowSequence !== imperativeBeforeSequence + 1 ||
    structuralCommitCount < 1 ||
    structuralCommitCount > 4 ||
    commandSequence !== windowSequence + structuralCommitCount ||
    imperativeSequence <= commandSequence ||
    imperativeHostRevision <= prependHostRevision ||
    imperative.commandPriority !== "normal" ||
    Math.abs(imperativeMeasuredHeight - EXPECTED_VIEWPORT_HEIGHT) >
      VIEWPORT_HEIGHT_TOLERANCE ||
    teardown.schemaVersion !== 0 ||
    teardownCreations !== imperativeCreations ||
    teardownDisposals !== teardownCreations ||
    teardownActiveRows !== 0 ||
    teardown.rootDisposed !== true ||
    teardown.surfaceReady !== false
  ) {
    throw new Error("The Android list benchmark emitted invalid evidence.");
  }

  return { frameMetrics, scroll, prepend, imperative, teardown };
}

export function parseReactNativeListBenchmarkLog(source) {
  const frameMetrics = markedJson(source, REACT_FRAME_MARKER);
  const scroll = markedJson(source, REACT_SCROLL_MARKER);
  const prepend = markedJson(source, REACT_PREPEND_MARKER);
  const imperative = markedJson(source, REACT_IMPERATIVE_MARKER);
  if (
    frameMetrics === undefined &&
    scroll === undefined &&
    prepend === undefined &&
    imperative === undefined
  ) {
    return undefined;
  }
  if (
    frameMetrics === undefined ||
    scroll === undefined ||
    prepend === undefined ||
    imperative === undefined
  ) {
    throw new Error(
      "The Android React Native list control marker set is incomplete.",
    );
  }

  const frames = nonNegativeInteger(frameMetrics, "frames");
  const deadlineMisses = nonNegativeInteger(frameMetrics, "deadlineMisses");
  const frozenFrames = nonNegativeInteger(frameMetrics, "frozenFrames");
  const droppedReports = nonNegativeInteger(frameMetrics, "droppedReports");
  const p50Milliseconds = finiteNumber(frameMetrics, "p50Milliseconds");
  const p95Milliseconds = finiteNumber(frameMetrics, "p95Milliseconds");
  const maxMilliseconds = finiteNumber(frameMetrics, "maxMilliseconds");
  const scrollOffset = finiteNumber(scroll, "scrollOffset");
  const visibleRowCount = nonNegativeInteger(scroll, "visibleRowCount");
  const mountedRowCount = nonNegativeInteger(scroll, "mountedRowCount");
  const prependCount = nonNegativeInteger(prepend, "prependCount");
  const prependBeforeOffset = finiteNumber(prepend, "beforeOffset");
  const prependExpectedOffset = finiteNumber(prepend, "expectedOffset");
  const prependOffset = finiteNumber(prepend, "scrollOffset");
  const prependVisibleRows = nonNegativeInteger(prepend, "visibleRowCount");
  const prependMountedRows = nonNegativeInteger(prepend, "mountedRowCount");
  const imperativeIndex = nonNegativeInteger(imperative, "index");
  const imperativeItemIndex = nonNegativeInteger(imperative, "itemIndex");
  const expectedOffset = finiteNumber(imperative, "expectedOffset");
  const imperativeOffset = finiteNumber(imperative, "scrollOffset");
  const imperativeVisibleRows = nonNegativeInteger(
    imperative,
    "visibleRowCount",
  );
  const imperativeMountedRows = nonNegativeInteger(
    imperative,
    "mountedRowCount",
  );

  if (
    frameMetrics.schemaVersion !== 1 ||
    typeof frameMetrics.manufacturer !== "string" ||
    frameMetrics.manufacturer === "" ||
    typeof frameMetrics.model !== "string" ||
    frameMetrics.model === "" ||
    !Number.isSafeInteger(frameMetrics.sdk) ||
    frameMetrics.sdk <= 0 ||
    typeof frameMetrics.osRelease !== "string" ||
    frameMetrics.osRelease === "" ||
    frames < 5 ||
    deadlineMisses > frames ||
    frozenFrames !== 0 ||
    droppedReports !== 0 ||
    p50Milliseconds < 0 ||
    p95Milliseconds < p50Milliseconds ||
    maxMilliseconds < p95Milliseconds ||
    scroll.schemaVersion !== 0 ||
    scroll.variant !== "react-native-flat-list" ||
    scroll.itemCount !== EXPECTED_ITEM_COUNT ||
    scrollOffset <= 168 ||
    visibleRowCount <= 0 ||
    visibleRowCount > 50 ||
    mountedRowCount < visibleRowCount ||
    mountedRowCount > 50 ||
    scroll.containsFirstRow !== false ||
    scroll.platform !== "android" ||
    scroll.runtime !== "react-native-fabric" ||
    typeof scroll.runtimeVersion !== "string" ||
    scroll.runtimeVersion === "" ||
    prepend.schemaVersion !== 0 ||
    prepend.variant !== "react-native-flat-list" ||
    prependCount !== EXPECTED_PREPEND_COUNT ||
    typeof prepend.anchorKey !== "string" ||
    !prepend.anchorKey.startsWith("item-") ||
    prependExpectedOffset !==
      prependBeforeOffset + EXPECTED_PREPEND_OFFSET_DELTA ||
    Math.abs(prependOffset - prependExpectedOffset) > 1 ||
    prependVisibleRows <= 0 ||
    prependVisibleRows > 50 ||
    prependMountedRows < prependVisibleRows ||
    prependMountedRows > 50 ||
    imperative.schemaVersion !== 0 ||
    imperative.variant !== "react-native-flat-list" ||
    imperativeIndex !== EXPECTED_IMPERATIVE_INDEX ||
    imperativeItemIndex !== EXPECTED_IMPERATIVE_ITEM_INDEX ||
    imperative.viewPosition !== 0.5 ||
    expectedOffset !== EXPECTED_IMPERATIVE_OFFSET ||
    Math.abs(imperativeOffset - expectedOffset) > 1 ||
    imperativeVisibleRows <= 0 ||
    imperativeVisibleRows > 50 ||
    imperativeMountedRows < imperativeVisibleRows ||
    imperativeMountedRows > 50
  ) {
    throw new Error(
      "The Android React Native list control emitted invalid evidence.",
    );
  }

  return { frameMetrics, scroll, prepend, imperative };
}

const SAMPLE_METRICS = {
  frames: (sample) => sample.frameMetrics.frames,
  deadlineMisses: (sample) => sample.frameMetrics.deadlineMisses,
  p50Milliseconds: (sample) => sample.frameMetrics.p50Milliseconds,
  p95Milliseconds: (sample) => sample.frameMetrics.p95Milliseconds,
  maxMilliseconds: (sample) => sample.frameMetrics.maxMilliseconds,
  instrumentationDurationMilliseconds: (sample) =>
    sample.instrumentationDurationMilliseconds,
};

export function summarizeListSamples(samples) {
  if (samples.length === 0) {
    throw new Error("The Android list benchmark has no samples.");
  }
  const reference = samples[0];
  if (
    reference === undefined ||
    samples.some(
      (sample, index) =>
        sample.sampleIndex !== index ||
        typeof sample.instrumentationDurationMilliseconds !== "number" ||
        !Number.isFinite(sample.instrumentationDurationMilliseconds) ||
        sample.instrumentationDurationMilliseconds <= 0 ||
        sample.frameMetrics.manufacturer !==
          reference.frameMetrics.manufacturer ||
        sample.frameMetrics.model !== reference.frameMetrics.model ||
        sample.frameMetrics.sdk !== reference.frameMetrics.sdk ||
        sample.frameMetrics.osRelease !== reference.frameMetrics.osRelease ||
        sample.scroll.runtime !== reference.scroll.runtime ||
        sample.scroll.runtimeVersion !== reference.scroll.runtimeVersion,
    )
  ) {
    throw new Error(
      "Android list benchmark samples used inconsistent devices or runtimes.",
    );
  }
  return Object.fromEntries(
    Object.entries(SAMPLE_METRICS).map(([name, select]) => [
      name,
      summarizeDistribution(samples.map(select)),
    ]),
  );
}

function buildAndInstall(appDirectory, serial) {
  run(
    "sh",
    [
      "scripts/android-gradle.sh",
      ":app:assembleSolidListRelease",
      ":app:assembleSolidListReleaseAndroidTest",
      "--console=plain",
    ],
    {
      cwd: appDirectory,
      env: { ...process.env, ENTRY_FILE: "list.tsx" },
    },
  );
  const applicationApk = path.join(
    appDirectory,
    "android/app/build/outputs/apk/solidList/release/app-solidList-release.apk",
  );
  const testApk = path.join(
    appDirectory,
    "android/app/build/outputs/apk/androidTest/solidList/release/app-solidList-release-androidTest.apk",
  );
  run("adb", ["-s", serial, "install", "-r", applicationApk]);
  run("adb", ["-s", serial, "install", "-r", "-t", testApk]);
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
      `instrumentation:${TEST_RUNNER} (target=${APP_ID})`,
    )
  ) {
    throw new Error(
      "Android did not register the Solid list instrumentation runner.",
    );
  }
}

function runSample(serial, sampleIndex, timeoutSeconds) {
  const adb = (...arguments_) => run("adb", ["-s", serial, ...arguments_]);
  adb("shell", "am", "force-stop", APP_ID);
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
      TEST_RUNNER,
    ],
    { timeout: timeoutSeconds * 1_000 },
  );
  const instrumentationDurationMilliseconds = performance.now() - startedAt;
  if (!/^OK \(1 test\)$/m.test(instrumentation)) {
    throw new Error(
      `Android list instrumentation sample ${String(sampleIndex)} did not report one passing test:\n${instrumentation}`,
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
  if (logs.includes(FAILURE_MARKER)) {
    throw new Error(
      `Android list instrumentation sample ${String(sampleIndex)} reported a JavaScript failure:\n${logs}`,
    );
  }
  const evidence = parseListBenchmarkLog(logs);
  if (evidence === undefined) {
    throw new Error(
      `Android list instrumentation sample ${String(sampleIndex)} emitted no benchmark evidence.`,
    );
  }
  return {
    sampleIndex,
    instrumentationDurationMilliseconds,
    initialThermalStatus,
    finalThermalStatus: thermalStatus(serial),
    ...evidence,
  };
}

async function main() {
  if (process.argv.length > 2) {
    throw new Error("The Android list benchmark accepts no arguments.");
  }
  run("adb", ["version"]);
  const serial = resolveSerial();
  const finishProcessCleanup = installAndroidProcessCleanup(serial, [APP_ID]);
  const adb = (...arguments_) => run("adb", ["-s", serial, ...arguments_]);
  if (adb("get-state") !== "device") {
    throw new Error(`Android device ${serial} is unavailable or unauthorized.`);
  }
  const sampleCount = readPositiveInteger(
    "SOLID_NATIVE_ANDROID_LIST_SAMPLES",
    6,
    100,
  );
  const timeoutSeconds = readPositiveInteger(
    "SOLID_NATIVE_ANDROID_LIST_TIMEOUT",
    60,
    600,
  );
  const warmupSamples = readNonNegativeInteger(
    "SOLID_NATIVE_ANDROID_LIST_WARMUP_SAMPLES",
    1,
    20,
  );
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const appDirectory = path.resolve(scriptDirectory, "..");
  const repositoryRoot = path.resolve(appDirectory, "../..");
  const nativeCompatibility = readNativeCompatibilityIdentity(
    repositoryRoot,
    appDirectory,
    "android",
  );
  buildAndInstall(appDirectory, serial);

  for (let warmupIndex = 0; warmupIndex < warmupSamples; warmupIndex++) {
    const warmup = runSample(serial, warmupIndex, timeoutSeconds);
    console.log(
      `Android list warmup ${String(warmupIndex + 1)}/${String(warmupSamples)}: ` +
        `${warmup.frameMetrics.frames} frames, p95 ${warmup.frameMetrics.p95Milliseconds.toFixed(3)} ms`,
    );
  }
  const samples = [];
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
    const sample = runSample(serial, sampleIndex, timeoutSeconds);
    samples.push(sample);
    console.log(
      `Android list sample ${String(sampleIndex + 1)}/${String(sampleCount)}: ` +
        `${sample.frameMetrics.frames} frames, p95 ${sample.frameMetrics.p95Milliseconds.toFixed(3)} ms, ` +
        `${sample.frameMetrics.deadlineMisses} deadline misses`,
    );
  }
  finishProcessCleanup();
  const summary = summarizeListSamples(samples);
  const result = {
    schemaVersion: 0,
    benchmark: "android-solid-native-virtualized-list-frames",
    measuredAt: new Date().toISOString(),
    interpretation: "diagnostic-only",
    configuration: {
      sampleCount,
      warmupSamples,
      input: "androidx-touchscreen-injection",
      itemCount: EXPECTED_ITEM_COUNT,
      itemSize: 56,
      viewportSize: EXPECTED_VIEWPORT_HEIGHT,
      maximumMountedRows: EXPECTED_MAXIMUM_MOUNTED_ROWS,
      prependCount: EXPECTED_PREPEND_COUNT,
      imperativeIndex: EXPECTED_IMPERATIVE_INDEX,
      imperativeItemIndex: EXPECTED_IMPERATIVE_ITEM_INDEX,
      imperativeOffset: EXPECTED_IMPERATIVE_OFFSET,
    },
    environment: {
      revision: run("git", ["-C", repositoryRoot, "rev-parse", "HEAD"]),
      dirty: run("git", ["-C", repositoryRoot, "status", "--porcelain"]) !== "",
      nativeCompatibilityFingerprint: nativeCompatibility.fingerprint,
      nativeCompatibilityInputCount: nativeCompatibility.inputCount,
      manufacturer: samples[0].frameMetrics.manufacturer,
      deviceModel: samples[0].frameMetrics.model,
      osVersion: samples[0].frameMetrics.osRelease,
      sdkLevel: samples[0].frameMetrics.sdk,
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
      path.join(outputDirectory, "solid-list-frame-result.json"),
      `${JSON.stringify(result, undefined, 2)}\n`,
      "utf8",
    );
    console.log(`Retained Android list samples at ${outputDirectory}`);
  }
  console.log(
    `Android Solid Native list: ${String(sampleCount)} repeated physical-device samples; ` +
      `p95 median ${summary.p95Milliseconds.median.toFixed(3)} ms, max-frame median ` +
      `${summary.maxMilliseconds.median.toFixed(3)} ms`,
  );
  console.log(
    "This repeated single-variant diagnostic is not a matched React Native comparison or a compositor-presentation measurement.",
  );
  console.log(`SOLID_NATIVE_ANDROID_LIST_RESULT ${JSON.stringify(result)}`);
}

const scriptPath = fileURLToPath(import.meta.url);
if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === scriptPath
) {
  await main();
}
