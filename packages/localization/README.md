# `@solid-native/localization`

Validated startup locale and effective native layout direction for Solid Native
applications. The React Native adapter calls the pinned 0.87 `I18nManager`
TurboModule directly without evaluating `I18nManager.js` or its generated
JavaScript spec.

```ts
import { getReactNativeLocalizationSnapshot } from "@solid-native/localization/react-native";

const localization = getReactNativeLocalizationSnapshot();
// { localeTag: "de-CH", layoutDirection: "ltr", ... }
```

Android's underscore-separated locale identifier is normalized to a hyphenated
tag. React Native's iOS module omits the identifier, so that platform uses the
Hermes `Intl.DateTimeFormat` locale while retaining native `isRTL` and style
swap policy. Every field is validated and the result is frozen.

This is deliberately a startup snapshot rather than a reactive accessor:
Android and iOS apply locale and RTL configuration during native application
startup, and changing those settings requires a restart. The package does not
expose `forceRTL`, `allowRTL`, or style-swapping mutation as if they updated the
running Fabric surface.

Shipping iOS applications must declare every supported localization, including
at least one RTL localization before natural RTL can activate. Xcode normally
derives `CFBundleLocalizations` from the project's localized resources; projects
that manage the plist directly must provide the equivalent declaration.

React Native 0.87's Android `I18nUtil` consults an arbitrary available locale
when deriving natural RTL. The package-owned Android `SolidNativeSurface`
therefore synchronizes React Native's package-scoped Fabric preferences from the
Activity's effective application locale immediately before surface creation.
This keeps the native Activity, the read-only snapshot, and Yoga direction
aligned without exposing the JavaScript mutation facade.

Run the physical Android Release gate on one attached, unlocked device with:

```sh
pnpm --filter @solid-native/native-e2e android:localization:test
```

The gate uses package-scoped `en-US` and `ar-SA` cold starts without modifying
the device locale or global RTL setting. It independently verifies Activity
configuration, TurboModule snapshot, decor direction, mirrored Fabric child
geometry, style swapping, teardown, and process/package cleanup.

Run the signed physical iPhone Release gate with:

```sh
SOLID_NATIVE_IOS_DESTINATION=<CoreDevice-identifier> \
SOLID_NATIVE_IOS_TEAM=<development-team> \
pnpm --filter @solid-native/native-e2e ios:localization:test
```

XCTest gives only the disposable app process `en-US` and `ar-SA` startup
preferences. It requires Hermes Intl, the direct native `I18nManager` snapshot,
and the physical LTR/RTL Fabric geometry to agree, disposes both cold-started
surfaces without terminating the host process, and removes the signed app.
