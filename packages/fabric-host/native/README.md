# Reviewed React Native Fabric boundary

This directory is the exact-release native seam for the Solid Native Fabric
backend. React Native 0.87.0 remains the only supported and device-verified
release. Application-facing packages must not include these headers or expose
React Native types.

`react-native-boundary.json` is the single native build selection. CocoaPods
reads its exact package release for every React Native pod constraint and
derives the expected normalized runtime tuple for the C++ compile guard. The
package-owned Gradle seam reads the same manifest and passes the same tuple to
CMake. React Native's own version macros must match that tuple, so neither
platform can silently compile against a different native tree merely because
its internal signatures happen to match.

The manifest is also the machine-readable review surface for the adapter. It
records every React Native, JSI, Folly, and fbjni header imported by the native
code, every `com.facebook.*` Android import, the generated Codegen headers,
CocoaPods dependencies, and Android CMake inputs. The package boundary verifier
reconstructs this inventory from source, matches it to the compatibility
package and native build wiring, and fails on any unreviewed addition, removal,
or pin change. Consumers can resolve the reviewed inventory through
`@solid-native/fabric-host/react-native-boundary`.

The internal C++ namespace intentionally identifies the `react_native` backend,
not a hard-coded release. A rehearsal can therefore select a reviewed candidate
by changing the isolated candidate manifest and dependency lock without
rewriting the implementation namespace or Podspec. That compile selection is
not a support claim: the public compatibility matrix remains fail-closed until
all qualification gates are complete.

The current manifest selects React Native `0.87.0`. The CocoaPods target and
package-owned Android CMake/Kotlin seam compile the same portable transaction coordinator with
direct calls to:

- `UIManager::createNode`
- `UIManager::cloneNode`
- `UIManager::appendChild`
- `UIManager::completeSurface`
- `UIManager::dispatchCommand`
- `dom::measure`

The platform shells install a synchronous `__solidNativeHost` JSI object before
the application bundle executes. iOS installs during
`RCTHostDelegate::didInitializeRuntime`; Android uses React Native's
`BindingsInstaller` and attaches its Fabric event listener lazily at commit 1,
after Android has installed `UIManager`. Subscribed Fabric events are
intercepted ahead of React's event queue and scheduled onto the owning Hermes
runtime.

The target was compiled, linked, mounted, updated, and rollback-tested in a
generated React Native iOS application on 2026-08-19 with Xcode 26.6, the iOS
26.5 simulator SDK, CocoaPods 1.16.2, and an iOS 15.1 deployment target. The
Hermes bundle rejected a cyclic transaction and then visibly updated the
Fabric tree through JSI.

The checked-in Release shell has exercised the same Solid-generated tree on a
physical iPhone and Pixel 9a. Both devices mounted the initial tree, routed a
press into Hermes after an AppState-driven commit, mounted the signal update,
returned non-empty current-revision layout, reclaimed every retained instance
identity, stopped the empty surface, and kept the process alive. The Android
flow is repeatable through a checked-in Release instrumentation test as well as
the manual install script. Commit 1 also contains a custom native view whose
descriptor and typed `label` prop are generated from a TypeScript Fabric spec;
its platform implementation and positive layout are verified on both devices.

Application commits construct React Native `RawProps` from values owned by the
calling Hermes runtime. RN's deprecated `folly::dynamic` constructor is isolated
to the native-only feasibility transactions, which intentionally run before a
JavaScript runtime owns the surface.

Opaque native props use a deliberately narrower path than ordinary RawProps.
The JSI binding retains up to 64 exact non-array objects in private runtime
storage and returns monotonically increasing safe-integer handles tagged by a
validated kind. The portable transaction still contains only a transport-safe
`__solidNativeResource` marker. While constructing RawProps, `FabricApi`
recognizes that marker only when it is the complete value of a direct prop and
asks the owning runtime registry for the original JSI value. Missing handles,
kind mismatches, nested use, and native-only transactions fail closed. Solid
owner cleanup releases entries, and surface teardown rejects any leak before
the binding's final defensive reclamation.

