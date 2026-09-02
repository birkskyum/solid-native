import assert from "node:assert/strict";
import test from "node:test";

import {
  IncompatibleNativeHostBindingError,
  installReactNativeFatalErrorHandler,
} from "@solid-native/fabric-host";

test("routes fatal Hermes errors to the native shell and restores its predecessor", () => {
  const nativeReports = [];
  const forwarded = [];
  const handoffErrors = [];
  const previous = (error, isFatal) => forwarded.push({ error, isFatal });
  let current = previous;
  const errorUtils = {
    getGlobalHandler: () => current,
    setGlobalHandler: (handler) => {
      current = handler;
    },
  };
  let failHandoff = false;
  const subscription = installReactNativeFatalErrorHandler({
    binding: {
      reportFatalError(name, message) {
        if (failHandoff) throw new Error("native handoff failed");
        nativeReports.push({ name, message });
      },
    },
    errorUtils,
    onError: (error) => handoffErrors.push(error),
  });
  const nonFatal = new Error("recoverable");
  const fatal = new Error("terminal");

  current(nonFatal, false);
  current(fatal, true);
  assert.deepEqual(forwarded, [{ error: nonFatal, isFatal: false }]);
  assert.deepEqual(nativeReports, [{ name: "Error", message: "terminal" }]);

  failHandoff = true;
  current(fatal, true);
  assert.equal(handoffErrors.length, 1);
  assert.match(handoffErrors[0].message, /native handoff failed/u);
  assert.deepEqual(forwarded[1], { error: fatal, isFatal: true });

  assert.equal(subscription.remove(), true);
  assert.equal(current, previous);
  assert.equal(subscription.remove(), false);
});

test("preserves a newer fatal-handler owner during cleanup", () => {
  const forwarded = [];
  const previous = (error, isFatal) => forwarded.push({ error, isFatal });
  let current = previous;
  const errorUtils = {
    getGlobalHandler: () => current,
    setGlobalHandler: (handler) => {
      current = handler;
    },
  };
  const binding = { reportFatalError: () => undefined };
  const first = installReactNativeFatalErrorHandler({ binding, errorUtils });
  const firstHandler = current;
  const second = installReactNativeFatalErrorHandler({ binding, errorUtils });

  assert.equal(first.remove(), false);
  assert.notEqual(current, firstHandler);
  assert.equal(second.remove(), true);
  assert.equal(current, previous);

  const failure = new Error("after cleanup");
  current(failure, true);
  assert.deepEqual(forwarded, [{ error: failure, isFatal: true }]);
});

test("rejects incomplete native and ErrorUtils boundaries", () => {
  assert.throws(
    () =>
      installReactNativeFatalErrorHandler({
        binding: {},
        errorUtils: {
          getGlobalHandler: () => () => {},
          setGlobalHandler: () => {},
        },
      }),
    IncompatibleNativeHostBindingError,
  );
  assert.throws(
    () =>
      installReactNativeFatalErrorHandler({
        binding: { reportFatalError: () => {} },
        errorUtils: {},
      }),
    /must expose getGlobalHandler and setGlobalHandler/u,
  );
});
