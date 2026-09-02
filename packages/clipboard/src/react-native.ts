import {
  get,
  getEnforcing,
} from "react-native/Libraries/TurboModule/TurboModuleRegistry";
import { assertVerifiedReactNativePlatform } from "@solid-native/react-native-compat";

import type { ClipboardService } from "./index.js";
import {
  createReactNativeClipboardAdapter,
  type ReactNativeClipboardModule,
} from "./react-native-adapter.js";

interface PlatformConstantsModule {
  getConstants(): unknown;
}

let service: ClipboardService | undefined;

function assertPlatform(): void {
  assertVerifiedReactNativePlatform(
    getEnforcing<PlatformConstantsModule>("PlatformConstants").getConstants(),
    "Clipboard",
  );
}

/** Resolves the pinned Clipboard TurboModule without evaluating Clipboard.js. */
export function createReactNativeClipboardService(): ClipboardService {
  if (service !== undefined) return service;
  assertPlatform();
  const module = get<ReactNativeClipboardModule>("Clipboard");
  if (module === null) {
    throw new Error("The React Native Clipboard TurboModule is unavailable.");
  }
  service = createReactNativeClipboardAdapter(module);
  return service;
}

export type { ClipboardService } from "./index.js";
