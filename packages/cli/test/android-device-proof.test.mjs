import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  createNativeAndroidDeviceProof,
  parseNativeAndroidInstrumentationResult,
  readNativeDeviceProofReceipt,
} from "../dist/index.js";

const NOW = new Date("2026-08-24T20:00:01.000Z");
const NOT_BEFORE = "2026-08-24T20:00:00.000Z";
const REVISION = "0123456789abcdef0123456789abcdef01234567";
const NATIVE_FINGERPRINT = `sha256:${"d".repeat(64)}`;
const INSTRUMENTATION_CLASS = "com.example.product.SolidNativeReleaseTest";
const INSTRUMENTATION_TEST = "testProductionRenderer";
const execFileAsync = promisify(execFile);
const CLI = fileURLToPath(new URL("../dist/bin.js", import.meta.url));

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function instrumentationXml(overrides = {}) {
  const values = {
    className: INSTRUMENTATION_CLASS,
    testName: INSTRUMENTATION_TEST,
    failures: 0,
    ...overrides,
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites tests="1" failures="${String(values.failures)}" errors="0" skipped="0">
  <testsuite name="${values.className}" tests="1" failures="${String(values.failures)}" errors="0" skipped="0" timestamp="2026-08-24T20:00:00.500">
    <testcase name="${values.testName}" classname="${values.className}" time="1.250" />
  </testsuite>
</testsuites>
`;
}

async function fixture(t, commandOverrides = {}) {
  const directory = await mkdtemp(
    path.join(tmpdir(), "solid-native-android-proof-producer-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const results = path.join(directory, "results");
  await mkdir(results);
  const paths = {
    applicationBundlePath: path.join(directory, "index.android.bundle"),
    sourceMapPath: path.join(directory, "index.android.bundle.map"),
    applicationApkPath: path.join(directory, "app-release.apk"),
    instrumentationApkPath: path.join(directory, "app-release-test.apk"),
    generatedBindingsPath: path.join(directory, "SolidNativeBindings.ts"),
    instrumentationResultsDirectory: results,
    outputPath: path.join(directory, "android-device-proof.json"),
  };
  const resultPath = path.join(results, "TEST-product.xml");
  const exitCodePath = path.join(results, "test-result-exit-code.txt");
  const bundle = Buffer.from("globalThis.__solidNativeProof = true;\n");
  const sourceMap = Buffer.from(
    `${JSON.stringify({
      version: 3,
      file: "index.android.bundle",
      sources: ["app:///src/physical-device-test.tsx"],
      sourcesContent: ["export const proof = true;\n"],
      names: [],
      mappings: "AAAA",
    })}\n`,
  );
  await Promise.all([
    writeFile(paths.applicationBundlePath, bundle),
    writeFile(paths.sourceMapPath, sourceMap),
    writeFile(paths.applicationApkPath, "application apk\n"),
    writeFile(paths.instrumentationApkPath, "instrumentation apk\n"),
    writeFile(
      paths.generatedBindingsPath,
      `export const solidNativeBindingManifest = { bindingSha256: "${"a".repeat(64)}" };\n`,
    ),
    writeFile(resultPath, instrumentationXml()),
    writeFile(exitCodePath, "0\n"),
  ]);
  await Promise.all([
    utimes(resultPath, NOW, new Date("2026-08-24T20:00:00.500Z")),
    utimes(exitCodePath, NOW, new Date("2026-08-24T20:00:00.500Z")),
  ]);

  const calls = [];
  const values = {
    "get-state": "device",
    "shell getprop ro.kernel.qemu": "0",
    "shell getprop ro.boot.qemu": "0",
    "shell getprop ro.build.fingerprint": "example/product/device:17/release",
    "shell dumpsys battery": "level: 82\ntemperature: 301\n",
    "shell settings get global low_power": "0",
    "shell getprop ro.product.manufacturer": "Example",
    "shell getprop ro.product.model": "Physical One",
    "shell getprop ro.product.name": "product_one",
    "shell getprop ro.product.cpu.abi": "arm64-v8a",
    "shell getprop ro.build.version.release": "17",
    "shell getprop ro.build.version.sdk": "37",
    ...commandOverrides.adb,
  };
  const runCommand = async (command, args) => {
    calls.push([command, ...args]);
    if (command === "git") {
      const operation = args.slice(2).join(" ");
      const stdout =
        operation === "rev-parse --show-toplevel"
          ? directory
          : operation === "rev-parse HEAD"
            ? REVISION
            : operation === "status --porcelain=v1 --untracked-files=normal"
              ? (commandOverrides.gitStatus ?? "")
              : undefined;
      assert.notEqual(stdout, undefined, `unexpected git command ${operation}`);
      return { exitCode: 0, stdout, stderr: "", timedOut: false };
    }
    assert.equal(command, "adb");
    assert.deepEqual(args.slice(0, 2), ["-s", "physical-serial"]);
    const operation = args.slice(2).join(" ");
    await commandOverrides.onCommand?.({
      command,
      operation,
      paths,
      resultPath,
      exitCodePath,
    });
    assert.ok(operation in values, `unexpected adb command ${operation}`);
    return {
      exitCode: 0,
      stdout: values[operation],
      stderr: "",
      timedOut: false,
    };
  };
  const createFingerprint = async () => ({
    schemaVersion: 0,
    algorithm: "sha256",
    projectRoot: directory,
    projectName: "portable-product",
    runtime: {},
    targets: [
      {
        platform: "android",
        fingerprint: NATIVE_FINGERPRINT,
        inputs: [
          { path: "android/app/build.gradle", sha256: "e".repeat(64) },
          { path: "package.json", sha256: "f".repeat(64) },
        ],
      },
    ],
  });
  return {
    directory,
    paths,
    calls,
    bundle,
    sourceMap,
    options: {
      cwd: directory,
      serial: "physical-serial",
      notBefore: NOT_BEFORE,
      ...paths,
      instrumentationClass: INSTRUMENTATION_CLASS,
      instrumentationTest: INSTRUMENTATION_TEST,
      requiredSources: ["app:///src/physical-device-test.tsx"],
      forbiddenSourceFragments: ["/node_modules/react/"],
      dependencies: {
        now: () => new Date(NOW),
        runCommand,
        createFingerprint,
      },
    },
  };
}

test("produces one immutable schema-1 proof from physical execution", async (t) => {
  const context = await fixture(t);
  const result = await createNativeAndroidDeviceProof(context.options);
  assert.equal(result.receipt.schemaVersion, 1);
  assert.equal(result.receipt.source.revision, REVISION);
  assert.equal(result.receipt.source.dirty, false);
  assert.equal(result.receipt.device.kind, "physical");
  assert.equal(result.receipt.device.model, "Physical One");
  assert.equal(result.receipt.device.batteryTemperatureCelsius, 30.1);
  assert.equal(
    result.receipt.nativeCompatibility.fingerprint,
    NATIVE_FINGERPRINT,
  );
  assert.equal(result.receipt.nativeCompatibility.inputCount, 2);
  assert.deepEqual(result.receipt.bundle, {
    bytes: context.bundle.length,
    sha256: digest(context.bundle),
  });
  assert.equal(result.receipt.sourceMap.bytes, context.sourceMap.length);
  assert.equal(result.receipt.sourceMap.sha256, digest(context.sourceMap));
  assert.equal(result.receipt.sourceMap.sourceCount, 1);
  assert.equal(result.receipt.sourceMap.checks.length, 2);
  assert.equal(result.receipt.instrumentation.resultBytes > 0, true);
  assert.match(result.receiptSha256, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(result.profile.receiptSchemaVersion, 1);
  assert.deepEqual(
    await readNativeDeviceProofReceipt(result.receiptPath),
    result.receipt,
  );
  assert.equal(
    context.calls.filter((call) => call.join(" ").endsWith("get-state")).length,
    2,
  );

  await assert.rejects(
    createNativeAndroidDeviceProof(context.options),
    /already exists; evidence files are immutable/u,
  );
});

test("rejects emulator, dirty, and mismatched instrumentation evidence", async (t) => {
  const emulator = await fixture(t, {
    adb: { "shell getprop ro.kernel.qemu": "1" },
  });
  await assert.rejects(
    createNativeAndroidDeviceProof(emulator.options),
    /cannot be produced from an emulator/u,
  );

  const dirty = await fixture(t, { gitStatus: " M src/index.ts" });
  await assert.rejects(
    createNativeAndroidDeviceProof(dirty.options),
    /requires a clean source checkout/u,
  );

  assert.throws(
    () =>
      parseNativeAndroidInstrumentationResult(
        instrumentationXml({ testName: "testTrivial" }),
        INSTRUMENTATION_CLASS,
        INSTRUMENTATION_TEST,
      ),
    /unexpected test/u,
  );
});

test("exposes fail-closed Android producer arguments through the CLI", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [
      CLI,
      "device-proof",
      "create-android",
      "--serial",
      "physical-serial",
    ]),
    /requires --not-before, --bundle, --source-map, --apk, --instrumentation-apk, --bindings, --instrumentation-results, --instrumentation-class, --instrumentation-test, --require, --output/u,
  );
  const help = await execFileAsync(process.execPath, [
    CLI,
    "device-proof",
    "create-android",
    "--help",
  ]);
  assert.match(help.stdout, /create-android --serial ID --not-before UTC/u);
  assert.match(help.stdout, /never overwrites existing evidence/u);
});

test("rejects late artifact and compatibility mutations", async (t) => {
  let artifactChanged = false;
  const artifact = await fixture(t, {
    onCommand: async ({ operation, paths }) => {
      if (operation === "shell dumpsys battery" && !artifactChanged) {
        artifactChanged = true;
        await writeFile(paths.applicationApkPath, "changed application apk\n");
      }
    },
  });
  await assert.rejects(
    createNativeAndroidDeviceProof(artifact.options),
    /artifacts changed while evidence was collected/u,
  );

  const compatibility = await fixture(t);
  const createFingerprint =
    compatibility.options.dependencies.createFingerprint;
  let fingerprintReads = 0;
  await assert.rejects(
    createNativeAndroidDeviceProof({
      ...compatibility.options,
      dependencies: {
        ...compatibility.options.dependencies,
        createFingerprint: async (cwd) => {
          fingerprintReads += 1;
          const report = await createFingerprint(cwd);
          return fingerprintReads === 1
            ? report
            : {
                ...report,
                targets: [
                  {
                    ...report.targets[0],
                    fingerprint: `sha256:${"1".repeat(64)}`,
                  },
                ],
              };
        },
      },
    }),
    /native compatibility identity changed while evidence was collected/u,
  );
});
