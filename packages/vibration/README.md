# `@solid-native/vibration`

Bounded, owner-safe vibration for Solid Native applications. The React Native
adapter calls the pinned 0.87 `Vibration` TurboModule directly without loading
`Libraries/Vibration/Vibration.js` or its timer state.

```ts
import { createReactNativeVibrationService } from "@solid-native/vibration/react-native";
import { createVibrationController } from "@solid-native/vibration/solid";

const vibration = createVibrationController(
  createReactNativeVibrationService(),
);

vibration.vibrate({ durationMs: 80 });
vibration.vibrate({
  pattern: [
    { delayMs: 0, durationMs: 60 },
    { delayMs: 90, durationMs: 120 },
  ],
  repeat: true,
});
```

Every request returns a revocable lease. Starting a new request cancels the
previous lease, but cancelling a stale lease cannot stop newer feedback from a
different Solid owner. Owner disposal cancels only that owner's current lease,
so repeating native patterns and iOS scheduling timers cannot survive a screen.

Durations, segment counts, and total cycle time are bounded before crossing the
native boundary. Android receives one native waveform. iOS hardware exposes a
fixed system pulse, so the adapter schedules pulse timing while treating each
requested duration as spacing before the following segment. Cancellation can
prevent future iOS pulses but cannot interrupt a system pulse already playing.

Android applications must declare:

```xml
<uses-permission android:name="android.permission.VIBRATE" />
```

Run the Android physical Release gate on one attached, unlocked device with:

```sh
pnpm --filter @solid-native/native-e2e android:vibration:test
```

The gate temporarily enables and always restores the device's vibration
setting. It requires Android's vibrator service to report a live, package-owned
infinite waveform with the exact normalized `0/80/160/140 ms` segments and
repeat index, proves explicit cancellation, then proves Solid owner disposal
cancels a restarted waveform. The source map must contain only the direct
owner-safe seam, and success is withheld until surface teardown, preference
restoration, and process/package cleanup. iOS remains Release-compiled and
awaits physical scheduled-pulse timing coverage.
