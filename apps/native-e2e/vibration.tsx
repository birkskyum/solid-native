/** @jsxImportSource @solid-native/core */
import "react-native/setup-env";

import {
  CORE_COMPONENT_DESCRIPTORS,
  Pressable,
  Text,
  View,
} from "@solid-native/core";
import { createSignal, type NativeApplication } from "@solid-native/renderer";
import {
  createNativeFabricHost,
  getNativeHostBinding,
  startApplication,
  waitForNativeSurface,
} from "@solid-native/runtime";
import { createReactNativeVibrationService } from "@solid-native/vibration/react-native";
import { createVibrationController } from "@solid-native/vibration/solid";

const READY_TEXT = "Solid Native vibration ready";
const START_LABEL = "Start repeating native vibration";
const CANCEL_LABEL = "Cancel native vibration";
const DISPOSE_LABEL = "Dispose Solid Native vibration proof";
const ACTIVE_TEXT = "Repeating vibration active";
const CANCELLED_TEXT = "Vibration cancelled";

function reportFatal(error: unknown): void {
  console.error("SOLID_NATIVE_VIBRATION_FAILED", error);
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
        backgroundColor: "#7c3aed",
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
    const service = createReactNativeVibrationService();
    let application: NativeApplication;
    application = startApplication(
      () => {
        const vibration = createVibrationController(service);
        const [status, setStatus] = createSignal("No vibration active");
        return (
          <View
            style={{
              alignItems: "stretch",
              backgroundColor: "#faf5ff",
              flex: 1,
              justifyContent: "center",
              padding: 24,
            }}
          >
            <Text accessibilityRole="header" style={{ fontSize: 22 }}>
              {READY_TEXT}
            </Text>
            <Text style={{ color: "#581c87", fontSize: 16 }}>{status}</Text>
            <ProofButton
              label={START_LABEL}
              onPress={() => {
                vibration.vibrate({
                  pattern: [
                    { delayMs: 0, durationMs: 80 },
                    { delayMs: 160, durationMs: 140 },
                  ],
                  repeat: true,
                });
                setStatus(ACTIVE_TEXT);
                console.log("SOLID_NATIVE_VIBRATION_STARTED");
              }}
            />
            <ProofButton
              label={CANCEL_LABEL}
              onPress={() => {
                vibration.cancel();
                setStatus(CANCELLED_TEXT);
                console.log("SOLID_NATIVE_VIBRATION_CANCELLED");
              }}
            />
            <ProofButton
              label={DISPOSE_LABEL}
              onPress={() => {
                void application.dispose().then(() => {
                  if (binding.getSurfaceInfo().ready) {
                    throw new Error(
                      "The vibration proof resolved disposal before its native surface stopped.",
                    );
                  }
                  console.log("SOLID_NATIVE_VIBRATION_TEARDOWN_SUCCEEDED");
                }, reportFatal);
              }}
            />
          </View>
        );
      },
      host,
      {
        surface: {
          name: "vibration-e2e",
          initialProps: {
            style: { backgroundColor: "#faf5ff", flex: 1 },
          },
        },
        requirements: { components: ["Pressable", "Text", "View"] },
        onCommitError: reportFatal,
      },
    );
    const initial = await application.root.flushMounted();
    if (initial?.sequence !== 1) {
      throw new Error("The vibration proof did not mount exactly once.");
    }
    console.log("SOLID_NATIVE_VIBRATION_READY");
  } catch (error) {
    reportFatal(error);
  }
}

void run();
