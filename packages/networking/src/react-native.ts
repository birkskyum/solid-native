import RCTDeviceEventEmitterModule from "react-native/Libraries/EventEmitter/RCTDeviceEventEmitter";
import {
  get,
  getEnforcing,
} from "react-native/Libraries/TurboModule/TurboModuleRegistry";
import { assertVerifiedReactNativePlatform } from "@solid-native/react-native-compat";

import { createNetworkService, type NetworkService } from "./index.js";
import {
  createAndroidNetworkingAdapter,
  createIOSNetworkingAdapter,
  type AndroidNetworkingModule,
  type IOSNetworkingModule,
  type NativeNetworkEventEmitter,
} from "./react-native-adapter.js";

interface PlatformConstantsModule {
  getConstants(): unknown;
}

type ConcretePlatform = "android" | "ios";
let service: NetworkService | undefined;

function platform(): ConcretePlatform {
  return assertVerifiedReactNativePlatform(
    getEnforcing<PlatformConstantsModule>("PlatformConstants").getConstants(),
    "Networking",
  ).platform;
}

/** Resolves the pinned Networking ABI without fetch, XHR, or RCTNetworking. */
export function createReactNativeNetworkService(): NetworkService {
  if (service !== undefined) return service;
  const emitter =
    RCTDeviceEventEmitterModule as unknown as NativeNetworkEventEmitter;
  const nativePlatform = platform();
  if (nativePlatform === "android") {
    const module = get<AndroidNetworkingModule>("Networking");
    if (module === null) {
      throw new Error("The Android Networking TurboModule is unavailable.");
    }
    service = createNetworkService(
      createAndroidNetworkingAdapter(module, emitter),
    );
    return service;
  }
  const module = get<IOSNetworkingModule>("Networking");
  if (module === null) {
    throw new Error("The iOS Networking TurboModule is unavailable.");
  }
  service = createNetworkService(createIOSNetworkingAdapter(module, emitter));
  return service;
}

export {
  NetworkRequestCancelledError,
  NetworkRequestTimedOutError,
  NetworkTransportError,
} from "./index.js";

export type {
  NetworkCredentials,
  NetworkPlatform,
  NetworkResponse,
  NetworkService,
  NetworkTextChunk,
  NetworkTextObserver,
  NetworkTextRequest,
  NetworkTextRequestHandle,
  NetworkTextResult,
} from "./index.js";
