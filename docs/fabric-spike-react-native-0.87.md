# Fabric feasibility spike: React Native 0.87

Date: 2026-08-20

Status: versioned JSI transaction decode, direct Fabric mount, clone-based
update, transport validation, and atomic rollback verified in an iOS simulator.
Release builds on a physical iPhone and Pixel now verify JSI installation,
JavaScript-owned structural commits, exact Fabric revision results, causal
commit-mount lifecycle delivery, Solid signal updates, native press routing,
native stack navigation, revision-aware identity reclamation, and safe surface
teardown.

## Selected baseline

| Dependency or tool          | Selected value              |
| --------------------------- | --------------------------- |
| React Native                | `0.87.0`                    |
| Hermes                      | `250829098.0.16`            |
| Host contract               | `v0`                        |
| Minimum iOS                 | `15.1`                      |
| Xcode                       | `26.6` (`17F113`)           |
| Simulator SDK used by build | `26.5`                      |
| Physical iOS proof device   | iPhone 17 Pro, iOS `26.6.1` |
| Physical Android device     | Pixel 9a, Android `17`      |
| CocoaPods                   | `1.16.2`                    |

The TypeScript representation of this selection is exported as
`REACT_NATIVE_0_87_BACKEND` from `@solid-native/runtime`. Startup code can use
`inspectNativeBackend` or `assertCompatibleNativeBackend` to reject version,
engine, contract, renderer, and platform-proof drift.

## Evidence

Inspection of the React Native 0.87 source found a direct path below React's
renderer:

1. An empty surface can be registered with `UIManager::startEmptySurface`.
2. `UIManager::createNode` resolves a registered component descriptor and
   creates its Fabric shadow node.
3. `UIManager::appendChild` constructs children on an unsealed new node, while
   `UIManager::cloneNode` preserves a node family for later updates.
4. `UIManager::completeSurface` clones the surface root and commits supplied
   root children through `ShadowTree`.
5. A non-React `ShadowTree` commit defaults to synchronous mounting.
6. `UIManager::dispatchCommand` delegates a command for a mounted shadow node.

The repo-owned `SolidNativeFabric` pod compiles exactly those calls. It was
installed into a clean application generated from React Native 0.87 and built
for a generic iOS simulator. CocoaPods resolved 88 dependencies and Xcode built
the 91-target dependency graph successfully, including the local
`SolidNativeFabric` static library and final application link.

A later Release build compiled the same boundary, the JavaScript-runtime-owned instance
handles, the event interceptor, and its Hermes press-handler bundle for generic
iPhone ARM64. The bundle also requests layout after sequence 2 and rejects a
future-sequence read. A signed build of this shell has now also been installed
and launched on physical hardware; its press and cleanup paths are verified
below.

The latest iPhone Release build carries bounded causal context in the JSI
transaction, returns the exact Fabric revision for structural commits, and
observes the mounting coordinator from the main queue. It schedules a
validated `commit-mounted` callback on Hermes only after the target revision,
or a later revision containing it, becomes the coordinator's mounted base.
Wall-clock timestamps bracket the cross-thread operation while mount latency is
measured with a monotonic clock. Command-only transactions intentionally return
no revision and produce no mount lifecycle event. After mount, a one-shot
`CADisplayLink` emits `commit-frame` at the next iOS display callback with
commit-to-frame and mount-to-frame latency. This establishes frame eligibility,
not compositor presentation.

The current harness now tears down the native-only proof tree and resets the
coordinator before it exposes readiness to JavaScript. The checked-in runtime
adapter requires that empty sequence-0 handoff, allocates nodes from 1, and
implements the renderer-facing host contract over the synchronous JSI binding.
The ownership-transfer revision now runs in the signed physical-device bundle;
its full event-driven destruction path now runs on that device.

The destroy path is guarded on both sides of JSI: the adapter tracks successful
create/delete mutations, and the native coordinator must be empty before the
binding unregisters events and stops Fabric. The device proof bundle performs
that teardown after the press-driven commit. It waits for every retained
identity to reach zero before stopping the surface.

