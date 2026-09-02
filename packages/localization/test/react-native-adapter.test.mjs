import assert from "node:assert/strict";
import test from "node:test";

import { readReactNativeLocalizationSnapshot } from "../dist/react-native-adapter.js";

test("maps Android I18nManager constants without consulting the fallback", () => {
  let fallbackReads = 0;
  const snapshot = readReactNativeLocalizationSnapshot(
    {
      getConstants: () => ({
        doLeftAndRightSwapInRTL: true,
        isRTL: false,
        localeIdentifier: "de_CH",
      }),
    },
    () => {
      fallbackReads += 1;
      return "fallback";
    },
  );

  assert.equal(fallbackReads, 0);
  assert.deepEqual(snapshot, {
    localeTag: "de-CH",
    layoutDirection: "ltr",
    swapsLeftAndRightInRTL: true,
  });
});

test("uses the JavaScript Intl locale when iOS omits its identifier", () => {
  const snapshot = readReactNativeLocalizationSnapshot(
    {
      getConstants: () => ({
        doLeftAndRightSwapInRTL: false,
        isRTL: true,
      }),
    },
    () => "fa_IR",
  );

  assert.deepEqual(snapshot, {
    localeTag: "fa-IR",
    layoutDirection: "rtl",
    swapsLeftAndRightInRTL: false,
  });
});

test("rejects malformed native modules, constants, and fallback readers", () => {
  assert.throws(
    () => readReactNativeLocalizationSnapshot(null),
    /must be an object/u,
  );
  assert.throws(
    () => readReactNativeLocalizationSnapshot({ getConstants: true }),
    /provide getConstants/u,
  );
  assert.throws(
    () =>
      readReactNativeLocalizationSnapshot({ getConstants: () => ({}) }, null),
    /reader must be a function/u,
  );
  assert.throws(
    () => readReactNativeLocalizationSnapshot({ getConstants: () => null }),
    /constants must be an object/u,
  );
});
