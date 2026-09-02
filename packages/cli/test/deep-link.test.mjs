import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  createNativeDeepLinkPlan,
  executeNativeDeepLinkPlan,
  formatNativeDeepLinkPlan,
  parseNativeAndroidDeepLinkExecution,
  parseNativeIosDeepLinkExecution,
} from "../dist/index.js";

const execFileAsync = promisify(execFile);

function commandResult(stdout = "") {
  return { exitCode: 0, stdout, stderr: "", timedOut: false };
}

function installedApplication(bundleIdentifier = "dev.solid.app") {
  return JSON.stringify({
    info: { outcome: "success", jsonVersion: 3 },
    result: {
      apps: [
        {
          bundleIdentifier,
          builtByDeveloper: true,
          name: "Solid App",
          version: "1.2.3",
        },
      ],
    },
  });
}

function iosLaunchResult(processIdentifier, terminateExistingInstances) {
  return JSON.stringify({
    info: { outcome: "success", jsonVersion: 3 },
    result: {
      deviceIdentifier: "DEVICE",
      launchOptions: { terminateExistingInstances },
      process: { processIdentifier },
    },
  });
}

function androidRunner(calls, serial = "PIXEL") {
  return async (command, args, context) => {
    calls.push({ command, args: [...args], context });
    if (args.length === 1 && args[0] === "devices") {
      return commandResult(`List of devices attached\n${serial}\tdevice\n`);
    }
    if (args.at(-1) === "get-state") return commandResult("device\n");
    if (args.includes("packages")) {
      return commandResult("package:dev.solid.app uid:10234\n");
    }
    throw new Error(`Unexpected adb call: ${args.join(" ")}`);
  };
}

function iosApplicationRunner(calls, source = installedApplication()) {
  return async (command, args, context) => {
    calls.push({ command, args: [...args], context });
    const outputIndex = args.indexOf("--json-output");
    assert.ok(outputIndex >= 0);
    await writeFile(args[outputIndex + 1], source);
    return commandResult();
  };
}

