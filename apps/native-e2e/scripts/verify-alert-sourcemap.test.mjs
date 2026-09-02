import assert from "node:assert/strict";
import test from "node:test";

import { assertAlertBundle } from "./verify-alert-sourcemap.mjs";

const requiredSources = [
  "/workspace/apps/native-e2e/alert.tsx",
  "/workspace/packages/dialogs/dist/index.js",
  "/workspace/packages/dialogs/dist/react-native-adapter.js",
  "/workspace/packages/dialogs/dist/react-native.js",
  "/workspace/packages/dialogs/dist/solid.js",
];

test("accepts one complete alert application and package seam", () => {
  assert.deepEqual(
    assertAlertBundle({ sources: [...requiredSources, "/workspace/other.js"] }),
    requiredSources,
  );
});

test("rejects omitted, duplicated, and unexpected alert sources", () => {
  assert.throws(
    () => assertAlertBundle({ sources: requiredSources.slice(1) }),
    /exactly one alert proof source/u,
  );
  assert.throws(
    () =>
      assertAlertBundle({
        sources: [...requiredSources, requiredSources[2]],
      }),
    /exactly one alert proof source/u,
  );
  assert.throws(
    () =>
      assertAlertBundle({
        sections: [
          {
            map: {
              sources: [
                ...requiredSources,
                "/workspace/packages/dialogs/src/private.js",
              ],
            },
          },
        ],
      }),
    /unexpected dialog package sources/u,
  );
});
