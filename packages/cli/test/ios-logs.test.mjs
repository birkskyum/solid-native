import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  createNativeIosLogsPlan,
  defaultNativeIosLogsExecutor,
  executeNativeIosLogsPlan,
  formatNativeIosLogsPlan,
  parseNativeIosInstalledApplication,
} from "../dist/index.js";

const execFileAsync = promisify(execFile);

function applicationResult(bundleIdentifier = "dev.solid.app", overrides = {}) {
  return JSON.stringify({
    info: { outcome: "success", jsonVersion: 3 },
    result: {
      apps: [
        {
          bundleIdentifier,
          builtByDeveloper: true,
          name: "Solid App",
          version: "1.2.3",
          ...overrides,
        },
      ],
    },
  });
}

function iosRunner(calls, resultSource = applicationResult()) {
  return async (command, args, context) => {
    calls.push({ command, args: [...args], context });
    const outputIndex = args.indexOf("--json-output");
    assert.ok(outputIndex >= 0);
    await writeFile(args[outputIndex + 1], resultSource);
    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
    };
  };
}

test("parses exactly one developer-installed iOS application", () => {
  assert.deepEqual(
    parseNativeIosInstalledApplication(applicationResult(), "dev.solid.app"),
    {
      bundleIdentifier: "dev.solid.app",
      builtByDeveloper: true,
      name: "Solid App",
      version: "1.2.3",
    },
  );
  assert.throws(
    () =>
      parseNativeIosInstalledApplication(
        applicationResult("dev.solid.app", { builtByDeveloper: false }),
        "dev.solid.app",
      ),
    /not a developer-installed application/u,
  );
  assert.throws(
    () =>
      parseNativeIosInstalledApplication(
        JSON.stringify({ info: { outcome: "success" }, result: { apps: [] } }),
        "dev.solid.app",
      ),
    /not installed exactly once/u,
  );
  assert.throws(
    () =>
      parseNativeIosInstalledApplication(
        JSON.stringify({ info: { outcome: "failure" }, result: { apps: [] } }),
        "dev.solid.app",
      ),
    /did not return a successful/u,
  );
});

