import assert from "node:assert/strict";
import test from "node:test";

import {
  REACT_NATIVE_0_87_BACKEND,
  NativeFabricSurfaceOwnershipError,
  NativeSurfaceStartupError,
  createNativeFabricHost,
  createNativeHostTransaction,
  inspectNativeBackend,
  waitForNativeSurface,
} from "@solid-native/fabric-host";

test("owns bounded native surface readiness without a framework runtime", async () => {
  let polls = 0;
  const binding = {
    getSurfaceInfo: () => {
      polls += 1;
      return {
        ready: polls === 3,
        surface: polls === 3 ? 17 : 0,
        sequence: 0,
        retainedNodeCount: 0,
        retainedResourceCount: 0,
      };
    },
  };

  assert.deepEqual(
    await waitForNativeSurface({
      binding,
      timeoutMs: 100,
      pollIntervalMs: 1,
    }),
    {
      ready: true,
      surface: 17,
      sequence: 0,
      retainedNodeCount: 0,
      retainedResourceCount: 0,
    },
  );
  assert.equal(polls, 3);

  await assert.rejects(
    () =>
      waitForNativeSurface({
        binding: {
          getSurfaceInfo: () => ({
            ready: false,
            surface: 0,
            sequence: 0,
            retainedNodeCount: 0,
            retainedResourceCount: 0,
          }),
        },
        timeoutMs: 0,
      }),
    NativeSurfaceStartupError,
  );
  await assert.rejects(
    () => waitForNativeSurface({ binding, pollIntervalMs: 0 }),
    /pollIntervalMs must be a safe integer from 1 through 1000 milliseconds/u,
  );
});

test("encodes a pinned Fabric transaction without a framework runtime", () => {
  const transaction = createNativeHostTransaction(
    {
      surface: 7,
      sequence: 1,
      priority: "normal",
      mutations: [
        {
          type: "create-element",
          node: 1,
          component: "RootView",
          props: {
            selectionColor: "#112233",
            style: { backgroundColor: "#146ef5" },
            underlineColorAndroid: "transparent",
          },
        },
      ],
    },
    "android",
  );

  assert.deepEqual(transaction, {
    contractVersion: 1,
    surface: 7,
    sequence: 1,
    priority: "normal",
    mutations: [
      {
        type: "create-element",
        node: 1,
        component: "RootView",
        props: {
          selectionColor: 0xff112233 | 0,
          style: { backgroundColor: 0xff146ef5 | 0 },
          underlineColorAndroid: 0x00000000,
        },
      },
    ],
  });
  assert.equal(
    inspectNativeBackend({
      backend: "react-native-fabric",
      backendVersion: "0.87.0",
      platform: "android",
      engine: "hermes",
      engineVersion: "250829098.0.16",
      hostContractVersion: 1,
      fabricEnabled: true,
    }).compatible,
    true,
  );
  assert.equal(REACT_NATIVE_0_87_BACKEND.packageVersion, "0.87.0");
  assert.equal(REACT_NATIVE_0_87_BACKEND.backendVersion, "0.87.0");
  assert.equal(REACT_NATIVE_0_87_BACKEND.engineVersion, "250829098.0.16");
  assert.equal(REACT_NATIVE_0_87_BACKEND.engineBytecodeVersion, 98);
});

test("normalizes colors throughout native appearance objects", () => {
  const standardAppearance = {
    tabBarBackgroundColor: "#102030",
    selected: {
      tabBarItemTitleFontColor: "#405060",
      tabBarItemIconColor: "rebeccapurple",
    },
    tabBarItemActiveIndicatorColor: "transparent",
  };
  const transaction = createNativeHostTransaction(
    {
      surface: 11,
      sequence: 2,
      priority: "normal",
      mutations: [
        {
          type: "update-props",
          node: 4,
          props: {
            standardAppearance,
            scrollEdgeAppearance: {
              stacked: {
                normal: { tabBarItemBadgeBackgroundColor: "#708090" },
              },
            },
          },
          removedProps: [],
        },
      ],
    },
    "ios",
  );

  assert.deepEqual(transaction.mutations[0].props, {
    standardAppearance: {
      tabBarBackgroundColor: 0xff102030,
      selected: {
        tabBarItemTitleFontColor: 0xff405060,
        tabBarItemIconColor: 0xff663399,
      },
      tabBarItemActiveIndicatorColor: 0x00000000,
    },
    scrollEdgeAppearance: {
      stacked: {
        normal: { tabBarItemBadgeBackgroundColor: 0xff708090 },
      },
    },
  });
  assert.equal(standardAppearance.tabBarBackgroundColor, "#102030");
});

test("normalizes Android ripple drawable colors without mutating props", () => {
  const nativeBackgroundAndroid = {
    type: "RippleAndroid",
    color: "#33669980",
    borderless: false,
    rippleRadius: 24,
    alpha: 0.7,
  };
  const transaction = createNativeHostTransaction(
    {
      surface: 12,
      sequence: 1,
      priority: "user-blocking",
      mutations: [
        {
          type: "create-element",
          node: 2,
          component: "Pressable",
          props: { nativeBackgroundAndroid },
        },
      ],
    },
    "android",
  );

  assert.deepEqual(transaction.mutations[0].props.nativeBackgroundAndroid, {
    type: "RippleAndroid",
    color: 0x80336699 | 0,
    borderless: false,
    rippleRadius: 24,
    alpha: 0.7,
  });
  assert.equal(nativeBackgroundAndroid.color, "#33669980");
});

