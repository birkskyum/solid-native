import { randomBytes } from "node:crypto";

const MAXIMUM_ORDER_SEED = 0xffff_ffff;

function round(value, places = 6) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

export function readBenchmarkOrderSeed(
  source,
  name,
  randomSeed = () => randomBytes(4).readUInt32LE(0),
) {
  const value = source === undefined ? randomSeed() : Number(source);
  if (
    (source !== undefined &&
      (typeof source !== "string" || !/^(?:0|[1-9]\d*)$/u.test(source))) ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAXIMUM_ORDER_SEED
  ) {
    throw new RangeError(`${name} must be an unsigned 32-bit integer.`);
  }
  return value;
}

function createSeededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b_79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

export function createBalancedPairOrders(pairCount, baseline, observed, seed) {
  if (!Number.isSafeInteger(pairCount) || pairCount <= 0) {
    throw new RangeError(
      "The benchmark pair count must be a positive integer.",
    );
  }
  if (
    typeof baseline !== "string" ||
    baseline.length === 0 ||
    typeof observed !== "string" ||
    observed.length === 0 ||
    baseline === observed
  ) {
    throw new TypeError("The benchmark pair variants must be distinct names.");
  }
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > MAXIMUM_ORDER_SEED) {
    throw new RangeError("The benchmark order seed must be unsigned 32-bit.");
  }

  const baselineFirstCount =
    Math.floor(pairCount / 2) + (pairCount % 2 === 1 && seed % 2 === 0 ? 1 : 0);
  const orders = Array.from({ length: pairCount }, (_, index) =>
    index < baselineFirstCount
      ? Object.freeze([baseline, observed])
      : Object.freeze([observed, baseline]),
  );
  const random = createSeededRandom(seed);
  for (let index = orders.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [orders[index], orders[swapIndex]] = [orders[swapIndex], orders[index]];
  }
  return Object.freeze(orders);
}

function percentile(sorted, quantile) {
  const position = (sorted.length - 1) * quantile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  if (lower === undefined || upper === undefined) {
    throw new Error("The benchmark distribution is incomplete.");
  }
  return lower + (upper - lower) * (position - lowerIndex);
}

export function summarizeDistribution(values) {
  if (
    values.length === 0 ||
    values.some((value) => typeof value !== "number" || !Number.isFinite(value))
  ) {
    throw new Error("The benchmark distribution must contain finite values.");
  }
  const sorted = values.toSorted((left, right) => left - right);
  const minimum = sorted[0];
  const maximum = sorted.at(-1);
  if (minimum === undefined || maximum === undefined) {
    throw new Error("The benchmark distribution is incomplete.");
  }
  return {
    count: sorted.length,
    minimum: round(minimum),
    p25: round(percentile(sorted, 0.25)),
    median: round(percentile(sorted, 0.5)),
    p75: round(percentile(sorted, 0.75)),
    p95: round(percentile(sorted, 0.95)),
    maximum: round(maximum),
    mean: round(
      sorted.reduce((total, value) => total + value, 0) / sorted.length,
    ),
  };
}

export function summarizePairedMetric(samples, metric) {
  const pairs = new Map();
  for (const sample of samples) {
    if (
      !Number.isSafeInteger(sample.sampleIndex) ||
      sample.sampleIndex < 0 ||
      (sample.variant !== "baseline" && sample.variant !== "observed")
    ) {
      throw new Error("The benchmark sample cannot be paired.");
    }
    const value = sample[metric];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`Telemetry benchmark ${metric} must be finite.`);
    }
    const pair = pairs.get(sample.sampleIndex) ?? {};
    if (pair[sample.variant] !== undefined) {
      throw new Error(
        "The benchmark sample pair contains a duplicate variant.",
      );
    }
    pair[sample.variant] = value;
    pairs.set(sample.sampleIndex, pair);
  }
  const baseline = [];
  const observed = [];
  const pairedDelta = [];
  const indexes = [...pairs.keys()].toSorted((left, right) => left - right);
  for (const [position, sampleIndex] of indexes.entries()) {
    const pair = pairs.get(sampleIndex);
    if (
      sampleIndex !== position ||
      pair?.baseline === undefined ||
      pair.observed === undefined
    ) {
      throw new Error("The benchmark sample pair is incomplete.");
    }
    baseline.push(pair.baseline);
    observed.push(pair.observed);
    pairedDelta.push(pair.observed - pair.baseline);
  }
  const baselineDistribution = summarizeDistribution(baseline);
  const observedDistribution = summarizeDistribution(observed);
  const pairedDeltaDistribution = summarizeDistribution(pairedDelta);
  return {
    baseline: baselineDistribution,
    observed: observedDistribution,
    pairedDelta: pairedDeltaDistribution,
    differenceOfMedians: round(
      observedDistribution.median - baselineDistribution.median,
    ),
    relativeDifferenceOfMediansPercent:
      baselineDistribution.median === 0
        ? null
        : round(
            (observedDistribution.median / baselineDistribution.median - 1) *
              100,
          ),
  };
}
