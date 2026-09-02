import "react-native/setup-env";

import {
  createNativeFabricHost,
  getNativeHostBinding,
  readNativeSurfaceInfo,
  waitForNativeSurface,
} from "@solid-native/fabric-host";
import type {
  HostCommitResult,
  HostLifecycleEvent,
  HostMutation,
  NativeComponentDescriptor,
  NativeEvent,
  NodeHandle,
} from "@solid-native/host-contract";

const PROOF_TIMEOUT_MS = 5_000;
const ROOT_TITLE = "Framework-free Fabric Host";
const INITIAL_STATE = "Fabric Host mounted without a framework renderer";
const UPDATED_STATE = "Physical press updated Fabric through NativeHost";
const UPDATE_LABEL = "Update framework-free Fabric tree";
const DISPOSE_LABEL = "Dispose framework-free Fabric tree";

const DESCRIPTORS: readonly NativeComponentDescriptor[] = [
  {
    name: "RootView",
    acceptsRawText: false,
    bubblingEvents: [],
    directEvents: [],
    commands: {},
  },
  {
    name: "View",
    acceptsRawText: false,
    bubblingEvents: [],
    directEvents: [],
    commands: { accessibilityFocus: [] },
  },
  {
    name: "Text",
    acceptsRawText: true,
    bubblingEvents: ["press"],
    directEvents: [],
    commands: { accessibilityFocus: [] },
  },
  {
    name: "Pressable",
    acceptsRawText: false,
    bubblingEvents: ["longPress", "press", "pressIn", "pressOut"],
    directEvents: [],
    commands: { accessibilityFocus: [], blur: [], focus: [] },
  },
];

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function waitFor(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  const deadline = Date.now() + PROOF_TIMEOUT_MS;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await delay(10);
  }
}

function reportFatal(error: unknown): void {
  console.error("SOLID_NATIVE_FABRIC_HOST_FAILED", error);
  setTimeout(() => {
    throw error instanceof Error ? error : new Error(String(error));
  });
}

function requireStructuralCommit(
  result: HostCommitResult,
  sequence: number,
): number {
  invariant(
    result.sequence === sequence &&
      result.mounted &&
      Number.isSafeInteger(result.hostRevision) &&
      (result.hostRevision ?? 0) > 0,
    `Fabric Host commit ${String(sequence)} did not publish an exact native revision.`,
  );
  return result.hostRevision as number;
}

