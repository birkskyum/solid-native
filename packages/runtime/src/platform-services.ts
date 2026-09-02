import {
  REACT_NATIVE_0_87_RELEASE,
  assertVerifiedReactNativePlatform,
} from "@solid-native/react-native-compat";

export type NativeAppState =
  "active" | "background" | "extension" | "inactive" | "unknown";

export const NATIVE_PLATFORM_MAX_URL_LENGTH = 8_192;

export interface NativeSubscription {
  remove(): void;
}

export interface NativeURLEvent {
  readonly url: string;
}

export interface NativeKeyboardMetrics {
  readonly screenX: number;
  readonly screenY: number;
  readonly width: number;
  readonly height: number;
}

export interface NativeWindowMetrics {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly fontScale: number;
}

export type NativeColorScheme = "light" | "dark";
export type NativeColorSchemeOverride = NativeColorScheme | "system";

export type NativeStatusBarStyle =
  "default" | "auto" | "light-content" | "dark-content";
export type NativeStatusBarAnimation = "none" | "fade" | "slide";

export interface NativeStatusBarConfiguration {
  readonly animated?: boolean;
  readonly barStyle?: NativeStatusBarStyle;
  readonly hidden?: boolean;
  readonly showHideTransition?: NativeStatusBarAnimation;
}

export interface NativeStatusBarStackEntry {
  replace(configuration: NativeStatusBarConfiguration): void;
  remove(): void;
}

export type NativeKeyboardState =
  | {
      readonly visible: false;
      readonly metrics?: undefined;
    }
  | {
      readonly visible: true;
      readonly metrics: NativeKeyboardMetrics;
    };

export interface NativePlatformFingerprint {
  readonly backend: "react-native";
  readonly backendVersion: typeof REACT_NATIVE_0_87_RELEASE.runtimeVersion;
  readonly platform: "android" | "ios";
}

export interface NativePlatformServices extends NativePlatformFingerprint {
  readonly initialAppState: NativeAppState;
  canOpenURL(url: string): Promise<boolean>;
  dismissKeyboard(): void;
  getColorScheme(): NativeColorScheme;
  getKeyboardState(): NativeKeyboardState;
  getInitialURL(): Promise<string | null>;
  getWindowMetrics(): NativeWindowMetrics;
  openSettings(): Promise<void>;
  openURL(url: string): Promise<void>;
  pushStatusBarEntry(
    configuration: NativeStatusBarConfiguration,
  ): NativeStatusBarStackEntry;
  setColorSchemeOverride(scheme: NativeColorSchemeOverride): void;
  subscribeAppState(
    listener: (state: NativeAppState) => void,
  ): NativeSubscription;
  subscribeColorScheme(
    listener: (scheme: NativeColorScheme) => void,
  ): NativeSubscription;
  subscribeHardwareBack(listener: () => boolean): NativeSubscription;
  subscribeKeyboard(
    listener: (state: NativeKeyboardState) => void,
  ): NativeSubscription;
  /** Emits when the backend reports platform memory pressure. */
  subscribeMemoryWarning(listener: () => void): NativeSubscription;
  subscribeURL(listener: (event: NativeURLEvent) => void): NativeSubscription;
  subscribeWindowMetrics(
    listener: (metrics: NativeWindowMetrics) => void,
  ): NativeSubscription;
}