test("builds an explicit CoreDevice restart-console plan", async () => {
  const calls = [];
  const plan = await createNativeIosLogsPlan({
    bundleIdentifier: "dev.solid.app",
    device: "CORE-DEVICE-ID",
    restart: true,
    cwd: "/workspace/app",
    env: { PATH: "/usr/bin" },
    dependencies: { hostPlatform: "darwin", runCommand: iosRunner(calls) },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "xcrun");
  assert.deepEqual(calls[0].args.slice(0, 10), [
    "devicectl",
    "device",
    "info",
    "apps",
    "--device",
    "CORE-DEVICE-ID",
    "--bundle-id",
    "dev.solid.app",
    "--quiet",
    "--timeout",
  ]);
  assert.equal(calls[0].context.cwd, "/workspace/app");
  assert.equal(calls[0].context.env.PATH, "/usr/bin");
  assert.equal(calls[0].context.timeoutMs, 12_000);
  assert.deepEqual(plan, {
    schemaVersion: 0,
    operation: "logs",
    platform: "ios",
    bundleIdentifier: "dev.solid.app",
    device: "CORE-DEVICE-ID",
    application: {
      bundleIdentifier: "dev.solid.app",
      builtByDeveloper: true,
      name: "Solid App",
      version: "1.2.3",
    },
    restartsApplication: true,
    includesHistoricalLogs: false,
    cwd: "/workspace/app",
    command: "xcrun",
    args: [
      "devicectl",
      "device",
      "process",
      "launch",
      "--device",
      "CORE-DEVICE-ID",
      "--terminate-existing",
      "--console",
      "--quiet",
      "dev.solid.app",
    ],
  });
  assert.equal(
    formatNativeIosLogsPlan(plan),
    "xcrun devicectl device process launch --device CORE-DEVICE-ID --terminate-existing --console --quiet dev.solid.app",
  );
});

test("fails closed on unsafe targets and CoreDevice discovery failures", async () => {
  await assert.rejects(
    createNativeIosLogsPlan({
      bundleIdentifier: "not a bundle",
      device: "DEVICE",
      restart: true,
      dependencies: { hostPlatform: "darwin", runCommand: iosRunner([]) },
    }),
    /valid dotted bundle identifier/u,
  );
  await assert.rejects(
    createNativeIosLogsPlan({
      bundleIdentifier: "dev.solid.app",
      device: "BAD DEVICE",
      restart: true,
      dependencies: { hostPlatform: "darwin", runCommand: iosRunner([]) },
    }),
    /non-whitespace characters/u,
  );
  await assert.rejects(
    createNativeIosLogsPlan({
      bundleIdentifier: "dev.solid.app",
      device: "DEVICE",
      restart: true,
      dependencies: { hostPlatform: "linux", runCommand: iosRunner([]) },
    }),
    /requires macOS and Xcode/u,
  );
  await assert.rejects(
    createNativeIosLogsPlan({
      bundleIdentifier: "dev.solid.app",
      device: "DEVICE",
      restart: true,
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
    createNativeIosLogsPlan({
      bundleIdentifier: "dev.solid.app",
      device: "DEVICE",
      restart: true,
      dependencies: {
        hostPlatform: "darwin",
        runCommand: iosRunner(
          [],
          JSON.stringify({
            info: { outcome: "success" },
            result: { apps: [] },
          }),
        ),
      },
    }),
    /not installed exactly once/u,
  );
});

test("executes only the inspected iOS console plan", async () => {
  const plan = await createNativeIosLogsPlan({
    bundleIdentifier: "dev.solid.app",
    device: "DEVICE",
    restart: true,
    dependencies: { hostPlatform: "darwin", runCommand: iosRunner([]) },
  });
  const exitCode = await executeNativeIosLogsPlan(plan, {
    env: { PATH: "/usr/bin" },
    async executor(received, context) {
      assert.equal(received, plan);
      assert.equal(context.env.PATH, "/usr/bin");
      return 130;
    },
  });
  assert.equal(exitCode, 130);
});

test("reports the forwarded signal even when CoreDevice handles it", async () => {
  const indexURL = new URL("../dist/index.js", import.meta.url).href;
  const source = `
    import { defaultNativeIosLogsExecutor } from ${JSON.stringify(indexURL)};
    const execution = defaultNativeIosLogsExecutor({
      schemaVersion: 0,
      operation: "logs",
      platform: "ios",
      bundleIdentifier: "dev.solid.app",
      device: "DEVICE",
      application: { bundleIdentifier: "dev.solid.app", builtByDeveloper: true, name: "Solid App", version: "1" },
      restartsApplication: true,
      includesHistoricalLogs: false,
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

  assert.equal(typeof defaultNativeIosLogsExecutor, "function");
});

test(
  "exposes an acknowledged machine-readable iOS logging dry run",
  { skip: process.platform !== "darwin" },
  async (t) => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "solid-native-ios-logs-cli-"),
    );
    t.after(() => rm(directory, { recursive: true }));
    const xcrun = path.join(directory, "xcrun");
    await writeFile(
      xcrun,
      `#!/bin/sh
output=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = '--json-output' ]; then
    shift
    output="$1"
  fi
  shift
done
printf '%s' '${applicationResult()}' > "$output"
`,
    );
    await chmod(xcrun, 0o755);
    const bin = new URL("../dist/bin.js", import.meta.url);
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        bin.pathname,
        "logs",
        "ios",
        "dev.solid.app",
        "--device",
        "CORE-DEVICE-ID",
        "--restart",
        "--dry-run",
        "--json",
      ],
      {
        env: {
          ...process.env,
          PATH: `${directory}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      },
    );
    const plan = JSON.parse(stdout);
    assert.equal(plan.platform, "ios");
    assert.equal(plan.restartsApplication, true);
    assert.equal(plan.includesHistoricalLogs, false);

    await assert.rejects(
      execFileAsync(process.execPath, [
        bin.pathname,
        "logs",
        "ios",
        "dev.solid.app",
        "--device",
        "CORE-DEVICE-ID",
      ]),
      /requires --restart/u,
    );
  },
);

test("documents both platform logging contracts", async () => {
  const bin = new URL("../dist/bin.js", import.meta.url);
  const { stdout } = await execFileAsync(process.execPath, [
    bin.pathname,
    "logs",
    "--help",
  ]);
  assert.match(stdout, /logs android PACKAGE/u);
  assert.match(stdout, /logs ios BUNDLE --device ID --restart/u);
  assert.match(stdout, /does not include historical logs/u);
});
