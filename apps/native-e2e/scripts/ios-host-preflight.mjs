import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const consoleExecutable =
  "/System/Applications/Utilities/Console.app/Contents/MacOS/Console";
const runawayCpuPercent = 50;

export function parseHostProcesses(output) {
  if (typeof output !== "string") {
    throw new TypeError("The host process snapshot must be text.");
  }
  const processes = [];
  for (const line of output.split("\n")) {
    if (line.trim() === "") continue;
    const match = /^\s*(\d+)\s+(\d+(?:\.\d+)?)\s+(.+?)\s*$/u.exec(line);
    if (match === null) continue;
    const processIdentifier = Number(match[1]);
    const cpuPercent = Number(match[2]);
    if (
      !Number.isSafeInteger(processIdentifier) ||
      processIdentifier <= 0 ||
      !Number.isFinite(cpuPercent) ||
      cpuPercent < 0
    ) {
      continue;
    }
    processes.push({
      processIdentifier,
      cpuPercent,
      command: match[3],
    });
  }
  return processes;
}

export function findSustainedConsoleProcesses(
  firstSnapshot,
  secondSnapshot,
  threshold = runawayCpuPercent,
) {
  if (!Number.isFinite(threshold) || threshold <= 0) {
    throw new TypeError("The device-log CPU threshold must be positive.");
  }
  const first = new Map(
    parseHostProcesses(firstSnapshot)
      .filter(
        (process) =>
          process.command === consoleExecutable &&
          process.cpuPercent >= threshold,
      )
      .map((process) => [process.processIdentifier, process]),
  );
  return parseHostProcesses(secondSnapshot)
    .filter(
      (process) =>
        process.command === consoleExecutable &&
        process.cpuPercent >= threshold &&
        first.has(process.processIdentifier),
    )
    .map((process) => ({
      ...process,
      firstCpuPercent: first.get(process.processIdentifier).cpuPercent,
    }));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function hostProcessSnapshot() {
  const { stdout } = await execFileAsync(
    "ps",
    ["-axo", "pid=,pcpu=,command="],
    {
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C" },
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  return stdout;
}

export async function assertIOSHostReady() {
  if (process.platform !== "darwin") return;
  const firstSnapshot = await hostProcessSnapshot();
  await delay(500);
  const secondSnapshot = await hostProcessSnapshot();
  const relays = findSustainedConsoleProcesses(firstSnapshot, secondSnapshot);
  if (relays.length === 0) return;
  const measurements = relays
    .map(
      (relay) =>
        `PID ${String(relay.processIdentifier)} at ${relay.firstCpuPercent.toFixed(1)}%/${relay.cpuPercent.toFixed(1)}% CPU`,
    )
    .join(", ");
  throw new Error(
    `macOS Console is sustaining high CPU while physical-iOS tooling is about to run (${measurements}). Quit Console or stop any connected-device stream first; a device-log relay can keep the phone busy, distort measurements, and cause thermal throttling.`,
  );
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  path.resolve(invokedPath) === fileURLToPath(import.meta.url)
) {
  try {
    await assertIOSHostReady();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
