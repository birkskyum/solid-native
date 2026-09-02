import { readFile, writeFile } from "node:fs/promises";

const BYTES_PER_MEBIBYTE = 1024 * 1024;
const NANOSECONDS_PER_SECOND = 1_000_000_000;
const REQUIRED_SCHEMA_COLUMNS = new Map([
  ["start-time", ["time"]],
  ["system-cpu-percent", ["cpu-percent"]],
  ["duration-on-core", ["cpu-total-system", "cpu-total-user"]],
  [
    "event-count",
    [
      "context-switch",
      "faults",
      "interrupt-wakeups",
      "mach-port-count",
      "msg-received",
      "msg-sent",
      "sys-calls-mach",
      "sys-calls-unix",
      "thread-count",
      "vm-page-ins",
    ],
  ],
  [
    "size-in-bytes",
    [
      "disk-bytes-read",
      "disk-bytes-written",
      "memory-physical-footprint",
      "memory-anonymous",
      "memory-compressed",
      "memory-purgeable",
      "memory-real-private",
      "memory-real-shared",
      "memory-resident-size",
      "memory-virtual-size",
    ],
  ],
]);
const REQUIRED_LIVE_SCHEMA_COLUMNS = new Map([
  ["start-time", ["start"]],
  ["duration", ["duration"]],
  ["system-cpu-percent", ["cpu-percent"]],
  ["duration-on-core", ["cpu-total"]],
  ["event-count", ["thread-count", "mach-port-count", "idle-wakeups"]],
  [
    "size-in-bytes",
    [
      "memory-physical-footprint",
      "memory-real",
      "memory-real-private",
      "memory-real-shared",
      "memory-purgeable",
      "memory-compressed",
    ],
  ],
]);
const RELOAD_BENCHMARKS = new Set([
  "ios-development-runtime-reload",
  "ios-bundled-runtime-reload",
]);

