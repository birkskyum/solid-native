import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createNativeCausalTrace,
  inspectNativeCausalDebugSnapshot,
  parseNativeCausalDebugSnapshotBytes,
} from "../../../packages/cli/dist/index.js";

function findCausalChain(snapshot) {
  const byId = new Map(
    snapshot.operations.map((operation) => [operation.operationId, operation]),
  );
  for (const frame of snapshot.operations) {
    if (frame.name !== "solid-native.frame") continue;
    for (const mountId of frame.causes) {
      const mount = byId.get(mountId);
      if (mount?.name !== "solid-native.mount") continue;
      for (const commitId of mount.causes) {
        const commit = byId.get(commitId);
        if (commit?.name !== "solid-native.commit") continue;
        for (const surfaceId of commit.causes) {
          const surface = byId.get(surfaceId);
          if (surface?.name === "solid-native.surface") {
            return { surface, commit, mount, frame };
          }
        }
      }
    }
  }
  return undefined;
}

/** Verifies that a physical capture preserved the complete host-to-frame proof. */
export function verifyNativeCausalDebugPhysicalProof(snapshot) {
  if (findCausalChain(snapshot) === undefined) {
    throw new Error(
      "The device snapshot did not retain a complete surface-to-commit-to-mount-to-frame causal chain.",
    );
  }
  const inspection = inspectNativeCausalDebugSnapshot(snapshot);
  const trace = createNativeCausalTrace(snapshot);
  const slices = trace.filter((event) => event.ph === "X").length;
  const flows = trace.filter(
    (event) => event.ph === "s" || event.ph === "f",
  ).length;
  if (slices < 4 || flows < 6) {
    throw new Error(
      "The device trace did not retain complete operation slices and causal flows.",
    );
  }
  return Object.freeze({
    operationCount: inspection.operationCount,
    activeOperationCount: inspection.activeOperationCount,
    slices,
    flows,
  });
}

async function main(arguments_) {
  if (arguments_.length !== 1) {
    throw new Error("Usage: causal-debug-physical-proof.mjs SNAPSHOT");
  }
  const snapshotPath = path.resolve(arguments_[0]);
  const snapshot = parseNativeCausalDebugSnapshotBytes(
    new Uint8Array(await readFile(snapshotPath)),
  );
  process.stdout.write(
    `SOLID_NATIVE_CAUSAL_DEBUG_PROOF ${JSON.stringify(verifyNativeCausalDebugPhysicalProof(snapshot))}\n`,
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main(process.argv.slice(2));
}