To include the compatibility target in a React Native 0.87 Podfile, resolve its
exported podspec through the application installation instead of assuming a
node_modules or monorepo layout:

```ruby
solid_native_fabric_host_native_path = File.dirname(
  Pod::Executable.execute_command('node', ['--preserve-symlinks', '-p',
    'require.resolve(
      "@solid-native/fabric-host/ios-podspec",
      {paths: [process.argv[1]]},
    )', __dir__]).strip
)
solid_native_fabric_host_native_path = Pathname
  .new(solid_native_fabric_host_native_path)
  .relative_path_from(Pathname.new(__dir__))
  .to_s

pod 'SolidNativeFabric', :path => solid_native_fabric_host_native_path
```

Then run `bundle exec pod install` and build the application workspace. The pod
version constraints intentionally make dependency resolution fail on a React
Native upgrade until this boundary is reviewed.

The application delegate starts the production bootstrap after it has created
its window and container view:

```swift
private var solidNativeApplication: SolidNativeFabricApplication?

solidNativeApplication = SolidNativeFabricApplication.start(
  withFactory: factory,
  containerView: containerView,
  launchOptions: launchOptions,
  statusHandler: { status, error in
    if status.hasSuffix("-failed"), let error {
      SolidNativeStartupFailureView.show(in: containerView, error: error)
    }
  }
)
```

`SolidNativeFabricApplication` installs Hermes/JSI, publishes one empty Fabric
revision, resets native sequence bookkeeping, and then lets JavaScript own node
allocation from commit 1. It does not mount diagnostic content or execute an
intentional failing transaction during application startup. Before constructing
`RCTHost`, it enables bridgeless legacy-module interop when React Native was
built with that fallback. This mirrors React Native 0.87's standard
`RCTRootViewFactory` ordering and lets explicitly versioned linked
`RCTBridgeModule` dependencies register before the host snapshots its module
set; it is not a generated-TurboModule compatibility claim. The boundary
verifier requires this call to remain ahead of host construction in both the
production and retained smoke bootstraps. `stop()` is idempotent, removes the
surface, disconnects the binding, and releases the `RCTHost`; it also cancels
native display-link work immediately rather than waiting for Hermes teardown.
Both start and stop are main-thread operations.

The package-owned iOS container also forwards every UIKit bounds or window
position change into the empty surface's Fabric layout constraints. Rotation,
window resizing, and embedding therefore relayout the native shadow tree rather
than merely stretching its outer `UIView` while retaining stale root bounds. It
also republishes UIKit trait changes through React Native's documented internal
notification, preserving `Appearance` delivery that its standard surface
hosting view normally owns.

For Android, apply the package-owned integration after the Android application,
AGP built-in Kotlin, and React Native plugins. Resolve it through Node so pnpm,
npm, and Yarn layouts all use the installed artifact instead of a
repository-relative source path:

```groovy
def solidNativeAndroidGradle = file(
    providers.exec {
        workingDir(rootProject.projectDir)
        commandLine(
            "node",
            "--print",
            "require.resolve('@solid-native/fabric-host/android-gradle')"
        )
    }.standardOutput.asText.get().trim()
)
apply from: solidNativeAndroidGradle
```

The helper adds the package-owned Kotlin installer to `main` using either AGP
9's built-in Kotlin source-set API or the external Kotlin Android plugin used
by the exact upstream React Native 0.87 template. It also passes the installed
Fabric Host directory to CMake. Include the reviewed CMake integration after React
Native creates its application target:

```cmake
include("${SOLID_NATIVE_FABRIC_HOST_DIR}/native/android/SolidNativeRuntime.cmake")
solid_native_configure_android_target(${CMAKE_PROJECT_NAME})
```

`SolidNativeRuntime.cmake` adds the package-owned JNI installer, portable
transaction coordinator, Fabric API, and UI-worklet evaluator to that target
with React Native's exact Folly mode. The package-artifact gate installs the
packed tarball in an isolated consumer and verifies this same entry-relative
native layout. The application's `JNI_OnLoad` includes
`SolidNativeBindingsInstaller.h` and calls
`solid_native::android::registerSolidNativeBindingsInstaller()` inside its
`fbjni` initializer. Application Kotlin passes
`dev.solidnative.runtime.SolidNativeBindingsInstaller()` to React Native's
`bindingsInstaller`. Its activity then starts the package-owned production
surface:

