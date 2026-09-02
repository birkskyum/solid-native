import assert from "node:assert/strict";
import test from "node:test";

import {
  CausalComputation,
  CORE_COMPONENT_DESCRIPTORS,
  Pressable,
  Text,
  View,
} from "@solid-native/core";
import { createCausalTelemetry } from "@solid-native/observability";
import { createComponent } from "@solid-native/renderer";
import { createMemo, createSignal, DEV } from "solid-js";

import {
  InMemoryHost,
  NativeTestCommitQueryError,
  NativeTestMutationQueryError,
  NativeTestQueryError,
  NativeTestWaitAbortedError,
  NativeTestWaitTimeoutError,
  renderNative,
} from "../dist/index.js";

test(
  "attributes a named Solid write through the native renderer commit",
  { skip: DEV?.attribution === undefined },
  async () => {
    DEV.attribution.enable({
      log: false,
      hotRuns: false,
      wideDeps: false,
      hotTime: false,
      unstableMemos: false,
      wideWrites: false,
    });
    let screen;
    let label;
    let setCount;
    const records = [];
    let operationSequence = 0;
    try {
      screen = await renderNative(
        () => {
          const [count, writeCount] = createSignal(0, {
            name: "native-count",
          });
          setCount = writeCount;
          label = createMemo(() => `Count: ${String(count())}`, {
            name: "native-label",
          });
          return createComponent(CausalComputation, {
            name: "counter.output",
            get children() {
              return createComponent(Text, { children: label });
            },
          });
        },
        {
          rootOptions: {
            telemetry: createCausalTelemetry({
              sink: (record) => records.push(record),
              createOperationId: () =>
                `diagnostic-operation-${++operationSequence}`,
            }),
          },
        },
      );

      await screen.act(() => setCount(1));

      assert.equal(screen.getByText("Count: 1").textContent, "Count: 1");
      assert.equal(screen.commits.length, 2);
      assert.deepEqual(screen.commits[1].mutations, [
        {
          type: "update-text",
          node: 3,
          text: "Count: 1",
        },
      ]);

      const reruns = DEV.attribution.why(label);
      assert.equal(reruns.length, 1);
      assert.equal(reruns[0].nodeKind, "memo");
      assert.equal(reruns[0].nodeName, "native-label");
      assert.deepEqual(
        reruns[0].causes.map(({ kind, name, prev, value }) => ({
          kind,
          name,
          prev,
          value,
        })),
        [
          {
            kind: "write",
            name: "native-count",
            prev: "0",
            value: "1",
          },
        ],
      );
      const nativeOutputRun = DEV.attribution
        .history()
        .find(
          (event) =>
            event.nodeKind === "effect" &&
            event.nodeName === "counter.output" &&
            event.causes.some(
              (cause) =>
                cause.kind === "derived" && cause.name === "native-label",
            ),
        );
      assert.ok(nativeOutputRun);
      assert.equal(nativeOutputRun.changed, true);
      const computation = records.find(
        (record) =>
          record.type === "operation-started" &&
          record.name === "solid-native.computation" &&
          record.attributes["computation.name"] === "counter.output" &&
          records.some(
            (candidate) =>
              candidate.type === "operation-started" &&
              candidate.name === "solid-native.commit" &&
              candidate.attributes["commit.sequence"] === 2 &&
              candidate.causes.includes(record.operationId),
          ),
      );
      assert.ok(computation);
      assert.ok(
        (DEV.attribution
          .costs()
          .writes.find((write) => write.name === "native-count")?.runs ?? 0) >=
          2,
      );
    } finally {
      DEV.attribution.disable();
      await screen?.cleanup();
    }
  },
);

