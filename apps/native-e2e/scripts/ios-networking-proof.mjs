import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  assertNetworkingServerEvidence,
  createNetworkingProofServer,
  summarizeNetworkingServerEvidence,
} from "./native-networking-proof-server.mjs";

const PROOF_TIMEOUT_MS = 20 * 60_000;
const SIGNALS = Object.freeze(["SIGHUP", "SIGINT", "SIGTERM"]);
const VALID_LOCAL_HOST_NAME =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/u;
const VALID_RUN_PREFIX = /^\/[a-f0-9]{36}$/u;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createIOSNetworkingProofOrigin(
  localHost,
  hostPort,
  pathPrefix,
) {
  const hostname = normalizeLocalProofHost(localHost);
  if (
    !Number.isSafeInteger(hostPort) ||
    hostPort < 1_024 ||
    hostPort > 65_535
  ) {
    throw new RangeError(
      "The iOS proof server needs a non-privileged TCP port.",
    );
  }
  if (typeof pathPrefix !== "string" || !VALID_RUN_PREFIX.test(pathPrefix)) {
    throw new TypeError("The iOS proof server needs a 144-bit run path.");
  }
  return `http://${hostname}:${String(hostPort)}${pathPrefix}`;
}

function isPrivateIPv4Address(hostname) {
  const octets = hostname.split(".");
  if (octets.length !== 4) return false;
  const values = octets.map((octet) => Number(octet));
  if (
    values.some(
      (value, index) =>
        !Number.isInteger(value) ||
        value < 0 ||
        value > 255 ||
        String(value) !== octets[index],
    )
  ) {
    return false;
  }
  return (
    values[0] === 10 ||
    (values[0] === 172 && values[1] >= 16 && values[1] <= 31) ||
    (values[0] === 192 && values[1] === 168)
  );
}

function normalizeLocalProofHost(value) {
  if (typeof value !== "string") {
    throw new TypeError("The Mac proof host must be a bounded local address.");
  }
  if (VALID_LOCAL_HOST_NAME.test(value)) return `${value.toLowerCase()}.local`;
  if (isPrivateIPv4Address(value)) return value;
  throw new TypeError("The Mac proof host must be a bounded local address.");
}

function resolveLocalHostName() {
  const result = spawnSync("scutil", ["--get", "LocalHostName"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Could not read the Mac LocalHostName: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return result.stdout.trim();
}

function runPhysicalTest(scriptPath, origin, onChild) {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", [scriptPath], {
      cwd: path.dirname(path.dirname(scriptPath)),
      env: {
        ...process.env,
        SOLID_NATIVE_IOS_NETWORKING_ORIGIN: origin,
      },
      stdio: "inherit",
    });
    onChild(child);
    let settled = false;
    let timer;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      onChild(undefined);
      if (error === undefined) resolve();
      else reject(error);
    };
    child.once("error", finish);
    child.once("close", (code, signal) => {
      if (code === 0) finish();
      else {
        finish(
          new Error(
            `The iOS networking runner exited with ${
              signal === null ? `status ${String(code)}` : `signal ${signal}`
            }.`,
          ),
        );
      }
    });
    timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(
        new Error(
          `The iOS networking proof exceeded ${String(PROOF_TIMEOUT_MS)}ms.`,
        ),
      );
    }, PROOF_TIMEOUT_MS);
  });
}

async function waitForServerEvidence(state) {
  const deadline = performance.now() + 5_000;
  while (true) {
    try {
      return assertNetworkingServerEvidence(state);
    } catch (error) {
      if (performance.now() >= deadline) throw error;
      await delay(50);
    }
  }
}

async function main() {
  if (process.platform !== "darwin") {
    throw new Error("The physical iOS networking proof requires macOS.");
  }
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const pathPrefix = `/${randomBytes(18).toString("hex")}`;
  const proofServer = await createNetworkingProofServer({
    host: "0.0.0.0",
    pathPrefix,
  });
  const origin = createIOSNetworkingProofOrigin(
    process.env.SOLID_NATIVE_IOS_NETWORKING_HOST ?? resolveLocalHostName(),
    proofServer.hostPort,
    proofServer.pathPrefix,
  );
  let activeChild;
  let cleanupStarted = false;
  const cleanup = async () => {
    if (cleanupStarted) return;
    cleanupStarted = true;
    activeChild?.kill("SIGTERM");
    await proofServer.close();
  };
  const signalHandlers = new Map();
  for (const signal of SIGNALS) {
    const handler = () => {
      void cleanup().finally(() => {
        for (const [registered, registeredHandler] of signalHandlers) {
          process.removeListener(registered, registeredHandler);
        }
        process.kill(process.pid, signal);
      });
    };
    signalHandlers.set(signal, handler);
    process.once(signal, handler);
  }

  try {
    try {
      await runPhysicalTest(
        path.join(scriptDirectory, "ios-networking-test.sh"),
        origin,
        (child) => {
          activeChild = child;
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${message} Privacy-safe server progress: ${JSON.stringify(summarizeNetworkingServerEvidence(proofServer.state))}.`,
        { cause: error },
      );
    }
    const evidence = await waitForServerEvidence(proofServer.state);
    process.stdout.write(
      `Verified physical iOS native networking through ${new URL(origin).hostname}: ${JSON.stringify(evidence)}.\n`,
    );
  } finally {
    for (const [signal, handler] of signalHandlers) {
      process.removeListener(signal, handler);
    }
    await cleanup();
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main();
}
