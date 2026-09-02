/** @jsxImportSource @solid-native/core */
import "react-native/setup-env";

import {
  CausalComputation,
  CausalOwner,
  CORE_COMPONENT_DESCRIPTORS,
  Pressable,
  Text,
  View,
} from "@solid-native/core";
import type {
  HostCommitFrameEvent,
  HostCommitMountedEvent,
} from "@solid-native/host-contract";
import {
  createSignal,
  type CausalTelemetry,
  type NativeApplication,
  type NativeNode,
  type NativeSyntheticEvent,
} from "@solid-native/renderer";
import {
  createNativeFabricHost,
  getNativeHostBinding,
  startApplication,
  type NativeFabricBinding,
} from "@solid-native/runtime";

type TelemetryBenchmarkVariant = "baseline" | "observed";

export interface TelemetryBenchmarkOptions {
  readonly variant: TelemetryBenchmarkVariant;
  readonly createTelemetry?: (
    binding: NativeFabricBinding,
    onRecord: () => void,
  ) => CausalTelemetry;
}

const PROOF_TIMEOUT_MS = 5_000;
const WARMUP_ITERATIONS = 100;
const MEASURED_ITERATIONS = 1_000;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function monotonicMilliseconds(): number {
  const clock = (
    globalThis as typeof globalThis & {
      readonly performance?: { now(): number };
    }
  ).performance;
  if (clock === undefined) {
    throw new Error("The native runtime did not expose a monotonic clock.");
  }
  return clock.now();
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

async function waitForLifecycleEvent<Event>(
  events: ReadonlyMap<number, Event>,
  sequence: number,
  kind: "mount" | "frame",
): Promise<Event> {
  const deadline = Date.now() + PROOF_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const event = events.get(sequence);
    if (event !== undefined) return event;
    await delay(10);
  }
  throw new Error(
    `Telemetry event commit ${String(sequence)} did not reach its ${kind} boundary.`,
  );
}

function reportFatal(error: unknown): void {
  console.error("SOLID_NATIVE_TELEMETRY_BENCHMARK_FAILED", error);
  setTimeout(() => {
    throw error instanceof Error ? error : new Error(String(error));
  });
}

interface BenchmarkTreeProps {
  readonly count: () => number;
  readonly onPress: (event: NativeSyntheticEvent) => unknown;
  readonly setPressable: (node: NativeNode) => void;
}

function BenchmarkTree(props: BenchmarkTreeProps) {
  return (
    <View style={styles.screen} testID="telemetry-benchmark-root">
      <Text style={styles.title}>Causal telemetry device benchmark</Text>
      <Text style={styles.status} testID="telemetry-benchmark-status">
        Commit {props.count()}
      </Text>
      <Pressable
        ref={props.setPressable}
        accessible
        accessibilityRole="button"
        accessibilityLabel="Run causal event sample"
        testID="telemetry-event-button"
        onPress={props.onPress}
        style={styles.button}
      >
        <Text style={styles.buttonText}>Run causal event sample</Text>
      </Pressable>
    </View>
  );
}

