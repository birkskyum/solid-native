import assert from "node:assert/strict";
import test from "node:test";

import { createNotificationService } from "../dist/index.js";
import {
  NOTIFY_KIT_10_FOREGROUND_EVENT,
  createNotifyKit10NotificationService,
} from "../dist/notify-kit-10.js";

function memoryAdapter() {
  const displayed = new Set();
  const listeners = new Set();
  return {
    displayed,
    listeners,
    lastNotification: undefined,
    permission: { authorization: "authorized" },
    async getPermission() {
      return this.permission;
    },
    async requestPermission() {
      return this.permission;
    },
    async display(notification) {
      this.lastNotification = notification;
      displayed.add(notification.id);
      return notification.id;
    },
    async getDisplayedNotificationIds() {
      return [...displayed];
    },
    async cancel(id) {
      displayed.delete(id);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(event) {
      for (const listener of listeners) listener(event);
    },
  };
}

test("validates local notification permission, display, query, and cancellation", async () => {
  const adapter = memoryAdapter();
  const service = createNotificationService(adapter);

  assert.deepEqual(await service.getPermission(), {
    authorization: "authorized",
  });
  const id = await service.display({
    id: "release-ready",
    title: "Solid Native",
    body: "Notification module delivered",
    channel: { id: "proof", name: "Proofs" },
  });
  assert.equal(id, "release-ready");
  assert.equal(adapter.lastNotification.channel.importance, "default");
  assert.deepEqual(await service.getDisplayedNotificationIds(), [
    "release-ready",
  ]);
  await service.cancel(id);
  assert.deepEqual(await service.getDisplayedNotificationIds(), []);
});

test("rejects malformed adapters, inputs, and native results", async () => {
  assert.throws(() => createNotificationService({}), /getPermission/);
  const adapter = memoryAdapter();
  const service = createNotificationService(adapter);

  await assert.rejects(
    service.display({
      id: "invalid",
      channel: { id: "proof", name: "Proofs" },
    }),
    /title or body/,
  );
  await assert.rejects(
    service.display({
      id: "invalid",
      title: "Invalid",
      channel: { id: "proof", name: "Proofs", importance: "urgent" },
    }),
    /importance/,
  );
  adapter.permission = { authorization: "maybe" };
  await assert.rejects(service.getPermission(), /authorization status/);
  adapter.getDisplayedNotificationIds = async () => ["duplicate", "duplicate"];
  await assert.rejects(service.getDisplayedNotificationIds(), /must be unique/);
});

test("normalizes foreground events and isolates listener failures", async () => {
  const adapter = memoryAdapter();
  const errors = [];
  const service = createNotificationService(adapter);
  const subscription = service.subscribe(
    async () => {
      throw new Error("application listener failed");
    },
    {
      async onError(error) {
        errors.push(error);
        throw new Error("diagnostic failed");
      },
    },
  );

  adapter.emit({ kind: "delivered", notificationId: "proof" });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(errors.length, 1);
  subscription.remove();
  subscription.remove();
  assert.equal(adapter.listeners.size, 0);
});

function notifyKitNative() {
  const calls = [];
  const native = {
    authorizationStatus: 1,
    calls,
    displayed: [],
    async getNotificationSettings() {
      assert.equal(this, native);
      calls.push(["getNotificationSettings"]);
      return { authorizationStatus: this.authorizationStatus };
    },
    async requestPermission(permissions) {
      assert.equal(this, native);
      calls.push(["requestPermission", permissions]);
      return { authorizationStatus: this.authorizationStatus };
    },
    async createChannel(channel) {
      assert.equal(this, native);
      calls.push(["createChannel", channel]);
    },
    async displayNotification(notification) {
      assert.equal(this, native);
      calls.push(["displayNotification", notification]);
    },
    async getDisplayedNotifications() {
      assert.equal(this, native);
      calls.push(["getDisplayedNotifications"]);
      return this.displayed;
    },
    async cancelAllNotificationsWithIds(ids, notificationType, tag) {
      assert.equal(this, native);
      calls.push(["cancelAllNotificationsWithIds", ids, notificationType, tag]);
    },
    async cancelNotification(id) {
      assert.equal(this, native);
      calls.push(["cancelNotification", id]);
    },
  };
  return native;
}

function nativeEventSource() {
  const listeners = new Set();
  const eventNames = [];
  let removals = 0;
  return {
    eventNames,
    listeners,
    get removals() {
      return removals;
    },
    addListener(eventName, listener) {
      eventNames.push(eventName);
      listeners.add(listener);
      return {
        remove() {
          removals += 1;
          listeners.delete(listener);
        },
      };
    },
    emit(event) {
      for (const listener of listeners) listener(event);
    },
  };
}

test("drives Notify Kit 10 through its narrow Android native ABI", async () => {
  const native = notifyKitNative();
  const events = nativeEventSource();
  const service = createNotifyKit10NotificationService(native, events, {
    platform: "android",
    androidSmallIcon: "solid_native_notification",
  });

  assert.deepEqual(await service.getPermission(), {
    authorization: "authorized",
  });
  native.authorizationStatus = 2;
  assert.deepEqual(await service.requestPermission(), {
    authorization: "provisional",
  });
  assert.deepEqual(native.calls[1], ["requestPermission", {}]);
  assert.ok(Object.isFrozen(native.calls[1][1]));

  assert.equal(
    await service.display({
      id: "wrapper-free",
      title: "Solid Native",
      body: "Generated native ABI",
      channel: { id: "proof", name: "Proofs", importance: "high" },
    }),
    "wrapper-free",
  );
  const channel = native.calls[2][1];
  const notification = native.calls[3][1];
  assert.deepEqual(channel, {
    id: "proof",
    name: "Proofs",
    bypassDnd: false,
    lights: true,
    vibration: true,
    badge: true,
    importance: 4,
    visibility: 0,
  });
  assert.ok(Object.isFrozen(channel));
  assert.equal(notification.android.channelId, "proof");
  assert.equal(notification.android.smallIcon, "solid_native_notification");
  assert.deepEqual(notification.android.pressAction, {
    id: "default",
    launchActivity: "default",
  });
  assert.ok(Object.isFrozen(notification));
  assert.ok(Object.isFrozen(notification.data));
  assert.ok(Object.isFrozen(notification.android));
  assert.ok(Object.isFrozen(notification.android.defaults));
  assert.ok(Object.isFrozen(notification.android.pressAction));

  native.displayed = [
    { id: "platform-id", notification: { id: "wrapper-free" } },
    { id: "second" },
  ];
  assert.deepEqual(await service.getDisplayedNotificationIds(), [
    "wrapper-free",
    "second",
  ]);
  await service.cancel("wrapper-free");
  const cancel = native.calls.at(-1);
  assert.deepEqual(cancel, [
    "cancelAllNotificationsWithIds",
    ["wrapper-free"],
    0,
    null,
  ]);
  assert.ok(Object.isFrozen(cancel[1]));

  const observed = [];
  const subscription = service.subscribe((event) => observed.push(event));
  assert.deepEqual(events.eventNames, [NOTIFY_KIT_10_FOREGROUND_EVENT]);
  events.emit({
    type: 2,
    detail: {
      notification: { id: "wrapper-free" },
      pressAction: { id: "accept" },
    },
  });
  events.emit({ type: 99, detail: null });
  assert.deepEqual(observed, [
    {
      kind: "action-pressed",
      notificationId: "wrapper-free",
      actionId: "accept",
    },
    { kind: "unknown" },
  ]);
  subscription.remove();
  subscription.remove();
  assert.equal(events.removals, 1);
  assert.equal(events.listeners.size, 0);
});

test("uses the reviewed Notify Kit 10 iOS payload and cancellation path", async () => {
  const native = notifyKitNative();
  const events = nativeEventSource();
  const service = createNotifyKit10NotificationService(native, events, {
    platform: "ios",
  });

  await service.requestPermission();
  assert.deepEqual(native.calls[0], [
    "requestPermission",
    { alert: true, badge: true, sound: true },
  ]);
  assert.ok(Object.isFrozen(native.calls[0][1]));
  await service.display({
    id: "ios-proof",
    title: "Solid Native",
    channel: { id: "portable", name: "Portable" },
  });
  assert.equal(
    native.calls.some(([name]) => name === "createChannel"),
    false,
  );
  assert.deepEqual(native.calls[1][1].ios.foregroundPresentationOptions, {
    alert: true,
    badge: true,
    sound: true,
    banner: true,
    list: true,
  });
  assert.ok(
    Object.isFrozen(native.calls[1][1].ios.foregroundPresentationOptions),
  );
  await service.cancel("ios-proof");
  assert.deepEqual(native.calls.at(-1), ["cancelNotification", "ios-proof"]);
});

test("fails closed on malformed Notify Kit modules, results, and subscriptions", async () => {
  const native = notifyKitNative();
  const events = nativeEventSource();
  assert.throws(
    () => createNotifyKit10NotificationService({}, events, { platform: "ios" }),
    /getNotificationSettings/u,
  );
  assert.throws(
    () => createNotifyKit10NotificationService(native, {}, { platform: "ios" }),
    /event source/u,
  );
  assert.throws(
    () =>
      createNotifyKit10NotificationService(native, events, {
        platform: "android",
        androidSmallIcon: "Invalid-Icon",
      }),
    /drawable resource/u,
  );

  const service = createNotifyKit10NotificationService(native, events, {
    platform: "android",
  });
  native.authorizationStatus = 7;
  await assert.rejects(service.getPermission(), /authorization status/u);
  native.displayed = {};
  await assert.rejects(
    service.getDisplayedNotificationIds(),
    /non-array displayed list/u,
  );

  const invalidEvents = { addListener: () => ({}) };
  const invalidSubscriptionService = createNotifyKit10NotificationService(
    native,
    invalidEvents,
    { platform: "ios" },
  );
  assert.throws(
    () => invalidSubscriptionService.subscribe(() => undefined),
    /expose remove/u,
  );
});
