import assert from "node:assert/strict";
import test from "node:test";

import { createDevelopmentErrorController } from "../dist/index.js";
import { installReactNativeDevelopmentErrorBridge } from "../dist/react-native.js";

function createErrorUtils(previous) {
  const errorUtils = {
    current: previous,
    getGlobalHandler() {
      assert.equal(this, errorUtils);
      return this.current;
    },
    setGlobalHandler(handler) {
      assert.equal(this, errorUtils);
      this.current = handler;
    },
  };
  return errorUtils;
}

test("owns non-fatal React Native runtime errors and restores the prior handler", () => {
  const forwarded = [];
  const previous = (error, isFatal) => forwarded.push({ error, isFatal });
  const errorUtils = createErrorUtils(previous);
  const controller = createDevelopmentErrorController({ clock: () => 7 });
  const bridge = installReactNativeDevelopmentErrorBridge(controller, {
    errorUtils,
  });
  const failure = new Error("guarded callback failed");

  errorUtils.current(failure, false);
  assert.equal(controller.current().source, "runtime");
  assert.equal(controller.current().message, failure.message);
  assert.deepEqual(forwarded, []);
  assert.equal(bridge.remove(), true);
  assert.equal(errorUtils.current, previous);
  assert.equal(bridge.remove(), false);
});

test("always forwards fatal errors and can opt into non-fatal forwarding", () => {
  const forwarded = [];
  const previous = (error, isFatal) => forwarded.push({ error, isFatal });
  const errorUtils = createErrorUtils(previous);
  const controller = createDevelopmentErrorController({ clock: () => 1 });
  const bridge = installReactNativeDevelopmentErrorBridge(controller, {
    errorUtils,
    forwardNonFatal: true,
  });
  const nonFatal = new Error("recoverable runtime error");
  const fatal = new Error("fatal runtime error");

  errorUtils.current(nonFatal, false);
  errorUtils.current(fatal, true);
  assert.deepEqual(forwarded, [
    { error: nonFatal, isFatal: false },
    { error: fatal, isFatal: true },
  ]);
  assert.equal(controller.current().message, fatal.message);
  assert.equal(controller.current().source, "runtime");
  assert.equal(bridge.remove(), true);
});

test("does not overwrite a later global handler during removal", () => {
  const previous = () => undefined;
  const replacement = () => undefined;
  const errorUtils = createErrorUtils(previous);
  const controller = createDevelopmentErrorController({ clock: () => 1 });
  const bridge = installReactNativeDevelopmentErrorBridge(controller, {
    errorUtils,
  });
  errorUtils.setGlobalHandler(replacement);

  assert.equal(bridge.remove(), false);
  assert.equal(errorUtils.current, replacement);
});

test("removes nested bridges out of order without retaining an inactive shim", () => {
  const previous = () => undefined;
  const errorUtils = createErrorUtils(previous);
  const first = installReactNativeDevelopmentErrorBridge(
    createDevelopmentErrorController({ clock: () => 1 }),
    { errorUtils },
  );
  const second = installReactNativeDevelopmentErrorBridge(
    createDevelopmentErrorController({ clock: () => 2 }),
    { errorUtils },
  );

  assert.equal(first.remove(), false);
  assert.notEqual(errorUtils.current, previous);
  assert.equal(second.remove(), true);
  assert.equal(errorUtils.current, previous);
});

test("preserves fatal platform handling when a foreign controller throws", () => {
  const fatal = new Error("fatal bridge fallback");
  const forwarded = [];
  const previous = (error, isFatal) => forwarded.push({ error, isFatal });
  const errorUtils = createErrorUtils(previous);
  const bridge = installReactNativeDevelopmentErrorBridge(
    {
      report() {
        throw new Error("foreign controller failed");
      },
    },
    { errorUtils },
  );

  errorUtils.current(fatal, true);
  assert.deepEqual(forwarded, [{ error: fatal, isFatal: true }]);
  assert.equal(bridge.remove(), true);
});

test("validates the React Native global error boundary", () => {
  const controller = createDevelopmentErrorController({ clock: () => 1 });
  assert.throws(
    () =>
      installReactNativeDevelopmentErrorBridge(controller, {
        errorUtils: {},
      }),
    /getGlobalHandler and setGlobalHandler/u,
  );
  assert.throws(
    () =>
      installReactNativeDevelopmentErrorBridge(controller, {
        errorUtils: null,
      }),
    /ErrorUtils is unavailable/u,
  );
  assert.throws(
    () =>
      installReactNativeDevelopmentErrorBridge(controller, {
        errorUtils: {
          getGlobalHandler: () => undefined,
          setGlobalHandler: () => undefined,
        },
      }),
    /invalid global handler/u,
  );
  assert.throws(
    () =>
      installReactNativeDevelopmentErrorBridge(controller, {
        errorUtils: createErrorUtils(() => undefined),
        forwardNonFatal: "yes",
      }),
    /forwardNonFatal must be a boolean/u,
  );
});
