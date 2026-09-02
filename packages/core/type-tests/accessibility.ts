import type {
  AccessibilityActionEvent,
  AccessibilityProps,
  ViewProps,
} from "../src/index.js";

const handleAction = (event: AccessibilityActionEvent): string =>
  event.payload.actionName;

const accessibility: AccessibilityProps = {
  accessibilityActions: [
    { name: "activate" },
    { name: "archive", label: "Archive item" },
  ],
  accessibilityElementsHidden: false,
  accessibilityLabelledBy: ["field-label", "field-help"],
  accessibilityLiveRegion: "polite",
  accessibilityRole: "adjustable",
  accessibilityState: { busy: false, disabled: false },
  accessibilityValue: { min: 0, max: 100, now: 25, text: "25 percent" },
  importantForAccessibility: "yes",
  onAccessibilityAction: handleAction,
  onAccessibilityEscape: (event) => event.name,
  onAccessibilityTap: (event) => event.name,
  onMagicTap: (event) => event.name,
  screenReaderFocusable: true,
};

const view: ViewProps = accessibility;

void view;
