/** @jsxImportSource @solid-native/core */
import "react-native/setup-env";

import {
  CausalComputation,
  CausalOwner,
  CORE_COMPONENT_DESCRIPTORS,
  Pressable,
  ScrollView,
  Text,
  View,
} from "@solid-native/core";
import type {
  HostCommitFrameEvent,
  HostCommitMountedEvent,
} from "@solid-native/host-contract";
import type {
  CausalOperationName,
  CausalTelemetryRecord,
  CausalTelemetrySink,
} from "@solid-native/observability";
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

type OrderPhase = "active" | "queued" | "settled";

interface Order {
  readonly id: string;
  readonly customer: string;
  readonly amount: string;
}

const PROOF_TIMEOUT_MS = 5_000;
const PRODUCT_WORKLOAD_UPDATE_COUNT = 30;
const PRODUCT_OWNER_NAME = "fulfillment.screen";
const SUMMARY_COMPUTATION_NAME = "fulfillment.summary.output";
const ALERT_COMPUTATION_NAME = "fulfillment.alert.output";
const QUEUE_COMPUTATION_NAME = "fulfillment.queue.output";
const orders: readonly Order[] = [
  { id: "ORD-1001", customer: "Aster Labs", amount: "$148" },
  { id: "ORD-1002", customer: "Northstar", amount: "$86" },
  { id: "ORD-1003", customer: "Cinder Co", amount: "$212" },
  { id: "ORD-1004", customer: "Mesa Goods", amount: "$64" },
  { id: "ORD-1005", customer: "Juniper", amount: "$173" },
  { id: "ORD-1006", customer: "Riverline", amount: "$95" },
  { id: "ORD-1007", customer: "Atlas House", amount: "$131" },
  { id: "ORD-1008", customer: "Beacon", amount: "$118" },
  { id: "ORD-1009", customer: "Fable Works", amount: "$77" },
  { id: "ORD-1010", customer: "Orbit Supply", amount: "$204" },
  { id: "ORD-1011", customer: "Pine Studio", amount: "$59" },
  { id: "ORD-1012", customer: "Willow Market", amount: "$162" },
];

export interface ProductWorkloadOptions {
  readonly variant: "solid-native" | "baseline" | "observed";
  readonly createTelemetry?: (
    binding: NativeFabricBinding,
    sink: CausalTelemetrySink,
  ) => CausalTelemetry;
}

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
        "The mixed product workload surface did not become ready.",
      );
    }
    await delay(10);
  }
  return binding;
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
    `Product workload commit ${String(sequence)} did not reach its ${kind} boundary.`,
  );
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function startedOperation(
  records: readonly CausalTelemetryRecord[],
  name: CausalOperationName,
  predicate: (record: CausalTelemetryRecord) => boolean,
) {
  return records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === name &&
      predicate(record),
  );
}

function operationFinished(
  records: readonly CausalTelemetryRecord[],
  operationId: string | undefined,
) {
  return records.find(
    (record) =>
      record.type === "operation-finished" &&
      record.operationId === operationId,
  );
}