```kotlin
private var solidNativeSurface: SolidNativeSurface? = null

solidNativeSurface =
    SolidNativeSurface.start(
        activity = this,
        reactHost = nativeApplication.reactHost,
        bindingsInstaller = nativeApplication.solidNativeBindingsInstaller,
    )
```

Call `solidNativeSurface?.stop()` from `onDestroy`. The controller owns empty
surface publication, UI-worklet output and pan handlers, immediate native-work
deactivation, and idempotent teardown. It waits for React Native's asynchronous
surface start before publishing and keeps the JSI surface in its destroying
state until the bounded asynchronous stop completes; startup and shutdown
failures release the remaining surface resources and are available through an
optional status handler. Before creating the surface it also derives natural
RTL from the Activity's effective application locale and synchronizes React
Native 0.87's package-scoped preferences, containing that version's incorrect
available-locale lookup at the pinned native boundary. The current installer
loads React Native's standard
`appmodules` application library; a separately packaged Android AAR and a
generated shell remain future integration work.

## What this proves

The checked-in application now boots through
`SolidNativeFabricApplication`, the same production path exposed by the pod.
The production bootstrap and JSI binding share the private
`SolidNativeFabricSurface`; its name now reflects that it is the actual runtime
surface rather than a test fixture. The earlier
`SolidNativeFabricSmokeApplication` feasibility harness remains in the packed
version-pinned source so the original native-only mount and rollback experiment
stays reproducible, but the podspec explicitly excludes that harness from
consumer compilation through a fail-closed production source list. Both paths
start Hermes/RCTHost without requesting a
React application surface and use a Fabric surface whose module name is empty.
The coordinator validates and stages complete versioned transaction lists,
maps public component names, materializes changed shadow paths, and performs
one `completeSurface` call. The earlier simulator proof showed the diagnostic
label and emitted `jsi-installed`, `mount-succeeded`, `rollback-succeeded`, and
`jsi-update-succeeded`.

The production bootstrap commits only an empty tree and resets the logical
sequence before marking the JSI surface ready. JavaScript can therefore
allocate node 1 and own commit sequence 1 without inheriting probe nodes.
`NativeFabricHost` adapts that empty, single-runtime surface to
the framework-neutral `NativeHost`, including allocation, commits, events, measurements,
descriptors, and teardown checks that reject live nodes.

`SolidNativeStartupFailureView` is a dependency-free native last resort for a
host, JSI-binding, or initial-surface failure. It replaces an otherwise blank
container with an accessible generic message; Debug builds may append one
sanitized, bounded local diagnostic, while Release builds never expose the
supplied error. The Android equivalent takes the Activity and can be called
from `SolidNativeSurface`'s optional status handler. The binding's bounded
`reportFatalError(name, message)` handoff also lets the package-owned shell
stop a live surface and replace it with this fallback after a fatal Hermes
exception or terminal Fabric commit. Stacks and arbitrary thrown values never
cross that native boundary.

The rollback proof stages a text change followed by an illegal self-insertion.
The coordinator rejects the transaction, leaves sequence 2 unused, and then
accepts a valid sequence-2 text update. Commands are required to be the only
mutation in their transaction because their side effects cannot be rolled back.

The JSI decoder rejects undefined values, non-finite numbers, functions,
symbols, BigInts, cyclic object graphs, more than 64 levels of nesting, and
more than 100,000 transported values. The binding remains unavailable until
the empty Fabric revision is ready, serializes commits against invalidation,
and checks the exact host/backend versions at the TypeScript edge.

The built-in public mappings are `RootView`, `View`, `Pressable`, `Text`,
`Image`, `ScrollView`, `TextInput`, `ActivityIndicator`, `Modal`, `Screen`, and
`ScreenStack`. The screen components resolve through the pinned
`react-native-screens` descriptors in the application shell. Generated Fabric
component identifiers pass through to React Native's generated
descriptor registry after the JavaScript host validates their Solid Native
descriptor. Raw text is only accepted under `Text`, root views cannot be
nested, styles are flattened into Fabric props, and an unregistered generated
name fails before Fabric commits the staged tree.

