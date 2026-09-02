# React Native compatibility strategy

React Native compatibility is not one binary claim.

## Compatibility levels

### JavaScript utilities

Framework-neutral JavaScript packages should generally work if their runtime assumptions are available.

### TurboModules

Native modules are the highest-value compatibility target. If the Solid Native runtime preserves the relevant JSI/TurboModule and codegen contracts, many modules may be reusable with a Solid-facing TypeScript wrapper.

The first such boundary is `@solid-native/runtime/react-native`. It contains the
pinned React Native 0.87 implementation imports for PlatformConstants, Linking,
AppState, Appearance, Dimensions, and BackHandler; validates their version and
untrusted payloads; and exposes framework-owned subscriptions with idempotent cleanup. It is evidence
for the compatibility strategy, not yet a claim that arbitrary TurboModules are
portable without a typed Solid-facing adapter. Core's `createAppState` is the
first Solid-facing projection: a fine-grained accessor whose native listener is
disposed with its reactive owner. `createMemoryWarningCount` directly owns the
pinned iOS AppState module's payload-free `memoryWarning` subscription and the
package-owned Android `SolidNativePlatformAndroid` event as one causal
monotonic count.
The generated Android shell explicitly forwards `Application.onTrimMemory` and
`onLowMemory`, excluding the non-pressure `UI_HIDDEN` level. Dedicated Release
device runners inject UIKit's exact notification on iPhone and the exact
running-critical Application callback on Pixel, then require the complete native
event, Solid computation, Fabric commit, frame, and teardown chain. These prove
native delivery on hardware, not OS-generated system-wide pressure, jetsam, or
process killing.
`createWindowDimensions` applies the same
ownership and causal boundary to rotation, resize, and foldable-window changes,
with independently tracked width, height, display scale, and font scale.
`createColorScheme` projects Appearance into a `"light" | "dark"` accessor,
suppresses duplicate deliveries, and binds its privacy-safe causal input and
native subscription to the current Solid owner. The service can also override
the application appearance and resume following the system preference.
The Pixel Release gate now proves portrait-to-landscape-to-portrait dimensions
and dark/light system-appearance changes against Android's independent native
configuration. Each of the four deliveries must retain its direct platform
event and named Solid computation in the exact normal-priority Fabric commit,
without exporting metric or appearance values. That gate caught the custom
Android shell omitting React Native's required configuration callback;
checked-in and newly generated Activities now forward
`onConfigurationChanged` to `ReactHost`. The same entrypoint is generic-iOS
Release compiled; physical iPhone delivery remains separate.
Core's zero-output `StatusBar` component uses the same service as an
owner-bound, property-merging native configuration stack. Nested Solid owners
can override style or visibility independently, automatic icon contrast
follows Appearance, and cleanup restores the next live entry. The backend
addresses `StatusBarManager` through the TurboModule registry instead of
evaluating React Native's React component. Generated iOS applications carry the
native manager's required `UIViewControllerBasedStatusBarAppearance=false`
setting. Physical Release gates now cover the complete child mount, light-icon
override, hide, parent restoration, and non-terminating teardown sequence on
both platforms. Android reads `WindowInsetsController` directly; iPhone XCTest
distinguishes dark, light, and absent system glyphs from physical screenshots
and requires each owner transition to retain its native press and named Solid
computation in the Fabric commit.
The same service calls the pinned native Linking TurboModule directly for
bounded, scheme-qualified `canOpenURL`/`openURL` requests and the application's
system-settings page. Boolean capability results are treated as untrusted
native data; outgoing URLs are operational inputs and are never telemetry
attributes. Physical Pixel and signed-iPhone Release runs resolve and open each
app's own registered URL, observe the operating system deliver it back to the
existing process and Hermes listener, and require the resulting owner-bound
Solid accessor to retain its private platform event through a named computation
and normal-priority Fabric commit. Each separately opens the real app-specific
Settings page, verifies the application label, returns to the same live process
with reactive state intact, and performs terminal surface teardown. Android
also removes both APKs. The source-map gate requires the reviewed TurboModule
registry/emitter seam while rejecting `Linking.js` and the higher-level
navigation package on both platforms.

`@solid-native/dialogs/react-native` similarly addresses the pinned React
Native 0.87 `DialogManagerAndroid` and `AlertManager` TurboModules directly. It
does not evaluate `Alert.js`. The framework-neutral package validates bounded
titles, messages, button identities, platform button limits, cancellation, and
untrusted native results. `@solid-native/dialogs/solid` rejects pending results
when their owner is disposed and turns button/dismissal delivery into discrete,
privacy-safe causal inputs; dialog content and button identities are not
telemetry attributes. React Native 0.87's Objective-C implementation returns
the configured button key as an `NSString` while its JavaScript spec declares a
number; the direct adapter accepts only bounded canonical decimal strings or
safe integers and rejects malformed or out-of-range values. Exact Pixel and
signed-iPhone Release gates pass facade-rejecting source-map policies and the
real platform UI. Android proves destructive selection and system-Back
dismissal. iOS proves destructive and cancel-styled UIKit button identities.
Both require the privacy-safe platform event and named Solid computation in the
user-blocking Fabric commit before non-terminating owner teardown.

`@solid-native/sharing/react-native` calls React Native 0.87's Android
`ShareModule` and iOS `ActionSheetManager` TurboModules directly without
evaluating `Share.js`, `NativeShareModule.js`, `ActionSheetIOS.js`, or
`NativeActionSheetManager.js`. The framework-neutral service bounds text and
subjects, requires scheme-qualified control-free URLs, rejects overlapping
presentations, and validates untrusted results. It also fixes the Android
facade's URL loss by appending URL content to the native text payload. Results
retain the real platform semantics: Android reports chooser `presented`, while
iOS reports `completed` with an optional activity type or `dismissed`.
`@solid-native/sharing/solid` owns pending settlements and gives those three
results distinct discrete causal names without recording the message, URL,
subject, or activity type. Exact Release gates on a Pixel and signed iPhone pass
their facade-rejecting source-map policies and exercise the real platform UI.
Android instrumentation selects an isolated receiver and verifies the exact
payload at the receiving-application boundary. iOS XCTest selects UIKit's Copy
activity for `completed`, dismisses a second popover for `dismissed`, and proves
both results flow through their platform event, named Solid computation, and
user-blocking Fabric commit before non-terminating owner teardown.

