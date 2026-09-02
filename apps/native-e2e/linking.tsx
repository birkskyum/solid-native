/** @jsxImportSource @solid-native/core */
import "react-native/setup-env";

import {
  CORE_COMPONENT_DESCRIPTORS,
  CausalComputation,
  CausalOwner,
  Pressable,
  Text,
  View,
  createNativeEventAccessor,
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
import {
  getReactNativePlatformServices,
  type NativeURLEvent,
} from "@solid-native/runtime/react-native";

const READY_TEXT = "Solid Native linking ready";
const WAITING_TEXT = "Native URL delivery: waiting";
const RECEIVED_TEXT = "Native URL delivery: received";
const OPEN_SELF_LABEL = "Open registered application URL";
const COMMIT_LINK_LABEL = "Commit native URL delivery";
const OPEN_SETTINGS_LABEL = "Open application settings";
const DISPOSE_LABEL = "Dispose Solid Native linking proof";
const ANDROID_SELF_URL = "dev.solidnative.e2e://navigation/outbound-link-proof";
const IOS_SELF_URL = "dev.solidnative.linking://navigation/outbound-link-proof";
const LINK_COMPUTATION_NAME = "platform.url.output";

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
  console.error("SOLID_NATIVE_LINKING_FAILED", error);
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
    const SELF_URL =
      platform.platform === "ios" ? IOS_SELF_URL : ANDROID_SELF_URL;
    invariant(
      (await platform.getInitialURL()) === null,
      "The ordinary linking proof launch unexpectedly contained an initial URL.",
    );
    const records: CausalTelemetryRecord[] = [];
    let operationSequence = 0;
    const telemetry = createCausalTelemetry({
      sink: (record) => records.push(record),
      createOperationId: () => `physical-linking-${++operationSequence}`,
    });
    let application: NativeApplication;
    let openingSelfURL = false;
    let openingSettings = false;

    const openSelfURL = async (): Promise<void> => {
      if (openingSelfURL) return;
      openingSelfURL = true;
      try {
        invariant(
          await platform.canOpenURL(SELF_URL),
          "The operating system did not resolve the application's registered URL.",
        );
        console.log("SOLID_NATIVE_LINKING_CAPABILITY_SUCCEEDED");
        await platform.openURL(SELF_URL);
        console.log("SOLID_NATIVE_LINKING_OPEN_SUCCEEDED");
      } catch (error) {
        reportFatal(error);
      } finally {
        openingSelfURL = false;
      }
    };
    const openSettings = async (): Promise<void> => {
      if (openingSettings) return;
      openingSettings = true;
      try {
        await platform.openSettings();
        console.log("SOLID_NATIVE_LINKING_SETTINGS_SUCCEEDED");
      } catch (error) {
        reportFatal(error);
      } finally {
        openingSettings = false;
      }
    };
    const commitURLDelivery = async (): Promise<void> => {
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
          "The native URL delivery did not produce a Fabric commit.",
        );
        const commitStarted = startedOperation(
          records,
          "solid-native.commit",
          (record) => record.attributes["commit.sequence"] === commit.sequence,
        );
        invariant(
          commitStarted?.attributes["commit.priority"] === "normal",
          "The native URL delivery did not retain a normal-priority commit.",
        );
        const nativeEvent = startedOperation(
          records,
          "solid-native.event",
          (record) =>
            record.attributes["event.name"] === "platform.url.open" &&
            commitStarted.causes.includes(record.operationId),
        );
        const computation = startedOperation(
          records,
          "solid-native.computation",
          (record) =>
            record.attributes["computation.name"] === LINK_COMPUTATION_NAME &&
            commitStarted.causes.includes(record.operationId),
        );
        invariant(
          nativeEvent?.attributes["event.priority"] === "default" &&
            nativeEvent.attributes["event.source"] === "platform" &&
            computation !== undefined &&
            hasOnlyAttributes(nativeEvent, PERMITTED_EVENT_ATTRIBUTES) &&
            hasOnlyAttributes(computation, PERMITTED_COMPUTATION_ATTRIBUTES),
          "The native URL causal chain was incomplete or retained private values.",
        );
        invariant(
          !JSON.stringify(records).includes(SELF_URL),
          "The private outbound URL leaked into causal telemetry.",
        );
        console.log(
          "SOLID_NATIVE_LINKING_CAUSALITY_SUCCEEDED",
          commit.sequence,
        );
      } catch (error) {
        reportFatal(error);
      }
    };
    const disposeApplication = async (): Promise<void> => {
      try {
        await application.dispose();
        invariant(
          !binding.getSurfaceInfo().ready,
          "The linking proof resolved disposal before its native surface stopped.",
        );
        console.log("SOLID_NATIVE_LINKING_TEARDOWN_SUCCEEDED");
      } catch (error) {
        reportFatal(error);
      }
    };

    application = startApplication(
      () => {
        const receivedURL = createNativeEventAccessor<NativeURLEvent, boolean>(
          (listener) => platform.subscribeURL(listener),
          {
            name: "platform.url.open",
            initialValue: false,
            decode(event) {
              invariant(
                event.url === SELF_URL,
                "The native URL event did not preserve the requested application URL.",
              );
              return true;
            },
            onError: reportFatal,
          },
        );
        return (
          <CausalOwner name="linking.root">
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
              <CausalComputation name={LINK_COMPUTATION_NAME}>
                <Text style={{ color: "#334155", fontSize: 16, marginTop: 8 }}>
                  {() => (receivedURL() ? RECEIVED_TEXT : WAITING_TEXT)}
                </Text>
              </CausalComputation>
              <ProofButton
                label={OPEN_SELF_LABEL}
                onPress={() => {
                  void openSelfURL();
                }}
              />
              <ProofButton
                label={COMMIT_LINK_LABEL}
                onPress={() => {
                  void commitURLDelivery();
                }}
              />
              <ProofButton
                label={OPEN_SETTINGS_LABEL}
                onPress={() => {
                  void openSettings();
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
          name: "linking-e2e",
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
    invariant(
      initial?.sequence === 1,
      "The linking proof did not mount exactly once.",
    );
    console.log("SOLID_NATIVE_LINKING_READY", platform.platform);
  } catch (error) {
    reportFatal(error);
  }
}

void run();
