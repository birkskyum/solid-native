# `@solid-native/fabric-host`

This private incubation package adapts the repository's pinned React Native
Fabric and Hermes ABI to the framework-neutral host contract. It owns the
JavaScript-side binding validation, transaction encoding, surface adapter, and
backend compatibility fingerprint. The same package owns the version-pinned
C++/Objective-C++/JNI adapter, CocoaPods target, and Android Gradle/CMake
integration; no Solid runtime source is part of that native boundary.

The package exports a machine-readable
`@solid-native/fabric-host/react-native-boundary` manifest. Repository and
package checks regenerate its effective header, Kotlin, CocoaPods, and CMake
surface from source and require an exact match, so a React Native upgrade has a
small explicit review diff before either native toolchain runs.

The transaction encoder also owns React Native's RawProps color boundary.
Style colors and native color props are converted to the pinned platform
payload before Fabric sees them, including Android's exceptional
`underlineColorAndroid` name (which does not end in `Color`). This keeps
framework integrations from importing React Native's JavaScript component
wrappers merely to obtain their color preprocessing. The encoder takes the
target platform explicitly because Android uses signed 32-bit processed colors
while iOS uses their unsigned representation.

It deliberately does not depend on Solid, the Solid renderer, JSX, owners,
signals, or computations. Framework integrations consume this package through
`@solid-native/host-contract`; `@solid-native/runtime` remains the compatible
Solid application-bootstrap facade.

The package name is literal and provisional. Public naming is independent of
the architectural boundary.

## Framework-neutral startup

Surface readiness belongs to this backend package rather than the Solid
runtime. A framework adapter can therefore use the complete public startup
boundary without importing Solid:

```ts
import {
  createNativeFabricHost,
  getNativeHostBinding,
  waitForNativeSurface,
} from "@solid-native/fabric-host";

const binding = getNativeHostBinding();
await waitForNativeSurface({ binding, timeoutMs: 10_000 });
const host = createNativeFabricHost({ binding, descriptors });
const surface = host.createSurface({ name: "application" });
```

`waitForNativeSurface` validates bounded timeout and polling options and throws
`NativeSurfaceStartupError` when the native shell never transfers ownership.
The Solid runtime re-exports this same primitive; it does not maintain a second
startup implementation.

Surface ownership is leased per native binding, not merely per JavaScript host
object. A second adapter therefore fails before it can allocate overlapping
node IDs or replace the active adapter's event routes. Failed ownership
transfer releases its provisional lease, while successful teardown releases
the lease only after the native shell reports that the surface has stopped.

The same boundary owns `installReactNativeFatalErrorHandler`. It routes fatal
Hermes failures into the package-owned native fallback, leaves recoverable
errors with the previous React Native handler, and restores that handler only
while it still owns the global slot. Framework adapters can use this without a
Solid runtime; Solid's `startNativeApplication` composes it with owner cleanup.

## Hardware proof

The checked-in Android and iOS Release proofs consume this package and
`@solid-native/host-contract` directly. They do not import Solid, the renderer,
runtime, core components, or navigation:

```sh
pnpm --filter @solid-native/native-e2e android:fabric-host:test
pnpm --filter @solid-native/native-e2e ios:fabric-host:test
```

On a connected phone, each proof mounts a native tree from raw host transactions,
receives a physical touchscreen press through Fabric, commits a native text
update, observes the exact mount and next-frame lifecycle events, then deletes
every node and stops the surface. Their source-map gates also reject any
accidental framework source in the Release bundle.
