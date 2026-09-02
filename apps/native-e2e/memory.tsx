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
  type NativeFabricBinding,
} from "@solid-native/runtime";
import {
  SolidNativeGeneratedViewNativeComponent as GeneratedView,
  SolidNativeGeneratedViewNativeDescriptor as GENERATED_VIEW_DESCRIPTOR,
} from "./generated/SolidNativeBindings";

const PROOF_TIMEOUT_MS = 5_000;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForSurface(binding: NativeFabricBinding): Promise<void> {
  const deadline = Date.now() + PROOF_TIMEOUT_MS;
  while (!binding.getSurfaceInfo().ready) {
    if (Date.now() >= deadline) {
      throw new Error(
        "The native Fabric surface was not ready within five seconds.",
      );
    }
    await delay(10);
  }
}

function reportFatal(error: unknown): void {
  console.error("SOLID_NATIVE_MEMORY_FAILED", error);
  setTimeout(() => {
    throw error instanceof Error ? error : new Error(String(error));
  });
}

async function run(): Promise<void> {
  const binding = getNativeHostBinding();
  await waitForSurface(binding);
  const host = createNativeFabricHost({
    binding,
    descriptors: [...CORE_COMPONENT_DESCRIPTORS, GENERATED_VIEW_DESCRIPTOR],
  });
  const [count, setCount] = createSignal(0);
  let application: NativeApplication | undefined;

  const handlePress = (): void => {
    setCount((value) => value + 1);
    void application?.root
      .flush()
      .then((commit) => {
        console.log(
          "SOLID_NATIVE_MEMORY_UPDATE",
          JSON.stringify({ sequence: commit?.sequence ?? null }),
        );
      })
      .catch(reportFatal);
  };

  application = startApplication(
    () => (
      <View style={styles.screen} testID="memory-root">
        <Text
          accessibilityRole="header"
          style={styles.title}
          testID="memory-title"
        >
          Native renderer memory scenario
        </Text>
        <Text style={styles.status} testID="memory-status">
          Memory control count {count()}
        </Text>
        <GeneratedView
          accessibilityLabel="Memory generated Fabric component"
          accessible
          label="Memory generated Fabric component"
          style={styles.generated}
          testID="memory-generated-view"
        />
        <Pressable
          accessibilityLabel="Run memory update"
          accessibilityRole="button"
          onPress={handlePress}
          style={styles.button}
          testID="memory-button"
        >
          <Text style={styles.buttonText}>Run memory update</Text>
        </Pressable>
      </View>
    ),
    host,
    {
      surface: {
        name: "native-memory",
        initialProps: { style: { backgroundColor: "#f4f0ff", flex: 1 } },
      },
      autoCommit: false,
      requirements: {
        capabilities: ["bubblingEvents"],
        components: ["Pressable", "SolidNativeGeneratedView", "Text", "View"],
      },
      onCommitError: reportFatal,
    },
  );
  const mount = await application.root.flush();
  if (mount?.sequence !== 1 || !Number.isSafeInteger(mount.hostRevision)) {
    throw new Error("The memory scenario did not produce native commit 1.");
  }
  setCount(1);
  const settled = await application.root.flush();
  if (settled?.sequence !== 2 || !Number.isSafeInteger(settled.hostRevision)) {
    throw new Error("The memory scenario did not produce native commit 2.");
  }
  console.log(
    "SOLID_NATIVE_MEMORY_READY",
    JSON.stringify({
      sequence: settled.sequence,
      hostRevision: settled.hostRevision,
    }),
  );
}

const styles = {
  screen: {
    backgroundColor: "#f4f0ff",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  title: {
    color: "#35156d",
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 16,
  },
  status: {
    color: "#281942",
    fontSize: 18,
    marginBottom: 16,
  },
  generated: {
    backgroundColor: "#5b21b6",
    height: 48,
    marginBottom: 16,
  },
  button: {
    alignItems: "center",
    backgroundColor: "#6d28d9",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "600",
  },
} as const;

void run().catch(reportFatal);
