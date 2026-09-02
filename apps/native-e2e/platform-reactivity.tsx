/** @jsxImportSource @solid-native/core */
import "react-native/setup-env";

import {
  CORE_COMPONENT_DESCRIPTORS,
  CausalComputation,
  CausalOwner,
  Pressable,
  Text,
  View,
  createColorScheme,
  createWindowDimensions,
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
import { getReactNativePlatformServices } from "@solid-native/runtime/react-native";

const READY_TEXT = "Solid Native platform reactivity ready";
const COMMIT_LABEL = "Commit native platform change";
const DISPOSE_LABEL = "Dispose Solid Native platform reactivity proof";
const WINDOW_COMPUTATION_NAME = "platform.window.output";
const APPEARANCE_COMPUTATION_NAME = "platform.appearance.output";

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
  console.error("SOLID_NATIVE_PLATFORM_REACTIVITY_FAILED", error);
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
    const records: CausalTelemetryRecord[] = [];
    let operationSequence = 0;
    const telemetry = createCausalTelemetry({
      sink: (record) => records.push(record),
      createOperationId: () => `physical-platform-${++operationSequence}`,
    });
    let application: NativeApplication;

    const commitPlatformChange = async (): Promise<void> => {
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
          "The native platform change did not produce a Fabric commit.",
        );
        const commitStarted = startedOperation(
          records,
          "solid-native.commit",
          (record) => record.attributes["commit.sequence"] === commit.sequence,
        );
        invariant(
          commitStarted?.attributes["commit.priority"] === "normal",
          "The native platform change did not retain a normal-priority commit.",
        );

        const candidates = [
          {
            eventName: "platform.window.dimensions",
            computationName: WINDOW_COMPUTATION_NAME,
            marker: "SOLID_NATIVE_PLATFORM_WINDOW_CAUSALITY_SUCCEEDED",
          },
          {
            eventName: "platform.appearance.change",
            computationName: APPEARANCE_COMPUTATION_NAME,
            marker: "SOLID_NATIVE_PLATFORM_APPEARANCE_CAUSALITY_SUCCEEDED",
          },
        ] as const;
        const matches = candidates.flatMap((candidate) => {
          const nativeEvent = startedOperation(
            records,
            "solid-native.event",
            (record) =>
              record.attributes["event.name"] === candidate.eventName &&
              commitStarted.causes.includes(record.operationId),
          );
          const computation = startedOperation(
            records,
            "solid-native.computation",
            (record) =>
              record.attributes["computation.name"] ===
                candidate.computationName &&
              commitStarted.causes.includes(record.operationId),
          );
          return nativeEvent === undefined || computation === undefined
            ? []
            : [{ candidate, computation, nativeEvent }];
        });
        invariant(
          matches.length === 1,
          "The platform commit did not retain exactly one native event and matching Solid computation.",
        );
        const match = matches[0];
        invariant(
          match !== undefined,
          "The platform causal match disappeared after validation.",
        );
        const { candidate, computation, nativeEvent } = match;
        invariant(
          nativeEvent.attributes["event.priority"] === "default" &&
            nativeEvent.attributes["event.source"] === "platform" &&
            hasOnlyAttributes(nativeEvent, PERMITTED_EVENT_ATTRIBUTES) &&
            hasOnlyAttributes(computation, PERMITTED_COMPUTATION_ATTRIBUTES),
          "The platform causal chain retained private native values or incorrect priority.",
        );
        console.log(candidate.marker, commit.sequence);
      } catch (error) {
        reportFatal(error);
      }
    };
    const disposeApplication = async (): Promise<void> => {
      try {
        await application.dispose();
        if (binding.getSurfaceInfo().ready) {
          throw new Error(
            "The platform-reactivity proof resolved disposal before its native surface stopped.",
          );
        }
        console.log("SOLID_NATIVE_PLATFORM_REACTIVITY_TEARDOWN_SUCCEEDED");
      } catch (error) {
        reportFatal(error);
      }
    };

    application = startApplication(
      () => {
        const dimensions = createWindowDimensions(platform);
        const colorScheme = createColorScheme(platform);
        return (
          <CausalOwner name="platform-reactivity.root">
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
              <CausalComputation name={WINDOW_COMPUTATION_NAME}>
                <Text style={{ color: "#334155", fontSize: 16 }}>
                  {() => {
                    const width = dimensions.width();
                    const height = dimensions.height();
                    const orientation =
                      width > height ? "landscape" : "portrait";
                    return `Window ${orientation} ${width.toFixed(2)}x${height.toFixed(
                      2,
                    )} scale ${dimensions.scale().toFixed(2)} font ${dimensions
                      .fontScale()
                      .toFixed(2)}`;
                  }}
                </Text>
              </CausalComputation>
              <CausalComputation name={APPEARANCE_COMPUTATION_NAME}>
                <Text style={{ color: "#334155", fontSize: 16 }}>
                  {() => `Appearance ${colorScheme()}`}
                </Text>
              </CausalComputation>
              <ProofButton
                label={COMMIT_LABEL}
                onPress={() => {
                  void commitPlatformChange();
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
          name: "platform-reactivity-e2e",
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
      "The platform-reactivity proof did not mount exactly once.",
    );
    console.log("SOLID_NATIVE_PLATFORM_REACTIVITY_READY", platform.platform);
  } catch (error) {
    reportFatal(error);
  }
}

void run();