The smoke application then started `RCTHost`/Hermes, requested a surface with an
empty module name (which selects `startEmptySurface`), and sent a versioned
host-contract transaction dictionary through the repo-owned coordinator. It
staged and committed an `RCTView -> RCTText -> RCTRawText` tree. An invalid
second transaction staged a text change and then attempted a cyclic insertion;
the coordinator rejected the entire transaction without advancing its sequence.
A valid sequence-2 transaction then cloned the raw text and both ancestor paths.
Simulator logs reported:

```text
SOLID_NATIVE_HOST-STARTED
SOLID_NATIVE_MOUNT-SUCCEEDED
SOLID_NATIVE_ROLLBACK-SUCCEEDED
SOLID_NATIVE_UPDATE-SUCCEEDED
```

A simulator screenshot visibly contained `Solid Native direct Fabric update`.
No registered React application component was requested or rendered. The
generated shell is disposable test infrastructure and is not checked into this
repository; the reusable Objective-C++ harness and podspec are checked in.

The follow-up proof constructed `RCTHost` with the smoke application as its
delegate and installed `__solidNativeHost` from `didInitializeRuntime`, before
the bundle executed. The JSI decoder first rejected a deliberately cyclic
object. After the native rollback left sequence 2 available, JavaScript polled
the guarded surface state and synchronously submitted a valid sequence-2 text
update. The screen visibly read `Solid Native Hermes/JSI update`, and logs
reported:

```text
SOLID_NATIVE_HOST-STARTED
SOLID_NATIVE_JSI-INSTALLED
SOLID_NATIVE_JSI_VALIDATION_SUCCEEDED
SOLID_NATIVE_MOUNT-SUCCEEDED
SOLID_NATIVE_ROLLBACK-SUCCEEDED
SOLID_NATIVE_JSI-SURFACE-READY
SOLID_NATIVE_JSI_COMMIT_SUCCEEDED
SOLID_NATIVE_JSI-UPDATE-SUCCEEDED
```

### Signed physical-device evidence

On 2026-08-19, Xcode built and automatically signed the disposable shell in
Release configuration, embedded the Hermes bundle, installed it as
`dev.solidnative.probe`, and launched it on an iPhone 17 Pro running iOS 26.6.1.
The Debug shell was discarded as evidence because it attempted to reach Metro
on the device instead of embedding JavaScript.

The physical-device bundle submitted JavaScript sequence 1 with causal
operation `physical-mount-proof`. Native observation delivered a
`commit-mounted` event for exact Fabric revision 3. The Hermes handler checked
the event type, sequence, exact returned revision, timestamps, monotonic
latency, and causal operation ID, then synchronously submitted sequence 2. That
follow-up mounted as revision 4. Temporary native diagnostic markers around the
handler call confirmed that both lifecycle callbacks returned without throwing:

```text
SOLID_NATIVE_HOST-STARTED
SOLID_NATIVE_JSI-INSTALLED
SOLID_NATIVE_MOUNT-SUCCEEDED
SOLID_NATIVE_ROLLBACK-SUCCEEDED
SOLID_NATIVE_JSI-SURFACE-READY
SOLID_NATIVE_DEVICE_LIFECYCLE_DISPATCH sequence=1 revision=3
SOLID_NATIVE_DEVICE_LIFECYCLE_RETURNED sequence=1 revision=3
SOLID_NATIVE_DEVICE_LIFECYCLE_DISPATCH sequence=2 revision=4
SOLID_NATIVE_DEVICE_LIFECYCLE_RETURNED sequence=2 revision=4
SOLID_NATIVE_JSI-UPDATE-SUCCEEDED
```

Those markers were used only for the local proof and removed immediately; the
runtime does not emit per-commit production logs. This verifies the exact
revision and lifecycle boundary on hardware. Representative performance is not
yet measured.

