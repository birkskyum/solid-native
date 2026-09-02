import {
  Pressable,
  ScrollView,
  Text,
  View,
  type NativeStyle,
} from "@solid-native/core";
import {
  Errored,
  createComponent,
  createSignal,
  onCleanup,
  type Accessor,
  type Element as SolidElement,
} from "solid-js";

import type {
  DevelopmentErrorController,
  DevelopmentErrorSnapshot,
} from "./index.js";
import type {
  DevelopmentNetworkInspector,
  DevelopmentNetworkRequestSnapshot,
} from "./network.js";

export {
  DEVELOPMENT_CAUSAL_PANEL_DEFAULT_VISIBLE_OPERATIONS,
  DEVELOPMENT_CAUSAL_PANEL_MAX_SEARCH_LENGTH,
  DEVELOPMENT_CAUSAL_PANEL_MAX_VISIBLE_OPERATIONS,
  DevelopmentCausalPanel,
  type DevelopmentCausalPanelProps,
} from "./causal-solid.js";

export interface DevelopmentErrorOverlayProps {
  readonly controller: DevelopmentErrorController;
  readonly children: SolidElement;
  /** Stack text is visible by default and may contain application data. */
  readonly showStack?: boolean;
  /** Runs synchronously before a caught render failure is reset. */
  readonly onDismiss?: (error: DevelopmentErrorSnapshot) => unknown;
}

export const DEVELOPMENT_NETWORK_PANEL_DEFAULT_VISIBLE_REQUESTS = 30;
export const DEVELOPMENT_NETWORK_PANEL_MAX_VISIBLE_REQUESTS = 100;

export interface DevelopmentNetworkPanelProps {
  readonly inspector: DevelopmentNetworkInspector;
  readonly children: SolidElement;
  readonly initiallyOpen?: boolean;
  readonly maxVisibleRequests?: number;
}