function readNonNegativeNumber(name, fallback) {
  const source = process.env[name];
  if (source === undefined) return fallback;
  const value = Number(source);
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative number.`);
  }
  return value;
}

function readBenchmark() {
  const benchmark =
    process.env.SOLID_NATIVE_IOS_MEMORY_BENCHMARK ??
    "ios-idle-process-resources";
  if (
    benchmark !== "ios-idle-process-resources" &&
    !RELOAD_BENCHMARKS.has(benchmark)
  ) {
    throw new Error("The iOS memory benchmark identity is unsupported.");
  }
  return benchmark;
}

function readNativeCompatibilityIdentity() {
  const fingerprint =
    process.env.SOLID_NATIVE_MEMORY_NATIVE_COMPATIBILITY_FINGERPRINT;
  const inputCount = Number(
    process.env.SOLID_NATIVE_MEMORY_NATIVE_COMPATIBILITY_INPUT_COUNT,
  );
  if (
    fingerprint === undefined ||
    !/^sha256:[a-f\d]{64}$/u.test(fingerprint) ||
    !Number.isSafeInteger(inputCount) ||
    inputCount <= 0
  ) {
    throw new Error(
      "The iOS memory result requires a valid native compatibility fingerprint.",
    );
  }
  return { fingerprint, inputCount };
}

function readElements(source, tagName, valuesById) {
  const pattern = new RegExp(
    `<${tagName}(?=[\\s/>])([^>]*?)(?:\\/>|>([^<]*)<\\/${tagName}>)`,
    "g",
  );
  const values = [];
  for (const match of source.matchAll(pattern)) {
    const attributes = match[1] ?? "";
    const reference = /\bref="(\d+)"/.exec(attributes)?.[1];
    if (reference !== undefined) {
      const value = valuesById.get(reference);
      if (value === undefined) {
        throw new Error(`${tagName} referenced unknown value ${reference}.`);
      }
      values.push(value);
      continue;
    }

    const value = Number(match[2]);
    if (!Number.isFinite(value)) {
      throw new Error(`${tagName} contained a non-numeric value.`);
    }
    const identifier = /\bid="(\d+)"/.exec(attributes)?.[1];
    if (identifier !== undefined) valuesById.set(identifier, value);
    values.push(value);
  }
  return values;
}

function requireActivityMonitorSchema(xml) {
  const schema =
    /<schema\b[^>]*\bname="sysmon-process"[^>]*>([\s\S]*?)<\/schema>/u.exec(
      xml,
    )?.[1];
  if (schema === undefined) {
    throw new Error("The Activity Monitor sysmon-process schema is missing.");
  }
  const actualByType = new Map();
  for (const match of schema.matchAll(/<col>([\s\S]*?)<\/col>/gu)) {
    const column = match[1];
    if (column === undefined) continue;
    const mnemonic = /<mnemonic>([^<]+)<\/mnemonic>/u.exec(column)?.[1];
    const engineeringType =
      /<engineering-type>([^<]+)<\/engineering-type>/u.exec(column)?.[1];
    if (mnemonic === undefined || engineeringType === undefined) {
      throw new Error(
        "The Activity Monitor sysmon-process schema is incomplete.",
      );
    }
    const actual = actualByType.get(engineeringType) ?? [];
    actual.push(mnemonic);
    actualByType.set(engineeringType, actual);
  }
  for (const [engineeringType, expected] of REQUIRED_SCHEMA_COLUMNS) {
    const actual = actualByType.get(engineeringType);
    if (
      actual === undefined ||
      actual.length !== expected.length ||
      actual.some((value, index) => value !== expected[index])
    ) {
      throw new Error(
        `The Activity Monitor ${engineeringType} schema columns changed.`,
      );
    }
  }
}

function parseSamples(xml) {
  requireActivityMonitorSchema(xml);
  const timeValues = new Map();
  const byteValues = new Map();
  const cpuPercentValues = new Map();
  const cpuTimeValues = new Map();
  const eventCountValues = new Map();
  const samples = [];

  for (const row of xml.matchAll(/<row>([\s\S]*?)<\/row>/g)) {
    const source = row[1];
    if (source === undefined) continue;
    const times = readElements(source, "start-time", timeValues);
    const sizes = readElements(source, "size-in-bytes", byteValues);
    const cpuPercents = readElements(
      source,
      "system-cpu-percent",
      cpuPercentValues,
    );
    const cpuTimes = readElements(source, "duration-on-core", cpuTimeValues);
    const eventCounts = readElements(source, "event-count", eventCountValues);
    if (
      times.length !== 1 ||
      sizes.length < 10 ||
      cpuPercents.length > 1 ||
      cpuTimes.length !== 2 ||
      eventCounts.length !== 10
    ) {
      throw new Error("The Activity Monitor sysmon-process row is incomplete.");
    }
    const time = times[0];
    const cpuPercent = cpuPercents[0] ?? null;
    const systemCpuTime = cpuTimes[0];
    const userCpuTime = cpuTimes[1];
    const contextSwitches = eventCounts[0];
    const interruptWakeups = eventCounts[2];
    const threadCount = eventCounts[8];
    const physicalFootprint = sizes[2];
    const residentSize = sizes[8];
    if (
      time === undefined ||
      systemCpuTime === undefined ||
      userCpuTime === undefined ||
      contextSwitches === undefined ||
      interruptWakeups === undefined ||
      threadCount === undefined ||
      physicalFootprint === undefined ||
      residentSize === undefined
    ) {
      throw new Error("The Activity Monitor resource columns are missing.");
    }
    if (
      (cpuPercent !== null && cpuPercent < 0) ||
      systemCpuTime < 0 ||
      userCpuTime < 0 ||
      !Number.isSafeInteger(contextSwitches) ||
      contextSwitches < 0 ||
      !Number.isSafeInteger(interruptWakeups) ||
      interruptWakeups < 0 ||
      !Number.isSafeInteger(threadCount) ||
      threadCount <= 0
    ) {
      throw new Error("The Activity Monitor resource columns are invalid.");
    }
    samples.push({
      time,
      cpuPercent,
      systemCpuTime,
      userCpuTime,
      contextSwitches,
      interruptWakeups,
      threadCount,
      physicalFootprint,
      residentSize,
    });
  }

  if (samples.length < 2) {
    throw new Error(
      "Activity Monitor produced fewer than two process samples.",
    );
  }
  return samples;
}

function requireActivityMonitorLiveSchema(xml) {
  const schema =
    /<schema\b[^>]*\bname="activity-monitor-process-live"[^>]*>([\s\S]*?)<\/schema>/u.exec(
      xml,
    )?.[1];
  if (schema === undefined) {
    throw new Error(
      "The Activity Monitor activity-monitor-process-live schema is missing.",
    );
  }
  const actualByType = new Map();
  for (const match of schema.matchAll(/<col>([\s\S]*?)<\/col>/gu)) {
    const column = match[1];
    if (column === undefined) continue;
    const mnemonic = /<mnemonic>([^<]+)<\/mnemonic>/u.exec(column)?.[1];
    const engineeringType =
      /<engineering-type>([^<]+)<\/engineering-type>/u.exec(column)?.[1];
    if (mnemonic === undefined || engineeringType === undefined) {
      throw new Error(
        "The Activity Monitor live process schema is incomplete.",
      );
    }
    const actual = actualByType.get(engineeringType) ?? [];
    actual.push(mnemonic);
    actualByType.set(engineeringType, actual);
  }
  for (const [engineeringType, expected] of REQUIRED_LIVE_SCHEMA_COLUMNS) {
    const actual = actualByType.get(engineeringType);
    if (
      actual === undefined ||
      actual.length !== expected.length ||
      actual.some((value, index) => value !== expected[index])
    ) {
      throw new Error(
        `The Activity Monitor live ${engineeringType} schema columns changed.`,
      );
    }
  }
}

function parseLiveSamples(xml) {
  requireActivityMonitorLiveSchema(xml);
  const timeValues = new Map();
  const durationValues = new Map();
  const cpuPercentValues = new Map();
  const cpuTimeValues = new Map();
  const eventCountValues = new Map();
  const byteValues = new Map();
  const samples = [];

  for (const row of xml.matchAll(/<row>([\s\S]*?)<\/row>/g)) {
    const source = row[1];
    if (source === undefined) continue;
    const times = readElements(source, "start-time", timeValues);
    const durations = readElements(source, "duration", durationValues);
    const cpuPercents = readElements(
      source,
      "system-cpu-percent",
      cpuPercentValues,
    );
    const cpuTimes = readElements(source, "duration-on-core", cpuTimeValues);
    const eventCounts = readElements(source, "event-count", eventCountValues);
    const sizes = readElements(source, "size-in-bytes", byteValues);
    if (
      times.length !== 1 ||
      durations.length !== 1 ||
      cpuPercents.length > 1 ||
      cpuTimes.length !== 1 ||
      eventCounts.length !== 3 ||
      sizes.length !== 6
    ) {
      throw new Error("The Activity Monitor live process row is incomplete.");
    }
    const startTime = times[0];
    const duration = durations[0];
    const cpuPercent = cpuPercents[0] ?? null;
    const cpuTime = cpuTimes[0];
    const threadCount = eventCounts[0];
    const physicalFootprint = sizes[0];
    const realMemory = sizes[1];
    if (
      startTime === undefined ||
      duration === undefined ||
      cpuTime === undefined ||
      threadCount === undefined ||
      physicalFootprint === undefined ||
      realMemory === undefined ||
      startTime < 0 ||
      duration <= 0 ||
      (cpuPercent !== null && cpuPercent < 0) ||
      cpuTime < 0 ||
      !Number.isSafeInteger(threadCount) ||
      threadCount <= 0 ||
      physicalFootprint < 0 ||
      realMemory < 0
    ) {
      throw new Error("The Activity Monitor live process columns are invalid.");
    }
    samples.push({
      startTime,
      duration,
      cpuPercent,
      cpuTime,
      threadCount,
      physicalFootprint,
      realMemory,
    });
  }

  if (samples.length < 2) {
    throw new Error(
      "Activity Monitor produced fewer than two live process intervals.",
    );
  }
  return samples;
}

function normalizeLiveIntervals(samples, warmupSeconds) {
  let previousEndSeconds;
  let previousCpuTimeNanoseconds;
  const normalized = samples.map((sample) => {
    const startSeconds = sample.startTime / NANOSECONDS_PER_SECOND;
    const intervalSeconds = sample.duration / NANOSECONDS_PER_SECOND;
    const endSeconds = startSeconds + intervalSeconds;
    if (
      previousEndSeconds !== undefined &&
      Math.abs(startSeconds - previousEndSeconds) > 0.25
    ) {
      throw new Error(
        "Activity Monitor's live process intervals are not contiguous.",
      );
    }
    previousEndSeconds = endSeconds;
    const cpuTimeDeltaNanoseconds =
      previousCpuTimeNanoseconds === undefined
        ? null
        : sample.cpuTime - previousCpuTimeNanoseconds;
    previousCpuTimeNanoseconds = sample.cpuTime;
    return {
      startSeconds,
      endSeconds,
      intervalSeconds,
      cpuPercent: sample.cpuPercent,
      cpuTimeNanoseconds: sample.cpuTime,
      cpuTimeDeltaNanoseconds,
      threadCount: sample.threadCount,
      physicalFootprintBytes: sample.physicalFootprint,
      realMemoryBytes: sample.realMemory,
    };
  });
  if ((normalized[0]?.startSeconds ?? Number.POSITIVE_INFINITY) > 0.25) {
    throw new Error(
      "Activity Monitor's live process intervals do not begin at trace start.",
    );
  }
  requireMonotonic(normalized, "cpuTimeNanoseconds");

  const intervals = normalized
    .filter((sample) => sample.endSeconds > warmupSeconds)
    .map((sample) => {
      const effectiveStartSeconds = Math.max(
        sample.startSeconds,
        warmupSeconds,
      );
      return {
        ...sample,
        effectiveStartSeconds,
        effectiveDurationSeconds: sample.endSeconds - effectiveStartSeconds,
      };
    });
  if (intervals.length < 1) {
    throw new Error(
      "The recording has no live process intervals after the warmup window.",
    );
  }
  return intervals;
}

function percentile(values, percentileValue) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1),
  );
  const value = sorted[index];
  if (value === undefined) throw new Error("The percentile set is empty.");
  return value;
}

function weightedPercentile(samples, percentileValue) {
  const sorted = [...samples].sort((left, right) => left.value - right.value);
  const totalWeight = sorted.reduce(
    (total, sample) => total + sample.weight,
    0,
  );
  if (totalWeight <= 0) {
    throw new Error("The weighted percentile set is empty.");
  }
  const threshold = totalWeight * percentileValue;
  let accumulatedWeight = 0;
  for (const sample of sorted) {
    accumulatedWeight += sample.weight;
    if (accumulatedWeight >= threshold) return sample.value;
  }
  const last = sorted.at(-1);
  if (last === undefined)
    throw new Error("The weighted percentile set is empty.");
  return last.value;
}

function requireMonotonic(samples, field) {
  let previous;
  for (const sample of samples) {
    const value = sample[field];
    if (previous !== undefined && value < previous) {
      throw new Error(`Activity Monitor's ${field} counter moved backwards.`);
    }
    previous = value;
  }
}

