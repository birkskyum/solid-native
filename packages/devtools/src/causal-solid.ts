import {
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type NativeStyle,
} from "@solid-native/core";
import {
  correlateNativeSolidDiagnostics,
  createCausalDebugSnapshot,
  explainCausalTimelineSnapshot,
  groupCausalTimelineSnapshot,
  type CausalTimeline,
  type CausalTimelineExplanation,
  type CausalTimelineGroup,
  type CausalTimelineOperation,
  type CausalTimelineSnapshot,
  type NativeSolidDiagnosticsCorrelation,
  type SolidDiagnosticsDebugEnvelope,
} from "@solid-native/observability";
import {
  createComponent,
  createSignal,
  onCleanup,
  type Element as SolidElement,
} from "solid-js";

import type { DevelopmentSolidDiagnosticsController } from "./solid-diagnostics.js";

export const DEVELOPMENT_CAUSAL_PANEL_DEFAULT_VISIBLE_OPERATIONS = 40;
export const DEVELOPMENT_CAUSAL_PANEL_MAX_VISIBLE_OPERATIONS = 100;
export const DEVELOPMENT_CAUSAL_PANEL_MAX_SEARCH_LENGTH = 128;
export const DEVELOPMENT_CAUSAL_PANEL_GROUP_NAME_LIMIT = 6;

export interface DevelopmentCausalPanelProps {
  readonly timeline: CausalTimeline;
  /** Adds a manual Solid attribution capture to the causal inspector. */
  readonly solidDiagnostics?: DevelopmentSolidDiagnosticsController;
  readonly children: SolidElement;
  readonly initiallyOpen?: boolean;
  readonly maxVisibleOperations?: number;
  /** Lets a development root place multiple inspector badges without overlap. */
  readonly badgeBottom?: number;
}

const SHELL_STYLE: NativeStyle = Object.freeze({
  flex: 1,
  position: "relative",
});
const OVERLAY_SLOT_STYLE: NativeStyle = Object.freeze({
  position: "absolute",
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});
const PANEL_STYLE: NativeStyle = Object.freeze({
  position: "absolute",
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  backgroundColor: "#071a18",
  paddingTop: 52,
  paddingRight: 16,
  paddingBottom: 24,
  paddingLeft: 16,
});
const HEADER_STYLE: NativeStyle = Object.freeze({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 12,
});
const HEADER_ACTIONS_STYLE: NativeStyle = Object.freeze({
  flexDirection: "row",
  gap: 7,
});
const TITLE_STYLE: NativeStyle = Object.freeze({
  color: "#ecfdf5",
  fontSize: 23,
  fontWeight: "700",
});
const SUMMARY_STYLE: NativeStyle = Object.freeze({
  color: "#8fbab0",
  fontSize: 13,
  lineHeight: 18,
  marginBottom: 12,
});
const SEARCH_STYLE: NativeStyle = Object.freeze({
  backgroundColor: "#0d2925",
  borderColor: "#24564e",
  borderWidth: 1,
  borderRadius: 8,
  color: "#ecfdf5",
  fontSize: 14,
  marginBottom: 12,
  paddingTop: 9,
  paddingRight: 11,
  paddingBottom: 9,
  paddingLeft: 11,
});
const BUTTON_STYLE: NativeStyle = Object.freeze({
  backgroundColor: "#153c36",
  borderRadius: 7,
  paddingTop: 8,
  paddingRight: 10,
  paddingBottom: 8,
  paddingLeft: 10,
});
const BUTTON_TEXT_STYLE: NativeStyle = Object.freeze({
  color: "#d1fae5",
  fontSize: 12,
  fontWeight: "700",
});
const LIST_STYLE: NativeStyle = Object.freeze({
  flexGrow: 1,
  gap: 9,
  paddingBottom: 24,
});
const ROW_STYLE: NativeStyle = Object.freeze({
  backgroundColor: "#0d2925",
  borderColor: "#24564e",
  borderWidth: 1,
  borderRadius: 9,
  gap: 4,
  padding: 11,
});
const ROW_TITLE_STYLE: NativeStyle = Object.freeze({
  color: "#d1fae5",
  fontSize: 14,
  fontWeight: "700",
});
const ROW_META_STYLE: NativeStyle = Object.freeze({
  color: "#8fbab0",
  fontSize: 12,
  lineHeight: 17,
});
const OPERATION_ID_STYLE: NativeStyle = Object.freeze({
  color: "#6ee7b7",
  fontFamily: "monospace",
  fontSize: 11,
});
const SECTION_STYLE: NativeStyle = Object.freeze({
  gap: 8,
  marginTop: 8,
});
const SECTION_TITLE_STYLE: NativeStyle = Object.freeze({
  color: "#a7f3d0",
  fontSize: 13,
  fontWeight: "700",
  textTransform: "uppercase",
});
const EMPTY_STYLE: NativeStyle = Object.freeze({
  color: "#a7c7c0",
  fontSize: 15,
  paddingTop: 28,
  textAlign: "center",
});
const DIAGNOSTICS_STYLE: NativeStyle = Object.freeze({
  backgroundColor: "#102f2a",
  borderColor: "#2d6c60",
  borderWidth: 1,
  borderRadius: 9,
  gap: 5,
  marginBottom: 12,
  padding: 11,
});
const BADGE_BASE_STYLE: NativeStyle = Object.freeze({
  position: "absolute",
  right: 16,
  backgroundColor: "#0d3b34",
  borderColor: "#3c776c",
  borderWidth: 1,
  borderRadius: 18,
  paddingTop: 9,
  paddingRight: 14,
  paddingBottom: 9,
  paddingLeft: 14,
});
const BADGE_TEXT_STYLE: NativeStyle = Object.freeze({
  color: "#ecfdf5",
  fontSize: 13,
  fontWeight: "700",
});