const SCREEN_STYLE: NativeStyle = Object.freeze({
  flex: 1,
  backgroundColor: "#180c0d",
});
const CONTENT_STYLE: NativeStyle = Object.freeze({
  flexGrow: 1,
  paddingTop: 56,
  paddingRight: 20,
  paddingBottom: 32,
  paddingLeft: 20,
  gap: 14,
});
const EYEBROW_STYLE: NativeStyle = Object.freeze({
  color: "#ff9b9b",
  fontSize: 13,
  fontWeight: "700",
  letterSpacing: 1,
  textTransform: "uppercase",
});
const TITLE_STYLE: NativeStyle = Object.freeze({
  color: "#fff4f4",
  fontSize: 25,
  fontWeight: "700",
});
const MESSAGE_STYLE: NativeStyle = Object.freeze({
  color: "#ffe1e1",
  fontSize: 16,
  lineHeight: 23,
});
const META_STYLE: NativeStyle = Object.freeze({
  color: "#d7a7a7",
  fontSize: 13,
  lineHeight: 18,
});
const STACK_CONTAINER_STYLE: NativeStyle = Object.freeze({
  backgroundColor: "#2a1416",
  borderColor: "#633438",
  borderWidth: 1,
  borderRadius: 8,
  padding: 12,
});
const STACK_STYLE: NativeStyle = Object.freeze({
  color: "#f3caca",
  fontFamily: "monospace",
  fontSize: 12,
  lineHeight: 17,
});
const ACTION_STYLE: NativeStyle = Object.freeze({
  alignItems: "center",
  alignSelf: "flex-start",
  backgroundColor: "#d83842",
  borderRadius: 8,
  minWidth: 112,
  paddingTop: 12,
  paddingRight: 18,
  paddingBottom: 12,
  paddingLeft: 18,
});
const ACTION_TEXT_STYLE: NativeStyle = Object.freeze({
  color: "#ffffff",
  fontSize: 16,
  fontWeight: "700",
});
const DEVELOPMENT_SHELL_STYLE: NativeStyle = Object.freeze({
  flex: 1,
  position: "relative",
});
const NETWORK_OVERLAY_SLOT_STYLE: NativeStyle = Object.freeze({
  position: "absolute",
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});
const NETWORK_BADGE_STYLE: NativeStyle = Object.freeze({
  position: "absolute",
  right: 16,
  bottom: 20,
  backgroundColor: "#172033",
  borderColor: "#526078",
  borderWidth: 1,
  borderRadius: 18,
  paddingTop: 9,
  paddingRight: 14,
  paddingBottom: 9,
  paddingLeft: 14,
});
const NETWORK_BADGE_TEXT_STYLE: NativeStyle = Object.freeze({
  color: "#f8fafc",
  fontSize: 13,
  fontWeight: "700",
});
const NETWORK_PANEL_STYLE: NativeStyle = Object.freeze({
  position: "absolute",
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  backgroundColor: "#0b1120",
  paddingTop: 52,
  paddingRight: 16,
  paddingBottom: 24,
  paddingLeft: 16,
});
const NETWORK_HEADER_STYLE: NativeStyle = Object.freeze({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 14,
});
const NETWORK_TITLE_STYLE: NativeStyle = Object.freeze({
  color: "#f8fafc",
  fontSize: 23,
  fontWeight: "700",
});
const NETWORK_HEADER_ACTIONS_STYLE: NativeStyle = Object.freeze({
  flexDirection: "row",
  gap: 8,
});
const NETWORK_HEADER_BUTTON_STYLE: NativeStyle = Object.freeze({
  backgroundColor: "#243047",
  borderRadius: 7,
  paddingTop: 8,
  paddingRight: 11,
  paddingBottom: 8,
  paddingLeft: 11,
});
const NETWORK_HEADER_BUTTON_TEXT_STYLE: NativeStyle = Object.freeze({
  color: "#e2e8f0",
  fontSize: 13,
  fontWeight: "700",
});
const NETWORK_SUMMARY_STYLE: NativeStyle = Object.freeze({
  color: "#94a3b8",
  fontSize: 13,
  marginBottom: 12,
});
const NETWORK_LIST_STYLE: NativeStyle = Object.freeze({
  flexGrow: 1,
  gap: 10,
  paddingBottom: 24,
});
const NETWORK_ROW_STYLE: NativeStyle = Object.freeze({
  backgroundColor: "#111b2e",
  borderColor: "#27364f",
  borderWidth: 1,
  borderRadius: 9,
  gap: 5,
  padding: 12,
});
const NETWORK_ROW_TITLE_STYLE: NativeStyle = Object.freeze({
  color: "#dbeafe",
  fontSize: 14,
  fontWeight: "700",
});
const NETWORK_ROW_TARGET_STYLE: NativeStyle = Object.freeze({
  color: "#f8fafc",
  fontSize: 13,
});
const NETWORK_ROW_META_STYLE: NativeStyle = Object.freeze({
  color: "#94a3b8",
  fontSize: 12,
  lineHeight: 17,
});
const NETWORK_EMPTY_STYLE: NativeStyle = Object.freeze({
  color: "#cbd5e1",
  fontSize: 15,
  paddingTop: 28,
  textAlign: "center",
});

function reportObserverFailure(_error: unknown): void {
  // A local diagnostic observer remains isolated from recovery. Applications
  // that need observer diagnostics can report them through a separate channel.
}

function notifyDismissed(
  listener: DevelopmentErrorOverlayProps["onDismiss"],
  snapshot: DevelopmentErrorSnapshot,
): void {
  try {
    const result = listener?.(snapshot);
    void Promise.resolve(result).catch(reportObserverFailure);
  } catch (error) {
    reportObserverFailure(error);
  }
}

function requireNetworkInspector(
  value: DevelopmentNetworkInspector,
): DevelopmentNetworkInspector {
  if (
    value === null ||
    typeof value !== "object" ||
    typeof value.history !== "function" ||
    typeof value.activeCount !== "function" ||
    typeof value.droppedCount !== "function" ||
    typeof value.clear !== "function" ||
    typeof value.subscribe !== "function"
  ) {
    throw new TypeError(
      "DevelopmentNetworkPanel requires a development network inspector.",
    );
  }
  return value;
}

