import assert from "node:assert/strict";
import test from "node:test";

import { assertRefreshableScrollViewBundle } from "./verify-refreshable-scroll-view-sourcemap.mjs";

const requiredSources = [
  "/workspace/apps/native-e2e/refreshable-scroll-view.tsx",
  "/workspace/packages/core/dist/index.js",
];

test("accepts one direct Solid-owned pull-to-refresh seam", () => {
  assert.deepEqual(
    assertRefreshableScrollViewBundle({
      sections: [
        { map: { sources: [...requiredSources, "/workspace/other.js"] } },
      ],
    }),
    requiredSources,
  );
});

test("rejects missing, duplicate, and React Native refresh facades", () => {
  assert.throws(
    () =>
      assertRefreshableScrollViewBundle({ sources: requiredSources.slice(1) }),
    /exactly one pull-to-refresh proof source/u,
  );
  assert.throws(
    () =>
      assertRefreshableScrollViewBundle({
        sources: [...requiredSources, requiredSources[1]],
      }),
    /exactly one pull-to-refresh proof source/u,
  );
  assert.throws(
    () =>
      assertRefreshableScrollViewBundle({
        sources: [
          ...requiredSources,
          "/workspace/node_modules/react-native/Libraries/Components/RefreshControl/RefreshControl.js",
        ],
      }),
    /React Native component facades/u,
  );
});
