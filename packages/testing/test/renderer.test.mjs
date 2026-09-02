import assert from "node:assert/strict";
import test from "node:test";

import {
  DEV,
  action,
  createMemo,
  createOptimistic,
  flush,
  onCleanup,
  resetErrorHalt,
  untrack,
} from "solid-js";

import {
  ActivityIndicator,
  Button,
  CausalComputation,
  CausalOwner,
  CORE_COMPONENT_DESCRIPTORS,
  Image,
  KeyboardAwareScrollView,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  RefreshableScrollView,
  SafeAreaProvider,
  SafeAreaView,
  Screen,
  ScreenHeader,
  ScreenHeaderSubview,
  ScreenStack,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  TabsHost,
  TabsScreen,
  Text,
  TextInput,
  TextInputFocusGroup,
  View,
  VirtualizedList,
  calculateFocusedFieldScrollOffset,
  calculateKeyboardAvoidanceInset,
  createAppState,
  createCausalPlatformEventHandler,
  createColorScheme,
  createCausalScope,
  createKeyboard,
  createMemoryWarningCount,
  createNativeComponent,
  createNativeComponentDescriptor,
  createNativeEventAccessor,
  createWindowDimensions,
  retainCausalNativeEvent,
  retainCausalPlatformEvent,
  useSafeAreaFrame,
  useSafeAreaInsets,
} from "@solid-native/core";
import { createCameraService } from "@solid-native/camera";
import { createCameraSessionEvent } from "@solid-native/camera/solid";
import { createClipboardService } from "@solid-native/clipboard";
import {
  ClipboardOwnerDisposedError,
  createClipboardController,
} from "@solid-native/clipboard/solid";
import { createImageService } from "@solid-native/images";
import {
  ImageOwnerDisposedError,
  createImageController,
} from "@solid-native/images/solid";
import { createNetworkService } from "@solid-native/networking";
import { requestJSON } from "@solid-native/networking/json";
import { requestServerEvents } from "@solid-native/networking/server-events";
import {
  NetworkOwnerDisposedError,
  createNetworkController,
} from "@solid-native/networking/solid";
import { createJSONResource } from "@solid-native/networking/solid-json";
import { createServerEventStream } from "@solid-native/networking/solid-server-events";
import { createSecureStorage } from "@solid-native/secure-storage";
import {
  SecureStorageOwnerDisposedError,
  createSecureStorageController,
} from "@solid-native/secure-storage/solid";
import {
  NativeHistory,
  NativeModalStack,
  NativeScrollRestoration,
  NativeStack,
  NativeTabs,
  TanStackNativeMatches,
  TanStackNativeLink,
  TanStackNativeOutlet,
  TanStackNativeRouteView,
  TanStackNativeRouterProvider,
  TanStackNativeScrollView,
  TanStackNativeStack,
  TanStackRootRoute,
  TanStackRoute,
  createNativeScreenAccessibilityFocus,
  createNativeScreenFocusTask,
  createTanStackNativeScreenFocusEffect,
  createTanStackNativeScreenFocusTask,
  createNativeNavigationBindings,
  createTanStackNativeHistory,
  createTanStackNativeMemoryPolicy,
  createTanStackNativeRouter,
  tanStackRedirect,
  useTanStackNativeLoaderData,
  useTanStackNativeMatch,
  useTanStackNativeNavigate,
  useTanStackNativeScreen,
} from "@solid-native/navigation";
import {
  Errored,
  Loading,
  Show,
  createComponent,
  createElement,
  createSignal,
  insert,
  mount,
  mountAsync,
} from "@solid-native/renderer";
import { createCausalTelemetry } from "@solid-native/observability";
import { createNotificationService } from "@solid-native/notifications";
import { createNotificationEvent } from "@solid-native/notifications/solid";
import {
  AlertOwnerDisposedError,
  createAlertController,
} from "@solid-native/dialogs/solid";
import {
  ShareOwnerDisposedError,
  createShareController,
} from "@solid-native/sharing/solid";
import {
  VibrationOwnerDisposedError,
  createVibrationController,
} from "@solid-native/vibration/solid";
import { createVibrationService } from "@solid-native/vibration";
import { createAccessibilityPreferences } from "@solid-native/accessibility/solid";

import { InMemoryHost } from "../dist/index.js";

const terminalSolidFailureOnly = { skip: DEV !== undefined };

function createRendererHost(platform = "android") {
  return new InMemoryHost({
    descriptors: CORE_COMPONENT_DESCRIPTORS,
    platform,
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

test("replaces a recovered Solid error boundary without duplicate native nodes", async () => {
  const host = createRendererHost();
  const failure = new Error("native boundary failed");
  let shouldFail = true;
  let reset;
  const app = mount(
    () =>
      createComponent(Errored, {
        fallback: (error, retry) => {
          reset = retry;
          return createComponent(Text, {
            get children() {
              return `Error: ${error().message}`;
            },
          });
        },
        get children() {
          if (shouldFail) throw failure;
          return createComponent(Text, { children: "Recovered" });
        },
      }),
    host,
    { surface: { name: "error-boundary-recovery" }, autoCommit: false },
  );
  const renderedText = () =>
    host
      .getSurfaceSnapshot(app.root.surfaceId)
      .nodes.filter((node) => node.kind === "text")
      .map((node) => node.text);

  await app.root.flush();
  assert.deepEqual(renderedText(), ["Error: native boundary failed"]);
  shouldFail = false;
  reset();
  await app.root.flush();
  assert.deepEqual(renderedText(), ["Recovered"]);
  await app.dispose();
});

test("rematerializes a previously mounted subtree retained by Solid error recovery", async () => {
  const host = createRendererHost();
  const failure = new Error("mounted subtree failed");
  const [failed, setFailed] = createSignal(false);
  let reset;
  let presses = 0;
  const content = createMemo(() => {
    if (failed()) throw failure;
    return "Retained native subtree";
  });
  const app = mount(
    () =>
      createComponent(Errored, {
        fallback: (error, retry) => {
          reset = retry;
          return createComponent(Text, {
            get children() {
              return `Error: ${error().message}`;
            },
          });
        },
        get children() {
          return createComponent(View, {
            get children() {
              return [
                createComponent(Text, {
                  get children() {
                    return content();
                  },
                }),
                createComponent(Pressable, {
                  accessibilityRole: "button",
                  accessibilityLabel: "Retained action",
                  onPress: () => presses++,
                  children: createComponent(Text, { children: "Press" }),
                }),
              ];
            },
          });
        },
      }),
    host,
    { surface: { name: "retained-error-recovery" }, autoCommit: false },
  );

  await app.root.flush();
  const initial = host.getSurfaceSnapshot(app.root.surfaceId);
  const initialView = initial.nodes.find(
    (node) => node.kind === "element" && node.component === "View",
  );
  const initialPressable = initial.nodes.find(
    (node) => node.kind === "element" && node.component === "Pressable",
  );
  assert.ok(initialView);
  assert.ok(initialPressable);

  setFailed(true);
  await app.root.flush();
  assert.deepEqual(
    host
      .getSurfaceSnapshot(app.root.surfaceId)
      .nodes.filter((node) => node.kind === "text")
      .map((node) => node.text),
    ["Error: mounted subtree failed"],
  );

  setFailed(false);
  reset();
  await app.root.flush();
  const recovered = host.getSurfaceSnapshot(app.root.surfaceId);
  const recoveredView = recovered.nodes.find(
    (node) => node.kind === "element" && node.component === "View",
  );
  const recoveredPressable = recovered.nodes.find(
    (node) => node.kind === "element" && node.component === "Pressable",
  );
  assert.ok(recoveredView);
  assert.ok(recoveredPressable);
  assert.notEqual(recoveredView.node, initialView.node);
  assert.notEqual(recoveredPressable.node, initialPressable.node);
  assert.deepEqual(
    recovered.nodes
      .filter((node) => node.kind === "text")
      .map((node) => node.text),
    ["Retained native subtree", "Press"],
  );
  host.injectEvent({
    surface: app.root.surfaceId,
    target: recoveredPressable.node,
    name: "press",
    priority: "discrete",
    bubbles: true,
  });
  assert.equal(presses, 1);
  assert.throws(
    () =>
      host.injectEvent({
        surface: app.root.surfaceId,
        target: initialPressable.node,
        name: "press",
        priority: "discrete",
        bubbles: true,
      }),
    /does not exist/u,
  );
  assert.equal(presses, 1);

  setFailed(true);
  await app.root.flush();
  setFailed(false);
  reset();
  await app.root.flush();
  const recoveredAgain = host.getSurfaceSnapshot(app.root.surfaceId);
  const recoveredAgainView = recoveredAgain.nodes.find(
    (node) => node.kind === "element" && node.component === "View",
  );
  const recoveredAgainPressable = recoveredAgain.nodes.find(
    (node) => node.kind === "element" && node.component === "Pressable",
  );
  assert.ok(recoveredAgainView);
  assert.ok(recoveredAgainPressable);
  assert.equal(recoveredAgain.nodes.length, initial.nodes.length);
  assert.notEqual(recoveredAgainView.node, recoveredView.node);
  assert.notEqual(recoveredAgainPressable.node, recoveredPressable.node);
  host.injectEvent({
    surface: app.root.surfaceId,
    target: recoveredAgainPressable.node,
    name: "press",
    priority: "discrete",
    bubbles: true,
  });
  assert.equal(presses, 2);
  assert.throws(
    () =>
      host.injectEvent({
        surface: app.root.surfaceId,
        target: recoveredPressable.node,
        name: "press",
        priority: "discrete",
        bubbles: true,
      }),
    /does not exist/u,
  );
  assert.equal(presses, 2);
  await app.dispose();
});

test("binds native AppState to Solid ownership", async () => {
  let listener;
  let removals = 0;
  let state;
  const host = createRendererHost();
  const records = [];
  let operationSequence = 0;
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `app-state-operation-${++operationSequence}`,
  });
  const app = mount(
    () => {
      state = createAppState({
        initialAppState: "active",
        subscribeAppState(next) {
          listener = next;
          return {
            remove() {
              listener = undefined;
              removals++;
            },
          };
        },
      });
      return createComponent(CausalOwner, {
        name: "lifecycle.root",
        get children() {
          return createComponent(CausalComputation, {
            name: "lifecycle.app-state.output",
            get children() {
              return createComponent(Text, {
                get children() {
                  return state();
                },
              });
            },
          });
        },
      });
    },
    host,
    {
      surface: { name: "solid-app-state" },
      autoCommit: false,
      telemetry,
    },
  );

  await app.root.flush();
  assert.equal(state(), "active");
  const beforeDelivery = records.length;
  listener("background");
  await app.root.flush();
  assert.equal(state(), "background");
  assert.deepEqual(
    host
      .getSurfaceSnapshot(app.root.surfaceId)
      .nodes.filter((node) => node.kind === "text")
      .map((node) => node.text),
    ["background"],
  );
  const deliveryRecords = records.slice(beforeDelivery);
  const eventStarted = deliveryRecords.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      record.attributes["event.name"] === "platform.app-state.change",
  );
  const eventFinished = deliveryRecords.find(
    (record) =>
      record.type === "operation-finished" &&
      record.operationId === eventStarted?.operationId,
  );
  const computationStarted = deliveryRecords.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.computation" &&
      record.attributes["computation.name"] === "lifecycle.app-state.output",
  );
  const ownerStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.owner" &&
      record.attributes["owner.name"] === "lifecycle.root",
  );
  const surfaceStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.surface",
  );
  const updateCommit = deliveryRecords.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      record.attributes["commit.sequence"] === 2,
  );
  assert.ok(eventStarted);
  assert.ok(eventFinished);
  assert.ok(computationStarted);
  assert.ok(ownerStarted);
  assert.ok(surfaceStarted);
  assert.ok(updateCommit);
  assert.deepEqual(eventStarted.causes, [surfaceStarted.operationId]);
  assert.deepEqual(eventStarted.attributes, {
    "event.bubbles": false,
    "event.coalescible": false,
    "event.name": "platform.app-state.change",
    "event.priority": "default",
    "event.source": "platform",
    "surface.id": app.root.surfaceId,
  });
  assert.equal(eventFinished.status, "ok");
  assert.equal(eventFinished.attributes["event.handler_count"], 1);
  assert.deepEqual(
    new Set(updateCommit.causes),
    new Set([
      eventStarted.operationId,
      ownerStarted.operationId,
      computationStarted.operationId,
    ]),
  );
  assert.equal(updateCommit.attributes["commit.priority"], "normal");

  await app.dispose();
  assert.equal(removals, 1);
  assert.equal(listener, undefined);
});

test("binds native memory warnings to Solid ownership", async () => {
  let listener;
  let removals = 0;
  let warningCount;
  const records = [];
  let operationSequence = 0;
  const host = createRendererHost();
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `memory-warning-${++operationSequence}`,
  });
  const app = mount(
    () => {
      warningCount = createMemoryWarningCount({
        subscribeMemoryWarning(next) {
          listener = next;
          return {
            remove() {
              listener = undefined;
              removals++;
            },
          };
        },
      });
      return createComponent(CausalComputation, {
        name: "lifecycle.memory-warning.output",
        get children() {
          return createComponent(Text, {
            get children() {
              return `memory-warnings:${String(warningCount())}`;
            },
          });
        },
      });
    },
    host,
    {
      surface: { name: "solid-memory-warning" },
      autoCommit: false,
      telemetry,
    },
  );

  await app.root.flush();
  assert.equal(warningCount(), 0);
  const beforeWarnings = records.length;
  listener();
  listener();
  await app.root.flush();
  assert.equal(warningCount(), 2);
  assert.deepEqual(
    host
      .getSurfaceSnapshot(app.root.surfaceId)
      .nodes.filter((node) => node.kind === "text")
      .map((node) => node.text),
    ["memory-warnings:2"],
  );
  assert.equal(
    records
      .slice(beforeWarnings)
      .filter(
        (record) =>
          record.type === "operation-started" &&
          record.name === "solid-native.event" &&
          record.attributes["event.name"] === "platform.memory-warning",
      ).length,
    2,
  );

  await app.dispose();
  assert.equal(removals, 1);
  assert.equal(listener, undefined);
});

test("binds native color scheme to Solid ownership", async () => {
  let listener;
  let removals = 0;
  let colorScheme;
  const records = [];
  let operationSequence = 0;
  const host = createRendererHost();
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `appearance-operation-${++operationSequence}`,
  });
  const app = mount(
    () => {
      colorScheme = createColorScheme({
        getColorScheme: () => "light",
        subscribeColorScheme(next) {
          listener = next;
          return {
            remove() {
              listener = undefined;
              removals++;
            },
          };
        },
      });
      return createComponent(Text, {
        get children() {
          return `Appearance: ${colorScheme()}`;
        },
      });
    },
    host,
    {
      surface: { name: "solid-color-scheme" },
      autoCommit: false,
      telemetry,
    },
  );

  await app.root.flush();
  assert.equal(colorScheme(), "light");
  const beforeChange = records.length;
  listener("dark");
  await app.root.flush();
  assert.deepEqual(
    host
      .getSurfaceSnapshot(app.root.surfaceId)
      .nodes.filter((node) => node.kind === "text")
      .map((node) => node.text),
    ["Appearance: dark"],
  );
  const changeRecords = records.slice(beforeChange);
  const changeEvent = changeRecords.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      record.attributes["event.name"] === "platform.appearance.change",
  );
  const changeCommit = changeRecords.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit",
  );
  assert.ok(changeEvent);
  assert.ok(changeCommit);
  assert.equal(changeEvent.attributes["event.source"], "platform");
  assert.equal(changeEvent.attributes["event.priority"], "default");
  assert.equal(changeCommit.causes.includes(changeEvent.operationId), true);

  const sequenceBeforeDuplicate = host.getSurfaceSnapshot(
    app.root.surfaceId,
  ).sequence;
  listener("dark");
  await app.root.flush();
  assert.equal(
    host.getSurfaceSnapshot(app.root.surfaceId).sequence,
    sequenceBeforeDuplicate,
  );

  await app.dispose();
  assert.equal(removals, 1);
  assert.equal(listener, undefined);
});

test("binds a reactive status-bar entry to its Solid owner", async () => {
  const calls = [];
  let setBarStyle;
  let setHidden;
  const source = {
    pushStatusBarEntry(configuration) {
      calls.push({ operation: "push", configuration: { ...configuration } });
      let active = true;
      return {
        replace(next) {
          assert.equal(active, true);
          calls.push({ operation: "replace", configuration: { ...next } });
        },
        remove() {
          if (!active) return;
          active = false;
          calls.push({ operation: "remove" });
        },
      };
    },
  };
  const host = createRendererHost();
  const app = mount(
    () => {
      const [barStyle, updateBarStyle] = createSignal("dark-content");
      const [hidden, updateHidden] = createSignal(false);
      setBarStyle = updateBarStyle;
      setHidden = updateHidden;
      createComponent(StatusBar, {
        source,
        get barStyle() {
          return barStyle();
        },
        get hidden() {
          return hidden();
        },
      });
      return createComponent(Text, { children: "Owned system UI" });
    },
    host,
    { surface: { name: "solid-status-bar" }, autoCommit: false },
  );

  assert.deepEqual(calls, [
    {
      operation: "push",
      configuration: { barStyle: "dark-content", hidden: false },
    },
  ]);
  setBarStyle("light-content");
  await Promise.resolve();
  assert.deepEqual(calls.at(-1), {
    operation: "replace",
    configuration: { barStyle: "light-content", hidden: false },
  });
  setHidden(true);
  await Promise.resolve();
  assert.deepEqual(calls.at(-1), {
    operation: "replace",
    configuration: { barStyle: "light-content", hidden: true },
  });
  await app.dispose();
  assert.deepEqual(calls.at(-1), { operation: "remove" });
  assert.equal(calls.filter((call) => call.operation === "remove").length, 1);
});

test("binds native window dimensions to fine-grained Solid ownership", async () => {
  let listener;
  let removals = 0;
  let dimensions;
  const records = [];
  let operationSequence = 0;
  const host = createRendererHost();
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `window-operation-${++operationSequence}`,
  });
  const app = mount(
    () => {
      dimensions = createWindowDimensions({
        getWindowMetrics: () => ({
          width: 390,
          height: 844,
          scale: 3,
          fontScale: 1,
        }),
        subscribeWindowMetrics(next) {
          listener = next;
          return {
            remove() {
              listener = undefined;
              removals++;
            },
          };
        },
      });
      return createComponent(CausalComputation, {
        name: "layout.window.output",
        get children() {
          return createComponent(Text, {
            get children() {
              return `${dimensions.width()}x${dimensions.height()}@${dimensions.scale()}/${dimensions.fontScale()}`;
            },
          });
        },
      });
    },
    host,
    {
      surface: { name: "solid-window-dimensions" },
      autoCommit: false,
      telemetry,
    },
  );

  await app.root.flush();
  assert.equal(dimensions.width(), 390);
  assert.equal(dimensions.height(), 844);
  const beforeResize = records.length;
  listener({ width: 844, height: 390, scale: 3, fontScale: 1.1 });
  await app.root.flush();
  assert.deepEqual(
    host
      .getSurfaceSnapshot(app.root.surfaceId)
      .nodes.filter((node) => node.kind === "text")
      .map((node) => node.text),
    ["844x390@3/1.1"],
  );
  const resizeRecords = records.slice(beforeResize);
  const resizeEvent = resizeRecords.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      record.attributes["event.name"] === "platform.window.dimensions",
  );
  const resizeCommit = resizeRecords.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit",
  );
  assert.ok(resizeEvent);
  assert.ok(resizeCommit);
  assert.equal(resizeEvent.attributes["event.source"], "platform");
  assert.equal(resizeEvent.attributes["event.priority"], "default");
  assert.equal(resizeCommit.attributes["commit.priority"], "normal");
  assert.equal(resizeCommit.causes.includes(resizeEvent.operationId), true);

  const sequenceBeforeDuplicate = host.getSurfaceSnapshot(
    app.root.surfaceId,
  ).sequence;
  listener({ width: 844, height: 390, scale: 3, fontScale: 1.1 });
  await app.root.flush();
  assert.equal(
    host.getSurfaceSnapshot(app.root.surfaceId).sequence,
    sequenceBeforeDuplicate,
  );

  await app.dispose();
  assert.equal(removals, 1);
  assert.equal(listener, undefined);
});

test("owns safe-area metrics and native inset application without React", async () => {
  const host = createRendererHost();
  const [edges, setEdges] = createSignal(["top", "bottom"]);
  const observedMetrics = [];

  function SafeContent() {
    const insets = useSafeAreaInsets();
    const frame = useSafeAreaFrame();
    return createComponent(SafeAreaView, {
      get edges() {
        return edges();
      },
      get children() {
        return createComponent(Text, {
          get children() {
            return `${insets.top()}/${insets.bottom()}:${frame.width()}x${frame.height()}`;
          },
        });
      },
    });
  }

  const app = mount(
    () =>
      createComponent(SafeAreaProvider, {
        testID: "safe-area-provider",
        onMetricsChange: (metrics) => observedMetrics.push(metrics),
        get children() {
          return createComponent(SafeContent, {});
        },
      }),
    host,
    { surface: { name: "solid-safe-area" }, autoCommit: false },
  );

  await app.root.flush();
  let snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  const provider = snapshot.nodes.find(
    (node) =>
      node.kind === "element" && node.component === "RNCSafeAreaProvider",
  );
  assert.ok(provider);
  assert.deepEqual(provider.props, {
    style: { flex: 1 },
    testID: "safe-area-provider",
  });
  assert.deepEqual(provider.eventListeners, ["insetsChange"]);
  assert.equal(
    snapshot.nodes.some(
      (node) => node.kind === "element" && node.component === "RNCSafeAreaView",
    ),
    false,
  );

  const metrics = {
    insets: { top: 59, right: 0, bottom: 34, left: 0 },
    frame: { x: 0, y: 59, width: 393, height: 759 },
  };
  host.injectEvent({
    surface: app.root.surfaceId,
    target: provider.node,
    name: "insetsChange",
    payload: metrics,
  });
  await app.root.flush();
  snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  let safeView = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "RNCSafeAreaView",
  );
  assert.ok(safeView);
  assert.deepEqual(safeView.props.edges, {
    top: "additive",
    right: "off",
    bottom: "additive",
    left: "off",
  });
  assert.equal(safeView.props.mode, "padding");
  assert.deepEqual(
    snapshot.nodes
      .filter((node) => node.kind === "text")
      .map((node) => node.text),
    ["59/34:393x759"],
  );
  assert.deepEqual(observedMetrics, [metrics]);
  assert.notEqual(observedMetrics[0], metrics);
  assert.equal(Object.isFrozen(observedMetrics[0]), true);
  assert.equal(Object.isFrozen(observedMetrics[0].insets), true);
  assert.throws(
    () =>
      host.injectEvent({
        surface: app.root.surfaceId,
        target: provider.node,
        name: "insetsChange",
        payload: {
          insets: { top: -1, right: 0, bottom: 34, left: 0 },
          frame: { x: 0, y: 59, width: 393, height: 759 },
        },
      }),
    /insets must be non-negative/,
  );

  const sequenceBeforeDuplicate = snapshot.sequence;
  host.injectEvent({
    surface: app.root.surfaceId,
    target: provider.node,
    name: "insetsChange",
    payload: metrics,
  });
  await app.root.flush();
  assert.equal(
    host.getSurfaceSnapshot(app.root.surfaceId).sequence,
    sequenceBeforeDuplicate,
  );

  setEdges({ top: "maximum", left: "additive" });
  await app.root.flush();
  safeView = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "RNCSafeAreaView",
    );
  assert.ok(safeView);
  assert.deepEqual(safeView.props.edges, {
    top: "maximum",
    right: "off",
    bottom: "off",
    left: "additive",
  });

  await app.dispose();

  const bootstrapHost = createRendererHost();
  const bootstrapApp = mount(
    () =>
      createComponent(SafeAreaProvider, {
        initialMetrics: metrics,
        get children() {
          return createComponent(SafeContent, {});
        },
      }),
    bootstrapHost,
    { surface: { name: "solid-safe-area-bootstrap" }, autoCommit: false },
  );
  await bootstrapApp.root.flush();
  const bootstrapSnapshot = bootstrapHost.getSurfaceSnapshot(
    bootstrapApp.root.surfaceId,
  );
  assert.equal(
    bootstrapSnapshot.nodes.some(
      (node) => node.kind === "element" && node.component === "RNCSafeAreaView",
    ),
    true,
  );
  assert.deepEqual(
    bootstrapSnapshot.nodes
      .filter((node) => node.kind === "text")
      .map((node) => node.text),
    ["59/34:393x759"],
  );
  await bootstrapApp.dispose();
});

test("binds normalized keyboard state to Solid ownership", async () => {
  let listener;
  let removals = 0;
  let dismissals = 0;
  let keyboard;
  const records = [];
  let operationSequence = 0;
  const host = createRendererHost();
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `keyboard-operation-${++operationSequence}`,
  });
  const app = mount(
    () => {
      keyboard = createKeyboard({
        dismissKeyboard() {
          dismissals++;
        },
        getKeyboardState() {
          return { visible: false };
        },
        subscribeKeyboard(next) {
          listener = next;
          return {
            remove() {
              listener = undefined;
              removals++;
            },
          };
        },
      });
      return createComponent(CausalComputation, {
        name: "input.keyboard.output",
        get children() {
          return createComponent(Text, {
            get children() {
              const metrics = keyboard.metrics();
              return keyboard.visible()
                ? `visible:${metrics?.height ?? "missing"}`
                : "hidden";
            },
          });
        },
      });
    },
    host,
    {
      surface: { name: "solid-keyboard" },
      autoCommit: false,
      telemetry,
    },
  );

  await app.root.flush();
  assert.equal(keyboard.visible(), false);
  assert.equal(keyboard.metrics(), undefined);
  const beforeShow = records.length;
  const shown = {
    visible: true,
    metrics: { screenX: 0, screenY: 520, width: 360, height: 280 },
  };
  listener(shown);
  const showUpdate = await app.root.flush();
  assert.equal(showUpdate.sequence, 2);
  assert.equal(keyboard.visible(), true);
  assert.deepEqual(keyboard.metrics(), shown.metrics);
  assert.deepEqual(
    host
      .getSurfaceSnapshot(app.root.surfaceId)
      .nodes.filter((node) => node.kind === "text")
      .map((node) => node.text),
    ["visible:280"],
  );
  const showRecords = records.slice(beforeShow);
  const eventStarted = showRecords.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      record.attributes["event.name"] === "platform.keyboard.visibility",
  );
  const updateCommit = showRecords.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      record.attributes["commit.sequence"] === 2,
  );
  assert.ok(eventStarted);
  assert.ok(updateCommit);
  assert.equal(
    Object.values(eventStarted.attributes).includes(shown.metrics.height),
    false,
  );
  assert.ok(updateCommit.causes.includes(eventStarted.operationId));

  listener({
    visible: true,
    metrics: { screenX: 0, screenY: 520, width: 360, height: 280 },
  });
  assert.equal(await app.root.flush(), undefined);
  listener({ visible: false });
  const hideUpdate = await app.root.flush();
  assert.equal(hideUpdate.sequence, 3);
  assert.equal(keyboard.visible(), false);
  assert.equal(keyboard.metrics(), undefined);
  keyboard.dismiss();
  assert.equal(dismissals, 1);

  await app.dispose();
  assert.equal(removals, 1);
  assert.equal(listener, undefined);
});

test("calculates bounded keyboard avoidance from screen-space intersection", () => {
  const frame = {
    pageX: 0,
    pageY: 100,
    width: 400,
    height: 600,
  };
  const keyboard = {
    screenX: 0,
    screenY: 600,
    width: 400,
    height: 300,
  };

  assert.equal(calculateKeyboardAvoidanceInset(frame, keyboard), 100);
  assert.equal(calculateKeyboardAvoidanceInset(frame, keyboard, 20), 120);
  assert.equal(
    calculateKeyboardAvoidanceInset(frame, {
      ...keyboard,
      screenX: 500,
    }),
    0,
  );
  assert.equal(
    calculateKeyboardAvoidanceInset(
      { ...frame, pageY: 650, height: 100 },
      keyboard,
    ),
    100,
  );
  assert.throws(
    () =>
      calculateKeyboardAvoidanceInset(
        frame,
        keyboard,
        Number.POSITIVE_INFINITY,
      ),
    /keyboardVerticalOffset must be finite/u,
  );
  assert.throws(
    () => calculateKeyboardAvoidanceInset({ ...frame, width: -1 }, keyboard),
    /width and height must be non-negative/u,
  );
});

test("calculates focused-field destinations inside the visible scroll viewport", () => {
  const scrollFrame = {
    pageX: 0,
    pageY: 100,
    width: 400,
    height: 500,
  };
  const keyboard = {
    screenX: 0,
    screenY: 500,
    width: 400,
    height: 300,
  };

  assert.equal(
    calculateFocusedFieldScrollOffset(
      scrollFrame,
      { pageX: 20, pageY: 520, width: 360, height: 48 },
      0,
      keyboard,
      { extraScrollHeight: 12 },
    ),
    80,
  );
  assert.equal(
    calculateFocusedFieldScrollOffset(
      scrollFrame,
      { pageX: 20, pageY: 430, width: 360, height: 48 },
      120,
      keyboard,
      { extraScrollHeight: 12 },
    ),
    120,
  );
  assert.equal(
    calculateFocusedFieldScrollOffset(
      scrollFrame,
      { pageX: 20, pageY: 80, width: 360, height: 48 },
      120,
      keyboard,
    ),
    100,
  );
  assert.equal(
    calculateFocusedFieldScrollOffset(
      scrollFrame,
      { pageX: 0, pageY: 520, width: 100, height: 48 },
      0,
      { ...keyboard, screenX: 300, width: 100 },
    ),
    0,
  );
  assert.equal(
    calculateFocusedFieldScrollOffset(
      scrollFrame,
      { pageX: 20, pageY: 200, width: 360, height: 450 },
      20,
      keyboard,
      { extraScrollHeight: 12 },
    ),
    120,
  );
  assert.equal(
    calculateFocusedFieldScrollOffset(
      scrollFrame,
      { pageX: 20, pageY: 430, width: 360, height: 48 },
      0,
      keyboard,
      { keyboardVerticalOffset: 30 },
    ),
    8,
  );
  assert.throws(
    () =>
      calculateFocusedFieldScrollOffset(
        scrollFrame,
        { pageX: 20, pageY: 520, width: 360, height: 48 },
        -1,
        keyboard,
      ),
    /must be non-negative/u,
  );
  assert.throws(
    () =>
      calculateFocusedFieldScrollOffset(
        scrollFrame,
        {
          pageX: Number.MAX_VALUE,
          pageY: 520,
          width: Number.MAX_VALUE,
          height: 48,
        },
        0,
        keyboard,
      ),
    /finite screen-space extents/u,
  );
});

test("scrolls the focused native editor through a Solid-owned causal task", async () => {
  let keyboard;
  let scrollViewRef;
  const destinations = [];
  const scrollEvents = [];
  const records = [];
  let operationSequence = 0;
  const host = createRendererHost("ios");
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `keyboard-focus-${++operationSequence}`,
  });
  const app = mount(
    () => {
      keyboard = createKeyboard({
        dismissKeyboard() {},
        getKeyboardState() {
          return {
            visible: true,
            metrics: { screenX: 0, screenY: 500, width: 400, height: 300 },
          };
        },
        subscribeKeyboard() {
          return { remove() {} };
        },
      });
      return createComponent(KeyboardAwareScrollView, {
        keyboard,
        animated: false,
        extraScrollHeight: 12,
        ref(node) {
          scrollViewRef = node;
        },
        onScroll(event) {
          scrollEvents.push(event.payload.contentOffset.y);
        },
        onFocusedFieldScroll(offset) {
          destinations.push(offset);
        },
        children: createComponent(TextInput, { defaultValue: "Editor" }),
      });
    },
    host,
    {
      surface: { name: "keyboard-aware-scroll" },
      autoCommit: false,
      telemetry,
    },
  );

  await app.root.flush();
  const snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  const scrollView = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "ScrollView",
  );
  const input = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "TextInput",
  );
  assert.ok(scrollView);
  assert.ok(input);
  assert.equal(scrollViewRef?.nativeNode.componentName, "ScrollView");
  assert.deepEqual(scrollView.eventListeners, ["scroll", "scrollBeginDrag"]);
  assert.ok(input.eventListeners.includes("focus"));
  assert.ok(input.eventListeners.includes("blur"));
  host.setMeasurement(app.root.surfaceId, scrollView.node, {
    x: 0,
    y: 100,
    width: 400,
    height: 500,
    pageX: 0,
    pageY: 100,
  });
  host.setMeasurement(app.root.surfaceId, input.node, {
    x: 20,
    y: 520,
    width: 360,
    height: 48,
    pageX: 20,
    pageY: 520,
  });

  const telemetryStart = records.length;
  host.injectEvent({
    surface: app.root.surfaceId,
    target: input.node,
    name: "focus",
    payload: {},
    priority: "default",
    bubbles: false,
  });
  for (let attempt = 0; destinations.length === 0 && attempt < 30; attempt++) {
    await Promise.resolve();
  }
  assert.deepEqual(destinations, [80]);
  const command = host.commits
    .flatMap((commit) => commit.mutations)
    .find(
      (mutation) =>
        mutation.type === "command" && mutation.command === "scrollTo",
    );
  assert.deepEqual(command, {
    type: "command",
    node: scrollView.node,
    command: "scrollTo",
    args: [0, 80, false],
  });
  host.injectEvent({
    surface: app.root.surfaceId,
    target: scrollView.node,
    name: "scroll",
    payload: { contentOffset: { x: 0, y: 80 } },
    priority: "continuous",
    bubbles: true,
  });
  assert.deepEqual(scrollEvents, [80]);

  const interaction = records.slice(telemetryStart);
  const focusEvent = interaction.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      record.attributes["event.name"] === "focus",
  );
  const task = interaction.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.task" &&
      record.attributes["task.name"] === "keyboard.focus.visibility",
  );
  const measurements = interaction.filter(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.measure",
  );
  const scrollCommand = interaction.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.command" &&
      record.attributes["command.name"] === "scrollTo",
  );
  assert.ok(focusEvent);
  assert.ok(task);
  assert.equal(measurements.length, 2);
  assert.ok(scrollCommand);
  assert.ok(task.causes.includes(focusEvent.operationId));
  assert.ok(
    measurements.every((measurement) =>
      measurement.causes.includes(task.operationId),
    ),
  );
  assert.ok(scrollCommand.causes.includes(task.operationId));
  await app.dispose();
});

test("selects the nearest keyboard-aware owner for a nested scroll form", async () => {
  const destinations = [];
  const host = createRendererHost("ios");
  const app = mount(
    () => {
      const keyboard = createKeyboard({
        dismissKeyboard() {},
        getKeyboardState() {
          return {
            visible: true,
            metrics: { screenX: 0, screenY: 500, width: 400, height: 300 },
          };
        },
        subscribeKeyboard() {
          return { remove() {} };
        },
      });
      return createComponent(KeyboardAwareScrollView, {
        keyboard,
        onFocusedFieldScroll: (offset) => destinations.push(["outer", offset]),
        children: createComponent(KeyboardAwareScrollView, {
          keyboard,
          animated: false,
          onFocusedFieldScroll: (offset) =>
            destinations.push(["inner", offset]),
          children: createComponent(TextInput, { defaultValue: "Nested" }),
        }),
      });
    },
    host,
    { surface: { name: "nested-keyboard-aware-scroll" }, autoCommit: false },
  );

  await app.root.flush();
  const snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  const scrollViews = snapshot.nodes.filter(
    (node) => node.kind === "element" && node.component === "ScrollView",
  );
  const input = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "TextInput",
  );
  assert.ok(input);
  const nodesByHandle = new Map(
    snapshot.nodes.map((node) => [node.node, node]),
  );
  const inputParent = nodesByHandle.get(input.parent);
  const innerScrollView =
    inputParent === undefined
      ? undefined
      : nodesByHandle.get(inputParent.parent);
  const outerScrollView = scrollViews.find(
    (node) => node.node !== innerScrollView?.node,
  );
  assert.equal(innerScrollView?.kind, "element");
  assert.equal(innerScrollView?.component, "ScrollView");
  assert.ok(outerScrollView);
  host.setMeasurement(app.root.surfaceId, innerScrollView.node, {
    x: 0,
    y: 100,
    width: 400,
    height: 500,
    pageX: 0,
    pageY: 100,
  });
  host.setMeasurement(app.root.surfaceId, input.node, {
    x: 20,
    y: 520,
    width: 360,
    height: 48,
    pageX: 20,
    pageY: 520,
  });

  host.injectEvent({
    surface: app.root.surfaceId,
    target: input.node,
    name: "focus",
    payload: {},
    priority: "default",
    bubbles: false,
  });
  for (let attempt = 0; destinations.length === 0 && attempt < 30; attempt++) {
    await Promise.resolve();
  }

  assert.deepEqual(destinations, [["inner", 68]]);
  const commands = host.commits
    .flatMap((commit) => commit.mutations)
    .filter(
      (mutation) =>
        mutation.type === "command" && mutation.command === "scrollTo",
    );
  assert.equal(commands.length, 1);
  assert.equal(commands[0].node, innerScrollView.node);
  assert.notEqual(commands[0].node, outerScrollView.node);
  await app.dispose();
});

test("reports focused-field failures without losing isolated diagnostics", async () => {
  const measurementFailure = new Error("focused field measurement failed");
  const commandFailure = new Error("focused field command failed");
  const callbackFailure = new Error("focused field callback failed");
  const errors = [];
  let failure = "measurement";
  const host = createRendererHost("android");
  const nativeMeasure = host.measure.bind(host);
  host.measure = (...args) =>
    failure === "measurement"
      ? Promise.reject(measurementFailure)
      : nativeMeasure(...args);
  const nativeCommit = host.commit.bind(host);
  host.commit = (transaction) =>
    failure === "command" &&
    transaction.mutations.some((mutation) => mutation.type === "command")
      ? Promise.reject(commandFailure)
      : nativeCommit(transaction);
  const app = mount(
    () => {
      const keyboard = createKeyboard({
        dismissKeyboard() {},
        getKeyboardState() {
          return {
            visible: true,
            metrics: { screenX: 0, screenY: 500, width: 400, height: 300 },
          };
        },
        subscribeKeyboard() {
          return { remove() {} };
        },
      });
      return createComponent(KeyboardAwareScrollView, {
        keyboard,
        onFocusedFieldScroll() {
          if (failure === "callback") throw callbackFailure;
        },
        onVisibilityError(error) {
          errors.push(error);
          throw new Error("focused-field diagnostic failed");
        },
        children: createComponent(TextInput, { defaultValue: "Editor" }),
      });
    },
    host,
    {
      surface: { name: "keyboard-aware-scroll-failure-isolation" },
      autoCommit: false,
    },
  );

  await app.root.flush();
  const snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  const scrollView = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "ScrollView",
  );
  const input = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "TextInput",
  );
  assert.ok(scrollView);
  assert.ok(input);
  host.setMeasurement(app.root.surfaceId, scrollView.node, {
    x: 0,
    y: 100,
    width: 400,
    height: 500,
    pageX: 0,
    pageY: 100,
  });
  host.setMeasurement(app.root.surfaceId, input.node, {
    x: 20,
    y: 520,
    width: 360,
    height: 48,
    pageX: 20,
    pageY: 520,
  });
  const focus = () =>
    host.injectEvent({
      surface: app.root.surfaceId,
      target: input.node,
      name: "focus",
      payload: {},
      priority: "default",
      bubbles: false,
    });
  const waitForError = async (count) => {
    for (let attempt = 0; errors.length < count && attempt < 30; attempt++) {
      await Promise.resolve();
    }
    assert.equal(errors.length, count);
  };

  focus();
  await waitForError(1);
  failure = "callback";
  focus();
  await waitForError(2);
  host.setMeasurement(app.root.surfaceId, scrollView.node, {
    x: 0,
    y: 100,
    width: 400,
    height: 500,
    pageX: 0,
    pageY: 100,
  });
  host.setMeasurement(app.root.surfaceId, input.node, {
    x: 20,
    y: 520,
    width: 360,
    height: 48,
    pageX: 20,
    pageY: 520,
  });
  failure = "command";
  focus();
  await waitForError(3);
  assert.deepEqual(errors, [
    measurementFailure,
    callbackFailure,
    commandFailure,
  ]);
  await assert.rejects(app.dispose(), (error) => error === commandFailure);
});

test("cancels measurements from a superseded focused field", async () => {
  const destinations = [];
  const pendingMeasurements = [];
  const host = createRendererHost("ios");
  const nativeMeasure = host.measure.bind(host);
  host.measure = (...args) => {
    nativeMeasure(...args);
    const measurement = deferred();
    pendingMeasurements.push(measurement);
    return measurement.promise;
  };
  const app = mount(
    () => {
      const keyboard = createKeyboard({
        dismissKeyboard() {},
        getKeyboardState() {
          return {
            visible: true,
            metrics: { screenX: 0, screenY: 500, width: 400, height: 300 },
          };
        },
        subscribeKeyboard() {
          return { remove() {} };
        },
      });
      return createComponent(KeyboardAwareScrollView, {
        keyboard,
        animated: false,
        onFocusedFieldScroll: (offset) => destinations.push(offset),
        children: [
          createComponent(TextInput, { defaultValue: "First" }),
          createComponent(TextInput, { defaultValue: "Second" }),
        ],
      });
    },
    host,
    { surface: { name: "keyboard-aware-focus-switch" }, autoCommit: false },
  );

  await app.root.flush();
  const snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  const inputs = snapshot.nodes.filter(
    (node) => node.kind === "element" && node.component === "TextInput",
  );
  assert.equal(inputs.length, 2);
  const focus = (target) =>
    host.injectEvent({
      surface: app.root.surfaceId,
      target,
      name: "focus",
      payload: {},
      priority: "default",
      bubbles: false,
    });
  focus(inputs[0].node);
  for (
    let attempt = 0;
    pendingMeasurements.length < 2 && attempt < 20;
    attempt++
  ) {
    await Promise.resolve();
  }
  focus(inputs[1].node);
  for (
    let attempt = 0;
    pendingMeasurements.length < 4 && attempt < 20;
    attempt++
  ) {
    await Promise.resolve();
  }
  assert.equal(pendingMeasurements.length, 4);
  const resolveFramePair = (index, fieldPageY) => {
    pendingMeasurements[index].resolve({
      x: 0,
      y: 100,
      width: 400,
      height: 500,
      pageX: 0,
      pageY: 100,
      observedSequence: 1,
    });
    pendingMeasurements[index + 1].resolve({
      x: 20,
      y: fieldPageY,
      width: 360,
      height: 48,
      pageX: 20,
      pageY: fieldPageY,
      observedSequence: 1,
    });
  };
  resolveFramePair(0, 520);
  for (let attempt = 0; attempt < 10; attempt++) await Promise.resolve();
  assert.deepEqual(destinations, []);
  resolveFramePair(2, 482);
  for (let attempt = 0; destinations.length === 0 && attempt < 30; attempt++) {
    await Promise.resolve();
  }
  assert.deepEqual(destinations, [30]);
  await app.dispose();
});

test("cancels stale focused-field measurements after blur and disposal", async () => {
  let keyboard;
  const destinations = [];
  const pendingMeasurements = [];
  const host = createRendererHost("android");
  host.measure = () => {
    const measurement = deferred();
    pendingMeasurements.push(measurement);
    return measurement.promise;
  };
  const app = mount(
    () => {
      keyboard = createKeyboard({
        dismissKeyboard() {},
        getKeyboardState() {
          return {
            visible: true,
            metrics: { screenX: 0, screenY: 500, width: 400, height: 300 },
          };
        },
        subscribeKeyboard() {
          return { remove() {} };
        },
      });
      return createComponent(KeyboardAwareScrollView, {
        keyboard,
        onFocusedFieldScroll: (offset) => destinations.push(offset),
        children: createComponent(TextInput, { defaultValue: "Editor" }),
      });
    },
    host,
    { surface: { name: "keyboard-aware-scroll-race" }, autoCommit: false },
  );

  await app.root.flush();
  const snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  const input = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "TextInput",
  );
  assert.ok(input);
  host.injectEvent({
    surface: app.root.surfaceId,
    target: input.node,
    name: "focus",
    payload: {},
    priority: "default",
    bubbles: false,
  });
  for (
    let attempt = 0;
    pendingMeasurements.length < 2 && attempt < 20;
    attempt++
  ) {
    await Promise.resolve();
  }
  assert.equal(pendingMeasurements.length, 2);
  host.injectEvent({
    surface: app.root.surfaceId,
    target: input.node,
    name: "blur",
    payload: {},
    priority: "default",
    bubbles: false,
  });
  pendingMeasurements[0].resolve({
    x: 0,
    y: 100,
    width: 400,
    height: 500,
    pageX: 0,
    pageY: 100,
    observedSequence: 1,
  });
  pendingMeasurements[1].resolve({
    x: 20,
    y: 520,
    width: 360,
    height: 48,
    pageX: 20,
    pageY: 520,
    observedSequence: 1,
  });
  for (let attempt = 0; attempt < 10; attempt++) await Promise.resolve();
  assert.deepEqual(destinations, []);
  assert.equal(
    host.commits
      .flatMap((commit) => commit.mutations)
      .some(
        (mutation) =>
          mutation.type === "command" && mutation.command === "scrollTo",
      ),
    false,
  );

  host.injectEvent({
    surface: app.root.surfaceId,
    target: input.node,
    name: "focus",
    payload: {},
    priority: "default",
    bubbles: false,
  });
  for (
    let attempt = 0;
    pendingMeasurements.length < 4 && attempt < 20;
    attempt++
  ) {
    await Promise.resolve();
  }
  assert.equal(pendingMeasurements.length, 4);
  const disposal = app.dispose();
  for (const measurement of pendingMeasurements.slice(2)) {
    measurement.resolve({
      x: 0,
      y: 100,
      width: 400,
      height: 500,
      pageX: 0,
      pageY: 100,
      observedSequence: 1,
    });
  }
  await disposal;
  assert.deepEqual(destinations, []);
});

test("traverses a reactive TextInput focus group through a causal command", async () => {
  let setSecondEditable;
  let setSecondReadOnly;
  const submits = [];
  const records = [];
  let operationSequence = 0;
  const host = createRendererHost("ios");
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `input-focus-${++operationSequence}`,
  });
  const app = mount(
    () => {
      const [secondEditable, setEditable] = createSignal(true);
      const [secondReadOnly, setReadOnly] = createSignal(undefined);
      setSecondEditable = setEditable;
      setSecondReadOnly = setReadOnly;
      return createComponent(TextInputFocusGroup, {
        get children() {
          return [
            createComponent(TextInput, {
              defaultValue: "First",
              onSubmitEditing: () => submits.push("first"),
            }),
            createComponent(TextInput, {
              defaultValue: "Second",
              get editable() {
                return secondEditable();
              },
              get readOnly() {
                return secondReadOnly();
              },
              onSubmitEditing: () => submits.push("second"),
            }),
          ];
        },
      });
    },
    host,
    {
      surface: { name: "text-input-focus-group" },
      autoCommit: false,
      telemetry,
    },
  );

  await app.root.flush();
  let inputs = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.filter(
      (node) => node.kind === "element" && node.component === "TextInput",
    );
  assert.equal(inputs.length, 2);
  assert.equal(inputs[0].props.returnKeyType, "next");
  assert.equal(inputs[1].props.returnKeyType, "done");
  assert.ok(inputs[0].eventListeners.includes("submitEditing"));
  assert.ok(inputs[1].eventListeners.includes("submitEditing"));

  setSecondEditable(false);
  await app.root.flush();
  inputs = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.filter(
      (node) => node.kind === "element" && node.component === "TextInput",
    );
  assert.equal(inputs[0].props.returnKeyType, "done");
  setSecondEditable(true);
  await app.root.flush();
  inputs = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.filter(
      (node) => node.kind === "element" && node.component === "TextInput",
    );
  assert.equal(inputs[0].props.returnKeyType, "next");

  setSecondReadOnly(true);
  await app.root.flush();
  inputs = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.filter(
      (node) => node.kind === "element" && node.component === "TextInput",
    );
  assert.equal(inputs[0].props.returnKeyType, "done");
  assert.equal(inputs[1].props.editable, false);
  setSecondReadOnly(undefined);
  await app.root.flush();
  inputs = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.filter(
      (node) => node.kind === "element" && node.component === "TextInput",
    );
  assert.equal(inputs[0].props.returnKeyType, "next");
  assert.equal(inputs[1].props.editable, true);

  const interactionStart = records.length;
  host.injectEvent({
    surface: app.root.surfaceId,
    target: inputs[0].node,
    name: "submitEditing",
    payload: {},
    priority: "discrete",
    bubbles: false,
  });
  let focusCommand;
  for (let attempt = 0; focusCommand === undefined && attempt < 30; attempt++) {
    await Promise.resolve();
    focusCommand = host.commits
      .flatMap((commit) => commit.mutations)
      .find(
        (mutation) =>
          mutation.type === "command" && mutation.command === "focus",
      );
  }
  assert.deepEqual(submits, ["first"]);
  assert.deepEqual(focusCommand, {
    type: "command",
    node: inputs[1].node,
    command: "focus",
    args: [],
  });

  const interaction = records.slice(interactionStart);
  const submitEvent = interaction.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      record.attributes["event.name"] === "submitEditing",
  );
  const traversal = interaction.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.task" &&
      record.attributes["task.name"] === "input.focus.traversal",
  );
  const command = interaction.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.command" &&
      record.attributes["command.name"] === "focus",
  );
  assert.ok(submitEvent);
  assert.ok(traversal);
  assert.ok(command);
  assert.ok(traversal.causes.includes(submitEvent.operationId));
  assert.ok(command.causes.includes(traversal.operationId));

  host.injectEvent({
    surface: app.root.surfaceId,
    target: inputs[1].node,
    name: "submitEditing",
    payload: {},
    priority: "discrete",
    bubbles: false,
  });
  assert.deepEqual(submits, ["first", "second"]);
  assert.equal(
    host.commits
      .flatMap((commit) => commit.mutations)
      .filter(
        (mutation) =>
          mutation.type === "command" && mutation.command === "focus",
      ).length,
    1,
  );
  await app.dispose();
});

test("keeps nested, multiline, and explicit TextInput focus policies local", async () => {
  const submits = [];
  const host = createRendererHost("android");
  const app = mount(
    () =>
      createComponent(TextInputFocusGroup, {
        get children() {
          return [
            createComponent(TextInput, {
              defaultValue: "Outer multiline",
              multiline: true,
            }),
            createComponent(TextInputFocusGroup, {
              get children() {
                return [
                  createComponent(TextInput, {
                    defaultValue: "Inner source",
                    focusNextOnSubmit: false,
                    returnKeyType: "send",
                    onSubmitEditing: () => submits.push("inner"),
                  }),
                  createComponent(TextInput, {
                    defaultValue: "Inner target",
                  }),
                ];
              },
            }),
            createComponent(TextInput, {
              defaultValue: "Outer target",
            }),
          ];
        },
      }),
    host,
    { surface: { name: "text-input-focus-policy" }, autoCommit: false },
  );

  await app.root.flush();
  const inputs = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.filter(
      (node) => node.kind === "element" && node.component === "TextInput",
    );
  assert.equal(inputs.length, 4);
  const inputsByText = new Map(
    inputs.map((input) => [input.props.text, input]),
  );
  const outerMultiline = inputsByText.get("Outer multiline");
  const innerSource = inputsByText.get("Inner source");
  const innerTarget = inputsByText.get("Inner target");
  const outerTarget = inputsByText.get("Outer target");
  assert.ok(outerMultiline);
  assert.ok(innerSource);
  assert.ok(innerTarget);
  assert.ok(outerTarget);
  assert.equal(outerMultiline.props.submitBehavior, "newline");
  assert.equal(outerMultiline.props.returnKeyType, undefined);
  assert.equal(innerSource.props.returnKeyType, "send");
  assert.equal(innerTarget.props.returnKeyType, "done");
  assert.equal(outerTarget.props.returnKeyType, "done");
  assert.equal(innerSource.props.focusNextOnSubmit, undefined);

  host.injectEvent({
    surface: app.root.surfaceId,
    target: innerSource.node,
    name: "submitEditing",
    payload: {},
    priority: "discrete",
    bubbles: false,
  });
  for (let attempt = 0; attempt < 5; attempt++) await Promise.resolve();
  assert.deepEqual(submits, ["inner"]);
  assert.equal(
    host.commits
      .flatMap((commit) => commit.mutations)
      .some(
        (mutation) =>
          mutation.type === "command" && mutation.command === "focus",
      ),
    false,
  );
  await app.dispose();
});

test("follows current native order when a TextInput mounts before an existing field", async () => {
  let setShowFirst;
  const host = createRendererHost("ios");
  const app = mount(
    () => {
      const [showFirst, setVisible] = createSignal(false);
      setShowFirst = setVisible;
      return createComponent(TextInputFocusGroup, {
        get children() {
          return [
            createComponent(Show, {
              get when() {
                return showFirst();
              },
              get children() {
                return createComponent(TextInput, {
                  defaultValue: "Conditional first",
                });
              },
            }),
            createComponent(TextInput, { defaultValue: "Stable second" }),
          ];
        },
      });
    },
    host,
    { surface: { name: "text-input-focus-order" }, autoCommit: false },
  );

  await app.root.flush();
  let inputs = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.filter(
      (node) => node.kind === "element" && node.component === "TextInput",
    );
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].props.text, "Stable second");
  assert.equal(inputs[0].props.returnKeyType, "done");

  setShowFirst(true);
  await app.root.flush();
  for (let attempt = 0; attempt < 3; attempt++) await Promise.resolve();
  await app.root.flush();
  inputs = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.filter(
      (node) => node.kind === "element" && node.component === "TextInput",
    );
  const inputsByText = new Map(
    inputs.map((input) => [input.props.text, input]),
  );
  const conditionalFirst = inputsByText.get("Conditional first");
  const stableSecond = inputsByText.get("Stable second");
  assert.ok(conditionalFirst);
  assert.ok(stableSecond);
  assert.equal(conditionalFirst.props.returnKeyType, "next");
  assert.equal(stableSecond.props.returnKeyType, "done");

  host.injectEvent({
    surface: app.root.surfaceId,
    target: conditionalFirst.node,
    name: "submitEditing",
    payload: {},
    priority: "discrete",
    bubbles: false,
  });
  let focusCommand;
  for (let attempt = 0; focusCommand === undefined && attempt < 30; attempt++) {
    await Promise.resolve();
    focusCommand = host.commits
      .flatMap((commit) => commit.mutations)
      .find(
        (mutation) =>
          mutation.type === "command" && mutation.command === "focus",
      );
  }
  assert.equal(focusCommand?.node, stableSecond.node);
  await app.dispose();
});

test("reports TextInput focus traversal command failures", async () => {
  const commandFailure = new Error("focus traversal command failed");
  const errors = [];
  const host = createRendererHost("ios");
  const nativeCommit = host.commit.bind(host);
  host.commit = (transaction) =>
    transaction.mutations.some(
      (mutation) => mutation.type === "command" && mutation.command === "focus",
    )
      ? Promise.reject(commandFailure)
      : nativeCommit(transaction);
  const app = mount(
    () =>
      createComponent(TextInputFocusGroup, {
        onTraversalError(error) {
          errors.push(error);
          throw new Error("focus traversal diagnostic failed");
        },
        get children() {
          return [
            createComponent(TextInput, { defaultValue: "First" }),
            createComponent(TextInput, { defaultValue: "Second" }),
          ];
        },
      }),
    host,
    { surface: { name: "text-input-focus-failure" }, autoCommit: false },
  );

  await app.root.flush();
  const inputs = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.filter(
      (node) => node.kind === "element" && node.component === "TextInput",
    );
  host.injectEvent({
    surface: app.root.surfaceId,
    target: inputs[0].node,
    name: "submitEditing",
    payload: {},
    priority: "discrete",
    bubbles: false,
  });
  for (let attempt = 0; errors.length === 0 && attempt < 30; attempt++) {
    await Promise.resolve();
  }
  assert.deepEqual(errors, [commandFailure]);
  await assert.rejects(app.dispose(), (error) => error === commandFailure);
});

test("adds keyboard avoidance through native layout and race-safe measurement", async () => {
  let keyboardListener;
  let keyboard;
  let avoidingViewRef;
  const layoutHeights = [];
  const insets = [];
  const records = [];
  let operationSequence = 0;
  const host = createRendererHost("ios");
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `keyboard-avoidance-${++operationSequence}`,
  });
  const app = mount(
    () => {
      keyboard = createKeyboard({
        dismissKeyboard() {},
        getKeyboardState() {
          return { visible: false };
        },
        subscribeKeyboard(next) {
          keyboardListener = next;
          return {
            remove() {
              keyboardListener = undefined;
            },
          };
        },
      });
      return createComponent(KeyboardAvoidingView, {
        keyboard,
        ref(node) {
          avoidingViewRef = node;
        },
        onLayout(event) {
          layoutHeights.push(event.payload.layout.height);
        },
        onAvoidanceChange: (inset) => insets.push(inset),
        children: createComponent(Text, { children: "Editor" }),
      });
    },
    host,
    {
      surface: { name: "keyboard-avoidance" },
      autoCommit: false,
      telemetry,
    },
  );

  await app.root.flush();
  assert.ok(avoidingViewRef);
  const view = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) =>
        node.kind === "element" &&
        node.component === "View" &&
        node.eventListeners.includes("layout"),
    );
  assert.ok(view);
  assert.deepEqual(view.eventListeners, ["layout"]);
  const spacerHandle = view.children.at(-1);
  assert.ok(spacerHandle);
  host.setMeasurement(app.root.surfaceId, view.node, {
    x: 0,
    y: 100,
    width: 400,
    height: 600,
    pageX: 0,
    pageY: 100,
  });
  host.injectEvent({
    surface: app.root.surfaceId,
    target: view.node,
    name: "layout",
    payload: { layout: { x: 0, y: 100, width: 400, height: 600 } },
  });
  assert.deepEqual(layoutHeights, [600]);

  keyboardListener({
    visible: true,
    metrics: { screenX: 0, screenY: 600, width: 400, height: 300 },
  });
  for (let attempt = 0; insets.length === 0 && attempt < 20; attempt++) {
    await Promise.resolve();
  }
  assert.deepEqual(insets, [100]);
  await app.root.flush();
  let spacer = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.node === spacerHandle,
    );
  assert.ok(spacer);
  assert.deepEqual(spacer.props.style, { flexShrink: 0, height: 100 });

  host.setMeasurement(app.root.surfaceId, view.node, {
    x: 0,
    y: 100,
    width: 400,
    height: 580,
    pageX: 0,
    pageY: 100,
  });
  const layoutTelemetryStart = records.length;
  host.injectEvent({
    surface: app.root.surfaceId,
    target: view.node,
    name: "layout",
    payload: { layout: { x: 0, y: 100, width: 400, height: 580 } },
  });
  assert.deepEqual(layoutHeights, [600, 580]);
  for (let attempt = 0; insets.length < 2 && attempt < 20; attempt++) {
    await Promise.resolve();
  }
  assert.deepEqual(insets, [100, 80]);
  await app.root.flush();
  spacer = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.node === spacerHandle,
    );
  assert.ok(spacer);
  assert.deepEqual(spacer.props.style, { flexShrink: 0, height: 80 });
  const layoutRecords = records.slice(layoutTelemetryStart);
  const layoutEvent = layoutRecords.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      record.attributes["event.name"] === "layout",
  );
  const measurement = layoutRecords.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.measure",
  );
  const settlement = layoutRecords.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.task" &&
      record.attributes["task.name"] === "keyboard.avoidance.measurement",
  );
  const insetCommit = layoutRecords.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      record.attributes["commit.mutation.update-props"] === 1,
  );
  assert.ok(layoutEvent);
  assert.ok(settlement);
  assert.ok(measurement);
  assert.ok(insetCommit);
  assert.ok(settlement.causes.includes(layoutEvent.operationId));
  assert.ok(measurement.causes.includes(settlement.operationId));
  assert.ok(insetCommit.causes.includes(settlement.operationId));

  keyboardListener({ visible: false });
  assert.deepEqual(insets, [100, 80, 0]);
  await app.root.flush();
  spacer = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.node === spacerHandle,
    );
  assert.ok(spacer);
  assert.deepEqual(spacer.props.style, { flexShrink: 0, height: 0 });
  await app.dispose();
  assert.equal(keyboardListener, undefined);
});

test("ignores keyboard measurements superseded by hide and disposal", async () => {
  let keyboardListener;
  let keyboard;
  const insets = [];
  const host = createRendererHost("android");
  const nativeMeasure = host.measure.bind(host);
  let measurement;
  let measurementStarted = 0;
  host.measure = (...args) => {
    nativeMeasure(...args);
    measurementStarted++;
    measurement = deferred();
    return measurement.promise;
  };
  const app = mount(
    () => {
      keyboard = createKeyboard({
        dismissKeyboard() {},
        getKeyboardState() {
          return { visible: false };
        },
        subscribeKeyboard(next) {
          keyboardListener = next;
          return { remove() {} };
        },
      });
      return createComponent(KeyboardAvoidingView, {
        keyboard,
        onAvoidanceChange: (inset) => insets.push(inset),
        children: createComponent(Text, { children: "Editor" }),
      });
    },
    host,
    { surface: { name: "keyboard-avoidance-race" }, autoCommit: false },
  );

  await app.root.flush();
  const view = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) =>
        node.kind === "element" && node.eventListeners.includes("layout"),
    );
  assert.ok(view);
  host.injectEvent({
    surface: app.root.surfaceId,
    target: view.node,
    name: "layout",
    payload: { layout: { x: 0, y: 0, width: 400, height: 700 } },
  });
  keyboardListener({
    visible: true,
    metrics: { screenX: 0, screenY: 600, width: 400, height: 300 },
  });
  for (let attempt = 0; measurementStarted === 0 && attempt < 20; attempt++) {
    await Promise.resolve();
  }
  assert.equal(measurementStarted, 1);
  keyboardListener({ visible: false });
  measurement.resolve({
    x: 0,
    y: 0,
    width: 400,
    height: 700,
    pageX: 0,
    pageY: 0,
    observedSequence: 1,
  });
  for (let attempt = 0; attempt < 10; attempt++) await Promise.resolve();
  assert.deepEqual(insets, []);
  assert.equal(await app.root.flush(), undefined);

  keyboardListener({
    visible: true,
    metrics: { screenX: 0, screenY: 600, width: 400, height: 300 },
  });
  for (let attempt = 0; measurementStarted < 2 && attempt < 20; attempt++) {
    await Promise.resolve();
  }
  assert.equal(measurementStarted, 2);
  const pendingMeasurement = measurement;
  const disposal = app.dispose();
  pendingMeasurement.resolve({
    x: 0,
    y: 0,
    width: 400,
    height: 700,
    pageX: 0,
    pageY: 0,
    observedSequence: 1,
  });
  await disposal;
  assert.deepEqual(insets, []);
});

test("adapts a generated native event emitter into Solid ownership", async () => {
  let listener;
  let removals = 0;
  let decodeCalls = 0;
  let latestEvent;
  const errors = [];
  const records = [];
  let operationSequence = 0;
  const host = createRendererHost();
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `native-module-event-${++operationSequence}`,
  });
  const app = mount(
    () => {
      latestEvent = createNativeEventAccessor(
        (next) => {
          listener = next;
          return {
            remove() {
              listener = undefined;
              removals++;
              throw new Error("native remove failed");
            },
          };
        },
        {
          name: "platform.fixture.changed",
          priority: "discrete",
          initialValue: { value: "initial" },
          decode(nativeEvent) {
            decodeCalls++;
            if (
              typeof nativeEvent !== "object" ||
              nativeEvent === null ||
              !("value" in nativeEvent) ||
              typeof nativeEvent.value !== "string"
            ) {
              throw new TypeError("fixture event value must be a string");
            }
            return Object.freeze({ value: nativeEvent.value });
          },
          onError: (error) => errors.push(error),
        },
      );
      return createComponent(Text, {
        get children() {
          return latestEvent()?.value ?? "none";
        },
      });
    },
    host,
    {
      surface: { name: "generated-native-event" },
      autoCommit: false,
      telemetry,
    },
  );

  await app.root.flush();
  assert.deepEqual(latestEvent(), { value: "initial" });
  const retainedListener = listener;
  retainedListener({ value: "validated-native-value" });
  await app.root.flush();
  assert.deepEqual(latestEvent(), { value: "validated-native-value" });
  const eventStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      record.attributes["event.name"] === "platform.fixture.changed",
  );
  assert.ok(eventStarted);
  assert.equal(eventStarted.attributes["event.priority"], "discrete");
  assert.equal(
    JSON.stringify(eventStarted).includes("validated-native-value"),
    false,
  );

  retainedListener({ value: 1 });
  assert.deepEqual(latestEvent(), { value: "validated-native-value" });
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /must be a string/u);

  await app.dispose();
  assert.equal(removals, 1);
  assert.equal(listener, undefined);
  assert.equal(errors.length, 2);
  assert.match(errors[1].message, /native remove failed/u);
  retainedListener({ value: "late" });
  assert.equal(decodeCalls, 2);
});

test("routes owner-bound notification kinds through private platform events", async () => {
  const listeners = new Set();
  const adapter = {
    async getPermission() {
      return { authorization: "authorized" };
    },
    async requestPermission() {
      return { authorization: "authorized" };
    },
    async display(notification) {
      return notification.id;
    },
    async getDisplayedNotificationIds() {
      return [];
    },
    async cancel() {},
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(event) {
      for (const listener of listeners) listener(event);
    },
  };
  const service = createNotificationService(adapter);
  const host = createRendererHost();
  const records = [];
  const errors = [];
  let operationSequence = 0;
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `notification-event-${++operationSequence}`,
  });
  let setService;
  let latestEvent;
  const app = mount(
    () => {
      const [currentService, setCurrentService] = createSignal();
      setService = setCurrentService;
      latestEvent = createNotificationEvent(currentService, {
        onError: (error) => errors.push(error),
      });
      return createComponent(CausalOwner, {
        name: "notification.screen",
        get children() {
          return createComponent(CausalComputation, {
            name: "platform.notification.output",
            get children() {
              return createComponent(Text, {
                get children() {
                  return latestEvent()?.kind ?? "none";
                },
              });
            },
          });
        },
      });
    },
    host,
    {
      surface: { name: "notification-events" },
      autoCommit: false,
      telemetry,
    },
  );

  await app.root.flush();
  assert.equal(listeners.size, 0);
  setService(service);
  await Promise.resolve();
  assert.equal(listeners.size, 1);

  const expectations = [
    {
      event: { kind: "delivered", notificationId: "private-delivery-id" },
      name: "platform.notification.delivered",
      priority: "default",
      commitPriority: "normal",
    },
    {
      event: { kind: "pressed", notificationId: "private-press-id" },
      name: "platform.notification.pressed",
      priority: "discrete",
      commitPriority: "user-blocking",
    },
    {
      event: {
        kind: "action-pressed",
        notificationId: "private-action-notification-id",
        actionId: "private-action-id",
      },
      name: "platform.notification.action-pressed",
      priority: "discrete",
      commitPriority: "user-blocking",
    },
    {
      event: { kind: "dismissed", notificationId: "private-dismiss-id" },
      name: "platform.notification.dismissed",
      priority: "default",
      commitPriority: "normal",
    },
    {
      event: { kind: "unknown", notificationId: "private-unknown-id" },
      name: "platform.notification.unknown",
      priority: "default",
      commitPriority: "normal",
    },
  ];
  const surfaceStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.surface",
  );
  const ownerStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.owner" &&
      record.attributes["owner.name"] === "notification.screen",
  );
  assert.ok(surfaceStarted);
  assert.ok(ownerStarted);

  for (const [index, expectation] of expectations.entries()) {
    adapter.emit(expectation.event);
    assert.deepEqual(latestEvent(), expectation.event);
    const update = await app.root.flush();
    assert.equal(update.sequence, index + 2);
    const commitStarted = records.find(
      (record) =>
        record.type === "operation-started" &&
        record.name === "solid-native.commit" &&
        record.attributes["commit.sequence"] === index + 2,
    );
    const eventStarted = records.find(
      (record) =>
        record.type === "operation-started" &&
        record.name === "solid-native.event" &&
        record.attributes["event.name"] === expectation.name &&
        commitStarted?.type === "operation-started" &&
        commitStarted.causes.includes(record.operationId),
    );
    const eventFinished = records.find(
      (record) =>
        record.type === "operation-finished" &&
        record.operationId === eventStarted?.operationId,
    );
    const computationStarted = records.find(
      (record) =>
        record.type === "operation-started" &&
        record.name === "solid-native.computation" &&
        record.attributes["computation.name"] ===
          "platform.notification.output" &&
        commitStarted?.type === "operation-started" &&
        commitStarted.causes.includes(record.operationId),
    );
    assert.ok(commitStarted);
    assert.ok(eventStarted);
    assert.ok(eventFinished);
    assert.ok(computationStarted);
    assert.deepEqual(eventStarted.causes, [surfaceStarted.operationId]);
    assert.equal(eventStarted.attributes["event.source"], "platform");
    assert.equal(
      eventStarted.attributes["event.priority"],
      expectation.priority,
    );
    assert.equal(eventFinished.status, "ok");
    assert.deepEqual(
      new Set(commitStarted.causes),
      new Set([
        eventStarted.operationId,
        ownerStarted.operationId,
        computationStarted.operationId,
      ]),
    );
    assert.equal(
      commitStarted.attributes["commit.priority"],
      expectation.commitPriority,
    );
  }

  assert.deepEqual(errors, []);
  for (const expectation of expectations) {
    for (const value of Object.values(expectation.event)) {
      if (value === expectation.event.kind) continue;
      assert.equal(JSON.stringify(records).includes(value), false);
    }
  }

  const replacementListeners = new Set();
  const replacementAdapter = {
    ...adapter,
    subscribe(listener) {
      replacementListeners.add(listener);
      return () => replacementListeners.delete(listener);
    },
    emit(event) {
      for (const listener of replacementListeners) listener(event);
    },
  };
  const replacementService = createNotificationService(replacementAdapter);
  setService(replacementService);
  await Promise.resolve();
  assert.equal(listeners.size, 0);
  assert.equal(replacementListeners.size, 1);
  adapter.emit({ kind: "pressed", notificationId: "detached-private-id" });
  assert.equal(latestEvent()?.kind, "unknown");
  replacementAdapter.emit({
    kind: "delivered",
    notificationId: "replacement-private-id",
  });
  assert.equal(latestEvent()?.notificationId, "replacement-private-id");
  await app.root.flush();
  setService(undefined);
  await Promise.resolve();
  assert.equal(replacementListeners.size, 0);

  await app.dispose();
  assert.equal(listeners.size, 0);
});

test("isolates notification accessor subscription handoff failures", async () => {
  const removalFailure = new Error("notification removal failed");
  const subscriptionFailure = new Error("notification subscribe failed");
  const errors = [];
  let removeCalls = 0;
  const removalService = createNotificationService({
    async getPermission() {
      return { authorization: "authorized" };
    },
    async requestPermission() {
      return { authorization: "authorized" };
    },
    async display(notification) {
      return notification.id;
    },
    async getDisplayedNotificationIds() {
      return [];
    },
    async cancel() {},
    subscribe() {
      return () => {
        removeCalls++;
        throw removalFailure;
      };
    },
  });
  const failingService = createNotificationService({
    async getPermission() {
      return { authorization: "authorized" };
    },
    async requestPermission() {
      return { authorization: "authorized" };
    },
    async display(notification) {
      return notification.id;
    },
    async getDisplayedNotificationIds() {
      return [];
    },
    async cancel() {},
    subscribe() {
      throw subscriptionFailure;
    },
  });
  let setService;
  const app = mount(
    () => {
      const [service, setCurrentService] = createSignal();
      setService = setCurrentService;
      createNotificationEvent(service, {
        async onError(error) {
          errors.push(error);
          throw new Error("diagnostic failed");
        },
      });
      return createComponent(Text, { children: "notification handoff" });
    },
    createRendererHost(),
    { surface: { name: "notification-handoff" }, autoCommit: false },
  );

  await app.root.flush();
  setService(removalService);
  await Promise.resolve();
  setService(failingService);
  await Promise.resolve();
  assert.equal(removeCalls, 1);
  assert.deepEqual(errors, [removalFailure, subscriptionFailure]);

  setService(removalService);
  await Promise.resolve();
  await app.dispose();
  assert.equal(removeCalls, 2);
  assert.deepEqual(errors, [
    removalFailure,
    subscriptionFailure,
    removalFailure,
  ]);
});

test("owns fine-grained accessibility preferences and their private causal input", async () => {
  const initialPreferences = deferred();
  let preferencesQuery = initialPreferences;
  let preferenceQueries = 0;
  let nativeListener;
  let removals = 0;
  let appStateListener;
  let appStateRemovals = 0;
  const accessibilityErrors = [];
  let announcement;
  const service = {
    platform: "android",
    getPreferences() {
      preferenceQueries++;
      return preferencesQuery.promise;
    },
    subscribe(listener) {
      nativeListener = listener;
      return {
        remove() {
          removals++;
        },
      };
    },
    announce(request) {
      announcement = request;
    },
    async getRecommendedTimeoutMillis(originalTimeout) {
      return originalTimeout + 500;
    },
  };
  const appState = {
    initialAppState: "active",
    subscribeAppState(listener) {
      appStateListener = listener;
      return {
        remove() {
          appStateRemovals++;
        },
      };
    },
  };
  assert.throws(
    () => createAccessibilityPreferences(service),
    /requires an active Solid owner/u,
  );

  const host = createRendererHost();
  const records = [];
  let operationSequence = 0;
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `accessibility-${++operationSequence}`,
  });
  let preferences;
  const app = mount(
    () => {
      preferences = createAccessibilityPreferences(service, {
        appState,
        onError: (error) => accessibilityErrors.push(error),
      });
      return createComponent(Text, {
        get children() {
          return `${preferences.status()}:${
            preferences.reduceMotionEnabled() ? "reduced" : "full"
          }`;
        },
      });
    },
    host,
    {
      surface: { name: "accessibility-preferences" },
      autoCommit: false,
      telemetry,
    },
  );

  await app.root.flush();
  assert.equal(preferences.status(), "loading");
  nativeListener({ preference: "reduceMotionEnabled", enabled: true });
  initialPreferences.resolve({
    platform: "android",
    screenReaderEnabled: false,
    reduceMotionEnabled: false,
    invertColorsEnabled: false,
    grayscaleEnabled: false,
    highTextContrastEnabled: false,
    accessibilityServiceEnabled: false,
  });
  await preferences.ready;
  const readyCommit = await app.root.flush();
  assert.equal(readyCommit.sequence, 2);
  assert.equal(preferences.status(), "ready");
  assert.equal(preferences.reduceMotionEnabled(), true);
  assert.equal(preferences.screenReaderEnabled(), false);

  nativeListener({ preference: "reduceMotionEnabled", enabled: false });
  const preferenceCommit = await app.root.flush();
  assert.equal(preferenceCommit.sequence, 3);
  assert.equal(preferences.reduceMotionEnabled(), false);
  const commitOperation = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      record.attributes["commit.sequence"] === preferenceCommit.sequence,
  );
  assert.ok(commitOperation);
  const preferenceEvent = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      record.attributes["event.name"] === "platform.accessibility.preference" &&
      commitOperation.causes.includes(record.operationId),
  );
  assert.ok(preferenceEvent);
  assert.equal(JSON.stringify(records).includes("reduceMotionEnabled"), false);

  const racingRefresh = deferred();
  preferencesQuery = racingRefresh;
  const racingRefreshPromise = preferences.refresh();
  nativeListener({ preference: "reduceMotionEnabled", enabled: true });
  racingRefresh.resolve({
    platform: "android",
    screenReaderEnabled: false,
    reduceMotionEnabled: false,
    invertColorsEnabled: false,
    grayscaleEnabled: false,
    highTextContrastEnabled: false,
    accessibilityServiceEnabled: false,
  });
  await racingRefreshPromise;
  await app.root.flush();
  assert.equal(preferences.reduceMotionEnabled(), true);

  const authoritativeRefresh = deferred();
  preferencesQuery = authoritativeRefresh;
  const authoritativeRefreshPromise = preferences.refresh();
  authoritativeRefresh.resolve({
    platform: "android",
    screenReaderEnabled: false,
    reduceMotionEnabled: false,
    invertColorsEnabled: false,
    grayscaleEnabled: false,
    highTextContrastEnabled: true,
    accessibilityServiceEnabled: true,
  });
  await authoritativeRefreshPromise;
  await app.root.flush();
  assert.equal(preferences.reduceMotionEnabled(), false);
  assert.equal(preferences.highTextContrastEnabled(), true);

  preferencesQuery = {
    promise: Promise.resolve({
      platform: "android",
      screenReaderEnabled: true,
      reduceMotionEnabled: true,
      invertColorsEnabled: false,
      grayscaleEnabled: false,
      highTextContrastEnabled: false,
      accessibilityServiceEnabled: true,
    }),
  };
  const queryCountBeforeResume = preferenceQueries;
  appStateListener("background");
  appStateListener("active");
  appStateListener("active");
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await app.root.flush();
  assert.equal(preferenceQueries, queryCountBeforeResume + 1);
  assert.equal(preferences.screenReaderEnabled(), true);
  assert.equal(preferences.reduceMotionEnabled(), true);
  assert.equal(preferences.highTextContrastEnabled(), false);
  appStateListener("foreground");
  await app.root.flush();
  assert.equal(accessibilityErrors.length, 1);
  assert.match(String(preferences.error()), /unsupported state/u);

  const olderRefresh = deferred();
  preferencesQuery = olderRefresh;
  const olderRefreshPromise = preferences.refresh();
  const newerRefresh = deferred();
  preferencesQuery = newerRefresh;
  const newerRefreshPromise = preferences.refresh();
  newerRefresh.resolve({
    platform: "android",
    screenReaderEnabled: true,
    reduceMotionEnabled: true,
    invertColorsEnabled: false,
    grayscaleEnabled: false,
    highTextContrastEnabled: false,
    accessibilityServiceEnabled: true,
  });
  await newerRefreshPromise;
  olderRefresh.resolve({
    platform: "android",
    screenReaderEnabled: false,
    reduceMotionEnabled: false,
    invertColorsEnabled: true,
    grayscaleEnabled: true,
    highTextContrastEnabled: true,
    accessibilityServiceEnabled: false,
  });
  await olderRefreshPromise;
  await app.root.flush();
  assert.equal(preferences.screenReaderEnabled(), true);
  assert.equal(preferences.reduceMotionEnabled(), true);
  assert.equal(preferences.highTextContrastEnabled(), false);

  preferences.announce("Private accessibility announcement");
  assert.equal(announcement, "Private accessibility announcement");
  assert.equal(await preferences.getRecommendedTimeoutMillis(1_000), 1_500);
  await app.dispose();
  assert.equal(removals, 1);
  assert.equal(appStateRemovals, 1);
  nativeListener({ preference: "reduceMotionEnabled", enabled: false });
  assert.equal(preferences.reduceMotionEnabled(), true);
});

test("owns alert settlements and preserves their private causal chain", async () => {
  const presentations = [];
  const service = {
    platform: "android",
    show(request) {
      const result = deferred();
      presentations.push({ request, result });
      return result.promise;
    },
  };
  assert.throws(
    () => createAlertController(service),
    /requires an active Solid owner/u,
  );
  const host = createRendererHost();
  const records = [];
  let operationSequence = 0;
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `alert-event-${++operationSequence}`,
  });
  let alerts;
  let setLabel;
  const app = mount(
    () => {
      const [label, updateLabel] = createSignal("Ready");
      setLabel = updateLabel;
      alerts = createAlertController(service);
      return createComponent(CausalOwner, {
        name: "alert.screen",
        get children() {
          return createComponent(CausalComputation, {
            name: "platform.alert.output",
            get children() {
              return createComponent(Text, { children: label });
            },
          });
        },
      });
    },
    host,
    {
      surface: { name: "alert-settlements" },
      autoCommit: false,
      telemetry,
    },
  );

  await app.root.flush();
  const buttonPromise = alerts
    .show({
      title: "Private alert title",
      buttons: [{ id: "private-confirm-id", text: "Private confirm text" }],
    })
    .then((result) => {
      setLabel(result.action === "button" ? "Confirmed" : "Dismissed");
      return result;
    });
  assert.equal(presentations.length, 1);
  presentations[0].result.resolve({
    action: "button",
    buttonId: "private-confirm-id",
  });
  assert.deepEqual(await buttonPromise, {
    action: "button",
    buttonId: "private-confirm-id",
  });
  await Promise.resolve();
  const buttonCommit = await app.root.flush();
  assert.equal(buttonCommit.sequence, 2);

  const buttonEvent = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      record.attributes["event.name"] === "platform.alert.button",
  );
  const buttonCommitOperation = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      record.attributes["commit.sequence"] === 2,
  );
  assert.ok(buttonEvent);
  assert.ok(buttonCommitOperation);
  assert.equal(buttonEvent.attributes["event.priority"], "discrete");
  assert.equal(
    buttonCommitOperation.attributes["commit.priority"],
    "user-blocking",
  );
  assert.ok(buttonCommitOperation.causes.includes(buttonEvent.operationId));

  const dismissedPromise = alerts
    .show({ message: "Private dismissal" })
    .then((result) => {
      setLabel(result.action === "dismissed" ? "Dismissed" : "Confirmed");
      return result;
    });
  presentations[1].result.resolve({ action: "dismissed" });
  assert.deepEqual(await dismissedPromise, { action: "dismissed" });
  await Promise.resolve();
  const dismissedCommit = await app.root.flush();
  assert.equal(dismissedCommit.sequence, 3);
  const dismissedEvent = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      record.attributes["event.name"] === "platform.alert.dismissed",
  );
  const dismissedCommitOperation = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      record.attributes["commit.sequence"] === 3,
  );
  assert.ok(dismissedEvent);
  assert.ok(dismissedCommitOperation);
  assert.ok(
    dismissedCommitOperation.causes.includes(dismissedEvent.operationId),
  );
  assert.equal(JSON.stringify(records).includes("Private alert title"), false);
  assert.equal(JSON.stringify(records).includes("private-confirm-id"), false);

  const disposedPromise = alerts
    .show({ title: "Private pending alert" })
    .catch((error) => error);
  assert.equal(presentations.length, 3);
  await app.dispose();
  const disposedError = await disposedPromise;
  assert.ok(disposedError instanceof AlertOwnerDisposedError);
  presentations[2].result.resolve({ action: "button", buttonId: "ok" });
  await Promise.resolve();
  await assert.rejects(
    alerts.show({ title: "After disposal" }),
    AlertOwnerDisposedError,
  );
});

test("owns truthful share settlements and preserves private causal data", async () => {
  const presentations = [];
  const service = {
    platform: "ios",
    share(request) {
      const result = deferred();
      presentations.push({ request, result });
      return result.promise;
    },
  };
  assert.throws(
    () => createShareController(service),
    /requires an active Solid owner/u,
  );
  const records = [];
  let operationSequence = 0;
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `share-event-${++operationSequence}`,
  });
  let sharing;
  let setLabel;
  const app = mount(
    () => {
      const [label, updateLabel] = createSignal("Ready");
      setLabel = updateLabel;
      sharing = createShareController(service);
      return createComponent(CausalOwner, {
        name: "share.screen",
        get children() {
          return createComponent(CausalComputation, {
            name: "platform.share.output",
            get children() {
              return createComponent(Text, { children: label });
            },
          });
        },
      });
    },
    createRendererHost("ios"),
    {
      surface: { name: "share-settlements" },
      autoCommit: false,
      telemetry,
    },
  );

  await app.root.flush();
  const completedPromise = sharing
    .share({
      message: "Private share message",
      url: "https://private.example/customer/42",
      subject: "Private share subject",
    })
    .then((result) => {
      setLabel(result.action === "completed" ? "Completed" : "Other");
      return result;
    });
  presentations[0].result.resolve({
    action: "completed",
    activityType: "private.activity.identifier",
  });
  assert.deepEqual(await completedPromise, {
    action: "completed",
    activityType: "private.activity.identifier",
  });
  await Promise.resolve();
  const completedCommit = await app.root.flush();
  assert.equal(completedCommit.sequence, 2);
  const completedEvent = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      record.attributes["event.name"] === "platform.share.completed",
  );
  const completedCommitOperation = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      record.attributes["commit.sequence"] === 2,
  );
  assert.ok(completedEvent);
  assert.ok(completedCommitOperation);
  assert.equal(completedEvent.attributes["event.priority"], "discrete");
  assert.equal(
    completedCommitOperation.attributes["commit.priority"],
    "user-blocking",
  );
  assert.ok(
    completedCommitOperation.causes.includes(completedEvent.operationId),
  );

  const dismissedPromise = sharing
    .share({ message: "Private dismissal message" })
    .then((result) => {
      setLabel(result.action === "dismissed" ? "Dismissed" : "Other");
      return result;
    });
  presentations[1].result.resolve({ action: "dismissed" });
  assert.deepEqual(await dismissedPromise, { action: "dismissed" });
  await Promise.resolve();
  const dismissedCommit = await app.root.flush();
  assert.equal(dismissedCommit.sequence, 3);
  const dismissedEvent = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      record.attributes["event.name"] === "platform.share.dismissed",
  );
  const dismissedCommitOperation = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      record.attributes["commit.sequence"] === 3,
  );
  assert.ok(dismissedEvent);
  assert.ok(dismissedCommitOperation);
  assert.ok(
    dismissedCommitOperation.causes.includes(dismissedEvent.operationId),
  );
  const serializedTelemetry = JSON.stringify(records);
  assert.equal(serializedTelemetry.includes("Private share message"), false);
  assert.equal(serializedTelemetry.includes("private.example"), false);
  assert.equal(serializedTelemetry.includes("Private share subject"), false);
  assert.equal(
    serializedTelemetry.includes("private.activity.identifier"),
    false,
  );

  const disposedPromise = sharing
    .share({ message: "Private pending share" })
    .catch((error) => error);
  await app.dispose();
  const disposedError = await disposedPromise;
  assert.ok(disposedError instanceof ShareOwnerDisposedError);
  presentations[2].result.resolve({ action: "completed" });
  await Promise.resolve();
  await assert.rejects(
    sharing.share({ message: "After disposal" }),
    ShareOwnerDisposedError,
  );
});

test("owns revocable vibration leases without cancelling newer owners", async () => {
  const started = [];
  let cancellations = 0;
  const service = createVibrationService({
    platform: "android",
    startVibration(request) {
      started.push(request);
    },
    cancelVibration() {
      cancellations++;
    },
  });
  assert.throws(
    () => createVibrationController(service),
    /requires an active Solid owner/u,
  );

  let firstController;
  const first = mount(
    () => {
      firstController = createVibrationController(service);
      return createComponent(Text, { children: "First vibration owner" });
    },
    createRendererHost(),
    { surface: { name: "first-vibration-owner" }, autoCommit: false },
  );
  let secondController;
  const second = mount(
    () => {
      secondController = createVibrationController(service);
      return createComponent(Text, { children: "Second vibration owner" });
    },
    createRendererHost(),
    { surface: { name: "second-vibration-owner" }, autoCommit: false },
  );
  await first.root.flush();
  await second.root.flush();

  const firstHandle = firstController.vibrate({
    pattern: [{ delayMs: 0, durationMs: 50 }],
    repeat: true,
  });
  const secondHandle = secondController.vibrate({ durationMs: 80 });
  assert.deepEqual(started, [
    {
      kind: "pattern",
      pattern: [{ delayMs: 0, durationMs: 50 }],
      repeat: true,
    },
    { kind: "pulse", durationMs: 80 },
  ]);
  assert.equal(cancellations, 1);

  firstHandle.cancel();
  await first.dispose();
  assert.equal(cancellations, 1);
  secondHandle.cancel();
  secondHandle.cancel();
  assert.equal(cancellations, 2);
  await second.dispose();
  assert.equal(cancellations, 2);
  assert.throws(() => secondController.vibrate(), VibrationOwnerDisposedError);
});

test("owns privacy-safe clipboard reads through their Solid commit", async () => {
  const reads = [];
  const writes = [];
  const service = createClipboardService({
    readText() {
      const result = deferred();
      reads.push(result);
      return result.promise;
    },
    writeText(text) {
      writes.push(text);
    },
  });
  assert.throws(
    () => createClipboardController(service),
    /requires an active Solid owner/u,
  );

  const records = [];
  let operationSequence = 0;
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `clipboard-operation-${++operationSequence}`,
  });
  let clipboard;
  let setLabel;
  const app = mount(
    () => {
      clipboard = createClipboardController(service);
      const [label, updateLabel] = createSignal("Clipboard idle");
      setLabel = updateLabel;
      return createComponent(Text, {
        get children() {
          return label();
        },
      });
    },
    createRendererHost(),
    {
      surface: { name: "clipboard-read" },
      autoCommit: false,
      telemetry,
    },
  );
  await app.root.flush();

  clipboard.writeText("Private clipboard write");
  clipboard.clear();
  assert.deepEqual(writes, ["Private clipboard write", ""]);
  const read = clipboard.readText().then((text) => {
    setLabel(text === "Private clipboard result" ? "Read" : "Unexpected");
    return text;
  });
  reads[0].resolve("Private clipboard result");
  assert.equal(await read, "Private clipboard result");
  await Promise.resolve();
  const commit = await app.root.flush();
  assert.equal(commit.sequence, 2);
  const readEvent = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      record.attributes["event.name"] === "platform.clipboard.read",
  );
  const commitOperation = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      record.attributes["commit.sequence"] === 2,
  );
  assert.ok(readEvent);
  assert.ok(commitOperation);
  assert.equal(readEvent.attributes["event.priority"], "default");
  assert.equal(commitOperation.attributes["commit.priority"], "normal");
  assert.ok(commitOperation.causes.includes(readEvent.operationId));
  const serializedTelemetry = JSON.stringify(records);
  assert.equal(serializedTelemetry.includes("Private clipboard write"), false);
  assert.equal(serializedTelemetry.includes("Private clipboard result"), false);

  const disposedRead = clipboard.readText().catch((error) => error);
  await app.dispose();
  assert.ok((await disposedRead) instanceof ClipboardOwnerDisposedError);
  reads[1].resolve("Late private clipboard result");
  await Promise.resolve();
  await assert.rejects(clipboard.readText(), ClipboardOwnerDisposedError);
  assert.throws(
    () => clipboard.writeText("After disposal"),
    ClipboardOwnerDisposedError,
  );
  assert.throws(() => clipboard.clear(), ClipboardOwnerDisposedError);
});

test("owns private secure-storage settlements through their Solid commits", async () => {
  const operations = [];
  const storage = createSecureStorage({
    getItem(key) {
      const result = deferred();
      operations.push({ kind: "read", key, result });
      return result.promise;
    },
    setItem(key, value) {
      const result = deferred();
      operations.push({ kind: "write", key, value, result });
      return result.promise;
    },
    removeItem(key) {
      const result = deferred();
      operations.push({ kind: "remove", key, result });
      return result.promise;
    },
  });
  assert.throws(
    () => createSecureStorageController(storage),
    /requires an active Solid owner/u,
  );

  const records = [];
  let operationSequence = 0;
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `secure-storage-operation-${++operationSequence}`,
  });
  let secureStorage;
  let setLabel;
  const app = mount(
    () => {
      secureStorage = createSecureStorageController(storage);
      const [label, updateLabel] = createSignal("Session idle");
      setLabel = updateLabel;
      return createComponent(Text, {
        get children() {
          return label();
        },
      });
    },
    createRendererHost(),
    {
      surface: { name: "secure-storage" },
      autoCommit: false,
      telemetry,
    },
  );
  await app.root.flush();

  const write = secureStorage.setItem("private-session-key", "private-token");
  await Promise.resolve();
  operations[0].result.resolve();
  await write;
  const read = secureStorage.getItem("private-session-key").then((value) => {
    setLabel(value === "private-token" ? "Session restored" : "Unexpected");
    return value;
  });
  await Promise.resolve();
  operations[1].result.resolve("private-token");
  assert.equal(await read, "private-token");
  await Promise.resolve();
  const commit = await app.root.flush();
  assert.equal(commit.sequence, 2);

  const readEvent = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      record.attributes["event.name"] === "platform.secure-storage.read",
  );
  const commitOperation = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      record.attributes["commit.sequence"] === 2,
  );
  assert.ok(readEvent);
  assert.ok(commitOperation);
  assert.equal(readEvent.attributes["event.priority"], "default");
  assert.equal(commitOperation.attributes["commit.priority"], "normal");
  assert.ok(commitOperation.causes.includes(readEvent.operationId));
  const eventNames = records
    .filter(
      (record) =>
        record.type === "operation-started" &&
        record.name === "solid-native.event",
    )
    .map((record) => record.attributes["event.name"]);
  assert.deepEqual(eventNames, [
    "platform.secure-storage.write",
    "platform.secure-storage.read",
  ]);
  const serializedTelemetry = JSON.stringify(records);
  assert.equal(serializedTelemetry.includes("private-session-key"), false);
  assert.equal(serializedTelemetry.includes("private-token"), false);

  const remove = secureStorage.removeItem("private-session-key");
  await Promise.resolve();
  await app.dispose();
  assert.ok(
    (await remove.catch((error) => error)) instanceof
      SecureStorageOwnerDisposedError,
  );
  operations[2].result.resolve();
  await Promise.resolve();
  await assert.rejects(
    secureStorage.getItem("private-session-key"),
    SecureStorageOwnerDisposedError,
  );
  await assert.rejects(
    secureStorage.setItem("private-session-key", "after-disposal"),
    SecureStorageOwnerDisposedError,
  );
  await assert.rejects(
    secureStorage.removeItem("private-session-key"),
    SecureStorageOwnerDisposedError,
  );
});

test("owns private image work through its exact Solid commits", async () => {
  const dimensionRequests = [];
  const prefetchRequests = [];
  const cacheRequests = [];
  const cancellations = [];
  const dimensions = [];
  const prefetches = [];
  const cacheQueries = [];
  const service = createImageService({
    platform: "android",
    getDimensions(request) {
      dimensionRequests.push(request);
      const result = deferred();
      dimensions.push(result);
      return result.promise;
    },
    prefetchImage(uri, requestId) {
      prefetchRequests.push({ uri, requestId });
      const result = deferred();
      prefetches.push(result);
      return result.promise;
    },
    cancelPrefetch(requestId) {
      cancellations.push(requestId);
    },
    queryCache(uris) {
      cacheRequests.push(uris);
      const result = deferred();
      cacheQueries.push(result);
      return result.promise;
    },
  });
  assert.throws(
    () => createImageController(service),
    /requires an active Solid owner/u,
  );

  const records = [];
  let operationSequence = 0;
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `image-operation-${++operationSequence}`,
  });
  let images;
  let setLabel;
  const app = mount(
    () => {
      images = createImageController(service);
      const [label, updateLabel] = createSignal("Images idle");
      setLabel = updateLabel;
      return createComponent(Text, {
        get children() {
          return label();
        },
      });
    },
    createRendererHost(),
    {
      surface: { name: "image-work" },
      autoCommit: false,
      telemetry,
    },
  );
  await app.root.flush();

  const dimensionURI = "https://private.example/customer/42/avatar.png";
  const dimensionPromise = images
    .getDimensions({
      uri: dimensionURI,
      headers: { Authorization: "Bearer private-image-token" },
    })
    .then((result) => {
      setLabel(`Dimensions ${result.width}x${result.height}`);
      return result;
    });
  assert.equal(dimensionRequests.length, 1);
  dimensions[0].resolve({ width: 320, height: 180 });
  assert.deepEqual(await dimensionPromise, { width: 320, height: 180 });
  await Promise.resolve();
  const dimensionCommit = await app.root.flush();
  assert.equal(dimensionCommit.sequence, 2);

  const prefetchURI = "https://private.example/customer/42/hero.png";
  const prefetchPromise = images.prefetch(prefetchURI).then(() => {
    setLabel("Prefetched");
  });
  await Promise.resolve();
  assert.deepEqual(prefetchRequests, [{ uri: prefetchURI, requestId: 1 }]);
  prefetches[0].resolve(true);
  await prefetchPromise;
  await Promise.resolve();
  const prefetchCommit = await app.root.flush();
  assert.equal(prefetchCommit.sequence, 3);

  const missingURI = "https://private.example/customer/42/missing.png";
  const cachePromise = images
    .queryCache([prefetchURI, missingURI])
    .then((entries) => {
      setLabel(entries[0].location === "disk" ? "Cached" : "Unexpected");
      return entries;
    });
  cacheQueries[0].resolve({ [prefetchURI]: "disk" });
  assert.deepEqual(await cachePromise, [
    { uri: prefetchURI, location: "disk" },
    { uri: missingURI, location: "none" },
  ]);
  await Promise.resolve();
  const cacheCommit = await app.root.flush();
  assert.equal(cacheCommit.sequence, 4);
  assert.deepEqual(cacheRequests, [[prefetchURI, missingURI]]);

  for (const [eventName, sequence] of [
    ["platform.image.dimensions", 2],
    ["platform.image.prefetch", 3],
    ["platform.image.cache-query", 4],
  ]) {
    const event = records.find(
      (record) =>
        record.type === "operation-started" &&
        record.name === "solid-native.event" &&
        record.attributes["event.name"] === eventName,
    );
    const commit = records.find(
      (record) =>
        record.type === "operation-started" &&
        record.name === "solid-native.commit" &&
        record.attributes["commit.sequence"] === sequence,
    );
    assert.ok(event);
    assert.ok(commit);
    assert.equal(event.attributes["event.priority"], "default");
    assert.equal(commit.attributes["commit.priority"], "normal");
    assert.ok(commit.causes.includes(event.operationId));
  }
  const serializedTelemetry = JSON.stringify(records);
  assert.equal(serializedTelemetry.includes("private.example"), false);
  assert.equal(serializedTelemetry.includes("private-image-token"), false);

  const pendingDimension = images
    .getDimensions("https://private.example/pending-dimensions.png")
    .catch((error) => error);
  const pendingPrefetch = images
    .prefetch("https://private.example/pending-prefetch.png")
    .catch((error) => error);
  const pendingCache = images
    .queryCache(["https://private.example/pending-cache.png"])
    .catch((error) => error);
  await Promise.resolve();
  await app.dispose();
  assert.ok((await pendingDimension) instanceof ImageOwnerDisposedError);
  assert.ok((await pendingPrefetch) instanceof ImageOwnerDisposedError);
  assert.ok((await pendingCache) instanceof ImageOwnerDisposedError);
  assert.deepEqual(cancellations, [2]);
  dimensions[1].resolve({ width: 1, height: 1 });
  prefetches[1].resolve(true);
  cacheQueries[1].resolve({});
  await Promise.resolve();
  await assert.rejects(
    images.getDimensions("https://private.example/after-dispose.png"),
    ImageOwnerDisposedError,
  );
  await assert.rejects(
    images.prefetch("https://private.example/after-dispose.png"),
    ImageOwnerDisposedError,
  );
  await assert.rejects(images.queryCache([]), ImageOwnerDisposedError);
});

test("traces private native stream chunks through their exact Solid commits", async () => {
  const nativeRequests = [];
  const nativeListeners = [];
  const cancellations = [];
  const service = createNetworkService({
    platform: "android",
    startTextRequest(request, listener) {
      const index = nativeRequests.length;
      nativeRequests.push(request);
      nativeListeners.push(listener);
      return {
        cancel() {
          cancellations.push(index);
        },
      };
    },
  });
  assert.throws(
    () => createNetworkController(service),
    /requires an active Solid owner/u,
  );

  const records = [];
  let operationSequence = 0;
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `network-operation-${++operationSequence}`,
  });
  let network;
  let setLabel;
  const app = mount(
    () => {
      network = createNetworkController(service);
      const [label, updateLabel] = createSignal("Stream idle");
      setLabel = updateLabel;
      return createComponent(Text, {
        get children() {
          return label();
        },
      });
    },
    createRendererHost(),
    {
      surface: { name: "network-stream" },
      autoCommit: false,
      telemetry,
    },
  );
  await app.root.flush();

  const privateURL = "https://private.example/customer/42/assistant";
  const privateToken = "Bearer private-network-token";
  const privateBody = '{"prompt":"private customer question"}';
  const privateChunk = 'data: {"tool":"lookup-account"}\n\n';
  const handle = network.requestText(
    {
      url: privateURL,
      method: "POST",
      headers: {
        Authorization: privateToken,
        "Content-Type": "application/json",
      },
      body: privateBody,
    },
    {
      onResponse(response) {
        setLabel(`Response ${response.status}`);
      },
      onChunk(chunk) {
        setLabel(`Chunk ${chunk.sequence}`);
      },
    },
  );
  await Promise.resolve();
  assert.equal(nativeRequests.length, 1);
  nativeListeners[0]({
    kind: "response",
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
    url: privateURL,
  });
  const responseCommit = await app.root.flush();
  assert.equal(responseCommit.sequence, 2);

  nativeListeners[0]({
    kind: "chunk",
    text: privateChunk,
    loaded: privateChunk.length,
    total: -1,
  });
  const chunkCommit = await app.root.flush();
  assert.equal(chunkCommit.sequence, 3);

  const completed = handle.result.then((result) => {
    setLabel(`Complete ${result.chunkCount}`);
    return result;
  });
  nativeListeners[0]({ kind: "complete", error: null, timedOut: false });
  assert.deepEqual(await completed, {
    response: {
      status: 200,
      url: privateURL,
      headers: { "Content-Type": "text/event-stream" },
    },
    chunkCount: 1,
    receivedCharacters: privateChunk.length,
  });
  await Promise.resolve();
  const completeCommit = await app.root.flush();
  assert.equal(completeCommit.sequence, 4);

  const cancelled = network
    .requestText({ url: "https://private.example/cancelled" })
    .result.catch((error) => {
      setLabel(`Failed ${error.name}`);
      return error;
    });
  await Promise.resolve();
  const cancelledHandle = network.requestText({
    url: "https://private.example/cancelled-explicitly",
  });
  await Promise.resolve();
  cancelledHandle.cancel();
  const cancelledError = await cancelledHandle.result.catch((error) => {
    setLabel(`Failed ${error.name}`);
    return error;
  });
  assert.equal(cancelledError.name, "NetworkRequestCancelledError");
  await Promise.resolve();
  const errorCommit = await app.root.flush();
  assert.equal(errorCommit.sequence, 5);

  for (const [eventName, sequence] of [
    ["platform.network.response", 2],
    ["platform.network.chunk", 3],
    ["platform.network.complete", 4],
    ["platform.network.error", 5],
  ]) {
    const event = records.find(
      (record) =>
        record.type === "operation-started" &&
        record.name === "solid-native.event" &&
        record.attributes["event.name"] === eventName,
    );
    const commit = records.find(
      (record) =>
        record.type === "operation-started" &&
        record.name === "solid-native.commit" &&
        record.attributes["commit.sequence"] === sequence,
    );
    assert.ok(event);
    assert.ok(commit);
    assert.equal(event.attributes["event.priority"], "default");
    assert.equal(commit.attributes["commit.priority"], "normal");
    assert.ok(commit.causes.includes(event.operationId));
  }
  const serializedTelemetry = JSON.stringify(records);
  for (const secret of [
    "private.example",
    "private-network-token",
    "private customer question",
    "lookup-account",
  ]) {
    assert.equal(serializedTelemetry.includes(secret), false);
  }

  await app.dispose();
  assert.ok((await cancelled) instanceof NetworkOwnerDisposedError);
  assert.deepEqual(cancellations, [2, 1]);
  const afterDispose = network.requestText({
    url: "https://private.example/after-dispose",
  });
  await assert.rejects(afterDispose.result, NetworkOwnerDisposedError);
});

test("retains native chunk and completion causes through parsed server events", async () => {
  const nativeListeners = [];
  const service = createNetworkService({
    platform: "ios",
    startTextRequest(_request, listener) {
      nativeListeners.push(listener);
      return { cancel() {} };
    },
  });
  const records = [];
  let operationSequence = 0;
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `server-event-operation-${++operationSequence}`,
  });
  let network;
  let setLabel;
  const app = mount(
    () => {
      network = createNetworkController(service);
      const [label, updateLabel] = createSignal("Server events idle");
      setLabel = updateLabel;
      return createComponent(Text, {
        get children() {
          return label();
        },
      });
    },
    createRendererHost(),
    {
      surface: { name: "server-events" },
      autoCommit: false,
      telemetry,
    },
  );
  await app.root.flush();

  const privateURL = "https://private.example/customer/42/events";
  const privateEvent = '{"tool":"lookup-private-account"}';
  const handle = requestServerEvents(
    network,
    { url: privateURL },
    {
      onEvent(event) {
        setLabel(`Event ${event.sequence}`);
      },
    },
  );
  await Promise.resolve();
  nativeListeners[0]({
    kind: "response",
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
    url: privateURL,
  });
  nativeListeners[0]({
    kind: "chunk",
    text: `event: tool\ndata: ${privateEvent}\n\n`,
    loaded: 60,
    total: -1,
  });
  const chunkCommit = await app.root.flush();
  assert.equal(chunkCommit.sequence, 2);

  nativeListeners[0]({
    kind: "chunk",
    text: "data: final event",
    loaded: 77,
    total: -1,
  });
  nativeListeners[0]({ kind: "complete", error: null, timedOut: false });
  assert.equal((await handle.result).eventCount, 2);
  await Promise.resolve();
  const completeCommit = await app.root.flush();
  assert.equal(completeCommit.sequence, 3);

  for (const [eventName, sequence] of [
    ["platform.network.chunk", 2],
    ["platform.network.complete", 3],
  ]) {
    const event = records.find(
      (record) =>
        record.type === "operation-started" &&
        record.name === "solid-native.event" &&
        record.attributes["event.name"] === eventName,
    );
    const commit = records.find(
      (record) =>
        record.type === "operation-started" &&
        record.name === "solid-native.commit" &&
        record.attributes["commit.sequence"] === sequence,
    );
    assert.ok(event);
    assert.ok(commit);
    assert.ok(commit.causes.includes(event.operationId));
  }
  const serializedTelemetry = JSON.stringify(records);
  assert.equal(serializedTelemetry.includes("private.example"), false);
  assert.equal(serializedTelemetry.includes("lookup-private-account"), false);
  await app.dispose();
});

test("publishes a Solid-owned server-event stream inside its native chunk cause", async () => {
  const nativeListeners = [];
  const service = createNetworkService({
    platform: "android",
    startTextRequest(_request, listener) {
      nativeListeners.push(listener);
      return { cancel() {} };
    },
  });
  const records = [];
  let operationSequence = 0;
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `server-stream-operation-${++operationSequence}`,
  });
  let stream;
  const privateURL = "https://private.example/customer/42/live";
  const privateValue = "private-stream-value";
  const app = mount(
    () => {
      const network = createNetworkController(service);
      stream = createServerEventStream(network, { url: privateURL });
      return createComponent(Text, {
        get children() {
          return stream()?.data ?? stream.state;
        },
      });
    },
    createRendererHost(),
    {
      surface: { name: "network-server-event-stream" },
      autoCommit: false,
      telemetry,
    },
  );
  await Promise.resolve();
  await app.root.flush();

  nativeListeners[0]({
    kind: "response",
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
    url: privateURL,
  });
  const text = `event: token\ndata: ${privateValue}\n\n`;
  nativeListeners[0]({
    kind: "chunk",
    text,
    loaded: text.length,
    total: -1,
  });
  await Promise.resolve();

  assert.equal(stream.state, "open");
  assert.equal(stream()?.data, privateValue);
  const commit = await app.root.flush();
  assert.equal(commit.sequence, 2);
  const chunk = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      record.attributes["event.name"] === "platform.network.chunk",
  );
  const commitRecord = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      record.attributes["commit.sequence"] === 2,
  );
  assert.ok(chunk);
  assert.ok(commitRecord);
  assert.ok(commitRecord.causes.includes(chunk.operationId));
  const serializedTelemetry = JSON.stringify(records);
  assert.equal(serializedTelemetry.includes("private.example"), false);
  assert.equal(serializedTelemetry.includes(privateValue), false);
  await app.dispose();
});

test("settles a parsed JSON document inside its exact native completion cause", async () => {
  const nativeListeners = [];
  const service = createNetworkService({
    platform: "android",
    startTextRequest(_request, listener) {
      nativeListeners.push(listener);
      return { cancel() {} };
    },
  });
  const records = [];
  let operationSequence = 0;
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `json-operation-${++operationSequence}`,
  });
  let network;
  let setLabel;
  const app = mount(
    () => {
      network = createNetworkController(service);
      const [label, updateLabel] = createSignal("JSON idle");
      setLabel = updateLabel;
      return createComponent(Text, {
        get children() {
          return label();
        },
      });
    },
    createRendererHost(),
    {
      surface: { name: "network-json" },
      autoCommit: false,
      telemetry,
    },
  );
  await app.root.flush();

  const privateURL = "https://private.example/customer/42/document";
  const privateValue = "private-account-summary";
  const handle = requestJSON(
    network,
    { url: privateURL },
    {
      onResult(result) {
        setLabel(`Document ${result.value.status}`);
      },
    },
  );
  await Promise.resolve();
  const firstChunk = '{"status":"ready","summary":"private-';
  const secondChunk = 'account-summary"}';
  nativeListeners[0]({
    kind: "response",
    status: 200,
    headers: { "Content-Type": "application/json" },
    url: privateURL,
  });
  nativeListeners[0]({
    kind: "chunk",
    text: firstChunk,
    loaded: firstChunk.length,
    total: -1,
  });
  nativeListeners[0]({
    kind: "chunk",
    text: secondChunk,
    loaded: firstChunk.length + secondChunk.length,
    total: firstChunk.length + secondChunk.length,
  });
  nativeListeners[0]({ kind: "complete", error: null, timedOut: false });

  const result = await handle.result;
  assert.equal(result.value.status, "ready");
  assert.equal(result.value.summary, privateValue);
  const commit = await app.root.flush();
  assert.equal(commit.sequence, 2);
  const completion = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      record.attributes["event.name"] === "platform.network.complete",
  );
  const commitRecord = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      record.attributes["commit.sequence"] === 2,
  );
  assert.ok(completion);
  assert.ok(commitRecord);
  assert.ok(commitRecord.causes.includes(completion.operationId));
  const serializedTelemetry = JSON.stringify(records);
  assert.equal(serializedTelemetry.includes("private.example"), false);
  assert.equal(serializedTelemetry.includes(privateValue), false);
  await app.dispose();
});

test("publishes a native JSON resource inside its exact completion cause", async () => {
  const nativeListeners = [];
  const service = createNetworkService({
    platform: "android",
    startTextRequest(_request, listener) {
      nativeListeners.push(listener);
      return { cancel() {} };
    },
  });
  const records = [];
  let operationSequence = 0;
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `json-resource-operation-${++operationSequence}`,
  });
  let resource;
  const privateURL = "https://private.example/customer/42/resource";
  const privateValue = "private-resource-value";
  const app = mount(
    () => {
      const network = createNetworkController(service);
      resource = createJSONResource(
        network,
        { url: privateURL },
        {
          decode(value) {
            if (
              value === null ||
              typeof value !== "object" ||
              Array.isArray(value) ||
              typeof value.status !== "string"
            ) {
              throw new TypeError("Resource status is required.");
            }
            return value.status;
          },
        },
      );
      return createComponent(Text, {
        get children() {
          return resource() ?? resource.state;
        },
      });
    },
    createRendererHost(),
    {
      surface: { name: "network-json-resource" },
      autoCommit: false,
      telemetry,
    },
  );
  await Promise.resolve();
  await app.root.flush();

  const text = JSON.stringify({ status: privateValue });
  nativeListeners[0]({
    kind: "response",
    status: 200,
    headers: { "Content-Type": "application/json" },
    url: privateURL,
  });
  nativeListeners[0]({
    kind: "chunk",
    text,
    loaded: text.length,
    total: text.length,
  });
  nativeListeners[0]({ kind: "complete", error: null, timedOut: false });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(resource.state, "ready");
  assert.equal(resource(), privateValue);
  const commit = await app.root.flush();
  assert.equal(commit.sequence, 2);
  const completion = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      record.attributes["event.name"] === "platform.network.complete",
  );
  const commitRecord = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      record.attributes["commit.sequence"] === 2,
  );
  assert.ok(completion);
  assert.ok(commitRecord);
  assert.ok(commitRecord.causes.includes(completion.operationId));
  const serializedTelemetry = JSON.stringify(records);
  assert.equal(serializedTelemetry.includes("private.example"), false);
  assert.equal(serializedTelemetry.includes(privateValue), false);
  await app.dispose();
});

test("routes owner-bound camera session kinds through private platform events", async () => {
  const listeners = new Set();
  const adapter = {
    getPermission() {
      return { authorization: "authorized" };
    },
    async requestPermission() {
      return { authorization: "authorized" };
    },
    async listDevices() {
      return [
        {
          id: "private-camera-id",
          name: "Private camera name",
          position: "back",
          type: "private-camera-type",
        },
      ];
    },
    async open() {
      return {
        device: {
          id: "private-camera-id",
          name: "Private camera name",
          position: "back",
          type: "private-camera-type",
        },
        async capturePhoto() {
          throw new Error("capture is outside the session-event proof");
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        async stop() {},
      };
    },
    emit(event) {
      for (const listener of listeners) listener(event);
    },
  };
  const session = await createCameraService(adapter).open("back");
  const host = createRendererHost();
  const records = [];
  const errors = [];
  let operationSequence = 0;
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `camera-event-${++operationSequence}`,
  });
  let setSession;
  let latestEvent;
  const app = mount(
    () => {
      const [currentSession, setCurrentSession] = createSignal();
      setSession = setCurrentSession;
      latestEvent = createCameraSessionEvent(currentSession, {
        onError: (error) => errors.push(error),
      });
      return createComponent(CausalOwner, {
        name: "camera.screen",
        get children() {
          return createComponent(CausalComputation, {
            name: "platform.camera.session.output",
            get children() {
              return createComponent(Text, {
                get children() {
                  return latestEvent()?.kind ?? "none";
                },
              });
            },
          });
        },
      });
    },
    host,
    {
      surface: { name: "camera-session-events" },
      autoCommit: false,
      telemetry,
    },
  );

  await app.root.flush();
  assert.equal(listeners.size, 0);
  setSession(session);
  await Promise.resolve();
  assert.equal(listeners.size, 1);

  const expectations = [
    {
      event: { kind: "started" },
      name: "platform.camera.session.started",
    },
    {
      event: { kind: "interrupted", reason: "private-system-pressure" },
      name: "platform.camera.session.interrupted",
    },
    {
      event: { kind: "resumed" },
      name: "platform.camera.session.resumed",
    },
    {
      event: { kind: "error", reason: "private-native-failure" },
      name: "platform.camera.session.error",
    },
    {
      event: { kind: "stopped" },
      name: "platform.camera.session.stopped",
    },
  ];
  const surfaceStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.surface",
  );
  const ownerStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.owner" &&
      record.attributes["owner.name"] === "camera.screen",
  );
  assert.ok(surfaceStarted);
  assert.ok(ownerStarted);

  for (const [index, expectation] of expectations.entries()) {
    adapter.emit(expectation.event);
    assert.deepEqual(latestEvent(), expectation.event);
    const update = await app.root.flush();
    assert.equal(update.sequence, index + 2);
    const commitStarted = records.find(
      (record) =>
        record.type === "operation-started" &&
        record.name === "solid-native.commit" &&
        record.attributes["commit.sequence"] === index + 2,
    );
    const eventStarted = records.find(
      (record) =>
        record.type === "operation-started" &&
        record.name === "solid-native.event" &&
        record.attributes["event.name"] === expectation.name &&
        commitStarted?.type === "operation-started" &&
        commitStarted.causes.includes(record.operationId),
    );
    const eventFinished = records.find(
      (record) =>
        record.type === "operation-finished" &&
        record.operationId === eventStarted?.operationId,
    );
    const computationStarted = records.find(
      (record) =>
        record.type === "operation-started" &&
        record.name === "solid-native.computation" &&
        record.attributes["computation.name"] ===
          "platform.camera.session.output" &&
        commitStarted?.type === "operation-started" &&
        commitStarted.causes.includes(record.operationId),
    );
    assert.ok(commitStarted);
    assert.ok(eventStarted);
    assert.ok(eventFinished);
    assert.ok(computationStarted);
    assert.deepEqual(eventStarted.causes, [surfaceStarted.operationId]);
    assert.equal(eventStarted.attributes["event.source"], "platform");
    assert.equal(eventStarted.attributes["event.priority"], "default");
    assert.equal(eventFinished.status, "ok");
    assert.deepEqual(
      new Set(commitStarted.causes),
      new Set([
        eventStarted.operationId,
        ownerStarted.operationId,
        computationStarted.operationId,
      ]),
    );
    assert.equal(commitStarted.attributes["commit.priority"], "normal");
  }

  assert.deepEqual(errors, []);
  assert.equal(
    JSON.stringify(records).includes("private-system-pressure"),
    false,
  );
  assert.equal(
    JSON.stringify(records).includes("private-native-failure"),
    false,
  );

  const replacementListeners = new Set();
  const replacementAdapter = {
    ...adapter,
    async open() {
      return {
        device: {
          id: "replacement-private-camera-id",
          name: "Replacement private camera name",
          position: "back",
          type: "replacement-private-camera-type",
        },
        async capturePhoto() {
          throw new Error("capture is outside the session-event proof");
        },
        subscribe(listener) {
          replacementListeners.add(listener);
          return () => replacementListeners.delete(listener);
        },
        async stop() {},
      };
    },
    emit(event) {
      for (const listener of replacementListeners) listener(event);
    },
  };
  const replacementSession =
    await createCameraService(replacementAdapter).open("back");
  setSession(replacementSession);
  await Promise.resolve();
  assert.equal(listeners.size, 0);
  assert.equal(replacementListeners.size, 1);
  adapter.emit({ kind: "started" });
  assert.equal(latestEvent()?.kind, "stopped");
  replacementAdapter.emit({ kind: "resumed" });
  assert.equal(latestEvent()?.kind, "resumed");
  await app.root.flush();
  setSession(undefined);
  await Promise.resolve();
  assert.equal(replacementListeners.size, 0);
  await app.dispose();
  assert.equal(listeners.size, 0);
  await session.stop();
  await replacementSession.stop();
});

test("isolates camera event accessor subscription handoff failures", async () => {
  const removalFailure = new Error("camera event removal failed");
  const subscriptionFailure = new Error("camera event subscribe failed");
  const errors = [];
  let removeCalls = 0;
  const device = Object.freeze({
    id: "private-camera-id",
    name: "Private camera name",
    position: "back",
    type: "private-camera-type",
  });
  const removalSession = Object.freeze({
    device,
    stopped: false,
    async capturePhoto() {
      throw new Error("capture is outside the handoff proof");
    },
    subscribe() {
      return Object.freeze({
        remove() {
          removeCalls++;
          throw removalFailure;
        },
      });
    },
    async stop() {},
  });
  const failingSession = Object.freeze({
    ...removalSession,
    subscribe() {
      throw subscriptionFailure;
    },
  });
  let setSession;
  const app = mount(
    () => {
      const [session, setCurrentSession] = createSignal();
      setSession = setCurrentSession;
      createCameraSessionEvent(session, {
        async onError(error) {
          errors.push(error);
          throw new Error("diagnostic failed");
        },
      });
      return createComponent(Text, { children: "camera event handoff" });
    },
    createRendererHost(),
    { surface: { name: "camera-event-handoff" }, autoCommit: false },
  );

  await app.root.flush();
  setSession(removalSession);
  await Promise.resolve();
  setSession(failingSession);
  await Promise.resolve();
  assert.equal(removeCalls, 1);
  assert.deepEqual(errors, [removalFailure, subscriptionFailure]);

  setSession(removalSession);
  await Promise.resolve();
  await app.dispose();
  assert.equal(removeCalls, 2);
  assert.deepEqual(errors, [
    removalFailure,
    subscriptionFailure,
    removalFailure,
  ]);
});

test("routes non-Fabric platform events at their declared causal priority", async () => {
  const host = createRendererHost();
  const records = [];
  let operationSequence = 0;
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `platform-event-${++operationSequence}`,
  });
  let handleBack;
  let handleFailure;
  let invalidName;
  let invalidPriority;
  let invalidCoalescing;
  const app = mount(
    () => {
      const [label, setLabel] = createSignal("Ready");
      handleBack = createCausalPlatformEventHandler(
        "platform.hardware-back.press",
        () => {
          setLabel("Back handled");
          return true;
        },
        { priority: "discrete" },
      );
      handleFailure = createCausalPlatformEventHandler(
        "platform.sensor.failure",
        () => {
          throw new TypeError("private sensor value");
        },
      );
      try {
        createCausalPlatformEventHandler("customer email", () => undefined);
      } catch (error) {
        invalidName = error;
      }
      try {
        createCausalPlatformEventHandler(
          "platform.invalid-priority",
          () => undefined,
          { priority: "immediate" },
        );
      } catch (error) {
        invalidPriority = error;
      }
      try {
        createCausalPlatformEventHandler(
          "platform.invalid-coalescing",
          () => undefined,
          { coalescible: "yes" },
        );
      } catch (error) {
        invalidCoalescing = error;
      }
      return createComponent(Text, { children: label });
    },
    host,
    {
      surface: { name: "causal-platform-events" },
      autoCommit: false,
      telemetry,
    },
  );

  await app.root.flush();
  assert.equal(handleBack(), true);
  await app.root.flush();
  assert.throws(handleFailure, /private sensor value/u);
  assert.match(String(invalidName), /causal event names/u);
  assert.match(String(invalidPriority), /priority must be/u);
  assert.match(String(invalidCoalescing), /coalescible must be/u);

  const surfaceStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.surface",
  );
  const backStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      record.attributes["event.name"] === "platform.hardware-back.press",
  );
  const backFinished = records.find(
    (record) =>
      record.type === "operation-finished" &&
      record.operationId === backStarted?.operationId,
  );
  const updateCommit = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      record.attributes["commit.sequence"] === 2,
  );
  const failureStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      record.attributes["event.name"] === "platform.sensor.failure",
  );
  const failureFinished = records.find(
    (record) =>
      record.type === "operation-finished" &&
      record.operationId === failureStarted?.operationId,
  );
  assert.ok(surfaceStarted);
  assert.ok(backStarted);
  assert.ok(backFinished);
  assert.ok(updateCommit);
  assert.deepEqual(backStarted.causes, [surfaceStarted.operationId]);
  assert.equal(backStarted.attributes["event.source"], "platform");
  assert.equal(backStarted.attributes["event.priority"], "discrete");
  assert.equal(backFinished.status, "ok");
  assert.deepEqual(updateCommit.causes, [backStarted.operationId]);
  assert.equal(updateCommit.attributes["commit.priority"], "user-blocking");
  assert.equal(failureFinished?.status, "error");
  assert.equal(failureFinished?.attributes["error.type"], "TypeError");
  assert.equal(JSON.stringify(records).includes("private sensor value"), false);
  await app.dispose();
});

test("retains a synchronous platform result through explicit async settlement", async () => {
  const host = createRendererHost();
  const records = [];
  let operationSequence = 0;
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `retained-event-${++operationSequence}`,
  });
  const settlement = deferred();
  let retention;
  let handleBack;
  let abandonedRetention;
  let handleAbandoned;
  let handleRetainedFailure;
  const app = mount(
    () => {
      const [label, setLabel] = createSignal("Guarded");
      handleBack = createCausalPlatformEventHandler(
        "platform.hardware-back.press",
        () =>
          retainCausalPlatformEvent(true, (event) => {
            retention = event;
            void settlement.promise.then(() => {
              event.run(() => setLabel("Allowed"));
              event.finish();
            });
          }),
        { priority: "discrete" },
      );
      handleAbandoned = createCausalPlatformEventHandler(
        "platform.pending.operation",
        () =>
          retainCausalPlatformEvent(false, (event) => {
            abandonedRetention = event;
          }),
      );
      handleRetainedFailure = createCausalPlatformEventHandler(
        "platform.pending.failure",
        () =>
          retainCausalPlatformEvent(true, (event) => {
            event.fail(new TypeError("private retained failure"));
          }),
      );
      return createComponent(Text, { children: label });
    },
    host,
    {
      surface: { name: "retained-platform-event" },
      autoCommit: false,
      telemetry,
    },
  );

  await app.root.flush();
  assert.equal(handleBack(), true);
  assert.equal(retention.state, "active");
  const eventStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      record.attributes["event.name"] === "platform.hardware-back.press",
  );
  assert.ok(eventStarted);
  assert.equal(
    records.some(
      (record) =>
        record.type === "operation-finished" &&
        record.operationId === eventStarted.operationId,
    ),
    false,
  );

  settlement.resolve("private blocker decision");
  await settlement.promise;
  await Promise.resolve();
  assert.equal(retention.state, "finished");
  const update = await app.root.flush();
  assert.equal(update.sequence, 2);
  const updateCommit = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      record.attributes["commit.sequence"] === 2,
  );
  const eventFinished = records.find(
    (record) =>
      record.type === "operation-finished" &&
      record.operationId === eventStarted.operationId,
  );
  assert.ok(updateCommit);
  assert.ok(eventFinished);
  assert.deepEqual(updateCommit.causes, [eventStarted.operationId]);
  assert.equal(updateCommit.attributes["commit.priority"], "user-blocking");
  assert.equal(eventFinished.status, "ok");
  assert.equal(
    JSON.stringify(records).includes("private blocker decision"),
    false,
  );
  assert.throws(
    () => retention.run(() => undefined),
    /retention is no longer active/u,
  );
  assert.throws(
    () => retainCausalPlatformEvent(true, undefined),
    /retention must be a function/u,
  );
  assert.equal(handleRetainedFailure(), true);
  const retainedFailureStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      record.attributes["event.name"] === "platform.pending.failure",
  );
  const retainedFailureFinished = records.find(
    (record) =>
      record.type === "operation-finished" &&
      record.operationId === retainedFailureStarted?.operationId,
  );
  assert.equal(retainedFailureFinished?.status, "error");
  assert.equal(retainedFailureFinished?.attributes["error.type"], "TypeError");
  assert.equal(
    JSON.stringify(records).includes("private retained failure"),
    false,
  );
  assert.equal(handleAbandoned(), false);
  assert.equal(abandonedRetention.state, "active");
  await app.dispose();
  assert.equal(abandonedRetention.state, "cancelled");
  const abandonedStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      record.attributes["event.name"] === "platform.pending.operation",
  );
  const abandonedFinished = records.find(
    (record) =>
      record.type === "operation-finished" &&
      record.operationId === abandonedStarted?.operationId,
  );
  assert.equal(abandonedFinished?.status, "cancelled");
});

test("retains a Fabric event through explicit asynchronous settlement", async () => {
  const host = createRendererHost();
  const records = [];
  let operationSequence = 0;
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `retained-native-event-${++operationSequence}`,
  });
  const settlement = deferred();
  let retention;
  let abandonedRetention;
  let pressCount = 0;
  const app = mount(
    () => {
      const [label, setLabel] = createSignal("Ready");
      return createComponent(Pressable, {
        onPress: () => {
          pressCount++;
          return pressCount === 1
            ? retainCausalNativeEvent(undefined, (event) => {
                retention = event;
                void settlement.promise.then(() => {
                  event.run(() => setLabel("Settled"));
                  event.finish();
                });
              })
            : retainCausalNativeEvent(undefined, (event) => {
                abandonedRetention = event;
              });
        },
        get children() {
          return createComponent(Text, { children: label });
        },
      });
    },
    host,
    {
      surface: { name: "retained-native-event" },
      autoCommit: false,
      telemetry,
    },
  );

  await app.root.flush();
  const pressable = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "Pressable",
    );
  assert.ok(pressable);
  host.injectEvent({
    surface: app.root.surfaceId,
    target: pressable.node,
    name: "press",
    priority: "discrete",
    bubbles: true,
  });
  assert.equal(retention.state, "active");
  const eventStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      record.attributes["event.name"] === "press",
  );
  assert.ok(eventStarted);
  assert.equal(
    records.some(
      (record) =>
        record.type === "operation-finished" &&
        record.operationId === eventStarted.operationId,
    ),
    false,
  );

  settlement.resolve();
  await settlement.promise;
  await Promise.resolve();
  assert.equal(retention.state, "finished");
  const update = await app.root.flush();
  assert.equal(update.sequence, 2);
  const updateCommit = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      record.attributes["commit.sequence"] === 2,
  );
  const eventFinished = records.find(
    (record) =>
      record.type === "operation-finished" &&
      record.operationId === eventStarted.operationId,
  );
  assert.ok(updateCommit);
  assert.deepEqual(updateCommit.causes, [eventStarted.operationId]);
  assert.equal(updateCommit.attributes["commit.priority"], "user-blocking");
  assert.equal(eventFinished?.status, "ok");
  assert.throws(
    () => retainCausalNativeEvent(undefined, undefined),
    /retention must be a function/u,
  );

  host.injectEvent({
    surface: app.root.surfaceId,
    target: pressable.node,
    name: "press",
    priority: "discrete",
    bubbles: true,
  });
  assert.equal(abandonedRetention.state, "active");
  await app.dispose();
  assert.equal(abandonedRetention.state, "cancelled");
  const abandonedStarted = records.findLast(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      record.attributes["event.name"] === "press",
  );
  const abandonedFinished = records.find(
    (record) =>
      record.type === "operation-finished" &&
      record.operationId === abandonedStarted?.operationId,
  );
  assert.equal(abandonedFinished?.status, "cancelled");
});

test("binds native navigation events to Solid ownership", async () => {
  const history = new NativeHistory({ initialHref: "/" });
  history.push("/detail");
  const blockedDecision = deferred();
  const allowedDecision = deferred();
  const blockerDecisions = [blockedDecision, allowedDecision];
  const removeBlocker = history.blockPlatformTransitions(
    () => blockerDecisions.shift().promise,
  );
  let backListener;
  let urlListener;
  const removals = { back: 0, url: 0 };
  const transitions = [];
  const blockedTransitions = [];
  const host = createRendererHost();
  const records = [];
  let operationSequence = 0;
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `navigation-binding-${++operationSequence}`,
  });
  const app = mount(
    () => {
      const [label, setLabel] = createSignal("Navigation bindings");
      const bindings = createNativeNavigationBindings(
        history,
        {
          subscribeHardwareBack(listener) {
            backListener = listener;
            return {
              remove() {
                backListener = undefined;
                removals.back++;
              },
            };
          },
          subscribeURL(listener) {
            urlListener = listener;
            return {
              remove() {
                urlListener = undefined;
                removals.url++;
              },
            };
          },
        },
        {
          hardwareBack: {
            onBlocked: (transition) => blockedTransitions.push(transition),
            onTransition: (transition) => {
              transitions.push(transition);
              setLabel("Platform Back");
            },
          },
          deepLinks: {
            resolve: (url) => ({ href: url, state: null }),
            onTransition: (transition) => {
              transitions.push(transition);
              setLabel("Live URL");
            },
          },
        },
      );
      assert.equal(Object.isFrozen(bindings), true);
      return createComponent(CausalOwner, {
        name: "navigation.bindings",
        get children() {
          return createComponent(CausalComputation, {
            name: "navigation.route.output",
            get children() {
              return createComponent(Text, { children: label });
            },
          });
        },
      });
    },
    host,
    {
      surface: { name: "native-navigation-bindings" },
      autoCommit: false,
      telemetry,
    },
  );

  await app.root.flush();
  assert.equal(backListener(), true);
  assert.equal(history.location.href, "/detail");
  blockedDecision.resolve(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(history.location.href, "/detail");
  assert.equal(blockedTransitions.length, 1);
  assert.equal(backListener(), true);
  allowedDecision.resolve(false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(history.location.href, "/");
  await app.root.flush();
  urlListener({ url: "/live-link" });
  assert.equal(history.location.href, "/live-link");
  await app.root.flush();
  assert.deepEqual(
    transitions.map((transition) => transition.origin),
    ["platform", "system"],
  );

  const surfaceStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.surface",
  );
  const ownerStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.owner" &&
      record.attributes["owner.name"] === "navigation.bindings",
  );
  assert.ok(surfaceStarted);
  assert.ok(ownerStarted);
  const expected = [
    {
      sequence: 2,
      name: "platform.hardware-back.press",
      priority: "discrete",
      commitPriority: "user-blocking",
    },
    {
      sequence: 3,
      name: "platform.url.open",
      priority: "default",
      commitPriority: "normal",
    },
  ];
  for (const expectation of expected) {
    const commitStarted = records.find(
      (record) =>
        record.type === "operation-started" &&
        record.name === "solid-native.commit" &&
        record.attributes["commit.sequence"] === expectation.sequence,
    );
    const eventStarted = records.find(
      (record) =>
        record.type === "operation-started" &&
        record.name === "solid-native.event" &&
        record.attributes["event.name"] === expectation.name &&
        commitStarted?.type === "operation-started" &&
        commitStarted.causes.includes(record.operationId),
    );
    const eventFinished = records.find(
      (record) =>
        record.type === "operation-finished" &&
        record.operationId === eventStarted?.operationId,
    );
    const computationStarted = records.find(
      (record) =>
        record.type === "operation-started" &&
        record.name === "solid-native.computation" &&
        record.attributes["computation.name"] === "navigation.route.output" &&
        commitStarted?.type === "operation-started" &&
        commitStarted.causes.includes(record.operationId),
    );
    assert.ok(commitStarted);
    assert.ok(eventStarted);
    assert.ok(eventFinished);
    assert.ok(computationStarted);
    assert.deepEqual(eventStarted.causes, [surfaceStarted.operationId]);
    assert.equal(eventStarted.attributes["event.source"], "platform");
    assert.equal(
      eventStarted.attributes["event.priority"],
      expectation.priority,
    );
    assert.equal(eventFinished.status, "ok");
    assert.deepEqual(
      new Set(commitStarted.causes),
      new Set([
        eventStarted.operationId,
        ownerStarted.operationId,
        computationStarted.operationId,
      ]),
    );
    assert.equal(
      commitStarted.attributes["commit.priority"],
      expectation.commitPriority,
    );
  }
  const backEvents = records.filter(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      record.attributes["event.name"] === "platform.hardware-back.press",
  );
  assert.equal(backEvents.length, 2);
  assert.equal(
    records.some(
      (record) =>
        record.type === "operation-started" &&
        record.name === "solid-native.commit" &&
        record.causes.includes(backEvents[0].operationId),
    ),
    false,
  );
  assert.equal(JSON.stringify(records).includes("/live-link"), false);

  removeBlocker();
  await app.dispose();
  assert.deepEqual(removals, { back: 1, url: 1 });
  assert.equal(backListener, undefined);
  assert.equal(urlListener, undefined);
});

test("registers and renders a custom native component", async () => {
  const GeneratedBadge = createNativeComponent("GeneratedBadge");
  const descriptor = createNativeComponentDescriptor("GeneratedBadge");
  const host = new InMemoryHost({
    descriptors: [...CORE_COMPONENT_DESCRIPTORS, descriptor],
  });
  const app = mount(
    () =>
      createComponent(GeneratedBadge, {
        label: "Codegen-backed",
        style: { height: 48 },
      }),
    host,
    { surface: { name: "custom-native-component" }, autoCommit: false },
  );

  await app.root.flush();
  const customNode = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "GeneratedBadge",
    );
  assert.ok(customNode);
  assert.deepEqual(customNode.props, {
    label: "Codegen-backed",
    style: { height: 48 },
  });
  await app.dispose();
});

test("rejects invalid custom native component names", () => {
  assert.throws(() => createNativeComponent(""), /1-128 character identifiers/);
  assert.throws(
    () => createNativeComponentDescriptor("native-component"),
    /1-128 character identifiers/,
  );
  assert.throws(
    () => createNativeComponent(`N${"a".repeat(128)}`),
    /1-128 character identifiers/,
  );
});

test("creates, composes, and flattens backend-neutral native styles", () => {
  const base = { backgroundColor: "navy", flex: 1 };
  const selected = { backgroundColor: "blue", opacity: 0.8 };
  const styles = StyleSheet.create({ base, selected });

  assert.equal(styles.base, base);
  assert.equal(StyleSheet.compose(undefined, styles.base), styles.base);
  assert.equal(StyleSheet.compose(styles.base, null), styles.base);

  const composed = StyleSheet.compose(styles.base, styles.selected);
  assert.deepEqual(composed, [styles.base, styles.selected]);
  assert.deepEqual(
    StyleSheet.flatten([styles.base, false, [null, styles.selected]]),
    { backgroundColor: "blue", flex: 1, opacity: 0.8 },
  );
  assert.equal(StyleSheet.flatten(styles.base), styles.base);
  assert.equal(StyleSheet.flatten(false), undefined);
  assert.equal(StyleSheet.absoluteFill, StyleSheet.absoluteFillObject);
  assert.deepEqual(StyleSheet.absoluteFill, {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  });

  const circular = [];
  circular.push(circular);
  assert.throws(
    () => StyleSheet.flatten(circular),
    /style arrays must not be circular/u,
  );
});

test("renders core components through Solid universal", async () => {
  const host = createRendererHost();
  const app = mount(
    () =>
      createComponent(View, {
        style: [{ flex: 1 }, false, { backgroundColor: "navy" }],
        get children() {
          return createComponent(Text, { children: "Hello native" });
        },
      }),
    host,
    { surface: { name: "solid-render" }, autoCommit: false },
  );

  await app.root.flush();
  const snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  assert.equal(snapshot.sequence, 1);
  assert.deepEqual(
    snapshot.nodes.map((node) =>
      node.kind === "element" ? node.component : node.text,
    ),
    ["RootView", "View", "Text", "Hello native"],
  );
  assert.deepEqual(snapshot.nodes[1].props.style, {
    flex: 1,
    backgroundColor: "navy",
  });

  await app.dispose();
  const disposal = host.commits.at(-1);
  assert.equal(disposal.sequence, 2);
  assert.equal(
    disposal.mutations.filter((mutation) => mutation.type === "delete-node")
      .length,
    4,
  );
});

test("synchronizes controlled TextInput updates with native event counts", async () => {
  const host = createRendererHost();
  const [value, setValue] = createSignal("");
  const changes = [];
  const rawChanges = [];
  let inputRef;
  const app = mount(
    () =>
      createComponent(TextInput, {
        ref(node) {
          inputRef = node;
        },
        get value() {
          return value();
        },
        onChange(event) {
          rawChanges.push(event.payload);
        },
        onChangeText(text) {
          changes.push(text);
          setValue(text);
        },
      }),
    host,
    { surface: { name: "controlled-text-input" }, autoCommit: false },
  );

  await app.root.flush();
  let input = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "TextInput",
    );
  assert.ok(input);
  assert.deepEqual(input.props, {
    allowFontScaling: true,
    autoCapitalize: "sentences",
    text: "",
    mostRecentEventCount: 0,
    placeholder: "",
    submitBehavior: "blurAndSubmit",
    underlineColorAndroid: "transparent",
  });
  assert.deepEqual(input.eventListeners, [
    "blur",
    "changeText",
    "focus",
    "selectionChange",
  ]);

  host.injectEvent({
    surface: app.root.surfaceId,
    target: input.node,
    name: "changeText",
    payload: { text: "Solid", eventCount: 3 },
    priority: "default",
    bubbles: false,
  });
  await app.root.flush();
  input = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "TextInput",
    );
  assert.ok(input);
  assert.deepEqual(input.props, {
    allowFontScaling: true,
    autoCapitalize: "sentences",
    text: "Solid",
    mostRecentEventCount: 3,
    placeholder: "",
    submitBehavior: "blurAndSubmit",
    underlineColorAndroid: "transparent",
  });
  assert.deepEqual(changes, ["Solid"]);
  assert.deepEqual(rawChanges, [{ text: "Solid", eventCount: 3 }]);

  host.injectEvent({
    surface: app.root.surfaceId,
    target: input.node,
    name: "changeText",
    payload: { text: "Solid", eventCount: 4 },
    priority: "default",
    bubbles: false,
  });
  await app.root.flush();
  input = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "TextInput",
    );
  assert.ok(input);
  assert.equal(input.props.mostRecentEventCount, 4);
  assert.equal(changes.length, 1);
  assert.deepEqual(rawChanges, [
    { text: "Solid", eventCount: 3 },
    { text: "Solid", eventCount: 4 },
  ]);

  host.injectEvent({
    surface: app.root.surfaceId,
    target: input.node,
    name: "changeText",
    payload: { text: "stale", eventCount: 2 },
    priority: "default",
    bubbles: false,
  });
  assert.equal(await app.root.flush(), undefined);
  assert.equal(value(), "Solid");
  assert.equal(changes.length, 1);
  assert.equal(rawChanges.length, 2);

  assert.throws(
    () =>
      host.injectEvent({
        surface: app.root.surfaceId,
        target: input.node,
        name: "changeText",
        payload: { text: "invalid" },
        priority: "default",
        bubbles: false,
      }),
    /non-negative integer eventCount/,
  );

  setValue("Solid controls Native");
  await app.root.flush();
  const controlledTextCommand = host.commits
    .flatMap((commit) => commit.mutations)
    .findLast(
      (mutation) =>
        mutation.type === "command" &&
        mutation.command === "setTextAndSelection",
    );
  assert.deepEqual(controlledTextCommand?.args, [
    4,
    "Solid controls Native",
    -1,
    -1,
  ]);

  assert.ok(inputRef);
  await inputRef.dispatchCommand(
    "setTextAndSelection",
    4,
    "Solid controls Native",
    2,
    2,
  );
  assert.equal(app.root.lastCommittedSequence, 6);

  await app.dispose();
});

test("synchronizes controlled TextInput selection with counted native commands", async () => {
  const host = createRendererHost();
  const [value, setValue] = createSignal("Solid controls Native");
  const [selection, setSelection] = createSignal(undefined);
  const selections = [];
  let inputRef;
  const app = mount(
    () =>
      createComponent(TextInput, {
        ref(node) {
          inputRef = node;
        },
        get value() {
          return value();
        },
        get selection() {
          return selection();
        },
        onChangeText(text) {
          setValue(text);
          setSelection(undefined);
        },
        onSelectionChange(event) {
          selections.push(event.payload);
        },
      }),
    host,
    { surface: { name: "controlled-text-input-selection" }, autoCommit: false },
  );

  await app.root.flush();
  assert.ok(inputRef);
  setSelection({ start: 5 });
  await app.root.flush();

  let input = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "TextInput",
    );
  assert.ok(input);
  assert.deepEqual(input.props.selection, { start: 5, end: 5 });
  let selectionCommands = host.commits
    .flatMap((commit) => commit.mutations)
    .filter(
      (mutation) =>
        mutation.type === "command" &&
        mutation.command === "setTextAndSelection",
    );
  assert.deepEqual(selectionCommands.at(-1)?.args, [
    0,
    "Solid controls Native",
    5,
    5,
  ]);

  host.injectEvent({
    surface: app.root.surfaceId,
    target: input.node,
    name: "selectionChange",
    payload: { selection: { start: 6, end: 6 } },
    priority: "default",
    bubbles: false,
  });
  await app.root.flush();
  selectionCommands = host.commits
    .flatMap((commit) => commit.mutations)
    .filter(
      (mutation) =>
        mutation.type === "command" &&
        mutation.command === "setTextAndSelection",
    );
  assert.equal(selectionCommands.length, 2);
  assert.deepEqual(selectionCommands.at(-1)?.args, [
    0,
    "Solid controls Native",
    5,
    5,
  ]);
  assert.deepEqual(selections, [{ selection: { start: 6, end: 6 } }]);

  host.injectEvent({
    surface: app.root.surfaceId,
    target: input.node,
    name: "changeText",
    payload: { text: "SolidX controls Native", eventCount: 7 },
    priority: "default",
    bubbles: false,
  });
  await app.root.flush();
  input = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "TextInput",
    );
  assert.ok(input);
  assert.equal(value(), "SolidX controls Native");
  assert.equal(input.props.text, "SolidX controls Native");
  assert.equal(input.props.mostRecentEventCount, 7);
  assert.equal(input.props.selection, undefined);

  setValue("Solid controls Native");
  await app.root.flush();
  selectionCommands = host.commits
    .flatMap((commit) => commit.mutations)
    .filter(
      (mutation) =>
        mutation.type === "command" &&
        mutation.command === "setTextAndSelection",
    );
  assert.deepEqual(selectionCommands.at(-1)?.args, [
    7,
    "Solid controls Native",
    -1,
    -1,
  ]);

  assert.throws(
    () =>
      host.injectEvent({
        surface: app.root.surfaceId,
        target: input.node,
        name: "selectionChange",
        payload: { selection: { start: -1, end: 0 } },
        priority: "default",
        bubbles: false,
      }),
    /non-negative 32-bit integer/,
  );

  await app.dispose();
});

test("maps an uncontrolled TextInput default to Fabric text", async () => {
  const host = createRendererHost();
  const app = mount(
    () => createComponent(TextInput, { defaultValue: "Initial native text" }),
    host,
    { surface: { name: "uncontrolled-text-input" }, autoCommit: false },
  );

  await app.root.flush();
  const input = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "TextInput",
    );
  assert.ok(input);
  assert.deepEqual(input.props, {
    allowFontScaling: true,
    autoCapitalize: "sentences",
    text: "Initial native text",
    mostRecentEventCount: 0,
    placeholder: "",
    submitBehavior: "blurAndSubmit",
    underlineColorAndroid: "transparent",
  });

  await app.dispose();
});

test("normalizes TextInput submit behavior without React's wrapper", async () => {
  const cases = [
    [{}, "blurAndSubmit"],
    [{ blurOnSubmit: false }, "submit"],
    [{ multiline: true }, "newline"],
    [{ multiline: true, blurOnSubmit: true }, "blurAndSubmit"],
    [{ submitBehavior: "submit" }, "submit"],
    [{ submitBehavior: "newline" }, "blurAndSubmit"],
    [{ multiline: true, submitBehavior: "newline" }, "newline"],
  ];

  for (const [props, expected] of cases) {
    const host = createRendererHost();
    const app = mount(() => createComponent(TextInput, props), host, {
      surface: { name: `text-input-submit-${expected}` },
      autoCommit: false,
    });
    await app.root.flush();
    const input = host
      .getSurfaceSnapshot(app.root.surfaceId)
      .nodes.find(
        (node) => node.kind === "element" && node.component === "TextInput",
      );
    assert.ok(input);
    assert.equal(input.props.submitBehavior, expected);
    assert.equal("blurOnSubmit" in input.props, false);
    await app.dispose();
  }
});

test("normalizes reactive Android TextInput input and autofill semantics", async () => {
  const host = createRendererHost("android");
  const [inputMode, setInputMode] = createSignal("email");
  const [enterKeyHint, setEnterKeyHint] = createSignal("previous");
  const [autoComplete, setAutoComplete] = createSignal("current-password");
  const [readOnly, setReadOnly] = createSignal(true);
  const [allowFontScaling, setAllowFontScaling] = createSignal(undefined);
  const [autoCapitalize, setAutoCapitalize] = createSignal(undefined);
  const [selectionColor, setSelectionColor] = createSignal("#123456");
  const [cursorColor, setCursorColor] = createSignal(undefined);
  const [selectionHandleColor, setSelectionHandleColor] =
    createSignal(undefined);
  const app = mount(
    () =>
      createComponent(TextInput, {
        get inputMode() {
          return inputMode();
        },
        keyboardType: "numeric",
        get enterKeyHint() {
          return enterKeyHint();
        },
        returnKeyType: "send",
        get autoComplete() {
          return autoComplete();
        },
        get readOnly() {
          return readOnly();
        },
        get allowFontScaling() {
          return allowFontScaling();
        },
        get autoCapitalize() {
          return autoCapitalize();
        },
        get selectionColor() {
          return selectionColor();
        },
        get cursorColor() {
          return cursorColor();
        },
        get selectionHandleColor() {
          return selectionHandleColor();
        },
        editable: false,
        showSoftInputOnFocus: false,
        caretHidden: false,
        autoCorrect: false,
        contextMenuHidden: true,
        maxLength: 120,
        selectTextOnFocus: true,
      }),
    host,
    { surface: { name: "android-text-input-semantics" }, autoCommit: false },
  );

  await app.root.flush();
  let input = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "TextInput",
    );
  assert.ok(input);
  assert.equal(input.props.keyboardType, "email-address");
  assert.equal(input.props.returnKeyType, "previous");
  assert.equal(input.props.autoComplete, "password");
  assert.equal(input.props.editable, false);
  assert.equal(input.props.showSoftInputOnFocus, true);
  assert.equal(input.props.caretHidden, false);
  assert.equal(input.props.allowFontScaling, true);
  assert.equal(input.props.autoCapitalize, "sentences");
  assert.equal(input.props.placeholder, "");
  assert.equal(input.props.selectionColor, "#123456");
  assert.equal(input.props.cursorColor, "#123456");
  assert.equal(input.props.selectionHandleColor, "#123456");
  assert.equal(input.props.underlineColorAndroid, "transparent");
  assert.equal(input.props.autoCorrect, false);
  assert.equal(input.props.contextMenuHidden, true);
  assert.equal(input.props.maxLength, 120);
  assert.equal(input.props.selectTextOnFocus, true);
  for (const translated of [
    "inputMode",
    "enterKeyHint",
    "readOnly",
    "value",
    "defaultValue",
  ]) {
    assert.equal(translated in input.props, false);
  }
  assert.equal("textContentType" in input.props, false);

  setInputMode("none");
  setEnterKeyHint(undefined);
  setAutoComplete("one-time-code");
  setReadOnly(false);
  setAllowFontScaling(false);
  setAutoCapitalize("none");
  setSelectionColor("#abcdef");
  setCursorColor(null);
  setSelectionHandleColor("#654321");
  await app.root.flush();
  input = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "TextInput",
    );
  assert.ok(input);
  assert.equal(input.props.keyboardType, "default");
  assert.equal(input.props.returnKeyType, "send");
  assert.equal(input.props.autoComplete, "sms-otp");
  assert.equal(input.props.editable, true);
  assert.equal(input.props.showSoftInputOnFocus, false);
  assert.equal(input.props.caretHidden, true);
  assert.equal(input.props.allowFontScaling, false);
  assert.equal(input.props.autoCapitalize, "none");
  assert.equal(input.props.selectionColor, "#abcdef");
  assert.equal(input.props.cursorColor, null);
  assert.equal(input.props.selectionHandleColor, "#654321");

  setInputMode(undefined);
  setReadOnly(undefined);
  await app.root.flush();
  input = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "TextInput",
    );
  assert.ok(input);
  assert.equal(input.props.keyboardType, "numeric");
  assert.equal(input.props.editable, false);
  assert.equal(input.props.showSoftInputOnFocus, false);
  assert.equal(input.props.caretHidden, false);

  await app.dispose();
});

test("normalizes reactive iOS TextInput input and autofill semantics", async () => {
  const host = createRendererHost("ios");
  const [inputMode, setInputMode] = createSignal("search");
  const [enterKeyHint, setEnterKeyHint] = createSignal("enter");
  const [autoComplete, setAutoComplete] = createSignal("email");
  const [textContentType, setTextContentType] = createSignal(undefined);
  const app = mount(
    () =>
      createComponent(TextInput, {
        get inputMode() {
          return inputMode();
        },
        keyboardType: "number-pad",
        get enterKeyHint() {
          return enterKeyHint();
        },
        returnKeyType: "done",
        get autoComplete() {
          return autoComplete();
        },
        get textContentType() {
          return textContentType();
        },
      }),
    host,
    { surface: { name: "ios-text-input-semantics" }, autoCommit: false },
  );

  await app.root.flush();
  let input = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "TextInput",
    );
  assert.ok(input);
  assert.equal(input.props.keyboardType, "web-search");
  assert.equal(input.props.returnKeyType, "default");
  assert.equal(input.props.textContentType, "emailAddress");
  assert.equal(input.props.allowFontScaling, true);
  assert.equal("autoComplete" in input.props, false);
  assert.equal("autoCapitalize" in input.props, false);
  assert.equal("cursorColor" in input.props, false);
  assert.equal("placeholder" in input.props, false);
  assert.equal("selectionHandleColor" in input.props, false);
  assert.equal("underlineColorAndroid" in input.props, false);

  setInputMode("none");
  setEnterKeyHint(undefined);
  setAutoComplete("current-password");
  setTextContentType("username");
  await app.root.flush();
  input = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "TextInput",
    );
  assert.ok(input);
  assert.equal(input.props.keyboardType, "default");
  assert.equal(input.props.returnKeyType, "done");
  assert.equal(input.props.textContentType, "username");
  assert.equal(input.props.showSoftInputOnFocus, false);
  assert.equal(input.props.caretHidden, true);

  setInputMode(undefined);
  setTextContentType(undefined);
  await app.root.flush();
  input = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "TextInput",
    );
  assert.ok(input);
  assert.equal(input.props.keyboardType, "number-pad");
  assert.equal(input.props.textContentType, "password");
  assert.equal("showSoftInputOnFocus" in input.props, false);
  assert.equal("caretHidden" in input.props, false);

  await app.dispose();
});

test("normalizes reactive TextInput wrapper styles without React", async () => {
  const androidHost = createRendererHost("android");
  const [androidStyle, setAndroidStyle] = createSignal([
    { fontWeight: 400, verticalAlign: "middle" },
    false,
  ]);
  const androidApp = mount(
    () =>
      createComponent(TextInput, {
        get style() {
          return androidStyle();
        },
      }),
    androidHost,
    { surface: { name: "android-text-input-style" }, autoCommit: false },
  );

  await androidApp.root.flush();
  let input = androidHost
    .getSurfaceSnapshot(androidApp.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "TextInput",
    );
  assert.ok(input);
  assert.deepEqual(input.props.style, {
    fontWeight: "400",
    textAlignVertical: "center",
  });

  setAndroidStyle([
    { paddingTop: 9, fontWeight: "700" },
    { verticalAlign: "top" },
  ]);
  await androidApp.root.flush();
  input = androidHost
    .getSurfaceSnapshot(androidApp.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "TextInput",
    );
  assert.ok(input);
  assert.deepEqual(input.props.style, {
    paddingTop: 9,
    fontWeight: "700",
    textAlignVertical: "top",
  });
  await androidApp.dispose();

  const iosHost = createRendererHost("ios");
  const [iosStyle, setIosStyle] = createSignal({
    color: "#123456",
    fontWeight: 500,
  });
  const [multiline, setMultiline] = createSignal(true);
  const iosApp = mount(
    () =>
      createComponent(TextInput, {
        get multiline() {
          return multiline();
        },
        get style() {
          return iosStyle();
        },
      }),
    iosHost,
    { surface: { name: "ios-text-input-style" }, autoCommit: false },
  );

  await iosApp.root.flush();
  input = iosHost
    .getSurfaceSnapshot(iosApp.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "TextInput",
    );
  assert.ok(input);
  assert.deepEqual(input.props.style, {
    color: "#123456",
    fontWeight: "500",
    paddingTop: 5,
  });

  setIosStyle({ paddingVertical: 8, verticalAlign: "bottom" });
  await iosApp.root.flush();
  input = iosHost
    .getSurfaceSnapshot(iosApp.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "TextInput",
    );
  assert.ok(input);
  assert.deepEqual(input.props.style, {
    paddingVertical: 8,
    textAlignVertical: "bottom",
  });

  setIosStyle([{ paddingTop: 4 }, { verticalAlign: "auto" }]);
  await iosApp.root.flush();
  input = iosHost
    .getSurfaceSnapshot(iosApp.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "TextInput",
    );
  assert.ok(input);
  assert.deepEqual(input.props.style, {
    paddingTop: 4,
    textAlignVertical: "auto",
  });

  setIosStyle({ color: "#abcdef" });
  setMultiline(false);
  await iosApp.root.flush();
  input = iosHost
    .getSurfaceSnapshot(iosApp.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "TextInput",
    );
  assert.ok(input);
  assert.deepEqual(input.props.style, { color: "#abcdef" });
  await iosApp.dispose();
});

test("exposes multiline TextInput content, key, scroll, and editing events", async () => {
  const host = createRendererHost();
  const events = [];
  const editingEvents = [];
  const keys = [];
  const scrolls = [];
  const app = mount(
    () =>
      createComponent(TextInput, {
        multiline: true,
        numberOfLines: 3,
        onContentSizeChange(event) {
          events.push(event);
        },
        onEndEditing(event) {
          editingEvents.push(event);
        },
        onKeyPress(event) {
          keys.push(event);
        },
        onScroll(event) {
          scrolls.push(event);
        },
      }),
    host,
    { surface: { name: "multiline-text-input" }, autoCommit: false },
  );

  await app.root.flush();
  const input = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "TextInput",
    );
  assert.ok(input);
  assert.equal(input.props.multiline, true);
  assert.equal(input.props.numberOfLines, 3);
  assert.equal(input.props.submitBehavior, "newline");
  assert.deepEqual(input.eventListeners, [
    "blur",
    "changeText",
    "contentSizeChange",
    "endEditing",
    "focus",
    "keyPress",
    "scroll",
    "selectionChange",
  ]);

  host.injectEvent({
    surface: app.root.surfaceId,
    target: input.node,
    name: "contentSizeChange",
    payload: { contentSize: { width: 240, height: 62 } },
    priority: "default",
    bubbles: false,
  });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0]?.payload, {
    contentSize: { width: 240, height: 62 },
  });

  host.injectEvent({
    surface: app.root.surfaceId,
    target: input.node,
    name: "keyPress",
    payload: { key: "Enter", eventCount: 0 },
    priority: "discrete",
    bubbles: true,
  });
  assert.equal(keys.length, 1);
  assert.deepEqual(keys[0]?.payload, { key: "Enter", eventCount: 0 });

  host.injectEvent({
    surface: app.root.surfaceId,
    target: input.node,
    name: "scroll",
    payload: { contentOffset: { x: 0, y: 18 } },
    priority: "continuous",
    bubbles: true,
    coalescible: true,
  });
  assert.equal(scrolls.length, 1);
  assert.deepEqual(scrolls[0]?.payload, {
    contentOffset: { x: 0, y: 18 },
  });
  assert.equal(scrolls[0]?.priority, "continuous");
  assert.equal(scrolls[0]?.coalescible, true);

  host.injectEvent({
    surface: app.root.surfaceId,
    target: input.node,
    name: "endEditing",
    payload: { text: "First line\nSecond line" },
    priority: "default",
    bubbles: true,
  });
  assert.equal(editingEvents.length, 1);
  assert.deepEqual(editingEvents[0]?.payload, {
    text: "First line\nSecond line",
  });

  await app.dispose();
});

test("normalizes Image sources and enables native load events", async () => {
  const host = createRendererHost();
  const [source, setSource] = createSignal("data:image/png;base64,initial");
  const app = mount(
    () =>
      createComponent(Image, {
        get source() {
          return source();
        },
        onLoad: () => undefined,
        style: { borderRadius: 4 },
      }),
    host,
    { surface: { name: "image" }, autoCommit: false },
  );

  await app.root.flush();
  let image = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "Image",
    );
  assert.ok(image);
  assert.deepEqual(image.props, {
    source: [{ uri: "data:image/png;base64,initial" }],
    style: { overflow: "hidden", borderRadius: 4 },
    resizeMode: "cover",
    shouldNotifyLoadEvents: true,
  });
  assert.deepEqual(image.eventListeners, ["load"]);

  setSource({ uri: "memory://resized", width: 20, height: 30, scale: 2 });
  await app.root.flush();
  image = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "Image",
    );
  assert.ok(image);
  assert.deepEqual(image.props.source, [
    { uri: "memory://resized", width: 20, height: 30, scale: 2 },
  ]);
  assert.deepEqual(image.props.style, {
    width: 20,
    height: 30,
    overflow: "hidden",
    borderRadius: 4,
  });

  await app.dispose();
});

test("normalizes ActivityIndicator defaults and reactive sizing", async () => {
  const host = createRendererHost();
  const [size, setSize] = createSignal("large");
  const [animating, setAnimating] = createSignal(true);
  const app = mount(
    () =>
      createComponent(ActivityIndicator, {
        accessibilityLabel: "Loading profile",
        get animating() {
          return animating();
        },
        get size() {
          return size();
        },
        style: { marginTop: 8 },
      }),
    host,
    { surface: { name: "activity-indicator" }, autoCommit: false },
  );

  await app.root.flush();
  let snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  let indicator = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "ActivityIndicator",
  );
  assert.ok(indicator);
  assert.deepEqual(indicator.props, {
    accessibilityLabel: "Loading profile",
    animating: true,
    hidesWhenStopped: true,
    size: "large",
    style: { height: 36, width: 36 },
  });
  const container = snapshot.nodes.find(
    (node) =>
      node.kind === "element" &&
      node.component === "View" &&
      node.children.includes(indicator.node),
  );
  assert.ok(container);
  assert.deepEqual(container.props.style, {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  });

  setSize(28);
  setAnimating(false);
  await app.root.flush();
  snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  indicator = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "ActivityIndicator",
  );
  assert.ok(indicator);
  assert.equal("size" in indicator.props, false);
  assert.equal(indicator.props.animating, false);
  assert.deepEqual(indicator.props.style, { height: 28, width: 28 });

  await app.dispose();
});

test("restores a rejected controlled Switch change through a native command", async () => {
  const host = createRendererHost();
  const [value, setValue] = createSignal(false);
  const changes = [];
  const values = [];
  const app = mount(
    () =>
      createComponent(Switch, {
        accessibilityLabel: "Enable sync",
        get value() {
          return value();
        },
        thumbColor: "#ffffff",
        trackColor: { false: "#64748b", true: "#146ef5" },
        iosBackgroundColor: "#334155",
        style: { marginTop: 8 },
        onChange(event) {
          changes.push(event);
        },
        onValueChange(nextValue) {
          values.push(nextValue);
        },
      }),
    host,
    { surface: { name: "controlled-switch" }, autoCommit: false },
  );

  await app.root.flush();
  let nativeSwitch = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "Switch",
    );
  assert.ok(nativeSwitch);
  assert.deepEqual(nativeSwitch.props, {
    accessibilityLabel: "Enable sync",
    accessibilityRole: "switch",
    accessibilityState: { checked: false, disabled: false },
    disabled: false,
    iosBackgroundColor: "#334155",
    style: { alignSelf: "flex-start", marginTop: 8 },
    thumbColor: "#ffffff",
    trackColorForFalse: "#64748b",
    trackColorForTrue: "#146ef5",
    value: false,
  });
  assert.deepEqual(nativeSwitch.eventListeners, ["valueChange"]);

  const nativeChange = {
    surface: app.root.surfaceId,
    target: nativeSwitch.node,
    name: "valueChange",
    payload: { value: true },
    priority: "discrete",
    bubbles: true,
  };
  host.injectEvent(nativeChange);
  await app.root.flush();
  let commands = host.commits
    .flatMap((commit) => commit.mutations)
    .filter(
      (mutation) =>
        mutation.type === "command" && mutation.command === "setValue",
    );
  assert.deepEqual(commands.at(-1)?.args, [false]);
  assert.deepEqual(values, [true]);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].currentTarget.componentName, "Switch");

  host.injectEvent(nativeChange);
  await app.root.flush();
  commands = host.commits
    .flatMap((commit) => commit.mutations)
    .filter(
      (mutation) =>
        mutation.type === "command" && mutation.command === "setValue",
    );
  assert.equal(commands.length, 2);
  assert.deepEqual(values, [true, true]);

  setValue(true);
  await app.root.flush();
  nativeSwitch = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "Switch",
    );
  assert.ok(nativeSwitch);
  assert.equal(nativeSwitch.props.value, true);
  assert.deepEqual(nativeSwitch.props.accessibilityState, {
    checked: true,
    disabled: false,
  });

  assert.throws(
    () =>
      host.injectEvent({
        ...nativeChange,
        payload: { value: "true" },
      }),
    /boolean value/,
  );

  await app.dispose();
});

test("parks hidden Modal state and normalizes its native host contract", async () => {
  const host = createRendererHost();
  const [visible, setVisible] = createSignal(false);
  const [transparent, setTransparent] = createSignal(false);
  const events = [];
  let modalRef;
  const app = mount(
    () =>
      createComponent(Modal, {
        ref(node) {
          modalRef = node;
        },
        get visible() {
          return visible();
        },
        get transparent() {
          return transparent();
        },
        backdropColor: "#112233",
        accessibilityLabel: "Portable modal content",
        testID: "portable-modal",
        style: { padding: 24 },
        onShow(event) {
          events.push(event.name);
        },
        onRequestClose(event) {
          events.push(event.name);
          setVisible(false);
        },
        onDismiss(event) {
          events.push(event.name);
        },
        onHidden() {
          events.push("hidden");
        },
        onOrientationChange(event) {
          events.push(event.name);
        },
        get children() {
          return createComponent(Text, { children: "Modal body" });
        },
      }),
    host,
    { surface: { name: "modal-facade" }, autoCommit: false },
  );

  await app.root.flush();
  let snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  let modal = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "Modal",
  );
  assert.ok(modal);
  assert.equal(modalRef?.componentName, "Modal");
  assert.equal(modal.props.visible, false);
  assert.equal(modal.props.animationType, "none");
  assert.equal(modal.props.presentationStyle, "fullScreen");
  assert.equal(modal.props.transparent, false);
  assert.equal(modal.props.hardwareAccelerated, false);
  assert.equal(modal.props.statusBarTranslucent, false);
  assert.equal(modal.props.navigationBarTranslucent, false);
  assert.equal(modal.props.allowSwipeDismissal, false);
  assert.deepEqual(modal.props.style, { position: "absolute" });
  assert.deepEqual(modal.eventListeners, [
    "dismiss",
    "orientationChange",
    "requestClose",
    "show",
  ]);
  const parking = snapshot.nodes.find(
    (node) => node.kind === "element" && node.node === modal.parent,
  );
  assert.ok(parking);
  assert.equal(parking.component, "View");
  assert.equal(parking.parent, null);
  const content = snapshot.nodes.find(
    (node) => node.kind === "element" && node.parent === modal.node,
  );
  assert.ok(content);
  assert.equal(content.component, "View");
  assert.deepEqual(content.props, {
    accessibilityLabel: "Portable modal content",
    collapsable: false,
    style: {
      backgroundColor: "#112233",
      flex: 1,
      left: 0,
      padding: 24,
      top: 0,
    },
  });

  setVisible(true);
  await app.root.flush();
  snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  modal = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "Modal",
  );
  const root = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "RootView",
  );
  const portal = snapshot.nodes.find(
    (node) =>
      node.kind === "element" &&
      node.component === "View" &&
      node.parent === root?.node,
  );
  assert.ok(modal);
  assert.ok(portal);
  assert.equal(modal.parent, portal.node);

  host.injectEvent({
    surface: app.root.surfaceId,
    target: modal.node,
    name: "show",
    payload: {},
    priority: "default",
    bubbles: false,
  });
  host.injectEvent({
    surface: app.root.surfaceId,
    target: modal.node,
    name: "orientationChange",
    payload: { orientation: "portrait" },
    priority: "default",
    bubbles: false,
  });
  host.injectEvent({
    surface: app.root.surfaceId,
    target: modal.node,
    name: "requestClose",
    payload: {},
    priority: "default",
    bubbles: false,
  });
  await app.root.flush();
  await Promise.resolve();
  await app.root.flush();
  snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  modal = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "Modal",
  );
  assert.ok(modal);
  assert.equal(modal.parent, parking.node);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, [
    "show",
    "orientationChange",
    "requestClose",
    "hidden",
  ]);

  // The parked node deliberately keeps its event route alive until UIKit's
  // asynchronous dismissal completion arrives.
  host.injectEvent({
    surface: app.root.surfaceId,
    target: modal.node,
    name: "dismiss",
    payload: {},
    priority: "default",
    bubbles: false,
  });
  assert.deepEqual(events, [
    "show",
    "orientationChange",
    "requestClose",
    "hidden",
    "dismiss",
  ]);

  setTransparent(true);
  setVisible(true);
  await app.root.flush();
  snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  modal = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "Modal",
  );
  assert.ok(modal);
  assert.equal(modal.props.presentationStyle, "overFullScreen");
  assert.equal(modal.props.transparent, true);
  const transparentContent = snapshot.nodes.find(
    (node) => node.kind === "element" && node.parent === modal.node,
  );
  assert.ok(transparentContent);
  assert.equal(transparentContent.props.style.backgroundColor, "transparent");

  await app.dispose();
});

test("retains an iOS Modal event route until UIKit completes dismissal", async () => {
  const host = new InMemoryHost({
    descriptors: CORE_COMPONENT_DESCRIPTORS,
    platform: "ios",
  });
  const [visible, setVisible] = createSignal(true);
  const events = [];
  const app = mount(
    () =>
      createComponent(Modal, {
        animationType: "fade",
        get visible() {
          return visible();
        },
        onDismiss: () => events.push("dismiss"),
        onHidden: () => events.push("hidden"),
        children: createComponent(Text, { children: "iOS modal" }),
      }),
    host,
    { surface: { name: "ios-modal-dismissal" }, autoCommit: false },
  );

  await app.root.flush();
  let snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  let modal = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "Modal",
  );
  const root = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "RootView",
  );
  const portal = snapshot.nodes.find(
    (node) =>
      node.kind === "element" &&
      node.component === "View" &&
      node.parent === root?.node,
  );
  assert.ok(modal);
  assert.ok(portal);
  assert.equal(modal.parent, portal.node);

  setVisible(false);
  await app.root.flush();
  await Promise.resolve();
  await app.root.flush();
  snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  modal = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "Modal",
  );
  assert.ok(modal);
  assert.equal(modal.props.visible, false);
  assert.equal(modal.parent, portal.node);

  host.injectEvent({
    surface: app.root.surfaceId,
    target: modal.node,
    name: "dismiss",
    payload: {},
    priority: "default",
    bubbles: false,
  });
  await app.root.flush();
  snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  modal = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "Modal",
  );
  assert.ok(modal);
  const parking = snapshot.nodes.find(
    (node) =>
      node.kind === "element" &&
      node.component === "View" &&
      node.node === modal.parent,
  );
  assert.ok(parking);
  assert.equal(parking.parent, null);
  assert.equal(modal.parent, parking.node);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["dismiss", "hidden"]);

  await app.dispose();
});

test("normalizes an iOS interactive Modal dismissal into one portable lifecycle", async () => {
  const host = new InMemoryHost({
    descriptors: CORE_COMPONENT_DESCRIPTORS,
    platform: "ios",
  });
  const [visible, setVisible] = createSignal(true);
  const events = [];
  const app = mount(
    () =>
      createComponent(Modal, {
        allowSwipeDismissal: true,
        get visible() {
          return visible();
        },
        onRequestClose: () => {
          events.push("requestClose");
          setVisible(false);
        },
        onDismiss: () => events.push("dismiss"),
        onHidden: () => events.push("hidden"),
        children: createComponent(Text, { children: "Swipe modal" }),
      }),
    host,
    { surface: { name: "ios-modal-swipe-dismissal" }, autoCommit: false },
  );

  const modal = () =>
    host
      .getSurfaceSnapshot(app.root.surfaceId)
      .nodes.find(
        (node) => node.kind === "element" && node.component === "Modal",
      );
  await app.root.flush();
  const nativeModal = modal();
  assert.ok(nativeModal);

  const requestClose = () =>
    host.injectEvent({
      surface: app.root.surfaceId,
      target: nativeModal.node,
      name: "requestClose",
      payload: {},
      priority: "default",
      bubbles: false,
    });
  const dismiss = () =>
    host.injectEvent({
      surface: app.root.surfaceId,
      target: nativeModal.node,
      name: "dismiss",
      payload: {},
      priority: "default",
      bubbles: false,
    });

  requestClose();
  await app.root.flush();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["requestClose", "dismiss", "hidden"]);
  const parking = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) =>
        node.kind === "element" &&
        node.component === "View" &&
        node.node === modal()?.parent,
    );
  assert.ok(parking);
  assert.equal(parking.parent, null);

  // React Native may still deliver its ordinary dismiss event after the
  // requestClose signal used for an interactive UIKit dismissal.
  dismiss();
  await app.root.flush();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["requestClose", "dismiss", "hidden"]);

  setVisible(true);
  await app.root.flush();
  requestClose();
  await app.root.flush();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, [
    "requestClose",
    "dismiss",
    "hidden",
    "requestClose",
    "dismiss",
    "hidden",
  ]);

  await app.dispose();
});

test("routes keyed standalone modals through NativeHistory", async () => {
  const host = createRendererHost();
  const history = new NativeHistory({ initialHref: "/" });
  const creations = new Map();
  const disposals = new Map();
  const shown = [];
  const requests = [];
  const hidden = [];
  const hiddenBeforeDisposal = [];
  const blocked = [];
  const completed = [];
  const app = mount(
    () =>
      createComponent(NativeModalStack, {
        history,
        defaultModalOptions: {
          accessibilityLabel: "Routed modal",
          allowSwipeDismissal: true,
          animationType: "fade",
          backdropColor: "#0f172a",
          style: { padding: 24 },
        },
        modalOptions: (entry) =>
          entry.href === "/edit"
            ? { presentationStyle: "formSheet", testID: "edit-modal" }
            : {},
        onModalShow: (entry) => shown.push(entry.href),
        onModalRequestClose: (entry) => requests.push(entry.href),
        onModalHidden: (entry) => {
          hidden.push(entry.href);
          hiddenBeforeDisposal.push(disposals.get(entry.id));
        },
        onPlatformBack: (transition) => completed.push(transition),
        onPlatformBackBlocked: (entry) => blocked.push(entry.href),
        children: (entry, _index, isFocused) => {
          const entryId = entry().id;
          creations.set(entryId, (creations.get(entryId) ?? 0) + 1);
          onCleanup(() => {
            disposals.set(entryId, (disposals.get(entryId) ?? 0) + 1);
          });
          return createComponent(Text, {
            get children() {
              return `${entry().href}:${isFocused() ? "focused" : "inactive"}`;
            },
          });
        },
      }),
    host,
    { surface: { name: "native-modal-routing" }, autoCommit: false },
  );

  const snapshot = () => host.getSurfaceSnapshot(app.root.surfaceId);
  const modal = () =>
    snapshot().nodes.find(
      (node) => node.kind === "element" && node.component === "Modal",
    );
  const texts = () =>
    snapshot()
      .nodes.filter((node) => node.kind === "text")
      .map((node) => node.text);
  await app.root.flush();
  const rootId = history.location.id;
  assert.deepEqual(texts(), ["/:focused"]);
  assert.equal(creations.get(rootId), 1);

  const pushed = history.push("/edit", { item: 42 });
  assert.equal(history.pendingApplicationTransitionCount, 1);
  await app.root.flush();
  const editId = pushed.to.id;
  const nativeModal = modal();
  assert.ok(nativeModal);
  assert.equal(nativeModal.props.visible, true);
  assert.equal(nativeModal.props.allowSwipeDismissal, true);
  assert.equal(nativeModal.props.animationType, "fade");
  assert.equal(nativeModal.props.presentationStyle, "formSheet");
  assert.equal(nativeModal.props.testID, "edit-modal");
  assert.deepEqual(texts(), ["/:inactive", "/edit:focused"]);
  assert.equal(creations.get(rootId), 1);
  assert.equal(creations.get(editId), 1);
  host.injectEvent({
    surface: app.root.surfaceId,
    target: nativeModal.node,
    name: "show",
    payload: {},
    priority: "default",
    bubbles: false,
  });
  assert.equal(history.pendingApplicationTransitionCount, 0);
  assert.deepEqual(shown, ["/edit"]);

  const unblock = history.blockPlatformTransitions(() => true);
  await app.root.flush();
  assert.equal(modal()?.props.allowSwipeDismissal, false);
  host.injectEvent({
    surface: app.root.surfaceId,
    target: nativeModal.node,
    name: "requestClose",
    payload: {},
    priority: "default",
    bubbles: false,
  });
  await new Promise((resolve) => setImmediate(resolve));
  await app.root.flush();
  assert.equal(history.location.href, "/edit");
  assert.equal(history.hasPendingPlatformTransition, false);
  assert.equal(modal()?.props.visible, true);
  assert.deepEqual(requests, ["/edit"]);
  assert.deepEqual(blocked, ["/edit"]);
  assert.equal(disposals.get(editId), undefined);

  unblock();
  await app.root.flush();
  assert.equal(modal()?.props.allowSwipeDismissal, true);
  host.injectEvent({
    surface: app.root.surfaceId,
    target: nativeModal.node,
    name: "requestClose",
    payload: {},
    priority: "default",
    bubbles: false,
  });
  await new Promise((resolve) => setImmediate(resolve));
  await app.root.flush();
  assert.equal(history.location.href, "/");

  await Promise.resolve();
  await app.root.flush();
  await new Promise((resolve) => setImmediate(resolve));
  await app.root.flush();
  assert.equal(modal(), undefined);
  assert.deepEqual(texts(), ["/:focused"]);
  assert.equal(disposals.get(editId), 1);
  assert.equal(disposals.get(rootId), undefined);
  assert.deepEqual(requests, ["/edit", "/edit"]);
  assert.deepEqual(hidden, ["/edit"]);
  assert.deepEqual(hiddenBeforeDisposal, [undefined]);
  assert.equal(completed.length, 1);
  assert.equal(completed[0].origin, "platform");

  const second = history.push("/confirm");
  await app.root.flush();
  const secondModal = modal();
  assert.ok(secondModal);
  host.injectEvent({
    surface: app.root.surfaceId,
    target: secondModal.node,
    name: "show",
    payload: {},
    priority: "default",
    bubbles: false,
  });
  assert.equal(history.pendingApplicationTransitionCount, 0);
  history.back();
  assert.equal(history.pendingApplicationTransitionCount, 1);
  await app.root.flush();
  assert.equal(modal()?.props.visible, false);
  assert.equal(disposals.get(second.to.id), undefined);
  await Promise.resolve();
  await app.root.flush();
  await new Promise((resolve) => setImmediate(resolve));
  await app.root.flush();
  assert.equal(history.pendingApplicationTransitionCount, 0);
  assert.equal(disposals.get(second.to.id), 1);

  const pendingAtDisposal = history.push("/dispose-pending");
  await app.root.flush();
  assert.equal(history.pendingApplicationTransitionCount, 1);
  await app.dispose();
  assert.equal(history.pendingApplicationTransitionCount, 0);
  assert.equal(
    history.acknowledgeApplicationTransition(pendingAtDisposal.id),
    false,
  );
  assert.equal(disposals.get(rootId), 1);
  assert.equal(disposals.get(pendingAtDisposal.to.id), 1);
});

test("nests standalone modal routes and serializes a multi-pop through native hidden boundaries", async () => {
  const host = createRendererHost("ios");
  const history = new NativeHistory({ initialHref: "/" });
  const creations = new Map();
  const disposals = new Map();
  const shown = [];
  const dismissed = [];
  const hidden = [];
  const hiddenBeforeDisposal = [];
  const app = mount(
    () =>
      createComponent(NativeModalStack, {
        history,
        modalOptions: (entry) => ({
          allowSwipeDismissal: true,
          presentationStyle: "pageSheet",
          testID: `modal-${entry.href.slice(1)}`,
        }),
        onModalShow: (entry) => shown.push(entry.href),
        onModalDismiss: (entry) => dismissed.push(entry.href),
        onModalHidden: (entry) => {
          hidden.push(entry.href);
          hiddenBeforeDisposal.push(disposals.get(entry.id));
        },
        children: (entry, _index, isFocused) => {
          const id = entry().id;
          creations.set(id, (creations.get(id) ?? 0) + 1);
          onCleanup(() => {
            disposals.set(id, (disposals.get(id) ?? 0) + 1);
          });
          return createComponent(Text, {
            get children() {
              return `${entry().href}:${isFocused() ? "focused" : "inactive"}`;
            },
          });
        },
      }),
    host,
    { surface: { name: "nested-native-modal-routing" }, autoCommit: false },
  );

  const snapshot = () => host.getSurfaceSnapshot(app.root.surfaceId);
  const modal = (testID) =>
    snapshot().nodes.find(
      (node) =>
        node.kind === "element" &&
        node.component === "Modal" &&
        node.props.testID === testID,
    );
  const injectModalEvent = (target, name) =>
    host.injectEvent({
      surface: app.root.surfaceId,
      target: target.node,
      name,
      payload: {},
      priority: "default",
      bubbles: false,
    });
  const settleHidden = async () => {
    await app.root.flush();
    await new Promise((resolve) => setImmediate(resolve));
    await app.root.flush();
  };

  await app.root.flush();
  const rootId = history.location.id;
  const firstPush = history.push("/first");
  const secondPush = history.push("/second");
  assert.equal(history.pendingApplicationTransitionCount, 2);
  await app.root.flush();

  const firstModal = modal("modal-first");
  const secondModal = modal("modal-second");
  assert.ok(firstModal);
  assert.ok(secondModal);
  const nodesById = new Map(snapshot().nodes.map((node) => [node.node, node]));
  const secondAncestors = [];
  let parent = secondModal.parent;
  while (parent !== null) {
    secondAncestors.push(parent);
    parent = nodesById.get(parent)?.parent ?? null;
  }
  assert.ok(
    secondAncestors.includes(firstModal.node),
    "The second native Modal must be presented from inside the first Modal hierarchy.",
  );
  assert.equal(firstModal.props.visible, true);
  assert.equal(secondModal.props.visible, true);
  assert.equal(creations.get(rootId), 1);
  assert.equal(creations.get(firstPush.to.id), 1);
  assert.equal(creations.get(secondPush.to.id), 1);

  injectModalEvent(firstModal, "show");
  assert.equal(
    history.pendingApplicationTransitionCount,
    2,
    "The parent show must not acknowledge an unshown nested modal.",
  );
  injectModalEvent(secondModal, "show");
  assert.equal(history.pendingApplicationTransitionCount, 0);
  assert.deepEqual(shown, ["/first", "/second"]);

  history.back(2);
  assert.equal(history.location.href, "/");
  assert.equal(history.pendingApplicationTransitionCount, 1);
  await app.root.flush();
  assert.equal(modal("modal-first")?.props.visible, true);
  assert.equal(modal("modal-second")?.props.visible, false);
  assert.equal(disposals.get(firstPush.to.id), undefined);
  assert.equal(disposals.get(secondPush.to.id), undefined);

  injectModalEvent(secondModal, "dismiss");
  await settleHidden();
  assert.equal(modal("modal-second"), undefined);
  assert.equal(modal("modal-first")?.props.visible, false);
  assert.equal(history.pendingApplicationTransitionCount, 1);
  assert.equal(disposals.get(secondPush.to.id), 1);
  assert.equal(disposals.get(firstPush.to.id), undefined);

  const remainingModal = modal("modal-first");
  assert.ok(remainingModal);
  injectModalEvent(remainingModal, "dismiss");
  await settleHidden();
  assert.equal(modal("modal-first"), undefined);
  assert.equal(history.pendingApplicationTransitionCount, 0);
  assert.equal(disposals.get(firstPush.to.id), 1);
  assert.equal(disposals.get(rootId), undefined);
  assert.deepEqual(dismissed, ["/second", "/first"]);
  assert.deepEqual(hidden, ["/second", "/first"]);
  assert.deepEqual(hiddenBeforeDisposal, [undefined, undefined]);

  await app.dispose();
  assert.equal(disposals.get(rootId), 1);
});

test("defers a replacement modal stack until the retired native hierarchy is hidden", async () => {
  const host = createRendererHost("ios");
  const history = new NativeHistory({ initialHref: "/old-root" });
  const creations = new Map();
  const disposals = new Map();
  const hidden = [];
  const app = mount(
    () =>
      createComponent(NativeModalStack, {
        history,
        modalOptions: (entry) => ({
          allowSwipeDismissal: true,
          presentationStyle: "pageSheet",
          testID: `modal-${entry.id}`,
        }),
        onModalHidden: (entry) => hidden.push(entry.id),
        children: (entry) => {
          const id = entry().id;
          creations.set(id, (creations.get(id) ?? 0) + 1);
          onCleanup(() => {
            disposals.set(id, (disposals.get(id) ?? 0) + 1);
          });
          return createComponent(Text, { children: entry().href });
        },
      }),
    host,
    {
      surface: { name: "replacement-native-modal-routing" },
      autoCommit: false,
    },
  );

  const snapshot = () => host.getSurfaceSnapshot(app.root.surfaceId);
  const modal = (entryId) =>
    snapshot().nodes.find(
      (node) =>
        node.kind === "element" &&
        node.component === "Modal" &&
        node.props.testID === `modal-${entryId}`,
    );
  const injectModalEvent = (target, name) =>
    host.injectEvent({
      surface: app.root.surfaceId,
      target: target.node,
      name,
      payload: {},
      priority: "default",
      bubbles: false,
    });
  const settleHidden = async () => {
    await app.root.flush();
    await new Promise((resolve) => setImmediate(resolve));
    await app.root.flush();
  };

  await app.root.flush();
  const oldRootId = history.location.id;
  const first = history.push("/first");
  await app.root.flush();
  const firstModal = modal(first.to.id);
  assert.ok(firstModal);
  injectModalEvent(firstModal, "show");
  const second = history.push("/second");
  await app.root.flush();
  const secondModal = modal(second.to.id);
  assert.ok(secondModal);
  injectModalEvent(secondModal, "show");
  assert.equal(history.pendingApplicationTransitionCount, 0);

  const reset = history.reset(
    [
      { href: "/new-root", state: null },
      { href: "/replacement", state: null },
    ],
    1,
  );
  const replacementId = reset.to.id;
  const newRootId = history.snapshot.entries[0].id;
  assert.equal(history.pendingApplicationTransitionCount, 1);
  await app.root.flush();
  assert.equal(modal(first.to.id)?.props.visible, true);
  assert.equal(modal(second.to.id)?.props.visible, false);
  assert.equal(modal(replacementId), undefined);
  assert.equal(disposals.get(oldRootId), 1);
  assert.equal(creations.get(newRootId), 1);

  injectModalEvent(secondModal, "dismiss");
  await settleHidden();
  assert.equal(modal(second.to.id), undefined);
  assert.equal(modal(first.to.id)?.props.visible, false);
  assert.equal(modal(replacementId), undefined);
  assert.equal(history.pendingApplicationTransitionCount, 1);
  assert.equal(disposals.get(second.to.id), 1);
  assert.equal(disposals.get(first.to.id), undefined);

  const remainingModal = modal(first.to.id);
  assert.ok(remainingModal);
  injectModalEvent(remainingModal, "dismiss");
  await settleHidden();
  const replacementModal = modal(replacementId);
  assert.ok(replacementModal);
  assert.equal(replacementModal.props.visible, true);
  assert.equal(modal(first.to.id), undefined);
  assert.equal(disposals.get(first.to.id), 1);
  assert.equal(creations.get(replacementId), 1);
  assert.equal(history.pendingApplicationTransitionCount, 1);
  assert.deepEqual(hidden, [second.to.id, first.to.id]);

  injectModalEvent(replacementModal, "show");
  assert.equal(history.pendingApplicationTransitionCount, 0);
  await app.dispose();
  assert.equal(disposals.get(newRootId), 1);
  assert.equal(disposals.get(replacementId), 1);
});

test("re-presents a modal only after an in-flight application dismissal is hidden", async () => {
  const host = createRendererHost("ios");
  const history = new NativeHistory({ initialHref: "/" });
  let modalCreations = 0;
  let modalDisposals = 0;
  let hidden = 0;
  const app = mount(
    () =>
      createComponent(NativeModalStack, {
        history,
        defaultModalOptions: {
          allowSwipeDismissal: true,
          presentationStyle: "pageSheet",
          testID: "reentrant-modal",
        },
        onModalHidden: () => hidden++,
        children: (entry) => {
          if (entry().href === "/modal") {
            modalCreations++;
            onCleanup(() => modalDisposals++);
          }
          return createComponent(Text, { children: entry().href });
        },
      }),
    host,
    { surface: { name: "reentrant-native-modal" }, autoCommit: false },
  );

  const modal = () =>
    host
      .getSurfaceSnapshot(app.root.surfaceId)
      .nodes.find(
        (node) =>
          node.kind === "element" &&
          node.component === "Modal" &&
          node.props.testID === "reentrant-modal",
      );
  const injectModalEvent = (target, name) =>
    host.injectEvent({
      surface: app.root.surfaceId,
      target: target.node,
      name,
      payload: {},
      priority: "default",
      bubbles: false,
    });

  await app.root.flush();
  history.push("/modal");
  await app.root.flush();
  const nativeModal = modal();
  assert.ok(nativeModal);
  injectModalEvent(nativeModal, "show");
  assert.equal(history.pendingApplicationTransitionCount, 0);

  history.back();
  history.forward();
  assert.equal(history.location.href, "/modal");
  assert.equal(history.pendingApplicationTransitionCount, 2);
  await app.root.flush();
  assert.equal(modal()?.node, nativeModal.node);
  assert.equal(modal()?.props.visible, false);
  assert.equal(modalCreations, 1);
  assert.equal(modalDisposals, 0);

  injectModalEvent(nativeModal, "dismiss");
  await app.root.flush();
  await new Promise((resolve) => setImmediate(resolve));
  await app.root.flush();
  const representedModal = modal();
  assert.ok(representedModal);
  assert.equal(representedModal.node, nativeModal.node);
  assert.equal(representedModal.props.visible, true);
  assert.equal(history.location.href, "/modal");
  assert.equal(history.pendingApplicationTransitionCount, 2);
  assert.equal(hidden, 1);
  assert.equal(modalCreations, 1);
  assert.equal(modalDisposals, 0);

  injectModalEvent(representedModal, "show");
  assert.equal(history.pendingApplicationTransitionCount, 0);
  await app.dispose();
  assert.equal(modalDisposals, 1);
});

test("retains a restored iOS modal route through dismissal completion", async () => {
  const host = createRendererHost("ios");
  const history = new NativeHistory({
    snapshot: {
      entries: [
        { id: "restored-root", href: "/", state: null },
        { id: "restored-modal", href: "/restored", state: null },
      ],
      index: 1,
    },
  });
  const disposals = new Map();
  const hidden = [];
  const app = mount(
    () =>
      createComponent(NativeModalStack, {
        history,
        defaultModalOptions: {
          allowSwipeDismissal: true,
          animationType: "slide",
          presentationStyle: "pageSheet",
        },
        onModalHidden: (entry) => hidden.push(entry.id),
        children: (entry, _index, isFocused) => {
          const id = entry().id;
          onCleanup(() => {
            disposals.set(id, (disposals.get(id) ?? 0) + 1);
          });
          return createComponent(Text, {
            get children() {
              return `${entry().href}:${isFocused() ? "focused" : "inactive"}`;
            },
          });
        },
      }),
    host,
    { surface: { name: "restored-ios-modal-routing" }, autoCommit: false },
  );

  await app.root.flush();
  let snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  let modal = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "Modal",
  );
  assert.ok(modal);
  assert.equal(modal.props.visible, true);
  assert.equal(modal.props.presentationStyle, "pageSheet");
  assert.deepEqual(
    snapshot.nodes
      .filter((node) => node.kind === "text")
      .map((node) => node.text),
    ["/:inactive", "/restored:focused"],
  );

  history.back();
  assert.equal(history.pendingApplicationTransitionCount, 1);
  await app.root.flush();
  snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  modal = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "Modal",
  );
  assert.ok(modal);
  assert.equal(modal.props.visible, false);
  assert.equal(disposals.get("restored-modal"), undefined);
  host.injectEvent({
    surface: app.root.surfaceId,
    target: modal.node,
    name: "dismiss",
    payload: {},
    priority: "default",
    bubbles: false,
  });
  await app.root.flush();
  await new Promise((resolve) => setImmediate(resolve));
  await app.root.flush();
  snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  assert.equal(
    snapshot.nodes.some(
      (node) => node.kind === "element" && node.component === "Modal",
    ),
    false,
  );
  assert.equal(history.pendingApplicationTransitionCount, 0);
  assert.equal(disposals.get("restored-modal"), 1);
  assert.deepEqual(hidden, ["restored-modal"]);

  const nativeDismissed = history.push("/native-dismissed");
  await app.root.flush();
  snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  modal = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "Modal",
  );
  assert.ok(modal);
  host.injectEvent({
    surface: app.root.surfaceId,
    target: modal.node,
    name: "show",
    payload: {},
    priority: "default",
    bubbles: false,
  });
  assert.equal(history.pendingApplicationTransitionCount, 0);
  host.injectEvent({
    surface: app.root.surfaceId,
    target: modal.node,
    name: "dismiss",
    payload: {},
    priority: "default",
    bubbles: false,
  });
  assert.equal(history.location.href, "/");
  assert.equal(history.hasPendingPlatformTransition, false);
  await app.root.flush();
  await new Promise((resolve) => setImmediate(resolve));
  await app.root.flush();
  assert.equal(disposals.get(nativeDismissed.to.id), 1);
  assert.deepEqual(hidden, ["restored-modal", nativeDismissed.to.id]);

  await app.dispose();
  assert.equal(disposals.get("restored-root"), 1);
});

test("forwards reactive accessibility semantics to native components", async () => {
  const host = createRendererHost();
  const [disabled, setDisabled] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const actions = [];
  const gestures = [];
  const app = mount(
    () =>
      createComponent(Pressable, {
        accessible: true,
        accessibilityLabel: "Run update",
        accessibilityHint: "Updates the native status",
        accessibilityRole: "button",
        accessibilityActions: [
          { name: "activate" },
          { name: "archive", label: "Archive update" },
        ],
        accessibilityLiveRegion: "polite",
        accessibilityValue: { min: 0, max: 10, now: 4 },
        importantForAccessibility: "yes",
        get accessibilityState() {
          return { disabled: disabled(), busy: busy() };
        },
        onAccessibilityAction: (event) =>
          actions.push(event.payload.actionName),
        onAccessibilityEscape: (event) => gestures.push(event.name),
        onAccessibilityTap: (event) => gestures.push(event.name),
        onMagicTap: (event) => gestures.push(event.name),
        onPress: () => undefined,
      }),
    host,
    { surface: { name: "accessibility" }, autoCommit: false },
  );

  await app.root.flush();
  let pressable = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "Pressable",
    );
  assert.ok(pressable);
  assert.deepEqual(pressable.props, {
    accessible: true,
    accessibilityLabel: "Run update",
    accessibilityHint: "Updates the native status",
    accessibilityRole: "button",
    accessibilityActions: [
      { name: "activate" },
      { name: "archive", label: "Archive update" },
    ],
    accessibilityLiveRegion: "polite",
    accessibilityValue: { min: 0, max: 10, now: 4 },
    accessibilityState: { disabled: false, busy: false },
    collapsable: false,
    focusable: true,
    importantForAccessibility: "yes",
    pointerEvents: "box-only",
  });
  assert.deepEqual(pressable.eventListeners, [
    "accessibilityAction",
    "accessibilityEscape",
    "accessibilityTap",
    "layout",
    "magicTap",
    "press",
    "pressCancel",
    "pressIn",
    "pressMove",
    "pressOut",
  ]);

  host.injectEvent({
    surface: app.root.surfaceId,
    target: pressable.node,
    name: "accessibilityAction",
    priority: "discrete",
    bubbles: false,
    payload: { actionName: "archive" },
  });
  assert.deepEqual(actions, ["archive"]);

  for (const name of ["accessibilityEscape", "accessibilityTap", "magicTap"]) {
    host.injectEvent({
      surface: app.root.surfaceId,
      target: pressable.node,
      name,
      priority: "discrete",
      bubbles: false,
    });
  }
  assert.deepEqual(gestures, [
    "accessibilityEscape",
    "accessibilityTap",
    "magicTap",
  ]);

  setDisabled(true);
  setBusy(true);
  const update = await app.root.flush();
  assert.ok(update);
  pressable = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "Pressable",
    );
  assert.deepEqual(pressable?.props.accessibilityState, {
    disabled: true,
    busy: true,
  });

  await app.dispose();
});

test("composes a reactive platform Button without adding a native descriptor", async () => {
  const host = createRendererHost("android");
  const [title, setTitle] = createSignal("Save draft");
  const [color, setColor] = createSignal("#2563eb");
  const [disabled, setDisabled] = createSignal(false);
  let presses = 0;
  const app = mount(
    () =>
      createComponent(Button, {
        get title() {
          return title();
        },
        get color() {
          return color();
        },
        get disabled() {
          return disabled();
        },
        onPress: () => presses++,
        style: (state) => ({ borderWidth: state.pressed ? 2 : 1 }),
        textStyle: { letterSpacing: 1 },
      }),
    host,
    { surface: { name: "button-composition" }, autoCommit: false },
  );

  await app.root.flush();
  let snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  const pressable = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "Pressable",
  );
  const text = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "Text",
  );
  assert.ok(pressable);
  assert.ok(text);
  assert.equal(
    snapshot.nodes.some(
      (node) => node.kind === "element" && node.component === "Button",
    ),
    false,
  );
  assert.equal(
    CORE_COMPONENT_DESCRIPTORS.some(
      (descriptor) => descriptor.name === "Button",
    ),
    false,
  );
  assert.equal(
    snapshot.nodes.find((node) => node.kind === "text")?.text,
    "SAVE DRAFT",
  );
  assert.equal(pressable.props.accessibilityRole, "button");
  assert.equal(pressable.props.accessibilityLabel, "Save draft");
  assert.deepEqual(pressable.props.accessibilityState, { disabled: false });
  assert.deepEqual(pressable.props.style, {
    elevation: 4,
    backgroundColor: "#2563eb",
    borderRadius: 2,
    borderWidth: 1,
  });
  assert.deepEqual(pressable.props.nativeBackgroundAndroid, {
    type: "RippleAndroid",
    color: "#ffffff33",
    borderless: false,
    rippleRadius: null,
    alpha: null,
  });
  assert.deepEqual(text.props.style, {
    color: "#ffffff",
    fontWeight: "500",
    margin: 8,
    textAlign: "center",
    letterSpacing: 1,
  });

  for (const name of ["pressIn", "pressOut", "press"]) {
    host.injectEvent({
      surface: app.root.surfaceId,
      target: pressable.node,
      name,
      priority: "discrete",
      bubbles: true,
    });
  }
  await app.root.flush();
  assert.equal(presses, 1);

  setTitle("Publish now");
  setColor("#16a34a");
  setDisabled(true);
  await app.root.flush();
  snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  assert.equal(
    snapshot.nodes.find((node) => node.kind === "text")?.text,
    "PUBLISH NOW",
  );
  const updatedPressable = snapshot.nodes.find(
    (node) => node.kind === "element" && node.node === pressable.node,
  );
  const updatedText = snapshot.nodes.find(
    (node) => node.kind === "element" && node.node === text.node,
  );
  assert.equal(updatedPressable?.props.accessibilityLabel, "Publish now");
  assert.deepEqual(updatedPressable?.props.accessibilityState, {
    disabled: true,
  });
  assert.deepEqual(updatedPressable?.props.style, {
    elevation: 0,
    backgroundColor: "#dfdfdf",
    borderRadius: 2,
    borderWidth: 1,
  });
  assert.equal(updatedText?.props.style.color, "#a1a1a1");
  await app.dispose();

  const iosHost = createRendererHost("ios");
  const iosApp = mount(
    () =>
      createComponent(Button, {
        title: "Save draft",
        color: "#7c3aed",
        onPress: () => undefined,
      }),
    iosHost,
    { surface: { name: "button-composition-ios" }, autoCommit: false },
  );
  await iosApp.root.flush();
  let iosSnapshot = iosHost.getSurfaceSnapshot(iosApp.root.surfaceId);
  const iosPressable = iosSnapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "Pressable",
  );
  assert.ok(iosPressable);
  assert.equal(
    iosSnapshot.nodes.find((node) => node.kind === "text")?.text,
    "Save draft",
  );
  assert.equal(iosPressable.props.nativeBackgroundAndroid, undefined);
  assert.equal(
    iosSnapshot.nodes.find(
      (node) => node.kind === "element" && node.component === "Text",
    )?.props.style.color,
    "#7c3aed",
  );
  iosHost.injectEvent({
    surface: iosApp.root.surfaceId,
    target: iosPressable.node,
    name: "pressIn",
    priority: "discrete",
    bubbles: true,
  });
  await iosApp.root.flush();
  iosSnapshot = iosHost.getSurfaceSnapshot(iosApp.root.surfaceId);
  assert.equal(
    iosSnapshot.nodes.find(
      (node) => node.kind === "element" && node.node === iosPressable.node,
    )?.props.style.opacity,
    0.65,
  );
  await iosApp.dispose();
});

test("owns Pressable feedback, disabled behavior, and long-press timing", async () => {
  const host = createRendererHost();
  const records = [];
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
  });
  const [disabled, setDisabled] = createSignal(false);
  const calls = [];
  const focusCalls = [];
  const app = mount(
    () =>
      createComponent(Pressable, {
        get disabled() {
          return disabled();
        },
        delayLongPress: 50,
        unstable_pressDelay: 10,
        style: (state) => ({ opacity: state.pressed ? 0.4 : 1 }),
        children: (state) =>
          createComponent(Text, {
            get children() {
              return state.pressed ? "Pressed" : "Ready";
            },
          }),
        onPressIn: (event) => calls.push(event.name),
        onPressOut: (event) => calls.push(event.name),
        onLongPress: (event) => calls.push(event.name),
        onPress: (event) => calls.push(event.name),
        onFocus: (event) => focusCalls.push(event.name),
        onBlur: (event) => focusCalls.push(event.name),
      }),
    host,
    {
      surface: { name: "pressable-semantics" },
      autoCommit: false,
      telemetry,
    },
  );

  await app.root.flush();
  let snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  const pressable = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "Pressable",
  );
  assert.ok(pressable);
  assert.equal(pressable.props.pointerEvents, "box-only");
  assert.deepEqual(pressable.props, {
    accessible: true,
    accessibilityState: { disabled: false },
    collapsable: false,
    focusable: true,
    pointerEvents: "box-only",
    style: { opacity: 1 },
  });
  assert.deepEqual(pressable.eventListeners, [
    "blur",
    "focus",
    "layout",
    "press",
    "pressCancel",
    "pressIn",
    "pressMove",
    "pressOut",
  ]);

  for (const name of ["focus", "blur"]) {
    host.injectEvent({
      surface: app.root.surfaceId,
      target: pressable.node,
      name,
      priority: "default",
      bubbles: false,
    });
  }
  assert.deepEqual(focusCalls, ["focus", "blur"]);

  host.injectEvent({
    surface: app.root.surfaceId,
    target: pressable.node,
    name: "pressIn",
    payload: { pointerType: "touch" },
    priority: "discrete",
    bubbles: true,
  });
  await app.root.flush();
  assert.deepEqual(calls, []);
  snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  assert.deepEqual(
    snapshot.nodes.find((node) => node.node === pressable.node)?.props.style,
    { opacity: 1 },
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  await app.root.flush();
  snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  assert.deepEqual(
    snapshot.nodes.find((node) => node.node === pressable.node)?.props.style,
    { opacity: 0.4 },
  );
  assert.equal(
    snapshot.nodes.find((node) => node.kind === "text")?.text,
    "Pressed",
  );
  assert.deepEqual(calls, ["pressIn"]);
  assert.ok(
    records.some(
      (record) =>
        record.type === "operation-started" &&
        record.name === "solid-native.event" &&
        record.attributes["event.name"] === "pressable.delayed-press-in" &&
        record.attributes["event.priority"] === "discrete" &&
        record.attributes["event.source"] === "platform",
    ),
  );

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(calls, ["pressIn", "longPress"]);
  assert.ok(
    records.some(
      (record) =>
        record.type === "operation-started" &&
        record.name === "solid-native.event" &&
        record.attributes["event.name"] === "pressable.long-press" &&
        record.attributes["event.priority"] === "discrete" &&
        record.attributes["event.source"] === "platform",
    ),
  );

  host.injectEvent({
    surface: app.root.surfaceId,
    target: pressable.node,
    name: "pressOut",
    priority: "discrete",
    bubbles: true,
  });
  host.injectEvent({
    surface: app.root.surfaceId,
    target: pressable.node,
    name: "press",
    priority: "discrete",
    bubbles: true,
  });
  await app.root.flush();
  assert.deepEqual(calls, ["pressIn", "longPress", "pressOut"]);

  setDisabled(true);
  await app.root.flush();
  snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  assert.deepEqual(
    snapshot.nodes.find((node) => node.node === pressable.node)?.props
      .accessibilityState,
    { disabled: true },
  );
  assert.deepEqual(
    snapshot.nodes.find((node) => node.node === pressable.node)?.props.style,
    { opacity: 1 },
  );
  for (const name of ["pressIn", "pressOut", "press"]) {
    host.injectEvent({
      surface: app.root.surfaceId,
      target: pressable.node,
      name,
      priority: "discrete",
      bubbles: true,
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(calls, ["pressIn", "longPress", "pressOut"]);

  setDisabled(false);
  await app.root.flush();
  for (const name of ["pressIn", "pressOut", "press"]) {
    host.injectEvent({
      surface: app.root.surfaceId,
      target: pressable.node,
      name,
      priority: "discrete",
      bubbles: true,
    });
  }
  await app.root.flush();
  assert.deepEqual(calls, [
    "pressIn",
    "longPress",
    "pressOut",
    "pressIn",
    "pressOut",
    "press",
  ]);

  host.injectEvent({
    surface: app.root.surfaceId,
    target: pressable.node,
    name: "pressIn",
    priority: "discrete",
    bubbles: true,
  });
  await app.dispose();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(calls, [
    "pressIn",
    "longPress",
    "pressOut",
    "pressIn",
    "pressOut",
    "press",
  ]);
});

test("owns delayed Pressable hover transitions and cleanup", async () => {
  const host = createRendererHost();
  const records = [];
  const calls = [];
  const app = mount(
    () =>
      createComponent(Pressable, {
        delayHoverIn: 15,
        delayHoverOut: 15,
        onHoverIn: (event) => calls.push(event.name),
        onHoverOut: (event) => calls.push(event.name),
        children: createComponent(Text, { children: "Hover target" }),
      }),
    host,
    {
      surface: { name: "pressable-hover" },
      autoCommit: false,
      telemetry: createCausalTelemetry({
        sink: (record) => records.push(record),
      }),
    },
  );

  await app.root.flush();
  const pressable = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "Pressable",
    );
  assert.ok(pressable);
  assert.deepEqual(pressable.eventListeners, ["hoverIn", "hoverOut"]);

  const inject = (name) =>
    host.injectEvent({
      surface: app.root.surfaceId,
      target: pressable.node,
      name,
      priority: "default",
      bubbles: false,
      payload: { pointerType: "mouse" },
    });

  inject("hoverIn");
  await new Promise((resolve) => setTimeout(resolve, 5));
  inject("hoverOut");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(calls, []);

  inject("hoverIn");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(calls, ["hoverIn"]);
  inject("hoverOut");
  await new Promise((resolve) => setTimeout(resolve, 5));
  inject("hoverIn");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(calls, ["hoverIn"]);

  inject("hoverOut");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(calls, ["hoverIn", "hoverOut"]);
  for (const name of [
    "pressable.delayed-hover-in",
    "pressable.delayed-hover-out",
  ]) {
    assert.ok(
      records.some(
        (record) =>
          record.type === "operation-started" &&
          record.name === "solid-native.event" &&
          record.attributes["event.name"] === name &&
          record.attributes["event.priority"] === "default" &&
          record.attributes["event.source"] === "platform",
      ),
    );
  }

  inject("hoverIn");
  await app.dispose();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(calls, ["hoverIn", "hoverOut"]);
});

test("owns Pressable movement cancellation and retained-region re-entry", async () => {
  const host = createRendererHost();
  const calls = [];
  const layouts = [];
  const moves = [];
  const app = mount(
    () =>
      createComponent(Pressable, {
        delayLongPress: 20,
        hitSlop: { right: 4 },
        pressRetentionOffset: { top: 5, right: 10, bottom: 15, left: 10 },
        style: (state) => ({ opacity: state.pressed ? 0.4 : 1 }),
        onLayout: (event) => layouts.push(event.payload.layout),
        onPressIn: (event) => calls.push(event.name),
        onPressMove: (event) => moves.push(event.name),
        onPressOut: (event) => calls.push(event.name),
        onLongPress: (event) => calls.push(event.name),
        onPress: (event) => calls.push(event.name),
        children: createComponent(Text, { children: "Retained press" }),
      }),
    host,
    { surface: { name: "pressable-retention" }, autoCommit: false },
  );

  await app.root.flush();
  const pressable = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "Pressable",
    );
  assert.ok(pressable);

  const inject = (name, payload = {}) =>
    host.injectEvent({
      surface: app.root.surfaceId,
      target: pressable.node,
      name,
      priority: name === "pressMove" ? "continuous" : "discrete",
      bubbles: name !== "layout",
      coalescible: name === "pressMove",
      payload,
    });
  inject("layout", {
    layout: { x: 0, y: 0, width: 100, height: 40 },
  });
  assert.deepEqual(layouts, [{ x: 0, y: 0, width: 100, height: 40 }]);

  inject("pressIn", { locationX: 20, locationY: 20 });
  await app.root.flush();
  assert.deepEqual(calls, ["pressIn"]);
  assert.deepEqual(
    host
      .getSurfaceSnapshot(app.root.surfaceId)
      .nodes.find((node) => node.node === pressable.node)?.props.style,
    { opacity: 0.4 },
  );

  inject("pressMove", {
    touches: [{ locationX: 114, locationY: 20 }],
  });
  await app.root.flush();
  assert.deepEqual(calls, ["pressIn", "pressOut"]);
  assert.deepEqual(
    host
      .getSurfaceSnapshot(app.root.surfaceId)
      .nodes.find((node) => node.node === pressable.node)?.props.style,
    { opacity: 1 },
  );
  assert.deepEqual(moves, ["pressMove"]);

  inject("pressMove", { offsetX: 113, offsetY: 20 });
  await app.root.flush();
  assert.deepEqual(calls, ["pressIn", "pressOut", "pressIn"]);
  inject("pressMove", { offsetX: 50, offsetY: 56 });
  inject("pressOut", { locationX: 50, locationY: 56 });
  inject("press");
  await app.root.flush();
  assert.deepEqual(calls, ["pressIn", "pressOut", "pressIn", "pressOut"]);

  inject("pressIn", { locationX: 20, locationY: 20 });
  inject("pressCancel", { locationX: 20, locationY: 20 });
  await app.root.flush();
  assert.deepEqual(calls.slice(-2), ["pressIn", "pressOut"]);

  inject("pressIn", { locationX: 20, locationY: 20 });
  inject("pressOut", { locationX: 20, locationY: 20 });
  inject("press");
  await app.root.flush();
  assert.deepEqual(calls.slice(-3), ["pressIn", "pressOut", "press"]);

  inject("pressIn", {
    locationX: 20,
    locationY: 20,
    pageX: 120,
    pageY: 220,
  });
  inject("pressMove", {
    touches: [{ locationX: 999, locationY: 999, pageX: 213, pageY: 220 }],
  });
  await app.root.flush();
  assert.deepEqual(calls.slice(-1), ["pressIn"]);
  assert.deepEqual(
    host
      .getSurfaceSnapshot(app.root.surfaceId)
      .nodes.find((node) => node.node === pressable.node)?.props.style,
    { opacity: 0.4 },
  );
  inject("pressMove", {
    touches: [{ locationX: 21, locationY: 20, pageX: 215, pageY: 220 }],
  });
  await app.root.flush();
  assert.deepEqual(calls.slice(-2), ["pressIn", "pressOut"]);
  inject("pressMove", {
    touches: [{ locationX: 999, locationY: 999, pageX: 213, pageY: 220 }],
  });
  inject("pressMove", {
    touches: [{ locationX: 999, locationY: 999, pageX: 120, pageY: 220 }],
  });
  await app.root.flush();
  assert.deepEqual(calls.slice(-3), ["pressIn", "pressOut", "pressIn"]);
  inject("pressCancel", { pageX: 215, pageY: 220 });
  assert.deepEqual(calls.slice(-4), [
    "pressIn",
    "pressOut",
    "pressIn",
    "pressOut",
  ]);

  inject("pressIn", { locationX: 20, locationY: 20 });
  inject("pressMove", { locationX: 31, locationY: 20 });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(calls.includes("longPress"), false);
  inject("pressOut", { locationX: 31, locationY: 20 });
  inject("press");
  await app.root.flush();
  assert.deepEqual(calls.slice(-3), ["pressIn", "pressOut", "press"]);
  assert.deepEqual(moves, [
    "pressMove",
    "pressMove",
    "pressMove",
    "pressMove",
    "pressMove",
    "pressMove",
    "pressMove",
    "pressMove",
  ]);

  await app.dispose();

  const invalidApp = mount(
    () =>
      createComponent(Pressable, {
        pressRetentionOffset: -1,
        onPress: () => undefined,
        children: createComponent(Text, { children: "Invalid retention" }),
      }),
    host,
    { surface: { name: "invalid-pressable-retention" }, autoCommit: false },
  );
  await invalidApp.root.flush();
  const invalidPressable = host
    .getSurfaceSnapshot(invalidApp.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "Pressable",
    );
  assert.ok(invalidPressable);
  const invalidEvent = (name, payload) => ({
    surface: invalidApp.root.surfaceId,
    target: invalidPressable.node,
    name,
    priority: "discrete",
    bubbles: name !== "layout",
    payload,
  });
  host.injectEvent(
    invalidEvent("layout", {
      layout: { x: 0, y: 0, width: 100, height: 40 },
    }),
  );
  assert.throws(
    () =>
      host.injectEvent(
        invalidEvent("pressIn", { locationX: 20, locationY: 20 }),
      ),
    /pressRetentionOffset must be a finite non-negative number/u,
  );
  await invalidApp.dispose();
});

test("cancels a nested Pressable when its ScrollView takes over", async () => {
  const host = createRendererHost("ios");
  const calls = [];
  const app = mount(
    () =>
      createComponent(ScrollView, {
        onScrollBeginDrag: (event) => calls.push(event.name),
        get children() {
          return createComponent(Pressable, {
            onPressIn: (event) => calls.push(event.name),
            onPressOut: (event) => calls.push(event.name),
            onPress: (event) => calls.push(event.name),
            children: createComponent(Text, { children: "Take over" }),
          });
        },
      }),
    host,
    { surface: { name: "pressable-scroll-takeover" }, autoCommit: false },
  );

  await app.root.flush();
  const snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  const scrollView = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "ScrollView",
  );
  const pressable = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "Pressable",
  );
  assert.ok(scrollView);
  assert.ok(pressable);
  assert.ok(scrollView.eventListeners.includes("scrollBeginDrag"));

  const injectPress = (name) =>
    host.injectEvent({
      surface: app.root.surfaceId,
      target: pressable.node,
      name,
      priority: "discrete",
      bubbles: true,
      payload: { locationX: 20, locationY: 20 },
    });
  injectPress("pressIn");
  host.injectEvent({
    surface: app.root.surfaceId,
    target: scrollView.node,
    name: "scrollBeginDrag",
    priority: "discrete",
    bubbles: true,
  });
  injectPress("pressOut");
  injectPress("press");
  await app.root.flush();
  assert.deepEqual(calls, ["pressIn", "pressOut", "scrollBeginDrag"]);

  injectPress("pressIn");
  injectPress("pressOut");
  injectPress("press");
  await app.root.flush();
  assert.deepEqual(calls.slice(-3), ["pressIn", "pressOut", "press"]);

  await app.dispose();
});

test("owns Android Pressable ripple props, hotspot, and pressed commands", async () => {
  const host = createRendererHost("android");
  const [foreground, setForeground] = createSignal(false);
  const app = mount(
    () =>
      createComponent(Pressable, {
        get android_ripple() {
          return {
            color: "#33669980",
            borderless: true,
            radius: 24,
            foreground: foreground(),
            alpha: 0.7,
          };
        },
        children: createComponent(Text, { children: "Ripple" }),
      }),
    host,
    { surface: { name: "android-ripple" }, autoCommit: false },
  );
  await app.root.flush();
  let pressable = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "Pressable",
    );
  assert.ok(pressable);
  const drawable = {
    type: "RippleAndroid",
    color: "#33669980",
    borderless: true,
    rippleRadius: 24,
    alpha: 0.7,
  };
  assert.deepEqual(pressable.props.nativeBackgroundAndroid, drawable);
  assert.equal(pressable.props.nativeForegroundAndroid, undefined);

  setForeground(true);
  await app.root.flush();
  pressable = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "Pressable",
    );
  assert.ok(pressable);
  assert.equal(pressable.props.nativeBackgroundAndroid, undefined);
  assert.deepEqual(pressable.props.nativeForegroundAndroid, drawable);

  const commands = () =>
    host.commits.flatMap((commit) =>
      commit.mutations.filter((mutation) => mutation.type === "command"),
    );
  const commandOffset = commands().length;
  const inject = (name, payload) =>
    host.injectEvent({
      surface: app.root.surfaceId,
      target: pressable.node,
      name,
      priority: name === "pressMove" ? "continuous" : "discrete",
      bubbles: true,
      coalescible: name === "pressMove",
      payload,
    });
  inject("pressIn", { locationX: 12, locationY: 14 });
  inject("pressMove", { touches: [{ locationX: 18, locationY: 20 }] });
  inject("pressOut", { locationX: 18, locationY: 20 });
  await app.root.flush();
  assert.deepEqual(commands().slice(commandOffset), [
    {
      type: "command",
      node: pressable.node,
      command: "hotspotUpdate",
      args: [12, 14],
    },
    {
      type: "command",
      node: pressable.node,
      command: "setPressed",
      args: [true],
    },
    {
      type: "command",
      node: pressable.node,
      command: "hotspotUpdate",
      args: [18, 20],
    },
    {
      type: "command",
      node: pressable.node,
      command: "setPressed",
      args: [false],
    },
  ]);
  await app.dispose();

  const iosHost = createRendererHost("ios");
  const iosApp = mount(
    () =>
      createComponent(Pressable, {
        android_ripple: { color: "#336699" },
        children: createComponent(Text, { children: "No iOS ripple" }),
      }),
    iosHost,
    { surface: { name: "ios-ripple-omission" }, autoCommit: false },
  );
  await iosApp.root.flush();
  const iosPressable = iosHost
    .getSurfaceSnapshot(iosApp.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "Pressable",
    );
  assert.ok(iosPressable);
  assert.equal(iosPressable.props.nativeBackgroundAndroid, undefined);
  assert.equal(iosPressable.props.nativeForegroundAndroid, undefined);
  assert.deepEqual(iosPressable.eventListeners, []);
  await iosApp.dispose();
});

test("normalizes Screen and ScreenStack for native presentation", async () => {
  const host = createRendererHost();
  const sheetDetentEvents = [];
  const app = mount(
    () =>
      createComponent(ScreenStack, {
        activeScreen: "details",
        onTransitionEnd: () => undefined,
        children: createComponent(Screen, {
          name: "details",
          presentation: "sheet",
          activityState: 2,
          preventNativeDismiss: true,
          sheetAllowedDetents: [0.4, 0.9],
          sheetInitialDetent: "last",
          sheetLargestUndimmedDetent: 0,
          sheetGrabberVisible: true,
          sheetCornerRadius: 18,
          sheetExpandsWhenScrolledToEdge: false,
          sheetElevation: 16,
          sheetShouldOverflowTopInset: true,
          sheetDefaultResizeAnimationEnabled: false,
          onFocus: () => undefined,
          onBlur: () => undefined,
          onDismiss: () => undefined,
          onGestureCancel: () => undefined,
          onNativeDismissCancel: () => undefined,
          onSheetDetentChange: (event) => sheetDetentEvents.push(event.payload),
          style: { backgroundColor: "#ffffff" },
          children: [
            createComponent(View, {}),
            createComponent(ScreenHeader, {
              backgroundColor: "#ffffff",
              backButtonDisplayMode: "minimal",
              backTitleVisible: false,
              color: "#166534",
              hideShadow: true,
              largeTitle: true,
              title: "Details",
              titleColor: "#111111",
              children: createComponent(ScreenHeaderSubview, {
                type: "right",
                hidesSharedBackground: true,
                children: createComponent(Text, { children: "Save" }),
              }),
            }),
          ],
        }),
      }),
    host,
    { surface: { name: "screen-normalization" }, autoCommit: false },
  );

  await app.root.flush();
  const snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  const stack = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "ScreenStack",
  );
  const screen = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "Screen",
  );
  const header = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "ScreenHeader",
  );
  const headerSubview = snapshot.nodes.find(
    (node) =>
      node.kind === "element" && node.component === "ScreenHeaderSubview",
  );
  assert.ok(stack);
  assert.ok(screen);
  assert.ok(header);
  assert.ok(headerSubview);
  assert.deepEqual(stack.props, { style: { flex: 1 } });
  assert.deepEqual(stack.eventListeners, ["transitionEnd"]);
  assert.deepEqual(screen.props, {
    activityState: 2,
    preventNativeDismiss: true,
    screenId: "details",
    sheetAllowedDetents: [0.4, 0.9],
    sheetCornerRadius: 18,
    sheetDefaultResizeAnimationEnabled: false,
    sheetElevation: 16,
    sheetExpandsWhenScrolledToEdge: false,
    sheetGrabberVisible: true,
    sheetInitialDetent: 1,
    sheetLargestUndimmedDetent: 0,
    sheetShouldOverflowTopInset: true,
    stackPresentation: "formSheet",
    style: { flex: 1, backgroundColor: "#ffffff" },
  });
  assert.deepEqual(screen.eventListeners, [
    "blur",
    "dismiss",
    "focus",
    "gestureCancel",
    "nativeDismissCancel",
    "sheetDetentChange",
  ]);
  assert.deepEqual(header.props, {
    backgroundColor: "#ffffff",
    backButtonDisplayMode: "minimal",
    backTitleVisible: false,
    color: "#166534",
    consumeTopInset: true,
    hideShadow: true,
    largeTitle: true,
    legacyTopInsetBehavior: false,
    pointerEvents: "box-none",
    style: {
      flexDirection: "row",
      justifyContent: "space-between",
      position: "absolute",
      width: "100%",
    },
    title: "Details",
    titleColor: "#111111",
  });
  assert.deepEqual(header.eventListeners, []);
  assert.deepEqual(headerSubview.props, {
    hidesSharedBackground: true,
    style: {
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "center",
    },
    type: "right",
  });
  assert.equal(header.children[0], headerSubview.node);
  assert.equal(screen.children[1], header.node);

  host.injectEvent({
    surface: app.root.surfaceId,
    target: screen.node,
    name: "sheetDetentChange",
    payload: { index: 1, isStable: true },
    priority: "default",
    bubbles: false,
  });
  assert.deepEqual(sheetDetentEvents, [{ index: 1, isStable: true }]);
  assert.throws(
    () =>
      host.injectEvent({
        surface: app.root.surfaceId,
        target: screen.node,
        name: "sheetDetentChange",
        payload: { index: 1, isStable: "yes" },
        priority: "default",
        bubbles: false,
      }),
    /boolean isStable/,
  );

  await app.dispose();
});

test("validates transport-safe native sheet configuration", async () => {
  const cases = [
    {
      name: "invalid-sheet-order",
      props: {
        presentation: "sheet",
        sheetAllowedDetents: [0.8, 0.4],
      },
      message: "strictly ascending",
    },
    {
      name: "invalid-sheet-presentation",
      props: {
        presentation: "push",
        sheetGrabberVisible: true,
      },
      message: 'requires presentation "sheet"',
    },
    {
      name: "invalid-android-sheet-count",
      props: {
        presentation: "sheet",
        sheetAllowedDetents: [0.2, 0.4, 0.6, 0.8],
      },
      message: "at most three detents",
    },
    {
      name: "invalid-sheet-boolean",
      props: {
        presentation: "sheet",
        sheetGrabberVisible: "yes",
      },
      message: "sheetGrabberVisible must be a boolean",
    },
  ];
  for (const fixture of cases) {
    const host = createRendererHost();
    const app = mount(
      () =>
        createComponent(Errored, {
          fallback: (error) =>
            createComponent(Text, {
              get children() {
                return error().message;
              },
            }),
          get children() {
            return createComponent(Screen, fixture.props);
          },
        }),
      host,
      { surface: { name: fixture.name }, autoCommit: false },
    );
    await app.root.flush();
    const messages = host
      .getSurfaceSnapshot(app.root.surfaceId)
      .nodes.filter((node) => node.kind === "text")
      .map((node) => node.text);
    assert.match(messages.join("\n"), new RegExp(fixture.message));
    await app.dispose();
  }
});

test("routes transport-safe iOS header buttons and nested menus", async () => {
  const host = createRendererHost("ios");
  const actions = [];
  const [selected, setSelected] = createSignal(false);
  const app = mount(
    () =>
      createComponent(ScreenHeader, {
        title: "Orders",
        headerLeftBarButtonItems: [
          {
            type: "menu",
            title: "More",
            icon: { type: "sfSymbol", name: "ellipsis.circle" },
            menu: {
              title: "Actions",
              items: [
                {
                  type: "action",
                  title: "Archive",
                  destructive: true,
                  onPress: () => actions.push("archive"),
                },
                {
                  type: "submenu",
                  title: "Move",
                  displayInline: true,
                  items: [
                    {
                      type: "action",
                      title: "Inbox",
                      icon: { type: "xcasset", name: "Inbox" },
                      state: "on",
                      onPress: () => actions.push("inbox"),
                    },
                  ],
                },
              ],
            },
          },
        ],
        get headerRightBarButtonItems() {
          return [
            {
              type: "button",
              title: "Done",
              variant: "done",
              selected: selected(),
              accessibilityLabel: "Finish order",
              onPress: () => actions.push("done"),
            },
          ];
        },
      }),
    host,
    { surface: { name: "ios-header-bar-buttons" }, autoCommit: false },
  );

  await app.root.flush();
  let header = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "ScreenHeader",
    );
  assert.ok(header);
  assert.deepEqual(header.props.headerLeftBarButtonItems, [
    {
      type: "menu",
      title: "More",
      sfSymbolName: "ellipsis.circle",
      menu: {
        title: "Actions",
        items: [
          {
            type: "action",
            title: "Archive",
            destructive: true,
            menuId: "0-0-left",
          },
          {
            type: "submenu",
            title: "Move",
            displayInline: true,
            items: [
              {
                type: "action",
                title: "Inbox",
                xcassetName: "Inbox",
                state: "on",
                menuId: "1.0-0-left",
              },
            ],
          },
        ],
      },
    },
  ]);
  assert.deepEqual(header.props.headerRightBarButtonItems, [
    {
      type: "button",
      title: "Done",
      variant: "done",
      selected: false,
      accessibilityLabel: "Finish order",
      buttonId: "0-right",
    },
  ]);
  assert.deepEqual(header.eventListeners, [
    "pressHeaderBarButtonItem",
    "pressHeaderBarButtonMenuItem",
  ]);
  assert.doesNotMatch(JSON.stringify(header.props), /onPress|function/u);

  host.injectEvent({
    surface: app.root.surfaceId,
    target: header.node,
    name: "pressHeaderBarButtonItem",
    payload: { buttonId: "0-right" },
    priority: "discrete",
    bubbles: false,
  });
  host.injectEvent({
    surface: app.root.surfaceId,
    target: header.node,
    name: "pressHeaderBarButtonMenuItem",
    payload: { menuId: "1.0-0-left" },
    priority: "discrete",
    bubbles: false,
  });
  assert.deepEqual(actions, ["done", "inbox"]);
  assert.throws(
    () =>
      host.injectEvent({
        surface: app.root.surfaceId,
        target: header.node,
        name: "pressHeaderBarButtonMenuItem",
        payload: { menuId: "missing" },
        priority: "discrete",
        bubbles: false,
      }),
    /unknown menuId/,
  );

  setSelected(true);
  await app.root.flush();
  header = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "ScreenHeader",
    );
  assert.equal(header?.props.headerRightBarButtonItems[0].selected, true);
  await app.dispose();
});

test("omits iOS header bar-button transport on Android", async () => {
  const host = createRendererHost("android");
  const app = mount(
    () =>
      createComponent(ScreenHeader, {
        headerRightBarButtonItems: [
          {
            type: "button",
            title: "Done",
            onPress: () => undefined,
          },
        ],
      }),
    host,
    { surface: { name: "android-header-bar-buttons" }, autoCommit: false },
  );
  await app.root.flush();
  const header = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "ScreenHeader",
    );
  assert.ok(header);
  assert.equal(header.props.headerRightBarButtonItems, undefined);
  assert.deepEqual(header.eventListeners, []);
  await app.dispose();
});

test("contains invalid native header menus inside a Solid error boundary", async () => {
  const cases = [
    {
      name: "missing-header-menu-action",
      items: [
        {
          type: "menu",
          title: "More",
          menu: {
            items: [{ type: "action", title: "Archive" }],
          },
        },
      ],
      message: "onPress must be a function",
    },
    {
      name: "oversized-header-items",
      items: Array.from({ length: 17 }, () => ({
        type: "spacing",
        spacing: 1,
      })),
      message: "supports at most 16 items",
    },
  ];
  for (const fixture of cases) {
    const host = createRendererHost("ios");
    const app = mount(
      () =>
        createComponent(Errored, {
          fallback: (error) =>
            createComponent(Text, {
              get children() {
                return error().message;
              },
            }),
          get children() {
            return createComponent(ScreenHeader, {
              headerRightBarButtonItems: fixture.items,
            });
          },
        }),
      host,
      { surface: { name: fixture.name }, autoCommit: false },
    );
    await app.root.flush();
    const messages = host
      .getSurfaceSnapshot(app.root.surfaceId)
      .nodes.filter((node) => node.kind === "text")
      .map((node) => node.text);
    assert.match(messages.join("\n"), new RegExp(fixture.message));
    await app.dispose();
  }
});

test("normalizes the pinned experimental native tabs facade", async () => {
  const host = createRendererHost();
  const selectedEvents = [];
  const lifecycleEvents = [];
  const app = mount(
    () =>
      createComponent(TabsHost, {
        selectedKey: "home",
        baseProvenance: 3,
        rejectStaleNavStateUpdates: true,
        nativeContainerBackgroundColor: "#ffffff",
        direction: "rtl",
        tabBarRespectsIMEInsets: true,
        tabBarTintColor: "#ff0000",
        onTabSelected: (event) => selectedEvents.push(event),
        children: createComponent(TabsScreen, {
          screenKey: "home",
          title: "Home",
          badgeValue: "2",
          icon: {
            android: { type: "drawableResource", name: "solid_native_home" },
            ios: { type: "sfSymbol", name: "house" },
          },
          selectedIcon: {
            android: {
              type: "drawableResource",
              name: "solid_native_home_selected",
            },
            ios: { type: "sfSymbol", name: "house.fill" },
          },
          standardAppearance: {
            android: {
              tabBarBackgroundColor: "#102030",
              tabBarItemRippleColor: "#203040",
              tabBarItemLabelVisibilityMode: "labeled",
              selected: {
                tabBarItemTitleFontColor: "#304050",
                tabBarItemIconColor: "#405060",
              },
              tabBarItemActiveIndicatorColor: "#506070",
              tabBarItemActiveIndicatorEnabled: true,
              tabBarItemTitleFontFamily: "sans-serif-medium",
              tabBarItemTitleSmallLabelFontSize: 11,
              tabBarItemTitleLargeLabelFontSize: 13,
              tabBarItemTitleFontWeight: "600",
              tabBarItemTitleFontStyle: "normal",
              tabBarItemBadgeBackgroundColor: "#607080",
              tabBarItemBadgeTextColor: "#ffffff",
            },
          },
          scrollEdgeAppearance: {
            ios: { tabBarBackgroundColor: "#ffffff" },
          },
          orientation: "portrait",
          tabBarItemAccessibilityLabel: "Home tab",
          specialEffects: {
            repeatedTabSelection: { popToRoot: false, scrollToTop: true },
          },
          onDidAppear: (event) => lifecycleEvents.push(event),
          style: { backgroundColor: "#ffffff" },
          children: createComponent(Text, { children: "Home content" }),
        }),
      }),
    host,
    { surface: { name: "native-tabs" }, autoCommit: false },
  );

  await app.root.flush();
  const snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  const tabsHost = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "TabsHost",
  );
  const tabsScreen = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "TabsScreen",
  );
  assert.ok(tabsHost);
  assert.ok(tabsScreen);
  assert.deepEqual(tabsHost.props, {
    nativeContainerBackgroundColor: "#ffffff",
    navStateRequest: { baseProvenance: 3, selectedScreenKey: "home" },
    rejectStaleNavStateUpdates: true,
    style: {
      direction: "rtl",
      flex: 1,
      height: "100%",
      width: "100%",
    },
    tabBarRespectsIMEInsets: true,
  });
  assert.deepEqual(tabsHost.eventListeners, ["tabSelected"]);
  assert.deepEqual(tabsScreen.props, {
    badgeValue: "2",
    collapsable: false,
    drawableIconResourceName: "solid_native_home",
    screenKey: "home",
    selectedDrawableIconResourceName: "solid_native_home_selected",
    specialEffects: {
      repeatedTabSelection: { popToRoot: false, scrollToTop: true },
    },
    standardAppearance: {
      selected: {
        tabBarItemIconColor: "#405060",
        tabBarItemTitleFontColor: "#304050",
      },
      tabBarBackgroundColor: "#102030",
      tabBarItemActiveIndicatorColor: "#506070",
      tabBarItemActiveIndicatorEnabled: true,
      tabBarItemBadgeBackgroundColor: "#607080",
      tabBarItemBadgeTextColor: "#ffffff",
      tabBarItemLabelVisibilityMode: "labeled",
      tabBarItemRippleColor: "#203040",
      tabBarItemTitleFontFamily: "sans-serif-medium",
      tabBarItemTitleFontStyle: "normal",
      tabBarItemTitleFontWeight: "600",
      tabBarItemTitleLargeLabelFontSize: 13,
      tabBarItemTitleSmallLabelFontSize: 11,
    },
    style: {
      backgroundColor: "#ffffff",
      flex: 1,
      height: "100%",
      position: "absolute",
      width: "100%",
    },
    tabBarItemAccessibilityLabel: "Home tab",
    title: "Home",
  });
  assert.deepEqual(tabsScreen.eventListeners, ["didAppear"]);

  host.injectEvent({
    surface: app.root.surfaceId,
    target: tabsHost.node,
    name: "tabSelected",
    payload: {
      selectedScreenKey: "home",
      provenance: 4,
      isRepeated: true,
      hasTriggeredSpecialEffect: true,
      actionOrigin: "user",
    },
    priority: "discrete",
    bubbles: false,
  });
  host.injectEvent({
    surface: app.root.surfaceId,
    target: tabsScreen.node,
    name: "didAppear",
    payload: null,
    priority: "default",
    bubbles: false,
  });
  assert.equal(selectedEvents.length, 1);
  assert.equal(selectedEvents[0].payload.provenance, 4);
  assert.equal(lifecycleEvents.length, 1);

  await app.dispose();

  const iosHost = createRendererHost("ios");
  const iosApp = mount(
    () =>
      createComponent(TabsHost, {
        selectedKey: "settings",
        baseProvenance: 0,
        direction: "ltr",
        tabBarRespectsIMEInsets: true,
        tabBarTintColor: "#166534",
        children: createComponent(TabsScreen, {
          screenKey: "settings",
          icon: {
            android: {
              type: "drawableResource",
              name: "solid_native_settings",
            },
            ios: { type: "sfSymbol", name: "gearshape" },
          },
          selectedIcon: {
            ios: { type: "sfSymbol", name: "gearshape.fill" },
          },
          standardAppearance: {
            ios: {
              stacked: {
                selected: {
                  tabBarItemTitleFontFamily: "Avenir Next",
                  tabBarItemTitleFontSize: 12,
                  tabBarItemTitleFontWeight: "600",
                  tabBarItemTitleFontStyle: "normal",
                  tabBarItemTitleFontColor: "#166534",
                  tabBarItemTitlePositionAdjustment: {
                    horizontal: 1,
                    vertical: -2,
                  },
                  tabBarItemIconColor: "#15803d",
                  tabBarItemBadgeBackgroundColor: "#dc2626",
                },
              },
              tabBarBackgroundColor: "#f0fdf4",
              tabBarBlurEffect: "systemThinMaterial",
              tabBarShadowColor: "#14532d",
            },
          },
          scrollEdgeAppearance: {
            ios: {
              tabBarBackgroundColor: "transparent",
              tabBarBlurEffect: "none",
            },
          },
          orientation: "portrait",
          children: createComponent(Text, { children: "Settings" }),
        }),
      }),
    iosHost,
    { surface: { name: "native-tabs-ios" }, autoCommit: false },
  );
  await iosApp.root.flush();
  const iosSnapshot = iosHost.getSurfaceSnapshot(iosApp.root.surfaceId);
  const iosTabsHost = iosSnapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "TabsHost",
  );
  const iosTabsScreen = iosSnapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "TabsScreen",
  );
  assert.deepEqual(iosTabsHost?.props, {
    layoutDirection: "ltr",
    navStateRequest: { baseProvenance: 0, selectedScreenKey: "settings" },
    style: { flex: 1, height: "100%", width: "100%" },
    tabBarTintColor: "#166534",
  });
  assert.equal(iosTabsScreen?.props.isTitleUndefined, true);
  assert.equal(iosTabsScreen?.props.iconType, "sfSymbol");
  assert.equal(iosTabsScreen?.props.iconResourceName, "gearshape");
  assert.equal(iosTabsScreen?.props.selectedIconResourceName, "gearshape.fill");
  assert.equal(iosTabsScreen?.props.orientation, "portrait");
  assert.deepEqual(iosTabsScreen?.props.standardAppearance, {
    stacked: {
      selected: {
        tabBarItemTitleFontFamily: "Avenir Next",
        tabBarItemTitleFontSize: 12,
        tabBarItemTitleFontWeight: "600",
        tabBarItemTitleFontStyle: "normal",
        tabBarItemTitleFontColor: "#166534",
        tabBarItemTitlePositionAdjustment: { horizontal: 1, vertical: -2 },
        tabBarItemIconColor: "#15803d",
        tabBarItemBadgeBackgroundColor: "#dc2626",
      },
    },
    tabBarBackgroundColor: "#f0fdf4",
    tabBarBlurEffect: "systemThinMaterial",
    tabBarShadowColor: "#14532d",
  });
  assert.deepEqual(iosTabsScreen?.props.scrollEdgeAppearance, {
    tabBarBackgroundColor: "transparent",
    tabBarBlurEffect: "none",
  });
  await iosApp.dispose();
});

test("normalizes URI-backed native tab icons and clears stale icon props", async () => {
  const host = createRendererHost("android");
  let setUseImages;
  const imageSource = {
    uri: "solid_native_home",
    width: 24,
    height: 24,
    scale: 2,
  };
  const app = mount(
    () => {
      const [useImages, updateUseImages] = createSignal(false);
      setUseImages = updateUseImages;
      return createComponent(TabsScreen, {
        screenKey: "home",
        get icon() {
          return {
            android: useImages()
              ? { type: "imageSource", source: imageSource }
              : { type: "drawableResource", name: "solid_native_home" },
          };
        },
        get selectedIcon() {
          return {
            android: useImages()
              ? {
                  type: "imageSource",
                  source: "solid_native_home_selected",
                }
              : {
                  type: "drawableResource",
                  name: "solid_native_home_selected",
                },
          };
        },
      });
    },
    host,
    { surface: { name: "native-tabs-image-icons-android" }, autoCommit: false },
  );
  const screen = () =>
    host
      .getSurfaceSnapshot(app.root.surfaceId)
      .nodes.find(
        (node) => node.kind === "element" && node.component === "TabsScreen",
      );

  await app.root.flush();
  const retainedNode = screen()?.node;
  assert.equal(screen()?.props.drawableIconResourceName, "solid_native_home");
  assert.equal(
    screen()?.props.selectedDrawableIconResourceName,
    "solid_native_home_selected",
  );

  setUseImages(true);
  await app.root.flush();
  assert.equal(screen()?.node, retainedNode);
  assert.deepEqual(screen()?.props.imageIconResource, imageSource);
  assert.deepEqual(screen()?.props.selectedImageIconResource, {
    uri: "solid_native_home_selected",
  });
  assert.equal("drawableIconResourceName" in screen().props, false);
  assert.equal("selectedDrawableIconResourceName" in screen().props, false);
  assert.notEqual(screen()?.props.imageIconResource, imageSource);
  await app.dispose();

  const iosHost = createRendererHost("ios");
  const iosApp = mount(
    () =>
      createComponent(TabsScreen, {
        screenKey: "home",
        icon: {
          ios: {
            type: "templateSource",
            source: { uri: "asset:/home.png", width: 20, height: 20 },
          },
        },
        selectedIcon: {
          ios: {
            type: "templateSource",
            source: "asset:/home-selected.png",
          },
        },
      }),
    iosHost,
    { surface: { name: "native-tabs-image-icons-ios" }, autoCommit: false },
  );
  await iosApp.root.flush();
  const iosScreen = iosHost
    .getSurfaceSnapshot(iosApp.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "TabsScreen",
    );
  assert.equal(iosScreen?.props.iconType, "template");
  assert.deepEqual(iosScreen?.props.iconImageSource, {
    uri: "asset:/home.png",
    width: 20,
    height: 20,
  });
  assert.deepEqual(iosScreen?.props.selectedIconImageSource, {
    uri: "asset:/home-selected.png",
  });
  assert.equal("iconResourceName" in iosScreen.props, false);
  assert.equal("selectedIconResourceName" in iosScreen.props, false);
  await iosApp.dispose();
});

test("rejects malformed transport-safe native tab configuration", async () => {
  const cases = [
    {
      name: "invalid-android-tab-icon",
      platform: "android",
      props: {
        icon: {
          android: { type: "drawableResource", name: "Home Icon" },
        },
      },
      message: "lowercase Android drawable resource identifier",
    },
    {
      name: "missing-android-tab-icon",
      platform: "android",
      props: {
        selectedIcon: {
          android: {
            type: "drawableResource",
            name: "solid_native_home_selected",
          },
        },
      },
      message: "selectedIcon.android requires icon.android",
    },
    {
      name: "mismatched-ios-tab-icon",
      platform: "ios",
      props: {
        icon: { ios: { type: "sfSymbol", name: "house" } },
        selectedIcon: { ios: { type: "xcasset", name: "HomeSelected" } },
      },
      message: "must use the same type",
    },
    {
      name: "opaque-android-tab-image-source",
      platform: "android",
      props: {
        icon: { android: { type: "imageSource", source: 42 } },
      },
      message: "must be a plain object",
    },
    {
      name: "unsupported-android-tab-image-source-property",
      platform: "android",
      props: {
        icon: {
          android: {
            type: "imageSource",
            source: { uri: "https://example.test/home.png", headers: {} },
          },
        },
      },
      message: 'contains unsupported property "headers"',
    },
    {
      name: "incomplete-android-tab-image-dimensions",
      platform: "android",
      props: {
        icon: {
          android: {
            type: "imageSource",
            source: { uri: "solid_native_home", width: 24 },
          },
        },
      },
      message:
        "width and TabsScreen icon.android.source.height must be set together",
    },
    {
      name: "unsafe-ios-tab-image-uri",
      platform: "ios",
      props: {
        icon: {
          ios: { type: "imageSource", source: "https://example.test/\nicon" },
        },
      },
      message: "without control characters",
    },
    {
      name: "unsupported-android-tab-appearance-property",
      platform: "android",
      props: {
        standardAppearance: {
          android: { tabBarTintColor: "#ffffff" },
        },
      },
      message: 'contains unsupported property "tabBarTintColor"',
    },
    {
      name: "invalid-ios-tab-title-offset",
      platform: "ios",
      props: {
        standardAppearance: {
          ios: {
            stacked: {
              selected: {
                tabBarItemTitlePositionAdjustment: { vertical: Infinity },
              },
            },
          },
        },
      },
      message: "must be a finite number",
    },
    {
      name: "invalid-tab-appearance-platform-container",
      platform: "android",
      props: { standardAppearance: [] },
      message: "standardAppearance must be a plain object",
    },
  ];
  for (const fixture of cases) {
    const host = createRendererHost(fixture.platform);
    const app = mount(
      () =>
        createComponent(Errored, {
          fallback: (error) =>
            createComponent(Text, {
              get children() {
                return error().message;
              },
            }),
          get children() {
            return createComponent(TabsScreen, {
              screenKey: "home",
              ...fixture.props,
              children: createComponent(Text, { children: "Home" }),
            });
          },
        }),
      host,
      { surface: { name: fixture.name }, autoCommit: false },
    );
    await app.root.flush();
    const messages = host
      .getSurfaceSnapshot(app.root.surfaceId)
      .nodes.filter((node) => node.kind === "text")
      .map((node) => node.text);
    assert.match(
      messages.join("\n"),
      new RegExp(fixture.message.replaceAll(".", "\\.")),
    );
    await app.dispose();
  }
});

test("reactively updates a retained native tab appearance", async () => {
  const host = createRendererHost("android");
  let setBackgroundColor;
  const app = mount(
    () => {
      const [backgroundColor, updateBackgroundColor] = createSignal("#102030");
      setBackgroundColor = updateBackgroundColor;
      return createComponent(TabsScreen, {
        screenKey: "home",
        get standardAppearance() {
          return {
            android: {
              tabBarBackgroundColor: backgroundColor(),
              selected: { tabBarItemIconColor: backgroundColor() },
            },
          };
        },
        children: createComponent(Text, { children: "Home" }),
      });
    },
    host,
    { surface: { name: "reactive-native-tab-appearance" }, autoCommit: false },
  );

  await app.root.flush();
  const tabsScreen = () =>
    host
      .getSurfaceSnapshot(app.root.surfaceId)
      .nodes.find(
        (node) => node.kind === "element" && node.component === "TabsScreen",
      );
  const retainedNode = tabsScreen()?.node;
  assert.deepEqual(tabsScreen()?.props.standardAppearance, {
    tabBarBackgroundColor: "#102030",
    selected: { tabBarItemIconColor: "#102030" },
  });

  setBackgroundColor("#405060");
  await app.root.flush();
  assert.equal(tabsScreen()?.node, retainedNode);
  assert.deepEqual(tabsScreen()?.props.standardAppearance, {
    tabBarBackgroundColor: "#405060",
    selected: { tabBarItemIconColor: "#405060" },
  });
  await app.dispose();
});

test("reconciles controlled native tabs from native provenance", async () => {
  const host = createRendererHost();
  const renderTab = () => createComponent(Text, { children: "tab" });
  assert.throws(
    () => NativeTabs({ tabs: [], children: renderTab }),
    /non-empty array/,
  );
  assert.throws(
    () =>
      NativeTabs({
        tabs: Array.from({ length: 6 }, (_, index) => ({
          key: `tab-${index}`,
        })),
        children: renderTab,
      }),
    /at most 5 items/,
  );
  assert.throws(
    () =>
      NativeTabs({
        tabs: [{ key: "duplicate" }, { key: "duplicate" }],
        children: renderTab,
      }),
    /is duplicated/,
  );
  assert.throws(
    () =>
      NativeTabs({
        tabs: [{ key: "home" }],
        selectedKey: "missing",
        children: renderTab,
      }),
    /does not identify a tab/,
  );
  const creations = new Map();
  const disposals = new Map();
  const selections = [];
  const rejections = [];
  const preventions = [];
  const appearances = [];
  const errors = [];
  let diagnosticRejections = 0;
  let setSelected;
  let setTabs;
  const app = mount(
    () => {
      const [selected, updateSelected] = createSignal("home");
      const [tabs, updateTabs] = createSignal([
        {
          key: "home",
          label: "Home",
          drawable: "solid_native_home",
        },
        {
          key: "settings",
          label: "Settings",
          drawable: "solid_native_settings",
        },
      ]);
      setSelected = updateSelected;
      setTabs = updateTabs;
      return createComponent(NativeTabs, {
        get tabs() {
          return tabs();
        },
        get selectedKey() {
          return selected();
        },
        nativeContainerBackgroundColor: "#ffffff",
        onTabSelected: (selection) => selections.push(selection),
        onTabSelectionRejected: (rejection) => rejections.push(rejection),
        onTabSelectionPrevented: (prevention) => preventions.push(prevention),
        onTabDidAppear: (tab) => appearances.push(tab.label),
        onError(error) {
          errors.push(error);
          return {
            then(_resolve, reject) {
              diagnosticRejections++;
              reject(new Error("native-tabs diagnostic failed"));
            },
          };
        },
        screenOptions: (tab, index) => ({
          title: `${index}:${tab.label}`,
          icon: {
            android: {
              type: "drawableResource",
              name: tab.drawable,
            },
          },
          selectedIcon: {
            android: {
              type: "drawableResource",
              name: `${tab.drawable}_selected`,
            },
          },
          standardAppearance: {
            android: {
              selected: {
                tabBarItemTitleFontColor:
                  tab.key === "home" ? "#7c2d12" : "#166534",
              },
            },
          },
          tabBarItemAccessibilityLabel: `${tab.label} tab`,
        }),
        children: (tab, index, isSelected) => {
          const key = tab().key;
          creations.set(key, (creations.get(key) ?? 0) + 1);
          onCleanup(() => {
            disposals.set(key, (disposals.get(key) ?? 0) + 1);
          });
          return createComponent(Text, {
            get children() {
              return `${index()}:${tab().label}:${isSelected() ? "selected" : "inactive"}`;
            },
          });
        },
      });
    },
    host,
    { surface: { name: "solid-owned-native-tabs" }, autoCommit: false },
  );

  const snapshot = () => host.getSurfaceSnapshot(app.root.surfaceId);
  const tabsHost = () =>
    snapshot().nodes.find(
      (node) => node.kind === "element" && node.component === "TabsHost",
    );
  const tabScreens = () =>
    snapshot().nodes.filter(
      (node) => node.kind === "element" && node.component === "TabsScreen",
    );
  const texts = () =>
    snapshot()
      .nodes.filter((node) => node.kind === "text")
      .map((node) => node.text);

  await app.root.flush();
  assert.deepEqual(tabsHost()?.props.navStateRequest, {
    baseProvenance: 0,
    selectedScreenKey: "home",
  });
  assert.deepEqual(texts(), ["0:Home:selected", "1:Settings:inactive"]);
  assert.deepEqual(Object.fromEntries(creations), { home: 1, settings: 1 });
  const initialScreens = new Map(
    tabScreens().map((screen) => [screen.props.screenKey, screen.node]),
  );
  assert.equal(
    tabScreens().find((screen) => screen.props.screenKey === "home")?.props
      .drawableIconResourceName,
    "solid_native_home",
  );
  assert.equal(
    tabScreens().find((screen) => screen.props.screenKey === "settings")?.props
      .selectedDrawableIconResourceName,
    "solid_native_settings_selected",
  );
  assert.deepEqual(
    tabScreens().find((screen) => screen.props.screenKey === "home")?.props
      .standardAppearance,
    { selected: { tabBarItemTitleFontColor: "#7c2d12" } },
  );

  setSelected("settings");
  await app.root.flush();
  assert.deepEqual(tabsHost()?.props.navStateRequest, {
    baseProvenance: 0,
    selectedScreenKey: "settings",
  });

  host.injectEvent({
    surface: app.root.surfaceId,
    target: tabsHost().node,
    name: "tabSelectionRejected",
    payload: {
      selectedScreenKey: "home",
      provenance: 1,
      rejectedScreenKey: "settings",
      rejectedBaseProvenance: 0,
      rejectionReason: "stale",
    },
    priority: "discrete",
    bubbles: false,
  });
  await app.root.flush();
  assert.deepEqual(tabsHost()?.props.navStateRequest, {
    baseProvenance: 1,
    selectedScreenKey: "settings",
  });
  assert.equal(rejections.length, 1);
  assert.equal(rejections[0].reason, "stale");

  host.injectEvent({
    surface: app.root.surfaceId,
    target: tabsHost().node,
    name: "tabSelected",
    payload: {
      selectedScreenKey: "settings",
      provenance: 2,
      isRepeated: false,
      hasTriggeredSpecialEffect: false,
      actionOrigin: "programmatic-js",
    },
    priority: "discrete",
    bubbles: false,
  });
  await app.root.flush();
  assert.deepEqual(texts(), ["0:Home:inactive", "1:Settings:selected"]);
  assert.equal(selections.length, 1);

  host.injectEvent({
    surface: app.root.surfaceId,
    target: tabsHost().node,
    name: "tabSelected",
    payload: {
      selectedScreenKey: "home",
      provenance: 3,
      isRepeated: false,
      hasTriggeredSpecialEffect: false,
      actionOrigin: "user",
    },
    priority: "discrete",
    bubbles: false,
  });
  await app.root.flush();
  assert.deepEqual(texts(), ["0:Home:selected", "1:Settings:inactive"]);
  assert.deepEqual(tabsHost()?.props.navStateRequest, {
    baseProvenance: 3,
    selectedScreenKey: "settings",
  });

  host.injectEvent({
    surface: app.root.surfaceId,
    target: tabsHost().node,
    name: "tabSelected",
    payload: {
      selectedScreenKey: "settings",
      provenance: 4,
      isRepeated: false,
      hasTriggeredSpecialEffect: false,
      actionOrigin: "programmatic-js",
    },
    priority: "discrete",
    bubbles: false,
  });
  await app.root.flush();
  setTabs([
    {
      key: "settings",
      label: "Preferences",
      drawable: "solid_native_settings_alt",
    },
    { key: "home", label: "Start", drawable: "solid_native_home_alt" },
  ]);
  await app.root.flush();
  assert.deepEqual(texts().sort(), [
    "0:Preferences:selected",
    "1:Start:inactive",
  ]);
  assert.equal(
    tabScreens().find((screen) => screen.props.screenKey === "home")?.node,
    initialScreens.get("home"),
  );
  assert.equal(
    tabScreens().find((screen) => screen.props.screenKey === "settings")?.node,
    initialScreens.get("settings"),
  );
  assert.equal(
    tabScreens().find((screen) => screen.props.screenKey === "settings")?.props
      .drawableIconResourceName,
    "solid_native_settings_alt",
  );
  assert.equal(
    tabScreens().find((screen) => screen.props.screenKey === "home")?.props
      .selectedDrawableIconResourceName,
    "solid_native_home_alt_selected",
  );
  assert.deepEqual(Object.fromEntries(creations), { home: 1, settings: 1 });

  const retainedSettings = tabScreens().find(
    (screen) => screen.props.screenKey === "settings",
  );
  assert.ok(retainedSettings);
  host.injectEvent({
    surface: app.root.surfaceId,
    target: retainedSettings.node,
    name: "didAppear",
    payload: null,
    priority: "default",
    bubbles: false,
  });
  assert.deepEqual(appearances, ["Preferences"]);

  host.injectEvent({
    surface: app.root.surfaceId,
    target: tabsHost().node,
    name: "tabSelectionPrevented",
    payload: {
      selectedScreenKey: "settings",
      provenance: 4,
      preventedScreenKey: "home",
    },
    priority: "discrete",
    bubbles: false,
  });
  await app.root.flush();
  assert.deepEqual(preventions, [
    { selectedKey: "settings", provenance: 4, preventedKey: "home" },
  ]);
  assert.deepEqual(tabsHost()?.props.navStateRequest, {
    baseProvenance: 3,
    selectedScreenKey: "settings",
  });

  host.injectEvent({
    surface: app.root.surfaceId,
    target: tabsHost().node,
    name: "tabSelected",
    payload: {
      selectedScreenKey: "missing",
      provenance: -1,
      isRepeated: false,
      hasTriggeredSpecialEffect: false,
      actionOrigin: "user",
    },
    priority: "discrete",
    bubbles: false,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(errors.length, 1);
  assert.equal(diagnosticRejections, 1);

  await app.dispose();
  assert.deepEqual(Object.fromEntries(disposals), { home: 1, settings: 1 });
});

test("inherits reactive navigator defaults before keyed screen overrides", async () => {
  const tabsHost = createRendererHost();
  let setBadge;
  const tabsApp = mount(
    () => {
      const [badge, updateBadge] = createSignal("new");
      setBadge = updateBadge;
      return createComponent(NativeTabs, {
        tabs: [{ key: "home" }, { key: "settings" }],
        get defaultScreenOptions() {
          return {
            badgeValue: badge(),
            preventNativeSelection: true,
            title: "Inherited title",
          };
        },
        screenOptions: (tab) =>
          tab.key === "home"
            ? { preventNativeSelection: false, title: "Home" }
            : { title: undefined },
        children: (tab) =>
          createComponent(Text, {
            get children() {
              return tab().key;
            },
          }),
      });
    },
    tabsHost,
    { surface: { name: "native-tab-option-inheritance" }, autoCommit: false },
  );

  const tabScreens = () =>
    tabsHost
      .getSurfaceSnapshot(tabsApp.root.surfaceId)
      .nodes.filter(
        (node) => node.kind === "element" && node.component === "TabsScreen",
      );
  await tabsApp.root.flush();
  const initialTabNodes = new Map(
    tabScreens().map((screen) => [screen.props.screenKey, screen.node]),
  );
  let homeTab = tabScreens().find(
    (screen) => screen.props.screenKey === "home",
  );
  let settingsTab = tabScreens().find(
    (screen) => screen.props.screenKey === "settings",
  );
  assert.ok(homeTab);
  assert.ok(settingsTab);
  assert.equal(homeTab.props.badgeValue, "new");
  assert.equal(homeTab.props.preventNativeSelection, false);
  assert.equal(homeTab.props.title, "Home");
  assert.equal(settingsTab.props.badgeValue, "new");
  assert.equal(settingsTab.props.preventNativeSelection, true);
  assert.equal(settingsTab.props.title, undefined);

  setBadge("2");
  await tabsApp.root.flush();
  homeTab = tabScreens().find((screen) => screen.props.screenKey === "home");
  settingsTab = tabScreens().find(
    (screen) => screen.props.screenKey === "settings",
  );
  assert.equal(homeTab?.node, initialTabNodes.get("home"));
  assert.equal(settingsTab?.node, initialTabNodes.get("settings"));
  assert.equal(homeTab?.props.badgeValue, "2");
  assert.equal(settingsTab?.props.badgeValue, "2");
  await tabsApp.dispose();

  const stackHost = createRendererHost();
  const history = new NativeHistory({ initialHref: "/" });
  let setDefaultGesture;
  let setDefaultPresentation;
  const stackApp = mount(
    () => {
      const [defaultGesture, updateDefaultGesture] = createSignal(false);
      const [defaultPresentation, updateDefaultPresentation] =
        createSignal("push");
      setDefaultGesture = updateDefaultGesture;
      setDefaultPresentation = updateDefaultPresentation;
      return createComponent(NativeStack, {
        history,
        get defaultScreenOptions() {
          return {
            gestureEnabled: defaultGesture(),
            nativeBackButtonDismissalEnabled: false,
            presentation: defaultPresentation(),
            preventNativeDismiss: true,
            style: { backgroundColor: "#f8fafc" },
          };
        },
        screenOptions: (entry) =>
          entry.href === "/"
            ? { gestureEnabled: true, preventNativeDismiss: undefined }
            : entry.href === "/detail"
              ? {
                  presentation: "sheet",
                  sheetAllowedDetents: [0.5, 0.9],
                  sheetGrabberVisible: true,
                }
              : {},
        children: (entry) =>
          createComponent(Text, {
            get children() {
              return entry().href;
            },
          }),
      });
    },
    stackHost,
    { surface: { name: "native-stack-option-inheritance" }, autoCommit: false },
  );

  const stackScreens = () =>
    stackHost
      .getSurfaceSnapshot(stackApp.root.surfaceId)
      .nodes.filter(
        (node) => node.kind === "element" && node.component === "Screen",
      );
  await stackApp.root.flush();
  const root = stackScreens()[0];
  assert.ok(root);
  assert.equal(root.props.gestureEnabled, true);
  assert.equal(root.props.nativeBackButtonDismissalEnabled, false);
  assert.equal(root.props.preventNativeDismiss, false);
  assert.equal(root.props.stackPresentation, "push");
  assert.deepEqual(root.props.style, {
    flex: 1,
    backgroundColor: "#f8fafc",
  });

  const detailTransition = history.push("/detail");
  await stackApp.root.flush();
  let detail = stackScreens().find(
    (screen) => screen.props.screenId === detailTransition.to.id,
  );
  assert.ok(detail);
  const detailNode = detail.node;
  assert.equal(detail.props.gestureEnabled, false);
  assert.equal(detail.props.nativeBackButtonDismissalEnabled, false);
  assert.equal(detail.props.preventNativeDismiss, true);
  assert.equal(detail.props.stackPresentation, "formSheet");
  assert.deepEqual(detail.props.sheetAllowedDetents, [0.5, 0.9]);
  assert.equal(detail.props.sheetGrabberVisible, true);
  assert.deepEqual(detail.props.style, {
    flex: 1,
    backgroundColor: "#f8fafc",
  });

  setDefaultGesture(true);
  await stackApp.root.flush();
  detail = stackScreens().find(
    (screen) => screen.props.screenId === detailTransition.to.id,
  );
  assert.equal(detail?.node, detailNode);
  assert.equal(detail?.props.gestureEnabled, true);

  setDefaultPresentation("modal");
  await stackApp.root.flush();
  assert.equal(stackScreens()[0]?.props.stackPresentation, "push");
  assert.equal(
    stackScreens().find(
      (screen) => screen.props.screenId === detailTransition.to.id,
    )?.props.stackPresentation,
    "formSheet",
  );
  const modalTransition = history.push("/modal");
  await stackApp.root.flush();
  const modal = stackScreens().find(
    (screen) => screen.props.screenId === modalTransition.to.id,
  );
  assert.equal(modal?.props.stackPresentation, "modal");
  setDefaultPresentation("push");
  await stackApp.root.flush();
  assert.equal(
    stackScreens().find(
      (screen) => screen.props.screenId === modalTransition.to.id,
    )?.props.stackPresentation,
    "modal",
  );
  await stackApp.dispose();
});

test("composes retained native tab and stack owners", async () => {
  const host = createRendererHost();
  const creations = new Map();
  const disposals = new Map();
  let settingsHistory;
  let setRootCount;
  const app = mount(
    () =>
      createComponent(NativeTabs, {
        tabs: [{ key: "home" }, { key: "settings" }],
        defaultSelectedKey: "settings",
        children: (tab) => {
          if (tab().key === "home") {
            return createComponent(Text, { children: "home" });
          }
          const history = new NativeHistory({ initialHref: "/" });
          settingsHistory = history;
          return createComponent(NativeStack, {
            history,
            children: (entry) => {
              const entryId = entry().id;
              const href = entry().href;
              creations.set(entryId, (creations.get(entryId) ?? 0) + 1);
              onCleanup(() => {
                disposals.set(entryId, (disposals.get(entryId) ?? 0) + 1);
              });
              if (href === "/") {
                const [count, updateCount] = createSignal(0);
                setRootCount = updateCount;
                return createComponent(Text, {
                  get children() {
                    return `settings-root:${count()}`;
                  },
                });
              }
              return createComponent(Text, { children: "settings-detail" });
            },
          });
        },
      }),
    host,
    { surface: { name: "nested-native-tabs-stack" }, autoCommit: false },
  );

  const snapshot = () => host.getSurfaceSnapshot(app.root.surfaceId);
  const texts = () =>
    snapshot()
      .nodes.filter((node) => node.kind === "text")
      .map((node) => node.text);
  const tabsHost = () =>
    snapshot().nodes.find(
      (node) => node.kind === "element" && node.component === "TabsHost",
    );
  const screens = () =>
    snapshot().nodes.filter(
      (node) => node.kind === "element" && node.component === "Screen",
    );

  await app.root.flush();
  assert.ok(settingsHistory);
  assert.deepEqual(texts(), ["home", "settings-root:0"]);
  const rootEntryId = settingsHistory.snapshot.entries[0].id;
  const rootScreen = screens()[0].node;
  setRootCount(1);
  settingsHistory.push("/detail");
  await app.root.flush();
  assert.deepEqual(texts(), ["home", "settings-root:1", "settings-detail"]);
  const detailEntryId = settingsHistory.snapshot.entries[1].id;
  const detailScreen = screens()[1].node;

  for (const [selectedScreenKey, provenance] of [
    ["home", 1],
    ["settings", 2],
  ]) {
    host.injectEvent({
      surface: app.root.surfaceId,
      target: tabsHost().node,
      name: "tabSelected",
      payload: {
        selectedScreenKey,
        provenance,
        isRepeated: false,
        hasTriggeredSpecialEffect: false,
        actionOrigin: "user",
      },
      priority: "discrete",
      bubbles: false,
    });
    await app.root.flush();
  }
  assert.equal(screens()[0].node, rootScreen);
  assert.equal(screens()[1].node, detailScreen);
  assert.deepEqual(texts(), ["home", "settings-root:1", "settings-detail"]);

  settingsHistory.back();
  await app.root.flush();
  assert.deepEqual(texts(), ["home", "settings-root:1"]);
  assert.equal(screens()[0].node, rootScreen);
  assert.equal(disposals.get(detailEntryId), 1);
  assert.equal(disposals.get(rootEntryId), undefined);
  assert.equal(creations.get(rootEntryId), 1);
  assert.equal(creations.get(detailEntryId), 1);

  await app.dispose();
  assert.equal(disposals.get(rootEntryId), 1);
});

test("retains a Solid-backed TanStack router inside a native tab owner", async () => {
  globalThis.window ??= globalThis;
  globalThis.self ??= globalThis;

  const host = createRendererHost();
  const ready = deferred();
  const creations = new Map();
  const disposals = new Map();
  let nativeHistory;
  let routerHistory;
  let router;
  let setRootCount;
  let routerOwnerDisposals = 0;
  const app = mount(
    () =>
      createComponent(NativeTabs, {
        tabs: [{ key: "home" }, { key: "settings" }],
        defaultSelectedKey: "settings",
        children: (tab) => {
          if (tab().key === "home") {
            return createComponent(Text, { children: "home-tab" });
          }

          nativeHistory = new NativeHistory({ initialHref: "/" });
          routerHistory = createTanStackNativeHistory(nativeHistory);
          onCleanup(() => {
            routerOwnerDisposals++;
            routerHistory.destroy();
          });
          let renderRoute;
          const RouteComponent = () => renderRoute();
          const rootRoute = new TanStackRootRoute({
            component: TanStackNativeOutlet,
          });
          const homeRoute = new TanStackRoute({
            getParentRoute: () => rootRoute,
            path: "/",
            loader: () => ({ title: "Settings root" }),
            component: RouteComponent,
          });
          const detailRoute = new TanStackRoute({
            getParentRoute: () => rootRoute,
            path: "/detail",
            loader: () => ({ title: "Settings detail" }),
            component: RouteComponent,
          });
          router = createTanStackNativeRouter({
            routeTree: rootRoute.addChildren([homeRoute, detailRoute]),
            history: routerHistory,
            isServer: false,
            defaultPendingMs: 0,
            defaultPendingMinMs: 0,
          });
          renderRoute = () => {
            const screen = useTanStackNativeScreen();
            const loaderData = useTanStackNativeLoaderData();
            const { entryId, href } = untrack(() => ({
              entryId: screen.entry().id,
              href: screen.entry().href,
            }));
            creations.set(entryId, (creations.get(entryId) ?? 0) + 1);
            onCleanup(() => {
              disposals.set(entryId, (disposals.get(entryId) ?? 0) + 1);
            });
            if (href === "/") {
              const [count, updateCount] = createSignal(0);
              setRootCount = updateCount;
              return createComponent(Text, {
                get children() {
                  return `${href}:${loaderData().title}:${count()}`;
                },
              });
            }
            return createComponent(Text, {
              get children() {
                return `${href}:${loaderData().title}`;
              },
            });
          };
          return createComponent(TanStackNativeRouterProvider, {
            router,
            onReady: () => ready.resolve(),
            onError: (error) => {
              throw error;
            },
            get children() {
              return createComponent(TanStackNativeStack, {
                router,
                history: nativeHistory,
                renderUnresolved: (entry) =>
                  createComponent(Text, {
                    get children() {
                      return `loading:${entry().href}`;
                    },
                  }),
              });
            },
          });
        },
      }),
    host,
    { surface: { name: "native-tab-tanstack" }, autoCommit: false },
  );

  const snapshot = () => host.getSurfaceSnapshot(app.root.surfaceId);
  const textNodes = () =>
    snapshot().nodes.filter((node) => node.kind === "text");
  const tabsHost = () =>
    snapshot().nodes.find(
      (node) => node.kind === "element" && node.component === "TabsHost",
    );

  await app.root.flush();
  await ready.promise;
  await app.root.flush();
  assert.ok(nativeHistory);
  assert.ok(routerHistory);
  assert.ok(router);
  assert.equal(router.state.location.pathname, "/");
  const rootEntryId = nativeHistory.location.id;
  const rootText = textNodes().find((node) =>
    node.text.startsWith("/:Settings root:"),
  );
  assert.ok(rootText);
  setRootCount(1);
  await app.root.flush();
  assert.equal(
    textNodes().find((node) => node.node === rootText.node)?.text,
    "/:Settings root:1",
  );

  await router.navigate({ to: "/detail" });
  await app.root.flush();
  const detailEntryId = nativeHistory.location.id;
  const detailText = textNodes().find(
    (node) => node.text === "/detail:Settings detail",
  );
  assert.ok(detailText);

  for (const [selectedScreenKey, provenance] of [
    ["home", 1],
    ["settings", 2],
  ]) {
    host.injectEvent({
      surface: app.root.surfaceId,
      target: tabsHost().node,
      name: "tabSelected",
      payload: {
        selectedScreenKey,
        provenance,
        isRepeated: false,
        hasTriggeredSpecialEffect: false,
        actionOrigin: "user",
      },
      priority: "discrete",
      bubbles: false,
    });
    await app.root.flush();
  }
  assert.equal(
    textNodes().find((node) => node.node === rootText.node)?.text,
    "/:Settings root:1",
  );
  assert.equal(
    textNodes().find((node) => node.node === detailText.node)?.text,
    "/detail:Settings detail",
  );

  routerHistory.back();
  for (let attempt = 0; attempt < 20; attempt++) {
    if (
      router.state.status === "idle" &&
      router.state.location.pathname === "/"
    ) {
      break;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  await app.root.flush();
  assert.equal(router.state.location.pathname, "/");
  assert.equal(
    textNodes().find((node) => node.node === rootText.node)?.text,
    "/:Settings root:1",
  );
  assert.equal(
    textNodes().some((node) => node.node === detailText.node),
    false,
  );
  assert.equal(creations.get(rootEntryId), 1);
  assert.equal(creations.get(detailEntryId), 1);
  assert.equal(disposals.get(rootEntryId), undefined);
  assert.equal(disposals.get(detailEntryId), 1);

  await app.dispose();
  assert.equal(disposals.get(rootEntryId), 1);
  assert.equal(routerOwnerDisposals, 1);
});

test("retains native-stack dismissal through its history commit", async () => {
  const host = createRendererHost("ios");
  const history = new NativeHistory({ initialHref: "/" });
  const records = [];
  let operationSequence = 0;
  const completed = [];
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `native-dismiss-${++operationSequence}`,
  });
  const app = mount(
    () =>
      createComponent(CausalOwner, {
        name: "native-stack.screen",
        get children() {
          return createComponent(NativeStack, {
            history,
            onPlatformBack: (transition) => completed.push(transition),
            children: (entry) =>
              createComponent(Text, {
                get children() {
                  return entry().href;
                },
              }),
          });
        },
      }),
    host,
    {
      surface: { name: "retained-native-dismiss" },
      autoCommit: false,
      telemetry,
    },
  );

  await app.root.flush();
  history.push("/detail");
  await app.root.flush();
  const screen = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) =>
        node.kind === "element" &&
        node.component === "Screen" &&
        node.props.screenId === history.location.id,
    );
  assert.ok(screen);
  host.injectEvent({
    surface: app.root.surfaceId,
    target: screen.node,
    name: "dismiss",
    payload: { dismissCount: 1 },
    priority: "default",
    bubbles: false,
  });
  await new Promise((resolve) => setImmediate(resolve));
  const update = await app.root.flush();
  assert.equal(update.sequence, 3);
  assert.equal(history.location.href, "/");
  assert.equal(completed.length, 1);

  const owner = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.owner" &&
      record.attributes["owner.name"] === "native-stack.screen",
  );
  const event = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      record.attributes["event.name"] === "dismiss",
  );
  const eventFinished = records.find(
    (record) =>
      record.type === "operation-finished" &&
      record.operationId === event?.operationId,
  );
  const commit = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      record.attributes["commit.sequence"] === 3,
  );
  assert.ok(owner);
  assert.ok(event);
  assert.ok(commit);
  assert.equal(event.attributes["event.priority"], "default");
  assert.equal(eventFinished?.status, "ok");
  assert.equal(eventFinished?.attributes["event.handler_count"], 1);
  assert.equal(commit.attributes["commit.priority"], "normal");
  assert.equal(commit.causes.length, 2);
  assert.ok(commit.causes.includes(event.operationId));
  assert.ok(commit.causes.includes(owner.operationId));
  await app.dispose();
});

test("arbitrates prevented native dismiss through TanStack blockers", async () => {
  const host = createRendererHost();
  const nativeHistory = new NativeHistory({ initialHref: "/" });
  const routerHistory = createTanStackNativeHistory(nativeHistory);
  const blockedEntries = [];
  const canceledEntries = [];
  const completedTransitions = [];
  const platformBackErrors = [];
  const routerUpdates = [];
  let diagnosticRejections = 0;
  let blockerInvocations = 0;
  const firstBlockerDecision = deferred();
  let shouldBlock = true;
  routerHistory.subscribe((update) => routerUpdates.push(update));
  const app = mount(
    () =>
      createComponent(NativeStack, {
        history: nativeHistory,
        onPlatformBack: (transition) => completedTransitions.push(transition),
        onPlatformBackBlocked: (entry) => blockedEntries.push(entry),
        onPlatformBackCancel: (entry) => canceledEntries.push(entry),
        onPlatformBackError(error) {
          platformBackErrors.push(error);
          return {
            then(_resolve, reject) {
              diagnosticRejections++;
              reject(new Error("platform-back diagnostic failed"));
            },
          };
        },
        children: (entry) =>
          createComponent(Text, {
            get children() {
              return entry().href;
            },
          }),
      }),
    host,
    { surface: { name: "blocked-native-stack" }, autoCommit: false },
  );

  await app.root.flush();
  nativeHistory.push("/guarded");
  await app.root.flush();
  assert.equal(routerUpdates.length, 1);
  assert.equal(routerUpdates[0].action.type, "PUSH");
  routerUpdates.length = 0;
  const unblock = routerHistory.block({
    async blockerFn({ action, nextLocation }) {
      blockerInvocations++;
      assert.equal(action, "BACK");
      assert.equal(nextLocation.pathname, "/");
      await firstBlockerDecision.promise;
      return shouldBlock;
    },
  });
  await app.root.flush();

  let snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  let guarded = snapshot.nodes.find(
    (node) =>
      node.kind === "element" &&
      node.component === "Screen" &&
      node.props.screenId === nativeHistory.location.id,
  );
  assert.ok(guarded);
  assert.equal(guarded.props.preventNativeDismiss, true);

  // Nested native stacks report a preventNativeDismiss rejection through
  // gestureCancel rather than nativeDismissCancel.
  host.injectEvent({
    surface: app.root.surfaceId,
    target: guarded.node,
    name: "gestureCancel",
    priority: "default",
    bubbles: false,
  });
  // Native containers can report the same prevented gesture through more than
  // one callback before asynchronous blocker arbitration finishes. Coalesce
  // those callbacks instead of attempting an overlapping history transition.
  host.injectEvent({
    surface: app.root.surfaceId,
    target: guarded.node,
    name: "nativeDismissCancel",
    payload: { dismissCount: 1 },
    priority: "default",
    bubbles: false,
  });
  await Promise.resolve();
  assert.equal(nativeHistory.hasPendingPlatformTransition, true);
  assert.equal(blockerInvocations, 1);
  assert.deepEqual(platformBackErrors, []);
  firstBlockerDecision.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(nativeHistory.location.href, "/guarded");
  assert.equal(nativeHistory.hasPendingPlatformTransition, false);
  assert.equal(canceledEntries.length, 0);
  assert.equal(blockedEntries.length, 1);
  assert.equal(completedTransitions.length, 0);
  assert.equal(routerUpdates.length, 0);

  shouldBlock = false;
  const blockerFailure = new Error("native dismiss blocker failed");
  const removeFailingBlocker = nativeHistory.blockPlatformTransitions(() =>
    Promise.reject(blockerFailure),
  );
  host.injectEvent({
    surface: app.root.surfaceId,
    target: guarded.node,
    name: "nativeDismissCancel",
    payload: { dismissCount: 1 },
    priority: "default",
    bubbles: false,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(nativeHistory.location.href, "/guarded");
  assert.equal(nativeHistory.hasPendingPlatformTransition, false);
  assert.deepEqual(platformBackErrors, [blockerFailure]);
  assert.equal(diagnosticRejections, 1);
  assert.equal(routerUpdates.length, 0);
  removeFailingBlocker();

  host.injectEvent({
    surface: app.root.surfaceId,
    target: guarded.node,
    name: "nativeDismissCancel",
    payload: { dismissCount: 1 },
    priority: "default",
    bubbles: false,
  });
  await new Promise((resolve) => setImmediate(resolve));
  await app.root.flush();
  assert.equal(nativeHistory.location.href, "/");
  assert.equal(completedTransitions.length, 1);
  assert.equal(routerUpdates.length, 1);
  assert.equal(routerUpdates[0].action.type, "BACK");

  unblock();
  await app.root.flush();
  snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  guarded = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "Screen",
  );
  assert.equal(guarded?.props.preventNativeDismiss, false);

  routerHistory.destroy();
  await app.dispose();
});

test("owns TanStack routing and renders route states as native nodes", async () => {
  globalThis.window ??= globalThis;
  globalThis.self ??= globalThis;

  const host = createRendererHost();
  const nativeHistory = new NativeHistory({ initialHref: "/" });
  const routerHistory = createTanStackNativeHistory(nativeHistory);
  const detail = deferred();
  const ready = deferred();
  const failure = new Error("loader failed");
  let errorRouteShouldFail = true;
  let retryErrorRoute;
  let router;

  const rootRoute = new TanStackRootRoute();
  const homeRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    loader: () => ({ title: "Home" }),
  });
  const detailRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/detail",
    loader: async () => detail.promise,
  });
  const errorRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/error",
    loader: () => {
      if (errorRouteShouldFail) throw failure;
      return { title: "Recovered" };
    },
  });
  const routeTree = rootRoute.addChildren([homeRoute, detailRoute, errorRoute]);
  const reportedErrors = [];
  const providerFailure = new Error("provider ready failed");
  let diagnosticRejections = 0;
  const app = mount(
    () => {
      router = createTanStackNativeRouter({
        routeTree,
        history: routerHistory,
        isServer: false,
        defaultPendingMs: 0,
        defaultPendingMinMs: 0,
      });
      return createComponent(TanStackNativeRouterProvider, {
        router,
        onReady: () => {
          ready.resolve();
          throw providerFailure;
        },
        onError(error) {
          reportedErrors.push(error);
          return {
            then(_resolve, reject) {
              diagnosticRejections++;
              reject(new Error("provider diagnostic failed"));
            },
          };
        },
        get children() {
          return createComponent(TanStackNativeRouteView, {
            renderPending: () =>
              createComponent(Text, { children: "Loading route" }),
            renderNotFound: () =>
              createComponent(Text, { children: "Not found" }),
            renderError: (error, retry) => {
              retryErrorRoute = retry;
              return createComponent(Text, {
                get children() {
                  return `Error: ${error().message}`;
                },
              });
            },
            children: (match) =>
              createComponent(Text, {
                get children() {
                  return `${match().pathname}: ${match().loaderData?.title ?? "No data"}`;
                },
              }),
          });
        },
      });
    },
    host,
    { surface: { name: "tanstack-native-provider" }, autoCommit: false },
  );
  const renderedText = () =>
    host
      .getSurfaceSnapshot(app.root.surfaceId)
      .nodes.filter((node) => node.kind === "text")
      .map((node) => node.text);

  await app.root.flush();
  assert.deepEqual(renderedText(), ["Loading route"]);
  await ready.promise;
  await app.root.flush();
  assert.deepEqual(renderedText(), ["/: Home"]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(reportedErrors, [providerFailure]);
  assert.equal(diagnosticRejections, 1);

  const detailNavigation = router.navigate({ to: "/detail" });
  await new Promise((resolve) => setImmediate(resolve));
  detail.resolve({ title: "Detail" });
  await detailNavigation;
  await app.root.flush();
  assert.deepEqual(renderedText(), ["/detail: Detail"]);

  await router.navigate({ to: "/error" });
  await app.root.flush();
  assert.deepEqual(renderedText(), ["Error: loader failed"]);
  assert.equal(typeof retryErrorRoute, "function");
  errorRouteShouldFail = false;
  await retryErrorRoute();
  await app.root.flush();
  assert.deepEqual(renderedText(), ["/error: Recovered"]);

  await router.navigate({ to: "/missing" });
  await app.root.flush();
  assert.deepEqual(renderedText(), ["Not found"]);

  const mountedStartTransition = router.startTransition;
  const settledPathname = router.state.location.pathname;
  await app.dispose();
  assert.notEqual(router.startTransition, mountedStartTransition);
  nativeHistory.push("/after-dispose");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(router.state.location.pathname, settledPathname);
  routerHistory.destroy();
});

test("publishes an initial async route guard into a keyed native stack", async () => {
  globalThis.window ??= globalThis;
  globalThis.self ??= globalThis;

  const host = createRendererHost();
  const nativeHistory = new NativeHistory({ initialHref: "/protected" });
  const routerHistory = createTanStackNativeHistory(nativeHistory);
  const credential = deferred();
  const ready = deferred();
  let guardRuns = 0;
  let storage;
  const storageService = createSecureStorage({
    async getItem() {
      await credential.promise;
      return "session";
    },
    async setItem() {},
    async removeItem() {},
  });

  const rootRoute = new TanStackRootRoute({
    component: () => createComponent(TanStackNativeOutlet, {}),
  });
  const protectedRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/protected",
    beforeLoad: async () => {
      guardRuns++;
      assert.equal(await storage.getItem("refresh-session"), "session");
    },
    loader: () => ({ title: "Restored session" }),
    component: () => {
      const data = useTanStackNativeLoaderData();
      return createComponent(Text, {
        get children() {
          return `protected:${data().title}`;
        },
      });
    },
  });
  const router = createTanStackNativeRouter({
    routeTree: rootRoute.addChildren([protectedRoute]),
    history: routerHistory,
    isServer: false,
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
  });
  const app = mount(
    () => {
      storage = createSecureStorageController(storageService);
      return createComponent(TanStackNativeRouterProvider, {
        router,
        onReady: () => ready.resolve(),
        onError: (error) => {
          throw error;
        },
        get children() {
          return createComponent(TanStackNativeStack, {
            router,
            history: nativeHistory,
            renderUnresolved: () =>
              createComponent(Text, { children: "guard pending" }),
          });
        },
      });
    },
    host,
    { surface: { name: "tanstack-native-async-guard" }, autoCommit: false },
  );
  const renderedText = () =>
    host
      .getSurfaceSnapshot(app.root.surfaceId)
      .nodes.filter((node) => node.kind === "text")
      .map((node) => node.text);

  await app.root.flush();
  assert.deepEqual(renderedText(), ["guard pending"]);
  credential.resolve();
  await ready.promise;
  await app.root.flush();
  assert.equal(guardRuns, 1);
  assert.equal(router.state.status, "idle");
  assert.deepEqual(renderedText(), ["protected:Restored session"]);

  await app.dispose();
  routerHistory.destroy();
});

test("navigates through a typed native link with fine-grained route state", async () => {
  globalThis.window ??= globalThis;
  globalThis.self ??= globalThis;

  const host = createRendererHost();
  const records = [];
  let operationSequence = 0;
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `native-link-cause-${++operationSequence}`,
  });
  const nativeHistory = new NativeHistory({ initialHref: "/" });
  const routerHistory = createTanStackNativeHistory(nativeHistory);
  const detail = deferred();
  const ready = deferred();
  const settled = deferred();
  const [linkLabel, setLinkLabel] = createSignal("View details");
  let detailLoads = 0;
  let pressIns = 0;

  const rootRoute = new TanStackRootRoute();
  const homeRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    loader: () => ({ title: "Home" }),
  });
  const detailRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/detail",
    loader: () => {
      detailLoads++;
      return detail.promise;
    },
  });
  const router = createTanStackNativeRouter({
    routeTree: rootRoute.addChildren([homeRoute, detailRoute]),
    history: routerHistory,
    isServer: false,
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
    defaultPreload: "intent",
  });
  const app = mount(
    () =>
      createComponent(TanStackNativeRouterProvider, {
        router,
        onReady: () => ready.resolve(),
        onError: (error) => {
          throw error;
        },
        get children() {
          return createComponent(View, {
            children: [
              createComponent(TanStackNativeLink, {
                options: { to: "/detail" },
                get pressableProps() {
                  return {
                    accessibilityLabel: linkLabel(),
                    onPressIn: () => pressIns++,
                    testID: "detail-link",
                  };
                },
                onNavigationSettled: () => settled.resolve(),
                children: (state) =>
                  createComponent(Text, {
                    get children() {
                      return [
                        state.pressed ? "pressed" : "released",
                        state.isActive ? "active" : "inactive",
                        state.isPending ? "pending" : "not-pending",
                        state.isTransitioning ? "transitioning" : "settled",
                        state.isPreloading ? "preloading" : "not-preloading",
                      ].join(":");
                    },
                  }),
              }),
              createComponent(TanStackNativeRouteView, {
                renderPending: () =>
                  createComponent(Text, { children: "Loading route" }),
                renderNotFound: () =>
                  createComponent(Text, { children: "Not found" }),
                renderError: (error) =>
                  createComponent(Text, {
                    get children() {
                      return `Error: ${error().message}`;
                    },
                  }),
                children: (match) =>
                  createComponent(Text, {
                    get children() {
                      return `${match().pathname}: ${match().loaderData?.title}`;
                    },
                  }),
              }),
            ],
          });
        },
      }),
    host,
    {
      surface: { name: "tanstack-native-link" },
      autoCommit: false,
      telemetry,
    },
  );
  const snapshot = () => host.getSurfaceSnapshot(app.root.surfaceId);
  const renderedText = () =>
    snapshot()
      .nodes.filter((node) => node.kind === "text")
      .map((node) => node.text);
  const link = () =>
    snapshot().nodes.find(
      (node) =>
        node.kind === "element" &&
        node.component === "Pressable" &&
        node.props.testID === "detail-link",
    );

  await app.root.flush();
  await ready.promise;
  await app.root.flush();
  assert.deepEqual(renderedText(), [
    "released:inactive:not-pending:settled:not-preloading",
    "/: Home",
  ]);
  assert.deepEqual(link()?.props.accessibilityState, {
    disabled: false,
    selected: false,
    busy: false,
  });
  assert.equal(link()?.props.accessibilityRole, "link");
  assert.equal(link()?.props.accessibilityLabel, "View details");
  setLinkLabel("Open detail");
  await app.root.flush();
  assert.equal(link()?.props.accessibilityLabel, "Open detail");

  const interactionStart = records.length;
  host.injectEvent({
    surface: app.root.surfaceId,
    target: link().node,
    name: "pressIn",
    priority: "discrete",
    bubbles: true,
  });
  await new Promise((resolve) => setImmediate(resolve));
  await app.root.flush();
  assert.equal(
    renderedText()[0],
    "pressed:inactive:not-pending:settled:preloading",
  );
  assert.equal(detailLoads, 1);
  assert.equal(pressIns, 1);

  for (const name of ["pressOut", "press"]) {
    host.injectEvent({
      surface: app.root.surfaceId,
      target: link().node,
      name,
      priority: "discrete",
      bubbles: true,
    });
  }
  await new Promise((resolve) => setImmediate(resolve));
  await app.root.flush();
  assert.equal(detailLoads, 1);
  assert.equal(
    renderedText()[0],
    "released:inactive:pending:transitioning:preloading",
  );
  assert.deepEqual(link()?.props.accessibilityState, {
    disabled: false,
    selected: false,
    busy: true,
  });

  host.injectEvent({
    surface: app.root.surfaceId,
    target: link().node,
    name: "press",
    priority: "discrete",
    bubbles: true,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(detailLoads, 1);

  detail.resolve({ title: "Detail" });
  await settled.promise;
  await app.root.flush();
  assert.equal(router.state.location.pathname, "/detail");
  assert.deepEqual(renderedText(), [
    "released:active:not-pending:settled:not-preloading",
    "/detail: Detail",
  ]);
  assert.deepEqual(link()?.props.accessibilityState, {
    disabled: false,
    selected: true,
    busy: false,
  });

  const interaction = records.slice(interactionStart);
  const pressOperation = interaction.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      record.attributes["event.name"] === "press",
  );
  const navigationTask = interaction.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.task" &&
      record.attributes["task.name"] === "navigation.link",
  );
  const causedCommits = interaction.filter(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      record.causes.includes(navigationTask?.operationId),
  );
  const navigationFinished = interaction.find(
    (record) =>
      record.type === "operation-finished" &&
      record.operationId === navigationTask?.operationId,
  );
  assert.ok(pressOperation);
  assert.ok(navigationTask);
  assert.deepEqual(navigationTask.attributes, {
    "task.name": "navigation.link",
  });
  assert.deepEqual(navigationTask.causes, [pressOperation.operationId]);
  assert.ok(causedCommits.length >= 2);
  assert.equal(causedCommits.at(-1)?.attributes["commit.priority"], "normal");
  assert.equal(navigationFinished?.status, "ok");

  await app.dispose();
  routerHistory.destroy();
});

test("preloads native links after render and isolates preload diagnostics", async () => {
  globalThis.window ??= globalThis;
  globalThis.self ??= globalThis;

  const host = createRendererHost();
  const nativeHistory = new NativeHistory({ initialHref: "/" });
  const routerHistory = createTanStackNativeHistory(nativeHistory);
  const warm = deferred();
  let warmLoads = 0;
  const rootRoute = new TanStackRootRoute();
  const homeRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/",
  });
  const warmRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/warm",
    loader: () => {
      warmLoads++;
      return warm.promise;
    },
  });
  const router = createTanStackNativeRouter({
    routeTree: rootRoute.addChildren([homeRoute, warmRoute]),
    history: routerHistory,
    isServer: false,
  });
  await router.load();

  const app = mount(
    () =>
      createComponent(TanStackNativeLink, {
        router,
        options: { to: "/warm" },
        preload: "render",
        children: (state) =>
          createComponent(Text, {
            get children() {
              return state.isPreloading ? "warming" : "idle";
            },
          }),
      }),
    host,
    { surface: { name: "tanstack-native-render-preload" }, autoCommit: false },
  );
  const renderedText = () =>
    host
      .getSurfaceSnapshot(app.root.surfaceId)
      .nodes.find((node) => node.kind === "text")?.text;

  await app.root.flush();
  await new Promise((resolve) => setImmediate(resolve));
  await app.root.flush();
  assert.equal(warmLoads, 1);
  assert.equal(renderedText(), "warming");

  warm.resolve({ title: "Warm" });
  await new Promise((resolve) => setImmediate(resolve));
  await app.root.flush();
  assert.equal(renderedText(), "idle");
  await app.dispose();

  const preloadFailure = new Error("native link preload failed");
  const preloadErrors = [];
  let diagnosticRejections = 0;
  const originalPreloadRoute = router.preloadRoute;
  router.preloadRoute = () => Promise.reject(preloadFailure);
  const failingApp = mount(
    () =>
      createComponent(TanStackNativeLink, {
        router,
        options: { to: "/warm" },
        preload: "render",
        onPreloadError(error) {
          preloadErrors.push(error);
          return {
            then(_resolve, reject) {
              diagnosticRejections++;
              reject(new Error("native link preload diagnostic failed"));
            },
          };
        },
        children: (state) =>
          createComponent(Text, {
            get children() {
              return state.isPreloading ? "failing" : "contained";
            },
          }),
      }),
    host,
    {
      surface: { name: "tanstack-native-preload-error" },
      autoCommit: false,
    },
  );
  await failingApp.root.flush();
  await new Promise((resolve) => setImmediate(resolve));
  await failingApp.root.flush();
  assert.deepEqual(preloadErrors, [preloadFailure]);
  assert.equal(diagnosticRejections, 1);
  assert.equal(
    host
      .getSurfaceSnapshot(failingApp.root.surfaceId)
      .nodes.find((node) => node.kind === "text")?.text,
    "contained",
  );

  await failingApp.dispose();
  const latePreload = deferred();
  router.preloadRoute = () => latePreload.promise;
  const disposedApp = mount(
    () =>
      createComponent(TanStackNativeLink, {
        router,
        options: { to: "/warm" },
        preload: "render",
        children: (state) =>
          createComponent(Text, {
            get children() {
              return state.isPreloading ? "late warming" : "late idle";
            },
          }),
      }),
    host,
    {
      surface: { name: "tanstack-native-disposed-preload" },
      autoCommit: false,
    },
  );
  await disposedApp.root.flush();
  await new Promise((resolve) => setImmediate(resolve));
  await disposedApp.root.flush();
  assert.equal(
    host
      .getSurfaceSnapshot(disposedApp.root.surfaceId)
      .nodes.find((node) => node.kind === "text")?.text,
    "late warming",
  );
  await disposedApp.dispose();
  latePreload.resolve([]);
  await new Promise((resolve) => setImmediate(resolve));

  router.preloadRoute = originalPreloadRoute;
  routerHistory.destroy();
});

test("redirects protected native routes and owns typed relative navigation", async () => {
  globalThis.window ??= globalThis;
  globalThis.self ??= globalThis;

  const host = createRendererHost();
  const records = [];
  let operationSequence = 0;
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `native-redirect-cause-${++operationSequence}`,
  });
  const nativeHistory = new NativeHistory({ initialHref: "/protected" });
  const routerHistory = createTanStackNativeHistory(nativeHistory);
  const ready = deferred();
  let navigateFromLogin;

  const LoginComponent = () => {
    navigateFromLogin = useTanStackNativeNavigate({ from: "/login" });
    return createComponent(Text, { children: "Sign in" });
  };
  const rootRoute = new TanStackRootRoute({
    component: () => createComponent(TanStackNativeOutlet, {}),
  });
  const loginRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/login",
    component: LoginComponent,
  });
  const protectedRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/protected",
    beforeLoad: () => {
      throw tanStackRedirect({ to: "/login", replace: true });
    },
    component: () => createComponent(Text, { children: "Protected" }),
  });
  const homeRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/home",
    component: () => createComponent(Text, { children: "Home" }),
  });
  const router = createTanStackNativeRouter({
    routeTree: rootRoute.addChildren([loginRoute, protectedRoute, homeRoute]),
    history: routerHistory,
    isServer: false,
  });
  const app = mount(
    () =>
      createComponent(TanStackNativeRouterProvider, {
        router,
        onReady: () => ready.resolve(),
        onError: (error) => {
          throw error;
        },
        get children() {
          return createComponent(TanStackNativeMatches, {});
        },
      }),
    host,
    {
      surface: { name: "tanstack-native-auth-redirect" },
      autoCommit: false,
      telemetry,
    },
  );
  const renderedText = () =>
    host
      .getSurfaceSnapshot(app.root.surfaceId)
      .nodes.filter((node) => node.kind === "text")
      .map((node) => node.text);

  await app.root.flush();
  await ready.promise;
  await app.root.flush();
  assert.equal(router.state.location.pathname, "/login");
  assert.deepEqual(nativeHistory.snapshot, {
    entries: [
      {
        id: nativeHistory.location.id,
        href: "/login",
        state: nativeHistory.location.state,
      },
    ],
    index: 0,
  });
  assert.deepEqual(renderedText(), ["Sign in"]);
  assert.equal(typeof navigateFromLogin, "function");

  assert.throws(
    () => navigateFromLogin({ href: "https://example.com" }),
    /only accepts client-native route navigation/,
  );
  const navigationStart = records.length;
  await navigateFromLogin({ to: "../home" });
  await app.root.flush();
  assert.equal(router.state.location.pathname, "/home");
  assert.equal(nativeHistory.location.href, "/home");
  assert.equal(nativeHistory.snapshot.entries.length, 2);
  assert.deepEqual(renderedText(), ["Home"]);

  const navigationRecords = records.slice(navigationStart);
  const navigationTask = navigationRecords.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.task" &&
      record.attributes["task.name"] === "navigation.programmatic",
  );
  const finalCommit = navigationRecords.findLast(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit",
  );
  assert.ok(navigationTask);
  assert.deepEqual(navigationTask.attributes, {
    "task.name": "navigation.programmatic",
  });
  assert.deepEqual(finalCommit?.causes, [navigationTask.operationId]);

  await app.dispose();
  routerHistory.destroy();
});

test("bounds latest-wins programmatic navigation causal tasks", async () => {
  globalThis.window ??= globalThis;
  globalThis.self ??= globalThis;

  const host = createRendererHost();
  const records = [];
  let operationSequence = 0;
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `native-navigation-bound-${++operationSequence}`,
  });
  const nativeHistory = new NativeHistory({ initialHref: "/" });
  const routerHistory = createTanStackNativeHistory(nativeHistory);
  const ready = deferred();
  const first = deferred();
  const second = deferred();
  const pendingAtDisposal = deferred();
  const navigationFailure = new Error("private route-loader canary");
  let navigate;
  let navigationCall = 0;

  const CaptureNavigate = () => {
    navigate = useTanStackNativeNavigate({ from: "/" });
    return createComponent(Text, { children: "Ready" });
  };
  const rootRoute = new TanStackRootRoute();
  const homeRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/",
  });
  const router = createTanStackNativeRouter({
    routeTree: rootRoute.addChildren([homeRoute]),
    history: routerHistory,
    isServer: false,
  });
  const app = mount(
    () =>
      createComponent(TanStackNativeRouterProvider, {
        router,
        onReady: () => ready.resolve(),
        onError: (error) => {
          throw error;
        },
        get children() {
          return createComponent(CaptureNavigate, {});
        },
      }),
    host,
    {
      surface: { name: "tanstack-native-navigation-task-bounds" },
      autoCommit: false,
      telemetry,
    },
  );

  await app.root.flush();
  await ready.promise;
  assert.equal(typeof navigate, "function");

  router.navigate = () => {
    navigationCall++;
    if (navigationCall === 1) return first.promise;
    if (navigationCall === 2) return second.promise;
    if (navigationCall === 3) return Promise.reject(navigationFailure);
    return pendingAtDisposal.promise;
  };

  const firstNavigation = navigate({ to: "." });
  const secondNavigation = navigate({ to: "." });
  const taskStarts = () =>
    records.filter(
      (record) =>
        record.type === "operation-started" &&
        record.name === "solid-native.task" &&
        record.attributes["task.name"] === "navigation.programmatic",
    );
  const taskFinish = (operationId) =>
    records.find(
      (record) =>
        record.type === "operation-finished" &&
        record.operationId === operationId,
    );

  assert.equal(taskStarts().length, 2);
  assert.equal(taskFinish(taskStarts()[0].operationId)?.status, "cancelled");
  assert.equal(taskFinish(taskStarts()[1].operationId), undefined);

  second.resolve();
  await secondNavigation;
  assert.equal(taskFinish(taskStarts()[1].operationId)?.status, "ok");
  first.resolve();
  await firstNavigation;
  assert.equal(taskFinish(taskStarts()[0].operationId)?.status, "cancelled");

  await assert.rejects(() => navigate({ to: "." }), navigationFailure);
  const failedTask = taskStarts()[2];
  const failedTaskFinish = taskFinish(failedTask.operationId);
  assert.equal(failedTaskFinish?.status, "error");
  assert.deepEqual(failedTaskFinish?.attributes, { "error.type": "Error" });
  assert.equal(JSON.stringify(failedTaskFinish).includes("canary"), false);

  const disposedNavigation = navigate({ to: "." });
  const disposedTask = taskStarts()[3];
  assert.equal(taskFinish(disposedTask.operationId), undefined);
  await app.dispose();
  assert.equal(taskFinish(disposedTask.operationId)?.status, "cancelled");
  pendingAtDisposal.resolve();
  await disposedNavigation;
  assert.equal(taskFinish(disposedTask.operationId)?.status, "cancelled");

  routerHistory.destroy();
});

test("interrupts an authenticated async route without committing stale native history", async () => {
  globalThis.window ??= globalThis;
  globalThis.self ??= globalThis;

  const host = createRendererHost();
  const records = [];
  let operationSequence = 0;
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `native-product-navigation-${++operationSequence}`,
  });
  const nativeHistory = new NativeHistory({ initialHref: "/protected" });
  const routerHistory = createTanStackNativeHistory(nativeHistory);
  const ready = deferred();
  const slowLoader = deferred();
  const homeLoader = deferred();
  let authenticated = false;
  let navigateFromLogin;
  let interruptNavigation;
  let slowLoaderRuns = 0;
  let homeLoaderRuns = 0;

  const LoginComponent = () => {
    navigateFromLogin = useTanStackNativeNavigate({ from: "/login" });
    interruptNavigation = useTanStackNativeNavigate();
    return createComponent(Text, { children: "Sign in" });
  };
  const rootRoute = new TanStackRootRoute({
    component: () => createComponent(TanStackNativeOutlet, {}),
  });
  const protectedRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/protected",
    beforeLoad: () => {
      if (!authenticated) {
        throw tanStackRedirect({ to: "/login", replace: true });
      }
    },
    component: () => createComponent(Text, { children: "Protected" }),
  });
  const loginRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/login",
    component: LoginComponent,
  });
  const slowRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/slow",
    loader: () => {
      slowLoaderRuns++;
      return slowLoader.promise;
    },
    component: () =>
      createComponent(Text, { children: "Stale protected data" }),
  });
  const homeRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/home",
    loader: () => {
      homeLoaderRuns++;
      return homeLoader.promise;
    },
    component: () => createComponent(Text, { children: "Authenticated home" }),
  });
  const router = createTanStackNativeRouter({
    routeTree: rootRoute.addChildren([
      protectedRoute,
      loginRoute,
      slowRoute,
      homeRoute,
    ]),
    history: routerHistory,
    isServer: false,
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
  });
  const app = mount(
    () =>
      createComponent(TanStackNativeRouterProvider, {
        router,
        onReady: () => ready.resolve(),
        onError: (error) => ready.reject(error),
        get children() {
          return createComponent(TanStackNativeMatches, {});
        },
      }),
    host,
    {
      surface: { name: "tanstack-native-product-interruption" },
      autoCommit: false,
      telemetry,
    },
  );

  await app.root.flush();
  await ready.promise;
  await app.root.flush();
  assert.equal(router.state.location.pathname, "/login");
  assert.deepEqual(
    nativeHistory.snapshot.entries.map((entry) => entry.href),
    ["/login"],
  );
  assert.equal(typeof navigateFromLogin, "function");
  assert.equal(typeof interruptNavigation, "function");

  authenticated = true;
  const navigationRecordStart = records.length;
  const displacedNavigation = navigateFromLogin({ to: "../slow" });
  const displacedSettlement = displacedNavigation.then(
    () => "ok",
    () => "error",
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(slowLoaderRuns, 1);

  const winningNavigation = interruptNavigation({
    to: "/home",
    replace: true,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(homeLoaderRuns, 1);
  await app.root.flush();
  homeLoader.resolve({ proof: "home" });
  await winningNavigation;
  await app.root.flush();

  const taskStarts = records
    .slice(navigationRecordStart)
    .filter(
      (record) =>
        record.type === "operation-started" &&
        record.name === "solid-native.task" &&
        record.attributes["task.name"] === "navigation.programmatic",
    );
  const taskFinish = (operationId) =>
    records.find(
      (record) =>
        record.type === "operation-finished" &&
        record.operationId === operationId,
    );
  assert.equal(taskStarts.length, 2);
  assert.equal(taskFinish(taskStarts[0].operationId)?.status, "cancelled");
  assert.equal(taskFinish(taskStarts[1].operationId)?.status, "ok");
  assert.equal(router.state.location.pathname, "/home");
  assert.deepEqual(
    nativeHistory.snapshot.entries.map((entry) => entry.href),
    ["/login", "/home"],
  );
  assert.equal(
    host
      .getSurfaceSnapshot(app.root.surfaceId)
      .nodes.some(
        (node) => node.kind === "text" && node.text === "Authenticated home",
      ),
    true,
  );
  const winningCommits = records.filter(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      record.causes.includes(taskStarts[1].operationId),
  );
  assert.ok(winningCommits.length >= 1);
  assert.equal(winningCommits.at(-1)?.attributes["commit.priority"], "normal");

  slowLoader.resolve({ proof: "slow" });
  await displacedSettlement;
  await new Promise((resolve) => setImmediate(resolve));
  await app.root.flush();
  assert.equal(router.state.location.pathname, "/home");
  assert.deepEqual(
    nativeHistory.snapshot.entries.map((entry) => entry.href),
    ["/login", "/home"],
  );
  const finalWinningSequence =
    winningCommits.at(-1)?.attributes["commit.sequence"];
  const laterCommits = records.filter(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      typeof record.attributes["commit.sequence"] === "number" &&
      typeof finalWinningSequence === "number" &&
      record.attributes["commit.sequence"] > finalWinningSequence,
  );
  assert.equal(
    laterCommits.some((record) =>
      taskStarts.some((task) => record.causes.includes(task.operationId)),
    ),
    false,
  );
  assert.equal(
    laterCommits.every(
      (record) => record.attributes["commit.priority"] === "normal",
    ),
    true,
  );

  await app.dispose();
  routerHistory.destroy();
});

test("renders nested TanStack route components and typed match selectors", async () => {
  globalThis.window ??= globalThis;
  globalThis.self ??= globalThis;

  const host = createRendererHost();
  const nativeHistory = new NativeHistory({ initialHref: "/" });
  const routerHistory = createTanStackNativeHistory(nativeHistory);
  const detail = deferred();
  const ready = deferred();
  const failure = new Error("nested loader failed");
  const componentFailure = new Error("component render failed");
  let errorRouteShouldFail = true;
  let componentShouldFail = true;
  let retryErrorRoute;
  let retryComponentRoute;
  let router;

  const RootComponent = () => {
    const routeId = useTanStackNativeMatch({
      select: (match) => match.routeId,
    });
    return createComponent(View, {
      get children() {
        return [
          createComponent(Text, {
            get children() {
              return `Layout ${routeId()}`;
            },
          }),
          createComponent(TanStackNativeOutlet, {}),
        ];
      },
    });
  };
  const HomeComponent = () => {
    const loaderData = useTanStackNativeLoaderData();
    return createComponent(Text, {
      get children() {
        return loaderData().title;
      },
    });
  };
  const DetailComponent = () => {
    const title = useTanStackNativeLoaderData({
      from: "/detail",
      select: (loaderData) => loaderData.title,
    });
    return createComponent(Text, {
      get children() {
        return title();
      },
    });
  };
  const rootRoute = new TanStackRootRoute({
    component: RootComponent,
    notFoundComponent: () =>
      createComponent(Text, { children: "Nested not found" }),
  });
  const homeRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    loader: () => ({ title: "Nested home" }),
    component: HomeComponent,
  });
  const detailRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/detail",
    loader: async () => detail.promise,
    pendingComponent: ({ match }) =>
      createComponent(Text, {
        get children() {
          return `Pending ${match().pathname}`;
        },
      }),
    component: DetailComponent,
  });
  const errorRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/error",
    loader: () => {
      if (errorRouteShouldFail) throw failure;
      return { title: "Nested recovered" };
    },
    component: HomeComponent,
    errorComponent: ({ error, retry }) => {
      retryErrorRoute = retry;
      return createComponent(Text, {
        get children() {
          return `Nested error: ${error().message}`;
        },
      });
    },
  });
  const componentErrorRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/component-error",
    loader: () => ({ title: "Component recovered" }),
    component: () => {
      if (componentShouldFail) throw componentFailure;
      return createComponent(Text, { children: "Component recovered" });
    },
    errorComponent: ({ error, retry }) => {
      retryComponentRoute = retry;
      return createComponent(Text, {
        get children() {
          return `Component error: ${error().message}`;
        },
      });
    },
  });
  const routeTree = rootRoute.addChildren([
    homeRoute,
    detailRoute,
    errorRoute,
    componentErrorRoute,
  ]);
  const app = mount(
    () => {
      router = createTanStackNativeRouter({
        routeTree,
        history: routerHistory,
        isServer: false,
        defaultPendingMs: 0,
        defaultPendingMinMs: 0,
      });
      return createComponent(TanStackNativeRouterProvider, {
        router,
        onReady: () => ready.resolve(),
        onError: (error) => {
          throw error;
        },
        get children() {
          return createComponent(TanStackNativeMatches, {});
        },
      });
    },
    host,
    { surface: { name: "tanstack-native-matches" }, autoCommit: false },
  );
  const renderedText = () =>
    host
      .getSurfaceSnapshot(app.root.surfaceId)
      .nodes.filter((node) => node.kind === "text")
      .map((node) => node.text);

  await app.root.flush();
  await ready.promise;
  await app.root.flush();
  assert.deepEqual(renderedText(), ["Layout __root__", "Nested home"]);

  const detailNavigation = router.navigate({ to: "/detail" });
  await new Promise((resolve) => setImmediate(resolve));
  await app.root.flush();
  assert.deepEqual(renderedText(), ["Layout __root__", "Pending /detail"]);
  detail.resolve({ title: "Nested detail" });
  await detailNavigation;
  await app.root.flush();
  assert.deepEqual(renderedText(), ["Layout __root__", "Nested detail"]);

  await router.navigate({ to: "/error" });
  await app.root.flush();
  assert.deepEqual(renderedText(), [
    "Layout __root__",
    "Nested error: nested loader failed",
  ]);
  errorRouteShouldFail = false;
  await retryErrorRoute();
  await app.root.flush();
  assert.deepEqual(renderedText(), ["Layout __root__", "Nested recovered"]);

  await router.navigate({ to: "/component-error" });
  await app.root.flush();
  assert.deepEqual(renderedText(), [
    "Layout __root__",
    "Component error: component render failed",
  ]);
  componentShouldFail = false;
  await retryComponentRoute();
  await app.root.flush();
  assert.deepEqual(renderedText(), ["Layout __root__", "Component recovered"]);

  await router.navigate({ to: "/missing" });
  await app.root.flush();
  assert.deepEqual(renderedText(), ["Nested not found"]);

  await app.dispose();
  routerHistory.destroy();
});

test("freezes TanStack matches inside keyed inactive native screens", async () => {
  globalThis.window ??= globalThis;
  globalThis.self ??= globalThis;

  const host = createRendererHost();
  const nativeHistory = new NativeHistory({ initialHref: "/" });
  const routerHistory = createTanStackNativeHistory(nativeHistory);
  const ready = deferred();
  let router;
  let homeCreates = 0;
  let homeDisposes = 0;
  let detailCreates = 0;
  let detailDisposes = 0;
  let homeLoads = 0;
  let setHomeVersion;
  let setDetailVersion;

  const RootComponent = () =>
    createComponent(View, {
      get children() {
        return createComponent(TanStackNativeOutlet, {});
      },
    });
  const HomeComponent = () => {
    homeCreates++;
    onCleanup(() => homeDisposes++);
    const screen = useTanStackNativeScreen();
    const [version, setVersion] = createSignal(0);
    setHomeVersion = setVersion;
    return createComponent(Text, {
      get children() {
        return `home:${screen.entry().id}:${version()}`;
      },
    });
  };
  const DetailComponent = () => {
    detailCreates++;
    onCleanup(() => detailDisposes++);
    const screen = useTanStackNativeScreen();
    const [version, setVersion] = createSignal(0);
    setDetailVersion = setVersion;
    return createComponent(Text, {
      get children() {
        return `detail:${screen.entry().id}:${version()}`;
      },
    });
  };
  const rootRoute = new TanStackRootRoute({ component: RootComponent });
  const homeRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    loader: () => {
      homeLoads++;
      return { title: "Home" };
    },
    component: HomeComponent,
  });
  const detailRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/detail",
    loader: () => ({ title: "Detail" }),
    component: DetailComponent,
  });
  const routeTree = rootRoute.addChildren([homeRoute, detailRoute]);
  router = createTanStackNativeRouter({
    routeTree,
    history: routerHistory,
    isServer: false,
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
  });
  await router.load();
  const app = mount(
    () =>
      createComponent(TanStackNativeRouterProvider, {
        router,
        onReady: () => ready.resolve(),
        onError: (error) => {
          throw error;
        },
        get children() {
          return createComponent(TanStackNativeStack, {
            history: nativeHistory,
            renderUnresolved: (entry) =>
              createComponent(Text, {
                get children() {
                  return `unresolved:${entry().href}`;
                },
              }),
          });
        },
      }),
    host,
    { surface: { name: "tanstack-native-stack" }, autoCommit: false },
  );
  const textNodes = () =>
    host
      .getSurfaceSnapshot(app.root.surfaceId)
      .nodes.filter((node) => node.kind === "text");

  await app.root.flush();
  assert.equal(homeLoads, 1);
  await ready.promise;
  await app.root.flush();
  let homeText = textNodes().find((node) => node.text.startsWith("home:"));
  assert.ok(homeText);
  const homeNode = homeText.node;
  assert.equal(homeCreates, 1);
  assert.equal(homeDisposes, 0);

  await router.navigate({ to: "/detail" });
  await app.root.flush();
  assert.equal(homeCreates, 1);
  assert.equal(homeDisposes, 0);
  assert.equal(detailCreates, 1);
  assert.equal(detailDisposes, 0);
  assert.equal(
    textNodes().filter((node) => node.text.startsWith("home:")).length,
    1,
  );
  assert.equal(
    textNodes().filter((node) => node.text.startsWith("detail:")).length,
    1,
  );

  setHomeVersion(1);
  setDetailVersion(1);
  await app.root.flush();
  homeText = textNodes().find((node) => node.text.startsWith("home:"));
  assert.equal(homeText?.node, homeNode);
  assert.equal(homeText?.text.endsWith(":1"), true);

  routerHistory.back();
  for (let attempt = 0; attempt < 20; attempt++) {
    if (
      router.state.status === "idle" &&
      router.state.location.pathname === "/"
    )
      break;
    await new Promise((resolve) => setImmediate(resolve));
  }
  await app.root.flush();
  homeText = textNodes().find((node) => node.text.startsWith("home:"));
  assert.equal(router.state.location.pathname, "/");
  assert.equal(homeText?.node, homeNode);
  assert.equal(homeCreates, 1);
  assert.equal(homeDisposes, 0);
  assert.equal(detailCreates, 1);
  assert.equal(detailDisposes, 1);
  assert.equal(
    textNodes().some((node) => node.text.startsWith("detail:")),
    false,
  );

  const priorHomeEntryId = nativeHistory.location.id;
  nativeHistory.reset([{ href: "/detail", state: null }]);
  for (let attempt = 0; attempt < 20; attempt++) {
    if (
      router.state.status === "idle" &&
      router.state.location.pathname === "/detail"
    )
      break;
    await new Promise((resolve) => setImmediate(resolve));
  }
  await app.root.flush();
  const resetDetailText = textNodes().find((node) =>
    node.text.startsWith("detail:"),
  );
  assert.equal(homeDisposes, 1);
  assert.equal(detailCreates, 2);
  assert.equal(detailDisposes, 1);
  assert.notEqual(nativeHistory.location.id, priorHomeEntryId);
  assert.equal(resetDetailText?.text.includes(nativeHistory.location.id), true);

  await app.dispose();
  assert.equal(homeDisposes, 1);
  assert.equal(detailDisposes, 2);
  routerHistory.destroy();
});

test("restores a process-durable native scroll snapshot after first focus", async () => {
  globalThis.window ??= globalThis;
  globalThis.self ??= globalThis;

  const host = createRendererHost();
  const nativeHistory = new NativeHistory({
    snapshot: {
      entries: [{ id: "restored-root", href: "/", state: null }],
      index: 0,
    },
  });
  const scrollRestoration = new NativeScrollRestoration(nativeHistory, {
    snapshot: {
      entries: [
        {
          entryId: "restored-root",
          containers: [{ restorationKey: "feed", x: 12, y: 256 }],
        },
      ],
    },
  });
  const routerHistory = createTanStackNativeHistory(nativeHistory);
  const ready = deferred();
  const RootComponent = () => createComponent(TanStackNativeOutlet, {});
  const HomeComponent = () =>
    createComponent(TanStackNativeScrollView, {
      restorationKey: "feed",
      children: createComponent(Text, { children: "restored:home" }),
    });
  const rootRoute = new TanStackRootRoute({ component: RootComponent });
  const homeRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: HomeComponent,
  });
  const router = createTanStackNativeRouter({
    routeTree: rootRoute.addChildren([homeRoute]),
    history: routerHistory,
    isServer: false,
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
  });
  await router.load();
  const app = mount(
    () =>
      createComponent(TanStackNativeRouterProvider, {
        router,
        onReady: () => ready.resolve(),
        onError: (error) => {
          throw error;
        },
        get children() {
          return createComponent(TanStackNativeStack, {
            history: nativeHistory,
            scrollRestoration,
            renderUnresolved: (entry) =>
              createComponent(Text, {
                get children() {
                  return `unresolved:${entry().href}`;
                },
              }),
          });
        },
      }),
    host,
    { surface: { name: "tanstack-durable-scroll" }, autoCommit: false },
  );
  await app.root.flush();
  await ready.promise;
  await app.root.flush();
  const snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  const screen = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "Screen",
  );
  const scrollView = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "ScrollView",
  );
  assert.ok(screen);
  assert.ok(scrollView);
  host.injectEvent({
    surface: app.root.surfaceId,
    target: screen.node,
    name: "focus",
    priority: "default",
    bubbles: false,
  });
  await app.root.flush();
  assert.deepEqual(
    host.commits
      .flatMap((commit) => commit.mutations)
      .filter(
        (mutation) =>
          mutation.type === "command" && mutation.command === "scrollTo",
      ),
    [
      {
        type: "command",
        node: scrollView.node,
        command: "scrollTo",
        args: [12, 256, false],
      },
    ],
  );

  await app.dispose();
  scrollRestoration.capture("restored-root", "feed", { x: 0, y: 320 });
  assert.deepEqual(scrollRestoration.read("restored-root", "feed"), {
    x: 0,
    y: 320,
  });
  scrollRestoration.dispose();
  routerHistory.destroy();
});

test("parks inactive TanStack route trees without replacing native screens", async () => {
  globalThis.window ??= globalThis;
  globalThis.self ??= globalThis;

  const host = createRendererHost();
  const nativeHistory = new NativeHistory({ initialHref: "/" });
  const routerHistory = createTanStackNativeHistory(nativeHistory);
  const ready = deferred();
  const [routeTreeLimit, setRouteTreeLimit] = createSignal();
  let homeCreates = 0;
  let homeDisposes = 0;
  let detailCreates = 0;
  let detailDisposes = 0;
  let homeScrollEvents = 0;
  const homeScrollRefs = [];
  const homeScrollRestorationErrors = [];

  const RootComponent = () => createComponent(TanStackNativeOutlet, {});
  const HomeComponent = () => {
    homeCreates++;
    onCleanup(() => homeDisposes++);
    return createComponent(TanStackNativeScrollView, {
      restorationKey: "feed",
      ref: (node) => homeScrollRefs.push(node),
      onScroll: () => homeScrollEvents++,
      onRestorationError: (error, entry, restorationKey) =>
        homeScrollRestorationErrors.push({ error, entry, restorationKey }),
      children: createComponent(Text, { children: "mounted:home" }),
    });
  };
  const DetailComponent = () => {
    detailCreates++;
    onCleanup(() => detailDisposes++);
    return createComponent(Text, { children: "mounted:detail" });
  };
  const rootRoute = new TanStackRootRoute({ component: RootComponent });
  const homeRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: HomeComponent,
  });
  const detailRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/detail",
    component: DetailComponent,
  });
  const router = createTanStackNativeRouter({
    routeTree: rootRoute.addChildren([homeRoute, detailRoute]),
    history: routerHistory,
    isServer: false,
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
  });
  await router.load();
  assert.throws(
    () =>
      TanStackNativeStack({
        router,
        history: nativeHistory,
        maxMountedRouteTrees: 0,
        renderUnresolved: () => undefined,
      }),
    /maxMountedRouteTrees must be an integer between 1 and 512/,
  );

  const app = mount(
    () =>
      createComponent(TanStackNativeRouterProvider, {
        router,
        onReady: () => ready.resolve(),
        onError: (error) => {
          throw error;
        },
        get children() {
          return createComponent(TanStackNativeStack, {
            history: nativeHistory,
            get maxMountedRouteTrees() {
              return routeTreeLimit();
            },
            renderUnresolved: (entry) =>
              createComponent(Text, {
                get children() {
                  return `unresolved:${entry().href}`;
                },
              }),
            renderParked: (entry) =>
              createComponent(Text, {
                get children() {
                  return `parked:${entry().href}`;
                },
              }),
          });
        },
      }),
    host,
    { surface: { name: "tanstack-route-tree-parking" }, autoCommit: false },
  );
  const snapshot = () => host.getSurfaceSnapshot(app.root.surfaceId);
  const text = () =>
    snapshot()
      .nodes.filter((node) => node.kind === "text")
      .map((node) => node.text)
      .sort();
  const screen = (screenId) =>
    snapshot().nodes.find(
      (node) =>
        node.kind === "element" &&
        node.component === "Screen" &&
        node.props.screenId === screenId,
    );

  await app.root.flush();
  await ready.promise;
  await app.root.flush();
  const homeEntryId = nativeHistory.location.id;
  const homeScreen = screen(homeEntryId)?.node;
  const initialHomeScrollView = snapshot().nodes.find(
    (node) => node.kind === "element" && node.component === "ScrollView",
  );
  assert.ok(homeScreen);
  assert.ok(initialHomeScrollView);
  assert.equal(homeScrollRefs.length, 1);
  assert.equal(homeScrollRefs[0].nativeNode.componentName, "ScrollView");
  assert.deepEqual(text(), ["mounted:home"]);
  host.injectEvent({
    surface: app.root.surfaceId,
    target: homeScreen,
    name: "focus",
    priority: "default",
    bubbles: false,
  });
  await app.root.flush();
  host.injectEvent({
    surface: app.root.surfaceId,
    target: initialHomeScrollView.node,
    name: "scroll",
    payload: { contentOffset: { x: -12, y: 144 } },
    priority: "continuous",
    bubbles: false,
  });
  assert.equal(homeScrollEvents, 1);
  host.injectEvent({
    surface: app.root.surfaceId,
    target: initialHomeScrollView.node,
    name: "scroll",
    payload: { contentOffset: { x: 0, y: "invalid" } },
    priority: "continuous",
    bubbles: false,
  });
  assert.equal(homeScrollEvents, 2);
  assert.equal(homeScrollRestorationErrors.length, 1);
  assert.equal(homeScrollRestorationErrors[0].entry.id, homeEntryId);
  assert.equal(homeScrollRestorationErrors[0].restorationKey, "feed");
  assert.match(
    homeScrollRestorationErrors[0].error.message,
    /finite x and y content offsets/u,
  );
  host.injectEvent({
    surface: app.root.surfaceId,
    target: initialHomeScrollView.node,
    name: "scroll",
    payload: { contentOffset: { x: 0, y: "still-invalid" } },
    priority: "continuous",
    bubbles: false,
  });
  assert.equal(homeScrollEvents, 3);
  assert.equal(homeScrollRestorationErrors.length, 1);
  host.injectEvent({
    surface: app.root.surfaceId,
    target: initialHomeScrollView.node,
    name: "scroll",
    payload: { contentOffset: { x: 0, y: 160 } },
    priority: "continuous",
    bubbles: false,
  });
  host.injectEvent({
    surface: app.root.surfaceId,
    target: initialHomeScrollView.node,
    name: "scroll",
    payload: { contentOffset: { x: 0, y: "invalid-after-recovery" } },
    priority: "continuous",
    bubbles: false,
  });
  assert.equal(homeScrollEvents, 5);
  assert.equal(homeScrollRestorationErrors.length, 2);
  const commandsBeforeParking = host.commits
    .flatMap((commit) => commit.mutations)
    .filter(
      (mutation) =>
        mutation.type === "command" && mutation.command === "scrollTo",
    ).length;

  await router.navigate({ to: "/detail" });
  await app.root.flush();
  assert.deepEqual(text(), ["mounted:detail", "mounted:home"]);
  assert.equal(homeCreates, 1);
  assert.equal(homeDisposes, 0);

  setRouteTreeLimit(1);
  await app.root.flush();
  assert.deepEqual(text(), ["mounted:detail", "parked:/"]);
  assert.equal(homeDisposes, 1);
  assert.equal(screen(homeEntryId)?.node, homeScreen);

  routerHistory.back();
  for (let attempt = 0; attempt < 20; attempt++) {
    if (
      router.state.status === "idle" &&
      router.state.location.pathname === "/"
    ) {
      break;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  await app.root.flush();
  assert.deepEqual(text(), ["mounted:home"]);
  assert.equal(screen(homeEntryId)?.node, homeScreen);
  assert.equal(homeCreates, 2);
  assert.equal(detailDisposes, 1);
  const restoredHomeScrollView = snapshot().nodes.find(
    (node) => node.kind === "element" && node.component === "ScrollView",
  );
  assert.ok(restoredHomeScrollView);
  assert.notEqual(restoredHomeScrollView.node, initialHomeScrollView.node);
  assert.equal(homeScrollRefs.length, 2);
  assert.notEqual(homeScrollRefs[1], homeScrollRefs[0]);
  assert.equal(homeScrollRefs[1].nativeNode.componentName, "ScrollView");
  const restoredCommands = host.commits
    .flatMap((commit) => commit.mutations)
    .filter(
      (mutation) =>
        mutation.type === "command" && mutation.command === "scrollTo",
    );
  assert.equal(restoredCommands.length, commandsBeforeParking + 1);
  assert.deepEqual(restoredCommands.at(-1), {
    type: "command",
    node: restoredHomeScrollView.node,
    command: "scrollTo",
    args: [0, 160, false],
  });
  assert.equal("restorationKey" in restoredHomeScrollView.props, false);
  assert.equal("onRestorationError" in restoredHomeScrollView.props, false);
  host.injectEvent({
    surface: app.root.surfaceId,
    target: homeScreen,
    name: "focus",
    priority: "default",
    bubbles: false,
  });
  await app.root.flush();
  const scrollCommands = host.commits
    .flatMap((commit) => commit.mutations)
    .filter(
      (mutation) =>
        mutation.type === "command" && mutation.command === "scrollTo",
    );
  assert.equal(scrollCommands.length, commandsBeforeParking + 1);
  host.injectEvent({
    surface: app.root.surfaceId,
    target: homeScreen,
    name: "blur",
    priority: "default",
    bubbles: false,
  });
  host.injectEvent({
    surface: app.root.surfaceId,
    target: homeScreen,
    name: "focus",
    priority: "default",
    bubbles: false,
  });
  await app.root.flush();
  assert.equal(
    host.commits
      .flatMap((commit) => commit.mutations)
      .filter(
        (mutation) =>
          mutation.type === "command" && mutation.command === "scrollTo",
      ).length,
    commandsBeforeParking + 1,
  );

  await router.navigate({ to: "/detail" });
  await app.root.flush();
  assert.deepEqual(text(), ["mounted:detail", "parked:/"]);
  assert.equal(homeDisposes, 2);

  setRouteTreeLimit(2);
  await app.root.flush();
  assert.deepEqual(text(), ["mounted:detail", "mounted:home"]);
  assert.equal(homeCreates, 3);
  assert.equal(homeDisposes, 2);
  assert.equal(screen(homeEntryId)?.node, homeScreen);

  await app.dispose();
  assert.equal(homeDisposes, 3);
  assert.equal(detailCreates, 2);
  assert.equal(detailDisposes, 2);
  routerHistory.destroy();
});

test("reclaims inactive TanStack state under native memory pressure", async () => {
  globalThis.window ??= globalThis;
  globalThis.self ??= globalThis;

  const host = createRendererHost();
  const nativeHistory = new NativeHistory({
    snapshot: {
      entries: [
        { id: "restored-slow", href: "/slow", state: null },
        { id: "restored-home", href: "/", state: null },
        { id: "restored-current", href: "/detail", state: null },
      ],
      index: 2,
    },
  });
  const routerHistory = createTanStackNativeHistory(nativeHistory);
  const ready = deferred();
  const slow = deferred();
  const slowStarted = deferred();
  let warningListener;
  let warningSubscriptionRemovals = 0;
  let cacheClears = 0;
  let slowAborts = 0;
  let slowCreates = 0;
  let policy;
  const preloadErrors = [];
  const externalCache = new Set(["ai-stream", "image", "query"]);
  const memoryPressureCalls = [];
  const memoryPressureErrors = [];
  let memoryPressurePreloadSignal;

  const RootComponent = () => createComponent(TanStackNativeOutlet, {});
  const HomeComponent = () =>
    createComponent(Text, { children: "mounted:home" });
  const DetailComponent = () =>
    createComponent(Text, { children: "mounted:detail" });
  const SlowComponent = () => {
    slowCreates++;
    return createComponent(Text, { children: "mounted:slow" });
  };
  const rootRoute = new TanStackRootRoute({ component: RootComponent });
  const homeRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: HomeComponent,
  });
  const detailRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/detail",
    component: DetailComponent,
  });
  const slowRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/slow",
    loader: ({ abortController }) => {
      abortController.signal.addEventListener(
        "abort",
        () => {
          slowAborts++;
        },
        { once: true },
      );
      slowStarted.resolve();
      return slow.promise;
    },
    component: SlowComponent,
  });
  const router = createTanStackNativeRouter({
    routeTree: rootRoute.addChildren([homeRoute, detailRoute, slowRoute]),
    history: routerHistory,
    isServer: false,
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
  });
  await router.load();
  const clearCache = router.clearCache.bind(router);
  router.clearCache = (...args) => {
    cacheClears++;
    return clearCache(...args);
  };
  assert.throws(
    () =>
      createTanStackNativeMemoryPolicy(
        { subscribeMemoryWarning: () => ({ remove() {} }) },
        { normalMountedRouteTrees: 3, pressuredMountedRouteTrees: 4 },
      ),
    /pressuredMountedRouteTrees cannot exceed normalMountedRouteTrees/,
  );

  const app = mount(
    () => {
      policy = createTanStackNativeMemoryPolicy(
        {
          subscribeMemoryWarning(listener) {
            warningListener = listener;
            return {
              remove() {
                warningSubscriptionRemovals++;
                warningListener = undefined;
              },
            };
          },
        },
        {
          normalMountedRouteTrees: 3,
          pressuredMountedRouteTrees: 1,
          onMemoryPressure(warningCount) {
            memoryPressureCalls.push(warningCount);
            externalCache.clear();
            if (warningCount === 1) {
              return Promise.reject(new Error("async cache eviction failed"));
            }
            throw new Error("sync cache eviction failed");
          },
          onMemoryPressureError(error, warningCount) {
            memoryPressureErrors.push({ error, warningCount });
            if (warningCount === 2) {
              throw new Error("diagnostic reporting failed");
            }
          },
        },
      );
      return createComponent(TanStackNativeRouterProvider, {
        router,
        onReady: () => ready.resolve(),
        onError: (error) => {
          throw error;
        },
        get children() {
          return createComponent(TanStackNativeStack, {
            history: nativeHistory,
            memoryPolicy: policy,
            preloadRestoredEntries: 2,
            shouldPreloadRestoredEntry(_entry, _index, signal) {
              memoryPressurePreloadSignal = signal;
              return true;
            },
            onPreloadError(error, entry) {
              preloadErrors.push({ error, entry });
            },
            renderUnresolved: (entry) =>
              createComponent(Text, {
                get children() {
                  return `unresolved:${entry().href}`;
                },
              }),
            renderParked: (entry) =>
              createComponent(Text, {
                get children() {
                  return `parked:${entry().href}`;
                },
              }),
          });
        },
      });
    },
    host,
    { surface: { name: "tanstack-memory-policy" }, autoCommit: false },
  );
  const text = () =>
    host
      .getSurfaceSnapshot(app.root.surfaceId)
      .nodes.filter((node) => node.kind === "text")
      .map((node) => node.text)
      .sort();

  await app.root.flush();
  await ready.promise;
  await slowStarted.promise;
  await app.root.flush();
  assert.deepEqual(text(), [
    "mounted:detail",
    "mounted:home",
    "unresolved:/slow",
  ]);
  assert.equal(policy.warningCount(), 0);
  assert.equal(policy.isUnderMemoryPressure(), false);
  assert.equal(policy.maxMountedRouteTrees(), 3);
  assert.equal(memoryPressurePreloadSignal.aborted, false);

  warningListener();
  await app.root.flush();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(policy.warningCount(), 1);
  assert.equal(policy.isUnderMemoryPressure(), true);
  assert.equal(policy.maxMountedRouteTrees(), 1);
  assert.equal(cacheClears, 1);
  assert.equal(slowAborts, 1);
  assert.equal(memoryPressurePreloadSignal.aborted, true);
  assert.deepEqual(memoryPressureCalls, [1]);
  assert.equal(externalCache.size, 0);
  assert.equal(memoryPressureErrors.length, 1);
  assert.equal(memoryPressureErrors[0].warningCount, 1);
  assert.match(memoryPressureErrors[0].error.message, /async cache eviction/u);
  assert.deepEqual(text(), ["mounted:detail", "parked:/", "parked:/slow"]);

  slow.resolve({ title: "Slow" });
  await new Promise((resolve) => setImmediate(resolve));
  await app.root.flush();
  assert.equal(slowCreates, 0);
  assert.deepEqual(preloadErrors, []);

  policy.acknowledgeRecovery();
  await app.root.flush();
  assert.equal(policy.isUnderMemoryPressure(), false);
  assert.equal(policy.maxMountedRouteTrees(), 3);
  assert.deepEqual(text(), [
    "mounted:detail",
    "unresolved:/",
    "unresolved:/slow",
  ]);

  externalCache.add("query-after-recovery");
  warningListener();
  await app.root.flush();
  assert.equal(policy.warningCount(), 2);
  assert.equal(policy.isUnderMemoryPressure(), true);
  assert.equal(policy.maxMountedRouteTrees(), 1);
  assert.equal(cacheClears, 2);
  assert.deepEqual(memoryPressureCalls, [1, 2]);
  assert.equal(externalCache.size, 0);
  assert.equal(memoryPressureErrors.length, 2);
  assert.equal(memoryPressureErrors[1].warningCount, 2);
  assert.match(memoryPressureErrors[1].error.message, /sync cache eviction/u);
  assert.deepEqual(text(), ["mounted:detail", "parked:/", "parked:/slow"]);

  await app.dispose();
  assert.equal(warningSubscriptionRemovals, 1);
  assert.equal(warningListener, undefined);
  routerHistory.destroy();
});

test("scopes TanStack native work to actual screen focus", async () => {
  globalThis.window ??= globalThis;
  globalThis.self ??= globalThis;

  const host = createRendererHost();
  const nativeHistory = new NativeHistory({ initialHref: "/" });
  const routerHistory = createTanStackNativeHistory(nativeHistory);
  const setups = { home: 0, detail: 0 };
  const cleanups = { home: 0, detail: 0 };
  const taskSignals = { home: [], detail: [] };

  const RootComponent = () => createComponent(TanStackNativeOutlet, {});
  const createRouteComponent = (name) => () => {
    createTanStackNativeScreenFocusEffect(() => {
      setups[name]++;
      return () => cleanups[name]++;
    });
    createTanStackNativeScreenFocusTask((signal) => {
      taskSignals[name].push(signal);
      return new Promise(() => undefined);
    });
    return createComponent(Text, { children: name });
  };
  const rootRoute = new TanStackRootRoute({ component: RootComponent });
  const homeRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: createRouteComponent("home"),
  });
  const detailRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/detail",
    component: createRouteComponent("detail"),
  });
  const router = createTanStackNativeRouter({
    routeTree: rootRoute.addChildren([homeRoute, detailRoute]),
    history: routerHistory,
    isServer: false,
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
  });
  await router.load();
  const app = mount(
    () =>
      createComponent(TanStackNativeRouterProvider, {
        router,
        onError: (error) => {
          throw error;
        },
        get children() {
          return createComponent(TanStackNativeStack, {
            history: nativeHistory,
            renderUnresolved: () =>
              createComponent(Text, { children: "unresolved" }),
          });
        },
      }),
    host,
    { surface: { name: "tanstack-focus-scope" }, autoCommit: false },
  );
  await app.root.flush();
  let snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  const stack = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "ScreenStack",
  );
  const home = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "Screen",
  );
  assert.ok(stack);
  assert.ok(home);
  assert.deepEqual(setups, { home: 0, detail: 0 });
  assert.deepEqual(cleanups, { home: 0, detail: 0 });

  host.injectEvent({
    surface: app.root.surfaceId,
    target: home.node,
    name: "focus",
    priority: "default",
    bubbles: false,
  });
  await app.root.flush();
  assert.deepEqual(setups, { home: 1, detail: 0 });
  assert.equal(taskSignals.home.length, 1);
  assert.equal(taskSignals.home[0].aborted, false);

  await router.navigate({ to: "/detail" });
  await app.root.flush();
  snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  const detail = snapshot.nodes.find(
    (node) =>
      node.kind === "element" &&
      node.component === "Screen" &&
      node.node !== home.node,
  );
  assert.ok(detail);
  assert.deepEqual(setups, { home: 1, detail: 0 });
  host.injectEvent({
    surface: app.root.surfaceId,
    target: detail.node,
    name: "focus",
    priority: "default",
    bubbles: false,
  });
  await app.root.flush();
  assert.deepEqual(setups, { home: 1, detail: 1 });
  assert.deepEqual(cleanups, { home: 1, detail: 0 });
  assert.equal(taskSignals.home[0].aborted, true);
  assert.equal(taskSignals.detail.length, 1);
  assert.equal(taskSignals.detail[0].aborted, false);

  host.injectEvent({
    surface: app.root.surfaceId,
    target: detail.node,
    name: "dismiss",
    payload: { dismissCount: 1 },
    priority: "default",
    bubbles: false,
  });
  for (let attempt = 0; attempt < 20; attempt++) {
    if (
      router.state.status === "idle" &&
      router.state.location.pathname === "/"
    ) {
      break;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  await app.root.flush();
  assert.deepEqual(setups, { home: 1, detail: 1 });
  assert.deepEqual(cleanups, { home: 1, detail: 1 });
  assert.equal(taskSignals.detail[0].aborted, true);
  host.injectEvent({
    surface: app.root.surfaceId,
    target: home.node,
    name: "focus",
    priority: "default",
    bubbles: false,
  });
  await app.root.flush();
  assert.deepEqual(setups, { home: 2, detail: 1 });
  assert.equal(taskSignals.home.length, 2);
  assert.equal(taskSignals.home[1].aborted, false);

  await app.dispose();
  assert.deepEqual(cleanups, { home: 2, detail: 1 });
  assert.equal(taskSignals.home[1].aborted, true);
  routerHistory.destroy();
});

test("reports active focus-task failures and ignores stale cancellation", async () => {
  const host = createRendererHost();
  let rejectCanceled;
  let rejectFailed;
  const canceled = new Promise((_resolve, reject) => {
    rejectCanceled = reject;
  });
  const failed = new Promise((_resolve, reject) => {
    rejectFailed = reject;
  });
  const reported = [];
  const signals = [];
  let setFocused;
  let setEnabled;
  let run = 0;
  const app = mount(
    () => {
      const [focused, updateFocused] = createSignal(false);
      const [enabled, updateEnabled] = createSignal(true);
      setFocused = updateFocused;
      setEnabled = updateEnabled;
      createNativeScreenFocusTask(
        focused,
        (signal) => {
          signals.push(signal);
          run++;
          return run === 1 ? canceled : failed;
        },
        {
          enabled,
          onError(error) {
            reported.push(error);
            return Promise.reject(new Error("focus-task diagnostic failed"));
          },
        },
      );
      return createComponent(Text, { children: "focus task" });
    },
    host,
    { surface: { name: "native-focus-task" }, autoCommit: false },
  );

  await app.root.flush();
  setFocused(true);
  await app.root.flush();
  assert.equal(signals.length, 1);
  assert.equal(signals[0].aborted, false);

  setEnabled(false);
  await app.root.flush();
  assert.equal(signals[0].aborted, true);
  rejectCanceled(new Error("stale cancellation"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(reported, []);

  setEnabled(true);
  await app.root.flush();
  assert.equal(signals.length, 2);
  const failure = new Error("focused task failed");
  rejectFailed(failure);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(reported, [failure]);
  assert.equal(signals[1].aborted, false);

  await app.dispose();
  assert.equal(signals[1].aborted, true);
});

test("preloads a bounded restored TanStack stack without changing location", async () => {
  globalThis.window ??= globalThis;
  globalThis.self ??= globalThis;

  const host = createRendererHost();
  const nativeHistory = new NativeHistory({
    snapshot: {
      entries: [
        { id: "restored-home", href: "/", state: null },
        { id: "restored-skipped", href: "/skipped", state: null },
        { id: "restored-invalid", href: "/invalid", state: null },
        { id: "restored-broken", href: "/broken", state: null },
        { id: "restored-detail", href: "/detail", state: null },
        { id: "restored-current", href: "/current", state: null },
      ],
      index: 5,
    },
  });
  const routerHistory = createTanStackNativeHistory(nativeHistory);
  let homeLoads = 0;
  let skippedLoads = 0;
  let detailLoads = 0;
  let currentLoads = 0;
  let detailCreates = 0;
  let detailDisposes = 0;
  const preloadFailure = new Error("restored preload failed");
  const preloadErrors = [];
  const preloadPolicyCalls = [];
  const preloadPolicySignals = [];
  let diagnosticRejections = 0;

  const RootComponent = () => createComponent(TanStackNativeOutlet, {});
  const routeComponent = (label) => () =>
    createComponent(Text, {
      children: label,
    });
  const DetailComponent = () => {
    detailCreates++;
    onCleanup(() => detailDisposes++);
    return createComponent(Text, { children: "detail" });
  };
  const rootRoute = new TanStackRootRoute({ component: RootComponent });
  const homeRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    loader: () => {
      homeLoads++;
      return { title: "Home" };
    },
    component: routeComponent("home"),
  });
  const detailRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/detail",
    loader: () => {
      detailLoads++;
      return { title: "Detail" };
    },
    component: DetailComponent,
  });
  const skippedRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/skipped",
    loader: () => {
      skippedLoads++;
      return { title: "Skipped" };
    },
    component: routeComponent("skipped"),
  });
  const currentRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/current",
    loader: () => {
      currentLoads++;
      return { title: "Current" };
    },
    component: routeComponent("current"),
  });
  const router = createTanStackNativeRouter({
    routeTree: rootRoute.addChildren([
      homeRoute,
      skippedRoute,
      detailRoute,
      currentRoute,
    ]),
    history: routerHistory,
    isServer: false,
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
  });
  const preloadRoute = router.preloadRoute.bind(router);
  router.preloadRoute = (options) =>
    options.href === "/broken"
      ? Promise.reject(preloadFailure)
      : preloadRoute(options);
  assert.throws(
    () =>
      TanStackNativeStack({
        router,
        history: nativeHistory,
        preloadRestoredEntries: -1,
        renderUnresolved: () => undefined,
      }),
    /preloadRestoredEntries must be an integer between 0 and 512/,
  );
  const app = mount(
    () =>
      createComponent(TanStackNativeRouterProvider, {
        router,
        onError: (error) => {
          throw error;
        },
        get children() {
          return createComponent(TanStackNativeStack, {
            history: nativeHistory,
            preloadRestoredEntries: 4,
            shouldPreloadRestoredEntry(entry, index, signal) {
              preloadPolicyCalls.push({ entry, index });
              preloadPolicySignals.push(signal);
              if (entry.href === "/invalid") return "yes";
              return entry.href !== "/skipped";
            },
            onPreloadError(error, entry) {
              preloadErrors.push({ error, entry });
              return {
                then(_resolve, reject) {
                  diagnosticRejections++;
                  reject(new Error("preload diagnostic failed"));
                },
              };
            },
            renderUnresolved: (entry) =>
              createComponent(Text, {
                get children() {
                  return `unresolved:${entry().href}`;
                },
              }),
          });
        },
      }),
    host,
    { surface: { name: "tanstack-restored-preload" }, autoCommit: false },
  );
  const renderedText = () =>
    host
      .getSurfaceSnapshot(app.root.surfaceId)
      .nodes.filter((node) => node.kind === "text")
      .map((node) => node.text);

  for (
    let attempt = 0;
    attempt < 20 &&
    (currentLoads === 0 || detailCreates === 0 || diagnosticRejections < 2);
    attempt++
  ) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  await app.root.flush();
  assert.equal(router.state.location.pathname, "/current");
  assert.equal(nativeHistory.location.href, "/current");
  assert.equal(homeLoads, 0);
  assert.equal(skippedLoads, 0);
  assert.equal(detailLoads, 1);
  assert.equal(currentLoads, 1);
  assert.equal(detailCreates, 1);
  assert.deepEqual(
    preloadPolicyCalls.map(({ entry, index }) => [entry.href, index]),
    [
      ["/detail", 4],
      ["/broken", 3],
      ["/invalid", 2],
      ["/skipped", 1],
    ],
  );
  assert.equal(new Set(preloadPolicySignals).size, 1);
  assert.equal(preloadPolicySignals[0].aborted, false);
  assert.deepEqual(preloadErrors[0], {
    error: preloadFailure,
    entry: { id: "restored-broken", href: "/broken", state: null },
  });
  assert.match(
    preloadErrors[1].error.message,
    /shouldPreloadRestoredEntry must resolve to a boolean/u,
  );
  assert.deepEqual(preloadErrors[1].entry, {
    id: "restored-invalid",
    href: "/invalid",
    state: null,
  });
  assert.equal(diagnosticRejections, 2);
  assert.deepEqual(renderedText().sort(), [
    "current",
    "detail",
    "unresolved:/",
    "unresolved:/broken",
    "unresolved:/invalid",
    "unresolved:/skipped",
  ]);

  routerHistory.back();
  for (let attempt = 0; attempt < 20; attempt++) {
    if (
      router.state.status === "idle" &&
      router.state.location.pathname === "/detail"
    ) {
      break;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  await app.root.flush();
  assert.equal(nativeHistory.location.href, "/detail");
  assert.equal(detailLoads, 1);
  assert.equal(detailCreates, 1);
  assert.equal(detailDisposes, 0);
  assert.deepEqual(renderedText().sort(), [
    "detail",
    "unresolved:/",
    "unresolved:/broken",
    "unresolved:/invalid",
    "unresolved:/skipped",
  ]);

  await app.dispose();
  assert.equal(detailDisposes, 1);
  assert.equal(preloadPolicySignals[0].aborted, true);
  routerHistory.destroy();
});

test("does not mount a restored TanStack preload after disposal", async () => {
  globalThis.window ??= globalThis;
  globalThis.self ??= globalThis;

  const host = createRendererHost();
  const nativeHistory = new NativeHistory({
    snapshot: {
      entries: [
        { id: "restored-slow", href: "/slow", state: null },
        { id: "restored-current", href: "/", state: null },
      ],
      index: 1,
    },
  });
  const routerHistory = createTanStackNativeHistory(nativeHistory);
  const slow = deferred();
  const slowStarted = deferred();
  let slowCreates = 0;
  let preloadPolicySignal;
  const rootRoute = new TanStackRootRoute({
    component: () => createComponent(TanStackNativeOutlet, {}),
  });
  const homeRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => createComponent(Text, { children: "current" }),
  });
  const slowRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/slow",
    loader: () => {
      slowStarted.resolve();
      return slow.promise;
    },
    component: () => {
      slowCreates++;
      return createComponent(Text, { children: "slow" });
    },
  });
  const router = createTanStackNativeRouter({
    routeTree: rootRoute.addChildren([homeRoute, slowRoute]),
    history: routerHistory,
    isServer: false,
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
  });
  const app = mount(
    () =>
      createComponent(TanStackNativeRouterProvider, {
        router,
        onError: (error) => {
          throw error;
        },
        get children() {
          return createComponent(TanStackNativeStack, {
            history: nativeHistory,
            preloadRestoredEntries: 1,
            shouldPreloadRestoredEntry(_entry, _index, signal) {
              preloadPolicySignal = signal;
              return true;
            },
            renderUnresolved: () =>
              createComponent(Text, { children: "unresolved" }),
          });
        },
      }),
    host,
    { surface: { name: "tanstack-preload-disposal" }, autoCommit: false },
  );

  await slowStarted.promise;
  assert.equal(preloadPolicySignal.aborted, false);
  await app.dispose();
  assert.equal(preloadPolicySignal.aborted, true);
  slow.resolve({ title: "Slow" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(slowCreates, 0);
  routerHistory.destroy();
});

test("resolves an already-focused accessibility target after its subtree settles", async () => {
  const host = createRendererHost();
  let heading;
  const app = mount(
    () => {
      createNativeScreenAccessibilityFocus(
        () => true,
        () => heading,
      );
      return createComponent(Text, {
        ref: (node) => {
          heading = node;
        },
        children: "Async route heading",
      });
    },
    host,
    {
      surface: { name: "settled-native-accessibility-focus" },
      autoCommit: false,
    },
  );

  flush();
  await app.root.flush();
  const text = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find((node) => node.kind === "element" && node.component === "Text");
  assert.ok(text);
  assert.deepEqual(host.commits.at(-1).mutations, [
    {
      type: "command",
      node: text.node,
      command: "accessibilityFocus",
      args: [],
    },
  ]);

  await app.dispose();
});

test("keeps keyed Solid screen owners synchronized with NativeHistory", async () => {
  const host = createRendererHost();
  const history = new NativeHistory({ initialHref: "/" });
  const focusEvents = [];
  const blurEvents = [];
  const app = mount(
    () =>
      createComponent(NativeStack, {
        history,
        onScreenFocus: (entry, event) => focusEvents.push({ entry, event }),
        onScreenBlur: (entry, event) => blurEvents.push({ entry, event }),
        renderHeader: (entry) =>
          createComponent(ScreenHeader, {
            get title() {
              return `Header ${entry().href}`;
            },
          }),
        children: (entry, _index, isFocused) => {
          let heading;
          createNativeScreenAccessibilityFocus(isFocused, () => heading);
          return createComponent(Text, {
            ref: (node) => {
              heading = node;
            },
            get children() {
              return `${entry().href}:${isFocused() ? "focused" : "blurred"}`;
            },
          });
        },
      }),
    host,
    { surface: { name: "native-stack" }, autoCommit: false },
  );

  await app.root.flush();
  let snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  let screens = snapshot.nodes.filter(
    (node) => node.kind === "element" && node.component === "Screen",
  );
  assert.equal(screens.length, 1);
  const rootScreen = screens[0];
  assert.ok(rootScreen);
  const rootContent = rootScreen.children[0];
  const rootHeader = rootScreen.children[1];
  assert.ok(rootContent);
  assert.ok(rootHeader);
  assert.equal(
    snapshot.nodes.find((node) => node.node === rootHeader)?.props.title,
    "Header /",
  );
  host.injectEvent({
    surface: app.root.surfaceId,
    target: rootScreen.node,
    name: "focus",
    priority: "default",
    bubbles: false,
  });
  await app.root.flush();
  assert.equal(focusEvents.length, 1);
  assert.equal(focusEvents[0].entry.id, rootScreen.props.screenId);
  assert.equal(focusEvents[0].event.name, "focus");
  assert.equal(focusEvents[0].event.currentTarget, focusEvents[0].event.target);
  assert.equal(
    host
      .getSurfaceSnapshot(app.root.surfaceId)
      .nodes.find((node) => node.kind === "text")?.text,
    "/:focused",
  );
  assert.deepEqual(host.commits.at(-1).mutations, [
    {
      type: "command",
      node: rootContent,
      command: "accessibilityFocus",
      args: [],
    },
  ]);

  const push = history.push("/details", { item: 42 });
  await app.root.flush();
  snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  screens = snapshot.nodes.filter(
    (node) => node.kind === "element" && node.component === "Screen",
  );
  assert.equal(screens.length, 2);
  assert.ok(screens.some((screen) => screen.node === rootScreen.node));
  assert.equal(
    screens.find((screen) => screen.node === rootScreen.node)?.children[0],
    rootContent,
  );
  assert.ok(screens.some((screen) => screen.props.screenId === push.to.id));
  const headers = snapshot.nodes.filter(
    (node) => node.kind === "element" && node.component === "ScreenHeader",
  );
  assert.equal(headers.length, 2);
  assert.ok(headers.some((header) => header.node === rootHeader));
  assert.ok(headers.some((header) => header.props.title === "Header /details"));

  const stack = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "ScreenStack",
  );
  assert.ok(stack);
  host.injectEvent({
    surface: app.root.surfaceId,
    target: stack.node,
    name: "transitionEnd",
    payload: null,
    priority: "default",
    bubbles: false,
  });
  assert.equal(history.acknowledgeApplicationTransition(push.id), false);

  const details = screens.find(
    (screen) => screen.props.screenId === push.to.id,
  );
  assert.ok(details);
  host.injectEvent({
    surface: app.root.surfaceId,
    target: details.node,
    name: "focus",
    priority: "default",
    bubbles: false,
  });
  await app.root.flush();
  assert.equal(blurEvents.length, 0);
  assert.deepEqual(
    host
      .getSurfaceSnapshot(app.root.surfaceId)
      .nodes.filter((node) => node.kind === "text")
      .map((node) => node.text),
    ["/:blurred", "/details:focused"],
  );
  host.injectEvent({
    surface: app.root.surfaceId,
    target: rootScreen.node,
    name: "blur",
    priority: "default",
    bubbles: false,
  });
  assert.equal(blurEvents.length, 1);
  assert.equal(blurEvents[0].entry.id, rootScreen.props.screenId);
  assert.equal(blurEvents[0].event.name, "blur");
  assert.equal(focusEvents.length, 2);
  assert.equal(focusEvents[1].entry.id, push.to.id);
  assert.equal(focusEvents[1].event.name, "focus");
  host.injectEvent({
    surface: app.root.surfaceId,
    target: details.node,
    name: "dismiss",
    payload: { dismissCount: 1 },
    priority: "default",
    bubbles: false,
  });
  await new Promise((resolve) => setImmediate(resolve));
  await app.root.flush();
  assert.equal(history.location.href, "/");
  snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  screens = snapshot.nodes.filter(
    (node) => node.kind === "element" && node.component === "Screen",
  );
  assert.equal(screens.length, 1);
  assert.equal(screens[0]?.node, rootScreen.node);
  assert.equal(screens[0]?.children[0], rootContent);
  assert.equal(screens[0]?.children[1], rootHeader);

  const replace = history.replace("/renamed");
  assert.equal(
    history.pendingApplicationTransitionCount,
    0,
    "A retained-screen replacement must not wait for a native transition event.",
  );
  await app.root.flush();
  snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  const replacedRoot = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "Screen",
  );
  const replacedText = snapshot.nodes.find((node) => node.kind === "text");
  assert.equal(replacedRoot?.node, rootScreen.node);
  assert.equal(replacedRoot?.children[0], rootContent);
  assert.equal(replacedRoot?.children[1], rootHeader);
  assert.equal(replacedText?.text, "/renamed:blurred");
  assert.equal(
    snapshot.nodes.find((node) => node.node === rootHeader)?.props.title,
    "Header /renamed",
  );
  assert.equal(history.acknowledgeApplicationTransition(replace.id), false);

  for (let revision = 0; revision < 256; revision++) {
    const replacement = history.replace(
      `/renamed?revision=${String(revision)}`,
    );
    assert.equal(history.pendingApplicationTransitionCount, 0);
    assert.equal(
      history.acknowledgeApplicationTransition(replacement.id),
      false,
    );
  }
  await app.root.flush();
  snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  const sustainedReplacementRoot = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "Screen",
  );
  assert.equal(sustainedReplacementRoot?.node, rootScreen.node);
  assert.equal(sustainedReplacementRoot?.children[0], rootContent);
  assert.equal(sustainedReplacementRoot?.children[1], rootHeader);
  assert.equal(
    snapshot.nodes.find((node) => node.node === rootHeader)?.props.title,
    "Header /renamed?revision=255",
  );

  const pendingAtDisposal = history.push("/dispose-pending");
  await app.root.flush();
  assert.equal(history.pendingApplicationTransitionCount, 1);
  await app.dispose();
  assert.equal(history.pendingApplicationTransitionCount, 0);
  assert.equal(
    history.acknowledgeApplicationTransition(pendingAtDisposal.id),
    false,
  );
});

test("bounds nodes and disposes only popped owners across repeated native navigation", async () => {
  const host = createRendererHost();
  const history = new NativeHistory({ initialHref: "/" });
  const ownerCreations = new Map();
  const ownerDisposals = new Map();
  let canceledEntry;
  const app = mount(
    () =>
      createComponent(NativeStack, {
        history,
        onPlatformBackCancel(entry) {
          canceledEntry = entry;
        },
        children: (entry) => {
          const id = entry().id;
          ownerCreations.set(id, (ownerCreations.get(id) ?? 0) + 1);
          onCleanup(() => {
            ownerDisposals.set(id, (ownerDisposals.get(id) ?? 0) + 1);
          });
          return createComponent(Text, {
            get children() {
              return entry().href;
            },
          });
        },
      }),
    host,
    { surface: { name: "native-stack-churn" }, autoCommit: false },
  );

  await app.root.flush();
  let snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  const stack = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "ScreenStack",
  );
  const rootScreen = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "Screen",
  );
  assert.ok(stack);
  assert.ok(rootScreen);
  const rootContent = rootScreen.children[0];
  assert.ok(rootContent);

  for (let index = 0; index < 100; index++) {
    const push = history.push(`/details/${String(index)}`);
    await app.root.flush();
    snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
    const detail = snapshot.nodes.find(
      (node) =>
        node.kind === "element" &&
        node.component === "Screen" &&
        node.props.screenId === push.to.id,
    );
    assert.ok(detail);

    host.injectEvent({
      surface: app.root.surfaceId,
      target: stack.node,
      name: "transitionEnd",
      priority: "default",
      bubbles: false,
    });
    assert.equal(history.acknowledgeApplicationTransition(push.id), false);

    if (index === 0) {
      host.injectEvent({
        surface: app.root.surfaceId,
        target: detail.node,
        name: "gestureCancel",
        priority: "default",
        bubbles: false,
      });
      assert.equal(canceledEntry?.id, push.to.id);
      assert.equal(history.location.id, push.to.id);
    }

    host.injectEvent({
      surface: app.root.surfaceId,
      target: detail.node,
      name: "dismiss",
      payload: { dismissCount: 1 },
      priority: "default",
      bubbles: false,
    });
    await Promise.resolve();
    await app.root.flush();

    snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
    const screens = snapshot.nodes.filter(
      (node) => node.kind === "element" && node.component === "Screen",
    );
    assert.equal(screens.length, 1);
    assert.equal(screens[0]?.node, rootScreen.node);
    assert.equal(screens[0]?.children[0], rootContent);
    assert.equal(
      snapshot.nodes.length,
      5,
      `cycle ${String(index)} retained ${JSON.stringify(snapshot.nodes)}`,
    );
    assert.equal(ownerCreations.get(push.to.id), 1);
    assert.equal(ownerDisposals.get(push.to.id), 1);
    assert.equal(ownerDisposals.get(rootScreen.props.screenId), undefined);
  }

  assert.equal(ownerCreations.size, 101);
  assert.equal(ownerDisposals.size, 100);
  await app.dispose();
  assert.equal(ownerDisposals.size, 101);
  assert.equal(ownerDisposals.get(rootScreen.props.screenId), 1);
});

test("renders ScrollView children through its native content container", async () => {
  const host = createRendererHost();
  let scrollViewHandle;
  let scrollViewRefCalls = 0;
  const [horizontal, setHorizontal] = createSignal(false);
  const [maintainVisibleContentPosition, setMaintainVisibleContentPosition] =
    createSignal({ minIndexForVisible: 1, autoscrollToTopThreshold: 24 });
  const app = mount(
    () =>
      createComponent(ScrollView, {
        ref(handle) {
          scrollViewHandle = handle;
          scrollViewRefCalls++;
        },
        get horizontal() {
          return horizontal();
        },
        style: { height: 120 },
        contentContainerStyle: { padding: 12 },
        get maintainVisibleContentPosition() {
          return maintainVisibleContentPosition();
        },
        get children() {
          return createComponent(Text, { children: "Scrollable content" });
        },
      }),
    host,
    { surface: { name: "scroll-view" }, autoCommit: false },
  );

  await app.root.flush();
  let snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  assert.deepEqual(
    snapshot.nodes.map((node) =>
      node.kind === "element" ? node.component : node.text,
    ),
    [
      "RootView",
      "ScrollView",
      "ScrollContentView",
      "Text",
      "Scrollable content",
    ],
  );
  assert.deepEqual(snapshot.nodes[1].props, {
    horizontal: false,
    maintainVisibleContentPosition: {
      minIndexForVisible: 1,
      autoscrollToTopThreshold: 24,
    },
    style: {
      flexGrow: 1,
      flexShrink: 1,
      flexDirection: "column",
      overflow: "scroll",
      height: 120,
    },
  });
  assert.deepEqual(snapshot.nodes[2].props, {
    collapsable: false,
    style: { padding: 12 },
  });
  assert.ok(Object.isFrozen(scrollViewHandle));
  assert.equal(scrollViewRefCalls, 1);
  assert.equal(scrollViewHandle.nativeNode.componentName, "ScrollView");
  assert.equal("ref" in snapshot.nodes[1].props, false);

  await scrollViewHandle.scrollTo({ x: 12, y: 48, animated: false });
  assert.deepEqual(host.commits.at(-1).mutations, [
    {
      type: "command",
      node: snapshot.nodes[1].node,
      command: "scrollTo",
      args: [12, 48, false],
    },
  ]);
  await scrollViewHandle.scrollToEnd();
  assert.deepEqual(host.commits.at(-1).mutations, [
    {
      type: "command",
      node: snapshot.nodes[1].node,
      command: "scrollToEnd",
      args: [true],
    },
  ]);
  assert.throws(() => scrollViewHandle.scrollTo(), /plain object/u);
  assert.throws(
    () => scrollViewHandle.scrollTo({ x: -1 }),
    /x must be non-negative/u,
  );
  assert.throws(
    () => scrollViewHandle.scrollTo({ y: Number.NaN }),
    /y must be a finite number/u,
  );
  assert.throws(
    () => scrollViewHandle.scrollTo({ animated: "yes" }),
    /animated must be a boolean/u,
  );
  assert.throws(
    () => scrollViewHandle.scrollTo({ offset: 48 }),
    /unknown option/u,
  );
  assert.throws(
    () => scrollViewHandle.scrollToEnd({ x: 1 }),
    /unknown option/u,
  );

  setHorizontal(true);
  await app.root.flush();
  snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  assert.equal(snapshot.nodes[1].props.horizontal, true);
  assert.equal(snapshot.nodes[1].props.style.flexDirection, "row");
  assert.deepEqual(snapshot.nodes[2].props.style, {
    flexDirection: "row",
    padding: 12,
  });

  setMaintainVisibleContentPosition({ minIndexForVisible: 2 });
  await app.root.flush();
  snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  assert.deepEqual(snapshot.nodes[1].props.maintainVisibleContentPosition, {
    minIndexForVisible: 2,
  });

  setMaintainVisibleContentPosition(undefined);
  await app.root.flush();
  snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  assert.equal(
    "maintainVisibleContentPosition" in snapshot.nodes[1].props,
    false,
  );

  await app.dispose();
  await assert.rejects(
    scrollViewHandle.scrollTo({ y: 1 }),
    /Native root has been disposed/u,
  );
  assert.throws(
    () =>
      ScrollView({
        maintainVisibleContentPosition: {
          minIndexForVisible: -1,
        },
      }),
    /minIndexForVisible must be an integer from 0/u,
  );
  assert.throws(
    () =>
      ScrollView({
        maintainVisibleContentPosition: {
          minIndexForVisible: 0,
          autoscrollToTopThreshold: 1.5,
        },
      }),
    /autoscrollToTopThreshold must be an integer from 0/u,
  );
});

test("owns controlled pull-to-refresh across the Android and iOS Fabric trees", async () => {
  for (const platform of ["android", "ios"]) {
    const host = createRendererHost(platform);
    const [refreshing, setRefreshing] = createSignal(false);
    const refreshes = [];
    let acceptRefresh = false;
    let scrollViewRef;
    const app = mount(
      () =>
        createComponent(RefreshableScrollView, {
          accessibilityLabel: "Messages",
          colors: ["#146ef5", "#16a34a"],
          enabled: true,
          progressBackgroundColor: "#ffffff",
          progressViewOffset: 12,
          get refreshing() {
            return refreshing();
          },
          size: "large",
          style: {
            backgroundColor: "#f8fafc",
            height: 180,
            marginTop: 8,
          },
          tintColor: "#146ef5",
          title: "Updating",
          titleColor: "#334155",
          ref(node) {
            scrollViewRef = node;
          },
          onRefresh() {
            refreshes.push(platform);
            if (acceptRefresh) setRefreshing(true);
          },
          get children() {
            return createComponent(Text, { children: "Refreshable content" });
          },
        }),
      host,
      {
        surface: { name: `refreshable-scroll-view-${platform}` },
        autoCommit: false,
      },
    );

    await app.root.flush();
    let snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
    const refreshControl = snapshot.nodes.find(
      (node) => node.kind === "element" && node.component === "RefreshControl",
    );
    const scrollView = snapshot.nodes.find(
      (node) => node.kind === "element" && node.component === "ScrollView",
    );
    const contentView = snapshot.nodes.find(
      (node) =>
        node.kind === "element" && node.component === "ScrollContentView",
    );
    assert.ok(refreshControl);
    assert.ok(scrollView);
    assert.ok(contentView);
    assert.equal(scrollViewRef?.nativeNode.componentName, "ScrollView");
    assert.deepEqual(refreshControl.eventListeners, ["refresh"]);
    assert.equal(refreshControl.props.refreshing, false);
    assert.equal(refreshControl.props.progressViewOffset, 12);

    if (platform === "android") {
      assert.deepEqual(refreshControl.children, [scrollView.node]);
      assert.deepEqual(scrollView.children, [contentView.node]);
      assert.deepEqual(refreshControl.props, {
        colors: ["#146ef5", "#16a34a"],
        enabled: true,
        progressBackgroundColor: "#ffffff",
        progressViewOffset: 12,
        refreshing: false,
        size: "large",
        style: {
          flexGrow: 1,
          flexShrink: 1,
          flexDirection: "column",
          overflow: "scroll",
          height: 180,
          marginTop: 8,
        },
      });
      assert.deepEqual(scrollView.props.style, {
        flexGrow: 1,
        flexShrink: 1,
        flexDirection: "column",
        overflow: "scroll",
        backgroundColor: "#f8fafc",
      });
      assert.equal(scrollView.props.nestedScrollEnabled, true);
    } else {
      assert.deepEqual(scrollView.children, [
        refreshControl.node,
        contentView.node,
      ]);
      assert.deepEqual(refreshControl.children, []);
      assert.deepEqual(refreshControl.props, {
        progressViewOffset: 12,
        refreshing: false,
        tintColor: "#146ef5",
        title: "Updating",
        titleColor: "#334155",
      });
      assert.deepEqual(scrollView.props.style, {
        flexGrow: 1,
        flexShrink: 1,
        flexDirection: "column",
        overflow: "scroll",
        backgroundColor: "#f8fafc",
        height: 180,
        marginTop: 8,
      });
    }

    host.injectEvent({
      surface: app.root.surfaceId,
      target: refreshControl.node,
      name: "refresh",
      priority: "discrete",
      bubbles: false,
    });
    await app.root.flush();
    const commands = host.commits
      .flatMap((commit) => commit.mutations)
      .filter(
        (mutation) =>
          mutation.type === "command" &&
          mutation.command === "setNativeRefreshing",
      );
    assert.deepEqual(commands.at(-1)?.args, [false]);
    assert.deepEqual(refreshes, [platform]);

    acceptRefresh = true;
    host.injectEvent({
      surface: app.root.surfaceId,
      target: refreshControl.node,
      name: "refresh",
      priority: "discrete",
      bubbles: false,
    });
    await app.root.flush();
    const acceptedCommands = host.commits
      .flatMap((commit) => commit.mutations)
      .filter(
        (mutation) =>
          mutation.type === "command" &&
          mutation.command === "setNativeRefreshing",
      );
    assert.equal(acceptedCommands.length, commands.length);
    snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
    assert.equal(
      snapshot.nodes.find((node) => node.node === refreshControl.node)?.props
        .refreshing,
      true,
    );
    await app.dispose();
  }
});

test("composes VirtualizedList windowing and commands with native refresh", async () => {
  for (const platform of ["android", "ios"]) {
    const host = createRendererHost(platform);
    const [refreshing, setRefreshing] = createSignal(false);
    let list;
    let refreshCount = 0;
    const data = Array.from({ length: 8 }, (_, index) => ({
      id: `row-${String(index)}`,
    }));
    const app = mount(
      () =>
        createComponent(VirtualizedList, {
          data,
          itemSize: 24,
          overscan: 0,
          viewportSize: 72,
          keyExtractor: (item) => item.id,
          renderItem({ item }) {
            return createComponent(Text, {
              get children() {
                return item().id;
              },
            });
          },
          colors: ["#146ef5"],
          tintColor: "#146ef5",
          get refreshing() {
            return refreshing();
          },
          onRefresh() {
            refreshCount++;
            setRefreshing(true);
          },
          ref(handle) {
            list = handle;
          },
        }),
      host,
      {
        surface: { name: `refreshable-virtualized-list-${platform}` },
        autoCommit: false,
      },
    );

    await app.root.flush();
    let snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
    const refreshControl = snapshot.nodes.find(
      (node) => node.kind === "element" && node.component === "RefreshControl",
    );
    const scrollView = snapshot.nodes.find(
      (node) => node.kind === "element" && node.component === "ScrollView",
    );
    const contentView = snapshot.nodes.find(
      (node) =>
        node.kind === "element" && node.component === "ScrollContentView",
    );
    assert.ok(refreshControl);
    assert.ok(scrollView);
    assert.ok(contentView);
    assert.equal(list?.nativeNode.componentName, "ScrollView");
    assert.equal(contentView.children.length, 3);
    if (platform === "android") {
      assert.deepEqual(refreshControl.children, [scrollView.node]);
      assert.deepEqual(scrollView.children, [contentView.node]);
    } else {
      assert.deepEqual(scrollView.children, [
        refreshControl.node,
        contentView.node,
      ]);
    }

    host.injectEvent({
      surface: app.root.surfaceId,
      target: refreshControl.node,
      name: "refresh",
      priority: "discrete",
      bubbles: false,
    });
    await app.root.flush();
    snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
    assert.equal(refreshCount, 1);
    assert.equal(
      snapshot.nodes.find((node) => node.node === refreshControl.node)?.props
        .refreshing,
      true,
    );
    assert.equal(
      host.commits
        .flatMap((commit) => commit.mutations)
        .some(
          (mutation) =>
            mutation.type === "command" &&
            mutation.command === "setNativeRefreshing",
        ),
      false,
    );

    setRefreshing(false);
    await app.root.flush();
    await list.scrollToEnd({ animated: false });
    assert.deepEqual(host.commits.at(-1)?.mutations, [
      {
        type: "command",
        node: scrollView.node,
        command: "scrollTo",
        args: [0, 120, false],
      },
    ]);
    await app.dispose();
  }
});

test("virtualizes fixed-extent rows with stable keyed Solid ownership", async () => {
  const host = createRendererHost();
  const [items, setItems] = createSignal([
    { id: "a", label: "Alpha" },
    { id: "b", label: "Beta" },
    { id: "c", label: "Gamma" },
    { id: "d", label: "Delta" },
    { id: "e", label: "Epsilon" },
    { id: "f", label: "Zeta" },
    { id: "g", label: "Eta" },
    { id: "h", label: "Theta" },
  ]);
  const creations = new Map();
  const disposals = new Map();
  const endReached = [];
  const startReached = [];
  const scrollEvents = [];
  let list;

  const app = mount(
    () =>
      createComponent(VirtualizedList, {
        get data() {
          return items();
        },
        itemSize: 20,
        viewportSize: 60,
        overscan: 1,
        keyExtractor: (item) => item.id,
        renderItem({ item, index, key }) {
          creations.set(key, (creations.get(key) ?? 0) + 1);
          onCleanup(() => {
            disposals.set(key, (disposals.get(key) ?? 0) + 1);
          });
          return createComponent(Text, {
            get children() {
              return `${key}:${String(index())}:${item().label}`;
            },
          });
        },
        ref(node) {
          list = node;
        },
        onScroll(event) {
          scrollEvents.push(event);
        },
        onEndReached(info) {
          endReached.push(info);
        },
        onStartReached(info) {
          startReached.push(info);
        },
        onStartReachedThreshold: 0,
      }),
    host,
    { surface: { name: "virtualized-list" }, autoCommit: false },
  );

  const rows = () => {
    const snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
    const byHandle = new Map(snapshot.nodes.map((node) => [node.node, node]));
    const content = snapshot.nodes.find(
      (node) =>
        node.kind === "element" && node.component === "ScrollContentView",
    );
    assert.ok(content);
    return new Map(
      content.children.map((handle) => {
        const wrapper = byHandle.get(handle);
        assert.equal(wrapper?.kind, "element");
        const text = byHandle.get(wrapper.children[0]);
        assert.equal(text?.kind, "element");
        const rawText = byHandle.get(text.children[0]);
        assert.equal(rawText?.kind, "text");
        return [rawText.text.split(":")[0], { rawText, wrapper }];
      }),
    );
  };

  await app.root.flush();
  let snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  const scrollView = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "ScrollView",
  );
  const content = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "ScrollContentView",
  );
  assert.ok(scrollView);
  assert.ok(content);
  assert.equal(list?.nativeNode.componentName, "ScrollView");
  assert.deepEqual(scrollView.props, {
    scrollEventThrottle: 16,
    style: {
      flexGrow: 0,
      flexShrink: 0,
      flexDirection: "column",
      overflow: "scroll",
      height: 60,
    },
  });
  assert.deepEqual(content.props, {
    collapsable: false,
    style: { height: 160, position: "relative" },
  });
  let mountedRows = rows();
  assert.deepEqual([...mountedRows.keys()], ["a", "b", "c", "d"]);
  assert.deepEqual(
    [...mountedRows.values()].map(({ wrapper }) => wrapper.props.style.top),
    [0, 20, 40, 60],
  );
  const retainedHandles = new Map(
    [...mountedRows].map(([key, { wrapper }]) => [key, wrapper.node]),
  );

  host.injectEvent({
    surface: app.root.surfaceId,
    target: scrollView.node,
    name: "scroll",
    payload: { contentOffset: { x: 0, y: 40 } },
    priority: "continuous",
    bubbles: true,
  });
  await app.root.flush();
  mountedRows = rows();
  assert.deepEqual([...mountedRows.keys()], ["b", "c", "d", "e", "f"]);
  for (const key of ["b", "c", "d"]) {
    assert.equal(mountedRows.get(key)?.wrapper.node, retainedHandles.get(key));
  }
  assert.equal(disposals.get("a"), 1);
  assert.equal(scrollEvents.length, 1);
  assert.deepEqual(endReached, []);
  assert.deepEqual(startReached, []);

  setItems([
    { id: "a", label: "Alpha" },
    { id: "c", label: "Gamma" },
    { id: "d", label: "Delta" },
    { id: "b", label: "Beta 2" },
    { id: "e", label: "Epsilon" },
    { id: "f", label: "Zeta" },
    { id: "g", label: "Eta" },
    { id: "h", label: "Theta" },
  ]);
  await app.root.flush();
  mountedRows = rows();
  assert.deepEqual([...mountedRows.keys()], ["c", "d", "b", "e", "f"]);
  assert.equal(mountedRows.get("b")?.wrapper.node, retainedHandles.get("b"));
  assert.equal(mountedRows.get("b")?.wrapper.props.style.top, 60);
  assert.equal(mountedRows.get("b")?.rawText.text, "b:3:Beta 2");
  for (const count of creations.values()) assert.equal(count, 1);

  for (let repetition = 0; repetition < 2; repetition++) {
    host.injectEvent({
      surface: app.root.surfaceId,
      target: scrollView.node,
      name: "scroll",
      payload: { contentOffset: { x: 0, y: 100 } },
      priority: "continuous",
      bubbles: true,
    });
    await app.root.flush();
  }
  mountedRows = rows();
  assert.deepEqual([...mountedRows.keys()], ["e", "f", "g", "h"]);
  assert.deepEqual(endReached, [{ distanceFromEnd: 0 }]);
  assert.equal(scrollEvents.length, 3);
  for (const key of ["b", "c", "d"]) assert.equal(disposals.get(key), 1);

  setItems([...items(), { id: "i", label: "Iota" }]);
  await app.root.flush();
  host.injectEvent({
    surface: app.root.surfaceId,
    target: scrollView.node,
    name: "scroll",
    payload: { contentOffset: { x: 0, y: 120 } },
    priority: "continuous",
    bubbles: true,
  });
  await app.root.flush();
  assert.deepEqual(endReached, [
    { distanceFromEnd: 0 },
    { distanceFromEnd: 0 },
  ]);

  const imperativeCommitStart = host.commits.length;
  await list.scrollToIndex({
    index: 3,
    viewOffset: 5,
    viewPosition: 0.5,
    animated: false,
  });
  const imperativeCommits = host.commits.slice(imperativeCommitStart);
  assert.equal(imperativeCommits.length, 2);
  assert.ok(
    imperativeCommits[0].mutations.every(
      (mutation) => mutation.type !== "command",
    ),
  );
  assert.deepEqual(imperativeCommits[1].mutations, [
    {
      type: "command",
      node: scrollView.node,
      command: "scrollTo",
      args: [0, 35, false],
    },
  ]);
  mountedRows = rows();
  assert.deepEqual([...mountedRows.keys()], ["a", "c", "d", "b", "e", "f"]);

  await list.scrollToOffset({ offset: 1_000, animated: true });
  assert.deepEqual(host.commits.at(-1)?.mutations, [
    {
      type: "command",
      node: scrollView.node,
      command: "scrollTo",
      args: [0, 120, true],
    },
  ]);
  await list.scrollToEnd({ animated: false });
  assert.deepEqual(host.commits.at(-1)?.mutations, [
    {
      type: "command",
      node: scrollView.node,
      command: "scrollTo",
      args: [0, 120, false],
    },
  ]);

  const queuedCommitStart = host.commits.length;
  const firstQueuedScroll = list.scrollToIndex({
    index: 0,
    animated: false,
  });
  const secondQueuedScroll = list.scrollToOffset({
    offset: 40,
    animated: false,
  });
  await Promise.all([firstQueuedScroll, secondQueuedScroll]);
  const queuedCommits = host.commits.slice(queuedCommitStart);
  assert.deepEqual(
    queuedCommits.map((commit) =>
      commit.mutations.find((mutation) => mutation.type === "command"),
    ),
    [
      undefined,
      {
        type: "command",
        node: scrollView.node,
        command: "scrollTo",
        args: [0, 0, false],
      },
      undefined,
      {
        type: "command",
        node: scrollView.node,
        command: "scrollTo",
        args: [0, 40, false],
      },
    ],
  );

  for (let repetition = 0; repetition < 2; repetition++) {
    host.injectEvent({
      surface: app.root.surfaceId,
      target: scrollView.node,
      name: "scroll",
      payload: { contentOffset: { x: 0, y: 0 } },
      priority: "continuous",
      bubbles: true,
    });
    await app.root.flush();
  }
  assert.deepEqual(startReached, [{ distanceFromStart: 0 }]);

  setItems([{ id: "before-a", label: "Before Alpha" }, ...items()]);
  await app.root.flush();
  host.injectEvent({
    surface: app.root.surfaceId,
    target: scrollView.node,
    name: "scroll",
    payload: { contentOffset: { x: 0, y: 0 } },
    priority: "continuous",
    bubbles: true,
  });
  await app.root.flush();
  assert.deepEqual(startReached, [
    { distanceFromStart: 0 },
    { distanceFromStart: 0 },
  ]);

  await app.dispose();
  for (const [key, count] of creations) {
    assert.equal(disposals.get(key), count);
  }
});

test("exposes fine-grained viewport visibility to VirtualizedList rows", async () => {
  const host = createRendererHost();
  const creations = new Map();
  const visibilityByKey = new Map();
  const data = Array.from({ length: 6 }, (_, index) => ({
    id: `row-${String(index)}`,
  }));
  const app = mount(
    () =>
      createComponent(VirtualizedList, {
        data,
        itemSize: 40,
        viewportSize: 50,
        overscan: 1,
        keyExtractor: (item) => item.id,
        renderItem({ isVisible, key, visibleFraction }) {
          creations.set(key, (creations.get(key) ?? 0) + 1);
          visibilityByKey.set(key, { isVisible, visibleFraction });
          return createComponent(Text, {
            get children() {
              return `${key}:${visibleFraction().toFixed(2)}:${String(isVisible())}`;
            },
          });
        },
      }),
    host,
    { surface: { name: "virtualized-list-visibility" }, autoCommit: false },
  );

  const visibleRows = () => {
    const snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
    const byHandle = new Map(snapshot.nodes.map((node) => [node.node, node]));
    const content = snapshot.nodes.find(
      (node) =>
        node.kind === "element" && node.component === "ScrollContentView",
    );
    assert.ok(content);
    return content.children.map((handle) => {
      const wrapper = byHandle.get(handle);
      assert.equal(wrapper?.kind, "element");
      const text = byHandle.get(wrapper.children[0]);
      assert.equal(text?.kind, "element");
      const rawText = byHandle.get(text.children[0]);
      assert.equal(rawText?.kind, "text");
      return rawText.text;
    });
  };

  await app.root.flush();
  let snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  const scrollView = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "ScrollView",
  );
  assert.ok(scrollView);
  assert.deepEqual(visibleRows(), [
    "row-0:1.00:true",
    "row-1:0.25:true",
    "row-2:0.00:false",
  ]);

  host.injectEvent({
    surface: app.root.surfaceId,
    target: scrollView.node,
    name: "scroll",
    payload: { contentOffset: { x: 0, y: 20 } },
    priority: "continuous",
    bubbles: true,
  });
  await app.root.flush();
  assert.equal(visibilityByKey.get("row-0")?.visibleFraction(), 0.5);
  assert.equal(visibilityByKey.get("row-1")?.visibleFraction(), 0.75);
  assert.deepEqual(visibleRows(), [
    "row-0:0.50:true",
    "row-1:0.75:true",
    "row-2:0.00:false",
  ]);
  assert.deepEqual(
    [...creations],
    [
      ["row-0", 1],
      ["row-1", 1],
      ["row-2", 1],
    ],
  );

  host.injectEvent({
    surface: app.root.surfaceId,
    target: scrollView.node,
    name: "scroll",
    payload: { contentOffset: { x: 0, y: 50 } },
    priority: "continuous",
    bubbles: true,
  });
  await app.root.flush();
  assert.deepEqual(visibleRows(), [
    "row-0:0.00:false",
    "row-1:0.75:true",
    "row-2:0.50:true",
    "row-3:0.00:false",
  ]);
  assert.equal(creations.get("row-0"), 1);
  assert.equal(creations.get("row-1"), 1);
  assert.equal(creations.get("row-2"), 1);
  assert.equal(creations.get("row-3"), 1);

  await app.dispose();
});

test("mounts VirtualizedList at an initial key or index without a scroll command", async () => {
  const data = Array.from({ length: 10 }, (_, index) => ({
    id: `row-${String(index)}`,
  }));
  for (const target of [
    {
      horizontal: false,
      geometry: { itemSize: 20 },
      initialScrollKey: "row-5",
      expectedOffset: { x: 0, y: 100 },
      expectedRows: ["row-5", "row-6", "row-7"],
    },
    {
      horizontal: true,
      geometry: { itemSize: 20 },
      initialScrollIndex: 5,
      expectedOffset: { x: 100, y: 0 },
      expectedRows: ["row-5", "row-6", "row-7"],
    },
    {
      horizontal: false,
      geometry: { estimatedItemSize: 30 },
      initialScrollKey: "row-4",
      expectedOffset: { x: 0, y: 120 },
      expectedRows: ["row-4", "row-5"],
    },
    {
      horizontal: false,
      geometry: {
        getItemLayout: (_data, index) => ({
          index,
          length: index % 2 === 0 ? 20 : 30,
          offset: Math.floor(index / 2) * 50 + (index % 2 === 0 ? 0 : 20),
        }),
      },
      initialScrollIndex: 5,
      expectedOffset: { x: 0, y: 120 },
      expectedRows: ["row-5", "row-6", "row-7"],
    },
  ]) {
    const host = createRendererHost();
    const app = mount(
      () =>
        createComponent(VirtualizedList, {
          data,
          ...target.geometry,
          viewportSize: 60,
          overscan: 0,
          horizontal: target.horizontal,
          ...(target.initialScrollKey === undefined
            ? { initialScrollIndex: target.initialScrollIndex }
            : { initialScrollKey: target.initialScrollKey }),
          keyExtractor: (item) => item.id,
          renderItem({ item }) {
            return createComponent(Text, {
              get children() {
                return item().id;
              },
            });
          },
        }),
      host,
      { surface: { name: "initial-virtualized-list" }, autoCommit: false },
    );

    await app.root.flush();
    const snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
    const byHandle = new Map(snapshot.nodes.map((node) => [node.node, node]));
    const scrollView = snapshot.nodes.find(
      (node) => node.kind === "element" && node.component === "ScrollView",
    );
    const content = snapshot.nodes.find(
      (node) =>
        node.kind === "element" && node.component === "ScrollContentView",
    );
    assert.ok(scrollView);
    assert.ok(content);
    assert.deepEqual(scrollView.props.contentOffset, target.expectedOffset);
    assert.deepEqual(
      content.children.map((handle) => {
        const wrapper = byHandle.get(handle);
        assert.equal(wrapper?.kind, "element");
        const text = byHandle.get(wrapper.children[0]);
        assert.equal(text?.kind, "element");
        const rawText = byHandle.get(text.children[0]);
        assert.equal(rawText?.kind, "text");
        return rawText.text;
      }),
      target.expectedRows,
    );
    assert.equal(
      host.commits
        .flatMap((commit) => commit.mutations)
        .some((mutation) => mutation.type === "command"),
      false,
    );
    await app.dispose();
  }
});

test("recycles bounded VirtualizedList row views without reusing keyed owners", async () => {
  const host = createRendererHost();
  const [items, setItems] = createSignal(
    Array.from({ length: 8 }, (_, index) => ({
      id: `row-${String(index)}`,
      label: `Row ${String(index)}`,
    })),
  );
  const creations = new Map();
  const disposals = new Map();
  const app = mount(
    () =>
      createComponent(VirtualizedList, {
        get data() {
          return items();
        },
        itemSize: 20,
        viewportSize: 40,
        overscan: 0,
        recycleRowViews: true,
        keyExtractor: (item) => item.id,
        renderItem({ item, key }) {
          creations.set(key, (creations.get(key) ?? 0) + 1);
          onCleanup(() => {
            disposals.set(key, (disposals.get(key) ?? 0) + 1);
          });
          return createComponent(Text, {
            get children() {
              return `${key}:${item().label}`;
            },
          });
        },
      }),
    host,
    { surface: { name: "recycled-virtualized-list" }, autoCommit: false },
  );
  const rendered = () => {
    const snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
    const byHandle = new Map(snapshot.nodes.map((node) => [node.node, node]));
    const scrollView = snapshot.nodes.find(
      (node) => node.kind === "element" && node.component === "ScrollView",
    );
    const content = snapshot.nodes.find(
      (node) =>
        node.kind === "element" && node.component === "ScrollContentView",
    );
    assert.ok(scrollView);
    assert.ok(content);
    return {
      content,
      scrollView,
      rows: new Map(
        content.children.map((handle) => {
          const wrapper = byHandle.get(handle);
          assert.equal(wrapper?.kind, "element");
          const text = byHandle.get(wrapper.children[0]);
          assert.equal(text?.kind, "element");
          const rawText = byHandle.get(text.children[0]);
          assert.equal(rawText?.kind, "text");
          return [rawText.text.split(":")[0], { rawText, wrapper }];
        }),
      ),
    };
  };

  await app.root.flush();
  let current = rendered();
  assert.deepEqual([...current.rows.keys()], ["row-0", "row-1"]);
  const firstSlot = current.rows.get("row-0").wrapper.node;
  const secondSlot = current.rows.get("row-1").wrapper.node;

  const recycleCommitStart = host.commits.length;
  host.injectEvent({
    surface: app.root.surfaceId,
    target: current.scrollView.node,
    name: "scroll",
    payload: { contentOffset: { x: 0, y: 40 } },
    priority: "continuous",
    bubbles: true,
  });
  await app.root.flush();
  current = rendered();
  assert.deepEqual([...current.rows.keys()], ["row-2", "row-3"]);
  assert.equal(current.rows.get("row-2").wrapper.node, firstSlot);
  assert.equal(current.rows.get("row-3").wrapper.node, secondSlot);
  assert.equal(disposals.get("row-0"), 1);
  assert.equal(disposals.get("row-1"), 1);
  assert.equal(creations.get("row-2"), 1);
  assert.equal(creations.get("row-3"), 1);
  const recycledMutations = host.commits
    .slice(recycleCommitStart)
    .flatMap((commit) => commit.mutations);
  assert.equal(
    recycledMutations.some(
      (mutation) =>
        mutation.type === "delete-node" &&
        (mutation.node === firstSlot || mutation.node === secondSlot),
    ),
    false,
  );
  assert.equal(
    recycledMutations.some(
      (mutation) =>
        mutation.type === "create-element" &&
        (mutation.node === firstSlot || mutation.node === secondSlot),
    ),
    false,
  );

  host.injectEvent({
    surface: app.root.surfaceId,
    target: current.scrollView.node,
    name: "scroll",
    payload: { contentOffset: { x: 0, y: 20 } },
    priority: "continuous",
    bubbles: true,
  });
  await app.root.flush();
  current = rendered();
  assert.deepEqual([...current.rows.keys()], ["row-1", "row-2"]);
  assert.equal(current.rows.get("row-1").wrapper.node, secondSlot);
  assert.equal(current.rows.get("row-2").wrapper.node, firstSlot);
  assert.equal(creations.get("row-1"), 2);
  assert.equal(disposals.get("row-3"), 1);

  const shrinkCommitStart = host.commits.length;
  setItems([{ id: "row-0", label: "Row 0" }]);
  await app.root.flush();
  current = rendered();
  assert.deepEqual([...current.rows.keys()], ["row-0"]);
  assert.equal(current.content.children.length, 1);
  assert.equal(
    host.commits
      .slice(shrinkCommitStart)
      .flatMap((commit) => commit.mutations)
      .filter(
        (mutation) =>
          mutation.type === "delete-node" &&
          (mutation.node === firstSlot || mutation.node === secondSlot),
      ).length,
    1,
    "a shrunken window must reclaim surplus wrapper slots",
  );

  await app.dispose();
  for (const [key, count] of creations) {
    assert.equal(disposals.get(key), count);
  }
});

test("retains a keyed VirtualizedList anchor across large prepends", async () => {
  const host = createRendererHost();
  const original = Array.from({ length: 20 }, (_, index) => ({
    id: `row-${String(index)}`,
  }));
  const [items, setItems] = createSignal(original);
  const app = mount(
    () =>
      createComponent(VirtualizedList, {
        get data() {
          return items();
        },
        itemSize: 20,
        viewportSize: 60,
        overscan: 1,
        maintainVisibleContentPosition: { minIndexForVisible: 5 },
        keyExtractor: (item) => item.id,
        renderItem: ({ item }) =>
          createComponent(Text, {
            get children() {
              return item().id;
            },
          }),
      }),
    host,
    { surface: { name: "anchored-virtualized-list" }, autoCommit: false },
  );
  const rendered = () => {
    const snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
    const byHandle = new Map(snapshot.nodes.map((node) => [node.node, node]));
    const scrollView = snapshot.nodes.find(
      (node) => node.kind === "element" && node.component === "ScrollView",
    );
    const content = snapshot.nodes.find(
      (node) =>
        node.kind === "element" && node.component === "ScrollContentView",
    );
    assert.ok(scrollView);
    assert.ok(content);
    return {
      content,
      scrollView,
      rows: new Map(
        content.children.map((handle) => {
          const wrapper = byHandle.get(handle);
          assert.equal(wrapper?.kind, "element");
          const text = byHandle.get(wrapper.children[0]);
          assert.equal(text?.kind, "element");
          const rawText = byHandle.get(text.children[0]);
          assert.equal(rawText?.kind, "text");
          return [rawText.text, wrapper];
        }),
      ),
    };
  };

  await app.root.flush();
  let current = rendered();
  host.injectEvent({
    surface: app.root.surfaceId,
    target: current.scrollView.node,
    name: "scroll",
    payload: { contentOffset: { x: 0, y: 100 } },
    priority: "continuous",
    bubbles: true,
  });
  await app.root.flush();
  current = rendered();
  assert.deepEqual(
    [...current.rows.keys()],
    ["row-4", "row-5", "row-6", "row-7", "row-8"],
  );
  assert.deepEqual(current.scrollView.props.maintainVisibleContentPosition, {
    minIndexForVisible: 1,
  });
  const anchorHandle = current.rows.get("row-5").node;
  assert.equal(current.rows.get("row-5").props.style.top, 100);

  const prepend = Array.from({ length: 10 }, (_, index) => ({
    id: `prepended-${String(index)}`,
  }));
  const commitStart = host.commits.length;
  setItems([...prepend, ...original]);
  await app.root.flush();
  current = rendered();
  assert.deepEqual(
    [...current.rows.keys()],
    ["row-4", "row-5", "row-6", "row-7", "row-8"],
  );
  assert.equal(current.rows.get("row-5").node, anchorHandle);
  assert.equal(current.rows.get("row-5").props.style.top, 300);
  assert.equal(current.content.props.style.height, 600);
  assert.deepEqual(current.scrollView.props.maintainVisibleContentPosition, {
    minIndexForVisible: 0,
  });
  assert.equal(
    host.commits
      .slice(commitStart)
      .flatMap((commit) => commit.mutations)
      .some((mutation) => mutation.type === "command"),
    false,
  );

  await app.dispose();
});

test("retains an anchored VirtualizedList window until the native threshold scroll", async () => {
  const host = createRendererHost();
  const original = Array.from({ length: 20 }, (_, index) => `row-${index}`);
  const [items, setItems] = createSignal(original);
  const app = mount(
    () =>
      createComponent(VirtualizedList, {
        get data() {
          return items();
        },
        itemSize: 20,
        viewportSize: 60,
        overscan: 0,
        maintainVisibleContentPosition: {
          minIndexForVisible: 0,
          autoscrollToTopThreshold: 80,
        },
        keyExtractor: (item) => item,
        renderItem: ({ item }) => createComponent(Text, { children: item }),
      }),
    host,
    { surface: { name: "autoscroll-virtualized-list" }, autoCommit: false },
  );
  const rows = () => {
    const snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
    const byHandle = new Map(snapshot.nodes.map((node) => [node.node, node]));
    const content = snapshot.nodes.find(
      (node) =>
        node.kind === "element" && node.component === "ScrollContentView",
    );
    assert.ok(content);
    return content.children.map((handle) => {
      const wrapper = byHandle.get(handle);
      const text = byHandle.get(wrapper.children[0]);
      return byHandle.get(text.children[0]).text;
    });
  };

  await app.root.flush();
  const scrollView = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "ScrollView",
    );
  assert.ok(scrollView);
  host.injectEvent({
    surface: app.root.surfaceId,
    target: scrollView.node,
    name: "scroll",
    payload: { contentOffset: { x: 0, y: 80 } },
    priority: "continuous",
    bubbles: true,
  });
  await app.root.flush();
  assert.deepEqual(rows(), ["row-4", "row-5", "row-6"]);

  setItems(["new-a", "new-b", ...original]);
  await app.root.flush();
  assert.deepEqual(rows(), ["row-4", "row-5", "row-6"]);
  const anchoredScrollView = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "ScrollView",
    );
  assert.ok(anchoredScrollView);
  assert.deepEqual(anchoredScrollView.props.maintainVisibleContentPosition, {
    minIndexForVisible: 0,
    autoscrollToTopThreshold: 80,
  });

  host.injectEvent({
    surface: app.root.surfaceId,
    target: scrollView.node,
    name: "scroll",
    payload: { contentOffset: { x: 0, y: 0 } },
    priority: "continuous",
    bubbles: true,
  });
  await app.root.flush();
  assert.deepEqual(rows(), ["new-a", "new-b", "row-0"]);
  await app.dispose();
});

test("virtualizes exact heterogeneous row layouts and scrolls by their geometry", async () => {
  const host = createRendererHost();
  const [items, setItems] = createSignal([
    { id: "a", label: "Alpha", length: 20 },
    { id: "b", label: "Beta", length: 40 },
    { id: "c", label: "Gamma", length: 30 },
    { id: "d", label: "Delta", length: 60 },
    { id: "e", label: "Epsilon", length: 10 },
    { id: "f", label: "Zeta", length: 50 },
  ]);
  const creations = new Map();
  const endReached = [];
  let list;
  const getItemLayout = (data, index) => ({
    index,
    length: data[index].length,
    offset: data
      .slice(0, index)
      .reduce((total, item) => total + item.length, 0),
  });
  const app = mount(
    () =>
      createComponent(VirtualizedList, {
        get data() {
          return items();
        },
        getItemLayout,
        viewportSize: 70,
        overscan: 1,
        keyExtractor: (item) => item.id,
        renderItem({ item, key }) {
          creations.set(key, (creations.get(key) ?? 0) + 1);
          return createComponent(Text, {
            get children() {
              return `${key}:${item().label}`;
            },
          });
        },
        ref(handle) {
          list = handle;
        },
        onEndReached(info) {
          endReached.push(info);
        },
      }),
    host,
    { surface: { name: "heterogeneous-virtualized-list" }, autoCommit: false },
  );
  const rows = () => {
    const snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
    const byHandle = new Map(snapshot.nodes.map((node) => [node.node, node]));
    const content = snapshot.nodes.find(
      (node) =>
        node.kind === "element" && node.component === "ScrollContentView",
    );
    assert.ok(content);
    return {
      content,
      rows: new Map(
        content.children.map((handle) => {
          const wrapper = byHandle.get(handle);
          assert.equal(wrapper?.kind, "element");
          const text = byHandle.get(wrapper.children[0]);
          assert.equal(text?.kind, "element");
          const rawText = byHandle.get(text.children[0]);
          assert.equal(rawText?.kind, "text");
          return [rawText.text.split(":")[0], wrapper];
        }),
      ),
    };
  };

  await app.root.flush();
  let rendered = rows();
  assert.deepEqual(rendered.content.props.style, {
    height: 210,
    position: "relative",
  });
  assert.deepEqual([...rendered.rows.keys()], ["a", "b", "c", "d"]);
  assert.deepEqual(
    [...rendered.rows.values()].map((row) => [
      row.props.style.top,
      row.props.style.height,
    ]),
    [
      [0, 20],
      [20, 40],
      [60, 30],
      [90, 60],
    ],
  );
  const bHandle = rendered.rows.get("b").node;
  const scrollView = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "ScrollView",
    );
  assert.ok(scrollView);

  host.injectEvent({
    surface: app.root.surfaceId,
    target: scrollView.node,
    name: "scroll",
    payload: { contentOffset: { x: 0, y: 80 } },
    priority: "continuous",
    bubbles: true,
  });
  await app.root.flush();
  rendered = rows();
  assert.deepEqual([...rendered.rows.keys()], ["b", "c", "d", "e"]);
  assert.equal(rendered.rows.get("b").node, bHandle);

  setItems([
    { id: "a", label: "Alpha", length: 20 },
    { id: "b", label: "Beta taller", length: 50 },
    { id: "c", label: "Gamma", length: 30 },
    { id: "d", label: "Delta", length: 60 },
    { id: "e", label: "Epsilon", length: 10 },
    { id: "f", label: "Zeta", length: 50 },
  ]);
  await app.root.flush();
  rendered = rows();
  assert.deepEqual(rendered.content.props.style, {
    height: 220,
    position: "relative",
  });
  assert.equal(rendered.rows.get("b").node, bHandle);
  assert.equal(rendered.rows.get("b").props.style.height, 50);
  assert.equal(rendered.rows.get("c").props.style.top, 70);
  for (const count of creations.values()) assert.equal(count, 1);

  host.injectEvent({
    surface: app.root.surfaceId,
    target: scrollView.node,
    name: "scroll",
    payload: { contentOffset: { x: 0, y: 150 } },
    priority: "continuous",
    bubbles: true,
  });
  await app.root.flush();
  assert.deepEqual(endReached, [{ distanceFromEnd: 0 }]);
  setItems([
    { id: "a", label: "Alpha", length: 20 },
    { id: "b", label: "Beta taller", length: 50 },
    { id: "c", label: "Gamma", length: 30 },
    { id: "d", label: "Delta", length: 60 },
    { id: "e", label: "Epsilon", length: 10 },
    { id: "f", label: "Zeta taller", length: 60 },
  ]);
  await app.root.flush();
  host.injectEvent({
    surface: app.root.surfaceId,
    target: scrollView.node,
    name: "scroll",
    payload: { contentOffset: { x: 0, y: 160 } },
    priority: "continuous",
    bubbles: true,
  });
  await app.root.flush();
  assert.deepEqual(endReached, [
    { distanceFromEnd: 0 },
    { distanceFromEnd: 0 },
  ]);

  const commitOffset = host.commits.length;
  await list.scrollToIndex({
    index: 4,
    viewOffset: 5,
    viewPosition: 0.5,
    animated: false,
  });
  const commits = host.commits.slice(commitOffset);
  assert.ok(
    commits[0].mutations.every((mutation) => mutation.type !== "command"),
  );
  assert.deepEqual(commits.at(-1)?.mutations, [
    {
      type: "command",
      node: scrollView.node,
      command: "scrollTo",
      args: [0, 125, false],
    },
  ]);
  rendered = rows();
  assert.deepEqual([...rendered.rows.keys()], ["c", "d", "e", "f"]);

  await list.scrollToEnd({ animated: false });
  assert.deepEqual(host.commits.at(-1)?.mutations, [
    {
      type: "command",
      node: scrollView.node,
      command: "scrollTo",
      args: [0, 160, false],
    },
  ]);
  await app.dispose();
});

test("learns intrinsic VirtualizedList row sizes while retaining keyed geometry", async () => {
  const host = createRendererHost();
  const original = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id }));
  const [items, setItems] = createSignal(original);
  const app = mount(
    () =>
      createComponent(VirtualizedList, {
        get data() {
          return items();
        },
        estimatedItemSize: 20,
        viewportSize: 60,
        overscan: 0,
        maintainVisibleContentPosition: { minIndexForVisible: 0 },
        keyExtractor: (item) => item.id,
        renderItem: ({ item }) =>
          createComponent(Text, {
            get children() {
              return item().id;
            },
          }),
      }),
    host,
    { surface: { name: "measured-virtualized-list" }, autoCommit: false },
  );
  const rendered = () => {
    const snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
    const byHandle = new Map(snapshot.nodes.map((node) => [node.node, node]));
    const scrollView = snapshot.nodes.find(
      (node) => node.kind === "element" && node.component === "ScrollView",
    );
    const content = snapshot.nodes.find(
      (node) =>
        node.kind === "element" && node.component === "ScrollContentView",
    );
    assert.ok(scrollView);
    assert.ok(content);
    return {
      content,
      scrollView,
      rows: new Map(
        content.children.map((handle) => {
          const wrapper = byHandle.get(handle);
          assert.equal(wrapper?.kind, "element");
          const text = byHandle.get(wrapper.children[0]);
          assert.equal(text?.kind, "element");
          const rawText = byHandle.get(text.children[0]);
          assert.equal(rawText?.kind, "text");
          return [rawText.text, wrapper];
        }),
      ),
    };
  };
  const measure = (row, height) =>
    host.injectEvent({
      surface: app.root.surfaceId,
      target: row.node,
      name: "layout",
      payload: { layout: { x: 0, y: row.props.style.top, width: 100, height } },
      priority: "default",
      bubbles: false,
    });

  await app.root.flush();
  let current = rendered();
  assert.deepEqual([...current.rows.keys()], ["a", "b", "c"]);
  assert.deepEqual(current.content.props.style, {
    height: 120,
    position: "relative",
  });
  assert.deepEqual(current.rows.get("a").props.style, {
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  });
  assert.deepEqual(current.rows.get("a").eventListeners, ["layout"]);
  const aHandle = current.rows.get("a").node;
  const bHandle = current.rows.get("b").node;
  measure(current.rows.get("a"), 30);
  measure(current.rows.get("b"), 50);
  await app.root.flush();

  current = rendered();
  assert.deepEqual([...current.rows.keys()], ["a", "b"]);
  assert.equal(current.rows.get("a").node, aHandle);
  assert.equal(current.rows.get("b").node, bHandle);
  assert.equal(current.rows.get("b").props.style.top, 30);
  assert.deepEqual(current.content.props.style, {
    height: 160,
    position: "relative",
  });

  host.injectEvent({
    surface: app.root.surfaceId,
    target: current.scrollView.node,
    name: "scroll",
    payload: { contentOffset: { x: 0, y: 90 } },
    priority: "continuous",
    bubbles: true,
  });
  await app.root.flush();
  current = rendered();
  assert.deepEqual([...current.rows.keys()], ["c", "d", "e", "f"]);
  measure(current.rows.get("c"), 10);
  await app.root.flush();
  current = rendered();
  assert.deepEqual([...current.rows.keys()], ["d", "e", "f"]);
  const dHandle = current.rows.get("d").node;
  const commitStart = host.commits.length;
  setItems([{ id: "prepended" }, ...original]);
  await app.root.flush();
  current = rendered();
  assert.deepEqual([...current.rows.keys()], ["d", "e", "f"]);
  assert.equal(current.rows.get("d").node, dHandle);
  assert.equal(current.rows.get("d").props.style.top, 110);
  assert.deepEqual(current.content.props.style, {
    height: 170,
    position: "relative",
  });
  assert.equal(
    host.commits
      .slice(commitStart)
      .flatMap((commit) => commit.mutations)
      .some((mutation) => mutation.type === "command"),
    false,
  );

  assert.throws(
    () => measure(current.rows.get("d"), -1),
    /finite non-negative scroll-axis extent/,
  );
  measure(current.rows.get("d"), 0);
  await app.root.flush();
  assert.equal(rendered().rows.get("d").props.style.top, 110);

  setItems([
    { id: "prepended" },
    ...original.filter((item) => item.id !== "a"),
  ]);
  await app.root.flush();
  assert.equal(rendered().content.props.style.height, 140);
  setItems([
    { id: "prepended" },
    ...original.filter((item) => item.id !== "a"),
    { id: "a" },
  ]);
  await app.root.flush();
  assert.equal(
    rendered().content.props.style.height,
    160,
    "a reintroduced key must start from the estimate instead of a pruned measurement",
  );
  await app.dispose();
});

test("ignores stale measurements after a VirtualizedList row view is reassigned", async () => {
  const host = createRendererHost();
  const disposals = new Map();
  const app = mount(
    () =>
      createComponent(VirtualizedList, {
        data: ["a", "b", "c", "d"],
        estimatedItemSize: 20,
        viewportSize: 40,
        overscan: 0,
        recycleRowViews: true,
        keyExtractor: (item) => item,
        renderItem({ item, key }) {
          onCleanup(() => {
            disposals.set(key, (disposals.get(key) ?? 0) + 1);
          });
          return createComponent(Text, { children: item });
        },
      }),
    host,
    { surface: { name: "measured-recycled-list" }, autoCommit: false },
  );
  const rendered = () => {
    const snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
    const byHandle = new Map(snapshot.nodes.map((node) => [node.node, node]));
    const scrollView = snapshot.nodes.find(
      (node) => node.kind === "element" && node.component === "ScrollView",
    );
    const content = snapshot.nodes.find(
      (node) =>
        node.kind === "element" && node.component === "ScrollContentView",
    );
    assert.ok(scrollView);
    assert.ok(content);
    return {
      content,
      scrollView,
      rows: new Map(
        content.children.map((handle) => {
          const wrapper = byHandle.get(handle);
          assert.equal(wrapper?.kind, "element");
          const text = byHandle.get(wrapper.children[0]);
          assert.equal(text?.kind, "element");
          const rawText = byHandle.get(text.children[0]);
          assert.equal(rawText?.kind, "text");
          return [rawText.text, wrapper];
        }),
      ),
    };
  };
  const measure = (row, height, observedSequence) =>
    host.injectEvent({
      surface: app.root.surfaceId,
      target: row.node,
      name: "layout",
      payload: { layout: { x: 0, y: row.props.style.top, width: 100, height } },
      observedSequence,
      priority: "default",
      bubbles: false,
    });

  await app.root.flush();
  let current = rendered();
  const aSlot = current.rows.get("a").node;
  const bSlot = current.rows.get("b").node;
  measure(current.rows.get("a"), 30, app.root.lastCommittedSequence);
  measure(current.rows.get("b"), 10, app.root.lastCommittedSequence);
  await app.root.flush();
  assert.equal(rendered().content.props.style.height, 80);

  host.injectEvent({
    surface: app.root.surfaceId,
    target: current.scrollView.node,
    name: "scroll",
    payload: { contentOffset: { x: 0, y: 40 } },
    priority: "continuous",
    bubbles: true,
  });
  await app.root.flush();
  current = rendered();
  assert.deepEqual([...current.rows.keys()], ["c", "d"]);
  assert.equal(current.rows.get("c").node, aSlot);
  assert.equal(current.rows.get("d").node, bSlot);
  assert.equal(disposals.get("a"), 1);
  assert.equal(disposals.get("b"), 1);

  measure(current.rows.get("c"), 99, app.root.lastCommittedSequence - 1);
  await app.root.flush();
  assert.equal(
    rendered().content.props.style.height,
    80,
    "a pre-assignment layout event must not become the new key's measurement",
  );

  current = rendered();
  measure(current.rows.get("c"), 50, app.root.lastCommittedSequence);
  await app.root.flush();
  assert.equal(rendered().content.props.style.height, 110);
  await app.dispose();
});

test("measures horizontal VirtualizedList rows on the native scroll axis", async () => {
  const host = createRendererHost();
  const app = mount(
    () =>
      createComponent(VirtualizedList, {
        data: ["a", "b", "c", "d"],
        estimatedItemSize: 20,
        viewportSize: 40,
        overscan: 0,
        horizontal: true,
        keyExtractor: (item) => item,
        renderItem: ({ item }) => createComponent(Text, { children: item }),
      }),
    host,
    { surface: { name: "horizontal-measured-list" }, autoCommit: false },
  );
  const rendered = () => {
    const snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
    const byHandle = new Map(snapshot.nodes.map((node) => [node.node, node]));
    const content = snapshot.nodes.find(
      (node) =>
        node.kind === "element" && node.component === "ScrollContentView",
    );
    assert.ok(content);
    return {
      content,
      rows: content.children.map((handle) => {
        const wrapper = byHandle.get(handle);
        assert.equal(wrapper?.kind, "element");
        return wrapper;
      }),
    };
  };

  await app.root.flush();
  let current = rendered();
  assert.deepEqual(current.content.props.style, {
    flexDirection: "row",
    position: "relative",
    width: 80,
  });
  assert.deepEqual(current.rows[0].props.style, {
    bottom: 0,
    left: 0,
    position: "absolute",
    top: 0,
  });
  for (const [row, width] of [
    [current.rows[0], 30],
    [current.rows[1], 15],
  ]) {
    host.injectEvent({
      surface: app.root.surfaceId,
      target: row.node,
      name: "layout",
      payload: {
        layout: { x: row.props.style.left, y: 0, width, height: 999 },
      },
      priority: "default",
      bubbles: false,
    });
  }
  await app.root.flush();
  current = rendered();
  assert.equal(current.rows[1].props.style.left, 30);
  assert.deepEqual(current.content.props.style, {
    flexDirection: "row",
    position: "relative",
    width: 85,
  });
  await app.dispose();
});

test("rejects unsafe VirtualizedList configuration and native scroll data", async () => {
  const host = createRendererHost();
  const common = {
    data: [{ id: "duplicate" }, { id: "duplicate" }],
    itemSize: 20,
    viewportSize: 60,
    keyExtractor: (item) => item.id,
    renderItem: () => createComponent(Text, { children: "row" }),
  };
  assert.throws(() => VirtualizedList(common), /duplicate key/);
  const validCommon = { ...common, data: [{ id: "valid" }] };
  assert.throws(
    () => VirtualizedList({ ...validCommon, refreshing: false }),
    /requires an onRefresh callback/,
  );
  assert.throws(
    () => VirtualizedList({ ...validCommon, onRefresh: () => undefined }),
    /requires a controlled refreshing boolean/,
  );
  assert.throws(
    () =>
      VirtualizedList({
        ...validCommon,
        maintainVisibleContentPosition: { minIndexForVisible: -1 },
      }),
    /minIndexForVisible must be an integer/,
  );
  assert.throws(
    () =>
      VirtualizedList({
        ...validCommon,
        initialScrollIndex: 0,
        initialScrollKey: "valid",
      }),
    /only one of initialScrollIndex or initialScrollKey/,
  );
  assert.throws(
    () =>
      VirtualizedList({
        ...validCommon,
        initialScrollIndex: 1,
      }),
    /outside 1 initial items/,
  );
  assert.throws(
    () =>
      VirtualizedList({
        ...validCommon,
        initialScrollKey: "missing",
      }),
    /not present in the initial data/,
  );
  assert.throws(
    () =>
      VirtualizedList({
        ...validCommon,
        initialScrollKey: "",
      }),
    /non-empty string of at most 256 characters/,
  );

  let list;
  const app = mount(
    () =>
      createComponent(VirtualizedList, {
        ...common,
        data: [{ id: "valid" }],
        ref(node) {
          list = node;
        },
      }),
    host,
    { surface: { name: "invalid-scroll" }, autoCommit: false },
  );
  await app.root.flush();
  assert.ok(list);
  assert.equal(list.nativeNode.componentName, "ScrollView");
  const scrollView = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "ScrollView",
    );
  assert.ok(scrollView);
  assert.throws(
    () =>
      host.injectEvent({
        surface: app.root.surfaceId,
        target: scrollView.node,
        name: "scroll",
        payload: { contentOffset: { y: "far" } },
        priority: "continuous",
        bubbles: true,
      }),
    /finite content offset/,
  );
  assert.throws(() => list.scrollToIndex(null), /options must be an object/);
  assert.throws(
    () => list.scrollToIndex({ index: -1 }),
    /non-negative safe integer/,
  );
  assert.throws(
    () => list.scrollToIndex({ index: 0, viewPosition: 2 }),
    /between 0 and 1/,
  );
  assert.throws(() => list.scrollToKey(null), /options must be an object/);
  assert.throws(
    () => list.scrollToKey({ key: "" }),
    /non-empty string of at most 256 characters/,
  );
  assert.throws(
    () => list.scrollToKey({ key: "valid", viewPosition: -1 }),
    /between 0 and 1/,
  );
  assert.throws(
    () => list.scrollToOffset({ offset: -1 }),
    /offset must be non-negative/,
  );
  assert.throws(
    () => list.scrollToEnd({ animated: "eventually" }),
    /animated must be a boolean/,
  );
  await assert.rejects(list.scrollToIndex({ index: 1 }), /outside 1 items/);
  await assert.rejects(
    list.scrollToKey({ key: "missing" }),
    /not present in the latest data/,
  );
  await app.dispose();

  for (const overrides of [
    { itemSize: 0 },
    { itemSize: undefined, estimatedItemSize: 0 },
    { viewportSize: Number.POSITIVE_INFINITY },
    { overscan: 1.5 },
    { onEndReachedThreshold: -1 },
    { onStartReachedThreshold: Number.NaN },
    { recycleRowViews: "sometimes" },
  ]) {
    assert.throws(
      () =>
        VirtualizedList({
          ...common,
          ...overrides,
          data: [{ id: "valid" }],
        }),
      /VirtualizedList/,
    );
  }
  assert.throws(
    () =>
      VirtualizedList({
        ...common,
        data: [{ id: "first" }, { id: "second" }],
        itemSize: Number.MAX_VALUE,
      }),
    /finite content extent/,
  );
  const exactLayoutCommon = {
    data: [{ id: "first" }, { id: "second" }],
    viewportSize: 60,
    keyExtractor: (item) => item.id,
    renderItem: () => createComponent(Text, { children: "row" }),
  };
  assert.throws(
    () => VirtualizedList(exactLayoutCommon),
    /requires itemSize, getItemLayout, or estimatedItemSize/,
  );
  assert.throws(
    () =>
      VirtualizedList({
        ...exactLayoutCommon,
        itemSize: 20,
        getItemLayout: (_data, index) => ({
          index,
          length: 20,
          offset: index * 20,
        }),
      }),
    /only one of itemSize, getItemLayout, or estimatedItemSize/,
  );
  assert.throws(
    () =>
      VirtualizedList({
        ...exactLayoutCommon,
        itemSize: 20,
        estimatedItemSize: 20,
      }),
    /only one of itemSize, getItemLayout, or estimatedItemSize/,
  );
  assert.throws(
    () =>
      VirtualizedList({
        ...exactLayoutCommon,
        getItemLayout: (_data, index) => ({
          index,
          length: 20,
          offset: index === 0 ? 0 : 10,
        }),
      }),
    /overlaps the preceding item/,
  );
  assert.throws(
    () =>
      VirtualizedList({
        ...exactLayoutCommon,
        getItemLayout: (_data, index) => ({
          index: index + 1,
          length: 20,
          offset: index * 20,
        }),
      }),
    /must report the requested index/,
  );
});

test("cancels queued VirtualizedList scrolling when its owner is disposed", async () => {
  const host = createRendererHost();
  const commit = host.commit.bind(host);
  let releaseWindow;
  host.commit = (transaction) => {
    const result = commit(transaction);
    if (transaction.sequence !== 2) return result;
    return new Promise((resolve) => {
      releaseWindow = () => resolve(result);
    });
  };
  let list;
  const app = mount(
    () =>
      createComponent(VirtualizedList, {
        data: Array.from({ length: 10 }, (_, index) => `row-${index}`),
        itemSize: 20,
        viewportSize: 40,
        overscan: 0,
        keyExtractor: (item) => item,
        ref(handle) {
          list = handle;
        },
        renderItem: ({ item }) => createComponent(Text, { children: item }),
      }),
    host,
    { surface: { name: "disposed-virtualized-list" }, autoCommit: false },
  );
  await app.root.flush();
  assert.ok(list);

  const first = list.scrollToIndex({ index: 5, animated: false });
  const second = list.scrollToEnd({ animated: false });
  for (
    let attempt = 0;
    releaseWindow === undefined && attempt < 10;
    attempt++
  ) {
    await Promise.resolve();
  }
  assert.ok(releaseWindow);
  const firstRejection = assert.rejects(first, /handle has been disposed/);
  const secondRejection = assert.rejects(second, /handle has been disposed/);
  const disposal = app.dispose();
  releaseWindow();
  await Promise.all([firstRejection, secondRejection, disposal]);
  assert.equal(
    host.commits.some((transaction) =>
      transaction.mutations.some((mutation) => mutation.type === "command"),
    ),
    false,
  );
});

test("validates a queued index scroll against the latest reactive data", async () => {
  const host = createRendererHost();
  const commit = host.commit.bind(host);
  let releaseFirstWindow;
  host.commit = (transaction) => {
    const result = commit(transaction);
    if (transaction.sequence !== 2) return result;
    return new Promise((resolve) => {
      releaseFirstWindow = () => resolve(result);
    });
  };
  const [items, setItems] = createSignal(
    Array.from({ length: 10 }, (_, index) => `row-${index}`),
  );
  let list;
  const app = mount(
    () =>
      createComponent(VirtualizedList, {
        get data() {
          return items();
        },
        itemSize: 20,
        viewportSize: 40,
        overscan: 0,
        keyExtractor: (item) => item,
        ref(handle) {
          list = handle;
        },
        renderItem: ({ item }) => createComponent(Text, { children: item }),
      }),
    host,
    { surface: { name: "reactive-index-scroll" }, autoCommit: false },
  );
  await app.root.flush();
  assert.ok(list);

  const first = list.scrollToIndex({ index: 5, animated: false });
  const queued = list.scrollToIndex({ index: 9, animated: false });
  for (
    let attempt = 0;
    releaseFirstWindow === undefined && attempt < 10;
    attempt++
  ) {
    await Promise.resolve();
  }
  assert.ok(releaseFirstWindow);
  setItems(["row-0"]);
  const queuedRejection = assert.rejects(queued, /outside 1 items/);
  releaseFirstWindow();
  await Promise.all([first, queuedRejection]);
  assert.equal(
    host.commits
      .flatMap((transaction) => transaction.mutations)
      .filter((mutation) => mutation.type === "command").length,
    1,
  );
  await app.dispose();
});

test("resolves a queued keyed scroll against the latest reactive order", async () => {
  const host = createRendererHost();
  const commit = host.commit.bind(host);
  let releaseFirstWindow;
  host.commit = (transaction) => {
    const result = commit(transaction);
    if (transaction.sequence !== 2) return result;
    return new Promise((resolve) => {
      releaseFirstWindow = () => resolve(result);
    });
  };
  const initialItems = Array.from({ length: 10 }, (_, index) => `row-${index}`);
  const [items, setItems] = createSignal(initialItems);
  let list;
  const app = mount(
    () =>
      createComponent(VirtualizedList, {
        get data() {
          return items();
        },
        itemSize: 20,
        viewportSize: 40,
        overscan: 0,
        keyExtractor: (item) => item,
        ref(handle) {
          list = handle;
        },
        renderItem: ({ item }) => createComponent(Text, { children: item }),
      }),
    host,
    { surface: { name: "reactive-key-scroll" }, autoCommit: false },
  );
  await app.root.flush();
  assert.ok(list);
  const scrollView = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "ScrollView",
    );
  assert.ok(scrollView);

  const first = list.scrollToIndex({ index: 5, animated: false });
  const queued = list.scrollToKey({ key: "row-9", animated: false });
  for (
    let attempt = 0;
    releaseFirstWindow === undefined && attempt < 10;
    attempt++
  ) {
    await Promise.resolve();
  }
  assert.ok(releaseFirstWindow);
  setItems(["row-0", "row-9", ...initialItems.slice(1, 9)]);
  releaseFirstWindow();
  await Promise.all([first, queued]);
  assert.deepEqual(
    host.commits
      .flatMap((transaction) => transaction.mutations)
      .filter((mutation) => mutation.type === "command"),
    [
      {
        type: "command",
        node: scrollView.node,
        command: "scrollTo",
        args: [0, 100, false],
      },
      {
        type: "command",
        node: scrollView.node,
        command: "scrollTo",
        args: [0, 20, false],
      },
    ],
  );
  await app.dispose();
});

test("uses horizontal offsets and fixed row extents for VirtualizedList", async () => {
  const host = createRendererHost();
  let list;
  const app = mount(
    () =>
      createComponent(VirtualizedList, {
        data: ["a", "b", "c", "d"],
        horizontal: true,
        itemSize: 25,
        viewportSize: 50,
        overscan: 0,
        keyExtractor: (item) => item,
        ref(handle) {
          list = handle;
        },
        renderItem({ item }) {
          return createComponent(Text, {
            get children() {
              return item();
            },
          });
        },
      }),
    host,
    { surface: { name: "horizontal-list" }, autoCommit: false },
  );
  await app.root.flush();
  let snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  const scrollView = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "ScrollView",
  );
  let content = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "ScrollContentView",
  );
  assert.ok(scrollView);
  assert.ok(content);
  assert.equal(scrollView.props.horizontal, true);
  assert.equal(scrollView.props.style.width, 50);
  assert.equal(scrollView.props.style.flexGrow, 0);
  assert.equal(scrollView.props.style.flexShrink, 0);
  assert.deepEqual(content.props.style, {
    flexDirection: "row",
    position: "relative",
    width: 100,
  });
  const byHandle = new Map(snapshot.nodes.map((node) => [node.node, node]));
  assert.deepEqual(
    content.children.map((handle) => byHandle.get(handle)?.props.style),
    [
      {
        bottom: 0,
        left: 0,
        position: "absolute",
        top: 0,
        width: 25,
      },
      {
        bottom: 0,
        left: 25,
        position: "absolute",
        top: 0,
        width: 25,
      },
    ],
  );

  host.injectEvent({
    surface: app.root.surfaceId,
    target: scrollView.node,
    name: "scroll",
    payload: { contentOffset: { x: 25, y: 0 } },
    priority: "continuous",
    bubbles: true,
  });
  await app.root.flush();
  snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  content = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "ScrollContentView",
  );
  assert.ok(content);
  const updatedByHandle = new Map(
    snapshot.nodes.map((node) => [node.node, node]),
  );
  const labels = content.children.map((handle) => {
    const wrapper = updatedByHandle.get(handle);
    const text = updatedByHandle.get(wrapper.children[0]);
    return updatedByHandle.get(text.children[0])?.text;
  });
  assert.deepEqual(labels, ["b", "c"]);

  assert.equal(list?.nativeNode.componentName, "ScrollView");
  await list.scrollToIndex({
    index: 3,
    viewPosition: 1,
    animated: false,
  });
  assert.deepEqual(host.commits.at(-1)?.mutations, [
    {
      type: "command",
      node: scrollView.node,
      command: "scrollTo",
      args: [50, 0, false],
    },
  ]);
  snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  content = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "ScrollContentView",
  );
  assert.ok(content);
  const movedByHandle = new Map(
    snapshot.nodes.map((node) => [node.node, node]),
  );
  assert.deepEqual(
    content.children.map((handle) => {
      const wrapper = movedByHandle.get(handle);
      const text = movedByHandle.get(wrapper.children[0]);
      return movedByHandle.get(text.children[0])?.text;
    }),
    ["c", "d"],
  );

  await app.dispose();
});

test("coalesces repeated signal writes into one native update", async () => {
  const host = createRendererHost();
  const [count, setCount] = createSignal(0);
  const app = mount(
    () =>
      createComponent(Text, {
        get children() {
          return `Count ${count()}`;
        },
      }),
    host,
    { surface: { name: "batching" }, autoCommit: false },
  );
  await app.root.flush();

  setCount(1);
  setCount(2);
  setCount(3);
  await app.root.flush();

  assert.equal(host.commits.length, 2);
  assert.equal(host.commits[1].priority, "normal");
  assert.deepEqual(host.commits[1].mutations, [
    {
      type: "update-text",
      node: 3,
      text: "Count 3",
    },
  ]);
  await app.dispose();
});

test("reveals a Solid 2 async boundary in one native transaction", async () => {
  const host = createRendererHost();
  const profile = deferred();
  const app = mount(
    () => {
      const name = createMemo(() => profile.promise);
      return createComponent(View, {
        get children() {
          return createComponent(Loading, {
            fallback: createComponent(Text, { children: "Loading profile" }),
            get children() {
              const resolvedName = name();
              return createComponent(Text, {
                children: `Hello ${resolvedName}`,
              });
            },
          });
        },
      });
    },
    host,
    { surface: { name: "solid-2-loading" }, autoCommit: false },
  );

  await app.root.flush();
  assert.deepEqual(
    host
      .getSurfaceSnapshot(app.root.surfaceId)
      .nodes.filter((node) => node.kind === "text")
      .map((node) => node.text),
    ["Loading profile"],
  );

  profile.resolve("Ada");
  await profile.promise;
  await new Promise((resolve) => setImmediate(resolve));
  await app.root.flush();

  assert.equal(host.commits.length, 2);
  assert.deepEqual(
    host
      .getSurfaceSnapshot(app.root.surfaceId)
      .nodes.filter((node) => node.kind === "text")
      .map((node) => node.text),
    ["Hello Ada"],
  );
  assert.ok(
    host.commits[1].mutations.some(
      (mutation) => mutation.type === "remove-child",
    ),
  );
  assert.ok(
    host.commits[1].mutations.some(
      (mutation) => mutation.type === "delete-node",
    ),
  );
  await app.dispose();
});

test("does not mount a late Solid 2 async result after disposal", async () => {
  const host = createRendererHost();
  const profile = deferred();
  const app = mount(
    () => {
      const name = createMemo(() => profile.promise);
      return createComponent(Loading, {
        fallback: createComponent(Text, { children: "Loading profile" }),
        get children() {
          return createComponent(Text, {
            get children() {
              return `Hello ${name()}`;
            },
          });
        },
      });
    },
    host,
    { surface: { name: "solid-2-disposal" }, autoCommit: false },
  );

  await app.root.flush();
  await app.dispose();
  const commitCountAfterDisposal = host.commits.length;

  profile.resolve("Too late");
  await profile.promise;
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(host.commits.length, commitCountAfterDisposal);
  assert.equal(app.root.disposed, true);
});

test("maps Solid 2 optimistic actions onto native commit priorities", async () => {
  const host = createRendererHost();
  const save = deferred();
  const records = [];
  let operationSequence = 0;
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `action-operation-${++operationSequence}`,
  });
  let saveAction;
  const app = mount(
    () => {
      const [name, setName] = createOptimistic("Ada");
      const rename = action(function* () {
        setName("Grace");
        yield save.promise;
      });
      return createComponent(Pressable, {
        onPress: () => {
          saveAction = rename();
          return saveAction;
        },
        get children() {
          return createComponent(Text, { children: name });
        },
      });
    },
    host,
    {
      surface: { name: "solid-2-action" },
      autoCommit: false,
      telemetry,
    },
  );

  await app.root.flush();
  const pressable = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "Pressable",
    );
  assert.ok(pressable);

  host.injectEvent({
    surface: app.root.surfaceId,
    target: pressable.node,
    name: "press",
    priority: "discrete",
    bubbles: true,
  });
  await app.root.flush();

  assert.ok(saveAction instanceof Promise);
  assert.equal(host.commits.length, 2);
  assert.equal(host.commits[1].priority, "user-blocking");
  assert.equal(
    host
      .getSurfaceSnapshot(app.root.surfaceId)
      .nodes.find((node) => node.kind === "text")?.text,
    "Grace",
  );

  save.resolve();
  await saveAction;
  await new Promise((resolve) => setImmediate(resolve));
  await app.root.flush();

  assert.equal(host.commits.length, 3);
  assert.equal(host.commits[2].priority, "normal");
  assert.equal(
    host
      .getSurfaceSnapshot(app.root.surfaceId)
      .nodes.find((node) => node.kind === "text")?.text,
    "Ada",
  );

  const eventStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event",
  );
  const optimisticCommitStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      record.attributes["commit.sequence"] === 2,
  );
  const reconciliationCommitStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      record.attributes["commit.sequence"] === 3,
  );
  assert.ok(eventStarted);
  assert.ok(optimisticCommitStarted);
  assert.ok(reconciliationCommitStarted);
  assert.deepEqual(optimisticCommitStarted.causes, [eventStarted.operationId]);
  assert.deepEqual(reconciliationCommitStarted.causes, [
    eventStarted.operationId,
  ]);
  await app.dispose();
});

test("links explicit owner-bound background work to its Solid commit", async () => {
  const host = createRendererHost();
  const records = [];
  let operationSequence = 0;
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `scope-operation-${++operationSequence}`,
  });
  let refreshScope;
  let abandonedScope;
  let failedScope;
  let setLabel;
  const app = mount(
    () => {
      const [label, writeLabel] = createSignal("Idle");
      setLabel = writeLabel;
      refreshScope = createCausalScope("profile.refresh");
      abandonedScope = createCausalScope("profile.prefetch");
      failedScope = createCausalScope("profile.cache-read");
      return createComponent(Text, { children: label });
    },
    host,
    {
      surface: { name: "causal-background-work" },
      autoCommit: false,
      telemetry,
    },
  );

  await app.root.flush();
  assert.equal(refreshScope.state, "active");
  assert.equal(Object.isFrozen(refreshScope), true);
  assert.equal(
    refreshScope.run(() => setLabel("Loaded")),
    "Loaded",
  );
  await app.root.flush();
  refreshScope.finish();
  failedScope.fail(new TypeError("private cache key"));

  assert.equal(refreshScope.state, "finished");
  assert.equal(failedScope.state, "failed");
  assert.equal(
    host
      .getSurfaceSnapshot(app.root.surfaceId)
      .nodes.find((node) => node.kind === "text")?.text,
    "Loaded",
  );
  assert.throws(() => refreshScope.run(() => undefined), /no longer active/u);

  const surfaceStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.surface",
  );
  const refreshStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.task" &&
      record.attributes["task.name"] === "profile.refresh",
  );
  const refreshFinished = records.find(
    (record) =>
      record.type === "operation-finished" &&
      record.operationId === refreshStarted?.operationId,
  );
  const updateCommit = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      record.attributes["commit.sequence"] === 2,
  );
  const failedFinished = records.find(
    (record) =>
      record.type === "operation-finished" &&
      record.name === "solid-native.task" &&
      record.status === "error",
  );
  assert.ok(surfaceStarted);
  assert.ok(refreshStarted);
  assert.deepEqual(refreshStarted.causes, [surfaceStarted.operationId]);
  assert.deepEqual(updateCommit?.causes, [refreshStarted.operationId]);
  assert.equal(refreshFinished?.status, "ok");
  assert.deepEqual(failedFinished?.attributes, { "error.type": "TypeError" });
  assert.equal(
    JSON.stringify(failedFinished).includes("private cache key"),
    false,
  );

  await app.dispose();
  assert.equal(abandonedScope.state, "cancelled");
  const cancelledFinish = records.find(
    (record) =>
      record.type === "operation-finished" &&
      record.name === "solid-native.task" &&
      record.status === "cancelled",
  );
  assert.ok(cancelledFinish);
});

test("links selected Solid owner subtrees to only their native commits", async () => {
  const host = createRendererHost();
  const records = [];
  let operationSequence = 0;
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `owner-operation-${++operationSequence}`,
  });
  let setInside;
  let setOutside;
  const app = mount(
    () => {
      const [inside, writeInside] = createSignal("Inside 0");
      const [outside, writeOutside] = createSignal("Outside 0");
      setInside = writeInside;
      setOutside = writeOutside;
      return createComponent(View, {
        get children() {
          return [
            createComponent(CausalOwner, {
              name: "profile.screen",
              get children() {
                return [
                  createComponent(Pressable, {
                    onPress: () => setInside("Inside 2"),
                    children: createComponent(Text, {
                      children: "Update inside owner",
                    }),
                  }),
                  createComponent(Text, { children: inside }),
                ];
              },
            }),
            createComponent(Text, { children: outside }),
          ];
        },
      });
    },
    host,
    {
      surface: { name: "causal-solid-owner" },
      autoCommit: false,
      telemetry,
    },
  );

  await app.root.flush();
  setInside("Inside 1");
  await app.root.flush();
  setOutside("Outside 1");
  await app.root.flush();

  const pressable = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "Pressable",
    );
  assert.ok(pressable);
  host.injectEvent({
    surface: app.root.surfaceId,
    target: pressable.node,
    name: "press",
    payload: {},
    priority: "discrete",
    bubbles: true,
  });
  await app.root.flush();

  const surfaceStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.surface",
  );
  const ownerStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.owner",
  );
  const insideCommit = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      record.attributes["commit.sequence"] === 2,
  );
  const outsideCommit = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      record.attributes["commit.sequence"] === 3,
  );
  const eventStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event",
  );
  const eventCommit = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      record.attributes["commit.sequence"] === 4,
  );
  assert.ok(surfaceStarted);
  assert.ok(ownerStarted);
  assert.equal(ownerStarted.attributes["owner.name"], "profile.screen");
  assert.deepEqual(ownerStarted.causes, [surfaceStarted.operationId]);
  assert.deepEqual(insideCommit?.causes, [ownerStarted.operationId]);
  assert.deepEqual(outsideCommit?.causes, []);
  assert.ok(eventStarted);
  assert.deepEqual(eventCommit?.causes, [
    ownerStarted.operationId,
    eventStarted.operationId,
  ]);

  await app.dispose();
  const ownerFinished = records.find(
    (record) =>
      record.type === "operation-finished" &&
      record.operationId === ownerStarted.operationId,
  );
  assert.equal(ownerFinished?.status, "ok");
  assert.equal(JSON.stringify(ownerStarted).includes("Inside"), false);
});

test("preserves nested Solid owner ancestry without duplicating commit causes", async () => {
  const host = createRendererHost();
  const records = [];
  let operationSequence = 0;
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `nested-owner-${++operationSequence}`,
  });
  let setLabel;
  const app = mount(
    () => {
      const [label, writeLabel] = createSignal("Nested 0");
      setLabel = writeLabel;
      return createComponent(CausalOwner, {
        name: "profile.screen",
        get children() {
          return createComponent(CausalOwner, {
            name: "profile.avatar",
            get children() {
              return createComponent(Text, { children: label });
            },
          });
        },
      });
    },
    host,
    {
      surface: { name: "nested-causal-solid-owner" },
      autoCommit: false,
      telemetry,
    },
  );

  await app.root.flush();
  setLabel("Nested 1");
  await app.root.flush();

  const surface = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.surface",
  );
  const outer = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.owner" &&
      record.attributes["owner.name"] === "profile.screen",
  );
  const inner = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.owner" &&
      record.attributes["owner.name"] === "profile.avatar",
  );
  const updateCommit = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      record.attributes["commit.sequence"] === 2,
  );
  assert.ok(surface);
  assert.ok(outer);
  assert.ok(inner);
  assert.deepEqual(outer.causes, [surface.operationId]);
  assert.deepEqual(inner.causes, [outer.operationId]);
  assert.deepEqual(updateCommit?.causes, [inner.operationId]);
  await app.dispose();
});

test("links selected Solid computations without recording reactive values", async () => {
  const host = createRendererHost();
  const records = [];
  let operationSequence = 0;
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `computation-${++operationSequence}`,
  });
  const [label, setLabel] = createSignal("Private value 0");
  const [outside, setOutside] = createSignal("Outside 0");
  const app = mount(
    () =>
      createComponent(CausalOwner, {
        name: "profile.screen",
        get children() {
          return [
            createComponent(CausalComputation, {
              name: "profile.status",
              get children() {
                return createComponent(View, {
                  get children() {
                    return [
                      createComponent(Pressable, {
                        onPress: () => setLabel("Private value 2"),
                        children: createComponent(Text, {
                          children: "Run computation",
                        }),
                      }),
                      createComponent(Text, { children: label }),
                    ];
                  },
                });
              },
            }),
            createComponent(Text, { children: outside }),
          ];
        },
      }),
    host,
    {
      surface: { name: "causal-solid-computation" },
      autoCommit: false,
      telemetry,
    },
  );

  await app.root.flush();
  setLabel("Private value 1");
  await app.root.flush();
  setOutside("Outside 1");
  await app.root.flush();
  const pressable = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "Pressable",
    );
  assert.ok(pressable);
  host.injectEvent({
    surface: app.root.surfaceId,
    target: pressable.node,
    name: "press",
    payload: {},
    priority: "discrete",
    bubbles: true,
  });
  await app.root.flush();

  const owner = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.owner" &&
      record.attributes["owner.name"] === "profile.screen",
  );
  const computations = records.filter(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.computation" &&
      record.attributes["computation.name"] === "profile.status",
  );
  const directCommit = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      record.attributes["commit.sequence"] === 2,
  );
  const event = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event",
  );
  const outsideCommit = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      record.attributes["commit.sequence"] === 3,
  );
  const eventCommit = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      record.attributes["commit.sequence"] === 4,
  );
  assert.ok(owner);
  assert.equal(computations.length, 3);
  const directComputation = computations[1];
  const eventComputation = computations[2];
  assert.ok(directComputation);
  assert.ok(eventComputation);
  assert.deepEqual(directComputation.causes, [owner.operationId]);
  assert.deepEqual(eventComputation.causes, [owner.operationId]);
  assert.deepEqual(directCommit?.causes, [
    directComputation.operationId,
    owner.operationId,
  ]);
  assert.deepEqual(outsideCommit?.causes, [owner.operationId]);
  assert.ok(event);
  assert.deepEqual(eventCommit?.causes, [
    eventComputation.operationId,
    owner.operationId,
    event.operationId,
  ]);
  assert.equal(JSON.stringify(computations).includes("Private value"), false);
  assert.equal(
    records.filter(
      (record) =>
        record.type === "operation-finished" &&
        record.name === "solid-native.computation" &&
        record.status === "ok",
    ).length,
    3,
  );
  await app.dispose();
});

test("preserves nested Solid computation ancestry", async () => {
  const host = createRendererHost();
  const records = [];
  let operationSequence = 0;
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `nested-computation-${++operationSequence}`,
  });
  const [label, setLabel] = createSignal("Nested output 0");
  const app = mount(
    () =>
      createComponent(CausalComputation, {
        name: "profile.output",
        get children() {
          return createComponent(CausalComputation, {
            name: "profile.status.output",
            get children() {
              return createComponent(Text, { children: label });
            },
          });
        },
      }),
    host,
    {
      surface: { name: "nested-causal-solid-computation" },
      autoCommit: false,
      telemetry,
    },
  );

  await app.root.flush();
  setLabel("Nested output 1");
  await app.root.flush();

  const surface = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.surface",
  );
  const outerComputations = records.filter(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.computation" &&
      record.attributes["computation.name"] === "profile.output",
  );
  const innerComputations = records.filter(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.computation" &&
      record.attributes["computation.name"] === "profile.status.output",
  );
  const updateCommit = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      record.attributes["commit.sequence"] === 2,
  );
  assert.ok(surface);
  const outer = outerComputations[1];
  const inner = innerComputations[1];
  assert.ok(outer);
  assert.ok(inner);
  assert.deepEqual(outer.causes, [surface.operationId]);
  assert.deepEqual(inner.causes, [outer.operationId]);
  assert.deepEqual(updateCommit?.causes, [
    inner.operationId,
    outer.operationId,
  ]);
  await app.dispose();
});

test("removes conditional native output after its causal computation closes", async () => {
  const host = createRendererHost();
  const records = [];
  let operationSequence = 0;
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `conditional-computation-${++operationSequence}`,
  });
  const [visible, setVisible] = createSignal(true);
  const app = mount(
    () =>
      createComponent(CausalOwner, {
        name: "profile.screen",
        get children() {
          return createComponent(View, {
            get children() {
              return visible()
                ? createComponent(CausalComputation, {
                    name: "profile.editor.output",
                    children: [
                      createComponent(Text, { children: "Private editor" }),
                      createComponent(Text, { children: "Private mirror" }),
                    ],
                  })
                : createComponent(Text, { children: "Editor removed" });
            },
          });
        },
      }),
    host,
    {
      surface: { name: "conditional-causal-computation" },
      autoCommit: false,
      telemetry,
    },
  );

  await app.root.flush();
  setVisible(false);
  await app.root.flush();

  const snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  assert.equal(
    snapshot.nodes.some(
      (node) =>
        node.kind === "text" &&
        (node.text === "Private editor" || node.text === "Private mirror"),
    ),
    false,
  );
  assert.equal(
    snapshot.nodes.some(
      (node) => node.kind === "text" && node.text === "Editor removed",
    ),
    true,
  );
  const removalCommit = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      record.attributes["commit.sequence"] === 2,
  );
  const owner = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.owner" &&
      record.attributes["owner.name"] === "profile.screen",
  );
  assert.ok(removalCommit);
  assert.ok(owner);
  assert.deepEqual(removalCommit.causes, [owner.operationId]);
  assert.equal(
    records.some(
      (record) =>
        record.type === "operation-finished" &&
        record.name === "solid-native.computation" &&
        record.status === "error",
    ),
    false,
  );
  await app.dispose();
});

test("validates explicit causal scope names", async () => {
  const host = createRendererHost();
  let error;
  const app = mount(
    () => {
      try {
        createCausalScope("customer email");
      } catch (caught) {
        error = caught;
      }
      return createComponent(Text, { children: "Safe" });
    },
    host,
    { surface: { name: "invalid-causal-scope" }, autoCommit: false },
  );
  assert.match(String(error), /1-128 character identifiers/u);
  await app.dispose();
});

test("validates causal Solid owner names", async () => {
  const host = createRendererHost();
  let error;
  const app = mount(
    () => {
      try {
        return createComponent(CausalOwner, {
          name: "customer email",
          children: createComponent(Text, { children: "Unsafe" }),
        });
      } catch (caught) {
        error = caught;
        return createComponent(Text, { children: "Safe" });
      }
    },
    host,
    { surface: { name: "invalid-causal-owner" }, autoCommit: false },
  );
  assert.match(String(error), /1-128 character identifiers/u);
  await app.dispose();
});

test("validates causal Solid computation names", async () => {
  const host = createRendererHost();
  let error;
  const app = mount(
    () => {
      try {
        return createComponent(CausalComputation, {
          name: "customer email",
          children: createComponent(Text, { children: "Unsafe" }),
        });
      } catch (caught) {
        error = caught;
        return createComponent(Text, { children: "Safe" });
      }
    },
    host,
    { surface: { name: "invalid-causal-computation" }, autoCommit: false },
  );
  assert.match(String(error), /1-128 character identifiers/u);
  await app.dispose();
});

test("routes bubbling events and gives discrete updates user-blocking priority", async () => {
  const host = createRendererHost();
  const calls = [];
  const [label, setLabel] = createSignal("Ready");
  const app = mount(
    () =>
      createComponent(Pressable, {
        onPressCapture: (event) => calls.push(`capture:${event.name}`),
        onPress: (event) => calls.push(`bubble:${event.name}`),
        get children() {
          return createComponent(Pressable, {
            onPress: (event) => {
              calls.push(`target:${event.name}`);
              setLabel("Pressed");
            },
            get children() {
              return createComponent(Text, {
                get children() {
                  return label();
                },
              });
            },
          });
        },
      }),
    host,
    { surface: { name: "events" }, autoCommit: false },
  );
  await app.root.flush();

  const snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  const pressable = snapshot.nodes.findLast(
    (node) => node.kind === "element" && node.component === "Pressable",
  );
  assert.ok(pressable);
  assert.deepEqual(pressable.eventListeners, [
    "layout",
    "press",
    "pressCancel",
    "pressIn",
    "pressMove",
    "pressOut",
  ]);
  assert.deepEqual(
    host.commits[0].mutations
      .filter((mutation) => mutation.type === "update-event-listeners")
      .toSorted((left, right) => left.node - right.node),
    [
      {
        type: "update-event-listeners",
        node: 2,
        events: [
          "layout",
          "press",
          "pressCancel",
          "pressIn",
          "pressMove",
          "pressOut",
        ],
      },
      {
        type: "update-event-listeners",
        node: 3,
        events: [
          "layout",
          "press",
          "pressCancel",
          "pressIn",
          "pressMove",
          "pressOut",
        ],
      },
    ],
  );
  host.injectEvent({
    surface: app.root.surfaceId,
    target: pressable.node,
    name: "press",
    payload: { pointerType: "touch" },
    priority: "discrete",
    bubbles: true,
  });
  await app.root.flush();

  assert.deepEqual(calls, ["capture:press", "target:press", "bubble:press"]);
  assert.equal(host.commits.at(-1).priority, "user-blocking");
  const updatedText = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find((node) => node.kind === "text");
  assert.equal(updatedText.text, "Pressed");
  await app.dispose();
});

test("dispatches native events outside Solid 2 owned scopes", async () => {
  const host = createRendererHost();
  const app = mount(
    () => {
      const [label, setLabel] = createSignal("Ready");
      return createComponent(Pressable, {
        onPress: () => setLabel("Pressed"),
        get children() {
          return createComponent(Text, { children: label });
        },
      });
    },
    host,
    { surface: { name: "solid-2-unowned-event" }, autoCommit: false },
  );
  await app.root.flush();

  const pressable = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "Pressable",
    );
  assert.ok(pressable);
  host.injectEvent({
    surface: app.root.surfaceId,
    target: pressable.node,
    name: "press",
    priority: "discrete",
    bubbles: true,
  });
  await app.root.flush();

  const updatedText = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find((node) => node.kind === "text");
  assert.equal(updatedText.text, "Pressed");
  await app.dispose();
});

test("links batched native events to the commit their Solid updates cause", async () => {
  const host = createRendererHost();
  const records = [];
  let operationSequence = 0;
  let now = 100;
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    clock: () => ++now,
    createOperationId: () => `operation-${++operationSequence}`,
  });
  const [label, setLabel] = createSignal("Ready");
  const app = mount(
    () =>
      createComponent(Pressable, {
        onPress: () =>
          setLabel(label() === "Ready" ? "Pressed once" : "Pressed twice"),
        get children() {
          return createComponent(Text, { children: label });
        },
      }),
    host,
    {
      surface: { name: "causal-observability" },
      autoCommit: false,
      telemetry,
    },
  );
  await app.root.flush();

  const pressable = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "Pressable",
    );
  assert.ok(pressable);
  const interactionStart = records.length;
  host.injectEvent({
    surface: app.root.surfaceId,
    target: pressable.node,
    name: "press",
    payload: { privateToken: "must-not-be-recorded-1" },
    priority: "discrete",
    bubbles: true,
  });
  host.injectEvent({
    surface: app.root.surfaceId,
    target: pressable.node,
    name: "press",
    payload: { privateToken: "must-not-be-recorded-2" },
    priority: "discrete",
    bubbles: true,
  });
  await app.root.flush();

  const interaction = records.slice(interactionStart);
  const eventsStarted = interaction.filter(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event",
  );
  const eventsFinished = interaction.filter(
    (record) =>
      record.type === "operation-finished" &&
      record.name === "solid-native.event",
  );
  const commitStarted = interaction.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit",
  );
  const commitFinished = interaction.find(
    (record) =>
      record.type === "operation-finished" &&
      record.name === "solid-native.commit",
  );
  const mountStarted = interaction.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.mount",
  );
  const mountFinished = interaction.find(
    (record) =>
      record.type === "operation-finished" &&
      record.name === "solid-native.mount",
  );
  const frameStarted = interaction.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.frame",
  );
  const frameFinished = interaction.find(
    (record) =>
      record.type === "operation-finished" &&
      record.name === "solid-native.frame",
  );
  assert.equal(eventsStarted.length, 2);
  assert.equal(eventsFinished.length, 2);
  assert.ok(commitStarted);
  assert.ok(commitFinished);
  assert.ok(mountStarted);
  assert.ok(mountFinished);
  assert.ok(frameStarted);
  assert.ok(frameFinished);
  assert.deepEqual(
    commitStarted.causes,
    eventsStarted.map((record) => record.operationId),
  );
  assert.equal(commitStarted.attributes["commit.priority"], "user-blocking");
  assert.equal(commitStarted.attributes["commit.mutation.update-text"], 1);
  assert.deepEqual(mountStarted.causes, [commitStarted.operationId]);
  assert.equal(mountStarted.attributes["mount.host_revision"], 2);
  assert.equal(mountFinished.duration, 0);
  assert.deepEqual(frameStarted.causes, [mountStarted.operationId]);
  assert.equal(frameStarted.attributes["frame.host_revision"], 2);
  assert.equal(
    frameStarted.attributes["frame.observation"],
    "next-vsync-after-mount",
  );
  assert.equal(frameFinished.duration, 0);
  assert.ok(
    eventsFinished.every(
      (record) =>
        record.attributes["event.handler_count"] === 1 &&
        record.status === "ok",
    ),
  );
  assert.equal(commitFinished.status, "ok");
  assert.equal(
    host.commits[1].causalContext.operationId,
    commitStarted.operationId,
  );
  assert.equal(
    JSON.stringify(interaction).includes("must-not-be-recorded-"),
    false,
  );

  await app.dispose();
  const surfaceStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.surface",
  );
  const surfaceFinished = records.find(
    (record) =>
      record.type === "operation-finished" &&
      record.name === "solid-native.surface",
  );
  assert.ok(surfaceStarted);
  assert.ok(surfaceFinished);
  assert.equal(surfaceFinished.operationId, surfaceStarted.operationId);
  assert.equal(surfaceFinished.status, "ok");
});

test("isolates renderer execution from telemetry failures", async () => {
  const host = createRendererHost();
  const telemetryErrors = [];
  let diagnosticRejections = 0;
  const app = mount(
    () => createComponent(Text, { children: "Still renders" }),
    host,
    {
      surface: { name: "telemetry-failure" },
      autoCommit: false,
      telemetry: {
        startOperation() {
          throw new Error("exporter unavailable");
        },
        finishOperation() {
          throw new Error("exporter unavailable");
        },
      },
      onTelemetryError(error) {
        telemetryErrors.push(error);
        if (telemetryErrors.length === 1) {
          throw new Error("synchronous telemetry diagnostic failed");
        }
        return {
          then(_resolve, reject) {
            diagnosticRejections++;
            reject(new Error("asynchronous telemetry diagnostic failed"));
          },
        };
      },
    },
  );

  await app.root.flush();
  assert.equal(
    host.getSurfaceSnapshot(app.root.surfaceId).nodes.at(-1).text,
    "Still renders",
  );
  await app.dispose();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(telemetryErrors.length >= 3);
  assert.equal(diagnosticRejections, telemetryErrors.length - 1);
  assert.ok(
    telemetryErrors.every(
      (error) =>
        error instanceof Error && error.message === "exporter unavailable",
    ),
  );
});

test("preserves a host commit failure when its diagnostic reporter fails", async () => {
  const commitFailure = new Error("host commit failed");
  const diagnosticFailure = new Error("commit diagnostic failed");
  let diagnosticRejections = 0;

  class FailingCommitHost extends InMemoryHost {
    constructor() {
      super({ descriptors: CORE_COMPONENT_DESCRIPTORS, platform: "android" });
    }

    commit() {
      throw commitFailure;
    }
  }

  for (const mode of ["synchronous", "asynchronous"]) {
    const reported = [];
    const app = mount(
      () => createComponent(Text, { children: "Never mounted" }),
      new FailingCommitHost(),
      {
        surface: { name: `commit-diagnostic-${mode}` },
        autoCommit: false,
        onCommitError(error) {
          reported.push(error);
          if (mode === "synchronous") throw diagnosticFailure;
          return {
            then(_resolve, reject) {
              diagnosticRejections++;
              reject(diagnosticFailure);
            },
          };
        },
      },
    );

    await assert.rejects(app.root.flush(), (error) => error === commitFailure);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(reported, [commitFailure]);
    await assert.rejects(app.dispose(), (error) => error === commitFailure);
  }

  assert.equal(diagnosticRejections, 1);
});

test("does not let invalid telemetry IDs break host commits", async () => {
  const host = createRendererHost();
  const telemetryErrors = [];
  const app = mount(
    () => createComponent(Text, { children: "Still causal" }),
    host,
    {
      surface: { name: "invalid-telemetry-id" },
      autoCommit: false,
      telemetry: {
        startOperation() {
          return { id: "x".repeat(129) };
        },
        finishOperation() {},
      },
      onTelemetryError: (error) => telemetryErrors.push(error),
    },
  );

  await app.root.flush();
  assert.equal(host.commits[0].causalContext, undefined);
  assert.equal(telemetryErrors.length, 1);
  assert.match(telemetryErrors[0].message, /operation IDs crossing the host/);
  await app.dispose();
});

test("normalizes property removals and validates transport values", async () => {
  const host = createRendererHost();
  const [testID, setTestID] = createSignal("present");
  const app = mount(
    () =>
      createComponent(View, {
        get testID() {
          return testID();
        },
      }),
    host,
    { surface: { name: "props" }, autoCommit: false },
  );
  await app.root.flush();
  setTestID(undefined);
  await app.root.flush();

  assert.deepEqual(host.commits[1].mutations, [
    {
      type: "update-props",
      node: 2,
      props: {},
      removedProps: ["testID"],
    },
  ]);
  assert.throws(
    () => app.root.createElement("View", { invalid: () => undefined }, null),
    /not a transport-safe host value/,
  );
  const circularStyle = [];
  circularStyle.push(circularStyle);
  assert.throws(
    () => app.root.createElement("View", { style: circularStyle }, null),
    /style arrays must not be circular/u,
  );
  await app.dispose();
});

test("reconciles structural moves without recreating nodes", async () => {
  const host = createRendererHost();
  const [reversed, setReversed] = createSignal(false);
  const app = mount(
    () => {
      const parent = createElement("View");
      const first = createComponent(Text, { children: "First" });
      const second = createComponent(Text, { children: "Second" });
      insert(parent, () => (reversed() ? [second, first] : [first, second]));
      return parent;
    },
    host,
    { surface: { name: "reconciliation" }, autoCommit: false },
  );
  await app.root.flush();
  const before = host.getSurfaceSnapshot(app.root.surfaceId);
  const viewBefore = before.nodes.find(
    (node) => node.kind === "element" && node.component === "View",
  );
  assert.ok(viewBefore);
  const originalChildren = [...viewBefore.children];

  setReversed(true);
  await app.root.flush();
  const after = host.getSurfaceSnapshot(app.root.surfaceId);
  const viewAfter = after.nodes.find(
    (node) => node.kind === "element" && node.component === "View",
  );
  assert.ok(viewAfter);
  assert.deepEqual(viewAfter.children, originalChildren.toReversed());
  assert.equal(
    host.commits[1].mutations.filter(
      (mutation) => mutation.type === "create-element",
    ).length,
    0,
  );
  await app.dispose();
});

test("exposes controlled measurement and command methods through refs", async () => {
  const host = createRendererHost();
  const records = [];
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
  });
  let pressableRef;
  const app = mount(
    () =>
      createComponent(Pressable, {
        ref: (node) => {
          pressableRef = node;
        },
        children: createComponent(Text, { children: "Focusable" }),
      }),
    host,
    { surface: { name: "refs" }, autoCommit: false, telemetry },
  );
  await app.root.flush();
  assert.ok(pressableRef);
  assert.equal("handle" in pressableRef, false);

  const snapshot = host.getSurfaceSnapshot(app.root.surfaceId);
  const pressable = snapshot.nodes.find(
    (node) => node.kind === "element" && node.component === "Pressable",
  );
  assert.ok(pressable);
  host.setMeasurement(app.root.surfaceId, pressable.node, {
    x: 10,
    y: 20,
    width: 120,
    height: 40,
    pageX: 10,
    pageY: 20,
  });

  assert.equal((await pressableRef.measure()).width, 120);
  await pressableRef.focus();
  assert.deepEqual(host.commits.at(-1).mutations, [
    { type: "command", node: pressable.node, command: "focus", args: [] },
  ]);
  await pressableRef.focusAccessibility();
  assert.deepEqual(host.commits.at(-1).mutations, [
    {
      type: "command",
      node: pressable.node,
      command: "accessibilityFocus",
      args: [],
    },
  ]);
  const measureFinished = records.find(
    (record) =>
      record.type === "operation-finished" &&
      record.name === "solid-native.measure",
  );
  const commandStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.command",
  );
  const commandCommit = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      record.attributes["commit.sequence"] === 2,
  );
  assert.ok(measureFinished);
  assert.equal(measureFinished.attributes["measurement.observed_sequence"], 1);
  assert.ok(commandStarted);
  assert.ok(commandCommit);
  assert.deepEqual(commandCommit.causes, [commandStarted.operationId]);
  await app.dispose();
});

test("retains discrete input and named output across async native measurement", async () => {
  const host = createRendererHost();
  const records = [];
  let operationSequence = 0;
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `event-measure-${++operationSequence}`,
  });
  let pressableRef;
  let pendingMeasurement;
  const app = mount(
    () =>
      createComponent(CausalOwner, {
        name: "event-measure.screen",
        get children() {
          return createComponent(CausalComputation, {
            name: "event-measure.geometry.output",
            get children() {
              return createComponent(Pressable, {
                ref(node) {
                  pressableRef = node;
                },
                onPress() {
                  pendingMeasurement = pressableRef.measure();
                  return pendingMeasurement;
                },
                children: createComponent(Text, { children: "Measure" }),
              });
            },
          });
        },
      }),
    host,
    {
      surface: { name: "event-measure" },
      autoCommit: false,
      telemetry,
    },
  );

  await app.root.flush();
  assert.ok(pressableRef);
  const pressable = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "Pressable",
    );
  assert.ok(pressable);
  host.setMeasurement(app.root.surfaceId, pressable.node, {
    x: 4,
    y: 8,
    width: 80,
    height: 32,
    pageX: 4,
    pageY: 8,
  });
  const operationStart = records.length;
  host.injectEvent({
    surface: app.root.surfaceId,
    target: pressable.node,
    name: "press",
    payload: { privateGeometryToken: "not-telemetry" },
    priority: "discrete",
    bubbles: true,
  });
  assert.ok(pendingMeasurement);
  assert.equal((await pendingMeasurement).width, 80);

  const interaction = records.slice(operationStart);
  const owner = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.owner" &&
      record.attributes["owner.name"] === "event-measure.screen",
  );
  const event = interaction.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      record.attributes["event.name"] === "press",
  );
  const computation = interaction.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.computation" &&
      record.attributes["computation.name"] === "event-measure.geometry.output",
  );
  const measurement = interaction.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.measure",
  );
  assert.ok(owner);
  assert.ok(event);
  assert.ok(computation);
  assert.ok(measurement);
  assert.deepEqual(computation.causes, [owner.operationId]);
  assert.deepEqual(measurement.causes, [
    event.operationId,
    computation.operationId,
  ]);
  assert.equal("event.payload" in event.attributes, false);
  for (const operation of [event, computation, measurement]) {
    assert.equal(
      interaction.some(
        (record) =>
          record.type === "operation-finished" &&
          record.operationId === operation.operationId &&
          record.status === "ok",
      ),
      true,
    );
  }
  await app.dispose();
});

test("retains named Solid output as the cause of an isolated native command", async () => {
  const host = createRendererHost();
  const records = [];
  let operationSequence = 0;
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `causal-command-${++operationSequence}`,
  });
  let pressableRef;
  const app = mount(
    () =>
      createComponent(CausalOwner, {
        name: "profile.screen",
        get children() {
          return createComponent(CausalComputation, {
            name: "profile.focus.output",
            get children() {
              return createComponent(Pressable, {
                ref(node) {
                  pressableRef = node;
                },
                children: createComponent(Text, { children: "Focus" }),
              });
            },
          });
        },
      }),
    host,
    {
      surface: { name: "causal-command" },
      autoCommit: false,
      telemetry,
    },
  );

  await app.root.flush();
  assert.ok(pressableRef);
  const operationStart = records.length;
  await pressableRef.focus();
  const commandRecords = records.slice(operationStart);
  const owner = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.owner" &&
      record.attributes["owner.name"] === "profile.screen",
  );
  const computation = commandRecords.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.computation" &&
      record.attributes["computation.name"] === "profile.focus.output",
  );
  const command = commandRecords.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.command" &&
      record.attributes["command.name"] === "focus",
  );
  const commandCommit = commandRecords.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      record.attributes["commit.sequence"] === 2,
  );
  assert.ok(owner);
  assert.ok(computation);
  assert.ok(command);
  assert.ok(commandCommit);
  assert.deepEqual(computation.causes, [owner.operationId]);
  assert.deepEqual(command.causes, [computation.operationId]);
  assert.deepEqual(commandCommit.causes, [command.operationId]);
  assert.equal("command.args" in command.attributes, false);
  for (const operation of [computation, command, commandCommit]) {
    assert.equal(
      commandRecords.some(
        (record) =>
          record.type === "operation-finished" &&
          record.operationId === operation.operationId &&
          record.status === "ok",
      ),
      true,
    );
  }
  await app.dispose();
});

test("retains discrete input, named output, and priority across async command dispatch", async () => {
  const host = createRendererHost();
  const records = [];
  let operationSequence = 0;
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    createOperationId: () => `event-command-${++operationSequence}`,
  });
  let pressableRef;
  const app = mount(
    () =>
      createComponent(CausalOwner, {
        name: "event-command.screen",
        get children() {
          return createComponent(CausalComputation, {
            name: "event-command.focus.output",
            get children() {
              return createComponent(Pressable, {
                ref(node) {
                  pressableRef = node;
                },
                onPress(event) {
                  assert.equal(event.priority, "discrete");
                  return pressableRef.focus();
                },
                children: createComponent(Text, {
                  children: "Focus from input",
                }),
              });
            },
          });
        },
      }),
    host,
    {
      surface: { name: "event-command" },
      autoCommit: false,
      telemetry,
    },
  );

  await app.root.flush();
  assert.ok(pressableRef);
  const pressable = host
    .getSurfaceSnapshot(app.root.surfaceId)
    .nodes.find(
      (node) => node.kind === "element" && node.component === "Pressable",
    );
  assert.ok(pressable);
  const operationStart = records.length;
  host.injectEvent({
    surface: app.root.surfaceId,
    target: pressable.node,
    name: "press",
    payload: {},
    priority: "discrete",
    bubbles: true,
  });
  await app.root.flush();

  const commandRecords = records.slice(operationStart);
  const owner = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.owner" &&
      record.attributes["owner.name"] === "event-command.screen",
  );
  const event = commandRecords.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      record.attributes["event.name"] === "press",
  );
  const computation = commandRecords.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.computation" &&
      record.attributes["computation.name"] === "event-command.focus.output",
  );
  const command = commandRecords.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.command" &&
      record.attributes["command.name"] === "focus",
  );
  const commandCommit = commandRecords.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      record.attributes["commit.sequence"] === 2,
  );
  assert.ok(owner);
  assert.ok(event);
  assert.ok(computation);
  assert.ok(command);
  assert.ok(commandCommit);
  assert.deepEqual(computation.causes, [owner.operationId]);
  assert.deepEqual(command.causes, [
    event.operationId,
    computation.operationId,
  ]);
  assert.deepEqual(commandCommit.causes, [command.operationId]);
  assert.equal(commandCommit.attributes["commit.priority"], "user-blocking");
  assert.equal(commandCommit.attributes["commit.mutation_count"], 1);
  assert.equal(commandCommit.attributes["commit.mutation.command"], 1);
  for (const operation of [event, computation, command, commandCommit]) {
    assert.equal(
      commandRecords.some(
        (record) =>
          record.type === "operation-finished" &&
          record.operationId === operation.operationId &&
          record.status === "ok",
      ),
      true,
    );
  }
  await app.dispose();
});

test("isolates native commands from pending structural work", async () => {
  const host = createRendererHost();
  const [label, setLabel] = createSignal("Before");
  let pressableRef;
  const app = mount(
    () =>
      createComponent(Pressable, {
        ref: (node) => {
          pressableRef = node;
        },
        children: createComponent(Text, { children: label }),
      }),
    host,
    { surface: { name: "command-ordering" }, autoCommit: false },
  );
  await app.root.flush();
  assert.ok(pressableRef);

  setLabel("After");
  await pressableRef.focus();

  assert.deepEqual(
    host.commits.at(-2).mutations.map((mutation) => mutation.type),
    ["update-text"],
  );
  assert.deepEqual(
    host.commits.at(-1).mutations.map((mutation) => mutation.type),
    ["command"],
  );
  await app.dispose();
});

test("isolates native commands from events racing an asynchronous commit", async () => {
  const host = createRendererHost();
  const commit = host.commit.bind(host);
  let releaseUpdate;
  host.commit = (transaction) => {
    const result = commit(transaction);
    if (transaction.sequence !== 2) return result;
    return new Promise((resolve) => {
      releaseUpdate = () => resolve(result);
    });
  };
  const [label, setLabel] = createSignal("Before");
  let pressableRef;
  const app = mount(
    () =>
      createComponent(Pressable, {
        ref: (node) => {
          pressableRef = node;
        },
        children: createComponent(Text, { children: label }),
      }),
    host,
    { surface: { name: "async-command-ordering" }, autoCommit: false },
  );
  await app.root.flush();
  assert.ok(pressableRef);

  setLabel("First update");
  const command = pressableRef.focus();
  for (
    let attempt = 0;
    releaseUpdate === undefined && attempt < 10;
    attempt++
  ) {
    await Promise.resolve();
  }
  assert.ok(releaseUpdate);
  setLabel("Racing update");
  releaseUpdate();
  await command;

  assert.deepEqual(
    host.commits
      .slice(1)
      .map((transaction) =>
        transaction.mutations.map((mutation) => mutation.type),
      ),
    [["update-text"], ["update-text"], ["command"]],
  );
  await app.dispose();
});

test("rejects a native command that races root disposal", async () => {
  const host = createRendererHost();
  let pressableRef;
  const app = mount(
    () =>
      createComponent(Pressable, {
        ref: (node) => {
          pressableRef = node;
        },
        children: createComponent(Text, { children: "Disposable" }),
      }),
    host,
    { surface: { name: "command-disposal-race" }, autoCommit: false },
  );
  await app.root.flush();
  assert.ok(pressableRef);

  const dispatchCommand = pressableRef.dispatchCommand.bind(pressableRef);
  let disposal;
  pressableRef.dispatchCommand = (...args) => {
    const command = dispatchCommand(...args);
    disposal = app.dispose();
    return command;
  };

  await assert.rejects(pressableRef.focus(), /Native root has been disposed/);
  assert.ok(disposal);
  await disposal;
  assert.equal(
    host.commits.some((transaction) =>
      transaction.mutations.some((mutation) => mutation.type === "command"),
    ),
    false,
  );
});

test("waits for an in-flight measurement and rejects stale geometry during disposal", async () => {
  const host = createRendererHost();
  const hostMeasurement = deferred();
  const measure = host.measure.bind(host);
  let measurementStarted = false;
  host.measure = (...args) => {
    measure(...args);
    measurementStarted = true;
    return hostMeasurement.promise;
  };
  const destroySurface = host.destroySurface.bind(host);
  let destroyCalls = 0;
  host.destroySurface = (surface) => {
    destroyCalls++;
    return destroySurface(surface);
  };
  let pressableRef;
  const app = mount(
    () =>
      createComponent(Pressable, {
        ref: (node) => {
          pressableRef = node;
        },
        children: createComponent(Text, { children: "Measurable" }),
      }),
    host,
    { surface: { name: "measurement-disposal-race" }, autoCommit: false },
  );
  await app.root.flush();
  assert.ok(pressableRef);

  const pendingMeasurement = pressableRef.measure();
  for (let attempt = 0; !measurementStarted && attempt < 10; attempt++) {
    await Promise.resolve();
  }
  assert.equal(measurementStarted, true);
  const staleMeasurement = assert.rejects(
    pendingMeasurement,
    /Native root has been disposed/,
  );
  const disposal = app.dispose();
  await Promise.resolve();
  assert.equal(destroyCalls, 0);
  hostMeasurement.resolve({
    x: 1,
    y: 2,
    width: 3,
    height: 4,
    pageX: 5,
    pageY: 6,
    observedSequence: 1,
  });
  await Promise.all([staleMeasurement, disposal]);
  assert.equal(destroyCalls, 1);
});

test("does not start a measurement after its pending commit loses a disposal race", async () => {
  const host = createRendererHost();
  const commit = host.commit.bind(host);
  let releaseUpdate;
  host.commit = (transaction) => {
    const result = commit(transaction);
    if (transaction.sequence !== 2) return result;
    return new Promise((resolve) => {
      releaseUpdate = () => resolve(result);
    });
  };
  const measure = host.measure.bind(host);
  let measureCalls = 0;
  host.measure = (...args) => {
    measureCalls++;
    return measure(...args);
  };
  const [label, setLabel] = createSignal("Before");
  let textRef;
  const app = mount(
    () =>
      createComponent(Text, {
        ref: (node) => {
          textRef = node;
        },
        children: label,
      }),
    host,
    { surface: { name: "pre-measurement-disposal" }, autoCommit: false },
  );
  await app.root.flush();
  assert.ok(textRef);

  setLabel("After");
  const pendingMeasurement = textRef.measure();
  for (
    let attempt = 0;
    releaseUpdate === undefined && attempt < 10;
    attempt++
  ) {
    await Promise.resolve();
  }
  assert.ok(releaseUpdate);
  const staleMeasurement = assert.rejects(
    pendingMeasurement,
    /Native root has been disposed/,
  );
  const disposal = app.dispose();
  releaseUpdate();
  await Promise.all([staleMeasurement, disposal]);
  assert.equal(measureCalls, 0);
});

test("shares application and root disposal completion across concurrent callers", async () => {
  const host = createRendererHost();
  const surfaceStop = deferred();
  const surfaceStopStarted = deferred();
  const destroySurface = host.destroySurface.bind(host);
  let destroyCalls = 0;
  host.destroySurface = async (surface) => {
    destroyCalls++;
    surfaceStopStarted.resolve();
    const result = destroySurface(surface);
    await surfaceStop.promise;
    return result;
  };
  let cleanups = 0;
  const app = mount(
    () => {
      onCleanup(() => cleanups++);
      return createComponent(Text, { children: "Disposable application" });
    },
    host,
    { surface: { name: "shared-disposal" }, autoCommit: false },
  );
  await app.root.flush();

  const firstApplicationDisposal = app.dispose();
  const secondApplicationDisposal = app.dispose();
  const firstRootDisposal = app.root.dispose();
  const secondRootDisposal = app.root.dispose();
  assert.equal(firstApplicationDisposal, secondApplicationDisposal);
  assert.equal(firstRootDisposal, secondRootDisposal);
  assert.equal(cleanups, 1);
  await surfaceStopStarted.promise;
  assert.equal(destroyCalls, 1);

  let applicationSettled = false;
  void firstApplicationDisposal.then(() => {
    applicationSettled = true;
  });
  await Promise.resolve();
  assert.equal(applicationSettled, false);
  surfaceStop.resolve();
  await Promise.all([firstApplicationDisposal, firstRootDisposal]);
  assert.equal(applicationSettled, true);
  assert.equal(app.dispose(), firstApplicationDisposal);
  assert.equal(app.root.dispose(), firstRootDisposal);
});

test("shares a disposal failure across repeated callers", async () => {
  const host = createRendererHost();
  const failure = new Error("surface stop failed");
  host.destroySurface = async () => {
    throw failure;
  };
  const app = mount(
    () => createComponent(Text, { children: "Failing disposal" }),
    host,
    { surface: { name: "failed-shared-disposal" }, autoCommit: false },
  );
  await app.root.flush();

  const first = app.dispose();
  const second = app.dispose();
  assert.equal(first, second);
  await assert.rejects(first, (error) => error === failure);
  const third = app.dispose();
  assert.equal(third, first);
  await assert.rejects(third, (error) => error === failure);
});

test(
  "cleans an asynchronously mounted surface after initial render failure",
  terminalSolidFailureOnly,
  async () => {
    const host = createRendererHost();
    const failure = new Error("initial native render failed");

    try {
      await assert.rejects(
        () =>
          mountAsync(
            () => {
              throw failure;
            },
            host,
            {
              surface: { name: "failed-initial-render" },
              autoCommit: false,
            },
          ),
        (error) => error === failure || error?.cause === failure,
      );
    } finally {
      // Solid 2 intentionally halts scheduling after an error escapes every
      // boundary. This test owns that terminal failure and must not freeze the
      // remaining isolated roots in this process.
      resetErrorHalt();
    }
    assert.equal(host.hasSurface(1), false);
  },
);

test(
  "starts background surface rollback when synchronous mount rendering fails",
  terminalSolidFailureOnly,
  async () => {
    const host = createRendererHost();
    const failure = new Error("synchronous native render failed");
    const destroySurface = host.destroySurface.bind(host);
    let resolveDestroyed;
    const destroyed = new Promise((resolve) => {
      resolveDestroyed = resolve;
    });
    host.destroySurface = (surface) => {
      destroySurface(surface);
      resolveDestroyed();
    };

    try {
      assert.throws(
        () =>
          mount(
            () => {
              throw failure;
            },
            host,
            {
              surface: { name: "failed-synchronous-render" },
              autoCommit: false,
            },
          ),
        (error) => error === failure || error?.cause === failure,
      );
    } finally {
      resetErrorHalt();
    }
    await destroyed;
    assert.equal(host.hasSurface(1), false);
  },
);

test("tears down the native surface when Solid owner cleanup fails", async () => {
  const host = createRendererHost();
  const failure = new Error("Solid owner cleanup failed");
  const app = mount(
    () => {
      onCleanup(() => {
        throw failure;
      });
      return createComponent(Text, { children: "Throwing cleanup" });
    },
    host,
    { surface: { name: "throwing-owner-cleanup" }, autoCommit: false },
  );
  await app.root.flush();

  await assert.rejects(app.dispose(), (error) => error === failure);
  assert.equal(host.hasSurface(app.root.surfaceId), false);
});

test(
  "retains both Solid and native failures at lifecycle cleanup boundaries",
  terminalSolidFailureOnly,
  async () => {
    const mountHost = createRendererHost();
    const mountFailure = new Error("initial mount failed");
    const mountCleanupFailure = new Error("initial surface cleanup failed");
    mountHost.destroySurface = async () => {
      throw mountCleanupFailure;
    };
    try {
      await assert.rejects(
        () =>
          mountAsync(
            () => {
              throw mountFailure;
            },
            mountHost,
            {
              surface: { name: "doubly-failed-initial-render" },
              autoCommit: false,
            },
          ),
        (error) => {
          assert.ok(error instanceof AggregateError);
          assert.equal(error.errors.length, 2);
          assert.ok(
            error.errors[0] === mountFailure ||
              error.errors[0]?.cause === mountFailure,
          );
          assert.equal(error.errors[1], mountCleanupFailure);
          return true;
        },
      );
    } finally {
      resetErrorHalt();
    }

    const disposalHost = createRendererHost();
    const solidCleanupFailure = new Error("owner cleanup failed");
    const nativeCleanupFailure = new Error("surface teardown failed");
    disposalHost.destroySurface = async () => {
      throw nativeCleanupFailure;
    };
    const app = mount(
      () => {
        onCleanup(() => {
          throw solidCleanupFailure;
        });
        return createComponent(Text, { children: "Doubly failed disposal" });
      },
      disposalHost,
      { surface: { name: "doubly-failed-disposal" }, autoCommit: false },
    );
    await app.root.flush();
    await assert.rejects(app.dispose(), (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [
        solidCleanupFailure,
        nativeCleanupFailure,
      ]);
      return true;
    });
  },
);

test("rolls back a surface when native root subscription setup fails", async () => {
  const host = new InMemoryHost({
    descriptors: CORE_COMPONENT_DESCRIPTORS,
    platform: "ios",
    capabilities: { commitMountEvents: true },
  });
  const initializationFailure = new Error(
    "native lifecycle subscription failed",
  );
  let eventSubscriptionRemoved = false;
  const nativeSubscribe = host.subscribe.bind(host);
  host.subscribe = (listener) => {
    const unsubscribe = nativeSubscribe(listener);
    return () => {
      eventSubscriptionRemoved = true;
      unsubscribe();
    };
  };
  host.subscribeLifecycle = () => {
    throw initializationFailure;
  };

  await assert.rejects(
    () =>
      mountAsync(() => null, host, {
        surface: { name: "failed-root-subscription" },
        autoCommit: false,
        telemetry: createCausalTelemetry({ sink() {} }),
      }),
    (error) => error === initializationFailure,
  );
  assert.equal(eventSubscriptionRemoved, true);
  assert.equal(host.hasSurface(1), false);
});

test("retains native root initialization and rollback failures", async () => {
  const host = createRendererHost();
  const initializationFailure = new Error("native subscription failed");
  const rollbackFailure = new Error("native surface rollback failed");
  host.subscribe = () => {
    throw initializationFailure;
  };
  host.destroySurface = async () => {
    throw rollbackFailure;
  };

  await assert.rejects(
    () =>
      mountAsync(() => null, host, {
        surface: { name: "failed-root-subscription-and-rollback" },
        autoCommit: false,
      }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [initializationFailure, rollbackFailure]);
      return true;
    },
  );
});

test("tears down the native surface when host unsubscribe fails", async () => {
  const host = createRendererHost();
  const unsubscribeFailure = new Error("native event unsubscribe failed");
  let surfaceDestroyed = false;
  host.subscribe = () => () => {
    throw unsubscribeFailure;
  };
  const nativeDestroySurface = host.destroySurface.bind(host);
  host.destroySurface = (surface) => {
    surfaceDestroyed = true;
    nativeDestroySurface(surface);
  };
  const app = mount(
    () => createComponent(Text, { children: "Unmount safely" }),
    host,
    { surface: { name: "throwing-host-unsubscribe" }, autoCommit: false },
  );
  await app.root.flush();

  await assert.rejects(app.dispose(), (error) => error === unsubscribeFailure);
  assert.equal(surfaceDestroyed, true);
  assert.equal(host.hasSurface(app.root.surfaceId), false);
});

test("retains every distinct native root disposal failure", async () => {
  const host = new InMemoryHost({
    descriptors: CORE_COMPONENT_DESCRIPTORS,
    capabilities: { commitMountEvents: true },
  });
  const lifecycleUnsubscribeFailure = new Error(
    "native lifecycle unsubscribe failed",
  );
  const eventUnsubscribeFailure = new Error("native event unsubscribe failed");
  const surfaceFailure = new Error("native surface teardown failed");
  host.subscribe = () => () => {
    throw eventUnsubscribeFailure;
  };
  host.subscribeLifecycle = () => () => {
    throw lifecycleUnsubscribeFailure;
  };
  host.destroySurface = async () => {
    throw surfaceFailure;
  };
  const app = mount(
    () => createComponent(Text, { children: "Report every cleanup failure" }),
    host,
    {
      surface: { name: "multiply-failed-root-disposal" },
      autoCommit: false,
      telemetry: createCausalTelemetry({ sink() {} }),
    },
  );
  await app.root.flush();

  await assert.rejects(app.dispose(), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [
      lifecycleUnsubscribeFailure,
      eventUnsubscribeFailure,
      surfaceFailure,
    ]);
    return true;
  });
});