export interface NativePlatformServicesAdapter {
  canOpenURL(url: string): Promise<unknown>;
  getPlatformConstants(): unknown;
  getColorScheme(): unknown;
  getInitialAppState(): unknown;
  getKeyboardMetrics(): unknown;
  getWindowMetrics(): unknown;
  dismissKeyboard(): void;
  getInitialURL(): Promise<unknown>;
  openSettings(): Promise<unknown>;
  openURL(url: string): Promise<unknown>;
  setColorSchemeOverride(scheme: NativeColorSchemeOverride): void;
  setStatusBarHidden(
    hidden: boolean,
    animation: NativeStatusBarAnimation,
  ): void;
  setStatusBarStyle(
    style: Exclude<NativeStatusBarStyle, "auto">,
    animated: boolean,
  ): void;
  subscribeAppState(listener: (state: unknown) => void): NativeSubscription;
  subscribeColorScheme(listener: (scheme: unknown) => void): NativeSubscription;
  subscribeHardwareBack(listener: () => boolean): NativeSubscription;
  subscribeKeyboard(listener: (state: unknown) => void): NativeSubscription;
  subscribeMemoryWarning(listener: () => void): NativeSubscription;
  subscribeURL(listener: (event: unknown) => void): NativeSubscription;
  subscribeWindowMetrics(
    listener: (metrics: unknown) => void,
  ): NativeSubscription;
}

function record(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function outboundURL(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > NATIVE_PLATFORM_MAX_URL_LENGTH
  ) {
    throw new TypeError(
      `Native outbound URLs must contain between 1 and ${NATIVE_PLATFORM_MAX_URL_LENGTH} characters.`,
    );
  }
  if (!/^[A-Za-z][A-Za-z\d+.-]*:/u.test(value)) {
    throw new TypeError("Native outbound URLs must include a valid scheme.");
  }
  if (/[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(
      "Native outbound URLs must not contain control characters.",
    );
  }
  return value;
}

function platformFingerprint(
  constantsValue: unknown,
): NativePlatformFingerprint {
  const verified = assertVerifiedReactNativePlatform(
    constantsValue,
    "Native platform services",
  );
  return Object.freeze({
    backend: "react-native",
    backendVersion: verified.runtimeVersion,
    platform: verified.platform,
  });
}

function subscription(
  value: NativeSubscription,
  path: string,
): NativeSubscription {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof value.remove !== "function"
  ) {
    throw new TypeError(`${path} did not return a removable subscription.`);
  }
  let active = true;
  return {
    remove() {
      if (!active) return;
      active = false;
      value.remove();
    },
  };
}

function appState(value: unknown): NativeAppState {
  if (
    value !== "active" &&
    value !== "background" &&
    value !== "extension" &&
    value !== "inactive" &&
    value !== "unknown"
  ) {
    throw new TypeError(
      `The native AppState module emitted an invalid state: ${String(value)}.`,
    );
  }
  return value;
}

function colorScheme(value: unknown, path: string): NativeColorScheme {
  if (value !== "light" && value !== "dark") {
    throw new TypeError(`${path} must be light or dark.`);
  }
  return value;
}

function colorSchemeOverride(value: unknown): NativeColorSchemeOverride {
  if (value !== "light" && value !== "dark" && value !== "system") {
    throw new TypeError(
      "The color-scheme override must be light, dark, or system.",
    );
  }
  return value;
}

interface NormalizedStatusBarEntry {
  readonly barStyle:
    | {
        readonly animated: boolean;
        readonly value: NativeStatusBarStyle;
      }
    | undefined;
  readonly hidden:
    | {
        readonly animation: NativeStatusBarAnimation;
        readonly value: boolean;
      }
    | undefined;
}

