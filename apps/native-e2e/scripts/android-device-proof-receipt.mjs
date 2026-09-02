import { createReadStream } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readNativeCompatibilityIdentity } from "./native-benchmark-environment.mjs";

const SHA256 = /^[a-f\d]{64}$/u;
const REVISION = /^(?:[a-f\d]{40}|[a-f\d]{64})$/u;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_BINDING_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_MAP_BYTES = 512 * 1024 * 1024;
const MAX_APK_BYTES = 1024 * 1024 * 1024;
const MAX_INSTRUMENTATION_SECONDS = 10 * 60;
const RESULT_FRESHNESS_TOLERANCE_MS = 2_000;
const TEST_SUITE = "dev.solidnative.e2e.SolidNativePhysicalTest";
const TEST_NAME = "testPhysicalRendererUpdate";

export const ANDROID_DEVICE_PROOF_SOURCE_POLICY = Object.freeze([
  Object.freeze({
    kind: "required-source",
    pattern: "app:///apps/native-e2e/adapters/NotifeeApiModule.ts",
    matches: 1,
  }),
  Object.freeze({
    kind: "required-source",
    pattern: "app:///apps/native-e2e/generated/SolidNativeBindings.ts",
    matches: 1,
  }),
  Object.freeze({
    kind: "required-source",
    pattern: "app:///packages/notifications/dist/notify-kit-10.js",
    matches: 1,
  }),
  Object.freeze({
    kind: "forbidden-fragment",
    pattern: "/node_modules/react-native-notify-kit/",
    matches: 0,
  }),
]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function plainRecord(value, name) {
  invariant(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${name} must be an object.`,
  );
  const prototype = Object.getPrototypeOf(value);
  invariant(
    prototype === Object.prototype || prototype === null,
    `${name} must be a plain object.`,
  );
  return value;
}

function exactKeys(value, expected, name) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  invariant(
    actual.length === sortedExpected.length &&
      actual.every((key, index) => key === sortedExpected[index]),
    `${name} has unexpected fields.`,
  );
}

function boundedString(value, name, maximumLength = 512) {
  invariant(
    typeof value === "string" &&
      value.length > 0 &&
      value.length <= maximumLength &&
      !/[\0-\x1f\x7f]/u.test(value),
    `${name} must be a bounded printable string.`,
  );
  return value;
}

function safeInteger(value, name, minimum, maximum) {
  invariant(
    Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    `${name} must be an integer from ${String(minimum)} to ${String(maximum)}.`,
  );
  return value;
}

function digestString(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function readBoundedText(file, maximumBytes, name) {
  const metadata = await stat(file);
  invariant(metadata.isFile(), `${name} must be a file.`);
  invariant(
    metadata.size > 0 && metadata.size <= maximumBytes,
    `${name} must contain 1-${String(maximumBytes)} bytes.`,
  );
  return {
    metadata,
    source: await readFile(file, "utf8"),
  };
}

async function digestFile(file, maximumBytes, name) {
  const metadata = await stat(file);
  invariant(metadata.isFile(), `${name} must be a file.`);
  invariant(
    metadata.size > 0 && metadata.size <= maximumBytes,
    `${name} must contain 1-${String(maximumBytes)} bytes.`,
  );
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return Object.freeze({
    bytes: metadata.size,
    sha256: hash.digest("hex"),
  });
}

function decodeXmlAttribute(value, name) {
  const decoded = value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
  invariant(!decoded.includes("&"), `${name} contains an unsupported entity.`);
  return boundedString(decoded, name);
}

function xmlAttribute(tag, attribute, name) {
  const expression = new RegExp(`\\s${attribute}="([^"]*)"`, "gu");
  const matches = [...tag.matchAll(expression)];
  invariant(matches.length === 1, `${name} must appear exactly once.`);
  return decodeXmlAttribute(matches[0][1], name);
}

function xmlInteger(tag, attribute, name, minimum, maximum) {
  const value = xmlAttribute(tag, attribute, name);
  invariant(/^(?:0|[1-9]\d*)$/u.test(value), `${name} must be an integer.`);
  return safeInteger(Number(value), name, minimum, maximum);
}

function uniqueXmlTag(source, tagName, name) {
  const matches = [
    ...source.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, "gu")),
  ];
  invariant(matches.length === 1, `${name} must appear exactly once.`);
  return matches[0][0];
}

