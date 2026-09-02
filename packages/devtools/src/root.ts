import type { Element as SolidElement } from "solid-js";
import type { CausalTimeline } from "@solid-native/observability";

import type {
  DevelopmentErrorController,
  DevelopmentErrorSnapshot,
} from "./index.js";
import type { ReactNativeDevelopmentErrorBridgeOptions } from "./react-native.js";
import type { DevelopmentNetworkInspector } from "./network.js";
import type { DevelopmentSolidDiagnosticsController } from "./solid-diagnostics.js";

export interface DevelopmentRootNetworkPanelOptions {
  readonly initiallyOpen?: boolean;
  readonly maxVisibleRequests?: number;
}

export interface DevelopmentRootCausalPanelOptions {
  readonly initiallyOpen?: boolean;
  readonly maxVisibleOperations?: number;
}

export interface DevelopmentRootProps {
  readonly children: SolidElement;
  /** Uses an internal bounded controller when omitted. */
  readonly controller?: DevelopmentErrorController;
  readonly errorBridgeOptions?: ReactNativeDevelopmentErrorBridgeOptions;
  /** Adds the native network badge/panel in development builds only. */
  readonly networkInspector?: DevelopmentNetworkInspector | undefined;
  readonly networkPanelOptions?: DevelopmentRootNetworkPanelOptions;
  /** Adds the manually refreshed causal graph inspector in development builds only. */
  readonly causalTimeline?: CausalTimeline | undefined;
  /** Enriches the causal panel with manual Solid attribution capture. */
  readonly solidDiagnostics?: DevelopmentSolidDiagnosticsController | undefined;
  readonly causalPanelOptions?: DevelopmentRootCausalPanelOptions;
  /** Stack text is visible by default and may contain application data. */
  readonly showStack?: boolean;
  readonly onDismiss?: (error: DevelopmentErrorSnapshot) => unknown;
}

/**
 * Production pass-through selected by `@solid-native/metro`. Development
 * builds resolve the same public entry point to the full diagnostic root.
 */
export function DevelopmentRoot(props: DevelopmentRootProps): SolidElement {
  return props.children;
}
