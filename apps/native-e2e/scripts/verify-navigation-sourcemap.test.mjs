import assert from "node:assert/strict";
import test from "node:test";

import { assertNavigationBundle } from "./verify-navigation-sourcemap.mjs";

const sharedSources = [
  "/workspace/apps/native-e2e/generated/SolidNativeBindings.ts",
  "/workspace/packages/core/dist/index.js",
  "/workspace/packages/navigation/dist/error-reporting.js",
  "/workspace/packages/navigation/dist/index.js",
  "/workspace/packages/navigation/dist/tanstack-matches.js",
  "/workspace/packages/navigation/dist/tanstack-router.js",
];

const navigationSources = [
  "/workspace/apps/native-e2e/navigation-restoration.tsx",
  ...sharedSources,
];

const tabsSources = ["/workspace/apps/native-e2e/tabs.tsx", ...sharedSources];

test("accepts the complete direct Solid-owned navigation seams", () => {
  assert.deepEqual(
    assertNavigationBundle(
      { sources: navigationSources },
      "navigation-restoration.tsx",
    ),
    {
      entrypoint: "navigation-restoration.tsx",
      sources: navigationSources,
    },
  );
  assert.deepEqual(
    assertNavigationBundle({ sources: tabsSources }, "tabs.tsx"),
    {
      entrypoint: "tabs.tsx",
      sources: tabsSources,
    },
  );
});

test("accepts indexed navigation maps and an entrypoint path", () => {
  assert.deepEqual(
    assertNavigationBundle(
      {
        sections: [
          { map: { sources: navigationSources.slice(0, 3) } },
          { map: { sources: navigationSources.slice(3) } },
        ],
      },
      "/workspace/apps/native-e2e/navigation-restoration.tsx",
    ),
    {
      entrypoint: "navigation-restoration.tsx",
      sources: navigationSources,
    },
  );
});

test("rejects missing, duplicate, and unexpected Solid navigation sources", () => {
  assert.throws(
    () =>
      assertNavigationBundle(
        { sources: navigationSources.slice(0, -1) },
        "navigation-restoration.tsx",
      ),
    /exactly one Solid-owned navigation source/u,
  );
  assert.throws(
    () =>
      assertNavigationBundle(
        { sources: [...navigationSources, navigationSources[0]] },
        "navigation-restoration.tsx",
      ),
    /exactly one Solid-owned navigation source/u,
  );
  assert.throws(
    () =>
      assertNavigationBundle(
        {
          sources: [
            ...navigationSources,
            "/workspace/packages/navigation/dist/private.js",
          ],
        },
        "navigation-restoration.tsx",
      ),
    /unexpected navigation package sources/u,
  );
});

test("rejects react-native-screens JavaScript and unsupported profiles", () => {
  for (const source of [
    "/workspace/node_modules/react-native-screens/src/index.tsx",
    "/workspace/node_modules/.pnpm/react-native-screens@4.27.0/node_modules/react-native-screens/lib/module/index.js",
  ]) {
    assert.throws(
      () =>
        assertNavigationBundle(
          { sources: [...navigationSources, source] },
          "navigation-restoration.tsx",
        ),
      /react-native-screens JavaScript/u,
    );
  }
  assert.throws(
    () => assertNavigationBundle({ sources: navigationSources }, "unknown.tsx"),
    /Unsupported navigation entrypoint/u,
  );
});