interface AppliedStatusBarState {
  readonly barStyle: {
    readonly animated: boolean;
    readonly value: Exclude<NativeStatusBarStyle, "auto">;
  };
  readonly hidden: {
    readonly animation: NativeStatusBarAnimation;
    readonly value: boolean;
  };
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${path} must be a boolean.`);
  }
  return value;
}

function statusBarStyle(value: unknown): NativeStatusBarStyle {
  if (
    value !== "default" &&
    value !== "auto" &&
    value !== "light-content" &&
    value !== "dark-content"
  ) {
    throw new TypeError(
      "StatusBar.barStyle must be default, auto, light-content, or dark-content.",
    );
  }
  return value;
}

function statusBarAnimation(value: unknown): NativeStatusBarAnimation {
  if (value !== "none" && value !== "fade" && value !== "slide") {
    throw new TypeError(
      "StatusBar.showHideTransition must be none, fade, or slide.",
    );
  }
  return value;
}

function statusBarConfiguration(
  value: NativeStatusBarConfiguration,
): NormalizedStatusBarEntry {
  const configuration = record(value, "status-bar configuration");
  const animated =
    configuration.animated === undefined
      ? false
      : booleanValue(configuration.animated, "StatusBar.animated");
  const transition =
    configuration.showHideTransition === undefined
      ? "fade"
      : statusBarAnimation(configuration.showHideTransition);
  return Object.freeze({
    barStyle:
      configuration.barStyle === undefined
        ? undefined
        : Object.freeze({
            animated,
            value: statusBarStyle(configuration.barStyle),
          }),
    hidden:
      configuration.hidden === undefined
        ? undefined
        : Object.freeze({
            animation: animated ? transition : "none",
            value: booleanValue(configuration.hidden, "StatusBar.hidden"),
          }),
  });
}

function urlEvent(value: unknown): NativeURLEvent {
  const event = record(value, "native URL event");
  if (typeof event.url !== "string" || event.url.length === 0) {
    throw new TypeError("The native URL event must contain a non-empty URL.");
  }
  return Object.freeze({ url: event.url });
}

function finiteCoordinate(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number.`);
  }
  return value;
}

function keyboardMetrics(value: unknown, path: string): NativeKeyboardMetrics {
  const metrics = record(value, path);
  const width = finiteCoordinate(metrics.width, `${path}.width`);
  const height = finiteCoordinate(metrics.height, `${path}.height`);
  if (width < 0 || height < 0) {
    throw new TypeError(`${path} width and height must be non-negative.`);
  }
  return Object.freeze({
    screenX: finiteCoordinate(metrics.screenX, `${path}.screenX`),
    screenY: finiteCoordinate(metrics.screenY, `${path}.screenY`),
    width,
    height,
  });
}

function windowMetrics(value: unknown, path: string): NativeWindowMetrics {
  const metrics = record(value, path);
  const width = finiteCoordinate(metrics.width, `${path}.width`);
  const height = finiteCoordinate(metrics.height, `${path}.height`);
  const scale = finiteCoordinate(metrics.scale, `${path}.scale`);
  const fontScale = finiteCoordinate(metrics.fontScale, `${path}.fontScale`);
  if (width < 0 || height < 0) {
    throw new TypeError(`${path} width and height must be non-negative.`);
  }
  if (scale <= 0 || fontScale <= 0) {
    throw new TypeError(`${path} scale and fontScale must be positive.`);
  }
  return Object.freeze({ width, height, scale, fontScale });
}

function initialKeyboardState(value: unknown): NativeKeyboardState {
  if (value === undefined || value === null) {
    return Object.freeze({ visible: false });
  }
  return Object.freeze({
    visible: true,
    metrics: keyboardMetrics(value, "initial keyboard metrics"),
  });
}

function keyboardState(value: unknown): NativeKeyboardState {
  const state = record(value, "native keyboard state");
  if (state.visible === false) {
    if (state.metrics !== undefined) {
      throw new TypeError(
        "A hidden native keyboard state must not include metrics.",
      );
    }
    return Object.freeze({ visible: false });
  }
  if (state.visible !== true) {
    throw new TypeError(
      "The native keyboard state must include a boolean visible field.",
    );
  }
  return Object.freeze({
    visible: true,
    metrics: keyboardMetrics(state.metrics, "native keyboard metrics"),
  });
}

/**
 * Validates and narrows the backend-specific native-module surface once. The
 * adapter keeps React Native implementation imports out of portable runtime
 * and application code.
 */
