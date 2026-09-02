import assert from "node:assert/strict";
import test from "node:test";

import { Text } from "@solid-native/core";
import {
  createCausalTelemetry,
  createCausalTimeline,
} from "@solid-native/observability";
import { renderNative } from "@solid-native/testing";
import { createComponent, createMemo, createSignal } from "solid-js";

import {
  DEVELOPMENT_ERROR_MAX_MESSAGE_LENGTH,
  DEVELOPMENT_ERROR_MAX_STACK_LENGTH,
  createDevelopmentErrorController,
  createDevelopmentErrorHandler,
} from "../dist/index.js";
import { createDevelopmentNetworkInspector } from "../dist/network.js";
import {
  DevelopmentCausalPanel,
  DevelopmentErrorOverlay,
  DevelopmentNetworkPanel,
} from "../dist/solid.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function panelNetworkService() {
  const settlement = deferred();
  const state = {
    observer: undefined,
    cancelled: 0,
  };
  return {
    state,
    settlement,
    service: {
      platform: "android",
      requestText(_request, observer) {
        state.observer = observer;
        return Object.freeze({
          result: settlement.promise,
          cancel: () => state.cancelled++,
        });
      },
    },
  };
}

test("normalizes, bounds, freezes, and coalesces local error reports", () => {
  let now = 10;
  const controller = createDevelopmentErrorController({
    maxHistory: 2,
    clock: () => now,
  });
  const failure = Object.assign(
    new Error("m".repeat(DEVELOPMENT_ERROR_MAX_MESSAGE_LENGTH + 20)),
    { stack: "s".repeat(DEVELOPMENT_ERROR_MAX_STACK_LENGTH + 20) },
  );
  const first = controller.report(failure, { source: "async" });
  assert.equal(first.protocolVersion, 0);
  assert.equal(first.id, 1);
  assert.equal(first.source, "async");
  assert.equal(first.message.length, DEVELOPMENT_ERROR_MAX_MESSAGE_LENGTH);
  assert.equal(first.message.endsWith("\u2026"), true);
  assert.equal(first.stack.length, DEVELOPMENT_ERROR_MAX_STACK_LENGTH);
  assert.equal(Object.isFrozen(first), true);

  now = 11;
  const repeated = controller.report(failure, { source: "async" });
  assert.equal(repeated.id, first.id);
  assert.equal(repeated.occurrenceCount, 2);
  assert.equal(repeated.firstOccurredAt, 10);
  assert.equal(repeated.lastOccurredAt, 11);
  assert.equal(controller.history().length, 1);
  assert.equal(Object.isFrozen(controller.history()), true);

  controller.report("second");
  controller.report("third");
  assert.deepEqual(
    controller.history().map((entry) => entry.message),
    ["second", "third"],
  );
});

test("never lets hostile thrown values or subscribers replace a report", async () => {
  const controller = createDevelopmentErrorController({ clock: () => 1 });
  const hostile = Object.create(null, {
    name: {
      get: () => {
        throw new Error("name getter");
      },
    },
    message: {
      get: () => {
        throw new Error("message getter");
      },
    },
    stack: {
      get: () => {
        throw new Error("stack getter");
      },
    },
  });
  let observed = 0;
  const failed = controller.subscribe(() => {
    throw new Error("listener failed");
  });
  const removed = controller.subscribe(() => {
    observed++;
  });
  const snapshot = controller.report(hostile, {
    source: "native",
  });
  assert.equal(snapshot.name, "Error");
  assert.equal(
    snapshot.message,
    "An object was thrown without a string message.",
  );
  assert.equal(snapshot.stack, undefined);
  assert.equal(observed, 1);
  removed.remove();
  removed.remove();
  failed.remove();
  controller.report(new Error("after removal"));
  await Promise.resolve();
  assert.equal(observed, 1);
});

test("dismisses only the visible identity and retains bounded history", () => {
  const controller = createDevelopmentErrorController({ clock: () => 1 });
  const first = controller.report("first");
  const second = controller.report("second");
  assert.equal(controller.dismiss(first.id), false);
  assert.equal(controller.current(), second);
  assert.equal(controller.dismiss(second.id), true);
  assert.equal(controller.current(), undefined);
  assert.equal(controller.history().length, 2);
  assert.equal(controller.dismiss(), false);
  controller.clear();
  assert.deepEqual(controller.history(), []);
});

