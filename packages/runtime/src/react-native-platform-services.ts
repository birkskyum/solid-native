import NativeEventEmitterModule from "react-native/Libraries/EventEmitter/NativeEventEmitter";
import KeyboardModule from "react-native/Libraries/Components/Keyboard/Keyboard";
import BackHandlerModule from "react-native/Libraries/Utilities/BackHandler";
import DimensionsModule from "react-native/Libraries/Utilities/Dimensions";
import * as AppearanceModule from "react-native/Libraries/Utilities/Appearance";
import {
  get,
  getEnforcing,
} from "react-native/Libraries/TurboModule/TurboModuleRegistry";

import {
  createNativePlatformServices,
  type NativePlatformServices,
  type NativePlatformServicesAdapter,
  type NativeSubscription,
} from "./platform-services.js";

interface PlatformConstantsModule {
  getConstants(): unknown;
}

interface StatusBarManagerModule {
  setHidden(hidden: boolean, animation?: string): void;
  setStyle(style: string, animated?: boolean): void;
}

interface AppStateModule {
  addListener(eventName: string): void;
  getConstants(): { readonly initialAppState?: unknown };
  removeListeners(count: number): void;
}

interface SolidNativePlatformAndroidModule {
  readonly onMemoryWarning: (
    listener: (event: unknown) => void,
  ) => NativeSubscription;
}

interface LinkingNativeModule {
  canOpenURL(url: string): Promise<unknown>;
  getInitialURL(): Promise<unknown>;
  openSettings(): Promise<unknown>;
  openURL(url: string): Promise<unknown>;
}