The physical press proof then mounted a blue Pressable containing a Text node.
iOS targeted nested Fabric tag 14 and the scheduler listener observed normalized
`topTouchStart` and `topTouchEnd` events. The binding removes React Native's
legacy `top` prefix, resolves the tag through the committed Solid parent graph,
and routes `touchEnd` to the semantic `press` subscriber on logical node 4.
The Hermes handler validated discrete priority and the observed host sequence,
submitted user-blocking sequence 3, and the device visibly displayed `Native
press delivered to Hermes`.

Ten seconds later, sequence 4 removed and deleted the complete logical tree.
The proof polled `retainedNodeCount` until it reached zero before calling
`destroySurface`. React Native 0.87 starts an empty-module surface without
loading ReactFabric, but its stop path still expects ReactFabric's
`RN$stopSurface` global. The pinned binding now installs a no-op React-side stop
handler only when that global is absent; the Solid-owned empty tree remains the
authoritative cleanup. The final device screen was empty, the live console
reported no exception, and the application process remained alive after
teardown.

### Checked-in device integration target

The previously disposable shell is now represented by `apps/native-e2e`. It
uses workspace dependencies, resolves the `SolidNativeFabric` podspec through
the installed Fabric Host package, keeps a portable dependency-relative lockfile,
uses portable pnpm/Xcode paths, embeds its Release bundle, and receives signing
settings only through the environment. A signed build of this checked-in target
compiled, installed, launched, and retained a live process on the same physical
iPhone.

Its application entry imports `react-native/setup-env` explicitly. An empty
Fabric surface does not load ReactFabric or AppRegistry, so it also does not get
React Native's usual timer and microtask setup transitively; Solid's scheduler
requires that environment even though React never renders the application. The
entry then mounts a Solid-generated TSX tree and defines a signal-driven press
update, lifecycle/measurement assertions, and deterministic renderer disposal.

The target also contains a Release XCUITest that foregrounds Settings for a real
lifecycle transition and reactivates the target. The runner extracts application
logs from the Xcode result bundle and fails unless the synchronous,
asynchronous, AppState-event, initial-mount, initial-frame, and native
event-update markers are present. On the attached iPhone running iOS 26, XCTest
drops the target's accessibility descendants after this lifecycle activation
even though the Fabric surface visibly returns and accepts a physical tap.
Consequently, the full lifecycle-plus-press chain is a manual iPhone proof
today; Android automates the whole chain. Promoting the lifecycle test into
device CI and closing that iOS automation gap remain open.

The Android half is a checked-in ARM64 Release shell using the same application
bundle and portable transaction coordinator. On a wired Pixel 9a running
Android 17, its AndroidX instrumentation test located the accessible Pressable,
injected a touchscreen gesture, observed the signal text, waited for
revision-aware identity reclamation and teardown, and verified that the
Activity survived. The run emitted all eleven stable `SOLID_NATIVE_*` proof
markers and completed one test with zero failures. Its mount lifecycle now
comes from React Native's post-effect UI-thread mount hook rather than the
synchronous commit-return boundary. A `Choreographer` callback then closes the
same causal chain at Android's next frame opportunity.

On both the physical iPhone and Pixel, the React-free bundle also resolves
`PlatformConstants` through React Native's TurboModule registry before it
mounts the Solid tree. The module reports React Native 0.87.0 and
platform-specific native constants. It then resolves the platform Linking
TurboModule and awaits its `getInitialURL` promise. Together, these prove that
the empty Fabric surface bootstrap retains synchronous and asynchronous native
module paths without requiring a React component renderer or AppRegistry.
After the tree is ready, each device backgrounds and reactivates the app so the
native `AppState` TurboModule must deliver a lifecycle event into Hermes before
the physical press proof can complete. This closes the third native-module
shape: event emission.

The same checked-in application declares `SolidNativeGeneratedView` in a
TypeScript Fabric spec. React Native Codegen produces its C++ descriptor and
typed `label` prop binding; the iOS component view and Android view manager are
registered through the ordinary platform extension points. Solid creates the
generated view directly in its TSX tree, Fabric mounts the purple native label,
and the host returns positive current-revision layout on both physical devices.
No generated React wrapper is imported or rendered at runtime.

