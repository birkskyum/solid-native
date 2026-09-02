import { pathToFileURL } from "node:url";

const TEST_IDENTIFIER =
  "SolidNativeE2EUITests/testVirtualizedListOnPhysicalDevice()";
const SYSTEM_PREFIX =
  "com.apple.dt.XCTMetric_OSSignpost-Scroll_DraggingAndDeceleration";
const APPLICATION_PREFIX = "com.apple.dt.XCTMetric_Hitch-list";

const SYSTEM_METRICS = Object.freeze({
  durationSeconds: `${SYSTEM_PREFIX}.duration`,
  systemAnimationHitches: `${SYSTEM_PREFIX}.animation.hitch.number`,
  systemAnimationHitchTimeRatioMsPerSecond: `${SYSTEM_PREFIX}.animation.hitch.time.ratio`,
  systemAnimationFrameCount: `${SYSTEM_PREFIX}.animation.frame.count`,
  systemAnimationFrameRate: `${SYSTEM_PREFIX}.animation.frame.rate`,
  systemAnimationHitchDurationMilliseconds: `${SYSTEM_PREFIX}.animation.hitches.total.duration`,
});

const APPLICATION_METRICS = Object.freeze({
  applicationHitchTimeRatioMsPerSecond: `${APPLICATION_PREFIX}.time.ratio`,
  applicationHitchDurationSeconds: `${APPLICATION_PREFIX}.total.duration`,
  applicationHitches: `${APPLICATION_PREFIX}.number`,
});

function requireObject(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object.`);
  }
  return value;
}

function readMetric(metricByIdentifier, identifier) {
  const metric = metricByIdentifier.get(identifier);
  if (metric === undefined) {
    throw new Error(`The iPhone list result omitted metric ${identifier}.`);
  }
  if (
    !Array.isArray(metric.measurements) ||
    metric.measurements.length !== 1 ||
    typeof metric.measurements[0] !== "number" ||
    !Number.isFinite(metric.measurements[0]) ||
    metric.measurements[0] < 0
  ) {
    throw new TypeError(
      `The iPhone list metric ${identifier} must have one finite non-negative measurement.`,
    );
  }
  return metric.measurements[0];
}

export function parseIOSListMetrics(value) {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new TypeError(
      "The iPhone list result must contain exactly one test.",
    );
  }
  const testResult = requireObject(value[0], "The iPhone list test result");
  if (testResult.testIdentifier !== TEST_IDENTIFIER) {
    throw new Error("The iPhone list metrics belong to an unexpected test.");
  }
  if (!Array.isArray(testResult.testRuns) || testResult.testRuns.length !== 1) {
    throw new TypeError("The iPhone list result must contain exactly one run.");
  }
  const testRun = requireObject(testResult.testRuns[0], "The iPhone list run");
  const device = requireObject(testRun.device, "The iPhone list device");
  if (
    typeof device.deviceId !== "string" ||
    device.deviceId.length === 0 ||
    typeof device.deviceName !== "string" ||
    device.deviceName.length === 0
  ) {
    throw new TypeError("The iPhone list run has invalid device identity.");
  }
  if (!Array.isArray(testRun.metrics)) {
    throw new TypeError("The iPhone list run omitted its metrics.");
  }

  const metricByIdentifier = new Map();
  for (const value of testRun.metrics) {
    const metric = requireObject(value, "An iPhone list metric");
    if (
      typeof metric.identifier !== "string" ||
      metric.identifier.length === 0
    ) {
      throw new TypeError("An iPhone list metric omitted its identifier.");
    }
    if (metricByIdentifier.has(metric.identifier)) {
      throw new Error(
        `The iPhone list metric ${metric.identifier} was duplicated.`,
      );
    }
    metricByIdentifier.set(metric.identifier, metric);
  }

  const result = {
    schemaVersion: 0,
    deviceId: device.deviceId,
    deviceName: device.deviceName,
  };
  for (const [name, identifier] of Object.entries(SYSTEM_METRICS)) {
    result[name] = readMetric(metricByIdentifier, identifier);
  }
  if (result.durationSeconds <= 0 || result.systemAnimationFrameRate <= 0) {
    throw new RangeError(
      "The iPhone list scroll must have positive duration and frame-rate evidence.",
    );
  }
  if (!Number.isSafeInteger(result.systemAnimationHitches)) {
    throw new TypeError(
      "The iPhone list system hitch count must be an integer.",
    );
  }

  const applicationMetricCount = Object.values(APPLICATION_METRICS).filter(
    (identifier) => metricByIdentifier.has(identifier),
  ).length;
  if (applicationMetricCount !== 0 && applicationMetricCount !== 3) {
    throw new Error(
      "The iPhone list app-targeted hitch metrics are incomplete.",
    );
  }
  if (applicationMetricCount === 3) {
    for (const [name, identifier] of Object.entries(APPLICATION_METRICS)) {
      result[name] = readMetric(metricByIdentifier, identifier);
    }
    if (!Number.isSafeInteger(result.applicationHitches)) {
      throw new TypeError(
        "The iPhone list app hitch count must be an integer.",
      );
    }
  }

  return Object.freeze(result);
}

async function main() {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  process.stdout.write(
    `${JSON.stringify(parseIOSListMetrics(JSON.parse(input)))}\n`,
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