Public component aliases are allowed to resolve differently at this native
boundary. In particular, `TextInput` maps to React Native's
`AndroidTextInput` descriptor on Android and `RCTTextInput` on iOS while the
Solid API and host descriptor remain platform-neutral. `ActivityIndicator`
similarly maps to `AndroidProgressBar` or `ActivityIndicatorView`; the Android
boundary supplies the constructor-only `styleAttr` and indeterminate props that
must not leak into the public Solid component.

`Modal` maps to Fabric's actual `ModalHostView` descriptor and enables only the
native event props requested by the Solid facade. Its lifecycle is deliberately
platform-aware above this seam: Android's manager ignores `visible=false` and
dismisses when structurally unmounted, whereas UIKit emits `onDismiss` from an
asynchronous completion that still needs the mounted ComponentView's
EventEmitter. Host contract version 1 exposes the binding's immutable platform
identifier so the facade can sequence those two paths without timers or a
React-owned wrapper.

Before cloning a retained node, the compatibility layer asks `UIManager` for
the newest mounted member of its ShadowNode family. Fabric views can advance
state without a Solid commit: a native TextInput edit, for example, updates its
attributed text and event count on the mounting side. Rebasing props and
children onto that newest node prevents a later controlled Solid update from
forking obsolete native state. Commands are dispatched to the newest mounted
family member for the same reason. The signed iPhone selection proof exercises
the failure-sensitive sequence: physical insertion, native state advancement,
Solid-controlled restoration, and current-value submit.

This proves the JSI call boundary, native transaction decoder, runtime-owned
Fabric node identity, and physical native-to-Hermes event route with atomic
logical staging on both platforms. The React-free application bundle also
resolves React Native's native `PlatformConstants` TurboModule through the
standard registry and awaits the platform Linking module's initial-URL promise
before mounting. It also subscribes to the native AppState module and requires
a background/foreground event before the press proof can finish. Application
code reaches PlatformConstants, Linking, AppState, Appearance, StatusBarManager,
and BackHandler through the pinned `@solid-native/runtime/react-native`
service; that boundary validates payloads, owns platform subscription and
status-bar stack lifetimes, and contains React Native implementation imports. Every node
created through JSI receives a non-null `InstanceHandle` whose frozen backing
object is retained by state attached to the owning Hermes host object. Failed
commits remove their staged identities before returning to JavaScript. Deleted
identities remain retained until Fabric reports that the platform mounted the
deleting shadow-tree revision, then a task on the owning Hermes runtime releases
both the backing object and native event route. iOS observes the mounting
coordinator on its main queue; Android registers a `UIManagerMountHook` that is
called after UI-thread mount effects are visible and reads the coordinator's
mounted base revision. Both then emit a separate next-vsync lifecycle record
through `CADisplayLink` or `Choreographer`; this observes frame eligibility, not
compositor presentation. Surface teardown releases any remaining identities.

The physical Pixel proof additionally passes VisionCamera's Nitro preview
output through this resource path into its generated `PreviewView`. Android
independently observes the real camera become unavailable, finds a shown
positive-size `androidx.camera.view.PreviewView`, requires its native stream
state to equal `STREAMING`, and then observes camera release after Solid owner
disposal. This is an identity-preserving Fabric prop proof, not serialization
of a HybridObject into the public host-value domain.

