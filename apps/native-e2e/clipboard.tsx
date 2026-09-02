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
import { createSignal, type NativeApplication } from "@solid-native/renderer";
import {
  createNativeFabricHost,
  getNativeHostBinding,
  startApplication,
  waitForNativeSurface,
} from "@solid-native/runtime";
import { createReactNativeClipboardService } from "@solid-native/clipboard/react-native";
import { createClipboardController } from "@solid-native/clipboard/solid";

const READY_TEXT = "Solid Native clipboard ready";
const WRITE_PROOF_TEXT = "Private Solid Native clipboard write proof";
const READ_PROOF_TEXT = "Private external clipboard read proof";
const WRITE_LABEL = "Write Solid Native clipboard proof";
const READ_LABEL = "Read Solid Native clipboard proof";
const CLEAR_LABEL = "Clear native clipboard";
const DISPOSE_LABEL = "Dispose Solid Native clipboard proof";
const WRITTEN_TEXT = "Clipboard proof written";
const READ_TEXT = "External clipboard proof read";
const CLEARED_TEXT = "Clipboard cleared";
const CLIPBOARD_OWNER_NAME = "clipboard.root";
const CLIPBOARD_COMPUTATION_NAME = "platform.clipboard.output";

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
const PERMITTED_OWNER_ATTRIBUTES = new Set(["owner.name"]);

function reportFatal(error: unknown): void {
  console.error("SOLID_NATIVE_CLIPBOARD_FAILED", error);
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
        backgroundColor: "#0369a1",
        borderRadius: 8,
        marginTop: 12,
        padding: 12,
      }}
    >
      <Text style={{ color: "#ffffff", fontSize: 16 }}>{props.label}</Text>
    </Pressable>
  );
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

async function run(): Promise<void> {
  try {
    const binding = getNativeHostBinding();
    await waitForNativeSurface({ binding, timeoutMs: 5_000 });
    const host = createNativeFabricHost({
      binding,
      descriptors: CORE_COMPONENT_DESCRIPTORS,
    });
    const service = createReactNativeClipboardService();
    const records: CausalTelemetryRecord[] = [];
    let operationSequence = 0;
    const telemetry = createCausalTelemetry({
      sink: (record) => records.push(record),
      createOperationId: () => `physical-clipboard-${++operationSequence}`,
    });
    let application: NativeApplication;

    const publishStatus = async (
      setStatus: (value: string) => string,
      value: string,
      marker: string,
    ): Promise<void> => {
      setStatus(value);
      const commit = await application.root.flushMounted();
      if (commit === undefined) {
        throw new Error(`${marker} did not produce a native commit.`);
      }
      console.log(marker);
    };

    const verifyReadCommit = async (): Promise<void> => {
      await Promise.resolve();
      const commit = await application.root.flushMounted();
      if (commit === undefined) {
        throw new Error("The clipboard read did not produce a native commit.");
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
          record.attributes["event.name"] === "platform.clipboard.read" &&
          operation?.causes.includes(record.operationId) === true,
      );
      const computation = startedOperation(
        records,
        "solid-native.computation",
        (record) =>
          record.attributes["computation.name"] ===
            CLIPBOARD_COMPUTATION_NAME &&
          operation?.causes.includes(record.operationId) === true,
      );
      const owner = startedOperation(
        records,
        "solid-native.owner",
        (record) =>
          record.attributes["owner.name"] === CLIPBOARD_OWNER_NAME &&
          operation?.causes.includes(record.operationId) === true,
      );
      if (
        event === undefined ||
        operation === undefined ||
        event.attributes["event.priority"] !== "default" ||
        event.attributes["event.source"] !== "platform" ||
        operation.attributes["commit.priority"] !== "normal" ||
        operation.causes.length !== 3 ||
        computation === undefined ||
        owner === undefined ||
        !hasOnlyAttributes(event, PERMITTED_EVENT_ATTRIBUTES) ||
        !hasOnlyAttributes(computation, PERMITTED_COMPUTATION_ATTRIBUTES) ||
        !hasOnlyAttributes(owner, PERMITTED_OWNER_ATTRIBUTES)
      ) {
        throw new Error(
          `The clipboard read lost its exact private event, owner, and computation causes (causes=${String(operation?.causes.length ?? 0)}, event=${String(event !== undefined)}, owner=${String(owner !== undefined)}, computation=${String(computation !== undefined)}).`,
        );
      }
      const serialized = JSON.stringify(records);
      if (
        serialized.includes(WRITE_PROOF_TEXT) ||
        serialized.includes(READ_PROOF_TEXT)
      ) {
        throw new Error(
          "Private clipboard content escaped into causal telemetry.",
        );
      }
      console.log("SOLID_NATIVE_CLIPBOARD_READ_CAUSALITY_SUCCEEDED");
    };

    application = startApplication(
      () => {
        const clipboard = createClipboardController(service);
        const [status, setStatus] = createSignal("Clipboard untouched");
        return (
          <CausalOwner name={CLIPBOARD_OWNER_NAME}>
            <View
              style={{
                alignItems: "stretch",
                backgroundColor: "#f0f9ff",
                flex: 1,
                justifyContent: "center",
                padding: 24,
              }}
            >
              <Text accessibilityRole="header" style={{ fontSize: 22 }}>
                {READY_TEXT}
              </Text>
              <CausalComputation name={CLIPBOARD_COMPUTATION_NAME}>
                <Text style={{ color: "#0c4a6e", fontSize: 16 }}>{status}</Text>
              </CausalComputation>
              <ProofButton
                label={WRITE_LABEL}
                onPress={() => {
                  clipboard.writeText(WRITE_PROOF_TEXT);
                  void publishStatus(
                    setStatus,
                    WRITTEN_TEXT,
                    "SOLID_NATIVE_CLIPBOARD_WRITTEN",
                  ).catch(reportFatal);
                }}
              />
              <ProofButton
                label={READ_LABEL}
                onPress={() => {
                  // Let physical XCUITest finish synthesizing the tap before
                  // iOS presents its cross-application paste sheet. Otherwise
                  // XCTest waits a full quiescence timeout on the deliberately
                  // blocked application main loop before it can tap Allow.
                  setTimeout(() => {
                    void clipboard.readText().then((text) => {
                      if (text !== READ_PROOF_TEXT) {
                        throw new Error(
                          "The native clipboard did not return the external proof text.",
                        );
                      }
                      setStatus(READ_TEXT);
                      void verifyReadCommit().catch(reportFatal);
                    }, reportFatal);
                  }, 1_000);
                }}
              />
              <ProofButton
                label={CLEAR_LABEL}
                onPress={() => {
                  clipboard.clear();
                  void publishStatus(
                    setStatus,
                    CLEARED_TEXT,
                    "SOLID_NATIVE_CLIPBOARD_CLEARED",
                  ).catch(reportFatal);
                }}
              />
              <ProofButton
                label={DISPOSE_LABEL}
                onPress={() => {
                  void application.dispose().then(() => {
                    if (binding.getSurfaceInfo().ready) {
                      throw new Error(
                        "The clipboard proof resolved disposal before its native surface stopped.",
                      );
                    }
                    console.log("SOLID_NATIVE_CLIPBOARD_TEARDOWN_SUCCEEDED");
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
          name: "clipboard-e2e",
          initialProps: {
            style: { backgroundColor: "#f0f9ff", flex: 1 },
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
      throw new Error("The clipboard proof did not mount exactly once.");
    }
    console.log("SOLID_NATIVE_CLIPBOARD_READY");
  } catch (error) {
    reportFatal(error);
  }
}

void run();
