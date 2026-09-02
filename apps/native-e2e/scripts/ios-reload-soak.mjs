import { execFile, execFileSync, spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  readNativeIosApplicationProcessStatus,
  stopNativeIosApplicationProcesses,
} from "../../../packages/cli/dist/index.js";
import { parseReloadMarkers } from "./android-reload-soak.mjs";
import { readNativeCompatibilityIdentity } from "./native-benchmark-environment.mjs";

const DEFAULT_RELOAD_CYCLES = 20;
const DEFAULT_RELOAD_TIMEOUT_MS = 30_000;
const DEFAULT_TRACE_TIMEOUT_SECONDS = 180;
const MAX_RELOAD_CYCLES = 100;
const MAX_RELOAD_TIMEOUT_MS = 120_000;
const DEFAULT_METRO_PORT = 8092;
const MAX_RETAINED_OUTPUT_BYTES = 1024 * 1024;
const SIGNALS = ["SIGHUP", "SIGINT", "SIGTERM"];
const IOS_BUNDLE_IDENTIFIER =
  /^[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9][A-Za-z0-9-]*)+$/u;
const execFileAsync = promisify(execFile);

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitForPromiseWithin(promise, timeoutMs) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function boundedEnvironmentString(name, value, maximumLength = 256) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    /[\0-\x1f\x7f]/u.test(value)
  ) {
    throw new Error(
      `${name} is required and must be a bounded printable value.`,
    );
  }
  return value;
}

export function readIosReloadConfiguration(environment = process.env) {
  const readInteger = (name, fallback, minimum, maximum) => {
    const source = environment[name];
    if (source === undefined || source === "") return fallback;
    const value = Number(source);
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw new RangeError(
        `${name} must be a safe integer from ${String(minimum)} through ${String(maximum)}.`,
      );
    }
    return value;
  };
  const bundleIdentifier = boundedEnvironmentString(
    "SOLID_NATIVE_IOS_RELOAD_BUNDLE_ID",
    environment.SOLID_NATIVE_IOS_RELOAD_BUNDLE_ID,
  );
  if (!IOS_BUNDLE_IDENTIFIER.test(bundleIdentifier)) {
    throw new Error(
      "SOLID_NATIVE_IOS_RELOAD_BUNDLE_ID must be a valid dotted bundle identifier.",
    );
  }
  const device = boundedEnvironmentString(
    "SOLID_NATIVE_IOS_DESTINATION",
    environment.SOLID_NATIVE_IOS_DESTINATION,
  );
  if (/\s/u.test(device)) {
    throw new Error(
      "SOLID_NATIVE_IOS_DESTINATION must not contain whitespace.",
    );
  }
  const mode = environment.SOLID_NATIVE_IOS_RELOAD_MODE ?? "metro";
  if (mode !== "metro" && mode !== "bundled") {
    throw new Error(
      "SOLID_NATIVE_IOS_RELOAD_MODE must be either metro or bundled.",
    );
  }
  const metroHost =
    mode === "metro"
      ? boundedEnvironmentString(
          "SOLID_NATIVE_IOS_RELOAD_METRO_HOST",
          environment.SOLID_NATIVE_IOS_RELOAD_METRO_HOST,
        )
      : undefined;
  if (metroHost !== undefined && !/^[A-Za-z0-9.-]+$/u.test(metroHost)) {
    throw new Error(
      "SOLID_NATIVE_IOS_RELOAD_METRO_HOST must be an IPv4 address or DNS name without a port.",
    );
  }
  const traceDevice = boundedEnvironmentString(
    "SOLID_NATIVE_IOS_RELOAD_TRACE_DEVICE",
    environment.SOLID_NATIVE_IOS_RELOAD_TRACE_DEVICE,
  );
  if (/\s/u.test(traceDevice)) {
    throw new Error(
      "SOLID_NATIVE_IOS_RELOAD_TRACE_DEVICE must not contain whitespace.",
    );
  }
  const developmentTeam = boundedEnvironmentString(
    "SOLID_NATIVE_IOS_TEAM",
    environment.SOLID_NATIVE_IOS_TEAM,
    64,
  );
  if (!/^[A-Za-z0-9]+$/u.test(developmentTeam)) {
    throw new Error(
      "SOLID_NATIVE_IOS_TEAM must be an alphanumeric team identifier.",
    );
  }
  return Object.freeze({
    bundleIdentifier,
    cycles: readInteger(
      "SOLID_NATIVE_IOS_RELOAD_CYCLES",
      DEFAULT_RELOAD_CYCLES,
      1,
      MAX_RELOAD_CYCLES,
    ),
    device,
    derivedDataPath: boundedEnvironmentString(
      "SOLID_NATIVE_IOS_RELOAD_DERIVED_DATA",
      environment.SOLID_NATIVE_IOS_RELOAD_DERIVED_DATA,
      4_096,
    ),
    developmentTeam,
    metroHost,
    metroPort: readInteger(
      "SOLID_NATIVE_IOS_RELOAD_METRO_PORT",
      DEFAULT_METRO_PORT,
      1_024,
      65_535,
    ),
    deviceModel: boundedEnvironmentString(
      "SOLID_NATIVE_IOS_RELOAD_DEVICE_MODEL",
      environment.SOLID_NATIVE_IOS_RELOAD_DEVICE_MODEL,
      512,
    ),
    osVersion: boundedEnvironmentString(
      "SOLID_NATIVE_IOS_RELOAD_OS_VERSION",
      environment.SOLID_NATIVE_IOS_RELOAD_OS_VERSION,
      128,
    ),
    mode,
    reloadTimeoutMs: readInteger(
      "SOLID_NATIVE_IOS_RELOAD_TIMEOUT_MS",
      DEFAULT_RELOAD_TIMEOUT_MS,
      1_000,
      MAX_RELOAD_TIMEOUT_MS,
    ),
    traceDevice,
    traceTimeoutSeconds: readInteger(
      "SOLID_NATIVE_IOS_RELOAD_TRACE_TIMEOUT_SECONDS",
      DEFAULT_TRACE_TIMEOUT_SECONDS,
      30,
      600,
    ),
  });
}

