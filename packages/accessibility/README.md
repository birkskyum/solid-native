# `@solid-native/accessibility`

This package exposes bounded native accessibility preferences and announcements
without evaluating React Native's `AccessibilityInfo.js` facade. Its three
layers remain explicit:

- `@solid-native/accessibility` validates framework-neutral preferences,
  changes, announcements, subscriptions, and recommended timeouts.
- `@solid-native/accessibility/react-native` drives React Native 0.87's pinned
  `AccessibilityInfo` Android and `AccessibilityManager` iOS TurboModules plus
  the lower-level device event emitter.
- `@solid-native/accessibility/solid` owns asynchronous loading and the native
  subscription, exposing independently memoized preference accessors.

```ts
import { createReactNativeAccessibilityService } from "@solid-native/accessibility/react-native";
import { createAccessibilityPreferences } from "@solid-native/accessibility/solid";
import { getReactNativePlatformServices } from "@solid-native/runtime/react-native";

const accessibility = createAccessibilityPreferences(
  createReactNativeAccessibilityService(),
  {
    appState: getReactNativePlatformServices(),
    onError: reportError,
  },
);

await accessibility.ready;

// Each accessor updates downstream computations only when its value changes.
if (accessibility.reduceMotionEnabled()) {
  // Select a non-motion transition or update an animation input.
}

accessibility.announce({
  message: "Draft saved",
  queue: true,
  priority: "default",
});
```

The same `reduceMotionEnabled` accessor can be passed directly as the
`reduceMotion` option to `createNativeViewAnimation`; no effect or duplicated
preference signal is required.

The common accessors cover screen-reader, reduced-motion, inverted-color, and
grayscale state. The discriminated Android controller adds high-text-contrast
and general accessibility-service state. The iOS controller adds bold text,
darker system colors, reduced transparency, and cross-fade preference. iOS does
not publish a cross-fade change event through this native ABI. Passing the
validated platform service as `appState` refreshes the complete snapshot once
after each inactive-to-active transition. Applications can also call the
imperative `refresh()` action explicitly.

The initial query begins after Solid component construction and is exposed as
`ready`; this avoids writing inside a Solid 2 owned computation. Native changes
that race the initial query remain authoritative. Later `refresh()` calls are
latest-wins actions, and late native callbacks are ignored after owner disposal.

Preference changes enter causal observability only as
`platform.accessibility.preference`. Preference names and values, announcement
text, native errors, and timeout values are not telemetry attributes. Android
does not support announcement queue or priority options, and iOS returns the
original timeout because its native manager has no recommended-timeout API.

Run the physical Android Release gate on one attached, unlocked device with:

```sh
pnpm --filter @solid-native/native-e2e android:accessibility:test
```

The gate changes reduced-motion and high-text-contrast settings away from and
back to their original values, proving four direct native deliveries through
the corresponding fine-grained Solid accessors and Fabric commits. Each commit
must preserve the privacy-safe `platform.accessibility.preference` cause and
named output computation without recording preference identity or value.
Android's own UI automation independently captures the exact native
announcement event after a touchscreen press. The run also verifies the
recommended timeout, refresh, owner teardown, setting restoration, source-map
policy, and process/package cleanup. It never enables a user accessibility
service. iOS remains Release-compiled and awaits equivalent physical coverage.