/** Parses the one-test Gradle XML without trusting paths or arbitrary XML. */
export function parseAndroidInstrumentationResult(source) {
  invariant(
    typeof source === "string" &&
      Buffer.byteLength(source, "utf8") > 0 &&
      Buffer.byteLength(source, "utf8") <= MAX_TEXT_BYTES,
    "Android instrumentation XML is empty or oversized.",
  );
  invariant(
    !/<!(?:DOCTYPE|ENTITY)/iu.test(source),
    "Android instrumentation XML cannot declare a document type or entity.",
  );
  const suites = uniqueXmlTag(source, "testsuites", "testsuites");
  const suite = uniqueXmlTag(source, "testsuite", "testsuite");
  const testCase = uniqueXmlTag(source, "testcase", "testcase");
  for (const [tag, name] of [
    [suites, "testsuites"],
    [suite, "testsuite"],
  ]) {
    invariant(
      xmlInteger(tag, "tests", `${name}.tests`, 0, 1) === 1,
      `${name} did not run exactly one test.`,
    );
    invariant(
      xmlInteger(tag, "failures", `${name}.failures`, 0, 1) === 0,
      `${name} reported a failure.`,
    );
    invariant(
      xmlInteger(tag, "errors", `${name}.errors`, 0, 1) === 0,
      `${name} reported an error.`,
    );
    invariant(
      xmlInteger(tag, "skipped", `${name}.skipped`, 0, 1) === 0,
      `${name} skipped its test.`,
    );
  }
  invariant(
    !/<(?:failure|error|skipped)\b/iu.test(source),
    "Android instrumentation XML contains a non-passing result element.",
  );
  const suiteName = xmlAttribute(suite, "name", "testsuite.name");
  const className = xmlAttribute(testCase, "classname", "testcase.classname");
  const testName = xmlAttribute(testCase, "name", "testcase.name");
  invariant(
    suiteName === TEST_SUITE && className === TEST_SUITE,
    "Android instrumentation ran an unexpected test suite.",
  );
  invariant(
    testName === TEST_NAME,
    "Android instrumentation ran an unexpected test.",
  );
  const durationSeconds = Number(
    xmlAttribute(testCase, "time", "testcase.time"),
  );
  invariant(
    Number.isFinite(durationSeconds) &&
      durationSeconds > 0 &&
      durationSeconds <= MAX_INSTRUMENTATION_SECONDS,
    "Android instrumentation duration is invalid.",
  );
  const timestamp = xmlAttribute(suite, "timestamp", "testsuite.timestamp");
  invariant(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/u.test(timestamp),
    "Android instrumentation timestamp is invalid.",
  );
  const reportedAt = new Date(`${timestamp}Z`);
  invariant(
    Number.isFinite(reportedAt.getTime()),
    "Android instrumentation timestamp is not a real UTC time.",
  );
  const properties = [...source.matchAll(/<property\b[^>]*\/>/gu)];
  invariant(
    properties.length > 0 && properties.length <= 16,
    "Android instrumentation properties are missing or oversized.",
  );
  const propertyValues = new Map();
  for (const match of properties) {
    const name = xmlAttribute(match[0], "name", "property.name");
    invariant(
      !propertyValues.has(name),
      `Android instrumentation property ${name} is duplicated.`,
    );
    propertyValues.set(
      name,
      xmlAttribute(match[0], "value", `property.${name}`),
    );
  }
  invariant(
    propertyValues.get("flavor") === "solid" &&
      propertyValues.get("project") === ":app",
    "Android instrumentation used an unexpected Gradle target.",
  );
  boundedString(propertyValues.get("device"), "property.device");
  return Object.freeze({
    className,
    durationSeconds,
    reportedAt: reportedAt.toISOString(),
    testName,
  });
}