function retainOutput(current, chunk) {
  const combined = `${current}${chunk.toString("utf8")}`;
  if (Buffer.byteLength(combined, "utf8") <= MAX_RETAINED_OUTPUT_BYTES) {
    return combined;
  }
  return Buffer.from(combined, "utf8")
    .subarray(-MAX_RETAINED_OUTPUT_BYTES)
    .toString("utf8");
}

function spawnCaptured(command, arguments_, options = {}) {
  const child = spawn(command, arguments_, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const receive = (chunk) => {
    output = retainOutput(output, chunk);
    if (options.echo !== false) process.stderr.write(chunk);
  };
  child.stdout?.on("data", receive);
  child.stderr?.on("data", receive);
  return { child, output: () => output };
}

function childHasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForMetro(port, processState, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (true) {
    if (childHasExited(processState.child)) {
      throw new Error(
        `Metro exited before becoming ready with status ${String(processState.child.exitCode)}:\n${processState.output()}`,
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

async function prewarmIosDevelopmentBundle(configuration) {
  const bundleURL = new URL(
    `http://127.0.0.1:${String(configuration.metroPort)}/dev-entry.bundle`,
  );
  bundleURL.search = new URLSearchParams({
    app: configuration.bundleIdentifier,
    dev: "true",
    excludeSource: "true",
    inlineSourceMap: "false",
    lazy: "true",
    minify: "false",
    modulesOnly: "false",
    platform: "ios",
    runModule: "true",
    sourcePaths: "url-server",
  }).toString();
  const response = await fetch(bundleURL, {
    signal: AbortSignal.timeout(configuration.reloadTimeoutMs),
  });
  if (!response.ok || response.body === null) {
    throw new Error(
      `Metro rejected the iOS development bundle prewarm with status ${String(response.status)}.`,
    );
  }
  const reader = response.body.getReader();
  let receivedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > 64 * 1024 * 1024) {
      await reader.cancel();
      throw new Error("The iOS development bundle exceeded 64 MiB.");
    }
  }
  if (receivedBytes === 0) {
    throw new Error("Metro returned an empty iOS development bundle.");
  }
}

async function waitForReloadMarker(processState, expectedCount, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (true) {
    if (childHasExited(processState.child)) {
      throw new Error(
        `The iOS development console exited before reload ${String(expectedCount - 1)} settled:\n${processState.output()}`,
      );
    }
    const output = processState.output();
    if (output.includes("SOLID_NATIVE_RELOAD_FAILED")) {
      throw new Error(
        `The replacement runtime emitted SOLID_NATIVE_RELOAD_FAILED:\n${output.slice(-8_192)}`,
      );
    }
    const markers = parseReloadMarkers(output);
    if (markers.length >= expectedCount) return markers;
    if (performance.now() >= deadline) {
      throw new Error(
        `Timed out waiting for iOS development reload marker ${String(expectedCount)}; observed ${String(markers.length)}.`,
      );
    }
    await delay(100);
  }
}

function startMetro(projectRoot, repositoryRoot, port) {
  return spawnCaptured(
    process.execPath,
    [
      path.join(repositoryRoot, "packages/cli/dist/bin.js"),
      "start",
      "--cwd",
      projectRoot,
      "--",
      "--host",
      "0.0.0.0",
      "--port",
      String(port),
    ],
    { cwd: projectRoot },
  );
}

function startIosConsole(projectRoot, configuration) {
  const launchArguments =
    configuration.mode === "metro"
      ? [
          "--solid-native-development-reload",
          `--solid-native-metro-location=${configuration.metroHost}:${String(configuration.metroPort)}`,
        ]
      : [
          "--solid-native-use-bundled-development",
          "--solid-native-bundled-reload",
        ];
  return spawnCaptured(
    "xcrun",
    [
      "devicectl",
      "device",
      "process",
      "launch",
      "--device",
      configuration.device,
      "--terminate-existing",
      "--console",
      "--quiet",
      configuration.bundleIdentifier,
      ...launchArguments,
      "--solid-native-memory-keep-awake",
    ],
    { cwd: projectRoot },
  );
}

async function requestIosDevelopmentReload(configuration) {
  if (configuration.mode === "metro") {
    const response = await fetch(
      `http://127.0.0.1:${String(configuration.metroPort)}/reload`,
    );
    if (!response.ok || (await response.text()).trim() !== "OK") {
      throw new Error("Metro rejected the iOS development reload.");
    }
    return;
  }

  await execFileAsync(
    "xcrun",
    [
      "devicectl",
      "device",
      "process",
      "launch",
      "--device",
      configuration.device,
      "--payload-url",
      `${configuration.bundleIdentifier}://development/reload`,
      "--quiet",
      "--timeout",
      String(Math.ceil(configuration.reloadTimeoutMs / 1_000)),
      configuration.bundleIdentifier,
    ],
    {
      maxBuffer: MAX_RETAINED_OUTPUT_BYTES,
      timeout: configuration.reloadTimeoutMs + 1_000,
    },
  );
}

function startIosLocalNetworkPreflight(projectRoot, configuration) {
  return spawnCaptured(
    "xcodebuild",
    [
      "-quiet",
      "-workspace",
      path.join(projectRoot, "ios/SolidNativeE2E.xcworkspace"),
      "-scheme",
      "SolidNativeE2E",
      "-configuration",
      "Debug",
      "-destination",
      `id=${configuration.device}`,
      "-derivedDataPath",
      configuration.derivedDataPath,
      `DEVELOPMENT_TEAM=${configuration.developmentTeam}`,
      "CODE_SIGN_STYLE=Automatic",
      `SOLID_NATIVE_APP_BUNDLE_ID=${configuration.bundleIdentifier}`,
      `SOLID_NATIVE_RELOAD_METRO_LOCATION=${configuration.metroHost}:${String(configuration.metroPort)}`,
      "-allowProvisioningUpdates",
      "-collect-test-diagnostics",
      "never",
      "-only-testing:SolidNativeE2EUITests/SolidNativeReloadUITests/testGrantLocalNetworkAccessForDevelopmentReload",
      "test-without-building",
    ],
    { cwd: projectRoot },
  );
}

function startIosBundledPreflight(projectRoot, configuration) {
  return spawnCaptured(
    "xcodebuild",
    [
      "-quiet",
      "-workspace",
      path.join(projectRoot, "ios/SolidNativeE2E.xcworkspace"),
      "-scheme",
      "SolidNativeE2E",
      "-configuration",
      "Debug",
      "-destination",
      `id=${configuration.device}`,
      "-derivedDataPath",
      configuration.derivedDataPath,
      `DEVELOPMENT_TEAM=${configuration.developmentTeam}`,
      "CODE_SIGN_STYLE=Automatic",
      `SOLID_NATIVE_APP_BUNDLE_ID=${configuration.bundleIdentifier}`,
      "-allowProvisioningUpdates",
      "-collect-test-diagnostics",
      "never",
      "-only-testing:SolidNativeE2EUITests/SolidNativeReloadUITests/testActivateBundledDevelopmentReload",
      "test-without-building",
    ],
    { cwd: projectRoot },
  );
}

async function waitForSuccessfulProcess(processState, label, timeoutMs) {
  const completion = new Promise((resolve, reject) => {
    processState.child.once("error", reject);
    processState.child.once("close", (exitCode, signal) => {
      resolve({ exitCode, signal });
    });
  });
  const result = await waitForPromiseWithin(completion, timeoutMs);
  if (result === undefined) {
    processState.child.kill("SIGTERM");
    await waitForPromiseWithin(completion, 5_000);
    if (!childHasExited(processState.child)) processState.child.kill("SIGKILL");
    throw new Error(`${label} exceeded its ${String(timeoutMs)}ms bound.`);
  }
  if (result.exitCode !== 0) {
    throw new Error(
      `${label} exited with ${result.signal === null ? `status ${String(result.exitCode)}` : `signal ${String(result.signal)}`}\n${processState.output()}`,
    );
  }
}

function startResourceRecording(
  projectRoot,
  configuration,
  processIdentifier,
  tracePath,
) {
  return spawnCaptured(
    "xcrun",
    [
      "xctrace",
      "record",
      "--template",
      "Activity Monitor",
      "--device",
      configuration.traceDevice,
      "--attach",
      String(processIdentifier),
      "--time-limit",
      `${String(configuration.traceTimeoutSeconds)}s`,
      "--output",
      tracePath,
      "--no-prompt",
    ],
    { cwd: projectRoot },
  );
}

export function isResourceRecordingStarted(output) {
  return /(?:Recording started|Starting recording with the Activity Monitor template\.)/u.test(
    output,
  );
}

export function isTransientResourceRecordingStartFailure(output) {
  return /^Cannot find process for provided pid: \d+\s*$/u.test(output.trim());
}

async function waitForResourceRecording(processState, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (true) {
    const output = processState.output();
    if (isResourceRecordingStarted(output)) return;
    if (childHasExited(processState.child)) {
      throw new Error(
        `xctrace exited before the iOS reload recording began with status ${String(processState.child.exitCode)}:\n${output}`,
      );
    }
    if (performance.now() >= deadline) {
      throw new Error(
        `xctrace did not acknowledge the iOS reload recording:\n${output}`,
      );
    }
    await delay(100);
  }
}

async function startResourceRecordingWithRetry(
  projectRoot,
  configuration,
  processIdentifier,
  tracePath,
) {
  const deadline = performance.now() + configuration.reloadTimeoutMs;
  while (true) {
    const processState = startResourceRecording(
      projectRoot,
      configuration,
      processIdentifier,
      tracePath,
    );
    try {
      await waitForResourceRecording(
        processState,
        Math.min(5_000, Math.max(1, deadline - performance.now())),
      );
      return processState;
    } catch (error) {
      const output = processState.output();
      if (
        !isTransientResourceRecordingStartFailure(output) ||
        performance.now() >= deadline
      ) {
        await stopChild(processState);
        throw error;
      }
      await delay(250);
    }
  }
}

async function finishResourceRecording(processState) {
  if (!childHasExited(processState.child)) {
    const exited = new Promise((resolve) =>
      processState.child.once("exit", (exitCode, signal) =>
        resolve({ exitCode, signal }),
      ),
    );
    processState.child.kill("SIGINT");
    const result = await waitForPromiseWithin(exited, 30_000);
    if (result === undefined) {
      processState.child.kill("SIGKILL");
      await exited;
      throw new Error("xctrace did not finish the bounded iOS reload trace.");
    }
  }
  const output = processState.output();
  if (!/Recording completed/u.test(output)) {
    throw new Error(
      `xctrace did not complete the iOS reload recording:\n${output}`,
    );
  }
}

async function fileIsNonempty(target) {
  try {
    return (await stat(target)).size > 0;
  } catch {
    return false;
  }
}

async function validateActivityMonitorExport(reporterPath, outputPath, live) {
  try {
    await execFileAsync(process.execPath, [reporterPath, outputPath], {
      env: {
        ...process.env,
        [live
          ? "SOLID_NATIVE_IOS_MEMORY_VALIDATE_LIVE_ONLY"
          : "SOLID_NATIVE_IOS_MEMORY_VALIDATE_ONLY"]: "1",
      },
      maxBuffer: MAX_RETAINED_OUTPUT_BYTES,
      timeout: 60_000,
    });
    return true;
  } catch {
    return false;
  }
}

async function exportActivityMonitorTable({
  live,
  outputPath,
  reporterPath,
  tracePath,
}) {
  const schema = live ? "activity-monitor-process-live" : "sysmon-process";
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await execFileAsync(
        "xcrun",
        [
          "xctrace",
          "export",
          "--input",
          tracePath,
          "--xpath",
          `/trace-toc/run[@number="1"]/data/table[@schema="${schema}"]`,
          "--output",
          outputPath,
        ],
        {
          maxBuffer: MAX_RETAINED_OUTPUT_BYTES,
          timeout: 60_000,
        },
      );
    } catch (error) {
      lastError = error;
    }
    if (
      (await fileIsNonempty(outputPath)) &&
      (await validateActivityMonitorExport(reporterPath, outputPath, live))
    ) {
      return;
    }
    await delay(500);
  }
  throw new Error(
    `Could not export the ${schema} table from the iOS reload trace: ${lastError instanceof Error ? lastError.message : "the exported table remained invalid"}`,
    { cause: lastError },
  );
}

async function createResourceReport({
  configuration,
  evidenceDirectory,
  nativeCompatibility,
  reporterPath,
  repositoryRoot,
  sysmonPath,
  livePath,
}) {
  const benchmark =
    configuration.mode === "metro"
      ? "ios-development-runtime-reload"
      : "ios-bundled-runtime-reload";
  const resultPath = path.join(evidenceDirectory, "resource-result.json");
  await execFileAsync(process.execPath, [reporterPath, sysmonPath, livePath], {
    env: {
      ...process.env,
      SOLID_NATIVE_IOS_MEMORY_BENCHMARK: benchmark,
      SOLID_NATIVE_IOS_MEMORY_WARMUP: "0",
      SOLID_NATIVE_MEMORY_BUNDLE_IDENTIFIER: configuration.bundleIdentifier,
      SOLID_NATIVE_MEMORY_DEVICE_MODEL: configuration.deviceModel,
      SOLID_NATIVE_MEMORY_DIRTY:
        execFileSync("git", ["-C", repositoryRoot, "status", "--porcelain"], {
          encoding: "utf8",
        }).trim() === ""
          ? "false"
          : "true",
      SOLID_NATIVE_MEMORY_NATIVE_COMPATIBILITY_FINGERPRINT:
        nativeCompatibility.fingerprint,
      SOLID_NATIVE_MEMORY_NATIVE_COMPATIBILITY_INPUT_COUNT: String(
        nativeCompatibility.inputCount,
      ),
      SOLID_NATIVE_MEMORY_OS_VERSION: configuration.osVersion,
      SOLID_NATIVE_MEMORY_REQUESTED_DURATION: "0",
      SOLID_NATIVE_MEMORY_REVISION: execFileSync(
        "git",
        ["-C", repositoryRoot, "rev-parse", "HEAD"],
        { encoding: "utf8" },
      ).trim(),
      SOLID_NATIVE_MEMORY_VARIANT:
        configuration.mode === "metro"
          ? "solid-development-reload"
          : "solid-bundled-reload",
      SOLID_NATIVE_IOS_MEMORY_RESULT_PATH: resultPath,
    },
    maxBuffer: MAX_RETAINED_OUTPUT_BYTES,
    timeout: 60_000,
  });
  const report = JSON.parse(await readFile(resultPath, "utf8"));
  if (report.benchmark !== benchmark) {
    throw new Error("The iOS reload resource report has the wrong identity.");
  }
  return report;
}

async function stopChild(processState) {
  if (processState === undefined || childHasExited(processState.child)) return;
  const exited = new Promise((resolve) =>
    processState.child.once("exit", resolve),
  );
  processState.child.kill("SIGTERM");
  if (
    await waitForPromiseWithin(
      exited.then(() => true),
      5_000,
    )
  ) {
    return;
  }
  processState.child.kill("SIGKILL");
  await exited;
}

function installSignalCleanup(cleanup) {
  const handlers = new Map();
  for (const signal of SIGNALS) {
    const handler = () => {
      void cleanup().finally(() => {
        for (const [registeredSignal, registeredHandler] of handlers) {
          process.removeListener(registeredSignal, registeredHandler);
        }
        process.kill(process.pid, signal);
      });
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
    throw new Error("Usage: node ios-reload-soak.mjs");
  }
  const configuration = readIosReloadConfiguration();
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(scriptDirectory, "..");
  const repositoryRoot = path.resolve(projectRoot, "../..");
  const nativeCompatibility = readNativeCompatibilityIdentity(
    repositoryRoot,
    projectRoot,
    "ios",
  );
  const outputRoot = process.env.SOLID_NATIVE_IOS_RELOAD_OUTPUT_DIR;
  const preserveEvidence = outputRoot !== undefined && outputRoot !== "";
  const evidenceDirectory = preserveEvidence
    ? path.resolve(
        outputRoot,
        new Date().toISOString().replaceAll(/[:.]/gu, "-"),
      )
    : await mkdtemp(path.join(tmpdir(), "solid-native-ios-reload-"));
  await mkdir(evidenceDirectory, { recursive: true });
  const tracePath = path.join(evidenceDirectory, "activity.trace");
  const sysmonPath = path.join(evidenceDirectory, "sysmon.xml");
  const livePath = path.join(evidenceDirectory, "process-live.xml");
  const reporterPath = path.join(scriptDirectory, "ios-memory-report.mjs");
  let metro;
  let permissionPreflight;
  let consoleProcess;
  let resourceRecording;
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    await stopChild(resourceRecording);
    try {
      await stopNativeIosApplicationProcesses({
        bundleIdentifier: configuration.bundleIdentifier,
        device: configuration.device,
      });
    } catch (error) {
      process.stderr.write(
        `iOS reload application cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
    await stopChild(consoleProcess);
    await stopChild(permissionPreflight);
    await stopChild(metro);
  };
  const removeSignalCleanup = installSignalCleanup(cleanup);

  try {
    if (configuration.mode === "metro") {
      metro = startMetro(projectRoot, repositoryRoot, configuration.metroPort);
      await waitForMetro(
        configuration.metroPort,
        metro,
        configuration.reloadTimeoutMs,
      );
      await prewarmIosDevelopmentBundle(configuration);
      permissionPreflight = startIosLocalNetworkPreflight(
        projectRoot,
        configuration,
      );
      await waitForSuccessfulProcess(
        permissionPreflight,
        "The iOS local-network permission preflight",
        120_000,
      );
      await stopNativeIosApplicationProcesses({
        bundleIdentifier: configuration.bundleIdentifier,
        device: configuration.device,
      });
      process.stdout.write(
        "Verified iOS Local Network access and a Metro-backed Solid Native mount before measurement.\n",
      );
    } else {
      permissionPreflight = startIosBundledPreflight(
        projectRoot,
        configuration,
      );
      await waitForSuccessfulProcess(
        permissionPreflight,
        "The bundled iOS foreground preflight",
        120_000,
      );
      process.stdout.write(
        "Verified a foreground Solid Native mount from the signed in-app bundle before isolating runtime-replacement ownership from Metro transport.\n",
      );
    }
    consoleProcess = startIosConsole(projectRoot, configuration);
    let markers = await waitForReloadMarker(
      consoleProcess,
      1,
      configuration.reloadTimeoutMs,
    );
    const initialStatus = await readNativeIosApplicationProcessStatus({
      bundleIdentifier: configuration.bundleIdentifier,
      device: configuration.device,
    });
    if (
      !initialStatus.running ||
      initialStatus.processIdentifiers.length !== 1 ||
      initialStatus.processIdentifiers[0] === undefined
    ) {
      throw new Error(
        "The iOS development application did not expose exactly one live process.",
      );
    }
    const processIdentifier = initialStatus.processIdentifiers[0];
    resourceRecording = await startResourceRecordingWithRetry(
      projectRoot,
      configuration,
      processIdentifier,
      tracePath,
    );
    const startedAt = performance.now();
    const cycles = [];
    for (let cycle = 1; cycle <= configuration.cycles; cycle += 1) {
      if (childHasExited(resourceRecording.child)) {
        throw new Error(
          `The Activity Monitor recording ended before iOS reload ${String(cycle)}.`,
        );
      }
      const requestedAt = performance.now();
      await requestIosDevelopmentReload(configuration);
      markers = await waitForReloadMarker(
        consoleProcess,
        cycle + 1,
        configuration.reloadTimeoutMs,
      );
      const status = await readNativeIosApplicationProcessStatus({
        bundleIdentifier: configuration.bundleIdentifier,
        device: configuration.device,
      });
      if (
        !status.running ||
        status.processIdentifiers.length !== 1 ||
        status.processIdentifiers[0] !== processIdentifier
      ) {
        throw new Error(
          `Development reload ${String(cycle)} replaced the iOS process lifetime.`,
        );
      }
      cycles.push(
        Object.freeze({
          cycle,
          elapsedMilliseconds: Math.round(performance.now() - startedAt),
          settleMilliseconds: Math.round(performance.now() - requestedAt),
          surface: markers.at(-1).surface,
        }),
      );
      process.stdout.write(
        `Solid Native iOS development reload ${String(cycle)}/${String(configuration.cycles)} settled in the original process with no pending native frame.\n`,
      );
    }

    await delay(2_000);
    await finishResourceRecording(resourceRecording);
    await cleanup();
    removeSignalCleanup();
    await exportActivityMonitorTable({
      live: false,
      outputPath: sysmonPath,
      reporterPath,
      tracePath,
    });
    await exportActivityMonitorTable({
      live: true,
      outputPath: livePath,
      reporterPath,
      tracePath,
    });
    const resourceReport = await createResourceReport({
      configuration,
      evidenceDirectory,
      livePath,
      nativeCompatibility,
      reporterPath,
      repositoryRoot,
      sysmonPath,
    });
    const benchmark =
      configuration.mode === "metro"
        ? "ios-development-runtime-reload"
        : "ios-bundled-runtime-reload";
    const result = Object.freeze({
      schemaVersion: 0,
      benchmark,
      interpretation: "diagnostic-only",
      measuredAt: new Date().toISOString(),
      configuration: {
        cycles: configuration.cycles,
        reloadTimeoutMs: configuration.reloadTimeoutMs,
        bundleIdentifier: configuration.bundleIdentifier,
        mode: configuration.mode,
        ...(configuration.mode === "metro"
          ? { metroPort: configuration.metroPort }
          : {}),
        traceTimeoutSeconds: configuration.traceTimeoutSeconds,
      },
      environment: {
        device: configuration.device,
        deviceModel: configuration.deviceModel,
        osVersion: configuration.osVersion,
        revision: execFileSync(
          "git",
          ["-C", repositoryRoot, "rev-parse", "HEAD"],
          { encoding: "utf8" },
        ).trim(),
        nativeCompatibilityFingerprint: nativeCompatibility.fingerprint,
        nativeCompatibilityInputCount: nativeCompatibility.inputCount,
      },
      processIdentifier,
      markerCount: markers.length,
      cycles,
      resources: {
        durationSeconds: resourceReport.configuration.durationSeconds,
        sampleCount: resourceReport.configuration.sampleCount,
        liveIntervalCount: resourceReport.configuration.liveIntervalCount,
        processor: resourceReport.processor,
        physicalFootprint: resourceReport.physicalFootprint,
        realMemory: resourceReport.realMemory,
        residentSize: resourceReport.residentSize,
      },
    });
    await writeFile(
      path.join(evidenceDirectory, "reload-result.json"),
      `${JSON.stringify(result, undefined, 2)}\n`,
      "utf8",
    );
    if (preserveEvidence) {
      console.log(`Retained iOS reload evidence at ${evidenceDirectory}`);
    }
    console.log(
      `Verified ${String(configuration.cycles)} full Hermes runtime replacements in one iOS process.`,
    );
    console.log(
      `Physical footprint ${String(Math.round(resourceReport.physicalFootprint.firstBytes / (1024 * 1024)))} MiB -> ${String(Math.round(resourceReport.physicalFootprint.lastBytes / (1024 * 1024)))} MiB; threads ${String(resourceReport.processor.minimumThreadCount)}-${String(resourceReport.processor.maximumThreadCount)}.`,
    );
    console.log(
      "Reload timing and resource samples are diagnostic evidence, not a general memory-leak or energy verdict.",
    );
    console.log(`SOLID_NATIVE_IOS_RELOAD_RESULT ${JSON.stringify(result)}`);
  } finally {
    removeSignalCleanup();
    await cleanup();
    if (!preserveEvidence) {
      await rm(evidenceDirectory, { force: true, recursive: true });
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
