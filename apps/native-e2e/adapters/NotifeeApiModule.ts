// App-owned seam from the generated Notify Kit ABI to the reviewed product
// adapter. Neither file evaluates react-native-notify-kit's JavaScript facade.

import {
  createNotifyKit10NotificationService,
  type NotificationService,
} from "@solid-native/notifications/notify-kit-10";
import NativeEventEmitter from "react-native/Libraries/EventEmitter/NativeEventEmitter";
import * as TurboModuleRegistry from "react-native/Libraries/TurboModule/TurboModuleRegistry";

import {
  requireNotifeeApiModuleNativeModule,
  type NotifeeApiModuleNativeModule,
} from "../generated/SolidNativeBindings";

export interface GeneratedNotifyKitOptions {
  readonly platform: "android" | "ios";
  readonly androidSmallIcon?: string;
}

interface NativeEventSubscription {
  remove(): void;
}

interface NativeEventSource {
  addListener(
    eventName: string,
    listener: (event: unknown) => void,
  ): NativeEventSubscription;
}

interface NativeEventEmitterConstructor {
  new (nativeModule: NotifeeApiModuleNativeModule): NativeEventSource;
}

const NotifeeNativeEventEmitter =
  NativeEventEmitter as unknown as NativeEventEmitterConstructor;

/**
 * Resolves the exact generated NotifeeApiModule ABI, then injects React
 * Native's low-level event transport into the wrapper-free Notify Kit adapter.
 */
export function createGeneratedNotifyKitNotificationService(
  options: GeneratedNotifyKitOptions,
): NotificationService {
  const native: NotifeeApiModuleNativeModule =
    requireNotifeeApiModuleNativeModule(TurboModuleRegistry);
  const events = new NotifeeNativeEventEmitter(native);
  return createNotifyKit10NotificationService(native, events, options);
}