`@solid-native/vibration/react-native` calls the pinned cross-platform
`Vibration` TurboModule without evaluating React Native's `Vibration.js` or
`NativeVibration.js`. The portable contract uses explicit silence/duration
segments and bounds individual durations, segment count, and total cycle time.
Android receives one native waveform. Because iOS exposes only a fixed system
pulse, the adapter owns its pulse scheduler and cancels every pending timer.
The framework-neutral service issues revocable process-wide leases: starting
new feedback invalidates the old lease, so disposal of an older Solid owner
cannot cancel feedback started by a newer owner. The exact Android Release app
passes a facade-rejecting source-map gate and declares the required VIBRATE
permission; a code-signing-free generic iOS Release app compiles the same
owner-cleanup path. Physical vibration timing remains a separate device gate.

`@solid-native/clipboard/react-native` calls the pinned cross-platform
`Clipboard` TurboModule without evaluating React Native's deprecated
`Clipboard.js`, its `NativeClipboard.js` re-export, or the underlying generated
JavaScript spec. Application writes and untrusted native read settlements are
bounded to 1 Mi UTF-16 code units. Reads occur only after an explicit
application request. Their settlements are owned by the current Solid owner
and become default-priority causal events without placing clipboard text in
telemetry. Disposal rejects every pending read and disables later access from
that controller. The exact Android and signed iPhone Release apps pass the
facade-rejecting source-map gate and physical read/write/clear proof. AndroidX
observes the Android OS boundary; on iOS, a second signed native-only app
archives and restores the complete pasteboard while independently seeding and
observing private canaries through Apple's real cross-application paste UI.
Both platforms require the read commit's exact platform-event, named-owner,
and named-computation causes while keeping clipboard content out of telemetry.

`@solid-native/secure-storage/react-native` resolves the exact
`RNKeychainManager` native module shipped by `react-native-keychain` 10.0.0
without evaluating that package's `src/index.ts`, runtime enums, or built
JavaScript facades. This dependency is an explicit legacy-native exception: it
declares `RNKeychainSpec`, but its published `src` directory contains no
discoverable `Native*` spec and React Native Codegen emits an empty schema.
The package-owned Fabric Host explicitly enables React Native 0.87's
bridgeless legacy-module interop before constructing `RCTHost`, matching the
ordering in that release's standard root factory. The registry therefore
reaches the linked module through the legacy fallback rather than a generated
TurboModule proxy. The versioned adapter validates the complete
read/write/reset ABI, selected service, account marker, storage result, and
encoded value before exposing the portable contract.
Defaults disable iCloud synchronization, select device-only unlocked access on
iOS, and require at least software-backed Android Keystore storage. Solid owns
successful read, write, and delete settlements as causal platform events while
keys and values remain absent from telemetry. Physical Pixel and signed iPhone
Release gates store, restore, delete, verify causal privacy, and complete
non-terminating teardown through the same entrypoint. Android independently
checks its non-exportable Keystore key and encrypted DataStore bytes; iOS
terminates and recreates Hermes, Solid, and `RCTHost` before restoring the exact
Keychain value. Both bundle gates reject every React-facing keychain facade.

`@solid-native/localization/react-native` reads the pinned cross-platform
`I18nManager` TurboModule directly without evaluating `I18nManager.js`, its
native re-export, or the generated JavaScript spec. It validates and freezes
the effective native RTL direction and left/right style-swap policy. Android's
native underscore-separated locale identifier is normalized to a hyphenated
tag; iOS, whose React Native module omits the locale identifier, uses Hermes
`Intl.DateTimeFormat` for the tag. The API is intentionally a startup snapshot:
native locale and RTL changes require application restart, so it does not
expose misleading reactive or runtime mutation controls. The exact Android and
signed-iPhone Release apps pass a facade-rejecting source-map gate. The Pixel
gate cold-starts package-only `en-US` and `ar-SA` overrides and proves the
Activity configuration, native decor direction, TurboModule snapshot, style
policy, and physical Fabric child ordering agree without changing device-wide
settings. That gate exposed React Native 0.87's natural-RTL lookup against an
arbitrary available locale. The package-owned Android surface contains the
defect by synchronizing the Activity's effective locale into RN's package-scoped
preferences before Fabric surface creation. The iPhone gate declares the two
bundle localizations, applies the same locales only to two disposable cold
starts, and requires Hermes Intl, the native snapshot, and mirrored Fabric
geometry to agree before non-terminating teardown and signed-app removal.

`@solid-native/accessibility/react-native` addresses the pinned Android
`AccessibilityInfo` and iOS `AccessibilityManager` TurboModules plus the
low-level device event emitter without evaluating React Native's
`AccessibilityInfo.js`. Its framework-neutral service validates complete
platform preference snapshots, change events, bounded announcements, and
recommended timeouts. The Solid controller starts its asynchronous query after
component construction, owns subscription cleanup, exposes independently
memoized preference accessors, and preserves a native change that races a
query. When given the validated platform service, it refreshes once after each
inactive-to-active transition so iOS preferences without change events do not
remain stale. Preference values and announcement content never become causal
telemetry attributes. The Pixel Release gate now toggles reduced motion and
high text contrast away from and back to their original device values. It
proves all four direct native deliveries through their fine-grained Solid
outputs and privacy-safe causal Fabric commits, captures the exact operating-
system announcement event through Android UI automation, verifies timeout and
refresh behavior, and restores the settings before removing both APKs. A
code-signing-free generic iOS Release app compiles the same entrypoint; physical
iOS preference changes, announcements, and teardown remain open.
The animation session can pull `reduceMotionEnabled` directly: target-based
drivers validate but resolve immediately, explicit decay is suppressed, and
direct pan tracking omits release inertia.

