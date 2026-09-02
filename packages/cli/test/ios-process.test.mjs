import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  formatNativeIosApplicationProcessStatus,
  formatNativeIosApplicationProcessStop,
  parseNativeIosApplicationProcesses,
  parseNativeIosProcessTarget,
  readNativeIosApplicationProcessStatus,
  stopNativeIosApplicationProcesses,
} from "../dist/index.js";

const execFileAsync = promisify(execFile);
const bundleIdentifier = "dev.solid.app";
const installationUrl =
  "file:///private/var/containers/Bundle/Application/APP-ID/SolidApp.app/";

function applicationResult(overrides = {}) {
  return JSON.stringify({
    info: { outcome: "success", jsonVersion: 3 },
    result: {
      apps: [
        {
          bundleIdentifier,
          builtByDeveloper: true,
          name: "Solid App",
          url: installationUrl,
          version: "1.2.3",
          ...overrides,
        },
      ],
    },
  });
}

function processResult(processIdentifiers = [], extraProcesses = []) {
  return JSON.stringify({
    info: { outcome: "success", jsonVersion: 3 },
    result: {
      runningProcesses: [
        ...extraProcesses,
        ...processIdentifiers.map((processIdentifier) => ({
          executable: `${installationUrl}SolidApp`,
          processIdentifier,
        })),
      ],
    },
  });
}

function fakeRunner({
  calls,
  application = applicationResult(),
  applications = [application],
  processResults = [processResult()],
}) {
  let applicationIndex = 0;
  let processIndex = 0;
  return async (command, args, context) => {
    calls.push({ command, args: [...args], context });
    const outputIndex = args.indexOf("--json-output");
    if (args.includes("info") && args.includes("apps")) {
      assert.ok(outputIndex >= 0);
      const source =
        applications[Math.min(applicationIndex, applications.length - 1)];
      applicationIndex += 1;
      await writeFile(args[outputIndex + 1], source);
    } else if (args.includes("info") && args.includes("processes")) {
      assert.ok(outputIndex >= 0);
      const source =
        processResults[Math.min(processIndex, processResults.length - 1)];
      processIndex += 1;
      await writeFile(args[outputIndex + 1], source);
    } else {
      assert.equal(args[2], "process");
      assert.equal(args[3], "terminate");
      assert.equal(outputIndex, -1);
    }
    return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
  };
}

test("parses one exact developer-installed iOS process target", () => {
  assert.deepEqual(
    parseNativeIosProcessTarget(applicationResult(), bundleIdentifier),
    {
      application: {
        bundleIdentifier,
        builtByDeveloper: true,
        name: "Solid App",
        version: "1.2.3",
      },
      installationUrl,
    },
  );
  assert.throws(
    () =>
      parseNativeIosProcessTarget(
        applicationResult({ builtByDeveloper: false }),
        bundleIdentifier,
      ),
    /not a developer-installed application/u,
  );
  assert.throws(
    () =>
      parseNativeIosProcessTarget(
        applicationResult({ url: "https://example.com/SolidApp.app/" }),
        bundleIdentifier,
      ),
    /unsafe iOS application URL/u,
  );
  assert.throws(
    () =>
      parseNativeIosProcessTarget(
        JSON.stringify({
          info: { outcome: "success" },
          result: { apps: [] },
        }),
        bundleIdentifier,
      ),
    /not installed exactly once/u,
  );
});

test("selects only exact app-bundle processes and sorts their identifiers", () => {
  const source = processResult(
    [72, 41],
    [
      { executable: "file:///usr/libexec/logd", processIdentifier: 33 },
      {
        executable:
          "file:///private/var/containers/Bundle/Application/OTHER/Other.app/Other",
        processIdentifier: 91,
      },
    ],
  );
  assert.deepEqual(
    parseNativeIosApplicationProcesses(source, installationUrl),
    [41, 72],
  );
  assert.throws(
    () =>
      parseNativeIosApplicationProcesses(
        processResult([41, 41]),
        installationUrl,
      ),
    /duplicate application process identifier/u,
  );
  assert.throws(
    () =>
      parseNativeIosApplicationProcesses(
        JSON.stringify({
          info: { outcome: "success" },
          result: {
            runningProcesses: [
              {
                executable: `${installationUrl}SolidApp`,
                processIdentifier: 0,
              },
            ],
          },
        }),
        installationUrl,
      ),
    /invalid application process identifier/u,
  );
  assert.throws(
    () =>
      parseNativeIosApplicationProcesses(
        JSON.stringify({
          info: { outcome: "success" },
          result: {
            runningProcesses: [
              {
                executable: `${installationUrl}../Other.app/Other`,
                processIdentifier: 41,
              },
            ],
          },
        }),
        installationUrl,
      ),
    /outside the selected application/u,
  );
});

