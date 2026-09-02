/** @jsxImportSource @solid-native/core */
import "react-native/setup-env";

import { createReactNativeAccessibilityService } from "@solid-native/accessibility/react-native";
import {
  createAccessibilityPreferences,
  type AccessibilityPreferencesController,
} from "@solid-native/accessibility/solid";
import {
  CORE_COMPONENT_DESCRIPTORS,
  CausalComputation,
  CausalOwner,
  Pressable,
  Text,
  View,
} from "@solid-native/core";
import {
  createCausalTelemetry,
  type CausalTelemetryRecord,
} from "@solid-native/observability";
import type { NativeApplication } from "@solid-native/renderer";
import {
  createNativeFabricHost,
  getNativeHostBinding,
  startApplication,
  waitForNativeSurface,
} from "@solid-native/runtime";
import { getReactNativePlatformServices } from "@solid-native/runtime/react-native";

const READY_TEXT = "Solid Native accessibility ready";
const REFRESH_LABEL = "Refresh native accessibility preferences";
const COMMIT_LABEL = "Commit native accessibility preference";
const ANNOUNCE_LABEL = "Announce Solid Native accessibility proof";
const DISPOSE_LABEL = "Dispose Solid Native accessibility proof";
const OUTPUT_COMPUTATION_NAME = "platform.accessibility.output";

function reportFatal(error: unknown): void {
  console.error("SOLID_NATIVE_ACCESSIBILITY_FAILED", error);
  setTimeout(() => {
    throw error instanceof Error ? error : new Error(String(error));
  });
}

function enabledLabel(value: boolean | undefined): string {
  if (value === undefined) return "loading";
  return value ? "enabled" : "disabled";
}

function platformSummary(
  preferences: AccessibilityPreferencesController,
): string {
  if (preferences.platform === "android") {
    return `High contrast ${enabledLabel(
      preferences.highTextContrastEnabled(),
    )}; accessibility service ${enabledLabel(
      preferences.accessibilityServiceEnabled(),
    )}`;
  }
  return `Bold text ${enabledLabel(
    preferences.boldTextEnabled(),
  )}; reduced transparency ${enabledLabel(
    preferences.reduceTransparencyEnabled(),
  )}; cross-fade ${enabledLabel(preferences.prefersCrossFadeTransitions())}`;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function startedOperation(
  records: readonly CausalTelemetryRecord[],
  name: string,
  predicate: (
    record: Extract<
      CausalTelemetryRecord,
      { readonly type: "operation-started" }
    >,
  ) => boolean,
) {
  return records.find(
    (
      record,
    ): record is Extract<
      CausalTelemetryRecord,
      { readonly type: "operation-started" }
    > =>
      record.type === "operation-started" &&
      record.name === name &&
      predicate(record),
  );
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
        backgroundColor: "#1d4ed8",
        borderRadius: 8,
        marginTop: 12,
        padding: 12,
      }}
    >
      <Text style={{ color: "#ffffff", fontSize: 16 }}>{props.label}</Text>
    </Pressable>
  );
}

