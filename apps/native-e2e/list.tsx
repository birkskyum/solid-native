/** @jsxImportSource @solid-native/core */
import "react-native/setup-env";

import {
  CORE_COMPONENT_DESCRIPTORS,
  Pressable,
  Text,
  View,
  VirtualizedList,
  type VirtualizedListHandle,
} from "@solid-native/core";
import type {
  HostCommit,
  HostCommitMountedEvent,
} from "@solid-native/host-contract";
import {
  createSignal,
  type NativeApplication,
  type NativeNode,
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
const ITEM_SIZE = 56;
const VIEWPORT_SIZE = 392;
const OVERSCAN = 2;
const PREPEND_COUNT = 50;
const MEASUREMENT_TOLERANCE = 0.01;
const MAXIMUM_PREPEND_STRUCTURAL_COMMITS = 4;
const MAXIMUM_IMPERATIVE_STRUCTURAL_COMMITS = 4;
const MAXIMUM_MOUNTED_ROWS =
  Math.ceil(VIEWPORT_SIZE / ITEM_SIZE) + OVERSCAN * 2 + 1;
const MINIMUM_PROOF_OFFSET = ITEM_SIZE * (OVERSCAN + 1);
const IMPERATIVE_INDEX = 900;
const IMPERATIVE_LOGICAL_INDEX = IMPERATIVE_INDEX + PREPEND_COUNT;
const IMPERATIVE_VIEW_POSITION = 0.5;
const IMPERATIVE_EXPECTED_OFFSET =
  IMPERATIVE_LOGICAL_INDEX * ITEM_SIZE -
  IMPERATIVE_VIEW_POSITION * (VIEWPORT_SIZE - ITEM_SIZE);
const READY_TEXT = "Solid Native VirtualizedList ready";
const SUCCEEDED_TEXT = "Solid Native VirtualizedList physical scroll mounted";
const PREPEND_SUCCEEDED_TEXT =
  "Solid Native VirtualizedList prepend anchor retained";
const IMPERATIVE_SUCCEEDED_TEXT =
  "Solid Native VirtualizedList imperative index mounted";
const PREPEND_LABEL = `Prepend ${String(PREPEND_COUNT)} virtualized rows`;
const IMPERATIVE_LABEL = `Jump to virtualized row ${String(IMPERATIVE_INDEX)}`;
const DISPOSE_LABEL = "Dispose virtualized list proof";

const originalItems = Array.from({ length: ITEM_COUNT }, (_, index) => ({
  id: `item-${String(index)}`,
  label: `Virtualized row ${String(index)}`,
}));
const prependedItems = Array.from({ length: PREPEND_COUNT }, (_, index) => ({
  id: `prepended-${String(index)}`,
  label: `Prepended virtualized row ${String(index)}`,
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

async function waitForMount(
  events: ReadonlyMap<number, HostCommitMountedEvent>,
  sequence: number,
): Promise<HostCommitMountedEvent> {
  const deadline = Date.now() + PROOF_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const event = events.get(sequence);
    if (event !== undefined) return event;
    await delay(10);
  }
  throw new Error(
    `VirtualizedList commit ${String(sequence)} did not reach the native UI thread.`,
  );
}

async function waitForScrollSettle(readOffset: () => number): Promise<number> {
  const deadline = Date.now() + PROOF_TIMEOUT_MS;
  let observed = readOffset();
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    await delay(50);
    const current = readOffset();
    if (current !== observed) {
      observed = current;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= 150) {
      return current;
    }
  }
  throw new Error("The physical VirtualizedList scroll did not settle.");
}

async function waitForScrollTarget(
  readOffset: () => number,
  target: number,
): Promise<number> {
  const deadline = Date.now() + PROOF_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const offset = readOffset();
    if (Math.abs(offset - target) <= 1) return offset;
    await delay(20);
  }
  throw new Error(
    `The imperative VirtualizedList scroll did not reach ${String(target)} points.`,
  );
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
      "The native VirtualizedList scroll event omitted its vertical offset.",
    );
  }
  return offset;
}

