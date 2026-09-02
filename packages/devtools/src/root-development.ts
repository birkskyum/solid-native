import {
  createComponent,
  onCleanup,
  type Element as SolidElement,
} from "solid-js";

import { createDevelopmentErrorController } from "./index.js";
import { installReactNativeDevelopmentErrorBridge } from "./react-native.js";
import type { DevelopmentRootProps } from "./root.js";
import { DevelopmentErrorOverlay, DevelopmentNetworkPanel } from "./solid.js";
import { DevelopmentCausalPanel } from "./causal-solid.js";

/** Development implementation selected only by the Solid Native Metro resolver. */
export function DevelopmentRoot(props: DevelopmentRootProps): SolidElement {
  const controller = props.controller ?? createDevelopmentErrorController();
  const bridge =
    props.errorBridgeOptions === undefined
      ? installReactNativeDevelopmentErrorBridge(controller)
      : installReactNativeDevelopmentErrorBridge(
          controller,
          props.errorBridgeOptions,
        );
  onCleanup(() => bridge.remove());

  return createComponent(DevelopmentErrorOverlay, {
    controller,
    get children() {
      const application =
        props.causalTimeline === undefined
          ? props.children
          : createComponent(DevelopmentCausalPanel, {
              timeline: props.causalTimeline,
              ...(props.solidDiagnostics === undefined
                ? {}
                : { solidDiagnostics: props.solidDiagnostics }),
              get children() {
                return props.children;
              },
              ...(props.causalPanelOptions?.initiallyOpen === undefined
                ? {}
                : {
                    initiallyOpen: props.causalPanelOptions.initiallyOpen,
                  }),
              ...(props.causalPanelOptions?.maxVisibleOperations === undefined
                ? {}
                : {
                    maxVisibleOperations:
                      props.causalPanelOptions.maxVisibleOperations,
                  }),
            });
      if (props.networkInspector === undefined) return application;
      return createComponent(DevelopmentNetworkPanel, {
        inspector: props.networkInspector,
        children: application,
        ...(props.networkPanelOptions?.initiallyOpen === undefined
          ? {}
          : { initiallyOpen: props.networkPanelOptions.initiallyOpen }),
        ...(props.networkPanelOptions?.maxVisibleRequests === undefined
          ? {}
          : {
              maxVisibleRequests: props.networkPanelOptions.maxVisibleRequests,
            }),
      });
    },
    ...(props.showStack === undefined ? {} : { showStack: props.showStack }),
    ...(props.onDismiss === undefined ? {} : { onDismiss: props.onDismiss }),
  });
}
