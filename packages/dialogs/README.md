# `@solid-native/dialogs`

This package exposes validated, promise-based native alerts without evaluating
React Native's `Alert.js` or mounting a React component tree. It has three
deliberately separate layers:

- `@solid-native/dialogs` is the framework-neutral request/result contract and
  adapter validator.
- `@solid-native/dialogs/react-native` drives React Native 0.87's pinned
  `DialogManagerAndroid` and `AlertManager` TurboModules directly.
- `@solid-native/dialogs/solid` binds pending results to the current Solid owner
  and records button presses and dismissals as privacy-safe causal inputs.

```ts
import { createReactNativeAlertService } from "@solid-native/dialogs/react-native";
import { createAlertController } from "@solid-native/dialogs/solid";

const alerts = createAlertController(createReactNativeAlertService());
const result = await alerts.show({
  title: "Remove download?",
  message: "The local file will be deleted.",
  buttons: [
    { id: "cancel", text: "Cancel", style: "cancel" },
    { id: "remove", text: "Remove", style: "destructive", preferred: true },
  ],
});

if (result.action === "button" && result.buttonId === "remove") {
  // Perform the application action.
}
```

Applications receive stable button identities rather than platform indices.
Android supports up to three buttons and can report Back/outside-tap dismissal
when `cancelable` is enabled. iOS supports the bounded package limit of 32
buttons plus one cancel, destructive, and preferred button and explicit
appearance metadata.
Button style metadata has a visual effect only where the native platform
supports it.

One service permits one native alert at a time. A concurrent call rejects with
`AlertPresentationInProgressError` instead of silently replacing an Android
dialog or producing a platform-dependent presentation stack. The React Native
factory returns one process-local service so repeated factory calls preserve
that invariant.

The Solid controller requires a current Solid owner and rejects still-pending results with
`AlertOwnerDisposedError` when its owner is disposed. Native alert modules do
not expose a public programmatic dismissal operation, so owner disposal stops
delivery to dead application state but does not claim to remove an already
presented operating-system alert. Dialog titles, messages, button text, and
button identities are never attached to causal telemetry.

Run the Android physical Release gate on one attached, unlocked device with:

```sh
pnpm --filter @solid-native/native-e2e android:alert:test
```

The gate presents two real operating-system dialogs on the Pixel: it taps the
native destructive button, sends Android system Back to the cancellable dialog,
and requires the exact stable results to drive user-blocking Solid commits.
Android themes may capitalize visible button text, so instrumentation compares
that native label case-insensitively while still requiring the application text
and button identity. The source map must contain the complete direct
TurboModule/Solid seam without `Alert.js`, private content must stay out of
telemetry, and the surface, process, and disposable packages must be gone before
success is published. The iOS implementation remains Release-compiled and
awaits an equivalent physical UIKit gate.
