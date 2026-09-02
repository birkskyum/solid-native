# `@solid-native/images`

Validated image metadata, prefetch, and cache inspection for Solid Native. The
React Native adapter resolves the pinned 0.87 `ImageLoader` TurboModule directly
without evaluating React Native's platform Image facade or generated JavaScript
specs.

```ts
import { createReactNativeImageService } from "@solid-native/images/react-native";
import { createImageController } from "@solid-native/images/solid";

const images = createImageController(createReactNativeImageService());
const dimensions = await images.getDimensions({
  uri: "https://images.example/hero.png",
  headers: { Authorization: "Bearer …" },
});
await images.prefetch("https://images.example/hero.png");
const cache = await images.queryCache(["https://images.example/hero.png"]);
```

The public service normalizes React Native's incompatible native ABIs: Android
returns an object from `getSize` and requires a signed 32-bit prefetch request
identifier, while iOS returns a width/height tuple and accepts no identifier.
Prefetch handles cancel native work on Android. React Native 0.87 has no iOS
cancellation primitive, so iOS cancellation rejects immediately and ignores the
late native settlement.

URIs, header names and values, query cardinality, native dimensions, prefetch
results, and cache states are bounded and validated. Cache queries preserve
caller order and duplicates while deduplicating native work, and every URI gets
an explicit `memory`, `disk`, `disk/memory`, or `none` result. The Solid
controller rejects pending work on owner disposal and causally traces successful
settlements without recording URIs or request headers.

Run the physical Android Release gate on one attached, unlocked device with:

```sh
pnpm --filter @solid-native/native-e2e android:images:test
```

The gate proves an authenticated dimension request at its local HTTP server,
an initially absent URI becoming natively cached after prefetch, ordered cache
results that do not trigger network work, explicit transport cancellation, and
transport cancellation caused by Solid owner disposal. Dimension, prefetch,
and cache-query settlements must retain their privacy-safe causal Solid commit.
Success is withheld until the Fabric surface stops and the process, APKs, and
temporary `adb reverse` tunnel are gone. iOS remains Release-compiled and
awaits equivalent physical metadata and cache coverage.
