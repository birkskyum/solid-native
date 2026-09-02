import { getEnforcing } from "react-native/Libraries/TurboModule/TurboModuleRegistry";

import { type CausalTimeline } from "@solid-native/observability";
import { onCleanup } from "solid-js";

import {
  createNativeDebugRequestHandler,
  reportNativeDebugError,
  type ReactNativeSolidDiagnosticsDebugController,
} from "./native-debug-handler.js";

export {
  NATIVE_DEBUG_OPERATION_CAUSAL_SNAPSHOT,
  NATIVE_DEBUG_OPERATION_SOLID_DIAGNOSTICS_BEGIN,
  NATIVE_DEBUG_OPERATION_SOLID_DIAGNOSTICS_END,
  type ReactNativeDebugOperation,
  type ReactNativeSolidDiagnosticsDebugController,
} from "./native-debug-handler.js";

export const NATIVE_CAUSAL_DEBUG_MODULE_NAME = "SolidNativeDebug" as const;
export const NATIVE_CAUSAL_DEBUG_REQUEST_EVENT = "onSnapshotRequest" as const;
interface NativeCausalDebugModule {
  onSnapshotRequest(
    listener: (event: unknown) => void,
  ): NativeEventSubscription;
  setSnapshotListenerReady(ready: boolean): void;
  publishSnapshot(requestId: string, payload: string): Promise<unknown>;
}

interface NativeEventSubscription {
  remove(): void;
}

export interface ReactNativeCausalDebugTransport {
  readonly active: boolean;
  dispose(): void;
}

export interface ReactNativeCausalDebugTransportOptions {
  readonly reportError?: (error: unknown) => void;
  readonly solidDiagnostics?: ReactNativeSolidDiagnosticsDebugController;
}

/**
 * Serves bounded snapshots only when a debuggable native runtime receives
 * one app-private nonce request. Store builds leave the native module inert.
 */
export function createReactNativeCausalDebugTransport(
  timeline: CausalTimeline,
  options: ReactNativeCausalDebugTransportOptions = {},
): ReactNativeCausalDebugTransport {
  if (
    typeof timeline !== "object" ||
    timeline === null ||
    typeof timeline.snapshot !== "function"
  ) {
    throw new TypeError("A causal timeline is required for native debugging.");
  }
  if (
    options.reportError !== undefined &&
    typeof options.reportError !== "function"
  ) {
    throw new TypeError("Causal-debug reportError must be a function.");
  }
  const diagnostics = options.solidDiagnostics;
  if (
    diagnostics !== undefined &&
    (typeof diagnostics !== "object" ||
      typeof diagnostics.available !== "boolean" ||
      typeof diagnostics.active !== "boolean" ||
      typeof diagnostics.begin !== "function" ||
      typeof diagnostics.end !== "function" ||
      typeof diagnostics.dispose !== "function")
  ) {
    throw new TypeError(
      "The Solid diagnostics debug controller is incomplete.",
    );
  }
  const nativeModule = getEnforcing<NativeCausalDebugModule>(
    NATIVE_CAUSAL_DEBUG_MODULE_NAME,
  );
  if (
    typeof nativeModule.onSnapshotRequest !== "function" ||
    typeof nativeModule.setSnapshotListenerReady !== "function" ||
    typeof nativeModule.publishSnapshot !== "function"
  ) {
    throw new TypeError("The native causal-debug module is incomplete.");
  }
  let active = true;
  const handleRequest = createNativeDebugRequestHandler(
    timeline,
    options,
    (requestId, payload) => nativeModule.publishSnapshot(requestId, payload),
  );
  const subscription = nativeModule.onSnapshotRequest((event) => {
    if (!active) return;
    handleRequest(event);
  });
  try {
    nativeModule.setSnapshotListenerReady(true);
  } catch (error) {
    active = false;
    subscription.remove();
    throw error;
  }
  return Object.freeze({
    get active() {
      return active;
    },
    dispose() {
      if (!active) return;
      active = false;
      try {
        diagnostics?.dispose();
      } catch (error) {
        reportNativeDebugError(options.reportError, error);
      }
      try {
        nativeModule.setSnapshotListenerReady(false);
      } finally {
        subscription.remove();
      }
    },
  });
}

/** Binds the debuggable native transport to the current Solid owner. */
export function createOwnedReactNativeCausalDebugTransport(
  timeline: CausalTimeline,
  options: ReactNativeCausalDebugTransportOptions = {},
): ReactNativeCausalDebugTransport {
  const transport = createReactNativeCausalDebugTransport(timeline, options);
  onCleanup(() => transport.dispose());
  return transport;
}
