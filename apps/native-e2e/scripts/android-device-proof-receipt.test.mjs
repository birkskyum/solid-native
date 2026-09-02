import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ANDROID_DEVICE_PROOF_SOURCE_POLICY,
  parseAndroidBatteryState,
  parseAndroidDeviceProofReceipt,
  parseAndroidDeviceProofSourcePolicy,
  parseAndroidInstrumentationResult,
  parseGeneratedBindingIdentity,
} from "./android-device-proof-receipt.mjs";

const HEX = "a".repeat(64);
const FINGERPRINT = `sha256:${HEX}`;
const RETAINED_PROOF_REVISION = "024de1df3558d1c910ea9add17fba0f448fd7749";

function instrumentationXml(overrides = {}) {
  const values = {
    failures: "0",
    errors: "0",
    skipped: "0",
    flavor: "solid",
    name: "testPhysicalRendererUpdate",
    ...overrides,
  };
  return `<?xml version='1.0' encoding='UTF-8' ?>
<testsuites tests="1" failures="${values.failures}" errors="${values.errors}" skipped="${values.skipped}" time="32.635" timestamp="2026-08-24T17:53:04" hostname="localhost">
  <testsuite name="dev.solidnative.e2e.SolidNativePhysicalTest" tests="1" failures="${values.failures}" errors="${values.errors}" skipped="${values.skipped}" time="30.962" timestamp="2026-08-24T17:53:04" hostname="localhost">
    <properties>
      <property name="device" value="Pixel 9a - 17" />
      <property name="flavor" value="${values.flavor}" />
      <property name="project" value=":app" />
    </properties>
    <testcase name="${values.name}" classname="dev.solidnative.e2e.SolidNativePhysicalTest" time="30.962" />
  </testsuite>
</testsuites>`;
}

function sourcePolicy(overrides = {}) {
  return JSON.stringify({
    schemaVersion: 0,
    ok: true,
    sourceMapPath: "/private/build/index.android.bundle.map",
    sourceCount: 664,
    checks: ANDROID_DEVICE_PROOF_SOURCE_POLICY.map((check) => ({
      ...check,
      status: "pass",
    })),
    ...overrides,
  });
}

function validReceipt() {
  return {
    schemaVersion: 0,
    proof: "solid-native-android-release-device",
    status: "passed",
    measuredAt: "2026-08-24T17:54:00.000Z",
    source: {
      revision: "b".repeat(40),
      dirty: false,
    },
    device: {
      kind: "physical",
      serialSha256: FINGERPRINT,
      manufacturer: "Google",
      model: "Pixel 9a",
      product: "tegu",
      abi: "arm64-v8a",
      osVersion: "17",
      sdkLevel: 37,
      buildFingerprintSha256: FINGERPRINT,
      batteryLevel: 100,
      batteryTemperatureCelsius: 29.4,
      lowPowerMode: false,
    },
    nativeCompatibility: {
      fingerprint: FINGERPRINT,
      inputCount: 12,
    },
    generatedBindings: {
      bytes: 24_000,
      fileSha256: HEX,
      manifestSha256: HEX,
    },
    bundle: {
      bytes: 8_000_000,
      sha256: HEX,
      sourceCount: 664,
      checks: ANDROID_DEVICE_PROOF_SOURCE_POLICY,
    },
    artifacts: {
      applicationApk: { bytes: 80_000_000, sha256: HEX },
      instrumentationApk: { bytes: 1_000_000, sha256: HEX },
    },
    instrumentation: {
      className: "dev.solidnative.e2e.SolidNativePhysicalTest",
      testName: "testPhysicalRendererUpdate",
      reportedAt: "2026-08-24T17:53:04.000Z",
      durationSeconds: 30.962,
      resultBytes: 687,
      resultSha256: HEX,
      exitCodeSha256: HEX,
    },
  };
}