test("builds package-scoped Android preserve and cold deep-link plans", async () => {
  const calls = [];
  const preserve = await createNativeDeepLinkPlan({
    platform: "android",
    packageName: "dev.solid.app",
    serial: "PIXEL",
    url: "dev.solid.app://navigation/settings?source=test",
    cwd: "/workspace/app",
    env: { PATH: "/usr/bin" },
    dependencies: { runCommand: androidRunner(calls) },
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(preserve, {
    schemaVersion: 0,
    operation: "open-deep-link",
    platform: "android",
    packageName: "dev.solid.app",
    serial: "PIXEL",
    uid: 10234,
    url: "dev.solid.app://navigation/settings?source=test",
    mode: "preserve",
    terminatesExistingApplication: false,
    cwd: "/workspace/app",
    command: "adb",
    args: [
      "-s",
      "PIXEL",
      "shell",
      "am",
      "start-activity",
      "-W",
      "--user",
      "current",
      "-a",
      "android.intent.action.VIEW",
      "-c",
      "android.intent.category.BROWSABLE",
      "-d",
      "dev.solid.app://navigation/settings?source=test",
      "-p",
      "dev.solid.app",
    ],
  });
  assert.match(
    formatNativeDeepLinkPlan(preserve),
    /start-activity -W --user current.*-p dev\.solid\.app/u,
  );

  const cold = await createNativeDeepLinkPlan({
    platform: "android",
    packageName: "dev.solid.app",
    url: "dev.solid.app://navigation/settings",
    cold: true,
    dependencies: { runCommand: androidRunner([], "PIXEL") },
  });
  assert.equal(cold.mode, "cold");
  assert.equal(cold.terminatesExistingApplication, true);
  assert.equal(cold.serial, "PIXEL");
  assert.ok(cold.args.includes("-S"));
});

test("validates Android delivery against the exact resolved package", async () => {
  const plan = await createNativeDeepLinkPlan({
    platform: "android",
    packageName: "dev.solid.app",
    serial: "PIXEL",
    url: "dev.solid.app://navigation/settings",
    dependencies: { runCommand: androidRunner([]) },
  });
  const source = `Status: ok\nLaunchState: UNKNOWN (0)\nActivity: dev.solid.app/.MainActivity\nComplete\n`;
  assert.deepEqual(parseNativeAndroidDeepLinkExecution(source, plan), {
    schemaVersion: 0,
    operation: "open-deep-link",
    platform: "android",
    packageName: "dev.solid.app",
    serial: "PIXEL",
    url: "dev.solid.app://navigation/settings",
    mode: "preserve",
    terminatesExistingApplication: false,
    activity: "dev.solid.app/.MainActivity",
    launchState: "UNKNOWN (0)",
  });
  assert.throws(
    () =>
      parseNativeAndroidDeepLinkExecution(
        source.replace(
          "dev.solid.app/.MainActivity",
          "dev.other/.MainActivity",
        ),
        plan,
      ),
    /did not confirm/u,
  );
  assert.throws(
    () =>
      parseNativeAndroidDeepLinkExecution(
        source.replace("Status: ok", "Status: timeout"),
        plan,
      ),
    /did not confirm/u,
  );
});

test("builds an iOS CoreDevice plan with a private result placeholder", async () => {
  const calls = [];
  const plan = await createNativeDeepLinkPlan({
    platform: "ios",
    bundleIdentifier: "dev.solid.app",
    device: "DEVICE",
    url: "dev.solid.app://navigation/settings",
    cold: true,
    cwd: "/workspace/app",
    env: { PATH: "/usr/bin" },
    dependencies: {
      hostPlatform: "darwin",
      runCommand: iosApplicationRunner(calls),
    },
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.slice(0, 10), [
    "devicectl",
    "device",
    "info",
    "apps",
    "--device",
    "DEVICE",
    "--bundle-id",
    "dev.solid.app",
    "--quiet",
    "--timeout",
  ]);
  assert.deepEqual(plan.application, {
    bundleIdentifier: "dev.solid.app",
    builtByDeveloper: true,
    name: "Solid App",
    version: "1.2.3",
  });
  assert.equal(plan.mode, "cold");
  assert.equal(plan.terminatesExistingApplication, true);
  assert.deepEqual(plan.args, [
    "devicectl",
    "device",
    "process",
    "launch",
    "--device",
    "DEVICE",
    "--terminate-existing",
    "--payload-url",
    "dev.solid.app://navigation/settings",
    "--quiet",
    "--timeout",
    "15",
    "--json-output",
    "<temporary-coredevice-result.json>",
    "dev.solid.app",
  ]);
  assert.match(
    formatNativeDeepLinkPlan(plan),
    /--payload-url dev\.solid\.app:\/\/navigation\/settings/u,
  );
});

test("executes and strictly consumes CoreDevice launch JSON", async () => {
  const plan = await createNativeDeepLinkPlan({
    platform: "ios",
    bundleIdentifier: "dev.solid.app",
    device: "DEVICE",
    url: "dev.solid.app://navigation/settings",
    dependencies: {
      hostPlatform: "darwin",
      runCommand: iosApplicationRunner([]),
    },
  });
  const calls = [];
  const result = await executeNativeDeepLinkPlan(plan, {
    env: { PATH: "/usr/bin" },
    async runCommand(command, args, context) {
      calls.push({ command, args: [...args], context });
      const outputIndex = args.indexOf("--json-output");
      assert.ok(outputIndex >= 0);
      assert.notEqual(
        args[outputIndex + 1],
        "<temporary-coredevice-result.json>",
      );
      await writeFile(args[outputIndex + 1], iosLaunchResult(418, false));
      return commandResult();
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].context.timeoutMs, 20_000);
  assert.deepEqual(result, {
    schemaVersion: 0,
    operation: "open-deep-link",
    platform: "ios",
    bundleIdentifier: "dev.solid.app",
    device: "DEVICE",
    url: "dev.solid.app://navigation/settings",
    mode: "preserve",
    terminatesExistingApplication: false,
    processIdentifier: 418,
  });
  assert.throws(
    () => parseNativeIosDeepLinkExecution(iosLaunchResult(418, true), plan),
    /did not confirm the requested preserve/u,
  );
});

test("executes only the inspected deep-link plan when injected", async () => {
  const plan = await createNativeDeepLinkPlan({
    platform: "android",
    packageName: "dev.solid.app",
    serial: "PIXEL",
    url: "dev.solid.app://navigation/settings",
    dependencies: { runCommand: androidRunner([]) },
  });
  const expected = {
    schemaVersion: 0,
    operation: "open-deep-link",
    platform: "android",
    packageName: "dev.solid.app",
    serial: "PIXEL",
    url: plan.url,
    mode: "preserve",
    terminatesExistingApplication: false,
    activity: "dev.solid.app/.MainActivity",
    launchState: "HOT",
  };
  const result = await executeNativeDeepLinkPlan(plan, {
    async executor(received, context) {
      assert.equal(received, plan);
      assert.equal(typeof context.runCommand, "function");
      return expected;
    },
  });
  assert.equal(result, expected);
});

test("fails closed on unsafe deep links, targets, devices, and tools", async () => {
  const base = {
    platform: "android",
    packageName: "dev.solid.app",
    serial: "PIXEL",
    dependencies: { runCommand: androidRunner([]) },
  };
  await assert.rejects(
    createNativeDeepLinkPlan({ ...base, url: "/relative" }),
    /absolute URLs/u,
  );
  await assert.rejects(
    createNativeDeepLinkPlan({ ...base, url: "dev.solid.app://bad link" }),
    /without whitespace/u,
  );
  await assert.rejects(
    createNativeDeepLinkPlan({
      ...base,
      platform: "windows",
      url: "dev.solid.app://valid",
    }),
    /require an ios or android platform/u,
  );
  await assert.rejects(
    createNativeDeepLinkPlan({
      ...base,
      cold: "yes",
      url: "dev.solid.app://valid",
    }),
    /cold mode must be a boolean/u,
  );
  await assert.rejects(
    createNativeDeepLinkPlan({
      ...base,
      packageName: "not a package",
      url: "dev.solid.app://valid",
    }),
    /valid dotted application identifier/u,
  );
  await assert.rejects(
    createNativeDeepLinkPlan({
      platform: "ios",
      bundleIdentifier: "dev.solid.app",
      device: "BAD DEVICE",
      url: "dev.solid.app://valid",
      dependencies: {
        hostPlatform: "darwin",
        runCommand: iosApplicationRunner([]),
      },
    }),
    /non-whitespace/u,
  );
  await assert.rejects(
    createNativeDeepLinkPlan({
      platform: "ios",
      bundleIdentifier: "dev.solid.app",
      device: "DEVICE",
      url: "dev.solid.app://valid",
      dependencies: {
        hostPlatform: "linux",
        runCommand: iosApplicationRunner([]),
      },
    }),
    /require macOS and Xcode/u,
  );
  await assert.rejects(
    createNativeDeepLinkPlan({
      ...base,
      url: "dev.solid.app://valid",
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
    /Install Android platform-tools or Xcode/u,
  );
  await assert.rejects(
    createNativeDeepLinkPlan({
      ...base,
      url: "dev.solid.app://valid",
      dependencies: { runCommand: null },
    }),
    /command runner is invalid/u,
  );
});

test("opens an Android deep link through the public CLI", async (t) => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "solid-native-open-cli-"),
  );
  t.after(() => rm(directory, { recursive: true }));
  const adb = path.join(directory, "adb");
  await writeFile(
    adb,
    `#!/bin/sh
case "$*" in
  *get-state*) printf 'device\\n' ;;
  *'list packages'*) printf 'package:dev.solid.app uid:10234\\n' ;;
  *start-activity*) printf 'Status: ok\\nLaunchState: COLD\\nActivity: dev.solid.app/.MainActivity\\nComplete\\n' ;;
  *) exit 9 ;;
esac
`,
  );
  await chmod(adb, 0o755);
  const bin = new URL("../dist/bin.js", import.meta.url);
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      bin.pathname,
      "open",
      "android",
      "dev.solid.app",
      "dev.solid.app://navigation/settings",
      "--serial",
      "PIXEL",
      "--cold",
      "--json",
    ],
    {
      env: {
        ...process.env,
        PATH: `${directory}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    },
  );
  const result = JSON.parse(stdout);
  assert.equal(result.platform, "android");
  assert.equal(result.mode, "cold");
  assert.equal(result.activity, "dev.solid.app/.MainActivity");
});

test(
  "opens an iOS deep link through the public CLI",
  { skip: process.platform !== "darwin" },
  async (t) => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "solid-native-open-ios-cli-"),
    );
    t.after(() => rm(directory, { recursive: true }));
    const xcrun = path.join(directory, "xcrun");
    await writeFile(
      xcrun,
      `#!/bin/sh
output=''
kind=launch
termination=false
for argument in "$@"; do
  if [ "$argument" = 'apps' ]; then kind=apps; fi
  if [ "$argument" = '--terminate-existing' ]; then termination=true; fi
done
while [ "$#" -gt 0 ]; do
  if [ "$1" = '--json-output' ]; then
    shift
    output="$1"
  fi
  shift
done
if [ "$kind" = apps ]; then
  printf '%s' '${installedApplication()}' > "$output"
elif [ "$termination" = true ]; then
  printf '%s' '${iosLaunchResult(519, true)}' > "$output"
else
  printf '%s' '${iosLaunchResult(518, false)}' > "$output"
fi
`,
    );
    await chmod(xcrun, 0o755);
    const bin = new URL("../dist/bin.js", import.meta.url);
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        bin.pathname,
        "open",
        "ios",
        "dev.solid.app",
        "dev.solid.app://navigation/settings",
        "--device",
        "DEVICE",
        "--cold",
        "--json",
      ],
      {
        env: {
          ...process.env,
          PATH: `${directory}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      },
    );
    const result = JSON.parse(stdout);
    assert.equal(result.platform, "ios");
    assert.equal(result.mode, "cold");
    assert.equal(result.processIdentifier, 519);
  },
);

test("documents preserve and cold physical deep-link delivery", async () => {
  const bin = new URL("../dist/bin.js", import.meta.url);
  const { stdout } = await execFileAsync(process.execPath, [
    bin.pathname,
    "open",
    "--help",
  ]);
  assert.match(stdout, /open android PACKAGE URL/u);
  assert.match(stdout, /open ios BUNDLE URL --device ID/u);
  assert.match(stdout, /default preserve mode does not terminate/iu);

  await assert.rejects(
    execFileAsync(process.execPath, [
      bin.pathname,
      "open",
      "ios",
      "dev.solid.app",
      "dev.solid.app://navigation",
    ]),
    /requires --device ID/u,
  );
});
