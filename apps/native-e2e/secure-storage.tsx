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
import { createCausalTelemetry } from "@solid-native/observability";
import { createSignal, type NativeApplication } from "@solid-native/renderer";
import { createReactNativeSecureStorage } from "@solid-native/secure-storage/react-native";
import { createSecureStorageController } from "@solid-native/secure-storage/solid";
import {
  createNativeFabricHost,
  getNativeHostBinding,
  startApplication,
  waitForNativeSurface,
} from "@solid-native/runtime";

const READY_TEXT = "Solid Native secure storage ready";
const PROOF_KEY = "refresh-session";
const PROOF_SECRET = "Private Solid Native refresh token proof";
const STORE_LABEL = "Store encrypted session proof";
const READ_LABEL = "Restore encrypted session proof";
const DELETE_LABEL = "Delete encrypted session proof";
const DISPOSE_LABEL = "Dispose Solid Native secure storage proof";
const STORED_TEXT = "Session proof stored in native secure storage";
const RESTORED_TEXT = "Session proof restored from native secure storage";
const DELETED_TEXT = "Session proof deleted from native secure storage";

function reportFatal(error: unknown): void {
  console.error("SOLID_NATIVE_SECURE_STORAGE_FAILED", error);
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
        backgroundColor: "#115e59",
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
    const service = createReactNativeSecureStorage({
      servicePrefix: "dev.solidnative.e2e.secure-storage",
    });
    const records: Array<{
      readonly type: string;
      readonly name?: string;
      readonly operationId: string;
      readonly causes?: readonly string[];
      readonly attributes: Readonly<Record<string, unknown>>;
    }> = [];
    let operationSequence = 0;
    const telemetry = createCausalTelemetry({
      sink: (record) => records.push(record),
      createOperationId: () => `physical-secure-storage-${++operationSequence}`,
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
        throw new Error(
          "The secure-storage read did not produce a native commit.",
        );
      }
      const event = records.find(
        (record) =>
          record.type === "operation-started" &&
          record.name === "solid-native.event" &&
          record.attributes["event.name"] === "platform.secure-storage.read",
      );
      const operation = records.find(
        (record) =>
          record.type === "operation-started" &&
          record.name === "solid-native.commit" &&
          record.attributes["commit.sequence"] === commit.sequence,
      );
      if (
        event === undefined ||
        operation === undefined ||
        event.attributes["event.priority"] !== "default" ||
        operation.attributes["commit.priority"] !== "normal" ||
        !operation.causes?.includes(event.operationId)
      ) {
        throw new Error(
          "The secure-storage read lost its default causal commit.",
        );
      }
      const serialized = JSON.stringify(records);
      if (serialized.includes(PROOF_KEY) || serialized.includes(PROOF_SECRET)) {
        throw new Error(
          "Private secure-storage material escaped into causal telemetry.",
        );
      }
      console.log("SOLID_NATIVE_SECURE_STORAGE_READ_CAUSALITY_SUCCEEDED");
    };

    application = startApplication(
      () => {
        const storage = createSecureStorageController(service);
        const [status, setStatus] = createSignal("Secure session untouched");
        return (
          <CausalOwner name="secure-storage.root">
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
              <CausalComputation name="platform.secure-storage.output">
                <Text style={{ color: "#134e4a", fontSize: 16 }}>{status}</Text>
              </CausalComputation>
              <ProofButton
                label={STORE_LABEL}
                onPress={() => {
                  void storage
                    .setItem(PROOF_KEY, PROOF_SECRET)
                    .then(() =>
                      publishStatus(
                        setStatus,
                        STORED_TEXT,
                        "SOLID_NATIVE_SECURE_STORAGE_STORED",
                      ),
                    )
                    .catch(reportFatal);
                }}
              />
              <ProofButton
                label={READ_LABEL}
                onPress={() => {
                  void storage
                    .getItem(PROOF_KEY)
                    .then((secret) => {
                      if (secret !== PROOF_SECRET) {
                        throw new Error(
                          "Native secure storage did not restore the exact proof value.",
                        );
                      }
                      setStatus(RESTORED_TEXT);
                      return verifyReadCommit();
                    })
                    .catch(reportFatal);
                }}
              />
              <ProofButton
                label={DELETE_LABEL}
                onPress={() => {
                  void storage
                    .removeItem(PROOF_KEY)
                    .then(async () => {
                      if ((await storage.getItem(PROOF_KEY)) !== null) {
                        throw new Error(
                          "Native secure storage retained the deleted proof value.",
                        );
                      }
                      await publishStatus(
                        setStatus,
                        DELETED_TEXT,
                        "SOLID_NATIVE_SECURE_STORAGE_DELETED",
                      );
                    })
                    .catch(reportFatal);
                }}
              />
              <ProofButton
                label={DISPOSE_LABEL}
                onPress={() => {
                  void application.dispose().then(() => {
                    if (binding.getSurfaceInfo().ready) {
                      throw new Error(
                        "The secure-storage proof resolved disposal before its native surface stopped.",
                      );
                    }
                    console.log(
                      "SOLID_NATIVE_SECURE_STORAGE_TEARDOWN_SUCCEEDED",
                    );
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
          name: "secure-storage-e2e",
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
      throw new Error("The secure-storage proof did not mount exactly once.");
    }
    console.log("SOLID_NATIVE_SECURE_STORAGE_READY");
  } catch (error) {
    reportFatal(error);
  }
}

void run();
