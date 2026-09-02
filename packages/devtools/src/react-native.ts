import type { DevelopmentErrorController } from "./index.js";

export type ReactNativeGlobalErrorHandler = (
  error: unknown,
  isFatal: boolean,
) => unknown;

/** The stable global error-guard surface installed by React Native startup. */
export interface ReactNativeErrorUtils {
  getGlobalHandler(): ReactNativeGlobalErrorHandler;
  setGlobalHandler(handler: ReactNativeGlobalErrorHandler): void;
}

export interface ReactNativeDevelopmentErrorBridgeOptions {
  /** Injectable for tests or a custom React Native host. Defaults to global ErrorUtils. */
  readonly errorUtils?: ReactNativeErrorUtils;
  /** Also invoke the prior handler for non-fatal errors. Defaults to false. */
  readonly forwardNonFatal?: boolean;
}

export interface ReactNativeDevelopmentErrorBridge {
  /**
   * Restores the prior global handler only if this bridge still owns the slot.
   * Returns false after removal or if another handler replaced it.
   */
  remove(): boolean;
}

interface InstalledBridgeHandler {
  readonly previous: ReactNativeGlobalErrorHandler;
  readonly active: () => boolean;
}

const INSTALLED_BRIDGE_HANDLERS = new WeakMap<
  ReactNativeGlobalErrorHandler,
  InstalledBridgeHandler
>();

function safeProperty(value: object, property: string): unknown {
  try {
    return Reflect.get(value, property);
  } catch {
    return undefined;
  }
}

function globalErrorUtils(): unknown {
  try {
    return Reflect.get(globalThis, "ErrorUtils");
  } catch {
    return undefined;
  }
}

function requireErrorUtils(value: unknown): ReactNativeErrorUtils {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    throw new TypeError(
      "React Native ErrorUtils is unavailable; install the bridge after platform startup.",
    );
  }
  if (
    typeof safeProperty(value, "getGlobalHandler") !== "function" ||
    typeof safeProperty(value, "setGlobalHandler") !== "function"
  ) {
    throw new TypeError(
      "React Native ErrorUtils must expose getGlobalHandler and setGlobalHandler.",
    );
  }
  return value as ReactNativeErrorUtils;
}

function reportRuntimeError(
  controller: DevelopmentErrorController,
  error: unknown,
): void {
  try {
    controller.report(error, { source: "runtime" });
  } catch {
    // A diagnostic bridge must not replace the platform's error behavior even
    // when passed a foreign controller that violates the no-throw contract.
  }
}

function activePredecessor(
  handler: ReactNativeGlobalErrorHandler,
): ReactNativeGlobalErrorHandler {
  let candidate = handler;
  let bridge = INSTALLED_BRIDGE_HANDLERS.get(candidate);
  while (bridge !== undefined && !bridge.active()) {
    candidate = bridge.previous;
    bridge = INSTALLED_BRIDGE_HANDLERS.get(candidate);
  }
  return candidate;
}

/**
 * Installs an opt-in development bridge over React Native's global error guard.
 * Non-fatal guarded errors are owned by the Solid overlay by default. Fatal
 * errors are reported locally and always forwarded to the platform handler.
 */
export function installReactNativeDevelopmentErrorBridge(
  controller: DevelopmentErrorController,
  options: ReactNativeDevelopmentErrorBridgeOptions = {},
): ReactNativeDevelopmentErrorBridge {
  if (
    controller === null ||
    typeof controller !== "object" ||
    typeof controller.report !== "function"
  ) {
    throw new TypeError("Development error controller is required.");
  }
  if (options === null || typeof options !== "object") {
    throw new TypeError(
      "React Native development error bridge options must be an object.",
    );
  }
  if (
    options.forwardNonFatal !== undefined &&
    typeof options.forwardNonFatal !== "boolean"
  ) {
    throw new TypeError("forwardNonFatal must be a boolean.");
  }

  const errorUtils = requireErrorUtils(
    options.errorUtils === undefined ? globalErrorUtils() : options.errorUtils,
  );
  const getGlobalHandler = safeProperty(errorUtils, "getGlobalHandler") as (
    this: ReactNativeErrorUtils,
  ) => ReactNativeGlobalErrorHandler;
  const setGlobalHandler = safeProperty(errorUtils, "setGlobalHandler") as (
    this: ReactNativeErrorUtils,
    handler: ReactNativeGlobalErrorHandler,
  ) => void;
  const previous = getGlobalHandler.call(errorUtils);
  if (typeof previous !== "function") {
    throw new TypeError(
      "React Native ErrorUtils returned an invalid global handler.",
    );
  }

  let active = true;
  const handler: ReactNativeGlobalErrorHandler = (error, isFatal) => {
    if (!active) return activePredecessor(previous)(error, isFatal);
    reportRuntimeError(controller, error);
    if (isFatal === true || options.forwardNonFatal === true) {
      return activePredecessor(previous)(error, isFatal);
    }
    return undefined;
  };
  INSTALLED_BRIDGE_HANDLERS.set(handler, {
    previous,
    active: () => active,
  });
  setGlobalHandler.call(errorUtils, handler);

  return Object.freeze({
    remove(): boolean {
      if (!active) return false;
      active = false;
      let current: ReactNativeGlobalErrorHandler;
      try {
        current = getGlobalHandler.call(errorUtils);
      } catch {
        return false;
      }
      if (current !== handler) return false;
      try {
        setGlobalHandler.call(errorUtils, activePredecessor(previous));
        return true;
      } catch {
        return false;
      }
    },
  });
}