test("renders, queries, presses, flushes, and cleans up one native application", async () => {
  const screen = await renderNative(() => {
    const [count, setCount] = createSignal(0);
    return createComponent(View, {
      children: [
        createComponent(Text, {
          accessibilityRole: "header",
          get children() {
            return `Count: ${String(count())}`;
          },
        }),
        createComponent(Pressable, {
          accessibilityRole: "button",
          accessibilityLabel: "Increment count",
          testID: "increment",
          onPress: () => setCount((value) => value + 1),
          children: createComponent(Text, { children: "Increment" }),
        }),
      ],
    });
  });

  assert.equal(screen.snapshot().name, "test");
  assert.equal(screen.commits.length, 1);
  assert.equal(screen.getByText("Count: 0").component, "Text");
  assert.equal(
    screen.getByRole("header", { name: "Count: 0" }).textContent,
    "Count: 0",
  );
  assert.equal(screen.getByText(/^Increment$/u).textContent, "Increment");
  assert.equal(screen.getByTestId("increment").component, "Pressable");
  assert.equal(
    screen.getByLabelText("Increment count").node,
    screen.getByRole("button", { name: /increment count/iu }).node,
  );
  assert.equal(
    screen.debug(),
    [
      'Native surface "test" (id=1, sequence=1)',
      "<RootView node=1>",
      "  <View node=7>",
      '    <Text node=2 role="header">',
      '      #text node=3 "Count: 0"',
      '    <Pressable node=6 role="button" label="Increment count" testID="increment" events=["layout","press","pressCancel","pressIn","pressMove","pressOut"]>',
      "      <Text node=4>",
      '        #text node=5 "Increment"',
    ].join("\n"),
  );

  const event = await screen.press(screen.getByTestId("increment"));
  assert.equal(event.name, "press");
  assert.equal(event.priority, "discrete");
  assert.equal(event.bubbles, true);
  assert.equal(screen.queryByText("Count: 0"), undefined);
  assert.equal(screen.getByText("Count: 1").textContent, "Count: 1");
  assert.equal(screen.commits.length, 2);
  assert.equal(
    screen.debugCommits({ maxCommits: 1 }),
    [
      "Native commits (showing 1 of 2)",
      "… 1 earlier commit(s) omitted",
      "commit surface=1 sequence=2 priority=user-blocking mutations=1",
      "  update-text node=3",
    ].join("\n"),
  );
  assert.match(
    screen.debugCommits({ includeValues: true, maxCommits: 1 }),
    /update-text node=3 text="Count: 1"$/u,
  );
  assert.match(
    screen.debugCommits({ maxMutations: 1 }),
    /earlier mutation\(s\) omitted[\s\S]*update-text node=3$/u,
  );
  assert.throws(
    () => screen.debugCommits({ maxCommits: 0 }),
    /maxCommits must be an integer from 1 through 100/u,
  );
  assert.throws(
    () => screen.debugCommits({ maxMutations: 2_001 }),
    /maxMutations must be an integer from 1 through 2000/u,
  );
  assert.throws(
    () => screen.debugCommits({ includeValues: "yes" }),
    /includeValues must be a boolean/u,
  );
  assert.match(screen.debug(), /#text node=3 "Count: 1"/u);
  assert.match(
    screen.debug({ includeProps: true }),
    /<Pressable node=6 .* props=\{"accessibilityLabel":"Increment count","accessibilityRole":"button","accessibilityState":\{\},"accessible":true,"collapsable":false,"focusable":true,"pointerEvents":"box-only","testID":"increment"\}>/u,
  );
  assert.match(screen.debug({ maxNodes: 2 }), /… 5 node\(s\) omitted$/u);
  assert.match(screen.debug({ maxDepth: 1 }), /… depth limit/u);
  assert.throws(() => screen.debug({ maxNodes: 0 }), /from 1 through 1000/u);
  assert.throws(() => screen.debug({ maxDepth: 257 }), /from 1 through 256/u);
  assert.throws(
    () => screen.debug({ includeProps: "yes" }),
    /includeProps must be a boolean/u,
  );

  await screen.cleanup();
  screen.assertDisposed();
  assert.equal(screen.disposed, true);
  assert.equal(screen.host.hasSurface(screen.surfaceId), false);
  await screen.cleanup();
  assert.throws(
    () => screen.snapshot(),
    /Cannot inspect a disposed native test render/u,
  );
});

test("matches render-scoped commits and structural mutations after explicit checkpoints", async () => {
  let pressableRef;
  let setCount;
  const screen = await renderNative(() => {
    const [count, writeCount] = createSignal(0);
    setCount = writeCount;
    return createComponent(View, {
      children: [
        createComponent(Text, {
          get children() {
            return `Count: ${String(count())}`;
          },
        }),
        createComponent(Pressable, {
          ref: (node) => {
            pressableRef = node;
          },
          accessibilityRole: "button",
          accessibilityLabel: "Increment",
          onPress: () => setCount((value) => value + 1),
          children: createComponent(Text, { children: "Increment" }),
        }),
      ],
    });
  });

  try {
    const checkpoint = screen.commitCheckpoint();
    assert.equal(checkpoint, 1);
    const button = screen.getByRole("button", { name: "Increment" });
    const container = screen.getByComponent("View");

    const create = screen.getMutation({
      type: "create-element",
      component: "Pressable",
      node: button,
    });
    assert.equal(create.commit.sequence, 1);
    assert.equal(create.mutation.component, "Pressable");
    assert.equal(
      screen.getMutation({
        type: "insert-child",
        parent: container,
        child: button,
        before: null,
      }).mutation.child,
      button.node,
    );
    assert.deepEqual(
      screen.getMutation({
        type: "update-event-listeners",
        node: button,
        events: [
          "pressOut",
          "pressMove",
          "pressIn",
          "pressCancel",
          "press",
          "layout",
        ],
      }).mutation.events,
      ["layout", "press", "pressCancel", "pressIn", "pressMove", "pressOut"],
    );

    await screen.press(button);
    const updateCommit = screen.getCommit({
      afterSequence: checkpoint,
      priority: "user-blocking",
      mutationTypes: ["update-text"],
    });
    assert.equal(updateCommit.sequence, 2);
    assert.equal(
      screen.queryCommit({ sequence: updateCommit.sequence })?.sequence,
      updateCommit.sequence,
    );
    const update = screen.getMutation({
      type: "update-text",
      afterSequence: checkpoint,
      priority: "user-blocking",
    });
    assert.equal(update.commit.sequence, 2);
    assert.equal(update.index, 0);
    assert.equal(update.mutation.text, "Count: 1");
    assert.equal(
      screen.queryAllMutations({
        type: "update-text",
        afterSequence: checkpoint,
      }).length,
      1,
    );
    assert.equal(
      screen.queryMutation({
        type: "update-props",
        afterSequence: checkpoint,
      }),
      undefined,
    );

    const commandCheckpoint = screen.commitCheckpoint();
    await pressableRef.focus();
    const command = screen.getMutation({
      type: "command",
      node: button,
      command: "focus",
      afterSequence: commandCheckpoint,
    });
    assert.equal(command.commit.sequence, 3);
    assert.deepEqual(command.mutation.args, []);
  } finally {
    await screen.cleanup();
  }
});

test("reports bounded value-free commit and mutation matcher failures", async () => {
  const secret = "private-value-that-must-not-leak";
  const first = await renderNative(() =>
    createComponent(View, {
      children: [
        createComponent(Text, { children: secret }),
        createComponent(Text, { children: "Second" }),
      ],
    }),
  );
  const second = await renderNative(() =>
    createComponent(Text, { children: "Other render" }),
  );
  try {
    assert.throws(
      () => first.getCommit({ afterSequence: first.commitCheckpoint() }),
      (error) => {
        assert.ok(error instanceof NativeTestCommitQueryError);
        assert.equal(error.matchCount, 0);
        assert.match(error.message, /after sequence 1/u);
        assert.match(error.message, /Native commits/u);
        assert.doesNotMatch(error.message, new RegExp(secret, "u"));
        return true;
      },
    );
    assert.throws(
      () => first.queryMutation({ type: "create-text" }),
      (error) => {
        assert.ok(error instanceof NativeTestMutationQueryError);
        assert.equal(error.matchCount, 2);
        assert.match(error.message, /expected exactly one/u);
        assert.doesNotMatch(error.message, new RegExp(secret, "u"));
        return true;
      },
    );
    assert.throws(
      () =>
        first.getMutation({
          type: "create-element",
          node: second.getByComponent("Text"),
        }),
      /belongs to another render/u,
    );
    assert.throws(
      () => first.getCommit({ priority: "urgent" }),
      /commit priority must be/u,
    );
    assert.throws(
      () => first.getCommit({ mutationTypes: ["replace-world"] }),
      /contains invalid kind/u,
    );
    assert.throws(
      () =>
        first.getMutation({
          type: "update-text",
          command: "focus",
        }),
      /unknown field "command"/u,
    );
    assert.throws(
      () => first.getMutation({ type: "update-props", setProps: ["x", "x"] }),
      /cannot contain duplicates/u,
    );
  } finally {
    await Promise.all([first.cleanup(), second.cleanup()]);
  }

  assert.throws(
    () => first.commitCheckpoint(),
    /Cannot inspect commits for a disposed native test render/u,
  );
  assert.throws(
    () => first.queryAllCommits(),
    /Cannot inspect commits for a disposed native test render/u,
  );
});

test("reports absent and ambiguous semantic queries with bounded native context", async () => {
  const screen = await renderNative(() =>
    createComponent(View, {
      children: [
        createComponent(View, {
          testID: "left",
          children: [
            createComponent(Text, { children: "Duplicate" }),
            createComponent(Text, { children: "Left only" }),
          ],
        }),
        createComponent(View, {
          testID: "right",
          children: [
            createComponent(Text, { children: "Duplicate" }),
            createComponent(Text, { children: "Right only" }),
          ],
        }),
      ],
    }),
  );
  try {
    assert.throws(
      () => screen.getByText("Missing"),
      (error) => {
        assert.ok(error instanceof NativeTestQueryError);
        assert.equal(error.matchCount, 0);
        assert.match(error.message, /Available: <RootView/u);
        return true;
      },
    );
    assert.throws(
      () => screen.queryByText(/duplicate/iu),
      (error) => {
        assert.ok(error instanceof NativeTestQueryError);
        assert.equal(error.matchCount, 2);
        assert.match(error.message, /expected exactly one/u);
        return true;
      },
    );
    assert.equal(screen.queryAllByText("Duplicate").length, 2);
    const left = screen.within(screen.getByTestId("left"));
    assert.equal(left.root.props.testID, "left");
    assert.equal(left.getByText("Duplicate").textContent, "Duplicate");
    assert.equal(left.queryAllByComponent("Text").length, 2);
    assert.throws(
      () => left.getByText("Missing"),
      (error) => {
        assert.ok(error instanceof NativeTestQueryError);
        assert.match(error.message, /Left only/u);
        assert.doesNotMatch(error.message, /Right only/u);
        return true;
      },
    );
  } finally {
    await screen.cleanup();
  }
});

test("waits for bounded asynchronous Solid updates with native timeout diagnostics", async () => {
  let setStatus;
  const screen = await renderNative(() => {
    const [status, writeStatus] = createSignal("Loading");
    setStatus = writeStatus;
    return createComponent(View, {
      testID: "async-root",
      get children() {
        return status() === "Loading"
          ? createComponent(Text, { children: "Loading" })
          : createComponent(Pressable, {
              accessibilityRole: "button",
              accessibilityLabel: "Loaded result",
              testID: "loaded",
              onPress: () => undefined,
              children: createComponent(Text, { children: "Loaded" }),
            });
      },
    });
  });
  try {
    const scope = screen.within(screen.getByTestId("async-root"));
    const pending = scope.findByText("Loaded", {
      timeout: 250,
      interval: 2,
    });
    setTimeout(() => setStatus("Loaded"), 5);
    assert.equal((await pending).textContent, "Loaded");
    const loaded = screen.getByTestId("loaded");
    assert.equal((await scope.findByComponent("Pressable")).node, loaded.node);
    assert.equal((await scope.findByTestId("loaded")).node, loaded.node);
    assert.equal(
      (await scope.findByLabelText("Loaded result")).node,
      loaded.node,
    );
    assert.equal(
      (
        await scope.findByRole("button", {
          name: /loaded result/iu,
        })
      ).node,
      loaded.node,
    );
    assert.equal(screen.commits.length, 2);

    await assert.rejects(
      screen.findByText("Never", {
        timeout: 10,
        interval: 1,
      }),
      (error) => {
        assert.ok(error instanceof NativeTestWaitTimeoutError);
        assert.equal(error.timeout, 10);
        assert.ok(error.attempts >= 1);
        assert.ok(error.cause instanceof NativeTestQueryError);
        assert.match(error.message, /Last assertion: Unable to find/u);
        assert.match(error.message, /Native surface "test"/u);
        assert.match(error.message, /#text node=\d+ "Loaded"/u);
        assert.match(error.message, /Native commits \(showing 2 of 2\)/u);
        return true;
      },
    );

    const controller = new AbortController();
    const reason = new Error("cancel this assertion");
    controller.abort(reason);
    await assert.rejects(
      screen.waitFor(() => screen.getByText("Never"), {
        signal: controller.signal,
      }),
      (error) => {
        assert.ok(error instanceof NativeTestWaitAbortedError);
        assert.equal(error.cause, reason);
        return true;
      },
    );
    await assert.rejects(
      screen.waitFor(() => undefined, { timeout: 0 }),
      /timeout must be an integer from 1 through 60000/u,
    );
    await assert.rejects(
      screen.waitFor(() => undefined, { interval: 0 }),
      /interval must be an integer from 1 through 1000/u,
    );
    await assert.rejects(
      screen.waitFor(() => undefined, { signal: {} }),
      /signal must be an AbortSignal/u,
    );
    await assert.rejects(
      screen.waitFor(async () => undefined),
      /assertions must be synchronous/u,
    );
  } finally {
    await screen.cleanup();
  }
});

test("rejects stale and cross-surface event targets", async () => {
  let hide;
  const first = await renderNative(() => {
    const [visible, setVisible] = createSignal(true);
    hide = () => setVisible(false);
    return createComponent(View, {
      get children() {
        return visible()
          ? createComponent(Pressable, {
              accessibilityRole: "button",
              onPress: () => undefined,
              children: createComponent(Text, { children: "Transient" }),
            })
          : createComponent(Text, { children: "Gone" });
      },
    });
  });
  const second = await renderNative(() =>
    createComponent(Pressable, {
      accessibilityRole: "button",
      onPress: () => undefined,
      children: createComponent(Text, { children: "Other" }),
    }),
  );
  try {
    const stale = first.getByRole("button");
    const staleScope = first.within(stale);
    assert.throws(
      () => first.within(second.getByRole("button")),
      /belongs to another render/u,
    );
    await first.act(() => hide());
    assert.throws(
      () => staleScope.getByComponent("Pressable"),
      /scope root .* no longer mounted/u,
    );
    await assert.rejects(first.press(stale), /is no longer mounted/u);
    await assert.rejects(
      first.press(second.getByRole("button")),
      /belongs to another render/u,
    );
  } finally {
    await Promise.all([first.cleanup(), second.cleanup()]);
  }
});

test("supports an explicitly configured host without mixing host ownership modes", async () => {
  const host = new InMemoryHost({
    descriptors: CORE_COMPONENT_DESCRIPTORS,
    platform: "custom",
  });
  await assert.rejects(
    renderNative(() => undefined, {
      host,
      hostOptions: { platform: "android" },
    }),
    /cannot combine host and hostOptions/u,
  );

  const first = await renderNative(
    () => createComponent(Text, { children: "First" }),
    { host },
  );
  const second = await renderNative(
    () => createComponent(Text, { children: "Second" }),
    { host },
  );
  assert.notEqual(first.surfaceId, second.surfaceId);
  assert.equal(first.commits.length, 1);
  assert.equal(second.commits.length, 1);
  assert.equal(first.getByText("First").host, host);
  await Promise.all([first.cleanup(), second.cleanup()]);

  const screen = await renderNative(() => undefined, {
    hostOptions: { platform: "ios" },
    surface: { name: "configured" },
  });
  assert.equal(screen.host.platform, "ios");
  assert.equal(screen.snapshot().name, "configured");
  assert.equal(screen.commits.length, 1);
  await screen.cleanup();
});