test("normalizes pull-to-refresh color arrays without mutating them", () => {
  const colors = ["#146ef5", "rebeccapurple"];
  const transaction = createNativeHostTransaction(
    {
      surface: 13,
      sequence: 1,
      priority: "normal",
      mutations: [
        {
          type: "create-element",
          node: 2,
          component: "RefreshControl",
          props: { colors },
        },
      ],
    },
    "android",
  );

  assert.deepEqual(transaction.mutations[0].props.colors, [
    0xff146ef5 | 0,
    0xff663399 | 0,
  ]);
  assert.deepEqual(colors, ["#146ef5", "rebeccapurple"]);
});

test("rejects invalid colors inside native appearance objects with a precise path", () => {
  assert.throws(
    () =>
      createNativeHostTransaction(
        {
          surface: 11,
          sequence: 3,
          priority: "normal",
          mutations: [
            {
              type: "create-element",
              node: 4,
              component: "TabsScreen",
              props: {
                standardAppearance: {
                  selected: {
                    tabBarItemIconColor: "definitely-not-a-color",
                  },
                },
              },
            },
          ],
        },
        "android",
      ),
    /standardAppearance\.selected\.tabBarItemIconColor is not a valid React Native color/,
  );
});

test("owns a Fabric surface through only the neutral NativeHost contract", async () => {
  let ready = true;
  const commits = [];
  const binding = {
    contractVersion: 1,
    backend: "react-native-fabric",
    backendVersion: "0.87.0",
    platform: "ios",
    getSurfaceInfo: () => ({
      ready,
      surface: ready ? 31 : 0,
      sequence: 0,
      retainedNodeCount: 0,
      retainedResourceCount: 0,
    }),
    setEventHandler: () => {},
    retainNativeResource: () => 1,
    releaseNativeResource: () => {},
    measure: (_node, afterSequence = 0) => ({
      x: 0,
      y: 0,
      width: 10,
      height: 20,
      pageX: 0,
      pageY: 0,
      observedSequence: afterSequence,
    }),
    commit: (transaction) => {
      commits.push(transaction);
      return {
        surface: transaction.surface,
        sequence: transaction.sequence,
        mounted: true,
      };
    },
    destroySurface: () => {
      ready = false;
    },
  };
  const host = createNativeFabricHost({
    binding,
    descriptors: [
      {
        name: "RootView",
        acceptsRawText: false,
        bubblingEvents: [],
        directEvents: [],
        commands: {},
      },
    ],
  });
  const surface = host.createSurface({ name: "framework-free" });
  const root = host.allocateNode(surface);

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
  });
  host.commit({
    surface,
    sequence: 2,
    priority: "normal",
    mutations: [{ type: "delete-node", node: root }],
  });
  await host.destroySurface(surface);

  assert.equal(root, 1);
  assert.equal(commits.length, 2);
  assert.equal(ready, false);
});

test("leases one native binding to exactly one active Fabric host", async () => {
  let ready = false;
  let surface = 41;
  let destroyFails = true;
  const binding = {
    contractVersion: 1,
    backend: "react-native-fabric",
    backendVersion: "0.87.0",
    platform: "ios",
    getSurfaceInfo: () => ({
      ready,
      surface: ready ? surface : 0,
      sequence: 0,
      retainedNodeCount: 0,
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
      observedSequence: 0,
    }),
    commit: (transaction) => ({
      surface: transaction.surface,
      sequence: transaction.sequence,
      mounted: true,
    }),
    destroySurface: () => {
      if (destroyFails) throw new Error("native stop rejected");
      ready = false;
    },
  };
  const descriptors = [
    {
      name: "RootView",
      acceptsRawText: false,
      bubblingEvents: [],
      directEvents: [],
      commands: {},
    },
  ];
  const first = createNativeFabricHost({ binding, descriptors });
  const second = createNativeFabricHost({ binding, descriptors });

  assert.throws(
    () => first.createSurface({ name: "not-ready" }),
    /native Fabric surface is not ready/u,
  );

  // A failed transfer releases its provisional lease.
  ready = true;
  assert.equal(second.createSurface({ name: "second" }), 41);
  assert.throws(
    () => first.createSurface({ name: "competing" }),
    NativeFabricSurfaceOwnershipError,
  );
  await assert.rejects(
    () => second.destroySurface(41),
    /native stop rejected/u,
  );
  assert.throws(
    () => first.createSurface({ name: "while-stop-failed" }),
    NativeFabricSurfaceOwnershipError,
  );

  destroyFails = false;
  await second.destroySurface(41);

  // A completed native teardown releases the binding for its next surface.
  ready = true;
  surface = 42;
  assert.equal(first.createSurface({ name: "replacement" }), 42);
  await first.destroySurface(42);
});