function summarizeProcessor(samples, durationSeconds) {
  if (durationSeconds <= 0) {
    throw new Error("The Activity Monitor sample duration must be positive.");
  }
  for (const field of [
    "systemCpuTimeNanoseconds",
    "userCpuTimeNanoseconds",
    "contextSwitches",
    "interruptWakeups",
  ]) {
    requireMonotonic(samples, field);
  }
  const cpuPercentSamples = samples
    .map((sample) => sample.cpuPercent)
    .filter((value) => value !== null);
  if (cpuPercentSamples.length < 1) {
    throw new Error(
      "Activity Monitor produced no post-warmup CPU percentage samples.",
    );
  }
  const first = samples[0];
  const last = samples.at(-1);
  if (first === undefined || last === undefined) {
    throw new Error("The processor sample set is incomplete.");
  }
  const cpuTimeNanoseconds =
    last.systemCpuTimeNanoseconds -
    first.systemCpuTimeNanoseconds +
    last.userCpuTimeNanoseconds -
    first.userCpuTimeNanoseconds;
  const cpuTimeSeconds = cpuTimeNanoseconds / NANOSECONDS_PER_SECOND;
  const contextSwitches = last.contextSwitches - first.contextSwitches;
  const interruptWakeups = last.interruptWakeups - first.interruptWakeups;
  const threadCounts = samples.map((sample) => sample.threadCount);
  return {
    cpuPercentSampleCount: cpuPercentSamples.length,
    meanCpuPercent: round(
      cpuPercentSamples.reduce((total, value) => total + value, 0) /
        cpuPercentSamples.length,
      6,
    ),
    p95CpuPercent: round(percentile(cpuPercentSamples, 0.95), 6),
    maximumCpuPercent: round(Math.max(...cpuPercentSamples), 6),
    cpuTimeSeconds: round(cpuTimeSeconds, 6),
    cpuTimeEquivalentPercent: round(
      (cpuTimeSeconds / durationSeconds) * 100,
      6,
    ),
    contextSwitches,
    contextSwitchesPerSecond: round(contextSwitches / durationSeconds, 6),
    interruptWakeups,
    interruptWakeupsPerSecond: round(interruptWakeups / durationSeconds, 6),
    minimumThreadCount: Math.min(...threadCounts),
    maximumThreadCount: Math.max(...threadCounts),
  };
}

