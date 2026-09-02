import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const directory = new URL("./", import.meta.url);
const read = (path) => readFileSync(new URL(path, directory), "utf8");

test("iOS secure-storage runner owns a bounded signed device proof", () => {
  const runner = read("ios-secure-storage-test.sh");
  assert.match(runner, /ios-device-preflight\.mjs/u);
  assert.match(runner, /ios-host-preflight\.mjs/u);
  assert.match(runner, /ensure_solid_native_ios_pods/u);
  assert.match(runner, /start_solid_native_ios_process_guard/u);
  assert.match(runner, /ENTRY_FILE=secure-storage\.tsx/u);
  assert.match(runner, /SOURCEMAP_FILE=/u);
  assert.match(runner, /testSecureStorageOnPhysicalDevice/u);
  assert.match(runner, /verify-secure-storage-sourcemap\.mjs/u);
  assert.match(runner, /SOLID_NATIVE_SECURE_STORAGE_READ_CAUSALITY_SUCCEEDED/u);
  assert.match(runner, /SOLID_NATIVE_SECURE_STORAGE_TEARDOWN_SUCCEEDED/u);
});

test("iOS proof crosses a process boundary and removes its native record", () => {
  const testSource = read(
    "../ios/SolidNativeE2EUITests/SolidNativeE2EUITests.swift",
  );
  const start = testSource.indexOf("func testSecureStorageOnPhysicalDevice()");
  const end = testSource.indexOf(
    "func testAppStateEventDeliveryOnPhysicalDevice()",
    start,
  );
  assert.notEqual(start, -1);
  assert.ok(end > start);
  const proof = testSource.slice(start, end);
  assert.match(proof, /Delete encrypted session proof/u);
  assert.match(proof, /Store encrypted session proof/u);
  assert.match(proof, /launchAndRequireReady\(\)/u);
  assert.match(proof, /Restore encrypted session proof/u);
  assert.match(proof, /Dispose Solid Native secure storage proof/u);
  assert.ok(
    proof.indexOf("Store encrypted session proof") <
      proof.indexOf("Restore encrypted session proof"),
  );
});
