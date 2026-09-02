import {
  createNotificationService,
  type NormalizedLocalNotification,
  type NotificationAuthorization,
  type NotificationEvent,
  type NotificationPermission,
  type NotificationService,
} from "./index.js";

export type {
  LocalNotification,
  NotificationAuthorization,
  NotificationEvent,
  NotificationPermission,
  NotificationService,
} from "./index.js";

export const NOTIFY_KIT_10_FOREGROUND_EVENT = "app.notifee.notification-event";

/** The reviewed Notify Kit 10.5 native surface used by this adapter. */
export interface NotifyKit10NativeModule {
  readonly getNotificationSettings: () => Promise<unknown>;
  readonly requestPermission: (
    permissions: Readonly<Record<string, unknown>>,
  ) => Promise<unknown>;
  readonly createChannel: (
    channel: Readonly<Record<string, unknown>>,
  ) => Promise<unknown>;
  readonly displayNotification: (
    notification: Readonly<Record<string, unknown>>,
  ) => Promise<unknown>;
  readonly getDisplayedNotifications: () => Promise<unknown>;
  readonly cancelAllNotificationsWithIds: (
    ids: ReadonlyArray<string>,
    notificationType: number,
    tag: string | null,
  ) => Promise<unknown>;
  readonly cancelNotification: (id: string) => Promise<unknown>;
}

export interface NotifyKit10NativeEventSubscription {
  remove(): void;
}

/** Injected so the product package never imports React Native or Notify Kit. */
export interface NotifyKit10NativeEventSource {
  addListener(eventName: string, listener: (event: unknown) => void): unknown;
}

export interface NotifyKit10NotificationServiceOptions {
  readonly platform: "android" | "ios";
  /** Android drawable resource name used as the status-bar icon. */
  readonly androidSmallIcon?: string;
}

function plainRecord(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must be a plain object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function nativeMethod(
  native: NotifyKit10NativeModule,
  name: keyof NotifyKit10NativeModule,
): void {
  if (typeof native[name] !== "function") {
    throw new TypeError(`Notify Kit native method ${name} must be a function.`);
  }
}

function androidResourceName(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_]{0,254}$/.test(value)) {
    throw new TypeError(
      "Android notification icon must be a lowercase drawable resource name.",
    );
  }
  return value;
}

function authorization(value: unknown): NotificationAuthorization {
  switch (value) {
    case -1:
      return "not-determined";
    case 0:
      return "denied";
    case 1:
      return "authorized";
    case 2:
      return "provisional";
    default:
      throw new TypeError(
        "Notify Kit returned an unsupported authorization status.",
      );
  }
}

function permission(value: unknown): NotificationPermission {
  const settings = plainRecord(value, "Notify Kit notification settings");
  return Object.freeze({
    authorization: authorization(settings.authorizationStatus),
  });
}

function importance(
  value: NormalizedLocalNotification["channel"]["importance"],
): 2 | 3 | 4 {
  switch (value) {
    case "low":
      return 2;
    case "default":
      return 3;
    case "high":
      return 4;
  }
}

function notificationEvent(value: unknown): NotificationEvent {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return Object.freeze({ kind: "unknown" });
  }
  const event = value as Readonly<Record<string, unknown>>;
  const detail =
    event.detail !== null &&
    typeof event.detail === "object" &&
    !Array.isArray(event.detail)
      ? (event.detail as Readonly<Record<string, unknown>>)
      : undefined;
  const notification =
    detail?.notification !== null &&
    typeof detail?.notification === "object" &&
    !Array.isArray(detail.notification)
      ? (detail.notification as Readonly<Record<string, unknown>>)
      : undefined;
  const pressAction =
    detail?.pressAction !== null &&
    typeof detail?.pressAction === "object" &&
    !Array.isArray(detail.pressAction)
      ? (detail.pressAction as Readonly<Record<string, unknown>>)
      : undefined;
  const kind: NotificationEvent["kind"] =
    event.type === 3
      ? "delivered"
      : event.type === 1
        ? "pressed"
        : event.type === 2
          ? "action-pressed"
          : event.type === 0
            ? "dismissed"
            : "unknown";
  return Object.freeze({
    kind,
    ...(typeof notification?.id === "string"
      ? { notificationId: notification.id }
      : {}),
    ...(typeof pressAction?.id === "string"
      ? { actionId: pressAction.id }
      : {}),
  });
}

function displayedNotificationIds(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Notify Kit returned a non-array displayed list.");
  }
  return value.map((entry, index) => {
    const displayed = plainRecord(
      entry,
      `Notify Kit displayed notification ${String(index)}`,
    );
    const nested = displayed.notification;
    if (nested !== undefined) {
      const notification = plainRecord(
        nested,
        `Notify Kit displayed notification ${String(index)} payload`,
      );
      return notification.id ?? displayed.id;
    }
    return displayed.id;
  });
}

