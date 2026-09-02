/** @jsxImportSource @solid-native/core */
import "react-native/setup-env";
import * as TurboModuleRegistry from "react-native/Libraries/TurboModule/TurboModuleRegistry";

import {
  ActivityIndicator,
  CausalComputation,
  CausalOwner,
  CORE_COMPONENT_DESCRIPTORS,
  Image,
  Modal,
  Pressable,
  ScreenHeader,
  ScrollView,
  StatusBar,
  Switch,
  Text,
  TextInput,
  View,
  createAppState,
  createKeyboard,
  createNativeComponentDescriptor,
  type NativeCausalScope,
  type NativeNode,
  type NativeSyntheticEvent,
  type ScrollViewHandle,
} from "@solid-native/core";
import {
  Loading,
  createSignal,
  effect,
  type NativeApplication,
} from "@solid-native/renderer";
import type { CameraService, CameraSession } from "@solid-native/camera";
import {
  createCameraSessionEvent,
  createOwnedCameraSession,
  type OwnedCameraSession,
} from "@solid-native/camera/solid";
import {
  createNativeHistoryFromLaunch,
  createNativeHistoryPersistence,
  createNativeNavigationBindings,
  createTanStackNativeScreenFocusEffect,
  createTanStackNativeHistory,
  createTanStackNativeRouter,
  deserializeNativeHistorySnapshot,
  TanStackNativeOutlet,
  TanStackNativeRouterProvider,
  TanStackNativeStack,
  TanStackRootRoute,
  TanStackRoute,
  useTanStackNativeScreen,
  type NativeHistoryPersistence,
  type NativeHistoryEntry,
  type NativeNavigationTransition,
} from "@solid-native/navigation";
import type { NotificationService } from "@solid-native/notifications";
import { createNotificationEvent } from "@solid-native/notifications/solid";
import {
  createNativeFabricHost,
  getNativeHostBinding,
  startApplication,
  waitForNativeSurface,
} from "@solid-native/runtime";
import {
  NotifeeApiModuleNativeModuleDescriptor,
  RNAsyncStorageNativeModuleDescriptor,
  SOLID_NATIVE_BINDING_MANIFEST,
  SolidNativeGeneratedViewNativeComponent as GeneratedView,
  SolidNativeGeneratedViewNativeDescriptor as GENERATED_VIEW_DESCRIPTOR,
  resolveRNAsyncStorageNativeModule,
} from "./generated/SolidNativeBindings";
import {
  createSampledCausalTelemetry,
  type CausalTelemetryRecord,
} from "@solid-native/observability";
import { getReactNativePlatformServices } from "@solid-native/runtime/react-native";
import type { KeyValueStorage } from "@solid-native/storage";
import type {
  HostCommitFrameEvent,
  HostCommitMountedEvent,
  HostValue,
} from "@solid-native/host-contract";
import { createComponent, createMemo } from "solid-js";

const READY_TEXT = "Background and reactivate to begin";
const RESOURCE_PROOF_START_LABEL = "Start intensive device proof";
const LIFECYCLE_READY_TEXT =
  "Native lifecycle event observed; ready for a physical press";
const APP_STATE_EVENT_NAME = "platform.app-state.change";
const APP_STATE_COMPUTATION_NAME = "platform.app-state.output";
const SIGNAL_TEXT = "Native press delivered through a Solid signal";
const ASYNC_LOADING_TEXT = "Solid async profile loading";
const ASYNC_READY_TEXT = "Solid async profile ready";
const IMAGE_PENDING_TEXT = "Native Image load proof pending";
const IMAGE_READY_TEXT = "Native Image load event observed";
const SCROLL_PENDING_TEXT = "Native ScrollView proof pending";
const SCROLL_READY_TEXT = "Native ScrollView command and event observed";
const IMAGE_LOAD_TASK_NAME = "media.image.load.settlement";
const IMAGE_STATUS_COMPUTATION_NAME = "media.image.status.output";
const SCROLL_EVENT_TASK_NAME = "input.scroll.event.settlement";
const SCROLL_STATUS_COMPUTATION_NAME = "input.scroll.status.output";
const SCROLL_VIEW_COMPUTATION_NAME = "input.scroll.viewport.output";
const CAMERA_CAPTURE_TEXT = "Native camera photo capture observed";
const CAMERA_CAPTURE_TASK_NAME = "camera.capture";
const CAMERA_CAPTURE_COMPUTATION_NAME = "camera.capture.output";
const CAMERA_PREVIEW_TASK_NAME = "camera.session.preview";
const CAMERA_PREVIEW_COMPUTATION_NAME = "camera.preview.output";
const CAMERA_SESSION_PENDING_TEXT = "Native camera session event pending";
const CAMERA_SESSION_STARTED_TEXT = "Native camera session start observed";
const CAMERA_SESSION_COMPUTATION_NAME = "platform.camera.session.output";
const NOTIFICATION_PENDING_TEXT = "Native notification proof pending";
const NOTIFICATION_DELIVERED_TEXT = "Native notification delivery observed";
const NOTIFICATION_PRESSED_TEXT = "Native notification press observed";
const NOTIFICATION_COMPUTATION_NAME = "platform.notification.output";
const NAVIGATION_DETAIL_TEXT = "Solid-owned native navigation detail";
const NAVIGATION_DETAIL_HEADER_TEXT = "Solid Native detail";
const NAVIGATION_BACK_TEXT = "Use the platform back gesture or button";
const DEEP_LINK_URL =
  "dev.solidnative.e2e://navigation/physical?source=device-test";
const DEEP_LINK_TEXT = "Native deep link delivered into Solid history";
const SCREEN_FOCUSED_TEXT = "Native screen focus observed";
const SCREEN_BLURRED_TEXT = "Native screen awaiting focus";
const NAVIGATION_FOCUS_COMPUTATION_NAME = "navigation.focus.output";
const TEXT_INPUT_VALUE_COMPUTATION_NAME = "input.text.value.output";
const TEXT_INPUT_SUBMIT_COMPUTATION_NAME = "input.text.submit.output";
const MULTILINE_TEXT_INPUT_COMPUTATION_NAME = "input.multiline.value.output";
const SWITCH_CONTROLLED_COMPUTATION_NAME = "input.switch.controlled.output";
const TEXT_INPUT_VALUE = "SolidNative42";
const TEXT_INPUT_CONTROLLED_VALUE = "Solid controls Native";
const TEXT_INPUT_SELECTION_VALUE = "SolidX controls Native";
const TEXT_INPUT_PENDING_TEXT = "Native TextInput proof pending";
const TEXT_INPUT_SELECTION_PENDING_TEXT = "Native TextInput selection pending";
const TEXT_INPUT_SELECTION_READY_TEXT =
  "Native TextInput controlled selection ready";
const TEXT_INPUT_SELECTION_SUCCEEDED_TEXT =
  "Native TextInput controlled selection observed";
const TEXT_INPUT_SUBMIT_READY_TEXT = "Native TextInput ready for submit";
const TEXT_INPUT_SUBMITTED_TEXT = "Native TextInput submit and blur observed";
const TEXT_INPUT_SUBMIT_PENDING_TEXT = "Native TextInput submit pending";
const MULTILINE_TEXT_INPUT_VALUE = "Solid\nNative";
const MULTILINE_TEXT_INPUT_PENDING_TEXT =
  "Native multiline TextInput proof pending";
const MULTILINE_TEXT_INPUT_READY_TEXT =
  "Native multiline TextInput ready for newline";
const MULTILINE_TEXT_INPUT_SUCCEEDED_TEXT =
  "Native multiline TextInput newline observed";
const SWITCH_PENDING_TEXT = "Native controlled Switch proof pending";
const SWITCH_SUCCEEDED_TEXT = "Native controlled Switch rollback observed";
const PERMITTED_NATIVE_EVENT_START_ATTRIBUTES = new Set([
  "event.bubbles",
  "event.coalescible",
  "event.name",
  "event.native_timestamp",
  "event.observed_sequence",
  "event.priority",
  "surface.id",
  "target.node",
]);
const PERMITTED_PLATFORM_EVENT_START_ATTRIBUTES = new Set([
  "event.bubbles",
  "event.coalescible",
  "event.name",
  "event.priority",
  "event.source",
  "surface.id",
]);
const PERMITTED_NATIVE_COMMAND_START_ATTRIBUTES = new Set([
  "command.name",
  "surface.id",
  "target.node",
]);
const PERMITTED_NATIVE_TASK_START_ATTRIBUTES = new Set(["task.name"]);
const PERMITTED_MEASUREMENT_START_ATTRIBUTES = new Set([
  "surface.id",
  "target.node",
]);
const PERMITTED_MEASUREMENT_FINISH_ATTRIBUTES = new Set([
  "measurement.after_sequence",
  "measurement.observed_sequence",
]);
const MODAL_TITLE_TEXT = "Solid Native modal is presented";
const MODAL_PENDING_TEXT = "Native Modal show pending";
const MODAL_SHOWN_TEXT = "Native Modal show observed";
const MODAL_LIFECYCLE_COMPUTATION_NAME = "modal.lifecycle.output";
const MODAL_CLOSE_LABEL = "Close Solid Native modal";
const MODAL_PRESENT_LABEL = "Present Solid Native modal";
const IMAGE_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAB4CAYAAAA5ZDbSAAABMUlEQVR42u3RwQnAIADAwNoZnNPtfdspihDuJghkzLXPQ9Z7O4B/GRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncNwHjfgDZpcg8EsAAAAASUVORK5CYII=";
const PROOF_TIMEOUT_MS = 5_000;
const TEARDOWN_DELAY_MS = 10_000;
const RESOURCE_PROOF_WATCHDOG_MS = 3 * 60_000;
// A physical iPhone can spend several seconds establishing its XCTest
// automation session after JavaScript has already mounted. Keep the initial
// deep-link screen visible long enough for the operating-system assertion to
// observe it before the app resets the launch stack.
const COLD_START_DISPLAY_MS = 10_000;
const STORAGE_PROOF_KEY = "physical-module-proof";
const NAVIGATION_STORAGE_KEY = "physical-navigation";
const NOTIFICATION_PROOF_ID = "solid-native-physical-proof";
const NOTIFICATION_PROOF_TITLE = "Solid Native notification proof";
const NOTIFICATION_PROOF_BODY =
  "Delivered by a React-free New Architecture module";

const CAMERA_PREVIEW_DESCRIPTOR =
  createNativeComponentDescriptor("PreviewView");
type CameraPreviewComponent =
  (typeof import("@solid-native/camera/react-native"))["CameraPreview"];

interface NavigationScreenLifecycle {
  readonly entryId: string;
  readonly href: string;
  readonly name: "focus" | "blur";
  readonly observedSequence: number;
}

const NativePlatform = getReactNativePlatformServices();

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isHostObject(
  value: unknown,
): value is Readonly<Record<string, HostValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function waitForMount(
  events: Map<number, HostCommitMountedEvent>,
  sequence: number,
): Promise<HostCommitMountedEvent> {
  const deadline = Date.now() + PROOF_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const event = events.get(sequence);
    if (event !== undefined) return event;
    await delay(10);
  }
  throw new Error(
    `Commit ${String(sequence)} did not produce a mount lifecycle event.`,
  );
}

async function waitForFrame(
  events: Map<number, HostCommitFrameEvent>,
  sequence: number,
): Promise<HostCommitFrameEvent> {
  const deadline = Date.now() + PROOF_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const event = events.get(sequence);
    if (event !== undefined) return event;
    await delay(10);
  }
  throw new Error(
    `Commit ${String(sequence)} did not reach the next platform frame callback.`,
  );
}

async function waitForScreenLifecycle(
  events: readonly NavigationScreenLifecycle[],
  startIndex: number,
  href: string,
  name: NavigationScreenLifecycle["name"],
  minimumSequence: number,
): Promise<NavigationScreenLifecycle> {
  const deadline = Date.now() + PROOF_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const event = events
      .slice(startIndex)
      .find(
        (candidate) =>
          candidate.href === href &&
          candidate.name === name &&
          candidate.observedSequence >= minimumSequence,
      );
    if (event !== undefined) return event;
    await delay(10);
  }
  throw new Error(
    `Native screen ${href} did not emit ${name} at or after commit ${String(minimumSequence)}.`,
  );
}

function startedTelemetryOperation(
  records: readonly CausalTelemetryRecord[],
  name: CausalTelemetryRecord["name"],
  predicate: (record: CausalTelemetryRecord) => boolean,
) {
  return records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === name &&
      predicate(record),
  );
}

function finishedTelemetryOperation(
  records: readonly CausalTelemetryRecord[],
  operationId: string | undefined,
) {
  return records.find(
    (record) =>
      record.type === "operation-finished" &&
      record.operationId === operationId,
  );
}

async function verifyAppStateCausality(
  records: readonly CausalTelemetryRecord[],
  mountEvents: Map<number, HostCommitMountedEvent>,
  frameEvents: Map<number, HostCommitFrameEvent>,
  commitSequence: number,
  hostRevision: number,
  resource: Readonly<{
    runtimeName: string;
    runtimeVersion: string;
    hostContractVersion: number;
    platform: string;
  }>,
): Promise<void> {
  await waitForMount(mountEvents, commitSequence);
  await waitForFrame(frameEvents, commitSequence);

  const commitStarted = startedTelemetryOperation(
    records,
    "solid-native.commit",
    (record) => record.attributes["commit.sequence"] === commitSequence,
  );
  const eventStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      record.attributes["event.name"] === APP_STATE_EVENT_NAME &&
      record.attributes["event.source"] === "platform" &&
      commitStarted?.type === "operation-started" &&
      commitStarted.causes.includes(record.operationId),
  );
  const surfaceStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.surface" &&
      eventStarted?.type === "operation-started" &&
      eventStarted.causes.length === 1 &&
      eventStarted.causes[0] === record.operationId,
  );
  const ownerStarted = startedTelemetryOperation(
    records,
    "solid-native.owner",
    (record) => record.attributes["owner.name"] === "e2e.root",
  );
  const computationStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.computation" &&
      record.attributes["computation.name"] === APP_STATE_COMPUTATION_NAME &&
      commitStarted?.type === "operation-started" &&
      commitStarted.causes.includes(record.operationId),
  );
  const eventFinished = finishedTelemetryOperation(
    records,
    eventStarted?.operationId,
  );
  const computationFinished = finishedTelemetryOperation(
    records,
    computationStarted?.operationId,
  );
  const commitFinished = finishedTelemetryOperation(
    records,
    commitStarted?.operationId,
  );

  invariant(
    surfaceStarted?.type === "operation-started" &&
      eventStarted?.type === "operation-started" &&
      eventStarted.causes.length === 1 &&
      eventStarted.causes[0] === surfaceStarted.operationId &&
      eventStarted.attributes["event.bubbles"] === false &&
      eventStarted.attributes["event.coalescible"] === false &&
      eventStarted.attributes["event.priority"] === "default" &&
      Object.keys(eventStarted.attributes).every(
        (name) =>
          PERMITTED_PLATFORM_EVENT_START_ATTRIBUTES.has(name) ||
          name.startsWith("resource."),
      ) &&
      eventFinished?.type === "operation-finished" &&
      eventFinished.status === "ok" &&
      eventFinished.attributes["event.handler_count"] === 1,
    "AppState lost its bounded, private platform-event operation.",
  );
  invariant(
    ownerStarted?.type === "operation-started" &&
      ownerStarted.causes.length === 1 &&
      ownerStarted.causes[0] === surfaceStarted.operationId &&
      computationStarted?.type === "operation-started" &&
      computationStarted.causes.length === 1 &&
      computationStarted.causes[0] === ownerStarted.operationId &&
      computationFinished?.type === "operation-finished" &&
      computationFinished.status === "ok",
    "AppState lost its Solid owner or named lifecycle output.",
  );
  invariant(
    commitStarted?.type === "operation-started" &&
      commitStarted.attributes["commit.priority"] === "normal" &&
      commitStarted.attributes["commit.mutation_count"] === 1 &&
      commitStarted.attributes["commit.mutation.update-text"] === 1 &&
      commitStarted.causes.length === 3 &&
      commitStarted.causes.includes(eventStarted.operationId) &&
      commitStarted.causes.includes(ownerStarted.operationId) &&
      commitStarted.causes.includes(computationStarted.operationId) &&
      commitFinished?.type === "operation-finished" &&
      commitFinished.status === "ok" &&
      commitFinished.attributes["commit.host_revision"] === hostRevision &&
      commitStarted.attributes["resource.runtime.name"] ===
        resource.runtimeName &&
      commitStarted.attributes["resource.runtime.version"] ===
        resource.runtimeVersion &&
      commitStarted.attributes["resource.runtime.host_contract_version"] ===
        resource.hostContractVersion &&
      commitStarted.attributes["resource.platform"] === resource.platform,
    "AppState lost its exact Solid/Fabric output commit.",
  );

  const mountStarted = startedTelemetryOperation(
    records,
    "solid-native.mount",
    (record) =>
      record.attributes["commit.sequence"] === commitSequence &&
      record.attributes["mount.host_revision"] === hostRevision,
  );
  const frameStarted = startedTelemetryOperation(
    records,
    "solid-native.frame",
    (record) =>
      record.attributes["commit.sequence"] === commitSequence &&
      record.attributes["frame.host_revision"] === hostRevision,
  );
  const mountFinished = finishedTelemetryOperation(
    records,
    mountStarted?.operationId,
  );
  const frameFinished = finishedTelemetryOperation(
    records,
    frameStarted?.operationId,
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
    "AppState lost its exact commit-to-mount-to-frame chain.",
  );
  invariant(
    !JSON.stringify(records).includes(LIFECYCLE_READY_TEXT),
    "AppState telemetry retained private lifecycle output.",
  );
}

async function verifyCameraOutputCausality(
  records: readonly CausalTelemetryRecord[],
  mountEvents: Map<number, HostCommitMountedEvent>,
  frameEvents: Map<number, HostCommitFrameEvent>,
  commitSequence: number,
  hostRevision: number,
  taskName: string,
  computationName: string,
  outputLabel: string,
  resource: Readonly<{
    runtimeName: string;
    runtimeVersion: string;
    hostContractVersion: number;
    platform: string;
  }>,
): Promise<void> {
  await waitForMount(mountEvents, commitSequence);
  await waitForFrame(frameEvents, commitSequence);

  const taskStarted = startedTelemetryOperation(
    records,
    "solid-native.task",
    (record) => record.attributes["task.name"] === taskName,
  );
  const surfaceStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.surface" &&
      taskStarted?.type === "operation-started" &&
      taskStarted.causes.length === 1 &&
      taskStarted.causes[0] === record.operationId,
  );
  const ownerStarted = startedTelemetryOperation(
    records,
    "solid-native.owner",
    (record) => record.attributes["owner.name"] === "e2e.root",
  );
  const commitStarted = startedTelemetryOperation(
    records,
    "solid-native.commit",
    (record) => record.attributes["commit.sequence"] === commitSequence,
  );
  const computationStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.computation" &&
      record.attributes["computation.name"] === computationName &&
      commitStarted?.type === "operation-started" &&
      commitStarted.causes.includes(record.operationId),
  );
  const taskFinished = finishedTelemetryOperation(
    records,
    taskStarted?.operationId,
  );
  const computationFinished = finishedTelemetryOperation(
    records,
    computationStarted?.operationId,
  );
  const commitFinished = finishedTelemetryOperation(
    records,
    commitStarted?.operationId,
  );

  invariant(
    surfaceStarted?.type === "operation-started" &&
      taskStarted?.type === "operation-started" &&
      taskStarted.causes.length === 1 &&
      taskStarted.causes[0] === surfaceStarted.operationId &&
      taskFinished?.type === "operation-finished" &&
      taskFinished.status === "ok" &&
      Object.keys(taskStarted.attributes).every(
        (name) =>
          PERMITTED_NATIVE_TASK_START_ATTRIBUTES.has(name) ||
          name.startsWith("resource."),
      ),
    `${outputLabel} lost its bounded, private native task.`,
  );
  invariant(
    ownerStarted?.type === "operation-started" &&
      ownerStarted.causes.length === 1 &&
      ownerStarted.causes[0] === surfaceStarted.operationId &&
      computationStarted?.type === "operation-started" &&
      computationStarted.causes.length === 1 &&
      computationStarted.causes[0] === ownerStarted.operationId &&
      computationFinished?.type === "operation-finished" &&
      computationFinished.status === "ok",
    `${outputLabel} lost its Solid owner or named output computation.`,
  );
  invariant(
    commitStarted?.type === "operation-started" &&
      commitStarted.attributes["commit.priority"] === "normal" &&
      typeof commitStarted.attributes["commit.mutation_count"] === "number" &&
      commitStarted.attributes["commit.mutation_count"] > 0 &&
      !("commit.mutation.command" in commitStarted.attributes) &&
      commitStarted.causes.length === 3 &&
      commitStarted.causes.includes(taskStarted.operationId) &&
      commitStarted.causes.includes(ownerStarted.operationId) &&
      commitStarted.causes.includes(computationStarted.operationId) &&
      commitFinished?.type === "operation-finished" &&
      commitFinished.status === "ok" &&
      commitFinished.attributes["commit.host_revision"] === hostRevision &&
      commitStarted.attributes["resource.runtime.name"] ===
        resource.runtimeName &&
      commitStarted.attributes["resource.runtime.version"] ===
        resource.runtimeVersion &&
      commitStarted.attributes["resource.runtime.host_contract_version"] ===
        resource.hostContractVersion &&
      commitStarted.attributes["resource.platform"] === resource.platform,
    `${outputLabel} lost its exact Solid/Fabric commit.`,
  );

  const mountStarted = startedTelemetryOperation(
    records,
    "solid-native.mount",
    (record) =>
      record.attributes["commit.sequence"] === commitSequence &&
      record.attributes["mount.host_revision"] === hostRevision,
  );
  const frameStarted = startedTelemetryOperation(
    records,
    "solid-native.frame",
    (record) =>
      record.attributes["commit.sequence"] === commitSequence &&
      record.attributes["frame.host_revision"] === hostRevision,
  );
  const mountFinished = finishedTelemetryOperation(
    records,
    mountStarted?.operationId,
  );
  const frameFinished = finishedTelemetryOperation(
    records,
    frameStarted?.operationId,
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
    `${outputLabel} lost its exact mount-to-frame chain.`,
  );
}

