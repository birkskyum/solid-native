/** @jsxImportSource @solid-native/core */
import "react-native/setup-env";

import {
  CausalComputation,
  CORE_COMPONENT_DESCRIPTORS,
  KeyboardAvoidingView,
  Pressable,
  Text,
  TextInput,
  View,
  createKeyboard,
} from "@solid-native/core";
import {
  createSignal,
  effect,
  type NativeApplication,
} from "@solid-native/renderer";
import {
  createNativeFabricHost,
  getNativeHostBinding,
  startApplication,
  waitForNativeSurface,
} from "@solid-native/runtime";
import { getReactNativePlatformServices } from "@solid-native/runtime/react-native";
import {
  createSampledCausalTelemetry,
  type CausalOperationStarted,
  type CausalTelemetryRecord,
} from "@solid-native/observability";

const READY_TEXT = "Solid Native keyboard ready";
const VISIBLE_TEXT = "Solid Native keyboard visible with positive metrics";
const SUCCEEDED_TEXT =
  "Solid Native keyboard show, submit, blur, and hide observed";
const INPUT_LABEL = "Solid Native keyboard proof input";
const AVOIDANCE_ANCHOR_LABEL = "Solid Native keyboard avoidance anchor";
const DISPOSE_LABEL = "Dispose Solid Native keyboard proof";
const PROOF_TIMEOUT_MS = 60_000;
const PERMITTED_PLATFORM_EVENT_START_ATTRIBUTES = new Set([
  "event.bubbles",
  "event.coalescible",
  "event.name",
  "event.priority",
  "event.source",
  "surface.id",
]);

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function reportFatal(error: unknown): void {
  console.error("SOLID_NATIVE_KEYBOARD_FAILED", error);
  setTimeout(() => {
    throw error instanceof Error ? error : new Error(String(error));
  });
}

async function waitForProof(
  proof: Promise<void>,
  failureMessage: string,
): Promise<void> {
  await Promise.race([
    proof,
    delay(PROOF_TIMEOUT_MS).then(() => {
      throw new Error(failureMessage);
    }),
  ]);
}

function isTransitivelyCausedBy(
  operation: CausalOperationStarted,
  causeId: string,
  operations: ReadonlyMap<string, CausalOperationStarted>,
  visited = new Set<string>(),
): boolean {
  if (operation.causes.includes(causeId)) return true;
  if (visited.has(operation.operationId)) return false;
  visited.add(operation.operationId);
  return operation.causes.some((parentId) => {
    const parent = operations.get(parentId);
    return (
      parent !== undefined &&
      isTransitivelyCausedBy(parent, causeId, operations, visited)
    );
  });
}

function verifyKeyboardAvoidanceCausality(
  records: readonly CausalTelemetryRecord[],
): void {
  const starts = records.filter(
    (record): record is CausalOperationStarted =>
      record.type === "operation-started",
  );
  const byId = new Map(starts.map((record) => [record.operationId, record]));
  const keyboardEvents = starts.filter(
    (record) =>
      record.name === "solid-native.event" &&
      record.attributes["event.name"] === "platform.keyboard.visibility",
  );
  const tasks = starts.filter(
    (record) =>
      record.name === "solid-native.task" &&
      record.attributes["task.name"] === "keyboard.avoidance.measurement",
  );
  const validTask = tasks.find(
    (task) =>
      keyboardEvents.some((event) =>
        isTransitivelyCausedBy(task, event.operationId, byId),
      ) &&
      starts.some(
        (record) =>
          record.name === "solid-native.measure" &&
          record.causes.includes(task.operationId),
      ) &&
      starts.some(
        (record) =>
          record.name === "solid-native.commit" &&
          Number(record.attributes["commit.mutation.update-props"] ?? 0) >= 1 &&
          record.causes.includes(task.operationId),
      ) &&
      records.some(
        (record) =>
          record.type === "operation-finished" &&
          record.operationId === task.operationId &&
          record.status === "ok",
      ),
  );
  if (keyboardEvents.length < 2 || validTask === undefined) {
    throw new Error(
      "The keyboard avoidance proof lost its event-to-measure-to-commit causal chain.",
    );
  }
}

