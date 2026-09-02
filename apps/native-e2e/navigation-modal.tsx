/** @jsxImportSource @solid-native/core */
import "react-native/setup-env";

import {
  CORE_COMPONENT_DESCRIPTORS,
  Pressable,
  Text,
  View,
  type NativeNode,
} from "@solid-native/core";
import {
  NativeHistory,
  NativeModalStack,
  type NativeHistoryUpdate,
} from "@solid-native/navigation";
import { createSignal, type NativeApplication } from "@solid-native/renderer";
import {
  createNativeFabricHost,
  getNativeHostBinding,
  startApplication,
} from "@solid-native/runtime";
import { getReactNativePlatformServices } from "@solid-native/runtime/react-native";
import { onCleanup } from "solid-js";

const PROOF_TIMEOUT_MS = 5_000;
const ROOT_TITLE = "Solid Native standalone modal root";
const MODAL_TITLE = "Solid Native standalone modal route";
const OPEN_LABEL = "Open standalone native modal";
const APPLICATION_CLOSE_LABEL = "Close modal through application history";
const ENABLE_SWIPE_LABEL = "Enable native modal swipe dismissal";
const SWIPE_BLOCKED_STATE = "Native modal swipe dismissal blocked";
const BLOCKED_REQUEST_STATE = "Native modal blocked request arbitrated";
const SWIPE_ENABLED_STATE = "Native modal swipe dismissal enabled";
const APPLICATION_HIDDEN_STATE =
  "Application modal hidden; owner disposed exactly once";
const PLATFORM_HIDDEN_STATE =
  "Platform modal hidden; owner disposed exactly twice";
