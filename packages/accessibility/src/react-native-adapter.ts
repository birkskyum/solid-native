import {
  type AccessibilityAdapter,
  type AccessibilityPreferenceKey,
  type NormalizedAccessibilityAnnouncement,
} from "./index.js";

type NativeSuccess = (value: unknown) => void;
type NativeFailure = (error: unknown) => void;

export interface NativeEventSubscription {
  remove(): void;
}

export interface NativeAccessibilityEventEmitter {
  addListener(
    eventName: string,
    listener: (value: unknown) => void,
  ): NativeEventSubscription;
}

export interface AndroidAccessibilityModule {
  isTouchExplorationEnabled(success: NativeSuccess): void;
  isReduceMotionEnabled(success: NativeSuccess): void;
  isInvertColorsEnabled(success: NativeSuccess): void;
  isGrayscaleEnabled(success: NativeSuccess): void;
  isHighTextContrastEnabled(success: NativeSuccess): void;
  isAccessibilityServiceEnabled(success: NativeSuccess): void;
  announceForAccessibility(message: string): void;
  getRecommendedTimeoutMillis(
    originalTimeout: number,
    success: NativeSuccess,
  ): void;
}

export interface IOSAccessibilityManagerModule {
  getCurrentVoiceOverState(
    success: NativeSuccess,
    failure: NativeFailure,
  ): void;
  getCurrentReduceMotionState(
    success: NativeSuccess,
    failure: NativeFailure,
  ): void;
  getCurrentInvertColorsState(
    success: NativeSuccess,
    failure: NativeFailure,
  ): void;
  getCurrentGrayscaleState(
    success: NativeSuccess,
    failure: NativeFailure,
  ): void;
  getCurrentBoldTextState(success: NativeSuccess, failure: NativeFailure): void;
  getCurrentDarkerSystemColorsState(
    success: NativeSuccess,
    failure: NativeFailure,
  ): void;
  getCurrentReduceTransparencyState(
    success: NativeSuccess,
    failure: NativeFailure,
  ): void;
  getCurrentPrefersCrossFadeTransitionsState(
    success: NativeSuccess,
    failure: NativeFailure,
  ): void;
  announceForAccessibilityWithOptions(
    message: string,
    options: Readonly<{ queue: boolean; priority: string }>,
  ): void;
}

function record(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function requireMethods(
  value: unknown,
  path: string,
  methods: readonly string[],
): void {
  const candidate = record(value, path);
  for (const method of methods) {
    if (typeof candidate[method] !== "function") {
      throw new TypeError(`${path} must provide ${method}().`);
    }
  }
}

function nativeError(value: unknown): Error {
  if (typeof value === "string" && value.length > 0 && value.length <= 4_096) {
    return new Error(value);
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const message = (value as Readonly<Record<string, unknown>>).message;
    if (
      typeof message === "string" &&
      message.length > 0 &&
      message.length <= 4_096
    ) {
      return new Error(message);
    }
  }
  return new Error(
    "The native accessibility manager reported an invalid error.",
  );
}

function callbackQuery(
  invoke: (success: NativeSuccess) => void,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    try {
      invoke((value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      });
    } catch (error) {
      if (settled) return;
      settled = true;
      reject(error);
    }
  });
}

function callbackQueryWithFailure(
  invoke: (success: NativeSuccess, failure: NativeFailure) => void,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    try {
      invoke(
        (value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        },
        (error) => {
          if (settled) return;
          settled = true;
          reject(nativeError(error));
        },
      );
    } catch (error) {
      if (settled) return;
      settled = true;
      reject(error);
    }
  });
}

function subscribeEvents(
  emitter: NativeAccessibilityEventEmitter,
  events: readonly (readonly [string, AccessibilityPreferenceKey])[],
  listener: (change: unknown) => void,
): NativeEventSubscription {
  const subscriptions: NativeEventSubscription[] = [];
  try {
    for (const [eventName, preference] of events) {
      const nativeSubscription = emitter.addListener(eventName, (enabled) =>
        listener({ preference, enabled }),
      );
      requireMethods(
        nativeSubscription,
        `Native accessibility event subscription ${eventName}`,
        ["remove"],
      );
      subscriptions.push(nativeSubscription);
    }
  } catch (error) {
    for (const nativeSubscription of [...subscriptions].reverse()) {
      try {
        nativeSubscription.remove();
      } catch {
        // Preserve the subscription setup failure.
      }
    }
    throw error;
  }
  let active = true;
  return Object.freeze({
    remove() {
      if (!active) return;
      active = false;
      let failure: unknown;
      for (const nativeSubscription of [...subscriptions].reverse()) {
        try {
          nativeSubscription.remove();
        } catch (error) {
          failure ??= error;
        }
      }
      if (failure !== undefined) throw failure;
    },
  });
}

const ANDROID_METHODS = Object.freeze([
  "isTouchExplorationEnabled",
  "isReduceMotionEnabled",
  "isInvertColorsEnabled",
  "isGrayscaleEnabled",
  "isHighTextContrastEnabled",
  "isAccessibilityServiceEnabled",
  "announceForAccessibility",
  "getRecommendedTimeoutMillis",
]);

const IOS_METHODS = Object.freeze([
  "getCurrentVoiceOverState",
  "getCurrentReduceMotionState",
  "getCurrentInvertColorsState",
  "getCurrentGrayscaleState",
  "getCurrentBoldTextState",
  "getCurrentDarkerSystemColorsState",
  "getCurrentReduceTransparencyState",
  "getCurrentPrefersCrossFadeTransitionsState",
  "announceForAccessibilityWithOptions",
]);