`setEventHandler` installs the single runtime callback used by the renderer.
The native listener converts Fabric tags back to Solid node handles, preserves
the observed commit sequence and native priority, and suppresses React's
default dispatch for every Solid-owned tag. Events queued from an older Fabric
revision revalidate their subscription on the Hermes thread and are therefore
dropped after unsubscription or deletion instead of reaching a nonexistent
Solid node. Native screen `appear`/`disappear` events map to semantic
`focus`/`blur`; both adapters normalize them to direct default-priority
lifecycle input instead of inheriting backend input scheduling categories.
TextInput `change` maps to semantic `changeText` and is normalized to direct
discrete input so its Solid-controlled reconciliation receives user-blocking
commit priority on both platforms. `keyPress` is discrete bubbling input, and
`submitEditing` is direct discrete input; `contentSizeChange` and
`selectionChange` are direct default-priority input. TextInput `scroll` is
normalized to continuous input and `endEditing` remains a default-priority
lifecycle event. `View` layout is also a direct default-priority event. Fabric
can synchronously emit a newly mounted
view's initial layout while applying its transaction, so both bindings stage
only layout-bearing tag/event routes before native apply. A rejected commit
restores the prior route, surface, and sequence; a successful commit publishes
the complete routing graph. This preserves the first layout event without
copying the full route table on every transaction.

Subscribing sets the native
`onContentSizeChange`, `onSelectionChange`, or `onScroll` prop needed to install
the corresponding platform watcher. Android additionally receives `onKeyPress`
only when the Solid handler is subscribed, enabling its input-connection
wrapper without paying that cost for every editor. Focus, blur, and end-editing
remain default-priority lifecycle events.

The Solid facade suppresses higher-count native echoes that repeat the same
text while still advancing React Native's hidden acknowledgement count.
Multiline inputs expose the native `numberOfLines` prop and content-size
observer. With explicit transaction flushing, the controlled text commit
precedes its resulting native geometry event. Signed iPhone and Pixel runs type
two lines into the real editor, commit that value, observe native content-size
growth, observe `Enter` before the newline change, and verify that newline mode
retains focus without submit or blur.

The JSI `measure(node, afterSequence?)` call reads React Native's current
shadow-tree revision and returns parent-relative and page-relative geometry.
It rejects unmounted nodes and future sequence requirements instead of
returning stale layout. Physical iPhone and Pixel Release runs both returned
positive geometry after commits 1 and 2.

`destroySurface()` is accepted only after the coordinator's logical tree is
empty. It deactivates event routing, unregisters the Fabric listener, makes the
binding unavailable for later commits, and stops the native surface. The
renderer-facing adapter independently tracks successful create/delete
mutations and rejects premature teardown before crossing JSI.

Both platform bindings additionally install the complete version-0 native
UI-worklet boundary. A bounded graph is decoded into immutable portable C++
bytecode only after its target logical node resolves to the runtime-retained
Fabric tag.
Input updates validate complete finite vectors and monotonic timestamps before
publication. Android `Choreographer` or iOS `CADisplayLink` then evaluates the
latest vector on the main/UI thread and applies one frame of supported native
view outputs. Multiple updates awaiting the same callback coalesce without
exposing a partial vector. Cancellation is linearized with frame application;
deleting a target cancels it defensively, pending callbacks observe inactive
state, and surface handoff/teardown reports both the active graph count and the
subset with a pending native display callback. This distinguishes an installed,
idle graph from actual frame work without enumerating opaque handles. On iOS
the worklet owns its pending display-link observer explicitly, so target
deletion, owner disposal, and runtime replacement invalidate the native link
immediately instead of waiting for another display callback to release its
target cycle. The host advertises `uiWorklets` only when install, update,
destroy, and inspection methods are all present.

The optional timing extension accepts one complete target vector, a monotonic
intent timestamp, a duration of at most 60 seconds, and one of four bounded
easing curves. Each display callback interpolates and evaluates in native C++,
then schedules another callback only while the timing remains active. A newer
timing replaces it from the latest evaluated vector; an ordinary input update,
target deletion, or owner disposal cancels it. Inspection publishes bounded
progress without invoking application JavaScript from the UI thread. It also
publishes frame counts, display-timestamp bounds, global interval
minimum/maximum/mean, and nearest-rank p50/p95/p99 cadence after the first
successful timing frame. Quantiles retain at most 8,192 intervals and report
every omitted sample explicitly; aggregate counts and extrema continue for the
whole timing. iOS keeps one `CADisplayLink` alive for the timing and requests
the screen's maximum supported refresh range instead of reallocating a
one-shot link per frame. Android continues through successive `Choreographer`
callbacks. These timestamps observe the worklet's display-callback cadence,
not compositor presentation.

