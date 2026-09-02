import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const reporterPath = path.join(scriptDirectory, "ios-memory-report.mjs");
const schema = `<schema name="sysmon-process">
  <col><mnemonic>time</mnemonic><engineering-type>start-time</engineering-type></col>
  <col><mnemonic>cpu-percent</mnemonic><engineering-type>system-cpu-percent</engineering-type></col>
  <col><mnemonic>cpu-total-system</mnemonic><engineering-type>duration-on-core</engineering-type></col>
  <col><mnemonic>cpu-total-user</mnemonic><engineering-type>duration-on-core</engineering-type></col>
  <col><mnemonic>context-switch</mnemonic><engineering-type>event-count</engineering-type></col>
  <col><mnemonic>faults</mnemonic><engineering-type>event-count</engineering-type></col>
  <col><mnemonic>interrupt-wakeups</mnemonic><engineering-type>event-count</engineering-type></col>
  <col><mnemonic>mach-port-count</mnemonic><engineering-type>event-count</engineering-type></col>
  <col><mnemonic>msg-received</mnemonic><engineering-type>event-count</engineering-type></col>
  <col><mnemonic>msg-sent</mnemonic><engineering-type>event-count</engineering-type></col>
  <col><mnemonic>sys-calls-mach</mnemonic><engineering-type>event-count</engineering-type></col>
  <col><mnemonic>sys-calls-unix</mnemonic><engineering-type>event-count</engineering-type></col>
  <col><mnemonic>thread-count</mnemonic><engineering-type>event-count</engineering-type></col>
  <col><mnemonic>vm-page-ins</mnemonic><engineering-type>event-count</engineering-type></col>
  <col><mnemonic>disk-bytes-read</mnemonic><engineering-type>size-in-bytes</engineering-type></col>
  <col><mnemonic>disk-bytes-written</mnemonic><engineering-type>size-in-bytes</engineering-type></col>
  <col><mnemonic>memory-physical-footprint</mnemonic><engineering-type>size-in-bytes</engineering-type></col>
  <col><mnemonic>memory-anonymous</mnemonic><engineering-type>size-in-bytes</engineering-type></col>
  <col><mnemonic>memory-compressed</mnemonic><engineering-type>size-in-bytes</engineering-type></col>
  <col><mnemonic>memory-purgeable</mnemonic><engineering-type>size-in-bytes</engineering-type></col>
  <col><mnemonic>memory-real-private</mnemonic><engineering-type>size-in-bytes</engineering-type></col>
  <col><mnemonic>memory-real-shared</mnemonic><engineering-type>size-in-bytes</engineering-type></col>
  <col><mnemonic>memory-resident-size</mnemonic><engineering-type>size-in-bytes</engineering-type></col>
  <col><mnemonic>memory-virtual-size</mnemonic><engineering-type>size-in-bytes</engineering-type></col>
</schema>`;
const liveSchema = `<schema name="activity-monitor-process-live">
  <col><mnemonic>start</mnemonic><engineering-type>start-time</engineering-type></col>
  <col><mnemonic>duration</mnemonic><engineering-type>duration</engineering-type></col>
  <col><mnemonic>cpu-percent</mnemonic><engineering-type>system-cpu-percent</engineering-type></col>
  <col><mnemonic>cpu-total</mnemonic><engineering-type>duration-on-core</engineering-type></col>
  <col><mnemonic>thread-count</mnemonic><engineering-type>event-count</engineering-type></col>
  <col><mnemonic>mach-port-count</mnemonic><engineering-type>event-count</engineering-type></col>
  <col><mnemonic>idle-wakeups</mnemonic><engineering-type>event-count</engineering-type></col>
  <col><mnemonic>memory-physical-footprint</mnemonic><engineering-type>size-in-bytes</engineering-type></col>
  <col><mnemonic>memory-real</mnemonic><engineering-type>size-in-bytes</engineering-type></col>
  <col><mnemonic>memory-real-private</mnemonic><engineering-type>size-in-bytes</engineering-type></col>
  <col><mnemonic>memory-real-shared</mnemonic><engineering-type>size-in-bytes</engineering-type></col>
  <col><mnemonic>memory-purgeable</mnemonic><engineering-type>size-in-bytes</engineering-type></col>
  <col><mnemonic>memory-compressed</mnemonic><engineering-type>size-in-bytes</engineering-type></col>
</schema>`;