The first physical screenshot appeared black even though UIKit inspection found
the Fabric paragraph and view components mounted, visible, and correctly sized.
The cause was React Native's low-level `RawProps` contract: unlike the React
renderer, the direct Solid transaction path had not converted color strings to
React Native's processed iOS color integers. The runtime adapter now performs
that pinned React Native 0.87 normalization for style and direct color props and
rejects invalid colors before JSI. Repeating the signed Release proof visibly
rendered a white surface, the revision-and-latency text, and the blue JSI-owned
event target.

## Important constraints

### Event identity is coupled to `InstanceHandle`

`UIManager::createNode` accepts an `InstanceHandle`. Passing null is unsafe for
an event-capable node: `EventTarget::getTag` dereferences it. The JSI commit path
now allocates the Fabric tag and `InstanceHandle` together, gives every created
node a frozen `{ surface, node }` backing object, and retains that object in
runtime-owned native state. Identity insertion is rolled back if the native
transaction fails. The smoke proof mounted an event-subscribed JSI subtree,
reported retained identities, terminated, and relaunched successfully.

The initial native-only smoke tree still uses the compatibility overload with
null handles. Application-created nodes cannot take that path. Successful JSI
identities deleted by an application commit are retired against the exact
Fabric shadow-tree revision. Their JavaScript backing values and native event
routes are released on the Hermes thread only after the platform reports that
revision, or a later coalesced revision, as the mounting coordinator's base.
iOS polls that base on the main queue. Android receives React Native's
post-effect `UIManagerMountHook` callback on the UI thread and reads the base
revision there. The same observations emit opt-in commit lifecycle telemetry.
The stop path releases all remaining retired identities after a guarded surface
stop.

Fabric's `EventDispatcher` invokes registered `EventListener` callbacks before
its normal JavaScript event queue and stops default dispatch when a listener
returns true. The binding now uses that seam, resolves Fabric tags against the
committed Solid node table, converts payloads on the owning runtime through
`RuntimeScheduler`, and suppresses all events for Solid-owned tags. Only events
still subscribed when Fabric dispatches them reach JavaScript. React Native's
normalized `topEventName` vocabulary is converted back to native event names,
and bubbling semantic events walk the committed Solid parent graph so a nested
text target reaches its Pressable owner. A real iPhone gesture now proves the
complete native-to-Hermes path. The proof treats initial native screen focus as
an explicit synchronization barrier before measuring or observing AppState.
This keeps subsequent exact commit assertions deterministic whether the app
started from its registered URL or through its ordinary launcher activity.

### Application props retain their JSI ownership boundary

The synchronous Hermes commit threads its owning `jsi::Runtime` through the
transaction coordinator. Fabric props are reconstructed as runtime-owned JSI
values and passed through `RawProps(jsi::Runtime &, const jsi::Value &)`, so the
application path does not depend on React Native's deprecated dynamic
constructor. `RawProps(folly::dynamic)` remains isolated to the native-only
feasibility mount because that diagnostic deliberately runs without a
JavaScript runtime.

### The public host vocabulary is not the Fabric vocabulary

Solid Native exposes `RootView`, `View`, `Text`, `Pressable`, and other semantic
components. Fabric registers lower-level component descriptors. The backend
owns explicit mappings for built-ins and normalizes raw text as `RawText`
children of a paragraph-capable text node. A custom native component uses the
same validated identifier on both sides: Solid's registered descriptor admits
it at application startup, and React Native Codegen registers its Fabric
descriptor and platform view. Unregistered names fail during staged shadow-node
materialization rather than entering the mounted tree.