export async function runTelemetryBenchmark(
  options: TelemetryBenchmarkOptions,
): Promise<void> {
  try {
    const { variant } = options;
    const observed = variant === "observed";
    if (observed !== (options.createTelemetry !== undefined)) {
      throw new Error(
        "Only the observed benchmark may construct a telemetry session.",
      );
    }
    const binding = getNativeHostBinding();
    await waitForSurface(binding);
    const host = createNativeFabricHost({
      binding,
      descriptors: CORE_COMPONENT_DESCRIPTORS,
    });
    let telemetryRecordCount = 0;
    const telemetry = options.createTelemetry?.(binding, () => {
      telemetryRecordCount++;
    });

    const [count, setCount] = createSignal(0);
    const mountEvents = new Map<number, HostCommitMountedEvent>();
    const frameEvents = new Map<number, HostCommitFrameEvent>();
    let application: NativeApplication | undefined;
    let pressable: NativeNode | undefined;
    let eventBenchmarkReady = false;
    let eventInFlight = false;
    let eventIndex = 0;

    const handlePress = async (event: NativeSyntheticEvent): Promise<void> => {
      if (!eventBenchmarkReady || eventInFlight) return;
      eventInFlight = true;
      try {
        const app = application;
        if (app === undefined || pressable === undefined) {
          throw new Error("The telemetry event target is unavailable.");
        }
        const currentEventIndex = ++eventIndex;
        const expectedObservedSequence =
          WARMUP_ITERATIONS + MEASURED_ITERATIONS + 1 + currentEventIndex;
        if (
          event.name !== "press" ||
          event.currentTarget !== pressable ||
          event.priority !== "discrete" ||
          event.observedSequence !== expectedObservedSequence
        ) {
          throw new Error(
            "The telemetry event benchmark received an invalid press.",
          );
        }

        const handlerEnteredAt = Date.now();
        setCount(
          WARMUP_ITERATIONS + MEASURED_ITERATIONS + 1 + currentEventIndex,
        );
        await Promise.resolve();
        const commit = await app.root.flush();
        const expectedCommitSequence = expectedObservedSequence + 1;
        if (
          commit?.sequence !== expectedCommitSequence ||
          !Number.isSafeInteger(commit.hostRevision)
        ) {
          throw new Error(
            "The telemetry event benchmark dropped its Solid commit.",
          );
        }
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
        if (
          mounted.hostRevision !== commit.hostRevision ||
          frame.hostRevision !== commit.hostRevision ||
          frame.mountedAt < mounted.mountedAt ||
          frame.frameStartedAt < frame.mountedAt
        ) {
          throw new Error(
            "The telemetry event benchmark received inconsistent native lifecycle events.",
          );
        }

        const handlerToCommitMilliseconds =
          mounted.commitStartedAt - handlerEnteredAt;
        const handlerToMountMilliseconds = mounted.mountedAt - handlerEnteredAt;
        const handlerToFrameMilliseconds =
          frame.frameStartedAt - handlerEnteredAt;
        if (
          handlerToCommitMilliseconds < 0 ||
          handlerToMountMilliseconds < handlerToCommitMilliseconds ||
          handlerToFrameMilliseconds < handlerToMountMilliseconds
        ) {
          throw new Error(
            "The telemetry event benchmark received non-monotonic wall-clock timestamps.",
          );
        }

        console.log(
          `SOLID_NATIVE_TELEMETRY_EVENT_BENCHMARK_RESULT ${JSON.stringify({
            schemaVersion: 0,
            benchmark: "causal-telemetry-event-path",
            interpretation: "diagnostic-only",
            variant,
            warmupIterations: WARMUP_ITERATIONS,
            measuredIterations: MEASURED_ITERATIONS,
            eventIndex: currentEventIndex,
            eventName: event.name,
            eventPriority: event.priority,
            nativeEventTimestamp: event.timestamp,
            observedSequence: event.observedSequence,
            commitSequence: commit.sequence,
            hostRevision: commit.hostRevision,
            handlerToCommitMilliseconds,
            handlerToMountMilliseconds,
            handlerToFrameMilliseconds,
            commitToMountMilliseconds: mounted.mountLatency,
            commitToFrameMilliseconds: frame.frameLatency,
            mountToFrameMilliseconds: frame.mountToFrameLatency,
            telemetryRecordCount,
            finalRevisionMounted: true,
            runtime: {
              name: binding.backend,
              version: binding.backendVersion,
              hostContractVersion: binding.contractVersion,
              platform: binding.platform,
            },
          })}`,
        );
      } catch (error) {
        reportFatal(error);
        throw error;
      } finally {
        eventInFlight = false;
      }
    };

    application = startApplication(
      () => (
        <CausalOwner name="benchmark.screen">
          <CausalComputation name="benchmark.count.output">
            <BenchmarkTree
              count={count}
              onPress={handlePress}
              setPressable={(node) => {
                pressable = node;
              }}
            />
          </CausalComputation>
        </CausalOwner>
      ),
      host,
      {
        surface: {
          name: `telemetry-benchmark-${variant}`,
          initialProps: {
            style: { backgroundColor: "#f8fafc", flex: 1 },
          },
        },
        autoCommit: false,
        ...(telemetry === undefined ? {} : { telemetry }),
        requirements: {
          capabilities: ["bubblingEvents", "commitMountEvents"],
          components: ["Pressable", "Text", "View"],
        },
        onCommitError: reportFatal,
      },
    );
    const initial = await application.root.flushMounted();
    if (
      initial?.sequence !== 1 ||
      !Number.isSafeInteger(initial.hostRevision)
    ) {
      throw new Error(
        "The telemetry benchmark did not mount its initial native tree.",
      );
    }

    for (let iteration = 1; iteration <= WARMUP_ITERATIONS; iteration++) {
      setCount(iteration);
      const commit = await application.root.flush();
      if (commit?.sequence !== iteration + 1) {
        throw new Error("A telemetry benchmark warmup commit was dropped.");
      }
    }

    const startedAt = monotonicMilliseconds();
    for (let iteration = 1; iteration <= MEASURED_ITERATIONS; iteration++) {
      setCount(WARMUP_ITERATIONS + iteration);
      const commit = await application.root.flush();
      if (commit?.sequence !== WARMUP_ITERATIONS + iteration + 1) {
        throw new Error("A measured telemetry benchmark commit was dropped.");
      }
    }
    const durationMilliseconds = monotonicMilliseconds() - startedAt;

    host.subscribeLifecycle((event) => {
      if (event.type === "commit-mounted") {
        mountEvents.set(event.sequence, event);
      } else {
        frameEvents.set(event.sequence, event);
      }
    });
    setCount(WARMUP_ITERATIONS + MEASURED_ITERATIONS + 1);
    const mounted = await application.root.flushMounted();
    const expectedFinalSequence = WARMUP_ITERATIONS + MEASURED_ITERATIONS + 2;
    if (
      mounted?.sequence !== expectedFinalSequence ||
      !Number.isSafeInteger(mounted.hostRevision)
    ) {
      throw new Error(
        "The telemetry benchmark did not mount its final native revision.",
      );
    }
    if (observed && telemetryRecordCount < MEASURED_ITERATIONS * 4) {
      throw new Error(
        "The observed benchmark did not emit complete computation and commit records.",
      );
    }
    if (!observed && telemetryRecordCount !== 0) {
      throw new Error("The baseline benchmark unexpectedly emitted telemetry.");
    }

    console.log(
      `SOLID_NATIVE_TELEMETRY_BENCHMARK_RESULT ${JSON.stringify({
        schemaVersion: 0,
        benchmark: "causal-telemetry-shadow-commit",
        interpretation: "diagnostic-only",
        variant,
        warmupIterations: WARMUP_ITERATIONS,
        measuredIterations: MEASURED_ITERATIONS,
        durationMilliseconds,
        microsecondsPerCommit:
          (durationMilliseconds * 1_000) / MEASURED_ITERATIONS,
        telemetryRecordCount,
        finalSequence: mounted.sequence,
        finalHostRevision: mounted.hostRevision,
        finalRevisionMounted: true,
        runtime: {
          name: binding.backend,
          version: binding.backendVersion,
          hostContractVersion: binding.contractVersion,
          platform: binding.platform,
        },
      })}`,
    );

    await waitForLifecycleEvent(frameEvents, mounted.sequence, "frame");
    const target = pressable;
    if (target === undefined) {
      throw new Error("The telemetry event Pressable ref was not assigned.");
    }
    const measurement = await target.measure();
    if (
      measurement.observedSequence < mounted.sequence ||
      measurement.width <= 0 ||
      measurement.height <= 0
    ) {
      throw new Error("The telemetry event Pressable was not visibly mounted.");
    }
    eventBenchmarkReady = true;
    console.log(
      `SOLID_NATIVE_TELEMETRY_EVENT_BENCHMARK_READY ${JSON.stringify({
        schemaVersion: 0,
        variant,
        observedSequence: measurement.observedSequence,
        bounds: {
          pageX: measurement.pageX,
          pageY: measurement.pageY,
          width: measurement.width,
          height: measurement.height,
        },
      })}`,
    );
  } catch (error) {
    reportFatal(error);
  }
}

const styles = {
  screen: {
    backgroundColor: "#f8fafc",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  title: {
    color: "#0f172a",
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 16,
  },
  status: {
    color: "#334155",
    fontSize: 18,
    marginBottom: 20,
  },
  button: {
    backgroundColor: "#146ef5",
    borderRadius: 10,
    padding: 14,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "600",
  },
} as const;
