import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  createNativeAndroidLogsPlan,
  defaultNativeAndroidLogsExecutor,
  executeNativeAndroidLogsPlan,
  formatNativeAndroidLogsPlan,
  parseAndroidPackageUid,
  parseAuthorizedAndroidDevices,
} from "../dist/index.js";

const execFileAsync = promisify(execFile);

const passed = (stdout = "") => ({
  exitCode: 0,
  stdout,
  stderr: "",
  timedOut: false,
});

function androidRunner(
  calls,
  packageOutput = "package:dev.solid.app uid:10123\n",
) {
  return async (command, args, context) => {
    calls.push({ command, args: [...args], context });
    if (args.length === 1 && args[0] === "devices") {
      return passed("List of devices attached\nPIXEL\tdevice usb:1-2\n");
    }
    if (args.at(-1) === "get-state") return passed("device\n");
    if (args.includes("packages")) return passed(packageOutput);
    throw new Error(`Unexpected adb call: ${args.join(" ")}`);
  };
}

test("parses only authorized Android devices and exact package UIDs", () => {
  assert.deepEqual(
    parseAuthorizedAndroidDevices(
      "List of devices attached\nPIXEL\tdevice usb:1\nOFFLINE\toffline\nPIXEL\tdevice\nUNAUTHORIZED\tunauthorized\nEMULATOR device product:sdk\n",
    ),
    ["PIXEL", "EMULATOR"],
  );
  assert.equal(
    parseAndroidPackageUid(
      "package:dev.solid.app.debug uid:10124\npackage:dev.solid.app uid:10123\n",
      "dev.solid.app",
    ),
    10123,
  );
  assert.equal(
    parseAndroidPackageUid(
      "package:dev.solid.app uid:10123\npackage:dev.solid.app uid:10123\n",
      "dev.solid.app",
    ),
    undefined,
  );
});

test("builds an app-UID-scoped live log plan for one authorized device", async () => {
  const calls = [];
  const plan = await createNativeAndroidLogsPlan({
    packageName: "dev.solid.app",
    cwd: "/workspace/app",
    env: { PATH: "/tools" },
    dependencies: { runCommand: androidRunner(calls) },
  });
  assert.deepEqual(plan, {
    schemaVersion: 0,
    operation: "logs",
    platform: "android",
    packageName: "dev.solid.app",
    serial: "PIXEL",
    uid: 10123,
    since: "1",
    cwd: "/workspace/app",
    command: "adb",
    args: [
      "-s",
      "PIXEL",
      "logcat",
      "--uid=10123",
      "-v",
      "threadtime",
      "-T",
      "1",
    ],
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].args, ["devices"]);
  assert.deepEqual(calls[1].args, ["-s", "PIXEL", "get-state"]);
  assert.deepEqual(calls[2].args, [
    "-s",
    "PIXEL",
    "shell",
    "cmd",
    "package",
    "list",
    "packages",
    "-U",
    "dev.solid.app",
  ]);
  assert.equal(calls[0].context.timeoutMs, 10_000);
  assert.equal(calls[0].context.env.PATH, "/tools");
});

test("uses an explicit device and preserves a bounded logcat history value", async () => {
  const calls = [];
  const plan = await createNativeAndroidLogsPlan({
    packageName: "dev.solid.app",
    serial: "4A291JEBF12962",
    since: "08-25 12:00:00.000",
    dependencies: { runCommand: androidRunner(calls) },
  });
  assert.equal(
    calls.some((call) => call.args[0] === "devices"),
    false,
  );
  assert.equal(plan.serial, "4A291JEBF12962");
  assert.equal(plan.since, "08-25 12:00:00.000");
  assert.equal(
    formatNativeAndroidLogsPlan(plan),
    "adb -s 4A291JEBF12962 logcat --uid=10123 -v threadtime -T '08-25 12:00:00.000'",
  );
});

