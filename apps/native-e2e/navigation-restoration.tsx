/** @jsxImportSource @solid-native/core */
import "react-native/setup-env";

import {
  CORE_COMPONENT_DESCRIPTORS,
  Pressable,
  ScreenHeader,
  ScreenHeaderSubview,
  Text,
  View,
  type NativeNode,
} from "@solid-native/core";
import {
  createHardwareBackHandler,
  createNativeHistoryFromStorage,
  createNativeHistoryPersistence,
  createNativeScrollRestorationFromStorage,
  createNativeScrollRestorationPersistence,
  createTanStackNativeScreenAccessibilityFocus,
  createTanStackNativeScreenFocusTask,
  createTanStackNativeHistory,
  createTanStackNativeMemoryPolicy,
  createTanStackNativeRouter,
  deserializeNativeHistorySnapshot,
  deserializeNativeScrollRestorationSnapshot,
  serializeNativeHistorySnapshot,
  serializeNativeScrollRestorationSnapshot,
  TanStackNativeLink,
  TanStackNativeOutlet,
  TanStackNativeRouterProvider,
  TanStackNativeScrollView,
  TanStackNativeStack,
  TanStackRootRoute,
  TanStackRoute,
  tanStackRedirect,
  useTanStackNativeLoaderData,
  useTanStackNativeNavigate,
  useTanStackNativeScreen,
} from "@solid-native/navigation";
import {
  createSampledCausalTelemetry,
  type CausalTelemetryRecord,
} from "@solid-native/observability";
import {
  createSignal,
  effect,
  type NativeApplication,
} from "@solid-native/renderer";
import {
  createNativeFabricHost,
  getNativeHostBinding,
  startApplication,
} from "@solid-native/runtime";
import { getReactNativePlatformServices } from "@solid-native/runtime/react-native";
import { onCleanup, untrack } from "solid-js";

import { createGeneratedRNAsyncStorageKeyValueStorage } from "./adapters/RNAsyncStorage";

const PROOF_TIMEOUT_MS = 5_000;
const STORAGE_KEY = "navigation-process-restoration";
const SCROLL_STORAGE_KEY = "navigation-process-scroll-restoration";
const PROCESS_SEED_URL =
  "dev.solidnative.navigation://navigation/process-restoration-seed";
const PROCESS_CHURN_URL =
  "dev.solidnative.navigation://navigation/sustained-churn";
const PROCESS_PRESSURE_URL =
  "dev.solidnative.navigation://navigation/memory-pressure";
const PROCESS_SHEET_URL =
  "dev.solidnative.navigation://navigation/native-sheet-detents";
const PROCESS_PRODUCT_URL =
  "dev.solidnative.navigation://navigation/authenticated-interruption";
const COLD_LINK_URL =
  "dev.solidnative.navigation://navigation/cold-link?source=device-test";
const ROOT_CONTENT = "Solid Native process-restored navigation root";
const DETAIL_CONTENT = "Solid Native process-restored navigation detail";
const LINKED_CONTENT = "Solid Native process-safe cold navigation link";
const PRODUCT_LOGIN_CONTENT = "Solid Native authenticated navigation sign in";
const PRODUCT_HOME_CONTENT = "Solid Native authenticated navigation home";
const ROOT_LOADER_STATE = "Navigation process loader root";
const DETAIL_LOADER_STATE = "Navigation process loader detail";
const LINKED_LOADER_STATE = "Navigation process loader linked";
const PRODUCT_LOGIN_LOADER_STATE = "Navigation product loader login";
const PRODUCT_HOME_LOADER_STATE = "Navigation product loader home";
const ROUTED_DETAIL_STATE = "Native navigation routed detail; back true";
const RESTORATION_STATE = "Native navigation process restoration; back true";
const BLOCKED_BACK_STATE = "Native navigation platform Back blocked";
const CANCELED_BACK_STATE = "Native navigation platform gesture canceled";
const COLD_LINK_STATE = "Native navigation cold launch; back false";
const MEMORY_POLICY_READY_STATE = "Native navigation memory policy ready";
const MEMORY_POLICY_PRESSURE_STATE =
  "Native navigation memory policy reclaimed inactive route";
const MEMORY_POLICY_RECOVERED_STATE =
  "Native navigation memory policy recovery acknowledged";
const MEMORY_POLICY_RECOVER_LABEL = "Acknowledge navigation memory recovery";
const ROOT_SCROLL_RESTORATION_KEY = "root";
const ROOT_SCROLL_TEST_ID = "solid-native-navigation-restoration-scroll-view";
const ROOT_SCROLL_TARGET = 320;
const PUSH_LABEL = "Open process-restored navigation detail";
const SEED_LABEL = "Persist navigation for process relaunch";
const DISPOSE_LABEL = "Dispose navigation process proof";
const DETAIL_HEADER_ACTION_LABEL = "Run detail native header action";
const DETAIL_HEADER_ACTION_DONE = "Detail header action complete";
const DETAIL_HEADER_MENU_LABEL = "Open detail native header menu";
const DETAIL_HEADER_SUBMENU_LABEL = "Nested native header menu";
const DETAIL_HEADER_MENU_ACTION_LABEL = "Confirm nested native header menu";
const DETAIL_HEADER_MENU_ACTION_DONE = "Detail header menu action complete";
const DETAIL_SHEET_INITIAL_STATE = "Native sheet detent pending";
const DETAIL_SHEET_EXPANDED_STATE = "Native sheet detent 1 stable";
const DETAIL_SHEET_COLLAPSED_STATE = "Native sheet detent 0 stable";
const PRODUCT_AUTH_REDIRECT_STATE =
  "Authentication redirect replaced protected native history";
const PRODUCT_START_LABEL = "Authenticate and start protected data";
const PRODUCT_SLOW_PENDING_STATE =
  "Protected data loading; interruption available";
const PRODUCT_INTERRUPT_LABEL = "Interrupt protected data with home";
const PRODUCT_HOME_STATE = "Authenticated home won interrupted navigation";

type ProofMode =
  "churn" | "cold" | "pressure" | "product" | "restore" | "seed" | "sheet";
