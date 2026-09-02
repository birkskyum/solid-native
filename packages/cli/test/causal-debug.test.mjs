import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { promisify } from "node:util";

import {
  NATIVE_CAUSAL_DEBUG_MAX_FILE_BYTES,
  NATIVE_CAUSAL_DEBUG_WATCH_MAX_INTERVAL_MS,
  NATIVE_CAUSAL_TRACE_MAX_FLOW_COUNT,
  captureNativeAndroidCausalDebugSnapshot,
  captureNativeAndroidCausalDebugReport,
  captureNativeAndroidSolidDiagnostics,
  captureNativeIosCausalDebugSnapshot,
  captureNativeIosCausalDebugReport,
  captureNativeIosSolidDiagnostics,
  NATIVE_STACK_MAX_FRAMES,
  NATIVE_STACK_MAX_INPUT_BYTES,
  NATIVE_STACK_MAX_INPUT_CHUNKS,
  NATIVE_STACK_MAX_LINES,
  NATIVE_STACK_MAX_METHOD_NAME_CHARACTERS,
  NATIVE_STACK_MAX_SKIPPED_FRAMES,
  NATIVE_SYMBOLICATION_MAX_LOCATIONS,
  compareNativeCausalDebugFiles,
  compareNativeCausalDebugSnapshots,
  createNativeCausalTrace,
  createNativeCausalTraceFile,
  createNativeCausalTraceStream,
  createNativeCausalDebugReport,
  createNativeCausalDebugReportFile,
  createNativeCausalDebugReportStream,
  formatNativeCausalDebugComparison,
  formatNativeCausalDebugInspection,
  formatNativeSolidDiagnosticsInspection,
  formatNativeSourceLocationSymbolication,
  formatNativeStackTraceSymbolication,
  inspectNativeCausalDebugFile,
  inspectNativeCausalDebugSnapshot,
  inspectNativeCausalDebugStream,
  inspectNativeSolidDiagnostics,
  inspectNativeSolidDiagnosticsFile,
  parseNativeStackTrace,
  parseNativeSolidDiagnosticsControlBytes,
  parseNativeSolidDiagnosticsDebugBytes,
  symbolicateNativeStackTrace,
  symbolicateNativeStackTraceFile,
  symbolicateNativeStackTraceStream,
  symbolicateNativeSourceLocations,
  watchNativeCausalDebugSnapshots,
  writeNativeCausalDebugReportFile,
} from "../dist/index.js";

const execFileAsync = promisify(execFile);

function runCLIWithInput(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      new URL("../dist/bin.js", import.meta.url).pathname,
      ...args,
    ]);
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
    child.stdin.end(input);
  });
}

function operation({
  operationId,
  name,
  causes = [],
  startedAt,
  startAttributes = {},
  finishedAt,
  duration,
  status,
  finishAttributes,
}) {
  return {
    operationId,
    name,
    causes,
    startedAt,
    startAttributes,
    ...(finishedAt === undefined ? {} : { finishedAt }),
    ...(duration === undefined ? {} : { duration }),
    ...(status === undefined ? {} : { status }),
    ...(finishAttributes === undefined ? {} : { finishAttributes }),
  };
}

function snapshot() {
  return {
    kind: "solid-native.causal-debug-snapshot",
    schemaVersion: 0,
    capturedAt: 1_700_000_000_100,
    operations: [
      operation({
        operationId: "event-1",
        name: "solid-native.event",
        causes: ["evicted-input"],
        startedAt: 1_700_000_000_000,
        startAttributes: {
          "event.name": "platform.network.chunk",
          private: "do-not-print-by-default",
        },
        finishedAt: 1_700_000_000_001,
        duration: 1,
        status: "ok",
        finishAttributes: {},
      }),
      operation({
        operationId: "computation-1",
        name: "solid-native.computation",
        causes: ["event-1"],
        startedAt: 1_700_000_000_002,
        startAttributes: { "computation.name": "assistant.output" },
        finishedAt: 1_700_000_000_003,
        duration: 1,
        status: "ok",
        finishAttributes: {},
      }),
      operation({
        operationId: "commit-1",
        name: "solid-native.commit",
        causes: ["computation-1"],
        startedAt: 1_700_000_000_004,
        startAttributes: { "commit.sequence": 2 },
        finishedAt: 1_700_000_000_006,
        duration: 2,
        status: "ok",
        finishAttributes: { "commit.mutation_count": 1 },
      }),
      operation({
        operationId: "frame-1",
        name: "solid-native.frame",
        causes: ["commit-1"],
        startedAt: 1_700_000_000_010,
        startAttributes: {},
      }),
    ],
    activeOperationCount: 1,
    evictedOperationCount: 1,
    discardedRecordCount: 2,
  };
}

function solidDiagnosticsArtifact() {
  return {
    schemaVersion: 0,
    kind: "solid-native.solid-diagnostics-debug",
    capturedAt: "2026-08-27T00:00:00.000Z",
    durationMilliseconds: 25,
    truncated: false,
    droppedDiagnostics: 0,
    diagnostics: [
      {
        sequence: 1,
        code: "HOT_SCOPE_TIME",
        kind: "perf",
        severity: "warn",
        nodeName: "results",
      },
      {
        sequence: 2,
        code: "HOT_SCOPE_TIME",
        kind: "perf",
        severity: "error",
      },
    ],
    reruns: [
      {
        run: 1,
        nodeRuns: 1,
        nodeKind: "memo",
        nodeName: "results",
        causes: [
          {
            sequence: 1,
            kind: "derived",
            name: "query",
            causes: [{ sequence: 2, kind: "write", name: "input" }],
          },
        ],
        dependencyCount: 1,
        dependenciesAdded: ["input"],
        dependenciesRemoved: [],
        selfMilliseconds: 3,
        totalMilliseconds: 4,
        changed: false,
        phase: "plain",
        held: false,
      },
    ],
    scopeCosts: [
      {
        name: "secondary",
        kind: "effect",
        runs: 1,
        selfMilliseconds: 1,
        wastedMilliseconds: 0,
        overlayMilliseconds: 0,
      },
      {
        name: "results",
        kind: "memo",
        runs: 2,
        selfMilliseconds: 3,
        wastedMilliseconds: 3,
        overlayMilliseconds: 0,
      },
    ],
    writeCosts: [
      { name: "secondary", runs: 1, downstreamMilliseconds: 0.5 },
      { name: "input", runs: 2, downstreamMilliseconds: 4 },
    ],
  };
}

function reportPayload(report) {
  const match = /<div id="report-data" hidden>([A-Za-z0-9+/=]+)<\/div>/u.exec(
    report,
  );
  assert.notEqual(match, null);
  return JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
}

function androidCommandResult({
  exitCode = 0,
  stdout = "",
  stderr = "",
  timedOut = false,
} = {}) {
  return {
    exitCode,
    stdout: Buffer.from(stdout),
    stderr: Buffer.from(stderr),
    timedOut,
  };
}

test("watches one-shot causal snapshots sequentially at a bounded cadence", async () => {
  const events = [];
  let activeCaptureCount = 0;
  let captureCount = 0;
  const result = await watchNativeCausalDebugSnapshots({
    count: 2,
    intervalMs: 250,
    capture: async () => {
      activeCaptureCount += 1;
      assert.equal(activeCaptureCount, 1);
      events.push(`capture-${captureCount}`);
      captureCount += 1;
      await Promise.resolve();
      activeCaptureCount -= 1;
      return snapshot();
    },
    onSnapshot: async (_value, index) => {
      assert.equal(activeCaptureCount, 0);
      events.push(`snapshot-${index}`);
    },
    dependencies: {
      wait: async (milliseconds) => {
        events.push(`wait-${milliseconds}`);
      },
    },
  });

  assert.deepEqual(events, [
    "capture-0",
    "snapshot-0",
    "wait-250",
    "capture-1",
    "snapshot-1",
  ]);
  assert.deepEqual(result, {
    capturedSnapshotCount: 2,
    captureFailureCount: 0,
    interrupted: false,
  });
  assert.ok(Object.isFrozen(result));
});

test("causal watch resets its consecutive capture-failure budget", async () => {
  const outcomes = [
    new Error("first"),
    snapshot(),
    new Error("second"),
    snapshot(),
  ];
  const failures = [];
  let index = 0;
  let waitCount = 0;
  const result = await watchNativeCausalDebugSnapshots({
    count: 2,
    maxConsecutiveFailures: 2,
    capture: async () => {
      const outcome = outcomes[index++];
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
    onSnapshot: () => {},
    onCaptureError: (error, consecutiveFailureCount) => {
      failures.push([error.message, consecutiveFailureCount]);
    },
    dependencies: {
      wait: async () => {
        waitCount += 1;
      },
    },
  });

  assert.deepEqual(failures, [
    ["first", 1],
    ["second", 1],
  ]);
  assert.equal(waitCount, 3);
  assert.deepEqual(result, {
    capturedSnapshotCount: 2,
    captureFailureCount: 2,
    interrupted: false,
  });
});

test("causal watch stops cleanly and never waits after interruption", async () => {
  let keepWatching = true;
  let waitCount = 0;
  const result = await watchNativeCausalDebugSnapshots({
    capture: async () => snapshot(),
    onSnapshot: () => {
      keepWatching = false;
    },
    shouldContinue: () => keepWatching,
    dependencies: {
      wait: async () => {
        waitCount += 1;
      },
    },
  });

  assert.deepEqual(result, {
    capturedSnapshotCount: 1,
    captureFailureCount: 0,
    interrupted: true,
  });
  assert.equal(waitCount, 0);
});

test("causal watch stops at its bounded consecutive failure budget", async () => {
  const captureError = new Error("device unavailable");
  let failureObserverCount = 0;
  let waitCount = 0;
  await assert.rejects(
    watchNativeCausalDebugSnapshots({
      capture: async () => {
        throw captureError;
      },
      onSnapshot: () => {},
      onCaptureError: () => {
        failureObserverCount += 1;
        throw new Error("observer failure must remain isolated");
      },
      maxConsecutiveFailures: 2,
      dependencies: {
        wait: async () => {
          waitCount += 1;
        },
      },
    }),
    (error) => error === captureError,
  );
  assert.equal(failureObserverCount, 2);
  assert.equal(waitCount, 1);
});

test("causal watch validates resource bounds before capture", async () => {
  await assert.rejects(
    watchNativeCausalDebugSnapshots({
      capture: async () => snapshot(),
      onSnapshot: () => {},
      intervalMs: NATIVE_CAUSAL_DEBUG_WATCH_MAX_INTERVAL_MS + 1,
    }),
    /interval must be a safe integer/u,
  );
  await assert.rejects(
    watchNativeCausalDebugSnapshots({
      capture: async () => snapshot(),
      onSnapshot: () => {},
      count: 0,
    }),
    /snapshot count must be a safe integer/u,
  );
  await assert.rejects(
    watchNativeCausalDebugSnapshots({
      capture: async () => snapshot(),
      onSnapshot: () => {},
      maxConsecutiveFailures: 0,
    }),
    /maximum consecutive failures must be a safe integer/u,
  );
  await assert.rejects(
    watchNativeCausalDebugSnapshots({
      capture: async () => ({ unexpected: true }),
      onSnapshot: () => {
        assert.fail("an invalid snapshot must not reach the observer");
      },
      maxConsecutiveFailures: 1,
    }),
    /snapshot contains unknown field/u,
  );
});

test("watches Android snapshots through the public CLI as safe NDJSON", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "solid-native-watch-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const adbPath = path.join(directory, "adb");
  const logPath = path.join(directory, "adb.log");
  await writeFile(
    adbPath,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$SOLID_NATIVE_TEST_ADB_LOG"
case "$*" in
  *" get-state") printf 'device\\n' ;;
  *" run-as dev.solidnative.demo pwd") printf '/data/user/0/dev.solidnative.demo\\n' ;;
  *" am get-current-user") printf '0\\n' ;;
  *" am broadcast "*) printf 'Broadcast completed: result=0\\n' ;;
  *" cat cache/solid-native-debug/"*) printf '%s\\n' "$SOLID_NATIVE_TEST_SNAPSHOT" ;;
  *" rm -f cache/solid-native-debug/"*) ;;
  *) printf 'unexpected fake adb command\\n' >&2; exit 1 ;;