test("parses exactly one passing Solid Release instrumentation result", () => {
  assert.deepEqual(parseAndroidInstrumentationResult(instrumentationXml()), {
    className: "dev.solidnative.e2e.SolidNativePhysicalTest",
    durationSeconds: 30.962,
    reportedAt: "2026-08-24T17:53:04.000Z",
    testName: "testPhysicalRendererUpdate",
  });
  assert.throws(
    () =>
      parseAndroidInstrumentationResult(instrumentationXml({ failures: "1" })),
    /reported a failure/u,
  );
  assert.throws(
    () =>
      parseAndroidInstrumentationResult(
        instrumentationXml({ flavor: "debug" }),
      ),
    /unexpected Gradle target/u,
  );
  assert.throws(
    () =>
      parseAndroidInstrumentationResult(
        instrumentationXml({ name: "otherTest" }),
      ),
    /unexpected test/u,
  );
  assert.throws(
    () =>
      parseAndroidInstrumentationResult(
        `<!DOCTYPE test [<!ENTITY x "unsafe">]>${instrumentationXml()}`,
      ),
    /document type or entity/u,
  );
});

test("accepts only the exact wrapper-free Android source policy", () => {
  assert.deepEqual(parseAndroidDeviceProofSourcePolicy(sourcePolicy()), {
    sourceCount: 664,
    checks: ANDROID_DEVICE_PROOF_SOURCE_POLICY,
  });
  const mismatched = ANDROID_DEVICE_PROOF_SOURCE_POLICY.map((check) => ({
    ...check,
    status: "pass",
  }));
  mismatched[0].matches = 2;
  assert.throws(
    () =>
      parseAndroidDeviceProofSourcePolicy(sourcePolicy({ checks: mismatched })),
    /drifted or failed/u,
  );
  assert.throws(
    () => parseAndroidDeviceProofSourcePolicy(sourcePolicy({ ok: false })),
    /did not pass/u,
  );
});

test("extracts bounded generated-binding and physical battery identities", () => {
  assert.equal(
    parseGeneratedBindingIdentity(
      `export const manifest = { bindingSha256: "${HEX}" };`,
    ),
    HEX,
  );
  assert.throws(
    () =>
      parseGeneratedBindingIdentity(
        `bindingSha256: "${HEX}"; bindingSha256: "${HEX}";`,
      ),
    /exactly one/u,
  );
  assert.deepEqual(
    parseAndroidBatteryState("  level: 100\n  temperature: 294\n"),
    { level: 100, temperatureCelsius: 29.4 },
  );
  assert.throws(
    () => parseAndroidBatteryState("level: 101\ntemperature: 294\n"),
    /battery level/u,
  );
});

test("validates a path-free, privacy-safe device proof receipt", () => {
  const receipt = validReceipt();
  assert.deepEqual(
    parseAndroidDeviceProofReceipt(`${JSON.stringify(receipt)}\n`),
    receipt,
  );

  const emulator = structuredClone(receipt);
  emulator.device.kind = "emulator";
  assert.throws(
    () => parseAndroidDeviceProofReceipt(JSON.stringify(emulator)),
    /not physical/u,
  );

  const pathful = structuredClone(receipt);
  pathful.artifacts.applicationApk.path = "/private/app.apk";
  assert.throws(
    () => parseAndroidDeviceProofReceipt(JSON.stringify(pathful)),
    /unexpected fields/u,
  );

  const policyDrift = structuredClone(receipt);
  policyDrift.bundle.checks[0].matches = 2;
  assert.throws(
    () => parseAndroidDeviceProofReceipt(JSON.stringify(policyDrift)),
    /bundle.checks drifted/u,
  );

  const secretSerial = structuredClone(receipt);
  secretSerial.device.serialSha256 = "4A291JEBF12962";
  assert.throws(
    () => parseAndroidDeviceProofReceipt(JSON.stringify(secretSerial)),
    /privacy-safe identities/u,
  );
});

test("retains the validated legacy schema-0 Pixel proof", () => {
  const receipt = parseAndroidDeviceProofReceipt(
    readFileSync(
      new URL(
        "../device-proofs/android-solid-release-pixel-9a-024de1d.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(receipt.source.revision, RETAINED_PROOF_REVISION);
  assert.equal(receipt.source.dirty, false);
  assert.equal(receipt.device.kind, "physical");
  assert.equal(receipt.device.model, "Pixel 9a");
  assert.equal(receipt.bundle.sourceCount, 664);
  assert.equal(receipt.instrumentation.testName, "testPhysicalRendererUpdate");
});