ScrollView is the first built-in whose public tree intentionally differs from
its native tree. The Solid facade inserts a hidden `ScrollContentView`, applies
`contentContainerStyle` there, and retains the public ref on the outer scroll
node. The backend maps that content node to `RCTScrollContentView` on iOS, a
regular `RCTView` for vertical Android scrolling, or
`AndroidHorizontalScrollContentView` for horizontal Android scrolling. Physical
iPhone and Pixel runs verify a command-only `scrollTo` sequence, its real
continuous positive-offset event, the resulting Solid commit, and current
geometry.

Image also needs a public-to-Fabric prop boundary. The Solid facade converts a
string URI to Fabric's source array, derives optional source dimensions into the
style cascade, supplies clipping and `cover` defaults, and enables load/error
delivery only when subscribed. Signed iPhone and Pixel runs decode the same
offline PNG and verify a direct `load` event with decoded dimensions. The host
normalizes that semantic event to default priority on both platforms: Android's
legacy coalescing route otherwise labels resource completion as continuous.
The resulting Image and ScrollView status writes flush as one exact commit,
preserving Solid's atomic transaction boundary. The Pixel causal proof retains
the programmatic `scrollTo` operation through a named ScrollView computation
and its command-only commit. Because Image load and scroll delivery are
independent in time, each native event parents an explicit bounded task; both
tasks and both named status computations then cause the shared structural
commit, mount, and next frame without retaining command arguments or decoded
event payloads.

ActivityIndicator also has behavior above its raw descriptor. The Solid facade
owns animation/hiding defaults, centers a 20-point or 36-point named spinner (or
a caller-sized numeric one) in a styleable container, and keeps accessibility
and refs on the native indicator. The backend resolves the portable component
to `ActivityIndicatorView` on Apple platforms and `AndroidProgressBar` on
Android, where it supplies the constructor-only progress style and
indeterminate mode. Both signed device runs verify the platform accessibility
wrapper and positive native geometry.

TextInput demonstrates a platform-specific descriptor alias behind one public
component. The backend maps Solid's `TextInput` to `AndroidTextInput` on
Android and `RCTTextInput` on iOS. Its Solid facade always observes the native
change event, validates and mirrors `eventCount` into
`mostRecentEventCount`, drops stale edits, and advances same-text native echoes
without invoking application change handlers twice.
Public `value`/`defaultValue` become the native shadow node's actual `text`
prop, and `setTextAndSelection` includes React Native's required event-count
argument. The host maps the platform change event to direct, discrete
`changeText` input. Signed Pixel and iPhone runs focus the real editor, type
through platform UI automation, then prove a programmatic Solid value replaces
the actual editor and visible mirror at a current or newer Fabric sequence. The
facade also replaces React Native's React-only text/selection synchronization
hook: it validates controlled ranges, tracks native selection, and reconciles
changed text or selection with the latest event count. Renderer flushes await
these framework-owned commands and keep every command isolated from structural
transactions, including updates racing an asynchronous commit. Both physical
devices accept a controlled caret at offset 5 and insert `X` there. Android
reports the programmatic selection range; iOS suppresses that callback and
reports the user-driven range after insertion. The host normalizes either as a
direct, default-priority `selectionChange`. Native state can advance
independently of those Solid commits, so the backend rebases retained nodes and
commands onto `UIManager`'s newest mounted ShadowNode-family member before use.
The physical iPhone proof caught this at the sensitive
insertion-to-controlled-restoration boundary; preserving the latest
attributed-text event count makes that restoration deterministic. The facade
also owns React Native-compatible `submitBehavior` defaults, including the
deprecated `blurOnSubmit` input. Both devices then press the native return key
and prove that a direct, discrete `submitEditing` event carries the current
controlled text before the editor emits blur and Solid mounts the result.
Multiline inputs expose `numberOfLines`, native content-size events, and
`keyPress`. The host normalizes `contentSizeChange` to direct default priority
and `keyPress` to discrete bubbling input; Android's input-connection watcher is
enabled only when subscribed. Both signed device runs observe `Enter`, type
`Solid`, Return, and `Native` into an intrinsically sized editor, commit the
controlled value through Solid, observe positive native content-size growth,
and prove newline mode retains focus without submit or blur.

