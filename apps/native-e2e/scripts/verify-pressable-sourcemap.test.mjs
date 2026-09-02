import assert from "node:assert/strict";
import test from "node:test";

import { assertPressableBundle } from "./verify-pressable-sourcemap.mjs";

const requiredSources = [
  "/workspace/apps/native-e2e/pressable.tsx",
  "/workspace/packages/core/dist/index.js",
];

test("accepts the direct Solid-owned Pressable bundle", () => {
  assert.deepEqual(
    assertPressableBundle({ sources: requiredSources }),
    requiredSources,
  );
});

test("requires the proof entrypoint and core facade exactly once", () => {
  assert.throws(
    () => assertPressableBundle({ sources: requiredSources.slice(1) }),
    /Expected exactly one Pressable proof source/u,
  );
  assert.throws(
    () =>
      assertPressableBundle({
        sources: [...requiredSources, requiredSources[1]],
      }),
    /Expected exactly one Pressable proof source/u,
  );
});

test("rejects React Pressability and ripple wrappers", () => {
  for (const source of [
    "/workspace/node_modules/react-native/Libraries/Components/Pressable/Pressable.js",
    "/workspace/node_modules/react-native/Libraries/Components/Pressable/useAndroidRippleForView.js",
    "/workspace/node_modules/react-native/Libraries/Pressability/Pressability.js",
    "/workspace/node_modules/react-native/Libraries/Pressability/usePressability.js",
  ]) {
    assert.throws(
      () => assertPressableBundle({ sources: [...requiredSources, source] }),
      /retained React's Pressable implementation/u,
    );
  }
});
