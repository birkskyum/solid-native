import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryHost } from "../dist/index.js";

const descriptors = [
  {
    name: "View",
    acceptsRawText: false,
    bubblingEvents: [],
    directEvents: [],
    commands: {},
  },
  {
    name: "Text",
    acceptsRawText: true,
    bubblingEvents: [],
    directEvents: [],
    commands: {},
  },
  {
    name: "Pressable",
    acceptsRawText: false,
    bubblingEvents: ["longPress", "press", "pressIn"],
    directEvents: [],
    commands: { focus: [] },
  },
];

function createHost() {
  return new InMemoryHost({ descriptors });
}

test("applies a complete tree commit atomically", () => {
  const host = createHost();
  const surface = host.createSurface({ name: "test" });
  const view = host.allocateNode(surface);
  const text = host.allocateNode(surface);
  const value = host.allocateNode(surface);

  assert.throws(
    () =>
      host.commit({
        surface,
        sequence: 1,
        priority: "normal",
        mutations: [
          { type: "create-element", node: view, component: "View", props: {} },
          { type: "create-text", node: value, text: "invalid" },
          { type: "insert-child", parent: view, child: value },
        ],
      }),
    /does not accept raw text/,
  );
  assert.deepEqual(host.getSurfaceSnapshot(surface).nodes, []);

  const result = host.commit({
    surface,
    sequence: 1,
    priority: "normal",
    mutations: [
      {
        type: "create-element",
        node: view,
        component: "View",
        props: { role: "main" },
      },
      { type: "create-element", node: text, component: "Text", props: {} },
      { type: "create-text", node: value, text: "Hello" },
      { type: "insert-child", parent: text, child: value },
      { type: "insert-child", parent: view, child: text },
    ],
  });

  assert.deepEqual(result, {
    surface,
    sequence: 1,
    mounted: true,
    hostRevision: 1,
  });
  assert.equal(host.commits.length, 1);
  assert.deepEqual(host.getSurfaceSnapshot(surface).nodes, [
    {
      kind: "element",
      node: view,
      component: "View",
      props: { role: "main" },
      eventListeners: [],
      parent: null,
      children: [text],
    },
    {
      kind: "element",
      node: text,
      component: "Text",
      props: {},
      eventListeners: [],
      parent: view,
      children: [value],
    },
    { kind: "text", node: value, text: "Hello", parent: text },
  ]);
});

test("updates, moves, removes, and deletes nodes", () => {
  const host = createHost();
  const surface = host.createSurface({ name: "mutations" });
  const first = host.allocateNode(surface);
  const second = host.allocateNode(surface);
  const child = host.allocateNode(surface);

  host.commit({
    surface,
    sequence: 1,
    priority: "normal",
    mutations: [
      {
        type: "create-element",
        node: first,
        component: "View",
        props: { stale: true },
      },
      { type: "create-element", node: second, component: "View", props: {} },
      {
        type: "create-element",
        node: child,
        component: "Pressable",
        props: {},
      },
      { type: "insert-child", parent: first, child },
    ],
  });
  host.commit({
    surface,
    sequence: 2,
    priority: "user-blocking",
    mutations: [
      {
        type: "update-props",
        node: first,
        props: { current: true },
        removedProps: ["stale"],
      },
      { type: "insert-child", parent: second, child },
      { type: "command", node: child, command: "focus", args: [] },
    ],
  });

  const moved = host.getSurfaceSnapshot(surface);
  assert.deepEqual(moved.nodes[0].props, { current: true });
  assert.deepEqual(moved.nodes[0].children, []);
  assert.deepEqual(moved.nodes[1].children, [child]);

  host.commit({
    surface,
    sequence: 3,
    priority: "normal",
    mutations: [
      { type: "remove-child", parent: second, child },
      { type: "delete-node", node: child },
    ],
  });
  assert.equal(host.getSurfaceSnapshot(surface).nodes.length, 2);
});

