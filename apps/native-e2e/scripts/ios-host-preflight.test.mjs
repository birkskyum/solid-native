import assert from "node:assert/strict";
import test from "node:test";

import {
  findSustainedConsoleProcesses,
  parseHostProcesses,
} from "./ios-host-preflight.mjs";

const consoleCommand =
  "/System/Applications/Utilities/Console.app/Contents/MacOS/Console";

test("parses bounded host process snapshots", () => {
  assert.deepEqual(
    parseHostProcesses(
      `  101 409.1 ${consoleCommand}\n  202  0.7 /usr/bin/other process\nmalformed\n`,
    ),
    [
      {
        processIdentifier: 101,
        cpuPercent: 409.1,
        command: consoleCommand,
      },
      {
        processIdentifier: 202,
        cpuPercent: 0.7,
        command: "/usr/bin/other process",
      },
    ],
  );
  assert.throws(() => parseHostProcesses(null), /must be text/u);
});

test("detects only a sustained runaway Console device-log relay", () => {
  const first = `101 409.1 ${consoleCommand}\n202 80.0 /usr/bin/other`;
  const second = `101 345.5 ${consoleCommand}\n202 90.0 /usr/bin/other`;
  assert.deepEqual(findSustainedConsoleProcesses(first, second), [
    {
      processIdentifier: 101,
      cpuPercent: 345.5,
      command: consoleCommand,
      firstCpuPercent: 409.1,
    },
  ]);
  assert.deepEqual(
    findSustainedConsoleProcesses(first, `101 0.0 ${consoleCommand}\n`),
    [],
  );
  assert.deepEqual(
    findSustainedConsoleProcesses(`101 2.0 ${consoleCommand}\n`, second),
    [],
  );
  assert.throws(
    () => findSustainedConsoleProcesses(first, second, 0),
    /threshold must be positive/u,
  );
});
