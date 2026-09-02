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
const ROOT_TITLE = "Solid Native nested modal root";
const FIRST_TITLE = "Solid Native nested modal level one";
const SECOND_TITLE = "Solid Native nested modal level two";
const OPEN_FIRST_LABEL = "Open first nested native modal";
const OPEN_SECOND_LABEL = "Open second nested native modal";
const APPLICATION_CLOSE_LABEL =
  "Close nested native modals through application history";
const DISPOSE_LABEL = "Dispose nested native modal proof";
const READY_STATE = "Nested native modal proof ready";
const FIRST_RETAINED_STATE =
  "First modal retained after one Android platform Back";
const PLATFORM_CLOSED_STATE =
  "Android platform Back closed both modal levels exactly";
const APPLICATION_CLOSED_STATE =
  "Application multi-pop closed both modal levels exactly";

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
  console.error("SOLID_NATIVE_NAVIGATION_MODAL_STACK_FAILED", error);
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
      platform.platform === "android",
      `The nested modal-stack proof requires Android, received ${JSON.stringify(platform.platform)}.`,
    );
    const host = createNativeFabricHost({
      binding,
      descriptors: CORE_COMPONENT_DESCRIPTORS,
    });
    const history = new NativeHistory({ initialHref: "/" });

    let application: NativeApplication | undefined;
    let teardownStarted = false;
    let rootCreations = 0;
    let rootDisposals = 0;
    let modalCreations = 0;
    let modalDisposals = 0;
    let modalShows = 0;
    let modalRequests = 0;
    let modalHidden = 0;
    let platformBacks = 0;
    const hiddenOrder: string[] = [];
    const hiddenBeforeDisposal: number[] = [];
    const disposalOrder: number[] = [];
    const updates: NativeHistoryUpdate[] = [];

    const flush = async (): Promise<void> => {
      const app = application;
      invariant(
        app !== undefined,
        "The nested modal proof application was not retained.",
      );
      await app.root.flush();
    };

    const verifyHiddenBoundary = (
      hiddenCount: number,
      expectedDisposals: number,
      marker: string,
    ): void => {
      setTimeout(() => {
        void flush()
          .then(() => {
            invariant(
              modalHidden >= hiddenCount && modalDisposals >= expectedDisposals,
              `The nested modal hidden boundary did not settle exactly: ${JSON.stringify(
                {
                  hiddenCount,
                  modalHidden,
                  expectedDisposals,
                  modalDisposals,
                },
              )}.`,
            );
            console.log(
              marker,
              JSON.stringify({
                modalHidden,
                modalDisposals,
                href: history.location.href,
                pending: history.pendingApplicationTransitionCount,
              }),
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
        "The nested modal proof application was not retained.",
      );
      void app
        .dispose()
        .then(() => {
          const transitions = updates.map((update) => ({
            kind: update.transition.kind,
            origin: update.transition.origin,
            delta: update.transition.delta,
          }));
          invariant(
            rootCreations === 1 &&
              rootDisposals === 1 &&
              modalCreations === 4 &&
              modalDisposals === 4 &&
              modalShows === 4 &&
              modalRequests === 2 &&
              modalHidden === 4 &&
              platformBacks === 2 &&
              hiddenOrder.join(",") === "/second,/first,/second,/first" &&
              hiddenBeforeDisposal.join(",") === "0,1,2,3" &&
              disposalOrder.join(",") === "2,1,4,3" &&
              transitions.length === 7 &&
              transitions[0]?.kind === "push" &&
              transitions[0]?.origin === "application" &&
              transitions[1]?.kind === "push" &&
              transitions[1]?.origin === "application" &&
              transitions[2]?.kind === "pop" &&
              transitions[2]?.origin === "platform" &&
              transitions[2]?.delta === -1 &&
              transitions[3]?.kind === "pop" &&
              transitions[3]?.origin === "platform" &&
              transitions[3]?.delta === -1 &&
              transitions[4]?.kind === "push" &&
              transitions[4]?.origin === "application" &&
              transitions[5]?.kind === "push" &&
              transitions[5]?.origin === "application" &&
              transitions[6]?.kind === "pop" &&
              transitions[6]?.origin === "application" &&
              transitions[6]?.delta === -2 &&
              history.location.href === "/" &&
              history.pendingApplicationTransitionCount === 0 &&
              app.root.disposed &&
              !binding.getSurfaceInfo().ready,
            `Nested modal teardown violated ownership or transition order: ${JSON.stringify(
              {
                rootCreations,
                rootDisposals,
                modalCreations,
                modalDisposals,
                modalShows,
                modalRequests,
                modalHidden,
                platformBacks,
                hiddenOrder,
                hiddenBeforeDisposal,
                disposalOrder,
                transitions,
                href: history.location.href,
                pending: history.pendingApplicationTransitionCount,
                rootDisposed: app.root.disposed,
                surfaceReady: binding.getSurfaceInfo().ready,
              },
            )}.`,
          );
          console.log(
            "SOLID_NATIVE_NAVIGATION_MODAL_STACK_TEARDOWN_SUCCEEDED",
            JSON.stringify({
              rootCreations,
              rootDisposals,
              modalCreations,
              modalDisposals,
              modalShows,
              modalRequests,
              modalHidden,
              platformBacks,
              hiddenOrder,
              disposalOrder,
            }),
          );
        })
        .catch(reportFatal);
    };

    application = startApplication(
      () => {
        const [lifecycleState, setLifecycleState] = createSignal(READY_STATE);
        const [shownRoute, setShownRoute] = createSignal("/");

        const pushRoute = (href: "/first" | "/second"): void => {
          const expectedFrom = href === "/first" ? "/" : "/first";
          invariant(
            history.location.href === expectedFrom &&
              history.pendingApplicationTransitionCount === 0,
            `The nested modal proof attempted ${href} from an unsettled route.`,
          );
          const transition = history.push(href, {
            presentation: modalCreations + 1,
          });
          invariant(
            transition.kind === "push" &&
              transition.origin === "application" &&
              Number(history.pendingApplicationTransitionCount) === 1,
            "The nested modal presentation did not await a native show boundary.",
          );
          void flush().catch(reportFatal);
        };

        const closeFromApplication = (): void => {
          invariant(
            history.location.href === "/second" && modalHidden === 2,
            "The application multi-pop started outside the second proof stack.",
          );
          const transition = history.back(2);
          invariant(
            transition?.kind === "pop" &&
              transition.origin === "application" &&
              transition.delta === -2 &&
              history.pendingApplicationTransitionCount === 1,
            "The application multi-pop did not await both native hidden boundaries.",
          );
          void flush().catch(reportFatal);
        };

        return (
          <NativeModalStack
            history={history}
            style={{ backgroundColor: "#eff6ff" }}
            defaultModalOptions={{
              accessibilityLabel: "Solid Native nested routed modal content",
              animationType: "none",
              presentationStyle: "fullScreen",
              testID: "solid-native-nested-routed-modal-host",
            }}
            onUpdate={(update) => updates.push(update)}
            onModalShow={(entry) => {
              modalShows++;
              invariant(
                (entry.href === "/first" || entry.href === "/second") &&
                  history.location.id === entry.id &&
                  history.pendingApplicationTransitionCount === 0 &&
                  modalShows <= modalCreations,
                "A nested modal show crossed an invalid route or transition boundary.",
              );
              setShownRoute(entry.href);
              console.log(
                "SOLID_NATIVE_NAVIGATION_MODAL_STACK_SHOW_SUCCEEDED",
                JSON.stringify({ modalShows, href: entry.href }),
              );
              void flush().catch(reportFatal);
            }}
            onModalRequestClose={(entry) => {
              modalRequests++;
              invariant(
                modalRequests <= 2 &&
                  modalHidden === modalRequests - 1 &&
                  history.location.id === entry.id,
                "Android platform Back requested the wrong nested modal route.",
              );
              console.log(
                "SOLID_NATIVE_NAVIGATION_MODAL_STACK_REQUEST_SUCCEEDED",
                JSON.stringify({ modalRequests, href: entry.href }),
              );
            }}
            onModalHidden={(entry) => {
              modalHidden++;
              hiddenOrder.push(entry.href);
              hiddenBeforeDisposal.push(modalDisposals);
              invariant(
                entry.href === (modalHidden % 2 === 1 ? "/second" : "/first") &&
                  modalDisposals === modalHidden - 1,
                "A nested modal hidden callback did not precede top-down owner disposal.",
              );
              if (modalHidden === 1) {
                invariant(
                  history.location.href === "/first" &&
                    history.pendingApplicationTransitionCount === 0,
                  "The first Android Back did not retain the first modal route.",
                );
                setLifecycleState(FIRST_RETAINED_STATE);
                verifyHiddenBoundary(
                  1,
                  1,
                  "SOLID_NATIVE_NAVIGATION_MODAL_STACK_LEVEL_SUCCEEDED",
                );
              } else if (modalHidden === 2) {
                invariant(
                  history.location.href === "/" &&
                    history.pendingApplicationTransitionCount === 0,
                  "The second Android Back did not restore the retained root.",
                );
                setLifecycleState(PLATFORM_CLOSED_STATE);
                verifyHiddenBoundary(
                  2,
                  2,
                  "SOLID_NATIVE_NAVIGATION_MODAL_STACK_PLATFORM_SUCCEEDED",
                );
              } else if (modalHidden === 3) {
                invariant(
                  history.location.href === "/" &&
                    history.pendingApplicationTransitionCount === 1,
                  "The application multi-pop completed before its lower modal hid.",
                );
              } else if (modalHidden === 4) {
                invariant(
                  history.location.href === "/" &&
                    history.pendingApplicationTransitionCount === 1,
                  "The final application hidden callback did not precede acknowledgment.",
                );
                setLifecycleState(APPLICATION_CLOSED_STATE);
                verifyHiddenBoundary(
                  4,
                  4,
                  "SOLID_NATIVE_NAVIGATION_MODAL_STACK_APPLICATION_SUCCEEDED",
                );
              } else {
                throw new Error("The nested modal proof hid too many routes.");
              }
            }}
            onPlatformBack={(transition) => {
              platformBacks++;
              invariant(
                platformBacks <= 2 &&
                  transition.kind === "pop" &&
                  transition.origin === "platform" &&
                  transition.delta === -1,
                "Android platform Back produced invalid modal transition metadata.",
              );
              void flush().catch(reportFatal);
            }}
            onPlatformBackError={reportFatal}
          >
            {(entry, index, isFocused) => {
              const route = entry();
              if (route.href === "/") {
                rootCreations++;
                invariant(
                  rootCreations === 1,
                  "The nested modal root owner was recreated.",
                );
                onCleanup(() => rootDisposals++);
                return (
                  <View
                    style={{
                      flex: 1,
                      justifyContent: "center",
                      padding: 24,
                    }}
                    testID="solid-native-modal-stack-root"
                  >
                    <Text
                      accessible
                      accessibilityRole="header"
                      style={{
                        color: "#111827",
                        fontSize: 26,
                        marginBottom: 12,
                      }}
                    >
                      {ROOT_TITLE}
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
                      accessibilityLabel={OPEN_FIRST_LABEL}
                      accessibilityRole="button"
                      onPress={() => pushRoute("/first")}
                      style={{
                        backgroundColor: "#2563eb",
                        borderRadius: 8,
                        marginBottom: 12,
                        padding: 14,
                      }}
                    >
                      <Text style={{ color: "#ffffff", fontSize: 17 }}>
                        {OPEN_FIRST_LABEL}
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
                route.href === "/first" || route.href === "/second",
                `The nested modal proof received an unexpected route ${JSON.stringify(route.href)}.`,
              );
              modalCreations++;
              const creation = modalCreations;
              onCleanup(() => {
                modalDisposals++;
                disposalOrder.push(creation);
              });
              return (
                <View
                  style={{
                    backgroundColor:
                      route.href === "/first" ? "#ede9fe" : "#fce7f3",
                    flex: 1,
                    justifyContent: "center",
                    padding: 24,
                  }}
                >
                  <Text
                    accessible
                    accessibilityRole="header"
                    style={{ color: "#111827", fontSize: 25, marginBottom: 12 }}
                  >
                    {route.href === "/first" ? FIRST_TITLE : SECOND_TITLE}
                  </Text>
                  <Text
                    style={{ color: "#4c1d95", fontSize: 16, marginBottom: 16 }}
                  >
                    Modal owner {creation}; depth {index()}; focused{" "}
                    {String(isFocused())}
                  </Text>
                  {route.href === "/first" ? (
                    <>
                      <Text
                        accessible
                        accessibilityLabel={lifecycleState()}
                        style={{
                          color: "#4c1d95",
                          fontSize: 16,
                          marginBottom: 16,
                        }}
                      >
                        {lifecycleState()}
                      </Text>
                      {shownRoute() === "/first" ? (
                        <Pressable
                          accessible
                          accessibilityLabel={OPEN_SECOND_LABEL}
                          accessibilityRole="button"
                          onPress={() => pushRoute("/second")}
                          style={{
                            backgroundColor: "#7c3aed",
                            borderRadius: 8,
                            padding: 14,
                          }}
                        >
                          <Text style={{ color: "#ffffff", fontSize: 17 }}>
                            {OPEN_SECOND_LABEL}
                          </Text>
                        </Pressable>
                      ) : null}
                    </>
                  ) : shownRoute() === "/second" ? (
                    <Pressable
                      accessible
                      accessibilityLabel={APPLICATION_CLOSE_LABEL}
                      accessibilityRole="button"
                      onPress={closeFromApplication}
                      style={{
                        backgroundColor: "#be185d",
                        borderRadius: 8,
                        padding: 14,
                      }}
                    >
                      <Text style={{ color: "#ffffff", fontSize: 17 }}>
                        {APPLICATION_CLOSE_LABEL}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ) as NativeNode;
            }}
          </NativeModalStack>
        ) as NativeNode;
      },
      host,
      {
        surface: {
          name: "navigation-nested-modal-stack",
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
      "The nested modal proof did not mount as the first commit.",
    );
    console.log(
      "SOLID_NATIVE_NAVIGATION_MODAL_STACK_READY",
      JSON.stringify({ schemaVersion: 0, sequence: mount.sequence }),
    );
  } catch (error) {
    reportFatal(error);
  }
}

void run();