/** Validates the portable subset of `solid-native bundle sources --json`. */
export function parseAndroidDeviceProofSourcePolicy(source) {
  invariant(
    typeof source === "string" &&
      Buffer.byteLength(source, "utf8") > 0 &&
      Buffer.byteLength(source, "utf8") <= MAX_TEXT_BYTES,
    "Android source-policy report is empty or oversized.",
  );
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error("Android source-policy report is not valid JSON.", {
      cause: error,
    });
  }
  const report = plainRecord(parsed, "Android source-policy report");
  exactKeys(
    report,
    ["checks", "ok", "schemaVersion", "sourceCount", "sourceMapPath"],
    "Android source-policy report",
  );
  invariant(
    report.schemaVersion === 0 && report.ok === true,
    "Android source-policy report did not pass schema version 0.",
  );
  const sourceCount = safeInteger(
    report.sourceCount,
    "Android source-policy sourceCount",
    1,
    100_000,
  );
  boundedString(
    report.sourceMapPath,
    "Android source-policy sourceMapPath",
    4_096,
  );
  invariant(
    Array.isArray(report.checks) &&
      report.checks.length === ANDROID_DEVICE_PROOF_SOURCE_POLICY.length,
    "Android source-policy report has an unexpected check count.",
  );
  const checks = report.checks.map((candidate, index) => {
    const check = plainRecord(
      candidate,
      `Android source-policy check ${String(index)}`,
    );
    exactKeys(
      check,
      ["kind", "matches", "pattern", "status"],
      `Android source-policy check ${String(index)}`,
    );
    const expected = ANDROID_DEVICE_PROOF_SOURCE_POLICY[index];
    invariant(
      check.kind === expected.kind &&
        check.pattern === expected.pattern &&
        check.matches === expected.matches &&
        check.status === "pass",
      `Android source-policy check ${String(index)} drifted or failed.`,
    );
    return Object.freeze({
      kind: expected.kind,
      matches: expected.matches,
      pattern: expected.pattern,
    });
  });
  return Object.freeze({ sourceCount, checks: Object.freeze(checks) });
}

export function parseGeneratedBindingIdentity(source) {
  invariant(
    typeof source === "string" &&
      Buffer.byteLength(source, "utf8") > 0 &&
      Buffer.byteLength(source, "utf8") <= MAX_BINDING_BYTES,
    "Generated binding is empty or oversized.",
  );
  const matches = [...source.matchAll(/bindingSha256: "([a-f\d]{64})"/gu)];
  invariant(
    matches.length === 1,
    "Generated binding must expose exactly one bindingSha256.",
  );
  return matches[0][1];
}

export function parseAndroidBatteryState(source) {
  invariant(
    typeof source === "string" &&
      Buffer.byteLength(source, "utf8") <= 64 * 1024,
    "Android battery state is oversized.",
  );
  const field = (name) => {
    const matches = [
      ...source.matchAll(new RegExp(`^\\s*${name}:\\s*(-?\\d+)\\s*$`, "gmu")),
    ];
    invariant(
      matches.length === 1,
      `Android battery ${name} is missing or duplicated.`,
    );
    return Number(matches[0][1]);
  };
  return Object.freeze({
    level: safeInteger(field("level"), "Android battery level", 0, 100),
    temperatureCelsius:
      safeInteger(
        field("temperature"),
        "Android battery temperature",
        -500,
        1_500,
      ) / 10,
  });
}

function run(command, arguments_, maximumBytes = MAX_TEXT_BYTES) {
  const result = spawnSync(command, arguments_, {
    encoding: "utf8",
    maxBuffer: maximumBytes,
  });
  if (result.error !== undefined) throw result.error;
  invariant(
    result.status === 0,
    `${command} ${arguments_.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`,
  );
  return result.stdout.trim();
}

function adb(serial, ...arguments_) {
  return run("adb", ["-s", serial, ...arguments_]);
}

async function freshInstrumentationResult(directory, notBeforeMilliseconds) {
  const entries = await readdir(directory, { withFileTypes: true });
  invariant(
    entries.length <= 64,
    "Android instrumentation result directory is oversized.",
  );
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^TEST-.+\.xml$/u.test(entry.name)) continue;
    const file = path.join(directory, entry.name);
    const metadata = await stat(file);
    if (
      metadata.mtimeMs + RESULT_FRESHNESS_TOLERANCE_MS >=
      notBeforeMilliseconds
    ) {
      candidates.push({ file, metadata });
    }
  }
  invariant(
    candidates.length === 1,
    `Expected one fresh Android instrumentation XML result; found ${String(candidates.length)}.`,
  );
  return candidates[0];
}

function parseLowPowerMode(value) {
  if (value === "0") return false;
  if (value === "1") return true;
  throw new Error("Android low-power mode must be 0 or 1.");
}

