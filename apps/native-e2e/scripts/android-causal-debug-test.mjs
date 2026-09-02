import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
  captureNativeAndroidCausalDebugSnapshot,
  captureNativeAndroidSolidDiagnostics,
} from "../../../packages/cli/dist/index.js";

import { stopAndroidProcesses } from "./android-process-cleanup.mjs";
import { verifyNativeCausalDebugPhysicalProof } from "./causal-debug-physical-proof.mjs";
import {
  verifyNativeSolidDiagnosticsCorrelationPhysicalProof,
  verifyNativeSolidDiagnosticsPhysicalProof,
  verifyNativeSolidDiagnosticsReportPhysicalProof,
} from "./solid-diagnostics-physical-proof.mjs";

const APP_ID = "dev.solidnative.diagnostics";
const ACTIVITY = `${APP_ID}/dev.solidnative.e2e.MainActivity`;
const DEVICE_METRO_PORT = 8081;
const HOST_METRO_PORT = 8092;
const START_TIMEOUT_MS = 30_000;
const MARKER = "SOLID_NATIVE_DIAGNOSTICS_READY";
const FAILURE_MARKER = "SOLID_NATIVE_DIAGNOSTICS_FAILED";

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

function tryRun(command, arguments_) {
  try {
    return run(command, arguments_);
  } catch {
    return undefined;
  }
}

function resolveSerial() {
  const configured = process.env.SOLID_NATIVE_ANDROID_SERIAL;
  if (configured !== undefined && configured !== "") return configured;
  const serials = run("adb", ["devices"])
    .split(/\r?\n/u)
    .slice(1)
    .map((line) => line.trim().split(/\s+/u))
    .filter(([, state]) => state === "device")
    .map(([serial]) => serial)
    .filter((serial) => serial !== undefined);
  if (serials.length !== 1) {
    throw new Error(
      `Expected exactly one authorized Android device; found ${String(serials.length)}. Set SOLID_NATIVE_ANDROID_SERIAL to choose one.`,
    );
  }
  return serials[0];
}