function verifyCausalInteraction(
  records: readonly CausalTelemetryRecord[],
  event: NativeSyntheticEvent,
  commitSequence: number,
  hostRevision: number,
  alertChanged: boolean,
): void {
  const eventStarted = startedOperation(
    records,
    "solid-native.event",
    (record) =>
      record.attributes["event.observed_sequence"] === event.observedSequence,
  );
  const commitStarted = startedOperation(
    records,
    "solid-native.commit",
    (record) => record.attributes["commit.sequence"] === commitSequence,
  );
  const ownerStarted = startedOperation(
    records,
    "solid-native.owner",
    (record) => record.attributes["owner.name"] === PRODUCT_OWNER_NAME,
  );
  const computation = (name: string) =>
    startedOperation(
      records,
      "solid-native.computation",
      (record) =>
        record.attributes["computation.name"] === name &&
        commitStarted?.type === "operation-started" &&
        commitStarted.causes.includes(record.operationId),
    );
  const summaryStarted = computation(SUMMARY_COMPUTATION_NAME);
  const alertStarted = computation(ALERT_COMPUTATION_NAME);
  const queueStarted = computation(QUEUE_COMPUTATION_NAME);
  const mountStarted = startedOperation(
    records,
    "solid-native.mount",
    (record) =>
      record.attributes["commit.sequence"] === commitSequence &&
      record.attributes["mount.host_revision"] === hostRevision,
  );
  const frameStarted = startedOperation(
    records,
    "solid-native.frame",
    (record) =>
      record.attributes["commit.sequence"] === commitSequence &&
      record.attributes["frame.host_revision"] === hostRevision,
  );
  const eventFinished = operationFinished(records, eventStarted?.operationId);
  const commitFinished = operationFinished(records, commitStarted?.operationId);
  const summaryFinished = operationFinished(
    records,
    summaryStarted?.operationId,
  );
  const alertFinished = operationFinished(records, alertStarted?.operationId);
  const queueFinished = operationFinished(records, queueStarted?.operationId);
  const mountFinished = operationFinished(records, mountStarted?.operationId);
  const frameFinished = operationFinished(records, frameStarted?.operationId);
  const unrelatedEventCause = records.some(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      record.operationId !== eventStarted?.operationId &&
      commitStarted?.type === "operation-started" &&
      commitStarted.causes.includes(record.operationId),
  );

  invariant(
    eventStarted?.type === "operation-started" &&
      eventStarted.attributes["event.name"] === "press" &&
      eventStarted.attributes["event.priority"] === "discrete" &&
      eventFinished?.type === "operation-finished" &&
      eventFinished.status === "ok" &&
      eventFinished.attributes["event.handler_count"] === 1,
    "The product workload did not retain its exact native press operation.",
  );
  invariant(
    ownerStarted?.type === "operation-started" &&
      commitStarted?.type === "operation-started" &&
      commitStarted.causes.includes(eventStarted.operationId) &&
      !unrelatedEventCause &&
      commitStarted.causes.includes(ownerStarted.operationId) &&
      commitFinished?.type === "operation-finished" &&
      commitFinished.status === "ok",
    "The product workload commit lost its native event or Solid owner cause.",
  );
  invariant(
    summaryStarted?.type === "operation-started" &&
      queueStarted?.type === "operation-started" &&
      summaryStarted.causes.includes(ownerStarted.operationId) &&
      queueStarted.causes.includes(ownerStarted.operationId) &&
      summaryFinished?.type === "operation-finished" &&
      summaryFinished.status === "ok" &&
      queueFinished?.type === "operation-finished" &&
      queueFinished.status === "ok",
    "The product workload lost a Solid native-output computation.",
  );
  invariant(
    alertChanged === (alertStarted?.type === "operation-started") &&
      (!alertChanged ||
        (alertStarted?.type === "operation-started" &&
          alertStarted.causes.includes(ownerStarted.operationId) &&
          alertFinished?.type === "operation-finished" &&
          alertFinished.status === "ok")),
    "The product workload alert computation did not match its structural transition.",
  );
  invariant(
    mountStarted?.type === "operation-started" &&
      mountStarted.causes.length === 1 &&
      mountStarted.causes[0] === commitStarted.operationId &&
      mountFinished?.type === "operation-finished" &&
      mountFinished.status === "ok" &&
      frameStarted?.type === "operation-started" &&
      frameStarted.causes.length === 1 &&
      frameStarted.causes[0] === mountStarted.operationId &&
      frameFinished?.type === "operation-finished" &&
      frameFinished.status === "ok",
    "The product workload did not preserve its commit-to-mount-to-frame chain.",
  );
}

function reportFatal(error: unknown): void {
  console.error("SOLID_NATIVE_PRODUCT_WORKLOAD_FAILED", error);
  setTimeout(() => {
    throw error instanceof Error ? error : new Error(String(error));
  });
}

interface OrderRowProps {
  readonly order: Order;
  readonly phase: () => OrderPhase;
}

function OrderRow(props: OrderRowProps) {
  return (
    <View
      accessibilityLabel={`Order ${props.order.id} ${props.phase()}`}
      accessible
      style={[
        styles.orderRow,
        props.phase() === "active"
          ? styles.activeOrder
          : props.phase() === "settled"
            ? styles.settledOrder
            : styles.queuedOrder,
      ]}
    >
      <View style={styles.orderIdentity}>
        <Text style={styles.orderId}>{props.order.id}</Text>
        <Text style={styles.customer}>{props.order.customer}</Text>
      </View>
      <View style={styles.orderMeta}>
        <Text style={styles.amount}>{props.order.amount}</Text>
        <Text style={styles.phase}>{props.phase()}</Text>
      </View>
    </View>
  );
}