test("creates source-specific adapter handlers", () => {
  const controller = createDevelopmentErrorController({ clock: () => 1 });
  const reportCommit = createDevelopmentErrorHandler(controller, "commit");
  assert.equal(reportCommit(new Error("commit failed")).source, "commit");
  assert.throws(
    () => createDevelopmentErrorHandler(controller, "invalid"),
    /source is invalid/u,
  );
});

test("renders and dismisses explicitly reported errors in native components", async () => {
  const controller = createDevelopmentErrorController({ clock: () => 1 });
  const rendered = await renderNative(() =>
    createComponent(DevelopmentErrorOverlay, {
      controller,
      get children() {
        return createComponent(Text, { children: "Application ready" });
      },
    }),
  );
  assert.ok(rendered.getByText("Application ready"));

  await rendered.act(() =>
    controller.report(new Error("network exploded"), {
      source: "async",
    }),
  );
  assert.ok(rendered.getByTestId("solid-native-development-error-overlay"));
  assert.ok(rendered.getByText("network exploded"));
  assert.ok(rendered.getByText("Source: async"));
  await rendered.press(
    rendered.getByRole("button", { name: "Dismiss development error" }),
  );
  assert.ok(rendered.getByText("Application ready"));
  await rendered.cleanup();
});

test("retries a failed Solid subtree without retaining duplicate native nodes", async () => {
  const controller = createDevelopmentErrorController({ clock: () => 1 });
  let shouldFail = true;
  const dismissed = [];
  const rendered = await renderNative(() =>
    createComponent(DevelopmentErrorOverlay, {
      controller,
      onDismiss: (error) => dismissed.push(error.id),
      get children() {
        if (shouldFail) throw new Error("render exploded");
        return createComponent(Text, { children: "Recovered application" });
      },
    }),
  );
  assert.ok(rendered.getByText("render exploded"));
  assert.equal(controller.current().source, "render");
  shouldFail = false;
  await rendered.press(
    rendered.getByRole("button", { name: "Retry failed Solid subtree" }),
  );
  assert.ok(rendered.getByText("Recovered application"));
  assert.equal(controller.current(), undefined);
  assert.deepEqual(dismissed, [1]);
  assert.equal(rendered.queryAllByText("Recovered application").length, 1);
  await rendered.cleanup();
});

test("does not reset twice when an observer repairs a tracked render source", async () => {
  const controller = createDevelopmentErrorController({ clock: () => 1 });
  let setFailure;
  const rendered = await renderNative(() => {
    const [failure, setFailed] = createSignal(true);
    setFailure = setFailed;
    const content = createMemo(() => {
      if (failure()) throw new Error("tracked render exploded");
      return "Tracked source recovered";
    });
    return createComponent(DevelopmentErrorOverlay, {
      controller,
      onDismiss: () => setFailure(false),
      get children() {
        return createComponent(Text, {
          get children() {
            return content();
          },
        });
      },
    });
  });
  assert.ok(rendered.getByText("tracked render exploded"));
  await rendered.press(
    rendered.getByRole("button", { name: "Retry failed Solid subtree" }),
  );
  assert.ok(rendered.getByText("Tracked source recovered"));
  assert.equal(
    rendered.queryAllByTestId("solid-native-development-error-overlay").length,
    0,
  );
  assert.equal(controller.current(), undefined);
  await rendered.cleanup();
});

