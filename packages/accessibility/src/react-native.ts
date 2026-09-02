import RCTDeviceEventEmitterModule from "react-native/Libraries/EventEmitter/RCTDeviceEventEmitter";
import {
  get,
  getEnforcing,
} from "react-native/Libraries/TurboModule/TurboModuleRegistry";
import { assertVerifiedReactNativePlatform } from "@solid-native/react-native-compat";

import {
  createAccessibilityService,
  type AccessibilityService,
} from "./index.js";
import {
  createAndroidAccessibilityAdapter,
  createIOSAccessibilityAdapter,
  type AndroidAccessibilityModule,
  type IOSAccessibilityManagerModule,
  type NativeAccessibilityEventEmitter,
} from "./react-native-adapter.js";

interface PlatformConstantsModule {
  getConstants(): unknown;
}

type ConcretePlatform = "android" | "ios";
let service: AccessibilityService | undefined;

function platform(): ConcretePlatform {
  return assertVerifiedReactNativePlatform(
    getEnforcing<PlatformConstantsModule>("PlatformConstants").getConstants(),
    "Native accessibility",
  ).platform;
}

/** Resolves the pinned accessibility TurboModule without AccessibilityInfo.js. */
export function createReactNativeAccessibilityService(): AccessibilityService {
  if (service !== undefined) return service;
  const nativePlatform = platform();
  const emitter =
    RCTDeviceEventEmitterModule as unknown as NativeAccessibilityEventEmitter;
  if (nativePlatform === "android") {
    const module = get<AndroidAccessibilityModule>("AccessibilityInfo");
    if (module === null) {
      throw new Error(
        "The Android AccessibilityInfo TurboModule is unavailable.",
      );
    }
    service = createAccessibilityService(
      createAndroidAccessibilityAdapter(module, emitter),
    );
    return service;
  }
  const module = get<IOSAccessibilityManagerModule>("AccessibilityManager");
  if (module === null) {
    throw new Error("The iOS AccessibilityManager TurboModule is unavailable.");
  }
  service = createAccessibilityService(
    createIOSAccessibilityAdapter(module, emitter),
  );
  return service;
}

export type {
  AccessibilityAnnouncement,
  AccessibilityAnnouncementPriority,
  AccessibilityPlatform,
  AccessibilityPreferenceChange,
  AccessibilityPreferenceKey,
  AccessibilityPreferences,
  AccessibilityService,
  AccessibilitySubscription,
  AccessibilitySubscriptionOptions,
  AndroidAccessibilityPreferences,
  IOSAccessibilityPreferences,
} from "./index.js";
