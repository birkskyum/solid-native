import assert from "node:assert/strict";
import test from "node:test";

import {
  REACT_NATIVE_0_87_RELEASE,
  assertVerifiedReactNativePlatform,
} from "@solid-native/react-native-compat";

test("keeps package, runtime, and Hermes release identities explicit", () => {
  assert.deepEqual(REACT_NATIVE_0_87_RELEASE, {
    packageVersion: "0.87.0",
    runtimeVersion: "0.87.0",
    runtimeVersionParts: { major: 0, minor: 87, patch: 0 },
    hermesCompilerVersion: "250829098.0.16",
    hermesBytecodeVersion: 98,
  });
  assert.equal(Object.isFrozen(REACT_NATIVE_0_87_RELEASE), true);
  assert.equal(
    Object.isFrozen(REACT_NATIVE_0_87_RELEASE.runtimeVersionParts),
    true,
  );
});

test("recognizes Android and iOS only on the verified normalized runtime", () => {
  assert.deepEqual(
    assertVerifiedReactNativePlatform(
      {
        reactNativeVersion: { major: 0, minor: 87, patch: 0 },
        Version: 36,
      },
      "Native test",
    ),
    { platform: "android", runtimeVersion: "0.87.0" },
  );
  assert.deepEqual(
    assertVerifiedReactNativePlatform(
      {
        reactNativeVersion: { major: 0, minor: 87, patch: 0 },
        systemName: "iOS",
      },
      "Native test",
    ),
    { platform: "ios", runtimeVersion: "0.87.0" },
  );
});

test("rejects runtime drift and malformed platform constants", () => {
  assert.throws(
    () =>
      assertVerifiedReactNativePlatform(
        {
          reactNativeVersion: { major: 0, minor: 88, patch: 0 },
          Version: 36,
        },
        "Native test",
      ),
    /Native test is verified only with React Native runtime 0\.87\.0; received 0\.88\.0/u,
  );
  assert.throws(
    () =>
      assertVerifiedReactNativePlatform(
        {
          reactNativeVersion: { major: 0, minor: 87, patch: 0 },
        },
        "Native test",
      ),
    /did not identify an Android or iOS runtime/u,
  );
  assert.throws(
    () =>
      assertVerifiedReactNativePlatform(
        {
          reactNativeVersion: { major: 0, minor: "87", patch: 0 },
          Version: 36,
        },
        "Native test",
      ),
    /reactNativeVersion\.minor must be a non-negative safe integer/u,
  );
});
