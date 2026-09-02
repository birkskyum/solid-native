import assert from "node:assert/strict";
import test from "node:test";

import { assertVibrationBundle } from "./verify-vibration-sourcemap.mjs";

const requiredSources = [
  "/workspace/apps/native-e2e/vibration.tsx",
  "/workspace/packages/vibration/dist/index.js",
  "/workspace/packages/vibration/dist/react-native-adapter.js",
  "/workspace/packages/vibration/dist/react-native.js",
  "/workspace/packages/vibration/dist/solid.js",
];

test("accepts one complete owner-safe vibration seam", () => {
  assert.deepEqual(
    assertVibrationBundle({
      sources: [...requiredSources, "/workspace/other.js"],
    }),
    requiredSources,
  );
});

test("rejects missing, duplicate, unexpected, and facade sources", () => {
  assert.throws(
    () => assertVibrationBundle({ sources: requiredSources.slice(1) }),
    /exactly one vibration proof source/u,
  );
  assert.throws(
    () =>
      assertVibrationBundle({
        sources: [...requiredSources, requiredSources[2]],
      }),
    /exactly one vibration proof source/u,
  );
  assert.throws(
    () =>
      assertVibrationBundle({
        sections: [
          {
            map: {
              sources: [
                ...requiredSources,
                "/workspace/packages/vibration/src/private.js",
              ],
            },
          },
        ],
      }),
    /unexpected package sources/u,
  );
  assert.throws(
    () =>
      assertVibrationBundle({
        sources: [
          ...requiredSources,
          "/workspace/node_modules/react-native/Libraries/Vibration/Vibration.js",
        ],
      }),
    /React Native vibration facades/u,
  );
});
