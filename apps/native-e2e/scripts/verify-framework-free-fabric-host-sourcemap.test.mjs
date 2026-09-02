import assert from "node:assert/strict";
import test from "node:test";

import { assertFrameworkFreeFabricHostBundle } from "./verify-framework-free-fabric-host-sourcemap.mjs";

const validSources = [
  "/workspace/apps/native-e2e/fabric-host.ts",
  "/workspace/packages/fabric-host/src/index.ts",
  "/workspace/packages/host-contract/src/index.ts",
  "/workspace/node_modules/.pnpm/react-native@0.87.0/node_modules/react-native/src/setup-env.js",
];

test("accepts a Fabric Host bundle without a framework renderer", () => {
  assert.deepEqual(
    assertFrameworkFreeFabricHostBundle({ sources: validSources }),
    {
      fabricHostSources: ["/workspace/packages/fabric-host/src/index.ts"],
      hostContractSources: ["/workspace/packages/host-contract/src/index.ts"],
    },
  );
});

test("rejects Solid and renderer sources in a framework-free bundle", () => {
  for (const forbidden of [
    "/workspace/node_modules/.pnpm/solid-js@2.0.0/node_modules/solid-js/dist/solid.js",
    "/workspace/node_modules/.pnpm/@solidjs+signals@2.0.0/node_modules/@solidjs/signals/dist/prod/index.js",
    "/workspace/packages/renderer/src/index.ts",
    "/workspace/packages/runtime/src/index.ts",
    "/workspace/packages/core/src/index.ts",
    "/workspace/packages/navigation/src/index.ts",
  ]) {
    assert.throws(
      () =>
        assertFrameworkFreeFabricHostBundle({
          sources: [...validSources, forbidden],
        }),
      /retained framework sources/,
    );
  }
});