async function verifyScrollImageCausality(
  records: readonly CausalTelemetryRecord[],
  mountEvents: Map<number, HostCommitMountedEvent>,
  frameEvents: Map<number, HostCommitFrameEvent>,
  commandSequence: number,
  statusSequence: number,
  statusHostRevision: number,
): Promise<void> {
  await waitForMount(mountEvents, statusSequence);
  await waitForFrame(frameEvents, statusSequence);

  const ownerStarted = startedTelemetryOperation(
    records,
    "solid-native.owner",
    (record) => record.attributes["owner.name"] === "e2e.root",
  );
  const commands = records.filter(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.command" &&
      record.attributes["command.name"] === "scrollTo",
  );
  const commandStarted = commands[0];
  const commandComputation = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.computation" &&
      record.attributes["computation.name"] === SCROLL_VIEW_COMPUTATION_NAME &&
      commandStarted?.type === "operation-started" &&
      commandStarted.causes.includes(record.operationId),
  );
  const commandCommit = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      commandStarted?.type === "operation-started" &&
      record.causes.length === 1 &&
      record.causes[0] === commandStarted.operationId,
  );
  const commandFinished = finishedTelemetryOperation(
    records,
    commandStarted?.operationId,
  );
  const commandComputationFinished = finishedTelemetryOperation(
    records,
    commandComputation?.operationId,
  );
  const commandCommitFinished = finishedTelemetryOperation(
    records,
    commandCommit?.operationId,
  );

  invariant(
    ownerStarted?.type === "operation-started" &&
      commands.length === 1 &&
      commandStarted?.type === "operation-started" &&
      commandStarted.causes.length === 1 &&
      commandComputation?.type === "operation-started" &&
      commandStarted.causes[0] === commandComputation.operationId &&
      commandComputation.causes.length === 1 &&
      commandComputation.causes[0] === ownerStarted.operationId &&
      commandFinished?.type === "operation-finished" &&
      commandFinished.status === "ok" &&
      commandComputationFinished?.type === "operation-finished" &&
      commandComputationFinished.status === "ok",
    "The ScrollView command lost its named Solid output cause.",
  );
  invariant(
    Object.keys(commandStarted.attributes).every(
      (name) =>
        PERMITTED_NATIVE_COMMAND_START_ATTRIBUTES.has(name) ||
        name.startsWith("resource."),
    ),
    "ScrollView command telemetry retained its native arguments.",
  );
  invariant(
    commandCommit?.type === "operation-started" &&
      commandCommit.attributes["commit.sequence"] === commandSequence &&
      commandCommit.attributes["commit.priority"] === "normal" &&
      commandCommit.attributes["commit.mutation_count"] === 1 &&
      commandCommit.attributes["commit.mutation.command"] === 1 &&
      commandCommitFinished?.type === "operation-finished" &&
      commandCommitFinished.status === "ok" &&
      !("commit.host_revision" in commandCommitFinished.attributes) &&
      !records.some(
        (record) =>
          record.type === "operation-started" &&
          (record.name === "solid-native.mount" ||
            record.name === "solid-native.frame") &&
          record.attributes["commit.sequence"] === commandSequence,
      ),
    "The ScrollView command lost its isolated non-mounting commit.",
  );

  const imageTaskStarted = startedTelemetryOperation(
    records,
    "solid-native.task",
    (record) => record.attributes["task.name"] === IMAGE_LOAD_TASK_NAME,
  );
  const scrollTaskStarted = startedTelemetryOperation(
    records,
    "solid-native.task",
    (record) => record.attributes["task.name"] === SCROLL_EVENT_TASK_NAME,
  );
  const imageEventStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      imageTaskStarted?.type === "operation-started" &&
      imageTaskStarted.causes.length === 1 &&
      imageTaskStarted.causes[0] === record.operationId,
  );
  const scrollEventStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      scrollTaskStarted?.type === "operation-started" &&
      scrollTaskStarted.causes.length === 1 &&
      scrollTaskStarted.causes[0] === record.operationId,
  );
  const imageEventFinished = finishedTelemetryOperation(
    records,
    imageEventStarted?.operationId,
  );
  const scrollEventFinished = finishedTelemetryOperation(
    records,
    scrollEventStarted?.operationId,
  );
  const imageTaskFinished = finishedTelemetryOperation(
    records,
    imageTaskStarted?.operationId,
  );
  const scrollTaskFinished = finishedTelemetryOperation(
    records,
    scrollTaskStarted?.operationId,
  );

  invariant(
    imageEventStarted?.type === "operation-started" &&
      imageEventStarted.attributes["event.name"] === "load" &&
      imageEventStarted.attributes["event.priority"] === "default" &&
      imageEventStarted.attributes["event.bubbles"] === false &&
      imageEventFinished?.type === "operation-finished" &&
      imageEventFinished.status === "ok" &&
      imageEventFinished.attributes["event.handler_count"] === 1 &&
      scrollEventStarted?.type === "operation-started" &&
      scrollEventStarted.attributes["event.name"] === "scroll" &&
      scrollEventStarted.attributes["event.priority"] === "continuous" &&
      scrollEventStarted.attributes["event.observed_sequence"] ===
        commandSequence &&
      scrollEventFinished?.type === "operation-finished" &&
      scrollEventFinished.status === "ok" &&
      scrollEventFinished.attributes["event.handler_count"] === 1,
    "The Image/ScrollView settlement lost its exact native events.",
  );
  invariant(
    [imageEventStarted, scrollEventStarted].every((record) =>
      Object.keys(record.attributes).every(
        (name) =>
          PERMITTED_NATIVE_EVENT_START_ATTRIBUTES.has(name) ||
          name.startsWith("resource."),
      ),
    ),
    "Image/ScrollView event telemetry retained a native payload.",
  );
  invariant(
    imageTaskStarted?.type === "operation-started" &&
      imageTaskStarted.causes[0] === imageEventStarted.operationId &&
      imageTaskFinished?.type === "operation-finished" &&
      imageTaskFinished.status === "ok" &&
      scrollTaskStarted?.type === "operation-started" &&
      scrollTaskStarted.causes[0] === scrollEventStarted.operationId &&
      scrollTaskFinished?.type === "operation-finished" &&
      scrollTaskFinished.status === "ok" &&
      [imageTaskStarted, scrollTaskStarted].every((record) =>
        Object.keys(record.attributes).every(
          (name) =>
            PERMITTED_NATIVE_TASK_START_ATTRIBUTES.has(name) ||
            name.startsWith("resource."),
        ),
      ),
    "The Image/ScrollView events did not survive their asynchronous task scopes.",
  );

  const statusCommit = startedTelemetryOperation(
    records,
    "solid-native.commit",
    (record) => record.attributes["commit.sequence"] === statusSequence,
  );
  const imageStatusComputation = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.computation" &&
      record.attributes["computation.name"] === IMAGE_STATUS_COMPUTATION_NAME &&
      statusCommit?.type === "operation-started" &&
      statusCommit.causes.includes(record.operationId),
  );
  const scrollStatusComputation = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.computation" &&
      record.attributes["computation.name"] ===
        SCROLL_STATUS_COMPUTATION_NAME &&
      statusCommit?.type === "operation-started" &&
      statusCommit.causes.includes(record.operationId),
  );
  const statusCommitFinished = finishedTelemetryOperation(
    records,
    statusCommit?.operationId,
  );
  const imageStatusComputationFinished = finishedTelemetryOperation(
    records,
    imageStatusComputation?.operationId,
  );
  const scrollStatusComputationFinished = finishedTelemetryOperation(
    records,
    scrollStatusComputation?.operationId,
  );

  invariant(
    statusCommit?.type === "operation-started" &&
      statusCommit.attributes["commit.priority"] === "normal" &&
      statusCommit.attributes["commit.mutation_count"] === 2 &&
      statusCommit.attributes["commit.mutation.update-text"] === 2 &&
      statusCommit.causes.length === 5 &&
      statusCommit.causes.includes(ownerStarted.operationId) &&
      statusCommit.causes.includes(imageTaskStarted.operationId) &&
      statusCommit.causes.includes(scrollTaskStarted.operationId) &&
      imageStatusComputation?.type === "operation-started" &&
      statusCommit.causes.includes(imageStatusComputation.operationId) &&
      scrollStatusComputation?.type === "operation-started" &&
      statusCommit.causes.includes(scrollStatusComputation.operationId) &&
      statusCommitFinished?.type === "operation-finished" &&
      statusCommitFinished.status === "ok" &&
      statusCommitFinished.attributes["commit.host_revision"] ===
        statusHostRevision,
    "The Image/ScrollView outputs did not coalesce into one exact Fabric commit.",
  );
  invariant(
    imageStatusComputation.causes.length === 1 &&
      imageStatusComputation.causes[0] === ownerStarted.operationId &&
      imageStatusComputationFinished?.type === "operation-finished" &&
      imageStatusComputationFinished.status === "ok" &&
      scrollStatusComputation.causes.length === 1 &&
      scrollStatusComputation.causes[0] === ownerStarted.operationId &&
      scrollStatusComputationFinished?.type === "operation-finished" &&
      scrollStatusComputationFinished.status === "ok",
    "The Image/ScrollView commit lost its named Solid output computations.",
  );

  const mountStarted = startedTelemetryOperation(
    records,
    "solid-native.mount",
    (record) =>
      record.attributes["commit.sequence"] === statusSequence &&
      record.attributes["mount.host_revision"] === statusHostRevision,
  );
  const frameStarted = startedTelemetryOperation(
    records,
    "solid-native.frame",
    (record) =>
      record.attributes["commit.sequence"] === statusSequence &&
      record.attributes["frame.host_revision"] === statusHostRevision,
  );
  const mountFinished = finishedTelemetryOperation(
    records,
    mountStarted?.operationId,
  );
  const frameFinished = finishedTelemetryOperation(
    records,
    frameStarted?.operationId,
  );
  invariant(
    mountStarted?.type === "operation-started" &&
      mountStarted.causes.length === 1 &&
      mountStarted.causes[0] === statusCommit.operationId &&
      mountFinished?.type === "operation-finished" &&
      mountFinished.status === "ok" &&
      frameStarted?.type === "operation-started" &&
      frameStarted.causes.length === 1 &&
      frameStarted.causes[0] === mountStarted.operationId &&
      frameFinished?.type === "operation-finished" &&
      frameFinished.status === "ok",
    "The Image/ScrollView commit lost its mount-to-frame chain.",
  );
}

function verifyNavigationFocusCausality(
  records: readonly CausalTelemetryRecord[],
  lifecycles: readonly NavigationScreenLifecycle[],
  focusedLifecycle: NavigationScreenLifecycle,
  commitSequence: number,
  hostRevision: number,
): void {
  const commitStarted = startedTelemetryOperation(
    records,
    "solid-native.commit",
    (record) => record.attributes["commit.sequence"] === commitSequence,
  );
  const ownerStarted = startedTelemetryOperation(
    records,
    "solid-native.owner",
    (record) => record.attributes["owner.name"] === "e2e.root",
  );
  const focusEventStarted = startedTelemetryOperation(
    records,
    "solid-native.event",
    (record) =>
      record.attributes["event.observed_sequence"] ===
        focusedLifecycle.observedSequence &&
      record.attributes["event.name"] === focusedLifecycle.name,
  );
  const lifecycleSequences = new Set(
    lifecycles.map((lifecycle) => lifecycle.observedSequence),
  );
  const causalLifecycleEvents = records.filter(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      commitStarted?.type === "operation-started" &&
      commitStarted.causes.includes(record.operationId),
  );
  const computations = records.filter(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.computation" &&
      record.attributes["computation.name"] ===
        NAVIGATION_FOCUS_COMPUTATION_NAME &&
      commitStarted?.type === "operation-started" &&
      commitStarted.causes.includes(record.operationId),
  );
  const mountStarted = startedTelemetryOperation(
    records,
    "solid-native.mount",
    (record) =>
      record.attributes["commit.sequence"] === commitSequence &&
      record.attributes["mount.host_revision"] === hostRevision,
  );
  const frameStarted = startedTelemetryOperation(
    records,
    "solid-native.frame",
    (record) =>
      record.attributes["commit.sequence"] === commitSequence &&
      record.attributes["frame.host_revision"] === hostRevision,
  );
  const focusEventFinished = finishedTelemetryOperation(
    records,
    focusEventStarted?.operationId,
  );
  const commitFinished = finishedTelemetryOperation(
    records,
    commitStarted?.operationId,
  );
  const mountFinished = finishedTelemetryOperation(
    records,
    mountStarted?.operationId,
  );
  const frameFinished = finishedTelemetryOperation(
    records,
    frameStarted?.operationId,
  );

  invariant(
    focusedLifecycle.name === "focus" &&
      focusEventStarted?.type === "operation-started" &&
      focusEventStarted.attributes["event.name"] === "focus" &&
      focusEventStarted.attributes["event.priority"] === "default" &&
      focusEventFinished?.type === "operation-finished" &&
      focusEventFinished.status === "ok" &&
      focusEventFinished.attributes["event.handler_count"] === 1,
    "Native navigation lost its exact focus-event telemetry.",
  );
  invariant(
    commitStarted?.type === "operation-started" &&
      commitStarted.causes.includes(focusEventStarted.operationId) &&
      ownerStarted?.type === "operation-started" &&
      commitStarted.causes.includes(ownerStarted.operationId) &&
      commitFinished?.type === "operation-finished" &&
      commitFinished.status === "ok" &&
      causalLifecycleEvents.length > 0 &&
      causalLifecycleEvents.every(
        (record) =>
          (record.attributes["event.name"] === "focus" ||
            record.attributes["event.name"] === "blur") &&
          lifecycleSequences.has(
            record.attributes["event.observed_sequence"] as number,
          ),
      ),
    "The navigation focus commit lost or invented a native lifecycle cause.",
  );
  invariant(
    computations.length > 0 &&
      computations.every((record) => {
        const finished = finishedTelemetryOperation(
          records,
          record.operationId,
        );
        return (
          record.type === "operation-started" &&
          record.causes.includes(ownerStarted.operationId) &&
          finished?.type === "operation-finished" &&
          finished.status === "ok"
        );
      }),
    "The navigation focus commit lost its Solid native-output computation.",
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
    "Navigation focus did not preserve its commit-to-mount-to-frame chain.",
  );
}

async function verifyPlatformEventCausality(
  records: readonly CausalTelemetryRecord[],
  mountEvents: Map<number, HostCommitMountedEvent>,
  frameEvents: Map<number, HostCommitFrameEvent>,
  commitSequence: number,
  hostRevision: number,
  eventName:
    | "platform.hardware-back.press"
    | "platform.url.open"
    | "platform.notification.delivered"
    | "platform.notification.pressed"
    | "platform.camera.session.started",
  eventPriority: "discrete" | "default",
  commitPriority: "user-blocking" | "normal",
  computationName: string | undefined,
  outputLabel: string,
  privateValue: string | undefined,
  resource: Readonly<{
    runtimeName: string;
    runtimeVersion: string;
    hostContractVersion: number;
    platform: string;
  }>,
): Promise<void> {
  await waitForMount(mountEvents, commitSequence);
  await waitForFrame(frameEvents, commitSequence);

  const commitStarted = startedTelemetryOperation(
    records,
    "solid-native.commit",
    (record) => record.attributes["commit.sequence"] === commitSequence,
  );
  const eventStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      record.attributes["event.name"] === eventName &&
      record.attributes["event.source"] === "platform" &&
      commitStarted?.type === "operation-started" &&
      commitStarted.causes.includes(record.operationId),
  );
  const surfaceStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.surface" &&
      eventStarted?.type === "operation-started" &&
      eventStarted.causes.length === 1 &&
      eventStarted.causes[0] === record.operationId,
  );
  const ownerStarted = startedTelemetryOperation(
    records,
    "solid-native.owner",
    (record) => record.attributes["owner.name"] === "e2e.root",
  );
  const computationStarted = records.find(
    (record) =>
      computationName !== undefined &&
      record.type === "operation-started" &&
      record.name === "solid-native.computation" &&
      record.attributes["computation.name"] === computationName &&
      commitStarted?.type === "operation-started" &&
      commitStarted.causes.includes(record.operationId),
  );
  const eventFinished = finishedTelemetryOperation(
    records,
    eventStarted?.operationId,
  );
  const commitFinished = finishedTelemetryOperation(
    records,
    commitStarted?.operationId,
  );
  const computationFinished = finishedTelemetryOperation(
    records,
    computationStarted?.operationId,
  );

  invariant(
    surfaceStarted?.type === "operation-started" &&
      eventStarted?.type === "operation-started" &&
      eventStarted.causes.length === 1 &&
      eventStarted.causes[0] === surfaceStarted.operationId &&
      eventStarted.attributes["event.bubbles"] === false &&
      eventStarted.attributes["event.coalescible"] === false &&
      eventStarted.attributes["event.priority"] === eventPriority &&
      Object.keys(eventStarted.attributes).every(
        (name) =>
          PERMITTED_PLATFORM_EVENT_START_ATTRIBUTES.has(name) ||
          name.startsWith("resource."),
      ) &&
      eventFinished?.type === "operation-finished" &&
      eventFinished.status === "ok" &&
      eventFinished.attributes["event.handler_count"] === 1,
    `${outputLabel} lost its bounded, private platform event.`,
  );
  invariant(
    ownerStarted?.type === "operation-started" &&
      ownerStarted.causes.length === 1 &&
      ownerStarted.causes[0] === surfaceStarted.operationId &&
      (computationName === undefined ||
        (computationStarted?.type === "operation-started" &&
          computationStarted.causes.length === 1 &&
          computationStarted.causes[0] === ownerStarted.operationId &&
          computationFinished?.type === "operation-finished" &&
          computationFinished.status === "ok")),
    `${outputLabel} lost its Solid route owner or named initial output.`,
  );
  invariant(
    commitStarted?.type === "operation-started" &&
      commitStarted.attributes["commit.priority"] === commitPriority &&
      typeof commitStarted.attributes["commit.mutation_count"] === "number" &&
      commitStarted.attributes["commit.mutation_count"] > 0 &&
      !("commit.mutation.command" in commitStarted.attributes) &&
      commitStarted.causes.length === (computationName === undefined ? 2 : 3) &&
      commitStarted.causes.includes(eventStarted.operationId) &&
      commitStarted.causes.includes(ownerStarted.operationId) &&
      (computationStarted === undefined ||
        commitStarted.causes.includes(computationStarted.operationId)) &&
      commitFinished?.type === "operation-finished" &&
      commitFinished.status === "ok" &&
      commitFinished.attributes["commit.host_revision"] === hostRevision &&
      commitStarted.attributes["resource.runtime.name"] ===
        resource.runtimeName &&
      commitStarted.attributes["resource.runtime.version"] ===
        resource.runtimeVersion &&
      commitStarted.attributes["resource.runtime.host_contract_version"] ===
        resource.hostContractVersion &&
      commitStarted.attributes["resource.platform"] === resource.platform,
    `${outputLabel} lost its exact Solid/Fabric route commit.`,
  );

  const mountStarted = startedTelemetryOperation(
    records,
    "solid-native.mount",
    (record) =>
      record.attributes["commit.sequence"] === commitSequence &&
      record.attributes["mount.host_revision"] === hostRevision,
  );
  const frameStarted = startedTelemetryOperation(
    records,
    "solid-native.frame",
    (record) =>
      record.attributes["commit.sequence"] === commitSequence &&
      record.attributes["frame.host_revision"] === hostRevision,
  );
  const mountFinished = finishedTelemetryOperation(
    records,
    mountStarted?.operationId,
  );
  const frameFinished = finishedTelemetryOperation(
    records,
    frameStarted?.operationId,
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
    `${outputLabel} lost its exact commit-to-mount-to-frame chain.`,
  );
  invariant(
    privateValue === undefined ||
      !JSON.stringify(records).includes(privateValue),
    `${outputLabel} telemetry retained its private callback payload.`,
  );
}

async function verifyNativeDismissCausality(
  records: readonly CausalTelemetryRecord[],
  mountEvents: Map<number, HostCommitMountedEvent>,
  frameEvents: Map<number, HostCommitFrameEvent>,
  commitSequence: number,
  hostRevision: number,
  resource: Readonly<{
    runtimeName: string;
    runtimeVersion: string;
    hostContractVersion: number;
    platform: string;
  }>,
): Promise<void> {
  await waitForMount(mountEvents, commitSequence);
  await waitForFrame(frameEvents, commitSequence);

  const commitStarted = startedTelemetryOperation(
    records,
    "solid-native.commit",
    (record) => record.attributes["commit.sequence"] === commitSequence,
  );
  const eventStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      record.attributes["event.name"] === "dismiss" &&
      commitStarted?.type === "operation-started" &&
      commitStarted.causes.includes(record.operationId),
  );
  const surfaceStarted = records.find(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.surface",
  );
  const ownerStarted = startedTelemetryOperation(
    records,
    "solid-native.owner",
    (record) => record.attributes["owner.name"] === "e2e.root",
  );
  const eventFinished = finishedTelemetryOperation(
    records,
    eventStarted?.operationId,
  );
  const commitFinished = finishedTelemetryOperation(
    records,
    commitStarted?.operationId,
  );

  invariant(
    eventStarted?.type === "operation-started" &&
      eventStarted.attributes["event.bubbles"] === false &&
      eventStarted.attributes["event.coalescible"] === false &&
      eventStarted.attributes["event.priority"] === "default" &&
      Object.keys(eventStarted.attributes).every(
        (name) =>
          PERMITTED_NATIVE_EVENT_START_ATTRIBUTES.has(name) ||
          name.startsWith("resource."),
      ) &&
      eventFinished?.type === "operation-finished" &&
      eventFinished.status === "ok" &&
      eventFinished.attributes["event.handler_count"] === 1,
    "Native screen dismissal lost its bounded, private Fabric event.",
  );
  invariant(
    surfaceStarted?.type === "operation-started" &&
      ownerStarted?.type === "operation-started" &&
      ownerStarted.causes.length === 1 &&
      ownerStarted.causes[0] === surfaceStarted.operationId,
    "Native screen dismissal lost its Solid route owner.",
  );
  invariant(
    commitStarted?.type === "operation-started" &&
      commitStarted.attributes["commit.priority"] === "normal" &&
      typeof commitStarted.attributes["commit.mutation_count"] === "number" &&
      commitStarted.attributes["commit.mutation_count"] > 0 &&
      !("commit.mutation.command" in commitStarted.attributes) &&
      commitStarted.causes.length === 2 &&
      commitStarted.causes.includes(eventStarted.operationId) &&
      commitStarted.causes.includes(ownerStarted.operationId) &&
      commitFinished?.type === "operation-finished" &&
      commitFinished.status === "ok" &&
      commitFinished.attributes["commit.host_revision"] === hostRevision &&
      commitStarted.attributes["resource.runtime.name"] ===
        resource.runtimeName &&
      commitStarted.attributes["resource.runtime.version"] ===
        resource.runtimeVersion &&
      commitStarted.attributes["resource.runtime.host_contract_version"] ===
        resource.hostContractVersion &&
      commitStarted.attributes["resource.platform"] === resource.platform,
    "Native screen dismissal lost its exact Solid/Fabric route commit.",
  );

  const mountStarted = startedTelemetryOperation(
    records,
    "solid-native.mount",
    (record) =>
      record.attributes["commit.sequence"] === commitSequence &&
      record.attributes["mount.host_revision"] === hostRevision,
  );
  const frameStarted = startedTelemetryOperation(
    records,
    "solid-native.frame",
    (record) =>
      record.attributes["commit.sequence"] === commitSequence &&
      record.attributes["frame.host_revision"] === hostRevision,
  );
  const mountFinished = finishedTelemetryOperation(
    records,
    mountStarted?.operationId,
  );
  const frameFinished = finishedTelemetryOperation(
    records,
    frameStarted?.operationId,
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
    "Native screen dismissal lost its exact commit-to-mount-to-frame chain.",
  );
}

function verifyTextInputValueCausality(
  records: readonly CausalTelemetryRecord[],
  interactionStart: number,
  eventCount: number,
  observedSequence: number,
  commitSequence: number,
  hostRevision: number,
): number {
  const interactionRecords = records.slice(interactionStart);
  const commitStarted = startedTelemetryOperation(
    interactionRecords,
    "solid-native.commit",
    (record) => record.attributes["commit.sequence"] === commitSequence,
  );
  const ownerStarted = startedTelemetryOperation(
    records,
    "solid-native.owner",
    (record) => record.attributes["owner.name"] === "e2e.root",
  );
  const causalEvents = interactionRecords.filter(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event" &&
      commitStarted?.type === "operation-started" &&
      commitStarted.causes.includes(record.operationId),
  );
  const computations = interactionRecords.filter(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.computation" &&
      record.attributes["computation.name"] ===
        TEXT_INPUT_VALUE_COMPUTATION_NAME &&
      commitStarted?.type === "operation-started" &&
      commitStarted.causes.includes(record.operationId),
  );
  const mountStarted = startedTelemetryOperation(
    interactionRecords,
    "solid-native.mount",
    (record) =>
      record.attributes["commit.sequence"] === commitSequence &&
      record.attributes["mount.host_revision"] === hostRevision,
  );
  const frameStarted = startedTelemetryOperation(
    interactionRecords,
    "solid-native.frame",
    (record) =>
      record.attributes["commit.sequence"] === commitSequence &&
      record.attributes["frame.host_revision"] === hostRevision,
  );
  const commitFinished = finishedTelemetryOperation(
    interactionRecords,
    commitStarted?.operationId,
  );
  const computationFinished = finishedTelemetryOperation(
    interactionRecords,
    computations[0]?.operationId,
  );
  const mountFinished = finishedTelemetryOperation(
    interactionRecords,
    mountStarted?.operationId,
  );
  const frameFinished = finishedTelemetryOperation(
    interactionRecords,
    frameStarted?.operationId,
  );
  const causalEventSummary = causalEvents.map((record) => {
    const finished = finishedTelemetryOperation(
      interactionRecords,
      record.operationId,
    );
    return {
      name: record.attributes["event.name"],
      observedSequence: record.attributes["event.observed_sequence"],
      priority: record.attributes["event.priority"],
      handlerCount:
        finished?.type === "operation-finished"
          ? finished.attributes["event.handler_count"]
          : undefined,
      status:
        finished?.type === "operation-finished" ? finished.status : undefined,
    };
  });

  invariant(
    eventCount > 0 &&
      causalEvents.length >= eventCount &&
      new Set(causalEvents.map((record) => record.operationId)).size ===
        causalEvents.length,
    `The controlled TextInput expected at least ${String(eventCount)} unique causal change events but found ${String(causalEvents.length)}: ${JSON.stringify(causalEventSummary)}.`,
  );
  invariant(
    causalEvents.every((record) => {
      const finished = finishedTelemetryOperation(
        interactionRecords,
        record.operationId,
      );
      return (
        record.type === "operation-started" &&
        record.attributes["event.name"] === "changeText" &&
        record.attributes["event.priority"] === "discrete" &&
        record.attributes["event.observed_sequence"] === observedSequence &&
        finished?.type === "operation-finished" &&
        finished.status === "ok" &&
        finished.attributes["event.handler_count"] === 1
      );
    }),
    `The controlled TextInput commit retained invalid native change events: ${JSON.stringify(causalEventSummary)}.`,
  );
  invariant(
    commitStarted?.type === "operation-started" &&
      commitStarted.attributes["commit.priority"] === "user-blocking" &&
      ownerStarted?.type === "operation-started" &&
      commitStarted.causes.includes(ownerStarted.operationId) &&
      commitFinished?.type === "operation-finished" &&
      commitFinished.status === "ok" &&
      computations.length === 1 &&
      computations[0]?.type === "operation-started" &&
      computations[0].causes.includes(ownerStarted.operationId) &&
      computationFinished?.type === "operation-finished" &&
      computationFinished.status === "ok",
    "The controlled TextInput commit lost its Solid owner or value-output computation.",
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
    "Controlled TextInput did not preserve its commit-to-mount-to-frame chain.",
  );
  invariant(
    !JSON.stringify(interactionRecords).includes(TEXT_INPUT_VALUE),
    "Controlled TextInput telemetry retained private editor content.",
  );
  return causalEvents.length;
}