function memoryRow(
  time,
  physicalFootprint,
  residentSize,
  {
    cpuPercent,
    systemCpuTime,
    userCpuTime,
    contextSwitches,
    interruptWakeups,
    threadCount,
  },
) {
  const sizes = [
    0,
    0,
    physicalFootprint,
    physicalFootprint - 100,
    0,
    0,
    physicalFootprint - 200,
    residentSize - 100,
    residentSize,
    residentSize * 10,
  ];
  const eventCounts = [
    contextSwitches,
    1_000,
    interruptWakeups,
    100,
    200,
    300,
    400,
    500,
    threadCount,
    600,
  ];
  return (
    `<row><start-time>${String(time)}</start-time>` +
    `<system-cpu-percent>${String(cpuPercent)}</system-cpu-percent>` +
    `<duration-on-core>${String(systemCpuTime)}</duration-on-core>` +
    `<duration-on-core>${String(userCpuTime)}</duration-on-core>` +
    sizes
      .map((value) => `<size-in-bytes>${String(value)}</size-in-bytes>`)
      .join("") +
    eventCounts
      .map((value) => `<event-count>${String(value)}</event-count>`)
      .join("") +
    "</row>"
  );
}

function liveRow(
  startTime,
  duration,
  physicalFootprint,
  realMemory,
  { cpuPercent, cpuTime, threadCount },
) {
  return (
    `<row><start-time>${String(startTime)}</start-time>` +
    `<duration>${String(duration)}</duration>` +
    `<system-cpu-percent>${String(cpuPercent)}</system-cpu-percent>` +
    `<duration-on-core>${String(cpuTime)}</duration-on-core>` +
    `<event-count>${String(threadCount)}</event-count>` +
    "<event-count>100</event-count>" +
    "<event-count>2</event-count>" +
    `<size-in-bytes>${String(physicalFootprint)}</size-in-bytes>` +
    `<size-in-bytes>${String(realMemory)}</size-in-bytes>` +
    `<size-in-bytes>${String(realMemory - 1_000)}</size-in-bytes>` +
    "<size-in-bytes>1000</size-in-bytes>" +
    "<size-in-bytes>0</size-in-bytes>" +
    "<size-in-bytes>0</size-in-bytes>" +
    "<size-in-bytes-per-second>0</size-in-bytes-per-second></row>"
  );
}

async function fixture(t, durationSeconds, lastContextSwitches = 112) {
  const directory = await mkdtemp(path.join(tmpdir(), "solid-native-memory-"));
  t.after(async () => {
    await rm(directory, { force: true, recursive: true });
  });
  const inputPath = path.join(directory, "sysmon.xml");
  await writeFile(
    inputPath,
    `<trace>${schema}${memoryRow(0, 10_000, 20_000, {
      cpuPercent: 0.25,
      systemCpuTime: 1_000_000_000,
      userCpuTime: 2_000_000_000,
      contextSwitches: 100,
      interruptWakeups: 20,
      threadCount: 8,
    })}${memoryRow(durationSeconds * 1_000_000_000, 11_000, 21_000, {
      cpuPercent: 0.5,
      systemCpuTime: 1_100_000_000,
      userCpuTime: 2_200_000_000,
      contextSwitches: lastContextSwitches,
      interruptWakeups: 26,
      threadCount: 9,
    })}</trace>`,
  );
  return inputPath;
}

