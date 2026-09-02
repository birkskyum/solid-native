/** @jsxImportSource @solid-native/core */
import "react-native/setup-env";

import {
  CORE_COMPONENT_DESCRIPTORS,
  Pressable,
  Text,
  View,
} from "@solid-native/core";
import {
  createDevelopmentErrorController,
  type DevelopmentErrorSnapshot,
} from "@solid-native/devtools";
import { installReactNativeDevelopmentErrorBridge } from "@solid-native/devtools/react-native";
import { createDevelopmentNetworkInspector } from "@solid-native/devtools/network";
import { createDevelopmentSolidDiagnosticsController } from "@solid-native/devtools/solid-diagnostics";
import {
  DevelopmentCausalPanel,
  DevelopmentErrorOverlay,
  DevelopmentNetworkPanel,
} from "@solid-native/devtools/solid";
import {
  createCausalTelemetry,
  createCausalTimeline,
} from "@solid-native/observability";
import { CausalComputation } from "@solid-native/renderer";
import { startNativeApplication } from "@solid-native/runtime";
import { createMemo, createSignal, type Accessor } from "solid-js";

const READY_TEXT = "Solid Native development overlay ready";
const ASYNC_BUTTON_LABEL = "Report async development error";
const ASYNC_ERROR_TEXT = "Physical async failure";
const ASYNC_RECOVERED_TEXT = "Async overlay recovered";
const RUNTIME_BUTTON_LABEL = "Report guarded Hermes error";
const RUNTIME_ERROR_TEXT = "Physical guarded Hermes failure";
const RUNTIME_RECOVERED_TEXT = "Runtime overlay recovered";
const RENDER_BUTTON_LABEL = "Throw Solid render error";
const RENDER_ERROR_TEXT = "Physical Solid render failure";
const RENDER_RECOVERED_TEXT = "Render overlay recovered";
const DIAGNOSTICS_BUTTON_LABEL = "Exercise Solid diagnostics capture";
const DIAGNOSTICS_COUNTER_NAME = "solid-native.devtools.diagnostics.counter";
const DIAGNOSTICS_OUTPUT_NAME = "solid-native.devtools.diagnostics.output";
const DISPOSE_LABEL = "Dispose development overlay proof";

function reportFatal(error: unknown): void {
  console.error("SOLID_NATIVE_DEVTOOLS_FAILED", error);
  setTimeout(() => {
    throw error instanceof Error ? error : new Error(String(error));
  });
}

function ProofButton(props: {
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessible
      accessibilityLabel={props.label}
      accessibilityRole="button"
      onPress={props.onPress}
      style={{
        backgroundColor: "#2563eb",
        borderRadius: 8,
        marginTop: 12,
        padding: 14,
      }}
    >
      <Text style={{ color: "#ffffff", fontSize: 16 }}>{props.label}</Text>
    </Pressable>
  );
}

function RenderFailure(props: { readonly active: Accessor<boolean> }) {
  const content = createMemo(() => {
    if (props.active()) throw new Error(RENDER_ERROR_TEXT);
    return "Solid subtree healthy";
  });
  return <Text>{content()}</Text>;
}