function requestMeta(snapshot: DevelopmentNetworkRequestSnapshot): string {
  const response =
    snapshot.responseStatus === undefined
      ? "No response"
      : `HTTP ${String(snapshot.responseStatus)}`;
  const chunks = `${String(snapshot.chunkCount)} ${snapshot.chunkCount === 1 ? "chunk" : "chunks"}`;
  const characters = `${String(snapshot.receivedCharacters)} chars`;
  const duration =
    snapshot.durationMilliseconds === undefined
      ? "active"
      : `${String(snapshot.durationMilliseconds)} ms`;
  const failure =
    snapshot.errorName === undefined ? "" : ` \u00b7 ${snapshot.errorName}`;
  return `#${String(snapshot.id)} \u00b7 ${snapshot.platform} \u00b7 ${response} \u00b7 ${chunks} \u00b7 ${characters} \u00b7 ${duration}${failure}`;
}

function NetworkRequestRow(props: {
  readonly snapshot: DevelopmentNetworkRequestSnapshot;
}): SolidElement {
  return createComponent(View, {
    style: NETWORK_ROW_STYLE,
    get children() {
      return [
        createComponent(Text, {
          style: NETWORK_ROW_TITLE_STYLE,
          children: `${props.snapshot.method} \u00b7 ${props.snapshot.state.toUpperCase()}`,
        }),
        createComponent(Text, {
          selectable: true,
          style: NETWORK_ROW_TARGET_STYLE,
          children: props.snapshot.requestTarget ?? "Request target hidden",
        }),
        createComponent(Text, {
          style: NETWORK_ROW_META_STYLE,
          children: requestMeta(props.snapshot),
        }),
      ];
    },
  });
}

/**
 * Adds an opt-in, native on-device view over a DevelopmentNetworkInspector.
 * The application subtree remains mounted while the panel opens and closes.
 */