test("shows native network history without remounting the application subtree", async () => {
  let now = 20;
  const inspector = createDevelopmentNetworkInspector({
    captureRequestTargets: true,
    clock: () => now++,
  });
  const native = panelNetworkService();
  const network = inspector.instrument(native.service);
  const rendered = await renderNative(() =>
    createComponent(DevelopmentNetworkPanel, {
      inspector,
      get children() {
        return createComponent(Text, { children: "Application stays mounted" });
      },
    }),
  );
  const applicationNode = rendered.getByText("Application stays mounted").node;
  const badgeNode = rendered.getByTestId(
    "solid-native-development-network-badge",
  ).node;
  assert.ok(rendered.getByText("Network 0"));

  let handle;
  await rendered.act(() => {
    handle = network.requestText({
      url: "https://api.example.test/v1/stream?token=private",
      method: "post",
    });
  });
  assert.ok(rendered.getByText("Network 1 \u00b7 1 active"));
  await rendered.press(
    rendered.getByRole("button", { name: /Open network inspector/u }),
  );
  const openPanel = rendered.getByTestId(
    "solid-native-development-network-panel",
  );
  const firstPanelNode = openPanel.node;
  assert.equal(openPanel.props.accessibilityViewIsModal, true);
  assert.equal(openPanel.props.importantForAccessibility, "yes");
  assert.equal(
    rendered.getByTestId("solid-native-development-network-badge").node,
    badgeNode,
  );
  assert.ok(rendered.getByText("POST \u00b7 PENDING"));
  assert.ok(rendered.getByText("https://api.example.test/v1/stream"));
  const openApplication = rendered.getByText("Application stays mounted");
  assert.equal(openApplication.node, applicationNode);
  const openApplicationContainer = rendered
    .snapshot()
    .nodes.find((node) => node.node === openApplication.parent);
  assert.equal(openApplicationContainer.props.pointerEvents, "none");
  assert.equal(
    openApplicationContainer.props.accessibilityElementsHidden,
    true,
  );
  assert.equal(
    openApplicationContainer.props.importantForAccessibility,
    "no-hide-descendants",
  );

  await rendered.act(async () => {
    native.state.observer.onResponse({
      status: 200,
      url: "https://edge.example.test/v1/stream?session=private",
      headers: {},
    });
    native.state.observer.onChunk({
      sequence: 1,
      text: "private",
      loaded: 7,
    });
    native.settlement.resolve({
      response: {
        status: 200,
        url: "https://edge.example.test/v1/stream?session=private",
        headers: {},
      },
      chunkCount: 1,
      receivedCharacters: 7,
    });
    await handle.result;
  });
  assert.ok(rendered.getByText("POST \u00b7 COMPLETED"));
  assert.ok(rendered.getByText(/HTTP 200 \u00b7 1 chunk \u00b7 7 chars/u));
  assert.equal(
    rendered.getByText("Application stays mounted").node,
    applicationNode,
  );
  await rendered.press(
    rendered.getByRole("button", { name: "Clear network history" }),
  );
  assert.ok(rendered.getByText("No network requests captured."));
  await rendered.press(
    rendered.getByRole("button", { name: "Close network inspector" }),
  );
  assert.equal(
    rendered.getByText("Application stays mounted").node,
    applicationNode,
  );
  assert.equal(
    rendered.queryByTestId("solid-native-development-network-panel"),
    undefined,
  );
  const closedApplication = rendered.getByText("Application stays mounted");
  const closedApplicationContainer = rendered
    .snapshot()
    .nodes.find((node) => node.node === closedApplication.parent);
  assert.equal(closedApplicationContainer.props.pointerEvents, "auto");
  assert.equal(
    closedApplicationContainer.props.accessibilityElementsHidden,
    false,
  );
  assert.equal(
    closedApplicationContainer.props.importantForAccessibility,
    "auto",
  );
  assert.equal(
    rendered.getByTestId("solid-native-development-network-badge").node,
    badgeNode,
  );
  await rendered.press(
    rendered.getByRole("button", { name: /Open network inspector/u }),
  );
  assert.notEqual(
    rendered.getByTestId("solid-native-development-network-panel").node,
    firstPanelNode,
  );
  await rendered.press(
    rendered.getByRole("button", { name: "Close network inspector" }),
  );
  await rendered.cleanup();
});

