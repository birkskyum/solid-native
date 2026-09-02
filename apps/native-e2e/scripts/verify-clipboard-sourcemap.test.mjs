import assert from "node:assert/strict";
import test from "node:test";

import { assertClipboardBundle } from "./verify-clipboard-sourcemap.mjs";

const requiredSources = [
  "/workspace/apps/native-e2e/clipboard.tsx",
  "/workspace/packages/clipboard/dist/index.js",
  "/workspace/packages/clipboard/dist/react-native-adapter.js",
  "/workspace/packages/clipboard/dist/react-native.js",
  "/workspace/packages/clipboard/dist/solid.js",
];

test("accepts one complete privacy-safe clipboard seam", () => {
  assert.deepEqual(
    assertClipboardBundle({ sources: requiredSources }),
    requiredSources,
  );
});

test("accepts indexed source maps", () => {
  assert.deepEqual(
    assertClipboardBundle({
      sections: [
        { map: { sources: requiredSources.slice(0, 2) } },
        { map: { sources: requiredSources.slice(2) } },
      ],
    }),
    requiredSources,
  );
});

test("rejects incomplete or duplicate package seams", () => {
  assert.throws(
    () => assertClipboardBundle({ sources: requiredSources.slice(0, -1) }),
    /exactly one clipboard proof source/u,
  );
  assert.throws(
    () =>
      assertClipboardBundle({
        sources: [...requiredSources, requiredSources[1]],
      }),
    /exactly one clipboard proof source/u,
  );
  assert.throws(
    () =>
      assertClipboardBundle({
        sources: [
          ...requiredSources,
          "/workspace/packages/clipboard/dist/private.js",
        ],
      }),
    /unexpected package sources/u,
  );
});

test("rejects React Native clipboard facades", () => {
  for (const facade of [
    "/workspace/node_modules/react-native/Libraries/Components/Clipboard/Clipboard.js",
    "/workspace/node_modules/react-native/Libraries/Components/Clipboard/NativeClipboard.js",
    "/workspace/node_modules/react-native/src/private/specs_DEPRECATED/modules/NativeClipboard.js",
  ]) {
    assert.throws(
      () => assertClipboardBundle({ sources: [...requiredSources, facade] }),
      /React Native clipboard facades/u,
    );
  }
});
