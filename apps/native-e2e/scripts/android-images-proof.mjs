import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  assertImageServerEvidence,
  createImageProofServer,
} from "./native-image-proof-server.mjs";

const APP_ID = "dev.solidnative.e2e";
const TEST_ID = `${APP_ID}.test`;
const TEST_CLASS =
  "dev.solidnative.e2e.SolidNativeImagesPhysicalTest#testNativeImageCacheCancellationCausalityAndOwnerTeardownOnPhysicalDevice";
const TEST_RUNNER = `${TEST_ID}/androidx.test.runner.AndroidJUnitRunner`;
const DEVICE_PORT = 38_474;
const MAX_COMMAND_OUTPUT_BYTES = 16 * 1024 * 1024;
const PROOF_TIMEOUT_MS = 120_000;
const MARKER_TIMEOUT_MS = 30_000;
const REQUIRED_MARKERS = Object.freeze([
  "SOLID_NATIVE_IMAGES_READY",
  "SOLID_NATIVE_IMAGES_CACHE_COLD_CAUSALITY_SUCCEEDED",
  "SOLID_NATIVE_IMAGES_DIMENSIONS_CAUSALITY_SUCCEEDED",
  "SOLID_NATIVE_IMAGES_PREFETCH_CAUSALITY_SUCCEEDED",
  "SOLID_NATIVE_IMAGES_CACHE_HOT_CAUSALITY_SUCCEEDED",
  "SOLID_NATIVE_IMAGES_CACHE_SUCCEEDED",
  "SOLID_NATIVE_IMAGES_CANCELLATION_ACTIVE",
  "SOLID_NATIVE_IMAGES_EXPLICIT_CANCELLATION_SUCCEEDED",
  "SOLID_NATIVE_IMAGES_OWNER_DISPOSAL_ACTIVE",
  "SOLID_NATIVE_IMAGES_OWNER_CANCELLATION_SUCCEEDED",
  "SOLID_NATIVE_IMAGES_TEARDOWN_SUCCEEDED",
]);
const SIGNALS = Object.freeze(["SIGHUP", "SIGINT", "SIGTERM"]);

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    encoding: "utf8",
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
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