function requireCausalTimeline(value: CausalTimeline): CausalTimeline {
  if (
    value === null ||
    typeof value !== "object" ||
    typeof value.snapshot !== "function" ||
    typeof value.explain !== "function" ||
    typeof value.clear !== "function" ||
    typeof value.sink !== "function"
  ) {
    throw new TypeError(
      "DevelopmentCausalPanel requires a bounded causal timeline.",
    );
  }
  return value;
}

function optionalSolidDiagnosticsController(
  value: DevelopmentSolidDiagnosticsController | undefined,
): DevelopmentSolidDiagnosticsController | undefined {
  if (value === undefined) return undefined;
  if (
    value === null ||
    typeof value !== "object" ||
    typeof value.available !== "boolean" ||
    typeof value.active !== "boolean" ||
    typeof value.begin !== "function" ||
    typeof value.end !== "function" ||
    typeof value.dispose !== "function"
  ) {
    throw new TypeError(
      "DevelopmentCausalPanel solidDiagnostics must be a diagnostics controller.",
    );
  }
  return value.available ? value : undefined;
}

function operationStatus(operation: CausalTimelineOperation): string {
  if (operation.status === undefined) return "active";
  return operation.status;
}

function operationMeta(operation: CausalTimelineOperation): string {
  const duration =
    operation.duration === undefined
      ? "running"
      : `${operation.duration.toFixed(2)} ms`;
  const causes = `${String(operation.causes.length)} ${operation.causes.length === 1 ? "cause" : "causes"}`;
  return `${operationStatus(operation)} · ${duration} · ${causes}`;
}

function normalizedOperationSearch(value: string): string {
  return value
    .slice(0, DEVELOPMENT_CAUSAL_PANEL_MAX_SEARCH_LENGTH)
    .trim()
    .toLowerCase();
}

function operationMatchesSearch(
  operation: CausalTimelineOperation,
  search: string,
): boolean {
  if (search.length === 0) return true;
  return (
    operation.name.toLowerCase().includes(search) ||
    operation.operationId.toLowerCase().includes(search)
  );
}

