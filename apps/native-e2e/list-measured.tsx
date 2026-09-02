/** @jsxImportSource @solid-native/core */
import "react-native/setup-env";

import {
  CORE_COMPONENT_DESCRIPTORS,
  Text,
  View,
  VirtualizedList,
  type NativeLayoutChangeEvent,
} from "@solid-native/core";
import {
  createSignal,
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
const ITEM_COUNT = 240;
const ESTIMATED_ITEM_SIZE = 56;
const VIEWPORT_SIZE = 392;
const OVERSCAN = 2;
const SHORT_ITEM_SIZE = 40;
const TALL_ITEM_SIZE = 80;
const MINIMUM_PROOF_OFFSET = ESTIMATED_ITEM_SIZE * (OVERSCAN + 1);
const MAXIMUM_MOUNTED_ROWS =
  Math.ceil(VIEWPORT_SIZE / SHORT_ITEM_SIZE) + OVERSCAN * 2 + 1;
const SETTLING_TEXT = "Solid Native measured VirtualizedList settling";
const READY_TEXT = "Solid Native measured VirtualizedList ready";
const SCROLLED_TEXT =
  "Solid Native measured VirtualizedList physical scroll mounted";

const items = Array.from({ length: ITEM_COUNT }, (_, index) => ({
  id: `measured-${String(index)}`,
  index,
  label: `Measured virtualized row ${String(index)}`,
  height: index % 2 === 0 ? SHORT_ITEM_SIZE : TALL_ITEM_SIZE,
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

function contentOffsetY(event: NativeSyntheticEvent): number {
  const payload = event.payload;
  const contentOffset =
    typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? (payload as Readonly<Record<string, unknown>>).contentOffset
      : undefined;
  const offset =
    typeof contentOffset === "object" &&
    contentOffset !== null &&
    !Array.isArray(contentOffset)
      ? (contentOffset as Readonly<Record<string, unknown>>).y
      : undefined;
  if (typeof offset !== "number" || !Number.isFinite(offset)) {
    throw new Error(
      "The measured VirtualizedList scroll event omitted its vertical offset.",
    );
  }
  return offset;
}

function reportFatal(error: unknown): void {
  console.error("SOLID_NATIVE_MEASURED_VIRTUALIZED_LIST_FAILED", error);
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
    const measuredKeys = new Set<string>();
    let ownerCreations = 0;
    let ownerDisposals = 0;
    let latestOffset = 0;
    let initialReadyPublished = false;
    let scrollProofStarted = false;
    let application: NativeApplication | undefined;
    const [status, setStatus] = createSignal(SETTLING_TEXT);

    const handleRowLayout = (
      key: string,
      expectedHeight: number,
      event: NativeLayoutChangeEvent,
    ): void => {
      const measuredHeight = event.payload.layout.height;
      if (
        event.name !== "layout" ||
        !Number.isFinite(measuredHeight) ||
        Math.abs(measuredHeight - expectedHeight) > 0.01
      ) {
        throw new Error(
          `Measured row ${key} reported invalid native geometry: ${JSON.stringify(event.payload.layout)}.`,
        );
      }
      measuredKeys.add(key);
      if (
        !initialReadyPublished &&
        measuredKeys.has("measured-0") &&
        measuredKeys.has("measured-1") &&
        measuredKeys.has("measured-2")
      ) {
        initialReadyPublished = true;
        setStatus(READY_TEXT);
        console.log(
          `SOLID_NATIVE_MEASURED_VIRTUALIZED_LIST_READY ${JSON.stringify({
            schemaVersion: 0,
            estimatedItemSize: ESTIMATED_ITEM_SIZE,
            shortItemSize: SHORT_ITEM_SIZE,
            tallItemSize: TALL_ITEM_SIZE,
            measuredRowCount: measuredKeys.size,
            activeRowCount: activeKeys.size,
          })}`,
        );
      }
    };

    const handleScroll = (event: NativeSyntheticEvent): void => {
      if (event.name !== "scroll" || event.priority !== "continuous") {
        throw new Error(
          "The measured VirtualizedList emitted an invalid scroll event.",
        );
      }
      latestOffset = contentOffsetY(event);
    };

    const handleScrollEnd = async (
      event: NativeSyntheticEvent,
    ): Promise<void> => {
      if (scrollProofStarted) return;
      if (
        event.name !== "scrollEndDrag" ||
        event.priority !== "discrete" ||
        !event.bubbles
      ) {
        throw new Error(
          "The measured VirtualizedList emitted an invalid drag completion.",
        );
      }
      scrollProofStarted = true;
      const deadline = Date.now() + PROOF_TIMEOUT_MS;
      while (
        (latestOffset < MINIMUM_PROOF_OFFSET || activeKeys.has("measured-0")) &&
        Date.now() < deadline
      ) {
        await delay(25);
      }
      const app = application;
      const measuredBeyondInitialWindow = [...measuredKeys].some((key) => {
        const index = Number(key.slice("measured-".length));
        return Number.isSafeInteger(index) && index >= 8;
      });
      if (
        app === undefined ||
        latestOffset < MINIMUM_PROOF_OFFSET ||
        activeKeys.size === 0 ||
        activeKeys.size > MAXIMUM_MOUNTED_ROWS ||
        activeKeys.has("measured-0") ||
        ownerCreations - ownerDisposals !== activeKeys.size ||
        !measuredBeyondInitialWindow
      ) {
        throw new Error(
          `The measured VirtualizedList did not retain a bounded measured window: ${JSON.stringify(
            {
              activeRowCount: activeKeys.size,
              measuredRowCount: measuredKeys.size,
              ownerCreations,
              ownerDisposals,
              scrollOffset: latestOffset,
            },
          )}.`,
        );
      }
      await app.root.flushMounted();
      const proofSequence = app.root.lastCommittedSequence;
      setStatus(SCROLLED_TEXT);
      await Promise.resolve();
      await app.root.flushMounted();
      console.log(
        `SOLID_NATIVE_MEASURED_VIRTUALIZED_LIST_SUCCEEDED ${JSON.stringify({
          schemaVersion: 0,
          activeRowCount: activeKeys.size,
          maximumMountedRows: MAXIMUM_MOUNTED_ROWS,
          measuredRowCount: measuredKeys.size,
          ownerCreations,
          ownerDisposals,
          scrollOffset: latestOffset,
          proofSequence,
          sequence: app.root.lastCommittedSequence,
          platform: binding.platform,
          runtime: binding.backend,
          runtimeVersion: binding.backendVersion,
        })}`,
      );
    };

    application = startApplication(
      () => (
        <View style={{ flex: 1, padding: 24 }}>
          <Text
            accessibilityRole="header"
            style={{ color: "#111827", fontSize: 22, marginBottom: 8 }}
          >
            Intrinsically measured list
          </Text>
          <Text
            testID="solid-native-measured-virtualized-list-status"
            style={{ color: "#334155", fontSize: 15, height: 44 }}
          >
            {status()}
          </Text>
          <VirtualizedList
            accessible={binding.platform === "android"}
            accessibilityLabel="Solid Native measured virtualized list"
            testID="solid-native-measured-virtualized-list"
            data={items}
            estimatedItemSize={ESTIMATED_ITEM_SIZE}
            viewportSize={VIEWPORT_SIZE}
            overscan={OVERSCAN}
            recycleRowViews
            keyExtractor={(item) => item.id}
            renderItem={({ item, key }) => {
              if (activeKeys.has(key)) {
                throw new Error(
                  `Measured list mounted duplicate owner ${key}.`,
                );
              }
              activeKeys.add(key);
              ownerCreations++;
              onCleanup(() => {
                if (!activeKeys.delete(key)) {
                  reportFatal(
                    new Error(`Measured list disposed inactive owner ${key}.`),
                  );
                }
                ownerDisposals++;
              });
              return (
                <View
                  accessible
                  accessibilityLabel={item().label}
                  onLayout={(event) =>
                    handleRowLayout(key, item().height, event)
                  }
                  style={{
                    backgroundColor:
                      item().index % 2 === 0 ? "#dbeafe" : "#ccfbf1",
                    borderBottomColor: "#64748b",
                    borderBottomWidth: 1,
                    height: item().height,
                    justifyContent: "center",
                    paddingHorizontal: 16,
                  }}
                >
                  <Text style={{ color: "#0f172a", fontSize: 16 }}>
                    {item().label}
                  </Text>
                </View>
              );
            }}
            onScroll={handleScroll}
            onScrollEndDrag={(event) => {
              void handleScrollEnd(event).catch(reportFatal);
            }}
            style={{
              backgroundColor: "#f8fafc",
              borderColor: "#475569",
              borderWidth: 1,
            }}
          />
        </View>
      ),
      host,
      {
        surface: {
          name: "measured-virtualized-list-e2e",
          initialProps: {
            style: { backgroundColor: "#ffffff", flex: 1, paddingTop: 48 },
          },
        },
        requirements: {
          capabilities: [
            "bubblingEvents",
            "commitMountEvents",
            "synchronousMeasurement",
          ],
          components: ["ScrollView", "Text", "View"],
        },
        onCommitError: reportFatal,
      },
    );
    const initial = await application.root.flushMounted();
    if (
      initial?.sequence !== 1 ||
      !Number.isSafeInteger(initial.hostRevision) ||
      activeKeys.size === 0 ||
      activeKeys.size > MAXIMUM_MOUNTED_ROWS
    ) {
      throw new Error(
        "The measured VirtualizedList did not mount its initial bounded estimate window.",
      );
    }
  } catch (error) {
    reportFatal(error);
  }
}

void run();
