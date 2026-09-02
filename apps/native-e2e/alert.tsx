/** @jsxImportSource @solid-native/core */
import "react-native/setup-env";

import {
  CORE_COMPONENT_DESCRIPTORS,
  CausalComputation,
  CausalOwner,
  Pressable,
  Text,
  View,
} from "@solid-native/core";
import { createReactNativeAlertService } from "@solid-native/dialogs/react-native";
import { createAlertController } from "@solid-native/dialogs/solid";
import {
  createCausalTelemetry,
  type CausalTelemetryRecord,
} from "@solid-native/observability";
import { createSignal, type NativeApplication } from "@solid-native/renderer";
import {
  createNativeFabricHost,
  getNativeHostBinding,
  startApplication,
  waitForNativeSurface,
} from "@solid-native/runtime";

const READY_TEXT = "Solid Native alert ready";
const SHOW_BUTTON_LABEL = "Show destructive native alert";
const DELETE_ALERT_TITLE = "Delete local draft?";
const DELETE_BUTTON_TEXT = "Delete";
const DELETE_RESULT_TEXT = "Alert result: delete";
const SHOW_DISMISS_LABEL = "Show cancellable native alert";
const DISMISS_ALERT_TITLE = "Dismiss this alert";
const DISMISSED_RESULT_TEXT = "Alert result: dismissed";
const IOS_CANCEL_BUTTON_ID = "cancel-alert";
const IOS_CANCEL_RESULT_TEXT = "Alert result: cancel";
const DISPOSE_LABEL = "Dispose Solid Native alert proof";
const ALERT_COMPUTATION_NAME = "platform.alert.output";

const PERMITTED_EVENT_ATTRIBUTES = new Set([
  "event.bubbles",
  "event.coalescible",
  "event.name",
  "event.priority",
  "event.source",
  "surface.id",
]);
const PERMITTED_COMPUTATION_ATTRIBUTES = new Set([
  "computation.kind",
  "computation.name",
]);

