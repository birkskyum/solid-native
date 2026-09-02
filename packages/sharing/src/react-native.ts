import {
  get,
  getEnforcing,
} from "react-native/Libraries/TurboModule/TurboModuleRegistry";
import { assertVerifiedReactNativePlatform } from "@solid-native/react-native-compat";

import { createShareService, type ShareService } from "./index.js";
import {
  createAndroidShareAdapter,
  createIOSShareAdapter,
  type AndroidShareModule,
  type IOSActionSheetManagerModule,
} from "./react-native-adapter.js";

interface PlatformConstantsModule {
  getConstants(): unknown;
}

type ConcretePlatform = "android" | "ios";
let service: ShareService | undefined;

function platform(): ConcretePlatform {
  return assertVerifiedReactNativePlatform(
    getEnforcing<PlatformConstantsModule>("PlatformConstants").getConstants(),
    "System sharing",
  ).platform;
}

/** Resolves pinned native modules without evaluating React Native's Share.js. */
export function createReactNativeShareService(): ShareService {
  if (service !== undefined) return service;
  const nativePlatform = platform();
  if (nativePlatform === "android") {
    const module = get<AndroidShareModule>("ShareModule");
    if (module === null) {
      throw new Error("The Android ShareModule TurboModule is unavailable.");
    }
    service = createShareService(createAndroidShareAdapter(module));
    return service;
  }
  const module = get<IOSActionSheetManagerModule>("ActionSheetManager");
  if (module === null) {
    throw new Error("The iOS ActionSheetManager TurboModule is unavailable.");
  }
  service = createShareService(createIOSShareAdapter(module));
  return service;
}

export { SharePresentationInProgressError } from "./index.js";

export type {
  NormalizedShareRequest,
  SharePlatform,
  ShareRequest,
  ShareResult,
  ShareService,
} from "./index.js";