The optional keyframe extension accepts 1–32 complete timing targets in one
JSI call, with the same four easing curves and a 60-second cap across the whole
sequence. Every endpoint is decoded, bounded, and evaluated against the graph
before the existing driver is replaced. The shared C++ evaluator advances by
elapsed time, can cross multiple completed stages after a late callback, and
publishes duration-weighted progress plus cadence statistics for the complete
sequence. No Hermes callback is needed to start the next stage. A replacement
driver begins from the latest input vector already evaluated by the native
display loop.

The optional cancellation extension accepts a monotonic intent timestamp,
linearizes against the display callback, stops whichever timing, keyframe,
spring, or decay owns the vector, and returns the exact frozen inputs in graph
order through the same synchronous JSI call. It does not synthesize an
additional view mutation. Android removes the pending native frame token so a
late `Choreographer` callback cannot publish an identical extra sequence; iOS
clears and invalidates the owned `CADisplayLink` immediately. Existing cadence
statistics and normalized position/progress/elapsed diagnostics remain, while
spring velocity and decay speed become zero. Cancellation neither destroys the
graph nor detaches a pan recognizer.

The optional spring extension accepts the same complete target vector plus a
bounded mass, stiffness, damping, normalized initial velocity, two positive
rest thresholds, and a hard duration cap. The shared C++ evaluator uses the
closed-form damped harmonic oscillator for underdamped, critically damped, and
overdamped motion, so a given elapsed display time produces the same position
and velocity independently of refresh rate. Position is intentionally
unbounded to preserve overshoot. Meeting both rest thresholds or reaching the
duration cap snaps every input to its exact target and publishes zero velocity.
A replacement timing or spring begins from the latest evaluated vector;
immediate input, pan ownership, target deletion, and owner teardown cancel the
driver. Inspection exposes active state, normalized position/velocity, and the
same bounded cadence statistics used by timings.

The optional pan extension resolves the graph's retained platform view and
attaches one native gesture source. Gesture begin snapshots the current input
vector; change/end/cancel samples add bounded logical-unit translation to the
two selected inputs, evaluate the complete graph, and apply the output frame
synchronously on the UI thread. Attachment transfers all session inputs to
native ownership, so later JavaScript update, timing, and spring requests fail
closed until the optional detachment handshake succeeds. Detachment linearizes
with an in-flight gesture sample, stops release decay and its pending frame,
removes the Android listener or iOS recognizer, and returns the exact input
vector before JavaScript regains ownership. A malformed result leaves the
session native-owned. Target deletion, graph destruction, and surface teardown
also remove the input source and invalidate any retained callback token. An
optional nested release-decay definition hands a successful
recognizer end's logical-unit velocity directly to the existing analytical
decay driver: x/y receive their native units-per-second velocity and every
other input receives zero. Direct pan bounds do not clamp the inertial path.
The final pan vector and analytical terminal vector are both evaluated before
the handoff is published; a failure cancels all drivers atomically. Cancel does
not start decay, while the next begin interrupts any release decay still in
flight. Android recycles its `VelocityTracker` on end, cancel, detach, and
surface cleanup; iOS reads `velocityInView:` from the owned recognizer.

In particular:

- Native stack sheet presentation is exposed through `Screen`; an independent
  `Sheet` is intentionally absent until it has a real native lifecycle and
  detent implementation. The fixed-extent `VirtualizedList` prototype is
  deliberately a Solid-owned composition over the verified ScrollView path.
  Platform-owned view pooling is verified on iOS and experimentally on Android;
  renderer-visible logical identity reuse and variable-height measurement
  remain open.
- JavaScript-owned native surface creation and broader native-module/component
  coverage remain open. `solid-native create` now generates an
  application-owned iOS/Android shell that consumes the package-owned binding
  and has mounted a Release signal update on a physical Pixel. Android native
  sources intentionally compile into the exact application's `appmodules`
  target; a prebuilt AAR is deferred until there is an ABI strategy that does
  not break React Native C++ and application Codegen compatibility.

See [the feasibility record](../../../docs/fabric-spike-react-native-0.87.md)
for the complete evidence and next experiment.