const DISPOSE_LABEL = "Dispose standalone modal proof";

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
  console.error("SOLID_NATIVE_NAVIGATION_MODAL_FAILED", error);
  setTimeout(() => {
    throw error instanceof Error ? error : new Error(String(error));
  });
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function run(): Promise<void> {
  try {
    const binding = await waitForSurface();
    const platform = getReactNativePlatformServices();
    invariant(
      platform.platform === "ios",
      `The standalone modal proof requires iOS, received ${JSON.stringify(platform.platform)}.`,
    );
    const host = createNativeFabricHost({
      binding,
      descriptors: CORE_COMPONENT_DESCRIPTORS,
    });
    const history = new NativeHistory({ initialHref: "/" });

    let application: NativeApplication | undefined;
    let teardownStarted = false;
    let removePlatformBlocker: (() => void) | undefined;
    let rootCreations = 0;
    let rootDisposals = 0;
    let modalCreations = 0;
    let modalDisposals = 0;
    let modalShows = 0;
    let modalRequests = 0;
    let modalDismissals = 0;
    let modalHidden = 0;
    let platformBlocks = 0;
    let platformCloses = 0;
    const updates: NativeHistoryUpdate[] = [];

    const flush = async (): Promise<void> => {
      const app = application;
      invariant(
        app !== undefined,
        "The modal proof application was not retained.",
      );
      await app.root.flush();
    };

    const verifyHidden = (hiddenCount: number): void => {
      setTimeout(() => {
        void flush()
          .then(() => {
            invariant(
              history.location.href === "/" &&
                history.pendingApplicationTransitionCount === 0 &&
                modalDisposals === hiddenCount,
              `The hidden modal did not settle exactly: ${JSON.stringify({
                hiddenCount,
                href: history.location.href,
                pending: history.pendingApplicationTransitionCount,
                modalDisposals,
              })}.`,
            );
            console.log(
              "SOLID_NATIVE_NAVIGATION_MODAL_HIDDEN_SUCCEEDED",
              JSON.stringify({ hiddenCount, modalDisposals }),
            );
          })
          .catch(reportFatal);
      });
    };

    const dispose = (): void => {
      if (teardownStarted) return;
      teardownStarted = true;
      const app = application;
      invariant(
        app !== undefined,
        "The modal proof application was not retained.",
      );
      void app
        .dispose()
        .then(() => {
          invariant(
            rootCreations === 1 &&
              rootDisposals === 1 &&
              modalCreations === 2 &&
              modalDisposals === 2 &&
              modalShows === 2 &&
              modalRequests === 2 &&
              modalDismissals === 2 &&
              modalHidden === 2 &&
              platformBlocks === 1 &&
              platformCloses === 1 &&
              updates.length === 4 &&
              updates[0]?.transition.kind === "push" &&
              updates[0]?.transition.origin === "application" &&
              updates[1]?.transition.kind === "pop" &&
              updates[1]?.transition.origin === "application" &&
              updates[2]?.transition.kind === "push" &&
              updates[2]?.transition.origin === "application" &&
              updates[3]?.transition.kind === "pop" &&
              updates[3]?.transition.origin === "platform" &&
              app.root.disposed &&
              !binding.getSurfaceInfo().ready,
            `Standalone modal teardown violated ownership: ${JSON.stringify({
              rootCreations,
              rootDisposals,
              modalCreations,
              modalDisposals,
              modalShows,
              modalRequests,
              modalDismissals,
              modalHidden,
              platformBlocks,
              platformCloses,
              updates: updates.map((update) => ({
                kind: update.transition.kind,
                origin: update.transition.origin,
              })),
              rootDisposed: app.root.disposed,
              surfaceReady: binding.getSurfaceInfo().ready,
            })}.`,
          );
          console.log(
            "SOLID_NATIVE_NAVIGATION_MODAL_TEARDOWN_SUCCEEDED",
            JSON.stringify({
              rootCreations,
              rootDisposals,
              modalCreations,
              modalDisposals,
              modalShows,
              modalRequests,
              modalDismissals,
              modalHidden,
              platformBlocks,
              platformCloses,
            }),
          );
        })
        .catch(reportFatal);
    };

    application = startApplication(
      () => {
        const [swipeEnabled, setSwipeEnabled] = createSignal(false);
        const [blockedRequests, setBlockedRequests] = createSignal(0);
        const [lifecycleState, setLifecycleState] = createSignal(
          "Standalone modal proof ready",
        );
        removePlatformBlocker = history.blockPlatformTransitions(() => true);
        onCleanup(() => {
          removePlatformBlocker?.();
          removePlatformBlocker = undefined;
        });

        const openModal = (): void => {
          invariant(
            history.location.href === "/" && modalDisposals === modalCreations,
            "The modal proof attempted to present over an unsettled route.",
          );
          const transition = history.push("/modal", {
            presentation: modalCreations + 1,
          });
          invariant(
            transition.kind === "push" &&
              transition.origin === "application" &&
              history.pendingApplicationTransitionCount === 1,
            "The modal presentation did not begin as one pending application transition.",
          );
          void flush().catch(reportFatal);
        };

        const closeFromApplication = (): void => {
          const transition = history.back();
          invariant(
            transition?.kind === "pop" &&
              transition.origin === "application" &&
              history.pendingApplicationTransitionCount === 1,
            "The modal application close did not await native completion.",
          );
          void flush().catch(reportFatal);
        };

        const enableSwipe = (): void => {
          invariant(
            !swipeEnabled() && removePlatformBlocker !== undefined,
            "The modal swipe blocker was already removed.",
          );
          removePlatformBlocker();
          removePlatformBlocker = undefined;
          setSwipeEnabled(true);
          void flush()
            .then(() => {
              console.log("SOLID_NATIVE_NAVIGATION_MODAL_SWIPE_ENABLED");
            })
            .catch(reportFatal);
        };

        return (
          <NativeModalStack
            history={history}
            style={{ backgroundColor: "#eff6ff" }}
            defaultModalOptions={{
              accessibilityLabel: "Solid Native routed modal content",
              allowSwipeDismissal: true,
              animationType: "slide",
              presentationStyle: "pageSheet",
              supportedOrientations: ["portrait"],
              testID: "solid-native-routed-modal-host",
            }}
            onUpdate={(update) => updates.push(update)}
            onModalShow={(entry) => {
              modalShows++;
              invariant(
                entry.href === "/modal" &&
                  history.location.id === entry.id &&
                  history.pendingApplicationTransitionCount === 0 &&
                  modalDisposals === modalShows - 1,
                "The routed modal show boundary was not owner-stable.",
              );
              console.log(
                "SOLID_NATIVE_NAVIGATION_MODAL_SHOW_SUCCEEDED",
                JSON.stringify({ modalShows, entry: entry.id }),
              );
            }}
            onModalRequestClose={(entry) => {
              modalRequests++;
              invariant(
                entry.href === "/modal" &&
                  history.location.id === entry.id &&
                  modalDisposals === 1 &&
                  (swipeEnabled()
                    ? modalRequests === 2 && platformBlocks === 1
                    : modalRequests === 1 && platformBlocks === 0),
                "The native modal close request crossed an invalid route boundary.",
              );
              console.log(
                "SOLID_NATIVE_NAVIGATION_MODAL_REQUEST_SUCCEEDED",
                JSON.stringify({ modalRequests, swipeEnabled: swipeEnabled() }),
              );
            }}
            onModalDismiss={(entry) => {
              modalDismissals++;
              invariant(
                entry.href === "/modal" &&
                  history.location.href === "/" &&
                  modalDisposals === modalDismissals - 1,
                "UIKit dismissed a modal after its Solid route owner was released.",
              );
              console.log(
                "SOLID_NATIVE_NAVIGATION_MODAL_DISMISS_SUCCEEDED",
                JSON.stringify({ modalDismissals, entry: entry.id }),
              );
            }}
            onModalHidden={(entry) => {
              modalHidden++;
              invariant(
                entry.href === "/modal" &&
                  history.location.href === "/" &&
                  modalDisposals === modalHidden - 1,
                "The hidden callback did not precede exact modal-owner disposal.",
              );
              verifyHidden(modalHidden);
            }}
            onPlatformBack={(transition) => {
              platformCloses++;
              invariant(
                platformCloses === 1 &&
                  transition.kind === "pop" &&
                  transition.origin === "platform" &&
                  transition.from.href === "/modal" &&
                  transition.to.href === "/" &&
                  transition.delta === -1,
                "The swipe dismissal produced invalid platform transition metadata.",
              );
              console.log("SOLID_NATIVE_NAVIGATION_MODAL_PLATFORM_SUCCEEDED");
            }}
            onPlatformBackBlocked={(entry) => {
              platformBlocks++;
              invariant(
                !swipeEnabled() &&
                  platformBlocks === 1 &&
                  modalRequests === 1 &&
                  entry.href === "/modal" &&
                  history.location.id === entry.id &&
                  !history.hasPendingPlatformTransition &&
                  modalDisposals === 1,
                "The prevented UIKit dismissal did not settle as one blocked platform transition.",
              );
              setBlockedRequests(platformBlocks);
              void flush()
                .then(() => {
                  console.log(
                    "SOLID_NATIVE_NAVIGATION_MODAL_BLOCKED_SUCCEEDED",
                  );
                })
                .catch(reportFatal);
            }}
            onPlatformBackError={reportFatal}
          >
            {(entry, index, isFocused) => {
              const route = entry();
              if (route.href === "/") {
                rootCreations++;
                invariant(
                  rootCreations === 1,
                  "The retained modal root was recreated.",
                );
                onCleanup(() => rootDisposals++);
                return (
                  <View
                    style={{
                      flex: 1,
                      justifyContent: "center",
                      padding: 24,
                    }}
                    testID="solid-native-modal-route-root"
                  >
                    <Text
                      accessible
                      accessibilityRole="header"
                      style={{
                        color: "#111827",
                        fontSize: 26,
                        marginBottom: 12,
                      }}
                      testID="solid-native-modal-route-root-title"
                    >
                      {ROOT_TITLE}
                    </Text>
                    <Text
                      style={{
                        color: "#1e3a8a",
                        fontSize: 16,
                        marginBottom: 16,
                      }}
                    >
                      Root depth {index()}; focused {String(isFocused())}
                    </Text>
                    <Text
                      accessible
                      accessibilityLabel={lifecycleState()}
                      style={{
                        color: "#1e3a8a",
                        fontSize: 16,
                        marginBottom: 16,
                      }}
                    >
                      {lifecycleState()}
                    </Text>
                    <Pressable
                      accessible
                      accessibilityLabel={OPEN_LABEL}
                      accessibilityRole="button"
                      onPress={openModal}
                      style={{
                        backgroundColor: "#2563eb",
                        borderRadius: 8,
                        marginBottom: 12,
                        padding: 14,
                      }}
                    >
                      <Text style={{ color: "#ffffff", fontSize: 17 }}>
                        {OPEN_LABEL}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessible
                      accessibilityLabel={DISPOSE_LABEL}
                      accessibilityRole="button"
                      onPress={dispose}
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
              }

              invariant(
                route.href === "/modal",
                `The modal proof received an unexpected route ${JSON.stringify(route.href)}.`,
              );
              modalCreations++;
              const creation = modalCreations;
              onCleanup(() => {
                modalDisposals++;
                invariant(
                  modalDisposals === creation,
                  "The routed modal owners were not disposed in creation order.",
                );
                setLifecycleState(
                  modalDisposals === 1
                    ? APPLICATION_HIDDEN_STATE
                    : PLATFORM_HIDDEN_STATE,
                );
              });
              return (
                <View
                  style={{
                    backgroundColor: "#f5f3ff",
                    flex: 1,
                    justifyContent: "center",
                    padding: 24,
                  }}
                  testID="solid-native-routed-modal"
                >
                  <Text
                    accessible
                    accessibilityRole="header"
                    style={{ color: "#111827", fontSize: 25, marginBottom: 12 }}
                    testID="solid-native-routed-modal-title"
                  >
                    {MODAL_TITLE}
                  </Text>
                  <Text
                    style={{ color: "#4c1d95", fontSize: 16, marginBottom: 16 }}
                  >
                    Modal owner {creation}; depth {index()}; focused{" "}
                    {String(isFocused())}
                  </Text>
                  <Text
                    accessible
                    accessibilityLabel={
                      swipeEnabled()
                        ? SWIPE_ENABLED_STATE
                        : blockedRequests() === 0
                          ? SWIPE_BLOCKED_STATE
                          : BLOCKED_REQUEST_STATE
                    }
                    style={{ color: "#4c1d95", fontSize: 16, marginBottom: 16 }}
                  >
                    {swipeEnabled()
                      ? SWIPE_ENABLED_STATE
                      : blockedRequests() === 0
                        ? SWIPE_BLOCKED_STATE
                        : BLOCKED_REQUEST_STATE}
                  </Text>
                  {creation === 1 ? (
                    <Pressable
                      accessible
                      accessibilityLabel={APPLICATION_CLOSE_LABEL}
                      accessibilityRole="button"
                      onPress={closeFromApplication}
                      style={{
                        backgroundColor: "#7c3aed",
                        borderRadius: 8,
                        padding: 14,
                      }}
                    >
                      <Text style={{ color: "#ffffff", fontSize: 17 }}>
                        {APPLICATION_CLOSE_LABEL}
                      </Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      accessible
                      accessibilityLabel={ENABLE_SWIPE_LABEL}
                      accessibilityRole="button"
                      onPress={enableSwipe}
                      style={{
                        backgroundColor: "#7c3aed",
                        borderRadius: 8,
                        padding: 14,
                      }}
                    >
                      <Text style={{ color: "#ffffff", fontSize: 17 }}>
                        {ENABLE_SWIPE_LABEL}
                      </Text>
                    </Pressable>
                  )}
                </View>
              ) as NativeNode;
            }}
          </NativeModalStack>
        ) as NativeNode;
      },
      host,
      {
        surface: {
          name: "navigation-standalone-modal",
          initialProps: {
            style: { backgroundColor: "#eff6ff", flex: 1 },
          },
        },
        autoCommit: false,
        requirements: {
          capabilities: ["bubblingEvents"],
          components: ["Modal", "Pressable", "Text", "View"],
        },
        onCommitError: reportFatal,
      },
    );

    const mount = await application.root.flush();
    invariant(
      mount?.sequence === 1,
      "The standalone modal proof did not mount as the first commit.",
    );
    console.log(
      "SOLID_NATIVE_NAVIGATION_MODAL_READY",
      JSON.stringify({ schemaVersion: 0, sequence: mount.sequence }),
    );
  } catch (error) {
    reportFatal(error);
  }
}

void run();