function androidChannel(
  notification: NormalizedLocalNotification,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    id: notification.channel.id,
    name: notification.channel.name,
    bypassDnd: false,
    lights: true,
    vibration: true,
    badge: true,
    importance: importance(notification.channel.importance),
    visibility: 0,
  });
}

function androidNotification(
  notification: NormalizedLocalNotification,
  smallIcon: string,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    id: notification.id,
    data: Object.freeze({}),
    ...(notification.title === undefined ? {} : { title: notification.title }),
    ...(notification.body === undefined ? {} : { body: notification.body }),
    android: Object.freeze({
      autoCancel: true,
      asForegroundService: false,
      lightUpScreen: false,
      badgeIconType: 2,
      colorized: false,
      chronometerDirection: "up",
      defaults: Object.freeze([-1]),
      groupAlertBehavior: 0,
      groupSummary: false,
      localOnly: false,
      ongoing: false,
      loopSound: false,
      onlyAlertOnce: false,
      importance: 3,
      showTimestamp: false,
      smallIcon,
      showChronometer: false,
      visibility: 0,
      circularLargeIcon: false,
      channelId: notification.channel.id,
      pressAction: Object.freeze({
        id: "default",
        launchActivity: "default",
      }),
    }),
  });
}

function iosNotification(
  notification: NormalizedLocalNotification,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    id: notification.id,
    data: Object.freeze({}),
    ...(notification.title === undefined ? {} : { title: notification.title }),
    ...(notification.body === undefined ? {} : { body: notification.body }),
    ios: Object.freeze({
      foregroundPresentationOptions: Object.freeze({
        alert: true,
        badge: true,
        sound: true,
        banner: true,
        list: true,
      }),
    }),
  });
}

/**
 * Adapts Notify Kit 10.5's generated native ABI without importing its
 * React-oriented JavaScript facade. Native resolution and event transport stay
 * application-owned so this package remains usable outside React Native.
 */
export function createNotifyKit10NotificationService(
  native: NotifyKit10NativeModule,
  events: NotifyKit10NativeEventSource,
  options: NotifyKit10NotificationServiceOptions,
): NotificationService {
  if (native === null || typeof native !== "object") {
    throw new TypeError("Notify Kit native module must be an object.");
  }
  for (const name of [
    "getNotificationSettings",
    "requestPermission",
    "createChannel",
    "displayNotification",
    "getDisplayedNotifications",
    "cancelAllNotificationsWithIds",
    "cancelNotification",
  ] as const) {
    nativeMethod(native, name);
  }
  if (
    events === null ||
    typeof events !== "object" ||
    typeof events.addListener !== "function"
  ) {
    throw new TypeError("Notify Kit native event source is invalid.");
  }
  if (options === null || typeof options !== "object") {
    throw new TypeError("Notify Kit adapter options must be an object.");
  }
  if (options.platform !== "android" && options.platform !== "ios") {
    throw new TypeError("Notify Kit platform must be android or ios.");
  }
  const smallIcon =
    options.androidSmallIcon === undefined
      ? "ic_launcher"
      : androidResourceName(options.androidSmallIcon);

  return createNotificationService({
    async getPermission() {
      return permission(await native.getNotificationSettings.call(native));
    },
    async requestPermission() {
      const requested =
        options.platform === "android"
          ? Object.freeze({})
          : Object.freeze({ alert: true, badge: true, sound: true });
      return permission(await native.requestPermission.call(native, requested));
    },
    async display(notification) {
      if (options.platform === "android") {
        await native.createChannel.call(native, androidChannel(notification));
        await native.displayNotification.call(
          native,
          androidNotification(notification, smallIcon),
        );
      } else {
        await native.displayNotification.call(
          native,
          iosNotification(notification),
        );
      }
      return notification.id;
    },
    async getDisplayedNotificationIds() {
      return displayedNotificationIds(
        await native.getDisplayedNotifications.call(native),
      );
    },
    async cancel(notificationId) {
      if (options.platform === "android") {
        await native.cancelAllNotificationsWithIds.call(
          native,
          Object.freeze([notificationId]),
          0,
          null,
        );
      } else {
        await native.cancelNotification.call(native, notificationId);
      }
    },
    subscribe(listener) {
      const subscription = events.addListener(
        NOTIFY_KIT_10_FOREGROUND_EVENT,
        (event) => listener(notificationEvent(event)),
      );
      if (
        subscription === null ||
        typeof subscription !== "object" ||
        typeof (subscription as NotifyKit10NativeEventSubscription).remove !==
          "function"
      ) {
        throw new TypeError(
          "Notify Kit native event subscription must expose remove().",
        );
      }
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        (subscription as NotifyKit10NativeEventSubscription).remove();
      };
    },
  });
}
