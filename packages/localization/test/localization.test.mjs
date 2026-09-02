import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCALIZATION_MAX_LOCALE_TAG_LENGTH,
  readLocalizationSnapshot,
} from "../dist/index.js";

test("normalizes and freezes a bounded localization snapshot", () => {
  const snapshot = readLocalizationSnapshot({
    readSnapshot: () => ({
      isRTL: true,
      localeTag: "ar_SA",
      swapsLeftAndRightInRTL: false,
    }),
  });

  assert.deepEqual(snapshot, {
    localeTag: "ar-SA",
    layoutDirection: "rtl",
    swapsLeftAndRightInRTL: false,
  });
  assert.ok(Object.isFrozen(snapshot));
});

test("derives left-to-right direction independently from style swapping", () => {
  assert.deepEqual(
    readLocalizationSnapshot({
      readSnapshot: () => ({
        isRTL: false,
        localeTag: "en-US",
        swapsLeftAndRightInRTL: true,
      }),
    }),
    {
      localeTag: "en-US",
      layoutDirection: "ltr",
      swapsLeftAndRightInRTL: true,
    },
  );
});

test("rejects malformed adapters and snapshots", () => {
  assert.throws(() => readLocalizationSnapshot(null), /must be an object/u);
  assert.throws(
    () => readLocalizationSnapshot({ readSnapshot: true }),
    /provide readSnapshot/u,
  );
  assert.throws(
    () => readLocalizationSnapshot({ readSnapshot: () => null }),
    /snapshot must be an object/u,
  );
});

test("rejects malformed layout flags", () => {
  assert.throws(
    () =>
      readLocalizationSnapshot({
        readSnapshot: () => ({
          isRTL: "yes",
          localeTag: "en-US",
          swapsLeftAndRightInRTL: true,
        }),
      }),
    /isRTL must be a boolean/u,
  );
  assert.throws(
    () =>
      readLocalizationSnapshot({
        readSnapshot: () => ({
          isRTL: false,
          localeTag: "en-US",
          swapsLeftAndRightInRTL: 1,
        }),
      }),
    /swapsLeftAndRightInRTL must be a boolean/u,
  );
});

test("rejects empty, malformed, or unbounded locale tags", () => {
  const read = (localeTag) =>
    readLocalizationSnapshot({
      readSnapshot: () => ({
        isRTL: false,
        localeTag,
        swapsLeftAndRightInRTL: true,
      }),
    });

  for (const locale of ["", "en US", "en@calendar", null]) {
    assert.throws(() => read(locale), /localeTag must be a language tag/u);
  }
  assert.throws(
    () => read("x".repeat(LOCALIZATION_MAX_LOCALE_TAG_LENGTH + 1)),
    /1-128/u,
  );
});
