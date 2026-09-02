/** @jsxImportSource @solid-native/core */
import "react-native/setup-env";

import {
  UI_WORKLET_PROTOCOL_VERSION,
  createUIWorkletGraph,
  createUIWorkletSession,
} from "@solid-native/animation";
import { createNativeViewUIWorkletHost } from "@solid-native/animation/react-native";
import {
  CORE_COMPONENT_DESCRIPTORS,
  Pressable,
  Text,
  View,
  type NativeNode,
} from "@solid-native/core";
import { createDevelopmentSolidDiagnosticsController } from "@solid-native/devtools/solid-diagnostics";
import {
  getNativeHostBinding,
  readNativeSurfaceInfo,
  startNativeApplication,
} from "@solid-native/runtime";
import {
  createCausalTelemetry,
  createCausalTimeline,
} from "@solid-native/observability";
import { createReactNativeCausalDebugTransport } from "@solid-native/runtime/react-native-causal-debug";
import { createSignal } from "solid-js";

const RELOAD_SETTLE_TIMEOUT_MS = 10_000;

const reloadGraph = createUIWorkletGraph({
  protocolVersion: UI_WORKLET_PROTOCOL_VERSION,
  inputs: [{ name: "opacity", initialValue: 1 }],
  outputs: [
    {
      name: "opacity",
      expression: { kind: "input", name: "opacity" },
    },
  ],
});

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function writeNativeReloadLog(message: string, level: number): void {
  const nativeLoggingHook = (
    globalThis as typeof globalThis & {
      readonly nativeLoggingHook?: (message: string, level: number) => void;
    }
  ).nativeLoggingHook;
  if (typeof nativeLoggingHook === "function") {
    nativeLoggingHook(message, level);
    return;
  }
  console.log(message);
}

function ReloadProof(props: { readonly onTarget: (node: NativeNode) => void }) {
  const [count, setCount] = createSignal(0);

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: 24,
        backgroundColor: "#f7f8fa",
      }}
    >
      <Text accessibilityRole="header" style={{ fontSize: 28 }}>
        Solid Native development reload
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Increment reload counter"
        onPress={() => setCount((value) => value + 1)}
        style={{ padding: 16, backgroundColor: "#2563eb" }}
      >
        <Text style={{ color: "#ffffff", fontSize: 17 }}>
          Reload-safe count: {count()}
        </Text>
      </Pressable>
      <View
        accessible
        accessibilityLabel="Development reload scheduler target"
        ref={props.onTarget}
        style={{ height: 1, opacity: 1, width: 1 }}
      />
    </View>
  );
}

let target: NativeNode | undefined;
const binding = getNativeHostBinding();
const timeline = createCausalTimeline();
const telemetry = createCausalTelemetry({ sink: timeline.sink });
createReactNativeCausalDebugTransport(timeline, {
  reportError: (error) =>
    console.error("SOLID_NATIVE_CAUSAL_DEBUG_TRANSPORT_FAILED", error),
  solidDiagnostics: createDevelopmentSolidDiagnosticsController(),
});

void startNativeApplication(
  () => (
    <ReloadProof
      onTarget={(node) => {
        target = node;
      }}
    />
  ),
  {
    autoCommit: false,
    descriptors: CORE_COMPONENT_DESCRIPTORS,
    surface: { name: "development-reload" },
    telemetry,
  },
)
  .then(async (application) => {
    const commit = await application.root.flush();
    if (commit?.sequence !== 1 || target === undefined) {
      throw new Error(
        "The development reload target did not mount in exactly one commit.",
      );
    }

    // This session is deliberately not bound to a JavaScript owner. A full
    // development reload destroys the entire Hermes runtime, and the native
    // binding must cancel the retiring graph before the replacement runtime
    // can publish a clean surface. The repeated-device runner exercises that
    // native lifetime directly.
    const workletHost = createNativeViewUIWorkletHost(target);
    const session = createUIWorkletSession(workletHost, reloadGraph);
    const deadline = Date.now() + RELOAD_SETTLE_TIMEOUT_MS;
    let snapshot = workletHost.inspectGraph(session.handle);
    let surface = readNativeSurfaceInfo(binding);
    while (
      (!snapshot.applied ||
        snapshot.appliedSequence !== snapshot.sequence ||
        surface.pendingUIWorkletFrameCount !== 0) &&
      Date.now() < deadline
    ) {
      await delay(10);
      snapshot = workletHost.inspectGraph(session.handle);
      surface = readNativeSurfaceInfo(binding);
    }
    if (
      !snapshot.applied ||
      snapshot.sequence !== 1 ||
      snapshot.appliedSequence !== 1 ||
      snapshot.outputs.opacity !== 1 ||
      surface.activeUIWorkletCount !== 1 ||
      surface.pendingUIWorkletFrameCount !== 0
    ) {
      throw new Error(
        `The development reload scheduler did not settle: ${JSON.stringify({ snapshot, surface })}`,
      );
    }
    writeNativeReloadLog(
      `SOLID_NATIVE_RELOAD_MOUNTED ${JSON.stringify({
        surface: application.root.surfaceId,
        sequence: commit.sequence,
        workletSequence: snapshot.sequence,
        activeUIWorkletCount: surface.activeUIWorkletCount,
        pendingUIWorkletFrameCount: surface.pendingUIWorkletFrameCount,
      })}`,
      1,
    );
  })
  .catch((error: unknown) => {
    writeNativeReloadLog(
      `SOLID_NATIVE_RELOAD_FAILED ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
      3,
    );
    console.error("SOLID_NATIVE_RELOAD_FAILED", error);
    void Promise.resolve().then(() => {
      throw error instanceof Error ? error : new Error(String(error));
    });
  });
