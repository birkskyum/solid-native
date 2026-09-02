# `@solid-native/runtime`

The TypeScript runtime applies the framework-neutral host contract's capability
and component validation before mounting an application. Its React Native 0.87
integration composes `@solid-native/fabric-host` with the Solid renderer. Fabric
Host implements the same `NativeHost` contract as the in-memory backend; this
package retains the compatible Solid owner and application-bootstrap facade.

On Android, the package-owned surface also resolves the Activity's effective
application locale immediately before Fabric surface creation and synchronizes
React Native 0.87's package-scoped RTL preferences. This contains an upstream
natural-RTL defect—0.87 consults an arbitrary available locale—inside the
version-pinned backend so Activity configuration, `I18nManager` constants, and
Yoga layout agree without a JavaScript mutation facade.

```ts
const report = inspectHost(host, {
  components: ["RootView", "View", "Text"],
  capabilities: ["bubblingEvents"],
});

const app = startApplication(() => App(), host, {
  surface: { name: "main" },
});
```

`startApplication` preserves a synchronous bootstrap for hosts whose surface
cleanup is synchronous. If the initial Solid render fails, it starts background
surface rollback before rethrowing the original error. Use
`await startApplicationAsync(...)` when an asynchronous host requires a
transactional boundary: failure is not reported until native rollback has
settled, and independent render and cleanup failures are retained together.

The first backend is now pinned to React Native 0.87.0 and Hermes
250829098.0.16. Its empty-surface bootstrap, direct Fabric mount, and clone-based
text update run in an iOS simulator without a React component render. JSI
host-contract transport now runs synchronously from Hermes into that surface;
the compiled boundary also routes normalized subscribed events through the
Solid-owned parent graph and reads current-revision layout. Signed physical
iPhone and Pixel Release proofs cover press delivery, signal-driven commits,
measurement, identity reclamation, and empty-surface stop. Both use the
checked-in `apps/native-e2e` shell. The Android JNI installer, Kotlin
`BindingsInstaller`, portable transaction coordinator, and CMake integration
are package-owned under `native/android`. The exported `./android-gradle`
integration configures the installed Kotlin and CMake paths without assuming a
node_modules layout. The package-owned `SolidNativeSurface` now owns empty
surface publication, native UI-worklet handlers, and acknowledged teardown;
the app supplies its ordinary React Native host and Activity callbacks. Android therefore shares the portable
transaction coordinator rather than maintaining a second logical renderer. The React-free
bundle resolves the native `PlatformConstants` TurboModule through React
Native's standard registry, verifies its 0.87.0 fingerprint, and awaits the
platform Linking module's initial-URL promise before mounting. A native
AppState lifecycle event must also reach Hermes before the press proof can
complete. On Pixel, core's platform-event wrapper retains that TurboModule
delivery as the input cause of the exact Solid/Fabric lifecycle commit, mount,
and next frame without recording the lifecycle payload. Those paths now enter
through the validated
`@solid-native/runtime/react-native` platform service rather than application
imports of React Native internals. That service also reads current keyboard
metrics, validates native show/hide geometry, combines both platform listeners
behind one idempotent subscription, and exposes dismissal without leaking React
Native event shapes into portable code. Window dimensions use the same boundary:
the service validates finite logical width, height, display scale, and font scale,
then follows rotation, resizing, and foldable-window changes through one removable
subscription. The same shell registers a TypeScript Codegen spec, mounts its custom
native view through the public component factory/descriptor helpers, and
measures it on both devices. See
[`native/README.md`](native/README.md) and the repository's Fabric spike record.
The package allowlist includes that reviewed native directory alongside the
compiled JavaScript. Repository CI packs the real artifact and requires its
podspec, portable C++ coordinator, iOS JSI binding, Android CMake seam, JNI
installer, Kotlin bridge, exported Gradle integration, and exported iOS podspec
to be present and resolvable before a source-only workspace build can pass.

Android shells that enable the native screen stack extend
`androidx.appcompat.app.AppCompatActivity` and use a no-action-bar AppCompat
theme. The pinned `RNSScreenStackHeaderConfig` installs its platform toolbar
through `setSupportActionBar`; a plain `FragmentActivity` is sufficient for
screens alone but cannot host native stack headers.