const CHURN_CYCLES = 30;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function scrollOffsetY(event: { readonly payload: unknown }): number {
  const payload = event.payload;
  const contentOffset =
    payload !== null && typeof payload === "object" && !Array.isArray(payload)
      ? Reflect.get(payload, "contentOffset")
      : undefined;
  const y =
    contentOffset !== null &&
    typeof contentOffset === "object" &&
    !Array.isArray(contentOffset)
      ? Reflect.get(contentOffset, "y")
      : undefined;
  if (typeof y !== "number" || !Number.isFinite(y)) {
    throw new TypeError(
      "The navigation scroll-restoration proof received an invalid native offset.",
    );
  }
  return Math.max(0, y);
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

function reportFatal(error: unknown): void {
  console.error("SOLID_NATIVE_NAVIGATION_PROCESS_FAILED", error);
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
      throw new Error("The navigation causal proof session was not sampled.");
    }
    const platform = getReactNativePlatformServices();
    const initialURL = await platform.getInitialURL();
    const storage = createGeneratedRNAsyncStorageKeyValueStorage({
      databaseName: "solid_native_navigation_e2e",
      prefix: "proof",
    });
    if (
      initialURL === PROCESS_SEED_URL ||
      initialURL === PROCESS_CHURN_URL ||
      initialURL === PROCESS_PRESSURE_URL ||
      initialURL === PROCESS_SHEET_URL ||
      initialURL === PROCESS_PRODUCT_URL
    ) {
      await Promise.all([
        storage.removeItem(STORAGE_KEY),
        storage.removeItem(SCROLL_STORAGE_KEY),
      ]);
    } else if (initialURL === COLD_LINK_URL) {
      await Promise.all([
        storage.setItem(
          STORAGE_KEY,
          serializeNativeHistorySnapshot({
            entries: [
              { id: "obsolete-root", href: "/obsolete-root", state: null },
              {
                id: "obsolete-detail",
                href: "/obsolete-detail",
                state: null,
              },
            ],
            index: 1,
          }),
        ),
        storage.setItem(
          SCROLL_STORAGE_KEY,
          serializeNativeScrollRestorationSnapshot({
            entries: [
              {
                entryId: "obsolete-root",
                containers: [
                  {
                    restorationKey: ROOT_SCROLL_RESTORATION_KEY,
                    x: 0,
                    y: ROOT_SCROLL_TARGET,
                  },
                ],
              },
            ],
          }),
        ),
      ]);
    }
    const launch = await createNativeHistoryFromStorage({
      storage,
      storageKey: STORAGE_KEY,
      initialHref: "/",
      initialURL,
      resolveDeepLink: (url) =>
        url === COLD_LINK_URL
          ? { href: "/linked", state: { source: "physical-cold-link" } }
          : url === PROCESS_PRODUCT_URL
            ? {
                href: "/protected",
                state: { source: "physical-product-auth" },
              }
            : undefined,
    });
    const mode: ProofMode =
      initialURL === PROCESS_SEED_URL && launch.source === "initial"
        ? "seed"
        : initialURL === PROCESS_CHURN_URL && launch.source === "initial"
          ? "churn"
          : initialURL === PROCESS_PRESSURE_URL && launch.source === "initial"
            ? "pressure"
            : initialURL === PROCESS_SHEET_URL && launch.source === "initial"
              ? "sheet"
              : initialURL === PROCESS_PRODUCT_URL &&
                  launch.source === "deep-link"
                ? "product"
                : initialURL === COLD_LINK_URL && launch.source === "deep-link"
                  ? "cold"
                  : initialURL === null && launch.source === "restoration"
                    ? "restore"
                    : (() => {
                        throw new Error(
                          `The navigation process proof received an invalid launch: ${JSON.stringify(
                            { initialURL, source: launch.source },
                          )}.`,
                        );
                      })();
    const history = launch.history;
    const scrollLaunch = await createNativeScrollRestorationFromStorage(
      history,
      {
        storage,
        storageKey: SCROLL_STORAGE_KEY,
        historySource: launch.source,
      },
    );
    if (scrollLaunch.restorationError !== undefined) {
      throw scrollLaunch.restorationError;
    }
    if (
      mode === "cold" &&
      ((await storage.getItem(STORAGE_KEY)) !== null ||
        (await storage.getItem(SCROLL_STORAGE_KEY)) !== null)
    ) {
      throw new Error(
        "The accepted navigation cold link did not clear discarded history and scroll restoration.",
      );
    }
    if (mode === "cold") {
      console.log("SOLID_NATIVE_NAVIGATION_PROCESS_DISCARDED_STORAGE_CLEARED");
    }

    const scrollRestoration = scrollLaunch.restoration;
    const routerHistory = createTanStackNativeHistory(history, {
      onNavigationError: reportFatal,
    });
    let renderRoute: (() => NativeNode) | undefined;
    const RouteComponent = (): NativeNode => {
      const render = renderRoute;
      if (render === undefined) {
        throw new Error(
          "The navigation process route renderer was not installed.",
        );
      }
      return render();
    };
    let rootLoaderRuns = 0;
    let detailLoaderRuns = 0;
    let linkedLoaderRuns = 0;
    let productAuthenticated = false;
    let productGuardRuns = 0;
    let productLoginLoaderRuns = 0;
    let productSlowLoaderRuns = 0;
    let productSlowLoaderSettlements = 0;
    let productHomeLoaderRuns = 0;
    let publishProductSlowLoaderStarted: (() => void) | undefined;
    let publishProductInterruptionComplete: (() => void) | undefined;
    let resolveProductSlowLoaderSettled!: () => void;
    const productSlowLoaderSettled = new Promise<void>((resolve) => {
      resolveProductSlowLoaderSettled = resolve;
    });
    const rootRoute = new TanStackRootRoute({
      component: TanStackNativeOutlet,
    });
    const homeRoute = new TanStackRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      loader: () => {
        rootLoaderRuns++;
        return { proof: "root" };
      },
      component: RouteComponent,
    });
    const detailRoute = new TanStackRoute({
      getParentRoute: () => rootRoute,
      path: "/detail",
      loader: async () => {
        detailLoaderRuns++;
        // Keep the physical transition pending across an actual asynchronous
        // route boundary so the final native commit must recover its task
        // cause rather than inheriting only the synchronous press callback.
        await delay(75);
        return { proof: "detail" };
      },
      component: RouteComponent,
    });
    const linkedRoute = new TanStackRoute({
      getParentRoute: () => rootRoute,
      path: "/linked",
      loader: () => {
        linkedLoaderRuns++;
        return { proof: "linked" };
      },
      component: RouteComponent,
    });
    const productProtectedRoute = new TanStackRoute({
      getParentRoute: () => rootRoute,
      path: "/protected",
      beforeLoad: () => {
        productGuardRuns++;
        if (!productAuthenticated) {
          throw tanStackRedirect({ to: "/login", replace: true });
        }
      },
      component: RouteComponent,
    });
    const productLoginRoute = new TanStackRoute({
      getParentRoute: () => rootRoute,
      path: "/login",
      loader: () => {
        productLoginLoaderRuns++;
        return { proof: "login" };
      },
      component: RouteComponent,
    });
    const productSlowRoute = new TanStackRoute({
      getParentRoute: () => rootRoute,
      path: "/slow",
      loader: async () => {
        productSlowLoaderRuns++;
        const publish = publishProductSlowLoaderStarted;
        if (publish === undefined) {
          throw new Error(
            "The product navigation loader started without its Solid publisher.",
          );
        }
        publish();
        await delay(500);
        productSlowLoaderSettlements++;
        resolveProductSlowLoaderSettled();
        return { proof: "slow" };
      },
      component: RouteComponent,
    });
    const productHomeRoute = new TanStackRoute({
      getParentRoute: () => rootRoute,
      path: "/home",
      loader: async () => {
        productHomeLoaderRuns++;
        await delay(75);
        return { proof: "home" };
      },
      component: RouteComponent,
    });
    const router = createTanStackNativeRouter({
      routeTree: rootRoute.addChildren([
        homeRoute,
        detailRoute,
        linkedRoute,
        productProtectedRoute,
        productLoginRoute,
        productSlowRoute,
        productHomeRoute,
      ]),
      history: routerHistory,
      isServer: false,
      defaultPendingMs: 0,
      defaultPendingMinMs: 0,
    });
    let platformBlockerAttempts = 0;
    let removePlatformBackBlocker: (() => void) | undefined;
    if (mode === "restore") {
      removePlatformBackBlocker = routerHistory.block({
        blockerFn({ action, currentLocation, nextLocation }) {
          platformBlockerAttempts++;
          if (
            action !== "BACK" ||
            currentLocation.pathname !== "/detail" ||
            nextLocation.pathname !== "/" ||
            platformBlockerAttempts > 2
          ) {
            throw new Error(
              `The navigation-process blocker received an invalid attempt: ${JSON.stringify(
                {
                  action,
                  current: currentLocation.pathname,
                  next: nextLocation.pathname,
                  platformBlockerAttempts,
                },
              )}.`,
            );
          }
          if (platformBlockerAttempts === 1) return true;
          removePlatformBackBlocker?.();
          removePlatformBackBlocker = undefined;
          console.log("SOLID_NATIVE_NAVIGATION_PROCESS_BLOCKER_RELEASED");
          return false;
        },
      });
    }
    const persistence = createNativeHistoryPersistence(history, storage, {
      storageKey: STORAGE_KEY,
      onError: reportFatal,
    });
    const scrollPersistence = createNativeScrollRestorationPersistence(
      scrollRestoration,
      storage,
      {
        storageKey: SCROLL_STORAGE_KEY,
        writeDelayMs: 25,
        onError: reportFatal,
      },
    );

    let application: NativeApplication | undefined;
    let resolveRouterReady!: () => void;
    let rejectRouterReady!: (error: unknown) => void;
    const routerReady = new Promise<void>((resolve, reject) => {
      resolveRouterReady = resolve;
      rejectRouterReady = reject;
    });
    let teardownStarted = false;
    let rootCreations = 0;
    let rootDisposals = 0;
    let detailCreations = 0;
    let detailDisposals = 0;
    let linkedCreations = 0;
    let linkedDisposals = 0;
    let productProtectedCreations = 0;
    let productProtectedDisposals = 0;
    let productLoginCreations = 0;
    let productLoginDisposals = 0;
    let productSlowCreations = 0;
    let productSlowDisposals = 0;
    let productHomeCreations = 0;
    let productHomeDisposals = 0;
    let focusTaskStarts = 0;
    let focusTaskAborts = 0;
    let focusTaskActive = 0;
    let focusTaskTransitionAborts = 0;
    const focusTaskStartsByHref = new Map<string, number>();
    const rootNodes = new Set<NativeNode>();
    const rootScrollNodes = new Set<NativeNode>();
    const detailNodes = new Set<NativeNode>();
    const linkedNodes = new Set<NativeNode>();
    const productLoginNodes = new Set<NativeNode>();
    const productHomeNodes = new Set<NativeNode>();
    let blockedBackCount = 0;
    let canceledBackCount = 0;
    let churnPushCount = 0;
    let churnBackCount = 0;
    let publishBlockedBack: (() => void) | undefined;
    let publishCanceledBack: (() => void) | undefined;
    let memoryPressureProofCompleted = false;
    let memoryRecoveryProofCompleted = false;
    let memoryPressureCacheReclamations = 0;
    let memoryScrollCaptureCompleted = false;
    let memoryScrollRestorationCompleted = false;
    let durableScrollCaptureCompleted = false;
    let durableScrollRestorationCompleted = false;
    let restorationPreloadPolicyCalls = 0;
    let restorationPreloadPolicySignal: AbortSignal | undefined;
    let linkCausalSettlements = 0;
    const verifiedLinkTasks = new Set<string>();
    let productStartPresses = 0;
    let productInterruptPresses = 0;
    let productInterruptionRequested = false;
    let productCausalSettlementVerified = false;
    const applicationPressureCache = new Set([
      "ai-stream",
      "decoded-image",
      "query",
    ]);

    const captureRootScroll = (event: { readonly payload: unknown }): void => {
      const offset = scrollOffsetY(event);
      if (offset < ROOT_SCROLL_TARGET) return;
      if (mode === "seed" && !durableScrollCaptureCompleted) {
        durableScrollCaptureCompleted = true;
        console.log(
          "SOLID_NATIVE_NAVIGATION_PROCESS_DURABLE_SCROLL_CAPTURE_SUCCEEDED",
          JSON.stringify({
            offset,
            restorationKey: ROOT_SCROLL_RESTORATION_KEY,
          }),
        );
        return;
      }
      if (mode === "restore" && !durableScrollRestorationCompleted) {
        durableScrollRestorationCompleted = true;
        console.log(
          "SOLID_NATIVE_NAVIGATION_PROCESS_DURABLE_SCROLL_RESTORATION_SUCCEEDED",
          JSON.stringify({
            offset,
            restorationKey: ROOT_SCROLL_RESTORATION_KEY,
          }),
        );
        return;
      }
      if (
        mode === "pressure" &&
        rootCreations === 1 &&
        !memoryScrollCaptureCompleted
      ) {
        memoryScrollCaptureCompleted = true;
        console.log(
          "SOLID_NATIVE_NAVIGATION_PROCESS_SCROLL_CAPTURE_SUCCEEDED",
          JSON.stringify({
            offset,
            restorationKey: ROOT_SCROLL_RESTORATION_KEY,
          }),
        );
        return;
      }
      if (
        mode === "pressure" &&
        rootCreations === 2 &&
        memoryScrollCaptureCompleted &&
        !memoryScrollRestorationCompleted
      ) {
        memoryScrollRestorationCompleted = true;
        console.log(
          "SOLID_NATIVE_NAVIGATION_PROCESS_SCROLL_RESTORATION_SUCCEEDED",
          JSON.stringify({
            offset,
            restorationKey: ROOT_SCROLL_RESTORATION_KEY,
          }),
        );
      }
    };

    const publishPlatformBackBlocked = (): boolean => {
      const publish = publishBlockedBack;
      if (publish === undefined) {
        reportFatal(
          new Error(
            "The navigation process blocked Back before its visible state publisher was mounted.",
          ),
        );
        return false;
      }
      blockedBackCount++;
      publish();
      return true;
    };

    const publishPlatformBackCanceled = (): boolean => {
      const publish = publishCanceledBack;
      if (publish === undefined) {
        reportFatal(
          new Error(
            "The navigation process canceled gesture before its visible state publisher was mounted.",
          ),
        );
        return false;
      }
      canceledBackCount++;
      publish();
      return true;
    };

    const flush = async (): Promise<void> => {
      const app = application;
      if (app === undefined) {
        throw new Error("The navigation process application was not retained.");
      }
      await app.root.flush();
    };

    const verifyLinkCausalSettlement = async (): Promise<void> => {
      const app = application;
      if (app === undefined) {
        throw new Error(
          "The navigation link causal proof lost its application.",
        );
      }
      const commit = await app.root.flushMounted();
      const task = telemetryRecords
        .slice()
        .reverse()
        .find(
          (record) =>
            record.type === "operation-started" &&
            record.name === "solid-native.task" &&
            record.attributes["task.name"] === "navigation.link" &&
            !verifiedLinkTasks.has(record.operationId),
        );
      if (task?.type !== "operation-started") {
        throw new Error(
          "The physical native link did not start a causal task.",
        );
      }
      const press = telemetryRecords.find(
        (record) =>
          record.type === "operation-started" &&
          record.name === "solid-native.event" &&
          record.attributes["event.name"] === "press" &&
          task.causes.includes(record.operationId),
      );
      const causedCommits = telemetryRecords.filter(
        (record) =>
          record.type === "operation-started" &&
          record.name === "solid-native.commit" &&
          record.causes.includes(task.operationId),
      );
      const taskFinished = telemetryRecords.find(
        (record) =>
          record.type === "operation-finished" &&
          record.operationId === task.operationId,
      );
      const finalCommit = causedCommits.at(-1);
      const taskStatus =
        taskFinished?.type === "operation-finished"
          ? taskFinished.status
          : undefined;
      const taskAttributeKeys = Object.keys(task.attributes).sort();
      const expectedTaskAttributeKeys = [
        "resource.platform",
        "resource.runtime.host_contract_version",
        "resource.runtime.name",
        "resource.runtime.version",
        "task.name",
      ];
      if (
        press?.type !== "operation-started" ||
        task.causes.length !== 1 ||
        taskAttributeKeys.length !== expectedTaskAttributeKeys.length ||
        taskAttributeKeys.some(
          (key, index) => key !== expectedTaskAttributeKeys[index],
        ) ||
        causedCommits.length < 1 ||
        finalCommit?.type !== "operation-started" ||
        finalCommit.attributes["commit.priority"] !== "normal" ||
        taskStatus !== "ok" ||
        commit === undefined ||
        commit.sequence !== finalCommit.attributes["commit.sequence"]
      ) {
        throw new Error(
          `The physical native link lost its causal settlement: ${JSON.stringify(
            {
              mode,
              taskCauses: task.causes.length,
              taskAttributeKeys,
              pressObserved: press !== undefined,
              causedCommits: causedCommits.length,
              finalPriority: finalCommit?.attributes["commit.priority"],
              taskStatus,
              mountedSequence: commit?.sequence,
              finalSequence: finalCommit?.attributes["commit.sequence"],
            },
          )}.`,
        );
      }
      verifiedLinkTasks.add(task.operationId);
      linkCausalSettlements++;
      console.log(
        "SOLID_NATIVE_NAVIGATION_PROCESS_LINK_CAUSALITY_SUCCEEDED",
        JSON.stringify({
          schemaVersion: 0,
          mode,
          settlement: linkCausalSettlements,
          causedCommits: causedCommits.length,
          finalPriority: finalCommit.attributes["commit.priority"],
          commitSequence: commit.sequence,
          hostRevision: commit.hostRevision,
        }),
      );
    };

    const verifyProductCausalSettlement = async (): Promise<void> => {
      const app = application;
      if (app === undefined) {
        throw new Error(
          "The product navigation causal proof lost its application.",
        );
      }
      await productSlowLoaderSettled;
      await delay(0);
      const commit = await app.root.flushMounted();
      const mountedSequence =
        commit?.sequence ?? app.root.lastCommittedSequence;
      const tasks = telemetryRecords.filter(
        (
          record,
        ): record is Extract<
          CausalTelemetryRecord,
          { readonly type: "operation-started" }
        > =>
          record.type === "operation-started" &&
          record.name === "solid-native.task" &&
          record.attributes["task.name"] === "navigation.programmatic",
      );
      const taskFinish = (operationId: string) =>
        telemetryRecords.find(
          (record) =>
            record.type === "operation-finished" &&
            record.operationId === operationId,
        );
      const taskCommits = (operationId: string) =>
        telemetryRecords.filter(
          (
            record,
          ): record is Extract<
            CausalTelemetryRecord,
            { readonly type: "operation-started" }
          > =>
            record.type === "operation-started" &&
            record.name === "solid-native.commit" &&
            record.causes.includes(operationId),
        );
      const taskPress = (operationId: string, causes: readonly string[]) =>
        telemetryRecords.find(
          (record) =>
            record.type === "operation-started" &&
            record.name === "solid-native.event" &&
            record.attributes["event.name"] === "press" &&
            causes.includes(record.operationId) &&
            record.operationId !== operationId,
        );
      const expectedTaskAttributeKeys = [
        "resource.platform",
        "resource.runtime.host_contract_version",
        "resource.runtime.name",
        "resource.runtime.version",
        "task.name",
      ];
      const displacedTask = tasks[0];
      const winningTask = tasks[1];
      const displacedFinish =
        displacedTask === undefined
          ? undefined
          : taskFinish(displacedTask.operationId);
      const winningFinish =
        winningTask === undefined
          ? undefined
          : taskFinish(winningTask.operationId);
      const displacedCommits =
        displacedTask === undefined
          ? []
          : taskCommits(displacedTask.operationId);
      const winningCommits =
        winningTask === undefined ? [] : taskCommits(winningTask.operationId);
      const finalCommit = winningCommits.at(-1);
      const finalCommitSequence =
        typeof finalCommit?.attributes["commit.sequence"] === "number"
          ? finalCommit.attributes["commit.sequence"]
          : undefined;
      const laterCommits =
        finalCommitSequence === undefined
          ? []
          : telemetryRecords.filter(
              (
                record,
              ): record is Extract<
                CausalTelemetryRecord,
                { readonly type: "operation-started" }
              > =>
                record.type === "operation-started" &&
                record.name === "solid-native.commit" &&
                typeof record.attributes["commit.sequence"] === "number" &&
                record.attributes["commit.sequence"] > finalCommitSequence,
            );
      const snapshot = history.snapshot;
      const taskKeysAreBounded = tasks.every((task) => {
        const keys = Object.keys(task.attributes).sort();
        return (
          keys.length === expectedTaskAttributeKeys.length &&
          keys.every((key, index) => key === expectedTaskAttributeKeys[index])
        );
      });
      if (
        mode !== "product" ||
        tasks.length !== 2 ||
        displacedTask === undefined ||
        winningTask === undefined ||
        displacedTask.causes.length !== 1 ||
        winningTask.causes.length !== 1 ||
        taskPress(displacedTask.operationId, displacedTask.causes)?.type !==
          "operation-started" ||
        taskPress(winningTask.operationId, winningTask.causes)?.type !==
          "operation-started" ||
        !taskKeysAreBounded ||
        displacedFinish?.type !== "operation-finished" ||
        displacedFinish.status !== "cancelled" ||
        winningFinish?.type !== "operation-finished" ||
        winningFinish.status !== "ok" ||
        displacedCommits.length < 1 ||
        winningCommits.length < 1 ||
        finalCommit?.type !== "operation-started" ||
        finalCommit.attributes["commit.priority"] !== "normal" ||
        finalCommitSequence === undefined ||
        displacedCommits.some(
          (record) =>
            typeof record.attributes["commit.sequence"] === "number" &&
            record.attributes["commit.sequence"] >= finalCommitSequence,
        ) ||
        mountedSequence < finalCommitSequence ||
        laterCommits.some(
          (record) =>
            record.attributes["commit.priority"] !== "normal" ||
            tasks.some((task) => record.causes.includes(task.operationId)),
        ) ||
        router.state.location.pathname !== "/home" ||
        snapshot.index !== 1 ||
        snapshot.entries.length !== 2 ||
        snapshot.entries[0]?.href !== "/login" ||
        snapshot.entries[1]?.href !== "/home" ||
        productStartPresses !== 1 ||
        productInterruptPresses !== 1 ||
        productSlowLoaderRuns !== 1 ||
        productSlowLoaderSettlements !== 1 ||
        productHomeLoaderRuns !== 1
      ) {
        throw new Error(
          `The authenticated product navigation lost its causal interruption: ${JSON.stringify(
            {
              mode,
              taskCount: tasks.length,
              taskCauses: tasks.map((task) => task.causes.length),
              taskAttributeKeys: tasks.map((task) =>
                Object.keys(task.attributes).sort(),
              ),
              displacedStatus:
                displacedFinish?.type === "operation-finished"
                  ? displacedFinish.status
                  : undefined,
              winningStatus:
                winningFinish?.type === "operation-finished"
                  ? winningFinish.status
                  : undefined,
              displacedCommits: displacedCommits.length,
              winningCommits: winningCommits.length,
              finalPriority: finalCommit?.attributes["commit.priority"],
              mountedSequence,
              finalSequence: finalCommitSequence,
              laterCommits: laterCommits.map((record) => ({
                sequence: record.attributes["commit.sequence"],
                priority: record.attributes["commit.priority"],
                causes: record.causes,
              })),
              location: router.state.location.pathname,
              history: snapshot,
              productStartPresses,
              productInterruptPresses,
              productSlowLoaderRuns,
              productSlowLoaderSettlements,
              productHomeLoaderRuns,
            },
          )}.`,
        );
      }
      productCausalSettlementVerified = true;
      publishProductInterruptionComplete?.();
      console.log(
        "SOLID_NATIVE_NAVIGATION_PROCESS_PRODUCT_INTERRUPTION_SUCCEEDED",
        JSON.stringify({
          schemaVersion: 0,
          displacedStatus: displacedFinish.status,
          winningStatus: winningFinish.status,
          displacedCommits: displacedCommits.length,
          winningCommits: winningCommits.length,
          detachedLaterCommits: laterCommits.length,
          finalPriority: finalCommit.attributes["commit.priority"],
          commitSequence: finalCommitSequence,
          ...(commit === undefined
            ? {}
            : { hostRevision: commit.hostRevision }),
          history: snapshot.entries.map((entry) => entry.href),
        }),
      );
    };

    const hardwareBack = platform.subscribeHardwareBack(
      createHardwareBackHandler(history, {
        onBlocked: (transition) => {
          if (
            mode !== "restore" ||
            transition.kind !== "pop" ||
            transition.origin !== "platform" ||
            transition.from.href !== "/detail" ||
            transition.to.href !== "/" ||
            history.location.href !== "/detail"
          ) {
            reportFatal(
              new Error(
                `The navigation-process blocked hardware Back was invalid: ${JSON.stringify(
                  transition,
                )}.`,
              ),
            );
            return;
          }
          if (!publishPlatformBackBlocked()) return;
          void Promise.resolve()
            .then(flush)
            .then(() => {
              console.log(
                "SOLID_NATIVE_NAVIGATION_PROCESS_PLATFORM_BLOCKED_SUCCEEDED",
                JSON.stringify({
                  source: "hardware-back",
                  id: transition.id,
                  from: transition.from.href,
                  to: transition.to.href,
                }),
              );
            })
            .catch(reportFatal);
        },
        onTransition: (transition) => {
          if (mode === "churn") {
            if (
              transition.kind !== "pop" ||
              transition.origin !== "platform" ||
              transition.from.href !== "/detail" ||
              transition.to.href !== "/" ||
              transition.delta !== -1 ||
              churnBackCount >= churnPushCount
            ) {
              reportFatal(
                new Error(
                  `The navigation-process churn Back was invalid: ${JSON.stringify(
                    {
                      transition,
                      churnPushCount,
                      churnBackCount,
                    },
                  )}.`,
                ),
              );
              return;
            }
            churnBackCount++;
          }
          void Promise.resolve()
            .then(flush)
            .then(() => {
              console.log(
                "SOLID_NATIVE_NAVIGATION_PROCESS_PLATFORM_BACK_SUCCEEDED",
                JSON.stringify({
                  id: transition.id,
                  from: transition.from.href,
                  to: transition.to.href,
                }),
              );
            })
            .catch(reportFatal);
        },
        onError: reportFatal,
      }),
    );

    const dispose = (preserveDurableSnapshot: boolean): void => {
      if (teardownStarted) return;
      teardownStarted = true;
      const app = application;
      if (app === undefined) {
        reportFatal(
          new Error("The navigation process application was not retained."),
        );
        return;
      }
      void Promise.all([persistence.flush(), scrollPersistence.flush()])
        .then(async () => {
          const serialized = await storage.getItem(STORAGE_KEY);
          const serializedScroll = await storage.getItem(SCROLL_STORAGE_KEY);
          if (serialized === null || serializedScroll === null) {
            throw new Error(
              "The navigation process history and scroll snapshots were not both persisted.",
            );
          }
          const snapshot = deserializeNativeHistorySnapshot(serialized);
          const scrollSnapshot =
            deserializeNativeScrollRestorationSnapshot(serializedScroll);
          const expectedEntries =
            mode === "cold"
              ? ["/linked"]
              : mode === "product"
                ? ["/login", "/home"]
                : ["/", "/detail"];
          const expectedIndex = mode === "seed" || mode === "sheet" ? 1 : 0;
          const expectsScrollSnapshot =
            mode === "seed" || mode === "restore" || mode === "pressure";
          const expectsCapturedScrollOffset =
            mode === "seed" || mode === "pressure";
          const rootEntry = snapshot.entries.find(
            (entry) => entry.href === "/",
          );
          const persistedRootScroll = scrollSnapshot.entries
            .find((entry) => entry.entryId === rootEntry?.id)
            ?.containers.find(
              (container) =>
                container.restorationKey === ROOT_SCROLL_RESTORATION_KEY,
            );
          if (
            preserveDurableSnapshot !== (mode === "seed") ||
            snapshot.index !== expectedIndex ||
            snapshot.entries.length !== expectedEntries.length ||
            snapshot.entries.some(
              (entry, index) => entry.href !== expectedEntries[index],
            ) ||
            snapshot.entries.some((entry) =>
              entry.href.startsWith("/obsolete-"),
            ) ||
            (expectsScrollSnapshot
              ? rootEntry === undefined ||
                scrollSnapshot.entries.length !== 1 ||
                persistedRootScroll === undefined ||
                persistedRootScroll.x !== 0 ||
                (expectsCapturedScrollOffset &&
                  persistedRootScroll.y < ROOT_SCROLL_TARGET)
              : scrollSnapshot.entries.length !== 0)
          ) {
            throw new Error(
              `The navigation process snapshots were invalid: ${JSON.stringify({ history: serialized, scroll: serializedScroll })}`,
            );
          }
          console.log(
            "SOLID_NATIVE_NAVIGATION_PROCESS_PERSISTENCE_SUCCEEDED",
            JSON.stringify({
              mode,
              index: snapshot.index,
              entries: snapshot.entries.map((entry) => entry.href),
              scrollEntries: scrollSnapshot.entries.length,
              rootScrollOffset: persistedRootScroll?.y,
              preserveDurableSnapshot,
            }),
          );
          if (preserveDurableSnapshot) {
            console.log("SOLID_NATIVE_NAVIGATION_PROCESS_SEED_SUCCEEDED");
          } else {
            await Promise.all([
              storage.removeItem(STORAGE_KEY),
              storage.removeItem(SCROLL_STORAGE_KEY),
            ]);
            if (
              (await storage.getItem(STORAGE_KEY)) !== null ||
              (await storage.getItem(SCROLL_STORAGE_KEY)) !== null
            ) {
              throw new Error(
                "The navigation process proof history or scroll storage was not removed.",
              );
            }
          }
          await app.dispose();
        })
        .then(() => {
          const expectsClassicStack = mode !== "cold" && mode !== "product";
          const expectedRootCount =
            mode === "pressure" ? 2 : expectsClassicStack ? 1 : 0;
          const expectedRootScrollCount =
            mode === "pressure"
              ? 2
              : mode === "seed" || mode === "restore"
                ? 1
                : 0;
          const expectedDetailCount =
            mode === "churn" ? CHURN_CYCLES : expectsClassicStack ? 1 : 0;
          // TanStack's default zero-stale policy revalidates the root route on
          // every Back while the keyed Solid route component remains retained.
          const expectedRootLoaderCount =
            mode === "churn"
              ? CHURN_CYCLES + 1
              : mode === "pressure"
                ? 2
                : expectsClassicStack
                  ? 1
                  : 0;
          // The product proof first reaches login through an auth redirect and
          // then revisits it through physical Back. TanStack revalidates the
          // loader on that second visit while retaining the keyed native Screen.
          const expectedProductLoginLoaderCount = mode === "product" ? 2 : 0;
          const expectedFocusHrefs =
            mode === "cold"
              ? ["/linked"]
              : mode === "product"
                ? ["/login", "/home"]
                : ["/", "/detail"];
          const minimumTransitionAborts =
            mode === "churn"
              ? CHURN_CYCLES * 2
              : mode === "cold"
                ? 0
                : mode === "product"
                  ? 2
                  : 1;
          if (
            rootCreations !== expectedRootCount ||
            rootDisposals !== rootCreations ||
            detailCreations !== expectedDetailCount ||
            detailDisposals !== detailCreations ||
            linkedCreations !== (mode === "cold" ? 1 : 0) ||
            linkedDisposals !== linkedCreations ||
            productProtectedCreations !== 0 ||
            productProtectedDisposals !== 0 ||
            productLoginCreations !== (mode === "product" ? 1 : 0) ||
            productLoginDisposals !== productLoginCreations ||
            productSlowCreations !== 0 ||
            productSlowDisposals !== 0 ||
            productHomeCreations !== (mode === "product" ? 1 : 0) ||
            productHomeDisposals !== productHomeCreations ||
            rootNodes.size !== rootCreations ||
            rootScrollNodes.size !== expectedRootScrollCount ||
            detailNodes.size !== detailCreations ||
            linkedNodes.size !== linkedCreations ||
            productLoginNodes.size !== productLoginCreations ||
            productHomeNodes.size !== productHomeCreations ||
            rootLoaderRuns !== expectedRootLoaderCount ||
            detailLoaderRuns !== expectedDetailCount ||
            linkedLoaderRuns !== (mode === "cold" ? 1 : 0) ||
            productGuardRuns !== (mode === "product" ? 1 : 0) ||
            productLoginLoaderRuns !== expectedProductLoginLoaderCount ||
            productSlowLoaderRuns !== (mode === "product" ? 1 : 0) ||
            productSlowLoaderSettlements !== (mode === "product" ? 1 : 0) ||
            productHomeLoaderRuns !== (mode === "product" ? 1 : 0) ||
            productStartPresses !== (mode === "product" ? 1 : 0) ||
            productInterruptPresses !== (mode === "product" ? 1 : 0) ||
            productCausalSettlementVerified !== (mode === "product") ||
            platformBlockerAttempts !== (mode === "restore" ? 2 : 0) ||
            blockedBackCount !== (mode === "restore" ? 1 : 0) ||
            canceledBackCount !==
              (mode === "seed" && platform.platform === "ios" ? 1 : 0) ||
            churnPushCount !== (mode === "churn" ? CHURN_CYCLES : 0) ||
            churnBackCount !== (mode === "churn" ? CHURN_CYCLES : 0) ||
            memoryPressureProofCompleted !== (mode === "pressure") ||
            memoryRecoveryProofCompleted !== (mode === "pressure") ||
            memoryPressureCacheReclamations !== (mode === "pressure" ? 1 : 0) ||
            memoryScrollCaptureCompleted !== (mode === "pressure") ||
            memoryScrollRestorationCompleted !== (mode === "pressure") ||
            durableScrollCaptureCompleted !== (mode === "seed") ||
            durableScrollRestorationCompleted !== (mode === "restore") ||
            applicationPressureCache.size !== (mode === "pressure" ? 0 : 3) ||
            restorationPreloadPolicyCalls !== (mode === "restore" ? 1 : 0) ||
            (mode === "restore"
              ? restorationPreloadPolicySignal?.aborted !== true
              : restorationPreloadPolicySignal !== undefined) ||
            linkCausalSettlements !==
              (mode === "churn"
                ? CHURN_CYCLES
                : mode === "seed" || mode === "pressure" || mode === "sheet"
                  ? 1
                  : 0) ||
            verifiedLinkTasks.size !== linkCausalSettlements ||
            focusTaskStarts < expectedFocusHrefs.length ||
            focusTaskAborts !== focusTaskStarts ||
            focusTaskActive !== 0 ||
            focusTaskTransitionAborts < minimumTransitionAborts ||
            expectedFocusHrefs.some(
              (href) => (focusTaskStartsByHref.get(href) ?? 0) < 1,
            ) ||
            !app.root.disposed ||
            binding.getSurfaceInfo().ready
          ) {
            throw new Error(
              `Navigation process teardown violated ownership: ${JSON.stringify(
                {
                  mode,
                  rootCreations,
                  rootDisposals,
                  detailCreations,
                  detailDisposals,
                  linkedCreations,
                  linkedDisposals,
                  productProtectedCreations,
                  productProtectedDisposals,
                  productLoginCreations,
                  productLoginDisposals,
                  productSlowCreations,
                  productSlowDisposals,
                  productHomeCreations,
                  productHomeDisposals,
                  rootNodes: rootNodes.size,
                  rootScrollNodes: rootScrollNodes.size,
                  detailNodes: detailNodes.size,
                  linkedNodes: linkedNodes.size,
                  productLoginNodes: productLoginNodes.size,
                  productHomeNodes: productHomeNodes.size,
                  rootLoaderRuns,
                  detailLoaderRuns,
                  linkedLoaderRuns,
                  productGuardRuns,
                  productLoginLoaderRuns,
                  productSlowLoaderRuns,
                  productSlowLoaderSettlements,
                  productHomeLoaderRuns,
                  productStartPresses,
                  productInterruptPresses,
                  productCausalSettlementVerified,
                  platformBlockerAttempts,
                  blockedBackCount,
                  canceledBackCount,
                  churnPushCount,
                  churnBackCount,
                  memoryPressureProofCompleted,
                  memoryRecoveryProofCompleted,
                  memoryPressureCacheReclamations,
                  memoryScrollCaptureCompleted,
                  memoryScrollRestorationCompleted,
                  durableScrollCaptureCompleted,
                  durableScrollRestorationCompleted,
                  applicationPressureCacheSize: applicationPressureCache.size,
                  restorationPreloadPolicyCalls,
                  restorationPreloadPolicyAborted:
                    restorationPreloadPolicySignal?.aborted,
                  linkCausalSettlements,
                  verifiedLinkTasks: verifiedLinkTasks.size,
                  focusTaskStarts,
                  focusTaskAborts,
                  focusTaskActive,
                  focusTaskTransitionAborts,
                  focusTaskStartsByHref: Object.fromEntries(
                    focusTaskStartsByHref,
                  ),
                  rootDisposed: app.root.disposed,
                  surfaceReady: binding.getSurfaceInfo().ready,
                },
              )}.`,
            );
          }
          if (mode === "churn") {
            console.log(
              "SOLID_NATIVE_NAVIGATION_PROCESS_CHURN_SUCCEEDED",
              JSON.stringify({
                cycles: CHURN_CYCLES,
                rootCreations,
                detailCreations,
                detailDisposals,
                rootLoaderRuns,
                detailLoaderRuns,
                churnPushCount,
                churnBackCount,
              }),
            );
          }
          console.log(
            "SOLID_NATIVE_NAVIGATION_PROCESS_FOCUS_TASK_SUCCEEDED",
            JSON.stringify({
              mode,
              starts: focusTaskStarts,
              aborts: focusTaskAborts,
              transitionAborts: focusTaskTransitionAborts,
              startsByHref: Object.fromEntries(focusTaskStartsByHref),
            }),
          );
          console.log(
            "SOLID_NATIVE_NAVIGATION_PROCESS_TEARDOWN_SUCCEEDED",
            JSON.stringify({
              mode,
              rootCreations,
              rootDisposals,
              detailCreations,
              detailDisposals,
              linkedCreations,
              linkedDisposals,
              productProtectedCreations,
              productProtectedDisposals,
              productLoginCreations,
              productLoginDisposals,
              productSlowCreations,
              productSlowDisposals,
              productHomeCreations,
              productHomeDisposals,
              rootLoaderRuns,
              detailLoaderRuns,
              linkedLoaderRuns,
              productGuardRuns,
              productLoginLoaderRuns,
              productSlowLoaderRuns,
              productSlowLoaderSettlements,
              productHomeLoaderRuns,
              productStartPresses,
              productInterruptPresses,
              productCausalSettlementVerified,
              platformBlockerAttempts,
              blockedBackCount,
              canceledBackCount,
              churnPushCount,
              churnBackCount,
              memoryPressureProofCompleted,
              memoryRecoveryProofCompleted,
              memoryPressureCacheReclamations,
              memoryScrollCaptureCompleted,
              memoryScrollRestorationCompleted,
              durableScrollCaptureCompleted,
              durableScrollRestorationCompleted,
              applicationPressureCacheSize: applicationPressureCache.size,
              restorationPreloadPolicyCalls,
              restorationPreloadPolicyAborted:
                restorationPreloadPolicySignal?.aborted,
              linkCausalSettlements,
              verifiedLinkTasks: verifiedLinkTasks.size,
              focusTaskStarts,
              focusTaskAborts,
              focusTaskActive,
              focusTaskTransitionAborts,
              focusTaskStartsByHref: Object.fromEntries(focusTaskStartsByHref),
              rootDisposed: app.root.disposed,
              surfaceReady: binding.getSurfaceInfo().ready,
            }),
          );
        })
        .finally(() => {
          persistence.dispose();
          scrollPersistence.dispose();
          scrollRestoration.dispose();
          hardwareBack.remove();
          removePlatformBackBlocker?.();
          removePlatformBackBlocker = undefined;
          routerHistory.destroy();
        })
        .catch(reportFatal);
    };

    application = startApplication(
      () => {
        const memoryPolicy =
          mode === "pressure"
            ? createTanStackNativeMemoryPolicy(platform, {
                normalMountedRouteTrees: 2,
                pressuredMountedRouteTrees: 1,
                onMemoryPressure(warningCount) {
                  if (
                    warningCount !== 1 ||
                    applicationPressureCache.size !== 3
                  ) {
                    throw new Error(
                      `The application cache received an invalid memory warning: ${JSON.stringify(
                        {
                          warningCount,
                          cacheEntries: [...applicationPressureCache],
                        },
                      )}.`,
                    );
                  }
                  memoryPressureCacheReclamations++;
                  applicationPressureCache.clear();
                },
                onMemoryPressureError: reportFatal,
              })
            : undefined;
        const [restoredRootReady, setRestoredRootReady] = createSignal(false);
        const [platformBackBlocked, setPlatformBackBlocked] =
          createSignal(false);
        const [platformBackCanceled, setPlatformBackCanceled] =
          createSignal(false);
        const [detailSheetState, setDetailSheetState] = createSignal(
          DETAIL_SHEET_INITIAL_STATE,
        );
        const [detailHeaderActionComplete, setDetailHeaderActionComplete] =
          createSignal(false);
        const [
          detailHeaderMenuActionComplete,
          setDetailHeaderMenuActionComplete,
        ] = createSignal(false);
        const [memoryRecoveryAcknowledged, setMemoryRecoveryAcknowledged] =
          createSignal(false);
        const [productSlowLoaderStarted, setProductSlowLoaderStarted] =
          createSignal(false);
        const [productInterruptionComplete, setProductInterruptionComplete] =
          createSignal(false);
        publishProductSlowLoaderStarted = () => {
          if (mode !== "product" || productSlowLoaderStarted()) {
            throw new Error(
              "The product navigation slow loader published an invalid lifecycle.",
            );
          }
          setProductSlowLoaderStarted(true);
          void Promise.resolve()
            .then(flush)
            .then(() => {
              console.log(
                "SOLID_NATIVE_NAVIGATION_PROCESS_PRODUCT_SLOW_LOADER_STARTED",
              );
            })
            .catch(reportFatal);
        };
        publishProductInterruptionComplete = () =>
          setProductInterruptionComplete(true);
        let memoryPressureVerificationStarted = false;
        let memoryRecoveryVerificationStarted = false;
        if (memoryPolicy !== undefined) {
          effect(
            () => ({
              isUnderMemoryPressure: memoryPolicy.isUnderMemoryPressure(),
              maxMountedRouteTrees: memoryPolicy.maxMountedRouteTrees(),
              warningCount: memoryPolicy.warningCount(),
            }),
            ({ isUnderMemoryPressure, maxMountedRouteTrees, warningCount }) => {
              if (warningCount === 0 || memoryPressureVerificationStarted) {
                return;
              }
              memoryPressureVerificationStarted = true;
              void Promise.resolve()
                .then(async () => {
                  const app = application;
                  if (app === undefined) {
                    throw new Error(
                      "The memory-pressure proof lost its native application.",
                    );
                  }
                  const commit = await app.root.flushMounted();
                  if (
                    warningCount !== 1 ||
                    !isUnderMemoryPressure ||
                    maxMountedRouteTrees !== 1 ||
                    rootCreations !== 1 ||
                    rootDisposals !== 1 ||
                    detailCreations !== 1 ||
                    detailDisposals !== 0 ||
                    rootScrollNodes.size !== 1 ||
                    !memoryScrollCaptureCompleted ||
                    memoryScrollRestorationCompleted ||
                    memoryPressureCacheReclamations !== 1 ||
                    applicationPressureCache.size !== 0 ||
                    history.snapshot.index !== 1 ||
                    history.snapshot.entries.length !== 2 ||
                    history.location.href !== "/detail" ||
                    commit === undefined
                  ) {
                    throw new Error(
                      `Navigation memory pressure violated ownership: ${JSON.stringify(
                        {
                          warningCount,
                          isUnderMemoryPressure,
                          maxMountedRouteTrees,
                          rootCreations,
                          rootDisposals,
                          detailCreations,
                          detailDisposals,
                          rootScrollNodes: rootScrollNodes.size,
                          memoryScrollCaptureCompleted,
                          memoryScrollRestorationCompleted,
                          memoryPressureCacheReclamations,
                          applicationPressureCacheSize:
                            applicationPressureCache.size,
                          history: history.snapshot,
                          commitSequence: commit?.sequence,
                        },
                      )}.`,
                    );
                  }
                  memoryPressureProofCompleted = true;
                  console.log(
                    "SOLID_NATIVE_NAVIGATION_PROCESS_MEMORY_PRESSURE_SUCCEEDED",
                    JSON.stringify({
                      warningCount,
                      maxMountedRouteTrees,
                      rootCreations,
                      rootDisposals,
                      detailCreations,
                      detailDisposals,
                      rootScrollNodes: rootScrollNodes.size,
                      memoryScrollCaptureCompleted,
                      memoryScrollRestorationCompleted,
                      memoryPressureCacheReclamations,
                      applicationPressureCacheSize:
                        applicationPressureCache.size,
                      historyIndex: history.snapshot.index,
                      historyEntries: history.snapshot.entries.map(
                        (entry) => entry.href,
                      ),
                      commitSequence: commit.sequence,
                      hostRevision: commit.hostRevision,
                    }),
                  );
                })
                .catch(reportFatal);
            },
          );
        }
        const acknowledgeMemoryRecovery = (): void => {
          if (
            memoryPolicy === undefined ||
            memoryRecoveryVerificationStarted ||
            !memoryPressureProofCompleted ||
            !untrack(memoryPolicy.isUnderMemoryPressure)
          ) {
            reportFatal(
              new Error(
                "Navigation memory recovery was requested outside verified pressure.",
              ),
            );
            return;
          }
          memoryRecoveryVerificationStarted = true;
          memoryPolicy.acknowledgeRecovery();
          setMemoryRecoveryAcknowledged(true);
          void Promise.resolve()
            .then(async () => {
              const app = application;
              if (app === undefined) {
                throw new Error(
                  "The memory-recovery proof lost its native application.",
                );
              }
              const commit = await app.root.flushMounted();
              if (
                untrack(memoryPolicy.isUnderMemoryPressure) ||
                untrack(memoryPolicy.maxMountedRouteTrees) !== 2 ||
                rootCreations !== 1 ||
                rootDisposals !== 1 ||
                detailCreations !== 1 ||
                detailDisposals !== 0 ||
                rootScrollNodes.size !== 1 ||
                !memoryScrollCaptureCompleted ||
                memoryScrollRestorationCompleted ||
                memoryPressureCacheReclamations !== 1 ||
                applicationPressureCache.size !== 0 ||
                history.snapshot.index !== 1 ||
                history.location.href !== "/detail" ||
                commit === undefined
              ) {
                throw new Error(
                  `Navigation memory recovery resurrected stale state: ${JSON.stringify(
                    {
                      isUnderMemoryPressure: untrack(
                        memoryPolicy.isUnderMemoryPressure,
                      ),
                      maxMountedRouteTrees: untrack(
                        memoryPolicy.maxMountedRouteTrees,
                      ),
                      rootCreations,
                      rootDisposals,
                      detailCreations,
                      detailDisposals,
                      rootScrollNodes: rootScrollNodes.size,
                      memoryScrollCaptureCompleted,
                      memoryScrollRestorationCompleted,
                      memoryPressureCacheReclamations,
                      applicationPressureCacheSize:
                        applicationPressureCache.size,
                      history: history.snapshot,
                      commitSequence: commit?.sequence,
                    },
                  )}.`,
                );
              }
              memoryRecoveryProofCompleted = true;
              console.log(
                "SOLID_NATIVE_NAVIGATION_PROCESS_MEMORY_RECOVERY_SUCCEEDED",
                JSON.stringify({
                  rootCreations,
                  rootDisposals,
                  detailCreations,
                  detailDisposals,
                  rootScrollNodes: rootScrollNodes.size,
                  memoryScrollCaptureCompleted,
                  memoryScrollRestorationCompleted,
                  memoryPressureCacheReclamations,
                  applicationPressureCacheSize: applicationPressureCache.size,
                  historyIndex: history.snapshot.index,
                  commitSequence: commit.sequence,
                  hostRevision: commit.hostRevision,
                }),
              );
            })
            .catch(reportFatal);
        };
        publishBlockedBack = () => setPlatformBackBlocked(true);
        publishCanceledBack = () => setPlatformBackCanceled(true);
        onCleanup(() => {
          publishBlockedBack = undefined;
          publishCanceledBack = undefined;
          publishProductSlowLoaderStarted = undefined;
          publishProductInterruptionComplete = undefined;
        });
        const ProductPendingScreen = (): NativeNode => {
          const interruptNavigation = useTanStackNativeNavigate();
          const interruptProtectedNavigation = (): void => {
            if (
              mode !== "product" ||
              !productSlowLoaderStarted() ||
              productInterruptionRequested ||
              productInterruptPresses !== 0
            ) {
              reportFatal(
                new Error(
                  "The pending product navigation received a duplicate or invalid interruption.",
                ),
              );
              return;
            }
            productInterruptionRequested = true;
            productInterruptPresses++;
            const winningNavigation = interruptNavigation({
              to: "/home",
              replace: true,
            });
            // This proof application disables automatic commits. Drain the
            // winning pending state separately so the later async loader frame
            // retains its truthful normal priority instead of inheriting the
            // discrete interrupt press.
            void Promise.resolve().then(flush).catch(reportFatal);
            void winningNavigation
              .then(verifyProductCausalSettlement)
              .catch(reportFatal);
          };
          return (
            <View
              style={{
                backgroundColor: "#fffbeb",
                flex: 1,
                justifyContent: "center",
                padding: 24,
              }}
            >
              <Text
                accessible
                accessibilityRole="header"
                style={{ color: "#111827", fontSize: 26, marginBottom: 12 }}
              >
                Loading authenticated data
              </Text>
              <Text
                accessible
                accessibilityLabel={PRODUCT_SLOW_PENDING_STATE}
                style={{ color: "#92400e", fontSize: 16, marginBottom: 16 }}
              >
                {PRODUCT_SLOW_PENDING_STATE}
              </Text>
              {productSlowLoaderStarted() ? (
                <Pressable
                  accessible
                  accessibilityLabel={PRODUCT_INTERRUPT_LABEL}
                  accessibilityRole="button"
                  onPress={interruptProtectedNavigation}
                  style={{
                    backgroundColor: "#c2410c",
                    borderRadius: 8,
                    padding: 14,
                  }}
                >
                  <Text style={{ color: "#ffffff", fontSize: 17 }}>
                    {PRODUCT_INTERRUPT_LABEL}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) as NativeNode;
        };
        renderRoute = () => {
          const { entry, index, isFocused } = useTanStackNativeScreen();
          const href = entry().href;
          let accessibilityHeading: NativeNode | undefined;
          if (mode !== "pressure" || href !== "/") {
            createTanStackNativeScreenAccessibilityFocus(
              () => accessibilityHeading,
            );
          }
          const loaderData = useTanStackNativeLoaderData<typeof router>();
          const loaded = loaderData() as unknown;
          createTanStackNativeScreenFocusTask(
            (signal) => {
              focusTaskStarts++;
              focusTaskActive++;
              focusTaskStartsByHref.set(
                href,
                (focusTaskStartsByHref.get(href) ?? 0) + 1,
              );
              return new Promise<void>((resolve) => {
                signal.addEventListener(
                  "abort",
                  () => {
                    focusTaskAborts++;
                    focusTaskActive--;
                    if (!teardownStarted) focusTaskTransitionAborts++;
                    resolve();
                  },
                  { once: true },
                );
              });
            },
            { onError: reportFatal },
          );
          const expectedProof =
            href === "/"
              ? "root"
              : href === "/detail"
                ? "detail"
                : href === "/linked"
                  ? "linked"
                  : href === "/login"
                    ? "login"
                    : href === "/slow"
                      ? "slow"
                      : href === "/home"
                        ? "home"
                        : undefined;
          if (
            expectedProof === undefined ||
            loaded === null ||
            typeof loaded !== "object" ||
            Array.isArray(loaded) ||
            (loaded as { readonly proof?: unknown }).proof !== expectedProof
          ) {
            throw new Error(
              `The navigation process loader data was invalid for ${JSON.stringify(href)}.`,
            );
          }
          if (href === "/") {
            rootCreations++;
            setRestoredRootReady(true);
            if (mode === "restore") {
              void Promise.resolve().then(flush).catch(reportFatal);
            }
            onCleanup(() => rootDisposals++);
            const rootContent = (
              <View
                ref={(node) => rootNodes.add(node)}
                style={{
                  backgroundColor: "#eff6ff",
                  flex: 1,
                  justifyContent: "center",
                  padding: 24,
                }}
              >
                <Text
                  accessible
                  accessibilityRole="header"
                  ref={(node) => {
                    accessibilityHeading = node;
                  }}
                  style={{ color: "#111827", fontSize: 26, marginBottom: 12 }}
                >
                  {ROOT_CONTENT}
                </Text>
                <Text
                  style={{ color: "#1e3a8a", fontSize: 16, marginBottom: 16 }}
                >
                  {ROOT_LOADER_STATE}; depth {index()}; focused{" "}
                  {String(isFocused())}
                </Text>
                <TanStackNativeLink
                  router={router}
                  options={{ to: "/detail" }}
                  preload={false}
                  pressableProps={{
                    accessible: true,
                    accessibilityLabel: PUSH_LABEL,
                    style: {
                      backgroundColor: "#2563eb",
                      borderRadius: 8,
                      marginBottom: 12,
                      padding: 14,
                    },
                  }}
                  onNavigationError={reportFatal}
                  onNavigationSettled={() => {
                    if (mode === "churn") churnPushCount++;
                    void Promise.resolve()
                      .then(verifyLinkCausalSettlement)
                      .catch(reportFatal);
                  }}
                >
                  {(state) => {
                    effect(
                      () => state.isTransitioning,
                      (isTransitioning) => {
                        if (!isTransitioning) return;
                        void Promise.resolve().then(flush).catch(reportFatal);
                      },
                    );
                    return (
                      <Text style={{ color: "#ffffff", fontSize: 17 }}>
                        {state.isTransitioning
                          ? "Loading process-restored navigation detail"
                          : PUSH_LABEL}
                      </Text>
                    ) as NativeNode;
                  }}
                </TanStackNativeLink>
                <Pressable
                  accessible
                  accessibilityLabel={DISPOSE_LABEL}
                  accessibilityRole="button"
                  onPress={() => dispose(false)}
                  style={{
                    backgroundColor: "#334155",
                    borderRadius: 8,
                    padding: 14,
                  }}
                >
                  <Text style={{ color: "#ffffff", fontSize: 17 }}>
                    {DISPOSE_LABEL}
                  </Text>
                </Pressable>
              </View>
            ) as NativeNode;
            if (mode !== "pressure" && mode !== "seed" && mode !== "restore") {
              return rootContent;
            }
            return (
              <TanStackNativeScrollView
                ref={(handle) => rootScrollNodes.add(handle.nativeNode)}
                restorationKey={ROOT_SCROLL_RESTORATION_KEY}
                scrollEventThrottle={16}
                testID={ROOT_SCROLL_TEST_ID}
                onScroll={captureRootScroll}
                onRestorationError={reportFatal}
                style={{ backgroundColor: "#eff6ff", flex: 1 }}
              >
                <View style={{ height: ROOT_SCROLL_TARGET }} />
                {rootContent}
                <View style={{ height: 960 }} />
              </TanStackNativeScrollView>
            ) as NativeNode;
          }
          if (href === "/detail") {
            detailCreations++;
            onCleanup(() => detailDisposals++);
            return (
              <View
                ref={(node) => detailNodes.add(node)}
                style={{
                  backgroundColor: "#ede9fe",
                  flex: 1,
                  justifyContent: "center",
                  padding: 24,
                }}
              >
                <Text
                  accessible
                  accessibilityRole="header"
                  ref={(node) => {
                    accessibilityHeading = node;
                  }}
                  style={{ color: "#111827", fontSize: 26, marginBottom: 12 }}
                >
                  {DETAIL_CONTENT}
                </Text>
                <Text
                  style={{ color: "#4c1d95", fontSize: 16, marginBottom: 16 }}
                >
                  {DETAIL_LOADER_STATE}; depth {index()}; focused{" "}
                  {String(isFocused())}
                </Text>
                <Text
                  style={{ color: "#4c1d95", fontSize: 16, marginBottom: 16 }}
                >
                  {mode === "restore" &&
                  history.canGoBack &&
                  restoredRootReady()
                    ? platformBackBlocked()
                      ? BLOCKED_BACK_STATE
                      : RESTORATION_STATE
                    : platformBackCanceled()
                      ? CANCELED_BACK_STATE
                      : ROUTED_DETAIL_STATE}
                </Text>
                {platform.platform === "android" || mode === "sheet" ? (
                  <Text
                    accessible
                    accessibilityLabel={detailSheetState()}
                    style={{
                      color: "#4c1d95",
                      fontSize: 16,
                      marginBottom: 16,
                    }}
                  >
                    {detailSheetState()}
                  </Text>
                ) : null}
                {memoryPolicy !== undefined ? (
                  <>
                    <Text
                      accessible
                      accessibilityLabel={
                        memoryRecoveryAcknowledged()
                          ? MEMORY_POLICY_RECOVERED_STATE
                          : memoryPolicy.isUnderMemoryPressure()
                            ? MEMORY_POLICY_PRESSURE_STATE
                            : MEMORY_POLICY_READY_STATE
                      }
                      style={{
                        color: "#4c1d95",
                        fontSize: 16,
                        marginBottom: 8,
                      }}
                    >
                      {memoryRecoveryAcknowledged()
                        ? MEMORY_POLICY_RECOVERED_STATE
                        : memoryPolicy.isUnderMemoryPressure()
                          ? MEMORY_POLICY_PRESSURE_STATE
                          : MEMORY_POLICY_READY_STATE}
                    </Text>
                    <Text
                      accessible
                      accessibilityLabel={`Navigation memory warnings ${memoryPolicy.warningCount()}; route budget ${memoryPolicy.maxMountedRouteTrees()}`}
                      style={{
                        color: "#4c1d95",
                        fontSize: 16,
                        marginBottom: 16,
                      }}
                    >
                      Navigation memory warnings {memoryPolicy.warningCount()};
                      route budget {memoryPolicy.maxMountedRouteTrees()}
                    </Text>
                    {!memoryRecoveryAcknowledged() &&
                    memoryPolicy.isUnderMemoryPressure() ? (
                      <Pressable
                        accessible
                        accessibilityLabel={MEMORY_POLICY_RECOVER_LABEL}
                        accessibilityRole="button"
                        onPress={acknowledgeMemoryRecovery}
                        style={{
                          backgroundColor: "#6d28d9",
                          borderRadius: 8,
                          marginBottom: 12,
                          padding: 14,
                        }}
                      >
                        <Text style={{ color: "#ffffff", fontSize: 17 }}>
                          {MEMORY_POLICY_RECOVER_LABEL}
                        </Text>
                      </Pressable>
                    ) : null}
                  </>
                ) : null}
                {platform.platform === "ios" && mode !== "sheet" ? (
                  <>
                    <Text
                      accessible
                      accessibilityLabel={
                        detailHeaderActionComplete()
                          ? DETAIL_HEADER_ACTION_DONE
                          : DETAIL_HEADER_ACTION_LABEL
                      }
                      style={{
                        color: "#4c1d95",
                        fontSize: 16,
                        marginBottom: 8,
                      }}
                    >
                      {detailHeaderActionComplete()
                        ? DETAIL_HEADER_ACTION_DONE
                        : DETAIL_HEADER_ACTION_LABEL}
                    </Text>
                    <Text
                      accessible
                      accessibilityLabel={
                        detailHeaderMenuActionComplete()
                          ? DETAIL_HEADER_MENU_ACTION_DONE
                          : DETAIL_HEADER_MENU_ACTION_LABEL
                      }
                      style={{
                        color: "#4c1d95",
                        fontSize: 16,
                        marginBottom: 16,
                      }}
                    >
                      {detailHeaderMenuActionComplete()
                        ? DETAIL_HEADER_MENU_ACTION_DONE
                        : DETAIL_HEADER_MENU_ACTION_LABEL}
                    </Text>
                  </>
                ) : null}
                <Pressable
                  accessible
                  accessibilityLabel={
                    mode === "sheet" || mode === "pressure"
                      ? DISPOSE_LABEL
                      : SEED_LABEL
                  }
                  accessibilityRole="button"
                  onPress={() => dispose(mode === "seed")}
                  style={{
                    backgroundColor: "#334155",
                    borderRadius: 8,
                    padding: 14,
                  }}
                >
                  <Text style={{ color: "#ffffff", fontSize: 17 }}>
                    {mode === "sheet" || mode === "pressure"
                      ? DISPOSE_LABEL
                      : SEED_LABEL}
                  </Text>
                </Pressable>
              </View>
            ) as NativeNode;
          }
          if (href === "/login") {
            productLoginCreations++;
            const navigateFromLogin = useTanStackNativeNavigate({
              from: "/login",
            });
            const startProtectedNavigation = (): void => {
              if (
                mode !== "product" ||
                productStartPresses !== 0 ||
                productSlowLoaderStarted()
              ) {
                reportFatal(
                  new Error(
                    "The product navigation start control received a duplicate or invalid press.",
                  ),
                );
                return;
              }
              productAuthenticated = true;
              productStartPresses++;
              void navigateFromLogin({ to: "../slow" }).catch((error) => {
                if (!productInterruptionRequested) reportFatal(error);
              });
            };
            onCleanup(() => productLoginDisposals++);
            return (
              <View
                ref={(node) => productLoginNodes.add(node)}
                style={{
                  backgroundColor: "#fff7ed",
                  flex: 1,
                  justifyContent: "center",
                  padding: 24,
                }}
              >
                <Text
                  accessible
                  accessibilityRole="header"
                  ref={(node) => {
                    accessibilityHeading = node;
                  }}
                  style={{ color: "#111827", fontSize: 26, marginBottom: 12 }}
                >
                  {PRODUCT_LOGIN_CONTENT}
                </Text>
                <Text
                  style={{ color: "#9a3412", fontSize: 16, marginBottom: 12 }}
                >
                  {PRODUCT_LOGIN_LOADER_STATE}; depth {index()}; focused{" "}
                  {String(isFocused())}
                </Text>
                <Text
                  accessible
                  accessibilityLabel={PRODUCT_AUTH_REDIRECT_STATE}
                  style={{ color: "#9a3412", fontSize: 16, marginBottom: 16 }}
                >
                  {PRODUCT_AUTH_REDIRECT_STATE}
                </Text>
                {productInterruptionComplete() ? (
                  <Pressable
                    accessible
                    accessibilityLabel={DISPOSE_LABEL}
                    accessibilityRole="button"
                    onPress={() => dispose(false)}
                    style={{
                      backgroundColor: "#334155",
                      borderRadius: 8,
                      padding: 14,
                    }}
                  >
                    <Text style={{ color: "#ffffff", fontSize: 17 }}>
                      {DISPOSE_LABEL}
                    </Text>
                  </Pressable>
                ) : productSlowLoaderStarted() ? (
                  <Text style={{ color: "#9a3412", fontSize: 16 }}>
                    Protected navigation pending in native stack
                  </Text>
                ) : (
                  <Pressable
                    accessible
                    accessibilityLabel={PRODUCT_START_LABEL}
                    accessibilityRole="button"
                    onPress={startProtectedNavigation}
                    style={{
                      backgroundColor: "#ea580c",
                      borderRadius: 8,
                      padding: 14,
                    }}
                  >
                    <Text style={{ color: "#ffffff", fontSize: 17 }}>
                      {PRODUCT_START_LABEL}
                    </Text>
                  </Pressable>
                )}
              </View>
            ) as NativeNode;
          }
          if (href === "/home") {
            productHomeCreations++;
            onCleanup(() => productHomeDisposals++);
            return (
              <View
                ref={(node) => productHomeNodes.add(node)}
                style={{
                  backgroundColor: "#ecfdf5",
                  flex: 1,
                  justifyContent: "center",
                  padding: 24,
                }}
              >
                <Text
                  accessible
                  accessibilityRole="header"
                  ref={(node) => {
                    accessibilityHeading = node;
                  }}
                  style={{ color: "#111827", fontSize: 26, marginBottom: 12 }}
                >
                  {PRODUCT_HOME_CONTENT}
                </Text>
                <Text
                  style={{ color: "#065f46", fontSize: 16, marginBottom: 12 }}
                >
                  {PRODUCT_HOME_LOADER_STATE}; depth {index()}; focused{" "}
                  {String(isFocused())}
                </Text>
                <Text
                  accessible
                  accessibilityLabel={PRODUCT_HOME_STATE}
                  style={{ color: "#065f46", fontSize: 16 }}
                >
                  {PRODUCT_HOME_STATE}
                </Text>
              </View>
            ) as NativeNode;
          }
          if (href === "/slow") {
            productSlowCreations++;
            onCleanup(() => productSlowDisposals++);
            return (
              <Text>Stale protected data mounted after interruption</Text>
            ) as NativeNode;
          }
          if (href === "/protected") {
            productProtectedCreations++;
            onCleanup(() => productProtectedDisposals++);
            return (<Text>Denied protected route mounted</Text>) as NativeNode;
          }
          if (href !== "/linked") {
            throw new Error(
              `The navigation process received an unknown route ${JSON.stringify(href)}.`,
            );
          }
          linkedCreations++;
          onCleanup(() => linkedDisposals++);
          return (
            <View
              ref={(node) => linkedNodes.add(node)}
              style={{
                backgroundColor: "#ecfdf5",
                flex: 1,
                justifyContent: "center",
                padding: 24,
              }}
            >
              <Text
                accessible
                accessibilityRole="header"
                ref={(node) => {
                  accessibilityHeading = node;
                }}
                style={{ color: "#111827", fontSize: 26, marginBottom: 12 }}
              >
                {LINKED_CONTENT}
              </Text>
              <Text
                style={{ color: "#065f46", fontSize: 16, marginBottom: 12 }}
              >
                {LINKED_LOADER_STATE}
              </Text>
              <Text
                style={{ color: "#065f46", fontSize: 16, marginBottom: 16 }}
              >
                {COLD_LINK_STATE}
              </Text>
              <Pressable
                accessible
                accessibilityLabel={DISPOSE_LABEL}
                accessibilityRole="button"
                onPress={() => dispose(false)}
                style={{
                  backgroundColor: "#334155",
                  borderRadius: 8,
                  padding: 14,
                }}
              >
                <Text style={{ color: "#ffffff", fontSize: 17 }}>
                  {DISPOSE_LABEL}
                </Text>
              </Pressable>
            </View>
          ) as NativeNode;
        };
        return (
          <TanStackNativeRouterProvider
            router={router}
            onReady={() => {
              console.log("SOLID_NATIVE_NAVIGATION_PROCESS_ROUTER_READY");
              resolveRouterReady();
            }}
            onError={(error) => {
              rejectRouterReady(error);
              reportFatal(error);
            }}
          >
            {
              (
                <TanStackNativeStack
                  router={router}
                  history={history}
                  scrollRestoration={scrollRestoration}
                  {...(memoryPolicy === undefined ? {} : { memoryPolicy })}
                  preloadRestoredEntries={mode === "restore" ? 1 : 0}
                  shouldPreloadRestoredEntry={(entry, index, signal) => {
                    if (
                      mode !== "restore" ||
                      restorationPreloadPolicyCalls !== 0 ||
                      entry.href !== "/" ||
                      index !== 0 ||
                      signal.aborted
                    ) {
                      throw new Error(
                        `The restoration preload policy received an invalid candidate: ${JSON.stringify(
                          {
                            mode,
                            calls: restorationPreloadPolicyCalls,
                            href: entry.href,
                            index,
                            aborted: signal.aborted,
                          },
                        )}.`,
                      );
                    }
                    restorationPreloadPolicyCalls++;
                    restorationPreloadPolicySignal = signal;
                    return true;
                  }}
                  onPreloadError={reportFatal}
                  renderParked={(entry) =>
                    (
                      <Text>{`Parked navigation route ${entry().href}`}</Text>
                    ) as NativeNode
                  }
                  onPlatformBack={(transition) => {
                    const isClassicBack =
                      transition.kind === "pop" &&
                      transition.origin === "platform" &&
                      transition.from.href === "/detail" &&
                      transition.to.href === "/" &&
                      transition.delta === -1;
                    const isProductBack =
                      mode === "product" &&
                      transition.kind === "pop" &&
                      transition.origin === "platform" &&
                      transition.from.href === "/home" &&
                      transition.to.href === "/login" &&
                      transition.delta === -1;
                    if (!isClassicBack && !isProductBack) {
                      reportFatal(
                        new Error(
                          `The navigation-process platform gesture produced invalid metadata: ${JSON.stringify(transition)}.`,
                        ),
                      );
                      return;
                    }
                    void Promise.resolve()
                      .then(flush)
                      .then(() => {
                        console.log(
                          "SOLID_NATIVE_NAVIGATION_PROCESS_PLATFORM_GESTURE_SUCCEEDED",
                          JSON.stringify({
                            id: transition.id,
                            from: transition.from.href,
                            to: transition.to.href,
                          }),
                        );
                      })
                      .catch(reportFatal);
                  }}
                  onPlatformBackBlocked={(entry) => {
                    if (
                      mode !== "restore" ||
                      entry.href !== "/detail" ||
                      history.location.href !== "/detail"
                    ) {
                      reportFatal(
                        new Error(
                          `The navigation-process blocked iOS gesture was invalid: ${JSON.stringify(
                            {
                              mode,
                              entry: entry.href,
                              current: history.location.href,
                            },
                          )}.`,
                        ),
                      );
                      return;
                    }
                    if (!publishPlatformBackBlocked()) return;
                    void Promise.resolve()
                      .then(flush)
                      .then(() => {
                        console.log(
                          "SOLID_NATIVE_NAVIGATION_PROCESS_PLATFORM_BLOCKED_SUCCEEDED",
                          JSON.stringify({
                            source: "native-dismiss-cancel",
                            from: entry.href,
                            to: "/",
                          }),
                        );
                      })
                      .catch(reportFatal);
                  }}
                  onPlatformBackCancel={(entry) => {
                    if (
                      platform.platform !== "ios" ||
                      mode !== "seed" ||
                      entry.href !== "/detail" ||
                      history.location.href !== "/detail" ||
                      canceledBackCount !== 0 ||
                      blockedBackCount !== 0 ||
                      platformBlockerAttempts !== 0
                    ) {
                      reportFatal(
                        new Error(
                          `The navigation-process canceled iOS gesture was invalid: ${JSON.stringify(
                            {
                              platform: platform.platform,
                              mode,
                              entry: entry.href,
                              current: history.location.href,
                              canceledBackCount,
                              blockedBackCount,
                              platformBlockerAttempts,
                            },
                          )}.`,
                        ),
                      );
                      return;
                    }
                    if (!publishPlatformBackCanceled()) return;
                    void Promise.resolve()
                      .then(flush)
                      .then(() => {
                        console.log(
                          "SOLID_NATIVE_NAVIGATION_PROCESS_PLATFORM_CANCEL_SUCCEEDED",
                          JSON.stringify({
                            source: "native-gesture-cancel",
                            current: entry.href,
                          }),
                        );
                      })
                      .catch(reportFatal);
                  }}
                  onPlatformBackError={reportFatal}
                  onScreenSheetDetentChange={(entry, event) => {
                    if (
                      !(
                        (platform.platform === "android" && mode === "seed") ||
                        (platform.platform === "ios" && mode === "sheet")
                      ) ||
                      entry.href !== "/detail" ||
                      !event.payload.isStable
                    ) {
                      return;
                    }
                    const state =
                      event.payload.index === 0
                        ? DETAIL_SHEET_COLLAPSED_STATE
                        : event.payload.index === 1
                          ? DETAIL_SHEET_EXPANDED_STATE
                          : undefined;
                    if (state === undefined) {
                      reportFatal(
                        new Error(
                          `The navigation sheet emitted an invalid stable detent index: ${String(event.payload.index)}.`,
                        ),
                      );
                      return;
                    }
                    setDetailSheetState(state);
                    void Promise.resolve()
                      .then(flush)
                      .then(() => {
                        console.log(
                          "SOLID_NATIVE_NAVIGATION_PROCESS_SHEET_DETENT_SUCCEEDED",
                          JSON.stringify({ index: event.payload.index }),
                        );
                      })
                      .catch(reportFatal);
                  }}
                  screenOptions={(entry) =>
                    entry.href === "/detail" &&
                    ((platform.platform === "android" && mode === "seed") ||
                      (platform.platform === "ios" && mode === "sheet"))
                      ? {
                          gestureEnabled: true,
                          presentation: "sheet",
                          sheetAllowedDetents: [0.55, 0.92],
                          sheetInitialDetent: "last",
                          sheetLargestUndimmedDetent: "none",
                          sheetGrabberVisible: true,
                          sheetCornerRadius: 20,
                          sheetElevation: 24,
                        }
                      : {
                          gestureEnabled: true,
                          presentation: "push",
                        }
                  }
                  renderHeader={(entry) => {
                    const completeHeaderAction = (): void => {
                      setDetailHeaderActionComplete(true);
                      void Promise.resolve()
                        .then(flush)
                        .then(() => {
                          console.log(
                            "SOLID_NATIVE_NAVIGATION_PROCESS_HEADER_ACTION_SUCCEEDED",
                          );
                        })
                        .catch(reportFatal);
                    };
                    const completeHeaderMenuAction = (): void => {
                      setDetailHeaderMenuActionComplete(true);
                      void Promise.resolve()
                        .then(flush)
                        .then(() => {
                          console.log(
                            "SOLID_NATIVE_NAVIGATION_PROCESS_HEADER_MENU_ACTION_SUCCEEDED",
                          );
                        })
                        .catch(reportFatal);
                    };
                    return (
                      <ScreenHeader
                        title={
                          entry().href === "/"
                            ? "Restored root"
                            : entry().href === "/detail"
                              ? "Restored detail"
                              : entry().href === "/login"
                                ? "Sign in"
                                : entry().href === "/home"
                                  ? "Authenticated home"
                                  : entry().href === "/slow"
                                    ? "Protected data"
                                    : "Cold link"
                        }
                        {...(platform.platform === "ios" &&
                        mode !== "sheet" &&
                        entry().href === "/detail"
                          ? {
                              headerRightBarButtonItems: [
                                {
                                  type: "button",
                                  title: "Verify",
                                  accessibilityLabel:
                                    detailHeaderActionComplete()
                                      ? DETAIL_HEADER_ACTION_DONE
                                      : DETAIL_HEADER_ACTION_LABEL,
                                  selected: detailHeaderActionComplete(),
                                  onPress: completeHeaderAction,
                                },
                                {
                                  type: "menu",
                                  icon: {
                                    type: "sfSymbol",
                                    name: "ellipsis.circle",
                                  },
                                  accessibilityLabel: DETAIL_HEADER_MENU_LABEL,
                                  menu: {
                                    title: "Detail actions",
                                    items: [
                                      {
                                        type: "submenu",
                                        title: DETAIL_HEADER_SUBMENU_LABEL,
                                        items: [
                                          {
                                            type: "action",
                                            title:
                                              DETAIL_HEADER_MENU_ACTION_LABEL,
                                            state:
                                              detailHeaderMenuActionComplete()
                                                ? "on"
                                                : "off",
                                            onPress: completeHeaderMenuAction,
                                          },
                                        ],
                                      },
                                    ],
                                  },
                                },
                              ],
                            }
                          : {})}
                      >
                        {platform.platform === "android" &&
                        entry().href === "/detail" ? (
                          <ScreenHeaderSubview
                            type="right"
                            style={{ marginRight: 8 }}
                          >
                            <Pressable
                              accessible
                              accessibilityLabel={
                                detailHeaderActionComplete()
                                  ? DETAIL_HEADER_ACTION_DONE
                                  : DETAIL_HEADER_ACTION_LABEL
                              }
                              accessibilityRole="button"
                              onPress={completeHeaderAction}
                              style={{ padding: 8 }}
                            >
                              <Text style={{ color: "#2563eb", fontSize: 15 }}>
                                {detailHeaderActionComplete()
                                  ? DETAIL_HEADER_ACTION_DONE
                                  : "Verify header"}
                              </Text>
                            </Pressable>
                          </ScreenHeaderSubview>
                        ) : null}
                      </ScreenHeader>
                    ) as NativeNode;
                  }}
                  renderUnresolved={(entry) =>
                    (entry().href === "/slow" && mode === "product" ? (
                      <ProductPendingScreen />
                    ) : (
                      <View style={{ flex: 1, padding: 24 }}>
                        <Text style={{ color: "#334155", fontSize: 17 }}>
                          Loading restored navigation route {entry().href}
                        </Text>
                      </View>
                    )) as NativeNode
                  }
                />
              ) as NativeNode
            }
          </TanStackNativeRouterProvider>
        );
      },
      host,
      {
        surface: {
          name: "navigation-process-restoration",
          initialProps: {
            style: { backgroundColor: "#f8fafc", flex: 1 },
          },
        },
        autoCommit: false,
        telemetry,
        requirements: {
          capabilities: ["bubblingEvents"],
          components: [
            "Pressable",
            "Screen",
            "ScreenHeader",
            "ScreenHeaderSubview",
            "ScreenStack",
            "ScrollView",
            "Text",
            "View",
          ],
        },
        onCommitError: reportFatal,
      },
    );
    const initialDrain = await application.root.flush();
    if (initialDrain === undefined || initialDrain.sequence < 1) {
      throw new Error(
        "The navigation process proof did not begin with an application-owned commit.",
      );
    }
    await routerReady;
    const settledDrain = await application.root.flushMounted();
    const readySequence =
      settledDrain?.sequence ?? application.root.lastCommittedSequence;
    if (readySequence < initialDrain.sequence) {
      throw new Error(
        "The navigation process router settled behind its initial native commit.",
      );
    }
    console.log(
      "SOLID_NATIVE_NAVIGATION_PROCESS_READY",
      JSON.stringify({
        schemaVersion: 0,
        sequence: readySequence,
        launchSource: launch.source,
        mode,
      }),
    );
    if (mode === "restore") {
      console.log("SOLID_NATIVE_NAVIGATION_PROCESS_RESTORATION_SUCCEEDED");
    }
    if (mode === "product") {
      const snapshot = history.snapshot;
      if (
        router.state.location.pathname !== "/login" ||
        snapshot.index !== 0 ||
        snapshot.entries.length !== 1 ||
        snapshot.entries[0]?.href !== "/login" ||
        productGuardRuns !== 1 ||
        productLoginLoaderRuns !== 1 ||
        productProtectedCreations !== 0
      ) {
        throw new Error(
          `The product authentication redirect exposed protected native history: ${JSON.stringify(
            {
              location: router.state.location.pathname,
              history: snapshot,
              productGuardRuns,
              productLoginLoaderRuns,
              productProtectedCreations,
            },
          )}.`,
        );
      }
      console.log(
        "SOLID_NATIVE_NAVIGATION_PROCESS_PRODUCT_AUTH_REDIRECT_SUCCEEDED",
        JSON.stringify({
          schemaVersion: 0,
          location: router.state.location.pathname,
          history: snapshot.entries.map((entry) => entry.href),
          guardRuns: productGuardRuns,
        }),
      );
    }
  } catch (error) {
    reportFatal(error);
  }
}

void run();
