# `@solid-native/sharing`

Validated system sharing for Solid Native applications. The package calls the
pinned React Native 0.87 native modules directly and does not evaluate
`Libraries/Share/Share.js`.

```ts
import { createReactNativeShareService } from "@solid-native/sharing/react-native";
import { createShareController } from "@solid-native/sharing/solid";

const sharing = createShareController(createReactNativeShareService());
const result = await sharing.share({
  message: "A native app rendered by Solid",
  url: "https://solid-native.dev",
  subject: "Solid Native",
});
```

The result is deliberately truthful about the native contract:

- Android returns `{ action: "presented" }` when it has launched the chooser.
  Android's built-in module cannot tell whether the user later completed a
  share.
- iOS returns `{ action: "completed", activityType? }` or
  `{ action: "dismissed" }`.

On Android, a separate URL is appended to the message so URL-only and
message-plus-URL requests work consistently instead of being silently dropped
by React Native's facade. On iOS, message and URL remain separate activity
items.

The package bounds all strings, validates URLs before native presentation,
rejects overlapping sheets, and validates every native settlement. The Solid
controller rejects pending work with `ShareOwnerDisposedError` when its owner
is disposed. Settlements enter observability as privacy-safe causal event names;
message, URL, subject, and activity type are never attached to causal metadata.

Run the Android physical Release gate on one attached, unlocked device with:

```sh
pnpm --filter @solid-native/native-e2e android:sharing:test
```

The gate opens two real Pixel sharesheets and physically selects a temporary
receiver contained only in the instrumentation APK. The receiver verifies the
actual Android `ACTION_SEND` boundary for message-plus-URL with subject and for
URL-only input; safe result labels cross back into the application, while the
private payload never enters telemetry or logs. Both Android `presented`
settlements must produce causal user-blocking Solid commits. The direct
TurboModule seam must pass its facade-rejecting source-map policy, and success
is withheld until surface teardown and app/test process and package cleanup are
complete. iOS remains Release-compiled and awaits physical activity-sheet
promotion.
