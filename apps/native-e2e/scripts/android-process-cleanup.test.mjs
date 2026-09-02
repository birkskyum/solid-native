import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  installAndroidProcessCleanup,
  stopAndroidProcesses,
} from "./android-process-cleanup.mjs";

function completed(stdout = "", status = 0) {
  return { error: undefined, status, stdout, stderr: "" };
}

test("force-stops and verifies every unique Android test process", () => {
  const calls = [];
  const spawn = (command, arguments_) => {
    calls.push([command, ...arguments_]);
    return arguments_.includes("pidof") ? completed("", 1) : completed();
  };
  stopAndroidProcesses("device-1", ["app.one", "app.one", "app.two"], spawn);
  assert.deepEqual(calls, [
    ["adb", "-s", "device-1", "shell", "am", "force-stop", "app.one"],
    ["adb", "-s", "device-1", "shell", "pidof", "app.one"],
    ["adb", "-s", "device-1", "shell", "am", "force-stop", "app.two"],
    ["adb", "-s", "device-1", "shell", "pidof", "app.two"],
  ]);
});

test("attempts every cleanup target and fails when a process survives", () => {
  const stopped = [];
  const spawn = (_command, arguments_) => {
    const bundleIdentifier = arguments_.at(-1);
    if (arguments_.includes("force-stop")) {
      stopped.push(bundleIdentifier);
      return completed();
    }
    return completed(bundleIdentifier === "app.one" ? "812\n" : "", 0);
  };
  assert.throws(
    () => stopAndroidProcesses("device-1", ["app.one", "app.two"], spawn),
    /app\.one remained alive/u,
  );
  assert.deepEqual(stopped, ["app.one", "app.two"]);
});

test("removes Android cleanup hooks after verified completion", () => {
  const before = Object.fromEntries(
    ["exit", "SIGHUP", "SIGINT", "SIGTERM"].map((signal) => [
      signal,
      process.listenerCount(signal),
    ]),
  );
  const spawn = (_command, arguments_) =>
    arguments_.includes("pidof") ? completed("", 1) : completed();
  const finish = installAndroidProcessCleanup("device-1", ["app.one"], spawn);
  for (const signal of Object.keys(before)) {
    assert.equal(process.listenerCount(signal), before[signal] + 1);
  }
  finish();
  for (const signal of Object.keys(before)) {
    assert.equal(process.listenerCount(signal), before[signal]);
  }
});

test("physical Android runners clean up before publishing success", async () => {
  for (const [file, marker] of [
    ["android-list-benchmark.mjs", "SOLID_NATIVE_ANDROID_LIST_RESULT"],
    [
      "android-list-matched-benchmark.mjs",
      "SOLID_NATIVE_ANDROID_LIST_MATCHED_RESULT",
    ],
    [
      "android-telemetry-benchmark.mjs",
      "SOLID_NATIVE_ANDROID_TELEMETRY_RESULT",
    ],
    [
      "android-product-telemetry-benchmark.mjs",
      "SOLID_NATIVE_ANDROID_PRODUCT_TELEMETRY_RESULT",
    ],
    [
      "android-update-matched-benchmark.mjs",
      "${workload.resultMarker} ${JSON.stringify(result)}",
    ],
  ]) {
    const source = await readFile(
      new URL(`./${file}`, import.meta.url),
      "utf8",
    );
    assert.match(source, /installAndroidProcessCleanup/u, file);
    const cleanupIndex = source.lastIndexOf("finishProcessCleanup();");
    assert.notEqual(
      cleanupIndex,
      -1,
      `${file} never finishes process cleanup.`,
    );
    assert.ok(
      cleanupIndex < source.lastIndexOf(marker),
      `${file} publishes success before verified cleanup.`,
    );
  }
});