The transaction snapshot processes style and direct color props into React
Native's `0xaarrggbb` transport representation, including the Switch facade's
internal false/true track colors. The native coordinator then resolves the
portable Switch descriptor, prop aliases, `valueChange` route, and platform
command name. A controlled rollback is command-only: it advances the renderer
sequence and participates in `flush()`, but correctly produces no structural
Fabric revision or mount lifecycle event.

Ordinary props remain bounded, transport-safe `HostValue` data. Native
components that genuinely require an object identity, such as VisionCamera's
preview output, use a separate direct-prop resource contract:

```ts
const resource = retainOwnedNativeResource(
  binding,
  "vision-camera.preview-output",
  previewOutput,
);

// Valid only as the complete value of one direct native prop.
const previewOutputProp = resource.reference;
```

The binding retains the exact non-array JSI object in a surface/runtime-scoped
registry capped at 64 entries. The transaction transports only a frozen typed
handle and kind; RawProps resolution restores the original object identity.
Nested markers are never resolved, unknown or mismatched handles fail the
commit, and Solid owner cleanup releases the registry entry. Surface handoff
and destroy both reject leaked resources.

Fabric Host's `createNativeHostTransaction(commit, platform)` stamps contract
version 1, applies the platform's signed or unsigned processed-color contract,
and deep-copies the renderer commit into the exact transport-safe envelope
consumed by the native coordinator. `getNativeHostBinding()` verifies the pinned JSI fingerprint,
`readNativeSurfaceInfo()` reads its native-owned surface,
`commitNativeHostTransaction()` snapshots and checks a synchronous commit,
`subscribeToNativeHostCommitLifecycle()` validates exact revision-mount events,
and `measureNativeHostNode()` validates sequence-aware layout results. A
renderer commit's opaque causal operation ID crosses the JSI transaction;
structural commits return their Fabric revision and later report its observed
platform mount, while command-only commits do neither.

Contract version 1 also requires the native binding and its host adapter to
report a stable `android` or `ios` platform identifier. Component facades use
that host-owned fact only where the underlying platform lifecycle genuinely
differs, notably Modal dismissal; applications do not need to import React
Native's `Platform` module.

The adapter also normalizes semantic scheduling where React Native's raw event
category is backend-dependent. In particular, drag start/end are discrete
input boundaries even though React Native 0.87 emits Android
`scrollEndDrag` through the unspecified generic event category; ordinary
`scroll` remains continuous. The dedicated Android VirtualizedList proof caught
and now guards this distinction on a physical Release build.

Application disposal is also an acknowledged platform boundary. The Android
binding requests package-owned `ReactSurface.stop/clear/detach` work on the main
thread. Native work is deactivated immediately, while surface publication is
retained until React Native's bounded asynchronous stop task completes, so the
host keeps the surface in a destroying state and rejects new work until
`getSurfaceInfo()` reports it gone. Consequently, `await app.dispose()` now
means Solid owners and Fabric identities were reclaimed and React Native
completed the stop, rather than only that Android's stop work was queued.

Development runtime replacement is a separate non-terminal boundary. Metro is
configured to reload application modules instead of passing Solid component
exports through React Refresh. When React Native replaces Hermes while retaining
its platform surface, both bindings cancel the retired runtime's native work,
detach its event/mount observers, discard its transaction coordinator graph,
and give the replacement runtime fresh event routing plus node and sequence
identity. This prevents stale Solid owners, worklets, or coordinator nodes from
crossing a reload without stopping the application-owned surface itself.

The backend-specific platform service keeps React Native 0.87 implementation
paths behind one subpath export. It validates the native-module version and
platform once, narrows untrusted initial-URL/AppState/link/window/appearance
payloads, and returns idempotent subscriptions for lifecycle, running-process
links, cross-platform memory warnings, window and color-scheme changes, and
Android hardware Back. Android memory pressure enters through the
package-owned `SolidNativePlatformAndroid` TurboModule because React Native
0.87's Android AppState module does not emit it. It also
validates bounded, scheme-qualified outbound URLs before calling the pinned
Linking TurboModule directly, exposes boolean `canOpenURL`, and opens the
application's system-settings page without evaluating `Linking.js`. It also
addresses `StatusBarManager` through the TurboModule registry and owns a
validated property-merging stack without evaluating React Native's React
`StatusBar` component. The portable factory accepts an injected adapter for
deterministic tests; application bundles use the pinned adapter after
`react-native/setup-env`:

