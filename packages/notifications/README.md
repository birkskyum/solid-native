# `@solid-native/notifications`

This package owns a bounded, portable local-notification contract. Native
permission values, displayed IDs, and foreground events are validated before
they enter application state. Subscription and diagnostic failures are
isolated from the platform event boundary.

The first backend is an explicit, wrapper-free New-Architecture Notify Kit
10.5 adapter. The application resolves its generated `NotifeeApiModule` and
constructs React Native's low-level native event source; this portable package
accepts both by injection and never imports React Native or Notify Kit's
JavaScript facade:

```ts
import { createNotifyKit10NotificationService } from "@solid-native/notifications/notify-kit-10";
import { createNotificationEvent } from "@solid-native/notifications/solid";

const notifications = createNotifyKit10NotificationService(
  generatedNotifeeModule,
  nativeEventSource,
  {
    platform: "android",
    androidSmallIcon: "solid_native_notification",
  },
);
const latestEvent = createNotificationEvent(notifications);

await notifications.requestPermission();
await notifications.display({
  id: "sync-complete",
  title: "Sync complete",
  channel: { id: "application", name: "Application" },
});
```

The checked-in E2E
[`NotifeeApiModule` seam](../../apps/native-e2e/adapters/NotifeeApiModule.ts)
shows the complete registry and `NativeEventEmitter` wiring. Keeping those two
React Native details in the application makes native initialization order and
the exact generated ABI reviewable. The product adapter narrows the native
module's 48 required methods to seven operations and reproduces the 10.5
channel, notification, permission, cancellation, and foreground-event
contract.

`createNotificationEvent` accepts either an available service or an accessor
whose service is loaded later. It replaces the native subscription when that
accessor changes and removes the current subscription with its Solid owner.
Subscription setup and removal failures flow through `onError`; failures in
that diagnostic hook are isolated so a broken native listener cannot halt the
reactive graph or prevent a later service handoff.
Every normalized kind enters the renderer's platform-event boundary under a
stable semantic name:

| Kind             | Event name                             | Priority |
| ---------------- | -------------------------------------- | -------- |
| `delivered`      | `platform.notification.delivered`      | default  |
| `pressed`        | `platform.notification.pressed`        | discrete |
| `action-pressed` | `platform.notification.action-pressed` | discrete |
| `dismissed`      | `platform.notification.dismissed`      | default  |
| `unknown`        | `platform.notification.unknown`        | default  |

Notification and action identifiers remain callback values; the causal event
records only the semantic name, source, priority, and bounded runtime identity.
The Notify Kit 10 adapter explicitly installs the portable body action
`{ id: "default", launchActivity: "default" }` on Android, so a tap reopens the
application and produces `pressed` without relying on Notify Kit's omission
default. Rich action buttons and background handlers remain outside this
minimal contract.
Background execution, remote push credentials, platform entitlements, and
application routing remain explicit shell responsibilities; this
local-delivery proof does not imply those features.

The wrapper-free adapter is physically qualified on both platforms. Run the
focused signed iPhone Release proof with a connected, unlocked device:

```sh
SOLID_NATIVE_IOS_DESTINATION=<core-device-id> \
SOLID_NATIVE_IOS_TEAM=<development-team-id> \
  pnpm --filter @solid-native/native-e2e ios:notifications:test
```

Its source-map gate requires the application adapter, generated ABI, and this
versioned product adapter exactly once, and rejects every Notify Kit JavaScript
facade source. The device path proves native permission, foreground delivery,
displayed-ID query, an exact content-private event/owner/computation
Solid/Fabric causal commit, cancellation, and non-terminating owner teardown.
On iOS, authorization and display are intentionally separate user-visible
operations: wait until the application is active again after the permission
sheet before calling `display`. An immediate continuation can still observe
UIKit's `Inactive` state, causing Notify Kit to route that delivery as a
background event. The Android physical proof additionally
inspects the operating system's notification content and presses its real body
action; iOS Notification Center inspection is not yet claimed.