async function run(): Promise<void> {
  const errors = createDevelopmentErrorController();
  const runtimeErrors = installReactNativeDevelopmentErrorBridge(errors);
  const causalTimeline = createCausalTimeline({ capacity: 200 });
  const networkInspector = createDevelopmentNetworkInspector();
  const solidDiagnostics = createDevelopmentSolidDiagnosticsController();
  let nextOperationId = 0;
  const telemetry = createCausalTelemetry({
    sink: causalTimeline.sink,
    createOperationId: () => {
      nextOperationId += 1;
      if (nextOperationId === 1) return "devtools-seed-event";
      if (nextOperationId === 2) return "devtools-seed-commit";
      return `devtools-runtime-${String(nextOperationId - 2)}`;
    },
  });
  const proofEvent = telemetry.startOperation("solid-native.event");
  telemetry.finishOperation(proofEvent);
  const proofCommit = telemetry.startOperation("solid-native.commit", {
    causes: [proofEvent],
  });
  telemetry.finishOperation(proofCommit);
  console.log("SOLID_NATIVE_DEVTOOLS_CAUSAL_SEEDED");
  let application: Awaited<ReturnType<typeof startNativeApplication>>;
  try {
    application = await startNativeApplication(
      () => {
        const [renderFailure, setRenderFailure] = createSignal(false);
        const [status, setStatus] = createSignal(READY_TEXT);
        const [diagnosticsCount, setDiagnosticsCount] = createSignal(0, {
          name: DIAGNOSTICS_COUNTER_NAME,
        });
        const onDismiss = (snapshot: DevelopmentErrorSnapshot): void => {
          if (snapshot.source === "async") {
            setStatus(ASYNC_RECOVERED_TEXT);
            console.log("SOLID_NATIVE_DEVTOOLS_ASYNC_RECOVERED");
            return;
          }
          if (snapshot.source === "runtime") {
            setStatus(RUNTIME_RECOVERED_TEXT);
            console.log("SOLID_NATIVE_DEVTOOLS_RUNTIME_RECOVERED");
            return;
          }
          if (snapshot.source === "render") {
            setRenderFailure(false);
            setStatus(RENDER_RECOVERED_TEXT);
            console.log("SOLID_NATIVE_DEVTOOLS_RENDER_RECOVERED");
          }
        };
        const disposeApplication = (): void => {
          void application
            .dispose()
            .then(() => {
              if (!runtimeErrors.remove()) {
                throw new Error(
                  "The development ErrorUtils bridge did not restore its predecessor.",
                );
              }
              errors.clear();
              console.log("SOLID_NATIVE_DEVTOOLS_BRIDGE_REMOVED");
              console.log("SOLID_NATIVE_DEVTOOLS_TEARDOWN_SUCCEEDED");
            })
            .catch(reportFatal);
        };

        return (
          <DevelopmentErrorOverlay controller={errors} onDismiss={onDismiss}>
            <DevelopmentNetworkPanel inspector={networkInspector}>
              <DevelopmentCausalPanel
                timeline={causalTimeline}
                solidDiagnostics={solidDiagnostics}
              >
                <View
                  style={{
                    flex: 1,
                    justifyContent: "center",
                    padding: 24,
                    backgroundColor: "#f8fafc",
                  }}
                >
                  <Text accessibilityRole="header" style={{ fontSize: 24 }}>
                    {status()}
                  </Text>
                  <RenderFailure active={renderFailure} />
                  <CausalComputation name={DIAGNOSTICS_OUTPUT_NAME}>
                    <Text>Solid diagnostics updates: {diagnosticsCount()}</Text>
                  </CausalComputation>
                  <ProofButton
                    label={DIAGNOSTICS_BUTTON_LABEL}
                    onPress={() => setDiagnosticsCount((value) => value + 1)}
                  />
                  <ProofButton
                    label={ASYNC_BUTTON_LABEL}
                    onPress={() => {
                      errors.report(new Error(ASYNC_ERROR_TEXT), {
                        source: "async",
                      });
                      console.log("SOLID_NATIVE_DEVTOOLS_ASYNC_REPORTED");
                    }}
                  />
                  <ProofButton
                    label={RENDER_BUTTON_LABEL}
                    onPress={() => setRenderFailure(true)}
                  />
                  <ProofButton
                    label={RUNTIME_BUTTON_LABEL}
                    onPress={() => {
                      const errorUtils = Reflect.get(
                        globalThis,
                        "ErrorUtils",
                      ) as {
                        reportError(error: unknown): void;
                      };
                      errorUtils.reportError(new Error(RUNTIME_ERROR_TEXT));
                      console.log("SOLID_NATIVE_DEVTOOLS_RUNTIME_REPORTED");
                    }}
                  />
                  <ProofButton
                    label={DISPOSE_LABEL}
                    onPress={disposeApplication}
                  />
                </View>
              </DevelopmentCausalPanel>
            </DevelopmentNetworkPanel>
          </DevelopmentErrorOverlay>
        );
      },
      {
        descriptors: CORE_COMPONENT_DESCRIPTORS,
        surface: { name: "development-error-overlay" },
        telemetry,
        onCommitError: reportFatal,
      },
    );
    await application.root.flushMounted();
    console.log("SOLID_NATIVE_DEVTOOLS_READY");
  } catch (error) {
    runtimeErrors.remove();
    reportFatal(error);
  }
}

void run();
