import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseNativeCompatibilityIdentity,
  readNativeCompatibilityIdentity,
} from "./native-benchmark-environment.mjs";

function fixture(overrides = {}) {
  return {
    schemaVersion: 0,
    projectName: "@solid-native/native-e2e",
    targets: [
      {
        platform: "android",
        fingerprint: `sha256:${"a".repeat(64)}`,
        inputs: [{ path: "android/build.gradle", sha256: "b".repeat(64) }],
      },
    ],
    ...overrides,
  };
}

test("parses one bounded native compatibility identity", () => {
  assert.deepEqual(
    parseNativeCompatibilityIdentity(JSON.stringify(fixture()), "android"),
    {
      fingerprint: `sha256:${"a".repeat(64)}`,
      inputCount: 1,
    },
  );
});

test("rejects malformed native compatibility evidence", () => {
  for (const source of [
    "not-json",
    JSON.stringify(fixture({ schemaVersion: 1 })),
    JSON.stringify(fixture({ projectName: "" })),
    JSON.stringify(fixture({ targets: [] })),
    JSON.stringify(
      fixture({
        targets: [
          {
            platform: "ios",
            fingerprint: `sha256:${"a".repeat(64)}`,
            inputs: [{ path: "ios/Podfile", sha256: "b".repeat(64) }],
          },
        ],
      }),
    ),
    JSON.stringify(
      fixture({
        targets: [
          { platform: "android", fingerprint: "sha256:short", inputs: [] },
        ],
      }),
    ),
  ]) {
    assert.throws(
      () => parseNativeCompatibilityIdentity(source, "android"),
      /not valid JSON|omitted a valid android target/u,
    );
  }
});

test("runs the built CLI against the exact benchmark project", () => {
  let invocation;
  const spawn = (command, arguments_, options) => {
    invocation = { command, arguments_, options };
    return {
      error: undefined,
      status: 0,
      stdout: JSON.stringify(fixture()),
      stderr: "",
    };
  };
  const identity = readNativeCompatibilityIdentity(
    "/repo",
    "/repo/apps/native-e2e",
    "android",
    spawn,
  );
  assert.equal(identity.inputCount, 1);
  assert.deepEqual(invocation.arguments_, [
    "/repo/packages/cli/dist/bin.js",
    "fingerprint",
    "--cwd",
    "/repo/apps/native-e2e",
    "--platform",
    "android",
    "--json",
  ]);
  assert.equal(invocation.options.maxBuffer, 2 * 1024 * 1024);
});

test("turns CLI failures into an actionable benchmark error", () => {
  const spawn = () => ({
    error: undefined,
    status: 1,
    stdout: "",
    stderr: "missing CLI output",
  });
  assert.throws(
    () =>
      readNativeCompatibilityIdentity(
        "/repo",
        "/repo/apps/native-e2e",
        "android",
        spawn,
      ),
    /missing CLI output.*Build @solid-native\/cli/u,
  );
});

test("binds iOS memory identity before starting device work", async () => {
  const source = await readFile(
    new URL("./ios-memory-sample.sh", import.meta.url),
    "utf8",
  );
  const identityIndex = source.indexOf("native-benchmark-environment.mjs");
  const firstDeviceCommandIndex = source.indexOf("ios-stop-processes.mjs");

  assert.ok(identityIndex >= 0);
  assert.ok(firstDeviceCommandIndex >= 0);
  assert.ok(identityIndex < firstDeviceCommandIndex);
  assert.match(source, /NATIVE_COMPATIBILITY_IDENTITY=\$\(node [^)]+\)/u);
  assert.match(
    source,
    /SOLID_NATIVE_MEMORY_NATIVE_COMPATIBILITY_FINGERPRINT=/u,
  );
  assert.match(
    source,
    /SOLID_NATIVE_MEMORY_NATIVE_COMPATIBILITY_INPUT_COUNT=/u,
  );
});