function summarizeLiveProcessor(intervals, rawSamples, durationSeconds) {
  if (durationSeconds <= 0) {
    throw new Error("The Activity Monitor sample duration must be positive.");
  }
  const cpuPercentIntervals = intervals
    .filter((sample) => sample.cpuPercent !== null)
    .map((sample) => ({
      value: sample.cpuPercent,
      weight: sample.effectiveDurationSeconds,
    }));
  if (cpuPercentIntervals.length < 1) {
    throw new Error(
      "Activity Monitor produced no post-warmup CPU percentage intervals.",
    );
  }
  const cpuPercentDurationSeconds = cpuPercentIntervals.reduce(
    (total, sample) => total + sample.weight,
    0,
  );
  const firstInterval = intervals[0];
  const lastInterval = intervals.at(-1);
  if (firstInterval === undefined || lastInterval === undefined) {
    throw new Error("The live processor interval set is incomplete.");
  }
  const cpuTimeSeconds =
    intervals.reduce((total, sample) => {
      if (sample.cpuTimeDeltaNanoseconds === null) return total;
      return (
        total +
        sample.cpuTimeDeltaNanoseconds *
          (sample.effectiveDurationSeconds / sample.intervalSeconds)
      );
    }, 0) / NANOSECONDS_PER_SECOND;

  for (const field of ["contextSwitches", "interruptWakeups"]) {
    requireMonotonic(rawSamples, field);
  }
  const firstRawSample = rawSamples[0];
  const lastRawSample = rawSamples.at(-1);
  const contextSwitches =
    firstRawSample === undefined || lastRawSample === undefined
      ? 0
      : lastRawSample.contextSwitches - firstRawSample.contextSwitches;
  const interruptWakeups =
    firstRawSample === undefined || lastRawSample === undefined
      ? 0
      : lastRawSample.interruptWakeups - firstRawSample.interruptWakeups;
  const threadCounts = intervals.map((sample) => sample.threadCount);
  const cpuPercentValues = cpuPercentIntervals.map((sample) => sample.value);
  return {
    cpuPercentSampleCount: cpuPercentIntervals.length,
    cpuPercentDurationSeconds: round(cpuPercentDurationSeconds, 6),
    meanCpuPercent: round(
      cpuPercentIntervals.reduce(
        (total, sample) => total + sample.value * sample.weight,
        0,
      ) / cpuPercentDurationSeconds,
      6,
    ),
    p95CpuPercent: round(weightedPercentile(cpuPercentIntervals, 0.95), 6),
    maximumCpuPercent: round(Math.max(...cpuPercentValues), 6),
    cpuTimeSeconds: round(cpuTimeSeconds, 6),
    cpuTimeEquivalentPercent: round(
      (cpuTimeSeconds / durationSeconds) * 100,
      6,
    ),
    contextSwitches,
    contextSwitchesPerSecond: round(contextSwitches / durationSeconds, 6),
    interruptWakeups,
    interruptWakeupsPerSecond: round(interruptWakeups / durationSeconds, 6),
    minimumThreadCount: Math.min(...threadCounts),
    maximumThreadCount: Math.max(...threadCounts),
  };
}

