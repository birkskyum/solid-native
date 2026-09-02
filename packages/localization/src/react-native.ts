import {
  get,
  getEnforcing,
} from "react-native/Libraries/TurboModule/TurboModuleRegistry";
import { assertVerifiedReactNativePlatform } from "@solid-native/react-native-compat";

import type { LocalizationSnapshot } from "./index.js";
import {
  readReactNativeLocalizationSnapshot,
  type ReactNativeI18nManagerModule,
} from "./react-native-adapter.js";

interface PlatformConstantsModule {
  getConstants(): unknown;
}

let snapshot: LocalizationSnapshot | undefined;

function assertPlatform(): void {
  assertVerifiedReactNativePlatform(
    getEnforcing<PlatformConstantsModule>("PlatformConstants").getConstants(),
    "Localization",
  );
}

/** Reads the pinned startup locale without evaluating I18nManager.js. */
export function getReactNativeLocalizationSnapshot(): LocalizationSnapshot {
  if (snapshot !== undefined) return snapshot;
  assertPlatform();
  const module = get<ReactNativeI18nManagerModule>("I18nManager");
  if (module === null) {
    throw new Error("The React Native I18nManager TurboModule is unavailable.");
  }
  snapshot = readReactNativeLocalizationSnapshot(module);
  return snapshot;
}

export type { LocalizationSnapshot, NativeLayoutDirection } from "./index.js";
