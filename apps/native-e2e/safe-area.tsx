/** @jsxImportSource @solid-native/core */
import "react-native/setup-env";

import {
  CORE_COMPONENT_DESCRIPTORS,
  CausalComputation,
  Pressable,
  SafeAreaProvider,
  SafeAreaView,
  Text,
  View,
  useSafeAreaFrame,
  useSafeAreaInsets,
  type SafeAreaMetrics,
} from "@solid-native/core";
import {
  createCausalTelemetry,
  type CausalTelemetryRecord,
} from "@solid-native/observability";
import { type NativeApplication } from "@solid-native/renderer";
import {
  createNativeFabricHost,
  getNativeHostBinding,
  startApplication,
  waitForNativeSurface,
} from "@solid-native/runtime";

const READY_TEXT = "Solid Native safe area ready";
const SAFE_VIEW_LABEL = "Solid Native safe area view";
const TOP_ANCHOR_LABEL = "Solid Native safe area top anchor";
const BOTTOM_ANCHOR_LABEL = "Solid Native safe area bottom anchor";
const COMMIT_LABEL = "Commit native safe-area change";
const DISPOSE_LABEL = "Dispose Solid Native safe area proof";
const METRICS_COMPUTATION_NAME = "safe-area.metrics.output";
const PROOF_TIMEOUT_MS = 10_000;
const PERMITTED_EVENT_ATTRIBUTES = new Set([
  "event.bubbles",
  "event.coalescible",
  "event.name",
  "event.native_timestamp",
  "event.observed_sequence",
  "event.priority",
  "surface.id",
  "target.node",
]);
const PERMITTED_COMPUTATION_ATTRIBUTES = new Set([
  "computation.kind",
  "computation.name",
]);

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function reportFatal(error: unknown): void {
  console.error("SOLID_NATIVE_SAFE_AREA_FAILED", error);
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

function assertPhysicalMetrics(metrics: SafeAreaMetrics): void {
  if (metrics.frame.width <= 0 || metrics.frame.height <= 0) {
    throw new Error("The native safe-area provider reported an empty frame.");
  }
  const insetTotal =
    metrics.insets.top +
    metrics.insets.right +
    metrics.insets.bottom +
    metrics.insets.left;
  if (insetTotal <= 0) {
    throw new Error(
      "The physical safe-area proof did not receive any system-bar or cutout inset.",
    );
  }
  if (
    !Object.isFrozen(metrics) ||
    !Object.isFrozen(metrics.insets) ||
    !Object.isFrozen(metrics.frame)
  ) {
    throw new Error("The delivered safe-area metrics were not immutable.");
  }
}

function SafeAreaContent(props: {
  readonly commit: () => Promise<void>;
  readonly dispose: () => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const frame = useSafeAreaFrame();
  return (
    <SafeAreaView
      accessibilityLabel={SAFE_VIEW_LABEL}
      edges={["top", "right", "bottom", "left"]}
      style={{
        backgroundColor: "#f8fafc",
        flex: 1,
        justifyContent: "space-between",
      }}
      testID="solid-native-safe-area-view"
    >
      <View
        accessible
        accessibilityLabel={TOP_ANCHOR_LABEL}
        style={{ backgroundColor: "#2563eb", height: 48 }}
      >
        <Text style={{ color: "#ffffff", fontSize: 16 }}>
          {TOP_ANCHOR_LABEL}
        </Text>
      </View>
      <View style={{ alignItems: "center", padding: 16 }}>
        <Text accessibilityRole="header" style={{ fontSize: 20 }}>
          {READY_TEXT}
        </Text>
        <CausalComputation name={METRICS_COMPUTATION_NAME}>
          <Text
            style={{ color: "#334155", fontSize: 14 }}
            testID="solid-native-safe-area-metrics"
          >
            {() =>
              `Insets ${insets.top()}/${insets.right()}/${insets.bottom()}/${insets.left()} frame ${frame.width()}x${frame.height()}`
            }
          </Text>
        </CausalComputation>
        <Pressable
          accessible
          accessibilityLabel={COMMIT_LABEL}
          accessibilityRole="button"
          onPress={() => {
            void props.commit();
          }}
          style={{
            backgroundColor: "#1d4ed8",
            borderRadius: 8,
            marginTop: 16,
            padding: 12,
          }}
        >
          <Text style={{ color: "#ffffff", fontSize: 16 }}>{COMMIT_LABEL}</Text>
        </Pressable>
        <Pressable
          accessible
          accessibilityLabel={DISPOSE_LABEL}
          accessibilityRole="button"
          onPress={() => {
            void props.dispose();
          }}
          style={{
            backgroundColor: "#334155",
            borderRadius: 8,
            marginTop: 16,
            padding: 12,
          }}
        >
          <Text style={{ color: "#ffffff", fontSize: 16 }}>
            {DISPOSE_LABEL}
          </Text>
        </Pressable>
      </View>
      <View
        accessible
        accessibilityLabel={BOTTOM_ANCHOR_LABEL}
        style={{ backgroundColor: "#16a34a", height: 48 }}
      >
        <Text style={{ color: "#ffffff", fontSize: 16 }}>
          {BOTTOM_ANCHOR_LABEL}
        </Text>
      </View>
    </SafeAreaView>
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
    const records: CausalTelemetryRecord[] = [];
    let operationSequence = 0;
    const telemetry = createCausalTelemetry({
      sink: (record) => records.push(record),
      createOperationId: () => `physical-safe-area-${++operationSequence}`,
    });
    let resolveMetrics!: () => void;
    const metricsObserved = new Promise<void>((resolve) => {
      resolveMetrics = resolve;
    });
    let receivedMetrics = false;
    let application: NativeApplication;

    const commitSafeAreaChange = async (): Promise<void> => {
      try {
        const deadline = Date.now() + 5_000;
        let commit: Awaited<ReturnType<typeof application.root.flushMounted>>;
        do {
          commit = await application.root.flushMounted();
          if (commit !== undefined) break;
          await delay(50);
        } while (Date.now() < deadline);
        invariant(
          commit !== undefined,
          "The native safe-area change did not produce a Fabric commit.",
        );
        const commitStarted = startedOperation(
          records,
          "solid-native.commit",
          (record) => record.attributes["commit.sequence"] === commit.sequence,
        );
        invariant(
          commitStarted?.attributes["commit.priority"] === "normal",
          "The native safe-area change did not retain a normal-priority commit.",
        );
        const nativeEvent = startedOperation(
          records,
          "solid-native.event",
          (record) =>
            record.attributes["event.name"] === "insetsChange" &&
            commitStarted.causes.includes(record.operationId),
        );
        const computation = startedOperation(
          records,
          "solid-native.computation",
          (record) =>
            record.attributes["computation.name"] ===
              METRICS_COMPUTATION_NAME &&
            commitStarted.causes.includes(record.operationId),
        );
        invariant(
          nativeEvent?.attributes["event.priority"] === "default" &&
            hasOnlyAttributes(nativeEvent, PERMITTED_EVENT_ATTRIBUTES),
          "The safe-area commit did not retain one privacy-safe native inset event.",
        );
        invariant(
          computation !== undefined &&
            hasOnlyAttributes(computation, PERMITTED_COMPUTATION_ATTRIBUTES),
          "The safe-area commit did not retain its named Solid computation.",
        );
        console.log(
          "SOLID_NATIVE_SAFE_AREA_CAUSALITY_SUCCEEDED",
          commit.sequence,
        );
      } catch (error) {
        reportFatal(error);
      }
    };

    const dispose = async (): Promise<void> => {
      try {
        await application.dispose();
        if (binding.getSurfaceInfo().ready) {
          throw new Error(
            "The safe-area proof resolved disposal before its native surface stopped.",
          );
        }
        console.log("SOLID_NATIVE_SAFE_AREA_TEARDOWN_SUCCEEDED");
      } catch (error) {
        reportFatal(error);
      }
    };

    application = startApplication(
      () => (
        <SafeAreaProvider
          onMetricsChange={(metrics) => {
            assertPhysicalMetrics(metrics);
            if (!receivedMetrics) {
              receivedMetrics = true;
              console.log("SOLID_NATIVE_SAFE_AREA_METRICS_OBSERVED");
              resolveMetrics();
            }
          }}
        >
          <SafeAreaContent commit={commitSafeAreaChange} dispose={dispose} />
        </SafeAreaProvider>
      ),
      host,
      {
        surface: {
          name: "safe-area-e2e",
          initialProps: {
            style: { backgroundColor: "#f8fafc", flex: 1 },
          },
        },
        autoCommit: false,
        requirements: {
          components: [
            "Pressable",
            "RNCSafeAreaProvider",
            "RNCSafeAreaView",
            "Text",
            "View",
          ],
        },
        telemetry,
        onCommitError: reportFatal,
      },
    );
    const initial = await application.root.flushMounted();
    if (initial?.sequence !== 1) {
      throw new Error("The safe-area provider did not mount exactly once.");
    }
    console.log("SOLID_NATIVE_SAFE_AREA_PROVIDER_MOUNTED");

    await Promise.race([
      metricsObserved,
      delay(PROOF_TIMEOUT_MS).then(() => {
        throw new Error(
          "The native safe-area provider did not deliver metrics.",
        );
      }),
    ]);
    const contentCommit = await application.root.flushMounted();
    if (contentCommit === undefined || contentCommit.sequence <= 1) {
      throw new Error(
        "The first safe-area delivery did not mount the gated Solid content.",
      );
    }
    console.log("SOLID_NATIVE_SAFE_AREA_CONTENT_MOUNTED");
  } catch (error) {
    reportFatal(error);
  }
}

void run();