function runStreaming(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    stdio: "inherit",
    ...options,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${arguments_.join(" ")} exited with status ${String(result.status)}.`,
    );
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

function runAsynchronous(command, arguments_, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    options.onChild?.(child);
    const stdout = [];
    const stderr = [];
    let byteLength = 0;
    let settled = false;
    let timer;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.onChild?.(undefined);
      if (error === undefined) resolve(result);
      else reject(error);
    };
    const retain = (chunks, chunk) => {
      byteLength += chunk.byteLength;
      if (byteLength > MAX_COMMAND_OUTPUT_BYTES) {
        child.kill("SIGTERM");
        finish(new Error(`${command} output exceeded the bounded capture.`));
        return;
      }
      chunks.push(chunk);
    };
    child.stdout.on("data", (chunk) => retain(stdout, chunk));
    child.stderr.on("data", (chunk) => retain(stderr, chunk));
    child.once("error", (error) => finish(error));
    child.once("close", (code, signal) => {
      const output = Buffer.concat(stdout).toString("utf8");
      const errorOutput = Buffer.concat(stderr).toString("utf8");
      if (code !== 0) {
        finish(
          new Error(
            `${command} ${arguments_.join(" ")} exited with ${
              signal === null ? `status ${String(code)}` : `signal ${signal}`
            }: ${(errorOutput || output).trim()}`,
          ),
        );
        return;
      }
      finish(undefined, output.trim());
    });
    timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(
        new Error(
          `${command} ${arguments_.join(" ")} exceeded ${String(options.timeoutMilliseconds)}ms.`,
        ),
      );
    }, options.timeoutMilliseconds);
  });
}

async function waitForMarkers(serial) {
  const deadline = performance.now() + MARKER_TIMEOUT_MS;
  let logs = "";
  while (performance.now() < deadline) {
    logs = run("adb", [
      "-s",
      serial,
      "logcat",
      "-d",
      "-v",
      "threadtime",
      "ReactNativeJS:I",
      "*:S",
    ]);
    if (logs.includes("SOLID_NATIVE_IMAGES_FAILED")) {
      throw new Error(`The physical image app reported failure:\n${logs}`);
    }
    if (REQUIRED_MARKERS.every((marker) => logs.includes(marker))) return logs;
    await delay(100);
  }
  const missing = REQUIRED_MARKERS.filter((marker) => !logs.includes(marker));
  throw new Error(
    `The physical image app omitted markers ${JSON.stringify(missing)}:\n${logs}`,
  );
}

async function waitForServerEvidence(state) {
  const deadline = performance.now() + 5_000;
  while (true) {
    try {
      return assertImageServerEvidence(state);
    } catch (error) {
      if (performance.now() >= deadline) throw error;
      await delay(50);
    }
  }
}

async function main() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const appDirectory = path.resolve(scriptDirectory, "..");
  const sourceMap = path.join(
    appDirectory,
    "android/app/build/generated/sourcemaps/react/solidRelease/index.android.bundle.map",
  );
  const appApk = path.join(
    appDirectory,
    "android/app/build/outputs/apk/solid/release/app-solid-release.apk",
  );
  const testApk = path.join(
    appDirectory,
    "android/app/build/outputs/apk/androidTest/solid/release/app-solid-release-androidTest.apk",
  );
  const serial = resolveSerial();
  const adb = (...arguments_) => run("adb", ["-s", serial, ...arguments_]);
  if (adb("get-state") !== "device") {
    throw new Error(`Android device ${serial} is unavailable or unauthorized.`);
  }
  if (adb("shell", "getprop", "ro.kernel.qemu") === "1") {
    throw new Error(
      "The image cache proof requires physical Android hardware.",
    );
  }
  adb("shell", "input", "keyevent", "KEYCODE_WAKEUP");
  adb("shell", "wm", "dismiss-keyguard");
  if (adb("shell", "dumpsys", "window").includes("mDreamingLockscreen=true")) {
    throw new Error(`Android device ${serial} is securely locked.`);
  }

  runStreaming(
    "sh",
    [
      "scripts/android-gradle.sh",
      ":app:assembleSolidRelease",
      ":app:assembleSolidReleaseAndroidTest",
      "--console=plain",
    ],
    {
      cwd: appDirectory,
      env: { ...process.env, ENTRY_FILE: "images.tsx" },
    },
  );
  run(process.execPath, [
    path.join(scriptDirectory, "verify-solid-runtime-sourcemap.mjs"),
    sourceMap,
  ]);
  run(process.execPath, [
    path.join(scriptDirectory, "verify-images-sourcemap.mjs"),
    sourceMap,
  ]);

  const proofServer = await createImageProofServer();
  let activeChild;
  let cleanupStarted = false;
  const cleanup = async (failClosed) => {
    if (cleanupStarted) return;
    cleanupStarted = true;
    activeChild?.kill("SIGTERM");
    const failures = [];
    for (const arguments_ of [
      ["reverse", "--remove", `tcp:${String(DEVICE_PORT)}`],
      ["shell", "am", "force-stop", APP_ID],
      ["uninstall", TEST_ID],
      ["uninstall", APP_ID],
    ]) {
      try {
        adb(...arguments_);
      } catch (error) {
        failures.push(error);
      }
    }
    const remainingPid = spawnSync(
      "adb",
      ["-s", serial, "shell", "pidof", APP_ID],
      { encoding: "utf8" },
    );
    if (remainingPid.status === 0 && remainingPid.stdout.trim() !== "") {
      failures.push(new Error(`Image process ${APP_ID} survived cleanup.`));
    }
    for (const packageName of [TEST_ID, APP_ID]) {
      const installed = spawnSync(
        "adb",
        ["-s", serial, "shell", "pm", "path", packageName],
        { encoding: "utf8" },
      );
      if (installed.status === 0 && installed.stdout.trim() !== "") {
        failures.push(
          new Error(`Image package ${packageName} survived cleanup.`),
        );
      }
    }
    const reverse = spawnSync("adb", ["-s", serial, "reverse", "--list"], {
      encoding: "utf8",
    });
    if (
      reverse.status === 0 &&
      reverse.stdout.includes(`tcp:${String(DEVICE_PORT)}`)
    ) {
      failures.push(
        new Error("The image proof reverse tunnel survived cleanup."),
      );
    }
    try {
      await proofServer.close();
    } catch (error) {
      failures.push(error);
    }
    if (failClosed && failures.length === 1) throw failures[0];
    if (failClosed && failures.length > 1) {
      throw new AggregateError(failures, "Image proof cleanup failed.");
    }
  };
  const signalHandlers = new Map();
  for (const signal of SIGNALS) {
    const handler = () => {
      void cleanup(false).finally(() => {
        for (const [registered, registeredHandler] of signalHandlers) {
          process.removeListener(registered, registeredHandler);
        }
        process.kill(process.pid, signal);
      });
    };
    signalHandlers.set(signal, handler);
    process.once(signal, handler);
  }

  try {
    adb("install", "-r", appApk);
    adb("install", "-r", testApk);
    adb(
      "reverse",
      `tcp:${String(DEVICE_PORT)}`,
      `tcp:${String(proofServer.hostPort)}`,
    );
    const reverse = adb("reverse", "--list");
    if (
      !reverse.includes(
        `tcp:${String(DEVICE_PORT)} tcp:${String(proofServer.hostPort)}`,
      )
    ) {
      throw new Error("adb did not retain the image proof reverse tunnel.");
    }
    adb("logcat", "-c");
    const instrumentation = await runAsynchronous(
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
      {
        timeoutMilliseconds: PROOF_TIMEOUT_MS,
        onChild: (child) => {
          activeChild = child;
        },
      },
    );
    process.stdout.write(`${instrumentation}\n`);
    if (
      !/^OK \(1 test\)$/mu.test(instrumentation) ||
      !/^INSTRUMENTATION_CODE: -1$/mu.test(instrumentation)
    ) {
      throw new Error(
        `Image instrumentation did not report one passing test:\n${instrumentation}`,
      );
    }
    const logs = await waitForMarkers(serial);
    const evidence = await waitForServerEvidence(proofServer.state);
    const readyLine = logs
      .split(/\r?\n/u)
      .find((line) => line.includes("SOLID_NATIVE_IMAGES_READY"));
    const pid = readyLine?.trim().split(/\s+/u)[2];
    if (pid === undefined || !/^\d+$/u.test(pid)) {
      throw new Error("The image ready marker omitted its process ID.");
    }
    process.stdout.write(
      `Verified physical Android native image loading on ${serial} (process ${pid}): ${JSON.stringify(evidence)}.\n`,
    );
  } finally {
    for (const [signal, handler] of signalHandlers) {
      process.removeListener(signal, handler);
    }
    await cleanup(true);
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main();
}
