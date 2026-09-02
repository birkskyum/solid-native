import assert from "node:assert/strict";
import test from "node:test";

import { CORE_COMPONENT_DESCRIPTORS, Text } from "@solid-native/core";
import { createComponent } from "@solid-native/renderer";
import {
  createCausalTimeline,
  createSolidDiagnosticsDebugEnvelope,
} from "@solid-native/observability";
import {
  IncompatibleHostError,
  IncompatibleNativeBackendError,
  IncompatibleNativeHostBindingError,
  NATIVE_HOST_GLOBAL,
  NativeSurfaceStartupError,
  REACT_NATIVE_0_87_BACKEND,
  assertCompatibleNativeBackend,
  commitNativeHostTransaction,
  createNativeFabricHost,
  createNativeHostTransaction,
  createNativePlatformServices,
  getNativeHostBinding,
  installReactNativeFatalErrorHandler,
  inspectHost,
  inspectNativeBackend,
  measureNativeHostNode,
  readNativeSurfaceInfo,
  reportNativeFatalError,
  retainNativeResource,
  retainOwnedNativeResource,
  supportsNativeUIWorkletDecays,
  supportsNativeUIWorkletAnimationCancellation,
  supportsNativeUIWorkletKeyframes,
  supportsNativeUIWorkletPanGestures,
  supportsNativeUIWorkletPanGestureDetachment,
  supportsNativeUIWorkletSprings,
  supportsNativeUIWorkletTimings,
  subscribeToNativeHostCommitLifecycle,
  subscribeToNativeHostEvents,
  startApplication,
  startApplicationAsync,
  startNativeApplication,
  waitForNativeSurface,
} from "@solid-native/runtime";

import { InMemoryHost } from "../dist/index.js";
import { createNativeDebugRequestHandler } from "../../runtime/dist/native-debug-handler.js";
import { createRoot, DEV, resetErrorHalt } from "solid-js";

const terminalSolidFailureOnly = { skip: DEV !== undefined };

test("dispatches the versioned native diagnostics protocol without exposing values", async () => {
  const timeline = createCausalTimeline();
  const published = [];
  const errors = [];
  let active = false;
  const diagnostics = {
    available: true,
    get active() {
      return active;
    },
    begin() {
      active = true;
    },
    end() {
      active = false;
      return createSolidDiagnosticsDebugEnvelope({
        capturedAt: "2026-08-27T00:00:00.000Z",
        durationMilliseconds: 10,
        diagnostics: [],
        reruns: [],
        costs: { scopes: [], writes: [] },
      });
    },
    dispose() {
      active = false;
    },
  };
  const handle = createNativeDebugRequestHandler(
    timeline,
    {
      solidDiagnostics: diagnostics,
      reportError: (error) => errors.push(error),
    },
    async (requestId, payload) => {
      published.push({ requestId, payload: JSON.parse(payload) });
    },
  );
  const requestId = "0123456789abcdef0123456789abcdef";

  handle({ requestId });
  handle({ requestId, operation: "solid-diagnostics-begin" });
  handle({ requestId, operation: "solid-diagnostics-begin" });
  handle({
    requestId,
    operation: "solid-diagnostics-end",
    sessionId: "fedcba9876543210fedcba9876543210",
  });
  handle({
    requestId,
    operation: "solid-diagnostics-end",
    sessionId: requestId,
  });
  handle({
    requestId,
    operation: "solid-diagnostics-end",
    sessionId: requestId,
  });
  handle({ requestId, operation: "unknown" });
  await Promise.resolve();

  assert.equal(published[0].payload.kind, "solid-native.causal-debug-snapshot");
  assert.deepEqual(
    published.slice(1).map(({ payload }) => payload),
    [
      {
        schemaVersion: 0,
        kind: "solid-native.solid-diagnostics-debug-control",
        operation: "solid-diagnostics-begin",
        ok: true,
        active: true,
      },
      {
        schemaVersion: 0,
        kind: "solid-native.solid-diagnostics-debug-control",
        operation: "solid-diagnostics-begin",
        ok: false,
        active: true,
        error: "invalid-state",
      },
      {
        schemaVersion: 0,
        kind: "solid-native.solid-diagnostics-debug-control",
        operation: "solid-diagnostics-end",
        ok: false,
        active: true,
        error: "invalid-state",
      },
      {
        schemaVersion: 0,
        kind: "solid-native.solid-diagnostics-debug",
        capturedAt: "2026-08-27T00:00:00.000Z",
        durationMilliseconds: 10,
        truncated: false,
        droppedDiagnostics: 0,
        diagnostics: [],
        reruns: [],
        scopeCosts: [],
        writeCosts: [],
      },
      {
        schemaVersion: 0,
        kind: "solid-native.solid-diagnostics-debug-control",
        operation: "solid-diagnostics-end",
        ok: false,
        active: false,
        error: "invalid-state",
      },
    ],
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /operation is invalid/u);
});

test("disposes a diagnostics controller that fails to activate", async () => {
  const published = [];
  const errors = [];
  let disposalCount = 0;
  const handle = createNativeDebugRequestHandler(
    createCausalTimeline(),
    {
      solidDiagnostics: {
        available: true,
        active: false,
        begin() {},
        end() {
          throw new Error("unexpected end");
        },
        dispose() {
          disposalCount += 1;
        },
      },
      reportError: (error) => errors.push(error),
    },
    async (requestId, payload) => {
      published.push({ requestId, payload: JSON.parse(payload) });
    },
  );

  handle({
    requestId: "0123456789abcdef0123456789abcdef",
    operation: "solid-diagnostics-begin",
  });
  await Promise.resolve();

  assert.equal(disposalCount, 1);
  assert.match(errors[0].message, /did not activate capture/u);
  assert.deepEqual(published[0].payload, {
    schemaVersion: 0,
    kind: "solid-native.solid-diagnostics-debug-control",
    operation: "solid-diagnostics-begin",
    ok: false,
    active: false,
    error: "capture-failed",
  });
});

test("reports missing capabilities and components before startup", () => {
  const host = new InMemoryHost({
    descriptors: CORE_COMPONENT_DESCRIPTORS,
    capabilities: { nativeScreens: false },
  });
  const report = inspectHost(host, {
    components: ["RootView", "MissingView"],
    capabilities: ["nativeScreens"],
  });

  assert.equal(report.compatible, false);
  assert.deepEqual(report.issues, [
    "Required capability nativeScreens is unavailable.",
    "Required native component MissingView is unavailable.",
  ]);
});

test("starts a compatible application through the runtime boundary", async () => {
  const host = new InMemoryHost({ descriptors: CORE_COMPONENT_DESCRIPTORS });
  const app = startApplication(
    () => createComponent(Text, { children: "Runtime" }),
    host,
    {
      surface: { name: "runtime" },
      autoCommit: false,
      requirements: { components: ["Text"] },
    },
  );
  await app.root.flush();
  assert.equal(host.getSurfaceSnapshot(app.root.surfaceId).sequence, 1);
  await app.dispose();
});

test(
  "awaits backend-neutral surface rollback after initial render failure",
  terminalSolidFailureOnly,
  async () => {
    const host = new InMemoryHost({
      descriptors: CORE_COMPONENT_DESCRIPTORS,
    });
    const failure = new Error("generic application render failed");
    let releaseStop;
    const stop = new Promise((resolve) => {
      releaseStop = resolve;
    });
    let resolveStopStarted;
    const stopStarted = new Promise((resolve) => {
      resolveStopStarted = resolve;
    });
    const destroySurface = host.destroySurface.bind(host);
    host.destroySurface = async (surface) => {
      resolveStopStarted();
      await stop;
      destroySurface(surface);
    };

    const startup = startApplicationAsync(
      () => {
        throw failure;
      },
      host,
      {
        surface: { name: "failed-generic-application" },
        autoCommit: false,
      },
    );
    let settled = false;
    void startup.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    try {
      await stopStarted;
      assert.equal(settled, false);
      assert.equal(host.hasSurface(1), true);
      releaseStop();
      await assert.rejects(
        startup,
        (error) => error === failure || error?.cause === failure,
      );
    } finally {
      releaseStop();
      resetErrorHalt();
    }
    assert.equal(host.hasSurface(1), false);
  },
);