function startMetro(projectRoot, repositoryRoot) {
  const executable = path.join(repositoryRoot, "packages/cli/dist/bin.js");
  const child = spawn(
    process.execPath,
    [
      executable,
      "start",
      "--cwd",
      projectRoot,
      "--",
      "--port",
      String(HOST_METRO_PORT),
    ],
    { cwd: projectRoot, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  const retain = (chunk) => {
    output = `${output}${chunk.toString()}`.slice(-65_536);
  };
  child.stdout?.on("data", retain);
  child.stderr?.on("data", retain);
  return { child, output: () => output };
}

async function stopMetro(child) {
  if (child === undefined || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  if (
    await Promise.race([
      exited.then(() => true),
      delay(5_000).then(() => false),
    ])
  ) {
    return;
  }
  child.kill("SIGKILL");
  await exited;
}

async function waitForMetro(metro) {
  const deadline = performance.now() + START_TIMEOUT_MS;
  while (true) {
    if (metro.child.exitCode !== null) {
      throw new Error(
        `Metro exited with status ${String(metro.child.exitCode)}:\n${metro.output()}`,
      );
    }
    try {
      const response = await fetch(
        `http://127.0.0.1:${String(HOST_METRO_PORT)}/status`,
      );
      if (
        response.ok &&
        (await response.text()).trim() === "packager-status:running"
      ) {
        return;
      }
    } catch {
      // The bounded startup window remains authoritative.
    }
    if (performance.now() >= deadline) {
      throw new Error("Metro did not become ready for causal-debug proof.");
    }
    await delay(100);
  }
}

async function waitForApplication(adb) {
  const deadline = performance.now() + START_TIMEOUT_MS;
  while (true) {
    const log = adb("logcat", "-d", "-v", "raw", "ReactNativeJS:V", "*:S");
    if (log.includes(FAILURE_MARKER)) {
      throw new Error(`The development app failed:\n${log.slice(-8_192)}`);
    }
    if (log.includes(MARKER)) return;
    if (performance.now() >= deadline) {
      throw new Error("The development app did not publish its ready marker.");
    }
    await delay(100);
  }
}

async function prepareDeviceForProof(adb) {
  adb("shell", "input", "keyevent", "KEYCODE_WAKEUP");
  adb("shell", "wm", "dismiss-keyguard");
  adb("shell", "cmd", "statusbar", "collapse");
  await delay(1_000);
  const policy = adb("shell", "dumpsys", "window", "policy");
  const delegate = policy.match(
    /KeyguardServiceDelegate[\s\S]*?\bshowing=(true|false)\b/u,
  );
  if (delegate?.[1] !== "false") {
    throw new Error(
      "The selected Android device is locked; unlock it before running the causal-debug proof.",
    );
  }
}

async function main() {
  if (process.argv.length > 2) {
    throw new Error("Usage: node android-causal-debug-test.mjs");
  }
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(scriptDirectory, "..");
  const repositoryRoot = path.resolve(projectRoot, "../..");
  const serial = resolveSerial();
  const adb = (...arguments_) => run("adb", ["-s", serial, ...arguments_]);
  if (adb("get-state") !== "device") {
    throw new Error(`Android device ${serial} is unavailable or unauthorized.`);
  }
  if (adb("shell", "getprop", "ro.kernel.qemu") === "1") {
    throw new Error("Causal-debug transport proof requires a physical device.");
  }

  let metro;
  let reverseInstalled = false;
  let reportDirectory;
  let stayAwakeLeased = false;
  const previousStayAwake = adb(
    "shell",
    "settings",
    "get",
    "global",
    "stay_on_while_plugged_in",
  );
  try {
    adb("shell", "settings", "put", "global", "stay_on_while_plugged_in", "3");
    stayAwakeLeased = true;
    await prepareDeviceForProof(adb);
    stopAndroidProcesses(serial, [APP_ID]);
    runStreaming(
      "sh",
      ["scripts/android-gradle.sh", ":app:installSolidDiagnosticsDebug"],
      { cwd: projectRoot },
    );
    stopAndroidProcesses(serial, [APP_ID]);

    metro = startMetro(projectRoot, repositoryRoot);
    await waitForMetro(metro);
    adb(
      "reverse",
      `tcp:${String(DEVICE_METRO_PORT)}`,
      `tcp:${String(HOST_METRO_PORT)}`,
    );
    reverseInstalled = true;
    adb("logcat", "-c");
    await prepareDeviceForProof(adb);
    adb("shell", "am", "start", "-S", "-W", "-n", ACTIVITY);
    await waitForApplication(adb);

    const diagnostics = await captureNativeAndroidSolidDiagnostics({
      packageName: APP_ID,
      serial,
      durationMs: 1_200,
      timeoutMs: 10_000,
    });
    const diagnosticsProof =
      verifyNativeSolidDiagnosticsPhysicalProof(diagnostics);
    const snapshot = await captureNativeAndroidCausalDebugSnapshot({
      packageName: APP_ID,
      serial,
      timeoutMs: 10_000,
    });
    const proof = verifyNativeCausalDebugPhysicalProof(snapshot);
    const correlationProof =
      verifyNativeSolidDiagnosticsCorrelationPhysicalProof(
        diagnostics,
        snapshot,
      );
    reportDirectory = await mkdtemp(
      path.join(tmpdir(), "solid-native-live-report-"),
    );
    const reportPath = path.join(reportDirectory, "causal-report.html");
    const reportOutput = run(process.execPath, [
      path.join(repositoryRoot, "packages/cli/dist/bin.js"),
      "debug",
      "report-android",
      APP_ID,
      "--serial",
      serial,
      "--duration",
      "1200",
      "--timeout",
      "10000",
      "--output",
      reportPath,
    ]);
    if (reportOutput !== `Wrote causal report: ${reportPath}`) {
      throw new Error("The live report command did not identify its artifact.");
    }
    const liveReport = await readFile(reportPath, "utf8");
    const liveReportProof =
      verifyNativeSolidDiagnosticsReportPhysicalProof(liveReport);
    const remainingResponses = adb(
      "exec-out",
      "run-as",
      APP_ID,
      "ls",
      "-A",
      "cache/solid-native-debug",
    );
    if (remainingResponses !== "") {
      throw new Error("The causal-debug response mailbox was not cleaned.");
    }
    console.log(
      `SOLID_NATIVE_ANDROID_CAUSAL_DEBUG_RESULT ${JSON.stringify({
        schemaVersion: 0,
        serial,
        applicationId: APP_ID,
        ...proof,
        diagnostics: diagnosticsProof,
        correlation: correlationProof,
        liveReport: liveReportProof,
      })}`,
    );
  } finally {
    try {
      if (reverseInstalled) {
        tryRun("adb", [
          "-s",
          serial,
          "reverse",
          "--remove",
          `tcp:${String(DEVICE_METRO_PORT)}`,
        ]);
      }
      stopAndroidProcesses(serial, [APP_ID]);
      await stopMetro(metro?.child);
      if (reportDirectory !== undefined) {
        await rm(reportDirectory, { recursive: true, force: true });
      }
    } finally {
      if (stayAwakeLeased) {
        if (previousStayAwake === "" || previousStayAwake === "null") {
          tryRun("adb", [
            "-s",
            serial,
            "shell",
            "settings",
            "delete",
            "global",
            "stay_on_while_plugged_in",
          ]);
        } else {
          tryRun("adb", [
            "-s",
            serial,
            "shell",
            "settings",
            "put",
            "global",
            "stay_on_while_plugged_in",
            previousStayAwake,
          ]);
        }
      }
    }
  }
}

await main();
