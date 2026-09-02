import {
  get,
  getEnforcing,
} from "react-native/Libraries/TurboModule/TurboModuleRegistry";
import { assertVerifiedReactNativePlatform } from "@solid-native/react-native-compat";

import { createAlertService, type AlertService } from "./index.js";
import {
  createAndroidAlertAdapter,
  createIOSAlertAdapter,
  type AndroidDialogManagerModule,
  type IOSAlertManagerModule,
} from "./react-native-adapter.js";

interface PlatformConstantsModule {
  getConstants(): unknown;
}

type ConcretePlatform = "android" | "ios";
let service: AlertService | undefined;

function platform(): ConcretePlatform {
  return assertVerifiedReactNativePlatform(
    getEnforcing<PlatformConstantsModule>("PlatformConstants").getConstants(),
    "Native alerts",
  ).platform;
}

/** Resolves the pinned platform alert TurboModule without evaluating Alert.js. */
export function createReactNativeAlertService(): AlertService {
  if (service !== undefined) return service;
  const nativePlatform = platform();
  if (nativePlatform === "android") {
    const module = get<AndroidDialogManagerModule>("DialogManagerAndroid");
    if (module === null) {
      throw new Error(
        "The Android DialogManagerAndroid TurboModule is unavailable.",
      );
    }
    service = createAlertService(createAndroidAlertAdapter(module));
    return service;
  }
  const module = get<IOSAlertManagerModule>("AlertManager");
  if (module === null) {
    throw new Error("The iOS AlertManager TurboModule is unavailable.");
  }
  service = createAlertService(createIOSAlertAdapter(module));
  return service;
}

export { AlertPresentationInProgressError } from "./index.js";

export type {
  AlertButton,
  AlertButtonStyle,
  AlertPlatform,
  AlertRequest,
  AlertResult,
  AlertService,
  AlertUserInterfaceStyle,
  NormalizedAlertButton,
  NormalizedAlertRequest,
} from "./index.js";
