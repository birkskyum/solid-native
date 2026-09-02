import {
  get,
  getEnforcing,
} from "react-native/Libraries/TurboModule/TurboModuleRegistry";
import { assertVerifiedReactNativePlatform } from "@solid-native/react-native-compat";

import { createImageService, type ImageService } from "./index.js";
import {
  createAndroidImageAdapter,
  createIOSImageAdapter,
  type AndroidImageLoaderModule,
  type IOSImageLoaderModule,
} from "./react-native-adapter.js";

interface PlatformConstantsModule {
  getConstants(): unknown;
}

type ConcretePlatform = "android" | "ios";
let service: ImageService | undefined;

function platform(): ConcretePlatform {
  return assertVerifiedReactNativePlatform(
    getEnforcing<PlatformConstantsModule>("PlatformConstants").getConstants(),
    "Images",
  ).platform;
}

/** Resolves the pinned ImageLoader without evaluating either Image facade. */
export function createReactNativeImageService(): ImageService {
  if (service !== undefined) return service;
  const nativePlatform = platform();
  if (nativePlatform === "android") {
    const module = get<AndroidImageLoaderModule>("ImageLoader");
    if (module === null) {
      throw new Error("The Android ImageLoader TurboModule is unavailable.");
    }
    service = createImageService(createAndroidImageAdapter(module));
    return service;
  }
  const module = get<IOSImageLoaderModule>("ImageLoader");
  if (module === null) {
    throw new Error("The iOS ImageLoader TurboModule is unavailable.");
  }
  service = createImageService(createIOSImageAdapter(module));
  return service;
}

export { ImagePrefetchCancelledError } from "./index.js";

export type {
  ImageCacheEntry,
  ImageCacheLocation,
  ImageDimensions,
  ImagePrefetchHandle,
  ImageRequest,
  ImageService,
} from "./index.js";