Navigation's owner-bound adapter also enters
hardware Back and live-Linking deliveries as privacy-safe platform-event
operations. A Pixel Release run proves the blocker-mediated Back and live-URL paths
through exact Fabric commit, mount, and next-frame chains without recording the
URL. The Back binding also preserves the native synchronous boolean while a
bounded delivery controller carries the event and discrete priority through
asynchronous blocker settlement; the denied-then-allowed Pixel path is physical.

The first external community package proof is
`@react-native-async-storage/async-storage` 3.1.1. Ordinary React Native
autolinking discovers it, Android consumes its packaged Maven artifacts, and
iOS CocoaPods generates and links `AsyncStorageSpec`. The native E2E app checks
in a React-free raw binding generated from the dependency's own spec, validates
the real callable surface through its injected registry resolver, and hands
only the three reviewed methods to `@solid-native/storage/async-storage-3`.
The portable package has no AsyncStorage JavaScript dependency. Both resolution
and adapter construction remain
behind the explicit resource gate, so ordinary launches only load the pure
frozen descriptor. Physical Pixel Release runs round-trip and remove a
SQLite-backed value, flush and decode the newest durable single-stack
navigation snapshot, and separately load then replace URL-competing
single-stack and native-tabs snapshots. Dedicated runners flush each two-entry
history, terminate the app, verify its process is gone, and start an ordinary
no-URL launch under a different PID. Each restored detail preloads its nearest
root and returns through real Android system Back or an iPhone left-edge
interactive pop. Their cold-link phases
require the URL-discarded value to be absent before persistence setup, then
read, decode, validate, and remove the final state through the same native
adapter. This automates both single-stack and native-tabs process restoration
on Pixel and iPhone for the bounded one-entry preload path.
The complete signed iPhone Release run does exercise the same native adapter in
Hermes, round-trip and remove its SQLite-backed value, and flush then decode the
current durable single-stack navigation snapshot. This is one pinned package
result, not a blanket compatibility claim.

Compatibility also includes operational behavior. AsyncStorage 3.1.1 ships a
Kotlin/Native `SharedAsyncStorage` framework on iOS. A same-build physical
iPhone isolation test found that eagerly constructing its adapter left 12–15
threads and about 19.09 interrupt wakeups per second while the exhaustive shell
was untouched; deferring only storage construction reduced that shell to 5–7
threads and about 0.08 wakeups per second. The exhaustive interactive harness
therefore loads storage, Notify Kit, and VisionCamera only after its explicit
intensive-proof gate. Dedicated process-restoration targets still initialize
storage before their first mount because restoration is the behavior under
test. Short idle samples remain diagnostic evidence, not a general energy or
leak classification.

