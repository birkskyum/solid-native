import {
  get,
  getEnforcing,
} from "react-native/Libraries/TurboModule/TurboModuleRegistry";
import { assertVerifiedReactNativePlatform } from "@solid-native/react-native-compat";

import {
  createKeychain10SecureStorage,
  type Keychain10SecureStorageOptions,
  type ReactNativeKeychain10Module,
} from "./keychain-10.js";
import type { SecureStorage } from "./index.js";

interface PlatformConstantsModule {
  getConstants(): unknown;
}

function assertPlatform(): void {
  assertVerifiedReactNativePlatform(
    getEnforcing<PlatformConstantsModule>("PlatformConstants").getConstants(),
    "Secure storage",
  );
}

/**
 * Resolves react-native-keychain 10 through React Native 0.87's native registry.
 * The registry intentionally falls back to legacy bridge modules because the
 * dependency publishes no discoverable TurboModule schema.
 */
export function createReactNativeSecureStorage(
  options: Keychain10SecureStorageOptions,
): SecureStorage {
  assertPlatform();
  const module = get<ReactNativeKeychain10Module>("RNKeychainManager");
  if (module === null) {
    throw new Error(
      "The react-native-keychain 10 RNKeychainManager native module is unavailable.",
    );
  }
  return createKeychain10SecureStorage(module, options);
}

export type { Keychain10SecureStorageOptions, SecureStorage };