Android applications generated by the CLI forward Activity configuration
changes to `ReactHost`. This is required by React Native's bridgeless host for
system appearance delivery; handling `uiMode` in the manifest without that
callback updates Android resources but leaves Hermes and Solid stale.

```ts
import {
  createAppState,
  createColorScheme,
  createMemoryWarningCount,
  StatusBar,
  createWindowDimensions,
} from "@solid-native/core";
import { getReactNativePlatformServices } from "@solid-native/runtime/react-native";

const platform = getReactNativePlatformServices();
const initialURL = await platform.getInitialURL();
if (await platform.canOpenURL("https://solidjs.com")) {
  await platform.openURL("https://solidjs.com");
}
await platform.openSettings();
const appState = createAppState(platform);
const memoryWarnings = createMemoryWarningCount(platform);
const colorScheme = createColorScheme(platform);
const window = createWindowDimensions(platform);
// appState() is a Solid accessor; its causal native subscription follows the owner.
// memoryWarnings() increments for each native warning on iOS and Android.
// colorScheme() is "light" or "dark" and updates at the same ownership boundary.
// window.width(), height(), scale(), and fontScale() update independently.

platform.setColorSchemeOverride("dark");
platform.setColorSchemeOverride("system"); // Resume following the device setting.

<StatusBar source={platform} barStyle="auto" hidden={false} />;
```

The physical iOS gate builds a signed Release app and posts UIKit's exact
memory-warning notification through a compile-time-only E2E URL after XCTest
observes the owned subscription's initial native output:

```sh
SOLID_NATIVE_IOS_DESTINATION=<CoreDevice-id> \
SOLID_NATIVE_IOS_TEAM=<development-team> \
pnpm --filter @solid-native/native-e2e ios:memory-warning:test
```

It requires the complete UIKit notification → `RCTAppState` → Hermes → Solid
computation → Fabric commit → mount → frame chain and owner teardown. The proof
route is not compiled into ordinary builds. This verifies native delivery on
hardware, not OS-generated pressure or jetsam behavior.

The Android gate uses the generated application's exact `onTrimMemory` entry,
then requires `SolidNativePlatformAndroid` → Hermes → Solid computation → Fabric
commit → mount → frame → teardown on a physical Pixel:

```sh
pnpm --filter @solid-native/native-e2e android:memory-warning:test
```

It injects `RUNNING_CRITICAL` deterministically on the device main thread; it
does not claim to force genuine system-wide low memory. `UI_HIDDEN` remains a
visibility transition and is deliberately not converted into a warning.

```ts
const binding = getNativeHostBinding();
const app = await startNativeApplication(() => App(), {
  binding,
  descriptors: CORE_COMPONENT_DESCRIPTORS,
  surface: { name: "main" },
});
```

`startNativeApplication` waits at most ten seconds for the package-owned shell
to publish its empty surface, then creates the pinned Fabric adapter and mounts
the Solid root. The timeout and polling interval are bounded and configurable;
a failed native launch cannot leave an unbounded JavaScript timer behind. The
bootstrap uses the renderer's asynchronous mount boundary, so root allocation,
initial-prop validation, subscription installation, or a synchronous initial
Solid render failure is not reported until the claimed native surface has
completed teardown and released its host lease. If construction and rollback
both fail, the rejection retains both causes.

Normal shutdown follows the same rule. Event and mount-lifecycle subscriptions
are detached independently, and a failure in either does not bypass the native
surface stop. Multiple distinct cleanup failures are returned as one
`AggregateError`; the same underlying native failure observed at more than one
layer retains its original identity.

