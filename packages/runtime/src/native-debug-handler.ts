import {
  createCausalDebugSnapshot,
  serializeSolidDiagnosticsDebugEnvelope,
  type CausalTimeline,
  type SolidDiagnosticsDebugEnvelope,
} from "@solid-native/observability";

export const NATIVE_DEBUG_OPERATION_CAUSAL_SNAPSHOT =
  "causal-snapshot" as const;
export const NATIVE_DEBUG_OPERATION_SOLID_DIAGNOSTICS_BEGIN =
  "solid-diagnostics-begin" as const;
export const NATIVE_DEBUG_OPERATION_SOLID_DIAGNOSTICS_END =
  "solid-diagnostics-end" as const;

export type ReactNativeDebugOperation =
  | typeof NATIVE_DEBUG_OPERATION_CAUSAL_SNAPSHOT
  | typeof NATIVE_DEBUG_OPERATION_SOLID_DIAGNOSTICS_BEGIN
  | typeof NATIVE_DEBUG_OPERATION_SOLID_DIAGNOSTICS_END;

export interface ReactNativeSolidDiagnosticsDebugController {
  readonly available: boolean;
  readonly active: boolean;
  begin(): void;
  end(): SolidDiagnosticsDebugEnvelope;
  dispose(): void;
}

export interface NativeDebugRequestHandlerOptions {
  readonly reportError?: (error: unknown) => void;
  readonly solidDiagnostics?: ReactNativeSolidDiagnosticsDebugController;
}

interface NativeDebugRequest {
  readonly requestId: string;
  readonly operation: ReactNativeDebugOperation;
  readonly sessionId?: string;
}

const REQUEST_ID_PATTERN = /^[a-f0-9]{32}$/u;

function debugRequest(value: unknown): NativeDebugRequest {
  if (
    typeof value !== "object" ||
    value === null ||
    !("requestId" in value) ||
    typeof value.requestId !== "string" ||
    !REQUEST_ID_PATTERN.test(value.requestId)
  ) {
    throw new TypeError("Native debug request is invalid.");
  }
  const operation =
    !("operation" in value) || value.operation === undefined
      ? NATIVE_DEBUG_OPERATION_CAUSAL_SNAPSHOT
      : value.operation;
  if (
    operation !== NATIVE_DEBUG_OPERATION_CAUSAL_SNAPSHOT &&
    operation !== NATIVE_DEBUG_OPERATION_SOLID_DIAGNOSTICS_BEGIN &&
    operation !== NATIVE_DEBUG_OPERATION_SOLID_DIAGNOSTICS_END
  ) {
    throw new TypeError("Native debug request operation is invalid.");
  }
  const sessionId = "sessionId" in value ? value.sessionId : undefined;
  if (operation === NATIVE_DEBUG_OPERATION_SOLID_DIAGNOSTICS_END) {
    if (typeof sessionId !== "string" || !REQUEST_ID_PATTERN.test(sessionId)) {
      throw new TypeError("Native diagnostics end request session is invalid.");
    }
  } else if (sessionId !== undefined) {
    throw new TypeError("Native debug request session is unexpected.");
  }
  return {
    requestId: value.requestId,
    operation,
    ...(sessionId === undefined ? {} : { sessionId }),
  };
}

function diagnosticsControlPayload(
  operation:
    | typeof NATIVE_DEBUG_OPERATION_SOLID_DIAGNOSTICS_BEGIN
    | typeof NATIVE_DEBUG_OPERATION_SOLID_DIAGNOSTICS_END,
  active: boolean,
  ok: boolean,
  error?: "unavailable" | "invalid-state" | "capture-failed",
): string {
  return JSON.stringify({
    schemaVersion: 0,
    kind: "solid-native.solid-diagnostics-debug-control",
    operation,
    ok,
    active,
    ...(error === undefined ? {} : { error }),
  });
}

export function reportNativeDebugError(
  reporter: ((error: unknown) => void) | undefined,
  error: unknown,
): void {
  if (reporter === undefined) return;
  try {
    reporter(error);
  } catch {
    // A diagnostic callback cannot affect the request transport.
  }
}

/** Pure request dispatcher shared by the React Native transport and tests. */
export function createNativeDebugRequestHandler(
  timeline: CausalTimeline,
  options: NativeDebugRequestHandlerOptions,
  publish: (requestId: string, payload: string) => Promise<unknown>,
): (event: unknown) => void {
  const diagnostics = options.solidDiagnostics;
  let diagnosticsSessionId: string | undefined;
  return (event) => {
    let request: NativeDebugRequest | undefined;
    let payload: string | undefined;
    try {
      request = debugRequest(event);
      if (request.operation === NATIVE_DEBUG_OPERATION_CAUSAL_SNAPSHOT) {
        payload = JSON.stringify(
          createCausalDebugSnapshot(timeline.snapshot()),
        );
      } else if (diagnostics === undefined || !diagnostics.available) {
        payload = diagnosticsControlPayload(
          request.operation,
          diagnostics?.active ?? false,
          false,
          "unavailable",
        );
      } else if (
        request.operation === NATIVE_DEBUG_OPERATION_SOLID_DIAGNOSTICS_BEGIN
      ) {
        if (diagnostics.active || diagnosticsSessionId !== undefined) {
          payload = diagnosticsControlPayload(
            request.operation,
            diagnostics.active,
            false,
            "invalid-state",
          );
        } else {
          diagnostics.begin();
          if (!diagnostics.active) {
            diagnostics.dispose();
            throw new Error(
              "Solid diagnostics controller did not activate capture.",
            );
          }
          diagnosticsSessionId = request.requestId;
          payload = diagnosticsControlPayload(
            request.operation,
            diagnostics.active,
            true,
          );
        }
      } else if (
        !diagnostics.active ||
        diagnosticsSessionId === undefined ||
        request.sessionId !== diagnosticsSessionId
      ) {
        payload = diagnosticsControlPayload(
          request.operation,
          diagnostics.active,
          false,
          "invalid-state",
        );
      } else {
        try {
          payload = serializeSolidDiagnosticsDebugEnvelope(diagnostics.end());
        } finally {
          diagnosticsSessionId = undefined;
        }
      }
    } catch (error) {
      reportNativeDebugError(options.reportError, error);
      if (request === undefined) return;
      if (request.operation === NATIVE_DEBUG_OPERATION_CAUSAL_SNAPSHOT) return;
      payload = diagnosticsControlPayload(
        request.operation,
        diagnostics?.active ?? false,
        false,
        "capture-failed",
      );
    }
    if (request === undefined || payload === undefined) return;
    void publish(request.requestId, payload).catch((error) => {
      reportNativeDebugError(options.reportError, error);
    });
  };
}
