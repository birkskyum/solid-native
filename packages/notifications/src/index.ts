export const NOTIFICATION_MAX_ID_LENGTH = 256;
export const NOTIFICATION_MAX_TITLE_LENGTH = 512;
export const NOTIFICATION_MAX_BODY_LENGTH = 4_096;
export const NOTIFICATION_MAX_DISPLAYED_COUNT = 10_000;

export type NotificationAuthorization =
  "not-determined" | "denied" | "authorized" | "provisional";

export type NotificationImportance = "low" | "default" | "high";

export type NotificationEventKind =
  "delivered" | "pressed" | "action-pressed" | "dismissed" | "unknown";

export interface NotificationPermission {
  readonly authorization: NotificationAuthorization;
}

export interface NotificationChannel {
  readonly id: string;
  readonly name: string;
  readonly importance?: NotificationImportance;
}

export interface LocalNotification {
  readonly id: string;
  readonly title?: string;
  readonly body?: string;
  /** Required by Android and validated on every platform for portability. */
  readonly channel: NotificationChannel;
}

export interface NormalizedLocalNotification {
  readonly id: string;
  readonly title?: string;
  readonly body?: string;
  readonly channel: Readonly<{
    id: string;
    name: string;
    importance: NotificationImportance;
  }>;
}

export interface NotificationEvent {
  readonly kind: NotificationEventKind;
  readonly notificationId?: string;
  readonly actionId?: string;
}

export interface NotificationAdapter {
  getPermission(): Promise<unknown>;
  requestPermission(): Promise<unknown>;
  display(notification: NormalizedLocalNotification): Promise<unknown>;
  getDisplayedNotificationIds(): Promise<unknown>;
  cancel(notificationId: string): Promise<unknown>;
  subscribe(listener: (event: unknown) => void): unknown;
}

export interface NotificationSubscriptionOptions {
  readonly onError?: (error: unknown) => unknown;
}

export interface NotificationSubscription {
  remove(): void;
}

export interface NotificationService {
  getPermission(): Promise<NotificationPermission>;
  requestPermission(): Promise<NotificationPermission>;
  display(notification: LocalNotification): Promise<string>;
  getDisplayedNotificationIds(): Promise<readonly string[]>;
  cancel(notificationId: string): Promise<void>;
  subscribe(
    listener: (event: NotificationEvent) => unknown,
    options?: NotificationSubscriptionOptions,
  ): NotificationSubscription;
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

function boundedString(
  value: unknown,
  path: string,
  maximumLength: number,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    value.includes("\0")
  ) {
    throw new TypeError(
      `${path} must be a 1-${maximumLength} character string without null bytes.`,
    );
  }
  return value;
}

function notificationId(value: unknown, path = "Notification id"): string {
  return boundedString(value, path, NOTIFICATION_MAX_ID_LENGTH);
}

function optionalString(
  value: unknown,
  path: string,
  maximumLength: number,
): string | undefined {
  return value === undefined
    ? undefined
    : boundedString(value, path, maximumLength);
}

function notificationPermission(value: unknown): NotificationPermission {
  const record = plainRecord(value, "Notification permission");
  if (
    record.authorization !== "not-determined" &&
    record.authorization !== "denied" &&
    record.authorization !== "authorized" &&
    record.authorization !== "provisional"
  ) {
    throw new TypeError(
      "Notification permission authorization status is invalid.",
    );
  }
  return Object.freeze({ authorization: record.authorization });
}

function normalizedNotification(value: unknown): NormalizedLocalNotification {
  const notification = plainRecord(value, "Local notification");
  const channel = plainRecord(
    notification.channel,
    "Local notification channel",
  );
  const title = optionalString(
    notification.title,
    "Notification title",
    NOTIFICATION_MAX_TITLE_LENGTH,
  );
  const body = optionalString(
    notification.body,
    "Notification body",
    NOTIFICATION_MAX_BODY_LENGTH,
  );
  if (title === undefined && body === undefined) {
    throw new TypeError("A local notification requires a title or body.");
  }
  const importance = channel.importance ?? "default";
  if (
    importance !== "low" &&
    importance !== "default" &&
    importance !== "high"
  ) {
    throw new TypeError("Notification channel importance is invalid.");
  }
  return Object.freeze({
    id: notificationId(notification.id),
    ...(title === undefined ? {} : { title }),
    ...(body === undefined ? {} : { body }),
    channel: Object.freeze({
      id: notificationId(channel.id, "Notification channel id"),
      name: boundedString(
        channel.name,
        "Notification channel name",
        NOTIFICATION_MAX_TITLE_LENGTH,
      ),
      importance,
    }),
  });
}

