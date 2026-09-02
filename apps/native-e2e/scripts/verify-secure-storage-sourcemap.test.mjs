import assert from "node:assert/strict";
import test from "node:test";

import { assertSecureStorageBundle } from "./verify-secure-storage-sourcemap.mjs";

const requiredSources = [
  "/repo/apps/native-e2e/secure-storage.tsx",
  "/repo/packages/secure-storage/dist/index.js",
  "/repo/packages/secure-storage/dist/keychain-10.js",
  "/repo/packages/secure-storage/dist/react-native.js",
  "/repo/packages/secure-storage/dist/solid.js",
];

test("accepts the exact secure-storage package seam", () => {
  assert.deepEqual(
    assertSecureStorageBundle({ sources: requiredSources }),
    requiredSources,
  );
});

test("rejects missing, duplicate, unexpected, and React-facing sources", () => {
  assert.throws(
    () => assertSecureStorageBundle({ sources: requiredSources.slice(1) }),
    /Expected exactly one/u,
  );
  assert.throws(
    () =>
      assertSecureStorageBundle({
        sources: [...requiredSources, requiredSources[0]],
      }),
    /found/u,
  );
  assert.throws(
    () =>
      assertSecureStorageBundle({
        sources: [
          ...requiredSources,
          "/repo/packages/secure-storage/dist/private.js",
        ],
      }),
    /unexpected package sources/u,
  );
  assert.throws(
    () =>
      assertSecureStorageBundle({
        sources: [
          ...requiredSources,
          "/repo/node_modules/react-native-keychain/src/index.ts",
        ],
      }),
    /React-facing keychain facades/u,
  );
});
