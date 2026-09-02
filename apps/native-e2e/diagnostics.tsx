/** @jsxImportSource @solid-native/core */
import "react-native/setup-env";

import { CORE_COMPONENT_DESCRIPTORS, Text, View } from "@solid-native/core";
import { createDevelopmentSolidDiagnosticsController } from "@solid-native/devtools/solid-diagnostics";
import {
  createCausalTelemetry,
  createCausalTimeline,
} from "@solid-native/observability";
import { CausalComputation } from "@solid-native/renderer";
import { createReactNativeCausalDebugTransport } from "@solid-native/runtime/react-native-causal-debug";
import { startNativeApplication } from "@solid-native/runtime";
import { createSignal, onCleanup } from "solid-js";

export const DIAGNOSTICS_COUNTER_NAME = "solid-native.diagnostics.counter";
export const DIAGNOSTICS_OUTPUT_NAME = "solid-native.diagnostics.output";
const UPDATE_INTERVAL_MS = 100;

function DiagnosticsProof() {
  const [count, setCount] = createSignal(0, {
    name: DIAGNOSTICS_COUNTER_NAME,
  });

  const interval = setInterval(() => {
    setCount((value) => value + 1);
  }, UPDATE_INTERVAL_MS);
  onCleanup(() => clearInterval(interval));

  return (
    <View
      accessible
      accessibilityLabel="Solid Native diagnostics physical proof"
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <CausalComputation name={DIAGNOSTICS_OUTPUT_NAME}>
        <Text accessibilityRole="header" style={{ fontSize: 24 }}>
          Diagnostics count: {count()}
        </Text>
      </CausalComputation>
    </View>
  );
}

const timeline = createCausalTimeline();
const telemetry = createCausalTelemetry({ sink: timeline.sink });
createReactNativeCausalDebugTransport(timeline, {
  reportError: (error) =>
    console.error("SOLID_NATIVE_DIAGNOSTICS_TRANSPORT_FAILED", error),
  solidDiagnostics: createDevelopmentSolidDiagnosticsController(),
});

void startNativeApplication(() => <DiagnosticsProof />, {
  descriptors: CORE_COMPONENT_DESCRIPTORS,
  surface: { name: "solid-diagnostics-physical-proof" },
  telemetry,
})
  .then(() => console.log("SOLID_NATIVE_DIAGNOSTICS_READY"))
  .catch((error: unknown) => {
    console.error("SOLID_NATIVE_DIAGNOSTICS_FAILED", error);
    void Promise.resolve().then(() => {
      throw error instanceof Error ? error : new Error(String(error));
    });
  });
