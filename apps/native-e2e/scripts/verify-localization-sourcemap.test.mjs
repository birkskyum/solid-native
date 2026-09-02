import assert from "node:assert/strict";
import test from "node:test";

import { assertLocalizationBundle } from "./verify-localization-sourcemap.mjs";

const requiredSources = [
  "/workspace/apps/native-e2e/localization.tsx",
  "/workspace/packages/localization/dist/index.js",
  "/workspace/packages/localization/dist/react-native-adapter.js",
  "/workspace/packages/localization/dist/react-native.js",
];

test("accepts one complete read-only localization seam", () => {
  assert.deepEqual(
    assertLocalizationBundle({ sources: requiredSources }),
    requiredSources,
  );
});

test("accepts indexed localization source maps", () => {
  assert.deepEqual(
    assertLocalizationBundle({
      sections: [
        { map: { sources: requiredSources.slice(0, 2) } },
        { map: { sources: requiredSources.slice(2) } },
      ],
    }),
    requiredSources,
  );
});

test("rejects incomplete, duplicate, or unexpected localization seams", () => {
  assert.throws(
    () => assertLocalizationBundle({ sources: requiredSources.slice(0, -1) }),
    /exactly one localization proof source/u,
  );
  assert.throws(
    () =>
      assertLocalizationBundle({
        sources: [...requiredSources, requiredSources[1]],
      }),
    /exactly one localization proof source/u,
  );
  assert.throws(
    () =>
      assertLocalizationBundle({
        sources: [
          ...requiredSources,
          "/workspace/packages/localization/dist/private.js",
        ],
      }),
    /unexpected package sources/u,
  );
});

test("rejects React Native I18n facades and generated JavaScript specs", () => {
  for (const facade of [
    "/workspace/node_modules/react-native/Libraries/ReactNative/I18nManager.js",
    "/workspace/node_modules/react-native/Libraries/ReactNative/NativeI18nManager.js",
    "/workspace/node_modules/react-native/src/private/specs_DEPRECATED/modules/NativeI18nManager.js",
  ]) {
    assert.throws(
      () => assertLocalizationBundle({ sources: [...requiredSources, facade] }),
      /React Native I18n facades/u,
    );
  }
});
