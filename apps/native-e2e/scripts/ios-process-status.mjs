import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  describeCoreDeviceFailure,
  findSolidNativeProcesses,
} from "./ios-stop-processes.mjs";

const execFileAsync = promisify(execFile);

function installedApplications(document) {
  const applications = document?.result?.apps;
  if (!Array.isArray(applications)) {
    throw new Error("CoreDevice returned no result.apps application list.");
  }
  return applications.flatMap((application) => {
    if (
      typeof application?.url !== "string" ||
      typeof application?.bundleIdentifier !== "string"
    ) {
      return [];
    }
    return [
      {
        bundleIdentifier: application.bundleIdentifier,
        url: application.url.endsWith("/")
          ? application.url
          : `${application.url}/`,
      },
    ];
  });
}

export function createSolidNativeIOSProcessStatus(
  device,
  processDocument,
  applicationDocument,
) {
  if (typeof device !== "string" || device.trim() === "") {
    throw new Error("The iOS process status requires a device identifier.");
  }
  const applications = installedApplications(applicationDocument);
  const processes = findSolidNativeProcesses(processDocument).map((process) => {
    const application = applications.find((candidate) =>
      process.executable.startsWith(candidate.url),
    );
    return Object.freeze({
      processIdentifier: process.processIdentifier,
      bundleIdentifier: application?.bundleIdentifier ?? null,
      executable: process.executable,
    });
  });
  return Object.freeze({
    schemaVersion: 0,
    device,
    processCount: processes.length,
    processes: Object.freeze(processes),
  });
}

async function queryCoreDevice(device, command, outputPath) {
  try {
    await execFileAsync("xcrun", [
      "devicectl",
      "device",
      "info",
      command,
      "--device",
      device,
      "--json-output",
      outputPath,
      "--quiet",
      "--timeout",
      "15",
    ]);
  } catch (error) {
    throw new Error(describeCoreDeviceFailure(error), { cause: error });
  }
  return JSON.parse(await readFile(outputPath, "utf8"));
}

export async function readSolidNativeIOSProcessStatus(device) {
  if (typeof device !== "string" || device.trim() === "") {
    throw new Error(
      "Pass the connected device identifier or set SOLID_NATIVE_IOS_DESTINATION.",
    );
  }
  const directory = await mkdtemp(
    path.join(tmpdir(), "solid-native-ios-status-"),
  );
  try {
    const processDocument = await queryCoreDevice(
      device,
      "processes",
      path.join(directory, "processes.json"),
    );
    const applicationDocument = await queryCoreDevice(
      device,
      "apps",
      path.join(directory, "apps.json"),
    );
    return createSolidNativeIOSProcessStatus(
      device,
      processDocument,
      applicationDocument,
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

export function formatSolidNativeIOSProcessStatus(report) {
  if (report.processCount === 0) {
    return `No Solid Native application or test-runner processes are alive on ${report.device}.`;
  }
  const rows = report.processes.map(
    (process) =>
      `- PID ${String(process.processIdentifier)}: ${process.bundleIdentifier ?? "unknown bundle"}`,
  );
  return [
    `${String(report.processCount)} Solid Native application/test ${report.processCount === 1 ? "process is" : "processes are"} alive on ${report.device}:`,
    ...rows,
  ].join("\n");
}

function parseArguments(arguments_) {
  let json = false;
  let device;
  let separator = false;
  for (const argument of arguments_) {
    if (argument === "--") {
      if (separator) throw new Error("Pass the option separator at most once.");
      separator = true;
      continue;
    }
    if (argument === "--json") {
      if (json) throw new Error("Pass --json at most once.");
      json = true;
      continue;
    }
    if (argument.startsWith("-") || device !== undefined) {
      throw new Error("Usage: ios-process-status.mjs [--json] [device]");
    }
    device = argument;
  }
  return { device, json };
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  path.resolve(invokedPath) === fileURLToPath(import.meta.url)
) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const report = await readSolidNativeIOSProcessStatus(
      options.device ?? process.env.SOLID_NATIVE_IOS_DESTINATION,
    );
    console.log(
      options.json
        ? JSON.stringify(report, null, 2)
        : formatSolidNativeIOSProcessStatus(report),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