function round(value, places = 3) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function summarize(samples, field) {
  const firstTime = samples[0]?.elapsedSeconds;
  if (firstTime === undefined) throw new Error("The sample set is empty.");
  const values = samples.map((sample) => sample[field]);
  const meanTime =
    samples.reduce((total, sample) => total + sample.elapsedSeconds, 0) /
    samples.length;
  const meanValue =
    values.reduce((total, value) => total + value, 0) / values.length;
  let numerator = 0;
  let denominator = 0;
  for (const sample of samples) {
    const timeDelta = sample.elapsedSeconds - meanTime;
    numerator += timeDelta * (sample[field] - meanValue);
    denominator += timeDelta * timeDelta;
  }
  const bytesPerSecond = denominator === 0 ? 0 : numerator / denominator;
  const first = values[0];
  const last = values.at(-1);
  if (first === undefined || last === undefined) {
    throw new Error("The sample set is incomplete.");
  }
  return {
    firstBytes: first,
    lastBytes: last,
    minimumBytes: Math.min(...values),
    maximumBytes: Math.max(...values),
    deltaBytes: last - first,
    leastSquaresBytesPerSecond: round(bytesPerSecond),
    leastSquaresMiBPerMinute: round(
      (bytesPerSecond * 60) / BYTES_PER_MEBIBYTE,
      6,
    ),
  };
}