test("reports exact application process state without exposing its install path", async () => {
  const calls = [];
  const status = await readNativeIosApplicationProcessStatus({
    bundleIdentifier,
    device: "CORE-DEVICE-ID",
    cwd: "/workspace/app",
    env: { PATH: "/usr/bin" },
    dependencies: {
      hostPlatform: "darwin",
      runCommand: fakeRunner({
        calls,
        processResults: [processResult([72, 41])],
      }),
    },
  });
  assert.deepEqual(status, {
    schemaVersion: 0,
    operation: "status",
    platform: "ios",
    bundleIdentifier,
    device: "CORE-DEVICE-ID",
    application: {
      bundleIdentifier,
      builtByDeveloper: true,
      name: "Solid App",
      version: "1.2.3",
    },
    running: true,
    processCount: 2,
    processIdentifiers: [41, 72],
  });
  assert.equal(JSON.stringify(status).includes("APP-ID"), false);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].args.slice(0, 9), [
    "devicectl",
    "device",
    "info",
    "apps",
    "--device",
    "CORE-DEVICE-ID",
    "--bundle-id",
    bundleIdentifier,
    "--quiet",
  ]);
  assert.equal(calls[0].context.cwd, "/workspace/app");
  assert.equal(calls[0].context.env.PATH, "/usr/bin");
  assert.equal(calls[0].context.timeoutMs, 15_000);
  assert.equal(
    formatNativeIosApplicationProcessStatus(status),
    "dev.solid.app is running on CORE-DEVICE-ID with 2 processes: 41, 72.",
  );
});

test("stops replacement generations and requires four clean polls", async () => {
  const calls = [];
  const waits = [];
  const result = await stopNativeIosApplicationProcesses({
    bundleIdentifier,
    device: "CORE-DEVICE-ID",
    dependencies: {
      hostPlatform: "darwin",
      runCommand: fakeRunner({
        calls,
        processResults: [
          processResult([41]),
          processResult([72]),
          processResult(),
          processResult(),
          processResult(),
          processResult(),
        ],
      }),
      wait: async (milliseconds) => {
        waits.push(milliseconds);
      },
    },
  });
  assert.deepEqual(result, {
    schemaVersion: 0,
    operation: "stop",
    platform: "ios",
    bundleIdentifier,
    device: "CORE-DEVICE-ID",
    application: {
      bundleIdentifier,
      builtByDeveloper: true,
      name: "Solid App",
      version: "1.2.3",
    },
    running: false,
    stoppedProcessCount: 2,
    stoppedProcessIdentifiers: [41, 72],
  });
  const terminations = calls.filter((call) => call.args.includes("terminate"));
  assert.deepEqual(
    terminations.map((call) => call.args[call.args.indexOf("--pid") + 1]),
    ["41", "72"],
  );
  assert.deepEqual(waits, [250, 250, 250, 250, 250]);
  assert.equal(
    formatNativeIosApplicationProcessStop(result),
    "Stopped 2 process generations for dev.solid.app on CORE-DEVICE-ID; verified a one-second clean window.",
  );
});

test("is idempotent when the exact app is already stopped", async () => {
  const calls = [];
  const result = await stopNativeIosApplicationProcesses({
    bundleIdentifier,
    device: "CORE-DEVICE-ID",
    dependencies: {
      hostPlatform: "darwin",
      runCommand: fakeRunner({ calls }),
      wait: async () => {},
    },
  });
  assert.equal(result.stoppedProcessCount, 0);
  assert.equal(
    calls.filter((call) => call.args.includes("processes")).length,
    4,
  );
  assert.equal(
    calls.some((call) => call.args.includes("terminate")),
    false,
  );
  assert.equal(
    formatNativeIosApplicationProcessStop(result),
    "dev.solid.app was already stopped on CORE-DEVICE-ID; verified a one-second clean window.",
  );
});

test("accepts a termination race only after the exact PID disappears", async () => {
  const calls = [];
  const runner = fakeRunner({
    calls,
    processResults: [
      processResult([41]),
      processResult(),
      processResult(),
      processResult(),
      processResult(),
      processResult(),
    ],
  });
  const result = await stopNativeIosApplicationProcesses({
    bundleIdentifier,
    device: "CORE-DEVICE-ID",
    dependencies: {
      hostPlatform: "darwin",
      runCommand: async (command, args, context) => {
        const successful = await runner(command, args, context);
        return args.includes("terminate")
          ? {
              exitCode: 1,
              stdout: "",
              stderr: "The process already exited",
              timedOut: false,
            }
          : successful;
      },
      wait: async () => {},
    },
  });
  assert.deepEqual(result.stoppedProcessIdentifiers, [41]);

  const persistentRunner = fakeRunner({
    calls: [],
    processResults: [processResult([41])],
  });
  await assert.rejects(
    stopNativeIosApplicationProcesses({
      bundleIdentifier,
      device: "CORE-DEVICE-ID",
      dependencies: {
        hostPlatform: "darwin",
        runCommand: async (command, args, context) => {
          const successful = await persistentRunner(command, args, context);
          return args.includes("terminate")
            ? {
                exitCode: 1,
                stdout: "",
                stderr: "permission denied",
                timedOut: false,
              }
            : successful;
        },
        wait: async () => {},
      },
    }),
    /Could not terminate iOS application process 41.*permission denied/u,
  );
});