const ANDROID_EVENTS = Object.freeze([
  ["touchExplorationDidChange", "screenReaderEnabled"],
  ["reduceMotionDidChange", "reduceMotionEnabled"],
  ["invertColorDidChange", "invertColorsEnabled"],
  ["grayscaleModeDidChange", "grayscaleEnabled"],
  ["highTextContrastDidChange", "highTextContrastEnabled"],
  ["accessibilityServiceDidChange", "accessibilityServiceEnabled"],
] as const);

const IOS_EVENTS = Object.freeze([
  ["screenReaderChanged", "screenReaderEnabled"],
  ["reduceMotionChanged", "reduceMotionEnabled"],
  ["invertColorsChanged", "invertColorsEnabled"],
  ["grayscaleChanged", "grayscaleEnabled"],
  ["boldTextChanged", "boldTextEnabled"],
  ["darkerSystemColorsChanged", "darkerSystemColorsEnabled"],
  ["reduceTransparencyChanged", "reduceTransparencyEnabled"],
] as const);

/** @internal Direct React Native 0.87 Android accessibility translation seam. */
export function createAndroidAccessibilityAdapter(
  module: AndroidAccessibilityModule,
  emitter: NativeAccessibilityEventEmitter,
): AccessibilityAdapter {
  requireMethods(module, "Android accessibility module", ANDROID_METHODS);
  requireMethods(emitter, "Native accessibility event emitter", [
    "addListener",
  ]);
  const adapter: AccessibilityAdapter = {
    platform: "android" as const,
    async getPreferences() {
      const [
        screenReaderEnabled,
        reduceMotionEnabled,
        invertColorsEnabled,
        grayscaleEnabled,
        highTextContrastEnabled,
        accessibilityServiceEnabled,
      ] = await Promise.all([
        callbackQuery((success) => module.isTouchExplorationEnabled(success)),
        callbackQuery((success) => module.isReduceMotionEnabled(success)),
        callbackQuery((success) => module.isInvertColorsEnabled(success)),
        callbackQuery((success) => module.isGrayscaleEnabled(success)),
        callbackQuery((success) => module.isHighTextContrastEnabled(success)),
        callbackQuery((success) =>
          module.isAccessibilityServiceEnabled(success),
        ),
      ]);
      return {
        platform: "android",
        screenReaderEnabled,
        reduceMotionEnabled,
        invertColorsEnabled,
        grayscaleEnabled,
        highTextContrastEnabled,
        accessibilityServiceEnabled,
      };
    },
    subscribe(listener: (change: unknown) => void) {
      return subscribeEvents(emitter, ANDROID_EVENTS, listener);
    },
    announce(request: NormalizedAccessibilityAnnouncement) {
      module.announceForAccessibility(request.message);
    },
    getRecommendedTimeoutMillis(originalTimeout: number) {
      return callbackQuery((success) =>
        module.getRecommendedTimeoutMillis(originalTimeout, success),
      );
    },
  };
  return Object.freeze(adapter);
}

/** @internal Direct React Native 0.87 iOS accessibility translation seam. */
export function createIOSAccessibilityAdapter(
  module: IOSAccessibilityManagerModule,
  emitter: NativeAccessibilityEventEmitter,
): AccessibilityAdapter {
  requireMethods(module, "iOS accessibility manager", IOS_METHODS);
  requireMethods(emitter, "Native accessibility event emitter", [
    "addListener",
  ]);
  const adapter: AccessibilityAdapter = {
    platform: "ios" as const,
    async getPreferences() {
      const [
        screenReaderEnabled,
        reduceMotionEnabled,
        invertColorsEnabled,
        grayscaleEnabled,
        boldTextEnabled,
        darkerSystemColorsEnabled,
        reduceTransparencyEnabled,
        prefersCrossFadeTransitions,
      ] = await Promise.all([
        callbackQueryWithFailure((success, failure) =>
          module.getCurrentVoiceOverState(success, failure),
        ),
        callbackQueryWithFailure((success, failure) =>
          module.getCurrentReduceMotionState(success, failure),
        ),
        callbackQueryWithFailure((success, failure) =>
          module.getCurrentInvertColorsState(success, failure),
        ),
        callbackQueryWithFailure((success, failure) =>
          module.getCurrentGrayscaleState(success, failure),
        ),
        callbackQueryWithFailure((success, failure) =>
          module.getCurrentBoldTextState(success, failure),
        ),
        callbackQueryWithFailure((success, failure) =>
          module.getCurrentDarkerSystemColorsState(success, failure),
        ),
        callbackQueryWithFailure((success, failure) =>
          module.getCurrentReduceTransparencyState(success, failure),
        ),
        callbackQueryWithFailure((success, failure) =>
          module.getCurrentPrefersCrossFadeTransitionsState(success, failure),
        ),
      ]);
      return {
        platform: "ios",
        screenReaderEnabled,
        reduceMotionEnabled,
        invertColorsEnabled,
        grayscaleEnabled,
        boldTextEnabled,
        darkerSystemColorsEnabled,
        reduceTransparencyEnabled,
        prefersCrossFadeTransitions,
      };
    },
    subscribe(listener: (change: unknown) => void) {
      return subscribeEvents(emitter, IOS_EVENTS, listener);
    },
    announce(request: NormalizedAccessibilityAnnouncement) {
      module.announceForAccessibilityWithOptions(
        request.message,
        Object.freeze({ queue: request.queue, priority: request.priority }),
      );
    },
    async getRecommendedTimeoutMillis(originalTimeout: number) {
      return originalTimeout;
    },
  };
  return Object.freeze(adapter);
}