function memoryPointsFromIntervals(intervals, field) {
  const points = intervals.map((sample) => ({
    elapsedSeconds: sample.effectiveStartSeconds,
    [field]: sample[field],
  }));
  const lastInterval = intervals.at(-1);
  if (lastInterval === undefined) {
    throw new Error("The live memory interval set is incomplete.");
  }
  points.push({
    elapsedSeconds: lastInterval.endSeconds,
    [field]: lastInterval[field],
  });
  return points;
}

function memoryPointsFromRawSamples(samples, traceEndSeconds, field) {
  const points = samples.map((sample) => ({
    elapsedSeconds: sample.elapsedSeconds,
    [field]: sample[field],
  }));
  const last = points.at(-1);
  if (last === undefined) return [];
  if (last.elapsedSeconds < traceEndSeconds) {
    points.push({
      elapsedSeconds: traceEndSeconds,
      [field]: last[field],
    });
  }
  return points;
}

function formatMiB(bytes) {
  return `${(bytes / BYTES_PER_MEBIBYTE).toFixed(2)} MiB`;
}

async function main() {
  const [inputPath, liveInputPath, ...unknownArguments] = process.argv.slice(2);
  if (inputPath === undefined || unknownArguments.length > 0) {
    throw new Error(
      "Usage: node ios-memory-report.mjs <sysmon.xml> [process-live.xml]",
    );
  }
  if (process.env.SOLID_NATIVE_IOS_MEMORY_VALIDATE_LIVE_ONLY === "1") {
    if (liveInputPath !== undefined) {
      throw new Error("Live-table validation accepts exactly one input path.");
    }
    const parsedLive = parseLiveSamples(await readFile(inputPath, "utf8"));
    normalizeLiveIntervals(parsedLive, 0);
    console.log(
      `Validated ${String(parsedLive.length)} Activity Monitor live process intervals.`,
    );
    return;
  }
  const xml = await readFile(inputPath, "utf8");
  const parsed = parseSamples(xml);
  if (process.env.SOLID_NATIVE_IOS_MEMORY_VALIDATE_ONLY === "1") {
    console.log(
      `Validated ${String(parsed.length)} Activity Monitor process samples.`,
    );
    return;
  }
  const nativeCompatibility = readNativeCompatibilityIdentity();
  const benchmark = readBenchmark();
  const reloadBenchmark = RELOAD_BENCHMARKS.has(benchmark);
  const warmupSeconds = readNonNegativeNumber(
    "SOLID_NATIVE_IOS_MEMORY_WARMUP",
    5,
  );
  const requestedDurationSeconds = readNonNegativeNumber(
    "SOLID_NATIVE_MEMORY_REQUESTED_DURATION",
    0,
  );
  let schemaVersion;
  let samples;
  let intervals;
  let durationSeconds;
  let physicalFootprint;
  let realMemory;
  let residentSize;
  let processor;
  let rawSampleSpanSeconds;

  if (liveInputPath === undefined) {
    const startedAt = parsed[0]?.time;
    if (startedAt === undefined)
      throw new Error("The first sample is missing.");
    const normalized = parsed.map((sample) => ({
      elapsedSeconds: (sample.time - startedAt) / NANOSECONDS_PER_SECOND,
      cpuPercent: sample.cpuPercent,
      systemCpuTimeNanoseconds: sample.systemCpuTime,
      userCpuTimeNanoseconds: sample.userCpuTime,
      contextSwitches: sample.contextSwitches,
      interruptWakeups: sample.interruptWakeups,
      threadCount: sample.threadCount,
      physicalFootprintBytes: sample.physicalFootprint,
      residentSizeBytes: sample.residentSize,
    }));
    samples = normalized.filter(
      (sample) => sample.elapsedSeconds >= warmupSeconds,
    );
    if (samples.length < 2) {
      throw new Error(
        "The recording has fewer than two samples after the warmup window.",
      );
    }
    durationSeconds =
      (samples.at(-1)?.elapsedSeconds ?? 0) - (samples[0]?.elapsedSeconds ?? 0);
    physicalFootprint = summarize(samples, "physicalFootprintBytes");
    residentSize = summarize(samples, "residentSizeBytes");
    processor = summarizeProcessor(samples, durationSeconds);
    schemaVersion = 1;
  } else {
    const parsedLive = parseLiveSamples(await readFile(liveInputPath, "utf8"));
    intervals = normalizeLiveIntervals(parsedLive, warmupSeconds);
    const traceEndSeconds = intervals.at(-1)?.endSeconds;
    if (traceEndSeconds === undefined) {
      throw new Error("The Activity Monitor live trace end is missing.");
    }
    durationSeconds = traceEndSeconds - warmupSeconds;
    const normalized = parsed.map((sample) => ({
      elapsedSeconds: sample.time / NANOSECONDS_PER_SECOND,
      cpuPercent: sample.cpuPercent,
      systemCpuTimeNanoseconds: sample.systemCpuTime,
      userCpuTimeNanoseconds: sample.userCpuTime,
      contextSwitches: sample.contextSwitches,
      interruptWakeups: sample.interruptWakeups,
      threadCount: sample.threadCount,
      physicalFootprintBytes: sample.physicalFootprint,
      residentSizeBytes: sample.residentSize,
    }));
    samples = normalized.filter(
      (sample) =>
        sample.elapsedSeconds >= warmupSeconds &&
        sample.elapsedSeconds <= traceEndSeconds,
    );
    const rawSummarySamples =
      samples.length > 0
        ? samples
        : [
            {
              ...normalized.at(-1),
              elapsedSeconds: warmupSeconds,
            },
          ];
    if (rawSummarySamples[0]?.contextSwitches === undefined) {
      throw new Error("The Activity Monitor raw process sample is missing.");
    }
    rawSampleSpanSeconds =
      (samples.at(-1)?.elapsedSeconds ?? 0) - (samples[0]?.elapsedSeconds ?? 0);
    physicalFootprint = summarize(
      memoryPointsFromIntervals(intervals, "physicalFootprintBytes"),
      "physicalFootprintBytes",
    );
    realMemory = summarize(
      memoryPointsFromIntervals(intervals, "realMemoryBytes"),
      "realMemoryBytes",
    );
    residentSize = summarize(
      memoryPointsFromRawSamples(
        rawSummarySamples,
        traceEndSeconds,
        "residentSizeBytes",
      ),
      "residentSizeBytes",
    );
    processor = summarizeLiveProcessor(
      intervals,
      rawSummarySamples,
      durationSeconds,
    );
    schemaVersion = 2;
  }

  if (requestedDurationSeconds > 0) {
    const minimumDurationSeconds = Math.max(
      1,
      requestedDurationSeconds - warmupSeconds - 5,
    );
    if (durationSeconds < minimumDurationSeconds) {
      throw new Error(
        `The process produced only ${durationSeconds.toFixed(1)} seconds of post-warmup coverage; expected at least ${minimumDurationSeconds.toFixed(1)}. Keep the device connected and foregrounded; the benchmark suppresses auto-lock after launch.`,
      );
    }
  }
  const result = {
    schemaVersion,
    benchmark,
    measuredAt: new Date().toISOString(),
    interpretation: "diagnostic-only",
    configuration: {
      variant: process.env.SOLID_NATIVE_MEMORY_VARIANT ?? "unknown",
      bundleIdentifier:
        process.env.SOLID_NATIVE_MEMORY_BUNDLE_IDENTIFIER ?? "unknown",
      requestedDurationSeconds,
      warmupSeconds,
      sampleCount: samples.length,
      ...(intervals === undefined
        ? {}
        : {
            rawSampleCount: samples.length,
            rawSampleSpanSeconds: round(rawSampleSpanSeconds ?? 0, 6),
            liveIntervalCount: intervals.length,
          }),
      durationSeconds: round(durationSeconds, 6),
    },
    environment: {
      revision: process.env.SOLID_NATIVE_MEMORY_REVISION ?? "unknown",
      dirty: process.env.SOLID_NATIVE_MEMORY_DIRTY === "true",
      nativeCompatibilityFingerprint: nativeCompatibility.fingerprint,
      nativeCompatibilityInputCount: nativeCompatibility.inputCount,
      deviceModel: process.env.SOLID_NATIVE_MEMORY_DEVICE_MODEL ?? "unknown",
      osVersion: process.env.SOLID_NATIVE_MEMORY_OS_VERSION ?? "unknown",
    },
    processor,
    physicalFootprint,
    ...(realMemory === undefined ? {} : { realMemory }),
    residentSize,
    samples: samples.map((sample) => ({
      elapsedSeconds: round(sample.elapsedSeconds, 6),
      cpuPercent:
        sample.cpuPercent === null ? null : round(sample.cpuPercent, 6),
      systemCpuTimeNanoseconds: sample.systemCpuTimeNanoseconds,
      userCpuTimeNanoseconds: sample.userCpuTimeNanoseconds,
      contextSwitches: sample.contextSwitches,
      interruptWakeups: sample.interruptWakeups,
      threadCount: sample.threadCount,
      physicalFootprintBytes: sample.physicalFootprintBytes,
      residentSizeBytes: sample.residentSizeBytes,
    })),
    ...(intervals === undefined
      ? {}
      : {
          intervals: intervals.map((sample) => ({
            startSeconds: round(sample.startSeconds, 6),
            endSeconds: round(sample.endSeconds, 6),
            effectiveStartSeconds: round(sample.effectiveStartSeconds, 6),
            effectiveDurationSeconds: round(sample.effectiveDurationSeconds, 6),
            cpuPercent:
              sample.cpuPercent === null ? null : round(sample.cpuPercent, 6),
            cpuTimeNanoseconds: sample.cpuTimeNanoseconds,
            cpuTimeDeltaNanoseconds: sample.cpuTimeDeltaNanoseconds,
            threadCount: sample.threadCount,
            physicalFootprintBytes: sample.physicalFootprintBytes,
            realMemoryBytes: sample.realMemoryBytes,
          })),
        }),
  };

  const resultPath = process.env.SOLID_NATIVE_IOS_MEMORY_RESULT_PATH;
  if (resultPath !== undefined && resultPath !== "") {
    await writeFile(
      resultPath,
      `${JSON.stringify(result, undefined, 2)}\n`,
      "utf8",
    );
  }

  console.log(
    `iOS ${benchmark === "ios-bundled-runtime-reload" ? "bundled reload" : reloadBenchmark ? "development reload" : "idle"} resources (${result.configuration.variant}): ` +
      `${String(samples.length)} raw samples` +
      (intervals === undefined
        ? ""
        : ` and ${String(intervals.length)} live intervals`) +
      ` across ${durationSeconds.toFixed(1)} s`,
  );
  console.log(
    `Physical footprint: ${formatMiB(physicalFootprint.firstBytes)} → ` +
      `${formatMiB(physicalFootprint.lastBytes)}; ` +
      `slope ${physicalFootprint.leastSquaresMiBPerMinute.toFixed(3)} MiB/min`,
  );
  console.log(
    `Resident size: ${formatMiB(residentSize.firstBytes)} → ` +
      `${formatMiB(residentSize.lastBytes)}; ` +
      `slope ${residentSize.leastSquaresMiBPerMinute.toFixed(3)} MiB/min`,
  );
  if (realMemory !== undefined) {
    console.log(
      `Live real memory: ${formatMiB(realMemory.firstBytes)} → ` +
        `${formatMiB(realMemory.lastBytes)}; ` +
        `slope ${realMemory.leastSquaresMiBPerMinute.toFixed(3)} MiB/min`,
    );
  }
  console.log(
    `CPU: ${processor.meanCpuPercent.toFixed(3)}% mean, ` +
      `${processor.p95CpuPercent.toFixed(3)}% p95, ` +
      `${processor.interruptWakeupsPerSecond.toFixed(3)} interrupt wakeups/s`,
  );
  console.log(
    `Short ${reloadBenchmark ? "reload" : "idle"} CPU, wakeup, and memory samples are diagnostic evidence, not a general energy or leak verdict.`,
  );
  console.log(`SOLID_NATIVE_IOS_MEMORY_RESULT ${JSON.stringify(result)}`);
}

await main();
