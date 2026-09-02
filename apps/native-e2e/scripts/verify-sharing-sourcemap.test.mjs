import assert from "node:assert/strict";
import test from "node:test";

import { assertSharingBundle } from "./verify-sharing-sourcemap.mjs";

const requiredSources = [
  "/workspace/apps/native-e2e/sharing.tsx",
  "/workspace/packages/sharing/dist/index.js",
  "/workspace/packages/sharing/dist/react-native-adapter.js",
  "/workspace/packages/sharing/dist/react-native.js",
  "/workspace/packages/sharing/dist/solid.js",
];

test("accepts one complete direct-native sharing seam", () => {
  assert.deepEqual(
    assertSharingBundle({
      sources: [...requiredSources, "/workspace/other.js"],
    }),
    requiredSources,
  );
});

test("rejects missing, duplicate, unexpected, and facade sources", () => {
  assert.throws(
    () => assertSharingBundle({ sources: requiredSources.slice(1) }),
    /exactly one sharing proof source/u,
  );
  assert.throws(
    () =>
      assertSharingBundle({
        sources: [...requiredSources, requiredSources[2]],
      }),
    /exactly one sharing proof source/u,
  );
  assert.throws(
    () =>
      assertSharingBundle({
        sections: [
          {
            map: {
              sources: [
                ...requiredSources,
                "/workspace/packages/sharing/src/private.js",
              ],
            },
          },
        ],
      }),
    /unexpected package sources/u,
  );
  assert.throws(
    () =>
      assertSharingBundle({
        sources: [
          ...requiredSources,
          "/workspace/node_modules/react-native/Libraries/Share/Share.js",
        ],
      }),
    /React Native sharing facades/u,
  );
});