function verifyTextInputSelectionCommandCausality(
  records: readonly CausalTelemetryRecord[],
  interactionStart: number,
): number {
  const interactionRecords = records.slice(interactionStart);
  const ownerStarted = startedTelemetryOperation(
    records,
    "solid-native.owner",
    (record) => record.attributes["owner.name"] === "e2e.root",
  );
  const commands = interactionRecords.filter(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.command" &&
      record.attributes["command.name"] === "setTextAndSelection",
  );
  const commandStarted = commands[0];
  const computationStarted =
    commandStarted?.type === "operation-started"
      ? interactionRecords.find(
          (record) =>
            record.type === "operation-started" &&
            record.name === "solid-native.computation" &&
            record.attributes["computation.name"] ===
              TEXT_INPUT_VALUE_COMPUTATION_NAME &&
            commandStarted.causes.includes(record.operationId),
        )
      : undefined;
  const commandCommit =
    commandStarted?.type === "operation-started"
      ? interactionRecords.find(
          (record) =>
            record.type === "operation-started" &&
            record.name === "solid-native.commit" &&
            record.causes.length === 1 &&
            record.causes[0] === commandStarted.operationId,
        )
      : undefined;
  const commandFinished = finishedTelemetryOperation(
    interactionRecords,
    commandStarted?.operationId,
  );
  const computationFinished = finishedTelemetryOperation(
    interactionRecords,
    computationStarted?.operationId,
  );
  const commitFinished = finishedTelemetryOperation(
    interactionRecords,
    commandCommit?.operationId,
  );

  invariant(
    commands.length === 1 &&
      commandStarted?.type === "operation-started" &&
      commandStarted.causes.length === 1 &&
      commandFinished?.type === "operation-finished" &&
      commandFinished.status === "ok",
    "The controlled selection did not retain exactly one successful native command.",
  );
  invariant(
    ownerStarted?.type === "operation-started" &&
      computationStarted?.type === "operation-started" &&
      computationStarted.causes.includes(ownerStarted.operationId) &&
      computationFinished?.type === "operation-finished" &&
      computationFinished.status === "ok",
    "The controlled selection command lost its Solid owner or editor-output computation.",
  );
  invariant(
    commandCommit?.type === "operation-started" &&
      Number.isSafeInteger(commandCommit.attributes["commit.sequence"]) &&
      commandCommit.attributes["commit.priority"] === "normal" &&
      commandCommit.attributes["commit.mutation_count"] === 1 &&
      commandCommit.attributes["commit.mutation.command"] === 1 &&
      commitFinished?.type === "operation-finished" &&
      commitFinished.status === "ok",
    "The controlled selection command lost its isolated host commit.",
  );
  invariant(
    !JSON.stringify(interactionRecords).includes(TEXT_INPUT_CONTROLLED_VALUE),
    "Controlled selection telemetry retained private editor content.",
  );
  return commandCommit.attributes["commit.sequence"] as number;
}

function verifySwitchControlledCommandCausality(
  records: readonly CausalTelemetryRecord[],
  interactionStart: number,
  observedSequence: number,
): number {
  const interactionRecords = records.slice(interactionStart);
  const ownerStarted = startedTelemetryOperation(
    records,
    "solid-native.owner",
    (record) => record.attributes["owner.name"] === "e2e.root",
  );
  const eventStarted = startedTelemetryOperation(
    interactionRecords,
    "solid-native.event",
    (record) =>
      record.attributes["event.name"] === "valueChange" &&
      record.attributes["event.observed_sequence"] === observedSequence,
  );
  const computations = interactionRecords.filter(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.computation" &&
      record.attributes["computation.name"] ===
        SWITCH_CONTROLLED_COMPUTATION_NAME,
  );
  const commands = interactionRecords.filter(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.command" &&
      record.attributes["command.name"] === "setValue",
  );
  const computationStarted = computations[0];
  const commandStarted = commands[0];
  const commandCommit =
    commandStarted?.type === "operation-started"
      ? interactionRecords.find(
          (record) =>
            record.type === "operation-started" &&
            record.name === "solid-native.commit" &&
            record.causes.length === 1 &&
            record.causes[0] === commandStarted.operationId,
        )
      : undefined;
  const eventFinished = finishedTelemetryOperation(
    interactionRecords,
    eventStarted?.operationId,
  );
  const computationFinished = finishedTelemetryOperation(
    interactionRecords,
    computationStarted?.operationId,
  );
  const commandFinished = finishedTelemetryOperation(
    interactionRecords,
    commandStarted?.operationId,
  );
  const commitFinished = finishedTelemetryOperation(
    interactionRecords,
    commandCommit?.operationId,
  );

  invariant(
    eventStarted?.type === "operation-started" &&
      eventStarted.attributes["event.priority"] === "discrete" &&
      eventStarted.attributes["event.bubbles"] === true &&
      eventFinished?.type === "operation-finished" &&
      eventFinished.status === "ok" &&
      eventFinished.attributes["event.handler_count"] === 1,
    "The controlled Switch lost its exact native input operation.",
  );
  invariant(
    ownerStarted?.type === "operation-started" &&
      computations.length === 1 &&
      computationStarted?.type === "operation-started" &&
      computationStarted.causes.includes(ownerStarted.operationId) &&
      computationFinished?.type === "operation-finished" &&
      computationFinished.status === "ok",
    "The controlled Switch command lost its Solid owner or output computation.",
  );
  invariant(
    commands.length === 1 &&
      commandStarted?.type === "operation-started" &&
      commandStarted.causes.includes(eventStarted.operationId) &&
      commandStarted.causes.includes(computationStarted.operationId) &&
      commandStarted.causes.length === 2 &&
      commandFinished?.type === "operation-finished" &&
      commandFinished.status === "ok",
    "The controlled Switch did not retain one event-and-output-caused command.",
  );
  invariant(
    Object.keys(eventStarted.attributes).every(
      (name) =>
        PERMITTED_NATIVE_EVENT_START_ATTRIBUTES.has(name) ||
        name.startsWith("resource."),
    ) &&
      Object.keys(commandStarted.attributes).every(
        (name) =>
          PERMITTED_NATIVE_COMMAND_START_ATTRIBUTES.has(name) ||
          name.startsWith("resource."),
      ),
    "Controlled Switch telemetry retained native payload or command arguments.",
  );
  invariant(
    commandCommit?.type === "operation-started" &&
      Number.isSafeInteger(commandCommit.attributes["commit.sequence"]) &&
      commandCommit.attributes["commit.priority"] === "user-blocking" &&
      commandCommit.attributes["commit.mutation_count"] === 1 &&
      commandCommit.attributes["commit.mutation.command"] === 1 &&
      commitFinished?.type === "operation-finished" &&
      commitFinished.status === "ok" &&
      !("commit.host_revision" in commitFinished.attributes) &&
      !interactionRecords.some(
        (record) =>
          record.type === "operation-started" &&
          (record.name === "solid-native.mount" ||
            record.name === "solid-native.frame") &&
          record.attributes["commit.sequence"] ===
            commandCommit.attributes["commit.sequence"],
      ),
    "The controlled Switch command lost its isolated non-mounting commit.",
  );
  return commandCommit.attributes["commit.sequence"] as number;
}

function verifySwitchMeasurementCausality(
  records: readonly CausalTelemetryRecord[],
  interactionStart: number,
  observedSequence: number,
): void {
  const interactionRecords = records.slice(interactionStart);
  const ownerStarted = startedTelemetryOperation(
    records,
    "solid-native.owner",
    (record) => record.attributes["owner.name"] === "e2e.root",
  );
  const computations = interactionRecords.filter(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.computation" &&
      record.attributes["computation.name"] ===
        SWITCH_CONTROLLED_COMPUTATION_NAME,
  );
  const measurements = interactionRecords.filter(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.measure",
  );
  const computationStarted = computations[0];
  const measurementStarted = measurements[0];
  const computationFinished = finishedTelemetryOperation(
    interactionRecords,
    computationStarted?.operationId,
  );
  const measurementFinished = finishedTelemetryOperation(
    interactionRecords,
    measurementStarted?.operationId,
  );

  invariant(
    ownerStarted?.type === "operation-started" &&
      computations.length === 1 &&
      computationStarted?.type === "operation-started" &&
      computationStarted.causes.includes(ownerStarted.operationId) &&
      computationFinished?.type === "operation-finished" &&
      computationFinished.status === "ok",
    "The controlled Switch measurement lost its Solid owner or output computation.",
  );
  invariant(
    measurements.length === 1 &&
      measurementStarted?.type === "operation-started" &&
      measurementStarted.causes.length === 1 &&
      measurementStarted.causes[0] === computationStarted.operationId &&
      measurementFinished?.type === "operation-finished" &&
      measurementFinished.status === "ok" &&
      measurementFinished.attributes["measurement.observed_sequence"] ===
        observedSequence,
    "The controlled Switch measurement lost its named-output cause or observed sequence.",
  );
  invariant(
    Object.keys(measurementStarted.attributes).every(
      (name) =>
        PERMITTED_MEASUREMENT_START_ATTRIBUTES.has(name) ||
        name.startsWith("resource."),
    ) &&
      Object.keys(measurementFinished.attributes).every(
        (name) =>
          PERMITTED_MEASUREMENT_FINISH_ATTRIBUTES.has(name) ||
          name.startsWith("resource."),
      ),
    "Controlled Switch measurement telemetry retained native geometry.",
  );
}

async function verifyModalLifecycleCausality(
  records: readonly CausalTelemetryRecord[],
  interactionStart: number,
  mountEvents: Map<number, HostCommitMountedEvent>,
  frameEvents: Map<number, HostCommitFrameEvent>,
  eventName: "press" | "show" | "requestClose" | "dismiss",
  observedSequence: number,
  eventPriority: "default" | "discrete",
  commitPriority: "normal" | "user-blocking",
): Promise<number> {
  const interactionRecords = records.slice(interactionStart);
  const ownerStarted = startedTelemetryOperation(
    records,
    "solid-native.owner",
    (record) => record.attributes["owner.name"] === "e2e.root",
  );
  const eventStarted = startedTelemetryOperation(
    interactionRecords,
    "solid-native.event",
    (record) =>
      record.attributes["event.name"] === eventName &&
      record.attributes["event.observed_sequence"] === observedSequence,
  );
  const eventFinished = finishedTelemetryOperation(
    interactionRecords,
    eventStarted?.operationId,
  );
  const commits = interactionRecords.filter(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.commit" &&
      eventStarted?.type === "operation-started" &&
      record.causes.includes(eventStarted.operationId),
  );
  const commitStarted = commits[0];
  const computations = interactionRecords.filter(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.computation" &&
      record.attributes["computation.name"] ===
        MODAL_LIFECYCLE_COMPUTATION_NAME &&
      commitStarted?.type === "operation-started" &&
      commitStarted.causes.includes(record.operationId),
  );
  const commitFinished = finishedTelemetryOperation(
    interactionRecords,
    commitStarted?.operationId,
  );
  const commitSequence = commitStarted?.attributes["commit.sequence"];
  const hostRevision = commitFinished?.attributes["commit.host_revision"];

  invariant(
    eventStarted?.type === "operation-started" &&
      eventStarted.attributes["event.priority"] === eventPriority &&
      eventStarted.attributes["event.bubbles"] === (eventName === "press") &&
      eventFinished?.type === "operation-finished" &&
      eventFinished.status === "ok" &&
      eventFinished.attributes["event.handler_count"] === 1,
    `The native Modal ${eventName} operation had invalid telemetry.`,
  );
  invariant(
    Object.keys(eventStarted.attributes).every(
      (name) =>
        PERMITTED_NATIVE_EVENT_START_ATTRIBUTES.has(name) ||
        name.startsWith("resource."),
    ),
    `Native Modal ${eventName} telemetry retained its event payload.`,
  );
  invariant(
    commits.length === 1 &&
      commitStarted?.type === "operation-started" &&
      commitStarted.attributes["commit.priority"] === commitPriority &&
      Number.isSafeInteger(commitSequence) &&
      typeof commitStarted.attributes["commit.mutation_count"] === "number" &&
      commitStarted.attributes["commit.mutation_count"] > 0 &&
      ownerStarted?.type === "operation-started" &&
      commitStarted.causes.includes(ownerStarted.operationId) &&
      commitFinished?.type === "operation-finished" &&
      commitFinished.status === "ok" &&
      Number.isSafeInteger(hostRevision),
    `The native Modal ${eventName} operation lost its exact Solid/Fabric commit.`,
  );
  invariant(
    computations.length > 0 &&
      computations.every((record) => {
        const finished = finishedTelemetryOperation(
          interactionRecords,
          record.operationId,
        );
        return (
          record.type === "operation-started" &&
          record.causes.includes(ownerStarted.operationId) &&
          finished?.type === "operation-finished" &&
          finished.status === "ok"
        );
      }),
    `The native Modal ${eventName} commit lost its lifecycle-output computation.`,
  );

  const sequence = commitSequence as number;
  const revision = hostRevision as number;
  await waitForMount(mountEvents, sequence);
  await waitForFrame(frameEvents, sequence);
  const lifecycleRecords = records.slice(interactionStart);
  const mountStarted = startedTelemetryOperation(
    lifecycleRecords,
    "solid-native.mount",
    (record) =>
      record.attributes["commit.sequence"] === sequence &&
      record.attributes["mount.host_revision"] === revision,
  );
  const frameStarted = startedTelemetryOperation(
    lifecycleRecords,
    "solid-native.frame",
    (record) =>
      record.attributes["commit.sequence"] === sequence &&
      record.attributes["frame.host_revision"] === revision,
  );
  const mountFinished = finishedTelemetryOperation(
    lifecycleRecords,
    mountStarted?.operationId,
  );
  const frameFinished = finishedTelemetryOperation(
    lifecycleRecords,
    frameStarted?.operationId,
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
    `The native Modal ${eventName} commit lost its mount-to-frame chain.`,
  );
  return sequence;
}

function verifyTextInputSelectionInsertionCausality(
  records: readonly CausalTelemetryRecord[],
  interactionStart: number,
  observedSequence: number,
  commitSequence: number,
  hostRevision: number,
): {
  readonly observedChangeEvents: number;
  readonly causalChangeEvents: number;
  readonly selectionEvents: number;
} {
  const interactionRecords = records.slice(interactionStart);
  const ownerStarted = startedTelemetryOperation(
    records,
    "solid-native.owner",
    (record) => record.attributes["owner.name"] === "e2e.root",
  );
  const commitStarted = startedTelemetryOperation(
    interactionRecords,
    "solid-native.commit",
    (record) => record.attributes["commit.sequence"] === commitSequence,
  );
  const eventStarted = interactionRecords.filter(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event",
  );
  const changeEvents = eventStarted.filter(
    (record) => record.attributes["event.name"] === "changeText",
  );
  const selectionEvents = eventStarted.filter(
    (record) => record.attributes["event.name"] === "selectionChange",
  );
  const commitCauseIds =
    commitStarted?.type === "operation-started" ? commitStarted.causes : [];
  const causedEvents = eventStarted.filter((record) =>
    commitCauseIds.includes(record.operationId),
  );
  const computations = interactionRecords.filter(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.computation" &&
      record.attributes["computation.name"] ===
        TEXT_INPUT_VALUE_COMPUTATION_NAME &&
      commitCauseIds.includes(record.operationId),
  );
  const mountStarted = startedTelemetryOperation(
    interactionRecords,
    "solid-native.mount",
    (record) =>
      record.attributes["commit.sequence"] === commitSequence &&
      record.attributes["mount.host_revision"] === hostRevision,
  );
  const frameStarted = startedTelemetryOperation(
    interactionRecords,
    "solid-native.frame",
    (record) =>
      record.attributes["commit.sequence"] === commitSequence &&
      record.attributes["frame.host_revision"] === hostRevision,
  );
  const successfulEvent = (record: CausalTelemetryRecord): boolean => {
    const finished = finishedTelemetryOperation(
      interactionRecords,
      record.operationId,
    );
    return (
      finished?.type === "operation-finished" &&
      finished.status === "ok" &&
      finished.attributes["event.handler_count"] === 1
    );
  };
  const computationFinished = finishedTelemetryOperation(
    interactionRecords,
    computations[0]?.operationId,
  );
  const commitFinished = finishedTelemetryOperation(
    interactionRecords,
    commitStarted?.operationId,
  );
  const mountFinished = finishedTelemetryOperation(
    interactionRecords,
    mountStarted?.operationId,
  );
  const frameFinished = finishedTelemetryOperation(
    interactionRecords,
    frameStarted?.operationId,
  );
  const eventSummary = eventStarted.map((record) => ({
    name: record.attributes["event.name"],
    observedSequence: record.attributes["event.observed_sequence"],
    priority: record.attributes["event.priority"],
    caused: commitCauseIds.includes(record.operationId),
    successful: successfulEvent(record),
  }));

  invariant(
    causedEvents.length > 0 &&
      causedEvents.length <= changeEvents.length &&
      causedEvents.every((record) => changeEvents.includes(record)) &&
      changeEvents.every(
        (record) =>
          record.attributes["event.priority"] === "discrete" &&
          record.attributes["event.observed_sequence"] === observedSequence &&
          successfulEvent(record),
      ),
    `The physical selection insertion lost its direct change-event causes: ${JSON.stringify(eventSummary)}.`,
  );
  invariant(
    selectionEvents.length > 0 &&
      selectionEvents.every(
        (record) =>
          record.attributes["event.priority"] === "default" &&
          record.attributes["event.observed_sequence"] === observedSequence &&
          successfulEvent(record) &&
          !commitCauseIds.includes(record.operationId),
      ),
    `The physical selection insertion lost its successful selection observations: ${JSON.stringify(eventSummary)}.`,
  );
  invariant(
    commitStarted?.type === "operation-started" &&
      commitStarted.attributes["commit.priority"] === "user-blocking" &&
      ownerStarted?.type === "operation-started" &&
      commitStarted.causes.includes(ownerStarted.operationId) &&
      commitFinished?.type === "operation-finished" &&
      commitFinished.status === "ok" &&
      computations.length === 1 &&
      computations[0]?.type === "operation-started" &&
      computations[0].causes.includes(ownerStarted.operationId) &&
      computationFinished?.type === "operation-finished" &&
      computationFinished.status === "ok",
    "The physical selection insertion lost its owner or editor-output computation.",
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
    "Selection insertion did not preserve its commit-to-mount-to-frame chain.",
  );
  const serializedRecords = JSON.stringify(interactionRecords);
  invariant(
    !serializedRecords.includes(TEXT_INPUT_SELECTION_VALUE) &&
      !serializedRecords.includes(TEXT_INPUT_CONTROLLED_VALUE),
    "Selection insertion telemetry retained private editor content.",
  );
  return {
    observedChangeEvents: changeEvents.length,
    causalChangeEvents: causedEvents.length,
    selectionEvents: selectionEvents.length,
  };
}

function verifyTextInputSubmitCausality(
  records: readonly CausalTelemetryRecord[],
  interactionStart: number,
  observedSequence: number,
  commitSequence: number,
  hostRevision: number,
): void {
  const interactionRecords = records.slice(interactionStart);
  const ownerStarted = startedTelemetryOperation(
    records,
    "solid-native.owner",
    (record) => record.attributes["owner.name"] === "e2e.root",
  );
  const commitStarted = startedTelemetryOperation(
    interactionRecords,
    "solid-native.commit",
    (record) => record.attributes["commit.sequence"] === commitSequence,
  );
  const submitStarted = startedTelemetryOperation(
    interactionRecords,
    "solid-native.event",
    (record) =>
      record.attributes["event.name"] === "submitEditing" &&
      record.attributes["event.observed_sequence"] === observedSequence,
  );
  const blurStarted = startedTelemetryOperation(
    interactionRecords,
    "solid-native.event",
    (record) =>
      record.attributes["event.name"] === "blur" &&
      record.attributes["event.observed_sequence"] === observedSequence,
  );
  const computations = interactionRecords.filter(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.computation" &&
      record.attributes["computation.name"] ===
        TEXT_INPUT_SUBMIT_COMPUTATION_NAME &&
      commitStarted?.type === "operation-started" &&
      commitStarted.causes.includes(record.operationId),
  );
  const mountStarted = startedTelemetryOperation(
    interactionRecords,
    "solid-native.mount",
    (record) =>
      record.attributes["commit.sequence"] === commitSequence &&
      record.attributes["mount.host_revision"] === hostRevision,
  );
  const frameStarted = startedTelemetryOperation(
    interactionRecords,
    "solid-native.frame",
    (record) =>
      record.attributes["commit.sequence"] === commitSequence &&
      record.attributes["frame.host_revision"] === hostRevision,
  );
  const submitFinished = finishedTelemetryOperation(
    interactionRecords,
    submitStarted?.operationId,
  );
  const blurFinished = finishedTelemetryOperation(
    interactionRecords,
    blurStarted?.operationId,
  );
  const computationFinished = finishedTelemetryOperation(
    interactionRecords,
    computations[0]?.operationId,
  );
  const commitFinished = finishedTelemetryOperation(
    interactionRecords,
    commitStarted?.operationId,
  );
  const mountFinished = finishedTelemetryOperation(
    interactionRecords,
    mountStarted?.operationId,
  );
  const frameFinished = finishedTelemetryOperation(
    interactionRecords,
    frameStarted?.operationId,
  );

  invariant(
    submitStarted?.type === "operation-started" &&
      submitStarted.attributes["event.priority"] === "discrete" &&
      submitFinished?.type === "operation-finished" &&
      submitFinished.status === "ok" &&
      submitFinished.attributes["event.handler_count"] === 1 &&
      blurStarted?.type === "operation-started" &&
      blurStarted.attributes["event.priority"] === "default" &&
      blurFinished?.type === "operation-finished" &&
      blurFinished.status === "ok" &&
      blurFinished.attributes["event.handler_count"] === 1,
    "The native submit/blur pair did not preserve its direct event operations.",
  );
  invariant(
    commitStarted?.type === "operation-started" &&
      commitStarted.attributes["commit.priority"] === "user-blocking" &&
      commitStarted.causes.includes(submitStarted.operationId) &&
      !commitStarted.causes.includes(blurStarted.operationId) &&
      ownerStarted?.type === "operation-started" &&
      commitStarted.causes.includes(ownerStarted.operationId) &&
      commitFinished?.type === "operation-finished" &&
      commitFinished.status === "ok" &&
      computations.length === 1 &&
      computations[0]?.type === "operation-started" &&
      computations[0].causes.includes(ownerStarted.operationId) &&
      computationFinished?.type === "operation-finished" &&
      computationFinished.status === "ok",
    "The submit status commit lost its native event, owner, or Solid computation.",
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
    "TextInput submit did not preserve its commit-to-mount-to-frame chain.",
  );
  invariant(
    !JSON.stringify(interactionRecords).includes(TEXT_INPUT_CONTROLLED_VALUE),
    "TextInput submit telemetry retained private editor content.",
  );
}

function verifyMultilineTextInputCausality(
  records: readonly CausalTelemetryRecord[],
  interactionStart: number,
  observedSequence: number,
  commitSequence: number,
  hostRevision: number,
): {
  readonly observedChangeEvents: number;
  readonly causalChangeEvents: number;
  readonly keyEvents: number;
  readonly sizeEvents: number;
} {
  const interactionRecords = records.slice(interactionStart);
  const ownerStarted = startedTelemetryOperation(
    records,
    "solid-native.owner",
    (record) => record.attributes["owner.name"] === "e2e.root",
  );
  const commitStarted = startedTelemetryOperation(
    interactionRecords,
    "solid-native.commit",
    (record) => record.attributes["commit.sequence"] === commitSequence,
  );
  const eventStarted = interactionRecords.filter(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.event",
  );
  const changeEvents = eventStarted.filter(
    (record) => record.attributes["event.name"] === "changeText",
  );
  const keyEvents = eventStarted.filter(
    (record) => record.attributes["event.name"] === "keyPress",
  );
  const sizeEvents = eventStarted.filter(
    (record) => record.attributes["event.name"] === "contentSizeChange",
  );
  const commitCauseIds =
    commitStarted?.type === "operation-started" ? commitStarted.causes : [];
  const causedEvents = eventStarted.filter((record) =>
    commitCauseIds.includes(record.operationId),
  );
  const computations = interactionRecords.filter(
    (record) =>
      record.type === "operation-started" &&
      record.name === "solid-native.computation" &&
      record.attributes["computation.name"] ===
        MULTILINE_TEXT_INPUT_COMPUTATION_NAME &&
      commitStarted?.type === "operation-started" &&
      commitStarted.causes.includes(record.operationId),
  );
  const mountStarted = startedTelemetryOperation(
    interactionRecords,
    "solid-native.mount",
    (record) =>
      record.attributes["commit.sequence"] === commitSequence &&
      record.attributes["mount.host_revision"] === hostRevision,
  );
  const frameStarted = startedTelemetryOperation(
    interactionRecords,
    "solid-native.frame",
    (record) =>
      record.attributes["commit.sequence"] === commitSequence &&
      record.attributes["frame.host_revision"] === hostRevision,
  );
  const computationFinished = finishedTelemetryOperation(
    interactionRecords,
    computations[0]?.operationId,
  );
  const commitFinished = finishedTelemetryOperation(
    interactionRecords,
    commitStarted?.operationId,
  );
  const mountFinished = finishedTelemetryOperation(
    interactionRecords,
    mountStarted?.operationId,
  );
  const frameFinished = finishedTelemetryOperation(
    interactionRecords,
    frameStarted?.operationId,
  );
  const successfulEvent = (record: CausalTelemetryRecord): boolean => {
    const finished = finishedTelemetryOperation(
      interactionRecords,
      record.operationId,
    );
    return (
      finished?.type === "operation-finished" &&
      finished.status === "ok" &&
      finished.attributes["event.handler_count"] === 1
    );
  };
  const eventSummary = eventStarted.map((record) => {
    const finished = finishedTelemetryOperation(
      interactionRecords,
      record.operationId,
    );
    return {
      name: record.attributes["event.name"],
      observedSequence: record.attributes["event.observed_sequence"],
      priority: record.attributes["event.priority"],
      caused: commitCauseIds.includes(record.operationId),
      handlerCount:
        finished?.type === "operation-finished"
          ? finished.attributes["event.handler_count"]
          : undefined,
      status:
        finished?.type === "operation-finished" ? finished.status : undefined,
    };
  });

  invariant(
    changeEvents.length > 0 &&
      causedEvents.length > 0 &&
      causedEvents.length <= changeEvents.length &&
      causedEvents.every((record) => changeEvents.includes(record)) &&
      changeEvents.every(
        (record) =>
          record.attributes["event.priority"] === "discrete" &&
          record.attributes["event.observed_sequence"] === observedSequence &&
          successfulEvent(record),
      ),
    `The multiline value commit did not retain its successful direct change events: ${JSON.stringify(eventSummary)}.`,
  );
  invariant(
    keyEvents.length > 0 &&
      keyEvents.every(
        (record) =>
          record.attributes["event.priority"] === "discrete" &&
          record.attributes["event.observed_sequence"] === observedSequence &&
          successfulEvent(record) &&
          !commitCauseIds.includes(record.operationId),
      ),
    "The multiline key path lost its successful bubbling event boundary.",
  );
  invariant(
    sizeEvents.length > 0 &&
      sizeEvents.every((record) => {
        const sizeObservedSequence =
          record.attributes["event.observed_sequence"];
        return (
          record.attributes["event.priority"] === "default" &&
          (sizeObservedSequence === observedSequence ||
            sizeObservedSequence === commitSequence) &&
          successfulEvent(record) &&
          !commitCauseIds.includes(record.operationId)
        );
      }),
    `The multiline value path lost its successful intrinsic-size observation: ${JSON.stringify(eventSummary)}.`,
  );
  invariant(
    commitStarted?.type === "operation-started" &&
      commitStarted.attributes["commit.priority"] === "user-blocking" &&
      ownerStarted?.type === "operation-started" &&
      commitStarted.causes.includes(ownerStarted.operationId) &&
      commitFinished?.type === "operation-finished" &&
      commitFinished.status === "ok" &&
      computations.length === 1 &&
      computations[0]?.type === "operation-started" &&
      computations[0].causes.includes(ownerStarted.operationId) &&
      computationFinished?.type === "operation-finished" &&
      computationFinished.status === "ok",
    "The multiline value commit lost its Solid owner or value-output computation.",
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
    "Multiline input did not preserve its commit-to-mount-to-frame chain.",
  );
  invariant(
    !JSON.stringify(interactionRecords).includes(MULTILINE_TEXT_INPUT_VALUE),
    "Multiline input telemetry retained private editor content.",
  );
  return {
    observedChangeEvents: changeEvents.length,
    causalChangeEvents: causedEvents.length,
    keyEvents: keyEvents.length,
    sizeEvents: sizeEvents.length,
  };
}

