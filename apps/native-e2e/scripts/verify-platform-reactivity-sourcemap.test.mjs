import assert from "node:assert/strict";
import test from "node:test";

import { assertPlatformReactivityBundle } from "./verify-platform-reactivity-sourcemap.mjs";

const requiredSources = [
  "/workspace/apps/native-e2e/platform-reactivity.tsx",
  "/workspace/packages/core/dist/index.js",
  "/workspace/packages/runtime/dist/index.js",
  "/workspace/packages/runtime/dist/platform-services.js",
  "/workspace/packages/runtime/dist/react-native-platform-services.js",
  "/workspace/node_modules/react-native/Libraries/Utilities/Appearance.js",
  "/workspace/node_modules/react-native/Libraries/Utilities/Dimensions.js",
];

test("accepts one complete hook-free platform-reactivity seam", () => {
  assert.deepEqual(
    assertPlatformReactivityBundle({ sources: requiredSources }),
    requiredSources,
  );
});

test("accepts indexed platform-reactivity source maps", () => {
  assert.deepEqual(
    assertPlatformReactivityBundle({
      sections: [
        { map: { sources: requiredSources.slice(0, 3) } },
        { map: { sources: requiredSources.slice(3) } },
      ],
    }),
    requiredSources,
  );
});

test("rejects incomplete, duplicate, or unexpected package seams", () => {
  assert.throws(
    () =>
      assertPlatformReactivityBundle({
        sources: requiredSources.slice(0, -1),
      }),
    /exactly one platform-reactivity proof source/u,
  );
  assert.throws(
    () =>
      assertPlatformReactivityBundle({
        sources: [...requiredSources, requiredSources[1]],
      }),
    /exactly one platform-reactivity proof source/u,
  );
  assert.throws(
    () =>
      assertPlatformReactivityBundle({
        sources: [
          ...requiredSources,
          "/workspace/packages/runtime/dist/private.js",
        ],
      }),
    /unexpected package sources/u,
  );
});

test("rejects React Native appearance and dimensions hooks", () => {
  for (const hook of [
    "/workspace/node_modules/react-native/Libraries/Utilities/useColorScheme.js",
    "/workspace/node_modules/react-native/Libraries/Utilities/useWindowDimensions.js",
  ]) {
    assert.throws(
      () =>
        assertPlatformReactivityBundle({
          sources: [...requiredSources, hook],
        }),
      /React Native appearance or dimensions hooks/u,
    );
  }
});