function notificationEvent(value: unknown): NotificationEvent {
  const event = plainRecord(value, "Notification event");
  if (
    event.kind !== "delivered" &&
    event.kind !== "pressed" &&
    event.kind !== "action-pressed" &&
    event.kind !== "dismissed" &&
    event.kind !== "unknown"
  ) {
    throw new TypeError("Notification event kind is invalid.");
  }
  const normalized = {
    kind: event.kind,
    ...(event.notificationId === undefined
      ? {}
      : {
          notificationId: notificationId(
            event.notificationId,
            "Notification event id",
          ),
        }),
    ...(event.actionId === undefined
      ? {}
      : {
          actionId: boundedString(
            event.actionId,
            "Notification action id",
            NOTIFICATION_MAX_ID_LENGTH,
          ),
        }),
  } satisfies NotificationEvent;
  return Object.freeze(normalized);
}

function adapterMethod(
  adapter: NotificationAdapter,
  name: keyof NotificationAdapter,
): void {
  if (typeof adapter[name] !== "function") {
    throw new TypeError(`Notification adapter ${name} must be a function.`);
  }
}

function reportSubscriptionError(
  error: unknown,
  options: NotificationSubscriptionOptions,
): void {
  try {
    const reported = options.onError?.(error);
    void Promise.resolve(reported).catch(() => undefined);
  } catch {
    // A diagnostic callback cannot escape a native event boundary.
  }
}

/**
 * Narrows an untrusted notification backend to bounded, portable values. The
 * adapter remains responsible for platform translation and permission UI.
 */
export function createNotificationService(
  adapter: NotificationAdapter,
): NotificationService {
  if (typeof adapter !== "object" || adapter === null) {
    throw new TypeError("Notification adapter must be an object.");
  }
  adapterMethod(adapter, "getPermission");
  adapterMethod(adapter, "requestPermission");
  adapterMethod(adapter, "display");
  adapterMethod(adapter, "getDisplayedNotificationIds");
  adapterMethod(adapter, "cancel");
  adapterMethod(adapter, "subscribe");

  return Object.freeze({
    async getPermission() {
      return notificationPermission(await adapter.getPermission());
    },
    async requestPermission() {
      return notificationPermission(await adapter.requestPermission());
    },
    async display(notification: LocalNotification) {
      const normalized = normalizedNotification(notification);
      const displayedId = notificationId(
        await adapter.display(normalized),
        "Displayed notification id",
      );
      if (displayedId !== normalized.id) {
        throw new Error(
          "The notification backend returned a different notification id.",
        );
      }
      return displayedId;
    },
    async getDisplayedNotificationIds() {
      const value = await adapter.getDisplayedNotificationIds();
      if (!Array.isArray(value)) {
        throw new TypeError(
          "The notification backend returned a non-array displayed list.",
        );
      }
      if (value.length > NOTIFICATION_MAX_DISPLAYED_COUNT) {
        throw new RangeError(
          `Displayed notifications cannot exceed ${NOTIFICATION_MAX_DISPLAYED_COUNT} entries.`,
        );
      }
      const ids = value.map((entry, index) =>
        notificationId(entry, `Displayed notification id ${String(index)}`),
      );
      if (new Set(ids).size !== ids.length) {
        throw new TypeError("Displayed notification ids must be unique.");
      }
      return Object.freeze(ids);
    },
    async cancel(id: string) {
      await adapter.cancel(notificationId(id));
    },
    subscribe(
      listener: (event: NotificationEvent) => unknown,
      options: NotificationSubscriptionOptions = {},
    ) {
      if (typeof listener !== "function") {
        throw new TypeError("Notification listener must be a function.");
      }
      let active = true;
      const remove = adapter.subscribe((value) => {
        if (!active) return;
        try {
          const result = listener(notificationEvent(value));
          void Promise.resolve(result).catch((error: unknown) => {
            reportSubscriptionError(error, options);
          });
        } catch (error) {
          reportSubscriptionError(error, options);
        }
      });
      if (typeof remove !== "function") {
        throw new TypeError(
          "Notification adapter subscribe must return a cleanup function.",
        );
      }
      return Object.freeze({
        remove() {
          if (!active) return;
          active = false;
          remove();
        },
      });
    },
  });
}
