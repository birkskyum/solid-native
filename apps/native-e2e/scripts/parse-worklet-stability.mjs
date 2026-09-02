import { pathToFileURL } from "node:url";

const MARKER = "SOLID_NATIVE_UI_WORKLET_STABILITY_SUCCEEDED";

function requireNonNegativeNumber(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be finite and non-negative.`);
  }
  return value;
}

function requireNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer.`);
  }
  return value;
}

export function parseWorkletStabilityLog(value) {
  if (typeof value !== "string") {
    throw new TypeError("Native UI worklet logs must be a string.");
  }
  const line = value
    .split(/\r?\n/u)
    .filter((candidate) => candidate.includes(MARKER))
    .at(-1);
  if (line === undefined) {
    throw new Error(`Native UI worklet logs omitted ${MARKER}.`);
  }
  const markerIndex = line.indexOf(MARKER);
  const objectStart = line.indexOf("{", markerIndex + MARKER.length);
  const objectEnd = line.lastIndexOf("}");
  if (objectStart < 0 || objectEnd < objectStart) {
    throw new Error("The native UI worklet stability marker omitted JSON.");
  }
  const result = JSON.parse(line.slice(objectStart, objectEnd + 1));
  if (
    result === null ||
    typeof result !== "object" ||
    Array.isArray(result) ||
    (result.cadence !== "standard-refresh" && result.cadence !== "high-refresh")
  ) {
    throw new TypeError("The native UI worklet cadence result is malformed.");
  }
  const frameCount = requireNonNegativeInteger(
    result.frameCount,
    "Native timing frame count",
  );
  const intervalCount = requireNonNegativeInteger(
    result.intervalCount,
    "Native timing interval count",
  );
  const sampledIntervalCount = requireNonNegativeInteger(
    result.sampledIntervalCount,
    "Native timing sampled interval count",
  );
  const droppedIntervalSampleCount = requireNonNegativeInteger(
    result.droppedIntervalSampleCount,
    "Native timing dropped interval count",
  );
  if (
    frameCount < 1 ||
    intervalCount !== frameCount - 1 ||
    sampledIntervalCount + droppedIntervalSampleCount !== intervalCount
  ) {
    throw new RangeError("Native timing frame counts are inconsistent.");
  }
  for (const name of [
    "firstFrameTimeMilliseconds",
    "lastFrameTimeMilliseconds",
    "minimumFrameIntervalMilliseconds",
    "maximumFrameIntervalMilliseconds",
    "meanFrameIntervalMilliseconds",
    "p50FrameIntervalMilliseconds",
    "p95FrameIntervalMilliseconds",
    "p99FrameIntervalMilliseconds",
  ]) {
    requireNonNegativeNumber(result[name], `Native timing ${name}`);
  }
  return result;
}

async function main() {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  process.stdout.write(`${JSON.stringify(parseWorkletStabilityLog(input))}\n`);
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
