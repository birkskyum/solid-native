import assert from "node:assert/strict";
import test from "node:test";

import { assertLinkingBundle } from "./verify-linking-sourcemap.mjs";

const requiredSources = [
  "/workspace/apps/native-e2e/linking.tsx",
  "/workspace/packages/core/dist/index.js",
  "/workspace/packages/observability/dist/index.js",
  "/workspace/packages/runtime/dist/index.js",
  "/workspace/packages/runtime/dist/platform-services.js",
  "/workspace/packages/runtime/dist/react-native-platform-services.js",
  "/workspace/node_modules/react-native/Libraries/EventEmitter/NativeEventEmitter.js",
  "/workspace/node_modules/react-native/Libraries/TurboModule/TurboModuleRegistry.js",
];

test("accepts one complete direct-TurboModule Linking seam", () => {
  assert.deepEqual(
    assertLinkingBundle({ sources: requiredSources }),
    requiredSources,
  );
});

test("accepts indexed Linking source maps", () => {
  assert.deepEqual(
    assertLinkingBundle({
      sections: [
        { map: { sources: requiredSources.slice(0, 4) } },
        { map: { sources: requiredSources.slice(4) } },
      ],
    }),
    requiredSources,
  );
});

test("rejects incomplete, duplicate, or unexpected platform seams", () => {
  assert.throws(
    () => assertLinkingBundle({ sources: requiredSources.slice(0, -1) }),
    /exactly one direct-Linking proof source/u,
  );
  assert.throws(
    () =>
      assertLinkingBundle({
        sources: [...requiredSources, requiredSources[1]],
      }),
    /exactly one direct-Linking proof source/u,
  );
  assert.throws(
    () =>
      assertLinkingBundle({
        sources: [
          ...requiredSources,
          "/workspace/packages/runtime/dist/private.js",
        ],
      }),
    /unexpected platform package sources/u,
  );
});

test("rejects the React Linking facade and the navigation layer", () => {
  for (const forbidden of [
    "/workspace/node_modules/react-native/Libraries/Linking/Linking.js",
    "/workspace/packages/navigation/dist/index.js",
  ]) {
    assert.throws(
      () => assertLinkingBundle({ sources: [...requiredSources, forbidden] }),
      /forbidden facade or navigation layer/u,
    );
  }
});
