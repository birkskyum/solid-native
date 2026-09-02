import { createCausalPlatformEventHandler } from "@solid-native/core";
import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";

import {
  type NotificationEvent,
  type NotificationEventKind,
  type NotificationService,
  type NotificationSubscriptionOptions,
} from "./index.js";

export interface NotificationEventAccessorOptions extends NotificationSubscriptionOptions {
  readonly initialValue?: NotificationEvent;
}

export type NotificationEventSource =
  NotificationService | Accessor<NotificationService | undefined>;

const NOTIFICATION_EVENT_NAMES = Object.freeze({
  delivered: "platform.notification.delivered",
  pressed: "platform.notification.pressed",
  "action-pressed": "platform.notification.action-pressed",
  dismissed: "platform.notification.dismissed",
  unknown: "platform.notification.unknown",
} satisfies Record<NotificationEventKind, string>);

function reportAccessorError(
  error: unknown,
  options: NotificationEventAccessorOptions,
): void {
  try {
    const reported = options.onError?.(error);
    void Promise.resolve(reported).catch(() => undefined);
  } catch {
    // Diagnostics cannot break subscription handoff or owner disposal.
  }
}

/**
 * Projects native foreground notification events into one fine-grained Solid
 * accessor and removes the platform subscription with its current owner.
 */
export function createNotificationEvent(
  source: NotificationEventSource,
  options: NotificationEventAccessorOptions = {},
): Accessor<NotificationEvent | undefined> {
  const [event, setEvent] = createSignal<NotificationEvent | undefined>(
    options.initialValue,
  );
  const handlers = Object.freeze({
    delivered: createCausalPlatformEventHandler(
      NOTIFICATION_EVENT_NAMES.delivered,
      setEvent,
    ),
    pressed: createCausalPlatformEventHandler(
      NOTIFICATION_EVENT_NAMES.pressed,
      setEvent,
      { priority: "discrete" },
    ),
    "action-pressed": createCausalPlatformEventHandler(
      NOTIFICATION_EVENT_NAMES["action-pressed"],
      setEvent,
      { priority: "discrete" },
    ),
    dismissed: createCausalPlatformEventHandler(
      NOTIFICATION_EVENT_NAMES.dismissed,
      setEvent,
    ),
    unknown: createCausalPlatformEventHandler(
      NOTIFICATION_EVENT_NAMES.unknown,
      setEvent,
    ),
  } satisfies Record<
    NotificationEventKind,
    (nextEvent: NotificationEvent) => unknown
  >);

  let removeSubscription: (() => void) | undefined;
  const removeCurrentSubscription = (): void => {
    const remove = removeSubscription;
    removeSubscription = undefined;
    if (remove === undefined) return;
    try {
      remove();
    } catch (error) {
      reportAccessorError(error, options);
    }
  };
  createEffect(
    () => (typeof source === "function" ? source() : source),
    (service) => {
      removeCurrentSubscription();
      if (service === undefined) return;
      try {
        const subscription = service.subscribe(
          (nextEvent) => handlers[nextEvent.kind](nextEvent),
          options,
        );
        removeSubscription = () => subscription.remove();
      } catch (error) {
        reportAccessorError(error, options);
      }
    },
  );
  onCleanup(removeCurrentSubscription);
  return event;
}