async function liveFixture(inputPath) {
  const liveInputPath = path.join(path.dirname(inputPath), "process-live.xml");
  await writeFile(
    liveInputPath,
    `<trace>${liveSchema}${liveRow(0, 2_000_000_000, 10_000, 20_000, {
      cpuPercent: 0.5,
      cpuTime: 3_000_000_000,
      threadCount: 8,
    })}${liveRow(2_000_000_000, 4_000_000_000, 11_000, 21_000, {
      cpuPercent: 0.25,
      cpuTime: 3_100_000_000,
      threadCount: 9,
    })}</trace>`,
  );
  return liveInputPath;
}

function reporterEnvironment(resultPath) {
  return {
    ...process.env,
    SOLID_NATIVE_IOS_MEMORY_WARMUP: "0",
    SOLID_NATIVE_MEMORY_BUNDLE_IDENTIFIER: "dev.solidnative.fixture",
    SOLID_NATIVE_MEMORY_REQUESTED_DURATION: "10",
    SOLID_NATIVE_MEMORY_VARIANT: "solid",
    SOLID_NATIVE_MEMORY_NATIVE_COMPATIBILITY_FINGERPRINT: `sha256:${"a".repeat(64)}`,
    SOLID_NATIVE_MEMORY_NATIVE_COMPATIBILITY_INPUT_COUNT: "103",
    ...(resultPath === undefined
      ? {}
      : { SOLID_NATIVE_IOS_MEMORY_RESULT_PATH: resultPath }),
  };
}

test("emits a result when the requested memory window is covered", async (t) => {
  const inputPath = await fixture(t, 6);
  const resultPath = path.join(path.dirname(inputPath), "resource-result.json");
  const { stdout } = await execFileAsync(
    process.execPath,
    [reporterPath, inputPath],
    {
      env: reporterEnvironment(resultPath),
    },
  );
  const marker = "SOLID_NATIVE_IOS_MEMORY_RESULT ";
  const resultLine = stdout
    .split(/\r?\n/u)
    .find((line) => line.startsWith(marker));
  assert.ok(resultLine);
  const result = JSON.parse(resultLine.slice(marker.length));
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.benchmark, "ios-idle-process-resources");
  assert.equal(result.configuration.requestedDurationSeconds, 10);
  assert.equal(result.configuration.durationSeconds, 6);
  assert.equal(result.configuration.sampleCount, 2);
  assert.equal(
    result.environment.nativeCompatibilityFingerprint,
    `sha256:${"a".repeat(64)}`,
  );
  assert.equal(result.environment.nativeCompatibilityInputCount, 103);
  assert.deepEqual(result.processor, {
    cpuPercentSampleCount: 2,
    meanCpuPercent: 0.375,
    p95CpuPercent: 0.5,
    maximumCpuPercent: 0.5,
    cpuTimeSeconds: 0.3,
    cpuTimeEquivalentPercent: 5,
    contextSwitches: 12,
    contextSwitchesPerSecond: 2,
    interruptWakeups: 6,
    interruptWakeupsPerSecond: 1,
    minimumThreadCount: 8,
    maximumThreadCount: 9,
  });
  assert.deepEqual(JSON.parse(await readFile(resultPath, "utf8")), result);
});

test("labels an explicitly selected development-reload resource recording", async (t) => {
  const inputPath = await fixture(t, 6);
  const { stdout } = await execFileAsync(
    process.execPath,
    [reporterPath, inputPath],
    {
      env: {
        ...reporterEnvironment(),
        SOLID_NATIVE_IOS_MEMORY_BENCHMARK: "ios-development-runtime-reload",
      },
    },
  );
  assert.match(stdout, /iOS development reload resources/u);
  assert.match(stdout, /"benchmark":"ios-development-runtime-reload"/u);
});

