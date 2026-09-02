# `@solid-native/clipboard`

Bounded, privacy-safe text clipboard access for Solid Native applications. The
React Native adapter calls the pinned 0.87 `Clipboard` TurboModule directly
without evaluating `Clipboard.js` or `NativeClipboard.js`.

```ts
import { createReactNativeClipboardService } from "@solid-native/clipboard/react-native";
import { createClipboardController } from "@solid-native/clipboard/solid";

const clipboard = createClipboardController(
  createReactNativeClipboardService(),
);

clipboard.writeText("Rendered by Solid");
const text = await clipboard.readText();
clipboard.clear();
```

Both application writes and native read results are limited to 1 Mi UTF-16
code units before entering the other side of the boundary. Empty text is valid
and `clear()` writes it explicitly.

Reads happen only when application code requests them. A read settlement is a
default-priority causal platform event so dependent Solid computations can be
traced through their commit, Fabric mount, and frame. Clipboard content is
never attached to telemetry. Disposing the current owner rejects every pending
read and disables later reads and writes from that controller.

Run the physical Release gates on attached, unlocked devices with:

```sh
pnpm --filter @solid-native/native-e2e android:clipboard:test

SOLID_NATIVE_IOS_DESTINATION=<core-device-id> \
SOLID_NATIVE_IOS_TEAM=<development-team-id> \
pnpm --filter @solid-native/native-e2e ios:clipboard:test
```

The app writes one private canary that a separate native observer verifies,
then reads a different native-seeded canary through the pinned TurboModule and
traces its exact platform-event, named-owner, and named-computation causes into
the normal-priority Solid commit. The observer independently verifies the
explicit empty-text clear contract. Neither canary may appear in causal
telemetry.

Android uses AndroidX and `ClipboardManager`. iOS uses a second separately
signed, native-only source application so the proof crosses real application
boundaries and accepts Apple's paste privacy sheets. The source archives every
original pasteboard item and representation before seeding, restores them in
XCTest's `defer`, and retains a recovery archive for shell cleanup after an
interrupted test. Success is withheld until terminal surface teardown, source
map and signature checks, restoration, and verified process/application
cleanup.