function portableFileFact(value, name) {
  const fact = plainRecord(value, name);
  exactKeys(fact, ["bytes", "sha256"], name);
  safeInteger(fact.bytes, `${name}.bytes`, 1, MAX_APK_BYTES);
  invariant(
    typeof fact.sha256 === "string" && SHA256.test(fact.sha256),
    `${name}.sha256 is invalid.`,
  );
}

/** Strictly validates a retained proof receipt before another tool consumes it. */
export function parseAndroidDeviceProofReceipt(source) {
  invariant(
    typeof source === "string" &&
      Buffer.byteLength(source, "utf8") > 0 &&
      Buffer.byteLength(source, "utf8") <= MAX_TEXT_BYTES,
    "Android device-proof receipt is empty or oversized.",
  );
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error("Android device-proof receipt is not valid JSON.", {
      cause: error,
    });
  }
  const receipt = plainRecord(parsed, "Android device-proof receipt");
  exactKeys(
    receipt,
    [
      "artifacts",
      "bundle",
      "device",
      "generatedBindings",
      "instrumentation",
      "measuredAt",
      "nativeCompatibility",
      "proof",
      "schemaVersion",
      "source",
      "status",
    ],
    "Android device-proof receipt",
  );
  invariant(
    receipt.schemaVersion === 0 &&
      receipt.proof === "solid-native-android-release-device" &&
      receipt.status === "passed",
    "Android device-proof receipt identity is invalid.",
  );
  invariant(
    new Date(receipt.measuredAt).toISOString() === receipt.measuredAt,
    "Android device-proof receipt measuredAt is invalid.",
  );
  const sourceRecord = plainRecord(receipt.source, "receipt.source");
  exactKeys(sourceRecord, ["dirty", "revision"], "receipt.source");
  invariant(
    typeof sourceRecord.revision === "string" &&
      REVISION.test(sourceRecord.revision),
    "receipt.source.revision is invalid.",
  );
  invariant(
    typeof sourceRecord.dirty === "boolean",
    "receipt.source.dirty is invalid.",
  );
  const compatibility = plainRecord(
    receipt.nativeCompatibility,
    "receipt.nativeCompatibility",
  );
  exactKeys(
    compatibility,
    ["fingerprint", "inputCount"],
    "receipt.nativeCompatibility",
  );
  invariant(
    typeof compatibility.fingerprint === "string" &&
      /^sha256:[a-f\d]{64}$/u.test(compatibility.fingerprint),
    "receipt.nativeCompatibility.fingerprint is invalid.",
  );
  safeInteger(
    compatibility.inputCount,
    "receipt.nativeCompatibility.inputCount",
    1,
    10_000,
  );
  const artifacts = plainRecord(receipt.artifacts, "receipt.artifacts");
  exactKeys(
    artifacts,
    ["applicationApk", "instrumentationApk"],
    "receipt.artifacts",
  );
  portableFileFact(
    artifacts.applicationApk,
    "receipt.artifacts.applicationApk",
  );
  portableFileFact(
    artifacts.instrumentationApk,
    "receipt.artifacts.instrumentationApk",
  );
  const bindings = plainRecord(
    receipt.generatedBindings,
    "receipt.generatedBindings",
  );
  exactKeys(
    bindings,
    ["bytes", "fileSha256", "manifestSha256"],
    "receipt.generatedBindings",
  );
  safeInteger(
    bindings.bytes,
    "receipt.generatedBindings.bytes",
    1,
    MAX_BINDING_BYTES,
  );
  invariant(
    typeof bindings.fileSha256 === "string" &&
      SHA256.test(bindings.fileSha256) &&
      typeof bindings.manifestSha256 === "string" &&
      SHA256.test(bindings.manifestSha256),
    "receipt.generatedBindings digests are invalid.",
  );
  const bundle = plainRecord(receipt.bundle, "receipt.bundle");
  exactKeys(
    bundle,
    ["bytes", "checks", "sha256", "sourceCount"],
    "receipt.bundle",
  );
  safeInteger(bundle.bytes, "receipt.bundle.bytes", 1, MAX_SOURCE_MAP_BYTES);
  safeInteger(bundle.sourceCount, "receipt.bundle.sourceCount", 1, 100_000);
  invariant(
    typeof bundle.sha256 === "string" && SHA256.test(bundle.sha256),
    "receipt.bundle.sha256 is invalid.",
  );
  invariant(
    Array.isArray(bundle.checks) &&
      bundle.checks.length === ANDROID_DEVICE_PROOF_SOURCE_POLICY.length,
    "receipt.bundle.checks drifted.",
  );
  bundle.checks.forEach((candidate, index) => {
    const check = plainRecord(
      candidate,
      `receipt.bundle.checks.${String(index)}`,
    );
    exactKeys(
      check,
      ["kind", "matches", "pattern"],
      `receipt.bundle.checks.${String(index)}`,
    );
    const expected = ANDROID_DEVICE_PROOF_SOURCE_POLICY[index];
    invariant(
      check.kind === expected.kind &&
        check.matches === expected.matches &&
        check.pattern === expected.pattern,
      "receipt.bundle.checks drifted.",
    );
  });
  const instrumentation = plainRecord(
    receipt.instrumentation,
    "receipt.instrumentation",
  );
  exactKeys(
    instrumentation,
    [
      "className",
      "durationSeconds",
      "exitCodeSha256",
      "resultBytes",
      "resultSha256",
      "reportedAt",
      "testName",
    ],
    "receipt.instrumentation",
  );
  invariant(
    instrumentation.className === TEST_SUITE &&
      instrumentation.testName === TEST_NAME,
    "receipt.instrumentation test identity is invalid.",
  );
  invariant(
    Number.isFinite(instrumentation.durationSeconds) &&
      instrumentation.durationSeconds > 0 &&
      instrumentation.durationSeconds <= MAX_INSTRUMENTATION_SECONDS,
    "receipt.instrumentation duration is invalid.",
  );
  invariant(
    new Date(instrumentation.reportedAt).toISOString() ===
      instrumentation.reportedAt,
    "receipt.instrumentation.reportedAt is invalid.",
  );
  safeInteger(
    instrumentation.resultBytes,
    "receipt.instrumentation.resultBytes",
    1,
    MAX_TEXT_BYTES,
  );
  invariant(
    typeof instrumentation.resultSha256 === "string" &&
      SHA256.test(instrumentation.resultSha256) &&
      typeof instrumentation.exitCodeSha256 === "string" &&
      SHA256.test(instrumentation.exitCodeSha256),
    "receipt.instrumentation digests are invalid.",
  );
  const device = plainRecord(receipt.device, "receipt.device");
  exactKeys(
    device,
    [
      "abi",
      "batteryLevel",
      "batteryTemperatureCelsius",
      "buildFingerprintSha256",
      "kind",
      "lowPowerMode",
      "manufacturer",
      "model",
      "osVersion",
      "product",
      "sdkLevel",
      "serialSha256",
    ],
    "receipt.device",
  );
  invariant(device.kind === "physical", "receipt.device.kind is not physical.");
  for (const key of ["abi", "manufacturer", "model", "osVersion", "product"]) {
    boundedString(device[key], `receipt.device.${key}`);
  }
  safeInteger(device.sdkLevel, "receipt.device.sdkLevel", 1, 999);
  safeInteger(device.batteryLevel, "receipt.device.batteryLevel", 0, 100);
  invariant(
    typeof device.batteryTemperatureCelsius === "number" &&
      Number.isFinite(device.batteryTemperatureCelsius) &&
      device.batteryTemperatureCelsius >= -50 &&
      device.batteryTemperatureCelsius <= 150,
    "receipt.device.batteryTemperatureCelsius is invalid.",
  );
  invariant(
    typeof device.lowPowerMode === "boolean",
    "receipt.device.lowPowerMode is invalid.",
  );
  invariant(
    typeof device.serialSha256 === "string" &&
      /^sha256:[a-f\d]{64}$/u.test(device.serialSha256) &&
      typeof device.buildFingerprintSha256 === "string" &&
      /^sha256:[a-f\d]{64}$/u.test(device.buildFingerprintSha256),
    "receipt.device privacy-safe identities are invalid.",
  );
  return Object.freeze(receipt);
}