async function run(): Promise<void> {
  try {
    const binding = getNativeHostBinding();
    await waitForNativeSurface({ binding, timeoutMs: 5_000 });
    const host = createNativeFabricHost({
      binding,
      descriptors: CORE_COMPONENT_DESCRIPTORS,
    });
    const service = createReactNativeAccessibilityService();
    const platform = getReactNativePlatformServices();
    const records: CausalTelemetryRecord[] = [];
    let operationSequence = 0;
    const telemetry = createCausalTelemetry({
      sink: (record) => records.push(record),
      createOperationId: () => `physical-accessibility-${++operationSequence}`,
    });
    let application: NativeApplication;
    let preferences: AccessibilityPreferencesController;

    const flushPreferences = async (marker: string): Promise<void> => {
      try {
        await application.root.flushMounted();
        console.log(marker);
      } catch (error) {
        reportFatal(error);
      }
    };
    const commitNativePreference = async (): Promise<void> => {
      try {
        const deadline = Date.now() + 5_000;
        let commit: Awaited<ReturnType<typeof application.root.flushMounted>>;
        do {
          commit = await application.root.flushMounted();
          if (commit !== undefined) break;
          await new Promise<void>((resolve) => setTimeout(resolve, 50));
        } while (Date.now() < deadline);
        invariant(
          commit !== undefined,
          "The native accessibility change did not produce a Fabric commit.",
        );
        const commitStarted = startedOperation(
          records,
          "solid-native.commit",
          (record) => record.attributes["commit.sequence"] === commit.sequence,
        );
        const nativeEvent = startedOperation(
          records,
          "solid-native.event",
          (record) =>
            record.attributes["event.name"] ===
              "platform.accessibility.preference" &&
            commitStarted?.causes.includes(record.operationId) === true,
        );
        const computation = startedOperation(
          records,
          "solid-native.computation",
          (record) =>
            record.attributes["computation.name"] === OUTPUT_COMPUTATION_NAME &&
            commitStarted?.causes.includes(record.operationId) === true,
        );
        invariant(
          commitStarted?.attributes["commit.priority"] === "normal" &&
            nativeEvent?.attributes["event.priority"] === "default" &&
            computation !== undefined,
          "The native accessibility preference lost its event, computation, or commit cause.",
        );
        invariant(
          records.every(
            (record) =>
              !("attributes" in record) ||
              Object.keys(record.attributes).every(
                (name) =>
                  !name.toLowerCase().includes("preference") &&
                  !name.toLowerCase().includes("enabled"),
              ),
          ),
          "A native accessibility preference value escaped into causal telemetry.",
        );
        console.log(
          "SOLID_NATIVE_ACCESSIBILITY_PREFERENCE_CAUSALITY_SUCCEEDED",
          commit.sequence,
        );
      } catch (error) {
        reportFatal(error);
      }
    };
    const disposeApplication = async (): Promise<void> => {
      try {
        await application.dispose();
        if (binding.getSurfaceInfo().ready) {
          throw new Error(
            "The accessibility proof resolved disposal before its native surface stopped.",
          );
        }
        console.log("SOLID_NATIVE_ACCESSIBILITY_TEARDOWN_SUCCEEDED");
      } catch (error) {
        reportFatal(error);
      }
    };

    application = startApplication(
      () => {
        preferences = createAccessibilityPreferences(service, {
          appState: platform,
          onError: reportFatal,
        });
        return (
          <CausalOwner name="accessibility.root">
            <View
              style={{
                alignItems: "stretch",
                backgroundColor: "#f8fafc",
                flex: 1,
                justifyContent: "center",
                padding: 24,
              }}
            >
              <Text accessibilityRole="header" style={{ fontSize: 22 }}>
                {READY_TEXT}
              </Text>
              <CausalComputation name={OUTPUT_COMPUTATION_NAME}>
                <Text style={{ color: "#334155", fontSize: 16 }}>
                  {() =>
                    `Screen reader ${enabledLabel(
                      preferences.screenReaderEnabled(),
                    )}; reduced motion ${enabledLabel(
                      preferences.reduceMotionEnabled(),
                    )}`
                  }
                </Text>
                <Text style={{ color: "#334155", fontSize: 16 }}>
                  {() => platformSummary(preferences)}
                </Text>
              </CausalComputation>
              <ProofButton
                label={COMMIT_LABEL}
                onPress={() => {
                  void commitNativePreference();
                }}
              />
              <ProofButton
                label={REFRESH_LABEL}
                onPress={() => {
                  void preferences
                    .refresh()
                    .then(() =>
                      flushPreferences("SOLID_NATIVE_ACCESSIBILITY_REFRESHED"),
                    )
                    .catch(reportFatal);
                }}
              />
              <ProofButton
                label={ANNOUNCE_LABEL}
                onPress={() => {
                  preferences.announce(
                    service.platform === "ios"
                      ? {
                          message: READY_TEXT,
                          queue: true,
                          priority: "default",
                        }
                      : READY_TEXT,
                  );
                  console.log("SOLID_NATIVE_ACCESSIBILITY_ANNOUNCED");
                }}
              />
              <ProofButton
                label={DISPOSE_LABEL}
                onPress={() => {
                  void disposeApplication();
                }}
              />
            </View>
          </CausalOwner>
        );
      },
      host,
      {
        surface: {
          name: "accessibility-e2e",
          initialProps: {
            style: { backgroundColor: "#f8fafc", flex: 1 },
          },
        },
        autoCommit: false,
        requirements: { components: ["Pressable", "Text", "View"] },
        telemetry,
        onCommitError: reportFatal,
      },
    );
    const initial = await application.root.flushMounted();
    if (initial?.sequence !== 1) {
      throw new Error("The accessibility proof did not mount exactly once.");
    }
    await preferences!.ready;
    await application.root.flushMounted();
    const timeout = await preferences!.getRecommendedTimeoutMillis(1_000);
    if (timeout < 1_000) {
      throw new Error("The native accessibility timeout shortened its input.");
    }
    console.log("SOLID_NATIVE_ACCESSIBILITY_TIMEOUT_READY", timeout);
    console.log("SOLID_NATIVE_ACCESSIBILITY_READY", service.platform);
  } catch (error) {
    reportFatal(error);
  }
}

void run();