export function DevelopmentNetworkPanel(
  props: DevelopmentNetworkPanelProps,
): SolidElement {
  const inspector = requireNetworkInspector(props.inspector);
  if (
    props.initiallyOpen !== undefined &&
    typeof props.initiallyOpen !== "boolean"
  ) {
    throw new TypeError(
      "DevelopmentNetworkPanel initiallyOpen must be a boolean.",
    );
  }
  const maxVisibleRequests =
    props.maxVisibleRequests ??
    DEVELOPMENT_NETWORK_PANEL_DEFAULT_VISIBLE_REQUESTS;
  if (
    !Number.isSafeInteger(maxVisibleRequests) ||
    maxVisibleRequests < 1 ||
    maxVisibleRequests > DEVELOPMENT_NETWORK_PANEL_MAX_VISIBLE_REQUESTS
  ) {
    throw new TypeError(
      `DevelopmentNetworkPanel maxVisibleRequests must be a safe integer from 1 through ${String(DEVELOPMENT_NETWORK_PANEL_MAX_VISIBLE_REQUESTS)}.`,
    );
  }

  const application = props.children;
  const [open, setOpen] = createSignal(props.initiallyOpen === true, {
    ownedWrite: true,
  });
  const [revision, setRevision] = createSignal(0, { ownedWrite: true });
  let retainedPanel: SolidElement | undefined;
  const subscription = inspector.subscribe(() => {
    setRevision((value) => (value >= Number.MAX_SAFE_INTEGER ? 0 : value + 1));
  });
  onCleanup(() => subscription.remove());

  const applicationContainer = createComponent(View, {
    style: DEVELOPMENT_SHELL_STYLE,
    get accessibilityElementsHidden() {
      return open();
    },
    get importantForAccessibility() {
      return open() ? "no-hide-descendants" : "auto";
    },
    get pointerEvents() {
      return open() ? "none" : "auto";
    },
    children: application,
  });

  const history = (): readonly DevelopmentNetworkRequestSnapshot[] => {
    revision();
    return inspector.history();
  };
  const closePanel = (): void => {
    // Fabric nodes must not be reinserted after React Native reclaims them.
    // Keep the slot stable, but create a fresh panel tree for every opening.
    retainedPanel = undefined;
    setOpen(false);
  };
  const badge = createComponent(Pressable, {
    accessibilityRole: "button",
    get accessibilityLabel() {
      return `Open network inspector (${String(history().length)} retained requests)`;
    },
    onPress: () => setOpen(true),
    style: NETWORK_BADGE_STYLE,
    testID: "solid-native-development-network-badge",
    get children() {
      const retained = history();
      const active = inspector.activeCount();
      return createComponent(Text, {
        style: NETWORK_BADGE_TEXT_STYLE,
        children: `Network ${String(retained.length)}${active === 0 ? "" : ` \u00b7 ${String(active)} active`}`,
      });
    },
  });
  const panel = (): SolidElement => {
    retainedPanel ??= createComponent(View, {
      accessibilityViewIsModal: true,
      importantForAccessibility: "yes",
      style: NETWORK_PANEL_STYLE,
      testID: "solid-native-development-network-panel",
      get children() {
        const retained = history();
        const visible = retained
          .slice(Math.max(0, retained.length - maxVisibleRequests))
          .reverse();
        const dropped = inspector.droppedCount();
        return [
          createComponent(View, {
            style: NETWORK_HEADER_STYLE,
            get children() {
              return [
                createComponent(Text, {
                  accessibilityRole: "header",
                  style: NETWORK_TITLE_STYLE,
                  children: "Native network",
                }),
                createComponent(View, {
                  style: NETWORK_HEADER_ACTIONS_STYLE,
                  get children() {
                    return [
                      createComponent(Pressable, {
                        accessibilityRole: "button",
                        accessibilityLabel: "Clear network history",
                        onPress: () => inspector.clear(),
                        style: NETWORK_HEADER_BUTTON_STYLE,
                        get children() {
                          return createComponent(Text, {
                            style: NETWORK_HEADER_BUTTON_TEXT_STYLE,
                            children: "Clear",
                          });
                        },
                      }),
                      createComponent(Pressable, {
                        accessibilityRole: "button",
                        accessibilityLabel: "Close network inspector",
                        onPress: closePanel,
                        style: NETWORK_HEADER_BUTTON_STYLE,
                        get children() {
                          return createComponent(Text, {
                            style: NETWORK_HEADER_BUTTON_TEXT_STYLE,
                            children: "Close",
                          });
                        },
                      }),
                    ];
                  },
                }),
              ];
            },
          }),
          createComponent(Text, {
            style: NETWORK_SUMMARY_STYLE,
            children: `${String(retained.length)} retained \u00b7 ${String(inspector.activeCount())} active${dropped === 0 ? "" : ` \u00b7 ${String(dropped)} dropped`}`,
          }),
          ...(visible.length === 0
            ? [
                createComponent(Text, {
                  style: NETWORK_EMPTY_STYLE,
                  children: "No network requests captured.",
                }),
              ]
            : [
                createComponent(ScrollView, {
                  style: DEVELOPMENT_SHELL_STYLE,
                  contentContainerStyle: NETWORK_LIST_STYLE,
                  children: visible.map((snapshot) =>
                    NetworkRequestRow({ snapshot }),
                  ),
                }),
              ]),
        ];
      },
    });
    return retainedPanel;
  };
  const badgeSlot = createComponent(View, {
    style: NETWORK_OVERLAY_SLOT_STYLE,
    get accessibilityElementsHidden() {
      return open();
    },
    get importantForAccessibility() {
      return open() ? "no-hide-descendants" : "auto";
    },
    get pointerEvents() {
      return open() ? "none" : "box-none";
    },
    children: badge,
  });
  const panelSlot = createComponent(View, {
    style: NETWORK_OVERLAY_SLOT_STYLE,
    get accessibilityElementsHidden() {
      return !open();
    },
    get importantForAccessibility() {
      return open() ? "auto" : "no-hide-descendants";
    },
    get pointerEvents() {
      return open() ? "box-none" : "none";
    },
    get children() {
      return open() ? panel() : undefined;
    },
  });
  return createComponent(View, {
    style: DEVELOPMENT_SHELL_STYLE,
    children: [applicationContainer, badgeSlot, panelSlot],
  });
}