export async function createAndroidDeviceProofReceipt(options) {
  const notBeforeMilliseconds = safeInteger(
    options.notBeforeMilliseconds,
    "notBeforeMilliseconds",
    0,
    9_007_199_254_740_991,
  );
  const now = Date.now();
  invariant(
    notBeforeMilliseconds <= now + 60_000,
    "Android proof start time is in the future.",
  );
  const serial = boundedString(options.serial, "Android serial", 256);
  invariant(
    adb(serial, "get-state") === "device",
    "Android device is unavailable.",
  );
  const qemu = [
    adb(serial, "shell", "getprop", "ro.kernel.qemu"),
    adb(serial, "shell", "getprop", "ro.boot.qemu"),
  ];
  invariant(
    qemu.every((value) => value === "" || value === "0"),
    "Android device proof cannot run against an emulator.",
  );
  const result = await freshInstrumentationResult(
    options.instrumentationResultsDirectory,
    notBeforeMilliseconds,
  );
  const { source: xml } = await readBoundedText(
    result.file,
    MAX_TEXT_BYTES,
    "Android instrumentation XML",
  );
  const instrumentation = parseAndroidInstrumentationResult(xml);
  const reportedAtMilliseconds = Date.parse(instrumentation.reportedAt);
  invariant(
    reportedAtMilliseconds + RESULT_FRESHNESS_TOLERANCE_MS >=
      notBeforeMilliseconds && reportedAtMilliseconds <= now + 60_000,
    "Android instrumentation XML is stale or future-dated.",
  );
  const exitCodePath = path.join(
    options.instrumentationResultsDirectory,
    "test-result-exit-code.txt",
  );
  const exitCode = await readBoundedText(
    exitCodePath,
    32,
    "Android instrumentation exit code",
  );
  invariant(
    exitCode.metadata.mtimeMs + RESULT_FRESHNESS_TOLERANCE_MS >=
      notBeforeMilliseconds && exitCode.source.trim() === "0",
    "Android instrumentation exit code is stale or nonzero.",
  );
  const policyText = await readBoundedText(
    options.sourcePolicyReport,
    MAX_TEXT_BYTES,
    "Android source-policy report",
  );
  const policy = parseAndroidDeviceProofSourcePolicy(policyText.source);
  const bindingText = await readBoundedText(
    options.generatedBindings,
    MAX_BINDING_BYTES,
    "Generated binding",
  );
  const bindingManifestSha256 = parseGeneratedBindingIdentity(
    bindingText.source,
  );
  const [
    applicationApk,
    instrumentationApk,
    sourceMap,
    generatedBindings,
    resultXml,
    exitCodeFile,
  ] = await Promise.all([
    digestFile(options.applicationApk, MAX_APK_BYTES, "Application APK"),
    digestFile(
      options.instrumentationApk,
      MAX_APK_BYTES,
      "Instrumentation APK",
    ),
    digestFile(options.sourceMap, MAX_SOURCE_MAP_BYTES, "Release source map"),
    digestFile(
      options.generatedBindings,
      MAX_BINDING_BYTES,
      "Generated binding",
    ),
    digestFile(result.file, MAX_TEXT_BYTES, "Android instrumentation XML"),
    digestFile(exitCodePath, 32, "Android instrumentation exit code"),
  ]);
  const compatibility = readNativeCompatibilityIdentity(
    options.repositoryRoot,
    options.projectRoot,
    "android",
  );
  const revision = run("git", [
    "-C",
    options.repositoryRoot,
    "rev-parse",
    "HEAD",
  ]).toLowerCase();
  invariant(REVISION.test(revision), "Git revision is invalid.");
  const dirty =
    run("git", ["-C", options.repositoryRoot, "status", "--porcelain"]) !== "";
  const buildFingerprint = boundedString(
    adb(serial, "shell", "getprop", "ro.build.fingerprint"),
    "Android build fingerprint",
    1_024,
  );
  const battery = parseAndroidBatteryState(
    adb(serial, "shell", "dumpsys", "battery"),
  );
  const receipt = {
    schemaVersion: 0,
    proof: "solid-native-android-release-device",
    status: "passed",
    measuredAt: new Date().toISOString(),
    source: {
      revision,
      dirty,
    },
    device: {
      kind: "physical",
      serialSha256: `sha256:${digestString(serial)}`,
      manufacturer: boundedString(
        adb(serial, "shell", "getprop", "ro.product.manufacturer"),
        "Android manufacturer",
      ),
      model: boundedString(
        adb(serial, "shell", "getprop", "ro.product.model"),
        "Android model",
      ),
      product: boundedString(
        adb(serial, "shell", "getprop", "ro.product.name"),
        "Android product",
      ),
      abi: boundedString(
        adb(serial, "shell", "getprop", "ro.product.cpu.abi"),
        "Android ABI",
      ),
      osVersion: boundedString(
        adb(serial, "shell", "getprop", "ro.build.version.release"),
        "Android OS version",
      ),
      sdkLevel: safeInteger(
        Number(adb(serial, "shell", "getprop", "ro.build.version.sdk")),
        "Android SDK level",
        1,
        999,
      ),
      buildFingerprintSha256: `sha256:${digestString(buildFingerprint)}`,
      batteryLevel: battery.level,
      batteryTemperatureCelsius: battery.temperatureCelsius,
      lowPowerMode: parseLowPowerMode(
        adb(serial, "shell", "settings", "get", "global", "low_power"),
      ),
    },
    nativeCompatibility: compatibility,
    generatedBindings: {
      bytes: generatedBindings.bytes,
      fileSha256: generatedBindings.sha256,
      manifestSha256: bindingManifestSha256,
    },
    bundle: {
      bytes: sourceMap.bytes,
      sha256: sourceMap.sha256,
      sourceCount: policy.sourceCount,
      checks: policy.checks,
    },
    artifacts: {
      applicationApk,
      instrumentationApk,
    },
    instrumentation: {
      ...instrumentation,
      resultBytes: resultXml.bytes,
      resultSha256: resultXml.sha256,
      exitCodeSha256: exitCodeFile.sha256,
    },
  };
  return parseAndroidDeviceProofReceipt(`${JSON.stringify(receipt)}\n`);
}

