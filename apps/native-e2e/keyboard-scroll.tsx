/** @jsxImportSource @solid-native/core */
import "react-native/setup-env";

import {
  CausalComputation,
  CORE_COMPONENT_DESCRIPTORS,
  KeyboardAwareScrollView,
  Pressable,
  Text,
  TextInput,
  TextInputFocusGroup,
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

const READY_TEXT = "Solid Native focused scroll ready";
const VISIBLE_TEXT = "Solid Native focused field visible above keyboard";
const TRAVERSED_TEXT = "Solid Native next field focused above keyboard";
const SUCCEEDED_TEXT = "Solid Native focus traversal submit and hide observed";
const FIRST_INPUT_LABEL = "Solid Native focused scroll first input";
const SECOND_INPUT_LABEL = "Solid Native focused scroll second input";
const DISPOSE_LABEL = "Dispose Solid Native focused scroll proof";
const PROOF_TIMEOUT_MS = 60_000;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function reportFatal(error: unknown): void {
  console.error("SOLID_NATIVE_KEYBOARD_SCROLL_FAILED", error);
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

function verifyFocusedScrollCausality(
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
      record.attributes["task.name"] === "keyboard.focus.visibility",
  );
  const validTask = tasks.find(
    (task) =>
      keyboardEvents.some((event) =>
        isTransitivelyCausedBy(task, event.operationId, byId),
      ) &&
      starts.filter(
        (record) =>
          record.name === "solid-native.measure" &&
          record.causes.includes(task.operationId),
      ).length >= 2 &&
      starts.some(
        (record) =>
          record.name === "solid-native.command" &&
          record.attributes["command.name"] === "scrollTo" &&
          record.causes.includes(task.operationId),
      ) &&
      records.some(
        (record) =>
          record.type === "operation-finished" &&
          record.operationId === task.operationId &&
          record.status === "ok",
      ),
  );
  const submitEvents = starts.filter(
    (record) =>
      record.name === "solid-native.event" &&
      record.attributes["event.name"] === "submitEditing",
  );
  const traversalTasks = starts.filter(
    (record) =>
      record.name === "solid-native.task" &&
      record.attributes["task.name"] === "input.focus.traversal",
  );
  const validTraversal = traversalTasks.find(
    (task) =>
      submitEvents.some((event) =>
        isTransitivelyCausedBy(task, event.operationId, byId),
      ) &&
      starts.some(
        (record) =>
          record.name === "solid-native.command" &&
          record.attributes["command.name"] === "focus" &&
          record.causes.includes(task.operationId),
      ) &&
      records.some(
        (record) =>
          record.type === "operation-finished" &&
          record.operationId === task.operationId &&
          record.status === "ok",
      ),
  );
  if (
    keyboardEvents.length < 2 ||
    validTask === undefined ||
    validTraversal === undefined
  ) {
    throw new Error(
      "The focused-scroll proof lost a keyboard visibility or submit-to-focus causal chain.",
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
      throw new Error("The focused-scroll telemetry session was rejected.");
    }
    const host = createNativeFabricHost({
      binding,
      descriptors: CORE_COMPONENT_DESCRIPTORS,
    });
    const [status, setStatus] = createSignal(READY_TEXT);
    let resolveShown: (() => void) | undefined;
    let resolveHidden: (() => void) | undefined;
    let resolveFirstSubmitted: (() => void) | undefined;
    let resolveFirstBlurred: (() => void) | undefined;
    let resolveSecondFocused: (() => void) | undefined;
    let resolveSecondSubmitted: (() => void) | undefined;
    let resolveSecondBlurred: (() => void) | undefined;
    let resolveAutomaticScroll: (() => void) | undefined;
    let resolveTraversalScroll: (() => void) | undefined;
    let resolveNativeScroll: (() => void) | undefined;
    const shown = new Promise<void>((resolve) => {
      resolveShown = resolve;
    });
    const hidden = new Promise<void>((resolve) => {
      resolveHidden = resolve;
    });
    const firstSubmitted = new Promise<void>((resolve) => {
      resolveFirstSubmitted = resolve;
    });
    const firstBlurred = new Promise<void>((resolve) => {
      resolveFirstBlurred = resolve;
    });
    const secondFocused = new Promise<void>((resolve) => {
      resolveSecondFocused = resolve;
    });
    const secondSubmitted = new Promise<void>((resolve) => {
      resolveSecondSubmitted = resolve;
    });
    const secondBlurred = new Promise<void>((resolve) => {
      resolveSecondBlurred = resolve;
    });
    const automaticScroll = new Promise<void>((resolve) => {
      resolveAutomaticScroll = resolve;
    });
    const traversalScroll = new Promise<void>((resolve) => {
      resolveTraversalScroll = resolve;
    });
    const nativeScroll = new Promise<void>((resolve) => {
      resolveNativeScroll = resolve;
    });
    let application: NativeApplication;
    let keyboardWasVisible = false;
    let focusedScrollCount = 0;
    let nativeScrollObserved = false;

    const dispose = async (): Promise<void> => {
      try {
        await application.dispose();
        if (binding.getSurfaceInfo().ready) {
          throw new Error(
            "The focused-scroll proof resolved disposal before its native surface stopped.",
          );
        }
        console.log("SOLID_NATIVE_KEYBOARD_SCROLL_TEARDOWN_SUCCEEDED");
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
                    "The focused-scroll keyboard omitted positive screen metrics.",
                  );
                }
                keyboardWasVisible = true;
                console.log("SOLID_NATIVE_KEYBOARD_SCROLL_METRICS_OBSERVED");
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
          <KeyboardAwareScrollView
            keyboard={keyboard}
            animated={false}
            extraScrollHeight={16}
            onVisibilityError={reportFatal}
            onFocusedFieldScroll={(offset) => {
              if (offset <= 0) return;
              focusedScrollCount++;
              if (focusedScrollCount === 1) {
                console.log(
                  "SOLID_NATIVE_KEYBOARD_FOCUS_VISIBILITY_APPLIED",
                  offset,
                );
                resolveAutomaticScroll?.();
                return;
              }
              if (focusedScrollCount === 2) {
                console.log(
                  "SOLID_NATIVE_KEYBOARD_FOCUS_TRAVERSAL_SCROLL_APPLIED",
                  offset,
                );
                resolveTraversalScroll?.();
              }
            }}
            onScroll={(event) => {
              const payload = event.payload;
              const contentOffset =
                typeof payload === "object" &&
                payload !== null &&
                !Array.isArray(payload)
                  ? (payload as Readonly<Record<string, unknown>>).contentOffset
                  : undefined;
              const y =
                typeof contentOffset === "object" &&
                contentOffset !== null &&
                !Array.isArray(contentOffset)
                  ? (contentOffset as Readonly<Record<string, unknown>>).y
                  : undefined;
              if (typeof y === "number" && y > 0 && !nativeScrollObserved) {
                nativeScrollObserved = true;
                console.log("SOLID_NATIVE_KEYBOARD_NATIVE_SCROLL_OBSERVED", y);
                resolveNativeScroll?.();
              }
            }}
            style={{ backgroundColor: "#f8fafc", flex: 1 }}
            contentContainerStyle={{ minHeight: 980, padding: 24 }}
          >
            <Text
              accessibilityRole="header"
              testID="solid-native-keyboard-scroll-title"
              style={{ color: "#0f172a", fontSize: 24 }}
            >
              Solid Native focused scroll proof
            </Text>
            <CausalComputation name="input.keyboard.focused-scroll.output">
              <Text
                testID="solid-native-keyboard-scroll-status"
                style={{ color: "#166534", fontSize: 16, marginTop: 12 }}
              >
                {status()}
              </Text>
            </CausalComputation>
            <View style={{ height: 430 }} />
            <TextInputFocusGroup onTraversalError={reportFatal}>
              <TextInput
                accessible
                accessibilityLabel={FIRST_INPUT_LABEL}
                testID="solid-native-keyboard-scroll-input-first"
                defaultValue=""
                placeholder="First field uses Next"
                submitBehavior="submit"
                onSubmitEditing={() => resolveFirstSubmitted?.()}
                onBlur={() => resolveFirstBlurred?.()}
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
              <TextInput
                accessible
                accessibilityLabel={SECOND_INPUT_LABEL}
                testID="solid-native-keyboard-scroll-input-second"
                defaultValue=""
                placeholder="Second field uses Done"
                submitBehavior="blurAndSubmit"
                onFocus={() => resolveSecondFocused?.()}
                onSubmitEditing={() => resolveSecondSubmitted?.()}
                onBlur={() => resolveSecondBlurred?.()}
                style={{
                  backgroundColor: "#ffffff",
                  borderColor: "#64748b",
                  borderRadius: 8,
                  borderWidth: 1,
                  color: "#0f172a",
                  fontSize: 18,
                  marginTop: 16,
                  minHeight: 48,
                  padding: 12,
                }}
              />
            </TextInputFocusGroup>
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
          </KeyboardAwareScrollView>
        );
      },
      host,
      {
        surface: {
          name: "keyboard-scroll-e2e",
          initialProps: {
            style: { backgroundColor: "#f8fafc", flex: 1 },
          },
        },
        autoCommit: false,
        telemetry,
        requirements: {
          components: [
            "Pressable",
            "ScrollContentView",
            "ScrollView",
            "Text",
            "TextInput",
            "View",
          ],
        },
        onCommitError: reportFatal,
      },
    );
    const initial = await application.root.flushMounted();
    if (initial?.sequence !== 1) {
      throw new Error("The focused-scroll proof did not mount exactly once.");
    }
    console.log("SOLID_NATIVE_KEYBOARD_SCROLL_READY");

    await waitForProof(
      Promise.all([shown, automaticScroll, nativeScroll]).then(() => undefined),
      "The focused field did not scroll above the physical keyboard.",
    );
    setStatus(VISIBLE_TEXT);
    await application.root.flushMounted();
    console.log("SOLID_NATIVE_KEYBOARD_SCROLL_VISIBLE_SUCCEEDED");

    await waitForProof(
      Promise.all([
        firstSubmitted,
        firstBlurred,
        secondFocused,
        traversalScroll,
      ]).then(() => undefined),
      "The focus group did not submit, blur, focus, and reveal its next field.",
    );
    setStatus(TRAVERSED_TEXT);
    await application.root.flushMounted();
    console.log("SOLID_NATIVE_KEYBOARD_FOCUS_TRAVERSAL_STATE_SUCCEEDED");

    await waitForProof(
      Promise.all([secondSubmitted, secondBlurred, hidden]).then(
        () => undefined,
      ),
      "The final focused field did not submit, blur, and hide the keyboard.",
    );
    setStatus(SUCCEEDED_TEXT);
    await application.root.flushMounted();
    verifyFocusedScrollCausality(telemetryRecords.slice(telemetryStart));
    console.log("SOLID_NATIVE_KEYBOARD_FOCUS_TRAVERSAL_SUCCEEDED");
    console.log("SOLID_NATIVE_KEYBOARD_SCROLL_CAUSALITY_SUCCEEDED");
    console.log("SOLID_NATIVE_KEYBOARD_SCROLL_STATE_SUCCEEDED");
  } catch (error) {
    reportFatal(error);
  }
}

void run();