test("waits for native surface ownership and mounts in one bounded bootstrap", async () => {
  const commits = [];
  let polls = 0;
  let ready = false;
  let destroyed = false;
  const binding = {
    contractVersion: 1,
    backend: "react-native-fabric",
    backendVersion: "0.87.0",
    platform: "android",
    getSurfaceInfo: () => {
      if (destroyed) {
        return {
          ready: false,
          surface: 0,
          sequence: 0,
          retainedNodeCount: 0,
          retainedResourceCount: 0,
        };
      }
      polls += 1;
      if (polls >= 3) ready = true;
      return {
        ready,
        surface: ready ? 61 : 0,
        sequence: 0,
        retainedNodeCount: 0,
        retainedResourceCount: 0,
      };
    },
    setEventHandler: () => {},
    measure: () => ({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      pageX: 0,
      pageY: 0,
      observedSequence: 0,
    }),
    destroySurface: () => {
      ready = false;
      destroyed = true;
    },
    commit: (transaction) => {
      commits.push(transaction);
      return {
        surface: transaction.surface,
        sequence: transaction.sequence,
        mounted: true,
      };
    },
  };

  const application = await startNativeApplication(
    () => createComponent(Text, { children: "Native bootstrap" }),
    {
      binding,
      descriptors: CORE_COMPONENT_DESCRIPTORS,
      surface: { name: "native-bootstrap" },
      autoCommit: false,
      requirements: { components: ["Text"] },
      surfaceReadyTimeoutMs: 100,
      surfaceReadyPollIntervalMs: 1,
    },
  );
  await application.root.flush();

  assert.equal(polls, 4);
  assert.equal(commits[0].surface, 61);
  assert.equal(
    commits[0].mutations.some(
      (mutation) =>
        mutation.type === "create-text" && mutation.text === "Native bootstrap",
    ),
    true,
  );
  await application.dispose();
});

test("bounds failed native surface startup and validates polling options", async () => {
  const binding = {
    contractVersion: 1,
    backend: "react-native-fabric",
    backendVersion: "0.87.0",
    platform: "ios",
    getSurfaceInfo: () => ({
      ready: false,
      surface: 0,
      sequence: 0,
      retainedNodeCount: 0,
      retainedResourceCount: 0,
    }),
    setEventHandler: () => {},
    measure: () => ({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      pageX: 0,
      pageY: 0,
      observedSequence: 0,
    }),
    destroySurface: () => {},
    commit: (transaction) => ({
      surface: transaction.surface,
      sequence: transaction.sequence,
      mounted: true,
    }),
  };

  await assert.rejects(
    () => waitForNativeSurface({ binding, timeoutMs: 0 }),
    (error) =>
      error.name === "NativeSurfaceStartupError" &&
      /within 0 milliseconds/.test(error.message),
  );
  await assert.rejects(
    () => waitForNativeSurface({ binding, pollIntervalMs: 0 }),
    /pollIntervalMs must be a safe integer from 1 through 1000 milliseconds/,
  );
  await assert.rejects(
    () => waitForNativeSurface({ binding, timeoutMs: 60_001 }),
    /timeoutMs must be a safe integer from 0 through 60000 milliseconds/,
  );
});

test("bounds terminal errors before handing them to the native shell", () => {
  const reports = [];
  const binding = {
    reportFatalError: (name, message) => reports.push({ name, message }),
  };
  const error = new Error(`terminal\u0000${"x".repeat(3_000)}`);
  error.name = `Fabric${"y".repeat(200)}`;

  reportNativeFatalError(binding, error);
  reportNativeFatalError(binding, "plain terminal failure");
  reportNativeFatalError(binding, {
    get name() {
      throw new Error("name getter failed");
    },
    get message() {
      throw new Error("message getter failed");
    },
  });

  assert.equal(reports[0].name.length, 128);
  assert.equal(reports[0].name.endsWith("\u2026"), true);
  assert.equal(reports[0].message.length, 2_048);
  assert.equal(reports[0].message.includes("\u0000"), false);
  assert.equal(reports[0].message.endsWith("\u2026"), true);
  assert.deepEqual(reports[1], {
    name: "Error",
    message: "plain terminal failure",
  });
  assert.deepEqual(reports[2], {
    name: "Error",
    message: "A terminal JavaScript failure occurred.",
  });
  assert.throws(
    () => reportNativeFatalError({}, new Error("unsupported")),
    /reportFatalError is unavailable/u,
  );
});