function reportFatal(error: unknown): void {
  console.error("SOLID_NATIVE_E2E_FAILED", error);
  setTimeout(() => {
    throw error instanceof Error ? error : new Error(String(error));
  });
}

function proveTurboModuleRuntime(): "android" | "ios" {
  const asyncStorageInput = SOLID_NATIVE_BINDING_MANIFEST.inputs.find(
    (input) =>
      input.packageName === "@react-native-async-storage/async-storage",
  );
  const notifyKitInput = SOLID_NATIVE_BINDING_MANIFEST.inputs.find(
    (input) => input.packageName === "react-native-notify-kit",
  );
  invariant(
    Object.isFrozen(RNAsyncStorageNativeModuleDescriptor) &&
      RNAsyncStorageNativeModuleDescriptor.unknownValueMembers.includes(
        "legacy_multiGet",
      ) &&
      Object.isFrozen(SOLID_NATIVE_BINDING_MANIFEST) &&
      Object.isFrozen(SOLID_NATIVE_BINDING_MANIFEST.inputs) &&
      SOLID_NATIVE_BINDING_MANIFEST.inputs.every((input) =>
        Object.isFrozen(input),
      ) &&
      SOLID_NATIVE_BINDING_MANIFEST.schemaVersion === 0 &&
      /^[a-f0-9]{64}$/u.test(SOLID_NATIVE_BINDING_MANIFEST.bindingSha256) &&
      asyncStorageInput?.packageVersion === "3.1.1" &&
      !("sourcePath" in asyncStorageInput) &&
      Object.isFrozen(NotifeeApiModuleNativeModuleDescriptor) &&
      NotifeeApiModuleNativeModuleDescriptor.requiredMethods.length === 48 &&
      NotifeeApiModuleNativeModuleDescriptor.unknownValueMembers.length ===
        19 &&
      NotifeeApiModuleNativeModuleDescriptor.unknownValueMembers.includes(
        "displayNotification",
      ) &&
      notifyKitInput?.packageVersion === "10.5.0" &&
      !("sourcePath" in notifyKitInput),
    "The generated dependency ABI or portable binding provenance drifted.",
  );
  console.log("SOLID_NATIVE_GENERATED_TURBOMODULE_SCHEMA_SUCCEEDED");
  console.log("SOLID_NATIVE_TURBOMODULE_SUCCEEDED");
  return NativePlatform.platform;
}

function proveGeneratedStorageTurboModuleRuntime(): void {
  const storageModule = resolveRNAsyncStorageNativeModule(TurboModuleRegistry);
  invariant(
    storageModule !== null,
    "The generated AsyncStorage TurboModule binding did not resolve.",
  );
  console.log("SOLID_NATIVE_GENERATED_TURBOMODULE_SUCCEEDED");
}

async function proveAsyncTurboModuleRuntime(): Promise<string | null> {
  const initialURL = await NativePlatform.getInitialURL();
  console.log("SOLID_NATIVE_TURBOMODULE_ASYNC_SUCCEEDED");
  return initialURL;
}

async function proveStorageTurboModule(
  storage: KeyValueStorage,
): Promise<void> {
  const value = JSON.stringify({ runtime: "solid-native", version: 1 });
  await storage.removeItem(STORAGE_PROOF_KEY);
  invariant(
    (await storage.getItem(STORAGE_PROOF_KEY)) === null,
    "The native storage module did not remove its proof value.",
  );
  await storage.setItem(STORAGE_PROOF_KEY, value);
  invariant(
    (await storage.getItem(STORAGE_PROOF_KEY)) === value,
    "The native storage module did not round-trip its proof value.",
  );
  await storage.removeItem(STORAGE_PROOF_KEY);
  invariant(
    (await storage.getItem(STORAGE_PROOF_KEY)) === null,
    "The native storage module retained its removed proof value.",
  );
  console.log("SOLID_NATIVE_STORAGE_MODULE_SUCCEEDED");
}

function resolveNavigationURL(
  url: string,
): { readonly href: string; readonly state: HostValue } | undefined {
  if (url !== DEEP_LINK_URL) return undefined;
  return { href: "/deep-link", state: { url } };
}

async function waitForAppStateProof(observed: Promise<void>): Promise<void> {
  await Promise.race([
    observed,
    delay(PROOF_TIMEOUT_MS).then(() => {
      throw new Error(
        "The AppState TurboModule event did not produce its mounted proof before the press.",
      );
    }),
  ]);
}