test("captures and correlates Solid diagnostics inside the causal panel", async () => {
  const capturedAt = Date.now() - 2_000;
  let now = capturedAt + 100;
  let nextOperationId = 0;
  const timeline = createCausalTimeline();
  const telemetry = createCausalTelemetry({
    sink: timeline.sink,
    clock: () => now++,
    createOperationId: () => `solid-capture-${String(++nextOperationId)}`,
  });
  const computation = telemetry.startOperation("solid-native.computation", {
    attributes: {
      "computation.kind": "native-output",
      "computation.name": "assistant.output",
    },
  });
  telemetry.finishOperation(computation);
  const commit = telemetry.startOperation("solid-native.commit", {
    causes: [computation],
  });
  telemetry.finishOperation(commit);
  const mount = telemetry.startOperation("solid-native.mount", {
    causes: [commit],
  });
  telemetry.finishOperation(mount);
  const frame = telemetry.startOperation("solid-native.frame", {
    causes: [mount],
  });
  telemetry.finishOperation(frame);

  let active = false;
  let beginCount = 0;
  let endCount = 0;
  let disposeCount = 0;
  const solidDiagnostics = {
    available: true,
    get active() {
      return active;
    },
    begin() {
      assert.equal(active, false);
      active = true;
      beginCount += 1;
    },
    end() {
      assert.equal(active, true);
      active = false;
      endCount += 1;
      return {
        schemaVersion: 0,
        kind: "solid-native.solid-diagnostics-debug",
        capturedAt: new Date(capturedAt).toISOString(),
        durationMilliseconds: 1_000,
        truncated: false,
        droppedDiagnostics: 0,
        diagnostics: [],
        reruns: [
          {
            run: 1,
            nodeRuns: 1,
            nodeKind: "effect",
            nodeName: "assistant.output",
            causes: [
              {
                sequence: 1,
                kind: "write",
                name: "assistant.chunk",
              },
            ],
            dependencyCount: 1,
            dependenciesAdded: [],
            dependenciesRemoved: [],
            selfMilliseconds: 0.1,
            totalMilliseconds: 0.2,
            changed: true,
            phase: "plain",
            held: false,
          },
        ],
        scopeCosts: [],
        writeCosts: [],
      };
    },
    dispose() {
      active = false;
      disposeCount += 1;
    },
  };
  const rendered = await renderNative(() =>
    createComponent(DevelopmentCausalPanel, {
      timeline,
      solidDiagnostics,
      children: createComponent(Text, { children: "Captured application" }),
    }),
  );

  await rendered.press(
    rendered.getByRole("button", { name: "Open causal trace inspector" }),
  );
  await rendered.press(
    rendered.getByRole("button", {
      name: "Start Solid diagnostics capture",
    }),
  );
  assert.equal(beginCount, 1);
  assert.equal(active, true);
  assert.equal(
    rendered.queryByTestId("solid-native-development-causal-panel"),
    undefined,
  );
  assert.ok(rendered.getByText("Stop Solid"));

  await rendered.press(
    rendered.getByRole("button", { name: "Stop Solid diagnostics capture" }),
  );
  assert.equal(endCount, 1);
  assert.equal(active, false);
  assert.ok(rendered.getByText("Solid → native correlation"));
  assert.ok(
    rendered.getByText(
      "1 reruns · 1 correlated outputs · 1 complete native frame outputs · exact per-rerun join: no",
    ),
  );
  assert.ok(rendered.getByText("assistant.output · 1 reruns · 1 frames"));
  assert.equal(rendered.queryByText("assistant.chunk"), undefined);

  await rendered.press(
    rendered.getByRole("button", { name: "Clear causal trace" }),
  );
  assert.equal(rendered.queryByText("Solid → native correlation"), undefined);
  await rendered.press(
    rendered.getByRole("button", {
      name: "Start Solid diagnostics capture",
    }),
  );
  await rendered.cleanup();
  assert.equal(disposeCount, 1);
  assert.equal(active, false);
});

test("validates controller configuration and overlay inputs", () => {
  assert.throws(
    () => createDevelopmentErrorController({ maxHistory: 0 }),
    /maxHistory/u,
  );
  assert.throws(
    () => createDevelopmentErrorController({ maxHistory: 51 }),
    /maxHistory/u,
  );
  assert.throws(
    () => createDevelopmentErrorController(null),
    /options must be an object/u,
  );
  assert.throws(
    () => DevelopmentErrorOverlay({ controller: null, children: undefined }),
    /requires an error controller/u,
  );
  assert.throws(
    () => DevelopmentNetworkPanel({ inspector: null, children: undefined }),
    /requires a development network inspector/u,
  );
  assert.throws(
    () =>
      DevelopmentNetworkPanel({
        inspector: createDevelopmentNetworkInspector(),
        children: undefined,
        maxVisibleRequests: 0,
      }),
    /maxVisibleRequests/u,
  );
  assert.throws(
    () => DevelopmentCausalPanel({ timeline: null, children: undefined }),
    /requires a bounded causal timeline/u,
  );
  assert.throws(
    () =>
      DevelopmentCausalPanel({
        timeline: createCausalTimeline(),
        children: undefined,
        maxVisibleOperations: 0,
      }),
    /maxVisibleOperations/u,
  );
  assert.throws(
    () =>
      DevelopmentCausalPanel({
        timeline: createCausalTimeline(),
        children: undefined,
        badgeBottom: -1,
      }),
    /badgeBottom/u,
  );
  assert.throws(
    () =>
      DevelopmentCausalPanel({
        timeline: createCausalTimeline(),
        children: undefined,
        solidDiagnostics: {},
      }),
    /solidDiagnostics/u,
  );
});
