import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseMatchedProductWorkloadLog } from "./android-update-matched-benchmark.mjs";

const UPDATE_MARKER = "SOLID_NATIVE_PRODUCT_TELEMETRY_UPDATE ";
const RESULT_MARKER = "SOLID_NATIVE_PRODUCT_TELEMETRY_RESULT ";
const EXPECTED_UPDATE_COUNT = 30;
const EXPECTED_ALERT_COMPUTATION_COUNT = 12;
const METRICS = [
  "handlerToCommitMilliseconds",
  "handlerToMountMilliseconds",
  "handlerToFrameMilliseconds",
  "commitToMountMilliseconds",
  "commitToFrameMilliseconds",
  "mountToFrameMilliseconds",
];

function markedJson(source, marker) {
  const results = [];
  for (const line of source.split(/\r?\n/u)) {
    const markerIndex = line.indexOf(marker);
    if (markerIndex === -1) continue;
    const payload = line.slice(markerIndex + marker.length).trim();
    if (payload === "") {
      throw new Error(`Product telemetry marker ${marker.trim()} is empty.`);
    }
    results.push(JSON.parse(payload));
  }
  return results;
}

function finiteNumber(record, name) {
  const value = record?.[name];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Product telemetry ${name} must be finite.`);
  }
  return value;
}

function validateUpdate(
  update,
  expectedVariant,
  expectedEventIndex,
  initialObservedSequence,
) {
  const processed = expectedEventIndex + 1;
  const expectedOrder = `ORD-${String(1001 + (expectedEventIndex % 12))}`;
  const alertVisible = processed % 5 === 0;
  const previousAlertVisible = (processed - 1) % 5 === 0;
  if (
    update === null ||
    typeof update !== "object" ||
    update.schemaVersion !== 0 ||
    update.variant !== expectedVariant ||
    update.eventIndex !== expectedEventIndex ||
    update.processed !== processed ||
    update.activeOrder !== expectedOrder ||
    update.alertVisible !== alertVisible ||
    update.alertComputation !== (alertVisible !== previousAlertVisible) ||
    update.telemetryEnabled !== (expectedVariant === "observed") ||
    update.causalChainValidated !== (expectedVariant === "observed") ||
    update.observedSequence !==
      initialObservedSequence + expectedEventIndex - 1 ||
    update.commitSequence !== expectedEventIndex + 1 ||
    !Number.isSafeInteger(update.hostRevision) ||
    update.hostRevision <= 0
  ) {
    throw new Error("The product telemetry update is incompatible.");
  }
  const values = Object.fromEntries(
    METRICS.map((metric) => [metric, finiteNumber(update, metric)]),
  );
  if (
    values.handlerToCommitMilliseconds < 0 ||
    values.handlerToMountMilliseconds < values.handlerToCommitMilliseconds ||
    values.handlerToFrameMilliseconds < values.handlerToMountMilliseconds ||
    values.commitToMountMilliseconds < 0 ||
    values.commitToFrameMilliseconds < values.commitToMountMilliseconds ||
    values.mountToFrameMilliseconds < 0 ||
    Math.abs(
      values.commitToMountMilliseconds +
        values.mountToFrameMilliseconds -
        values.commitToFrameMilliseconds,
    ) > 1e-6 ||
    Math.abs(
      values.handlerToCommitMilliseconds +
        values.commitToMountMilliseconds -
        values.handlerToMountMilliseconds,
    ) > 0.25 ||
    Math.abs(
      values.handlerToCommitMilliseconds +
        values.commitToFrameMilliseconds -
        values.handlerToFrameMilliseconds,
    ) > 0.25
  ) {
    throw new Error("The product telemetry update has invalid timing bounds.");
  }
  return update;
}

export function parseProductTelemetryVariantLog(source, expectedVariant) {
  if (expectedVariant !== "baseline" && expectedVariant !== "observed") {
    throw new Error(
      "The product telemetry variant must be baseline or observed.",
    );
  }
  const updates = markedJson(source, UPDATE_MARKER);
  const results = markedJson(source, RESULT_MARKER);
  const result = results.at(-1);
  const physicalEvidence = parseMatchedProductWorkloadLog(
    source,
    expectedVariant,
  );
  if (
    updates.length !== EXPECTED_UPDATE_COUNT ||
    results.length !== 1 ||
    result === undefined ||
    physicalEvidence === undefined
  ) {
    throw new Error(
      "The product telemetry proof omitted causal or physical evidence.",
    );
  }
  const initialObservedSequence = updates[0]?.observedSequence;
  if (
    !Number.isSafeInteger(initialObservedSequence) ||
    initialObservedSequence <= 0
  ) {
    throw new Error(
      "The product telemetry proof has no valid initial native sequence.",
    );
  }
  const validatedUpdates = updates.map((update, index) =>
    validateUpdate(update, expectedVariant, index + 1, initialObservedSequence),
  );
  for (let index = 1; index < validatedUpdates.length; index++) {
    const previous = validatedUpdates[index - 1];
    const current = validatedUpdates[index];
    if (current.hostRevision <= previous.hostRevision) {
      throw new Error(
        "The product telemetry proof reused or reordered a Fabric revision.",
      );
    }
  }
  if (
    result.schemaVersion !== 0 ||
    result.benchmark !== "causal-telemetry-product-workload" ||
    result.interpretation !== "functional-proof" ||
    result.variant !== expectedVariant ||
    result.workload !== "order-dashboard" ||
    result.input !== "androidx-touchscreen-injection" ||
    result.updateCount !== EXPECTED_UPDATE_COUNT ||
    result.validatedInteractionCount !==
      (expectedVariant === "observed" ? EXPECTED_UPDATE_COUNT : 0) ||
    result.alertComputationInteractionCount !==
      (expectedVariant === "observed" ? EXPECTED_ALERT_COMPUTATION_COUNT : 0) ||
    result.finalProcessed !== 31 ||
    result.finalActiveOrder !== "ORD-1007" ||
    result.finalAlertVisible !== false ||
    !Number.isSafeInteger(result.telemetryRecordCount) ||
    (expectedVariant === "observed"
      ? result.telemetryRecordCount <= 0
      : result.telemetryRecordCount !== 0) ||
    result.telemetryEnabled !== (expectedVariant === "observed") ||
    result.payloadValuesRetained !== false ||
    result.runtime?.platform !== "android" ||
    typeof result.runtime.name !== "string" ||
    result.runtime.name === "" ||
    typeof result.runtime.version !== "string" ||
    result.runtime.version === "" ||
    !Number.isSafeInteger(result.runtime.hostContractVersion) ||
    result.runtime.hostContractVersion <= 0
  ) {
    throw new Error("The product telemetry result is incompatible.");
  }
  if (
    physicalEvidence.updateCount !== result.updateCount ||
    physicalEvidence.finalCount !== result.finalProcessed ||
    physicalEvidence.finalActiveOrder !== result.finalActiveOrder ||
    physicalEvidence.alertAppearances !== 6 ||
    physicalEvidence.alertDisposals !== 6
  ) {
    throw new Error(
      "The product telemetry graph disagrees with the physical UI evidence.",
    );
  }
  return { result, updates: validatedUpdates, physicalEvidence };
}

export function parseProductTelemetryProof(source) {
  return parseProductTelemetryVariantLog(source, "observed");
}

async function main() {
  const unknownArguments = process.argv.slice(2);
  if (unknownArguments.length > 1) {
    throw new Error(
      "Usage: parse-product-telemetry-proof.mjs [android-log-file]",
    );
  }
  const source =
    unknownArguments[0] === undefined
      ? await readFile("/dev/stdin", "utf8")
      : await readFile(path.resolve(unknownArguments[0]), "utf8");
  const proof = parseProductTelemetryProof(source);
  console.log(
    JSON.stringify({
      updateCount: proof.result.updateCount,
      validatedInteractionCount: proof.result.validatedInteractionCount,
      alertComputationInteractionCount:
        proof.result.alertComputationInteractionCount,
      telemetryRecordCount: proof.result.telemetryRecordCount,
      finalActiveOrder: proof.result.finalActiveOrder,
      frozenFrames: proof.physicalEvidence.frameMetrics.frozenFrames,
      droppedFrameReports: proof.physicalEvidence.frameMetrics.droppedReports,
    }),
  );
}

const scriptPath = fileURLToPath(import.meta.url);
if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === scriptPath
) {
  await main();
}