export function createNativePlatformServices(
  adapter: NativePlatformServicesAdapter,
): NativePlatformServices {
  const fingerprint = platformFingerprint(adapter.getPlatformConstants());
  const statusBarEntries: NormalizedStatusBarEntry[] = [];
  let appliedStatusBarState: AppliedStatusBarState | undefined;
  let statusBarAppearance: NativeColorScheme | undefined;
  let statusBarAppearanceSubscription: NativeSubscription | undefined;

  const mergedStatusBarState = (): AppliedStatusBarState => {
    let barStyle: NonNullable<NormalizedStatusBarEntry["barStyle"]> = {
      animated: false,
      value: "default",
    };
    let hidden: NonNullable<NormalizedStatusBarEntry["hidden"]> = {
      animation: "none",
      value: false,
    };
    for (const entry of statusBarEntries) {
      barStyle = entry.barStyle ?? barStyle;
      hidden = entry.hidden ?? hidden;
    }
    const resolvedStyle =
      barStyle.value === "auto"
        ? statusBarAppearance === "dark"
          ? "light-content"
          : "dark-content"
        : barStyle.value;
    return {
      barStyle: { animated: barStyle.animated, value: resolvedStyle },
      hidden,
    };
  };

  const applyStatusBarState = (): void => {
    const next = mergedStatusBarState();
    if (
      appliedStatusBarState === undefined ||
      appliedStatusBarState.barStyle.value !== next.barStyle.value
    ) {
      adapter.setStatusBarStyle(next.barStyle.value, next.barStyle.animated);
    }
    if (
      appliedStatusBarState === undefined ||
      appliedStatusBarState.hidden.value !== next.hidden.value
    ) {
      adapter.setStatusBarHidden(next.hidden.value, next.hidden.animation);
    }
    appliedStatusBarState = next;
  };

  const usesAutomaticStatusBarStyle = (): boolean =>
    statusBarEntries.some((entry) => entry.barStyle?.value === "auto");

  const ensureStatusBarAppearanceSubscription = (): void => {
    if (statusBarAppearanceSubscription !== undefined) return;
    const nativeSubscription = subscription(
      adapter.subscribeColorScheme((value) => {
        statusBarAppearance = colorScheme(value, "native color scheme");
        applyStatusBarState();
      }),
      "subscribeColorScheme for automatic status-bar style",
    );
    try {
      statusBarAppearance = colorScheme(
        adapter.getColorScheme(),
        "current color scheme",
      );
    } catch (error) {
      nativeSubscription.remove();
      throw error;
    }
    statusBarAppearanceSubscription = nativeSubscription;
  };

  const updateStatusBarStack = (): void => {
    const automatic = usesAutomaticStatusBarStyle();
    if (automatic) ensureStatusBarAppearanceSubscription();
    applyStatusBarState();
    if (!automatic && statusBarAppearanceSubscription !== undefined) {
      const nativeSubscription = statusBarAppearanceSubscription;
      statusBarAppearanceSubscription = undefined;
      statusBarAppearance = undefined;
      nativeSubscription.remove();
    }
  };

  const services: NativePlatformServices = {
    ...fingerprint,
    initialAppState: appState(adapter.getInitialAppState()),
    async canOpenURL(url) {
      const result = await adapter.canOpenURL(outboundURL(url));
      if (typeof result !== "boolean") {
        throw new TypeError(
          "The native Linking module returned a non-boolean canOpenURL result.",
        );
      }
      return result;
    },
    dismissKeyboard() {
      adapter.dismissKeyboard();
    },
    getColorScheme() {
      return colorScheme(adapter.getColorScheme(), "current color scheme");
    },
    getKeyboardState() {
      return initialKeyboardState(adapter.getKeyboardMetrics());
    },
    getWindowMetrics() {
      return windowMetrics(
        adapter.getWindowMetrics(),
        "current window metrics",
      );
    },
    pushStatusBarEntry(configuration) {
      let normalized = statusBarConfiguration(configuration);
      statusBarEntries.push(normalized);
      let active = true;
      try {
        updateStatusBarStack();
      } catch (error) {
        statusBarEntries.pop();
        try {
          updateStatusBarStack();
        } catch {
          // Preserve the failure from the requested status-bar operation.
        }
        throw error;
      }
      return Object.freeze({
        replace(nextConfiguration: NativeStatusBarConfiguration) {
          if (!active) {
            throw new Error("Cannot replace a removed status-bar stack entry.");
          }
          const next = statusBarConfiguration(nextConfiguration);
          const index = statusBarEntries.indexOf(normalized);
          if (index === -1) {
            throw new Error("The status-bar stack entry is no longer active.");
          }
          statusBarEntries[index] = next;
          const previous = normalized;
          normalized = next;
          try {
            updateStatusBarStack();
          } catch (error) {
            statusBarEntries[index] = previous;
            normalized = previous;
            try {
              updateStatusBarStack();
            } catch {
              // Preserve the failure from the requested status-bar operation.
            }
            throw error;
          }
        },
        remove() {
          if (!active) return;
          active = false;
          const index = statusBarEntries.indexOf(normalized);
          if (index !== -1) statusBarEntries.splice(index, 1);
          updateStatusBarStack();
        },
      });
    },
    setColorSchemeOverride(scheme) {
      adapter.setColorSchemeOverride(colorSchemeOverride(scheme));
      if (statusBarAppearanceSubscription !== undefined) {
        statusBarAppearance = colorScheme(
          adapter.getColorScheme(),
          "current color scheme",
        );
        applyStatusBarState();
      }
    },
    async getInitialURL() {
      const value = await adapter.getInitialURL();
      if (value !== null && (typeof value !== "string" || value.length === 0)) {
        throw new TypeError(
          "The native Linking module returned an invalid initial URL.",
        );
      }
      return value;
    },
    async openSettings() {
      await adapter.openSettings();
    },
    async openURL(url) {
      await adapter.openURL(outboundURL(url));
    },
    subscribeAppState(listener) {
      return subscription(
        adapter.subscribeAppState((value) => listener(appState(value))),
        "subscribeAppState",
      );
    },
    subscribeColorScheme(listener) {
      const nativeSubscription = subscription(
        adapter.subscribeColorScheme((value) =>
          listener(colorScheme(value, "native color scheme")),
        ),
        "subscribeColorScheme",
      );
      try {
        listener(colorScheme(adapter.getColorScheme(), "current color scheme"));
      } catch (error) {
        nativeSubscription.remove();
        throw error;
      }
      return nativeSubscription;
    },
    subscribeHardwareBack(listener) {
      return subscription(
        adapter.subscribeHardwareBack(listener),
        "subscribeHardwareBack",
      );
    },
    subscribeKeyboard(listener) {
      const nativeSubscription = subscription(
        adapter.subscribeKeyboard((value) => listener(keyboardState(value))),
        "subscribeKeyboard",
      );
      try {
        listener(initialKeyboardState(adapter.getKeyboardMetrics()));
      } catch (error) {
        nativeSubscription.remove();
        throw error;
      }
      return nativeSubscription;
    },
    subscribeMemoryWarning(listener) {
      return subscription(
        adapter.subscribeMemoryWarning(listener),
        "subscribeMemoryWarning",
      );
    },
    subscribeURL(listener) {
      return subscription(
        adapter.subscribeURL((value) => listener(urlEvent(value))),
        "subscribeURL",
      );
    },
    subscribeWindowMetrics(listener) {
      const nativeSubscription = subscription(
        adapter.subscribeWindowMetrics((value) =>
          listener(windowMetrics(value, "native window metrics")),
        ),
        "subscribeWindowMetrics",
      );
      try {
        listener(
          windowMetrics(adapter.getWindowMetrics(), "current window metrics"),
        );
      } catch (error) {
        nativeSubscription.remove();
        throw error;
      }
      return nativeSubscription;
    },
  };
  return Object.freeze(services);
}