esac
`,
  );
  await chmod(adbPath, 0o700);

  const environment = {
    ...process.env,
    PATH: `${directory}:${process.env.PATH ?? ""}`,
    SOLID_NATIVE_TEST_ADB_LOG: logPath,
    SOLID_NATIVE_TEST_SNAPSHOT: JSON.stringify(snapshot()),
  };
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [
      new URL("../dist/bin.js", import.meta.url).pathname,
      "debug",
      "watch-android",
      "dev.solidnative.demo",
      "--serial",
      "pixel-test",
      "--count",
      "2",
      "--interval",
      "100",
      "--json",
    ],
    {
      env: environment,
      timeout: 5_000,
    },
  );

  const inspections = stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(stderr, "");
  assert.equal(inspections.length, 2);
  assert.equal(inspections[0].kind, "solid-native.causal-debug-inspection");
  assert.equal(inspections[1].operationCount, 4);
  assert.equal(stdout.includes("do-not-print-by-default"), false);
  const commands = (await readFile(logPath, "utf8")).trim().split("\n");
  assert.equal(
    commands.filter((command) => command.includes(" broadcast ")).length,
    2,
  );
  assert.equal(
    commands.filter((command) => command.includes(" cat cache/")).length,
    2,
  );
  assert.equal(
    commands.filter((command) => command.includes(" rm -f cache/")).length,
    2,
  );

  const interrupted = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        new URL("../dist/bin.js", import.meta.url).pathname,
        "debug",
        "watch-android",
        "dev.solidnative.demo",
        "--serial",
        "pixel-test",
        "--interval",
        "30000",
        "--json",
      ],
      { env: environment },
    );
    const output = [];
    const errors = [];
    let signalled = false;
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("watch CLI did not stop promptly after SIGINT"));
    }, 2_000);
    child.stdout.on("data", (chunk) => {
      output.push(chunk);
      if (!signalled) {
        signalled = true;
        child.kill("SIGINT");
      }
    });
    child.stderr.on("data", (chunk) => errors.push(chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({
        code,
        signal,
        stdout: Buffer.concat(output).toString("utf8"),
        stderr: Buffer.concat(errors).toString("utf8"),
      });
    });
  });
  assert.equal(interrupted.code, 0);
  assert.equal(interrupted.signal, null);
  assert.equal(interrupted.stderr, "");
  assert.equal(interrupted.stdout.trim().split("\n").length, 1);
});

test("rejects invalid watch-only CLI options before device access", async () => {
  const invalidCount = await runCLIWithInput(
    [
      "debug",
      "watch-android",
      "dev.solidnative.demo",
      "--serial",
      "pixel-test",
      "--count",
      "0",
    ],
    "",
  );
  assert.equal(invalidCount.code, 2);
  assert.match(
    invalidCount.stderr,
    /--count requires a positive safe integer/u,
  );

  const captureInterval = await runCLIWithInput(
    [
      "debug",
      "capture-android",
      "dev.solidnative.demo",
      "--serial",
      "pixel-test",
      "--interval",
      "100",
    ],
    "",
  );
  assert.equal(captureInterval.code, 2);
  assert.match(captureInterval.stderr, /does not support --interval/u);
});

test("exposes live device reports and validates them before device access", async () => {
  const help = await execFileAsync(process.execPath, [
    new URL("../dist/bin.js", import.meta.url).pathname,
    "debug",
    "--help",
  ]);
  assert.match(help.stdout, /debug report-android PACKAGE --serial ID/u);
  assert.match(help.stdout, /debug report-ios BUNDLE --device ID/u);
  assert.match(help.stdout, /complete live workflow in one\s+command/u);

  const missingSerial = await runCLIWithInput(
    ["debug", "report-android", "dev.solidnative.demo"],
    "",
  );
  assert.equal(missingSerial.code, 2);
  assert.match(missingSerial.stderr, /report-android requires --serial/u);

  const redundantJson = await runCLIWithInput(
    [
      "debug",
      "report-ios",
      "dev.solidnative.demo",
      "--device",
      "device-1",
      "--json",
    ],
    "",
  );
  assert.equal(redundantJson.code, 2);
  assert.match(redundantJson.stderr, /always emits HTML/u);
});

test("captures one nonce-bound snapshot from a debuggable Android app", async () => {
  const commands = [];
  let readAttempts = 0;
  let now = 1_000;
  const value = await captureNativeAndroidCausalDebugSnapshot({
    packageName: "dev.solidnative.demo",
    serial: "pixel-1",
    timeoutMs: 500,
    dependencies: {
      createRequestId: () => "0123456789abcdef0123456789abcdef",
      now: () => now,
      wait: async (milliseconds) => {
        now += milliseconds;
      },
      runCommand: async (command, args, options) => {
        commands.push({ command, args, options });
        if (args.at(-1) === "get-state") {
          return androidCommandResult({ stdout: "device\n" });
        }
        if (args.at(-1) === "pwd") {
          return androidCommandResult({
            stdout: "/data/user/0/dev.solidnative.demo\n",
          });
        }
        if (args.at(-1) === "get-current-user") {
          return androidCommandResult({ stdout: "0\n" });
        }
        if (args.includes("broadcast")) {
          return androidCommandResult({
            stdout: "Broadcast completed: result=0\n",
          });
        }
        if (args.includes("cat")) {
          readAttempts += 1;
          return readAttempts === 1
            ? androidCommandResult({ exitCode: 1, stderr: "missing" })
            : androidCommandResult({ stdout: JSON.stringify(snapshot()) });
        }
        if (args.includes("rm")) return androidCommandResult();
        throw new Error(`Unexpected adb command ${args.join(" ")}`);
      },
    },
  });

  assert.equal(value.kind, "solid-native.causal-debug-snapshot");
  assert.ok(Object.isFrozen(value));
  assert.equal(readAttempts, 2);
  assert.deepEqual(commands[0].args, ["-s", "pixel-1", "get-state"]);
  const broadcast = commands.find(({ args }) => args.includes("broadcast"));
  assert.deepEqual(broadcast.args, [
    "-s",
    "pixel-1",
    "shell",
    "run-as",
    "dev.solidnative.demo",
    "am",
    "broadcast",
    "--user",
    "0",
    "-a",
    "dev.solidnative.demo.solidnative.DEBUG_SNAPSHOT_REQUEST",
    "--es",
    "requestId",
    "0123456789abcdef0123456789abcdef",
    "--es",
    "operation",
    "causal-snapshot",
    "-p",
    "dev.solidnative.demo",
  ]);
  const cleanup = commands.at(-1);
  assert.deepEqual(cleanup.args.slice(-4), [
    "dev.solidnative.demo",
    "rm",
    "-f",
    "cache/solid-native-debug/0123456789abcdef0123456789abcdef.json",
  ]);
});

test("captures one timed value-free Solid diagnostics window on Android", async () => {
  const commands = [];
  const waits = [];
  const requestIds = [
    "0123456789abcdef0123456789abcdef",
    "fedcba9876543210fedcba9876543210",
  ];
  let operation;
  const diagnostics = await captureNativeAndroidSolidDiagnostics({
    packageName: "dev.solidnative.demo",
    serial: "pixel-1",
    durationMs: 25,
    timeoutMs: 500,
    dependencies: {
      createRequestId: () => requestIds.shift(),
      now: () => 1_000,
      wait: async (milliseconds) => {
        waits.push(milliseconds);
      },
      runCommand: async (command, args, options) => {
        commands.push({ command, args, options });
        if (args.at(-1) === "get-state") {
          return androidCommandResult({ stdout: "device\n" });
        }
        if (args.at(-1) === "pwd") {
          return androidCommandResult({
            stdout: "/data/user/0/dev.solidnative.demo\n",
          });
        }
        if (args.at(-1) === "get-current-user") {
          return androidCommandResult({ stdout: "0\n" });
        }
        if (args.includes("broadcast")) {
          operation = args[args.indexOf("operation") + 1];
          return androidCommandResult({
            stdout: "Broadcast completed: result=0\n",
          });
        }
        if (args.includes("cat")) {
          if (operation === "solid-diagnostics-begin") {
            return androidCommandResult({
              stdout: JSON.stringify({
                schemaVersion: 0,
                kind: "solid-native.solid-diagnostics-debug-control",
                operation,
                ok: true,
                active: true,
              }),
            });
          }
          return androidCommandResult({
            stdout: JSON.stringify({
              schemaVersion: 0,
              kind: "solid-native.solid-diagnostics-debug",
              capturedAt: "2026-08-27T00:00:00.000Z",
              durationMilliseconds: 25,
              truncated: false,
              droppedDiagnostics: 0,
              diagnostics: [],
              reruns: [],
              scopeCosts: [],
              writeCosts: [],
            }),
          });
        }
        if (args.includes("rm")) return androidCommandResult();
        throw new Error(`Unexpected adb command ${args.join(" ")}`);
      },
    },
  });

  assert.equal(diagnostics.kind, "solid-native.solid-diagnostics-debug");
  assert.equal(diagnostics.durationMilliseconds, 25);
  assert.deepEqual(waits, [25]);
  assert.deepEqual(
    commands
      .filter(({ args }) => args.includes("broadcast"))
      .map(({ args }) => args[args.indexOf("operation") + 1]),
    ["solid-diagnostics-begin", "solid-diagnostics-end"],
  );
  const endBroadcast = commands
    .filter(({ args }) => args.includes("broadcast"))
    .find(
      ({ args }) =>
        args[args.indexOf("operation") + 1] === "solid-diagnostics-end",
    );
  assert.equal(
    endBroadcast.args[endBroadcast.args.indexOf("sessionId") + 1],
    "0123456789abcdef0123456789abcdef",
  );
  assert.equal(commands.filter(({ args }) => args.includes("rm")).length, 2);
});

test("ends only its nonce-bound diagnostics session after a malformed begin response", async () => {
  const broadcasts = [];
  const requestIds = [
    "0123456789abcdef0123456789abcdef",
    "fedcba9876543210fedcba9876543210",
  ];
  let operation;
  await assert.rejects(
    captureNativeAndroidSolidDiagnostics({
      packageName: "dev.solidnative.demo",
      serial: "pixel-1",
      durationMs: 25,
      dependencies: {
        createRequestId: () => requestIds.shift(),
        now: () => 1_000,
        wait: async () => {},
        runCommand: async (_command, args) => {
          if (args.at(-1) === "get-state") {
            return androidCommandResult({ stdout: "device\n" });
          }
          if (args.at(-1) === "pwd") return androidCommandResult();
          if (args.at(-1) === "get-current-user") {
            return androidCommandResult({ stdout: "0\n" });
          }
          if (args.includes("broadcast")) {
            operation = args[args.indexOf("operation") + 1];
            broadcasts.push(args);
            return androidCommandResult();
          }
          if (args.includes("cat")) {
            return androidCommandResult({
              stdout:
                operation === "solid-diagnostics-begin"
                  ? "not-json"
                  : JSON.stringify({
                      schemaVersion: 0,
                      kind: "solid-native.solid-diagnostics-debug-control",
                      operation,
                      ok: false,
                      active: false,
                      error: "invalid-state",
                    }),
            });
          }
          if (args.includes("rm")) return androidCommandResult();
          throw new Error(`Unexpected adb command ${args.join(" ")}`);
        },
      },
    }),
    /must be valid JSON/u,
  );

  assert.equal(broadcasts.length, 2);
  assert.equal(
    broadcasts[1][broadcasts[1].indexOf("sessionId") + 1],
    "0123456789abcdef0123456789abcdef",
  );
});

test("strictly validates detached Solid diagnostics responses", () => {
  assert.throws(
    () =>
      parseNativeSolidDiagnosticsControlBytes(
        Buffer.from(
          JSON.stringify({
            schemaVersion: 0,
            kind: "solid-native.solid-diagnostics-debug-control",
            operation: "solid-diagnostics-end",
            ok: true,
            active: false,
          }),
        ),
        "solid-diagnostics-begin",
      ),
    /operation does not match/u,
  );
  assert.throws(
    () =>
      parseNativeSolidDiagnosticsControlBytes(
        Buffer.from(
          JSON.stringify({
            schemaVersion: 0,
            kind: "solid-native.solid-diagnostics-debug-control",
            operation: "solid-diagnostics-begin",
            ok: false,
            active: false,
          }),
        ),
        "solid-diagnostics-begin",
      ),
    /outcome is inconsistent/u,
  );
  assert.throws(
    () =>
      parseNativeSolidDiagnosticsDebugBytes(
        Buffer.from(
          JSON.stringify({
            schemaVersion: 0,
            kind: "solid-native.solid-diagnostics-debug",
            capturedAt: "2026-08-27T00:00:00.000Z",
            durationMilliseconds: 1,
            truncated: false,
            droppedDiagnostics: 0,
            diagnostics: [],
            reruns: [],
            scopeCosts: [],
            writeCosts: [],
            privateValue: "must-not-cross-boundary",
          }),
        ),
      ),
    /unknown property/u,
  );
});

test("summarizes a value-free Solid diagnostics artifact deterministically", () => {
  const inspection = inspectNativeSolidDiagnostics(solidDiagnosticsArtifact());

  assert.equal(inspection.diagnosticCount, 2);
  assert.deepEqual(inspection.diagnosticCodeCounts, { HOT_SCOPE_TIME: 2 });
  assert.equal(inspection.warnDiagnosticCount, 1);
  assert.equal(inspection.errorDiagnosticCount, 1);
  assert.equal(inspection.rerunCount, 1);
  assert.equal(inspection.changedRerunCount, 0);
  assert.equal(inspection.unchangedRerunCount, 1);
  assert.equal(inspection.causeCount, 2);
  assert.equal(inspection.totalScopeRuns, 3);
  assert.equal(inspection.totalScopeSelfMilliseconds, 4);
  assert.equal(inspection.totalWastedMilliseconds, 3);
  assert.equal(inspection.totalDownstreamMilliseconds, 4.5);
  assert.deepEqual(
    inspection.hottestScopes.map(({ name }) => name),
    ["results", "secondary"],
  );
  assert.deepEqual(
    inspection.hottestWrites.map(({ name }) => name),
    ["input", "secondary"],
  );
  assert.equal(Object.isFrozen(inspection), true);
  assert.match(
    formatNativeSolidDiagnosticsInspection(inspection),
    /HOT_SCOPE_TIME: 2[\s\S]*results: 3\.000 ms self/u,
  );
});

test("inspects bounded Solid diagnostics files and CLI stdin", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "solid-native-diag-"));
  const artifactPath = path.join(directory, "artifact.json");
  try {
    await writeFile(artifactPath, JSON.stringify(solidDiagnosticsArtifact()));
    const inspection = await inspectNativeSolidDiagnosticsFile({
      artifactPath,
    });
    assert.equal(
      inspection.kind,
      "solid-native.solid-diagnostics-debug-inspection",
    );

    const cli = await runCLIWithInput(
      ["debug", "diagnostics-inspect", "-", "--json"],
      JSON.stringify(solidDiagnosticsArtifact()),
    );
    assert.equal(cli.code, 0);
    assert.equal(JSON.parse(cli.stdout).diagnosticCount, 2);
    assert.equal(cli.stderr, "");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("bounds Android capture and always cleans a timed-out response", async () => {
  const commands = [];
  let now = 100;
  await assert.rejects(
    captureNativeAndroidCausalDebugSnapshot({
      packageName: "dev.solidnative.demo",
      serial: "pixel-1",
      timeoutMs: 50,
      dependencies: {
        createRequestId: () => "fedcba9876543210fedcba9876543210",
        now: () => now,
        wait: async (milliseconds) => {
          now += milliseconds;
        },
        runCommand: async (_command, args) => {
          commands.push(args);
          if (args.at(-1) === "get-state") {
            return androidCommandResult({ stdout: "device" });
          }
          if (args.at(-1) === "pwd" || args.includes("broadcast")) {
            return androidCommandResult();
          }
          if (args.at(-1) === "get-current-user") {
            return androidCommandResult({ stdout: "0" });
          }
          if (args.includes("cat")) {
            return androidCommandResult({ exitCode: 1 });
          }
          return androidCommandResult();
        },
      },
    }),
    /did not publish.*within 50 milliseconds/u,
  );
  assert.equal(commands.at(-1).includes("rm"), true);

  await assert.rejects(
    captureNativeAndroidCausalDebugSnapshot({
      packageName: "not-a-package",
      serial: "pixel-1",
    }),
    /application ID is invalid/u,
  );
});

test("captures and acknowledges one nonce-bound snapshot from an iOS app container", async () => {
  const commands = [];
  let copyAttempts = 0;
  let now = 2_000;
  const value = await captureNativeIosCausalDebugSnapshot({
    bundleIdentifier: "dev.solidnative.demo",
    device: "00008150-001155E01191401C",
    timeoutMs: 5_000,
    dependencies: {
      createRequestId: () => "0123456789abcdef0123456789abcdef",
      now: () => now,
      wait: async (milliseconds) => {
        now += milliseconds;
      },
      runCommand: async (command, args, options) => {
        commands.push({ command, args, options });
        if (args.includes("copy")) {
          copyAttempts += 1;
          if (copyAttempts === 1) {
            return androidCommandResult({ exitCode: 1, stderr: "missing" });
          }
          const destination = args[args.indexOf("--destination") + 1];
          await writeFile(destination, JSON.stringify(snapshot()));
        }
        if (!args.includes("copy") || copyAttempts > 1) {
          const resultPath = args[args.indexOf("--json-output") + 1];
          await writeFile(
            resultPath,
            JSON.stringify({ info: { outcome: "success" } }),
          );
        }
        return androidCommandResult();
      },
    },
  });

  assert.equal(value.kind, "solid-native.causal-debug-snapshot");
  assert.ok(Object.isFrozen(value));
  assert.equal(copyAttempts, 2);
  assert.equal(
    commands.every(({ command }) => command === "xcrun"),
    true,
  );
  const launches = commands.filter(({ args }) => args.includes("launch"));
  assert.equal(launches.length, 2);
  assert.ok(
    launches[0].args.includes(
      "solid-native-debug://capture?requestId=0123456789abcdef0123456789abcdef&operation=causal-snapshot",
    ),
  );
  assert.ok(
    launches[1].args.includes(
      "solid-native-debug://ack?requestId=0123456789abcdef0123456789abcdef",
    ),
  );
  const copy = commands.find(({ args }) => args.includes("copy"));
  assert.deepEqual(
    copy.args.slice(
      copy.args.indexOf("--source"),
      copy.args.indexOf("--destination"),
    ),
    [
      "--source",
      "Library/Caches/solid-native-debug/0123456789abcdef0123456789abcdef.json",
    ],
  );
  assert.equal(copy.args.includes("appDataContainer"), true);
  assert.equal(copy.args.includes("dev.solidnative.demo"), true);
});

test("captures one timed nonce-bound Solid diagnostics window on iOS", async () => {
  const commands = [];
  const waits = [];
  const requestIds = [
    "0123456789abcdef0123456789abcdef",
    "fedcba9876543210fedcba9876543210",
  ];
  let operation;
  const diagnostics = await captureNativeIosSolidDiagnostics({
    bundleIdentifier: "dev.solidnative.demo",
    device: "00008150-001155E01191401C",
    durationMs: 25,
    timeoutMs: 5_000,
    dependencies: {
      createRequestId: () => requestIds.shift(),
      now: () => 2_000,
      wait: async (milliseconds) => {
        waits.push(milliseconds);
      },
      runCommand: async (command, args, options) => {
        commands.push({ command, args, options });
        if (args.includes("launch")) {
          const payload = args[args.indexOf("--payload-url") + 1];
          if (payload.startsWith("solid-native-debug://capture")) {
            operation = new URL(payload).searchParams.get("operation");
          }
        }
        if (args.includes("copy")) {
          const destination = args[args.indexOf("--destination") + 1];
          await writeFile(
            destination,
            JSON.stringify(
              operation === "solid-diagnostics-begin"
                ? {
                    schemaVersion: 0,
                    kind: "solid-native.solid-diagnostics-debug-control",
                    operation,
                    ok: true,
                    active: true,
                  }
                : {
                    schemaVersion: 0,
                    kind: "solid-native.solid-diagnostics-debug",
                    capturedAt: "2026-08-27T00:00:00.000Z",
                    durationMilliseconds: 25,
                    truncated: false,
                    droppedDiagnostics: 0,
                    diagnostics: [],
                    reruns: [],
                    scopeCosts: [],
                    writeCosts: [],
                  },
            ),
          );
        }
        const resultPath = args[args.indexOf("--json-output") + 1];
        await writeFile(
          resultPath,
          JSON.stringify({ info: { outcome: "success" } }),
        );
        return androidCommandResult();
      },
    },
  });

  assert.equal(diagnostics.kind, "solid-native.solid-diagnostics-debug");
  assert.deepEqual(waits, [25]);
  const captureUrls = commands
    .filter(({ args }) => args.includes("--payload-url"))
    .map(({ args }) => args[args.indexOf("--payload-url") + 1])
    .filter((url) => url.startsWith("solid-native-debug://capture"));
  assert.equal(captureUrls.length, 2);
  assert.equal(
    new URL(captureUrls[0]).searchParams.get("operation"),
    "solid-diagnostics-begin",
  );
  assert.equal(
    new URL(captureUrls[1]).searchParams.get("operation"),
    "solid-diagnostics-end",
  );
  assert.equal(
    new URL(captureUrls[1]).searchParams.get("sessionId"),
    "0123456789abcdef0123456789abcdef",
  );
  assert.equal(
    commands.filter(({ args }) =>
      args.some((argument) => argument.startsWith("solid-native-debug://ack")),
    ).length,
    2,
  );
});

test("captures and correlates one live Android diagnostics report without intermediate files", async () => {
  const order = [];
  const diagnostics = solidDiagnosticsArtifact();
  diagnostics.capturedAt = "2023-11-14T22:13:20.000Z";
  diagnostics.reruns[0].nodeKind = "effect";
  diagnostics.reruns[0].nodeName = "assistant.output";
  const causalSnapshot = snapshot();
  causalSnapshot.operations[1].startAttributes["computation.kind"] =
    "native-output";
  causalSnapshot.operations.splice(
    3,
    0,
    operation({
      operationId: "mount-1",
      name: "solid-native.mount",
      causes: ["commit-1"],
      startedAt: 1_700_000_000_008,
      finishedAt: 1_700_000_000_009,
      duration: 1,
      status: "ok",
      finishAttributes: {},
    }),
  );
  const frame = causalSnapshot.operations.at(-1);
  frame.causes = ["mount-1"];
  frame.finishedAt = 1_700_000_000_011;
  frame.duration = 1;
  frame.status = "ok";
  frame.finishAttributes = {};
  causalSnapshot.activeOperationCount = 0;

  const report = await captureNativeAndroidCausalDebugReport({
    packageName: "dev.solidnative.demo",
    serial: "pixel-1",
    durationMs: 25,
    timeoutMs: 500,
    dependencies: {
      captureDiagnostics: async (options) => {
        order.push(["diagnostics", options]);
        return diagnostics;
      },
      captureSnapshot: async (options) => {
        order.push(["snapshot", options]);
        return causalSnapshot;
      },
    },
  });

  assert.deepEqual(order, [
    [
      "diagnostics",
      {
        packageName: "dev.solidnative.demo",
        serial: "pixel-1",
        durationMs: 25,
        timeoutMs: 500,
      },
    ],
    [
      "snapshot",
      {
        packageName: "dev.solidnative.demo",
        serial: "pixel-1",
        timeoutMs: 500,
      },
    ],
  ]);
  const payload = reportPayload(report);
  assert.equal(payload.diagnosticsCorrelation.correlatedOutputCount, 1);
  assert.equal(payload.diagnosticsCorrelation.completeOutputCount, 1);
  assert.equal(payload.diagnosticsCorrelation.exactPerRerunJoin, false);
  assert.deepEqual(
    payload.diagnosticsCorrelation.outputs[0].nativeFrameOperationIds,
    ["frame-1"],
  );
  assert.equal(payload.operations[0].attributes, undefined);
  assert.doesNotMatch(report, /do-not-print-by-default/u);
});

test("uses the same ordered live-report workflow on iOS and preserves explicit disclosure", async () => {
  const order = [];
  const diagnostics = solidDiagnosticsArtifact();
  diagnostics.capturedAt = "2023-11-14T22:13:20.000Z";
  const causalSnapshot = snapshot();
  const report = await captureNativeIosCausalDebugReport({
    bundleIdentifier: "dev.solidnative.demo",
    device: "00008150-001155E01191401C",
    durationMs: 50,
    timeoutMs: 5_000,
    includeAttributes: true,
    dependencies: {
      captureDiagnostics: async (options) => {
        order.push(["diagnostics", options]);
        return diagnostics;
      },
      captureSnapshot: async (options) => {
        order.push(["snapshot", options]);
        return causalSnapshot;
      },
    },
  });

  assert.deepEqual(
    order.map(([name]) => name),
    ["diagnostics", "snapshot"],
  );
  assert.deepEqual(order[0][1], {
    bundleIdentifier: "dev.solidnative.demo",
    device: "00008150-001155E01191401C",
    durationMs: 50,
    timeoutMs: 5_000,
  });
  assert.deepEqual(order[1][1], {
    bundleIdentifier: "dev.solidnative.demo",
    device: "00008150-001155E01191401C",
    timeoutMs: 5_000,
  });
  assert.equal(
    reportPayload(report).operations[0].attributes.start.private,
    "do-not-print-by-default",
  );
  assert.doesNotMatch(report, /do-not-print-by-default/u);
});

test("does not request a causal snapshot after a live diagnostics failure", async () => {
  let snapshotRequested = false;
  await assert.rejects(
    captureNativeAndroidCausalDebugReport({
      packageName: "dev.solidnative.demo",
      serial: "pixel-1",
      dependencies: {
        captureDiagnostics: async () => {
          throw new Error("diagnostics unavailable");
        },
        captureSnapshot: async () => {
          snapshotRequested = true;
          return snapshot();
        },
      },
    }),
    /diagnostics unavailable/u,
  );
  assert.equal(snapshotRequested, false);
});

test("ends only its nonce-bound iOS diagnostics session after a malformed begin response", async () => {
  const captureUrls = [];
  const requestIds = [
    "0123456789abcdef0123456789abcdef",
    "fedcba9876543210fedcba9876543210",
  ];
  let operation;
  await assert.rejects(
    captureNativeIosSolidDiagnostics({
      bundleIdentifier: "dev.solidnative.demo",
      device: "00008150-001155E01191401C",
      durationMs: 25,
      dependencies: {
        createRequestId: () => requestIds.shift(),
        now: () => 2_000,
        wait: async () => {},
        runCommand: async (_command, args) => {
          if (args.includes("launch")) {
            const payload = args[args.indexOf("--payload-url") + 1];
            if (payload.startsWith("solid-native-debug://capture")) {
              captureUrls.push(payload);
              operation = new URL(payload).searchParams.get("operation");
            }
          }
          if (args.includes("copy")) {
            const destination = args[args.indexOf("--destination") + 1];
            await writeFile(
              destination,
              operation === "solid-diagnostics-begin"
                ? "not-json"
                : JSON.stringify({
                    schemaVersion: 0,
                    kind: "solid-native.solid-diagnostics-debug-control",
                    operation,
                    ok: false,
                    active: false,
                    error: "invalid-state",
                  }),
            );
          }
          const resultPath = args[args.indexOf("--json-output") + 1];
          await writeFile(
            resultPath,
            JSON.stringify({ info: { outcome: "success" } }),
          );
          return androidCommandResult();
        },
      },
    }),
    /must be valid JSON/u,
  );

  assert.equal(captureUrls.length, 2);
  assert.equal(
    new URL(captureUrls[1]).searchParams.get("sessionId"),
    "0123456789abcdef0123456789abcdef",
  );
});

test("bounds iOS capture and acknowledges timed-out requests", async () => {
  const commands = [];
  let now = 100;
  await assert.rejects(
    captureNativeIosCausalDebugSnapshot({
      bundleIdentifier: "dev.solidnative.demo",
      device: "iphone-1",
      timeoutMs: 5_000,
      dependencies: {
        createRequestId: () => "fedcba9876543210fedcba9876543210",
        now: () => now,
        wait: async (milliseconds) => {
          now += milliseconds;
        },
        runCommand: async (_command, args) => {
          commands.push(args);
          if (args.includes("copy")) {
            return androidCommandResult({ exitCode: 1 });
          }
          const resultPath = args[args.indexOf("--json-output") + 1];
          await writeFile(
            resultPath,
            JSON.stringify({ info: { outcome: "success" } }),
          );
          return androidCommandResult();
        },
      },
    }),
    /did not publish.*within 5000 milliseconds/u,
  );
  assert.ok(
    commands
      .at(-1)
      .includes(
        "solid-native-debug://ack?requestId=fedcba9876543210fedcba9876543210",
      ),
  );

  await assert.rejects(
    captureNativeIosCausalDebugSnapshot({
      bundleIdentifier: "not-a-bundle",
      device: "iphone-1",
    }),
    /bundle identifier is invalid/u,
  );

  await assert.rejects(
    captureNativeIosCausalDebugSnapshot({
      bundleIdentifier: "dev.solidnative.demo",
      device: "iphone-1",
      timeoutMs: 4_999,
    }),
    /from 5000 through 30000 milliseconds/u,
  );
});

test("does not report a captured iOS snapshot when acknowledgement fails", async () => {
  let launchCount = 0;
  await assert.rejects(
    captureNativeIosCausalDebugSnapshot({
      bundleIdentifier: "dev.solidnative.demo",
      device: "iphone-1",
      dependencies: {
        createRequestId: () => "fedcba9876543210fedcba9876543210",
        runCommand: async (_command, args) => {
          if (args.includes("launch")) {
            launchCount += 1;
            if (launchCount === 2) {
              return androidCommandResult({
                exitCode: 1,
                stderr: "ack unavailable",
              });
            }
          }
          if (args.includes("copy")) {
            const destination = args[args.indexOf("--destination") + 1];
            await writeFile(destination, JSON.stringify(snapshot()));
          }
          const resultPath = args[args.indexOf("--json-output") + 1];
          await writeFile(
            resultPath,
            JSON.stringify({ info: { outcome: "success" } }),
          );
          return androidCommandResult();
        },
      },
    }),
    /snapshot acknowledgement failed: ack unavailable/u,
  );
  assert.equal(launchCount, 2);
});

test("rejects a successful process exit without CoreDevice success", async () => {
  await assert.rejects(
    captureNativeIosCausalDebugSnapshot({
      bundleIdentifier: "dev.solidnative.demo",
      device: "iphone-1",
      dependencies: {
        createRequestId: () => "fedcba9876543210fedcba9876543210",
        runCommand: async (_command, args) => {
          const resultPath = args[args.indexOf("--json-output") + 1];
          await writeFile(
            resultPath,
            JSON.stringify({
              error: { code: 7000 },
              info: { outcome: "failed" },
            }),
          );
          return androidCommandResult();
        },
      },
    }),
    /did not return a successful CoreDevice result/u,
  );
});

test("summarizes a causal snapshot and reconstructs one selected graph", () => {
  const inspection = inspectNativeCausalDebugSnapshot(snapshot(), {
    operationId: "commit-1",
  });

  assert.equal(inspection.kind, "solid-native.causal-debug-inspection");
  assert.equal(inspection.schemaVersion, 1);
  assert.equal(inspection.operationCount, 4);
  assert.equal(inspection.groupCount, 1);
  assert.deepEqual(inspection.statusCounts, {
    active: 1,
    ok: 3,
    error: 0,
    cancelled: 0,
  });
  assert.equal(inspection.operationCounts["solid-native.event"], 1);
  assert.equal(inspection.operationCounts["solid-native.owner"], 0);
  assert.equal(inspection.selection.target.operationId, "commit-1");
  assert.equal(inspection.selection.groupId, "event-1");
  assert.deepEqual(
    inspection.selection.ancestors.map(({ operationId }) => operationId),
    ["event-1", "computation-1"],
  );
  assert.deepEqual(
    inspection.selection.descendants.map(({ operationId }) => operationId),
    ["frame-1"],
  );
  assert.deepEqual(inspection.selection.unresolvedCauseIds, ["evicted-input"]);
  assert.deepEqual(inspection.groups, [
    {
      groupId: "event-1",
      operationIds: ["event-1", "computation-1", "commit-1", "frame-1"],
      operationNames: [
        "solid-native.event",
        "solid-native.computation",
        "solid-native.commit",
        "solid-native.frame",
      ],
      entryOperationIds: ["event-1"],
      terminalOperationIds: ["frame-1"],
      unresolvedCauseIds: ["evicted-input"],
      operationCount: 4,
      activeOperationCount: 1,
      okOperationCount: 3,
      errorOperationCount: 0,
      cancelledOperationCount: 0,
      startedAt: 1_700_000_000_000,
    },
  ]);
  assert.equal(inspection.selection.target.attributes, undefined);
  assert.ok(Object.isFrozen(inspection));
  assert.ok(Object.isFrozen(inspection.selection));
  assert.ok(Object.isFrozen(inspection.selection.ancestors));
  assert.ok(Object.isFrozen(inspection.groups));
  assert.ok(Object.isFrozen(inspection.groups[0]));
  assert.ok(Object.isFrozen(inspection.groups[0].operationIds));

  const formatted = formatNativeCausalDebugInspection(inspection);
  assert.match(formatted, /PASS Solid Native causal debug snapshot/u);
  assert.match(formatted, /2 retained ancestors, 1 retained descendants/u);
  assert.match(formatted, /Groups: 1 retained causal group/u);
  assert.match(formatted, /Selected group: event-1/u);
  assert.doesNotMatch(formatted, /do-not-print-by-default/u);
});

test("summarizes disconnected retained causal groups without attributes", () => {
  const value = snapshot();
  value.operations.push(
    operation({
      operationId: "isolated-owner",
      name: "solid-native.owner",
      startedAt: 1_700_000_000_020,
      startAttributes: { private: "group-secret" },
      finishedAt: 1_700_000_000_023,
      duration: 3,
      status: "error",
      finishAttributes: {},
    }),
  );

  const inspection = inspectNativeCausalDebugSnapshot(value);
  assert.equal(inspection.groupCount, 2);
  assert.deepEqual(
    inspection.groups.map((group) => group.groupId),
    ["event-1", "isolated-owner"],
  );
  assert.deepEqual(inspection.groups[1], {
    groupId: "isolated-owner",
    operationIds: ["isolated-owner"],
    operationNames: ["solid-native.owner"],
    entryOperationIds: ["isolated-owner"],
    terminalOperationIds: ["isolated-owner"],
    unresolvedCauseIds: [],
    operationCount: 1,
    activeOperationCount: 0,
    okOperationCount: 0,
    errorOperationCount: 1,
    cancelledOperationCount: 0,
    startedAt: 1_700_000_000_020,
    finishedAt: 1_700_000_000_023,
    duration: 3,
  });
  assert.equal(JSON.stringify(inspection).includes("group-secret"), false);
});

test("requires an explicit option before exposing custom attributes", () => {
  const hidden = inspectNativeCausalDebugSnapshot(snapshot(), {
    operationId: "event-1",
  });
  assert.equal(
    JSON.stringify(hidden).includes("do-not-print-by-default"),
    false,
  );

  const visible = inspectNativeCausalDebugSnapshot(snapshot(), {
    operationId: "event-1",
    includeAttributes: true,
  });
  assert.equal(
    visible.selection.target.attributes.start.private,
    "do-not-print-by-default",
  );
  assert.match(
    formatNativeCausalDebugInspection(visible),
    /do-not-print-by-default/u,
  );
});

test("compares causal graph quality and explicit p95 regression thresholds", () => {
  const baseline = snapshot();
  const candidate = JSON.parse(JSON.stringify(baseline));
  candidate.operations[0].duration = 3;
  candidate.operations[0].status = "error";
  candidate.operations[2].causes.push("candidate-missing-input");
  candidate.operations[2].duration = 4;
  candidate.evictedOperationCount = 2;
  candidate.discardedRecordCount = 3;

  const comparison = compareNativeCausalDebugSnapshots(baseline, candidate, {
    maxP95RegressionPercent: 50,
  });
  assert.equal(comparison.kind, "solid-native.causal-debug-comparison");
  assert.equal(comparison.schemaVersion, 1);
  assert.equal(comparison.ok, false);
  assert.equal(comparison.baseline.groupCount, 1);
  assert.equal(comparison.baseline.isolatedGroupCount, 0);
  assert.equal(comparison.baseline.largestGroupOperationCount, 4);
  assert.equal(comparison.baseline.unresolvedCauseCount, 1);
  assert.equal(comparison.candidate.unresolvedCauseCount, 2);
  assert.equal(
    comparison.operations["solid-native.event"].candidateDuration,
    undefined,
  );
  assert.equal(
    comparison.operations["solid-native.commit"].p95Regression,
    true,
  );
  assert.deepEqual(
    comparison.regressions.map(({ metric, operationName }) => ({
      metric,
      operationName,
    })),
    [
      { metric: "p95-duration", operationName: "solid-native.commit" },
      { metric: "error-count", operationName: "solid-native.event" },
      { metric: "evicted-operation-count", operationName: undefined },
      { metric: "discarded-record-count", operationName: undefined },
      { metric: "unresolved-cause-count", operationName: undefined },
    ],
  );
  assert.equal(
    JSON.stringify(comparison).includes("do-not-print-by-default"),
    false,
  );
  assert.ok(Object.isFrozen(comparison));
  assert.ok(Object.isFrozen(comparison.operations));
  assert.ok(Object.isFrozen(comparison.regressions));
  assert.match(
    formatNativeCausalDebugComparison(comparison),
    /FAIL Solid Native causal debug comparison[\s\S]*\[REGRESSION\]/u,
  );
});

test("keeps latency deltas informational without an explicit threshold", () => {
  const baseline = snapshot();
  const candidate = JSON.parse(JSON.stringify(baseline));
  candidate.operations[2].duration = 20;
  const comparison = compareNativeCausalDebugSnapshots(baseline, candidate);
  assert.equal(comparison.ok, true);
  assert.equal(comparison.regressions.length, 0);
  assert.equal(
    comparison.operations["solid-native.commit"].p95DeltaPercent,
    900,
  );
  assert.equal(
    comparison.operations["solid-native.commit"].p95Regression,
    false,
  );
  assert.match(
    formatNativeCausalDebugComparison(comparison),
    /PASS Solid Native causal debug comparison/u,
  );
  assert.throws(
    () =>
      compareNativeCausalDebugSnapshots(baseline, candidate, {
        maxP95RegressionPercent: -1,
      }),
    /from 0 through 10000/u,
  );

  const zeroBaseline = snapshot();
  const positiveCandidate = JSON.parse(JSON.stringify(zeroBaseline));
  zeroBaseline.operations[2].duration = 0;
  positiveCandidate.operations[2].duration = 1;
  const zeroComparison = compareNativeCausalDebugSnapshots(
    zeroBaseline,
    positiveCandidate,
    { maxP95RegressionPercent: 10 },
  );
  assert.equal(zeroComparison.ok, false);
  assert.equal(
    zeroComparison.operations["solid-native.commit"].p95DeltaPercent,
    undefined,
  );
  assert.equal(
    zeroComparison.operations["solid-native.commit"].p95Regression,
    true,
  );
});

test("detects causal fragmentation only across equal operation shapes", () => {
  const baseline = snapshot();
  const fragmented = JSON.parse(JSON.stringify(baseline));
  fragmented.operations[2].causes = [];

  const regression = compareNativeCausalDebugSnapshots(baseline, fragmented);
  assert.equal(regression.ok, false);
  assert.equal(regression.baseline.groupCount, 1);
  assert.equal(regression.candidate.groupCount, 2);
  assert.equal(regression.candidate.isolatedGroupCount, 0);
  assert.equal(regression.candidate.largestGroupOperationCount, 2);
  assert.deepEqual(regression.regressions, [
    {
      metric: "retained-group-count",
      baselineValue: 1,
      candidateValue: 2,
    },
  ]);
  assert.match(
    formatNativeCausalDebugComparison(regression),
    /Graph quality: groups 1 -> 2[\s\S]*retained-group-count: 1 -> 2/u,
  );

  const expanded = JSON.parse(JSON.stringify(baseline));
  expanded.operations.push(
    operation({
      operationId: "new-owner",
      name: "solid-native.owner",
      startedAt: 1_700_000_000_020,
      finishedAt: 1_700_000_000_021,
      duration: 1,
      status: "ok",
      finishAttributes: {},
    }),
  );
  const informational = compareNativeCausalDebugSnapshots(baseline, expanded);
  assert.equal(informational.candidate.groupCount, 2);
  assert.equal(informational.ok, true);
  assert.deepEqual(informational.regressions, []);
});

test("compares the same bounded snapshots from local files", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "solid-native-compare-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await Promise.all([
    writeFile(
      path.join(directory, "baseline.json"),
      JSON.stringify(snapshot()),
    ),
    writeFile(
      path.join(directory, "candidate.json"),
      JSON.stringify(snapshot()),
    ),
  ]);
  const comparison = await compareNativeCausalDebugFiles({
    cwd: directory,
    baselinePath: "baseline.json",
    candidatePath: "candidate.json",
  });
  assert.equal(comparison.ok, true);
  assert.equal(comparison.regressions.length, 0);
});

test("creates a CSP-locked offline causal report without implicit attributes", () => {
  const report = createNativeCausalDebugReport(snapshot(), {
    operationId: "commit-1",
  });
  assert.match(report, /^<!doctype html>/u);
  assert.match(report, /default-src 'none'/u);
  assert.match(report, /connect-src 'none'/u);
  assert.doesNotMatch(report, /do-not-print-by-default/u);

  const payload = reportPayload(report);
  assert.equal(payload.kind, "solid-native.causal-debug-report");
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.selectedOperationId, "commit-1");
  assert.equal(payload.operationCount, 4);
  assert.equal(payload.groupCount, 1);
  assert.equal(payload.groups[0].groupId, "event-1");
  assert.deepEqual(payload.groups[0].operationIds, [
    "event-1",
    "computation-1",
    "commit-1",
    "frame-1",
  ]);
  assert.equal(payload.groups[0].status, "active");
  assert.equal(payload.groups[0].duration, 100);
  assert.equal(payload.operations[0].attributes, undefined);
  assert.equal(payload.operations[0].groupId, "event-1");
  assert.deepEqual(payload.operations[0].unresolvedCauseIds, ["evicted-input"]);
  assert.match(report, /id="view-filter"/u);
  assert.match(report, /id="groups"/u);
  assert.match(report, /not a distributed trace ID/u);

  const style = /<style>([\s\S]*?)<\/style>/u.exec(report)?.[1];
  const script = /<script>([\s\S]*?)<\/script>/u.exec(report)?.[1];
  assert.equal(typeof style, "string");
  assert.equal(typeof script, "string");
  assert.doesNotThrow(() => new Function(script));
  const styleHash = createHash("sha256").update(style).digest("base64");
  const scriptHash = createHash("sha256").update(script).digest("base64");
  assert.equal(report.includes(`style-src 'sha256-${styleHash}'`), true);
  assert.equal(report.includes(`script-src 'sha256-${scriptHash}'`), true);
});

test("base64-encodes explicitly disclosed report attributes", () => {
  const value = snapshot();
  value.operations[0].startAttributes.private =
    '</script><script id="injected">throw 1</script>';
  const report = createNativeCausalDebugReport(value, {
    includeAttributes: true,
  });
  assert.doesNotMatch(report, /id="injected"/u);
  assert.equal(
    reportPayload(report).operations[0].attributes.start.private,
    value.operations[0].startAttributes.private,
  );
});

test("creates the same offline report from bounded files and streams", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "solid-native-report-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    path.join(directory, "timeline.json"),
    JSON.stringify(snapshot()),
  );

  const fromFile = await createNativeCausalDebugReportFile({
    cwd: directory,
    snapshotPath: "timeline.json",
  });
  const fromStream = await createNativeCausalDebugReportStream(
    Readable.from([JSON.stringify(snapshot())]),
  );
  assert.equal(fromFile, fromStream);
  assert.equal(fromFile.includes(directory), false);
});

test("publishes reports privately, atomically, and without clobbering", async (t) => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "solid-native-report-output-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const report = createNativeCausalDebugReport(snapshot());
  const outputPath = await writeNativeCausalDebugReportFile({
    cwd: directory,
    outputPath: "private/report.html",
    report,
  });

  assert.equal(outputPath, path.join(directory, "private/report.html"));
  assert.equal(await readFile(outputPath, "utf8"), report);
  assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(path.dirname(outputPath)), ["report.html"]);

  await assert.rejects(
    writeNativeCausalDebugReportFile({
      cwd: directory,
      outputPath: "private/report.html",
      report: report.replace("Causal report", "Replacement report"),
    }),
    /refusing to overwrite/u,
  );
  assert.equal(await readFile(outputPath, "utf8"), report);
  assert.deepEqual(await readdir(path.dirname(outputPath)), ["report.html"]);
});

test("exports deterministic Perfetto slices and retained causal flows", () => {
  const first = createNativeCausalTrace(snapshot());
  const second = createNativeCausalTrace(snapshot());

  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first));
  assert.ok(first.every((event) => Object.isFrozen(event)));
  assert.ok(first.every((event) => Object.isFrozen(event.args)));
  assert.equal(
    JSON.stringify(first).includes("do-not-print-by-default"),
    false,
  );

  const threadNames = first
    .filter((event) => event.ph === "M" && event.name === "thread_name")
    .map((event) => event.args.name);
  assert.deepEqual(threadNames, [
    "Snapshot",
    "solid-native.commit",
    "solid-native.computation",
    "solid-native.event",
    "solid-native.frame",
  ]);
  assert.equal(
    first.find((event) => event.cat === "solid-native.snapshot").args
      .retained_group_count,
    1,
  );

  const groups = first.filter((event) => event.cat === "solid-native.group");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, "retained-causal-group");
  assert.equal(groups[0].ts, 0);
  assert.deepEqual(groups[0].args, {
    group_id: "event-1",
    group_id_scope: "local-retained-component",
    operation_count: 4,
    active_operation_count: 1,
    ok_operation_count: 3,
    error_operation_count: 0,
    cancelled_operation_count: 0,
    entry_operation_count: 1,
    terminal_operation_count: 1,
    unresolved_cause_count: 1,
  });

  const operations = first.filter(
    (event) => event.cat === "solid-native.operation",
  );
  assert.deepEqual(
    operations.map(({ ph, ts }) => ({ ph, ts })),
    [
      { ph: "X", ts: 0 },
      { ph: "X", ts: 2_000 },
      { ph: "X", ts: 4_000 },
      { ph: "X", ts: 10_000 },
    ],
  );
  assert.equal(operations[2].dur, 2_000);
  assert.equal(operations[3].dur, 90_000);
  assert.equal(operations[0].args.unresolved_cause_count, 1);
  assert.equal(
    operations.every((event) => event.args.retained_group_id === "event-1"),
    true,
  );

  const flowStarts = first.filter((event) => event.ph === "s");
  const flowFinishes = first.filter((event) => event.ph === "f");
  assert.deepEqual(
    flowStarts.map(({ id }) => id),
    [1, 2, 3],
  );
  assert.deepEqual(
    flowFinishes.map(({ id }) => id),
    [1, 2, 3],
  );
  assert.deepEqual(
    flowFinishes.map(({ bp }) => bp),
    ["e", "e", "e"],
  );
});

test("preserves disconnected retained groups in Perfetto markers and slices", () => {
  const value = snapshot();
  value.operations.push(
    operation({
      operationId: "owner-2",
      name: "solid-native.owner",
      startedAt: 1_700_000_000_020,
      finishedAt: 1_700_000_000_021,
      duration: 1,
      status: "ok",
      finishAttributes: {},
    }),
  );
  const trace = createNativeCausalTrace(value);
  assert.deepEqual(
    trace
      .filter((event) => event.cat === "solid-native.group")
      .map((event) => event.args.group_id),
    ["event-1", "owner-2"],
  );
  assert.equal(
    trace.find(
      (event) =>
        event.cat === "solid-native.operation" &&
        event.name === "solid-native.owner",
    ).args.retained_group_id,
    "owner-2",
  );
});

test("assigns overlapping operations to deterministic non-overlapping lanes", () => {
  const value = snapshot();
  value.operations.splice(
    1,
    0,
    operation({
      operationId: "event-2",
      name: "solid-native.event",
      startedAt: 1_700_000_000_000.5,
      finishedAt: 1_700_000_000_001.5,
      duration: 1,
      status: "ok",
      finishAttributes: {},
    }),
  );
  const trace = createNativeCausalTrace(value);
  const eventThreads = trace
    .filter(
      (entry) =>
        entry.ph === "M" &&
        entry.name === "thread_name" &&
        String(entry.args.name).startsWith("solid-native.event"),
    )
    .map((entry) => entry.args.name);
  assert.deepEqual(eventThreads, [
    "solid-native.event",
    "solid-native.event #2",
  ]);
  const eventSlices = trace.filter(
    (entry) =>
      entry.cat === "solid-native.operation" &&
      entry.name === "solid-native.event",
  );
  assert.notEqual(eventSlices[0].tid, eventSlices[1].tid);
});

test("requires explicit disclosure and representable trace timestamps", () => {
  const trace = createNativeCausalTrace(snapshot(), {
    includeAttributes: true,
  });
  const event = trace.find((entry) => entry.args.operation_id === "event-1");
  assert.equal(event.args["start.private"], "do-not-print-by-default");

  assert.throws(
    () =>
      createNativeCausalTrace({
        ...snapshot(),
        capturedAt: Number.MAX_VALUE,
      }),
    /cannot be represented/u,
  );
  assert.throws(
    () => createNativeCausalTrace(snapshot(), { includeAttributes: "yes" }),
    /must be a boolean/u,
  );
});

test("rejects hostile retained-flow expansion before building trace events", () => {
  const causes = Array.from({ length: 255 }, (_, index) =>
    operation({
      operationId: `cause-${index}`,
      name: "solid-native.event",
      startedAt: index / 1_000,
      finishedAt: 1,
      duration: 1,
      status: "ok",
      finishAttributes: {},
    }),
  );
  const effectCount =
    Math.floor(NATIVE_CAUSAL_TRACE_MAX_FLOW_COUNT / causes.length) + 1;
  const effects = Array.from({ length: effectCount }, (_, index) =>
    operation({
      operationId: `effect-${index}`,
      name: "solid-native.computation",
      causes: causes.map(({ operationId }) => operationId),
      startedAt: 2 + index / 1_000,
      finishedAt: 3,
      duration: 1,
      status: "ok",
      finishAttributes: {},
    }),
  );

  const expanded = {
    kind: "solid-native.causal-debug-snapshot",
    schemaVersion: 0,
    capturedAt: 4,
    operations: [...causes, ...effects],
    activeOperationCount: 0,
    evictedOperationCount: 0,
    discardedRecordCount: 0,
  };
  assert.throws(
    () => createNativeCausalTrace(expanded),
    new RegExp(
      `exceeds ${NATIVE_CAUSAL_TRACE_MAX_FLOW_COUNT} retained flows`,
      "u",
    ),
  );
  assert.throws(
    () => createNativeCausalDebugReport(expanded),
    new RegExp(
      `report exceeds ${NATIVE_CAUSAL_TRACE_MAX_FLOW_COUNT} retained flows`,
      "u",
    ),
  );
});

test("formats finite timestamps outside the JavaScript Date range", () => {
  const inspection = inspectNativeCausalDebugSnapshot({
    ...snapshot(),
    capturedAt: Number.MAX_VALUE,
  });
  assert.equal(
    formatNativeCausalDebugInspection(inspection).includes(
      `Captured: ${String(Number.MAX_VALUE)}`,
    ),
    true,
  );
});

test("reads one bounded UTF-8 JSON file without retaining its path", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "solid-native-debug-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const snapshotPath = path.join(directory, "timeline.json");
  await writeFile(snapshotPath, JSON.stringify(snapshot()));

  const inspection = await inspectNativeCausalDebugFile({
    cwd: directory,
    snapshotPath: "timeline.json",
    operationId: "commit-1",
  });
  assert.equal(inspection.selection.target.name, "solid-native.commit");
  assert.equal(JSON.stringify(inspection).includes(directory), false);
});

test("creates the same path-free trace from bounded files and streams", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "solid-native-trace-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    path.join(directory, "timeline.json"),
    JSON.stringify(snapshot()),
  );

  const fromFile = await createNativeCausalTraceFile({
    cwd: directory,
    snapshotPath: "timeline.json",
  });
  const fromStream = await createNativeCausalTraceStream(
    Readable.from([JSON.stringify(snapshot())]),
  );
  assert.deepEqual(fromFile, fromStream);
  assert.equal(JSON.stringify(fromFile).includes(directory), false);
});

test("rejects malformed snapshots, missing selections, and unsafe options", () => {
  assert.throws(
    () =>
      inspectNativeCausalDebugSnapshot({ ...snapshot(), unexpected: true }, {}),
    /unknown field/u,
  );
  assert.throws(
    () =>
      inspectNativeCausalDebugSnapshot(snapshot(), {
        operationId: "missing-operation",
      }),
    /does not contain operation/u,
  );
  assert.throws(
    () =>
      inspectNativeCausalDebugSnapshot(snapshot(), {
        includeAttributes: "yes",
      }),
    /must be a boolean/u,
  );
});

test("rejects directories, invalid UTF-8, invalid JSON, and oversized files", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "solid-native-debug-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  await assert.rejects(
    inspectNativeCausalDebugFile({ snapshotPath: directory }),
    /must be a file/u,
  );

  const invalidUTF8 = path.join(directory, "invalid-utf8.json");
  await writeFile(invalidUTF8, Buffer.from([0xff]));
  await assert.rejects(
    inspectNativeCausalDebugFile({ snapshotPath: invalidUTF8 }),
    /valid UTF-8/u,
  );

  const invalidJSON = path.join(directory, "invalid.json");
  await writeFile(invalidJSON, "{");
  await assert.rejects(
    inspectNativeCausalDebugFile({ snapshotPath: invalidJSON }),
    /valid JSON/u,
  );

  const oversized = path.join(directory, "oversized.json");
  await writeFile(oversized, "");
  await truncate(oversized, NATIVE_CAUSAL_DEBUG_MAX_FILE_BYTES + 1);
  await assert.rejects(
    inspectNativeCausalDebugFile({ snapshotPath: oversized }),
    /exceeds 16777216 bytes/u,
  );

  const childDirectory = path.join(directory, "directory.json");
  await mkdir(childDirectory);
  await assert.rejects(
    inspectNativeCausalDebugFile({ snapshotPath: childDirectory }),
    /must be a file/u,
  );
});

test("exposes the bounded inspection through the CLI", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "solid-native-debug-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    path.join(directory, "timeline.json"),
    JSON.stringify(snapshot()),
  );

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    new URL("../dist/bin.js", import.meta.url).pathname,
    "debug",
    "inspect",
    "timeline.json",
    "--cwd",
    directory,
    "--operation",
    "commit-1",
    "--json",
  ]);
  assert.equal(stderr, "");
  const output = JSON.parse(stdout);
  assert.equal(output.selection.target.operationId, "commit-1");
  assert.equal(
    JSON.stringify(output).includes("do-not-print-by-default"),
    false,
  );
});

test("emits a directly loadable Chrome JSON trace through the CLI", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "solid-native-trace-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    path.join(directory, "timeline.json"),
    JSON.stringify(snapshot()),
  );

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    new URL("../dist/bin.js", import.meta.url).pathname,
    "debug",
    "trace",
    "timeline.json",
    "--cwd",
    directory,
  ]);
  assert.equal(stderr, "");
  const output = JSON.parse(stdout);
  assert.ok(Array.isArray(output));
  assert.equal(
    output.some((event) => event.ph === "X"),
    true,
  );
  assert.equal(
    output.some((event) => event.ph === "s"),
    true,
  );
  assert.equal(
    output.some((event) => event.ph === "f"),
    true,
  );
  assert.equal(
    JSON.stringify(output).includes("do-not-print-by-default"),
    false,
  );
});

test("streams Chrome JSON traces and rejects redundant output modes", async () => {
  const result = await runCLIWithInput(
    ["debug", "trace", "-"],
    JSON.stringify(snapshot()),
  );
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout);
  assert.equal(
    output.some((event) => event.name === "causes"),
    true,
  );

  const invalid = await runCLIWithInput(
    ["debug", "trace", "-", "--json"],
    JSON.stringify(snapshot()),
  );
  assert.equal(invalid.code, 2);
  assert.match(invalid.stderr, /always emits Chrome JSON/u);
});

test("emits an offline causal report through CLI files and stdin", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "solid-native-report-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    path.join(directory, "timeline.json"),
    JSON.stringify(snapshot()),
  );
  const file = await execFileAsync(process.execPath, [
    new URL("../dist/bin.js", import.meta.url).pathname,
    "debug",
    "report",
    "timeline.json",
    "--cwd",
    directory,
    "--operation",
    "commit-1",
  ]);
  assert.equal(file.stderr, "");
  assert.equal(reportPayload(file.stdout).selectedOperationId, "commit-1");
  assert.equal(file.stdout.includes("do-not-print-by-default"), false);

  const output = await runCLIWithInput(
    [
      "debug",
      "report",
      "timeline.json",
      "--cwd",
      directory,
      "--output",
      "artifacts/causal.html",
    ],
    "",
  );
  assert.equal(output.code, 0);
  assert.equal(output.stderr, "");
  assert.equal(
    output.stdout,
    `Wrote causal report: ${path.join(directory, "artifacts/causal.html")}\n`,
  );
  const writtenReport = await readFile(
    path.join(directory, "artifacts/causal.html"),
    "utf8",
  );
  assert.equal(reportPayload(writtenReport).operationCount, 4);
  assert.equal(
    (await stat(path.join(directory, "artifacts/causal.html"))).mode & 0o777,
    0o600,
  );

  const clobber = await runCLIWithInput(
    [
      "debug",
      "report",
      "timeline.json",
      "--cwd",
      directory,
      "--output",
      "artifacts/causal.html",
    ],
    "",
  );
  assert.equal(clobber.code, 2);
  assert.match(clobber.stderr, /refusing to overwrite/u);

  const streamed = await runCLIWithInput(
    ["debug", "report", "-"],
    JSON.stringify(snapshot()),
  );
  assert.equal(streamed.code, 0);
  assert.equal(streamed.stderr, "");
  assert.equal(reportPayload(streamed.stdout).operationCount, 4);

  const invalid = await runCLIWithInput(
    ["debug", "report", "-", "--json"],
    JSON.stringify(snapshot()),
  );
  assert.equal(invalid.code, 2);
  assert.match(invalid.stderr, /always emits HTML/u);

  const stdoutAlias = await runCLIWithInput(
    ["debug", "report", "timeline.json", "--cwd", directory, "--output", "-"],
    "",
  );
  assert.equal(stdoutAlias.code, 2);
  assert.match(stdoutAlias.stderr, /--output requires a value/u);
});

test("consumes a bounded snapshot stream across arbitrary UTF-8 chunks", async () => {
  const value = snapshot();
  value.operations[0].startAttributes.private = "split-🙂-payload";
  const bytes = Buffer.from(JSON.stringify(value));
  const emoji = bytes.indexOf(Buffer.from("🙂"));
  const inspection = await inspectNativeCausalDebugStream(
    Readable.from([
      bytes.subarray(0, emoji + 1),
      bytes.subarray(emoji + 1, emoji + 3),
      bytes.subarray(emoji + 3),
    ]),
    { operationId: "commit-1" },
  );
  assert.equal(inspection.selection.target.operationId, "commit-1");
  assert.equal(JSON.stringify(inspection).includes("split-"), false);

  let cleaned = false;
  await assert.rejects(
    inspectNativeCausalDebugStream(
      (async function* () {
        try {
          yield 42;
        } finally {
          cleaned = true;
        }
      })(),
    ),
    /chunks must be strings or Uint8Array/u,
  );
  assert.equal(cleaned, true);
});

test("accepts a causal snapshot over CLI stdin and exits", async () => {
  const result = await runCLIWithInput(
    ["debug", "inspect", "-", "--operation", "commit-1", "--json"],
    JSON.stringify(snapshot()),
  );
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout);
  assert.equal(output.selection.target.operationId, "commit-1");
  assert.equal(
    JSON.stringify(output).includes("do-not-print-by-default"),
    false,
  );
});

test("compares causal snapshots through the CLI with CI exit semantics", async (t) => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "solid-native-compare-cli-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const baseline = snapshot();
  const candidate = JSON.parse(JSON.stringify(baseline));
  candidate.operations[2].duration = 5;
  await Promise.all([
    writeFile(path.join(directory, "baseline.json"), JSON.stringify(baseline)),
    writeFile(
      path.join(directory, "candidate.json"),
      JSON.stringify(candidate),
    ),
  ]);

  const failed = await runCLIWithInput(
    [
      "debug",
      "compare",
      "baseline.json",
      "candidate.json",
      "--cwd",
      directory,
      "--max-p95-regression",
      "25",
      "--json",
    ],
    "",
  );
  assert.equal(failed.code, 1);
  assert.equal(failed.stderr, "");
  const failedComparison = JSON.parse(failed.stdout);
  assert.equal(failedComparison.ok, false);
  assert.equal(
    failedComparison.operations["solid-native.commit"].p95Regression,
    true,
  );

  const informational = await runCLIWithInput(
    ["debug", "compare", "baseline.json", "candidate.json", "--cwd", directory],
    "",
  );
  assert.equal(informational.code, 0);
  assert.equal(informational.stderr, "");
  assert.match(
    informational.stdout,
    /PASS Solid Native causal debug comparison/u,
  );

  const invalid = await runCLIWithInput(
    [
      "debug",
      "compare",
      "baseline.json",
      "candidate.json",
      "--max-p95-regression",
      "-1",
    ],
    "",
  );
  assert.equal(invalid.code, 2);
  assert.match(invalid.stderr, /requires a value/u);
});

function portableSourceMap() {
  return {
    version: 3,
    file: "main.jsbundle",
    sources: ["app:///src/App.tsx"],
    sourcesContent: ["export function render() {}\nrender();\n"],
    names: ["render"],
    mappings: "AAAAA;AACA",
    x_google_ignoreList: [0],
  };
}

test("symbolicates explicit one-based locations through a canonical map", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "solid-native-debug-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    path.join(directory, "main.jsbundle.map"),
    JSON.stringify(portableSourceMap()),
  );

  const result = await symbolicateNativeSourceLocations({
    cwd: directory,
    sourceMapPath: "main.jsbundle.map",
    locations: [
      { line: 1, column: 1 },
      { line: 2, column: 1 },
      { line: 3, column: 1 },
    ],
  });
  assert.equal(result.sourceCount, 1);
  assert.deepEqual(result.locations, [
    {
      generated: { line: 1, column: 1 },
      original: {
        source: "app:///src/App.tsx",
        line: 1,
        column: 1,
        name: "render",
        ignored: true,
      },
    },
    {
      generated: { line: 2, column: 1 },
      original: {
        source: "app:///src/App.tsx",
        line: 2,
        column: 1,
        ignored: true,
      },
    },
    { generated: { line: 3, column: 1 } },
  ]);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.locations));
  assert.ok(Object.isFrozen(result.locations[0].original));
  const formatted = formatNativeSourceLocationSymbolication(result);
  assert.match(
    formatted,
    /1:1 -> app:\/\/\/src\/App\.tsx:1:1 \(render\) \[ignored\]/u,
  );
  assert.match(formatted, /3:1 -> <unmapped>/u);
  assert.equal(formatted.includes(directory), false);
});

test("symbolicates indexed canonical maps", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "solid-native-debug-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const map = {
    version: 3,
    file: "main.jsbundle",
    sections: [
      {
        offset: { line: 0, column: 0 },
        map: portableSourceMap(),
      },
      {
        offset: { line: 2, column: 0 },
        map: {
          ...portableSourceMap(),
          sources: ["app:///src/Second.tsx"],
          sourcesContent: ["second();"],
          names: ["second"],
        },
      },
    ],
  };
  await writeFile(path.join(directory, "indexed.map"), JSON.stringify(map));

  const result = await symbolicateNativeSourceLocations({
    cwd: directory,
    sourceMapPath: "indexed.map",
    locations: [{ line: 3, column: 1 }],
  });
  assert.equal(result.sourceCount, 2);
  assert.equal(result.locations[0].original.source, "app:///src/Second.tsx");
  assert.equal(result.locations[0].original.name, "second");
});

test("parses and symbolicates the pinned Hermes stack dialect", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "solid-native-debug-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    path.join(directory, "main.jsbundle.map"),
    JSON.stringify(portableSourceMap()),
  );
  const stack = [
    "TypeError: private error message",
    "    at render (address at file:///private/device/main.jsbundle:1:0)",
    "    at nativeCall (native)",
    "    at internal (address at InternalBytecode.js:1:24)",
    "    ... skipping 2 frames",
    "    at App (file:///private/device/main.jsbundle:2:1)",
  ].join("\n");

  const parsed = parseNativeStackTrace(stack);
  assert.deepEqual(parsed, {
    dialect: "hermes",
    inputFrameCount: 4,
    omittedFrameCount: 4,
    frames: [
      {
        index: 0,
        methodName: "render",
        generated: { line: 1, column: 1 },
        columnInferred: false,
      },
      {
        index: 3,
        methodName: "App",
        generated: { line: 2, column: 1 },
        columnInferred: false,
      },
    ],
  });
  assert.ok(Object.isFrozen(parsed));
  assert.ok(Object.isFrozen(parsed.frames));

  const result = await symbolicateNativeStackTrace({
    cwd: directory,
    sourceMapPath: "main.jsbundle.map",
    stack,
  });
  assert.equal(result.kind, "solid-native.stack-trace-symbolication");
  assert.equal(result.frames[0].original.source, "app:///src/App.tsx");
  assert.equal(result.frames[1].original.line, 2);
  const formatted = formatNativeStackTraceSymbolication(result);
  assert.match(formatted, /#0 render 1:1 -> app:\/\/\/src\/App\.tsx/u);
  assert.equal(formatted.includes("private error message"), false);
  assert.equal(formatted.includes("file:///private/device"), false);
  assert.equal(JSON.stringify(result).includes(directory), false);
});

test("parses generic JavaScript frames and marks inferred columns", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "solid-native-debug-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    path.join(directory, "main.jsbundle.map"),
    JSON.stringify(portableSourceMap()),
  );
  const stack = [
    "Error: private generic message",
    "    at render (http://localhost:8081/index.bundle?platform=ios:1:1)",
    "    at anonymous (http://localhost:8081/index.bundle?platform=ios:3)",
  ].join("\r\n");
  await writeFile(path.join(directory, "error.stack"), stack);
  const result = await symbolicateNativeStackTraceFile({
    cwd: directory,
    sourceMapPath: "main.jsbundle.map",
    stackPath: "error.stack",
  });
  assert.equal(result.dialect, "javascript");
  assert.equal(result.frames[0].original.name, "render");
  assert.equal(result.frames[1].generated.column, 1);
  assert.equal(result.frames[1].columnInferred, true);
  assert.equal(result.frames[1].original, undefined);
  assert.match(
    formatNativeStackTraceSymbolication(result),
    /<unmapped> \[column inferred\]/u,
  );

  const jsc = parseNativeStackTrace(
    "render@file:///private/device/main.jsbundle:1:2",
  );
  assert.equal(jsc.dialect, "javascript");
  assert.deepEqual(jsc.frames[0].generated, { line: 1, column: 2 });
});

test("consumes a strict bounded stack stream and closes rejected producers", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "solid-native-debug-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    path.join(directory, "main.jsbundle.map"),
    JSON.stringify(portableSourceMap()),
  );
  const bytes = Buffer.from(
    "Error\n    at render🙂 (http://localhost/index.bundle:1:1)",
  );
  const emoji = bytes.indexOf(Buffer.from("🙂"));
  const result = await symbolicateNativeStackTraceStream({
    cwd: directory,
    sourceMapPath: "main.jsbundle.map",
    stream: Readable.from([
      bytes.subarray(0, emoji + 1),
      bytes.subarray(emoji + 1, emoji + 3),
      bytes.subarray(emoji + 3),
    ]),
  });
  assert.equal(result.frames[0].methodName, "render🙂");

  let cleaned = false;
  await assert.rejects(
    symbolicateNativeStackTraceStream({
      sourceMapPath: "missing.map",
      stream: (async function* () {
        try {
          yield 42;
        } finally {
          cleaned = true;
        }
      })(),
    }),
    /chunks must be strings or Uint8Array/u,
  );
  assert.equal(cleaned, true);
});

test("rejects unsafe stack files and stream bytes before source-map work", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "solid-native-debug-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  await writeFile(
    path.join(directory, "invalid.stack"),
    new Uint8Array([0xc3]),
  );
  await assert.rejects(
    symbolicateNativeStackTraceFile({
      cwd: directory,
      sourceMapPath: "missing.map",
      stackPath: "invalid.stack",
    }),
    /valid UTF-8/u,
  );

  await writeFile(path.join(directory, "oversized.stack"), "");
  await truncate(
    path.join(directory, "oversized.stack"),
    NATIVE_STACK_MAX_INPUT_BYTES + 1,
  );
  await assert.rejects(
    symbolicateNativeStackTraceFile({
      cwd: directory,
      sourceMapPath: "missing.map",
      stackPath: "oversized.stack",
    }),
    /exceeds 1048576 bytes/u,
  );

  await mkdir(path.join(directory, "directory.stack"));
  await assert.rejects(
    symbolicateNativeStackTraceFile({
      cwd: directory,
      sourceMapPath: "missing.map",
      stackPath: "directory.stack",
    }),
    /path must be a file/u,
  );

  await assert.rejects(
    symbolicateNativeStackTraceStream({
      sourceMapPath: "missing.map",
      stream: Readable.from([new Uint8Array([0xc3])]),
    }),
    /valid UTF-8/u,
  );
  await assert.rejects(
    symbolicateNativeStackTraceStream({
      sourceMapPath: "missing.map",
      stream: Readable.from([new Uint8Array(NATIVE_STACK_MAX_INPUT_BYTES + 1)]),
    }),
    /exceeds 1048576 bytes/u,
  );
  await assert.rejects(
    symbolicateNativeStackTraceStream({
      sourceMapPath: "missing.map",
      stream: (async function* () {
        yield "Error\n    at \ud800 (bundle.js:1:1)";
      })(),
    }),
    /valid Unicode scalar values/u,
  );
});

test("rejects malformed or resource-exhausting stack traces before maps", () => {
  assert.throws(
    () => parseNativeStackTrace("private message only"),
    /no supported/u,
  );
  assert.throws(
    () => parseNativeStackTrace("x".repeat(NATIVE_STACK_MAX_INPUT_BYTES + 1)),
    /exceeds 1048576 bytes/u,
  );
  assert.throws(
    () =>
      parseNativeStackTrace(
        Array.from({ length: NATIVE_STACK_MAX_LINES + 1 }, () => "").join("\n"),
      ),
    /exceeds 4096 lines/u,
  );
  assert.throws(
    () =>
      parseNativeStackTrace(
        Array.from(
          { length: NATIVE_STACK_MAX_FRAMES + 1 },
          (_, index) => `    at frame${index} (bundle.js:1:1)`,
        ).join("\n"),
      ),
    /exceeds 1024 frames/u,
  );
  assert.throws(
    () =>
      parseNativeStackTrace(
        `    at ${"x".repeat(NATIVE_STACK_MAX_METHOD_NAME_CHARACTERS + 1)} (bundle.js:1:1)`,
      ),
    /methodName/u,
  );
  assert.throws(
    () => parseNativeStackTrace("    at unsafe\u001b[2J (bundle.js:1:1)"),
    /formatting characters/u,
  );
  assert.throws(
    () => parseNativeStackTrace("    at \ud800 (bundle.js:1:1)"),
    /valid Unicode scalar values/u,
  );
  assert.throws(
    () =>
      parseNativeStackTrace(
        `Error\n    ... skipping ${NATIVE_STACK_MAX_SKIPPED_FRAMES + 1} frames\n    at render (bundle.js:1:1)`,
      ),
    /omitted frames/u,
  );
});

test("bounds stack stream chunk count independently of byte count", async () => {
  let cleaned = false;
  await assert.rejects(
    symbolicateNativeStackTraceStream({
      sourceMapPath: "missing.map",
      stream: (async function* () {
        try {
          for (
            let index = 0;
            index <= NATIVE_STACK_MAX_INPUT_CHUNKS;
            index += 1
          ) {
            yield new Uint8Array();
          }
        } finally {
          cleaned = true;
        }
      })(),
    }),
    /exceeds 4096 chunks/u,
  );
  assert.equal(cleaned, true);
});

test("escapes source-map display names in human symbolication output", () => {
  const source = formatNativeSourceLocationSymbolication({
    kind: "solid-native.source-location-symbolication",
    schemaVersion: 0,
    sourceCount: 1,
    locations: [
      {
        generated: { line: 1, column: 1 },
        original: {
          source: "app:///src/App.tsx",
          line: 1,
          column: 1,
          name: "render\u001b[2J",
          ignored: false,
        },
      },
    ],
  });
  assert.equal(source.includes("\u001b"), false);
  assert.match(source, /render\\u001b\[2J/u);

  const stack = formatNativeStackTraceSymbolication({
    kind: "solid-native.stack-trace-symbolication",
    schemaVersion: 0,
    dialect: "javascript",
    sourceCount: 1,
    inputFrameCount: 1,
    omittedFrameCount: 0,
    frames: [
      {
        index: 0,
        methodName: "render",
        generated: { line: 1, column: 1 },
        columnInferred: false,
        original: {
          source: "app:///src/App.tsx",
          line: 1,
          column: 1,
          name: "render\u001b[2J",
          ignored: false,
        },
      },
    ],
  });
  assert.equal(stack.includes("\u001b"), false);
  assert.match(stack, /render\\u001b\[2J/u);
});

test("rejects invalid or unbounded generated locations before reading a map", async () => {
  await assert.rejects(
    symbolicateNativeSourceLocations({
      sourceMapPath: "missing.map",
      locations: [],
    }),
    /non-empty array/u,
  );
  await assert.rejects(
    symbolicateNativeSourceLocations({
      sourceMapPath: "missing.map",
      locations: [{ line: 0, column: 1 }],
    }),
    /positive safe integer/u,
  );
  await assert.rejects(
    symbolicateNativeSourceLocations({
      sourceMapPath: "missing.map",
      locations: Array.from(
        { length: NATIVE_SYMBOLICATION_MAX_LOCATIONS + 1 },
        () => ({ line: 1, column: 1 }),
      ),
    }),
    /more than 1024 locations/u,
  );
});

test("exposes local source-location symbolication through the CLI", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "solid-native-debug-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    path.join(directory, "main.jsbundle.map"),
    JSON.stringify(portableSourceMap()),
  );

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    new URL("../dist/bin.js", import.meta.url).pathname,
    "debug",
    "symbolicate",
    "main.jsbundle.map",
    "--cwd",
    directory,
    "--at",
    "1:1",
    "--at",
    "3:1",
    "--json",
  ]);
  assert.equal(stderr, "");
  const output = JSON.parse(stdout);
  assert.equal(output.locations[0].original.source, "app:///src/App.tsx");
  assert.equal(output.locations[1].original, undefined);
  assert.equal(JSON.stringify(output).includes(directory), false);
});

test("symbolicates bounded native stack files and stdin through the CLI", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "solid-native-debug-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    path.join(directory, "main.jsbundle.map"),
    JSON.stringify(portableSourceMap()),
  );
  const stack = [
    "TypeError: private device message",
    "    at render (address at file:///private/main.jsbundle:1:0)",
  ].join("\n");
  await writeFile(path.join(directory, "device.stack"), stack);

  const file = await execFileAsync(process.execPath, [
    new URL("../dist/bin.js", import.meta.url).pathname,
    "debug",
    "symbolicate",
    "main.jsbundle.map",
    "--cwd",
    directory,
    "--stack",
    "device.stack",
  ]);
  assert.equal(file.stderr, "");
  assert.match(file.stdout, /#0 render 1:1 -> app:\/\/\/src\/App\.tsx/u);
  assert.equal(file.stdout.includes("private device message"), false);
  assert.equal(file.stdout.includes("file:///private"), false);

  const stdin = await runCLIWithInput(
    [
      "debug",
      "symbolicate",
      "main.jsbundle.map",
      "--cwd",
      directory,
      "--stack",
      "-",
      "--json",
    ],
    stack,
  );
  assert.equal(stdin.code, 0);
  assert.equal(stdin.signal, null);
  assert.equal(stdin.stderr, "");
  const output = JSON.parse(stdin.stdout);
  assert.equal(output.kind, "solid-native.stack-trace-symbolication");
  assert.equal(output.frames[0].original.source, "app:///src/App.tsx");
  assert.equal(JSON.stringify(output).includes(directory), false);
});

test("requires exactly one native symbolication input mode", async () => {
  const missing = await runCLIWithInput(
    ["debug", "symbolicate", "missing.map"],
    "",
  );
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /requires --at or --stack/u);

  const conflicting = await runCLIWithInput(
    ["debug", "symbolicate", "missing.map", "--at", "1:1", "--stack", "-"],
    "",
  );
  assert.equal(conflicting.code, 2);
  assert.match(conflicting.stderr, /mutually exclusive/u);
});