async function run(): Promise<void> {
  try {
    const binding = getNativeHostBinding();
    await waitForNativeSurface({ binding, timeoutMs: PROOF_TIMEOUT_MS });
    const host = createNativeFabricHost({ binding, descriptors: DESCRIPTORS });
    invariant(
      host.platform === "android" || host.platform === "ios",
      `The framework-free physical proof requires Android or iOS, received ${JSON.stringify(host.platform)}.`,
    );
    const surface = host.createSurface({ name: "framework-free-fabric-host" });
    const nodes = {
      root: host.allocateNode(surface),
      content: host.allocateNode(surface),
      title: host.allocateNode(surface),
      titleText: host.allocateNode(surface),
      state: host.allocateNode(surface),
      stateText: host.allocateNode(surface),
      update: host.allocateNode(surface),
      updateLabel: host.allocateNode(surface),
      updateLabelText: host.allocateNode(surface),
      dispose: host.allocateNode(surface),
      disposeLabel: host.allocateNode(surface),
      disposeLabelText: host.allocateNode(surface),
    } as const;
    const mountedSequences = new Set<number>();
    const framedSequences = new Set<number>();
    const lifecycle: HostLifecycleEvent[] = [];
    let phase: "mounted" | "updated" | "disposing" = "mounted";
    let handlingEvent = false;

    const detachLifecycle = host.subscribeLifecycle?.((event) => {
      lifecycle.push(event);
      if (event.type === "commit-mounted") {
        mountedSequences.add(event.sequence);
      } else {
        framedSequences.add(event.sequence);
      }
    });
    invariant(
      detachLifecycle !== undefined,
      "The physical Fabric Host did not expose commit lifecycle events.",
    );

    const teardownMutations = (): readonly HostMutation[] => [
      { type: "remove-child", parent: nodes.title, child: nodes.titleText },
      { type: "delete-node", node: nodes.titleText },
      { type: "remove-child", parent: nodes.content, child: nodes.title },
      { type: "delete-node", node: nodes.title },
      { type: "remove-child", parent: nodes.state, child: nodes.stateText },
      { type: "delete-node", node: nodes.stateText },
      { type: "remove-child", parent: nodes.content, child: nodes.state },
      { type: "delete-node", node: nodes.state },
      {
        type: "remove-child",
        parent: nodes.updateLabel,
        child: nodes.updateLabelText,
      },
      { type: "delete-node", node: nodes.updateLabelText },
      {
        type: "remove-child",
        parent: nodes.update,
        child: nodes.updateLabel,
      },
      { type: "delete-node", node: nodes.updateLabel },
      { type: "remove-child", parent: nodes.content, child: nodes.update },
      { type: "delete-node", node: nodes.update },
      {
        type: "remove-child",
        parent: nodes.disposeLabel,
        child: nodes.disposeLabelText,
      },
      { type: "delete-node", node: nodes.disposeLabelText },
      {
        type: "remove-child",
        parent: nodes.dispose,
        child: nodes.disposeLabel,
      },
      { type: "delete-node", node: nodes.disposeLabel },
      { type: "remove-child", parent: nodes.content, child: nodes.dispose },
      { type: "delete-node", node: nodes.dispose },
      { type: "remove-child", parent: nodes.root, child: nodes.content },
      { type: "delete-node", node: nodes.content },
      { type: "delete-node", node: nodes.root },
    ];

    const handleEvent = async (event: NativeEvent): Promise<void> => {
      invariant(
        !handlingEvent,
        "Fabric Host delivered overlapping press events.",
      );
      handlingEvent = true;
      try {
        invariant(
          event.surface === surface &&
            event.name === "press" &&
            event.priority === "discrete" &&
            event.bubbles &&
            !event.coalescible,
          "Fabric Host delivered malformed framework-free press metadata.",
        );
        if (phase === "mounted") {
          invariant(
            event.target === nodes.update && event.observedSequence >= 1,
            "The first physical press did not target the update node.",
          );
          const revision = requireStructuralCommit(
            host.commit({
              surface,
              sequence: 2,
              priority: "user-blocking",
              causalContext: { operationId: "fabric-host-physical-update" },
              mutations: [
                {
                  type: "update-text",
                  node: nodes.stateText,
                  text: UPDATED_STATE,
                },
              ],
            }),
            2,
          );
          phase = "updated";
          console.log(
            "SOLID_NATIVE_FABRIC_HOST_UPDATE_SUCCEEDED",
            JSON.stringify({
              observedSequence: event.observedSequence,
              revision,
            }),
          );
          return;
        }

        invariant(
          phase === "updated" &&
            event.target === nodes.dispose &&
            event.observedSequence >= 2,
          "The second physical press did not target the disposal node after the update.",
        );
        phase = "disposing";
        await waitFor(
          () =>
            mountedSequences.has(1) &&
            framedSequences.has(1) &&
            mountedSequences.has(2) &&
            framedSequences.has(2),
          "Fabric Host did not publish the initial and updated mount-to-frame boundaries.",
        );
        console.log(
          "SOLID_NATIVE_FABRIC_HOST_FRAME_SUCCEEDED",
          JSON.stringify({ lifecycleCount: lifecycle.length }),
        );
        const revision = requireStructuralCommit(
          host.commit({
            surface,
            sequence: 3,
            priority: "user-blocking",
            causalContext: { operationId: "fabric-host-physical-teardown" },
            mutations: teardownMutations(),
          }),
          3,
        );
        await waitFor(
          () => mountedSequences.has(3),
          "Fabric Host did not publish the teardown mount boundary.",
        );
        await host.destroySurface(surface);
        invariant(
          !readNativeSurfaceInfo(binding).ready,
          "The framework-free Fabric surface remained ready after teardown.",
        );
        console.log(
          "SOLID_NATIVE_FABRIC_HOST_TEARDOWN_SUCCEEDED",
          JSON.stringify({ revision, lifecycleCount: lifecycle.length }),
        );
      } finally {
        handlingEvent = false;
      }
    };

    host.subscribe((event) => {
      void handleEvent(event).catch(reportFatal);
    });

    const initialRevision = requireStructuralCommit(
      host.commit({
        surface,
        sequence: 1,
        priority: "normal",
        causalContext: { operationId: "fabric-host-physical-mount" },
        mutations: [
          {
            type: "create-element",
            node: nodes.root,
            component: "RootView",
            props: {
              style: { backgroundColor: "#eff6ff", flex: 1 },
            },
          },
          {
            type: "create-element",
            node: nodes.content,
            component: "View",
            props: {
              style: {
                flex: 1,
                justifyContent: "center",
                padding: 24,
              },
            },
          },
          {
            type: "create-element",
            node: nodes.title,
            component: "Text",
            props: {
              accessible: true,
              accessibilityRole: "header",
              style: { color: "#111827", fontSize: 26, marginBottom: 12 },
            },
          },
          { type: "create-text", node: nodes.titleText, text: ROOT_TITLE },
          {
            type: "create-element",
            node: nodes.state,
            component: "Text",
            props: {
              accessible: true,
              style: { color: "#1e3a8a", fontSize: 16, marginBottom: 16 },
            },
          },
          { type: "create-text", node: nodes.stateText, text: INITIAL_STATE },
          {
            type: "create-element",
            node: nodes.update,
            component: "Pressable",
            props: {
              accessible: true,
              accessibilityLabel: UPDATE_LABEL,
              accessibilityRole: "button",
              style: {
                backgroundColor: "#2563eb",
                borderRadius: 8,
                marginBottom: 12,
                padding: 14,
              },
            },
          },
          {
            type: "update-event-listeners",
            node: nodes.update,
            events: ["press"],
          },
          {
            type: "create-element",
            node: nodes.updateLabel,
            component: "Text",
            props: { style: { color: "#ffffff", fontSize: 17 } },
          },
          {
            type: "create-text",
            node: nodes.updateLabelText,
            text: UPDATE_LABEL,
          },
          {
            type: "create-element",
            node: nodes.dispose,
            component: "Pressable",
            props: {
              accessible: true,
              accessibilityLabel: DISPOSE_LABEL,
              accessibilityRole: "button",
              style: {
                backgroundColor: "#334155",
                borderRadius: 8,
                padding: 14,
              },
            },
          },
          {
            type: "update-event-listeners",
            node: nodes.dispose,
            events: ["press"],
          },
          {
            type: "create-element",
            node: nodes.disposeLabel,
            component: "Text",
            props: { style: { color: "#ffffff", fontSize: 17 } },
          },
          {
            type: "create-text",
            node: nodes.disposeLabelText,
            text: DISPOSE_LABEL,
          },
          { type: "insert-child", parent: nodes.title, child: nodes.titleText },
          { type: "insert-child", parent: nodes.state, child: nodes.stateText },
          {
            type: "insert-child",
            parent: nodes.updateLabel,
            child: nodes.updateLabelText,
          },
          {
            type: "insert-child",
            parent: nodes.update,
            child: nodes.updateLabel,
          },
          {
            type: "insert-child",
            parent: nodes.disposeLabel,
            child: nodes.disposeLabelText,
          },
          {
            type: "insert-child",
            parent: nodes.dispose,
            child: nodes.disposeLabel,
          },
          { type: "insert-child", parent: nodes.content, child: nodes.title },
          { type: "insert-child", parent: nodes.content, child: nodes.state },
          { type: "insert-child", parent: nodes.content, child: nodes.update },
          { type: "insert-child", parent: nodes.content, child: nodes.dispose },
          { type: "insert-child", parent: nodes.root, child: nodes.content },
        ],
      }),
      1,
    );
    console.log(
      "SOLID_NATIVE_FABRIC_HOST_READY",
      JSON.stringify({
        initialRevision,
        nodeCount: Object.keys(nodes).length,
        platform: host.platform,
      }),
    );
  } catch (error) {
    reportFatal(error);
  }
}

void run();