test("injects events and returns deterministic measurements", () => {
  const host = createHost();
  const surface = host.createSurface({ name: "events" });
  const target = host.allocateNode(surface);
  host.commit({
    surface,
    sequence: 4,
    priority: "normal",
    mutations: [
      {
        type: "create-element",
        node: target,
        component: "Pressable",
        props: {},
      },
      {
        type: "update-event-listeners",
        node: target,
        events: ["press"],
      },
    ],
  });

  const received = [];
  const unsubscribe = host.subscribe((event) => received.push(event));
  const event = host.injectEvent({
    surface,
    target,
    name: "press",
    payload: { pointer: "touch" },
    priority: "discrete",
    bubbles: true,
    timestamp: 123,
  });
  unsubscribe();
  host.injectEvent({ surface, target, name: "press" });

  assert.equal(received.length, 1);
  assert.deepEqual(received[0], event);
  assert.equal(event.observedSequence, 4);

  host.setMeasurement(surface, target, {
    x: 1,
    y: 2,
    width: 100,
    height: 50,
    pageX: 3,
    pageY: 4,
  });
  assert.deepEqual(host.measure(surface, target, 4), {
    x: 1,
    y: 2,
    width: 100,
    height: 50,
    pageX: 3,
    pageY: 4,
    observedSequence: 4,
  });
  assert.throws(() => host.measure(surface, target, 5), /latest commit is 4/);
});

test("validates event subscriptions atomically", () => {
  const host = createHost();
  const surface = host.createSurface({ name: "event-subscriptions" });
  const target = host.allocateNode(surface);

  assert.throws(
    () =>
      host.commit({
        surface,
        sequence: 1,
        priority: "normal",
        mutations: [
          {
            type: "create-element",
            node: target,
            component: "Pressable",
            props: {},
          },
          {
            type: "update-event-listeners",
            node: target,
            events: ["pressIn", "press"],
          },
        ],
      }),
    /must be sorted/,
  );
  assert.deepEqual(host.getSurfaceSnapshot(surface).nodes, []);

  host.commit({
    surface,
    sequence: 1,
    priority: "normal",
    mutations: [
      {
        type: "create-element",
        node: target,
        component: "Pressable",
        props: {},
      },
      {
        type: "update-event-listeners",
        node: target,
        events: ["press", "pressIn"],
      },
    ],
  });
  assert.deepEqual(host.getSurfaceSnapshot(surface).nodes[0].eventListeners, [
    "press",
    "pressIn",
  ]);
  assert.throws(
    () => host.injectEvent({ surface, target, name: "longPress" }),
    /is not observing event longPress/,
  );
});

test("rejects stale commits without changing state", () => {
  const host = createHost();
  const surface = host.createSurface({ name: "ordering" });
  const node = host.allocateNode(surface);
  host.commit({
    surface,
    sequence: 10,
    priority: "normal",
    mutations: [{ type: "create-element", node, component: "View", props: {} }],
  });

  assert.throws(
    () =>
      host.commit({
        surface,
        sequence: 10,
        priority: "normal",
        mutations: [],
      }),
    /must be greater than 10/,
  );
  assert.equal(host.commits.length, 1);
  assert.equal(host.getSurfaceSnapshot(surface).sequence, 10);
});

test("rolls back measurement cleanup when a commit fails", () => {
  const host = createHost();
  const surface = host.createSurface({ name: "rollback" });
  const node = host.allocateNode(surface);
  host.commit({
    surface,
    sequence: 1,
    priority: "normal",
    mutations: [{ type: "create-element", node, component: "View", props: {} }],
  });
  host.setMeasurement(surface, node, {
    x: 1,
    y: 1,
    width: 20,
    height: 20,
    pageX: 1,
    pageY: 1,
  });

  assert.throws(
    () =>
      host.commit({
        surface,
        sequence: 2,
        priority: "normal",
        mutations: [
          { type: "delete-node", node },
          { type: "update-props", node, props: {}, removedProps: [] },
        ],
      }),
    /does not exist/,
  );
  assert.equal(host.measure(surface, node).width, 20);
  assert.equal(host.getSurfaceSnapshot(surface).sequence, 1);
});

test("does not satisfy an after-sequence read with stale measurement data", () => {
  const host = createHost();
  const surface = host.createSurface({ name: "measurement-ordering" });
  const node = host.allocateNode(surface);
  host.commit({
    surface,
    sequence: 1,
    priority: "normal",
    mutations: [{ type: "create-element", node, component: "View", props: {} }],
  });
  host.setMeasurement(surface, node, {
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    pageX: 0,
    pageY: 0,
  });
  host.commit({
    surface,
    sequence: 2,
    priority: "normal",
    mutations: [
      {
        type: "update-props",
        node,
        props: { width: 20 },
        removedProps: [],
      },
    ],
  });

  assert.throws(
    () => host.measure(surface, node, 2),
    /only observes sequence 1/,
  );
});
