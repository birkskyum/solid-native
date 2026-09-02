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
import {
  createCausalTelemetry,
  type CausalTelemetryRecord,
} from "@solid-native/observability";
import { createReactNativeShareService } from "@solid-native/sharing/react-native";
import { createShareController } from "@solid-native/sharing/solid";
import type { ShareResult } from "@solid-native/sharing";
import { createSignal, type NativeApplication } from "@solid-native/renderer";
import {
  createNativeFabricHost,
  getNativeHostBinding,
  startApplication,
  waitForNativeSurface,
} from "@solid-native/runtime";

const READY_TEXT = "Solid Native sharing ready";
const SHARE_COMBINED_LABEL = "Share message and URL";
const SHARE_URL_ONLY_LABEL = "Share URL only";
const COMBINED_RESULT_TEXT = "Combined share result: presented";
const URL_ONLY_RESULT_TEXT = "URL-only share result: presented";
const IOS_COMBINED_RESULT_TEXT = "Combined share result: completed";
const IOS_URL_ONLY_RESULT_TEXT = "URL-only share result: dismissed";
const DISPOSE_LABEL = "Dispose Solid Native sharing proof";
const PRIVATE_MESSAGE = "Private Solid Native sharing proof";
const PRIVATE_URL = "https://solid-native.dev/private-proof";
const PRIVATE_SUBJECT = "Private Solid Native subject";
const SHARE_COMPUTATION_NAME = "platform.share.output";

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
  console.error("SOLID_NATIVE_SHARING_FAILED", error);
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
        backgroundColor: "#0f766e",
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
    const service = createReactNativeShareService();
    const records: CausalTelemetryRecord[] = [];
    let operationSequence = 0;
    const telemetry = createCausalTelemetry({
      sink: (record) => records.push(record),
      createOperationId: () => `physical-share-${++operationSequence}`,
    });
    let application: NativeApplication;

    const verifyCommit = async (
      eventName:
        | "platform.share.presented"
        | "platform.share.completed"
        | "platform.share.dismissed",
      successMarker: string,
    ): Promise<void> => {
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
          record.attributes["computation.name"] === SHARE_COMPUTATION_NAME &&
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
        serialized.includes(PRIVATE_MESSAGE) ||
        serialized.includes(PRIVATE_URL) ||
        serialized.includes(PRIVATE_SUBJECT)
      ) {
        throw new Error("Private share content escaped into causal telemetry.");
      }
      console.log(successMarker);
    };

    const host = createNativeFabricHost({
      binding,
      descriptors: CORE_COMPONENT_DESCRIPTORS,
    });
    application = startApplication(
      () => {
        const sharing = createShareController(service);
        const [resultLabel, setResultLabel] = createSignal("No share result");
        const share = (
          request: Parameters<typeof sharing.share>[0],
          resultText: string,
          expectedAction: ShareResult["action"],
          successMarker: string,
        ): void => {
          void sharing.share(request).then((result) => {
            const eventName = `platform.share.${result.action}` as const;
            if (result.action !== expectedAction) {
              throw new Error(
                `Expected a ${expectedAction} share result on ${service.platform}; received ${result.action}.`,
              );
            }
            setResultLabel(resultText);
            void verifyCommit(eventName, successMarker).catch(reportFatal);
          }, reportFatal);
        };
        return (
          <CausalOwner name="sharing.root">
            <View
              style={{
                alignItems: "stretch",
                backgroundColor: "#f0fdfa",
                flex: 1,
                justifyContent: "center",
                padding: 24,
              }}
            >
              <Text accessibilityRole="header" style={{ fontSize: 22 }}>
                {READY_TEXT}
              </Text>
              <CausalComputation name={SHARE_COMPUTATION_NAME}>
                <Text style={{ color: "#134e4a", fontSize: 16 }}>
                  {resultLabel}
                </Text>
              </CausalComputation>
              <ProofButton
                label={SHARE_COMBINED_LABEL}
                onPress={() =>
                  share(
                    {
                      message: PRIVATE_MESSAGE,
                      url: PRIVATE_URL,
                      subject: PRIVATE_SUBJECT,
                    },
                    service.platform === "ios"
                      ? IOS_COMBINED_RESULT_TEXT
                      : COMBINED_RESULT_TEXT,
                    service.platform === "ios" ? "completed" : "presented",
                    "SOLID_NATIVE_SHARING_COMBINED_CAUSALITY_SUCCEEDED",
                  )
                }
              />
              <ProofButton
                label={SHARE_URL_ONLY_LABEL}
                onPress={() =>
                  share(
                    { url: PRIVATE_URL },
                    service.platform === "ios"
                      ? IOS_URL_ONLY_RESULT_TEXT
                      : URL_ONLY_RESULT_TEXT,
                    service.platform === "ios" ? "dismissed" : "presented",
                    "SOLID_NATIVE_SHARING_URL_ONLY_CAUSALITY_SUCCEEDED",
                  )
                }
              />
              <ProofButton
                label={DISPOSE_LABEL}
                onPress={() => {
                  void application.dispose().then(() => {
                    if (binding.getSurfaceInfo().ready) {
                      throw new Error(
                        "The sharing proof resolved disposal before its native surface stopped.",
                      );
                    }
                    console.log("SOLID_NATIVE_SHARING_TEARDOWN_SUCCEEDED");
                  }, reportFatal);
                }}
              />
            </View>
          </CausalOwner>
        );
      },
      host,
      {
        surface: {
          name: "sharing-e2e",
          initialProps: {
            style: { backgroundColor: "#f0fdfa", flex: 1 },
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
      throw new Error("The sharing proof did not mount exactly once.");
    }
    console.log("SOLID_NATIVE_SHARING_READY");
  } catch (error) {
    reportFatal(error);
  }
}

void run();