function groupMatchesSearch(
  group: CausalTimelineGroup,
  search: string,
): boolean {
  return group.operations.some((operation) =>
    operationMatchesSearch(operation, search),
  );
}

function groupOperationNames(group: CausalTimelineGroup): string {
  const omitted = Math.max(
    0,
    group.operations.length - DEVELOPMENT_CAUSAL_PANEL_GROUP_NAME_LIMIT,
  );
  const names = group.operations
    .slice(-DEVELOPMENT_CAUSAL_PANEL_GROUP_NAME_LIMIT)
    .map((operation) => operation.name.replace(/^solid-native\./u, ""))
    .join(" → ");
  return omitted === 0 ? names : `+${String(omitted)} earlier · ${names}`;
}

function counted(count: number, singular: string, plural: string): string {
  return `${String(count)} ${count === 1 ? singular : plural}`;
}

function groupMeta(group: CausalTimelineGroup): string {
  const duration =
    group.duration === undefined
      ? "running"
      : `${group.duration.toFixed(2)} ms`;
  return `${counted(group.operations.length, "operation", "operations")} · ${String(group.activeOperationCount)} active · ${counted(group.errorOperationCount, "error", "errors")} · ${String(group.cancelledOperationCount)} cancelled · ${duration}`;
}

function TraceGroupRow(props: {
  readonly group: CausalTimelineGroup;
  readonly onSelect: () => void;
}): SolidElement {
  return createComponent(Pressable, {
    accessibilityRole: "button",
    accessibilityLabel: `Inspect causal trace group (${props.group.groupId})`,
    onPress: props.onSelect,
    style: ROW_STYLE,
    get children() {
      return [
        createComponent(Text, {
          style: ROW_TITLE_STYLE,
          children: groupOperationNames(props.group),
        }),
        createComponent(Text, {
          style: ROW_META_STYLE,
          children: groupMeta(props.group),
        }),
        createComponent(Text, {
          selectable: true,
          style: OPERATION_ID_STYLE,
          children: props.group.groupId,
        }),
      ];
    },
  });
}

function OperationRow(props: {
  readonly operation: CausalTimelineOperation;
  readonly onSelect?: () => void;
}): SolidElement {
  const content = () => [
    createComponent(Text, {
      style: ROW_TITLE_STYLE,
      children: props.operation.name,
    }),
    createComponent(Text, {
      style: ROW_META_STYLE,
      children: operationMeta(props.operation),
    }),
    createComponent(Text, {
      selectable: true,
      style: OPERATION_ID_STYLE,
      children: props.operation.operationId,
    }),
  ];
  if (props.onSelect === undefined) {
    return createComponent(View, { style: ROW_STYLE, children: content() });
  }
  return createComponent(Pressable, {
    accessibilityRole: "button",
    accessibilityLabel: `Inspect causal operation ${props.operation.name} (${props.operation.operationId})`,
    onPress: props.onSelect,
    style: ROW_STYLE,
    children: content(),
  });
}

function RelationSection(props: {
  readonly title: string;
  readonly operations: readonly CausalTimelineOperation[];
  readonly onSelect: (operation: CausalTimelineOperation) => void;
}): SolidElement {
  return createComponent(View, {
    style: SECTION_STYLE,
    get children() {
      return [
        createComponent(Text, {
          style: SECTION_TITLE_STYLE,
          children: `${props.title} (${String(props.operations.length)})`,
        }),
        ...(props.operations.length === 0
          ? [
              createComponent(Text, {
                style: ROW_META_STYLE,
                children: "None retained in this snapshot.",
              }),
            ]
          : props.operations.map((operation) =>
              OperationRow({
                operation,
                onSelect: () => props.onSelect(operation),
              }),
            )),
      ];
    },
  });
}