function ErrorView(props: {
  readonly snapshot: Accessor<DevelopmentErrorSnapshot>;
  readonly showStack: Accessor<boolean>;
  readonly retry: boolean;
  readonly onAction: () => void;
}): SolidElement {
  return createComponent(View, {
    style: SCREEN_STYLE,
    testID: "solid-native-development-error-overlay",
    get children() {
      return createComponent(ScrollView, {
        style: SCREEN_STYLE,
        contentContainerStyle: CONTENT_STYLE,
        get children() {
          const snapshot = props.snapshot();
          const stack = props.showStack() ? snapshot.stack : undefined;
          return [
            createComponent(Text, {
              style: EYEBROW_STYLE,
              children: "Solid Native development error",
            }),
            createComponent(Text, {
              accessibilityRole: "header",
              style: TITLE_STYLE,
              get children() {
                return snapshot.name;
              },
            }),
            createComponent(Text, {
              selectable: true,
              style: MESSAGE_STYLE,
              get children() {
                return snapshot.message;
              },
            }),
            createComponent(Text, {
              style: META_STYLE,
              get children() {
                const count = snapshot.occurrenceCount;
                return `Source: ${snapshot.source}${count === 1 ? "" : ` \u00b7 repeated ${String(count)} times`}`;
              },
            }),
            createComponent(Pressable, {
              accessibilityRole: "button",
              accessibilityLabel: props.retry
                ? "Retry failed Solid subtree"
                : "Dismiss development error",
              onPress: props.onAction,
              style: ACTION_STYLE,
              get children() {
                return createComponent(Text, {
                  style: ACTION_TEXT_STYLE,
                  children: props.retry ? "Retry" : "Dismiss",
                });
              },
            }),
            ...(stack === undefined
              ? []
              : [
                  createComponent(View, {
                    style: STACK_CONTAINER_STYLE,
                    get children() {
                      return createComponent(Text, {
                        selectable: true,
                        style: STACK_STYLE,
                        children: stack,
                      });
                    },
                  }),
                ]),
            createComponent(Text, {
              style: META_STYLE,
              children:
                "Local development view. Error messages and stacks may contain sensitive application data.",
            }),
          ];
        },
      });
    },
  });
}

/**
 * Replaces a failed Solid subtree, or an explicitly reported application error,
 * with a native recovery view. It does not install a process-global handler.
 */
export function DevelopmentErrorOverlay(
  props: DevelopmentErrorOverlayProps,
): SolidElement {
  if (
    props.controller === null ||
    typeof props.controller !== "object" ||
    typeof props.controller.current !== "function" ||
    typeof props.controller.subscribe !== "function"
  ) {
    throw new TypeError(
      "DevelopmentErrorOverlay requires an error controller.",
    );
  }
  const externallyVisible = (
    snapshot: DevelopmentErrorSnapshot | undefined,
  ): DevelopmentErrorSnapshot | undefined =>
    snapshot?.source === "render" ? undefined : snapshot;
  const [reported, setReported] = createSignal(
    externallyVisible(props.controller.current()),
    { ownedWrite: true },
  );
  const subscription = props.controller.subscribe((snapshot) => {
    setReported(externallyVisible(snapshot));
  });
  onCleanup(() => subscription.remove());

  return createComponent(Errored, {
    fallback(error, reset) {
      let observed: unknown = Symbol("unobserved");
      let snapshot: DevelopmentErrorSnapshot | undefined;
      let fallbackMounted = true;
      onCleanup(() => {
        fallbackMounted = false;
      });
      const captured = (): DevelopmentErrorSnapshot => {
        const next = error();
        if (snapshot === undefined || observed !== next) {
          observed = next;
          snapshot = props.controller.report(next, { source: "render" });
        }
        return snapshot;
      };
      captured();
      return ErrorView({
        snapshot: captured,
        showStack: () => props.showStack !== false,
        retry: true,
        onAction: () => {
          const current = captured();
          props.controller.dismiss(current.id);
          notifyDismissed(props.onDismiss, current);
          // A synchronous observer may repair a tracked source, which lets
          // Solid recover this boundary during the current native event flush.
          // Reset only if that recovery did not dispose the fallback; doing
          // both in one flush can otherwise reinsert a reclaimed native node.
          void Promise.resolve()
            .then(() => {
              if (fallbackMounted) reset();
            })
            .catch(reportObserverFailure);
        },
      });
    },
    get children() {
      const snapshot = reported();
      if (snapshot === undefined) return props.children;
      return ErrorView({
        snapshot: () => snapshot,
        showStack: () => props.showStack !== false,
        retry: false,
        onAction: () => {
          if (!props.controller.dismiss(snapshot.id)) return;
          notifyDismissed(props.onDismiss, snapshot);
        },
      });
    },
  });
}