function reportFatal(error: unknown): void {
  console.error("SOLID_NATIVE_VIRTUALIZED_LIST_FAILED", error);
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
    const committedTransactions = new Map<number, HostCommit>();
    const commit = host.commit.bind(host);
    host.commit = (transaction) => {
      committedTransactions.set(transaction.sequence, transaction);
      return commit(transaction);
    };
    const mountEvents = new Map<number, HostCommitMountedEvent>();
    const activeKeys = new Set<string>();
    let ownerCreations = 0;
    let ownerDisposals = 0;
    let application: NativeApplication | undefined;
    let list: VirtualizedListHandle | undefined;
    let actionButton: NativeNode | undefined;
    let latestOffset = 0;
    let proofStarted = false;
    let prependStarted = false;
    let imperativeStarted = false;
    let teardownStarted = false;
    const [status, setStatus] = createSignal(READY_TEXT);
    const [items, setItems] = createSignal(originalItems);

    const handleScroll = (event: NativeSyntheticEvent): void => {
      if (
        event.name !== "scroll" ||
        event.currentTarget !== list?.nativeNode ||
        event.priority !== "continuous"
      ) {
        throw new Error(
          "The native VirtualizedList emitted an invalid continuous event.",
        );
      }
      latestOffset = contentOffsetY(event);
    };

    const handleScrollEnd = async (
      event: NativeSyntheticEvent,
    ): Promise<void> => {
      if (proofStarted) return;
      if (
        event.name !== "scrollEndDrag" ||
        event.currentTarget !== list?.nativeNode ||
        event.priority !== "discrete" ||
        !event.bubbles
      ) {
        throw new Error(
          `The native VirtualizedList emitted an invalid drag completion: ${JSON.stringify(
            {
              name: event.name,
              currentTargetMatches: event.currentTarget === list?.nativeNode,
              priority: event.priority,
              bubbles: event.bubbles,
              coalescible: event.coalescible,
            },
          )}.`,
        );
      }
      if (latestOffset < MINIMUM_PROOF_OFFSET) {
        throw new Error(
          `The physical list gesture moved only ${String(latestOffset)} points.`,
        );
      }
      proofStarted = true;
      const app = application;
      const target = list?.nativeNode;
      if (app === undefined || target === undefined) {
        throw new Error("The VirtualizedList application was not retained.");
      }
      const proofOffset = await waitForScrollSettle(() => latestOffset);
      await app.root.flushMounted();
      const listSequence = app.root.lastCommittedSequence;
      if (listSequence <= 1) {
        throw new Error(
          "The physical list gesture did not produce a mounted Fabric revision.",
        );
      }
      const mounted = await waitForMount(mountEvents, listSequence);
      const firstVisibleIndex = Math.floor(proofOffset / ITEM_SIZE);
      if (
        !Number.isSafeInteger(mounted.hostRevision) ||
        activeKeys.size === 0 ||
        activeKeys.size > MAXIMUM_MOUNTED_ROWS ||
        activeKeys.has("item-0") ||
        !activeKeys.has(`item-${String(firstVisibleIndex)}`) ||
        ownerCreations - ownerDisposals !== activeKeys.size
      ) {
        throw new Error(
          "The physical VirtualizedList did not retain a bounded keyed window.",
        );
      }
      const measurement = await target.measure();
      if (
        measurement.observedSequence < listSequence ||
        measurement.width <= 0 ||
        Math.abs(measurement.height - VIEWPORT_SIZE) > MEASUREMENT_TOLERANCE
      ) {
        throw new Error(
          `The physical VirtualizedList measurement was invalid: ${JSON.stringify(measurement)}.`,
        );
      }
      setStatus(SUCCEEDED_TEXT);
      await Promise.resolve();
      await app.root.flushMounted();
      const successSequence = app.root.lastCommittedSequence;
      if (successSequence <= listSequence) {
        throw new Error(
          "The VirtualizedList success state did not reach a later Fabric commit.",
        );
      }
      const successMount = await waitForMount(mountEvents, successSequence);
      if (!Number.isSafeInteger(successMount.hostRevision)) {
        throw new Error(
          "The VirtualizedList success commit omitted its Fabric revision.",
        );
      }
      console.log(
        `SOLID_NATIVE_VIRTUALIZED_LIST_SUCCEEDED ${JSON.stringify({
          schemaVersion: 0,
          itemCount: ITEM_COUNT,
          activeRowCount: activeKeys.size,
          maximumMountedRows: MAXIMUM_MOUNTED_ROWS,
          ownerCreations,
          ownerDisposals,
          scrollOffset: proofOffset,
          listSequence,
          sequence: successSequence,
          hostRevision: successMount.hostRevision,
          measuredHeight: measurement.height,
          platform: binding.platform,
          runtime: binding.backend,
          runtimeVersion: binding.backendVersion,
        })}`,
      );
    };

    const handleAction = async (event: NativeSyntheticEvent): Promise<void> => {
      if (
        event.name !== "press" ||
        event.currentTarget !== actionButton ||
        event.priority !== "discrete" ||
        !event.bubbles
      ) {
        throw new Error(
          "The VirtualizedList action received an invalid physical press.",
        );
      }
      if (status() === SUCCEEDED_TEXT && !prependStarted) {
        prependStarted = true;
        const app = application;
        if (app === undefined) {
          throw new Error("The VirtualizedList application was not retained.");
        }
        const beforeSequence = app.root.lastCommittedSequence;
        const beforeOffset = latestOffset;
        const anchorIndex = Math.floor(beforeOffset / ITEM_SIZE);
        const anchorKey = `item-${String(anchorIndex)}`;
        setItems([...prependedItems, ...originalItems]);
        await Promise.resolve();
        await app.root.flushMounted();
        const prependSequence = app.root.lastCommittedSequence;
        const structuralCommitCount = prependSequence - beforeSequence;
        const prependTransactions: HostCommit[] = [];
        for (
          let sequence = beforeSequence + 1;
          sequence <= prependSequence;
          sequence++
        ) {
          const transaction = committedTransactions.get(sequence);
          if (transaction === undefined) {
            throw new Error(
              `The VirtualizedList prepend omitted transaction ${String(sequence)}.`,
            );
          }
          prependTransactions.push(transaction);
        }
        const expectedOffset = beforeOffset + PREPEND_COUNT * ITEM_SIZE;
        const anchoredOffset = await waitForScrollTarget(
          () => latestOffset,
          expectedOffset,
        );
        if (
          structuralCommitCount < 1 ||
          structuralCommitCount > MAXIMUM_PREPEND_STRUCTURAL_COMMITS ||
          prependTransactions.length !== structuralCommitCount ||
          prependTransactions.some((transaction) =>
            transaction.mutations.some(
              (mutation) => mutation.type === "command",
            ),
          ) ||
          activeKeys.size === 0 ||
          activeKeys.size > MAXIMUM_MOUNTED_ROWS ||
          !activeKeys.has(anchorKey) ||
          activeKeys.has("prepended-0") ||
          ownerCreations - ownerDisposals !== activeKeys.size
        ) {
          throw new Error(
            `The VirtualizedList prepend did not retain its bounded keyed anchor: ${JSON.stringify(
              {
                activeRowCount: activeKeys.size,
                anchorKey,
                beforeSequence,
                prependSequence,
                structuralCommitCount,
                mutationTypes: prependTransactions.map((transaction) =>
                  transaction.mutations.map((mutation) => mutation.type),
                ),
              },
            )}.`,
          );
        }
        const prependMount = await waitForMount(mountEvents, prependSequence);
        setStatus(PREPEND_SUCCEEDED_TEXT);
        await Promise.resolve();
        await app.root.flushMounted();
        const successSequence = app.root.lastCommittedSequence;
        if (successSequence <= prependSequence) {
          throw new Error(
            "The VirtualizedList prepend success state did not mount.",
          );
        }
        console.log(
          `SOLID_NATIVE_VIRTUALIZED_LIST_PREPEND_SUCCEEDED ${JSON.stringify({
            schemaVersion: 0,
            prependCount: PREPEND_COUNT,
            anchorKey,
            beforeOffset,
            expectedOffset,
            scrollOffset: anchoredOffset,
            activeRowCount: activeKeys.size,
            beforeSequence,
            prependSequence,
            structuralCommitCount,
            sequence: successSequence,
            hostRevision: prependMount.hostRevision,
          })}`,
        );
        return;
      }
      if (status() === PREPEND_SUCCEEDED_TEXT && !imperativeStarted) {
        imperativeStarted = true;
        const app = application;
        const target = list;
        if (app === undefined || target === undefined) {
          throw new Error("The VirtualizedList application was not retained.");
        }
        const beforeSequence = app.root.lastCommittedSequence;
        await target.scrollToIndex({
          index: IMPERATIVE_LOGICAL_INDEX,
          viewPosition: IMPERATIVE_VIEW_POSITION,
          animated: false,
        });
        const commandSequence = app.root.lastCommittedSequence;
        const windowSequence = beforeSequence + 1;
        const structuralCommitCount = commandSequence - windowSequence;
        const imperativeTransactions: HostCommit[] = [];
        for (
          let sequence = windowSequence;
          sequence <= commandSequence;
          sequence++
        ) {
          const transaction = committedTransactions.get(sequence);
          if (transaction === undefined) {
            throw new Error(
              `The imperative VirtualizedList scroll omitted transaction ${String(sequence)}.`,
            );
          }
          imperativeTransactions.push(transaction);
        }
        const structuralTransactions = imperativeTransactions.slice(0, -1);
        const commandTransaction = imperativeTransactions.at(-1);
        const commandMutation = commandTransaction?.mutations[0];
        if (
          structuralCommitCount < 1 ||
          structuralCommitCount > MAXIMUM_IMPERATIVE_STRUCTURAL_COMMITS ||
          structuralTransactions.length !== structuralCommitCount ||
          structuralTransactions.some((transaction) =>
            transaction.mutations.some(
              (mutation) => mutation.type === "command",
            ),
          ) ||
          commandTransaction === undefined ||
          commandTransaction.mutations.length !== 1 ||
          commandMutation?.type !== "command" ||
          commandMutation.command !== "scrollTo" ||
          commandMutation.args.length !== 3 ||
          commandMutation.args[0] !== 0 ||
          commandMutation.args[1] !== IMPERATIVE_EXPECTED_OFFSET ||
          commandMutation.args[2] !== false
        ) {
          throw new Error(
            `The imperative VirtualizedList scroll did not retain a bounded structural barrier and isolated command: ${JSON.stringify(
              {
                beforeSequence,
                windowSequence,
                structuralCommitCount,
                commandSequence,
                priorities: imperativeTransactions.map(
                  (transaction) => transaction.priority,
                ),
                mutationTypes: imperativeTransactions.map((transaction) =>
                  transaction.mutations.map((mutation) => mutation.type),
                ),
                command:
                  commandMutation?.type === "command"
                    ? {
                        name: commandMutation.command,
                        args: commandMutation.args,
                      }
                    : undefined,
              },
            )}.`,
          );
        }
        const structuralMounts = await Promise.all(
          structuralTransactions.map((transaction) =>
            waitForMount(mountEvents, transaction.sequence),
          ),
        );
        const windowMount = structuralMounts.at(-1);
        const imperativeOffset = await waitForScrollTarget(
          () => latestOffset,
          IMPERATIVE_EXPECTED_OFFSET,
        );
        if (
          !Number.isSafeInteger(windowMount?.hostRevision) ||
          activeKeys.size === 0 ||
          activeKeys.size > MAXIMUM_MOUNTED_ROWS ||
          !activeKeys.has(`item-${String(IMPERATIVE_INDEX)}`) ||
          activeKeys.has("item-0") ||
          ownerCreations - ownerDisposals !== activeKeys.size
        ) {
          throw new Error(
            "The imperative VirtualizedList scroll did not mount a bounded target window.",
          );
        }
        const measurement = await target.nativeNode.measure();
        if (
          measurement.observedSequence < commandSequence ||
          measurement.width <= 0 ||
          Math.abs(measurement.height - VIEWPORT_SIZE) > MEASUREMENT_TOLERANCE
        ) {
          throw new Error(
            `The imperative VirtualizedList measurement was invalid: ${JSON.stringify(measurement)}.`,
          );
        }
        setStatus(IMPERATIVE_SUCCEEDED_TEXT);
        await Promise.resolve();
        await app.root.flushMounted();
        const successSequence = app.root.lastCommittedSequence;
        if (successSequence <= commandSequence) {
          throw new Error(
            "The imperative VirtualizedList success state did not mount.",
          );
        }
        const successMount = await waitForMount(mountEvents, successSequence);
        console.log(
          `SOLID_NATIVE_VIRTUALIZED_LIST_IMPERATIVE_SUCCEEDED ${JSON.stringify({
            schemaVersion: 0,
            index: IMPERATIVE_LOGICAL_INDEX,
            itemIndex: IMPERATIVE_INDEX,
            viewPosition: IMPERATIVE_VIEW_POSITION,
            expectedOffset: IMPERATIVE_EXPECTED_OFFSET,
            scrollOffset: imperativeOffset,
            activeRowCount: activeKeys.size,
            ownerCreations,
            ownerDisposals,
            beforeSequence,
            windowSequence,
            structuralCommitCount,
            commandSequence,
            commandPriority: commandTransaction.priority,
            sequence: successSequence,
            hostRevision: successMount.hostRevision,
            measuredHeight: measurement.height,
          })}`,
        );
        return;
      }
      if (teardownStarted) return;
      if (status() !== IMPERATIVE_SUCCEEDED_TEXT) {
        throw new Error(
          "The VirtualizedList teardown ran before the imperative proof completed.",
        );
      }
      teardownStarted = true;
      const app = application;
      if (app === undefined) {
        throw new Error("The VirtualizedList application was not retained.");
      }
      await app.dispose();
      if (
        !app.root.disposed ||
        activeKeys.size !== 0 ||
        ownerCreations !== ownerDisposals
      ) {
        throw new Error(
          `The physical VirtualizedList did not release every Solid owner: ${JSON.stringify(
            {
              rootDisposed: app.root.disposed,
              activeRowCount: activeKeys.size,
              ownerCreations,
              ownerDisposals,
            },
          )}.`,
        );
      }
      if (binding.getSurfaceInfo().ready) {
        throw new Error(
          "VirtualizedList disposal resolved before the platform stopped its native surface.",
        );
      }
      console.log(
        `SOLID_NATIVE_VIRTUALIZED_LIST_TEARDOWN_SUCCEEDED ${JSON.stringify({
          schemaVersion: 0,
          ownerCreations,
          ownerDisposals,
          activeRowCount: activeKeys.size,
          rootDisposed: app.root.disposed,
          surfaceReady: binding.getSurfaceInfo().ready,
        })}`,
      );
    };

    application = startApplication(
      () => (
        <View style={{ flex: 1, padding: 24 }}>
          <Text
            accessibilityRole="header"
            style={{ color: "#111827", fontSize: 24, marginBottom: 8 }}
          >
            Solid Native virtualized list
          </Text>
          <Text
            testID="solid-native-virtualized-list-status"
            style={{
              color: "#334155",
              fontSize: 16,
              height: 48,
              marginBottom: 12,
            }}
          >
            {status()}
          </Text>
          <Pressable
            ref={(node) => {
              actionButton = node;
            }}
            accessible
            accessibilityRole="button"
            accessibilityLabel={
              status() === IMPERATIVE_SUCCEEDED_TEXT
                ? DISPOSE_LABEL
                : status() === SUCCEEDED_TEXT
                  ? PREPEND_LABEL
                  : IMPERATIVE_LABEL
            }
            disabled={status() === READY_TEXT}
            onPress={(event) => {
              void handleAction(event).catch(reportFatal);
            }}
            style={{
              backgroundColor:
                status() === SUCCEEDED_TEXT ||
                status() === PREPEND_SUCCEEDED_TEXT ||
                status() === IMPERATIVE_SUCCEEDED_TEXT
                  ? "#0f766e"
                  : "#94a3b8",
              borderRadius: 8,
              marginBottom: 12,
              padding: 12,
            }}
          >
            <Text style={{ color: "#ffffff", fontSize: 16 }}>
              {status() === IMPERATIVE_SUCCEEDED_TEXT
                ? "Dispose list proof"
                : status() === SUCCEEDED_TEXT
                  ? `Prepend ${String(PREPEND_COUNT)} rows`
                  : `Jump to row ${String(IMPERATIVE_INDEX)}`}
            </Text>
          </Pressable>
          <VirtualizedList
            ref={(node) => {
              list = node;
            }}
            accessible={binding.platform === "android"}
            accessibilityLabel="Solid Native virtualized list"
            testID="solid-native-virtualized-list"
            data={items()}
            itemSize={ITEM_SIZE}
            viewportSize={VIEWPORT_SIZE}
            overscan={OVERSCAN}
            maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
            keyExtractor={(item) => item.id}
            renderItem={({ item, key }) => {
              if (activeKeys.has(key)) {
                throw new Error(
                  `VirtualizedList mounted duplicate owner ${key}.`,
                );
              }
              activeKeys.add(key);
              ownerCreations++;
              onCleanup(() => {
                if (!activeKeys.delete(key)) {
                  reportFatal(
                    new Error(
                      `VirtualizedList disposed inactive owner ${key}.`,
                    ),
                  );
                }
                ownerDisposals++;
              });
              return (
                <Text
                  accessible
                  accessibilityLabel={item().label}
                  style={{
                    backgroundColor: "#e2e8f0",
                    borderBottomColor: "#94a3b8",
                    borderBottomWidth: 1,
                    color: "#0f172a",
                    fontSize: 17,
                    height: ITEM_SIZE,
                    padding: 16,
                  }}
                >
                  {item().label}
                </Text>
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
          name: "virtualized-list-e2e",
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
          components: ["Pressable", "ScrollView", "Text", "View"],
        },
        onCommitError: reportFatal,
      },
    );
    host.subscribeLifecycle((event) => {
      if (event.type === "commit-mounted") {
        mountEvents.set(event.sequence, event);
      }
    });
    const initial = await application.root.flushMounted();
    if (
      initial?.sequence !== 1 ||
      !Number.isSafeInteger(initial.hostRevision) ||
      activeKeys.size === 0 ||
      activeKeys.size > MAXIMUM_MOUNTED_ROWS
    ) {
      throw new Error(
        "The VirtualizedList did not mount its initial bounded native window.",
      );
    }
    console.log("SOLID_NATIVE_VIRTUALIZED_LIST_READY");
  } catch (error) {
    reportFatal(error);
  }
}

void run();