interface LinkingEventNativeModule extends LinkingNativeModule {
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

interface NativeEventEmitterInstance {
  addListener(
    eventName: string,
    listener: (event: unknown) => void,
  ): NativeSubscription;
}

interface NativeEventEmitterConstructor {
  new (
    nativeModule?: AppStateModule | LinkingEventNativeModule,
  ): NativeEventEmitterInstance;
}

interface BackHandlerInstance {
  addEventListener(
    eventName: "hardwareBackPress",
    listener: () => boolean,
  ): NativeSubscription;
}

interface KeyboardInstance {
  addListener(
    eventName: "keyboardDidShow" | "keyboardDidHide",
    listener: (event: unknown) => void,
  ): NativeSubscription;
  dismiss(): void;
  metrics(): unknown;
}

interface DimensionsInstance {
  get(dimension: "window"): unknown;
  addEventListener(
    eventName: "change",
    listener: (event: unknown) => void,
  ): NativeSubscription;
}

interface AppearanceInstance {
  addChangeListener(listener: (event: unknown) => void): NativeSubscription;
  getColorScheme(): unknown;
  setColorScheme(scheme: "light" | "dark" | "auto"): void;
}

const BackHandler = BackHandlerModule as unknown as BackHandlerInstance;
const Keyboard = KeyboardModule as unknown as KeyboardInstance;
const Dimensions = DimensionsModule as unknown as DimensionsInstance;
const Appearance = AppearanceModule as unknown as AppearanceInstance;
const NativeEventEmitter =
  NativeEventEmitterModule as unknown as NativeEventEmitterConstructor;

let services: NativePlatformServices | undefined;

/**
 * Returns the pinned React Native 0.87 implementation of Solid Native's
 * validated platform services. Import `react-native/setup-env` before this
 * entry point in an application bundle.
 */
export function getReactNativePlatformServices(): NativePlatformServices {
  if (services !== undefined) return services;
  const platformConstants =
    getEnforcing<PlatformConstantsModule>("PlatformConstants").getConstants();
  const isAndroid =
    typeof platformConstants === "object" &&
    platformConstants !== null &&
    "Version" in platformConstants &&
    typeof platformConstants.Version === "number";
  const appState = getEnforcing<AppStateModule>("AppState");
  const solidNativePlatform = isAndroid
    ? getEnforcing<SolidNativePlatformAndroidModule>(
        "SolidNativePlatformAndroid",
      )
    : undefined;
  const statusBar = getEnforcing<StatusBarManagerModule>("StatusBarManager");
  const appStateEmitter = new NativeEventEmitter(appState);
  const linking =
    get<LinkingNativeModule>("LinkingManager") ??
    get<LinkingNativeModule>("IntentAndroid");
  if (linking === null) {
    throw new Error("The native Linking TurboModule is unavailable.");
  }
  const linkingEmitter = new NativeEventEmitter(
    isAndroid ? undefined : (linking as LinkingEventNativeModule),
  );
  services = createNativePlatformServices({
    canOpenURL: (url) => linking.canOpenURL(url),
    getPlatformConstants: () => platformConstants,
    getColorScheme: () => Appearance.getColorScheme(),
    getInitialAppState: () => appState.getConstants().initialAppState,
    getKeyboardMetrics: () => Keyboard.metrics(),
    getWindowMetrics: () => Dimensions.get("window"),
    setColorSchemeOverride: (scheme) =>
      Appearance.setColorScheme(scheme === "system" ? "auto" : scheme),
    setStatusBarHidden: (hidden, animation) => {
      if (isAndroid) statusBar.setHidden(hidden);
      else statusBar.setHidden(hidden, animation);
    },
    setStatusBarStyle: (style, animated) => {
      if (isAndroid) statusBar.setStyle(style);
      else statusBar.setStyle(style, animated);
    },
    dismissKeyboard: () => Keyboard.dismiss(),
    getInitialURL: () => linking.getInitialURL(),
    openSettings: () => linking.openSettings(),
    openURL: (url) => linking.openURL(url),
    subscribeAppState: (listener) =>
      appStateEmitter.addListener("appStateDidChange", (event) =>
        listener(
          typeof event === "object" && event !== null && "app_state" in event
            ? event.app_state
            : undefined,
        ),
      ),
    subscribeColorScheme: (listener) =>
      Appearance.addChangeListener((event) =>
        listener(
          typeof event === "object" && event !== null && "colorScheme" in event
            ? event.colorScheme
            : undefined,
        ),
      ),
    subscribeHardwareBack: (listener) =>
      BackHandler.addEventListener("hardwareBackPress", listener),
    subscribeKeyboard: (listener) => {
      const shown = Keyboard.addListener("keyboardDidShow", (event) =>
        listener({
          visible: true,
          metrics:
            typeof event === "object" &&
            event !== null &&
            "endCoordinates" in event
              ? event.endCoordinates
              : undefined,
        }),
      );
      const hidden = Keyboard.addListener("keyboardDidHide", () =>
        listener({ visible: false }),
      );
      let active = true;
      return {
        remove() {
          if (!active) return;
          active = false;
          let failure: unknown;
          try {
            shown.remove();
          } catch (error) {
            failure = error;
          }
          try {
            hidden.remove();
          } catch (error) {
            failure ??= error;
          }
          if (failure !== undefined) throw failure;
        },
      };
    },
    subscribeMemoryWarning: (listener) =>
      solidNativePlatform === undefined
        ? appStateEmitter.addListener("memoryWarning", listener)
        : solidNativePlatform.onMemoryWarning(listener),
    subscribeURL: (listener) => linkingEmitter.addListener("url", listener),
    subscribeWindowMetrics: (listener) =>
      Dimensions.addEventListener("change", (event) =>
        listener(
          typeof event === "object" && event !== null && "window" in event
            ? event.window
            : undefined,
        ),
      ),
  } satisfies NativePlatformServicesAdapter);
  return services;
}

export type {
  NativeAppState,
  NativeColorScheme,
  NativeColorSchemeOverride,
  NativeKeyboardMetrics,
  NativeKeyboardState,
  NativePlatformFingerprint,
  NativePlatformServices,
  NativeStatusBarAnimation,
  NativeStatusBarConfiguration,
  NativeStatusBarStackEntry,
  NativeStatusBarStyle,
  NativeSubscription,
  NativeURLEvent,
  NativeWindowMetrics,
} from "./platform-services.js";