test("labels an explicitly selected bundled-reload resource recording", async (t) => {
  const inputPath = await fixture(t, 6);
  const { stdout } = await execFileAsync(
    process.execPath,
    [reporterPath, inputPath],
    {
      env: {
        ...reporterEnvironment(),
        SOLID_NATIVE_IOS_MEMORY_BENCHMARK: "ios-bundled-runtime-reload",
      },
    },
  );
  assert.match(stdout, /iOS bundled reload resources/u);
  assert.match(stdout, /"benchmark":"ios-bundled-runtime-reload"/u);
});

test("rejects an unknown resource benchmark identity", async (t) => {
  const inputPath = await fixture(t, 6);
  await assert.rejects(
    execFileAsync(process.execPath, [reporterPath, inputPath], {
      env: {
        ...reporterEnvironment(),
        SOLID_NATIVE_IOS_MEMORY_BENCHMARK: "arbitrary-benchmark",
      },
    }),
    (error) => {
      assert.match(String(error.stderr), /benchmark identity is unsupported/u);
      return true;
    },
  );
});

test("uses live intervals to cover a sparse idle process trace", async (t) => {
  const inputPath = await fixture(t, 6);
  const liveInputPath = await liveFixture(inputPath);
  const { stdout } = await execFileAsync(
    process.execPath,
    [reporterPath, inputPath, liveInputPath],
    { env: reporterEnvironment() },
  );
  const marker = "SOLID_NATIVE_IOS_MEMORY_RESULT ";
  const resultLine = stdout
    .split(/\r?\n/u)
    .find((line) => line.startsWith(marker));
  assert.ok(resultLine);
  const result = JSON.parse(resultLine.slice(marker.length));

  assert.equal(result.schemaVersion, 2);
  assert.equal(result.configuration.durationSeconds, 6);
  assert.equal(result.configuration.rawSampleCount, 2);
  assert.equal(result.configuration.rawSampleSpanSeconds, 6);
  assert.equal(result.configuration.liveIntervalCount, 2);
  assert.equal(result.processor.cpuPercentSampleCount, 2);
  assert.equal(result.processor.cpuPercentDurationSeconds, 6);
  assert.equal(result.processor.meanCpuPercent, 0.333333);
  assert.equal(result.processor.p95CpuPercent, 0.5);
  assert.equal(result.processor.maximumCpuPercent, 0.5);
  assert.equal(result.processor.cpuTimeSeconds, 0.1);
  assert.equal(result.processor.cpuTimeEquivalentPercent, 1.666667);
  assert.equal(result.processor.contextSwitches, 12);
  assert.equal(result.processor.interruptWakeups, 6);
  assert.equal(result.processor.minimumThreadCount, 8);
  assert.equal(result.processor.maximumThreadCount, 9);
  assert.equal(result.realMemory.firstBytes, 20_000);
  assert.equal(result.realMemory.lastBytes, 21_000);
  assert.equal(result.intervals.length, 2);
});

test("validates a complete exported table without benchmark metadata", async (t) => {
  const inputPath = await fixture(t, 1);
  const { stdout } = await execFileAsync(
    process.execPath,
    [reporterPath, inputPath],
    {
      env: {
        ...process.env,
        SOLID_NATIVE_IOS_MEMORY_VALIDATE_ONLY: "1",
      },
    },
  );

  assert.match(stdout, /Validated 2 Activity Monitor process samples\./u);
});

test("rejects an incomplete exported table during validation", async (t) => {
  const inputPath = await fixture(t, 1);
  const source = await readFile(inputPath, "utf8");
  await writeFile(inputPath, source.replace("thread-count", "task-count"));

  await assert.rejects(
    execFileAsync(process.execPath, [reporterPath, inputPath], {
      env: {
        ...process.env,
        SOLID_NATIVE_IOS_MEMORY_VALIDATE_ONLY: "1",
      },
    }),
    (error) => {
      assert.match(String(error.stderr), /event-count schema columns changed/u);
      return true;
    },
  );
});