async function run(): Promise<void> {
  const binding = getNativeHostBinding();
  await waitForNativeSurface({ binding, timeoutMs: PROOF_TIMEOUT_MS });
  const nativePlatform = proveTurboModuleRuntime();
  invariant(
    binding.platform === nativePlatform,
    "The JSI host platform disagrees with PlatformConstants.",
  );
  const initialURL = await proveAsyncTurboModuleRuntime();
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
  invariant(telemetry !== undefined, "The E2E telemetry session was rejected.");

  const host = createNativeFabricHost({
    binding,
    descriptors: [
      ...CORE_COMPONENT_DESCRIPTORS,
      GENERATED_VIEW_DESCRIPTOR,
      CAMERA_PREVIEW_DESCRIPTOR,
    ],
  });
  const mountEvents = new Map<number, HostCommitMountedEvent>();
  const frameEvents = new Map<number, HostCommitFrameEvent>();
  const screenLifecycleEvents: NavigationScreenLifecycle[] = [];
  const [status, setStatus] = createSignal(READY_TEXT);
  const [imageStatus, setImageStatus] = createSignal(IMAGE_PENDING_TEXT);
  const [scrollStatus, setScrollStatus] = createSignal(SCROLL_PENDING_TEXT);
  const [textInputValue, setTextInputValue] = createSignal("");
  const [textInputReady, setTextInputReady] = createSignal(false);
  const [textInputSelection, setTextInputSelection] = createSignal<
    { readonly start: number; readonly end: number } | undefined
  >(undefined);
  const [textInputSelectionStatus, setTextInputSelectionStatus] = createSignal(
    TEXT_INPUT_SELECTION_PENDING_TEXT,
  );
  const [textInputSubmitStatus, setTextInputSubmitStatus] = createSignal(
    TEXT_INPUT_SUBMIT_PENDING_TEXT,
  );
  const [multilineTextInputReady, setMultilineTextInputReady] =
    createSignal(false);
  const [multilineTextInputValue, setMultilineTextInputValue] =
    createSignal("");
  const [multilineTextInputStatus, setMultilineTextInputStatus] = createSignal(
    MULTILINE_TEXT_INPUT_PENDING_TEXT,
  );
  const [switchStatus, setSwitchStatus] = createSignal(SWITCH_PENDING_TEXT);
  const [modalVisible, setModalVisible] = createSignal(false);
  const [modalStatus, setModalStatus] = createSignal(MODAL_PENDING_TEXT);
  const [modalHandoffReady, setModalHandoffReady] = createSignal(false);
  const [cameraSessionRequested, setCameraSessionRequested] =
    createSignal(false);
  const [cameraPreviewSession, setCameraPreviewSession] =
    createSignal<CameraSession>();
  const [cameraPreviewComponent, setCameraPreviewComponent] =
    createSignal<CameraPreviewComponent>();
  const [cameraCaptureStatus, setCameraCaptureStatus] = createSignal<string>();
  const [cameraSessionStatus, setCameraSessionStatus] = createSignal(
    CAMERA_SESSION_PENDING_TEXT,
  );
  const [notificationService, setNotificationService] =
    createSignal<NotificationService>();
  const [notificationStatus, setNotificationStatus] = createSignal(
    NOTIFICATION_PENDING_TEXT,
  );
  // The exhaustive application has dedicated process-restoration targets.
  // Keep this interactive shell independent of persistent storage until its
  // explicit intensive-proof gate so an unattended iPhone launch remains
  // quiescent.
  const launch = createNativeHistoryFromLaunch({
    initialHref: "/",
    initialURL,
    resolveDeepLink: resolveNavigationURL,
  });
  const navigation = launch.history;
  const routerHistory = createTanStackNativeHistory(navigation, {
    onNavigationError: reportFatal,
  });
  let renderPhysicalRoute: (() => NativeNode) | undefined;
  const PhysicalRouteComponent = (): NativeNode => {
    const render = renderPhysicalRoute;
    invariant(
      render !== undefined,
      "The physical TanStack route renderer was not installed before mount.",
    );
    return render();
  };
  const rootRoute = new TanStackRootRoute({
    component: TanStackNativeOutlet,
  });
  const homeRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    loader: () => ({ proof: "home" }),
    component: PhysicalRouteComponent,
  });
  const detailRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/detail",
    loader: () => ({ proof: "detail" }),
    component: PhysicalRouteComponent,
  });
  const deepLinkRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/deep-link",
    loader: () => ({ proof: "deep-link" }),
    component: PhysicalRouteComponent,
  });
  const routeTree = rootRoute.addChildren([
    homeRoute,
    detailRoute,
    deepLinkRoute,
  ]);
  const navigationRouter = createTanStackNativeRouter({
    routeTree,
    history: routerHistory,
    isServer: false,
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
  });
  await navigationRouter.load();
  const waitForRouterLocation = async (pathname: string): Promise<void> => {
    // The provider owns router loads for native-history updates. Observe that
    // publication instead of initiating a duplicate load from the proof.
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        navigationRouter.state.status === "idle" &&
        navigationRouter.state.location.pathname === pathname
      ) {
        return;
      }
      await Promise.resolve();
    }
    throw new Error(`TanStack Router did not settle ${pathname}.`);
  };
  let blockNextAndroidPlatformBack = NativePlatform.platform === "android";
  let removeAndroidPlatformBackBlocker: (() => void) | undefined;
  if (blockNextAndroidPlatformBack) {
    removeAndroidPlatformBackBlocker = routerHistory.block({
      blockerFn({ action, currentLocation, nextLocation }) {
        if (
          action !== "BACK" ||
          currentLocation.pathname !== "/detail" ||
          nextLocation.pathname !== "/"
        ) {
          return false;
        }
        if (blockNextAndroidPlatformBack) {
          blockNextAndroidPlatformBack = false;
          console.log("SOLID_NATIVE_NAVIGATION_BLOCKED_BACK_SUCCEEDED");
          return true;
        }
        removeAndroidPlatformBackBlocker?.();
        removeAndroidPlatformBackBlocker = undefined;
        console.log("SOLID_NATIVE_NAVIGATION_BLOCKER_RELEASE_SUCCEEDED");
        return false;
      },
    });
  }
  const coldStart = launch.source === "deep-link";
  let proofCommitOffset = 0;
  const proofSequence = (sequence: number): number =>
    sequence + (coldStart ? 1 : 0) + proofCommitOffset;
  let application: NativeApplication | undefined;
  let nativeNotifications: NotificationService | undefined;
  let nativeNotificationsPromise: Promise<NotificationService> | undefined;
  let nativeCamera: CameraService | undefined;
  let nativeCameraPromise: Promise<CameraService> | undefined;
  let nativeStorage: KeyValueStorage | undefined;
  let nativeStoragePromise: Promise<KeyValueStorage> | undefined;
  let ownedCameraSession: OwnedCameraSession | undefined;
  let navigationPersistence: NativeHistoryPersistence | undefined;
  let generatedView: NativeNode | undefined;
  let activityIndicator: NativeNode | undefined;
  let image: NativeNode | undefined;
  let pressable: NativeNode | undefined;
  let scrollView: ScrollViewHandle | undefined;
  let textInput: NativeNode | undefined;
  let multilineTextInput: NativeNode | undefined;
  let nativeSwitch: NativeNode | undefined;
  let navigationDetail: NativeNode | undefined;
  let deepLinkDetail: NativeNode | undefined;
  const activeNavigationFocusScopes = new Set<string>();
  let navigationFocusScopeSetups = 0;
  let navigationFocusScopeCleanups = 0;
  let validatedNavigationCausalInteractions = 0;
  let pressHandled = false;
  let resourceProofStartHandled = false;
  let resourceProofWatchdog: ReturnType<typeof setTimeout> | undefined;
  let appStateProofArmed = false;
  let imageHandled = false;
  let scrollHandled = false;
  let imageLoadScope: NativeCausalScope | undefined;
  let scrollEventScope: NativeCausalScope | undefined;
  let textInputFocused = false;
  let textInputHandled = false;
  let textInputSelectionArmed = false;
  let textInputSelectionObserved = false;
  let textInputSelectionInserted = false;
  let textInputSubmitted = false;
  let textInputBlurred = false;
  let textInputChangeCount = 0;
  let textInputRawChangeCount = 0;
  let textInputNativeEventCount = -1;
  let multilineTextInputFocused = false;
  let multilineTextInputProofActive = false;
  let multilineTextInputEnterPressed = false;
  let multilineTextInputSubmitted = false;
  let multilineTextInputBlurred = false;
  let switchChangeObserved = false;
  let switchValueObserved = false;
  let switchObservedSequence = -1;
  let modalShowObserved = false;
  let modalRequestCloseObserved = false;
  let modalDismissObserved = false;
  let modalPresentationObservedSequence = -1;
  let modalShowObservedSequence = -1;
  let modalRequestCloseObservedSequence = -1;
  let modalDismissalRequestObservedSequence = -1;
  let modalDismissObservedSequence = -1;
  let multilineContentSizeEventCount = 0;
  let multilineMinimumContentHeight: number | undefined;
  let multilineMaximumContentHeight: number | undefined;
  let unsubscribeLifecycle: (() => void) | undefined;
  let resolveAppStateCommit: (() => void) | undefined;
  let resolveResourceProofStart: (() => void) | undefined;
  let resolveAsyncContent: ((value: string) => void) | undefined;
  let resolveImageEvent: (() => void) | undefined;
  let resolveScrollEvent: (() => void) | undefined;
  let resolveTextInputEvent: (() => void) | undefined;
  let resolveTextInputSelection: (() => void) | undefined;
  let resolveTextInputSelectionInsertion: (() => void) | undefined;
  let resolveTextInputSubmit: (() => void) | undefined;
  let resolveTextInputBlur: (() => void) | undefined;
  let resolveKeyboardShown: (() => void) | undefined;
  let resolveKeyboardHidden: (() => void) | undefined;
  let resolveMultilineTextInputValue: (() => void) | undefined;
  let resolveMultilineInitialContentSize: (() => void) | undefined;
  let resolveMultilineContentGrowth: (() => void) | undefined;
  let resolveSwitchChange: (() => void) | undefined;
  let resolveSwitchValue: (() => void) | undefined;
  let resolveModalShow: (() => void) | undefined;
  let resolveModalRequestClose: (() => void) | undefined;
  let resolveModalDismiss: (() => void) | undefined;
  let resolveModalPresentationRequest: (() => void) | undefined;
  let resolveModalDismissalRequest: (() => void) | undefined;
  let resolveNotificationDelivery: (() => void) | undefined;
  let resolveNotificationPress: (() => void) | undefined;
  let resolveCameraSessionOwner:
    ((session: OwnedCameraSession) => void) | undefined;
  let resolveCameraSessionStarted: (() => void) | undefined;
  let resolveNavigationPush: (() => void) | undefined;
  let resolveNavigationPlatformBack:
    ((transition: NativeNavigationTransition) => void) | undefined;
  let resolveDeepLink:
    ((transition: NativeNavigationTransition) => void) | undefined;
  let resolveDeepLinkPush: (() => void) | undefined;
  const appStateCommitted = new Promise<void>((resolve) => {
    resolveAppStateCommit = resolve;
  });
  const resourceProofStarted = new Promise<void>((resolve) => {
    resolveResourceProofStart = resolve;
  });
  const asyncContent = new Promise<string>((resolve) => {
    resolveAsyncContent = resolve;
  });
  const imageEventObserved = new Promise<void>((resolve) => {
    resolveImageEvent = resolve;
  });
  const scrollEventObserved = new Promise<void>((resolve) => {
    resolveScrollEvent = resolve;
  });
  const textInputEventObserved = new Promise<void>((resolve) => {
    resolveTextInputEvent = resolve;
  });
  const textInputSelectionEventObserved = new Promise<void>((resolve) => {
    resolveTextInputSelection = resolve;
  });
  const textInputSelectionInsertionObserved = new Promise<void>((resolve) => {
    resolveTextInputSelectionInsertion = resolve;
  });
  const textInputSubmitObserved = new Promise<void>((resolve) => {
    resolveTextInputSubmit = resolve;
  });
  const textInputBlurObserved = new Promise<void>((resolve) => {
    resolveTextInputBlur = resolve;
  });
  const keyboardShownObserved = new Promise<void>((resolve) => {
    resolveKeyboardShown = resolve;
  });
  const keyboardHiddenObserved = new Promise<void>((resolve) => {
    resolveKeyboardHidden = resolve;
  });
  const multilineTextInputValueObserved = new Promise<void>((resolve) => {
    resolveMultilineTextInputValue = resolve;
  });
  const multilineInitialContentSizeObserved = new Promise<void>((resolve) => {
    resolveMultilineInitialContentSize = resolve;
  });
  const multilineContentGrowthObserved = new Promise<void>((resolve) => {
    resolveMultilineContentGrowth = resolve;
  });
  const switchChangeEventObserved = new Promise<void>((resolve) => {
    resolveSwitchChange = resolve;
  });
  const switchValueEventObserved = new Promise<void>((resolve) => {
    resolveSwitchValue = resolve;
  });
  const modalShowEventObserved = new Promise<void>((resolve) => {
    resolveModalShow = resolve;
  });
  const modalRequestCloseEventObserved = new Promise<void>((resolve) => {
    resolveModalRequestClose = resolve;
  });
  const modalDismissEventObserved = new Promise<void>((resolve) => {
    resolveModalDismiss = resolve;
  });
  const modalPresentationRequested = new Promise<void>((resolve) => {
    resolveModalPresentationRequest = resolve;
  });
  const modalDismissalRequested = new Promise<void>((resolve) => {
    resolveModalDismissalRequest = resolve;
  });
  const notificationDeliveryObserved = new Promise<void>((resolve) => {
    resolveNotificationDelivery = resolve;
  });
  const notificationPressObserved = new Promise<void>((resolve) => {
    resolveNotificationPress = resolve;
  });
  const cameraSessionOwnerCreated = new Promise<OwnedCameraSession>(
    (resolve) => {
      resolveCameraSessionOwner = resolve;
    },
  );
  const cameraSessionStartedObserved = new Promise<void>((resolve) => {
    resolveCameraSessionStarted = resolve;
  });
  const navigationPushObserved = new Promise<void>((resolve) => {
    resolveNavigationPush = resolve;
  });
  const navigationPlatformBackObserved =
    new Promise<NativeNavigationTransition>((resolve) => {
      resolveNavigationPlatformBack = resolve;
    });
  const deepLinkObserved = new Promise<NativeNavigationTransition>(
    (resolve) => {
      resolveDeepLink = resolve;
    },
  );
  const deepLinkPushObserved = new Promise<void>((resolve) => {
    resolveDeepLinkPush = resolve;
  });
  const loadNativeNotifications = (): Promise<NotificationService> => {
    if (nativeNotifications !== undefined) {
      return Promise.resolve(nativeNotifications);
    }
    nativeNotificationsPromise ??= import("./adapters/NotifeeApiModule").then(
      ({ createGeneratedNotifyKitNotificationService }) => {
        const service = createGeneratedNotifyKitNotificationService({
          platform: binding.platform,
          androidSmallIcon: "solid_native_notification",
        });
        nativeNotifications = service;
        setNotificationService(service);
        return service;
      },
    );
    return nativeNotificationsPromise;
  };
  const requireNativeNotifications = (): NotificationService => {
    invariant(
      nativeNotifications !== undefined,
      "The notification service was not loaded after the resource-proof gate.",
    );
    return nativeNotifications;
  };
  const loadNativeCamera = (): Promise<CameraService> => {
    if (nativeCamera !== undefined) return Promise.resolve(nativeCamera);
    nativeCameraPromise ??= import("@solid-native/camera/react-native").then(
      ({ CameraPreview, createReactNativeCameraService }) => {
        setCameraPreviewComponent(() => CameraPreview);
        const service = createReactNativeCameraService();
        nativeCamera = service;
        return service;
      },
    );
    return nativeCameraPromise;
  };
  const requireNativeCamera = (): CameraService => {
    invariant(
      nativeCamera !== undefined,
      "The camera service was not loaded after the resource-proof gate.",
    );
    return nativeCamera;
  };
  const loadNativeStorage = (): Promise<KeyValueStorage> => {
    if (nativeStorage !== undefined) return Promise.resolve(nativeStorage);
    nativeStoragePromise ??= import("./adapters/RNAsyncStorage").then(
      ({ createGeneratedRNAsyncStorageKeyValueStorage }) => {
        const storage = createGeneratedRNAsyncStorageKeyValueStorage({
          databaseName: "solid_native_e2e",
          prefix: "proof",
        });
        nativeStorage = storage;
        return storage;
      },
    );
    return nativeStoragePromise;
  };
  const completeAppStateProof = async (): Promise<void> => {
    const app = application;
    invariant(app !== undefined, "The renderer application was not retained.");
    const update = await app.root.flush();
    invariant(
      update?.sequence === proofSequence(2),
      `The AppState TurboModule event did not produce commit ${String(proofSequence(2))}.`,
    );
    invariant(
      Number.isSafeInteger(update.hostRevision),
      "The AppState TurboModule commit did not return a Fabric revision.",
    );
    const lifecycle = await waitForMount(mountEvents, proofSequence(2));
    invariant(
      lifecycle.hostRevision === update.hostRevision,
      "The AppState TurboModule event mounted at a different Fabric revision.",
    );
    await verifyAppStateCausality(
      telemetryRecords,
      mountEvents,
      frameEvents,
      proofSequence(2),
      update.hostRevision,
      {
        runtimeName: binding.backend,
        runtimeVersion: binding.backendVersion,
        hostContractVersion: binding.contractVersion,
        platform: binding.platform,
      },
    );
    console.log("SOLID_NATIVE_APP_STATE_CAUSALITY_SUCCEEDED");
    console.log("SOLID_NATIVE_TURBOMODULE_EVENT_SUCCEEDED");
    resolveAppStateCommit?.();
  };

  const completePressProof = async (): Promise<void> => {
    const app = application;
    const target = pressable;
    invariant(app !== undefined, "The renderer application was not retained.");
    invariant(target !== undefined, "The Pressable ref was not retained.");
    await waitForAppStateProof(appStateCommitted);
    setStatus(SIGNAL_TEXT);

    const update = await app.root.flush();
    invariant(
      update?.sequence === proofSequence(3),
      `The Solid signal did not produce commit ${String(proofSequence(3))}.`,
    );
    invariant(
      Number.isSafeInteger(update.hostRevision),
      "The Solid signal commit did not return a Fabric revision.",
    );
    const lifecycle = await waitForMount(mountEvents, proofSequence(3));
    invariant(
      lifecycle.hostRevision === update.hostRevision,
      "The Solid signal mounted at a different Fabric revision.",
    );

    const measurement = await target.measure();
    invariant(
      measurement.observedSequence === proofSequence(3) &&
        measurement.width > 0 &&
        measurement.height > 0,
      `The post-signal measurement was stale or empty: ${JSON.stringify(measurement)}.`,
    );
    console.log("SOLID_NATIVE_SOLID_SIGNAL_SUCCEEDED");
    console.log("SOLID_NATIVE_MEASUREMENT_SUCCEEDED");

    resolveAsyncContent?.(ASYNC_READY_TEXT);
    await asyncContent;
    await Promise.resolve();
    const asyncUpdate = await app.root.flush();
    invariant(
      asyncUpdate?.sequence === proofSequence(4),
      `The Solid async boundary did not produce commit ${String(proofSequence(4))}.`,
    );
    invariant(
      Number.isSafeInteger(asyncUpdate.hostRevision),
      "The Solid async boundary commit did not return a Fabric revision.",
    );
    const asyncLifecycle = await waitForMount(mountEvents, proofSequence(4));
    invariant(
      asyncLifecycle.hostRevision === asyncUpdate.hostRevision,
      "The Solid async boundary mounted at a different Fabric revision.",
    );
    console.log("SOLID_NATIVE_ASYNC_BOUNDARY_SUCCEEDED");

    const scrollTarget = scrollView;
    invariant(
      scrollTarget !== undefined,
      "The ScrollView ref was not retained.",
    );
    await scrollTarget.scrollTo({ y: 120, animated: false });
    console.log("SOLID_NATIVE_SCROLL_COMMAND_SUCCEEDED");
    await Promise.race([
      scrollEventObserved,
      delay(PROOF_TIMEOUT_MS).then(() => {
        throw new Error(
          "The native ScrollView command did not emit its continuous event.",
        );
      }),
    ]);
    console.log("SOLID_NATIVE_SCROLL_EVENT_SUCCEEDED");

    await Promise.race([
      imageEventObserved,
      delay(PROOF_TIMEOUT_MS).then(() => {
        throw new Error("The native Image did not emit its load event.");
      }),
    ]);
    console.log("SOLID_NATIVE_IMAGE_LOAD_SUCCEEDED");

    const imageScope = imageLoadScope;
    const scrollScope = scrollEventScope;
    invariant(
      imageScope?.state === "active" && scrollScope?.state === "active",
      "The Image/ScrollView events did not retain active causal scopes.",
    );
    try {
      imageScope.run(() => setImageStatus(IMAGE_READY_TEXT));
      scrollScope.run(() => setScrollStatus(SCROLL_READY_TEXT));
      const scrollUpdate = await app.root.flush();
      invariant(
        scrollUpdate?.sequence === proofSequence(6),
        `The ScrollView proof did not produce commit ${String(proofSequence(6))}.`,
      );
      invariant(
        Number.isSafeInteger(scrollUpdate.hostRevision),
        "The ScrollView proof commit did not return a Fabric revision.",
      );
      imageScope.finish();
      scrollScope.finish();
      const scrollLifecycle = await waitForMount(mountEvents, proofSequence(6));
      invariant(
        scrollLifecycle.hostRevision === scrollUpdate.hostRevision,
        "The ScrollView proof mounted at a different Fabric revision.",
      );
      await verifyScrollImageCausality(
        telemetryRecords,
        mountEvents,
        frameEvents,
        proofSequence(5),
        scrollUpdate.sequence,
        scrollUpdate.hostRevision,
      );
      console.log(
        "SOLID_NATIVE_SCROLL_IMAGE_CAUSALITY_SUCCEEDED",
        JSON.stringify({ nativeEvents: 2, taskScopes: 2 }),
      );
      const scrollMeasurement = await scrollTarget.nativeNode.measure();
      invariant(
        scrollMeasurement.observedSequence === proofSequence(6) &&
          scrollMeasurement.width > 0 &&
          scrollMeasurement.height > 0,
        `The ScrollView measurement was stale or empty: ${JSON.stringify(scrollMeasurement)}.`,
      );
      console.log("SOLID_NATIVE_SCROLLVIEW_SUCCEEDED");
    } catch (error) {
      if (imageScope.state === "active") imageScope.fail(error);
      if (scrollScope.state === "active") scrollScope.fail(error);
      throw error;
    }

    const rootPressable = pressable;
    invariant(
      rootPressable !== undefined,
      "The root Pressable ref was not retained before native navigation.",
    );
    const pushLifecycleStart = screenLifecycleEvents.length;
    const pushTransition = navigation.push("/detail", {
      proof: "physical-native-stack",
    });
    invariant(
      pushTransition.kind === "push" &&
        pushTransition.origin === "application" &&
        pushTransition.from.href === "/" &&
        pushTransition.to.href === "/detail",
      "The application navigation push had invalid transition metadata.",
    );
    await waitForRouterLocation("/detail");
    const navigationUpdate = await app.root.flush();
    invariant(
      navigationUpdate?.sequence === proofSequence(7),
      `The native navigation push did not produce commit ${String(proofSequence(7))}.`,
    );
    invariant(
      Number.isSafeInteger(navigationUpdate.hostRevision),
      "The native navigation push did not return a Fabric revision.",
    );
    const navigationLifecycle = await waitForMount(
      mountEvents,
      proofSequence(7),
    );
    invariant(
      navigationLifecycle.hostRevision === navigationUpdate.hostRevision,
      "The native navigation push mounted at a different Fabric revision.",
    );
    await Promise.race([
      navigationPushObserved,
      delay(PROOF_TIMEOUT_MS).then(() => {
        throw new Error(
          "RNSScreenStack did not finish its physical push transition.",
        );
      }),
    ]);
    const pushFocusLifecycle = await waitForScreenLifecycle(
      screenLifecycleEvents,
      pushLifecycleStart,
      "/detail",
      "focus",
      proofSequence(6),
    );
    const pushFocusUpdate = await app.root.flush();
    invariant(
      pushFocusUpdate?.sequence === proofSequence(7) + 1,
      "The detail-screen focus did not produce its reactive commit.",
    );
    invariant(
      pushFocusUpdate.hostRevision !== undefined &&
        Number.isSafeInteger(pushFocusUpdate.hostRevision),
      "The detail-screen focus commit did not return a Fabric revision.",
    );
    await waitForMount(mountEvents, pushFocusUpdate.sequence);
    await waitForFrame(frameEvents, pushFocusUpdate.sequence);
    verifyNavigationFocusCausality(
      telemetryRecords,
      screenLifecycleEvents.slice(pushLifecycleStart),
      pushFocusLifecycle,
      pushFocusUpdate.sequence,
      pushFocusUpdate.hostRevision,
    );
    validatedNavigationCausalInteractions++;
    proofCommitOffset++;
    invariant(
      activeNavigationFocusScopes.size === 1 &&
        activeNavigationFocusScopes.has(navigation.location.id) &&
        navigationFocusScopeSetups >= 2 &&
        navigationFocusScopeCleanups >= 1,
      "The detail screen did not exclusively own native-focus work.",
    );
    invariant(
      navigation.acknowledgeApplicationTransition(pushTransition.id) === false,
      "RNSScreenStack did not acknowledge the application transition.",
    );
    const detailTarget = navigationDetail;
    invariant(
      detailTarget !== undefined,
      "The native navigation detail ref was not retained.",
    );
    const detailMeasurement = await detailTarget.measure();
    invariant(
      detailMeasurement.observedSequence === proofSequence(7) &&
        detailMeasurement.width > 0 &&
        detailMeasurement.height > 0,
      `The native navigation detail measurement was stale or empty: ${JSON.stringify(detailMeasurement)}.`,
    );
    const detailMatch = navigationRouter.state.matches.at(-1);
    invariant(
      navigationRouter.state.location.pathname === "/detail" &&
        detailMatch !== undefined &&
        isHostObject(detailMatch.loaderData) &&
        detailMatch.loaderData.proof === "detail",
      "TanStack Router did not publish the native detail route loader.",
    );
    console.log("SOLID_NATIVE_TANSTACK_ROUTE_COMPONENT_SUCCEEDED");
    console.log("SOLID_NATIVE_NAVIGATION_PUSH_SUCCEEDED");

    const popLifecycleStart = screenLifecycleEvents.length;
    const platformTransition = await Promise.race([
      navigationPlatformBackObserved,
      delay(PROOF_TIMEOUT_MS * 2).then(() => {
        throw new Error(
          "The physical platform back action did not reach NativeHistory.",
        );
      }),
    ]);
    invariant(
      platformTransition.kind === "pop" &&
        platformTransition.origin === "platform" &&
        platformTransition.from.href === "/detail" &&
        platformTransition.to.href === "/" &&
        platformTransition.delta === -1,
      "The physical platform back transition had invalid metadata.",
    );
    invariant(
      navigation.location.href === "/" && !navigation.canGoBack,
      "NativeHistory did not reconcile the physical platform back action.",
    );
    console.log("SOLID_NATIVE_NAVIGATION_BACK_EVENT_SUCCEEDED");

    await waitForRouterLocation("/");
    const navigationPopUpdate = await app.root.flush();
    invariant(
      navigationPopUpdate?.sequence === proofSequence(8),
      `The physical native navigation pop did not produce commit ${String(proofSequence(8))}.`,
    );
    invariant(
      Number.isSafeInteger(navigationPopUpdate.hostRevision),
      "The physical native navigation pop did not return a Fabric revision.",
    );
    const navigationPopLifecycle = await waitForMount(
      mountEvents,
      proofSequence(8),
    );
    invariant(
      navigationPopLifecycle.hostRevision === navigationPopUpdate.hostRevision,
      "The physical native navigation pop mounted at a different Fabric revision.",
    );
    const navigationResource = {
      runtimeName: binding.backend,
      runtimeVersion: binding.backendVersion,
      hostContractVersion: binding.contractVersion,
      platform: binding.platform,
    };
    if (binding.platform === "ios") {
      await verifyNativeDismissCausality(
        telemetryRecords,
        mountEvents,
        frameEvents,
        navigationPopUpdate.sequence,
        navigationPopUpdate.hostRevision,
        navigationResource,
      );
    } else {
      await verifyPlatformEventCausality(
        telemetryRecords,
        mountEvents,
        frameEvents,
        navigationPopUpdate.sequence,
        navigationPopUpdate.hostRevision,
        "platform.hardware-back.press",
        "discrete",
        "user-blocking",
        undefined,
        "Hardware Back",
        undefined,
        navigationResource,
      );
    }
    console.log("SOLID_NATIVE_NAVIGATION_BACK_CAUSALITY_SUCCEEDED");
    const popFocusLifecycle = await waitForScreenLifecycle(
      screenLifecycleEvents,
      popLifecycleStart,
      "/",
      "focus",
      proofSequence(7),
    );
    const popFocusUpdate = await app.root.flush();
    invariant(
      popFocusUpdate?.sequence === proofSequence(8) + 1,
      "The restored root focus did not produce its reactive commit.",
    );
    invariant(
      popFocusUpdate.hostRevision !== undefined &&
        Number.isSafeInteger(popFocusUpdate.hostRevision),
      "The restored root focus commit did not return a Fabric revision.",
    );
    await waitForMount(mountEvents, popFocusUpdate.sequence);
    await waitForFrame(frameEvents, popFocusUpdate.sequence);
    verifyNavigationFocusCausality(
      telemetryRecords,
      screenLifecycleEvents.slice(popLifecycleStart),
      popFocusLifecycle,
      popFocusUpdate.sequence,
      popFocusUpdate.hostRevision,
    );
    validatedNavigationCausalInteractions++;
    proofCommitOffset++;
    invariant(
      activeNavigationFocusScopes.size === 1 &&
        activeNavigationFocusScopes.has(navigation.location.id) &&
        navigationFocusScopeSetups >= 3 &&
        navigationFocusScopeCleanups >= 2,
      "The restored root did not reacquire native-focus work exclusively.",
    );
    const restoredTarget = pressable;
    invariant(
      restoredTarget === rootPressable,
      "The restored root screen did not preserve its Solid owner and native handle.",
    );
    const restoredMeasurement = await restoredTarget.measure();
    invariant(
      restoredMeasurement.observedSequence === proofSequence(8) &&
        restoredMeasurement.width > 0 &&
        restoredMeasurement.height > 0,
      `The restored root screen measurement was stale or empty: ${JSON.stringify(restoredMeasurement)}.`,
    );
    console.log("SOLID_NATIVE_TANSTACK_SCREEN_IDENTITY_SUCCEEDED");
    console.log("SOLID_NATIVE_NAVIGATION_POP_SUCCEEDED");

    const deepLinkLifecycleStart = screenLifecycleEvents.length;
    const deepLinkTransition = await Promise.race([
      deepLinkObserved,
      delay(PROOF_TIMEOUT_MS * 2).then(() => {
        throw new Error(
          "The physical native deep link did not reach NativeHistory.",
        );
      }),
    ]);
    invariant(
      deepLinkTransition.kind === "push" &&
        deepLinkTransition.origin === "system" &&
        deepLinkTransition.from.href === "/" &&
        deepLinkTransition.to.href === "/deep-link" &&
        isHostObject(deepLinkTransition.to.state) &&
        deepLinkTransition.to.state.url === DEEP_LINK_URL,
      "The native deep-link transition had invalid metadata.",
    );
    console.log("SOLID_NATIVE_DEEP_LINK_EVENT_SUCCEEDED");

    await waitForRouterLocation("/deep-link");
    const deepLinkUpdate = await app.root.flush();
    invariant(
      deepLinkUpdate?.sequence === proofSequence(9),
      `The native deep link produced ${String(deepLinkUpdate?.sequence)} instead of commit ${String(proofSequence(9))}.`,
    );
    invariant(
      Number.isSafeInteger(deepLinkUpdate.hostRevision),
      "The native deep-link commit did not return a Fabric revision.",
    );
    const deepLinkLifecycle = await waitForMount(mountEvents, proofSequence(9));
    invariant(
      deepLinkLifecycle.hostRevision === deepLinkUpdate.hostRevision,
      "The native deep link mounted at a different Fabric revision.",
    );
    await verifyPlatformEventCausality(
      telemetryRecords,
      mountEvents,
      frameEvents,
      deepLinkUpdate.sequence,
      deepLinkUpdate.hostRevision,
      "platform.url.open",
      "default",
      "normal",
      NAVIGATION_FOCUS_COMPUTATION_NAME,
      "Live deep link",
      DEEP_LINK_URL,
      {
        runtimeName: binding.backend,
        runtimeVersion: binding.backendVersion,
        hostContractVersion: binding.contractVersion,
        platform: binding.platform,
      },
    );
    console.log("SOLID_NATIVE_DEEP_LINK_CAUSALITY_SUCCEEDED");
    await Promise.race([
      deepLinkPushObserved,
      delay(PROOF_TIMEOUT_MS).then(() => {
        throw new Error(
          "RNSScreenStack did not finish the native deep-link push.",
        );
      }),
    ]);
    const deepLinkFocusLifecycle = await waitForScreenLifecycle(
      screenLifecycleEvents,
      deepLinkLifecycleStart,
      "/deep-link",
      "focus",
      proofSequence(8),
    );
    const deepLinkFocusUpdate = await app.root.flush();
    invariant(
      deepLinkFocusUpdate?.sequence === proofSequence(9) + 1,
      "The live-linked screen focus did not produce its reactive commit.",
    );
    invariant(
      deepLinkFocusUpdate.hostRevision !== undefined &&
        Number.isSafeInteger(deepLinkFocusUpdate.hostRevision),
      "The live-linked focus commit did not return a Fabric revision.",
    );
    await waitForMount(mountEvents, deepLinkFocusUpdate.sequence);
    await waitForFrame(frameEvents, deepLinkFocusUpdate.sequence);
    verifyNavigationFocusCausality(
      telemetryRecords,
      screenLifecycleEvents.slice(deepLinkLifecycleStart),
      deepLinkFocusLifecycle,
      deepLinkFocusUpdate.sequence,
      deepLinkFocusUpdate.hostRevision,
    );
    validatedNavigationCausalInteractions++;
    proofCommitOffset++;
    invariant(
      navigation.acknowledgeApplicationTransition(deepLinkTransition.id) ===
        false,
      "RNSScreenStack did not acknowledge the deep-link transition.",
    );
    const deepLinkTarget = deepLinkDetail;
    invariant(
      deepLinkTarget !== undefined,
      "The native deep-link detail ref was not retained.",
    );
    const deepLinkMeasurement = await deepLinkTarget.measure();
    invariant(
      deepLinkMeasurement.observedSequence === proofSequence(9) &&
        deepLinkMeasurement.width > 0 &&
        deepLinkMeasurement.height > 0,
      `The native deep-link measurement was stale or empty: ${JSON.stringify(deepLinkMeasurement)}.`,
    );
    console.log("SOLID_NATIVE_DEEP_LINK_MOUNT_SUCCEEDED");
    invariant(
      validatedNavigationCausalInteractions === 3,
      "The physical navigation sequence omitted a causal interaction proof.",
    );
    console.log(
      "SOLID_NATIVE_NAVIGATION_CAUSALITY_SUCCEEDED",
      JSON.stringify({ interactions: validatedNavigationCausalInteractions }),
    );
    console.log("SOLID_NATIVE_NAVIGATION_FOCUS_SUCCEEDED");

    setTextInputReady(true);
    const textInputMountUpdate = await app.root.flush();
    invariant(
      textInputMountUpdate?.sequence === proofSequence(9) + 1,
      `The TextInput readiness barrier produced ${String(textInputMountUpdate?.sequence)} instead of commit ${String(proofSequence(9) + 1)}.`,
    );
    invariant(
      Number.isSafeInteger(textInputMountUpdate.hostRevision),
      "The TextInput readiness barrier did not return a Fabric revision.",
    );
    await waitForMount(mountEvents, textInputMountUpdate.sequence);

    const textInputTelemetryStart = telemetryRecords.length;
    await Promise.race([
      Promise.all([textInputEventObserved, keyboardShownObserved]),
      delay(PROOF_TIMEOUT_MS * 3).then(() => {
        throw new Error(
          "The physical keyboard did not become visible and deliver the controlled TextInput value.",
        );
      }),
    ]);
    const textInputUpdate = await app.root.flush();
    invariant(
      textInputUpdate?.sequence === proofSequence(9) + 2,
      `The controlled TextInput change produced ${String(textInputUpdate?.sequence)} instead of commit ${String(proofSequence(9) + 2)} after ${String(textInputChangeCount)} semantic changes and ${String(textInputRawChangeCount)} native acknowledgements ending at eventCount ${String(textInputNativeEventCount)}.`,
    );
    invariant(
      textInputUpdate.hostRevision !== undefined &&
        Number.isSafeInteger(textInputUpdate.hostRevision),
      "The controlled TextInput commit did not return a Fabric revision.",
    );
    await waitForMount(mountEvents, textInputUpdate.sequence);
    await waitForFrame(frameEvents, textInputUpdate.sequence);
    const textInputCausalEventCount = verifyTextInputValueCausality(
      telemetryRecords,
      textInputTelemetryStart,
      textInputChangeCount,
      textInputMountUpdate.sequence,
      textInputUpdate.sequence,
      textInputUpdate.hostRevision,
    );
    console.log(
      "SOLID_NATIVE_TEXTINPUT_CAUSALITY_SUCCEEDED",
      JSON.stringify({
        applicationEvents: textInputChangeCount,
        nativeAcknowledgements: textInputRawChangeCount,
        causalEvents: textInputCausalEventCount,
      }),
    );
    const textInputTarget = textInput;
    invariant(
      textInputTarget !== undefined && textInputValue() === TEXT_INPUT_VALUE,
      "The controlled TextInput did not retain the physical keyboard value.",
    );
    const textInputMeasurement = await textInputTarget.measure();
    invariant(
      textInputMeasurement.observedSequence >= textInputUpdate.sequence &&
        textInputMeasurement.width > 0 &&
        textInputMeasurement.height > 0,
      `The controlled TextInput measurement was stale or empty: ${JSON.stringify(textInputMeasurement)}.`,
    );

    setTextInputValue(TEXT_INPUT_CONTROLLED_VALUE);
    const controlledReplacementUpdate = await app.root.flush();
    invariant(
      controlledReplacementUpdate !== undefined &&
        controlledReplacementUpdate.sequence >
          textInputMeasurement.observedSequence,
      `The programmatic TextInput replacement produced ${String(controlledReplacementUpdate?.sequence)} after observed commit ${String(textInputMeasurement.observedSequence)}.`,
    );
    const controlledReplacementMountSequence =
      textInputMeasurement.observedSequence + 1;
    await waitForMount(mountEvents, controlledReplacementMountSequence);
    const controlledMeasurement = await textInputTarget.measure();
    invariant(
      textInputValue() === TEXT_INPUT_CONTROLLED_VALUE &&
        controlledMeasurement.observedSequence >=
          controlledReplacementMountSequence &&
        controlledMeasurement.width > 0 &&
        controlledMeasurement.height > 0,
      `The programmatic TextInput replacement did not settle natively: ${JSON.stringify(controlledMeasurement)}.`,
    );

    // The Solid facade turns this reactive range into an event-counted native
    // command after its structural prop update has mounted; later controlled
    // text also uses the same counted reconciliation path. iOS intentionally
    // suppresses selectionChange for JavaScript-driven ranges, so the root
    // flush is the command-completion boundary and the following physical
    // insertion proves where the native caret actually settled.
    textInputSelectionArmed = true;
    const selectionCommandTelemetryStart = telemetryRecords.length;
    setTextInputSelection({ start: 5, end: 5 });
    await app.root.flush();
    const selectionCommandSequence = verifyTextInputSelectionCommandCausality(
      telemetryRecords,
      selectionCommandTelemetryStart,
    );
    invariant(
      app.root.lastCommittedSequence === selectionCommandSequence,
      "The controlled selection command proof did not finish at the latest host sequence.",
    );
    console.log("SOLID_NATIVE_TEXTINPUT_SELECTION_CAUSALITY_SUCCEEDED");
    setTextInputSelectionStatus(TEXT_INPUT_SELECTION_READY_TEXT);
    const selectionReadyUpdate = await app.root.flush();
    invariant(
      selectionReadyUpdate !== undefined &&
        selectionReadyUpdate.sequence >
          controlledMeasurement.observedSequence &&
        Number.isSafeInteger(selectionReadyUpdate.hostRevision),
      "The controlled TextInput selection did not mount a visible readiness barrier.",
    );
    await waitForMount(mountEvents, selectionReadyUpdate.sequence);

    const selectionInsertionTelemetryStart = telemetryRecords.length;
    await Promise.race([
      Promise.all([
        textInputSelectionInsertionObserved,
        textInputSelectionEventObserved,
      ]),
      delay(PROOF_TIMEOUT_MS * 3).then(() => {
        throw new Error(
          "The physical keyboard did not insert text at Solid's controlled selection and report its resulting range.",
        );
      }),
    ]);
    invariant(
      textInputSelectionInserted &&
        textInputSelectionObserved &&
        textInputValue() === TEXT_INPUT_SELECTION_VALUE,
      "The TextInput selection insertion proof resolved with the wrong value.",
    );
    textInputSelectionArmed = false;
    const selectionInsertionUpdate = await app.root.flush();
    invariant(
      selectionInsertionUpdate !== undefined &&
        selectionInsertionUpdate.sequence > selectionReadyUpdate.sequence &&
        selectionInsertionUpdate.hostRevision !== undefined &&
        Number.isSafeInteger(selectionInsertionUpdate.hostRevision),
      "The controlled TextInput selection insertion did not mount.",
    );
    await waitForMount(mountEvents, selectionInsertionUpdate.sequence);
    await waitForFrame(frameEvents, selectionInsertionUpdate.sequence);
    const selectionInsertionCausalCounts =
      verifyTextInputSelectionInsertionCausality(
        telemetryRecords,
        selectionInsertionTelemetryStart,
        selectionReadyUpdate.sequence,
        selectionInsertionUpdate.sequence,
        selectionInsertionUpdate.hostRevision,
      );
    console.log(
      "SOLID_NATIVE_TEXTINPUT_SELECTION_INSERTION_CAUSALITY_SUCCEEDED",
      JSON.stringify(selectionInsertionCausalCounts),
    );

    setTextInputValue(TEXT_INPUT_CONTROLLED_VALUE);
    setTextInputSelectionStatus(TEXT_INPUT_SELECTION_SUCCEEDED_TEXT);
    const selectionRestorationUpdate = await app.root.flush();
    invariant(
      selectionRestorationUpdate !== undefined &&
        selectionRestorationUpdate.sequence > selectionInsertionUpdate.sequence,
      "The TextInput selection proof did not restore the controlled value.",
    );
    const selectionRestorationMountSequence =
      selectionInsertionUpdate.sequence + 1;
    await waitForMount(mountEvents, selectionRestorationMountSequence);
    const selectionMeasurement = await textInputTarget.measure();
    invariant(
      selectionMeasurement.observedSequence >=
        selectionRestorationMountSequence,
      "The TextInput selection restoration was not measurable.",
    );
    console.log("SOLID_NATIVE_TEXTINPUT_SELECTION_SUCCEEDED");

    const submitTelemetryStart = telemetryRecords.length;
    setTextInputSubmitStatus(TEXT_INPUT_SUBMIT_READY_TEXT);
    const submitReadyUpdate = await app.root.flush();
    invariant(
      submitReadyUpdate !== undefined &&
        submitReadyUpdate.sequence > selectionMeasurement.observedSequence &&
        submitReadyUpdate.hostRevision !== undefined &&
        Number.isSafeInteger(submitReadyUpdate.hostRevision),
      "The TextInput submit readiness barrier did not mount after measurement.",
    );
    const submitSequenceBeforeInput = submitReadyUpdate.sequence;
    await waitForMount(mountEvents, submitSequenceBeforeInput);
    await Promise.race([
      Promise.all([
        textInputSubmitObserved,
        textInputBlurObserved,
        keyboardHiddenObserved,
      ]),
      delay(PROOF_TIMEOUT_MS * 3).then(() => {
        throw new Error(
          "The physical return key did not submit, blur, and hide the native keyboard.",
        );
      }),
    ]);
    invariant(
      textInputSubmitted && textInputBlurred,
      "The TextInput submit/blur proof resolved without both native events.",
    );
    const submitUpdate = await app.root.flush();
    const submitUpdateSequence = app.root.lastCommittedSequence;
    invariant(
      submitUpdate !== undefined &&
        submitUpdateSequence > submitSequenceBeforeInput &&
        submitUpdateSequence === submitSequenceBeforeInput + 1 &&
        submitUpdate.sequence === submitUpdateSequence &&
        submitUpdate.hostRevision !== undefined &&
        Number.isSafeInteger(submitUpdate.hostRevision),
      `The TextInput submit proof produced ${String(submitUpdateSequence)} after observed commit ${String(selectionMeasurement.observedSequence)}.`,
    );
    await waitForMount(mountEvents, submitUpdateSequence);
    await waitForFrame(frameEvents, submitUpdateSequence);
    verifyTextInputSubmitCausality(
      telemetryRecords,
      submitTelemetryStart,
      submitSequenceBeforeInput,
      submitUpdateSequence,
      submitUpdate.hostRevision,
    );
    console.log("SOLID_NATIVE_TEXTINPUT_SUBMIT_CAUSALITY_SUCCEEDED");
    const keyboardShowStarted = startedTelemetryOperation(
      telemetryRecords.slice(textInputTelemetryStart),
      "solid-native.event",
      (record) =>
        record.attributes["event.name"] === "platform.keyboard.visibility",
    );
    const keyboardHideStarted = startedTelemetryOperation(
      telemetryRecords.slice(submitTelemetryStart),
      "solid-native.event",
      (record) =>
        record.attributes["event.name"] === "platform.keyboard.visibility",
    );
    const keyboardShowFinished = finishedTelemetryOperation(
      telemetryRecords,
      keyboardShowStarted?.operationId,
    );
    const keyboardHideFinished = finishedTelemetryOperation(
      telemetryRecords,
      keyboardHideStarted?.operationId,
    );
    invariant(
      keyboardShowStarted?.type === "operation-started" &&
        keyboardShowFinished?.type === "operation-finished" &&
        keyboardShowFinished.status === "ok" &&
        keyboardHideStarted?.type === "operation-started" &&
        keyboardHideFinished?.type === "operation-finished" &&
        keyboardHideFinished.status === "ok" &&
        [keyboardShowStarted, keyboardHideStarted].every((record) =>
          Object.keys(record.attributes).every(
            (name) =>
              PERMITTED_PLATFORM_EVENT_START_ATTRIBUTES.has(name) ||
              name.startsWith("resource."),
          ),
        ),
      "The Solid keyboard accessor lost its private show/hide platform events.",
    );
    console.log("SOLID_NATIVE_KEYBOARD_STATE_SUCCEEDED");
    console.log("SOLID_NATIVE_TEXTINPUT_SUBMIT_SUCCEEDED");
    console.log("SOLID_NATIVE_TEXTINPUT_SUCCEEDED");

    setTextInputReady(false);
    setMultilineTextInputReady(true);
    const multilineMountUpdate = await app.root.flush();
    invariant(
      multilineMountUpdate !== undefined &&
        multilineMountUpdate.sequence > submitUpdateSequence &&
        Number.isSafeInteger(multilineMountUpdate.hostRevision),
      "The multiline TextInput did not replace the single-line editor.",
    );
    await waitForMount(mountEvents, multilineMountUpdate.sequence);
    multilineTextInputProofActive = true;
    setMultilineTextInputStatus(MULTILINE_TEXT_INPUT_READY_TEXT);
    const multilineReadyUpdate = await app.root.flush();
    invariant(
      multilineReadyUpdate !== undefined &&
        multilineReadyUpdate.sequence > multilineMountUpdate.sequence &&
        Number.isSafeInteger(multilineReadyUpdate.hostRevision),
      "The multiline TextInput readiness barrier did not mount.",
    );
    await waitForMount(mountEvents, multilineReadyUpdate.sequence);

    const multilineTelemetryStart = telemetryRecords.length;
    await Promise.race([
      Promise.all([
        multilineInitialContentSizeObserved,
        multilineTextInputValueObserved,
      ]),
      delay(PROOF_TIMEOUT_MS * 3).then(() => {
        throw new Error(
          "The physical multiline input did not deliver both its native content size and newline value.",
        );
      }),
    ]);
    const multilineValueUpdate = await app.root.flush();
    invariant(
      multilineValueUpdate !== undefined &&
        multilineValueUpdate.sequence > multilineReadyUpdate.sequence &&
        multilineValueUpdate.hostRevision !== undefined &&
        Number.isSafeInteger(multilineValueUpdate.hostRevision),
      "The multiline TextInput value did not produce a native commit.",
    );
    await waitForMount(mountEvents, multilineValueUpdate.sequence);
    await waitForFrame(frameEvents, multilineValueUpdate.sequence);
    await Promise.race([
      multilineContentGrowthObserved,
      delay(PROOF_TIMEOUT_MS).then(() => {
        throw new Error(
          "The committed multiline TextInput newline did not grow its native content size.",
        );
      }),
    ]);
    const multilineCausalCounts = verifyMultilineTextInputCausality(
      telemetryRecords,
      multilineTelemetryStart,
      multilineReadyUpdate.sequence,
      multilineValueUpdate.sequence,
      multilineValueUpdate.hostRevision,
    );
    console.log(
      "SOLID_NATIVE_TEXTINPUT_MULTILINE_CAUSALITY_SUCCEEDED",
      JSON.stringify(multilineCausalCounts),
    );
    await delay(250);
    invariant(
      multilineTextInputFocused &&
        multilineTextInputEnterPressed &&
        !multilineTextInputSubmitted &&
        !multilineTextInputBlurred &&
        multilineTextInputValue() === MULTILINE_TEXT_INPUT_VALUE,
      "The multiline TextInput did not preserve focus and newline semantics.",
    );
    setMultilineTextInputStatus(MULTILINE_TEXT_INPUT_SUCCEEDED_TEXT);
    const multilineNewlineUpdate = await app.root.flush();
    invariant(
      multilineNewlineUpdate !== undefined &&
        multilineNewlineUpdate.sequence > multilineValueUpdate.sequence &&
        Number.isSafeInteger(multilineNewlineUpdate.hostRevision),
      "The multiline TextInput newline result did not mount.",
    );
    await waitForMount(mountEvents, multilineNewlineUpdate.sequence);
    const multilineTarget = multilineTextInput;
    invariant(
      multilineTarget !== undefined,
      "The multiline TextInput ref was not retained.",
    );
    const multilineMeasurement = await multilineTarget.measure();
    invariant(
      multilineMeasurement.observedSequence >=
        multilineNewlineUpdate.sequence &&
        multilineMeasurement.width > 0 &&
        multilineMeasurement.height > 0,
      `The multiline TextInput measurement was stale or empty: ${JSON.stringify(multilineMeasurement)}.`,
    );
    multilineTextInputProofActive = false;
    console.log("SOLID_NATIVE_TEXTINPUT_MULTILINE_SUCCEEDED");

    const switchSequenceBeforeTap = app.root.lastCommittedSequence;
    const switchTelemetryStart = telemetryRecords.length;
    await Promise.race([
      Promise.all([switchChangeEventObserved, switchValueEventObserved]),
      delay(PROOF_TIMEOUT_MS).then(() => {
        throw new Error(
          "The physical Switch did not deliver both controlled change callbacks.",
        );
      }),
    ]);
    invariant(
      switchChangeObserved && switchValueObserved,
      "The controlled Switch proof resolved without both public callbacks.",
    );
    await app.root.flush();
    const switchUpdateSequence = app.root.lastCommittedSequence;
    invariant(
      switchUpdateSequence > switchSequenceBeforeTap &&
        switchUpdateSequence > multilineMeasurement.observedSequence,
      "The controlled Switch result did not produce a native commit.",
    );
    const switchCommandSequence = verifySwitchControlledCommandCausality(
      telemetryRecords,
      switchTelemetryStart,
      switchObservedSequence,
    );
    invariant(
      switchCommandSequence === switchUpdateSequence,
      "The controlled Switch did not finish on its isolated command commit.",
    );
    const switchTarget = nativeSwitch;
    invariant(
      switchTarget !== undefined,
      "The native Switch ref was not retained.",
    );
    const switchMeasurementTelemetryStart = telemetryRecords.length;
    const switchMeasurement = await switchTarget.measure();
    invariant(
      switchMeasurement.observedSequence >= switchUpdateSequence &&
        switchMeasurement.width > 0 &&
        switchMeasurement.height > 0,
      `The controlled Switch measurement was stale or empty: ${JSON.stringify(switchMeasurement)}.`,
    );
    verifySwitchMeasurementCausality(
      telemetryRecords,
      switchMeasurementTelemetryStart,
      switchMeasurement.observedSequence,
    );
    console.log("SOLID_NATIVE_SWITCH_CAUSALITY_SUCCEEDED");
    console.log("SOLID_NATIVE_SWITCH_SUCCEEDED");

    setModalHandoffReady(true);
    const modalHandoff = await app.root.flush();
    invariant(
      modalHandoff !== undefined &&
        Number.isSafeInteger(modalHandoff.hostRevision),
      "The Modal presentation handoff did not mount.",
    );
    await waitForMount(mountEvents, modalHandoff.sequence);
    const modalTelemetryStart = telemetryRecords.length;
    await Promise.race([
      modalPresentationRequested,
      delay(PROOF_TIMEOUT_MS * 2).then(() => {
        throw new Error(
          "The physical Modal presentation control was not pressed.",
        );
      }),
    ]);
    await app.root.flush();
    const modalPresentationSequence = await verifyModalLifecycleCausality(
      telemetryRecords,
      modalTelemetryStart,
      mountEvents,
      frameEvents,
      "press",
      modalPresentationObservedSequence,
      "discrete",
      "user-blocking",
    );
    await Promise.race([
      modalShowEventObserved,
      delay(PROOF_TIMEOUT_MS * 2).then(() => {
        throw new Error("The native Modal did not emit its show event.");
      }),
    ]);
    await app.root.flush();
    const modalShowSequence = await verifyModalLifecycleCausality(
      telemetryRecords,
      modalTelemetryStart,
      mountEvents,
      frameEvents,
      "show",
      modalShowObservedSequence,
      "default",
      "normal",
    );
    invariant(modalShowObserved, "The native Modal show proof resolved early.");
    invariant(
      modalShowSequence > modalPresentationSequence,
      "The native Modal show output did not follow its presentation commit.",
    );
    console.log("SOLID_NATIVE_MODAL_SHOW_SUCCEEDED");

    let modalApplicationCloseSequence: number | undefined;
    if (nativePlatform === "ios") {
      await Promise.race([
        modalDismissalRequested,
        delay(PROOF_TIMEOUT_MS * 2).then(() => {
          throw new Error(
            "The physical Modal dismissal control was not pressed.",
          );
        }),
      ]);
      await app.root.flush();
      modalApplicationCloseSequence = await verifyModalLifecycleCausality(
        telemetryRecords,
        modalTelemetryStart,
        mountEvents,
        frameEvents,
        "press",
        modalDismissalRequestObservedSequence,
        "discrete",
        "user-blocking",
      );
      invariant(
        modalApplicationCloseSequence > modalShowSequence,
        "The iOS Modal close press did not follow its show output.",
      );
    }

    await Promise.race([
      nativePlatform === "android"
        ? modalRequestCloseEventObserved
        : modalDismissEventObserved,
      delay(PROOF_TIMEOUT_MS * 2).then(() => {
        throw new Error(
          nativePlatform === "android"
            ? "Android did not route system Back through Modal onRequestClose."
            : "UIKit did not complete the native Modal dismissal.",
        );
      }),
    ]);
    await app.root.flush();
    if (nativePlatform === "android") {
      const modalCloseSequence = await verifyModalLifecycleCausality(
        telemetryRecords,
        modalTelemetryStart,
        mountEvents,
        frameEvents,
        "requestClose",
        modalRequestCloseObservedSequence,
        "default",
        "normal",
      );
      invariant(
        modalCloseSequence > modalShowSequence,
        "The Android Modal close request did not follow its show output.",
      );
      console.log(
        "SOLID_NATIVE_MODAL_CAUSALITY_SUCCEEDED",
        JSON.stringify({ interactions: 3 }),
      );
    } else {
      const modalDismissSequence = await verifyModalLifecycleCausality(
        telemetryRecords,
        modalTelemetryStart,
        mountEvents,
        frameEvents,
        "dismiss",
        modalDismissObservedSequence,
        "default",
        "normal",
      );
      invariant(
        modalApplicationCloseSequence !== undefined &&
          modalDismissSequence > modalApplicationCloseSequence,
        "The iOS Modal dismissal did not follow its application close commit.",
      );
      console.log(
        "SOLID_NATIVE_MODAL_CAUSALITY_SUCCEEDED",
        JSON.stringify({ interactions: 4 }),
      );
    }
    invariant(
      !modalVisible() &&
        (nativePlatform === "android"
          ? modalRequestCloseObserved
          : modalDismissObserved),
      "The native Modal close did not reconcile Solid visibility.",
    );
    console.log("SOLID_NATIVE_MODAL_DISMISS_SUCCEEDED");

    const persistence = navigationPersistence;
    invariant(
      persistence !== undefined,
      "The native history persistence controller was not retained.",
    );
    await persistence.flush();
    const storage = nativeStorage;
    invariant(
      storage !== undefined,
      "The native storage adapter was not retained through the proof.",
    );
    const serializedNavigation = await storage.getItem(NAVIGATION_STORAGE_KEY);
    invariant(
      serializedNavigation !== null,
      "The native history snapshot was not stored.",
    );
    const persistedNavigation =
      deserializeNativeHistorySnapshot(serializedNavigation);
    invariant(
      persistedNavigation.entries[persistedNavigation.index]?.href ===
        navigation.location.href,
      "The durable native history snapshot did not contain the latest screen.",
    );
    console.log("SOLID_NATIVE_NAVIGATION_PERSISTENCE_SUCCEEDED");
    await storage.removeItem(NAVIGATION_STORAGE_KEY);
    const notifications = requireNativeNotifications();
    await notifications.cancel(NOTIFICATION_PROOF_ID);
    invariant(
      !(await notifications.getDisplayedNotificationIds()).includes(
        NOTIFICATION_PROOF_ID,
      ),
      "The native notification module retained its canceled proof value.",
    );
    console.log("SOLID_NATIVE_NOTIFICATION_CANCEL_SUCCEEDED");

    await delay(TEARDOWN_DELAY_MS);
    unsubscribeLifecycle?.();
    unsubscribeLifecycle = undefined;
    await app.dispose();
    invariant(
      Number(activeNavigationFocusScopes.size) === 0 &&
        navigationFocusScopeSetups === navigationFocusScopeCleanups,
      "Native screen focus work was not balanced during root disposal.",
    );
    console.log("SOLID_NATIVE_NAVIGATION_FOCUS_SCOPE_SUCCEEDED");
    removeAndroidPlatformBackBlocker?.();
    removeAndroidPlatformBackBlocker = undefined;
    navigationPersistence?.dispose();
    navigationPersistence = undefined;
    routerHistory.destroy();
    const cameraSession = ownedCameraSession;
    invariant(
      cameraSession !== undefined,
      "The owner-bound camera session was not retained through teardown.",
    );
    await cameraSession.stop();
    invariant(
      cameraSession.state() === "stopped",
      "The owner-bound camera session did not stop during root disposal.",
    );
    disarmResourceProofWatchdog();
    console.log("SOLID_NATIVE_CAMERA_SESSION_STOP_SUCCEEDED");
    invariant(app.root.disposed, "The renderer root did not report disposal.");
    console.log("SOLID_NATIVE_IDENTITY_RECLAMATION_SUCCEEDED");
    console.log("SOLID_NATIVE_TEARDOWN_SUCCEEDED");
  };

  const handlePress = (event: NativeSyntheticEvent): void => {
    if (pressHandled) return;
    invariant(
      application !== undefined,
      "The press arrived before application startup.",
    );
    invariant(
      pressable !== undefined,
      "The press arrived before ref assignment.",
    );
    invariant(
      event.name === "press",
      "The native event was not a semantic press.",
    );
    invariant(
      event.currentTarget === pressable,
      "The press routed to the wrong Solid node.",
    );
    invariant(
      event.priority === "discrete",
      "The native press was not discrete.",
    );
    invariant(
      event.observedSequence === proofSequence(2),
      `The native press observed sequence ${String(event.observedSequence)} instead of ${String(proofSequence(2))}.`,
    );
    pressHandled = true;
    void Promise.resolve()
      .then(() => completePressProof())
      .catch(reportFatal);
  };

  const handleResourceProofStart = (event: NativeSyntheticEvent): void => {
    if (resourceProofStartHandled) return;
    invariant(
      event.name === "press" && event.priority === "discrete",
      "The resource-proof gate did not receive a discrete native press.",
    );
    resourceProofStartHandled = true;
    console.log("SOLID_NATIVE_RESOURCE_PROOF_STARTED");
    resolveResourceProofStart?.();
  };

  const armResourceProofWatchdog = (): void => {
    invariant(
      resourceProofWatchdog === undefined,
      "The resource-proof watchdog was already armed.",
    );
    resourceProofWatchdog = setTimeout(() => {
      resourceProofWatchdog = undefined;
      void (async () => {
        console.error(
          "SOLID_NATIVE_RESOURCE_PROOF_WATCHDOG_STARTED",
          "The intensive physical proof exceeded three minutes; releasing owned resources.",
        );
        unsubscribeLifecycle?.();
        unsubscribeLifecycle = undefined;
        removeAndroidPlatformBackBlocker?.();
        removeAndroidPlatformBackBlocker = undefined;
        navigationPersistence?.dispose();
        navigationPersistence = undefined;
        routerHistory.destroy();
        const results = await Promise.allSettled([
          nativeNotifications?.cancel(NOTIFICATION_PROOF_ID),
          ownedCameraSession?.stop(),
          application?.dispose(),
        ]);
        for (const result of results) {
          if (result.status === "rejected") {
            console.error(
              "SOLID_NATIVE_RESOURCE_PROOF_WATCHDOG_FAILED",
              result.reason,
            );
          }
        }
        console.log("SOLID_NATIVE_RESOURCE_PROOF_WATCHDOG_RELEASED");
      })().catch((error: unknown) => {
        console.error("SOLID_NATIVE_RESOURCE_PROOF_WATCHDOG_FAILED", error);
      });
    }, RESOURCE_PROOF_WATCHDOG_MS);
  };

  const disarmResourceProofWatchdog = (): void => {
    if (resourceProofWatchdog === undefined) return;
    clearTimeout(resourceProofWatchdog);
    resourceProofWatchdog = undefined;
  };

  const handleScroll = (event: NativeSyntheticEvent): void => {
    if (scrollHandled || event.observedSequence !== proofSequence(5)) return;
    try {
      invariant(
        scrollView !== undefined,
        "The scroll event arrived before ref assignment.",
      );
      invariant(event.name === "scroll", "The native event was not a scroll.");
      invariant(
        event.currentTarget === scrollView.nativeNode,
        "The scroll event routed to the wrong Solid node.",
      );
      invariant(
        event.priority === "continuous",
        "The native scroll event was not continuous.",
      );
      invariant(
        isHostObject(event.payload) && "contentOffset" in event.payload,
        "The native scroll event omitted its content offset.",
      );
      const contentOffset = event.payload.contentOffset;
      invariant(
        isHostObject(contentOffset) &&
          typeof contentOffset.y === "number" &&
          contentOffset.y > 0,
        "The native ScrollView did not move to a positive vertical offset.",
      );
      const app = application;
      invariant(
        app !== undefined,
        "The renderer application was not retained.",
      );
      scrollEventScope = app.root.createCausalScope(SCROLL_EVENT_TASK_NAME);
      scrollHandled = true;
      resolveScrollEvent?.();
    } catch (error) {
      reportFatal(error);
    }
  };

  const handleImageLoad = (event: NativeSyntheticEvent): void => {
    if (imageHandled) return;
    try {
      invariant(
        image !== undefined,
        "The image event arrived before ref assignment.",
      );
      invariant(
        event.name === "load",
        "The native event was not an image load.",
      );
      invariant(
        event.currentTarget === image,
        "The image load routed to the wrong Solid node.",
      );
      invariant(
        event.priority === "default" && !event.bubbles,
        "The native image load was not a default-priority direct event.",
      );
      invariant(
        Number.isSafeInteger(event.observedSequence) &&
          event.observedSequence >= proofSequence(1),
        "The native image load did not observe a committed tree.",
      );
      invariant(
        isHostObject(event.payload) &&
          isHostObject(event.payload.source) &&
          typeof event.payload.source.uri === "string" &&
          event.payload.source.uri.startsWith("data:image/png;base64,") &&
          typeof event.payload.source.width === "number" &&
          event.payload.source.width > 0 &&
          typeof event.payload.source.height === "number" &&
          event.payload.source.height > 0,
        "The native image load payload omitted its decoded source geometry.",
      );
      const app = application;
      invariant(
        app !== undefined,
        "The renderer application was not retained.",
      );
      imageLoadScope = app.root.createCausalScope(IMAGE_LOAD_TASK_NAME);
      imageHandled = true;
      resolveImageEvent?.();
    } catch (error) {
      reportFatal(error);
    }
  };

  const handleTextInputFocus = (event: NativeSyntheticEvent): void => {
    try {
      invariant(
        textInput !== undefined,
        "The TextInput focus arrived before ref assignment.",
      );
      invariant(
        event.name === "focus" && event.currentTarget === textInput,
        "The native TextInput focus routed to the wrong Solid node.",
      );
      invariant(
        event.priority === "default" && !event.bubbles,
        "The native TextInput focus was not a default-priority direct event.",
      );
      textInputFocused = true;
    } catch (error) {
      reportFatal(error);
    }
  };

  const handleTextInputChange = (event: NativeSyntheticEvent): void => {
    try {
      invariant(
        textInput !== undefined,
        "The TextInput change arrived before ref assignment.",
      );
      invariant(
        event.name === "changeText" && event.currentTarget === textInput,
        "The native TextInput change routed to the wrong Solid node.",
      );
      invariant(
        event.priority === "discrete" && !event.bubbles,
        "The native TextInput change was not a discrete direct event.",
      );
      invariant(
        isHostObject(event.payload) &&
          typeof event.payload.text === "string" &&
          typeof event.payload.eventCount === "number" &&
          Number.isSafeInteger(event.payload.eventCount) &&
          event.payload.eventCount >= 0,
        "The native TextInput change omitted its controlled-input payload.",
      );
      textInputRawChangeCount++;
      textInputNativeEventCount = event.payload.eventCount;
    } catch (error) {
      reportFatal(error);
    }
  };

  const handleTextInputChangeText = (text: string): void => {
    try {
      invariant(
        typeof text === "string",
        "The semantic TextInput change omitted its text value.",
      );
      textInputChangeCount++;
      setTextInputValue(text);
      if (textInputSelectionArmed) {
        if (text !== TEXT_INPUT_SELECTION_VALUE) return;
        if (textInputSelectionInserted) return;
        textInputSelectionInserted = true;
        setTextInputSelection(undefined);
        resolveTextInputSelectionInsertion?.();
        return;
      }
      if (textInputHandled) return;
      if (text !== TEXT_INPUT_VALUE) return;
      invariant(
        textInputFocused,
        "The native TextInput changed before delivering focus.",
      );
      textInputHandled = true;
      resolveTextInputEvent?.();
    } catch (error) {
      reportFatal(error);
    }
  };

  const handleTextInputSelectionChange = (
    event: NativeSyntheticEvent,
  ): void => {
    try {
      invariant(
        textInput !== undefined,
        "The TextInput selection arrived before ref assignment.",
      );
      invariant(
        event.name === "selectionChange" && event.currentTarget === textInput,
        "The native TextInput selection routed to the wrong Solid node.",
      );
      invariant(
        event.priority === "default" && !event.bubbles,
        "The native TextInput selection was not a default-priority direct event.",
      );
      invariant(
        isHostObject(event.payload) &&
          isHostObject(event.payload.selection) &&
          Number.isSafeInteger(event.payload.selection.start) &&
          Number.isSafeInteger(event.payload.selection.end),
        "The native TextInput selection omitted its integer range.",
      );
      if (!textInputSelectionArmed) {
        return;
      }
      // Android reports the JavaScript-driven 5..5 range, while iOS suppresses
      // it by design and reports the user-driven caret at 6 after insertion.
      // The exact inserted editor value remains the portable cursor proof.
      const observedProgrammaticRange =
        event.payload.selection.start === 5 &&
        event.payload.selection.end === 5;
      const observedInsertedRange =
        event.payload.selection.start === 6 &&
        event.payload.selection.end === 6;
      if (!observedProgrammaticRange && !observedInsertedRange) {
        return;
      }
      if (textInputSelectionObserved) return;
      textInputSelectionObserved = true;
      resolveTextInputSelection?.();
    } catch (error) {
      reportFatal(error);
    }
  };

  const handleTextInputSubmit = (event: NativeSyntheticEvent): void => {
    try {
      invariant(
        textInput !== undefined,
        "The TextInput submit arrived before ref assignment.",
      );
      invariant(
        event.name === "submitEditing" && event.currentTarget === textInput,
        "The native TextInput submit routed to the wrong Solid node.",
      );
      invariant(
        event.priority === "discrete" && !event.bubbles,
        "The native TextInput submit was not a discrete direct event.",
      );
      invariant(
        isHostObject(event.payload) &&
          event.payload.text === TEXT_INPUT_CONTROLLED_VALUE,
        "The native TextInput submit omitted its current controlled text.",
      );
      textInputSubmitted = true;
      setTextInputSubmitStatus(TEXT_INPUT_SUBMITTED_TEXT);
      resolveTextInputSubmit?.();
    } catch (error) {
      reportFatal(error);
    }
  };

  const handleTextInputBlur = (event: NativeSyntheticEvent): void => {
    try {
      invariant(
        textInput !== undefined,
        "The TextInput blur arrived before ref assignment.",
      );
      invariant(
        event.name === "blur" && event.currentTarget === textInput,
        "The native TextInput blur routed to the wrong Solid node.",
      );
      invariant(
        event.priority === "default" && !event.bubbles,
        "The native TextInput blur was not a default-priority direct event.",
      );
      textInputBlurred = true;
      resolveTextInputBlur?.();
    } catch (error) {
      reportFatal(error);
    }
  };

  const handleMultilineTextInputFocus = (event: NativeSyntheticEvent): void => {
    try {
      invariant(
        multilineTextInput !== undefined &&
          event.name === "focus" &&
          event.currentTarget === multilineTextInput,
        "The native multiline TextInput focus routed to the wrong Solid node.",
      );
      invariant(
        event.priority === "default" && !event.bubbles,
        "The native multiline TextInput focus was not a default-priority direct event.",
      );
      multilineTextInputFocused = true;
    } catch (error) {
      reportFatal(error);
    }
  };

  const handleMultilineTextInputChange = (
    event: NativeSyntheticEvent,
  ): void => {
    try {
      invariant(
        multilineTextInput !== undefined &&
          event.name === "changeText" &&
          event.currentTarget === multilineTextInput,
        "The native multiline TextInput change routed to the wrong Solid node.",
      );
      invariant(
        event.priority === "discrete" && !event.bubbles,
        "The native multiline TextInput change was not discrete direct input.",
      );
      invariant(
        isHostObject(event.payload) &&
          typeof event.payload.text === "string" &&
          typeof event.payload.eventCount === "number" &&
          Number.isSafeInteger(event.payload.eventCount) &&
          event.payload.eventCount >= 0,
        "The multiline TextInput change omitted its controlled-input payload.",
      );
    } catch (error) {
      reportFatal(error);
    }
  };

  const handleMultilineTextInputChangeText = (text: string): void => {
    try {
      invariant(
        typeof text === "string",
        "The semantic multiline TextInput change omitted its text value.",
      );
      setMultilineTextInputValue(text);
      if (text === MULTILINE_TEXT_INPUT_VALUE) {
        resolveMultilineTextInputValue?.();
      }
    } catch (error) {
      reportFatal(error);
    }
  };

  const handleMultilineTextInputKeyPress = (
    event: NativeSyntheticEvent,
  ): void => {
    try {
      invariant(
        multilineTextInput !== undefined &&
          event.name === "keyPress" &&
          event.currentTarget === multilineTextInput,
        "The native multiline key press routed to the wrong Solid node.",
      );
      invariant(
        event.priority === "discrete" && event.bubbles,
        "The native multiline key press was not discrete bubbling input.",
      );
      invariant(
        isHostObject(event.payload) && typeof event.payload.key === "string",
        "The multiline TextInput key press omitted its key payload.",
      );
      if (event.payload.key === "Enter") {
        multilineTextInputEnterPressed = true;
      }
    } catch (error) {
      reportFatal(error);
    }
  };

  const handleMultilineTextInputContentSizeChange = (
    event: NativeSyntheticEvent,
  ): void => {
    try {
      invariant(
        multilineTextInput !== undefined &&
          event.name === "contentSizeChange" &&
          event.currentTarget === multilineTextInput,
        "The native multiline content-size event routed to the wrong Solid node.",
      );
      invariant(
        event.priority === "default" && !event.bubbles,
        "The native multiline content-size event was not default-priority direct input.",
      );
      invariant(
        isHostObject(event.payload) &&
          isHostObject(event.payload.contentSize) &&
          typeof event.payload.contentSize.width === "number" &&
          event.payload.contentSize.width > 0 &&
          typeof event.payload.contentSize.height === "number" &&
          event.payload.contentSize.height > 0,
        "The multiline TextInput content-size event omitted positive geometry.",
      );
      const height = event.payload.contentSize.height;
      multilineContentSizeEventCount++;
      multilineMinimumContentHeight = Math.min(
        multilineMinimumContentHeight ?? height,
        height,
      );
      multilineMaximumContentHeight = Math.max(
        multilineMaximumContentHeight ?? height,
        height,
      );
      if (multilineContentSizeEventCount === 1) {
        resolveMultilineInitialContentSize?.();
      }
      if (multilineMaximumContentHeight > multilineMinimumContentHeight + 0.5) {
        resolveMultilineContentGrowth?.();
      }
    } catch (error) {
      reportFatal(error);
    }
  };

  const handleMultilineTextInputSubmit = (
    event: NativeSyntheticEvent,
  ): void => {
    try {
      invariant(
        multilineTextInput !== undefined &&
          event.name === "submitEditing" &&
          event.currentTarget === multilineTextInput,
        "The native multiline submit routed to the wrong Solid node.",
      );
      multilineTextInputSubmitted = true;
      invariant(
        !multilineTextInputProofActive,
        "A newline-mode multiline TextInput emitted submitEditing.",
      );
    } catch (error) {
      reportFatal(error);
    }
  };

  const handleMultilineTextInputBlur = (event: NativeSyntheticEvent): void => {
    try {
      invariant(
        multilineTextInput !== undefined &&
          event.name === "blur" &&
          event.currentTarget === multilineTextInput,
        "The native multiline blur routed to the wrong Solid node.",
      );
      multilineTextInputBlurred = true;
      invariant(
        !multilineTextInputProofActive,
        "A newline-mode multiline TextInput blurred after the return key.",
      );
    } catch (error) {
      reportFatal(error);
    }
  };

  const handleSwitchChange = (event: NativeSyntheticEvent): void => {
    try {
      invariant(
        nativeSwitch !== undefined &&
          event.name === "valueChange" &&
          event.currentTarget === nativeSwitch,
        "The native Switch change routed to the wrong Solid node.",
      );
      invariant(
        event.priority === "discrete" && event.bubbles,
        "The native Switch change was not discrete bubbling input.",
      );
      invariant(
        isHostObject(event.payload) && event.payload.value === true,
        "The native Switch change omitted its enabled boolean value.",
      );
      switchObservedSequence = event.observedSequence;
      switchChangeObserved = true;
      resolveSwitchChange?.();
    } catch (error) {
      reportFatal(error);
    }
  };

  const handleSwitchValueChange = (value: boolean): void => {
    try {
      invariant(value, "The Switch value callback omitted the enabled state.");
      switchValueObserved = true;
      setSwitchStatus(SWITCH_SUCCEEDED_TEXT);
      resolveSwitchValue?.();
    } catch (error) {
      reportFatal(error);
    }
  };

  const handleModalShow = (event: NativeSyntheticEvent): void => {
    try {
      invariant(
        event.name === "show" && event.priority === "default" && !event.bubbles,
        "The native Modal show event had invalid semantics.",
      );
      modalShowObservedSequence = event.observedSequence;
      modalShowObserved = true;
      setModalStatus(MODAL_SHOWN_TEXT);
      resolveModalShow?.();
    } catch (error) {
      reportFatal(error);
    }
  };

  const handleModalRequestClose = (event: NativeSyntheticEvent): void => {
    try {
      invariant(
        event.name === "requestClose" &&
          event.priority === "default" &&
          !event.bubbles,
        "The native Modal close request had invalid semantics.",
      );
      modalRequestCloseObservedSequence = event.observedSequence;
      modalRequestCloseObserved = true;
      setModalVisible(false);
      resolveModalRequestClose?.();
    } catch (error) {
      reportFatal(error);
    }
  };

  const handleModalDismiss = (event: NativeSyntheticEvent): void => {
    try {
      invariant(
        event.name === "dismiss" &&
          event.priority === "default" &&
          !event.bubbles,
        "The native Modal dismissal had invalid semantics.",
      );
      modalDismissObservedSequence = event.observedSequence;
      modalDismissObserved = true;
      resolveModalDismiss?.();
    } catch (error) {
      reportFatal(error);
    }
  };

  const handleModalClosePress = (event: NativeSyntheticEvent): void => {
    try {
      invariant(
        event.name === "press" &&
          event.priority === "discrete" &&
          event.bubbles,
        "The native Modal close press had invalid semantics.",
      );
      modalDismissalRequestObservedSequence = event.observedSequence;
      setModalVisible(false);
      resolveModalDismissalRequest?.();
    } catch (error) {
      reportFatal(error);
    }
  };

  const handleModalPresentationPress = (event: NativeSyntheticEvent): void => {
    try {
      invariant(
        event.name === "press" &&
          event.priority === "discrete" &&
          event.bubbles,
        "The native Modal presentation press had invalid semantics.",
      );
      modalPresentationObservedSequence = event.observedSequence;
      setModalHandoffReady(false);
      setModalVisible(true);
      resolveModalPresentationRequest?.();
    } catch (error) {
      reportFatal(error);
    }
  };

  const handleNavigationTransitionEnd = (event: NativeSyntheticEvent): void => {
    try {
      invariant(
        event.name === "transitionEnd",
        "The native stack emitted an invalid transition event.",
      );
      invariant(
        event.priority === "default" && !event.bubbles,
        "The native stack transition was not a default-priority direct event.",
      );
      if (event.observedSequence >= proofSequence(9)) {
        resolveDeepLinkPush?.();
      } else if (event.observedSequence >= proofSequence(7)) {
        resolveNavigationPush?.();
      }
    } catch (error) {
      reportFatal(error);
    }
  };

  const handleScreenLifecycle = (
    entry: NativeHistoryEntry,
    event: NativeSyntheticEvent,
  ): void => {
    try {
      invariant(
        event.name === "focus" || event.name === "blur",
        "The native screen emitted an invalid lifecycle event.",
      );
      invariant(
        event.priority === "default" && !event.bubbles,
        "The native screen lifecycle was not a default-priority direct event.",
      );
      const lifecycle: NavigationScreenLifecycle = {
        entryId: entry.id,
        href: entry.href,
        name: event.name,
        observedSequence: event.observedSequence,
      };
      screenLifecycleEvents.push(lifecycle);
      console.log("SOLID_NATIVE_SCREEN_LIFECYCLE", JSON.stringify(lifecycle));
    } catch (error) {
      reportFatal(error);
    }
  };

  const handleNavigationPlatformBack = (
    transition: NativeNavigationTransition,
  ): void => {
    resolveNavigationPlatformBack?.(transition);
  };

  application = startApplication(
    () => {
      const asyncLabel = createMemo(() => asyncContent);
      const appState = createAppState(NativePlatform);
      const keyboard = createKeyboard(NativePlatform);
      createComponent(StatusBar, {
        source: NativePlatform,
        barStyle: "auto",
        hidden: false,
      });
      let keyboardWasVisible = false;
      effect(
        () => ({ visible: keyboard.visible(), metrics: keyboard.metrics() }),
        (state) => {
          if (state.visible) {
            invariant(
              state.metrics !== undefined &&
                state.metrics.width > 0 &&
                state.metrics.height > 0,
              "The visible native keyboard omitted positive screen metrics.",
            );
            keyboardWasVisible = true;
            resolveKeyboardShown?.();
            return;
          }
          if (keyboardWasVisible) resolveKeyboardHidden?.();
        },
      );
      const notificationEvent = createNotificationEvent(notificationService, {
        onError: reportFatal,
      });
      const cameraSessionEvent = createCameraSessionEvent(
        cameraPreviewSession,
        {
          onError: reportFatal,
        },
      );
      effect(
        () => notificationEvent(),
        (event) => {
          if (event?.notificationId !== NOTIFICATION_PROOF_ID) return;
          if (event.kind === "delivered") {
            setNotificationStatus(NOTIFICATION_DELIVERED_TEXT);
            resolveNotificationDelivery?.();
            return;
          }
          if (event.kind === "pressed") {
            invariant(
              event.actionId === "default",
              "The notification body press used an unexpected action.",
            );
            setNotificationStatus(NOTIFICATION_PRESSED_TEXT);
            resolveNotificationPress?.();
          }
        },
      );
      let didObserveCameraSessionStart = false;
      effect(
        () => cameraSessionEvent(),
        (event) => {
          if (event?.kind !== "started" || didObserveCameraSessionStart) return;
          didObserveCameraSessionStart = true;
          setCameraSessionStatus(CAMERA_SESSION_STARTED_TEXT);
          resolveCameraSessionStarted?.();
        },
      );
      createNativeNavigationBindings(navigation, NativePlatform, {
        hardwareBack: {
          onTransition: (transition) => {
            resolveNavigationPlatformBack?.(transition);
          },
          onError: reportFatal,
        },
        deepLinks: {
          resolve: resolveNavigationURL,
          onTransition: (transition) => {
            resolveDeepLink?.(transition);
          },
          onError: reportFatal,
        },
      });
      effect(
        () => cameraSessionRequested(),
        (requested) => {
          if (!requested || ownedCameraSession !== undefined) return;
          ownedCameraSession = createOwnedCameraSession(requireNativeCamera(), {
            position: "back",
            onError: reportFatal,
          });
          resolveCameraSessionOwner?.(ownedCameraSession);
        },
      );
      let didLeaveForeground = false;
      let didObserveAppState = false;
      effect(
        () => appState(),
        (state) => {
          if (!appStateProofArmed) {
            // Permission and camera setup can transiently change AppState.
            // Only the explicit post-ready hardware lifecycle round trip is
            // part of the deterministic commit-sequence proof.
            didLeaveForeground = false;
            return;
          }
          if (state !== "active") {
            didLeaveForeground = true;
            return;
          }
          if (!didLeaveForeground || didObserveAppState) return;
          didObserveAppState = true;
          setStatus(LIFECYCLE_READY_TEXT);
          void Promise.resolve().then(completeAppStateProof).catch(reportFatal);
        },
      );
      renderPhysicalRoute = () => {
        const { entry, isFocused } = useTanStackNativeScreen();
        const renderCameraPreview = () => {
          const CameraPreview = cameraPreviewComponent();
          const session = cameraPreviewSession();
          if (CameraPreview === undefined || session === undefined) return null;
          return createComponent(CameraPreview, {
            session,
            accessible: true,
            accessibilityLabel: "Solid Native live camera preview",
            resizeMode: "cover",
            implementationMode: "compatible",
            testID: "solid-native-camera-preview",
            style: {
              backgroundColor: "#0f172a",
              borderRadius: 10,
              height: 160,
              marginBottom: 16,
            },
          });
        };
        createTanStackNativeScreenFocusEffect(() => {
          const entryId = entry().id;
          invariant(
            !activeNavigationFocusScopes.has(entryId),
            "A native screen started duplicate focus work.",
          );
          activeNavigationFocusScopes.add(entryId);
          navigationFocusScopeSetups++;
          return () => {
            invariant(
              activeNavigationFocusScopes.delete(entryId),
              "A native screen cleaned up inactive focus work.",
            );
            navigationFocusScopeCleanups++;
          };
        });
        return (
          entry().href === "/detail" ? (
            <View
              ref={(node) => {
                navigationDetail = node;
              }}
              style={{ flex: 1, padding: 24 }}
            >
              <Text
                accessibilityRole="header"
                testID="solid-native-navigation-detail"
                style={{ color: "#111111", fontSize: 24, marginBottom: 16 }}
              >
                {NAVIGATION_DETAIL_TEXT}
              </Text>
              <CausalComputation name={NAVIGATION_FOCUS_COMPUTATION_NAME}>
                <Text
                  testID="solid-native-navigation-focus"
                  style={{ color: "#166534", fontSize: 15, marginBottom: 12 }}
                >
                  {isFocused() ? SCREEN_FOCUSED_TEXT : SCREEN_BLURRED_TEXT}
                </Text>
              </CausalComputation>
              <Text
                testID="solid-native-navigation-back-instruction"
                style={{ color: "#334155", fontSize: 17 }}
              >
                {NAVIGATION_BACK_TEXT}
              </Text>
              <Text
                testID="solid-native-navigation-image-proof"
                style={{ color: "#166534", fontSize: 15, marginTop: 20 }}
              >
                {IMAGE_READY_TEXT}
              </Text>
              <Text
                testID="solid-native-navigation-scroll-proof"
                style={{ color: "#166534", fontSize: 15, marginTop: 8 }}
              >
                {SCROLL_READY_TEXT}
              </Text>
            </View>
          ) : entry().href === "/deep-link" ? (
            <View
              ref={(node) => {
                deepLinkDetail = node;
              }}
              style={{ flex: 1, padding: 24 }}
            >
              <Text
                accessibilityRole="header"
                testID="solid-native-deep-link-detail"
                style={{ color: "#111111", fontSize: 24, marginBottom: 16 }}
              >
                {DEEP_LINK_TEXT}
              </Text>
              <CausalComputation name={NAVIGATION_FOCUS_COMPUTATION_NAME}>
                <Text
                  testID="solid-native-navigation-focus"
                  style={{ color: "#166534", fontSize: 15, marginBottom: 12 }}
                >
                  {isFocused() ? SCREEN_FOCUSED_TEXT : SCREEN_BLURRED_TEXT}
                </Text>
              </CausalComputation>
              <Text
                testID="solid-native-deep-link-url"
                style={{ color: "#334155", fontSize: 15 }}
              >
                {DEEP_LINK_URL}
              </Text>
              {textInputReady() ? (
                <>
                  <CausalComputation name={TEXT_INPUT_VALUE_COMPUTATION_NAME}>
                    <TextInput
                      ref={(node) => {
                        textInput = node;
                      }}
                      accessible
                      accessibilityLabel="Solid Native text input"
                      testID="solid-native-text-input"
                      value={textInputValue()}
                      selection={textInputSelection()}
                      placeholder="Type SolidNative42"
                      returnKeyType="done"
                      submitBehavior="blurAndSubmit"
                      onFocus={handleTextInputFocus}
                      onChange={handleTextInputChange}
                      onChangeText={handleTextInputChangeText}
                      onSelectionChange={handleTextInputSelectionChange}
                      onSubmitEditing={handleTextInputSubmit}
                      onBlur={handleTextInputBlur}
                      style={{
                        borderColor: "#64748b",
                        borderRadius: 8,
                        borderWidth: 1,
                        color: "#111111",
                        fontSize: 17,
                        height: 48,
                        marginTop: 20,
                        padding: 10,
                      }}
                    />
                    <Text
                      testID="solid-native-text-input-value"
                      style={{
                        color: "#334155",
                        fontSize: 15,
                        marginTop: 10,
                      }}
                    >
                      {textInputValue() || TEXT_INPUT_PENDING_TEXT}
                    </Text>
                  </CausalComputation>
                  <Text
                    testID="solid-native-text-input-selection"
                    style={{
                      color: "#334155",
                      fontSize: 15,
                      marginTop: 8,
                    }}
                  >
                    {textInputSelectionStatus()}
                  </Text>
                  <CausalComputation name={TEXT_INPUT_SUBMIT_COMPUTATION_NAME}>
                    <Text
                      testID="solid-native-text-input-submit"
                      style={{
                        color: "#334155",
                        fontSize: 15,
                        marginTop: 8,
                      }}
                    >
                      {textInputSubmitStatus()}
                    </Text>
                  </CausalComputation>
                </>
              ) : null}
              {multilineTextInputReady() ? (
                <>
                  <Text
                    testID="solid-native-text-input-submit"
                    style={{ color: "#334155", fontSize: 15, marginTop: 8 }}
                  >
                    {textInputSubmitStatus()}
                  </Text>
                  <CausalComputation name={SWITCH_CONTROLLED_COMPUTATION_NAME}>
                    <Switch
                      ref={(node) => {
                        nativeSwitch = node;
                      }}
                      accessible
                      accessibilityLabel="Solid Native controlled switch"
                      iosBackgroundColor="#cbd5e1"
                      onChange={handleSwitchChange}
                      onValueChange={handleSwitchValueChange}
                      testID="solid-native-switch"
                      thumbColor="#ffffff"
                      trackColor={{ false: "#64748b", true: "#146ef5" }}
                      value={false}
                      style={{ marginTop: 12 }}
                    />
                  </CausalComputation>
                  <Text
                    testID="solid-native-switch-status"
                    style={{ color: "#334155", fontSize: 15, marginTop: 8 }}
                  >
                    {switchStatus()}
                  </Text>
                  {modalHandoffReady() ? (
                    <Pressable
                      accessible
                      accessibilityRole="button"
                      accessibilityLabel={MODAL_PRESENT_LABEL}
                      testID="solid-native-modal-present"
                      onPress={handleModalPresentationPress}
                      style={{
                        backgroundColor: "#146ef5",
                        borderRadius: 10,
                        marginTop: 10,
                        padding: 12,
                      }}
                    >
                      <Text style={{ color: "#ffffff", fontSize: 16 }}>
                        {MODAL_PRESENT_LABEL}
                      </Text>
                    </Pressable>
                  ) : null}
                  <CausalComputation
                    name={MULTILINE_TEXT_INPUT_COMPUTATION_NAME}
                  >
                    <TextInput
                      ref={(node) => {
                        multilineTextInput = node;
                      }}
                      accessible
                      accessibilityLabel="Solid Native multiline text input"
                      testID="solid-native-multiline-text-input"
                      value={multilineTextInputValue()}
                      multiline
                      placeholder="Type Solid, return, Native"
                      submitBehavior="newline"
                      onFocus={handleMultilineTextInputFocus}
                      onChange={handleMultilineTextInputChange}
                      onChangeText={handleMultilineTextInputChangeText}
                      onContentSizeChange={
                        handleMultilineTextInputContentSizeChange
                      }
                      onKeyPress={handleMultilineTextInputKeyPress}
                      onSubmitEditing={handleMultilineTextInputSubmit}
                      onBlur={handleMultilineTextInputBlur}
                      style={{
                        borderColor: "#64748b",
                        borderRadius: 8,
                        borderWidth: 1,
                        color: "#111111",
                        fontSize: 17,
                        marginTop: 12,
                        minHeight: 44,
                        padding: 10,
                        textAlignVertical: "top",
                      }}
                    />
                    <Text
                      testID="solid-native-multiline-text-input-value"
                      style={{
                        color: "#334155",
                        fontSize: 15,
                        marginTop: 10,
                      }}
                    >
                      {multilineTextInputValue() ||
                        MULTILINE_TEXT_INPUT_PENDING_TEXT}
                    </Text>
                  </CausalComputation>
                  <Text
                    testID="solid-native-multiline-text-input-status"
                    style={{
                      color: "#334155",
                      fontSize: 15,
                      marginTop: 8,
                    }}
                  >
                    {multilineTextInputStatus()}
                  </Text>
                </>
              ) : null}
            </View>
          ) : (
            <View style={{ padding: 20 }}>
              <Text
                accessibilityRole="header"
                testID="solid-native-title"
                style={{ color: "#111111", fontSize: 24, marginBottom: 12 }}
              >
                Solid Native physical integration
              </Text>
              <CausalComputation name={NAVIGATION_FOCUS_COMPUTATION_NAME}>
                <Text
                  testID="solid-native-navigation-focus"
                  style={{ color: "#166534", fontSize: 15, marginBottom: 12 }}
                >
                  {isFocused() ? SCREEN_FOCUSED_TEXT : SCREEN_BLURRED_TEXT}
                </Text>
              </CausalComputation>
              <CausalComputation name={APP_STATE_COMPUTATION_NAME}>
                <Text
                  testID="solid-native-status"
                  style={{
                    color: "#333333",
                    fontSize: 17,
                    marginBottom: 16,
                    minHeight: 48,
                  }}
                >
                  {status()}
                </Text>
              </CausalComputation>
              <Loading
                fallback={
                  <Text
                    testID="solid-native-async-loading"
                    style={{
                      color: "#7c2d12",
                      fontSize: 16,
                      marginBottom: 16,
                    }}
                  >
                    {ASYNC_LOADING_TEXT}
                  </Text>
                }
              >
                <Text
                  testID="solid-native-async-ready"
                  style={{
                    color: "#166534",
                    fontSize: 16,
                    marginBottom: 16,
                  }}
                >
                  {asyncLabel()}
                </Text>
              </Loading>
              <CausalComputation name={IMAGE_STATUS_COMPUTATION_NAME}>
                <Text
                  testID="solid-native-image-status"
                  style={{ color: "#334155", fontSize: 15, marginBottom: 8 }}
                >
                  {imageStatus()}
                </Text>
              </CausalComputation>
              <Image
                ref={(node) => {
                  image = node;
                }}
                accessible
                accessibilityRole="image"
                accessibilityLabel="Solid Native decoded image"
                accessibilityHint="Decoded by the native image component"
                testID="solid-native-image"
                source={IMAGE_DATA_URI}
                resizeMode="contain"
                onLoad={handleImageLoad}
                onError={(event) => {
                  reportFatal(
                    new Error(
                      `The native Image emitted an error: ${JSON.stringify(event.payload)}.`,
                    ),
                  );
                }}
                style={{
                  backgroundColor: "#fef3c7",
                  borderRadius: 8,
                  height: 40,
                  marginBottom: 12,
                  width: 40,
                }}
              />
              <ActivityIndicator
                ref={(node) => {
                  activityIndicator = node;
                }}
                accessible
                accessibilityLabel="Solid Native activity indicator"
                animating={false}
                color="#146ef5"
                hidesWhenStopped={false}
                size="large"
                testID="solid-native-activity-indicator"
                style={{ marginBottom: 12 }}
              />
              <Pressable
                accessible
                accessibilityRole="button"
                accessibilityLabel={RESOURCE_PROOF_START_LABEL}
                accessibilityHint="Starts notification, camera, and interactive physical-device checks"
                testID="solid-native-resource-proof-start"
                onPress={handleResourceProofStart}
                style={{
                  backgroundColor: "#b45309",
                  borderRadius: 10,
                  marginBottom: 16,
                  padding: 14,
                }}
              >
                <Text style={{ color: "#ffffff", fontSize: 18 }}>
                  {RESOURCE_PROOF_START_LABEL}
                </Text>
              </Pressable>
              <GeneratedView
                ref={(node) => {
                  generatedView = node;
                }}
                accessible
                accessibilityLabel="Solid Native generated Fabric component"
                testID="solid-native-generated-view"
                label="Generated Fabric component"
                style={{
                  backgroundColor: "#5b21b6",
                  borderRadius: 10,
                  height: 48,
                  marginBottom: 16,
                }}
              />
              <CausalComputation name={CAMERA_PREVIEW_COMPUTATION_NAME}>
                {renderCameraPreview()}
              </CausalComputation>
              <CausalComputation name={CAMERA_CAPTURE_COMPUTATION_NAME}>
                {cameraCaptureStatus() === undefined ? null : (
                  <Text testID="solid-native-camera-capture">
                    {cameraCaptureStatus()}
                  </Text>
                )}
              </CausalComputation>
              <CausalComputation name={CAMERA_SESSION_COMPUTATION_NAME}>
                <Text testID="solid-native-camera-session-status">
                  {cameraSessionStatus()}
                </Text>
              </CausalComputation>
              <CausalComputation name={NOTIFICATION_COMPUTATION_NAME}>
                <Text testID="solid-native-notification-status">
                  {notificationStatus()}
                </Text>
              </CausalComputation>
              <Pressable
                ref={(node) => {
                  pressable = node;
                }}
                accessible
                accessibilityRole="button"
                accessibilityLabel="Run Solid signal update"
                accessibilityHint="Runs the Solid signal update proof"
                accessibilityState={{ disabled: false }}
                testID="solid-native-signal-button"
                onPress={handlePress}
                style={{
                  backgroundColor: "#146ef5",
                  borderRadius: 10,
                  padding: 14,
                }}
              >
                <Text style={{ color: "#ffffff", fontSize: 18 }}>
                  Run Solid signal update
                </Text>
              </Pressable>
              <CausalComputation name={SCROLL_STATUS_COMPUTATION_NAME}>
                <Text
                  testID="solid-native-scroll-status"
                  style={{ color: "#334155", fontSize: 15, marginTop: 12 }}
                >
                  {scrollStatus()}
                </Text>
              </CausalComputation>
              <CausalComputation name={SCROLL_VIEW_COMPUTATION_NAME}>
                <ScrollView
                  ref={(node) => {
                    scrollView = node;
                  }}
                  testID="solid-native-scroll-view"
                  scrollEventThrottle={16}
                  showsVerticalScrollIndicator
                  onScroll={handleScroll}
                  style={{
                    backgroundColor: "#e2e8f0",
                    borderRadius: 8,
                    flexGrow: 0,
                    flexShrink: 0,
                    height: 96,
                    marginTop: 8,
                  }}
                  contentContainerStyle={{ minHeight: 320, padding: 12 }}
                >
                  <Text style={{ color: "#0f172a", fontSize: 15 }}>
                    Solid owns this native scroll tree
                  </Text>
                  <View style={{ height: 240 }} />
                  <Text style={{ color: "#0f172a", fontSize: 15 }}>
                    Native command destination
                  </Text>
                </ScrollView>
              </CausalComputation>
            </View>
          )
        ) as NativeNode;
      };
      return (
        <CausalOwner name="e2e.root">
          <TanStackNativeRouterProvider
            router={navigationRouter}
            onReady={() => {
              console.log("SOLID_NATIVE_TANSTACK_ROUTER_READY");
            }}
            onError={reportFatal}
          >
            {
              (
                <TanStackNativeStack
                  router={navigationRouter}
                  history={navigation}
                  onTransitionEnd={handleNavigationTransitionEnd}
                  onScreenFocus={handleScreenLifecycle}
                  onScreenBlur={handleScreenLifecycle}
                  onPlatformBack={handleNavigationPlatformBack}
                  renderHeader={(entry) =>
                    (
                      <ScreenHeader
                        title={
                          entry().href === "/detail"
                            ? NAVIGATION_DETAIL_HEADER_TEXT
                            : entry().href === "/deep-link"
                              ? "Solid Native link"
                              : "Solid Native"
                        }
                        backgroundColor="#ffffff"
                        color="#166534"
                        titleColor="#111111"
                        backButtonDisplayMode="minimal"
                        hideShadow
                      />
                    ) as NativeNode
                  }
                  renderUnresolved={(entry) =>
                    (
                      <View style={{ flex: 1, padding: 24 }}>
                        <Text style={{ color: "#334155", fontSize: 17 }}>
                          Loading native route {entry().href}
                        </Text>
                      </View>
                    ) as NativeNode
                  }
                  style={{ backgroundColor: "#ffffff" }}
                  screenOptions={() => ({
                    style: { backgroundColor: "#ffffff" },
                  })}
                />
              ) as NativeNode
            }
          </TanStackNativeRouterProvider>
          <CausalComputation name={MODAL_LIFECYCLE_COMPUTATION_NAME}>
            <Modal
              visible={modalVisible()}
              transparent
              animationType="fade"
              presentationStyle="overFullScreen"
              onShow={handleModalShow}
              onRequestClose={handleModalRequestClose}
              onDismiss={handleModalDismiss}
              testID="solid-native-modal"
              style={{ justifyContent: "center", padding: 24 }}
            >
              <View
                accessible
                accessibilityLabel="Solid Native modal content"
                style={{
                  backgroundColor: "#ffffff",
                  borderRadius: 16,
                  padding: 24,
                }}
              >
                <Text
                  accessibilityRole="header"
                  testID="solid-native-modal-title"
                  style={{ color: "#111111", fontSize: 22, marginBottom: 12 }}
                >
                  {MODAL_TITLE_TEXT}
                </Text>
                <Text
                  testID="solid-native-modal-status"
                  style={{ color: "#334155", fontSize: 16, marginBottom: 20 }}
                >
                  {modalStatus()}
                </Text>
                <Pressable
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={MODAL_CLOSE_LABEL}
                  testID="solid-native-modal-close"
                  onPress={handleModalClosePress}
                  style={{
                    backgroundColor: "#146ef5",
                    borderRadius: 10,
                    padding: 14,
                  }}
                >
                  <Text style={{ color: "#ffffff", fontSize: 17 }}>
                    {MODAL_CLOSE_LABEL}
                  </Text>
                </Pressable>
              </View>
            </Modal>
          </CausalComputation>
        </CausalOwner>
      );
    },
    host,
    {
      surface: {
        name: "native-e2e",
        initialProps: {
          style: {
            backgroundColor: "#ffffff",
            flex: 1,
            paddingTop: 72,
          },
        },
      },
      autoCommit: false,
      telemetry,
      requirements: {
        capabilities: [
          "bubblingEvents",
          "commitMountEvents",
          "synchronousMeasurement",
        ],
        components: [
          "ActivityIndicator",
          "Image",
          "Modal",
          "Pressable",
          "Screen",
          "ScreenStack",
          "ScrollView",
          "SolidNativeGeneratedView",
          "Switch",
          "Text",
          "TextInput",
          "View",
        ],
      },
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
  const mount = await application.root.flush();
  invariant(
    mount?.sequence === 1,
    "The initial Solid tree did not produce commit 1.",
  );
  invariant(
    Number.isSafeInteger(mount.hostRevision),
    "The initial Solid tree did not return a Fabric revision.",
  );
  const lifecycle = await waitForMount(mountEvents, 1);
  invariant(
    lifecycle.hostRevision === mount.hostRevision &&
      lifecycle.commitStartedAt >= 0 &&
      lifecycle.mountedAt >= 0 &&
      lifecycle.mountLatency >= 0,
    "The initial Fabric mount lifecycle event was invalid.",
  );
  const frame = await waitForFrame(frameEvents, 1);
  invariant(
    frame.hostRevision === mount.hostRevision &&
      frame.mountedAt >= lifecycle.mountedAt &&
      frame.frameStartedAt >= frame.mountedAt &&
      frame.frameLatency >= lifecycle.mountLatency &&
      frame.mountToFrameLatency >= 0,
    "The initial platform frame lifecycle event was invalid.",
  );

  let rootMount = mount;
  let rootLifecycle = lifecycle;
  let rootFrame = frame;
  if (coldStart) {
    await waitForScreenLifecycle(
      screenLifecycleEvents,
      0,
      "/deep-link",
      "focus",
      1,
    );
    const coldFocusUpdate = await application.root.flush();
    invariant(
      coldFocusUpdate?.sequence === proofSequence(1),
      "The cold-start screen focus did not produce commit 2.",
    );
    invariant(
      Number.isSafeInteger(coldFocusUpdate.hostRevision),
      "The cold-start screen focus did not return a Fabric revision.",
    );
    await waitForMount(mountEvents, coldFocusUpdate.sequence);
    proofCommitOffset++;
    invariant(
      launch.initialURL === DEEP_LINK_URL &&
        navigation.location.href === "/deep-link" &&
        isHostObject(navigation.location.state) &&
        navigation.location.state.url === DEEP_LINK_URL &&
        navigation.snapshot.entries.length === 1 &&
        !navigation.canGoBack &&
        navigation.pendingApplicationTransitionCount === 0,
      "The cold-start deep link did not create an isolated launch stack.",
    );
    const coldStartTarget = deepLinkDetail;
    invariant(
      coldStartTarget !== undefined,
      "The cold-start deep-link ref was not assigned.",
    );
    const coldStartMeasurement = await coldStartTarget.measure();
    invariant(
      coldStartMeasurement.observedSequence === coldFocusUpdate.sequence &&
        coldStartMeasurement.width > 0 &&
        coldStartMeasurement.height > 0,
      `The cold-start deep-link measurement was stale or empty: ${JSON.stringify(coldStartMeasurement)}.`,
    );
    console.log("SOLID_NATIVE_COLD_START_DEEP_LINK_SUCCEEDED");
    await delay(COLD_START_DISPLAY_MS);

    const coldRootLifecycleStart = screenLifecycleEvents.length;
    const resetTransition = navigation.reset([{ href: "/", state: null }]);
    await waitForRouterLocation("/");
    const coldRootMount = await application.root.flush();
    invariant(
      coldRootMount?.sequence === proofSequence(1),
      "The cold-start proof did not restore the root after its focus commit.",
    );
    invariant(
      Number.isSafeInteger(coldRootMount.hostRevision),
      "The cold-start root commit did not return a Fabric revision.",
    );
    await waitForMount(mountEvents, coldRootMount.sequence);
    await waitForFrame(frameEvents, coldRootMount.sequence);
    await waitForScreenLifecycle(
      screenLifecycleEvents,
      coldRootLifecycleStart,
      "/",
      "focus",
      coldRootMount.sequence,
    );
    const coldRootFocusUpdate = await application.root.flush();
    invariant(
      coldRootFocusUpdate?.sequence === coldRootMount.sequence + 1,
      "The cold-start root focus did not produce its reactive commit.",
    );
    invariant(
      Number.isSafeInteger(coldRootFocusUpdate.hostRevision),
      "The cold-start root focus did not return a Fabric revision.",
    );
    rootMount = coldRootFocusUpdate;
    rootLifecycle = await waitForMount(
      mountEvents,
      coldRootFocusUpdate.sequence,
    );
    rootFrame = await waitForFrame(frameEvents, coldRootFocusUpdate.sequence);
    proofCommitOffset++;
    navigation.acknowledgeApplicationTransition(resetTransition.id);
    const resetHref: string = navigation.location.href;
    invariant(
      resetHref === "/" &&
        navigation.snapshot.entries.length === 1 &&
        !navigation.canGoBack &&
        navigation.pendingApplicationTransitionCount === 0,
      "The cold-start proof left deep-link history behind the root.",
    );
    console.log("SOLID_NATIVE_COLD_START_RESET_SUCCEEDED");
  } else {
    await waitForScreenLifecycle(screenLifecycleEvents, 0, "/", "focus", 1);
    const rootFocusUpdate = await application.root.flush();
    invariant(
      rootFocusUpdate?.sequence === proofSequence(1) + 1,
      "The initial root focus did not produce commit 2.",
    );
    invariant(
      Number.isSafeInteger(rootFocusUpdate.hostRevision),
      "The initial root focus did not return a Fabric revision.",
    );
    rootMount = rootFocusUpdate;
    rootLifecycle = await waitForMount(mountEvents, rootFocusUpdate.sequence);
    rootFrame = await waitForFrame(frameEvents, rootFocusUpdate.sequence);
    proofCommitOffset++;
    console.log("SOLID_NATIVE_INITIAL_FOCUS_SUCCEEDED");
  }

  invariant(
    rootMount !== undefined &&
      rootLifecycle.hostRevision === rootMount.hostRevision &&
      rootFrame.hostRevision === rootMount.hostRevision,
    "The root screen did not reach matching mount and frame revisions.",
  );
  invariant(
    generatedView !== undefined,
    "The generated Fabric component ref was not assigned.",
  );
  const generatedMeasurement = await generatedView.measure();
  invariant(
    generatedMeasurement.observedSequence === proofSequence(1) &&
      generatedMeasurement.width > 0 &&
      generatedMeasurement.height > 0,
    `The generated Fabric component measurement was stale or empty: ${JSON.stringify(generatedMeasurement)}.`,
  );
  invariant(image !== undefined, "The Solid Image ref was not assigned.");
  const imageMeasurement = await image.measure();
  invariant(
    imageMeasurement.observedSequence === proofSequence(1) &&
      imageMeasurement.width > 0 &&
      imageMeasurement.height > 0,
    `The initial Image measurement was stale or empty: ${JSON.stringify(imageMeasurement)}.`,
  );
  invariant(
    activityIndicator !== undefined,
    "The Solid ActivityIndicator ref was not assigned.",
  );
  const activityIndicatorMeasurement = await activityIndicator.measure();
  invariant(
    activityIndicatorMeasurement.observedSequence === proofSequence(1) &&
      activityIndicatorMeasurement.width > 0 &&
      activityIndicatorMeasurement.height > 0,
    `The initial ActivityIndicator measurement was stale or empty: ${JSON.stringify(activityIndicatorMeasurement)}.`,
  );
  console.log("SOLID_NATIVE_ACTIVITY_INDICATOR_SUCCEEDED");
  invariant(
    pressable !== undefined,
    "The Solid Pressable ref was not assigned.",
  );
  const measurement = await pressable.measure();
  invariant(
    measurement.observedSequence === proofSequence(1) &&
      measurement.width > 0 &&
      measurement.height > 0,
    `The initial native measurement was stale or empty: ${JSON.stringify(measurement)}.`,
  );
  invariant(
    scrollView !== undefined,
    "The Solid ScrollView ref was not assigned.",
  );
  const initialScrollMeasurement = await scrollView.nativeNode.measure();
  invariant(
    initialScrollMeasurement.observedSequence === proofSequence(1) &&
      initialScrollMeasurement.width > 0 &&
      initialScrollMeasurement.height > 0,
    `The initial ScrollView measurement was stale or empty: ${JSON.stringify(initialScrollMeasurement)}.`,
  );
  // The default application is also our exhaustive hardware harness. Keep a
  // manual CLI/Xcode launch quiescent until a person or device runner
  // explicitly opts into notifications, a live camera session, and the long
  // interaction sequence. This prevents an unattended proof build from
  // becoming a persistent thermal workload.
  console.log("SOLID_NATIVE_QUIESCENT_READY");
  await resourceProofStarted;
  armResourceProofWatchdog();
  proveGeneratedStorageTurboModuleRuntime();
  const storage = await loadNativeStorage();
  await proveStorageTurboModule(storage);
  await storage.removeItem(NAVIGATION_STORAGE_KEY);
  navigationPersistence = createNativeHistoryPersistence(navigation, storage, {
    storageKey: NAVIGATION_STORAGE_KEY,
    onError: reportFatal,
  });
  const notifications = await loadNativeNotifications();
  // Allow the owner-bound accessor to observe the lazily installed service
  // before the native adapter can synchronously publish a foreground event.
  await Promise.resolve();
  await notifications.cancel(NOTIFICATION_PROOF_ID);
  const notificationPermission = await notifications.requestPermission();
  invariant(
    notificationPermission.authorization === "authorized" ||
      notificationPermission.authorization === "provisional",
    `Notification permission was not granted: ${notificationPermission.authorization}.`,
  );
  const notificationId = await notifications.display({
    id: NOTIFICATION_PROOF_ID,
    title: NOTIFICATION_PROOF_TITLE,
    body: NOTIFICATION_PROOF_BODY,
    channel: {
      id: "solid-native-proof",
      name: "Solid Native device proofs",
      importance: "default",
    },
  });
  invariant(
    notificationId === NOTIFICATION_PROOF_ID,
    "The native notification module returned the wrong notification id.",
  );
  await Promise.race([
    notificationDeliveryObserved,
    delay(PROOF_TIMEOUT_MS).then(() => {
      throw new Error(
        "The native notification module did not emit its foreground delivery event.",
      );
    }),
  ]);
  const notificationUpdate = await application.root.flush();
  invariant(
    notificationUpdate?.sequence === proofSequence(1) + 1,
    `The foreground notification did not produce commit ${String(proofSequence(1) + 1)}.`,
  );
  invariant(
    notificationUpdate.hostRevision !== undefined &&
      Number.isSafeInteger(notificationUpdate.hostRevision),
    "The foreground notification commit did not return a Fabric revision.",
  );
  await verifyPlatformEventCausality(
    telemetryRecords,
    mountEvents,
    frameEvents,
    notificationUpdate.sequence,
    notificationUpdate.hostRevision,
    "platform.notification.delivered",
    "default",
    "normal",
    NOTIFICATION_COMPUTATION_NAME,
    "Foreground notification delivery",
    NOTIFICATION_PROOF_ID,
    {
      runtimeName: binding.backend,
      runtimeVersion: binding.backendVersion,
      hostContractVersion: binding.contractVersion,
      platform: binding.platform,
    },
  );
  proofCommitOffset++;
  invariant(
    (await notifications.getDisplayedNotificationIds()).includes(
      NOTIFICATION_PROOF_ID,
    ),
    "The native notification module did not report its displayed proof value.",
  );
  console.log("SOLID_NATIVE_NOTIFICATION_DELIVERY_SUCCEEDED");
  console.log("SOLID_NATIVE_NOTIFICATION_CAUSALITY_SUCCEEDED");
  if (binding.platform === "android") {
    await Promise.race([
      notificationPressObserved,
      delay(PROOF_TIMEOUT_MS * 2).then(() => {
        throw new Error(
          "The Android notification body press did not reach its Solid owner.",
        );
      }),
    ]);
    const notificationPressUpdate = await application.root.flush();
    invariant(
      notificationPressUpdate?.sequence === proofSequence(1) + 1,
      `The notification press did not produce commit ${String(proofSequence(1) + 1)}.`,
    );
    invariant(
      notificationPressUpdate.hostRevision !== undefined &&
        Number.isSafeInteger(notificationPressUpdate.hostRevision),
      "The notification press commit did not return a Fabric revision.",
    );
    await verifyPlatformEventCausality(
      telemetryRecords,
      mountEvents,
      frameEvents,
      notificationPressUpdate.sequence,
      notificationPressUpdate.hostRevision,
      "platform.notification.pressed",
      "discrete",
      "user-blocking",
      NOTIFICATION_COMPUTATION_NAME,
      "Notification body press",
      NOTIFICATION_PROOF_ID,
      {
        runtimeName: binding.backend,
        runtimeVersion: binding.backendVersion,
        hostContractVersion: binding.contractVersion,
        platform: binding.platform,
      },
    );
    proofCommitOffset++;
    console.log("SOLID_NATIVE_NOTIFICATION_PRESS_CAUSALITY_SUCCEEDED");
  }
  const camera = await loadNativeCamera();
  const cameraPermission = await camera.requestPermission();
  invariant(
    cameraPermission.authorization === "authorized",
    `Camera permission was not granted: ${cameraPermission.authorization}.`,
  );
  console.log("SOLID_NATIVE_CAMERA_PERMISSION_SUCCEEDED");
  const cameraDevices = await camera.listDevices();
  invariant(
    cameraDevices.some((device) => device.position === "back"),
    "The native camera module did not enumerate a back camera.",
  );
  console.log("SOLID_NATIVE_CAMERA_DEVICES_SUCCEEDED");
  const cameraPreviewScope = application.root.createCausalScope(
    CAMERA_PREVIEW_TASK_NAME,
  );
  const cameraSession = await (async (): Promise<CameraSession> => {
    try {
      cameraPreviewScope.run(() => setCameraSessionRequested(true));
      await application.root.flush();
      const cameraSessionOwner = await Promise.race([
        cameraSessionOwnerCreated,
        delay(PROOF_TIMEOUT_MS).then(() => {
          throw new Error(
            "Solid did not create the owner-bound camera session.",
          );
        }),
      ]);
      const session = await Promise.race([
        cameraSessionOwner.ready,
        delay(PROOF_TIMEOUT_MS * 2).then(() => {
          throw new Error("The native camera session did not start.");
        }),
      ]);
      await application.root.flush();
      invariant(
        cameraSessionOwner.state() === "running" &&
          session.device.position === "back",
        "The owner-bound native camera session did not enter its running state.",
      );
      // Reserve the extra proof commit before exposing native UI that can let
      // the device runner advance and deliver lifecycle events concurrently.
      proofCommitOffset++;
      cameraPreviewScope.run(() => setCameraPreviewSession(session));
      const cameraPreviewUpdate = await application.root.flush();
      invariant(
        cameraPreviewUpdate !== undefined &&
          typeof cameraPreviewUpdate.hostRevision === "number" &&
          Number.isSafeInteger(cameraPreviewUpdate.hostRevision),
        "The Solid-owned camera preview did not produce a Fabric commit.",
      );
      cameraPreviewScope.finish();
      await verifyCameraOutputCausality(
        telemetryRecords,
        mountEvents,
        frameEvents,
        cameraPreviewUpdate.sequence,
        cameraPreviewUpdate.hostRevision,
        CAMERA_PREVIEW_TASK_NAME,
        CAMERA_PREVIEW_COMPUTATION_NAME,
        "Camera preview",
        {
          runtimeName: binding.backend,
          runtimeVersion: binding.backendVersion,
          hostContractVersion: binding.contractVersion,
          platform: binding.platform,
        },
      );
      return session;
    } catch (error) {
      if (cameraPreviewScope.state === "active") cameraPreviewScope.fail(error);
      throw error;
    }
  })();
  console.log("SOLID_NATIVE_CAMERA_PREVIEW_CAUSALITY_SUCCEEDED");
  console.log("SOLID_NATIVE_CAMERA_PREVIEW_SUCCEEDED");
  await Promise.race([
    cameraSessionStartedObserved,
    delay(PROOF_TIMEOUT_MS).then(() => {
      throw new Error(
        "The mounted native camera preview did not emit a started session event.",
      );
    }),
  ]);
  const cameraSessionStartedUpdate = await application.root.flush();
  invariant(
    cameraSessionStartedUpdate !== undefined &&
      typeof cameraSessionStartedUpdate.hostRevision === "number" &&
      Number.isSafeInteger(cameraSessionStartedUpdate.hostRevision),
    "The native camera started event did not produce a Solid-owned Fabric commit.",
  );
  await verifyPlatformEventCausality(
    telemetryRecords,
    mountEvents,
    frameEvents,
    cameraSessionStartedUpdate.sequence,
    cameraSessionStartedUpdate.hostRevision,
    "platform.camera.session.started",
    "default",
    "normal",
    CAMERA_SESSION_COMPUTATION_NAME,
    "Camera session start",
    undefined,
    {
      runtimeName: binding.backend,
      runtimeVersion: binding.backendVersion,
      hostContractVersion: binding.contractVersion,
      platform: binding.platform,
    },
  );
  proofCommitOffset++;
  console.log("SOLID_NATIVE_CAMERA_SESSION_EVENT_CAUSALITY_SUCCEEDED");
  const cameraCaptureScope = application.root.createCausalScope(
    CAMERA_CAPTURE_TASK_NAME,
  );
  try {
    const cameraPhoto = await Promise.race([
      cameraSession.capturePhoto({
        flashMode: "off",
        enableShutterSound: false,
      }),
      delay(PROOF_TIMEOUT_MS * 2).then(() => {
        throw new Error("The native camera did not capture a photo.");
      }),
    ]);
    invariant(
      cameraPhoto.width > 0 &&
        cameraPhoto.height > 0 &&
        cameraPhoto.containerFormat === "jpeg" &&
        cameraPhoto.filePath.length > 0 &&
        Number.isFinite(cameraPhoto.timestamp),
      "The native camera returned invalid captured-photo metadata.",
    );
    proofCommitOffset++;
    // The mounted capture text is the device runner's license to background
    // the app. Arm AppState before publishing that checkpoint so a fast
    // accessibility observer cannot deliver the lifecycle round trip in the
    // gap between mount and causal frame verification.
    appStateProofArmed = true;
    cameraCaptureScope.run(() => setCameraCaptureStatus(CAMERA_CAPTURE_TEXT));
    const cameraCaptureUpdate = await application.root.flush();
    invariant(
      cameraCaptureUpdate !== undefined &&
        typeof cameraCaptureUpdate.hostRevision === "number" &&
        Number.isSafeInteger(cameraCaptureUpdate.hostRevision),
      "The camera capture result did not produce a Solid-owned Fabric commit.",
    );
    cameraCaptureScope.finish();
    await verifyCameraOutputCausality(
      telemetryRecords,
      mountEvents,
      frameEvents,
      cameraCaptureUpdate.sequence,
      cameraCaptureUpdate.hostRevision,
      CAMERA_CAPTURE_TASK_NAME,
      CAMERA_CAPTURE_COMPUTATION_NAME,
      "Camera capture",
      {
        runtimeName: binding.backend,
        runtimeVersion: binding.backendVersion,
        hostContractVersion: binding.contractVersion,
        platform: binding.platform,
      },
    );
  } catch (error) {
    if (cameraCaptureScope.state === "active") cameraCaptureScope.fail(error);
    throw error;
  }
  console.log("SOLID_NATIVE_CAMERA_CAPTURE_CAUSALITY_SUCCEEDED");
  console.log("SOLID_NATIVE_CAUSAL_COMPUTATION_SUCCEEDED");
  console.log("SOLID_NATIVE_RUNTIME_RESOURCE_SUCCEEDED");
  console.log("SOLID_NATIVE_CAUSAL_OWNER_SUCCEEDED");
  console.log("SOLID_NATIVE_CAUSAL_SCOPE_SUCCEEDED");
  console.log("SOLID_NATIVE_CAMERA_CAPTURE_SUCCEEDED");
  console.log("SOLID_NATIVE_CAMERA_SESSION_SUCCEEDED");
  console.log("SOLID_NATIVE_CODEGEN_COMPONENT_SUCCEEDED");
  console.log("SOLID_NATIVE_MOUNT_LIFECYCLE_SUCCEEDED");
  console.log("SOLID_NATIVE_FRAME_SUCCEEDED");
  console.log("SOLID_NATIVE_E2E_READY");
}

void run().catch(reportFatal);
