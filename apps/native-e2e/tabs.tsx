/** @jsxImportSource @solid-native/core */
import "react-native/setup-env";

import {
  CORE_COMPONENT_DESCRIPTORS,
  Pressable,
  ScreenHeader,
  Text,
  View,
  type NativeNode,
  type NativeSyntheticEvent,
  type TabsScreenIcon,
} from "@solid-native/core";
import {
  createHardwareBackHandler,
  createNativeTabsStateFromStorage,
  createNativeTabsStatePersistence,
  createTanStackNativeHistory,
  createTanStackNativeRouter,
  deserializeNativeTabsStateSnapshot,
  NativeTabs,
  TanStackNativeLink,
  TanStackNativeOutlet,
  TanStackNativeRouterProvider,
  TanStackNativeStack,
  TanStackRootRoute,
  TanStackRoute,
  tanStackRedirect,
  serializeNativeTabsStateSnapshot,
  useTanStackNativeLoaderData,
  useTanStackNativeNavigate,
  useTanStackNativeScreen,
  type NativeTabSelection,
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
import { createReactNativeSecureStorage } from "@solid-native/secure-storage/react-native";
import { createSecureStorageController } from "@solid-native/secure-storage/solid";
import { onCleanup } from "solid-js";

import { createGeneratedRNAsyncStorageKeyValueStorage } from "./adapters/RNAsyncStorage";

const PROOF_TIMEOUT_MS = 5_000;
const HOME_KEY = "home";
const SETTINGS_KEY = "settings";
const HOME_CONTENT = "Solid Native home tab content";
const SETTINGS_CONTENT = "Solid Native settings tab content";
const SETTINGS_STATE_PREFIX = "Settings retained state";
const SETTINGS_INCREMENT_LABEL = "Increment settings tab state";
const NESTED_DETAIL_CONTENT = "Solid Native nested settings detail";
const NESTED_DETAIL_STATE_PREFIX = "Nested detail retained state";
const NESTED_LOADER_PREFIX = "Settings TanStack loader";
const NESTED_PUSH_LABEL = "Open nested settings detail";
const NESTED_POP_LABEL = "Pop nested settings detail";
const NESTED_RESET_LABEL = "Reset cold-linked settings root";
const NESTED_SHEET_CONTENT = "Solid Native nested settings sheet";
const NESTED_SHEET_STATE = "Native tabs nested sheet active";
const NESTED_SHEET_OPEN_LABEL = "Start nested settings sheet load";
const NESTED_SHEET_PENDING_STATE = "Nested settings sheet loading";
const NESTED_SHEET_INTERRUPT_LABEL =
  "Interrupt nested settings load with sheet";
const NESTED_SHEET_CAUSAL_STATE =
  "Native tabs sheet interruption causality verified";
const PRODUCT_LOGIN_CONTENT = "Solid Native product authentication";
const PRODUCT_LOGIN_LABEL = "Authenticate composed native flow";
const COLD_LINK_URL =
  "dev.solidnative.tabs://navigation/settings/detail?source=device-test";
const COLD_LINK_STATE = "Native tabs cold launch deep-link; back false";
const PROCESS_SEED_URL =
  "dev.solidnative.tabs://navigation/process-restoration-seed";
const PRODUCT_COMPOSITION_URL =
  "dev.solidnative.tabs://navigation/product-composition";
const PRODUCT_SESSION_RESTORE_URL =
  "dev.solidnative.tabs://navigation/product-session-restore";
const PRODUCT_SESSION_SERVICE_PREFIX = "dev.solidnative.tabs.product-session";
const PRODUCT_SESSION_KEY = "refresh-session";
const PRODUCT_SESSION_PROOF = "Private composed native session proof";
const PRODUCT_SESSION_RESTORED_CONTENT =
  "Solid Native restored protected session";
const PRODUCT_SESSION_CLEAR_LABEL = "Clear restored session and dispose";
const ICON_OWNERSHIP_PROOF_URL =
  "dev.solidnative.tabs://navigation/icon-ownership-proof";
const PROCESS_RESTORATION_STATE = "Native tabs process restoration; back true";
const BLOCKED_BACK_STATE = "Native tabs selected detail Back blocked";
const CANCELED_BACK_STATE = "Native tabs selected detail gesture canceled";
const PROCESS_SEED_LABEL = "Persist native tabs for process relaunch";
const TABS_STORAGE_KEY = "native-tabs";
const DISPOSE_LABEL = "Dispose native tabs proof";
const HOME_ICON_CYCLE_LABEL = "Cycle home tab icon source";
const HOME_ICON_MODE_PREFIX = "Home tab icon source";
const HOME_IMAGE_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAQAAABKfvVzAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAACYktHRAD/h4/MvwAAAAd0SU1FB+oIGRMcAel6sXIAAAB2SURBVDjL1c6xEYAgEAXRjySk5lZgC/RgF7RhIXZiLRSzBo4DjooEGvASkr3jpFYwAEN9PrIb63JP4t/zibOpnAeuwlMsZu7N3OSWhWcL9pw7VspWXMp7Iu8ivWQkCVTJGJOdRTnd36529+G7gfzYf35oaOB/G+3jx1GwXKYdAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTA4LTI1VDE5OjI4OjAxKzAwOjAwLv91OQAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0wOC0yNVQxOToyODowMSswMDowMF+izYUAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMDgtMjVUMTk6Mjg6MDErMDA6MDAIt+xaAAAAAElFTkSuQmCC";
const HOME_SELECTED_IMAGE_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAQAAABKfvVzAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAACYktHRAD/h4/MvwAAAAd0SU1FB+oIGRMcAel6sXIAAAB+SURBVDjLzdLLCYAwEEXRGXHjMmsbsAJbsIg0kTJSRxqxE1u5LgQlqPmAEM/6vsBARBphBMbyfOIwleUzlzmfL8SWdG65s++545l7ihXPO4/GeU8gLdBf+cBK3spw5IatIAfYMCoCNX/gPCU/UxUR6WpebzxQrRz88IbPBtV2pLTwE1C1eOwAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMDgtMjVUMTk6Mjg6MDErMDA6MDAu/3U5AAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTA4LTI1VDE5OjI4OjAxKzAwOjAwX6LNhQAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0wOC0yNVQxOToyODowMSswMDowMAi37FoAAAAASUVORK5CYII=";

type HomeIconMode = "image" | "none" | "resource";

const HOME_RESOURCE_ICON = {
  android: { type: "drawableResource", name: "solid_native_home" },
  ios: { type: "sfSymbol", name: "house" },
} as const;

const HOME_SELECTED_RESOURCE_ICON = {
  android: {
    type: "drawableResource",
    name: "solid_native_home_selected",
  },
  ios: { type: "sfSymbol", name: "house.fill" },
} as const;

const TAB_STANDARD_APPEARANCE = {
  android: {
    tabBarBackgroundColor: "#fff7ed",
    tabBarItemRippleColor: "#7c2d12",
    tabBarItemLabelVisibilityMode: "labeled",
    normal: {
      tabBarItemTitleFontColor: "#9a3412",
      tabBarItemIconColor: "#c2410c",
    },
    selected: {
      tabBarItemTitleFontColor: "#7c2d12",
      tabBarItemIconColor: "#ea580c",
    },
    tabBarItemActiveIndicatorColor: "#fed7aa",
    tabBarItemActiveIndicatorEnabled: true,
    tabBarItemTitleFontFamily: "sans-serif",
    tabBarItemTitleSmallLabelFontSize: 11,
    tabBarItemTitleLargeLabelFontSize: 13,
    tabBarItemTitleFontWeight: "600",
    tabBarItemTitleFontStyle: "normal",
    tabBarItemBadgeBackgroundColor: "#dc2626",
    tabBarItemBadgeTextColor: "#ffffff",
  },
  ios: {
    stacked: {
      normal: {
        tabBarItemTitleFontColor: "#9a3412",
        tabBarItemIconColor: "#c2410c",
      },
      selected: {
        tabBarItemTitleFontWeight: "600",
        tabBarItemTitleFontColor: "#7c2d12",
        tabBarItemIconColor: "#ea580c",
        tabBarItemBadgeBackgroundColor: "#dc2626",
      },
    },
    tabBarBackgroundColor: "#fff7ed",
    tabBarBlurEffect: "none",
    tabBarShadowColor: "#fed7aa",
  },
} as const;

const TAB_SCROLL_EDGE_APPEARANCE = {
  ios: {
    stacked: TAB_STANDARD_APPEARANCE.ios.stacked,
    tabBarBackgroundColor: "#fff7ed",
    tabBarBlurEffect: "none",
    tabBarShadowColor: "#fed7aa",
  },
} as const;

const tabs = [
  {
    key: HOME_KEY,
    title: "Home",
    accessibilityLabel: "Home tab",
    icon: {
      android: { type: "imageSource", source: HOME_IMAGE_URI },
      ios: { type: "templateSource", source: HOME_IMAGE_URI },
    },
    selectedIcon: {
      android: {
        type: "imageSource",
        source: HOME_SELECTED_IMAGE_URI,
      },
      ios: { type: "templateSource", source: HOME_SELECTED_IMAGE_URI },
    },
  },
  {
    key: SETTINGS_KEY,
    title: "Settings",
    accessibilityLabel: "Settings tab",
    icon: {
      android: { type: "drawableResource", name: "solid_native_settings" },
      ios: { type: "sfSymbol", name: "gearshape" },
    },
    selectedIcon: {
      android: {
        type: "drawableResource",
        name: "solid_native_settings_selected",
      },
      ios: { type: "sfSymbol", name: "gearshape.fill" },
    },
  },
] as const;

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

function reportFatal(error: unknown): void {
  console.error("SOLID_NATIVE_TABS_FAILED", error);
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
      throw new Error("The native-tabs causal proof session was not sampled.");
    }
    const platformServices = getReactNativePlatformServices();
    const initialURL = await platformServices.getInitialURL();
    const secureStorageService = createReactNativeSecureStorage({
      servicePrefix: PRODUCT_SESSION_SERVICE_PREFIX,
    });
    if (initialURL === PRODUCT_COMPOSITION_URL) {
      await secureStorageService.removeItem(PRODUCT_SESSION_KEY);
      if ((await secureStorageService.getItem(PRODUCT_SESSION_KEY)) !== null) {
        throw new Error(
          "The product authentication proof could not clear its prior secure session.",
        );
      }
    }
    const nativeStorage = createGeneratedRNAsyncStorageKeyValueStorage({
      databaseName: "solid_native_tabs_e2e",
      prefix: "proof",
    });
    const obsoleteSnapshot = serializeNativeTabsStateSnapshot({
      selectedKey: HOME_KEY,
      tabs: [
        {
          key: HOME_KEY,
          history: {
            entries: [
              { id: "obsolete-home", href: "/obsolete-home", state: null },
            ],
            index: 0,
          },
        },
        {
          key: SETTINGS_KEY,
          history: {
            entries: [
              {
                id: "obsolete-settings",
                href: "/obsolete-settings",
                state: null,
              },
            ],
            index: 0,
          },
        },
      ],
    });
    if (initialURL === COLD_LINK_URL) {
      await nativeStorage.setItem(TABS_STORAGE_KEY, obsoleteSnapshot);
    } else if (initialURL !== null) {
      await nativeStorage.removeItem(TABS_STORAGE_KEY);
    }
    const launch = await createNativeTabsStateFromStorage({
      tabs: [
        { key: HOME_KEY, initialHref: "/" },
        { key: SETTINGS_KEY, initialHref: "/" },
      ],
      storage: nativeStorage,
      storageKey: TABS_STORAGE_KEY,
      initialURL,
      resolveDeepLink: (url) =>
        url === COLD_LINK_URL
          ? {
              tabKey: SETTINGS_KEY,
              href: "/detail",
              state: { source: "physical-cold-link" },
            }
          : url === PRODUCT_COMPOSITION_URL
            ? {
                tabKey: SETTINGS_KEY,
                href: "/protected",
                state: { source: "physical-product-composition" },
              }
            : url === PRODUCT_SESSION_RESTORE_URL
              ? {
                  tabKey: SETTINGS_KEY,
                  href: "/protected",
                  state: { source: "physical-product-session-restore" },
                }
              : undefined,
    });
    if (initialURL === PROCESS_SEED_URL && launch.source !== "initial") {
      throw new Error("The process-restoration seed did not start cleanly.");
    }
    if (
      initialURL === COLD_LINK_URL &&
      (await nativeStorage.getItem(TABS_STORAGE_KEY)) !== null
    ) {
      throw new Error(
        "The accepted cold link did not clear its discarded durable snapshot.",
      );
    }
    if (initialURL === COLD_LINK_URL) {
      console.log("SOLID_NATIVE_TABS_DISCARDED_STORAGE_CLEARED");
    }
    const tabsState = launch.state;
    const tabsPersistence = createNativeTabsStatePersistence(
      tabsState,
      nativeStorage,
      {
        storageKey: TABS_STORAGE_KEY,
        onError: reportFatal,
      },
    );
    const nativeNodes = new Map<string, NativeNode>();
    let ownerCreations = 0;
    let ownerDisposals = 0;
    let nestedRootCreations = 0;
    let nestedRootDisposals = 0;
    let nestedDetailCreations = 0;
    let nestedDetailDisposals = 0;
    const nestedDetailNodes = new Set<NativeNode>();
    let activeNestedDetailNode: NativeNode | undefined;
    let nestedSheetCreations = 0;
    let nestedSheetDisposals = 0;
    const nestedSheetNodes = new Set<NativeNode>();
    let activeNestedSheetNode: NativeNode | undefined;
    let productAuthenticated = false;
    let productGuardRuns = 0;
    let productProtectedCreations = 0;
    let productProtectedDisposals = 0;
    let productLoginCreations = 0;
    let productLoginDisposals = 0;
    let productLoginLoaderRuns = 0;
    let productProtectedLoaderRuns = 0;
    let productSessionStored = false;
    let productSessionRestored = false;
    let productSessionRestoreVerified = false;
    let productSessionCleared = false;
    let productSlowSheetCreations = 0;
    let productSlowSheetDisposals = 0;
    let productSlowSheetLoaderRuns = 0;
    let productSlowSheetLoaderSettlements = 0;
    let settingsRootLoaderRuns = 0;
    let settingsDetailLoaderRuns = 0;
    let settingsSheetLoaderRuns = 0;
    let productLinkCausalSettlementVerified = false;
    let productAuthRedirectVerified = false;
    let productInterruptionCausalSettlementVerified = false;
    let platformBlockerAttempts = 0;
    let blockedBackCount = 0;
    let canceledBackCount = 0;
    let seedCanceledBackCount = 0;
    const [homeIconMode, setHomeIconMode] = createSignal<HomeIconMode>("image");
    let application: NativeApplication | undefined;
    let teardownStarted = false;

    const flush = async (): Promise<void> => {
      const app = application;
      if (app === undefined) {
        throw new Error("The native tabs application was not retained.");
      }
      await app.root.flush();
    };

    const verifyProductLinkCausalSettlement = async (): Promise<void> => {
      const app = application;
      if (app === undefined) {
        throw new Error("The native-tabs link proof lost its application.");
      }
      const mounted = await app.root.flushMounted();
      const tasks = telemetryRecords.filter(
        (
          record,
        ): record is Extract<
          CausalTelemetryRecord,
          { readonly type: "operation-started" }
        > =>
          record.type === "operation-started" &&
          record.name === "solid-native.task" &&
          record.attributes["task.name"] === "navigation.link",
      );
      const task = tasks[0];
      const taskFinish =
        task === undefined
          ? undefined
          : telemetryRecords.find(
              (record) =>
                record.type === "operation-finished" &&
                record.operationId === task.operationId,
            );
      const press =
        task === undefined
          ? undefined
          : telemetryRecords.find(
              (record) =>
                record.type === "operation-started" &&
                record.name === "solid-native.event" &&
                record.attributes["event.name"] === "press" &&
                task.causes.includes(record.operationId),
            );
      const commits =
        task === undefined
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
                record.causes.includes(task.operationId),
            );
      const finalCommit = commits.at(-1);
      const expectedTaskAttributeKeys = [
        "resource.platform",
        "resource.runtime.host_contract_version",
        "resource.runtime.name",
        "resource.runtime.version",
        "task.name",
      ];
      const taskAttributeKeys =
        task === undefined ? [] : Object.keys(task.attributes).sort();
      if (
        tasks.length !== 1 ||
        task === undefined ||
        task.causes.length !== 1 ||
        press?.type !== "operation-started" ||
        taskAttributeKeys.length !== expectedTaskAttributeKeys.length ||
        taskAttributeKeys.some(
          (key, index) => key !== expectedTaskAttributeKeys[index],
        ) ||
        taskFinish?.type !== "operation-finished" ||
        taskFinish.status !== "ok" ||
        commits.length < 2 ||
        finalCommit?.attributes["commit.priority"] !== "normal" ||
        mounted === undefined ||
        mounted.sequence !== finalCommit.attributes["commit.sequence"]
      ) {
        throw new Error(
          `The composed native-tabs link lost causal settlement: ${JSON.stringify(
            {
              tasks: tasks.length,
              taskCauses: task?.causes.length,
              pressObserved: press !== undefined,
              taskAttributeKeys,
              taskStatus:
                taskFinish?.type === "operation-finished"
                  ? taskFinish.status
                  : undefined,
              commits: commits.length,
              finalPriority: finalCommit?.attributes["commit.priority"],
              mountedSequence: mounted?.sequence,
              finalSequence: finalCommit?.attributes["commit.sequence"],
            },
          )}.`,
        );
      }
      productLinkCausalSettlementVerified = true;
      console.log(
        "SOLID_NATIVE_TABS_PRODUCT_LINK_CAUSALITY_SUCCEEDED",
        JSON.stringify({
          schemaVersion: 0,
          commits: commits.length,
          finalPriority: finalCommit.attributes["commit.priority"],
          sequence: mounted.sequence,
        }),
      );
    };

    const handleTabSelected = (
      selection: NativeTabSelection,
      event: NativeSyntheticEvent,
    ): void => {
      try {
        if (
          event.name !== "tabSelected" ||
          event.priority !== "discrete" ||
          event.bubbles
        ) {
          throw new Error(
            `The native tabs host emitted an invalid event route: ${JSON.stringify(
              {
                name: event.name,
                priority: event.priority,
                bubbles: event.bubbles,
                coalescible: event.coalescible,
              },
            )}.`,
          );
        }
        if (
          selection.selectedKey !== HOME_KEY &&
          selection.selectedKey !== SETTINGS_KEY
        ) {
          throw new Error(
            "The native tabs host selected an unknown physical tab.",
          );
        }
        tabsState.handleTabSelected(selection);
        void Promise.resolve()
          .then(flush)
          .then(() => {
            console.log(
              "SOLID_NATIVE_TABS_SELECTION_SUCCEEDED",
              JSON.stringify(selection),
            );
          })
          .catch(reportFatal);
      } catch (error) {
        reportFatal(error);
      }
    };

    const dispose = (preserveDurableSnapshot: boolean): void => {
      if (teardownStarted) return;
      teardownStarted = true;
      const app = application;
      if (app === undefined) {
        reportFatal(new Error("The native tabs application was not retained."));
        return;
      }
      void tabsPersistence
        .flush()
        .then(async () => {
          const serializedSnapshot =
            await nativeStorage.getItem(TABS_STORAGE_KEY);
          if (serializedSnapshot === null) {
            throw new Error("The native tabs snapshot was not stored.");
          }
          const persistedSnapshot =
            deserializeNativeTabsStateSnapshot(serializedSnapshot);
          const persistedSettings = persistedSnapshot.tabs.find(
            (tab) => tab.key === SETTINGS_KEY,
          );
          const persistedSettingsEntry =
            persistedSettings?.history.entries[persistedSettings.history.index];
          const expectedSettingsHref = preserveDurableSnapshot
            ? "/detail"
            : initialURL === PRODUCT_SESSION_RESTORE_URL
              ? "/protected"
              : "/";
          const expectedSettingsIndex = preserveDurableSnapshot ? 1 : 0;
          if (
            persistedSnapshot.selectedKey !== SETTINGS_KEY ||
            persistedSettingsEntry?.href !== expectedSettingsHref ||
            persistedSettings?.history.index !== expectedSettingsIndex ||
            persistedSnapshot.tabs.some((tab) =>
              tab.history.entries.some((entry) =>
                entry.href.startsWith("/obsolete-"),
              ),
            )
          ) {
            throw new Error(
              `The durable native tabs snapshot retained stale launch state: ${serializedSnapshot}`,
            );
          }
          console.log(
            "SOLID_NATIVE_TABS_PERSISTENCE_SUCCEEDED",
            JSON.stringify({
              schemaVersion: 0,
              selectedKey: persistedSnapshot.selectedKey,
              settingsHref: persistedSettingsEntry.href,
              settingsIndex: persistedSettings.history.index,
              preserveDurableSnapshot,
            }),
          );
          if (preserveDurableSnapshot) {
            console.log("SOLID_NATIVE_TABS_PROCESS_SEED_SUCCEEDED");
          } else {
            await nativeStorage.removeItem(TABS_STORAGE_KEY);
            if ((await nativeStorage.getItem(TABS_STORAGE_KEY)) !== null) {
              throw new Error("The native tabs proof storage was not removed.");
            }
          }
          await app.dispose();
        })
        .then(() => {
          const productComposition = initialURL === PRODUCT_COMPOSITION_URL;
          const productSessionRestore =
            initialURL === PRODUCT_SESSION_RESTORE_URL;
          const expectedNestedRootCount = productSessionRestore ? 0 : 1;
          const expectedNestedDetailCount = productSessionRestore
            ? 0
            : initialURL === COLD_LINK_URL
              ? 2
              : 1;
          const expectedNestedSheetCount = productComposition ? 1 : 0;
          const secureEventCount = (name: string): number =>
            telemetryRecords.filter(
              (record) =>
                record.type === "operation-started" &&
                record.name === "solid-native.event" &&
                record.attributes["event.name"] === name,
            ).length;
          const secureReadEvents = secureEventCount(
            "platform.secure-storage.read",
          );
          const secureWriteEvents = secureEventCount(
            "platform.secure-storage.write",
          );
          const secureRemoveEvents = secureEventCount(
            "platform.secure-storage.remove",
          );
          const privateTelemetry = JSON.stringify(telemetryRecords);
          if (
            ownerCreations !== tabs.length ||
            ownerDisposals !== tabs.length ||
            nativeNodes.size !== tabs.length ||
            nestedRootCreations !== expectedNestedRootCount ||
            nestedRootDisposals !== expectedNestedRootCount ||
            nestedDetailCreations !== expectedNestedDetailCount ||
            nestedDetailDisposals !== expectedNestedDetailCount ||
            nestedSheetCreations !== expectedNestedSheetCount ||
            nestedSheetDisposals !== expectedNestedSheetCount ||
            productAuthRedirectVerified !== productComposition ||
            productGuardRuns !==
              (productComposition || productSessionRestore ? 1 : 0) ||
            productProtectedCreations !== (productSessionRestore ? 1 : 0) ||
            productProtectedDisposals !== (productSessionRestore ? 1 : 0) ||
            productProtectedLoaderRuns !== (productSessionRestore ? 1 : 0) ||
            productLoginCreations !== expectedNestedSheetCount ||
            productLoginDisposals !== expectedNestedSheetCount ||
            productLoginLoaderRuns !== expectedNestedSheetCount ||
            productSlowSheetCreations !== 0 ||
            productSlowSheetDisposals !== 0 ||
            productSlowSheetLoaderRuns !== expectedNestedSheetCount ||
            productSlowSheetLoaderSettlements !== expectedNestedSheetCount ||
            (productSessionRestore
              ? settingsRootLoaderRuns !== 0
              : settingsRootLoaderRuns < 1) ||
            (productSessionRestore
              ? settingsDetailLoaderRuns !== 0
              : settingsDetailLoaderRuns < 1) ||
            settingsSheetLoaderRuns !== expectedNestedSheetCount ||
            productLinkCausalSettlementVerified !== productComposition ||
            productInterruptionCausalSettlementVerified !==
              productComposition ||
            productSessionStored !== productComposition ||
            productSessionRestored !== productSessionRestore ||
            productSessionRestoreVerified !== productSessionRestore ||
            productSessionCleared !== productSessionRestore ||
            secureReadEvents !== (productSessionRestore ? 2 : 0) ||
            secureWriteEvents !== (productComposition ? 1 : 0) ||
            secureRemoveEvents !== (productSessionRestore ? 1 : 0) ||
            privateTelemetry.includes(PRODUCT_SESSION_KEY) ||
            privateTelemetry.includes(PRODUCT_SESSION_PROOF) ||
            nestedDetailNodes.size !== expectedNestedDetailCount ||
            activeNestedDetailNode !== undefined ||
            nestedSheetNodes.size !== expectedNestedSheetCount ||
            activeNestedSheetNode !== undefined ||
            platformBlockerAttempts !==
              (platformServices.platform === "ios" &&
              launch.source === "restoration"
                ? 2
                : 0) ||
            blockedBackCount !==
              (platformServices.platform === "ios" &&
              launch.source === "restoration"
                ? 1
                : 0) ||
            (platformServices.platform !== "ios" && canceledBackCount !== 0) ||
            canceledBackCount < seedCanceledBackCount ||
            seedCanceledBackCount !==
              (platformServices.platform === "ios" &&
              initialURL === PROCESS_SEED_URL
                ? 1
                : 0) ||
            tabsState.selectedKey() !== SETTINGS_KEY ||
            !app.root.disposed ||
            binding.getSurfaceInfo().ready
          ) {
            throw new Error(
              `Native tabs teardown violated ownership invariants: ${JSON.stringify(
                {
                  ownerCreations,
                  ownerDisposals,
                  retainedNativeNodes: nativeNodes.size,
                  nestedRootCreations,
                  nestedRootDisposals,
                  nestedDetailCreations,
                  nestedDetailDisposals,
                  nestedSheetCreations,
                  nestedSheetDisposals,
                  productAuthRedirectVerified,
                  productGuardRuns,
                  productProtectedCreations,
                  productProtectedDisposals,
                  productLoginCreations,
                  productLoginDisposals,
                  productLoginLoaderRuns,
                  productProtectedLoaderRuns,
                  productSessionStored,
                  productSessionRestored,
                  productSessionRestoreVerified,
                  productSessionCleared,
                  secureReadEvents,
                  secureWriteEvents,
                  secureRemoveEvents,
                  productSlowSheetCreations,
                  productSlowSheetDisposals,
                  productSlowSheetLoaderRuns,
                  productSlowSheetLoaderSettlements,
                  settingsRootLoaderRuns,
                  settingsDetailLoaderRuns,
                  settingsSheetLoaderRuns,
                  productLinkCausalSettlementVerified,
                  productInterruptionCausalSettlementVerified,
                  distinctNestedDetailNodes: nestedDetailNodes.size,
                  activeNestedDetailNode: activeNestedDetailNode !== undefined,
                  distinctNestedSheetNodes: nestedSheetNodes.size,
                  activeNestedSheetNode: activeNestedSheetNode !== undefined,
                  platformBlockerAttempts,
                  blockedBackCount,
                  canceledBackCount,
                  seedCanceledBackCount,
                  selectedTabKey: tabsState.selectedKey(),
                  launchSource: launch.source,
                  preserveDurableSnapshot,
                  rootDisposed: app.root.disposed,
                  surfaceReady: binding.getSurfaceInfo().ready,
                },
              )}.`,
            );
          }
          if (productComposition) {
            console.log(
              "SOLID_NATIVE_TABS_PRODUCT_COMPOSITION_SUCCEEDED",
              JSON.stringify({
                schemaVersion: 0,
                nestedDetailCreations,
                nestedSheetCreations,
                productGuardRuns,
                productLoginCreations,
                productLoginLoaderRuns,
                productSessionStored,
                productSlowSheetLoaderRuns,
                productSlowSheetLoaderSettlements,
                settingsRootLoaderRuns,
                settingsDetailLoaderRuns,
                settingsSheetLoaderRuns,
                productLinkCausalSettlementVerified,
                productInterruptionCausalSettlementVerified,
              }),
            );
          }
          console.log(
            "SOLID_NATIVE_TABS_TEARDOWN_SUCCEEDED",
            JSON.stringify({
              schemaVersion: 0,
              ownerCreations,
              ownerDisposals,
              nestedRootCreations,
              nestedRootDisposals,
              nestedDetailCreations,
              nestedDetailDisposals,
              nestedSheetCreations,
              nestedSheetDisposals,
              productAuthRedirectVerified,
              productGuardRuns,
              productLoginCreations,
              productLoginDisposals,
              productLoginLoaderRuns,
              productProtectedLoaderRuns,
              productSessionStored,
              productSessionRestored,
              productSessionRestoreVerified,
              productSessionCleared,
              secureReadEvents,
              secureWriteEvents,
              secureRemoveEvents,
              productSlowSheetLoaderRuns,
              productSlowSheetLoaderSettlements,
              distinctNestedDetailNodes: nestedDetailNodes.size,
              distinctNestedSheetNodes: nestedSheetNodes.size,
              settingsRootLoaderRuns,
              settingsDetailLoaderRuns,
              settingsSheetLoaderRuns,
              productLinkCausalSettlementVerified,
              productInterruptionCausalSettlementVerified,
              platformBlockerAttempts,
              blockedBackCount,
              canceledBackCount,
              seedCanceledBackCount,
              selectedTabKey: tabsState.selectedKey(),
              launchSource: launch.source,
              preserveDurableSnapshot,
              rootDisposed: app.root.disposed,
              surfaceReady: binding.getSurfaceInfo().ready,
            }),
          );
        })
        .finally(() => {
          tabsPersistence.dispose();
          tabsState.dispose();
        })
        .catch(reportFatal);
    };

    application = startApplication(
      () => (
        <NativeTabs
          tabs={tabs}
          selectedKey={tabsState.selectedKey()}
          nativeContainerBackgroundColor="#f8fafc"
          tabBarRespectsIMEInsets
          screenOptions={(tab) => {
            const mode = homeIconMode();
            const icon: TabsScreenIcon | undefined =
              tab.key !== HOME_KEY || mode === "image"
                ? tab.icon
                : mode === "resource"
                  ? HOME_RESOURCE_ICON
                  : undefined;
            const selectedIcon: TabsScreenIcon | undefined =
              tab.key !== HOME_KEY || mode === "image"
                ? tab.selectedIcon
                : mode === "resource"
                  ? HOME_SELECTED_RESOURCE_ICON
                  : undefined;
            return {
              title: tab.title,
              ...(icon === undefined ? {} : { icon }),
              ...(selectedIcon === undefined ? {} : { selectedIcon }),
              standardAppearance: TAB_STANDARD_APPEARANCE,
              scrollEdgeAppearance: TAB_SCROLL_EDGE_APPEARANCE,
              tabBarItemAccessibilityLabel: tab.accessibilityLabel,
              tabBarItemTestID: `solid-native-${tab.key}-tab`,
            };
          }}
          onTabSelected={handleTabSelected}
          onError={reportFatal}
        >
          {(tab, index, isSelected) => {
            const key = tab().key;
            ownerCreations++;
            onCleanup(() => {
              ownerDisposals++;
            });
            if (key === HOME_KEY) {
              return (
                <View
                  ref={(node) => {
                    const previous = nativeNodes.get(key);
                    if (previous !== undefined && previous !== node) {
                      throw new Error(
                        `Native tab ${JSON.stringify(key)} replaced its retained native root.`,
                      );
                    }
                    nativeNodes.set(key, node);
                  }}
                  style={{
                    backgroundColor: "#eff6ff",
                    flex: 1,
                    justifyContent: "center",
                    padding: 24,
                  }}
                >
                  <Text
                    accessibilityRole="header"
                    style={{
                      color: "#111827",
                      fontSize: 26,
                      marginBottom: 12,
                    }}
                  >
                    {HOME_CONTENT}
                  </Text>
                  <Text style={{ color: "#334155", fontSize: 16 }}>
                    Native tab {index() + 1}; selected {String(isSelected())}
                  </Text>
                  <Text
                    style={{ color: "#334155", fontSize: 16, marginTop: 12 }}
                  >
                    {HOME_ICON_MODE_PREFIX} {homeIconMode()}
                  </Text>
                  <Pressable
                    accessible
                    accessibilityLabel={HOME_ICON_CYCLE_LABEL}
                    accessibilityRole="button"
                    onPress={() => {
                      setHomeIconMode((mode) =>
                        mode === "image"
                          ? "none"
                          : mode === "none"
                            ? "resource"
                            : "image",
                      );
                    }}
                    style={{
                      backgroundColor: "#dbeafe",
                      borderRadius: 8,
                      marginTop: 16,
                      padding: 12,
                    }}
                  >
                    <Text style={{ color: "#1e3a8a", fontSize: 16 }}>
                      {HOME_ICON_CYCLE_LABEL}
                    </Text>
                  </Pressable>
                </View>
              );
            }

            const secureStorage =
              createSecureStorageController(secureStorageService);
            const [settingsCount, setSettingsCount] = createSignal(0);
            const [
              productInterruptionCausalSettlementReady,
              setProductInterruptionCausalSettlementReady,
            ] = createSignal(false);
            const [restoredRootReady, setRestoredRootReady] =
              createSignal(false);
            const [platformBackBlocked, setPlatformBackBlocked] =
              createSignal(false);
            const [platformBackCanceled, setPlatformBackCanceled] =
              createSignal(false);
            const settingsHistory = tabsState.history(SETTINGS_KEY);
            const settingsRouterHistory = createTanStackNativeHistory(
              settingsHistory,
              { onNavigationError: reportFatal },
            );
            let renderSettingsRoute: (() => NativeNode) | undefined;
            const SettingsRouteComponent = (): NativeNode => {
              const render = renderSettingsRoute;
              if (render === undefined) {
                throw new Error(
                  "The Settings TanStack route renderer was not installed.",
                );
              }
              return render();
            };
            const settingsRootRoute = new TanStackRootRoute({
              component: TanStackNativeOutlet,
            });
            const productProtectedRoute = new TanStackRoute({
              getParentRoute: () => settingsRootRoute,
              path: "/protected",
              beforeLoad: () => {
                productGuardRuns++;
                if (
                  !productAuthenticated &&
                  initialURL === PRODUCT_SESSION_RESTORE_URL
                ) {
                  return secureStorage
                    .getItem(PRODUCT_SESSION_KEY)
                    .then((session) => {
                      if (session !== PRODUCT_SESSION_PROOF) {
                        throw new Error(
                          "The protected cold launch did not restore its exact native credential.",
                        );
                      }
                      productAuthenticated = true;
                      productSessionRestored = true;
                      console.log("SOLID_NATIVE_TABS_PRODUCT_SESSION_RESTORED");
                    });
                }
                if (!productAuthenticated) {
                  throw tanStackRedirect({ to: "/login", replace: true });
                }
              },
              loader: () => {
                productProtectedLoaderRuns++;
                return { proof: "protected" };
              },
              component: SettingsRouteComponent,
            });
            const productLoginRoute = new TanStackRoute({
              getParentRoute: () => settingsRootRoute,
              path: "/login",
              loader: () => {
                productLoginLoaderRuns++;
                return { proof: "login" };
              },
              component: SettingsRouteComponent,
            });
            const settingsHomeRoute = new TanStackRoute({
              getParentRoute: () => settingsRootRoute,
              path: "/",
              loader: () => {
                settingsRootLoaderRuns++;
                return { proof: "root" };
              },
              component: SettingsRouteComponent,
            });
            const settingsDetailRoute = new TanStackRoute({
              getParentRoute: () => settingsRootRoute,
              path: "/detail",
              loader: () => {
                settingsDetailLoaderRuns++;
                return initialURL === PRODUCT_COMPOSITION_URL
                  ? delay(75).then(() => ({ proof: "detail" }))
                  : { proof: "detail" };
              },
              component: SettingsRouteComponent,
            });
            const settingsSheetRoute = new TanStackRoute({
              getParentRoute: () => settingsRootRoute,
              path: "/sheet",
              loader: () => {
                settingsSheetLoaderRuns++;
                return initialURL === PRODUCT_COMPOSITION_URL
                  ? delay(75).then(() => ({ proof: "sheet" }))
                  : { proof: "sheet" };
              },
              component: SettingsRouteComponent,
            });
            let resolveProductSlowSheetSettled!: () => void;
            const productSlowSheetSettled = new Promise<void>((resolve) => {
              resolveProductSlowSheetSettled = resolve;
            });
            const productSlowSheetRoute = new TanStackRoute({
              getParentRoute: () => settingsRootRoute,
              path: "/slow-sheet",
              loader: async () => {
                productSlowSheetLoaderRuns++;
                await delay(platformServices.platform === "ios" ? 8_000 : 500);
                productSlowSheetLoaderSettlements++;
                resolveProductSlowSheetSettled();
                return { proof: "slow-sheet" };
              },
              component: SettingsRouteComponent,
            });
            const settingsRouter = createTanStackNativeRouter({
              routeTree: settingsRootRoute.addChildren([
                productProtectedRoute,
                productLoginRoute,
                settingsHomeRoute,
                settingsDetailRoute,
                settingsSheetRoute,
                productSlowSheetRoute,
              ]),
              history: settingsRouterHistory,
              isServer: false,
              defaultPendingMs: 0,
              defaultPendingMinMs: 0,
            });
            const verifyProductInterruptionCausalSettlement = async () => {
              const app = application;
              if (app === undefined) {
                throw new Error(
                  "The composed interruption proof lost its application.",
                );
              }
              await productSlowSheetSettled;
              await delay(0);
              const mounted = await app.root.flushMounted();
              const mountedSequence =
                mounted?.sequence ?? app.root.lastCommittedSequence;
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
                  (
                    record,
                  ): record is Extract<
                    CausalTelemetryRecord,
                    { readonly type: "operation-finished" }
                  > =>
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
              const expectedTaskAttributeKeys = [
                "resource.platform",
                "resource.runtime.host_contract_version",
                "resource.runtime.name",
                "resource.runtime.version",
                "task.name",
              ];
              const displacedTask = tasks[0];
              const winningTask = tasks[1];
              const displacedCommits =
                displacedTask === undefined
                  ? []
                  : taskCommits(displacedTask.operationId);
              const winningCommits =
                winningTask === undefined
                  ? []
                  : taskCommits(winningTask.operationId);
              const finalCommit = winningCommits.at(-1);
              const finalSequence =
                typeof finalCommit?.attributes["commit.sequence"] === "number"
                  ? finalCommit.attributes["commit.sequence"]
                  : undefined;
              const laterCommits =
                finalSequence === undefined
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
                        typeof record.attributes["commit.sequence"] ===
                          "number" &&
                        record.attributes["commit.sequence"] > finalSequence,
                    );
              const snapshot = settingsHistory.snapshot;
              if (
                tasks.length !== 2 ||
                displacedTask === undefined ||
                winningTask === undefined ||
                tasks.some((task) => {
                  const keys = Object.keys(task.attributes).sort();
                  return (
                    keys.length !== expectedTaskAttributeKeys.length ||
                    keys.some(
                      (key, index) => key !== expectedTaskAttributeKeys[index],
                    )
                  );
                }) ||
                taskFinish(displacedTask.operationId)?.status !== "cancelled" ||
                taskFinish(winningTask.operationId)?.status !== "ok" ||
                displacedCommits.length < 1 ||
                winningCommits.length < 1 ||
                finalCommit?.attributes["commit.priority"] !== "normal" ||
                finalSequence === undefined ||
                mountedSequence < finalSequence ||
                laterCommits.some(
                  (commit) =>
                    commit.attributes["commit.priority"] !== "normal" ||
                    commit.causes.includes(displacedTask.operationId) ||
                    commit.causes.includes(winningTask.operationId),
                ) ||
                settingsRouter.state.location.pathname !== "/sheet" ||
                snapshot.index !== 2 ||
                snapshot.entries.map((entry) => entry.href).join("|") !==
                  "/|/detail|/sheet"
              ) {
                throw new Error(
                  `The composed sheet interruption lost causal ownership: ${JSON.stringify(
                    {
                      tasks: tasks.length,
                      displacedStatus:
                        displacedTask === undefined
                          ? undefined
                          : taskFinish(displacedTask.operationId)?.status,
                      winningStatus:
                        winningTask === undefined
                          ? undefined
                          : taskFinish(winningTask.operationId)?.status,
                      displacedCommits: displacedCommits.length,
                      winningCommits: winningCommits.length,
                      finalPriority: finalCommit?.attributes["commit.priority"],
                      finalSequence,
                      mountedSequence,
                      laterCommits: laterCommits.length,
                      location: settingsRouter.state.location.pathname,
                      history: snapshot,
                    },
                  )}.`,
                );
              }
              productInterruptionCausalSettlementVerified = true;
              setProductInterruptionCausalSettlementReady(true);
              await app.root.flush();
              console.log(
                "SOLID_NATIVE_TABS_PRODUCT_INTERRUPTION_SUCCEEDED",
                JSON.stringify({
                  schemaVersion: 0,
                  displacedCommits: displacedCommits.length,
                  winningCommits: winningCommits.length,
                  finalSequence,
                  mountedSequence,
                }),
              );
            };
            let removePlatformBackBlocker: (() => void) | undefined;
            if (
              platformServices.platform === "ios" &&
              launch.source === "restoration"
            ) {
              removePlatformBackBlocker = settingsRouterHistory.block({
                blockerFn({ action, currentLocation, nextLocation }) {
                  platformBlockerAttempts++;
                  if (
                    action !== "BACK" ||
                    currentLocation.pathname !== "/detail" ||
                    nextLocation.pathname !== "/" ||
                    platformBlockerAttempts > 2
                  ) {
                    throw new Error(
                      `The selected-tab blocker received an invalid attempt: ${JSON.stringify(
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
                  console.log("SOLID_NATIVE_TABS_BLOCKER_RELEASED");
                  return false;
                },
              });
            }
            onCleanup(() => {
              removePlatformBackBlocker?.();
              removePlatformBackBlocker = undefined;
              settingsRouterHistory.destroy();
            });
            const hardwareBack = platformServices.subscribeHardwareBack(
              createHardwareBackHandler(
                () => {
                  const selectedHistory = tabsState.selectedHistory();
                  return selectedHistory.snapshot.index > 0
                    ? selectedHistory
                    : undefined;
                },
                {
                  onTransition: (transition) => {
                    void Promise.resolve()
                      .then(flush)
                      .then(() => {
                        console.log(
                          "SOLID_NATIVE_TABS_PLATFORM_BACK_SUCCEEDED",
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
                },
              ),
            );
            onCleanup(() => hardwareBack.remove());
            renderSettingsRoute = () => {
              const {
                entry,
                index: nestedIndex,
                isFocused: isNestedFocused,
              } = useTanStackNativeScreen();
              const loaderData =
                useTanStackNativeLoaderData<typeof settingsRouter>();
              const expectedLoaderProof =
                entry().href === "/login"
                  ? "login"
                  : entry().href === "/protected"
                    ? "protected"
                    : entry().href === "/detail"
                      ? "detail"
                      : entry().href === "/sheet"
                        ? "sheet"
                        : entry().href === "/slow-sheet"
                          ? "slow-sheet"
                          : "root";
              const loaded = loaderData() as unknown;
              if (
                loaded === null ||
                typeof loaded !== "object" ||
                Array.isArray(loaded) ||
                (loaded as { readonly proof?: unknown }).proof !==
                  expectedLoaderProof
              ) {
                throw new Error(
                  `The Settings route received invalid loader data for ${JSON.stringify(entry().href)}.`,
                );
              }
              if (entry().href === "/protected") {
                productProtectedCreations++;
                onCleanup(() => productProtectedDisposals++);
                return (
                  <View
                    ref={(node) => {
                      const previous = nativeNodes.get(key);
                      if (previous !== undefined && previous !== node) {
                        throw new Error(
                          `Native tab ${JSON.stringify(key)} replaced its retained native root.`,
                        );
                      }
                      nativeNodes.set(key, node);
                    }}
                    style={{
                      backgroundColor: "#ecfdf5",
                      flex: 1,
                      justifyContent: "center",
                      padding: 24,
                    }}
                  >
                    <Text accessibilityRole="header" style={{ fontSize: 24 }}>
                      {PRODUCT_SESSION_RESTORED_CONTENT}
                    </Text>
                    <Pressable
                      accessible
                      accessibilityLabel={PRODUCT_SESSION_CLEAR_LABEL}
                      accessibilityRole="button"
                      onPress={() => {
                        void secureStorage
                          .removeItem(PRODUCT_SESSION_KEY)
                          .then(() =>
                            secureStorage.getItem(PRODUCT_SESSION_KEY),
                          )
                          .then((session) => {
                            if (session !== null) {
                              throw new Error(
                                "The restored product session survived secure logout.",
                              );
                            }
                            productSessionCleared = true;
                            console.log(
                              "SOLID_NATIVE_TABS_PRODUCT_SESSION_CLEARED",
                            );
                            dispose(false);
                          })
                          .catch(reportFatal);
                      }}
                      style={{
                        backgroundColor: "#047857",
                        borderRadius: 8,
                        marginTop: 16,
                        padding: 14,
                      }}
                    >
                      <Text style={{ color: "#ffffff", fontSize: 17 }}>
                        {PRODUCT_SESSION_CLEAR_LABEL}
                      </Text>
                    </Pressable>
                  </View>
                ) as NativeNode;
              }
              if (entry().href === "/slow-sheet") {
                productSlowSheetCreations++;
                onCleanup(() => productSlowSheetDisposals++);
                return (<Text>Stale product sheet mounted</Text>) as NativeNode;
              }
              if (entry().href === "/login") {
                productLoginCreations++;
                onCleanup(() => productLoginDisposals++);
                return (
                  <View
                    style={{
                      backgroundColor: "#fff7ed",
                      flex: 1,
                      justifyContent: "center",
                      padding: 24,
                    }}
                  >
                    <Text
                      accessibilityRole="header"
                      style={{
                        color: "#111827",
                        fontSize: 26,
                        marginBottom: 16,
                      }}
                    >
                      {PRODUCT_LOGIN_CONTENT}
                    </Text>
                    <Pressable
                      accessible
                      accessibilityLabel={PRODUCT_LOGIN_LABEL}
                      accessibilityRole="button"
                      onPress={() => {
                        void secureStorage
                          .setItem(PRODUCT_SESSION_KEY, PRODUCT_SESSION_PROOF)
                          .then(() => {
                            productAuthenticated = true;
                            productSessionStored = true;
                            console.log(
                              "SOLID_NATIVE_TABS_PRODUCT_SESSION_STORED",
                            );
                            return settingsRouter.navigate({
                              to: "/",
                              replace: true,
                            });
                          })
                          .then(flush)
                          .catch(reportFatal);
                      }}
                      style={{
                        backgroundColor: "#c2410c",
                        borderRadius: 8,
                        padding: 14,
                      }}
                    >
                      <Text style={{ color: "#ffffff", fontSize: 17 }}>
                        {PRODUCT_LOGIN_LABEL}
                      </Text>
                    </Pressable>
                  </View>
                ) as NativeNode;
              }
              const isDetail = entry().href === "/detail";
              const isSheet = entry().href === "/sheet";
              if (isSheet) {
                nestedSheetCreations++;
                onCleanup(() => {
                  nestedSheetDisposals++;
                  activeNestedSheetNode = undefined;
                });
                return (
                  <View
                    ref={(node) => {
                      if (
                        activeNestedSheetNode !== undefined &&
                        activeNestedSheetNode !== node
                      ) {
                        throw new Error(
                          "The nested sheet replaced its retained native root.",
                        );
                      }
                      activeNestedSheetNode = node;
                      nestedSheetNodes.add(node);
                    }}
                    style={{
                      backgroundColor: "#fff7ed",
                      flex: 1,
                      justifyContent: "center",
                      padding: 24,
                    }}
                  >
                    <Text
                      accessibilityRole="header"
                      style={{
                        color: "#111827",
                        fontSize: 26,
                        marginBottom: 12,
                      }}
                    >
                      {NESTED_SHEET_CONTENT}
                    </Text>
                    <Text
                      accessible
                      accessibilityLabel={NESTED_SHEET_STATE}
                      style={{
                        color: "#9a3412",
                        fontSize: 18,
                        marginBottom: 16,
                      }}
                    >
                      {NESTED_SHEET_STATE}; retained settings {settingsCount()};
                      depth {nestedIndex()}; focused {String(isNestedFocused())}
                    </Text>
                    <Text style={{ color: "#9a3412", fontSize: 16 }}>
                      {NESTED_LOADER_PREFIX} {expectedLoaderProof}
                    </Text>
                    {productInterruptionCausalSettlementReady() ? (
                      <Text style={{ color: "#9a3412", fontSize: 16 }}>
                        {NESTED_SHEET_CAUSAL_STATE}
                      </Text>
                    ) : null}
                  </View>
                ) as NativeNode;
              }
              if (isDetail) {
                const startSheetNavigation = useTanStackNativeNavigate({
                  from: "/detail",
                });
                nestedDetailCreations++;
                onCleanup(() => {
                  nestedDetailDisposals++;
                  activeNestedDetailNode = undefined;
                });
                return (
                  <View
                    ref={(node) => {
                      if (
                        activeNestedDetailNode !== undefined &&
                        activeNestedDetailNode !== node
                      ) {
                        throw new Error(
                          "The nested detail replaced its retained native root.",
                        );
                      }
                      activeNestedDetailNode = node;
                      nestedDetailNodes.add(node);
                    }}
                    style={{
                      backgroundColor: "#ede9fe",
                      flex: 1,
                      justifyContent: "center",
                      padding: 24,
                    }}
                  >
                    <Text
                      accessibilityRole="header"
                      style={{
                        color: "#111827",
                        fontSize: 26,
                        marginBottom: 12,
                      }}
                    >
                      {NESTED_DETAIL_CONTENT}
                    </Text>
                    <Text
                      style={{
                        color: "#4c1d95",
                        fontSize: 18,
                        marginBottom: 16,
                      }}
                    >
                      {NESTED_DETAIL_STATE_PREFIX} {settingsCount()}; depth{" "}
                      {nestedIndex()}; focused {String(isNestedFocused())}
                    </Text>
                    <Text
                      style={{
                        color: "#4c1d95",
                        fontSize: 16,
                        marginBottom: 16,
                      }}
                    >
                      {NESTED_LOADER_PREFIX} {expectedLoaderProof}
                    </Text>
                    <Text
                      style={{
                        color: "#4c1d95",
                        fontSize: 16,
                        marginBottom: 16,
                      }}
                    >
                      {launch.source === "deep-link" &&
                      !settingsHistory.canGoBack
                        ? COLD_LINK_STATE
                        : launch.source === "restoration" &&
                            settingsHistory.canGoBack &&
                            restoredRootReady()
                          ? platformBackBlocked()
                            ? BLOCKED_BACK_STATE
                            : PROCESS_RESTORATION_STATE
                          : platformBackCanceled()
                            ? CANCELED_BACK_STATE
                            : `Native tabs routed detail; back ${String(settingsHistory.canGoBack)}`}
                    </Text>
                    {initialURL === PRODUCT_COMPOSITION_URL ? (
                      <Pressable
                        accessible
                        accessibilityLabel={NESTED_SHEET_OPEN_LABEL}
                        accessibilityRole="button"
                        onPress={() => {
                          const navigation = startSheetNavigation({
                            to: "../slow-sheet",
                          });
                          void Promise.resolve().then(flush).catch(reportFatal);
                          void navigation.catch(() => undefined);
                        }}
                        style={{
                          backgroundColor: "#c2410c",
                          borderRadius: 8,
                          marginBottom: 12,
                          padding: 14,
                        }}
                      >
                        <Text style={{ color: "#ffffff", fontSize: 17 }}>
                          {NESTED_SHEET_OPEN_LABEL}
                        </Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      accessible
                      accessibilityLabel={NESTED_RESET_LABEL}
                      accessibilityRole="button"
                      onPress={() => {
                        void settingsRouter
                          .navigate({ to: "/", replace: true })
                          .then(flush)
                          .catch(reportFatal);
                      }}
                      style={{
                        backgroundColor: "#6d28d9",
                        borderRadius: 8,
                        marginBottom: 12,
                        padding: 14,
                      }}
                    >
                      <Text style={{ color: "#ffffff", fontSize: 17 }}>
                        {NESTED_RESET_LABEL}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessible
                      accessibilityLabel={NESTED_POP_LABEL}
                      accessibilityRole="button"
                      onPress={() => {
                        if (settingsHistory.back() === undefined) {
                          reportFatal(
                            new Error(
                              "The nested settings stack could not pop its detail.",
                            ),
                          );
                          return;
                        }
                        void flush().catch(reportFatal);
                      }}
                      style={{
                        backgroundColor: "#5b21b6",
                        borderRadius: 8,
                        marginBottom: 12,
                        padding: 14,
                      }}
                    >
                      <Text style={{ color: "#ffffff", fontSize: 17 }}>
                        {NESTED_POP_LABEL}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessible
                      accessibilityLabel={PROCESS_SEED_LABEL}
                      accessibilityRole="button"
                      onPress={() => dispose(true)}
                      style={{
                        backgroundColor: "#334155",
                        borderRadius: 8,
                        padding: 14,
                      }}
                    >
                      <Text style={{ color: "#ffffff", fontSize: 17 }}>
                        {PROCESS_SEED_LABEL}
                      </Text>
                    </Pressable>
                  </View>
                ) as NativeNode;
              }

              nestedRootCreations++;
              setRestoredRootReady(true);
              onCleanup(() => {
                nestedRootDisposals++;
              });
              return (
                <View
                  ref={(node) => {
                    const previous = nativeNodes.get(key);
                    if (previous !== undefined && previous !== node) {
                      throw new Error(
                        `Native tab ${JSON.stringify(key)} replaced its retained native root.`,
                      );
                    }
                    nativeNodes.set(key, node);
                  }}
                  style={{
                    backgroundColor: "#f5f3ff",
                    flex: 1,
                    justifyContent: "center",
                    padding: 24,
                  }}
                >
                  <Text
                    accessibilityRole="header"
                    style={{
                      color: "#111827",
                      fontSize: 26,
                      marginBottom: 12,
                    }}
                  >
                    {SETTINGS_CONTENT}
                  </Text>
                  <Text
                    style={{
                      color: "#334155",
                      fontSize: 16,
                      marginBottom: 16,
                    }}
                  >
                    Native tab {index() + 1}; selected {String(isSelected())}
                  </Text>
                  <Text
                    style={{
                      color: "#4c1d95",
                      fontSize: 18,
                      marginBottom: 16,
                    }}
                  >
                    {SETTINGS_STATE_PREFIX} {settingsCount()}
                  </Text>
                  <Text
                    style={{
                      color: "#4c1d95",
                      fontSize: 16,
                      marginBottom: 16,
                    }}
                  >
                    {NESTED_LOADER_PREFIX} {expectedLoaderProof}
                  </Text>
                  <Pressable
                    accessible
                    accessibilityLabel={SETTINGS_INCREMENT_LABEL}
                    accessibilityRole="button"
                    onPress={() => {
                      setSettingsCount((count) => count + 1);
                      void flush().catch(reportFatal);
                    }}
                    style={{
                      backgroundColor: "#6d28d9",
                      borderRadius: 8,
                      marginBottom: 12,
                      padding: 14,
                    }}
                  >
                    <Text style={{ color: "#ffffff", fontSize: 17 }}>
                      {SETTINGS_INCREMENT_LABEL}
                    </Text>
                  </Pressable>
                  {initialURL === PRODUCT_COMPOSITION_URL ? (
                    <TanStackNativeLink
                      router={settingsRouter}
                      options={{ to: "/detail" }}
                      preload={false}
                      pressableProps={{
                        accessible: true,
                        accessibilityLabel: NESTED_PUSH_LABEL,
                        style: {
                          backgroundColor: "#7c3aed",
                          borderRadius: 8,
                          marginBottom: 12,
                          padding: 14,
                        },
                      }}
                      onNavigationError={reportFatal}
                      onNavigationSettled={() => {
                        void Promise.resolve()
                          .then(verifyProductLinkCausalSettlement)
                          .catch(reportFatal);
                      }}
                    >
                      {(state) => {
                        effect(
                          () => state.isTransitioning,
                          (isTransitioning) => {
                            if (!isTransitioning) return;
                            void Promise.resolve()
                              .then(flush)
                              .catch(reportFatal);
                          },
                        );
                        return (
                          <Text style={{ color: "#ffffff", fontSize: 17 }}>
                            {state.isTransitioning
                              ? "Loading nested settings detail"
                              : NESTED_PUSH_LABEL}
                          </Text>
                        ) as NativeNode;
                      }}
                    </TanStackNativeLink>
                  ) : (
                    <Pressable
                      accessible
                      accessibilityLabel={NESTED_PUSH_LABEL}
                      accessibilityRole="button"
                      onPress={() => {
                        void settingsRouter
                          .navigate({ to: "/detail" })
                          .then(flush)
                          .catch(reportFatal);
                      }}
                      style={{
                        backgroundColor: "#7c3aed",
                        borderRadius: 8,
                        marginBottom: 12,
                        padding: 14,
                      }}
                    >
                      <Text style={{ color: "#ffffff", fontSize: 17 }}>
                        {NESTED_PUSH_LABEL}
                      </Text>
                    </Pressable>
                  )}
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
            const ProductSheetPending = (): NativeNode => {
              const interruptSheetNavigation = useTanStackNativeNavigate();
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
                    style={{
                      color: "#92400e",
                      fontSize: 26,
                      marginBottom: 12,
                    }}
                  >
                    {NESTED_SHEET_PENDING_STATE}
                  </Text>
                  <Pressable
                    accessible
                    accessibilityLabel={NESTED_SHEET_INTERRUPT_LABEL}
                    accessibilityRole="button"
                    onPress={() => {
                      const navigation = interruptSheetNavigation({
                        to: "/sheet",
                        replace: true,
                      });
                      void Promise.resolve()
                        .then(flush)
                        .then(() => navigation)
                        .then(flush)
                        .then(verifyProductInterruptionCausalSettlement)
                        .catch(reportFatal);
                    }}
                    style={{
                      backgroundColor: "#c2410c",
                      borderRadius: 8,
                      padding: 14,
                    }}
                  >
                    <Text style={{ color: "#ffffff", fontSize: 17 }}>
                      {NESTED_SHEET_INTERRUPT_LABEL}
                    </Text>
                  </Pressable>
                </View>
              ) as NativeNode;
            };
            return (
              <TanStackNativeRouterProvider
                router={settingsRouter}
                onReady={() => {
                  console.log("SOLID_NATIVE_TABS_ROUTER_READY");
                  if (initialURL === PRODUCT_COMPOSITION_URL) {
                    const snapshot = settingsHistory.snapshot;
                    if (
                      settingsRouter.state.location.pathname !== "/login" ||
                      snapshot.index !== 0 ||
                      snapshot.entries.length !== 1 ||
                      snapshot.entries[0]?.href !== "/login" ||
                      productGuardRuns !== 1 ||
                      productLoginLoaderRuns !== 1 ||
                      productProtectedCreations !== 0
                    ) {
                      reportFatal(
                        new Error(
                          `The composed auth redirect exposed protected history: ${JSON.stringify(
                            {
                              location: settingsRouter.state.location.pathname,
                              history: snapshot,
                              productGuardRuns,
                              productLoginLoaderRuns,
                              productProtectedCreations,
                            },
                          )}.`,
                        ),
                      );
                      return;
                    }
                    productAuthRedirectVerified = true;
                    console.log(
                      "SOLID_NATIVE_TABS_PRODUCT_AUTH_REDIRECT_SUCCEEDED",
                    );
                  } else if (initialURL === PRODUCT_SESSION_RESTORE_URL) {
                    if (
                      settingsRouter.state.location.pathname !== "/protected" ||
                      !productAuthenticated ||
                      !productSessionRestored ||
                      productGuardRuns !== 1 ||
                      productProtectedLoaderRuns !== 1 ||
                      productLoginCreations !== 0 ||
                      productLoginLoaderRuns !== 0
                    ) {
                      reportFatal(
                        new Error(
                          "The secure product session did not authorize its protected cold launch.",
                        ),
                      );
                      return;
                    }
                    void flush()
                      .then(() => {
                        if (productProtectedCreations !== 1) {
                          throw new Error(
                            "The authorized product session did not mount its protected route.",
                          );
                        }
                        productSessionRestoreVerified = true;
                        console.log(
                          "SOLID_NATIVE_TABS_PRODUCT_SESSION_RESTORE_SUCCEEDED",
                          JSON.stringify({
                            schemaVersion: 0,
                            status: settingsRouter.state.status,
                            isLoading: settingsRouter.state.isLoading,
                            pathname: settingsRouter.state.location.pathname,
                            locationIndex:
                              settingsRouter.state.location.state.__TSR_index,
                            resolvedPathname:
                              settingsRouter.state.resolvedLocation?.pathname,
                            matches: settingsRouter.state.matches.map(
                              (match) => ({
                                routeId: match.routeId,
                                status: match.status,
                              }),
                            ),
                          }),
                        );
                      })
                      .catch(reportFatal);
                  }
                }}
                onError={reportFatal}
              >
                {
                  (
                    <TanStackNativeStack
                      router={settingsRouter}
                      history={settingsHistory}
                      preloadRestoredEntries={
                        launch.source === "restoration" ? 1 : 0
                      }
                      onPreloadError={reportFatal}
                      onPlatformBack={(transition) => {
                        const validProductSheetPop =
                          initialURL === PRODUCT_COMPOSITION_URL &&
                          transition.from.href === "/sheet" &&
                          transition.to.href === "/detail";
                        const validDetailPop =
                          transition.from.href === "/detail" &&
                          transition.to.href === "/";
                        if (
                          transition.kind !== "pop" ||
                          transition.origin !== "platform" ||
                          (!validProductSheetPop && !validDetailPop) ||
                          transition.delta !== -1
                        ) {
                          reportFatal(
                            new Error(
                              `The native-tabs platform gesture produced invalid metadata: ${JSON.stringify(transition)}.`,
                            ),
                          );
                          return;
                        }
                        void Promise.resolve()
                          .then(flush)
                          .then(() => {
                            console.log(
                              "SOLID_NATIVE_TABS_PLATFORM_GESTURE_SUCCEEDED",
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
                          platformServices.platform !== "ios" ||
                          launch.source !== "restoration" ||
                          entry.href !== "/detail" ||
                          settingsHistory.location.href !== "/detail" ||
                          blockedBackCount !== 0 ||
                          platformBlockerAttempts !== 1
                        ) {
                          reportFatal(
                            new Error(
                              `The selected-tab blocked gesture was invalid: ${JSON.stringify(
                                {
                                  platform: platformServices.platform,
                                  launchSource: launch.source,
                                  entry: entry.href,
                                  current: settingsHistory.location.href,
                                  blockedBackCount,
                                  platformBlockerAttempts,
                                },
                              )}.`,
                            ),
                          );
                          return;
                        }
                        blockedBackCount++;
                        setPlatformBackBlocked(true);
                        void Promise.resolve()
                          .then(flush)
                          .then(() => {
                            console.log(
                              "SOLID_NATIVE_TABS_PLATFORM_BLOCKED_SUCCEEDED",
                              JSON.stringify({
                                source: "selected-tab-native-blocked-dismiss",
                                from: entry.href,
                                to: "/",
                              }),
                            );
                          })
                          .catch(reportFatal);
                      }}
                      onPlatformBackCancel={(entry) => {
                        if (
                          platformServices.platform !== "ios" ||
                          entry.href !== "/detail" ||
                          settingsHistory.location.href !== "/detail" ||
                          blockedBackCount !== 0 ||
                          platformBlockerAttempts !== 0
                        ) {
                          reportFatal(
                            new Error(
                              `The selected-tab canceled gesture was invalid: ${JSON.stringify(
                                {
                                  platform: platformServices.platform,
                                  initialURL,
                                  entry: entry.href,
                                  current: settingsHistory.location.href,
                                  canceledBackCount,
                                  blockedBackCount,
                                  platformBlockerAttempts,
                                },
                              )}.`,
                            ),
                          );
                          return;
                        }
                        canceledBackCount++;
                        setPlatformBackCanceled(true);
                        void Promise.resolve()
                          .then(flush)
                          .then(() => {
                            const proof = {
                              source: "selected-tab-native-gesture-cancel",
                              current: entry.href,
                              launchSource: launch.source,
                              canceledBackCount,
                            };
                            if (
                              initialURL === PROCESS_SEED_URL &&
                              seedCanceledBackCount === 0
                            ) {
                              seedCanceledBackCount++;
                              console.log(
                                "SOLID_NATIVE_TABS_PLATFORM_CANCEL_SUCCEEDED",
                                JSON.stringify(proof),
                              );
                            } else {
                              console.log(
                                "SOLID_NATIVE_TABS_PLATFORM_CANCEL_OBSERVED",
                                JSON.stringify(proof),
                              );
                            }
                          })
                          .catch(reportFatal);
                      }}
                      onPlatformBackError={reportFatal}
                      screenOptions={(entry) =>
                        initialURL === PRODUCT_COMPOSITION_URL &&
                        entry.href === "/sheet"
                          ? {
                              gestureEnabled: true,
                              presentation: "sheet",
                              sheetAllowedDetents: [0.58, 0.92],
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
                      renderHeader={(entry) => (
                        <ScreenHeader
                          title={
                            entry().href === "/"
                              ? "Nested settings"
                              : entry().href === "/login"
                                ? "Product sign in"
                                : entry().href === "/protected"
                                  ? "Restored session"
                                  : entry().href === "/detail"
                                    ? "Nested settings detail"
                                    : "Nested settings sheet"
                          }
                        />
                      )}
                      renderUnresolved={(entry) =>
                        initialURL === PRODUCT_COMPOSITION_URL &&
                        entry().href === "/slow-sheet"
                          ? ProductSheetPending()
                          : ((
                              <View style={{ flex: 1, padding: 24 }}>
                                <Text
                                  style={{ color: "#334155", fontSize: 17 }}
                                >
                                  Loading Settings route {entry().href}
                                </Text>
                              </View>
                            ) as NativeNode)
                      }
                    />
                  ) as NativeNode
                }
              </TanStackNativeRouterProvider>
            );
          }}
        </NativeTabs>
      ),
      host,
      {
        surface: {
          name: "native-tabs",
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
            "ScreenStack",
            "TabsHost",
            "TabsScreen",
            "Text",
            "View",
          ],
        },
        onCommitError: reportFatal,
      },
    );
    const mount = await application.root.flush();
    if (
      mount === undefined ||
      mount.sequence < 1 ||
      application.root.lastCommittedSequence !== mount.sequence ||
      ownerCreations !== tabs.length
    ) {
      throw new Error(
        `The physical native tabs proof did not mount two keyed owners: ${JSON.stringify(
          {
            sequence: mount?.sequence ?? null,
            lastCommittedSequence: application.root.lastCommittedSequence,
            ownerCreations,
            expectedOwnerCreations: tabs.length,
          },
        )}.`,
      );
    }
    console.log(
      "SOLID_NATIVE_TABS_READY",
      JSON.stringify({
        schemaVersion: 0,
        sequence: mount.sequence,
        launchSource: launch.source,
        ownerCreations,
      }),
    );
    if (initialURL === ICON_OWNERSHIP_PROOF_URL) {
      const applyIconMode = async (mode: HomeIconMode): Promise<void> => {
        setHomeIconMode(mode);
        await flush();
        console.log("SOLID_NATIVE_TABS_ICON_MODE", mode);
      };
      void Promise.resolve()
        .then(async () => {
          await delay(1_500);
          await applyIconMode("none");
          await delay(1_000);
          await applyIconMode("resource");
          await delay(1_000);
          await applyIconMode("image");
          await applyIconMode("none");
          await delay(1_000);
          await applyIconMode("resource");
          await delay(1_000);
          await applyIconMode("image");
          console.log("SOLID_NATIVE_TABS_ICON_OWNERSHIP_SUCCEEDED");
        })
        .catch(reportFatal);
    }
    if (launch.source === "restoration") {
      console.log("SOLID_NATIVE_TABS_PROCESS_RESTORATION_SUCCEEDED");
    }
  } catch (error) {
    reportFatal(error);
  }
}

void run();