test("validates a complete live interval table without benchmark metadata", async (t) => {
  const inputPath = await fixture(t, 1);
  const liveInputPath = await liveFixture(inputPath);
  const { stdout } = await execFileAsync(
    process.execPath,
    [reporterPath, liveInputPath],
    {
      env: {
        ...process.env,
        SOLID_NATIVE_IOS_MEMORY_VALIDATE_LIVE_ONLY: "1",
      },
    },
  );

  assert.match(
    stdout,
    /Validated 2 Activity Monitor live process intervals\./u,
  );
});

test("rejects a changed live interval schema during validation", async (t) => {
  const inputPath = await fixture(t, 1);
  const liveInputPath = await liveFixture(inputPath);
  const source = await readFile(liveInputPath, "utf8");
  await writeFile(
    liveInputPath,
    source.replace("idle-wakeups", "timer-wakeups"),
  );

  await assert.rejects(
    execFileAsync(process.execPath, [reporterPath, liveInputPath], {
      env: {
        ...process.env,
        SOLID_NATIVE_IOS_MEMORY_VALIDATE_LIVE_ONLY: "1",
      },
    }),
    (error) => {
      assert.match(
        String(error.stderr),
        /live event-count schema columns changed/u,
      );
      return true;
    },
  );
});

test("rejects a noncontiguous live interval export", async (t) => {
  const inputPath = await fixture(t, 1);
  const liveInputPath = await liveFixture(inputPath);
  const source = await readFile(liveInputPath, "utf8");
  await writeFile(
    liveInputPath,
    source.replace(
      "<start-time>2000000000</start-time>",
      "<start-time>3000000000</start-time>",
    ),
  );

  await assert.rejects(
    execFileAsync(process.execPath, [reporterPath, liveInputPath], {
      env: {
        ...process.env,
        SOLID_NATIVE_IOS_MEMORY_VALIDATE_LIVE_ONLY: "1",
      },
    }),
    (error) => {
      assert.match(String(error.stderr), /intervals are not contiguous/u);
      return true;
    },
  );
});

test("rejects missing native compatibility identity", async (t) => {
  const inputPath = await fixture(t, 6);
  const environment = reporterEnvironment();
  delete environment.SOLID_NATIVE_MEMORY_NATIVE_COMPATIBILITY_FINGERPRINT;
  await assert.rejects(
    execFileAsync(process.execPath, [reporterPath, inputPath], {
      env: environment,
    }),
    (error) => {
      assert.match(
        String(error.stderr),
        /requires a valid native compatibility fingerprint/u,
      );
      return true;
    },
  );
});

test("rejects a trace truncated by process suspension", async (t) => {
  const inputPath = await fixture(t, 3);
  await assert.rejects(
    execFileAsync(process.execPath, [reporterPath, inputPath], {
      env: reporterEnvironment(),
    }),
    (error) => {
      assert.match(
        String(error.stderr),
        /produced only 3\.0 seconds.+expected at least 5\.0/u,
      );
      assert.match(String(error.stderr), /suppresses auto-lock/u);
      return true;
    },
  );
});

test("rejects a process counter that moves backwards", async (t) => {
  const inputPath = await fixture(t, 6, 99);
  await assert.rejects(
    execFileAsync(process.execPath, [reporterPath, inputPath], {
      env: reporterEnvironment(),
    }),
    (error) => {
      assert.match(
        String(error.stderr),
        /contextSwitches counter moved backwards/u,
      );
      return true;
    },
  );
});

test("rejects an Activity Monitor schema that changes column meaning", async (t) => {
  const inputPath = await fixture(t, 6);
  const source = await readFile(inputPath, "utf8");
  await writeFile(
    inputPath,
    source.replace("interrupt-wakeups", "timer-wakeups"),
  );
  await assert.rejects(
    execFileAsync(process.execPath, [reporterPath, inputPath], {
      env: reporterEnvironment(),
    }),
    (error) => {
      assert.match(String(error.stderr), /event-count schema columns changed/u);
      return true;
    },
  );
});