test("fails closed on unsafe targets, host state, command errors, and relaunch loops", async () => {
  await assert.rejects(
    readNativeIosApplicationProcessStatus({
      bundleIdentifier: "not a bundle",
      device: "DEVICE",
      dependencies: { hostPlatform: "darwin" },
    }),
    /valid dotted bundle identifier/u,
  );
  await assert.rejects(
    readNativeIosApplicationProcessStatus({
      bundleIdentifier,
      device: "BAD DEVICE",
      dependencies: { hostPlatform: "darwin" },
    }),
    /non-whitespace characters/u,
  );
  await assert.rejects(
    readNativeIosApplicationProcessStatus({
      bundleIdentifier,
      device: "DEVICE",
      dependencies: { hostPlatform: "linux" },
    }),
    /requires macOS and Xcode/u,
  );
  await assert.rejects(
    readNativeIosApplicationProcessStatus({
      bundleIdentifier,
      device: "DEVICE",
      dependencies: {
        hostPlatform: "darwin",
        runCommand: async () => ({
          exitCode: null,
          stdout: "",
          stderr: "spawn xcrun ENOENT",
          timedOut: false,
          errorCode: "ENOENT",
        }),
      },
    }),
    /Install Xcode/u,
  );
  await assert.rejects(
    readNativeIosApplicationProcessStatus({
      bundleIdentifier,
      device: "DEVICE",
      dependencies: {
        hostPlatform: "darwin",
        runCommand: fakeRunner({
          calls: [],
          applications: [
            applicationResult(),
            applicationResult({
              url: "file:///private/var/containers/Bundle/Application/REPLACED/SolidApp.app/",
            }),
          ],
        }),
      },
    }),
    /changed while its process state was inspected/u,
  );
  await assert.rejects(
    stopNativeIosApplicationProcesses({
      bundleIdentifier,
      device: "DEVICE",
      dependencies: {
        hostPlatform: "darwin",
        runCommand: fakeRunner({
          calls: [],
          processResults: [processResult([41])],
        }),
        wait: async () => {},
      },
    }),
    /kept relaunching/u,
  );
});

test(
  "exposes status and bounded stop through the CLI",
  { skip: process.platform !== "darwin" },
  async (t) => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "solid-native-ios-process-cli-"),
    );
    t.after(() => rm(directory, { force: true, recursive: true }));
    const xcrun = path.join(directory, "xcrun");
    const apps = applicationResult().replaceAll("'", "'\\''");
    const processes = processResult().replaceAll("'", "'\\''");
    await writeFile(
      xcrun,
      `#!/bin/sh
set -eu
output=''
subject=''
for argument in "$@"; do
  if [ "$argument" = 'apps' ] || [ "$argument" = 'processes' ]; then
    subject="$argument"
  fi
done
while [ "$#" -gt 0 ]; do
  if [ "$1" = '--json-output' ]; then
    shift
    output="$1"
  fi
  shift
done
if [ "$subject" = 'apps' ]; then
  printf '%s' '${apps}' > "$output"
elif [ "$subject" = 'processes' ]; then
  printf '%s' '${processes}' > "$output"
fi
`,
    );
    await chmod(xcrun, 0o755);
    const bin = new URL("../dist/bin.js", import.meta.url);
    const env = {
      ...process.env,
      PATH: `${directory}${path.delimiter}${process.env.PATH ?? ""}`,
    };
    const { stdout: statusOutput } = await execFileAsync(
      process.execPath,
      [
        bin.pathname,
        "device",
        "status-ios",
        bundleIdentifier,
        "--device",
        "CORE-DEVICE-ID",
        "--json",
      ],
      { env },
    );
    const status = JSON.parse(statusOutput);
    assert.equal(status.operation, "status");
    assert.equal(status.running, false);

    const { stdout: stopOutput } = await execFileAsync(
      process.execPath,
      [
        bin.pathname,
        "device",
        "stop-ios",
        bundleIdentifier,
        "--device",
        "CORE-DEVICE-ID",
        "--json",
      ],
      { env },
    );
    const stopped = JSON.parse(stopOutput);
    assert.equal(stopped.operation, "stop");
    assert.equal(stopped.stoppedProcessCount, 0);

    const { stdout: help } = await execFileAsync(process.execPath, [
      bin.pathname,
      "device",
      "--help",
    ]);
    assert.match(help, /device status-ios BUNDLE --device ID/u);
    assert.match(help, /device stop-ios BUNDLE --device ID/u);
  },
);
