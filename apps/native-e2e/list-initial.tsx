/** @jsxImportSource @solid-native/core */
import "react-native/setup-env";

import {
  CORE_COMPONENT_DESCRIPTORS,
  Pressable,
  Text,
  View,
  VirtualizedList,
} from "@solid-native/core";
import {
  type NativeApplication,
  type NativeSyntheticEvent,
} from "@solid-native/renderer";
import {
  createNativeFabricHost,
  getNativeHostBinding,
  startApplication,
} from "@solid-native/runtime";
import { onCleanup } from "solid-js";

const PROOF_TIMEOUT_MS = 5_000;
const ITEM_COUNT = 1_000;
const ITEM_SIZE = 50;
const VIEWPORT_SIZE = 350;
const INITIAL_INDEX = 100;
const MAXIMUM_MOUNTED_ROWS = VIEWPORT_SIZE / ITEM_SIZE;
const READY_TEXT = "Solid Native initial VirtualizedList ready";
const DISPOSE_LABEL = "Dispose initial VirtualizedList proof";

const items = Array.from({ length: ITEM_COUNT }, (_, index) => ({
  id: `initial-${String(index)}`,
  label: `Initial virtualized row ${String(index)}`,
}));

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForSurface(): Promise<
  ReturnType<typeof getNativeHostBinding>
> {
  const binding = getNativeHostBinding();
  const deadline = Date.now() + PROOF_TIMEOUT_MS;
  while (!binding.getSurfaceInfo().ready) {
    if (Date.now() >= deadline) {
      throw new Error(
        "The native Fabric surface was not ready within five seconds.",
      );
    }
    await delay(10);
  }
  return binding;
}

function reportFatal(error: unknown): void {
  console.error("SOLID_NATIVE_INITIAL_VIRTUALIZED_LIST_FAILED", error);
  setTimeout(() => {
    throw error instanceof Error ? error : new Error(String(error));
  });
}

async function run(): Promise<void> {
  try {
    const binding = await waitForSurface();
    const host = createNativeFabricHost({
      binding,
      descriptors: CORE_COMPONENT_DESCRIPTORS,
    });
    const activeKeys = new Set<string>();
    let ownerCreations = 0;
    let ownerDisposals = 0;
    let application: NativeApplication | undefined;

    const dispose = async (event: NativeSyntheticEvent): Promise<void> => {
      if (
        event.name !== "press" ||
        event.priority !== "discrete" ||
        !event.bubbles
      ) {
        throw new Error(
          "The initial VirtualizedList disposal received an invalid native press.",
        );
      }
      const app = application;
      if (app === undefined) {
        throw new Error(
          "The initial VirtualizedList application was not retained.",
        );
      }
      await app.dispose();
      if (
        !app.root.disposed ||
        activeKeys.size !== 0 ||
        ownerCreations !== ownerDisposals ||
        binding.getSurfaceInfo().ready
      ) {
        throw new Error(
          `The initial VirtualizedList did not tear down cleanly: ${JSON.stringify(
            {
              activeRowCount: activeKeys.size,
              ownerCreations,
              ownerDisposals,
              rootDisposed: app.root.disposed,
              surfaceReady: binding.getSurfaceInfo().ready,
            },
          )}.`,
        );
      }
      console.log(
        `SOLID_NATIVE_INITIAL_VIRTUALIZED_LIST_TEARDOWN_SUCCEEDED ${JSON.stringify(
          {
            schemaVersion: 0,
            ownerCreations,
            ownerDisposals,
            rootDisposed: app.root.disposed,
            surfaceReady: binding.getSurfaceInfo().ready,
          },
        )}`,
      );
    };

    application = startApplication(
      () => (
        <View style={{ flex: 1, padding: 24 }}>
          <Text
            accessibilityRole="header"
            testID="solid-native-initial-virtualized-list-status"
            style={{ color: "#111827", fontSize: 20, height: 40 }}
          >
            {READY_TEXT}
          </Text>
          <Pressable
            accessible
            accessibilityRole="button"
            accessibilityLabel={DISPOSE_LABEL}
            onPress={(event) => {
              void dispose(event).catch(reportFatal);
            }}
            style={{ backgroundColor: "#0f766e", padding: 12 }}
          >
            <Text style={{ color: "#ffffff" }}>{DISPOSE_LABEL}</Text>
          </Pressable>
          <VirtualizedList
            accessible={binding.platform === "android"}
            accessibilityLabel="Solid Native initial virtualized list"
            testID="solid-native-initial-virtualized-list"
            data={items}
            initialScrollKey={items[INITIAL_INDEX]!.id}
            itemSize={ITEM_SIZE}
            viewportSize={VIEWPORT_SIZE}
            overscan={0}
            keyExtractor={(item) => item.id}
            renderItem={({ item, key }) => {
              if (activeKeys.has(key)) {
                throw new Error(`Initial list mounted duplicate owner ${key}.`);
              }
              activeKeys.add(key);
              ownerCreations++;
              onCleanup(() => {
                if (!activeKeys.delete(key)) {
                  reportFatal(
                    new Error(`Initial list disposed inactive owner ${key}.`),
                  );
                }
                ownerDisposals++;
              });
              return (
                <Text
                  accessible
                  accessibilityLabel={item().label}
                  style={{
                    backgroundColor: "#dbeafe",
                    borderBottomColor: "#64748b",
                    borderBottomWidth: 1,
                    color: "#0f172a",
                    fontSize: 16,
                    height: ITEM_SIZE,
                    padding: 14,
                  }}
                >
                  {item().label}
                </Text>
              );
            }}
            style={{ borderColor: "#475569", borderWidth: 1 }}
          />
        </View>
      ),
      host,
      {
        surface: {
          name: "initial-virtualized-list-e2e",
          initialProps: {
            style: { backgroundColor: "#ffffff", flex: 1, paddingTop: 48 },
          },
        },
        requirements: {
          capabilities: ["bubblingEvents", "commitMountEvents"],
          components: ["Pressable", "ScrollView", "Text", "View"],
        },
        onCommitError: reportFatal,
      },
    );
    const initial = await application.root.flushMounted();
    const expectedKeys = Array.from(
      { length: MAXIMUM_MOUNTED_ROWS },
      (_, offset) => `initial-${String(INITIAL_INDEX + offset)}`,
    );
    if (
      initial?.sequence !== 1 ||
      !Number.isSafeInteger(initial.hostRevision) ||
      activeKeys.size !== MAXIMUM_MOUNTED_ROWS ||
      expectedKeys.some((key) => !activeKeys.has(key)) ||
      activeKeys.has("initial-0") ||
      ownerCreations !== activeKeys.size ||
      ownerDisposals !== 0
    ) {
      throw new Error(
        `The initial VirtualizedList did not mount only its target window: ${JSON.stringify(
          {
            activeKeys: [...activeKeys],
            ownerCreations,
            ownerDisposals,
            sequence: initial?.sequence,
          },
        )}.`,
      );
    }
    console.log(
      `SOLID_NATIVE_INITIAL_VIRTUALIZED_LIST_READY ${JSON.stringify({
        schemaVersion: 0,
        initialIndex: INITIAL_INDEX,
        itemSize: ITEM_SIZE,
        viewportSize: VIEWPORT_SIZE,
        activeKeys: [...activeKeys],
        sequence: initial.sequence,
        hostRevision: initial.hostRevision,
      })}`,
    );
  } catch (error) {
    reportFatal(error);
  }
}

void run();