The native binding also exposes a bounded terminal-error handoff. The runtime
uses it automatically when a Fabric commit becomes permanently failed.
`startNativeApplication` also installs the `ErrorUtils` bridge for fatal Hermes
exceptions by default and owns it for exactly the returned application's
lifetime. Failed startup and `dispose()` both restore the preceding global
handler, without overwriting a newer owner. Specialized shells may pass
`fatalErrorHandler: false`; custom bootstrap code can still call
`installReactNativeFatalErrorHandler({ binding })` directly. A successful
handoff stops the live surface and lets the package-owned shell render its
dependency-free fallback; non-fatal errors remain with the preceding React
Native handler. If native takeover itself fails, the bridge synchronously
invokes the preceding platform fatal handler. Only a sanitized error name and
message cross the binding—never a stack or arbitrary thrown object—and Release
UI remains generic.

The current global is deliberately private (`__solidNativeHost`) and exposes
only surface info, terminal-error reporting, event and commit-lifecycle
attachment, bounded native resource retain/release, measurement, commit, and
guarded destroy primitives.
`NativeFabricHost` is the public-contract adapter for the one empty surface
handed off by the application shell. It owns JavaScript node allocation and
event fan-out, rejects a dirty ownership handoff, and refuses teardown while
logical nodes remain. After the renderer deletes its logical tree, the adapter
waits for the retiring Fabric revision to release every JSI instance identity
before it crosses the guarded destroy boundary. Native surface creation is
still shell-owned. React Native 0.87 does not install `RN$stopSurface` for
`startEmptySurface`, so the pinned binding supplies the no-op React half of
that stop contract only when the global is absent.

## Intended scope

- Start Hermes and install JSI bindings
- Create/destroy application surfaces
- Implement the host contract over selected React Native/Fabric internals
- Coordinate JavaScript, commit/layout, and UI threads
- Register core component descriptors
- Bootstrap TurboModules and generated native components
- Report runtime fingerprints and capabilities
- Isolate all React Native-version-specific code

The first feasibility experiment belongs here. No API should be declared stable until native nodes can be mounted and updated without React rendering the application.

## Native causal-debug transport

Debuggable Android and iOS applications can expose one bounded causal snapshot
through the package-owned `SolidNativeDebug` TurboModule. React Native 0.87
Codegen owns its typed `onSnapshotRequest` EventEmitter and readiness method.
On Android it generates `NativeSolidNativeDebugSpec` in the
`dev.solidnative.runtime` Java package and `SolidNativePackage()` must be in the
host package list. On iOS, the app Codegen provider maps `SolidNativeDebug` to
`SolidNativeDebugModule`, while AppDelegate routes CoreDevice payload URLs to
`SolidNativeDebugRequest`. The CLI scaffold installs all of these contracts.

```ts
import {
  createCausalTelemetry,
  createCausalTimeline,
} from "@solid-native/observability";
import { createReactNativeCausalDebugTransport } from "@solid-native/runtime/react-native-causal-debug";
import { createDevelopmentSolidDiagnosticsController } from "@solid-native/devtools/solid-diagnostics";

const timeline = createCausalTimeline({ capacity: 2_000 });
const telemetry = createCausalTelemetry({ sink: timeline.sink });
createReactNativeCausalDebugTransport(timeline, {
  solidDiagnostics: createDevelopmentSolidDiagnosticsController(),
});
```

Pass `telemetry` to `startNativeApplication`. Android registers a non-exported
receiver; iOS accepts a bundle-targeted CoreDevice payload URL. Both transports
accept only bounded nonce-bound requests while the typed Hermes listener is
ready and atomically write the matching response into app-private cache
storage. Android non-debuggable builds and ordinary iOS store Release builds
are inert. Neither platform opens a socket, polls in the background, nor
uploads telemetry.

The same nonce mailbox carries versioned `causal-snapshot`,
`solid-diagnostics-begin`, and `solid-diagnostics-end` operations. Metro maps
the diagnostics controller to Solid's development runtime only in development
bundles; production receives an inert shim. A diagnostics response is capped,
strictly parsed by the CLI, and intentionally excludes values, messages,
stacks, owner IDs, props, text, and rendered content.