The second external result deliberately exercises a different shape. The
maintained `react-native-notify-kit` 10.5.0 fork is New-Architecture-only and
brings a Codegen TurboModule plus Android services, receivers, a provider,
runtime permission, native foreground events, and iOS notification code. The
CLI now audits its actual `NotifeeSpec` and emits the 48-method
`NotifeeApiModule` ABI into the application's checked-in React-free binding.
The app resolves that generated module and injects React Native's low-level
`NativeEventEmitter` into `@solid-native/notifications/notify-kit-10`. That
versioned product adapter exposes only the seven reviewed native operations and
translates them into bounded permission, channel, notification, event, and
cancellation values without evaluating Notify Kit's JavaScript facade;
`@solid-native/notifications/solid` exposes the latest foreground event as a
fine-grained accessor disposed with its owner, including when the adapter is
loaded lazily. Delivered, pressed, action-pressed, dismissed, and unknown inputs
have stable causal event names; user actions are discrete while delivery and
lifecycle observations use default priority. A physical Pixel test grants the
real Android permission, requires `NotificationManager` to expose the expected
OS-visible title/body, and requires `platform.notification.delivered`, the root
owner, and `platform.notification.output` to be the exact causes of its normal
commit, mount, and next frame without recording the notification ID. It also
opens the real notification shade, taps the adapter's explicitly pinned default
body action, and requires the resulting discrete `platform.notification.pressed`
event to cause its user-blocking Solid/Fabric chain before native cancellation.
CocoaPods generates `NotifeeSpec`. The fresh Pixel Release map contains the
application adapter, generated binding, and versioned product adapter exactly
once and contains no source from `node_modules/react-native-notify-kit`; the
complete physical proof passes on that bundle. A fresh signed iPhone Release
target applies the same exact source-map inclusion and facade-exclusion policy,
handles the first-install SpringBoard permission action, waits for the
authorized result to render after the application is active again, and only
then performs display as a second physical operation. That separation is a
required iOS lifecycle invariant: displaying from the permission promise's
immediate continuation can race the `Inactive` to `Active` transition and make
Notify Kit route the delivery onto its background channel. The proof then
requires the native foreground delivery event plus displayed-ID query. The
event's default priority, root owner, and named Solid computation must be the
exact three private causes of the normal Fabric commit before native
cancellation and non-terminating owner teardown. This promotes the iOS module seam to
`device-verified`; it does not inspect Notification Center content or press the
notification as Android does. Remote push, background execution, and rich
notification actions are not claimed by either local delivery proof. The
archived upstream Notifee repository itself recommends the
[maintained fork](https://github.com/marcocrupi/react-native-notify-kit).

The third external result exercises Nitro HybridObjects instead of a Codegen
TurboModule. `react-native-vision-camera` 5.2.2 exposes an imperative camera
factory, outputs, controllers, and sessions beneath its React conveniences.
`@solid-native/camera/react-native` drives that API directly, maps permissions
and device metadata into bounded portable values, configures preview plus a
small JPEG photo output so CameraX has a real readiness path before the preview
surface mounts, captures through that same session, and waits for native
session readiness rather than treating lifecycle activation as hardware
readiness.
`@solid-native/camera/solid` binds asynchronous opening, session events,
idempotent stop, and cleanup to the current Solid owner. It invokes no
VisionCamera hook and renders no React component tree.
The adapter now installs the pinned NitroModules TurboModule through the direct
React Native registry and asks its validated proxy only for `CameraFactory`.
The Release source-map gate rejects the root `react-native`, VisionCamera, and
NitroModules barrels plus VisionCamera hooks and its React `Camera` component;
type-only references do not become bundle dependencies.

Physical Pixel instrumentation grants the actual camera permission and uses
Android's `CameraManager.AvailabilityCallback` as an independent OS assertion:
a camera available before launch must become unavailable while the native
session owns it and available again after Solid root disposal. The same run
mounts VisionCamera's generated `PreviewView` directly from Solid. A bounded
runtime registry retains the exact preview-output HybridObject, transports only
a typed handle through the transaction, and restores that identity for the
direct Fabric prop. Instrumentation requires the shown positive-size native
view's CameraX stream state to become `STREAMING`, rather than trusting a
JavaScript marker. It then captures a real JPEG, validates its temporary path
and positive geometry, disposes the in-memory Nitro photo, and requires the
portable result to cause its own Solid/Fabric commit. On Pixel, that commit must
retain exactly the bounded capture task, root owner, and named camera-output
computation through its matching mount and next frame without exporting photo
metadata. Session startup and typed PreviewView publication independently retain
the same three-part structure under a bounded preview task, without exporting
the Nitro resource identity. Preview attachment then produces a second real
CameraX `started` callback. Its privacy-safe platform event, root owner, and
named session output are the exact causes of a separate normal-priority commit,
mount, and frame. The iOS pod graph for
VisionCamera 5.2.2, NitroModules 0.36.5, and NitroImage 0.15.1 also runs in the
signed physical-phone Release app and XCTest runner. It grants camera
permission, enumerates a back camera, starts the native session, mounts the
generated preview, captures a real JPEG with positive bounded metadata, and
stops the session during Solid root teardown.

This preview-and-photo claim is deliberately narrow. Ordinary public props still
accept only transport-safe `HostValue`; an opaque resource marker is valid only
as the complete value of one direct native prop and has deterministic Solid
ownership. The capture API returns bounded metadata and a temporary filesystem
path, not a Nitro object. Video, frame processing, callbacks, interruption
behavior, durable media persistence, and independent iOS operating-system
assertions for streaming and release require their own API and lifetime gates.

Compatibility must be tested per supported React Native release line. Notify
Kit, for example, imports React Native's `AppRegistry`, `AppState`, and
`Platform`; its headless-task registration works with the React-free shell, but
the Solid-facing adapter intentionally excludes those implementation details.
Other packages may assume initialization that the shell does not provide.

### Fabric Native Components

Native component implementations and generated descriptors may be reusable.
Their JavaScript React wrappers are not. `@solid-native/codegen` now validates
the pinned React Native schema and deterministically emits typed Solid component
factories, prop contracts, native command shims, and deeply frozen renderer host
descriptors. React Native Codegen still owns the generated
C++/Objective-C++/Java/Kotlin ABI, so this reuses the New Architecture contract
without putting a hidden React tree in the application. The native E2E app
regenerates one combined module from its checked-in component spec and the
explicitly selected AsyncStorage dependency spec, using the same fail-closed
CLI plan exposed to applications, and fails CI if it drifts.

CLI output includes a frozen path-free provenance manifest and deterministic
binding SHA-256 over the emitted source plus package/library/version inputs.
The E2E shell validates it before the intensive resource gate so compatibility
identity itself does not initialize a dependency TurboModule.

The first external native-component reuse that ships as a core facade is
`react-native-safe-area-context` 5.8.1. Solid Native autolinks its generated
`RNCSafeAreaProvider` and `RNCSafeAreaView` implementations and addresses those
exact Fabric component names through the host descriptor catalog. The public
`SafeAreaProvider`, `SafeAreaView`, `useSafeAreaInsets`, and `useSafeAreaFrame`
APIs own context, reactivity, validation, and cleanup in Solid; none evaluates
the dependency's React wrapper. Both checked-in generic Release shells compile
and link the dependency. A checked-in Pixel Release gate also compiles the
actual provider delivery, system-inset layout comparison, and terminal teardown
scenario and passes on physical hardware. The signed physical-iPhone gate
compares notch/home-indicator metrics with actual UIKit accessibility frames,
rotates portrait to landscape and back, requires the native inset event and
named Solid computation to cause the normal-priority Fabric commit, and proves
non-terminating teardown.

Core pull-to-refresh follows the same boundary discipline for React Native
0.87's built-in components. `RefreshableScrollView` maps one logical host
descriptor to `AndroidSwipeRefreshLayout` or `PullToRefreshView`, owns their
different tree composition in Solid, and targets `setNativeRefreshing`
directly. Its Pixel Release gate performs real downward touchscreen pulls and
requires rejected plus accepted/completed controlled paths while retaining the
exact native wrapper and backing ScrollView objects. The source-map gate rejects
React Native's RefreshControl and ScrollView JavaScript facades. A generic iOS
Release build passes; the signed physical iPhone pull remains open.

On Android, a passing physical Release run also emits an unsigned, path-free
receipt binding that generated identity to the exact APKs, source map policy,
native-compatibility fingerprint, instrumentation result, Git state, and
privacy-safe device facts. The compatibility catalog pins the receipt generator
as reviewed evidence, while the receipt records the separate fact that a fresh
hardware execution succeeded. The current clean Pixel result is retained under
the application, parsed by CI, and content-addressed by every Android
device-verified claim exercised by that suite.

The same package now emits React-free raw TurboModule ABI bindings: prefixed
alias and enum types, method and Codegen event-emitter contracts, injected
optional/enforcing registry resolvers, and deeply frozen surface descriptors.
Resolvers validate that required callable members exist before returning a
binding. Schema members containing `mixed`, `any`, or untyped `Object` are
rendered as `unknown` and recorded in descriptor audit metadata. This does not
replace packages such as `@solid-native/storage`: an explicit adapter must
still validate native data and convert the raw ABI into a bounded portable
Solid-owned service. Generated event emitters can be passed directly to
`createNativeEventAccessor`; a required decoder validates each event before it
updates a fine-grained accessor, while Solid ownership disposes the native
subscription and the causal scheduler attributes valid delivery without
recording its payload.

### React components

Packages implemented as React components will not work directly. Running them through a hidden React tree would add two ownership and scheduling systems and undermine the platform's semantics. Port or wrap the underlying native module instead.

### Expo modules

Expo modules should be evaluated individually. Native modules may be adaptable when their runtime dependencies are satisfied. Expo React components and deployment infrastructure are separate concerns.

## Version policy

The project should support a small explicit matrix rather than “latest React Native”:

| Solid Native line | Host contract | React Native backend               | Status                                        |
| ----------------- | ------------- | ---------------------------------- | --------------------------------------------- |
| `0.x`             | `v0`          | `0.87.0` / Hermes `250829098.0.16` | Signed physical iPhone + Pixel Release proofs |

An isolated [React Native 0.88 nightly rehearsal](react-native-0.88-upgrade-rehearsal.md)
passes workspace build/check, Android Release compilation, and the ordinary
physical Pixel launch. A fresh mainline candidate also passes CocoaPods, a
100-target generic-device iOS Release build, and the strict one-Solid/no-React-
facade bundle gate. The same nightly now compiles, signs, launches, survives a
bounded process check, and cleans up on the physical iPhone 17 Pro under a
collision-free identity. It remains a forward-compatibility canary rather than
a supported matrix entry; the representative behavioral suites and stable
0.88 release have not yet been promoted.

Future rehearsals start with
`solid-native upgrade react-native --candidate path/to/installed-candidate`.
The offline audit anchors the diff to the verified backend, validates the exact
package/runtime/Hermes/HBC and build-tool pair, checks the candidate's exported
Fabric boundary identity, and hashes the imported React Native-owned header
surface across both trees. It deliberately leaves backend promotion false and
prints the native-build, physical-device, behavioral, performance, and memory
gates that remain.

The supported release identity lives in the dependency-free
`@solid-native/react-native-compat` package. It deliberately records the exact
npm package release, normalized native runtime version, Hermes compiler, and
HBC format as separate fields. The CLI, Fabric host, runtime platform services,
and direct TurboModule adapters consume that contract. Android and Apple JSI
bindings publish the runtime version from one C++ constant, with a repository
test enforcing alignment across the TypeScript contract, application pins,
podspec, and native sources. The reviewed boundary manifest supplies every
exact iOS pod constraint and the normalized compile-time version tuple passed
by CocoaPods and Gradle/CMake, so selecting an isolated candidate does not
require rewriting native implementation namespaces.

The current proof runs the same application source on physical iOS and Android
hardware. Signed Release builds verify JavaScript-owned structural commits,
native press delivery, signal-driven updates, lifecycle delivery, synchronous
measurement, identity reclamation, generated Fabric components, and
empty-surface teardown. They also verify a Solid-owned native screen stack:
the app first cold-launches from a registered URL, resolves React Native's
initial-URL result into an isolated one-entry history, and mounts its native
screen before resetting to a fresh root. Application push later mounts an
actual native detail container, then a physical iOS edge-swipe or Android
system Back reconciles the platform pop into the same `NativeHistory` without
recreating the retained root screen. Android repeats that push/system-Back path
30 times in a fresh Release process while retaining the exact Java
`ScreenStack` and keyed root owner and balancing every detail owner. The
operating system then opens the URL a
second time through iOS XCTest or an Android `ACTION_VIEW` intent; React
Native's Linking path delivers the live event to Hermes and Solid mounts its
resolved system-originated history entry in the native stack. Native screen
appearance also drives an exclusive per-owner Solid focus accessor and visible
follow-up commits throughout cold launch, push, pop, and live-link delivery;
the host normalizes focus/blur as direct default-priority lifecycle events.
They also verify a platform-correct native ScrollView
content tree, an isolated `scrollTo` command, positive-offset continuous event
routing into Solid, and a visible follow-up commit. React Native 0.87 emits
Android `scrollEndDrag` through a generic unspecified-category event; the host
normalizes drag start/end to discrete bubbling input boundaries while retaining
ordinary scroll as continuous. A dedicated Pixel 9a Release application also
renders 1,000 logical fixed-size rows through the Solid-owned
`VirtualizedList`, injects a physical touchscreen swipe, and independently
requires both the live keyed-owner set and Android accessibility tree to remain
bounded at 12 rows after the window moves.

The ScrollView facade also forwards the pinned Fabric
`maintainVisibleContentPosition` policy through a strict reactive configuration.
Both React Native 0.87 platform implementations are present and both Release
shells compile the facade. `VirtualizedList` now exposes the same logical-index
policy: its Solid-owned keyed window retains the visible row while translating
the logical minimum to the mounted native child index. A Pixel 9a Release test
prepends 50 fixed rows after a physical swipe, observes the exact 2,800-point
native offset correction without a JavaScript scroll command, retains the same
keyed Android `View`, and measures the row at the same screen coordinate. The
signed iPhone Release proof observes the same correction while retaining the
keyed Solid owner and accessible row frame. Exact UIKit object identity remains
an explicit promotion gate because XCTest cannot expose a trustworthy pointer.

The same public list accepts exact heterogeneous `{ index, length, offset }`
geometry without adding a native component dependency. Its validation,
binary-searched window, reactive row resizing, and true-offset imperative
scrolling have deterministic coverage; the retained device proof remains the
fixed-size workload described above.

The public Image facade
canonicalizes a URI as Fabric's source array, derives optional source dimensions
into style, applies `cover` and clipping defaults, and requests native load
notifications only when a handler exists. Both devices decode the same offline
PNG and route a direct, default-priority `load` event with positive decoded
geometry; the host normalizes this semantic priority because React Native's
Android coalescing path otherwise classifies resource completion as continuous.
The Image and ScrollView result signals then mount together in one atomic
commit. On Pixel, the command retains its named ScrollView computation and each
independent native event parents a bounded task across the async wait. The
shared two-text commit requires both tasks and both status computations through
its exact Fabric mount and next frame while telemetry excludes command
arguments and decoded event payloads. The equivalent iOS causal composition
remains open. The ActivityIndicator facade supplies the behavior that otherwise
lives in React Native's React wrapper: portable animation/hiding defaults,
centered 20-point or 36-point named sizes, numeric dimensions, and a public
style container. The native boundary maps it to `AndroidProgressBar` or
`ActivityIndicatorView` and injects Android's constructor-only progress style.
Both devices expose the accessible native wrapper and return positive spinner
geometry. Accessibility props and nested state are forwarded through the same
React-free structural and reactive paths. The physical Pixel test queries the
operating system's accessibility node tree and requires native heading,
ImageView, Button, ScrollView, Switch, and editable single-line/multiline
EditText semantics. Signed iPhone XCTest requires the matching static text, Image,
Button, Switch, text field, and text-view elements with their explicit labels
and enabled/selected/checked state. React Native's iOS ScrollView content remains
accessible through its descendants but its container is not exposed as a
separate XCTest ScrollView element, so the test does not assert a nonexistent
platform node. The public accessibility contract also exposes the pinned
Fabric backend's roles, state, values, live regions, labeling and containment
controls, plus typed custom actions. Supplying `onAccessibilityAction` installs
the native watcher and routes its action name into Solid as a discrete,
non-bubbling causal input; iOS accessibility tap, escape, and magic-tap
callbacks follow the same path. Deterministic host tests cover these events.
Physical assistive-technology gesture delivery remains open. The public TextInput
facade similarly preserves a portable Solid
name while the backend resolves React Native's platform descriptors
(`AndroidTextInput` on Android and `RCTTextInput` on iOS). It owns the hidden
`mostRecentEventCount` acknowledgement, drops stale native edits, suppresses
same-text higher-count echoes while still advancing that acknowledgement, and
exposes a controlled value contract by translating public
`value`/`defaultValue` to the descriptors' actual `text` prop. Both device tests
focus the native editor and type through platform UI automation; the direct
`changeText` event is normalized to discrete priority and reconciles through
Solid. Solid then programmatically replaces the value, and both tests verify
the real editor, visible mirror, and current-or-later measured Fabric sequence.
The facade
also owns React Native's event-counted text/selection synchronization instead
of importing its React hook: controlled ranges are validated and normalized,
native selection is tracked internally, and changed text or selection is sent
through `setTextAndSelection` with the latest event count. Both devices accept
a Solid-controlled caret at offset 5 and physically insert `X` there. Android
reports the programmatic range while iOS intentionally suppresses that callback
and reports the user-driven range; the host exposes both as direct,
default-priority `selectionChange`. The renderer isolates those commands from
racing structural updates and includes framework-owned commands in its flush
completion boundary. The native compatibility layer also rebases retained
nodes and commands onto `UIManager`'s newest mounted ShadowNode-family member.
That preserves native-owned attributed text and event-count state between
Solid commits instead of cloning an obsolete editor snapshot. The facade
computes the same single-line and multiline
`submitBehavior` defaults normally owned by React Native's React wrapper,
including compatibility with `blurOnSubmit`. Both devices press the native
return key and prove that `submitEditing` is direct, discrete input carrying
the current controlled text, followed by a real blur event and Solid commit.
It also owns the wrapper's production form translations: `inputMode` and
`enterKeyHint` take precedence over their lower-level native alternatives,
`readOnly` controls effective editability and focus-group eligibility, and
portable `autoComplete` values become Android autofill hints or iOS
`textContentType`. Explicit iOS `textContentType` remains authoritative.
Platform-specific search keyboards, keyboard/caret suppression for
`inputMode="none"`, and all precedence changes are covered reactively against
both platform contracts without loading React. It also supplies React Native's
wrapper-owned font-scaling default on both platforms and the Android defaults
for sentence capitalization, empty placeholder, transparent underline, and
cursor/selection-handle inheritance from `selectionColor`. Explicit Android
cursor or handle colors—including `null`—remain authoritative. Its style
projection preserves nested style precedence, stringifies numeric font weights,
maps `verticalAlign` to `textAlignVertical`, and applies iOS's five-point
multiline top inset only when the caller supplied no relevant padding.
The facade also exposes multiline `numberOfLines`, `onContentSizeChange`,
`onEndEditing`, `onScroll`, and `onKeyPress`. Subscribing enables React Native's
native observer; Android's input-connection key watcher is likewise opt-in. The
host routes `contentSizeChange` as direct, default-priority input, editor scroll
as continuous input, end-editing as a default-priority lifecycle event, and
`keyPress` as discrete bubbling input. Both devices observe `Enter` before
typing a two-line value through platform UI automation; after Solid commits
that controlled value, the real editor reports positive content-size growth
while remaining focused and emitting neither submit nor blur.
The public Switch facade similarly replaces wrapper-owned behavior. It maps to
`AndroidSwitch` or UIKit `Switch`, normalizes false/true track colors through
the native color ABI, translates the platform command to `setNativeValue` or
`setValue`, and exposes one portable discrete bubbling `valueChange` event.
React Native's native control toggles before notifying JavaScript, so the Solid
facade records every observed value and restores a rejected controlled value
with an isolated command—even when the same rejected toggle repeats. Physical
Pixel and iPhone automation requires both public callbacks and observes the
actual platform switch return to off.
The public Modal facade likewise replaces React Native's platform-conditional
React component lifetime. It validates portable presentation props and keeps
the same Solid owner while Android structurally dismisses after a mounted
visibility handoff or iOS waits for UIKit's asynchronous `onDismiss`. The host
contract supplies the platform identity, so application code does not import
React Native's `Platform` or render a hidden React tree.
The adapter also resolves
the native `PlatformConstants` TurboModule directly through React Native's
registry on both platforms, verifies the pinned runtime version, and awaits the
platform Linking TurboModule's initial-URL promise before mounting the Solid
tree. A
background/foreground cycle must then deliver an AppState TurboModule event
before the physical press proof can complete. The Pixel Release proof further
requires that non-Fabric callback to become a private platform-event operation
and remain a cause through its named Solid output, exact Fabric commit, mount,
and next frame. The equivalent iOS causal assertion remains open. React Native 0.87's color
normalization runs before direct `RawProps` construction so standard string
colors render correctly without React's JavaScript renderer. A physical press
on a nested text target now crosses Fabric's normalized event boundary, bubbles
to the owning Pressable, invokes Hermes, and drives a visible follow-up commit.
The public Pressable facade additionally owns React-free interaction state:
accessible/focusable/non-collapsible defaults, disabled callback suppression,
reactive pressed styles and function children, delayed press-in, and cancellable
long-press timing. Delayed press-in and synthetic long-press callbacks re-enter
the causal protocol at discrete priority, and a handled long press suppresses
the following ordinary press. Native target-level focus and blur transitions
are exposed at default priority. Solid now also owns the retained press region:
native touch/pointer movement combines `hitSlop` with `pressRetentionOffset`,
releases and restores feedback across that boundary, cancels long press after
drift, and suppresses an outside release. Android ripple configuration is also
translated into the pinned native drawable and generic hotspot/pressed commands
without React's Pressable wrapper. These paths have deterministic coverage and
Release compile gates. A physical Pixel Release gate now proves diagonal
retained-region exit/re-entry, cancellation recovery, parent ScrollView
takeover, visible foreground ripple pixels, and terminal cleanup. Equivalent
iOS movement promotion is not yet claimed. Hover callbacks and their bounded
entry/exit delays route directly from native pointer enter/leave on both
backends, cancel cleanly with re-entry and owner disposal, and pass both native
Release compile gates; physical pointer-input promotion remains open.
The same run verifies sequence-aware measurement, complete identity
reclamation, and an empty-surface stop with the device process still alive. A
checked-in TypeScript component spec also generates a custom descriptor and
typed prop binding whose native view mounts and measures on both platforms.
The equivalent Release shells are checked in under
`apps/native-e2e`; the bundle explicitly imports React Native's environment
setup because a React-free bundle does not receive those timer/microtask
globals through AppRegistry. On both platforms, deleted JSI identities remain
retained until Fabric reports that their retiring revision has mounted. See the
[React Native 0.87 Fabric spike](fabric-spike-react-native-0.87.md).

### `react-native-screens` backend pin

Native stack presentation currently pins `react-native-screens` 4.27.0, the
stable line that explicitly supports React Native 0.87. Moving from 4.25.2
removed two compatibility hunks because upstream now owns them:

- Fresco's nullable Android bitmap is handled by the upstream image loader.
- The iOS custom-transition host object is guarded by upstream's
  `RNS_USE_CXXBRIDGE` build contract.

The smaller patch now covers only asynchronous native-tab icon ownership.
Android routes both resource and URI props through upstream's
`PropIconResolver` at the end of one Fabric prop transaction, clearing removed
icons and rejecting stale URI completions. iOS weakly owns the item and screen,
then also requires the current image-source identity and icon mode to match the
completed request. These two fixes are candidates for upstreaming. Any
`react-native-screens` or React Native upgrade must rebase or remove the patch
explicitly and repeat both device tests; an unreviewed range upgrade is not
compatible by assumption.

The navigation package owns this backend input instead of relying on an
unpublished monorepo convention. Its exact screens peer, exported patch, and
schema-1 backend contract ship in the packed artifact. `solid-native doctor`
resolves that contract from the installed navigation package and checks the
patch digest plus all three post-patch native file digests. An exact 4.27.0
manifest with an unpatched install therefore fails closed. Applications still
copy the exported patch into their own repository and configure their package
manager explicitly so clean dependency resolution remains self-contained.

The checked-in CLI suite also audits the dependency's real Codegen schema. At
4.27.0 it exposes 15 directly projectable screens components plus `RNSModule`;
the combined application audit contains a sixteenth component from the E2E
app. Sixteen other declarations are interface-only, including `RNSScreen`, so
they are intentionally absent from default generated descriptors. The runtime's
working `RNSScreen` path is therefore backed by its separately reviewed native
descriptor alias and physical tests—not by pretending that schema projection
made an interface-only declaration independently mountable. This exact
inventory is pinned as an upgrade regression gate.

The E2E application now owns `solid-native.compatibility.json` and runs
`solid-native compatibility check` in its ordinary check gate. Its initial
claims cover the exact AsyncStorage 3.1.1 `RNAsyncStorage` TurboModule, Notify
Kit 10.5.0 `NotifeeApiModule`, and the exercised screens 4.27.0 stack, screen,
header, iOS modal-sheet, and native-tab surfaces. The screens runtime surfaces
point at bounded physical restoration, appearance/image-ownership, and focused
product-composition runners. `RNSModule` remains explicitly
`schema-discovered`; it is not promoted to runtime support merely because its
ABI parses. Every other screens surface is returned as package-attributed,
unclaimed inventory for later adapter work.

The 4.27.0 pin has passed isolated schema/catalog checks, Android Release
compile/link, CocoaPods regeneration, and generic iPhoneOS Release builds. The
current checked-in Pixel navigation suite passes six distinct processes, and
the signed iPhone single-stack suite passes three, including durable root-scroll
restoration. Their exercised stack, screen, and header claims are therefore
`device-verified`. Modal and tab surfaces remain `native-integrated` until their
independent current-evidence runners are promoted again. No promotion transfers
automatically to a future screens pin.

The AsyncStorage claim now includes an application-owned adapter generated from
the exact ABI and narrowed onto `@solid-native/storage/async-storage-3`. The
three E2E entrypoints resolve `RNAsyncStorage` through the generated registry
binding instead of the dependency's React-oriented `createAsyncStorage`
entrypoint. The Android Release bundle now proves that exact source graph and
the catalog held it at `native-integrated` until a fresh secure-device run
passed. That refreshed Android run now passes on a tethered Pixel 9a, including
process restoration, 30-cycle native navigation churn, and cold-link
precedence. The signed iPhone device path now also persists and restores the
native backend in three fresh processes. The iOS claim nevertheless remains
`binding-generated` until an iOS source-map policy gate proves the same direct
adapter boundary and facade exclusion as Android.
The pre-install source-graph assertion uses the public
`solid-native bundle sources` policy command, so another product adapter can
require its generated boundary and exclude a React-facing wrapper without
copying the E2E application's parser.

Notify Kit now follows the same wrapper-free product pattern. Android is
`device-verified` after the source-policy-clean Release bundle passed real
permission, OS-visible delivery/body press, causal Solid updates, query,
cancellation, and complete resource teardown on a tethered Pixel 9a. iOS is
also `device-verified` after the replacement seam passed a signed physical
Release run with the exact wrapper-free source policy, first-install permission
handling, native foreground delivery and displayed-ID query, private causal
Solid/Fabric update, cancellation, and non-terminating teardown. OS-level
content inspection and body-press interaction remain Android-only.

Catalog validation re-audits each dependency alone, preventing a same-named
surface from another package or the app from satisfying a claim. A
`device-verified` level is still reviewed metadata: the local check validates
the exact schema plus the pinned SHA-256 bytes of every proof path, while
release automation must separately run and retain the physical result.

The Android screens evidence now includes the restoration runner's bounded
memory-pressure reclamation and recovery phase, and that exact Release source
passed again on the Pixel 9a. The current shared entry also passed its complete
three-process signed-iPhone sequence: a physical root drag persisted across
process termination, the restored native Back flow recovered the same on-screen
position, and a third PID proved cold-link precedence. Those results promote
the catalog's stack, screen, and header claims on both platforms. They do not
claim an iOS memory-pressure phase or re-promote the separate modal/tab runners.

React Native 0.87's built-in Image loading utility is also treated as a pinned
native ABI rather than a stable JavaScript facade. Android `ImageLoader.getSize`
returns an object and `prefetchImage` requires a client-generated signed 32-bit
request identifier that can be passed to `abortRequest`; iOS returns a
width/height tuple, accepts no prefetch identifier, and exposes no cancellation
method. `@solid-native/images` normalizes those differences behind one bounded
service, validates all native settlements, and loads the TurboModule registry
directly. Its Release source policy rejects `Image.android.js`, `Image.ios.js`,
both NativeImageLoader re-exports, and both deprecated generated JavaScript
specs. A physical Pixel Release gate now proves authenticated metadata, a
cold-to-hot native prefetch transition, ordered cache inspection without a
network request for an absent URI, direct `abortRequest` transport
cancellation, and transport cancellation on Solid owner disposal. Every
successful settlement retains its privacy-safe causal Solid commit; the gate
also requires acknowledged Fabric teardown and complete process, package, and
reverse-tunnel cleanup. iOS remains generic Release-compiled and awaits its
physical metadata/cache gate. This does not claim the similarly named
`ImageEditingManager`: React
Native 0.87 retains its generated contract and iOS implementation but does not
register an Android implementation, so it is not a portable backend surface.

Incremental text networking is a separate pinned native ABI. Android
`Networking.sendRequest` requires a framework-generated signed 32-bit request
identifier, tuple headers, and positional arguments; iOS accepts an object and
returns its native request identifier through a callback that may arrive after
application cancellation. `@solid-native/networking` normalizes both forms,
subscribes directly to native response, incremental-data, and completion events,
and aborts active work on explicit cancellation or Solid owner disposal. It
validates HTTP(S) URLs, methods, credentials, headers, request and response
bounds, metadata, monotonic progress, native errors, and event ordering without
accumulating the response body. React Native's application bootstrap still
installs the platform fetch/XHR stack before the entrypoint. The Release source
policy fingerprints exactly that unavoidable `setup-env` baseline, rejects a
mixed-platform baseline, and separately requires the Solid Native networking
package to contain only its direct registry, adapter, validation, and ownership
seam. A separate bounded SSE layer parses arbitrary native chunk boundaries and
retains the chunk or completion cause through event delivery. It validates HTTP
status and media type, bounds parser memory and work, and exposes retry and
last-event-ID state without starting hidden reconnection work. A Solid-owned
stream projects the connection and latest event into reactive state, cancels
replaced or disposed requests, and keeps restart policy explicit. A finite JSON
layer independently caps chunk count, document characters, depth, and value
count, validates JSON media types, deeply freezes parsed data, and offers a
synchronous result observer whose Solid writes retain the native completion
cause. A Solid-first JSON resource adds reactive request replacement,
last-good-value refresh state, synchronous decoding, explicit refetch, and
owner-bound cancellation without changing that transport contract. It does not
interpret HTTP status or expose response content to telemetry. Retry policy,
caching, server functions, and server-component semantics remain higher layers
rather than hidden behavior in the transport.

Backend upgrades require:

- Native build on supported iOS and Android versions
- Core component conformance tests
- Module/component compatibility suite
- Performance comparison
- Upgrade notes for downstream native packages

The native rn087 adapter also checks React Native's
`ReactNativeVersion.h` macros at compile time. CocoaPods already pins every
selected Fabric subspec exactly; this gives Android's source-based CMake
integration the same fail-closed version boundary. Matching C++ signatures are
useful canary evidence, but they cannot silently turn a different React Native
tree into a supported backend.

The first concrete record of that process is the
[React Native 0.88 nightly upgrade rehearsal](react-native-0.88-upgrade-rehearsal.md).

## Licensing and branding

React Native is MIT-licensed, which permits commercial modification and distribution while requiring retention of its copyright and license notice. That does not grant trademark rights or permission to imply endorsement.

Before distribution:

- Inventory licenses for React Native, Hermes, Yoga, Folly, third-party native libraries, and generated artifacts
- Preserve required notices in source and binary distributions
- Review the project name and marketing claims with counsel
- Review patent posture and distribution dependencies with counsel
- Keep application infrastructure separate from third-party open-source code

This document is an engineering plan, not legal advice.
