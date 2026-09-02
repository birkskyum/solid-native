import assert from "node:assert/strict";
import test from "node:test";

import { assertImagesBundle } from "./verify-images-sourcemap.mjs";

const requiredSources = [
  "/workspace/apps/native-e2e/images.tsx",
  "/workspace/packages/images/dist/index.js",
  "/workspace/packages/images/dist/react-native-adapter.js",
  "/workspace/packages/images/dist/react-native.js",
  "/workspace/packages/images/dist/solid.js",
];

test("accepts one complete owner-safe images seam", () => {
  assert.deepEqual(
    assertImagesBundle({ sources: requiredSources }),
    requiredSources,
  );
});

test("accepts indexed images source maps", () => {
  assert.deepEqual(
    assertImagesBundle({
      sections: [
        { map: { sources: requiredSources.slice(0, 2) } },
        { map: { sources: requiredSources.slice(2) } },
      ],
    }),
    requiredSources,
  );
});

test("rejects incomplete, duplicate, or unexpected images seams", () => {
  assert.throws(
    () => assertImagesBundle({ sources: requiredSources.slice(0, -1) }),
    /exactly one images proof source/u,
  );
  assert.throws(
    () =>
      assertImagesBundle({ sources: [...requiredSources, requiredSources[1]] }),
    /exactly one images proof source/u,
  );
  assert.throws(
    () =>
      assertImagesBundle({
        sources: [
          ...requiredSources,
          "/workspace/packages/images/dist/private.js",
        ],
      }),
    /unexpected package sources/u,
  );
});

test("rejects React Native Image facades and generated specs", () => {
  for (const facade of [
    "/workspace/node_modules/react-native/Libraries/Image/Image.android.js",
    "/workspace/node_modules/react-native/Libraries/Image/Image.ios.js",
    "/workspace/node_modules/react-native/Libraries/Image/NativeImageLoaderAndroid.js",
    "/workspace/node_modules/react-native/Libraries/Image/NativeImageLoaderIOS.js",
    "/workspace/node_modules/react-native/src/private/specs_DEPRECATED/modules/NativeImageLoaderAndroid.js",
    "/workspace/node_modules/react-native/src/private/specs_DEPRECATED/modules/NativeImageLoaderIOS.js",
  ]) {
    assert.throws(
      () => assertImagesBundle({ sources: [...requiredSources, facade] }),
      /React Native Image facades or generated specs/u,
    );
  }
});