Switch adds a second stateful wrapper-elimination proof. The portable facade
derives accessibility checked/disabled state, subscribes to the native change,
and delivers both a boolean `onValueChange` callback and the semantic event.
Because Android and UIKit eagerly mutate their control before emitting, a
rejected controlled toggle schedules an isolated `setValue` command; a revision
counter ensures repeated identical rejections are not lost to signal equality.
The backend maps `Switch` to `AndroidSwitch` or UIKit `Switch`, maps the command
to `setNativeValue` or `setValue`, converts direct and false/true track colors
to React Native's processed-color representation, and disambiguates the generic
native `change` name with the node's declared subscription. Both signed devices
physically toggle the control, observe discrete bubbling input, and verify the
real native value is restored. The command advances the logical sequence but,
as expected, emits no structural mount lifecycle revision.

Modal exposes a platform-lifetime difference that cannot be papered over by a
shallow descriptor alias. Android's native manager ignores `visible=false` and
expects the host view to leave the mounted tree; UIKit must retain that same
view until its animated dismissal completion emits `onDismiss`. Host contract
v1 carries the native binding's stable platform identity, and the Solid facade
uses the renderer's exact revision-mount barrier to sequence the Android
structural park while keeping the iOS EventEmitter live until completion. The
signed Pixel run proves system Back reaches `onRequestClose`; the signed iPhone
run proves UIKit's late `onDismiss` reaches Hermes before the host is parked.

Screen navigation is the first substantial third-party Fabric-container reuse.
The public `Screen` and `ScreenStack` facades map to `RNSScreen` and
`RNSScreenStack`, while `NativeStack` retains stable Solid owners keyed by
history entry. The normal-launch proof pushes a detail screen in exact commit 7.
A real iOS left-edge gesture or Android system Back then produces a
platform-originated history transition and exact pop commit 8 without replacing
the root screen's content handle. The current automated matrix additionally
cold-launches a registered URL as commit 1, mounts its native-focus reaction as
commit 2, and resets to a clean root as commit 3. Later, application push and
detail focus mount commits 9 and 10; physical pop and restored-root focus mount
commits 11 and 12; a second live URL and its focus reaction mount commits 13
and 14.

The host maps native `appear`/`disappear` to semantic `focus`/`blur` and
normalizes both to direct default-priority lifecycle events. Android does not
reliably emit `disappear` when another screen covers or replaces one, so one
focus event exclusively updates every keyed screen's Solid focus accessor.
Direct blur callbacks remain reserved for genuine backend events.

The backend now pins `react-native-screens` 4.27.0, whose stable release line
explicitly supports React Native 0.87. That upgrade removed the repository's
former Android Fresco-nullability and iOS `RCTCxxBridge` compile guards because
equivalent fixes are upstream. The remaining patch is behavioral: Android
reuses upstream's latest-request-wins icon resolver for tab items, while iOS
rejects an asynchronous icon result whose source or rendering mode no longer
owns the request. Android's host also forwards the predictive/system Back
dispatcher to Hermes so Solid's history state remains authoritative.

### Upstream API stability remains a risk

These headers are shipped by React Native but are not a stable framework-neutral
API. The pod pins all three Fabric subspecs to `0.87.0`; an upgrade fails during
dependency resolution until the boundary is compiled and reviewed against the
new release.

## Next executable proof

The NativeHistory-to-ScreenStack and controlled-TextInput proofs are complete
on both physical platforms through counted text/selection synchronization,
single-line submit/blur, and multiline newline/content-size behavior.
Composition/IME and keyboard avoidance remain separate compatibility work. A
physical Pixel Release process now exercises 30 sustained native-stack
push/system-Back cycles while retaining one Java container and keyed root owner
and balancing all detail owners. Broader sustained-update workloads should
continue exercising bounded memory before SDK claims broaden.

The generated-component experiment is complete. ADR 0001 remains Proposed
until the pinned backend has gone through one upgrade rehearsal, as required by
the decision record.
