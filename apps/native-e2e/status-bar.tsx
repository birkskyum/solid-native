/** @jsxImportSource @solid-native/core */
import "react-native/setup-env";

import {
  CORE_COMPONENT_DESCRIPTORS,
  CausalComputation,
  Pressable,
  StatusBar,
  Text,
  View,
} from "@solid-native/core";
import {
  createCausalTelemetry,
  type CausalTelemetryRecord,
} from "@solid-native/observability";
import {
  Show,
  createSignal,
  type NativeApplication,
} from "@solid-native/renderer";
import {
  createNativeFabricHost,
  getNativeHostBinding,
  startApplication,
  waitForNativeSurface,
} from "@solid-native/runtime";
import { getReactNativePlatformServices } from "@solid-native/runtime/react-native";

const READY_TEXT = "Solid Native status bar ready";
const MOUNT_OVERLAY_LABEL = "Mount light status bar owner";
const HIDE_OVERLAY_LABEL = "Hide status bar from child owner";
const DISPOSE_OVERLAY_LABEL = "Dispose child status bar owner";
const DISPOSE_APPLICATION_LABEL = "Dispose Solid Native status bar proof";
const PARENT_STATUS_TEXT = "Status bar parent dark visible";
const CHILD_STATUS_TEXT = "Status bar child light visible";
const HIDDEN_STATUS_TEXT = "Status bar child light hidden";
const STATUS_COMPUTATION_NAME = "platform.status-bar.output";
const PERMITTED_EVENT_ATTRIBUTES = new Set([
  "event.bubbles",
  "event.coalescible",
  "event.name",
  "event.native_timestamp",
  "event.observed_sequence",
  "event.priority",
  "surface.id",
  "target.node",
]);
const PERMITTED_COMPUTATION_ATTRIBUTES = new Set([
  "computation.kind",
  "computation.name",
]);

function reportFatal(error: unknown): void {
  console.error("SOLID_NATIVE_STATUS_BAR_FAILED", error);
  setTimeout(() => {
    throw error instanceof Error ? error : new Error(String(error));
  });
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

function hasOnlyAttributes(
  record: Extract<
    CausalTelemetryRecord,
    { readonly type: "operation-started" }
  >,
  permitted: ReadonlySet<string>,
): boolean {
  return Object.keys(record.attributes).every(
    (name) => permitted.has(name) || name.startsWith("resource."),
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
    const platform = getReactNativePlatformServices();
    const records: CausalTelemetryRecord[] = [];
    let operationSequence = 0;
    const telemetry = createCausalTelemetry({
      sink: (record) => records.push(record),
      createOperationId: () => `physical-status-bar-${++operationSequence}`,
    });
    let application: NativeApplication;

    const commitStatusBarChange = async (marker: string): Promise<void> => {
      try {
        const commit = await application.root.flushMounted();
        invariant(
          commit !== undefined,
          "The status-bar owner change did not produce a Fabric commit.",
        );
        const commitStarted = startedOperation(
          records,
          "solid-native.commit",
          (record) => record.attributes["commit.sequence"] === commit.sequence,
        );
        invariant(
          commitStarted?.attributes["commit.priority"] === "user-blocking",
          "The status-bar press did not retain a user-blocking commit.",
        );
        const press = startedOperation(
          records,
          "solid-native.event",
          (record) =>
            record.attributes["event.name"] === "press" &&
            commitStarted.causes.includes(record.operationId),
        );
        const computation = startedOperation(
          records,
          "solid-native.computation",
          (record) =>
            record.attributes["computation.name"] === STATUS_COMPUTATION_NAME &&
            commitStarted.causes.includes(record.operationId),
        );
        invariant(
          press?.attributes["event.priority"] === "discrete" &&
            hasOnlyAttributes(press, PERMITTED_EVENT_ATTRIBUTES),
          "The status-bar commit did not retain one privacy-safe native press.",
        );
        invariant(
          computation !== undefined &&
            hasOnlyAttributes(computation, PERMITTED_COMPUTATION_ATTRIBUTES),
          "The status-bar commit did not retain its named Solid computation.",
        );
        console.log(marker, commit.sequence);
      } catch (error) {
        reportFatal(error);
      }
    };

    const disposeApplication = async (): Promise<void> => {
      try {
        await application.dispose();
        if (binding.getSurfaceInfo().ready) {
          throw new Error(
            "The status-bar proof resolved disposal before its native surface stopped.",
          );
        }
        console.log("SOLID_NATIVE_STATUS_BAR_TEARDOWN_SUCCEEDED");
      } catch (error) {
        reportFatal(error);
      }
    };

    application = startApplication(
      () => {
        const [overlayMounted, setOverlayMounted] = createSignal(false);
        const [overlayHidden, setOverlayHidden] = createSignal(false);
        return (
          <>
            <StatusBar
              source={platform}
              barStyle="dark-content"
              hidden={false}
            />
            <Show when={overlayMounted()}>
              <StatusBar
                source={platform}
                barStyle="light-content"
                hidden={overlayHidden()}
                animated
                showHideTransition="fade"
              />
            </Show>
            <View
              style={{
                alignItems: "stretch",
                backgroundColor: "#64748b",
                flex: 1,
                justifyContent: "center",
                padding: 24,
              }}
            >
              <Text accessibilityRole="header" style={{ fontSize: 22 }}>
                {READY_TEXT}
              </Text>
              <CausalComputation name={STATUS_COMPUTATION_NAME}>
                <Text
                  style={{ color: "#ffffff", fontSize: 15, marginTop: 8 }}
                  testID="solid-native-status-bar-state"
                >
                  {() =>
                    overlayMounted()
                      ? overlayHidden()
                        ? HIDDEN_STATUS_TEXT
                        : CHILD_STATUS_TEXT
                      : PARENT_STATUS_TEXT
                  }
                </Text>
              </CausalComputation>
              <ProofButton
                label={MOUNT_OVERLAY_LABEL}
                onPress={() => {
                  setOverlayHidden(false);
                  setOverlayMounted(true);
                  void commitStatusBarChange(
                    "SOLID_NATIVE_STATUS_BAR_CHILD_MOUNTED",
                  );
                }}
              />
              <ProofButton
                label={HIDE_OVERLAY_LABEL}
                onPress={() => {
                  setOverlayHidden(true);
                  void commitStatusBarChange("SOLID_NATIVE_STATUS_BAR_HIDDEN");
                }}
              />
              <ProofButton
                label={DISPOSE_OVERLAY_LABEL}
                onPress={() => {
                  setOverlayMounted(false);
                  void commitStatusBarChange(
                    "SOLID_NATIVE_STATUS_BAR_PARENT_RESTORED",
                  );
                }}
              />
              <ProofButton
                label={DISPOSE_APPLICATION_LABEL}
                onPress={() => {
                  void disposeApplication();
                }}
              />
            </View>
          </>
        );
      },
      host,
      {
        surface: {
          name: "status-bar-e2e",
          initialProps: {
            style: { backgroundColor: "#64748b", flex: 1 },
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
      throw new Error("The status-bar proof did not mount exactly once.");
    }
    console.log("SOLID_NATIVE_STATUS_BAR_READY");
  } catch (error) {
    reportFatal(error);
  }
}

void run();