function explanationContent(
  explanation: CausalTimelineExplanation,
  onSelect: (operation: CausalTimelineOperation) => void,
): SolidElement[] {
  return [
    createComponent(Text, {
      style: SECTION_TITLE_STYLE,
      children: "Selected operation",
    }),
    OperationRow({ operation: explanation.target }),
    RelationSection({
      title: "Retained causes",
      operations: explanation.ancestors,
      onSelect,
    }),
    RelationSection({
      title: "Retained effects",
      operations: explanation.descendants,
      onSelect,
    }),
    ...(explanation.unresolvedCauseIds.length === 0
      ? []
      : [
          createComponent(Text, {
            style: SUMMARY_STYLE,
            children: `${String(explanation.unresolvedCauseIds.length)} cause IDs were evicted before this snapshot.`,
          }),
        ]),
  ];
}

function groupContent(
  group: CausalTimelineGroup,
  maxVisibleOperations: number,
  onSelect: (operation: CausalTimelineOperation) => void,
): SolidElement[] {
  const omitted = Math.max(0, group.operations.length - maxVisibleOperations);
  const visible = group.operations.slice(-maxVisibleOperations);
  return [
    createComponent(Text, {
      style: SECTION_TITLE_STYLE,
      children: "Selected trace group",
    }),
    createComponent(Text, {
      style: SUMMARY_STYLE,
      children: `${groupMeta(group)} · ${counted(group.entryOperationIds.length, "entry", "entries")} · ${counted(group.terminalOperationIds.length, "terminal", "terminals")} · ${counted(group.unresolvedCauseIds.length, "unresolved cause", "unresolved causes")}.`,
    }),
    ...(omitted === 0
      ? []
      : [
          createComponent(Text, {
            style: SUMMARY_STYLE,
            children: `${counted(omitted, "earlier operation is", "earlier operations are")} hidden by the visible-row limit.`,
          }),
        ]),
    ...visible.map((operation) =>
      OperationRow({
        operation,
        onSelect: () => onSelect(operation),
      }),
    ),
  ];
}

/**
 * Adds an on-device, manually refreshed causal graph inspector. Refresh is
 * explicit because rendering the inspector itself creates Fabric telemetry;
 * subscribing the view to its own timeline would form a feedback loop.
 */
