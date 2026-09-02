/** @jsxImportSource @solid-native/core */
import {
  CORE_COMPONENT_DESCRIPTORS,
  Pressable,
  ScrollView,
  Text,
  View,
  type NativeNode,
} from "@solid-native/core";
import { NativeHistory, NativeStack } from "@solid-native/navigation";
import { Loading, createSignal, mount } from "@solid-native/renderer";
import { InMemoryHost } from "@solid-native/testing";
import { createMemo } from "solid-js";

async function runSandbox(): Promise<void> {
  const host = new InMemoryHost({ descriptors: CORE_COMPONENT_DESCRIPTORS });
  const history = new NativeHistory({ initialHref: "/" });
  const [count, setCount] = createSignal(0);
  let resolveProfile!: (value: string) => void;
  const profile = new Promise<string>((resolve) => {
    resolveProfile = resolve;
  });
  let pressableRef: NativeNode | undefined;

  const app = mount(
    () => {
      const profileLabel = createMemo(() => profile);
      return (
        <NativeStack history={history}>
          {(entry) =>
            entry().href === "/detail" ? (
              <View>
                <Text>Detail</Text>
              </View>
            ) : (
              <ScrollView
                contentContainerStyle={{ padding: 24, gap: 12 }}
                accessibilityLabel="Solid Native validation screen"
              >
                <View style={{ gap: 8 }}>
                  <Text accessibilityRole="header" style={{ fontSize: 24 }}>
                    Solid Native Phase 0
                  </Text>
                  <Loading fallback={<Text>Sandbox profile loading</Text>}>
                    <Text>{profileLabel()}</Text>
                  </Loading>
                  <Pressable
                    ref={(node) => {
                      pressableRef = node;
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Increment counter"
                    onPress={() => setCount((value) => value + 1)}
                    style={{ padding: 12, backgroundColor: "#315efb" }}
                  >
                    <Text
                      style={{ color: "white" }}
                    >{`Press count: ${count()}`}</Text>
                  </Pressable>
                </View>
              </ScrollView>
            )
          }
        </NativeStack>
      );
    },
    host,
    {
      surface: {
        name: "native-sandbox",
        initialProps: { appearance: "light" },
      },
      autoCommit: false,
    },
  );

  await app.root.flush();
  const initial = host.getSurfaceSnapshot(app.root.surfaceId);
  resolveProfile("Sandbox profile ready");
  await profile;
  await Promise.resolve();
  await app.root.flush();
  const pressable = initial.nodes.find(
    (node) => node.kind === "element" && node.component === "Pressable",
  );
  if (pressable === undefined || pressableRef === undefined) {
    throw new Error("Sandbox Pressable did not mount.");
  }

  host.injectEvent({
    surface: app.root.surfaceId,
    target: pressable.node,
    name: "press",
    payload: { pointerType: "touch" },
    priority: "discrete",
    bubbles: true,
    timestamp: 1,
  });
  await app.root.flush();
  host.setMeasurement(app.root.surfaceId, pressable.node, {
    x: 24,
    y: 72,
    width: 240,
    height: 48,
    pageX: 24,
    pageY: 72,
  });

  const afterPress = host.getSurfaceSnapshot(app.root.surfaceId);
  const measurement = await pressableRef.measure();
  const summary = {
    surface: afterPress.name,
    initialSequence: initial.sequence,
    updatedSequence: afterPress.sequence,
    nodes: afterPress.nodes.length,
    text: afterPress.nodes
      .filter((node) => node.kind === "text")
      .map((node) => node.text),
    measurement,
    commits: host.commits.map((commit) => ({
      sequence: commit.sequence,
      priority: commit.priority,
      mutations: commit.mutations.length,
    })),
  };

  console.log(JSON.stringify(summary, null, 2));
  await app.dispose();
}

void runSandbox().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