test("fails closed on ambiguous devices, unavailable packages, and unsafe input", async () => {
  await assert.rejects(
    createNativeAndroidLogsPlan({
      packageName: "not-a-package",
      dependencies: { runCommand: androidRunner([]) },
    }),
    /valid dotted application package/u,
  );
  await assert.rejects(
    createNativeAndroidLogsPlan({
      packageName: "dev.solid.app",
      serial: "BAD SERIAL",
      dependencies: { runCommand: androidRunner([]) },
    }),
    /non-whitespace characters/u,
  );
  await assert.rejects(
    createNativeAndroidLogsPlan({
      packageName: "dev.solid.app",
      since: "bad\nvalue",
      dependencies: { runCommand: androidRunner([]) },
    }),
    /printable logcat/u,
  );
  await assert.rejects(
    createNativeAndroidLogsPlan({
      packageName: "dev.solid.app",
      dependencies: {
        runCommand: async () => passed("List of devices attached\n"),
      },
    }),
    /exactly one authorized Android device; found 0/u,
  );
  await assert.rejects(
    createNativeAndroidLogsPlan({
      packageName: "dev.solid.app",
      dependencies: {
        runCommand: androidRunner(
          [],
          "package:dev.solid.app.debug uid:10124\n",
        ),
      },
    }),
    /is not installed exactly once/u,
  );
  await assert.rejects(
    createNativeAndroidLogsPlan({
      packageName: "dev.solid.app",
      dependencies: {
        runCommand: async () => ({
          exitCode: null,
          stdout: "",
          stderr: "spawn adb ENOENT",
          timedOut: false,
          errorCode: "ENOENT",
        }),
      },
    }),
    /Install Android platform-tools/u,
  );
});

test("executes the exact inspected stream and preserves its exit status", async () => {
  const calls = [];
  const plan = await createNativeAndroidLogsPlan({
    packageName: "dev.solid.app",
    dependencies: { runCommand: androidRunner(calls) },
  });
  const exitCode = await executeNativeAndroidLogsPlan(plan, {
    env: { PATH: "/platform-tools" },
    async executor(received, context) {
      assert.equal(received, plan);
      assert.equal(context.env.PATH, "/platform-tools");
      return 130;
    },
  });
  assert.equal(exitCode, 130);
});

test("reports the forwarded signal even when logcat handles it", async () => {
  const indexURL = new URL("../dist/index.js", import.meta.url).href;
  const source = `
    import { defaultNativeAndroidLogsExecutor } from ${JSON.stringify(indexURL)};
    const execution = defaultNativeAndroidLogsExecutor({
      schemaVersion: 0,
      operation: "logs",
      platform: "android",
      packageName: "dev.solid.app",
      serial: "PIXEL",
      uid: 10123,
      since: "1",
      cwd: process.cwd(),
      command: process.execPath,
      args: ["--eval", 'process.on("SIGTERM", () => process.exit(7)); setInterval(() => {}, 1000)'],
    }, { env: process.env });
    setTimeout(() => process.kill(process.pid, "SIGTERM"), 100);
    process.stdout.write(String(await execution));
  `;
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--input-type=module", "--eval", source],
    { timeout: 5_000 },
  );
  assert.equal(stdout, "143");

  // Retain a direct reference so this test also guards the public export.
  assert.equal(typeof defaultNativeAndroidLogsExecutor, "function");
});

test("exposes help and a machine-readable executable dry run", async (t) => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "solid-native-android-logs-"),
  );
  t.after(() => rm(directory, { recursive: true }));
  const adb = path.join(directory, "adb");
  await writeFile(
    adb,
    `#!/bin/sh
case "$*" in
  *"get-state"*) printf 'device\\n' ;;
  *"package list packages"*) printf 'package:dev.solid.app uid:10123\\n' ;;
  *) exit 9 ;;
esac
`,
  );
  await chmod(adb, 0o755);
  const bin = new URL("../dist/bin.js", import.meta.url);
  const [{ stdout: help }, { stdout: output }] = await Promise.all([
    execFileAsync(process.execPath, [bin.pathname, "logs", "--help"]),
    execFileAsync(
      process.execPath,
      [
        bin.pathname,
        "logs",
        "android",
        "dev.solid.app",
        "--serial",
        "PIXEL",
        "--since",
        "25",
        "--dry-run",
        "--json",
      ],
      {
        env: {
          ...process.env,
          PATH: `${directory}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      },
    ),
  ]);
  assert.match(help, /streams only that UID/u);
  const plan = JSON.parse(output);
  assert.equal(plan.operation, "logs");
  assert.equal(plan.serial, "PIXEL");
  assert.equal(plan.uid, 10123);
  assert.equal(plan.since, "25");
  await assert.rejects(
    execFileAsync(process.execPath, [
      bin.pathname,
      "logs",
      "android",
      "dev.solid.app",
      "--json",
    ]),
    /requires --dry-run/u,
  );
});
