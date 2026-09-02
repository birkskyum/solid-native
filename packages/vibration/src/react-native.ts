import {
  get,
  getEnforcing,
} from "react-native/Libraries/TurboModule/TurboModuleRegistry";
import { assertVerifiedReactNativePlatform } from "@solid-native/react-native-compat";

import { createVibrationService, type VibrationService } from "./index.js";
import {
  createAndroidVibrationAdapter,
  createIOSVibrationAdapter,
  type ReactNativeVibrationModule,
} from "./react-native-adapter.js";

interface PlatformConstantsModule {
  getConstants(): unknown;
}

type ConcretePlatform = "android" | "ios";
let service: VibrationService | undefined;

function platform(): ConcretePlatform {
  return assertVerifiedReactNativePlatform(
    getEnforcing<PlatformConstantsModule>("PlatformConstants").getConstants(),
    "Vibration",
  ).platform;
}

/** Resolves the pinned Vibration TurboModule without evaluating Vibration.js. */
export function createReactNativeVibrationService(): VibrationService {
  if (service !== undefined) return service;
  const nativePlatform = platform();
  const module = get<ReactNativeVibrationModule>("Vibration");
  if (module === null) {
    throw new Error("The React Native Vibration TurboModule is unavailable.");
  }
  service = createVibrationService(
    nativePlatform === "android"
      ? createAndroidVibrationAdapter(module)
      : createIOSVibrationAdapter(module),
  );
  return service;
}

export type {
  NormalizedVibrationRequest,
  VibrationHandle,
  VibrationPlatform,
  VibrationRequest,
  VibrationSegment,
  VibrationService,
} from "./index.js";