function reportFatal(error: unknown): void {
  console.error("SOLID_NATIVE_ALERT_FAILED", error);
  setTimeout(() => {
    throw error instanceof Error ? error : new Error(String(error));
  });
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
    const service = createReactNativeAlertService();
    const records: CausalTelemetryRecord[] = [];
    let operationSequence = 0;
    const telemetry = createCausalTelemetry({
      sink: (record) => records.push(record),
      createOperationId: () => `physical-alert-${++operationSequence}`,
    });
    let application: NativeApplication;

    const verifyCommit = async (
      eventName: "platform.alert.button" | "platform.alert.dismissed",
      marker: string,
    ): Promise<void> => {
      // The controller queues its retained causal flush immediately after the
      // application's first promise continuation.
      await Promise.resolve();
      const commit = await application.root.flushMounted();
      if (commit === undefined) {
        throw new Error(`${eventName} did not produce a native commit.`);
      }
      const operation = startedOperation(
        records,
        "solid-native.commit",
        (record) => record.attributes["commit.sequence"] === commit.sequence,
      );
      const event = startedOperation(
        records,
        "solid-native.event",
        (record) =>
          record.attributes["event.name"] === eventName &&
          operation?.causes.includes(record.operationId) === true,
      );
      const computation = startedOperation(
        records,
        "solid-native.computation",
        (record) =>
          record.attributes["computation.name"] === ALERT_COMPUTATION_NAME &&
          operation?.causes.includes(record.operationId) === true,
      );
      if (
        event === undefined ||
        operation === undefined ||
        operation.attributes["commit.priority"] !== "user-blocking" ||
        event.attributes["event.priority"] !== "discrete" ||
        event.attributes["event.source"] !== "platform" ||
        computation === undefined ||
        !hasOnlyAttributes(event, PERMITTED_EVENT_ATTRIBUTES) ||
        !hasOnlyAttributes(computation, PERMITTED_COMPUTATION_ATTRIBUTES)
      ) {
        throw new Error(
          `${eventName} lost its private event or Solid computation in the discrete causal commit.`,
        );
      }
      const serialized = JSON.stringify(records);
      if (
        serialized.includes(DELETE_ALERT_TITLE) ||
        serialized.includes(DISMISS_ALERT_TITLE) ||
        serialized.includes("delete-draft") ||
        serialized.includes(IOS_CANCEL_BUTTON_ID)
      ) {
        throw new Error("Private alert content escaped into causal telemetry.");
      }
      console.log(marker);
    };

    const disposeApplication = async (): Promise<void> => {
      try {
        await application.dispose();
        if (binding.getSurfaceInfo().ready) {
          throw new Error(
            "The alert proof resolved disposal before its native surface stopped.",
          );
        }
        console.log("SOLID_NATIVE_ALERT_TEARDOWN_SUCCEEDED");
      } catch (error) {
        reportFatal(error);
      }
    };

    application = startApplication(
      () => {
        const alerts = createAlertController(service);
        const [resultLabel, setResultLabel] = createSignal("No alert result");
        const showDeleteAlert = (): void => {
          void alerts
            .show({
              title: DELETE_ALERT_TITLE,
              message: "This cannot be undone.",
              buttons: [
                { id: "cancel", text: "Cancel", style: "cancel" },
                {
                  id: "delete-draft",
                  text: DELETE_BUTTON_TEXT,
                  style: "destructive",
                  preferred: true,
                },
              ],
            })
            .then((result) => {
              if (
                result.action !== "button" ||
                result.buttonId !== "delete-draft"
              ) {
                throw new Error("The native alert selected the wrong button.");
              }
              setResultLabel(DELETE_RESULT_TEXT);
              void verifyCommit(
                "platform.alert.button",
                "SOLID_NATIVE_ALERT_BUTTON_CAUSALITY_SUCCEEDED",
              ).catch(reportFatal);
            }, reportFatal);
        };
        const showDismissableAlert = (): void => {
          const ios = service.platform === "ios";
          void alerts
            .show({
              title: DISMISS_ALERT_TITLE,
              message: ios
                ? "Select Cancel to settle through UIKit."
                : "Press Android Back to dismiss.",
              cancelable: !ios,
              buttons: ios
                ? [
                    {
                      id: IOS_CANCEL_BUTTON_ID,
                      text: "Cancel",
                      style: "cancel",
                    },
                  ]
                : [{ id: "stay", text: "Stay" }],
            })
            .then((result) => {
              if (ios) {
                if (
                  result.action !== "button" ||
                  result.buttonId !== IOS_CANCEL_BUTTON_ID
                ) {
                  throw new Error(
                    "The native iOS alert selected the wrong cancel button.",
                  );
                }
                setResultLabel(IOS_CANCEL_RESULT_TEXT);
                void verifyCommit(
                  "platform.alert.button",
                  "SOLID_NATIVE_ALERT_CANCEL_CAUSALITY_SUCCEEDED",
                ).catch(reportFatal);
                return;
              }
              if (result.action !== "dismissed") {
                throw new Error("The native alert was not dismissed.");
              }
              setResultLabel(DISMISSED_RESULT_TEXT);
              void verifyCommit(
                "platform.alert.dismissed",
                "SOLID_NATIVE_ALERT_DISMISS_CAUSALITY_SUCCEEDED",
              ).catch(reportFatal);
            }, reportFatal);
        };
        return (
          <CausalOwner name="alert.root">
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
              <CausalComputation name={ALERT_COMPUTATION_NAME}>
                <Text style={{ color: "#334155", fontSize: 16 }}>
                  {resultLabel}
                </Text>
              </CausalComputation>
              <ProofButton
                label={SHOW_BUTTON_LABEL}
                onPress={showDeleteAlert}
              />
              <ProofButton
                label={SHOW_DISMISS_LABEL}
                onPress={showDismissableAlert}
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
          name: "alert-e2e",
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
      throw new Error("The alert proof did not mount exactly once.");
    }
    console.log("SOLID_NATIVE_ALERT_READY");
  } catch (error) {
    reportFatal(error);
  }
}

void run();