export function DevelopmentCausalPanel(
  props: DevelopmentCausalPanelProps,
): SolidElement {
  const timeline = requireCausalTimeline(props.timeline);
  const solidDiagnostics = optionalSolidDiagnosticsController(
    props.solidDiagnostics,
  );
  if (
    props.initiallyOpen !== undefined &&
    typeof props.initiallyOpen !== "boolean"
  ) {
    throw new TypeError(
      "DevelopmentCausalPanel initiallyOpen must be a boolean.",
    );
  }
  const maxVisibleOperations =
    props.maxVisibleOperations ??
    DEVELOPMENT_CAUSAL_PANEL_DEFAULT_VISIBLE_OPERATIONS;
  if (
    !Number.isSafeInteger(maxVisibleOperations) ||
    maxVisibleOperations < 1 ||
    maxVisibleOperations > DEVELOPMENT_CAUSAL_PANEL_MAX_VISIBLE_OPERATIONS
  ) {
    throw new TypeError(
      `DevelopmentCausalPanel maxVisibleOperations must be a safe integer from 1 through ${String(DEVELOPMENT_CAUSAL_PANEL_MAX_VISIBLE_OPERATIONS)}.`,
    );
  }
  const badgeBottom = props.badgeBottom ?? 68;
  if (!Number.isFinite(badgeBottom) || badgeBottom < 0 || badgeBottom > 512) {
    throw new TypeError(
      "DevelopmentCausalPanel badgeBottom must be a finite number from 0 through 512.",
    );
  }

  const application = props.children;
  const [open, setOpen] = createSignal(props.initiallyOpen === true, {
    ownedWrite: true,
  });
  const [snapshot, setSnapshot] = createSignal<CausalTimelineSnapshot>(
    timeline.snapshot(),
    { ownedWrite: true },
  );
  const [selectedOperationId, setSelectedOperationId] = createSignal<
    CausalTimelineOperation["operationId"] | undefined
  >(undefined, { ownedWrite: true });
  const [selectedGroupId, setSelectedGroupId] = createSignal<
    CausalTimelineGroup["groupId"] | undefined
  >(undefined, { ownedWrite: true });
  const [grouped, setGrouped] = createSignal(false, { ownedWrite: true });
  const [search, setSearch] = createSignal("", { ownedWrite: true });
  const [capturingSolidDiagnostics, setCapturingSolidDiagnostics] =
    createSignal(false, { ownedWrite: true });
  const [solidDiagnosticsEnvelope, setSolidDiagnosticsEnvelope] = createSignal<
    SolidDiagnosticsDebugEnvelope | undefined
  >(undefined, { ownedWrite: true });
  const [solidDiagnosticsCorrelation, setSolidDiagnosticsCorrelation] =
    createSignal<NativeSolidDiagnosticsCorrelation | undefined>(undefined, {
      ownedWrite: true,
    });
  const [solidDiagnosticsFailure, setSolidDiagnosticsFailure] = createSignal<
    string | undefined
  >(undefined, { ownedWrite: true });
  let panelOwnsSolidDiagnostics = false;
  let retainedSearchInput: SolidElement | undefined;
  let retainedPanel: SolidElement | undefined;
  const updateSnapshot = (
    next: CausalTimelineSnapshot,
    diagnostics:
      | SolidDiagnosticsDebugEnvelope
      | null
      | undefined = solidDiagnosticsEnvelope(),
  ): void => {
    setSnapshot(next);
    if (diagnostics === undefined || diagnostics === null) return;
    try {
      setSolidDiagnosticsCorrelation(
        correlateNativeSolidDiagnostics(
          diagnostics,
          createCausalDebugSnapshot(next),
        ),
      );
      setSolidDiagnosticsFailure(undefined);
    } catch {
      setSolidDiagnosticsCorrelation(undefined);
      setSolidDiagnosticsFailure(
        "The Solid/native correlation could not be validated.",
      );
    }
  };
  const refresh = (): void => {
    const next = timeline.snapshot();
    updateSnapshot(next);
    const selected = selectedOperationId();
    if (
      selected !== undefined &&
      !next.operations.some((operation) => operation.operationId === selected)
    ) {
      setSelectedOperationId(undefined);
    }
    const selectedGroup = selectedGroupId();
    if (
      selectedGroup !== undefined &&
      !groupCausalTimelineSnapshot(next).some(
        (group) => group.groupId === selectedGroup,
      )
    ) {
      setSelectedGroupId(undefined);
    }
  };
  const openPanel = (): void => {
    refresh();
    setOpen(true);
  };
  const closePanel = (): void => {
    retainedPanel = undefined;
    retainedSearchInput = undefined;
    setOpen(false);
  };
  const clear = (): void => {
    timeline.clear();
    setSolidDiagnosticsEnvelope(undefined);
    setSolidDiagnosticsCorrelation(undefined);
    setSolidDiagnosticsFailure(undefined);
    setSelectedOperationId(undefined);
    setSelectedGroupId(undefined);
    setSearch("");
    updateSnapshot(timeline.snapshot(), null);
  };
  const startSolidDiagnosticsCapture = (): void => {
    if (solidDiagnostics === undefined) return;
    if (solidDiagnostics.active) {
      setSolidDiagnosticsFailure(
        "Another Solid diagnostics capture is already active.",
      );
      return;
    }
    try {
      solidDiagnostics.begin();
      panelOwnsSolidDiagnostics = true;
      setSolidDiagnosticsEnvelope(undefined);
      setSolidDiagnosticsCorrelation(undefined);
      setSolidDiagnosticsFailure(undefined);
      setCapturingSolidDiagnostics(true);
      closePanel();
    } catch {
      panelOwnsSolidDiagnostics = false;
      setSolidDiagnosticsFailure(
        "The Solid diagnostics capture could not be started.",
      );
    }
  };
  const stopSolidDiagnosticsCapture = (): void => {
    if (solidDiagnostics === undefined || !panelOwnsSolidDiagnostics) return;
    try {
      const diagnostics = solidDiagnostics.end();
      panelOwnsSolidDiagnostics = false;
      setSolidDiagnosticsEnvelope(diagnostics);
      setCapturingSolidDiagnostics(false);
      updateSnapshot(timeline.snapshot(), diagnostics);
    } catch {
      try {
        solidDiagnostics.dispose();
      } catch {
        // Development instrumentation must not destabilize the application.
      }
      panelOwnsSolidDiagnostics = false;
      setCapturingSolidDiagnostics(false);
      setSolidDiagnosticsEnvelope(undefined);
      setSolidDiagnosticsCorrelation(undefined);
      setSolidDiagnosticsFailure(
        "The Solid diagnostics capture could not be completed.",
      );
    }
    setOpen(true);
  };
  onCleanup(() => {
    if (!panelOwnsSolidDiagnostics || solidDiagnostics === undefined) return;
    panelOwnsSolidDiagnostics = false;
    try {
      solidDiagnostics.dispose();
    } catch {
      // Development instrumentation must not destabilize the application.
    }
  });
  const applicationContainer = createComponent(View, {
    style: SHELL_STYLE,
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
  const searchInput = (): SolidElement => {
    retainedSearchInput ??= createComponent(TextInput, {
      accessibilityLabel: "Filter causal operations",
      autoCapitalize: "none",
      autoCorrect: false,
      maxLength: DEVELOPMENT_CAUSAL_PANEL_MAX_SEARCH_LENGTH,
      placeholder: "Filter by operation name or ID",
      placeholderTextColor: "#6f9d94",
      style: SEARCH_STYLE,
      get value() {
        return search();
      },
      onChangeText(value) {
        setSearch(value.slice(0, DEVELOPMENT_CAUSAL_PANEL_MAX_SEARCH_LENGTH));
      },
    });
    return retainedSearchInput;
  };
  const badge = createComponent(Pressable, {
    accessibilityRole: "button",
    get accessibilityLabel() {
      return capturingSolidDiagnostics()
        ? "Stop Solid diagnostics capture"
        : "Open causal trace inspector";
    },
    get onPress() {
      return capturingSolidDiagnostics()
        ? stopSolidDiagnosticsCapture
        : openPanel;
    },
    style: { ...BADGE_BASE_STYLE, bottom: badgeBottom },
    testID: "solid-native-development-causal-badge",
    children: createComponent(Text, {
      style: BADGE_TEXT_STYLE,
      get children() {
        return capturingSolidDiagnostics() ? "Stop Solid" : "Trace";
      },
    }),
  });
  const panel = (): SolidElement => {
    retainedPanel ??= createComponent(View, {
      accessibilityViewIsModal: true,
      importantForAccessibility: "yes",
      style: PANEL_STYLE,
      testID: "solid-native-development-causal-panel",
      get children() {
        const retained = snapshot();
        const diagnosticsCorrelation = solidDiagnosticsCorrelation();
        const diagnosticsFailure = solidDiagnosticsFailure();
        const selected = selectedOperationId();
        const groups = groupCausalTimelineSnapshot(retained);
        const selectedGroup = groups.find(
          (group) => group.groupId === selectedGroupId(),
        );
        const explanation =
          selected === undefined
            ? undefined
            : explainCausalTimelineSnapshot(retained, selected);
        const normalizedSearch = normalizedOperationSearch(search());
        const matchingOperations = retained.operations.filter((operation) =>
          operationMatchesSearch(operation, normalizedSearch),
        );
        const visible = matchingOperations
          .slice(Math.max(0, matchingOperations.length - maxVisibleOperations))
          .reverse();
        const matchingGroups = groups.filter((group) =>
          groupMatchesSearch(group, normalizedSearch),
        );
        const visibleGroups = matchingGroups
          .slice(Math.max(0, matchingGroups.length - maxVisibleOperations))
          .reverse();
        return [
          createComponent(View, {
            style: HEADER_STYLE,
            get children() {
              return [
                createComponent(Text, {
                  accessibilityRole: "header",
                  style: TITLE_STYLE,
                  children: "Causal trace",
                }),
                createComponent(View, {
                  style: HEADER_ACTIONS_STYLE,
                  get children() {
                    return [
                      ...(explanation === undefined &&
                      selectedGroup === undefined
                        ? []
                        : [
                            createComponent(Pressable, {
                              accessibilityRole: "button",
                              accessibilityLabel:
                                explanation !== undefined
                                  ? selectedGroup === undefined
                                    ? "Back to causal operations"
                                    : "Back to causal trace group"
                                  : "Back to causal trace groups",
                              onPress: () => {
                                if (explanation !== undefined) {
                                  setSelectedOperationId(undefined);
                                } else {
                                  setSelectedGroupId(undefined);
                                }
                              },
                              style: BUTTON_STYLE,
                              children: createComponent(Text, {
                                style: BUTTON_TEXT_STYLE,
                                children: "Back",
                              }),
                            }),
                          ]),
                      ...(solidDiagnostics === undefined ||
                      explanation !== undefined ||
                      selectedGroup !== undefined
                        ? []
                        : [
                            createComponent(Pressable, {
                              accessibilityRole: "button",
                              accessibilityLabel:
                                "Start Solid diagnostics capture",
                              onPress: startSolidDiagnosticsCapture,
                              style: BUTTON_STYLE,
                              children: createComponent(Text, {
                                style: BUTTON_TEXT_STYLE,
                                children: "Capture Solid",
                              }),
                            }),
                          ]),
                      createComponent(Pressable, {
                        accessibilityRole: "button",
                        accessibilityLabel: "Refresh causal trace",
                        onPress: refresh,
                        style: BUTTON_STYLE,
                        children: createComponent(Text, {
                          style: BUTTON_TEXT_STYLE,
                          children: "Refresh",
                        }),
                      }),
                      createComponent(Pressable, {
                        accessibilityRole: "button",
                        accessibilityLabel: "Close causal trace inspector",
                        onPress: closePanel,
                        style: BUTTON_STYLE,
                        children: createComponent(Text, {
                          style: BUTTON_TEXT_STYLE,
                          children: "Close",
                        }),
                      }),
                    ];
                  },
                }),
              ];
            },
          }),
          createComponent(Text, {
            style: SUMMARY_STYLE,
            children: `${String(retained.operations.length)} retained · ${String(retained.activeOperationCount)} active${retained.evictedOperationCount === 0 ? "" : ` · ${String(retained.evictedOperationCount)} evicted`}${retained.discardedRecordCount === 0 ? "" : ` · ${String(retained.discardedRecordCount)} discarded`}. Manual snapshots prevent self-observation.`,
          }),
          ...(diagnosticsFailure === undefined
            ? []
            : [
                createComponent(View, {
                  style: DIAGNOSTICS_STYLE,
                  children: createComponent(Text, {
                    style: ROW_META_STYLE,
                    children: diagnosticsFailure,
                  }),
                }),
              ]),
          ...(diagnosticsCorrelation === undefined
            ? []
            : [
                createComponent(View, {
                  style: DIAGNOSTICS_STYLE,
                  get children() {
                    return [
                      createComponent(Text, {
                        style: SECTION_TITLE_STYLE,
                        children: "Solid → native correlation",
                      }),
                      createComponent(Text, {
                        style: ROW_META_STYLE,
                        children: `${String(diagnosticsCorrelation.rerunCount)} reruns · ${String(diagnosticsCorrelation.correlatedOutputCount)} correlated outputs · ${String(diagnosticsCorrelation.completeOutputCount)} complete native frame outputs · exact per-rerun join: no`,
                      }),
                      ...diagnosticsCorrelation.outputs.map((output) =>
                        createComponent(Text, {
                          style: ROW_META_STYLE,
                          children: `${output.name} · ${String(output.rerunCount)} reruns · ${String(output.nativeFrameOperationIds.length)} frames`,
                        }),
                      ),
                    ];
                  },
                }),
              ]),
          searchInput(),
          ...(explanation === undefined && selectedGroup === undefined
            ? [
                createComponent(Pressable, {
                  accessibilityRole: "button",
                  get accessibilityLabel() {
                    return grouped()
                      ? "Show causal operations"
                      : "Group causal operations";
                  },
                  onPress: () => setGrouped(!grouped()),
                  style: { ...BUTTON_STYLE, marginBottom: 12 },
                  children: createComponent(Text, {
                    style: BUTTON_TEXT_STYLE,
                    get children() {
                      return grouped()
                        ? "Show individual operations"
                        : "Group connected operations";
                    },
                  }),
                }),
              ]
            : []),
          createComponent(ScrollView, {
            style: SHELL_STYLE,
            contentContainerStyle: LIST_STYLE,
            get children() {
              if (explanation !== undefined) {
                return explanationContent(explanation, (operation) =>
                  setSelectedOperationId(operation.operationId),
                );
              }
              if (selectedGroup !== undefined) {
                return groupContent(
                  selectedGroup,
                  maxVisibleOperations,
                  (operation) => setSelectedOperationId(operation.operationId),
                );
              }
              if (grouped()) {
                if (visibleGroups.length === 0) {
                  return createComponent(Text, {
                    style: EMPTY_STYLE,
                    children:
                      retained.operations.length === 0
                        ? "No causal operations captured."
                        : "No causal trace groups match this filter.",
                  });
                }
                return [
                  createComponent(Text, {
                    style: SUMMARY_STYLE,
                    children: `${String(matchingGroups.length)} ${matchingGroups.length === 1 ? "matching retained trace group" : "matching retained trace groups"}.`,
                  }),
                  ...visibleGroups.map((group) =>
                    TraceGroupRow({
                      group,
                      onSelect: () => setSelectedGroupId(group.groupId),
                    }),
                  ),
                ];
              }
              if (visible.length === 0) {
                return createComponent(Text, {
                  style: EMPTY_STYLE,
                  children:
                    normalizedSearch.length === 0
                      ? "No causal operations captured."
                      : "No causal operations match this filter.",
                });
              }
              return [
                ...(normalizedSearch.length === 0
                  ? []
                  : [
                      createComponent(Text, {
                        style: SUMMARY_STYLE,
                        children: `${String(matchingOperations.length)} matching retained operations.`,
                      }),
                    ]),
                ...visible.map((operation) =>
                  OperationRow({
                    operation,
                    onSelect: () =>
                      setSelectedOperationId(operation.operationId),
                  }),
                ),
              ];
            },
          }),
          createComponent(Pressable, {
            accessibilityRole: "button",
            accessibilityLabel: "Clear causal trace",
            onPress: clear,
            style: BUTTON_STYLE,
            children: createComponent(Text, {
              style: BUTTON_TEXT_STYLE,
              children: "Clear retained trace",
            }),
          }),
        ];
      },
    });
    return retainedPanel;
  };
  const badgeSlot = createComponent(View, {
    style: OVERLAY_SLOT_STYLE,
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
    style: OVERLAY_SLOT_STYLE,
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
    style: SHELL_STYLE,
    children: [applicationContainer, badgeSlot, panelSlot],
  });
}