export async function runProductWorkload(
  options: ProductWorkloadOptions,
): Promise<void> {
  try {
    const observed = options.variant === "observed";
    const measured = options.variant !== "solid-native";
    if (observed !== (options.createTelemetry !== undefined)) {
      throw new Error(
        "Only the observed product workload may construct causal telemetry.",
      );
    }
    const binding = await waitForSurface();
    const host = createNativeFabricHost({
      binding,
      descriptors: CORE_COMPONENT_DESCRIPTORS,
    });
    const telemetryRecords: CausalTelemetryRecord[] = [];
    const telemetry = options.createTelemetry?.(binding, (record) => {
      telemetryRecords.push(record);
    });
    const mountEvents = new Map<number, HostCommitMountedEvent>();
    const frameEvents = new Map<number, HostCommitFrameEvent>();
    const [processed, setProcessed] = createSignal(1);
    const [activeIndex, setActiveIndex] = createSignal(0);
    const [priorityAlert, setPriorityAlert] = createSignal(false);
    const phases = orders.map((_, index) =>
      createSignal<OrderPhase>(index === 0 ? "active" : "queued"),
    );
    let application: NativeApplication | undefined;
    let pressable: NativeNode | undefined;
    let eventInFlight = false;
    let eventIndex = 0;
    let validatedInteractionCount = 0;
    let alertComputationInteractionCount = 0;

    const advance = async (event: NativeSyntheticEvent): Promise<void> => {
      try {
        const app = application;
        const target = pressable;
        if (app === undefined || target === undefined) {
          throw new Error("The product workload press target is unavailable.");
        }
        if (
          event.name !== "press" ||
          event.currentTarget !== target ||
          event.priority !== "discrete"
        ) {
          throw new Error("The product workload received an invalid press.");
        }
        const currentEventIndex = ++eventIndex;
        const previousIndex = activeIndex();
        const nextIndex = (previousIndex + 1) % orders.length;
        const nextProcessed = processed() + 1;
        const previousAlert = priorityAlert();
        const nextAlert = nextProcessed % 5 === 0;
        const alertChanged = previousAlert !== nextAlert;
        const previousPhase = phases[previousIndex]?.[1];
        const nextPhase = phases[nextIndex]?.[1];
        if (previousPhase === undefined || nextPhase === undefined) {
          throw new Error("The product workload lost an order signal.");
        }

        const handlerEnteredAt = Date.now();
        previousPhase("settled");
        nextPhase("active");
        setActiveIndex(nextIndex);
        setProcessed(nextProcessed);
        setPriorityAlert(nextAlert);
        const commit = await app.root.flush();
        invariant(
          commit?.sequence === currentEventIndex + 1 &&
            Number.isSafeInteger(commit.hostRevision),
          "The product workload dropped or reordered its Solid commit.",
        );

        if (measured) {
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
            "The product workload received inconsistent native lifecycle evidence.",
          );
          if (observed) {
            verifyCausalInteraction(
              telemetryRecords,
              event,
              commit.sequence,
              commit.hostRevision,
              alertChanged,
            );
            validatedInteractionCount++;
            if (alertChanged) alertComputationInteractionCount++;
          } else {
            invariant(
              telemetryRecords.length === 0,
              "The baseline product workload unexpectedly emitted telemetry.",
            );
          }

          const handlerToCommitMilliseconds =
            mounted.commitStartedAt - handlerEnteredAt;
          const handlerToMountMilliseconds =
            mounted.mountedAt - handlerEnteredAt;
          const handlerToFrameMilliseconds =
            frame.frameStartedAt - handlerEnteredAt;
          invariant(
            handlerToCommitMilliseconds >= 0 &&
              handlerToMountMilliseconds >= handlerToCommitMilliseconds &&
              handlerToFrameMilliseconds >= handlerToMountMilliseconds,
            "The product workload emitted non-monotonic lifecycle timestamps.",
          );
          console.log(
            `SOLID_NATIVE_PRODUCT_TELEMETRY_UPDATE ${JSON.stringify({
              schemaVersion: 0,
              variant: options.variant,
              eventIndex: currentEventIndex,
              processed: nextProcessed,
              activeOrder: orders[nextIndex]?.id,
              alertVisible: nextAlert,
              alertComputation: alertChanged,
              observedSequence: event.observedSequence,
              commitSequence: commit.sequence,
              hostRevision: commit.hostRevision,
              handlerToCommitMilliseconds,
              handlerToMountMilliseconds,
              handlerToFrameMilliseconds,
              commitToMountMilliseconds: mounted.mountLatency,
              commitToFrameMilliseconds: frame.frameLatency,
              mountToFrameMilliseconds: frame.mountToFrameLatency,
              telemetryEnabled: observed,
              causalChainValidated: observed,
            })}`,
          );

          if (currentEventIndex === PRODUCT_WORKLOAD_UPDATE_COUNT) {
            if (observed) {
              const serializedTelemetry = JSON.stringify(telemetryRecords);
              const forbiddenValues = orders.flatMap((order) => [
                order.id,
                order.customer,
                order.amount,
              ]);
              invariant(
                forbiddenValues.every(
                  (value) => !serializedTelemetry.includes(value),
                ),
                "The product workload telemetry captured rendered order data.",
              );
              invariant(
                !serializedTelemetry.includes(
                  "Priority reconciliation required",
                ),
                "The product workload telemetry captured rendered alert text.",
              );
            }
            console.log(
              `SOLID_NATIVE_PRODUCT_TELEMETRY_RESULT ${JSON.stringify({
                schemaVersion: 0,
                benchmark: "causal-telemetry-product-workload",
                interpretation: "functional-proof",
                variant: options.variant,
                workload: "order-dashboard",
                input: "androidx-touchscreen-injection",
                updateCount: PRODUCT_WORKLOAD_UPDATE_COUNT,
                validatedInteractionCount,
                alertComputationInteractionCount,
                finalProcessed: nextProcessed,
                finalActiveOrder: orders[nextIndex]?.id,
                finalAlertVisible: nextAlert,
                telemetryRecordCount: telemetryRecords.length,
                telemetryEnabled: observed,
                payloadValuesRetained: false,
                runtime: {
                  name: binding.backend,
                  version: binding.backendVersion,
                  hostContractVersion: binding.contractVersion,
                  platform: binding.platform,
                },
              })}`,
            );
          }
        }

        console.log(
          "SOLID_NATIVE_PRODUCT_WORKLOAD_UPDATE",
          JSON.stringify({
            sequence: commit.sequence,
            processed: nextProcessed,
            activeOrder: orders[nextIndex]?.id,
          }),
        );
      } catch (error) {
        reportFatal(error);
      } finally {
        eventInFlight = false;
      }
    };
    const handleAdvance = (event: NativeSyntheticEvent): void => {
      if (eventInFlight) return;
      eventInFlight = true;
      // Run synchronously through the first flush boundary while the native
      // event is the active cause. No host mutation occurs after the await, so
      // returning void avoids attributing a later unrelated commit to promise
      // settlement.
      void advance(event);
    };

    application = startApplication(
      () => (
        <CausalOwner name={PRODUCT_OWNER_NAME}>
          <View style={styles.screen} testID="product-workload-root">
            <Text accessibilityRole="header" style={styles.title}>
              Fulfillment overview
            </Text>
            <CausalComputation name={SUMMARY_COMPUTATION_NAME}>
              <View style={styles.summaryRow}>
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryLabel}>Processed</Text>
                  <Text style={styles.summaryValue}>
                    Orders processed {processed()}
                  </Text>
                </View>
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryLabel}>Active</Text>
                  <Text style={styles.summaryValue}>
                    Active order {orders[activeIndex()]?.id}
                  </Text>
                </View>
              </View>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: (processed() % 10 || 10) * 24 },
                  ]}
                />
              </View>
            </CausalComputation>
            <CausalComputation name={ALERT_COMPUTATION_NAME}>
              {priorityAlert() ? (
                <View style={styles.alert}>
                  <Text style={styles.alertText}>
                    Priority reconciliation required
                  </Text>
                </View>
              ) : null}
            </CausalComputation>
            <Pressable
              ref={(node) => {
                pressable = node;
              }}
              accessibilityLabel="Advance fulfillment workload"
              accessibilityRole="button"
              onPress={handleAdvance}
              style={styles.button}
            >
              <Text style={styles.buttonText}>Process next order</Text>
            </Pressable>
            <Text style={styles.sectionTitle}>Live order queue</Text>
            <CausalComputation name={QUEUE_COMPUTATION_NAME}>
              <ScrollView style={styles.list}>
                {orders.map((order, index) => {
                  const phase = phases[index]?.[0];
                  if (phase === undefined) {
                    throw new Error(
                      "The product workload row signal is missing.",
                    );
                  }
                  return <OrderRow order={order} phase={phase} />;
                })}
              </ScrollView>
            </CausalComputation>
          </View>
        </CausalOwner>
      ),
      host,
      {
        surface: {
          name: `native-product-workload-${options.variant}`,
          initialProps: { style: { backgroundColor: "#f4f7fb", flex: 1 } },
        },
        autoCommit: false,
        ...(telemetry === undefined ? {} : { telemetry }),
        requirements: {
          capabilities: [
            "bubblingEvents",
            ...(measured ? (["commitMountEvents"] as const) : []),
          ],
          components: ["Pressable", "ScrollView", "Text", "View"],
        },
        onCommitError: reportFatal,
      },
    );
    if (measured) {
      host.subscribeLifecycle((event) => {
        if (event.type === "commit-mounted") {
          mountEvents.set(event.sequence, event);
        } else {
          frameEvents.set(event.sequence, event);
        }
      });
    }
    const mounted = await application.root.flush();
    if (
      mounted?.sequence !== 1 ||
      !Number.isSafeInteger(mounted.hostRevision)
    ) {
      throw new Error("The mixed product workload did not mount commit 1.");
    }
    if (measured) {
      await waitForLifecycleEvent(mountEvents, mounted.sequence, "mount");
      await waitForLifecycleEvent(frameEvents, mounted.sequence, "frame");
    }
    console.log(
      "SOLID_NATIVE_PRODUCT_WORKLOAD_READY",
      JSON.stringify({
        sequence: mounted.sequence,
        hostRevision: mounted.hostRevision,
        rows: orders.length,
        variant: options.variant,
      }),
    );
  } catch (error) {
    reportFatal(error);
  }
}

