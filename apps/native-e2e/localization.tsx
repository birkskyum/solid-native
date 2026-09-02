/** @jsxImportSource @solid-native/core */
import "react-native/setup-env";

import {
  CORE_COMPONENT_DESCRIPTORS,
  Pressable,
  Text,
  View,
} from "@solid-native/core";
import { getReactNativeLocalizationSnapshot } from "@solid-native/localization/react-native";
import {
  createNativeFabricHost,
  getNativeHostBinding,
  startApplication,
  waitForNativeSurface,
} from "@solid-native/runtime";

const READY_TEXT = "Solid Native localization ready";
const LEADING_MARKER_LABEL = "Localization leading marker";
const TRAILING_MARKER_LABEL = "Localization trailing marker";
const DISPOSE_LABEL = "Dispose Solid Native localization proof";

function reportFatal(error: unknown): void {
  console.error("SOLID_NATIVE_LOCALIZATION_FAILED", error);
  setTimeout(() => {
    throw error instanceof Error ? error : new Error(String(error));
  });
}

async function run(): Promise<void> {
  try {
    const localization = getReactNativeLocalizationSnapshot();
    const binding = getNativeHostBinding();
    await waitForNativeSurface({ binding, timeoutMs: 5_000 });
    const host = createNativeFabricHost({
      binding,
      descriptors: CORE_COMPONENT_DESCRIPTORS,
    });
    let application: ReturnType<typeof startApplication>;
    application = startApplication(
      () => (
        <View
          style={{
            alignItems: "center",
            backgroundColor: "#f5f3ff",
            flex: 1,
            justifyContent: "center",
            padding: 24,
          }}
        >
          <Text accessibilityRole="header" style={{ fontSize: 22 }}>
            {READY_TEXT}
          </Text>
          <Text style={{ color: "#4c1d95", fontSize: 17 }}>
            {`Locale ${localization.localeTag}`}
          </Text>
          <Text style={{ color: "#4c1d95", fontSize: 17 }}>
            {`Direction ${localization.layoutDirection}`}
          </Text>
          <Text style={{ color: "#4c1d95", fontSize: 17 }}>
            {localization.swapsLeftAndRightInRTL
              ? "RTL style swapping enabled"
              : "RTL style swapping disabled"}
          </Text>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              marginTop: 12,
              width: 240,
            }}
          >
            <Text
              accessible
              accessibilityLabel={LEADING_MARKER_LABEL}
              style={{ backgroundColor: "#ddd6fe", padding: 8 }}
            >
              Leading
            </Text>
            <Text
              accessible
              accessibilityLabel={TRAILING_MARKER_LABEL}
              style={{ backgroundColor: "#c4b5fd", padding: 8 }}
            >
              Trailing
            </Text>
          </View>
          <Pressable
            accessible
            accessibilityLabel={DISPOSE_LABEL}
            accessibilityRole="button"
            onPress={() => {
              void application.dispose().then(() => {
                if (binding.getSurfaceInfo().ready) {
                  throw new Error(
                    "The localization proof resolved disposal before its native surface stopped.",
                  );
                }
                console.log("SOLID_NATIVE_LOCALIZATION_TEARDOWN_SUCCEEDED");
              }, reportFatal);
            }}
            style={{
              backgroundColor: "#6d28d9",
              borderRadius: 8,
              marginTop: 12,
              padding: 12,
            }}
          >
            <Text style={{ color: "#ffffff", fontSize: 16 }}>
              {DISPOSE_LABEL}
            </Text>
          </Pressable>
        </View>
      ),
      host,
      {
        surface: {
          name: "localization-e2e",
          initialProps: {
            style: { backgroundColor: "#f5f3ff", flex: 1 },
          },
        },
        requirements: { components: ["Pressable", "Text", "View"] },
        onCommitError: reportFatal,
      },
    );
    const initial = await application.root.flushMounted();
    if (initial?.sequence !== 1) {
      throw new Error("The localization proof did not mount exactly once.");
    }
    console.log(
      "SOLID_NATIVE_LOCALIZATION_READY",
      localization.localeTag,
      localization.layoutDirection,
      localization.swapsLeftAndRightInRTL,
    );
  } catch (error) {
    reportFatal(error);
  }
}

void run();
