import assert from "node:assert/strict";
import test from "node:test";

import { assertAccessibilityBundle } from "./verify-accessibility-sourcemap.mjs";

const requiredSources = [
  "/workspace/apps/native-e2e/accessibility.tsx",
  "/workspace/packages/accessibility/dist/index.js",
  "/workspace/packages/accessibility/dist/react-native-adapter.js",
  "/workspace/packages/accessibility/dist/react-native.js",
  "/workspace/packages/accessibility/dist/solid.js",
];

test("accepts one complete accessibility application and package seam", () => {
  assert.deepEqual(
    assertAccessibilityBundle({
      sources: [...requiredSources, "/workspace/other.js"],
    }),
    requiredSources,
  );
});

test("rejects omitted, duplicated, unexpected, and facade sources", () => {
  assert.throws(
    () => assertAccessibilityBundle({ sources: requiredSources.slice(1) }),
    /exactly one accessibility proof source/u,
  );
  assert.throws(
    () =>
      assertAccessibilityBundle({
        sources: [...requiredSources, requiredSources[2]],
      }),
    /exactly one accessibility proof source/u,
  );
  assert.throws(
    () =>
      assertAccessibilityBundle({
        sources: [
          ...requiredSources,
          "/workspace/packages/accessibility/dist/private.js",
        ],
      }),
    /unexpected package sources/u,
  );
  assert.throws(
    () =>
      assertAccessibilityBundle({
        sources: [
          ...requiredSources,
          "/workspace/node_modules/react-native/Libraries/Components/AccessibilityInfo/AccessibilityInfo.js",
        ],
      }),
    /evaluated React Native's AccessibilityInfo facade/u,
  );
});
