/** @jsxImportSource @solid-native/core */
import "react-native/setup-env";

import {
  CORE_COMPONENT_DESCRIPTORS,
  CausalComputation,
  CausalOwner,
  Pressable,
  Text,
  View,
  createMemoryWarningCount,
} from "@solid-native/core";
import type {
  HostCommitFrameEvent,
  HostCommitMountedEvent,
} from "@solid-native/host-contract";
import {
  createCausalTelemetry,
  type CausalTelemetryRecord,
} from "@solid-native/observability";
import { createSignal, type NativeApplication } from "@solid-native/renderer";
import {
  createNativeFabricHost,
  getNativeHostBinding,
  startApplication,
  type NativePlatformServices,
  waitForNativeSurface,
} from "@solid-native/runtime";
import { getReactNativePlatformServices } from "@solid-native/runtime/react-native";
import { createEffect } from "solid-js";

const OUTPUT_COMPUTATION_NAME = "platform.memory-warning.output";
const READY_TEXT = "Solid Native memory-warning proof ready";
const SUCCEEDED_TEXT = "Solid Native memory-warning causal proof succeeded";
const DISPOSE_LABEL = "Dispose Solid Native memory-warning proof";
const PROOF_TIMEOUT_MS = 10_000;

function reportFatal(error: unknown): void {
  console.error("SOLID_NATIVE_MEMORY_WARNING_FAILED", error);
  setTimeout(() => {
    throw error instanceof Error ? error : new Error(String(error));
  });
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function startedOperation(
  records: readonly CausalTelemetryRecord[],
  name: CausalTelemetryRecord["name"],
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

async function waitForLifecycleEvent<Event>(
  events: ReadonlyMap<number, Event>,
  sequence: number,
  kind: "mount" | "frame",
): Promise<Event> {
  const deadline = Date.now() + PROOF_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const event = events.get(sequence);
    if (event !== undefined) return event;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `Memory-warning commit ${String(sequence)} did not reach its ${kind} boundary.`,
  );
}

function MemoryWarningOutput(props: {
  readonly platform: NativePlatformServices;
  readonly onWarning: (count: number) => void;
}) {
  const warningCount = createMemoryWarningCount(props.platform);
  createEffect(warningCount, (count) => {
    if (count > 0) props.onWarning(count);
  });
  return (
    <CausalComputation name={OUTPUT_COMPUTATION_NAME}>
      <Text
        testID="solid-native-memory-warning-count"
        style={{ color: "#0f172a", fontSize: 18 }}
      >
        {() => `Memory warnings ${String(warningCount())}`}
      </Text>
    </CausalComputation>
  );
}

async function run(): Promise<void> {
  try {
    const binding = getNativeHostBinding();
    invariant(
      binding.platform === "ios" || binding.platform === "android",
      "The physical memory-warning proof requires iOS or Android.",
    );
    await waitForNativeSurface({ binding, timeoutMs: 5_000 });
    const host = createNativeFabricHost({
      binding,
      descriptors: CORE_COMPONENT_DESCRIPTORS,
    });
    const platform = getReactNativePlatformServices();
    const [status, setStatus] = createSignal(READY_TEXT);
    const mountEvents = new Map<number, HostCommitMountedEvent>();
    const frameEvents = new Map<number, HostCommitFrameEvent>();
    const records: CausalTelemetryRecord[] = [];
    let operationSequence = 0;
    const telemetry = createCausalTelemetry({
      sink: (record) => records.push(record),
      createOperationId: () =>
        `physical-memory-warning-${String(++operationSequence)}`,
    });
    let application: NativeApplication;
    let proofStarted = false;
    let teardownStarted = false;
    let unsubscribeLifecycle = (): void => undefined;

    const dispose = async (): Promise<void> => {
      if (teardownStarted) return;
      teardownStarted = true;
      try {
        console.log("SOLID_NATIVE_MEMORY_WARNING_TEARDOWN_REQUESTED");
        unsubscribeLifecycle();
        await application.dispose();
        invariant(
          !binding.getSurfaceInfo().ready,
          "The memory-warning owner resolved disposal before its surface stopped.",
        );
        console.log("SOLID_NATIVE_MEMORY_WARNING_TEARDOWN_SUCCEEDED");
      } catch (error) {
        reportFatal(error);
      }
    };

    const verifyMemoryWarning = async (count: number): Promise<void> => {
      if (proofStarted) return;
      proofStarted = true;
      try {
        invariant(
          count === 1,
          "The host delivered more than one memory warning.",
        );
        await Promise.resolve();
        const commit = await application.root.flush();
        invariant(
          commit !== undefined && Number.isSafeInteger(commit.hostRevision),
          "The memory warning did not produce a Fabric commit.",
        );
        const mounted = await waitForLifecycleEvent(
          mountEvents,
          commit.sequence,
          "mount",
        );
        const frame = await waitForLifecycleEvent(
          frameEvents,
          commit.sequence,
          "frame",
        );
        invariant(
          mounted.hostRevision === commit.hostRevision &&
            frame.hostRevision === commit.hostRevision &&
            frame.frameStartedAt >= mounted.mountedAt,
          "The memory-warning output produced inconsistent native lifecycle evidence.",
        );

        const commitStarted = startedOperation(
          records,
          "solid-native.commit",
          (record) => record.attributes["commit.sequence"] === commit.sequence,
        );
        const eventStarted = startedOperation(
          records,
          "solid-native.event",
          (record) =>
            record.attributes["event.name"] === "platform.memory-warning" &&
            commitStarted?.causes.includes(record.operationId) === true,
        );
        const computationStarted = startedOperation(
          records,
          "solid-native.computation",
          (record) =>
            record.attributes["computation.name"] === OUTPUT_COMPUTATION_NAME &&
            commitStarted?.causes.includes(record.operationId) === true,
        );
        const mountStarted = startedOperation(
          records,
          "solid-native.mount",
          (record) =>
            record.attributes["commit.sequence"] === commit.sequence &&
            record.attributes["mount.host_revision"] === commit.hostRevision,
        );
        const frameStarted = startedOperation(
          records,
          "solid-native.frame",
          (record) =>
            record.attributes["commit.sequence"] === commit.sequence &&
            record.attributes["frame.host_revision"] === commit.hostRevision,
        );
        invariant(
          commitStarted?.attributes["commit.priority"] === "normal" &&
            commitStarted.attributes["commit.mutation.update-text"] === 1 &&
            eventStarted?.attributes["event.priority"] === "default" &&
            eventStarted.attributes["event.source"] === "platform" &&
            computationStarted !== undefined &&
            mountStarted?.causes.length === 1 &&
            mountStarted.causes[0] === commitStarted.operationId &&
            frameStarted?.causes.length === 1 &&
            frameStarted.causes[0] === mountStarted.operationId,
          "The memory warning lost its event-to-Solid-to-Fabric-to-frame causal chain.",
        );
        invariant(
          Object.keys(eventStarted.attributes).every(
            (name) =>
              name === "event.bubbles" ||
              name === "event.coalescible" ||
              name === "event.name" ||
              name === "event.priority" ||
              name === "event.source" ||
              name === "surface.id" ||
              name.startsWith("resource."),
          ),
          "The memory-warning event retained a private native payload.",
        );
        console.log(
          "SOLID_NATIVE_MEMORY_WARNING_CAUSALITY_SUCCEEDED",
          commit.sequence,
          commit.hostRevision,
        );
        setStatus(SUCCEEDED_TEXT);
        const proofCommit = await application.root.flushMounted();
        invariant(
          proofCommit !== undefined && proofCommit.sequence > commit.sequence,
          "The verified memory-warning result did not reach the native accessibility tree.",
        );
      } catch (error) {
        reportFatal(error);
      }
    };

    application = startApplication(
      () => (
        <CausalOwner name="memory-warning.root">
          <View
            style={{
              alignItems: "center",
              backgroundColor: "#f8fafc",
              flex: 1,
              justifyContent: "center",
              padding: 24,
            }}
          >
            <Text accessibilityRole="header" style={{ fontSize: 22 }}>
              Solid Native memory-warning proof
            </Text>
            <Text
              testID="solid-native-memory-warning-status"
              style={{ color: "#166534", fontSize: 16, marginTop: 12 }}
            >
              {status()}
            </Text>
            <MemoryWarningOutput
              platform={platform}
              onWarning={(count) => {
                void Promise.resolve().then(() => verifyMemoryWarning(count));
              }}
            />
            {() =>
              status() === SUCCEEDED_TEXT ? (
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
              ) : null
            }
          </View>
        </CausalOwner>
      ),
      host,
      {
        surface: {
          name: "memory-warning-e2e",
          initialProps: {
            style: { backgroundColor: "#f8fafc", flex: 1 },
          },
        },
        autoCommit: false,
        requirements: {
          capabilities: ["commitMountEvents"],
          components: ["Pressable", "Text", "View"],
        },
        telemetry,
        onCommitError: reportFatal,
      },
    );
    unsubscribeLifecycle = host.subscribeLifecycle((event) => {
      if (event.type === "commit-mounted") {
        mountEvents.set(event.sequence, event);
      } else {
        frameEvents.set(event.sequence, event);
      }
    });
    const initial = await application.root.flushMounted();
    invariant(
      initial?.sequence === 1,
      "The memory-warning proof did not mount commit 1.",
    );
    await waitForLifecycleEvent(mountEvents, initial.sequence, "mount");
    await waitForLifecycleEvent(frameEvents, initial.sequence, "frame");
    console.log("SOLID_NATIVE_MEMORY_WARNING_READY", platform.platform);
  } catch (error) {
    reportFatal(error);
  }
}

void run();