function parseCreateArguments(arguments_) {
  const values = new Map();
  const allowed = new Set([
    "--apk",
    "--bindings",
    "--instrumentation-apk",
    "--instrumentation-results",
    "--not-before-ms",
    "--output",
    "--serial",
    "--source-map",
    "--source-policy",
  ]);
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    invariant(
      allowed.has(flag) && value !== undefined && !values.has(flag),
      `Invalid or duplicate Android device-proof option ${String(flag)}.`,
    );
    values.set(flag, value);
  }
  invariant(
    values.size === allowed.size,
    "Android device-proof receipt requires every documented option.",
  );
  return Object.fromEntries(values);
}

async function writeReceipt(file, receipt) {
  const absolute = path.resolve(file);
  await mkdir(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${String(process.pid)}.${String(Date.now())}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(receipt, undefined, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporary, absolute);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return absolute;
}

async function main() {
  const arguments_ = process.argv.slice(2);
  if (arguments_[0] === "--verify") {
    invariant(
      arguments_.length === 2,
      "Usage: android-device-proof-receipt.mjs --verify RECEIPT",
    );
    const receipt = await readBoundedText(
      path.resolve(arguments_[1]),
      MAX_TEXT_BYTES,
      "Android device-proof receipt",
    );
    const parsed = parseAndroidDeviceProofReceipt(receipt.source);
    process.stdout.write(
      `Verified Android device-proof receipt for ${parsed.device.model} at ${parsed.measuredAt}.\n`,
    );
    return;
  }
  const options = parseCreateArguments(arguments_);
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(scriptDirectory, "..");
  const repositoryRoot = path.resolve(projectRoot, "../..");
  const notBeforeMilliseconds = Number(options["--not-before-ms"]);
  const receipt = await createAndroidDeviceProofReceipt({
    applicationApk: path.resolve(options["--apk"]),
    generatedBindings: path.resolve(options["--bindings"]),
    instrumentationApk: path.resolve(options["--instrumentation-apk"]),
    instrumentationResultsDirectory: path.resolve(
      options["--instrumentation-results"],
    ),
    notBeforeMilliseconds,
    projectRoot,
    repositoryRoot,
    serial: options["--serial"],
    sourceMap: path.resolve(options["--source-map"]),
    sourcePolicyReport: path.resolve(options["--source-policy"]),
  });
  const output = await writeReceipt(options["--output"], receipt);
  process.stdout.write(`Retained Android device-proof receipt at ${output}.\n`);
  process.stdout.write(
    `SOLID_NATIVE_ANDROID_DEVICE_PROOF_RECEIPT ${JSON.stringify(receipt)}\n`,
  );
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
