import assert from "node:assert/strict";
import test from "node:test";

import {
  createSolidNativeIOSProcessStatus,
  formatSolidNativeIOSProcessStatus,
} from "./ios-process-status.mjs";

const processDocument = {
  result: {
    runningProcesses: [
      { executable: "file:///sbin/launchd", processIdentifier: 1 },
      {
        executable:
          "file:///private/var/containers/Bundle/Application/NAV/SolidNativeE2E.app/SolidNativeE2E",
        processIdentifier: 101,
      },
      {
        executable:
          "file:///private/var/containers/Bundle/Application/TEST/SolidNativeE2EUITests-Runner.app/SolidNativeE2EUITests-Runner",
        processIdentifier: 202,
      },
    ],
  },
};

test("maps retained iOS test processes back to their bundle identities", () => {
  const report = createSolidNativeIOSProcessStatus(
    "device-id",
    processDocument,
    {
      result: {
        apps: [
          {
            bundleIdentifier: "dev.solidnative.navigation",
            url: "file:///private/var/containers/Bundle/Application/NAV/SolidNativeE2E.app/",
          },
          {
            bundleIdentifier: "dev.solidnative.e2e.uitests.xctrunner",
            url: "file:///private/var/containers/Bundle/Application/TEST/SolidNativeE2EUITests-Runner.app/",
          },
        ],
      },
    },
  );

  assert.equal(report.schemaVersion, 0);
  assert.equal(report.device, "device-id");
  assert.equal(report.processCount, 2);
  assert.deepEqual(
    report.processes.map(({ processIdentifier, bundleIdentifier }) => ({
      processIdentifier,
      bundleIdentifier,
    })),
    [
      {
        processIdentifier: 101,
        bundleIdentifier: "dev.solidnative.navigation",
      },
      {
        processIdentifier: 202,
        bundleIdentifier: "dev.solidnative.e2e.uitests.xctrunner",
      },
    ],
  );
  assert.match(
    formatSolidNativeIOSProcessStatus(report),
    /PID 101: dev\.solidnative\.navigation/u,
  );
});

test("reports an unmapped executable without inventing a bundle identity", () => {
  const report = createSolidNativeIOSProcessStatus(
    "device-id",
    processDocument,
    { result: { apps: [] } },
  );
  assert.equal(report.processes[0].bundleIdentifier, null);
  assert.match(formatSolidNativeIOSProcessStatus(report), /unknown bundle/u);
});

test("formats a clean device process inventory", () => {
  const report = createSolidNativeIOSProcessStatus(
    "device-id",
    { result: { runningProcesses: [] } },
    { result: { apps: [] } },
  );
  assert.equal(report.processCount, 0);
  assert.equal(
    formatSolidNativeIOSProcessStatus(report),
    "No Solid Native application or test-runner processes are alive on device-id.",
  );
});

test("rejects malformed CoreDevice application output", () => {
  assert.throws(
    () =>
      createSolidNativeIOSProcessStatus("device-id", processDocument, {
        result: {},
      }),
    /result\.apps/u,
  );
});