test("hands fatal Hermes errors to native and restores ErrorUtils ownership", () => {
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

test("does not overwrite a newer fatal-handler owner during cleanup", () => {
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

test("owns the fatal Hermes bridge for the native application lifetime", async () => {
  const nativeReports = [];
  const forwarded = [];
  const previous = (error, isFatal) => forwarded.push({ error, isFatal });
  let current = previous;
  let ready = true;
  const errorUtils = {
    getGlobalHandler: () => current,
    setGlobalHandler: (handler) => {
      current = handler;
    },
  };
  const binding = {
    contractVersion: 1,
    backend: "react-native-fabric",
    backendVersion: "0.87.0",
    platform: "android",
    getSurfaceInfo: () => ({
      ready,
      surface: ready ? 62 : 0,
      sequence: 0,
      retainedNodeCount: 0,
      retainedResourceCount: 0,
    }),
    reportFatalError: (name, message) => nativeReports.push({ name, message }),
    setEventHandler: () => {},
    measure: () => ({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      pageX: 0,
      pageY: 0,
      observedSequence: 0,
    }),
    destroySurface: () => {
      ready = false;
    },
    commit: (transaction) => ({
      surface: transaction.surface,
      sequence: transaction.sequence,
      mounted: true,
    }),
  };

  const application = await startNativeApplication(
    () => createComponent(Text, { children: "Owned fatal bridge" }),
    {
      binding,
      descriptors: CORE_COMPONENT_DESCRIPTORS,
      fatalErrorHandler: { errorUtils },
      surface: { name: "owned-fatal-bridge" },
      autoCommit: false,
    },
  );
  assert.notEqual(current, previous);
  const fatal = new Error("owned terminal error");
  const recoverable = new Error("recoverable");
  current(fatal, true);
  current(recoverable, false);
  assert.deepEqual(nativeReports, [
    { name: "Error", message: "owned terminal error" },
  ]);
  assert.deepEqual(forwarded, [{ error: recoverable, isFatal: false }]);

  await application.root.flush();
  const firstDisposal = application.dispose();
  assert.equal(application.dispose(), firstDisposal);
  await firstDisposal;
  assert.equal(current, previous);
});

test("removes the fatal Hermes bridge when native startup fails", async () => {
  const previous = () => {};
  let current = previous;
  const errorUtils = {
    getGlobalHandler: () => current,
    setGlobalHandler: (handler) => {
      current = handler;
    },
  };

  await assert.rejects(
    () =>
      startNativeApplication(() => null, {
        binding: {
          getSurfaceInfo: () => ({
            ready: false,
            surface: 0,
            sequence: 0,
            retainedNodeCount: 0,
            retainedResourceCount: 0,
          }),
          reportFatalError: () => {},
        },
        descriptors: CORE_COMPONENT_DESCRIPTORS,
        fatalErrorHandler: { errorUtils },
        surface: { name: "failed-owned-fatal-bridge" },
        surfaceReadyTimeoutMs: 0,
      }),
    NativeSurfaceStartupError,
  );
  assert.equal(current, previous);
});

test(
  "reclaims native ownership before rejecting an initial Solid render",
  terminalSolidFailureOnly,
  async () => {
    const failure = new Error("initial Solid render failed");
    const previous = () => {};
    let current = previous;
    let ready = true;
    let destroyed = false;
    let fatalHandlerOwnedDuringDestroy = false;
    const errorUtils = {
      getGlobalHandler: () => current,
      setGlobalHandler: (handler) => {
        current = handler;
      },
    };
    const binding = {
      contractVersion: 1,
      backend: "react-native-fabric",
      backendVersion: "0.87.0",
      platform: "ios",
      getSurfaceInfo: () => ({
        ready,
        surface: ready ? 64 : 0,
        sequence: 0,
        retainedNodeCount: 0,
        retainedResourceCount: 0,
      }),
      reportFatalError: () => {},
      setEventHandler: () => {},
      measure: () => ({
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        pageX: 0,
        pageY: 0,
        observedSequence: 0,
      }),
      commit: (transaction) => ({
        surface: transaction.surface,
        sequence: transaction.sequence,
        mounted: true,
      }),
      destroySurface: () => {
        fatalHandlerOwnedDuringDestroy = current !== previous;
        destroyed = true;
        ready = false;
      },
    };

    try {
      await assert.rejects(
        () =>
          startNativeApplication(
            () => {
              throw failure;
            },
            {
              binding,
              descriptors: CORE_COMPONENT_DESCRIPTORS,
              fatalErrorHandler: { errorUtils },
              surface: { name: "failed-initial-solid-render" },
              autoCommit: false,
            },
          ),
        (error) => error === failure || error?.cause === failure,
      );
    } finally {
      resetErrorHalt();
    }
    assert.equal(destroyed, true);
    assert.equal(fatalHandlerOwnedDuringDestroy, true);
    assert.equal(current, previous);
  },
);

test("reclaims native ownership after root initialization fails", async () => {
  const previous = () => {};
  let current = previous;
  let ready = true;
  let destroyCount = 0;
  let fatalHandlerOwnedDuringDestroy = false;
  const errorUtils = {
    getGlobalHandler: () => current,
    setGlobalHandler: (handler) => {
      current = handler;
    },
  };
  const binding = {
    contractVersion: 1,
    backend: "react-native-fabric",
    backendVersion: "0.87.0",
    platform: "ios",
    getSurfaceInfo: () => ({
      ready,
      surface: ready ? 65 : 0,
      sequence: 0,
      retainedNodeCount: 0,
      retainedResourceCount: 0,
    }),
    reportFatalError: () => {},
    setEventHandler: () => {},
    measure: () => ({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      pageX: 0,
      pageY: 0,
      observedSequence: 0,
    }),
    commit: (transaction) => ({
      surface: transaction.surface,
      sequence: transaction.sequence,
      mounted: true,
    }),
    destroySurface: () => {
      fatalHandlerOwnedDuringDestroy = current !== previous;
      destroyCount++;
      ready = false;
    },
  };

  await assert.rejects(
    () =>
      startNativeApplication(() => null, {
        binding,
        descriptors: CORE_COMPONENT_DESCRIPTORS,
        fatalErrorHandler: { errorUtils },
        surface: {
          name: "failed-native-root-initialization",
          initialProps: { invalid: () => {} },
        },
        autoCommit: false,
      }),
    /invalid is not a transport-safe host value/u,
  );
  assert.equal(destroyCount, 1);
  assert.equal(fatalHandlerOwnedDuringDestroy, true);
  assert.equal(current, previous);

  // The failed adapter released its binding-wide lease only after native stop.
  // Republish the shell's next empty surface and prove a fresh host can own it.
  ready = true;
  const application = await startNativeApplication(() => null, {
    binding,
    descriptors: CORE_COMPONENT_DESCRIPTORS,
    fatalErrorHandler: { errorUtils },
    surface: { name: "recovered-native-root-initialization" },
    autoCommit: false,
  });
  await application.dispose();
  assert.equal(destroyCount, 2);
  assert.equal(current, previous);
});

test("hands terminal native commits to the shell and application observer", async () => {
  const commitFailure = new Error("Fabric terminal commit");
  const nativeReports = [];
  const observed = [];
  const binding = {
    contractVersion: 1,
    backend: "react-native-fabric",
    backendVersion: "0.87.0",
    platform: "android",
    getSurfaceInfo: () => ({
      ready: true,
      surface: 63,
      sequence: 0,
      retainedNodeCount: 0,
      retainedResourceCount: 0,
    }),
    reportFatalError: (name, message) => nativeReports.push({ name, message }),
    setEventHandler: () => {},
    measure: () => ({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      pageX: 0,
      pageY: 0,
      observedSequence: 0,
    }),
    destroySurface: () => {},
    commit: () => {
      throw commitFailure;
    },
  };
  const application = await startNativeApplication(
    () => createComponent(Text, { children: "Terminal commit" }),
    {
      binding,
      descriptors: CORE_COMPONENT_DESCRIPTORS,
      fatalErrorHandler: false,
      surface: { name: "terminal-commit" },
      autoCommit: false,
      onCommitError: (error) => observed.push(error),
    },
  );

  await assert.rejects(() => application.root.flush(), commitFailure);
  assert.deepEqual(nativeReports, [
    { name: "Error", message: "Fabric terminal commit" },
  ]);
  assert.deepEqual(observed, [commitFailure]);
});

test("throws a structured compatibility error", () => {
  const host = new InMemoryHost({ descriptors: [] });
  assert.throws(
    () =>
      startApplication(() => null, host, {
        surface: { name: "invalid" },
      }),
    (error) =>
      error instanceof IncompatibleHostError &&
      error.report.issues.includes(
        "Required native component RootView is unavailable.",
      ),
  );
});

test("accepts the exact device-verified React Native backends", () => {
  const observed = {
    backend: "react-native-fabric",
    backendVersion: "0.87.0",
    platform: "ios",
    engine: "hermes",
    engineVersion: "250829098.0.16",
    hostContractVersion: 1,
    fabricEnabled: true,
  };

  assert.equal(inspectNativeBackend(observed).compatible, true);
  assert.equal(inspectNativeBackend(observed).proof, "device-verified");
  assert.equal(
    assertCompatibleNativeBackend(observed),
    REACT_NATIVE_0_87_BACKEND,
  );
  assert.equal(
    inspectNativeBackend({ ...observed, platform: "android" }).proof,
    "device-verified",
  );
});

test("rejects version drift on a device-verified platform", () => {
  const report = inspectNativeBackend({
    backend: "react-native-fabric",
    backendVersion: "0.88.0",
    platform: "android",
    engine: "hermes",
    engineVersion: "unknown",
    hostContractVersion: 1,
    fabricEnabled: false,
  });

  assert.equal(report.compatible, false);
  assert.equal(report.proof, "device-verified");
  assert.deepEqual(report.issues, [
    "Expected React Native 0.87.0, received 0.88.0.",
    "Expected Hermes 250829098.0.16, received unknown.",
    "The React Native Fabric renderer is disabled.",
  ]);
  assert.throws(
    () => assertCompatibleNativeBackend(report.observed),
    IncompatibleNativeBackendError,
  );
});

test("normalizes native platform modules behind a validated service", async () => {
  let appStateListener;
  let backListener;
  const colorSchemeListeners = new Set();
  let keyboardListener;
  let memoryWarningListener;
  let urlListener;
  let windowMetricsListener;
  let keyboardDismissals = 0;
  let settingsOpens = 0;
  let currentColorScheme = "dark";
  const checkedURLs = [];
  const openedURLs = [];
  const colorSchemeOverrides = [];
  const statusBarUpdates = [];
  const removals = {
    appState: 0,
    back: 0,
    colorScheme: 0,
    keyboard: 0,
    memoryWarning: 0,
    url: 0,
    windowMetrics: 0,
  };
  const services = createNativePlatformServices({
    async canOpenURL(url) {
      checkedURLs.push(url);
      return url !== "missing-app://resource";
    },
    getPlatformConstants: () => ({
      reactNativeVersion: { major: 0, minor: 87, patch: 0 },
      Version: 36,
    }),
    getColorScheme: () => currentColorScheme,
    getInitialAppState: () => "active",
    getKeyboardMetrics: () => undefined,
    getWindowMetrics: () => ({
      width: 393,
      height: 852,
      scale: 3,
      fontScale: 1,
    }),
    dismissKeyboard: () => keyboardDismissals++,
    setColorSchemeOverride: (scheme) => colorSchemeOverrides.push(scheme),
    setStatusBarHidden: (hidden, animation) =>
      statusBarUpdates.push({ hidden, animation }),
    setStatusBarStyle: (style, animated) =>
      statusBarUpdates.push({ style, animated }),
    getInitialURL: async () => "solid-native://launch",
    async openSettings() {
      settingsOpens++;
    },
    async openURL(url) {
      openedURLs.push(url);
    },
    subscribeAppState(listener) {
      appStateListener = listener;
      return { remove: () => removals.appState++ };
    },
    subscribeHardwareBack(listener) {
      backListener = listener;
      return { remove: () => removals.back++ };
    },
    subscribeColorScheme(listener) {
      colorSchemeListeners.add(listener);
      return {
        remove() {
          colorSchemeListeners.delete(listener);
          removals.colorScheme++;
        },
      };
    },
    subscribeKeyboard(listener) {
      keyboardListener = listener;
      return { remove: () => removals.keyboard++ };
    },
    subscribeMemoryWarning(listener) {
      memoryWarningListener = listener;
      return { remove: () => removals.memoryWarning++ };
    },
    subscribeURL(listener) {
      urlListener = listener;
      return { remove: () => removals.url++ };
    },
    subscribeWindowMetrics(listener) {
      windowMetricsListener = listener;
      return { remove: () => removals.windowMetrics++ };
    },
  });

  assert.equal(Object.isFrozen(services), true);
  assert.equal(services.initialAppState, "active");
  assert.equal(services.getColorScheme(), "dark");
  assert.deepEqual(services.getKeyboardState(), { visible: false });
  assert.deepEqual(
    {
      backend: services.backend,
      backendVersion: services.backendVersion,
      platform: services.platform,
    },
    {
      backend: "react-native",
      backendVersion: "0.87.0",
      platform: "android",
    },
  );
  assert.equal(await services.getInitialURL(), "solid-native://launch");
  assert.equal(await services.canOpenURL("https://solidjs.com"), true);
  assert.equal(await services.canOpenURL("missing-app://resource"), false);
  await services.openURL("mailto:team@solidjs.com");
  await services.openSettings();
  assert.deepEqual(checkedURLs, [
    "https://solidjs.com",
    "missing-app://resource",
  ]);
  assert.deepEqual(openedURLs, ["mailto:team@solidjs.com"]);
  assert.equal(settingsOpens, 1);
  assert.deepEqual(services.getWindowMetrics(), {
    width: 393,
    height: 852,
    scale: 3,
    fontScale: 1,
  });
  assert.equal(Object.isFrozen(services.getWindowMetrics()), true);

  const appStates = [];
  const appStateSubscription = services.subscribeAppState((state) =>
    appStates.push(state),
  );
  appStateListener("background");
  appStateListener("active");
  assert.deepEqual(appStates, ["background", "active"]);

  let backHandled = false;
  const backSubscription = services.subscribeHardwareBack(() => {
    backHandled = true;
    return true;
  });
  assert.equal(backListener(), true);
  assert.equal(backHandled, true);

  const colorSchemes = [];
  const colorSchemeSubscription = services.subscribeColorScheme((scheme) =>
    colorSchemes.push(scheme),
  );
  currentColorScheme = "light";
  for (const listener of colorSchemeListeners) listener("light");
  assert.deepEqual(colorSchemes, ["dark", "light"]);
  services.setColorSchemeOverride("dark");
  services.setColorSchemeOverride("system");
  assert.deepEqual(colorSchemeOverrides, ["dark", "system"]);

  currentColorScheme = "dark";
  const rootStatusBar = services.pushStatusBarEntry({ barStyle: "auto" });
  assert.equal(Object.isFrozen(rootStatusBar), true);
  assert.equal(colorSchemeListeners.size, 2);
  assert.deepEqual(statusBarUpdates, [
    { style: "light-content", animated: false },
    { hidden: false, animation: "none" },
  ]);
  currentColorScheme = "light";
  for (const listener of colorSchemeListeners) listener("light");
  assert.deepEqual(statusBarUpdates.at(-1), {
    style: "dark-content",
    animated: false,
  });
  const overlayStatusBar = services.pushStatusBarEntry({
    animated: true,
    barStyle: "light-content",
    hidden: true,
    showHideTransition: "slide",
  });
  assert.deepEqual(statusBarUpdates.slice(-2), [
    { style: "light-content", animated: true },
    { hidden: true, animation: "slide" },
  ]);
  const updatesBeforeCoveredReplacement = statusBarUpdates.length;
  rootStatusBar.replace({ barStyle: "dark-content" });
  assert.equal(statusBarUpdates.length, updatesBeforeCoveredReplacement);
  assert.equal(colorSchemeListeners.size, 1);
  overlayStatusBar.remove();
  assert.deepEqual(statusBarUpdates.slice(-2), [
    { style: "dark-content", animated: false },
    { hidden: false, animation: "none" },
  ]);
  rootStatusBar.remove();
  rootStatusBar.remove();
  assert.deepEqual(statusBarUpdates.at(-1), {
    style: "default",
    animated: false,
  });
  assert.throws(
    () => rootStatusBar.replace({ hidden: true }),
    /removed status-bar stack entry/,
  );

  const keyboardStates = [];
  const keyboardSubscription = services.subscribeKeyboard((state) =>
    keyboardStates.push(state),
  );
  keyboardListener({
    visible: true,
    metrics: { screenX: 0, screenY: 540.5, width: 360, height: 260.5 },
  });
  keyboardListener({ visible: false });
  assert.deepEqual(keyboardStates, [
    { visible: false },
    {
      visible: true,
      metrics: { screenX: 0, screenY: 540.5, width: 360, height: 260.5 },
    },
    { visible: false },
  ]);
  assert.equal(Object.isFrozen(keyboardStates[0]), true);
  assert.equal(Object.isFrozen(keyboardStates[1].metrics), true);
  services.dismissKeyboard();
  assert.equal(keyboardDismissals, 1);

  let memoryWarnings = 0;
  const memoryWarningSubscription = services.subscribeMemoryWarning(() => {
    memoryWarnings++;
  });
  memoryWarningListener();
  memoryWarningListener();
  assert.equal(memoryWarnings, 2);

  const urls = [];
  const urlSubscription = services.subscribeURL((event) => urls.push(event));
  urlListener({ url: "solid-native://running" });
  assert.deepEqual(urls, [{ url: "solid-native://running" }]);
  assert.equal(Object.isFrozen(urls[0]), true);

  const windowMetrics = [];
  const windowMetricsSubscription = services.subscribeWindowMetrics((metrics) =>
    windowMetrics.push(metrics),
  );
  windowMetricsListener({
    width: 852,
    height: 393,
    scale: 3,
    fontScale: 1.1,
  });
  assert.deepEqual(windowMetrics, [
    { width: 393, height: 852, scale: 3, fontScale: 1 },
    { width: 852, height: 393, scale: 3, fontScale: 1.1 },
  ]);
  assert.equal(Object.isFrozen(windowMetrics[0]), true);
  assert.equal(Object.isFrozen(windowMetrics[1]), true);

  appStateSubscription.remove();
  appStateSubscription.remove();
  backSubscription.remove();
  backSubscription.remove();
  colorSchemeSubscription.remove();
  colorSchemeSubscription.remove();
  keyboardSubscription.remove();
  keyboardSubscription.remove();
  memoryWarningSubscription.remove();
  memoryWarningSubscription.remove();
  urlSubscription.remove();
  urlSubscription.remove();
  windowMetricsSubscription.remove();
  windowMetricsSubscription.remove();
  assert.deepEqual(removals, {
    appState: 1,
    back: 1,
    colorScheme: 2,
    keyboard: 1,
    memoryWarning: 1,
    url: 1,
    windowMetrics: 1,
  });
});

test("rejects platform-module version drift and malformed transport", async () => {
  const adapter = {
    canOpenURL: async () => true,
    getPlatformConstants: () => ({
      reactNativeVersion: { major: 0, minor: 87, patch: 0 },
      systemName: "iOS",
    }),
    getColorScheme: () => "light",
    getInitialAppState: () => "inactive",
    getKeyboardMetrics: () => undefined,
    getWindowMetrics: () => ({
      width: 393,
      height: 852,
      scale: 3,
      fontScale: 1,
    }),
    dismissKeyboard() {},
    setColorSchemeOverride() {},
    setStatusBarHidden() {},
    setStatusBarStyle() {},
    getInitialURL: async () => null,
    openSettings: async () => undefined,
    openURL: async () => undefined,
    subscribeAppState: () => ({ remove() {} }),
    subscribeHardwareBack: () => ({ remove() {} }),
    subscribeColorScheme: () => ({ remove() {} }),
    subscribeKeyboard: () => ({ remove() {} }),
    subscribeMemoryWarning: () => ({ remove() {} }),
    subscribeURL: () => ({ remove() {} }),
    subscribeWindowMetrics: () => ({ remove() {} }),
  };
  assert.throws(
    () =>
      createNativePlatformServices({
        ...adapter,
        getPlatformConstants: () => ({
          reactNativeVersion: { major: 0, minor: 88, patch: 0 },
          systemName: "iOS",
        }),
      }),
    /verified only with React Native runtime 0\.87\.0; received 0\.88\.0/,
  );
  assert.throws(
    () =>
      createNativePlatformServices({
        ...adapter,
        getInitialAppState: () => "foreground",
      }),
    /invalid state/,
  );
  assert.throws(
    () =>
      createNativePlatformServices({
        ...adapter,
        getPlatformConstants: () => ({
          reactNativeVersion: { major: 0, minor: 87, patch: 0 },
        }),
      }),
    /did not identify/,
  );
  assert.throws(
    () =>
      createNativePlatformServices({
        ...adapter,
        getColorScheme: () => "sepia",
      }).getColorScheme(),
    /must be light or dark/,
  );

  let appStateListener;
  let keyboardListener;
  let urlListener;
  const malformed = createNativePlatformServices({
    ...adapter,
    canOpenURL: async () => "yes",
    getInitialURL: async () => 42,
    subscribeAppState(listener) {
      appStateListener = listener;
      return { remove() {} };
    },
    subscribeKeyboard(listener) {
      keyboardListener = listener;
      return { remove() {} };
    },
    subscribeURL(listener) {
      urlListener = listener;
      return { remove() {} };
    },
  });
  await assert.rejects(() => malformed.getInitialURL(), /invalid initial URL/);
  await assert.rejects(
    () => malformed.canOpenURL("custom://resource"),
    /non-boolean canOpenURL result/u,
  );
  await assert.rejects(
    () => malformed.openURL("relative/path"),
    /include a valid scheme/u,
  );
  await assert.rejects(
    () => malformed.openURL("https://example.com/unsafe\npath"),
    /control characters/u,
  );
  await assert.rejects(
    () => malformed.openURL(`custom:${"x".repeat(8_193)}`),
    /between 1 and 8192 characters/u,
  );
  malformed.subscribeAppState(() => {});
  assert.throws(() => appStateListener("foreground"), /invalid state/);
  malformed.subscribeURL(() => {});
  assert.throws(() => urlListener({ url: "" }), /non-empty URL/);
  malformed.subscribeKeyboard(() => {});
  assert.throws(
    () =>
      keyboardListener({
        visible: true,
        metrics: { screenY: 500, width: 360, height: 200 },
      }),
    /screenX must be a finite number/,
  );
  assert.throws(
    () => keyboardListener({ visible: false, metrics: {} }),
    /hidden native keyboard state must not include metrics/,
  );
  assert.throws(
    () => malformed.setColorSchemeOverride("auto"),
    /light, dark, or system/,
  );
  assert.throws(
    () => malformed.pushStatusBarEntry({ barStyle: "sepia" }),
    /StatusBar\.barStyle/,
  );
  assert.throws(
    () =>
      malformed.pushStatusBarEntry({
        animated: "yes",
        hidden: true,
      }),
    /StatusBar\.animated must be a boolean/,
  );
  assert.throws(
    () =>
      malformed.pushStatusBarEntry({
        hidden: true,
        showHideTransition: "zoom",
      }),
    /StatusBar\.showHideTransition/,
  );
  assert.throws(
    () => malformed.pushStatusBarEntry(null),
    /status-bar configuration must be an object/,
  );

  let invalidColorSchemeRemovals = 0;
  const invalidColorScheme = createNativePlatformServices({
    ...adapter,
    getColorScheme: () => "sepia",
    subscribeColorScheme: () => ({
      remove: () => invalidColorSchemeRemovals++,
    }),
  });
  assert.throws(
    () => invalidColorScheme.subscribeColorScheme(() => {}),
    /must be light or dark/,
  );
  assert.equal(invalidColorSchemeRemovals, 1);

  let malformedColorSchemeListener;
  const malformedColorSchemeSubscription = createNativePlatformServices({
    ...adapter,
    subscribeColorScheme(listener) {
      malformedColorSchemeListener = listener;
      return { remove() {} };
    },
  }).subscribeColorScheme(() => {});
  assert.throws(
    () => malformedColorSchemeListener(null),
    /must be light or dark/,
  );
  malformedColorSchemeSubscription.remove();

  assert.throws(() => {
    const invalidInitialKeyboard = createNativePlatformServices({
      ...adapter,
      getKeyboardMetrics: () => ({
        screenX: 0,
        screenY: 500,
        width: 360,
        height: -1,
      }),
    });
    invalidInitialKeyboard.getKeyboardState();
  }, /width and height must be non-negative/);

  const emptyInitialURL = createNativePlatformServices({
    ...adapter,
    getInitialURL: async () => "",
  });
  await assert.rejects(
    () => emptyInitialURL.getInitialURL(),
    /invalid initial URL/,
  );

  const invalidSubscription = createNativePlatformServices({
    ...adapter,
    subscribeHardwareBack: () => ({ remove: 1 }),
  });
  assert.throws(
    () => invalidSubscription.subscribeHardwareBack(() => false),
    /removable subscription/,
  );

  let invalidWindowMetricsRemovals = 0;
  const invalidWindowMetrics = createNativePlatformServices({
    ...adapter,
    getWindowMetrics: () => ({
      width: 393,
      height: 852,
      scale: 0,
      fontScale: 1,
    }),
    subscribeWindowMetrics: () => ({
      remove: () => invalidWindowMetricsRemovals++,
    }),
  });
  assert.throws(
    () => invalidWindowMetrics.getWindowMetrics(),
    /scale and fontScale must be positive/,
  );
  assert.throws(
    () => invalidWindowMetrics.subscribeWindowMetrics(() => {}),
    /scale and fontScale must be positive/,
  );
  assert.equal(invalidWindowMetricsRemovals, 1);

  let malformedWindowListener;
  let malformedWindowRemovals = 0;
  const malformedWindowSubscription = createNativePlatformServices({
    ...adapter,
    subscribeWindowMetrics(listener) {
      malformedWindowListener = listener;
      return { remove: () => malformedWindowRemovals++ };
    },
  }).subscribeWindowMetrics(() => {});
  assert.throws(
    () =>
      malformedWindowListener({
        width: -1,
        height: 852,
        scale: 3,
        fontScale: 1,
      }),
    /width and height must be non-negative/,
  );
  malformedWindowSubscription.remove();
  assert.equal(malformedWindowRemovals, 1);
});

test("creates an ownership-safe versioned native transaction envelope", () => {
  const nestedStyle = {
    backgroundColor: "#146ef5",
    color: "rgba(255, 255, 255, 0.5)",
    padding: 12,
  };
  const removedProps = ["hidden"];
  const commandArgs = [{ animated: true }];
  const causalContext = { operationId: "commit-3" };
  const commit = {
    surface: 7,
    sequence: 3,
    priority: "user-blocking",
    causalContext,
    mutations: [
      {
        type: "update-props",
        node: 2,
        props: {
          style: nestedStyle,
          tintColor: "navy",
          trackColorForFalse: "#112233",
          trackColorForTrue: "#abcdef",
        },
        removedProps,
      },
      { type: "command", node: 2, command: "focus", args: commandArgs },
    ],
  };

  const transaction = createNativeHostTransaction(commit, "ios");
  nestedStyle.padding = 99;
  removedProps.push("testID");
  commandArgs[0].animated = false;
  causalContext.operationId = "mutated";

  assert.deepEqual(transaction, {
    contractVersion: 1,
    surface: 7,
    sequence: 3,
    priority: "user-blocking",
    causalContext: { operationId: "commit-3" },
    mutations: [
      {
        type: "update-props",
        node: 2,
        props: {
          style: {
            backgroundColor: 0xff146ef5,
            color: 0x80ffffff,
            padding: 12,
          },
          tintColor: 0xff000080,
          trackColorForFalse: 0xff112233,
          trackColorForTrue: 0xffabcdef,
        },
        removedProps: ["hidden"],
      },
      {
        type: "command",
        node: 2,
        command: "focus",
        args: [{ animated: true }],
      },
    ],
  });
});

test("rejects invalid colors before crossing JSI", () => {
  assert.throws(
    () =>
      createNativeHostTransaction(
        {
          surface: 7,
          sequence: 1,
          priority: "normal",
          mutations: [
            {
              type: "create-element",
              node: 1,
              component: "View",
              props: { style: { backgroundColor: "not-a-color" } },
            },
          ],
        },
        "android",
      ),
    /style\.backgroundColor is not a valid React Native color/,
  );
});

test("snapshots opaque native resource references for direct Fabric props", () => {
  const reference = {
    __solidNativeResource: {
      handle: 9,
      kind: "vision-camera.preview-output",
    },
  };
  const transaction = createNativeHostTransaction(
    {
      surface: 7,
      sequence: 1,
      priority: "normal",
      mutations: [
        {
          type: "create-element",
          node: 1,
          component: "CameraPreview",
          props: { previewOutput: reference },
        },
      ],
    },
    "ios",
  );

  reference.__solidNativeResource.handle = 10;
  assert.deepEqual(transaction.mutations[0].props.previewOutput, {
    __solidNativeResource: {
      handle: 9,
      kind: "vision-camera.preview-output",
    },
  });
  assert.notEqual(transaction.mutations[0].props.previewOutput, reference);
});

test("validates and calls the installed synchronous JSI binding", () => {
  const received = [];
  const globalObject = {
    [NATIVE_HOST_GLOBAL]: {
      contractVersion: 1,
      backend: "react-native-fabric",
      backendVersion: "0.87.0",
      platform: "ios",
      getSurfaceInfo: () => ({
        ready: true,
        surface: 41,
        sequence: 1,
        retainedNodeCount: 3,
        retainedResourceCount: 2,
        activeUIWorkletCount: 1,
        pendingUIWorkletFrameCount: 1,
      }),
      setEventHandler: (listener) => {
        globalObject.listener = listener;
      },
      setCommitLifecycleHandler: (listener) => {
        globalObject.lifecycleListener = listener;
      },
      retainNativeResource: (kind, value) => {
        globalObject.retainedResource = { kind, value };
        return 9;
      },
      releaseNativeResource: (handle) => {
        globalObject.releasedResource = handle;
        globalObject.releaseCount = (globalObject.releaseCount ?? 0) + 1;
      },
      measure: (node, afterSequence = 0) => ({
        x: node,
        y: 4,
        width: 120,
        height: 44,
        pageX: 8,
        pageY: 12,
        observedSequence: Math.max(2, afterSequence),
      }),
      destroySurface: () => {},
      commit: (transaction) => {
        received.push(transaction);
        return {
          surface: transaction.surface,
          sequence: transaction.sequence,
          mounted: true,
          hostRevision: 17,
        };
      },
    },
  };
  const binding = getNativeHostBinding(globalObject);
  assert.deepEqual(readNativeSurfaceInfo(binding), {
    ready: true,
    surface: 41,
    sequence: 1,
    retainedNodeCount: 3,
    retainedResourceCount: 2,
    activeUIWorkletCount: 1,
    pendingUIWorkletFrameCount: 1,
  });

  const opaque = {};
  assert.throws(
    () => retainNativeResource(binding, "VisionCamera", opaque),
    /native resource kind/,
  );
  assert.throws(
    () => retainNativeResource(binding, "vision-camera.preview-output", []),
    /non-array object/,
  );
  assert.throws(
    () =>
      retainNativeResource(
        binding,
        "vision-camera.preview-output",
        () => undefined,
      ),
    /non-array object/,
  );
  assert.throws(
    () =>
      retainNativeResource(
        { ...binding, retainNativeResource: () => 0 },
        "vision-camera.preview-output",
        {},
      ),
    IncompatibleNativeHostBindingError,
  );
  const retained = retainNativeResource(
    binding,
    "vision-camera.preview-output",
    opaque,
  );
  assert.equal(globalObject.retainedResource.value, opaque);
  assert.deepEqual(retained.reference, {
    __solidNativeResource: {
      handle: 9,
      kind: "vision-camera.preview-output",
    },
  });
  assert.equal(Object.isFrozen(retained.reference), true);
  assert.equal(retained.released, false);
  retained.release();
  retained.release();
  assert.equal(retained.released, true);
  assert.equal(globalObject.releasedResource, 9);
  assert.equal(globalObject.releaseCount, 1);

  let disposeOwner;
  createRoot((dispose) => {
    disposeOwner = dispose;
    const owned = retainOwnedNativeResource(
      binding,
      "vision-camera.preview-output",
      {},
    );
    assert.equal(owned.released, false);
  });
  disposeOwner();
  assert.equal(globalObject.releasedResource, 9);
  assert.equal(globalObject.releaseCount, 2);

  const style = { opacity: 0.5 };
  assert.deepEqual(
    commitNativeHostTransaction(binding, {
      surface: 41,
      sequence: 2,
      priority: "normal",
      causalContext: { operationId: "native-commit-2" },
      mutations: [
        { type: "update-props", node: 2, props: { style }, removedProps: [] },
      ],
    }),
    { surface: 41, sequence: 2, mounted: true, hostRevision: 17 },
  );
  style.opacity = 1;
  assert.deepEqual(received[0].mutations[0].props, {
    style: { opacity: 0.5 },
  });
  assert.deepEqual(received[0].causalContext, {
    operationId: "native-commit-2",
  });
  assert.deepEqual(measureNativeHostNode(binding, 2, 2), {
    x: 2,
    y: 4,
    width: 120,
    height: 44,
    pageX: 8,
    pageY: 12,
    observedSequence: 2,
  });

  const listener = () => {};
  const unsubscribe = subscribeToNativeHostEvents(binding, listener);
  assert.equal(globalObject.listener, listener);
  const nextListener = () => {};
  const unsubscribeNext = subscribeToNativeHostEvents(binding, nextListener);
  unsubscribe();
  unsubscribe();
  assert.equal(globalObject.listener, nextListener);
  unsubscribeNext();
  unsubscribeNext();
  assert.equal(globalObject.listener, null);

  const lifecycleEvents = [];
  const unsubscribeLifecycle = subscribeToNativeHostCommitLifecycle(
    binding,
    (event) => lifecycleEvents.push(event),
  );
  globalObject.lifecycleListener({
    type: "commit-mounted",
    surface: 41,
    sequence: 2,
    hostRevision: 17,
    commitStartedAt: 100,
    mountedAt: 104,
    mountLatency: 3.5,
    causalContext: { operationId: "native-commit-2" },
  });
  globalObject.lifecycleListener({
    type: "commit-frame",
    surface: 41,
    sequence: 2,
    hostRevision: 17,
    mountedAt: 104,
    frameStartedAt: 112,
    frameLatency: 11.5,
    mountToFrameLatency: 8,
    causalContext: { operationId: "native-commit-2" },
  });
  assert.deepEqual(lifecycleEvents, [
    {
      type: "commit-mounted",
      surface: 41,
      sequence: 2,
      hostRevision: 17,
      commitStartedAt: 100,
      mountedAt: 104,
      mountLatency: 3.5,
      causalContext: { operationId: "native-commit-2" },
    },
    {
      type: "commit-frame",
      surface: 41,
      sequence: 2,
      hostRevision: 17,
      mountedAt: 104,
      frameStartedAt: 112,
      frameLatency: 11.5,
      mountToFrameLatency: 8,
      causalContext: { operationId: "native-commit-2" },
    },
  ]);
  unsubscribeLifecycle();
  assert.equal(globalObject.lifecycleListener, null);
});

test("adapts the single native Fabric surface to the renderer host", async () => {
  const commits = [];
  let eventHandler = null;
  let surfaceReady = true;
  let surfaceDestroyed = false;
  const binding = {
    contractVersion: 1,
    backend: "react-native-fabric",
    backendVersion: "0.87.0",
    platform: "android",
    getSurfaceInfo: () => ({
      ready: surfaceReady,
      surface: surfaceReady ? 51 : 0,
      sequence: 0,
      retainedNodeCount: 0,
      retainedResourceCount: 0,
    }),
    setEventHandler: (listener) => {
      eventHandler = listener;
    },
    measure: (node, afterSequence = 0) => ({
      x: node,
      y: 2,
      width: 40,
      height: 20,
      pageX: node + 1,
      pageY: 3,
      observedSequence: afterSequence,
    }),
    destroySurface: () => {
      surfaceDestroyed = true;
      surfaceReady = false;
    },
    commit: (transaction) => {
      commits.push(transaction);
      return {
        surface: transaction.surface,
        sequence: transaction.sequence,
        mounted: true,
      };
    },
  };
  const host = createNativeFabricHost({
    binding,
    descriptors: CORE_COMPONENT_DESCRIPTORS,
  });
  assert.equal(host.platform, "android");
  assert.equal(host.capabilities.commitMountEvents, false);
  assert.equal(host.capabilities.nativeScreens, true);
  assert.equal(host.capabilities.uiWorklets, false);
  assert.equal(
    createNativeFabricHost({
      binding,
      descriptors: CORE_COMPONENT_DESCRIPTORS.filter(
        (descriptor) => descriptor.name !== "ScreenStack",
      ),
    }).capabilities.nativeScreens,
    false,
  );
  const surface = host.createSurface({ name: "native" });
  const root = host.allocateNode(surface);
  const events = [];
  const unsubscribe = host.subscribe((event) => events.push(event));

  assert.equal(surface, 51);
  assert.equal(root, 1);
  assert.deepEqual(
    host.commit({
      surface,
      sequence: 1,
      priority: "normal",
      mutations: [
        {
          type: "create-element",
          node: root,
          component: "RootView",
          props: {},
        },
      ],
    }),
    { surface: 51, sequence: 1, mounted: true },
  );
  assert.deepEqual(host.measure(surface, root, 1), {
    x: 1,
    y: 2,
    width: 40,
    height: 20,
    pageX: 2,
    pageY: 3,
    observedSequence: 1,
  });

  eventHandler({
    surface,
    target: root,
    observedSequence: 1,
    name: "press",
    timestamp: 10,
    priority: "discrete",
    bubbles: true,
    coalescible: false,
    payload: null,
  });
  assert.equal(events.length, 1);
  assert.throws(() => host.destroySurface(surface), /1 live nodes/);

  host.commit({
    surface,
    sequence: 2,
    priority: "normal",
    mutations: [{ type: "delete-node", node: root }],
  });
  unsubscribe();
  await host.destroySurface(surface);
  assert.equal(eventHandler, null);
  assert.equal(surfaceDestroyed, true);
  assert.equal(commits.length, 2);
  assert.throws(() => host.allocateNode(surface), /active surface/);
});

test("publishes UI worklets only for a complete native binding", () => {
  const binding = {
    contractVersion: 1,
    backend: "react-native-fabric",
    backendVersion: "0.87.0",
    platform: "android",
    getSurfaceInfo: () => ({
      ready: true,
      surface: 61,
      sequence: 0,
      retainedNodeCount: 0,
      retainedResourceCount: 0,
      activeUIWorkletCount: 0,
    }),
    setEventHandler: () => {},
    retainNativeResource: () => 1,
    releaseNativeResource: () => {},
    installUIWorklet: () => 1,
    updateUIWorkletInputs: () => {},
    animateUIWorkletInputs: () => {},
    animateUIWorkletKeyframes: () => {},
    springUIWorkletInputs: () => {},
    decayUIWorkletInputs: () => {},
    cancelUIWorkletAnimation: () => [0],
    attachUIWorkletPanGesture: () => {},
    detachUIWorkletPanGesture: () => [0],
    destroyUIWorklet: () => {},
    getUIWorkletInfo: () => ({
      handle: 1,
      target: 1,
      sequence: 0,
      appliedSequence: 0,
      applied: false,
      frameTimeNanoseconds: 0,
      timingActive: false,
      timingProgress: 0,
      outputs: {},
    }),
    measure: () => ({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      pageX: 0,
      pageY: 0,
      observedSequence: 0,
    }),
    destroySurface: () => {},
    commit: (transaction) => ({
      surface: transaction.surface,
      sequence: transaction.sequence,
      mounted: true,
    }),
  };
  const host = createNativeFabricHost({
    binding,
    descriptors: CORE_COMPONENT_DESCRIPTORS,
  });
  assert.equal(host.capabilities.uiWorklets, true);
  assert.equal(supportsNativeUIWorkletTimings(binding), true);
  assert.equal(supportsNativeUIWorkletKeyframes(binding), true);
  assert.equal(supportsNativeUIWorkletSprings(binding), true);
  assert.equal(supportsNativeUIWorkletDecays(binding), true);
  assert.equal(supportsNativeUIWorkletAnimationCancellation(binding), true);
  assert.equal(supportsNativeUIWorkletPanGestures(binding), true);
  assert.equal(supportsNativeUIWorkletPanGestureDetachment(binding), true);
  assert.doesNotThrow(() =>
    getNativeHostBinding({ [NATIVE_HOST_GLOBAL]: binding }),
  );
  assert.throws(
    () =>
      getNativeHostBinding({
        [NATIVE_HOST_GLOBAL]: {
          ...binding,
          destroyUIWorklet: undefined,
        },
      }),
    /require install, update, destroy, and inspection methods together/,
  );
  assert.throws(
    () =>
      getNativeHostBinding({
        [NATIVE_HOST_GLOBAL]: {
          ...binding,
          animateUIWorkletInputs: true,
        },
      }),
    /animateUIWorkletInputs must be a function/,
  );
  assert.throws(
    () =>
      getNativeHostBinding({
        [NATIVE_HOST_GLOBAL]: {
          ...binding,
          animateUIWorkletKeyframes: true,
        },
      }),
    /animateUIWorkletKeyframes must be a function/,
  );
  assert.throws(
    () =>
      getNativeHostBinding({
        [NATIVE_HOST_GLOBAL]: {
          ...binding,
          springUIWorkletInputs: true,
        },
      }),
    /springUIWorkletInputs must be a function/,
  );
  assert.throws(
    () =>
      getNativeHostBinding({
        [NATIVE_HOST_GLOBAL]: {
          ...binding,
          decayUIWorkletInputs: true,
        },
      }),
    /decayUIWorkletInputs must be a function/,
  );
  assert.throws(
    () =>
      getNativeHostBinding({
        [NATIVE_HOST_GLOBAL]: {
          ...binding,
          cancelUIWorkletAnimation: true,
        },
      }),
    /cancelUIWorkletAnimation must be a function/,
  );
  assert.throws(
    () =>
      getNativeHostBinding({
        [NATIVE_HOST_GLOBAL]: {
          ...binding,
          attachUIWorkletPanGesture: true,
        },
      }),
    /attachUIWorkletPanGesture must be a function/,
  );
  assert.throws(
    () =>
      getNativeHostBinding({
        [NATIVE_HOST_GLOBAL]: {
          ...binding,
          detachUIWorkletPanGesture: true,
        },
      }),
    /detachUIWorkletPanGesture must be a function/,
  );
  assert.throws(
    () =>
      getNativeHostBinding({
        [NATIVE_HOST_GLOBAL]: {
          ...binding,
          attachUIWorkletPanGesture: undefined,
        },
      }),
    /detachment requires the pan attachment extension/,
  );
});

test("rejects retained native resources at ownership transfer and teardown", async () => {
  let retainedResourceCount = 1;
  let activeUIWorkletCount = 0;
  let surfaceReady = true;
  let surfaceDestroyed = false;
  const binding = {
    contractVersion: 1,
    backend: "react-native-fabric",
    backendVersion: "0.87.0",
    platform: "android",
    getSurfaceInfo: () => ({
      ready: surfaceReady,
      surface: surfaceReady ? 54 : 0,
      sequence: 0,
      retainedNodeCount: 0,
      retainedResourceCount,
      activeUIWorkletCount,
    }),
    setEventHandler: () => {},
    measure: () => ({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      pageX: 0,
      pageY: 0,
      observedSequence: 0,
    }),
    destroySurface: () => {
      surfaceDestroyed = true;
      surfaceReady = false;
    },
    commit: (transaction) => ({
      surface: transaction.surface,
      sequence: transaction.sequence,
      mounted: true,
    }),
  };

  const dirtyHost = createNativeFabricHost({
    descriptors: CORE_COMPONENT_DESCRIPTORS,
    binding,
  });
  assert.throws(
    () => dirtyHost.createSurface({ name: "dirty-resource-handoff" }),
    /not empty at JavaScript ownership transfer/,
  );

  retainedResourceCount = 0;
  const host = createNativeFabricHost({
    descriptors: CORE_COMPONENT_DESCRIPTORS,
    binding,
  });
  const surface = host.createSurface({ name: "resource-teardown" });
  retainedResourceCount = 1;
  assert.throws(
    () => host.destroySurface(surface),
    /1 retained native resources/,
  );
  assert.equal(surfaceDestroyed, false);

  retainedResourceCount = 0;
  activeUIWorkletCount = 1;
  assert.throws(() => host.destroySurface(surface), /1 active UI worklets/);
  assert.equal(surfaceDestroyed, false);

  activeUIWorkletCount = 0;
  await host.destroySurface(surface);
  assert.equal(surfaceDestroyed, true);
});

test("mounts and tears down a renderer tree through the native adapter", async () => {
  const commits = [];
  let eventHandler = null;
  let surfaceReady = true;
  let surfaceDestroyed = false;
  const host = createNativeFabricHost({
    descriptors: CORE_COMPONENT_DESCRIPTORS,
    binding: {
      contractVersion: 1,
      backend: "react-native-fabric",
      backendVersion: "0.87.0",
      platform: "ios",
      getSurfaceInfo: () => ({
        ready: surfaceReady,
        surface: surfaceReady ? 52 : 0,
        sequence: 0,
        retainedNodeCount: 0,
        retainedResourceCount: 0,
      }),
      setEventHandler: (listener) => {
        eventHandler = listener;
      },
      measure: () => ({
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        pageX: 0,
        pageY: 0,
        observedSequence: 1,
      }),
      destroySurface: () => {
        surfaceDestroyed = true;
        surfaceReady = false;
      },
      commit: (transaction) => {
        commits.push(transaction);
        return {
          surface: transaction.surface,
          sequence: transaction.sequence,
          mounted: true,
        };
      },
    },
  });
  const app = startApplication(
    () => createComponent(Text, { children: "Native adapter" }),
    host,
    {
      surface: { name: "native-adapter" },
      autoCommit: false,
      requirements: { components: ["Text"] },
    },
  );

  await app.root.flush();
  assert.deepEqual(
    commits[0].mutations.map((mutation) => mutation.type),
    [
      "create-element",
      "create-element",
      "create-text",
      "insert-child",
      "insert-child",
    ],
  );
  await app.dispose();
  assert.equal(commits.length, 2);
  assert.equal(
    commits[1].mutations.filter((mutation) => mutation.type === "delete-node")
      .length,
    3,
  );
  assert.equal(eventHandler, null);
  assert.equal(surfaceDestroyed, true);
});

test("waits for the platform to acknowledge an asynchronous surface stop", async () => {
  let stopRequested = false;
  let stopPolls = 0;
  const binding = {
    contractVersion: 1,
    backend: "react-native-fabric",
    backendVersion: "0.87.0",
    platform: "android",
    getSurfaceInfo: () => {
      const ready = !stopRequested || stopPolls++ < 2;
      return {
        ready,
        surface: ready ? 56 : 0,
        sequence: 0,
        retainedNodeCount: 0,
        retainedResourceCount: 0,
      };
    },
    setEventHandler: () => {},
    measure: () => ({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      pageX: 0,
      pageY: 0,
      observedSequence: 0,
    }),
    destroySurface: () => {
      stopRequested = true;
    },
    commit: (transaction) => ({
      surface: transaction.surface,
      sequence: transaction.sequence,
      mounted: true,
    }),
  };
  const host = createNativeFabricHost({
    descriptors: CORE_COMPONENT_DESCRIPTORS,
    binding,
  });
  const surface = host.createSurface({ name: "asynchronous-stop" });

  const destruction = host.destroySurface(surface);
  assert.ok(destruction instanceof Promise);
  assert.equal(stopRequested, true);
  assert.throws(() => host.allocateNode(surface), /being destroyed/);
  assert.throws(() => host.subscribe(() => {}), /active native surface/);
  assert.throws(
    () => host.subscribeLifecycle(() => {}),
    /active native surface/,
  );
  await destruction;

  assert.equal(stopPolls, 3);
  assert.equal(binding.getSurfaceInfo().ready, false);
  assert.throws(() => host.allocateNode(surface), /active surface/);
});

test("waits for retired Fabric identities before destroying a native surface", async () => {
  let retiring = false;
  let reclamationPolls = 0;
  let surfaceReady = true;
  let surfaceDestroyed = false;
  const host = createNativeFabricHost({
    descriptors: CORE_COMPONENT_DESCRIPTORS,
    binding: {
      contractVersion: 1,
      backend: "react-native-fabric",
      backendVersion: "0.87.0",
      platform: "ios",
      getSurfaceInfo: () => ({
        ready: surfaceReady,
        surface: surfaceReady ? 53 : 0,
        sequence: retiring ? 2 : 0,
        retainedNodeCount:
          surfaceReady && retiring && reclamationPolls++ < 2 ? 1 : 0,
        retainedResourceCount: 0,
      }),
      setEventHandler: () => {},
      measure: () => ({
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        pageX: 0,
        pageY: 0,
        observedSequence: 1,
      }),
      destroySurface: () => {
        surfaceDestroyed = true;
        surfaceReady = false;
      },
      commit: (transaction) => {
        if (
          transaction.mutations.some(
            (mutation) => mutation.type === "delete-node",
          )
        ) {
          retiring = true;
        }
        return {
          surface: transaction.surface,
          sequence: transaction.sequence,
          mounted: true,
        };
      },
    },
  });
  const surface = host.createSurface({ name: "reclamation" });
  const root = host.allocateNode(surface);
  host.commit({
    surface,
    sequence: 1,
    priority: "normal",
    mutations: [
      { type: "create-element", node: root, component: "RootView", props: {} },
    ],
  });
  host.commit({
    surface,
    sequence: 2,
    priority: "normal",
    mutations: [{ type: "delete-node", node: root }],
  });

  const destruction = host.destroySurface(surface);
  assert.ok(destruction instanceof Promise);
  assert.equal(surfaceDestroyed, false);
  await destruction;
  assert.equal(reclamationPolls, 3);
  assert.equal(surfaceDestroyed, true);
});

test("aborts deferred teardown if a native resource appears", async () => {
  let tearingDown = false;
  let teardownReads = 0;
  let surfaceReady = true;
  let surfaceDestroyed = false;
  const host = createNativeFabricHost({
    descriptors: CORE_COMPONENT_DESCRIPTORS,
    binding: {
      contractVersion: 1,
      backend: "react-native-fabric",
      backendVersion: "0.87.0",
      platform: "ios",
      getSurfaceInfo: () => {
        if (!tearingDown) {
          return {
            ready: surfaceReady,
            surface: surfaceReady ? 55 : 0,
            sequence: 0,
            retainedNodeCount: 0,
            retainedResourceCount: 0,
          };
        }
        teardownReads += 1;
        return {
          ready: surfaceReady,
          surface: surfaceReady ? 55 : 0,
          sequence: 1,
          retainedNodeCount: 1,
          retainedResourceCount: teardownReads > 1 ? 1 : 0,
        };
      },
      setEventHandler: () => {},
      measure: () => ({
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        pageX: 0,
        pageY: 0,
        observedSequence: 0,
      }),
      destroySurface: () => {
        surfaceDestroyed = true;
        surfaceReady = false;
      },
      commit: (transaction) => ({
        surface: transaction.surface,
        sequence: transaction.sequence,
        mounted: true,
      }),
    },
  });
  const surface = host.createSurface({ name: "late-resource" });
  tearingDown = true;

  await assert.rejects(
    host.destroySurface(surface),
    /1 retained native resources/,
  );
  assert.equal(surfaceDestroyed, false);

  tearingDown = false;
  await host.destroySurface(surface);
  assert.equal(surfaceDestroyed, true);
});

test("rejects missing, drifted, and malformed native JSI bindings", () => {
  assert.throws(
    () => getNativeHostBinding({}),
    IncompatibleNativeHostBindingError,
  );
  assert.throws(
    () =>
      getNativeHostBinding({
        [NATIVE_HOST_GLOBAL]: {
          contractVersion: 1,
          backend: "other",
          backendVersion: "0.88.0",
        },
      }),
    (error) =>
      error instanceof IncompatibleNativeHostBindingError &&
      error.issues.length === 10,
  );
  assert.throws(
    () =>
      readNativeSurfaceInfo({
        contractVersion: 1,
        backend: "react-native-fabric",
        backendVersion: "0.87.0",
        platform: "ios",
        getSurfaceInfo: () => ({
          ready: true,
          surface: 0,
          sequence: -1,
          retainedNodeCount: -1,
          retainedResourceCount: -1,
          activeUIWorkletCount: 1,
          pendingUIWorkletFrameCount: 2,
        }),
        setEventHandler: () => {},
        measure: () => ({
          x: Number.NaN,
          y: 0,
          width: -1,
          height: 0,
          pageX: 0,
          pageY: 0,
          observedSequence: -1,
        }),
        destroySurface: () => {},
        commit: () => ({ surface: 0, sequence: 0, mounted: false }),
      }),
    IncompatibleNativeHostBindingError,
  );
  assert.throws(
    () =>
      measureNativeHostNode(
        {
          contractVersion: 1,
          backend: "react-native-fabric",
          backendVersion: "0.87.0",
          platform: "ios",
          getSurfaceInfo: () => ({
            ready: true,
            surface: 1,
            sequence: 2,
            retainedNodeCount: 1,
            retainedResourceCount: 0,
          }),
          setEventHandler: () => {},
          measure: () => ({
            x: 0,
            y: 0,
            width: -1,
            height: 1,
            pageX: 0,
            pageY: 0,
            observedSequence: 1,
          }),
          destroySurface: () => {},
          commit: () => ({ surface: 1, sequence: 2, mounted: true }),
        },
        1,
        2,
      ),
    IncompatibleNativeHostBindingError,
  );
});