const styles = {
  screen: {
    backgroundColor: "#f4f7fb",
    flex: 1,
    padding: 18,
  },
  title: {
    color: "#14213d",
    fontSize: 25,
    fontWeight: "700",
    marginBottom: 10,
  },
  summaryRow: {
    flexDirection: "row",
    marginBottom: 8,
  },
  summaryCard: {
    backgroundColor: "#ffffff",
    flex: 1,
    marginRight: 8,
    padding: 10,
  },
  summaryLabel: {
    color: "#64748b",
    fontSize: 12,
  },
  summaryValue: {
    color: "#14213d",
    fontSize: 15,
    fontWeight: "600",
  },
  progressTrack: {
    backgroundColor: "#dbe4f0",
    height: 6,
    marginBottom: 8,
  },
  progressFill: {
    backgroundColor: "#2563eb",
    height: 6,
  },
  alert: {
    backgroundColor: "#fff1c2",
    marginBottom: 8,
    padding: 8,
  },
  alertText: {
    color: "#7c4a03",
    fontSize: 13,
    fontWeight: "600",
  },
  button: {
    alignItems: "center",
    backgroundColor: "#2563eb",
    marginBottom: 10,
    paddingVertical: 11,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
  },
  sectionTitle: {
    color: "#334155",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 6,
  },
  list: {
    flex: 1,
  },
  orderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  activeOrder: {
    backgroundColor: "#dbeafe",
  },
  queuedOrder: {
    backgroundColor: "#ffffff",
  },
  settledOrder: {
    backgroundColor: "#e8f7ee",
  },
  orderIdentity: {
    flex: 1,
  },
  orderMeta: {
    alignItems: "flex-end",
  },
  orderId: {
    color: "#1e293b",
    fontSize: 13,
    fontWeight: "600",
  },
  customer: {
    color: "#64748b",
    fontSize: 12,
  },
  amount: {
    color: "#1e293b",
    fontSize: 13,
    fontWeight: "600",
  },
  phase: {
    color: "#64748b",
    fontSize: 11,
  },
} as const;
