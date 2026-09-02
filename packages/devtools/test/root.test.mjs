import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { Text } from "@solid-native/core";
import {
  createCausalTelemetry,
  createCausalTimeline,
} from "@solid-native/observability";
import { renderNative } from "@solid-native/testing";
import { createComponent } from "solid-js";

import { createDevelopmentErrorController } from "../dist/index.js";
import { createDevelopmentNetworkInspector } from "../dist/network.js";
import { DevelopmentRoot as DevelopmentImplementation } from "../dist/root-development.js";
import { DevelopmentRoot as ProductionRoot } from "../dist/root.js";

test("keeps the production root free of development runtime imports", async () => {
  const source = await readFile(
    new URL("../dist/root.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /^import\s/mu);
  assert.doesNotMatch(source, /\.\/(?:index|react-native|solid)\.js/u);
  assert.match(source, /return props\.children/u);
});

test("keeps the production development root as a dependency-free pass-through", async () => {
  let childReads = 0;
  const rendered = await renderNative(() =>
    createComponent(ProductionRoot, {
      get children() {
        childReads++;
        return createComponent(Text, { children: "Production application" });
      },
    }),
  );

  assert.ok(rendered.getByText("Production application"));
  assert.equal(childReads, 1);
  await rendered.cleanup();
});

test("owns the overlay and guarded runtime bridge for one development root", async () => {
  const previous = () => undefined;
  const errorUtils = {
    current: previous,
    getGlobalHandler() {
      return this.current;
    },
    setGlobalHandler(handler) {
      this.current = handler;
    },
  };
  const controller = createDevelopmentErrorController({ clock: () => 1 });
  const networkInspector = createDevelopmentNetworkInspector();
  const causalTimeline = createCausalTimeline({ capacity: 20 });
  let nextOperationId = 0;
  let now = 100;
  const telemetry = createCausalTelemetry({
    sink: causalTimeline.sink,
    clock: () => ++now,
    createOperationId: () => `resident-${String(++nextOperationId)}`,
  });
  const event = telemetry.startOperation("solid-native.event", {
    attributes: { "event.name": "save" },
  });
  telemetry.finishOperation(event);
  const commit = telemetry.startOperation("solid-native.commit", {
    causes: [event],
    attributes: { "commit.sequence": 4 },
  });
  telemetry.finishOperation(commit);
  const rendered = await renderNative(() =>
    createComponent(DevelopmentImplementation, {
      controller,
      causalTimeline,
      causalPanelOptions: { maxVisibleOperations: 1 },
      networkInspector,
      errorBridgeOptions: { errorUtils },
      get children() {
        return createComponent(Text, { children: "Development application" });
      },
    }),
  );
  assert.notEqual(errorUtils.current, previous);
  const applicationNode = rendered.getByText("Development application").node;
  assert.ok(rendered.getByText("Network 0"));
  assert.ok(rendered.getByText("Trace"));
  assert.equal(
    rendered.queryByLabelText("Filter causal operations"),
    undefined,
  );
  await rendered.press(
    rendered.getByRole("button", { name: "Open causal trace inspector" }),
  );
  assert.ok(
    rendered.getByText(
      "2 retained · 0 active. Manual snapshots prevent self-observation.",
    ),
  );
  assert.equal(
    rendered.getByText("Development application").node,
    applicationNode,
  );
  assert.throws(() => rendered.getByText("save"));
  assert.ok(rendered.getByText("solid-native.commit"));
  await rendered.press(
    rendered.getByRole("button", {
      name: "Inspect causal operation solid-native.commit (resident-2)",
    }),
  );
  assert.ok(rendered.getByText("Retained causes (1)"));
  assert.ok(rendered.getByText("Retained effects (0)"));
  await rendered.press(
    rendered.getByRole("button", {
      name: "Inspect causal operation solid-native.event (resident-1)",
    }),
  );
  assert.ok(rendered.getByText("Retained causes (0)"));
  assert.ok(rendered.getByText("Retained effects (1)"));
  await rendered.press(
    rendered.getByRole("button", { name: "Back to causal operations" }),
  );
  const causalFilter = rendered.getByLabelText("Filter causal operations");
  const causalFilterNode = causalFilter.node;
  await rendered.fireEvent(causalFilter, "changeText", {
    text: "commit",
    eventCount: 1,
  });
  assert.equal(
    rendered.getByLabelText("Filter causal operations").node,
    causalFilterNode,
  );
  assert.ok(rendered.getByText("1 matching retained operations."));
  assert.ok(rendered.getByText("solid-native.commit"));
  assert.equal(rendered.queryByText("solid-native.event"), undefined);
  await rendered.fireEvent(causalFilter, "changeText", {
    text: "RESIDENT-1",
    eventCount: 2,
  });
  assert.ok(rendered.getByText("solid-native.event"));
  assert.equal(rendered.queryByText("solid-native.commit"), undefined);
  await rendered.fireEvent(causalFilter, "changeText", {
    text: "missing-operation",
    eventCount: 3,
  });
  assert.ok(rendered.getByText("No causal operations match this filter."));
  await rendered.fireEvent(causalFilter, "changeText", {
    text: "",
    eventCount: 4,
  });
  const mount = telemetry.startOperation("solid-native.mount", {
    causes: [commit],
  });
  telemetry.finishOperation(mount);
  assert.throws(() => rendered.getByText("solid-native.mount"));
  await rendered.press(
    rendered.getByRole("button", { name: "Refresh causal trace" }),
  );
  assert.ok(rendered.getByText("solid-native.mount"));
  await rendered.press(
    rendered.getByRole("button", { name: "Group causal operations" }),
  );
  assert.ok(rendered.getByText("1 matching retained trace group."));
  await rendered.press(
    rendered.getByRole("button", {
      name: "Inspect causal trace group (resident-1)",
    }),
  );
  assert.ok(rendered.getByText("Selected trace group"));
  assert.ok(rendered.getByText("solid-native.mount"));
  await rendered.press(
    rendered.getByRole("button", {
      name: "Inspect causal operation solid-native.mount (resident-3)",
    }),
  );
  assert.ok(rendered.getByText("Retained causes (2)"));
  await rendered.press(
    rendered.getByRole("button", { name: "Back to causal trace group" }),
  );
  assert.ok(rendered.getByText("Selected trace group"));
  await rendered.press(
    rendered.getByRole("button", { name: "Back to causal trace groups" }),
  );
  await rendered.press(
    rendered.getByRole("button", { name: "Show causal operations" }),
  );
  assert.ok(rendered.getByText("solid-native.mount"));
  await rendered.press(
    rendered.getByRole("button", { name: "Clear causal trace" }),
  );
  assert.ok(rendered.getByText("No causal operations captured."));
  assert.deepEqual(causalTimeline.snapshot().operations, []);
  await rendered.press(
    rendered.getByRole("button", { name: "Close causal trace inspector" }),
  );
  assert.equal(
    rendered.queryByLabelText("Filter causal operations"),
    undefined,
  );
  assert.equal(
    rendered.getByText("Development application").node,
    applicationNode,
  );
  await rendered.press(
    rendered.getByRole("button", { name: /Open network inspector/u }),
  );
  assert.ok(rendered.getByText("No network requests captured."));
  await rendered.press(
    rendered.getByRole("button", { name: "Close network inspector" }),
  );

  await rendered.act(() =>
    errorUtils.current(new Error("Development runtime failed"), false),
  );
  assert.ok(rendered.getByText("Development runtime failed"));
  assert.ok(rendered.getByText("Source: runtime"));
  await rendered.press(
    rendered.getByRole("button", { name: "Dismiss development error" }),
  );
  assert.ok(rendered.getByText("Development application"));

  await rendered.cleanup();
  assert.equal(errorUtils.current, previous);
});
