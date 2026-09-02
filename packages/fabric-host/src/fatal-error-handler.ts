import {
  IncompatibleNativeHostBindingError,
  getNativeHostBinding,
  reportNativeFatalError,
  supportsNativeFatalErrorReporting,
  type NativeFabricBinding,
} from "./native-binding.js";

export type ReactNativeGlobalErrorHandler = (
  error: unknown,
  isFatal: boolean,
) => void;

export interface ReactNativeErrorUtils {
  getGlobalHandler(): ReactNativeGlobalErrorHandler;
  setGlobalHandler(handler: ReactNativeGlobalErrorHandler): void;
}

export interface ReactNativeFatalErrorHandlerOptions {
  readonly binding?: NativeFabricBinding;
  /** Injectable for tests or custom React Native hosts. Defaults to global ErrorUtils. */
  readonly errorUtils?: ReactNativeErrorUtils;
  /** Observes a native handoff failure before the prior handler takes over. */
  readonly onError?: (error: unknown) => unknown;
}

export interface ReactNativeFatalErrorHandler {
  /**
   * Restores the prior global handler only if this handler still owns the slot.
   * Returns false after removal or if another handler replaced it.
   */
  remove(): boolean;
}

function safeGlobalProperty(target: object, key: string): unknown {
  try {
    return Reflect.get(target, key);
  } catch {
    return undefined;
  }
}

function requireReactNativeErrorUtils(value: unknown): ReactNativeErrorUtils {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function") ||
    typeof safeGlobalProperty(value, "getGlobalHandler") !== "function" ||
    typeof safeGlobalProperty(value, "setGlobalHandler") !== "function"
  ) {
    throw new TypeError(
      "React Native ErrorUtils must expose getGlobalHandler and setGlobalHandler.",
    );
  }
  return value as ReactNativeErrorUtils;
}

interface InstalledFatalHandler {
  readonly previous: ReactNativeGlobalErrorHandler;
  readonly active: () => boolean;
}

const INSTALLED_FATAL_HANDLERS = new WeakMap<
  ReactNativeGlobalErrorHandler,
  InstalledFatalHandler
>();

function activeFatalPredecessor(
  handler: ReactNativeGlobalErrorHandler,
): ReactNativeGlobalErrorHandler {
  let candidate = handler;
  let installed = INSTALLED_FATAL_HANDLERS.get(candidate);
  while (installed !== undefined && !installed.active()) {
    candidate = installed.previous;
    installed = INSTALLED_FATAL_HANDLERS.get(candidate);
  }
  return candidate;
}

function reportFatalHandlerError(
  handler: ReactNativeFatalErrorHandlerOptions["onError"],
  error: unknown,
): void {
  try {
    const result = handler?.(error);
    void Promise.resolve(result).catch(() => undefined);
  } catch {
    // A diagnostic observer cannot replace the platform's prior fatal handler.
  }
}

/**
 * Lets the package-owned native shell take over fatal Hermes errors after
 * startup. Non-fatal errors remain with React Native's existing handler. If
 * native takeover fails, the prior fatal handler is invoked synchronously.
 */
export function installReactNativeFatalErrorHandler(
  options: ReactNativeFatalErrorHandlerOptions = {},
): ReactNativeFatalErrorHandler {
  if (options === null || typeof options !== "object") {
    throw new TypeError(
      "React Native fatal error handler options must be an object.",
    );
  }
  if (options.onError !== undefined && typeof options.onError !== "function") {
    throw new TypeError("onError must be a function when present.");
  }
  const binding = options.binding ?? getNativeHostBinding();
  if (!supportsNativeFatalErrorReporting(binding)) {
    throw new IncompatibleNativeHostBindingError([
      "reportFatalError is unavailable.",
    ]);
  }
  const errorUtils = requireReactNativeErrorUtils(
    options.errorUtils ?? safeGlobalProperty(globalThis, "ErrorUtils"),
  );
  const getGlobalHandler = safeGlobalProperty(
    errorUtils,
    "getGlobalHandler",
  ) as ReactNativeErrorUtils["getGlobalHandler"];
  const setGlobalHandler = safeGlobalProperty(
    errorUtils,
    "setGlobalHandler",
  ) as ReactNativeErrorUtils["setGlobalHandler"];
  const previous = getGlobalHandler.call(errorUtils);
  if (typeof previous !== "function") {
    throw new TypeError(
      "React Native ErrorUtils returned an invalid global handler.",
    );
  }
  let active = true;
  const handler: ReactNativeGlobalErrorHandler = (error, isFatal) => {
    if (!active || isFatal !== true) {
      activeFatalPredecessor(previous)(error, isFatal);
      return;
    }
    try {
      reportNativeFatalError(binding, error);
    } catch (handoffError) {
      reportFatalHandlerError(options.onError, handoffError);
      activeFatalPredecessor(previous)(error, isFatal);
    }
  };
  INSTALLED_FATAL_HANDLERS.set(handler, {
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
        setGlobalHandler.call(errorUtils, activeFatalPredecessor(previous));
        return true;
      } catch {
        return false;
      }
    },
  });
}
