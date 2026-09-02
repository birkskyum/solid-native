/** @jsxImportSource @solid-native/core */
import "react-native/setup-env";

import { CORE_COMPONENT_DESCRIPTORS } from "@solid-native/core";
import { createInspectableNetworkService } from "@solid-native/devtools/network-service";
import { DevelopmentRoot } from "@solid-native/devtools/root";
import { createDevelopmentSolidDiagnosticsController } from "@solid-native/devtools/solid-diagnostics";
import { createReactNativeNetworkService } from "@solid-native/networking/react-native";
import {
  createCausalTelemetry,
  createCausalTimeline,
} from "@solid-native/observability";
import {
  getNativeHostBinding,
  startNativeApplication,
} from "@solid-native/runtime";
import { createReactNativeCausalDebugTransport } from "@solid-native/runtime/react-native-causal-debug";

import { App } from "./App";

const binding = getNativeHostBinding();
const network = createInspectableNetworkService(
  createReactNativeNetworkService(),
);
const causalTimeline = __DEV__
  ? createCausalTimeline({ capacity: 2_000 })
  : undefined;
const telemetry =
  causalTimeline === undefined
    ? undefined
    : createCausalTelemetry({ sink: causalTimeline.sink });
const solidDiagnostics =
  causalTimeline === undefined
    ? undefined
    : createDevelopmentSolidDiagnosticsController();
if (causalTimeline !== undefined) {
  createReactNativeCausalDebugTransport(causalTimeline, {
    reportError: (error) =>
      console.error("Solid Native causal-debug transport failed.", error),
    solidDiagnostics,
  });
}

void startNativeApplication(
  () => (
    <DevelopmentRoot
      causalTimeline={causalTimeline}
      networkInspector={network.inspector}
      solidDiagnostics={solidDiagnostics}
    >
      <App network={network.service} />
    </DevelopmentRoot>
  ),
  {
    binding,
    descriptors: CORE_COMPONENT_DESCRIPTORS,
    surface: { name: "main" },
    telemetry,
  },
).catch((error: unknown) => {
  console.error("Solid Native application startup failed.", error);
  void Promise.resolve().then(() => {
    throw error instanceof Error ? error : new Error(String(error));
  });
});