async function run(): Promise<void> {
  try {
    const binding = getNativeHostBinding();
    await waitForNativeSurface({ binding, timeoutMs: 5_000 });
    const telemetryRecords: CausalTelemetryRecord[] = [];
    const telemetry = createSampledCausalTelemetry({
      sink: (record) => telemetryRecords.push(record),
      sampleRate: 1,
      resource: {
        runtimeName: binding.backend,
        runtimeVersion: binding.backendVersion,
        hostContractVersion: binding.contractVersion,
        platform: binding.platform,
      },
    });
    if (telemetry === undefined) {
      throw new Error("The keyboard proof telemetry session was rejected.");
    }
    const host = createNativeFabricHost({
      binding,
      descriptors: CORE_COMPONENT_DESCRIPTORS,
    });
    const [status, setStatus] = createSignal(READY_TEXT);
    let resolveShown: (() => void) | undefined;
    let resolveHidden: (() => void) | undefined;
    let resolveSubmitted: (() => void) | undefined;
    let resolveBlurred: (() => void) | undefined;
    let resolveAvoidanceApplied: (() => void) | undefined;
    let resolveAvoidanceCleared: (() => void) | undefined;
    const shown = new Promise<void>((resolve) => {
      resolveShown = resolve;
    });
    const hidden = new Promise<void>((resolve) => {
      resolveHidden = resolve;
    });
    const submitted = new Promise<void>((resolve) => {
      resolveSubmitted = resolve;
    });
    const blurred = new Promise<void>((resolve) => {
      resolveBlurred = resolve;
    });
    const avoidanceApplied = new Promise<void>((resolve) => {
      resolveAvoidanceApplied = resolve;
    });
    const avoidanceCleared = new Promise<void>((resolve) => {
      resolveAvoidanceCleared = resolve;
    });
    let application: NativeApplication;
    let keyboardWasVisible = false;
    let positiveAvoidanceObserved = false;
    let layoutWasObserved = false;

    const dispose = async (): Promise<void> => {
      try {
        await application.dispose();
        if (binding.getSurfaceInfo().ready) {
          throw new Error(
            "The keyboard proof resolved disposal before its native surface stopped.",
          );
        }
        console.log("SOLID_NATIVE_KEYBOARD_TEARDOWN_SUCCEEDED");
      } catch (error) {
        reportFatal(error);
      }
    };

    const telemetryStart = telemetryRecords.length;
    application = startApplication(
      () => {
        const keyboard = createKeyboard(getReactNativePlatformServices());
        effect(
          () => ({ visible: keyboard.visible(), metrics: keyboard.metrics() }),
          (state) => {
            try {
              if (state.visible) {
                if (
                  state.metrics === undefined ||
                  state.metrics.width <= 0 ||
                  state.metrics.height <= 0
                ) {
                  throw new Error(
                    "The visible keyboard omitted positive screen metrics.",
                  );
                }
                keyboardWasVisible = true;
                console.log("SOLID_NATIVE_KEYBOARD_METRICS_OBSERVED");
                resolveShown?.();
                return;
              }
              if (keyboardWasVisible) resolveHidden?.();
            } catch (error) {
              reportFatal(error);
            }
          },
        );
        return (
          <KeyboardAvoidingView
            keyboard={keyboard}
            onLayout={() => {
              if (layoutWasObserved) return;
              layoutWasObserved = true;
              console.log("SOLID_NATIVE_KEYBOARD_LAYOUT_OBSERVED");
            }}
            onMeasurementError={reportFatal}
            onAvoidanceChange={(inset) => {
              if (inset > 0 && !positiveAvoidanceObserved) {
                positiveAvoidanceObserved = true;
                resolveAvoidanceApplied?.();
                console.log("SOLID_NATIVE_KEYBOARD_AVOIDANCE_APPLIED");
              } else if (inset === 0 && positiveAvoidanceObserved) {
                resolveAvoidanceCleared?.();
                console.log("SOLID_NATIVE_KEYBOARD_AVOIDANCE_CLEARED");
              }
            }}
            style={{
              backgroundColor: "#f8fafc",
              flex: 1,
              justifyContent: "flex-end",
              padding: 24,
            }}
          >
            <Text
              accessibilityRole="header"
              testID="solid-native-keyboard-title"
              style={{ color: "#0f172a", fontSize: 24, marginBottom: 12 }}
            >
              Solid Native keyboard proof
            </Text>
            <CausalComputation name="input.keyboard.output">
              <Text
                testID="solid-native-keyboard-status"
                style={{ color: "#166534", fontSize: 16, marginBottom: 16 }}
              >
                {status()}
              </Text>
            </CausalComputation>
            <TextInput
              accessible
              accessibilityLabel={INPUT_LABEL}
              testID="solid-native-keyboard-input"
              defaultValue=""
              placeholder="Type on the software keyboard"
              returnKeyType="done"
              submitBehavior="blurAndSubmit"
              onSubmitEditing={() => resolveSubmitted?.()}
              onBlur={() => resolveBlurred?.()}
              style={{
                backgroundColor: "#ffffff",
                borderColor: "#64748b",
                borderRadius: 8,
                borderWidth: 1,
                color: "#0f172a",
                fontSize: 18,
                minHeight: 48,
                padding: 12,
              }}
            />
            <Pressable
              accessible
              accessibilityLabel={DISPOSE_LABEL}
              accessibilityRole="button"
              onPress={() => {
                void dispose();
              }}
              style={{
                backgroundColor: "#334155",
                borderRadius: 8,
                marginTop: 20,
                padding: 12,
              }}
            >
              <Text style={{ color: "#ffffff", fontSize: 16 }}>
                {DISPOSE_LABEL}
              </Text>
            </Pressable>
            <Text
              accessible
              accessibilityLabel={AVOIDANCE_ANCHOR_LABEL}
              testID="solid-native-keyboard-avoidance-anchor"
              style={{ color: "#64748b", fontSize: 12, marginTop: 8 }}
            >
              {AVOIDANCE_ANCHOR_LABEL}
            </Text>
          </KeyboardAvoidingView>
        );
      },
      host,
      {
        surface: {
          name: "keyboard-e2e",
          initialProps: {
            style: { backgroundColor: "#f8fafc", flex: 1 },
          },
        },
        autoCommit: false,
        telemetry,
        requirements: {
          components: ["Pressable", "Text", "TextInput", "View"],
        },
        onCommitError: reportFatal,
      },
    );
    const initial = await application.root.flushMounted();
    if (initial?.sequence !== 1) {
      throw new Error("The keyboard proof did not mount exactly once.");
    }
    console.log("SOLID_NATIVE_KEYBOARD_READY");

    await waitForProof(
      Promise.all([shown, avoidanceApplied]).then(() => undefined),
      "The physical keyboard did not become visible with positive avoidance.",
    );
    setStatus(VISIBLE_TEXT);
    await application.root.flushMounted();
    console.log("SOLID_NATIVE_KEYBOARD_VISIBLE_SUCCEEDED");

    await waitForProof(
      Promise.all([submitted, blurred, hidden, avoidanceCleared]).then(
        () => undefined,
      ),
      "The physical keyboard did not submit, blur, hide, and clear avoidance.",
    );
    setStatus(SUCCEEDED_TEXT);
    await application.root.flushMounted();

    const keyboardEvents = telemetryRecords
      .slice(telemetryStart)
      .filter(
        (record) =>
          record.type === "operation-started" &&
          record.name === "solid-native.event" &&
          record.attributes["event.name"] === "platform.keyboard.visibility",
      );
    if (
      keyboardEvents.length < 2 ||
      keyboardEvents.some(
        (started) =>
          Object.keys(started.attributes).some(
            (name) =>
              !PERMITTED_PLATFORM_EVENT_START_ATTRIBUTES.has(name) &&
              !name.startsWith("resource."),
          ) ||
          !telemetryRecords.some(
            (record) =>
              record.type === "operation-finished" &&
              record.operationId === started.operationId &&
              record.status === "ok",
          ),
      )
    ) {
      throw new Error(
        "The keyboard proof lost its private successful show/hide causal events.",
      );
    }
    verifyKeyboardAvoidanceCausality(telemetryRecords.slice(telemetryStart));
    console.log("SOLID_NATIVE_KEYBOARD_AVOIDANCE_CAUSALITY_SUCCEEDED");
    console.log("SOLID_NATIVE_KEYBOARD_STATE_SUCCEEDED");
  } catch (error) {
    reportFatal(error);
  }
}

void run();
