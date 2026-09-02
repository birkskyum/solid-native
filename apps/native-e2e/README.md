# Native physical-device integration

This checked-in React Native 0.87 shell exercises the production Solid Native
path beneath React's renderer. Its application tree is compiled with Solid's
universal transform and committed through `NativeFabricHost` directly into an
empty Fabric surface.

Solid TSX uses the pinned `@dom-expressions/compiler` OXC backend exclusively.
`@solid-native/metro` composes that compiler's source map with Metro's map
before the Release bundle reaches Hermes. React Native's Babel transform still
handles its platform and module lowering after OXC has removed JSX;
`babel-preset-solid` is not part of the application graph. The separate React
control entry bypasses the Solid transform and uses a distinct Metro cache key.
The physical Android command then inspects the generated source map and fails
unless the bundle contains exactly one matching browser Solid/signals runtime
pair and no JavaScript wrapper from `react-native-safe-area-context`. This
guards against Metro resolving ESM imports to `solid.js` while a CommonJS
dependency independently resolves `solid.cjs`, and prevents native-component
reuse from silently introducing a second React-owned context/component layer.
The development config also forces workspace application modules through a
complete runtime reload. Metro's React Refresh heuristic cannot safely replace
mounted Solid owners, so retaining them across edits is forbidden until Solid
Native owns an explicit HMR lifecycle.

The framework-neutral host can be qualified independently from Solid on either
physical platform:

```sh
pnpm android:fabric-host:test
SOLID_NATIVE_IOS_DESTINATION=<core-device-id> \
SOLID_NATIVE_IOS_TEAM=<development-team-id> \
  pnpm ios:fabric-host:test
```

Both Release proofs bundle only `@solid-native/fabric-host` plus
`@solid-native/host-contract`, reject Solid and every higher framework package
from the generated source map, then require a physical press, native update,
Fabric mount/frame lifecycle, exact tree teardown, and process/package cleanup.

The physical-device scenarios prove the following. Android and iOS automate the
complete current sequence, including the external storage, notification, and
camera graph. Android additionally makes independent operating-system assertions
for notification contents, CameraX streaming, and camera release:

`solid-native.compatibility.json` records the deliberately narrower public
compatibility claim backed by these scenarios. `pnpm compatibility:check`
re-audits AsyncStorage, Notify Kit, and screens independently at their exact installed
versions, validates each platform/category/evidence reference, and leaves the
rest of the discovered schema visibly unclaimed. It checks that the reviewed
claim has not drifted; it does not replace running the referenced physical
scripts.

1. Hermes receives the versioned JSI host before application code runs.
2. Solid Native's pinned platform service resolves React Native's
   `PlatformConstants` TurboModule without a React component renderer, validates
   the 0.87.0 runtime and native platform, and keeps its internal import out of
   application code. The app also loads the checked-in React-free ABI and frozen
   audit descriptors generated alongside the app component from AsyncStorage's
   and Notify Kit's dependency-owned Codegen specs through the CLI's explicit dependency plan,
   including a frozen path-free binding fingerprint, without resolving or
   initializing that module before the resource gate.
3. The same validated service resolves the platform Linking TurboModule's
   asynchronous initial-URL promise without React or AppRegistry. The automated
   device run is launched through the registered URL and receives that exact
   cold-start value. After the explicit intensive-proof press, the shell loads
   the external AsyncStorage 3.1.1 Codegen TurboModule through its generated
   registry resolver and `@solid-native/storage`, proving both the callable ABI
   surface and a SQLite-backed set/get/remove round trip without rendering
   React. It then resolves the autolinked New-Architecture-only Notify Kit
   10.5.0 module through its generated application ABI and the wrapper-free
   `@solid-native/notifications/notify-kit-10` adapter, requests the
   real platform permission, displays a local notification, and projects its
   foreground delivery event into an owner-bound Solid accessor. Delivery
   mounts visible commit 5 from the default-priority platform event, root
   owner, and named notification output. Android opens the real notification
   shade and taps the OS body; its discrete press mounts user-blocking commit 6
   from the same owner/output without retaining notification callback values.
   The Release source-map gate requires that product adapter and the generated
   binding exactly once while forbidding Notify Kit's JavaScript facade.
   Finally, it
   autolinks VisionCamera 5.2.2 plus its Nitro dependencies, maps camera
   permission and device metadata through `@solid-native/camera`, and opens a
   real back-camera session plus generated native preview, then captures a JPEG,
   all owned by Solid without invoking VisionCamera's React hooks or rendering
   a React component tree.
4. `createNativeHistoryFromLaunch` resolves the URL into an isolated one-entry
   stack. The main exhaustive harness deliberately leaves process restoration
   to its dedicated targets, so Solid mounts and measures this native screen in
   commit 1 with no restored screen available behind Back.
5. The native screen's real `appear` event focuses its keyed Solid owner. The
   per-screen accessor mounts visible focus state in exact commit 2.
6. The proof resets to a fresh one-entry root stack in exact commit 3 before
   continuing, verifies the cold URL did not remain behind it, then waits for
   the restored root's native focus accessor to mount in exact commit 4.
7. React Native Codegen generates a custom Fabric descriptor and native prop
   binding from the checked-in TypeScript component spec.
8. Solid mounts RootView, Text, View, Pressable, Image, ActivityIndicator,
   ScrollView, its required platform content container, and the generated
   native view in commit 3 without rendering a React component.
   The same tree exposes explicit labels, roles, hints, identifiers, and state
   through the platform accessibility hierarchy. Android verifies native
   heading, ImageView, accessible progress-container, Button, ScrollView, and
   editable TextInput semantics; iOS verifies the corresponding static text,
   Image, activity-indicator wrapper, Button, text field, and multiline
   text-view elements.
9. Fabric reports the exact mounted revision and core, Image,
   ActivityIndicator, ScrollView, and generated view layout are measurable;
   the platform then reports the first frame callback eligible to display that
   revision.
10. The camera session mounts VisionCamera's generated `PreviewView` in exact
    commit 7. The preview output crosses Fabric as an owner-scoped typed resource
    handle whose registry restores the exact Nitro object. Android independently
    requires a previously available physical camera to become unavailable and a
    shown, positive-size native PreviewView to reach CameraX `STREAMING` state.
    The asynchronous session request and ready settlement stay inside a bounded
    `camera.session.preview` task; that task, the root owner, and
    `camera.preview.output` must be the exact three causes of the preview commit,
    matching mount, and next frame without exporting the resource handle.
11. Once the native preview output is attached, CameraX transitions the same
    hardware session back to `OPEN`. `createCameraSessionEvent` receives that
    real `started` callback as `platform.camera.session.started` and mounts
    commit 8. The platform event, root owner, and
    `platform.camera.session.output` are the exact three causes of its normal
    commit, matching mount, and next frame. No camera identity or callback
    payload enters telemetry. Android's ordinary background transition leaves
    this independently owned session open, so interruption/resume remains a
    distinct contention or operating-system-pressure gate.
12. The running session captures a real JPEG with shutter sound disabled,
    disposes the in-memory Nitro `Photo` after writing its temporary file,
    validates portable path/dimension/orientation/format/timestamp metadata,
    and mounts the result in exact commit 9. An explicit `camera.capture`
    causal scope, enclosing named Solid owner, and `camera.capture.output`
    computation must be the exact three causes of that normal-priority commit.
    Capture or settlement failure explicitly fails the task; success continues
    through the matching mount and next frame without recording photo metadata.
    AppState acceptance is armed before this visible checkpoint mounts, so a
    fast accessibility observer cannot lose the following lifecycle event.
13. `createAppState` exposes the validated native lifecycle as a fine-grained
    Solid accessor with owner-bound cleanup. A real background/foreground event
    enters as a private `platform.app-state.change` operation, updates it, and
    mounts commit 10. The platform event, `e2e.root`, and
    `platform.app-state.output` must be the exact three commit causes; the proof
    then requires the matching host revision, mount, and next frame without
    recording the lifecycle value.
14. A real press bubbles from Fabric into the Solid-owned handler.
15. A Solid signal produces user-blocking commit 11 and visible text.
16. The same physical interaction resolves a Solid 2 promise computation; its
    `Loading` fallback is replaced by ready content in commit 12.
17. A native `scrollTo` command advances sequence 13 without inventing a mount
    revision. The command retains the ScrollView's named Solid output cause
    without recording arguments. Its real scroll event returns to the owning
    Solid node with continuous priority and a positive content offset.
18. The native Image decodes an offline PNG and returns a direct,
    default-priority `load` event with positive decoded geometry.
19. Solid batches the visible Image and ScrollView results into exact commit 14
    and verifies fresh, positive native geometry for the scroll view. Each
    event parents a bounded task scope that crosses the asynchronous wait; the
    shared commit must contain both tasks, both named output computations, and
    the root owner before continuing through its exact mount and next frame.
    Event payloads and command arguments remain outside telemetry.
20. Application navigation pushes a detail entry into a real native
    ScreenStack in exact commit 15, mounts its `ScreenHeader` as a real platform
    toolbar, waits for the native transition, and measures the detail content.
21. The detail screen's native focus event exclusively updates the keyed
    per-screen accessors, mounts visible focus state in commit 16, cleans the
    covered root's focus-owned work, and starts exactly one detail scope.
22. A physical iOS left-edge gesture or Android system Back action reaches the
    platform-transition path. On Android, the first real Back is held by a
    TanStack blocker and the detail screen must remain; the blocker releases
    itself and the second Back produces the platform-originated history pop.
    Each callback returns its consumed boolean synchronously. Its bounded event
    retention finishes after the asynchronous blocker decision; the denial
    produces no structural commit. The allowed action re-enters the discrete,
    private `platform.hardware-back.press` event and produces user-blocking
    commit 17. That event and `e2e.root` must be the commit's exact two causes
    before the matching mount and frame. Solid restores the retained root screen
    without replacing its direct content handle, and the root's native focus
    mounts visible state in commit 18 while reacquiring focus-owned work.
23. The operating system opens the app's registered URL again. React Native's
    native Linking path delivers the default-priority, private
    `platform.url.open` event to Hermes, `NativeHistory` records a
    system-originated push, and Solid mounts the resolved screen in exact commit
    19 inside the real native stack. The event, `e2e.root`, and only the new
    screen's `navigation.focus.output` must cause that normal-priority commit,
    mount, and frame without exporting the URL. Native focus drives commit 20. All three
    navigation focus commits must preserve their exact native lifecycle event,
    static Solid owner, named focus-output computation, Fabric mount, and next
    platform frame as one causal graph.
24. After a commit-21 readiness barrier separates navigation measurement from
    device input, a real native TextInput receives physical keyboard events.
    Its direct, discrete `changeText` payload advances the monotonic native
    event counter, Solid reconciles the controlled value in commit 22, and a
    fresh measurement observes that commit or a later native acknowledgement.
    Every native `changeText` operation contributing to that commit—including
    controlled same-text acknowledgements consumed inside the facade—must join
    the static root owner and exactly one `input.text.value.output` computation,
    then preserve the exact commit-to-mount-to-next-frame chain. The proof
    reports application-visible and contributing native event counts separately
    and rejects telemetry containing the typed value.
    Solid then replaces the value through a counted native command; the
    platform editor and visible mirror both show the replacement. A second
    counted command places the caret at offset 5, where the physical device
    inserts `X` to produce `SolidX controls Native`. The command must retain
    the static root owner and `input.text.value.output` computation across its
    asynchronous dispatch and into exactly one isolated command commit;
    telemetry must contain neither its arguments nor the controlled text.
    Android reports the
    programmatic selection callback while iOS intentionally suppresses it and
    reports the subsequent user range; both routes arrive as direct,
    default-priority `selectionChange`. Solid restores the controlled editor
    value with the latest event count. The physical insertion must retain every
    contributing change operation, the root owner, and editor-output
    computation through its user-blocking commit, mount, and frame. Successful
    selection callbacks remain non-causes because their handlers only validate
    the caret, and telemetry must contain neither the inserted nor restored
    editor value. The device then presses the editor's real return key; a
    direct, discrete `submitEditing` event carries the
    current controlled text, the native editor blurs, and Solid mounts both
    observations. The visible result must retain exactly one
    `input.text.submit.output` computation and the submit event through its
    user-blocking commit, Fabric mount, and next frame. The successful blur
    remains an independent observation because its handler performs no write,
    and telemetry must not contain the submitted text.
25. Solid replaces the single-line editor with an intrinsically sized
    multiline editor. The device types `Solid`, Return, and `Native`; Return
    first arrives as discrete bubbling `keyPress` with key `Enter`, then inserts
    a newline instead of submitting. A direct, default-priority
    `contentSizeChange` reports positive native growth while the editor remains
    focused and emits neither submit nor blur. Solid coalesces the controlled
    two-line value, and all contributing direct changes must join the static
    root owner and exactly one `input.multiline.value.output` computation
    through the user-blocking commit, Fabric mount, and next frame. Successful
    key and intrinsic-size operations remain non-causes because they perform no
    Solid write. The proof reports observed and contributing change counts
    separately and rejects telemetry containing the two-line value.
26. The device physically enables the real native Switch. Solid receives a
    discrete bubbling `valueChange`, invokes both public callbacks, then rejects
    the eager platform toggle because the controlled value remains `false`.
    An isolated command restores the platform control without inventing a
    structural mount. The command must retain both the input operation and the
    static `input.switch.controlled.output` computation, then preserve
    user-blocking priority in its command-only commit without recording the
    event payload or command arguments. Android and iOS accessibility both
    observe the value return to off, and a command-aware measurement sees
    current positive geometry. The Pixel causal gate also requires that
    measurement to retain the same named output while exporting only its
    observed commit sequence, never the returned geometry.
27. A device-visible handoff presents the real platform Modal. Both backends
    route `onShow`; Android sends system Back and requires direct
    `onRequestClose`, while iOS presses the native close button and requires
    UIKit's asynchronous `onDismiss` completion. Solid reconciles `visible`
    and the underlying modal disappears before the root content is inspected
    again. On Android, the physical presentation press directly owns the
    user-blocking presentation commit; `show` then owns a normal-priority
    status commit; system Back owns the normal-priority visibility
    reconciliation. Each joins `modal.lifecycle.output`, the root owner, exact
    Fabric mount, and following frame without recording event payloads.
28. The owner-bound navigation persistence observer flushes its latest snapshot
    through AsyncStorage. The proof reads it back, applies the bounded versioned
    decoder, and requires its active href to equal live history before removing
    the test value.
29. Native teardown cancels the delivered notification and requires the module's
    displayed-ID query to remove it. Android instrumentation independently
    requires the expected title/body to appear and disappear through the
    operating system's `NotificationManager`, rather than trusting JavaScript
    markers alone.
30. Disposal stops the owner-bound camera session and Android requires the exact
    camera to become available again. It also removes every logical node,
    releases every retained native resource, waits until retiring Fabric node
    identities are reclaimed, stops the empty surface, and leaves the process
    alive.

A direct launch without an initial URL takes a shorter startup path. It now
waits for the root screen's native `focus` event, flushes that accessor update
as commit 2, and advances the proof's sequence offset before any measurement.
This prevents a focus event racing an implicit measurement flush from making
otherwise-current geometry look stale. The isolated Android launch smoke test
covers this direct-launch barrier separately from the complete cold-deep-link
instrumentation scenario.

The cold-deep-link path applies the same barrier after resetting to root. The
physical runner also waits for that focused root and a clickable, nonempty
resource-gate rectangle before injecting its first touch. This prevents a
transitioning accessibility node or delayed focus commit from overlapping
camera acquisition and shifting the later AppState sequence.

The iOS UI test presses Home, reactivates the app, and verifies the real
AppState/Fabric commit through application logs extracted from the Xcode result
bundle. On iOS 26, XCTest can drop the target application's accessibility
descendants after that background/foreground round trip. The runner first tries
to reacquire the live button and otherwise uses its pre-background coordinate
to inject an ordinary touchscreen tap, avoiding any test-only native event
hook. Both physical platforms therefore automate the lifecycle transition,
touchscreen press, signal update, async fallback/reveal, native scroll command
and event, native image decode/load, native stack push, physical platform pop,
cold-start and live deep-link delivery, exclusive screen focus, visible
focus-driven Solid commits, balanced focus-owned setup/cleanup, controlled
native text input, reclamation, and teardown sequence. The text-input coverage
includes counted text/selection
synchronization, single-line submit/blur, and multiline newline/content-size
semantics. The same run proves controlled native Switch event and rollback
semantics plus platform-correct Modal show/dismiss lifetimes. The initial tree
is also queried through each operating system's
real accessibility API to verify component classes, roles, labels, enabled and
selected state, focusability/editability, and scroll or multiline traits. The
Pixel run additionally verifies OS-visible local-notification delivery and
cancellation plus camera acquisition, live native preview streaming, and
release. A focused signed-iPhone Release target now separately proves the new
wrapper-free Notify Kit seam: first-install permission, a separately initiated
native foreground delivery after the app is active again, displayed-ID query,
an exact private event/owner/computation causal Solid/Fabric update,
cancellation, owner teardown, and a still-running host process. Its composed
Hermes map requires the application adapter, generated binding, and versioned
product adapter exactly once while rejecting every Notify Kit JavaScript facade
source. Android remains the only platform whose proof opens the operating
system notification surface and inspects or presses its visible content. The
complete iPhone workload also covers camera permission and enumeration,
generated preview, real JPEG capture, and session stop.
Release
configuration is intentional: both targets embed the Hermes bundle and do not
depend on Metro being reachable from the phone.

Run the focused iPhone notification proof with:

```sh
SOLID_NATIVE_IOS_DESTINATION=<core-device-id> \
SOLID_NATIVE_IOS_TEAM=<development-team-id> \
  pnpm --filter @solid-native/native-e2e ios:notifications:test
```

The runner starts from an uninstalled app, builds and verifies the signed
Release artifact before starting its process guard, and addresses iOS 26's
first-install **Allow** action through SpringBoard when it appears. It requires
the permission result to reach Solid before it performs display as a second
physical tap. This avoids Notify Kit routing delivery to its background channel
while the permission sheet is returning the app from `Inactive` to `Active`.
The exact default-priority notification event, `notification.root` owner, and
named Solid computation must then be the only three causes of the normal Fabric
commit without retaining notification content in telemetry. The runner cancels
through the native service, disposes the owner and surface without terminating
the app, and uninstalls the focused test bundle during guarded cleanup. Remote
push, background execution, rich actions, and Notification Center content
inspection are outside this proof.

The ordinary Android `solidDebug` flavor instead loads the small `dev-entry.tsx`
development target from Metro. It avoids the permission-heavy release proof,
mounts one signal-driven button under Solid's development runtime, and logs
`SOLID_NATIVE_RELOAD_MOUNTED` after every initial or replacement Hermes runtime
owns a clean surface. The target also installs one demand-driven native UI
worklet, waits for its only frame to apply, and requires the scheduler to have
exactly one active graph with zero pending frames before publishing that marker.
This is the physical target for repeated full-reload and resource-lifecycle
verification.

Run the bounded Android reload soak with:

```sh
pnpm --filter @solid-native/native-e2e android:reload:test
```

The runner builds and installs the physical-device `solidDebug` flavor, starts
the validated Solid Native Metro command on host port 8091, reverses the
device's port 8081 to it, and requests 20 complete runtime replacements by
default. Every replacement must mount commit 1 and settle its one native graph
without a pending Choreographer callback while the Android process ID and
process start time remain unchanged. The runner records per-cycle PSS, RSS, and
thread counts, then stops the application, removes the reverse tunnel, and
terminates Metro before publishing `SOLID_NATIVE_ANDROID_RELOAD_RESULT`.
Override the bounded count with `SOLID_NATIVE_ANDROID_RELOAD_CYCLES` (1–100),
the default three-cycle warmup with
`SOLID_NATIVE_ANDROID_RELOAD_WARMUP_CYCLES`,
the host port with `SOLID_NATIVE_ANDROID_RELOAD_METRO_PORT`, or retain JSON with
`SOLID_NATIVE_ANDROID_RELOAD_OUTPUT_DIR`. Resource deltas are diagnostic-only;
they are not, by themselves, a memory-leak or energy verdict.

Run the corresponding bounded iPhone reload and process-resource soak with:

```sh
SOLID_NATIVE_IOS_DESTINATION=<core-device-id> \
SOLID_NATIVE_IOS_TEAM=<development-team-id> \
  pnpm --filter @solid-native/native-e2e ios:reload:test
```

To isolate runtime and Fabric ownership from local-network transport, run the
same soak against a signed in-app `dev-entry.tsx` bundle:

```sh
SOLID_NATIVE_IOS_DESTINATION=<core-device-id> \
SOLID_NATIVE_IOS_TEAM=<development-team-id> \
  pnpm --filter @solid-native/native-e2e ios:reload:bundled:test
```

The signed Debug runner selects `dev-entry.tsx` only through explicit launch
arguments and addresses Metro through the IPv4 address on the Mac's active
default-route interface. Override it with `SOLID_NATIVE_IOS_RELOAD_METRO_HOST`
when the phone and Mac share a different interface. A USB/CoreDevice connection
alone does not expose a Metro port to ordinary iOS applications, so the phone
and Mac must also share an IP network. A dedicated XCTest preflight handles the
first-install Local Network permission and requires a real Metro-backed Solid
surface before measurement.
Because a cold signed build can outlast the phone's Auto-Lock interval, the
runner checks device unlock and host-log-relay state again immediately before
installation. A locked phone waits at that safe boundary for up to five minutes
instead of leaving XCTest waiting with Metro or an application process alive;
override the 1–600 second bound with
`SOLID_NATIVE_IOS_RELOAD_UNLOCK_WAIT_SECONDS`.
The measured phase then requests 20 complete runtime replacements by default,
requires every replacement to publish commit 1 with one settled native worklet,
and verifies that the exact application process ID is unchanged after every
cycle. Activity Monitor records that process's physical footprint, real memory,
resident size, CPU, and thread count. The runner stops the exact test bundle,
Metro, its console stream, and the trace before reporting success, then
uninstalls only `dev.solidnative.reload`. Override the bounded count with
`SOLID_NATIVE_IOS_RELOAD_CYCLES` (1–100), Metro's non-privileged port with
`SOLID_NATIVE_IOS_RELOAD_METRO_PORT`, the development-server host with
`SOLID_NATIVE_IOS_RELOAD_METRO_HOST`, or retain the trace, exported tables, and
JSON reports under `SOLID_NATIVE_IOS_RELOAD_OUTPUT_DIR`. Like the Android
samples, these resource trends are diagnostic evidence rather than a standalone
memory-leak or energy verdict.
The bundled variant uses the same React Native reload command, Hermes runtime
replacement, empty Fabric surface, process-identity checks, worklet settlement,
and Activity Monitor report. It deliberately omits only Metro transport, making
it the stable lifecycle baseline when a tethered phone is not also reachable on
the Mac's IP network. Its UI-automation preflight first requires the signed
bundle to reach the foreground and mount a real Solid tree, so an asleep display
cannot silently turn the resource run into a background-process measurement.

Run the complete on-device development UI on either attached device with:

```sh
pnpm --filter @solid-native/native-e2e android:devtools:test
SOLID_NATIVE_IOS_DESTINATION=<core-device-id> \
SOLID_NATIVE_IOS_TEAM=<development-team-id> \
  pnpm --filter @solid-native/native-e2e ios:devtools:test
```

Both commands use true development Solid and Signals runtimes, reject a locked
device before expensive work, and verify their composed source map against the
complete devtools package seam. The native automation repeatedly opens and
closes the network and causal panels, captures one named Solid update and its
native frame correlation, recovers explicit async, guarded Hermes, and Solid
render failures, removes the runtime bridge, and tears down the surface without
terminating the platform host. The Android path is physically qualified on the
Pixel. The iOS app and UI-test target are compile-qualified; the bounded runner
uses the shared device-process watchdog and awaits an unlocked-device run.

Run the demand-driven causal snapshot transport on either attached device with:

```sh
SOLID_NATIVE_ANDROID_SERIAL=<serial> \
  pnpm --filter @solid-native/native-e2e android:causal-debug:test
SOLID_NATIVE_IOS_DESTINATION=<core-device-id> \
SOLID_NATIVE_IOS_TEAM=<development-team-id> \
  pnpm --filter @solid-native/native-e2e ios:causal-debug:test
```

The Android runner leases and restores wired stay-awake state, rejects a secure
keyguard before building, and runs an isolated `solidDiagnosticsDebug` flavor
from a guarded Metro process. The iOS runner signs a Debug build whose
development Hermes bundle is embedded at build time and selected only by the
proof launch argument, so it does not depend on a resident Metro server.
Ordinary optimized Release builds still resolve the inert diagnostics
controller and keep the native mailbox disabled.

Both runners require the captured timeline and generated Perfetto trace to
retain the complete surface → commit → mount → frame chain. They then open one
1,200 ms diagnostics session while a named Solid signal drives a named native
output. The returned value-free artifact must contain that exact write in a
rerun cause chain, positive scope/write costs, no truncation, and no dropped
diagnostics. A causal snapshot taken after the session must also retain the
same named output's computation → commit → mount → frame descendants inside
the bounded capture window. This correlation is physically proven on the Pixel
across 19 complete frame chains and on the iPhone across 29 complete frame
chains; it explicitly does not claim an exact per-rerun token join. The iOS path
uses only CoreDevice launch payloads and app-container copies, requires each
nonce acknowledgement, and leaves no device-log relay or app process running
after the bounded proof. The signed iPhone Debug run captured 48 named Solid
reruns and 72 retained causes with zero causal eviction or discarded records.

The same installed diagnostics workload can now produce its complete offline
debugger without intermediate JSON files:

```sh
pnpm exec solid-native debug report-android dev.solidnative.e2e \
  --serial <serial> --duration 1200 --output causal-report.html
pnpm exec solid-native debug report-ios dev.solidnative.e2e \
  --device <core-device-id> --duration 1200 --output causal-report.html
```

Each command captures diagnostics first and the containing causal snapshot
second, consumes both nonce-bound device responses, and excludes custom causal
attributes by default. `--output` uses private file permissions, publishes
atomically, and refuses to overwrite an existing report. The Android command is
physically qualified on the Pixel: its latest generated report retained 189
native operations, 30 Solid reruns, and 19 complete computation → commit →
mount → frame chains with zero included
custom attributes. The iPhone command is wired into the same signed proof and
awaits an unlocked-device execution.

## iOS physical device

Install workspace dependencies and CocoaPods, sign into Xcode, enable Developer
Mode on the phone, and trust the Mac. The local pod is referenced with a
repository-relative path; no signing identity or machine path is committed.

```sh
pnpm install
pnpm --filter @solid-native/native-e2e ios:pods
xcrun xctrace list devices
```

Set the connected device identifier and the Apple team selected in Xcode:

```sh
export SOLID_NATIVE_IOS_DESTINATION=YOUR_DEVICE_ID
export SOLID_NATIVE_IOS_TEAM=YOUR_TEAM_ID
```

Every physical-iOS command first samples the host process table twice. It fails
before launching when macOS Console is sustaining at least 50% CPU: a Console
live stream from the connected phone can keep CoreDevice's log relay busy,
thermally throttle the phone, and even destabilize Instruments export. Quit
Console or stop its device stream, then rerun. The standalone check is
`pnpm --filter @solid-native/native-e2e ios:preflight`; an idle open Console is
allowed.

Every bounded XCTest or Instruments runner also has a 20-minute device-process
lease. Its detached watchdog stops all `SolidNativeE2E` application and test
processes when either the runner exits or that deadline expires, including when
the host command remains alive but wedged. Set
`SOLID_NATIVE_IOS_PROCESS_GUARD_TIMEOUT_SECONDS` to a positive value of at most
3600 only when a known-slow signed build needs a wider bound.

Build, install, and launch the manual proof:

```sh
pnpm --filter @solid-native/native-e2e ios:release
```

The installed harness stays quiescent until **Start intensive device proof** is
tapped. That explicit gate prevents an ordinary Xcode or CLI launch from
initializing AsyncStorage, notifications, or VisionCamera in the background;
the visible activity indicator is also non-animating. This is especially
important on iOS because AsyncStorage 3.1.1 embeds a Kotlin/Native
`SharedAsyncStorage` framework. Initializing it starts coroutine, keep-alive,
and garbage-collection threads even after storage calls settle. In paired
untouched samples of the same signed iPhone build, moving only that adapter
behind the gate reduced the process from 12–15 to 5–7 threads and from 19.09 to
0.08 interrupt wakeups per second. These short samples diagnose this startup
side effect; they are not a general energy verdict for AsyncStorage or the
application.

The checked-in combined app/dependency binding module is safe to import before
this gate: its descriptors and portable fingerprint are pure and its registry
is injected. `codegen:solid:check` calls the public read-only CLI drift gate;
there is no app-specific generator. The app deliberately waits until the
intensive proof begins before calling the generated resolver, so Codegen
coverage does not regress the quiescent thermal boundary.

Once armed, the proof deliberately keeps a physical camera session open until
its final teardown step. A three-minute watchdog releases storage persistence,
the notification, camera, renderer, and lifecycle resources if the interactive
sequence stalls. You can still stop it immediately before leaving the device
or switching development builds:

```sh
pnpm --filter @solid-native/native-e2e ios:status
pnpm --filter @solid-native/native-e2e ios:stop
```

`ios:status` is read-only and maps each live Solid Native PID back to its test
bundle ID; add `-- --json` for a versioned machine-readable report. This makes
it clear whether a device retained the main proof, a benchmark control, or an
XCTest runner before deciding to stop anything. If the iPhone becomes hot or
slow during development, run `ios:status` first and use `ios:stop` before doing
more device work. The separately installed proof and benchmark bundle IDs can
be alive at the same time. A live PID is not itself evidence of high CPU, so use
the paired idle-resource sampler before classifying the behavior as an app leak.

The build, test, and memory scripts stop every `SolidNativeE2E` executable
before replacing an installed app. Every automated physical test and the memory
sampler also stop both the application and its XCTest runner on success,
failure, or interruption. Each bounded runner also leaves the leased watchdog
behind while Xcode or Instruments owns the device. If the runner is killed too
abruptly for a shell trap to execute, or remains wedged past its bound, the
watchdog performs the same process cleanup. This executable-level cleanup
matters on a physical iPhone: different test bundle IDs can otherwise leave
several app-container processes alive, including a process retaining its camera
session. A normal exit now verifies foreground cleanup before releasing the
detached watchdog. CoreDevice failures receive three bounded attempts; if those
still fail, the shell deliberately leaves the watchdog alive to retry after the
runner exits. Broad cleanup reacquires the process inventory after every
termination, follows replacement PIDs, and requires four consecutive clean
polls before it reports success; iOS cannot hide an immediate scene relaunch
behind a departed original PID. The manual `ios:release` and `ios:control`
launchers keep their one app open for interaction but lease its exact device PID
for 20 minutes. The detached lease stops only that captured process when it
expires instead of broadly terminating every later Solid Native run. Set
`SOLID_NATIVE_IOS_LAUNCH_LEASE_SECONDS` to a positive value up to 3600 when a
different bounded window is necessary, or use `ios:stop` immediately when
finished. Before package compilation or Xcode work, every direct physical
runner reads CoreDevice's lock state and fails unless the phone is currently
unlocked and has been unlocked since boot. The shared preflight also classifies
a missing developer-services tunnel and disabled Developer Mode separately, so
the runner reports the actual device remediation instead of an opaque
CoreDevice command failure or an expensive build that waits at installation.

Raw `xcodebuild` invocations do not source this shell guard. When debugging a
test outside the checked-in `ios:*:test` commands, run `ios:stop` afterward;
otherwise XCTest can leave suspended app-container processes from several
bundle IDs on the phone. A completed guarded product-composition run has also
been followed by an independent `ios:status -- --json` check with
`processCount: 0`.

If XCTest itself times out while enabling device UI automation, every physical
test reads the structured result summary and states that application code never
launched. The remediation keeps the phone unlocked and awake, verifies its UI
Automation developer setting, reconnects USB, and restarts the phone before a
later attempt. Runners deliberately do not retry this failure automatically:
repeated one-minute XCTest handshakes add heat without testing Solid Native.

Send the app to the Home screen once, reactivate it, then tap **Run Solid signal
update**. The lifecycle transition is part of the native-module event proof.

Run the physical-device UI test:

```sh
pnpm --filter @solid-native/native-e2e ios:test
```

The runner requires the synchronous, asynchronous, event-emitting, and
generated-schema/resolver TurboModule markers, the generated-component and
ActivityIndicator measurement markers, the external storage-module,
notification delivery/cancellation,
camera permission/device/session/preview/capture/start-stop, and
durable-navigation markers,
the initial Fabric mount/frame markers, the native observer's
event-update marker, the
Solid signal and async-reveal markers, ScrollView command/event/mount markers,
the Image load and shared causal-commit markers, native navigation
push/back/pop markers, identity
reclamation, cold-start/reset markers, native screen-focus, deep-link
event/mount markers, the controlled TextInput text/selection and submit/blur
markers, the normalized keyboard show/hide marker, the multiline TextInput
newline/content-size marker, the controlled
Switch event/rollback marker, both native Modal lifecycle markers, native
accessibility roles/labels/state for the title, Pressable, Image,
ActivityIndicator, Switch, and both TextInput modes, and teardown.
XCTest first launches with the app's
registered URL, then opens it again through the operating system after the
physical pop. It deliberately
does not synthesize the press, navigation gesture, or either link input through
a test-only native hook. Each input-dependent predicate is a guarded checkpoint:
if it fails, XCTest stops the scenario before sending later keystrokes,
preserving the first causal failure instead of cascading through stale native
state.

The signed iPhone test also requires XCTest to observe the real software
keyboard after focusing the native single-line editor and to observe it hidden
after Return submits and blurs. Independently, the application requires finite,
positive keyboard screen metrics and private, payload-free
`platform.keyboard.visibility` telemetry for both transitions before emitting
the marker enforced by the runner.

Run that keyboard contract independently of camera and other optional device
modules with the focused signed Release gate:

```sh
SOLID_NATIVE_IOS_DESTINATION=<device-udid> \
SOLID_NATIVE_IOS_TEAM=<development-team-id> \
pnpm --filter @solid-native/native-e2e ios:keyboard:test
```

The focused runner installs `dev.solidnative.keyboard`, requires XCTest to
observe the real software keyboard, and fails unless Hermes reports readiness,
an initial native layout, positive normalized metrics, measured content movement
above the keyboard, restoration after hide, a successful private
event-to-measure-to-Fabric-commit causal chain, and terminal owner teardown.

Run the separate focused-field scrolling contract against a signed physical
iPhone Release build:

```sh
SOLID_NATIVE_IOS_DESTINATION=<device-udid> \
SOLID_NATIVE_IOS_TEAM=<development-team-id> \
pnpm --filter @solid-native/native-e2e ios:keyboard-scroll:test
```

This profile installs `dev.solidnative.keyboard.scroll` and uses the real
software keyboard and its physical accessibility frame as the source of truth.
XCTest requires the first native TextInput below the keyboard boundary to move
by a positive amount and finish with at least 15 points of clearance. Its Next
action must focus and reveal a second native editor without another tap or a
keyboard hide; the second Done action must then submit, blur, and hide. Hermes
independently requires both the private keyboard-event-to-two-measurements-to-
`scrollTo` chain and the submit-to-`input.focus.traversal`-to-`focus` command
chain before owner teardown can succeed.

Override `SOLID_NATIVE_IOS_KEYBOARD_BUNDLE_ID` or
`SOLID_NATIVE_IOS_KEYBOARD_SCROLL_BUNDLE_ID` when a globally unique development
bundle identifier is needed. `SOLID_NATIVE_IOS_KEYBOARD_DERIVED_DATA` can move
build products out of the default ignored `ios/build` directory.

The test script reuses an installed Pods project when `Podfile.lock` matches
`Pods/Manifest.lock` and regenerates it when the graph is absent or stale. The
Podfile locally retries CocoaPods 1.16.2's intermittent pnpm-symlink
`Pathname#realdirpath` failure tracked in
[CocoaPods #12866](https://github.com/CocoaPods/CocoaPods/issues/12866); remove
that narrow workaround when the upstream release is fixed.

## Android physical device

Install Android platform-tools and the SDK/NDK versions pinned by the Gradle
project, enable USB debugging on an ARM64 phone, authorize the Mac, and verify
that adb sees it:

```sh
adb devices
```

Run the isolated native safe-area contract with:

```sh
SOLID_NATIVE_ANDROID_SERIAL=<adb-serial> \
pnpm --filter @solid-native/native-e2e android:safe-area:test
```

The proof mounts only `RNCSafeAreaProvider` in commit 1. Its first real native
inset delivery validates and freezes the metrics, releases the gated Solid
content, and mounts `RNCSafeAreaView` without importing the dependency's React
wrapper. Instrumentation requires the autolinked package-native provider/view
types in the Android hierarchy, derives the expected top and bottom overlap
from the same system-bar, display-cutout, navigation-bar, and caption-bar
insets used by the dependency, and compares those physical pixels with the
actual first/last child placement. A touchscreen press must then dispose every
owner, stop the surface, and leave the Activity alive. The checked-in Release
app and instrumentation pass this gate on a physical Pixel. The runner waits
boundedly for terminal Hermes teardown evidence instead of racing the final
native mount.

Run the equivalent signed physical-iPhone gate with a CoreDevice identifier
and Apple development team:

```sh
SOLID_NATIVE_IOS_DESTINATION=<core-device-id> \
SOLID_NATIVE_IOS_TEAM=<development-team-id> \
pnpm --filter @solid-native/native-e2e ios:safe-area:test
```

The XCTest compares the reported top and bottom values with the actual UIKit
accessibility frames around the notch and home indicator, rotates portrait to
landscape and back, and requires each changed snapshot to remain physically
hittable. The application also requires the native `insetsChange` event and
named Solid metrics computation to cause the normal-priority Fabric commit,
with a strict telemetry attribute allowlist, before non-terminating teardown.
The checked-in Release application, source-map policy, signatures, XCTest, and
diagnostic markers pass this gate on a physical iPhone 17 Pro.

Run the isolated Solid-owned pull-to-refresh contract on either physical
platform with:

```sh
SOLID_NATIVE_ANDROID_SERIAL=<adb-serial> \
pnpm --filter @solid-native/native-e2e android:refresh:test

SOLID_NATIVE_IOS_DESTINATION=<core-device-id> \
SOLID_NATIVE_IOS_TEAM=<development-team-id> \
pnpm --filter @solid-native/native-e2e ios:refresh:test
```

The Release entry mounts `RefreshableScrollView` as the real
`AndroidSwipeRefreshLayout` wrapped around a backing `ReactScrollView`, with no
React Native RefreshControl or ScrollView JavaScript facade in its source map.
Instrumentation performs two shell-level touchscreen pulls against the native
wrapper. The first leaves the controlled Solid value false and requires the
corrective `setNativeRefreshing(false)` path to stop the indicator. The second
sets the value true, requires the native indicator to remain active, then sets
it false and requires completion. Both paths must retain the exact Java wrapper
and ScrollView objects before terminal owner/surface teardown. This gate passes
on the tethered Pixel. The iPhone gate builds a fresh signed Release app and UI
test bundle, verifies their signatures and source-map policy, then performs the
same two real pulls against the backing `UIScrollView`. XCTest seals rejected
and completed UI state, retained frame/identity, and terminal removal; exported
device diagnostics seal the transient accepted Solid commit and balanced
teardown. The runner leaves neither app nor test-runner processes alive.

Run the isolated owner-bound status-bar contract with:

```sh
SOLID_NATIVE_ANDROID_SERIAL=<adb-serial> \
pnpm --filter @solid-native/native-e2e android:status-bar:test

SOLID_NATIVE_IOS_DESTINATION=<core-device-id> \
SOLID_NATIVE_IOS_TEAM=<development-team-id> \
pnpm --filter @solid-native/native-e2e ios:status-bar:test
```

The root Solid owner requests visible dark icons. A physically tapped control
mounts a child owner requesting light icons, a second hides the real status bar,
and a third disposes that child. Android instrumentation reads
`WindowInsetsController` and the status-bar inset directly after every step; it
requires the parent owner to restore both dark icons and visibility. A final
touchscreen press disposes the application without terminating its Activity.
The exact Release app and instrumentation pass this gate on a physical Pixel.
The signed iPhone gate checks the required plist ownership mode and verifies
dark glyphs, light glyphs, and fully hidden output directly from physical
screenshots over a controlled neutral backdrop, excluding the Dynamic Island.
Each owner change must also preserve its privacy-safe native press and named
Solid computation in the user-blocking Fabric commit. It then proves parent
restoration and non-terminating teardown; the exact Release app and XCTest pass
on a physical iPhone 17 Pro.

Run the same focused keyboard-avoidance contract without camera and other
optional device modules:

```sh
SOLID_NATIVE_ANDROID_SERIAL=<adb-serial> \
pnpm --filter @solid-native/native-e2e android:keyboard:test
```

The focused test temporarily selects Android's `adjustNothing` policy for its
Activity so operating-system resize cannot satisfy the assertion. It requires
the real IME inset to appear, a Solid-owned measured spacer to move accessible
content above it, the frame to return after submit/blur, all layout/metrics and
private causal markers, and terminal owner teardown. The normal application
manifest remains on its production soft-input policy. Terminal teardown is
activated through Android's real accessible click action after the physical
keyboard interaction, proving that the control is both visible and operable to
assistive technology.

Run the matching automatic focused-field scrolling profile with:

```sh
SOLID_NATIVE_ANDROID_SERIAL=<adb-serial> \
pnpm --filter @solid-native/native-e2e android:keyboard-scroll:test
```

It also forces `adjustNothing`, then requires the first physical editor to move
at least 20 density-independent pixels and clear the real IME by at least 15
pixels. Return must move Android input focus to the second editor while the IME
stays visible, and that editor must remain clear of the IME before its final
Return hides it. The Hermes markers prove that Solid-owned measurement,
`scrollTo`, and `focus` commands—not Android window resizing or an extra
test-driver tap—caused the transitions. The second assertion reads the current
IME inset again because Android can resize the keyboard when Next changes to
Done. Both Release keyboard profiles pass on the physical Pixel.

Build the Release APK, install it, and cold-launch the proof target:

```sh
pnpm --filter @solid-native/native-e2e android:install
```

Verify an isolated ordinary launch mounts and measures the initial tree,
reaches the native-focus barrier, and remains quiescent before the explicit
resource-proof gate. The probe force-stops its exact app process on success or
failure:

```sh
pnpm --filter @solid-native/native-e2e android:launch:test
```

If multiple devices are attached, select one without committing its serial:

```sh
export SOLID_NATIVE_ANDROID_SERIAL=YOUR_DEVICE_SERIAL
pnpm --filter @solid-native/native-e2e android:install
```

Send the app to the Home screen once, reopen it, tap **Run Solid signal
update**, then inspect the stable assertions:

```sh
adb logcat -d -v brief | grep SOLID_NATIVE
```

Or run the checked-in Release instrumentation test on the connected phone. It
cold-launches with a registered `ACTION_VIEW` intent, observes the isolated
deep-link screen and one-entry root reset, backgrounds and reactivates the app,
locates the button through Android accessibility, injects touchscreen input at
its bounds, observes the signal, async, Image, and ScrollView proof text,
requires the native heading, ImageView, progress-container, Button, ScrollView,
Switch, and EditText accessibility classes and their relevant focusable,
clickable, enabled, checked, editable, scrollable, and multiline state,
observes the native detail screen, sends Android's system Back action, verifies
the root returns, delivers a second `ACTION_VIEW` intent to the running app,
observes the live-linked native screen, focuses its native editor, types the
proof value through Android instrumentation, verifies Solid's controlled
replacement in both the editor and visible mirror, presses the editor's return
key, observes submit and blur in Solid, types the multiline proof, physically
toggles the controlled Switch and observes it return to off, presents the
native Modal, sends system Back, requires `onRequestClose`, waits for teardown,
and checks that the Activity survived. The test also observes the operating
system's camera-availability transition while the Solid-owned VisionCamera
session runs, requires a streaming native preview plus the visible result of a
real JPEG capture, and requires hardware release after root disposal:

```sh
pnpm --filter @solid-native/native-e2e android:test
```

After a passing run, the command atomically writes the ignored, machine-readable
receipt `build/device-proofs/android-solid-release.json`. The receipt fails
closed on stale, ambiguous, skipped, failed, or emulator results and binds the
exact instrumentation XML and exit code, application and test APKs, Release
JavaScript bundle, source map and wrapper-free source policy, generated binding
identity, native compatibility fingerprint, Git revision/state, and
privacy-safe physical device identity. The package-owned producer hashes every
build artifact twice around live device collection and never overwrites an
existing evidence file. The runner clears only its ignored default scratch
path; a custom `SOLID_NATIVE_ANDROID_PROOF_RECEIPT` must be new. Validate a
retained receipt's strict schema and inspect its profile without touching the
phone with:

```sh
pnpm --filter @solid-native/native-e2e android:proof:verify
```

This is portable schema-1 execution evidence, not an authenticity claim. A
release control plane can sign the exact receipt bytes later without weakening
or reinterpreting the local physical gate.

The compatibility catalog retains
`device-proofs/android-solid-release-pixel-9a-9f067da.json` as the current clean
Pixel example. Its source revision was clean when tested, its exact bytes are
hash-pinned by every Android `device-verified` claim exercised by that suite,
and the ordinary application test command parses it against the current strict
receipt schema. Replacing it therefore requires a deliberate fresh hardware run
and catalog digest update rather than an undocumented success assertion. The
older `android-solid-release-pixel-9a-024de1d.json` remains only as a schema-0
backward-compatibility fixture; it cannot satisfy release correlation because
that historical schema did not identify JavaScript bundle bytes separately.

The runner requires one authorized, unlocked device (or
`SOLID_NATIVE_ANDROID_SERIAL`), temporarily leases Android's AC-and-USB wired
stay-awake setting across Release preparation and instrumentation, and restores
the exact previous value on success, failure, or interruption. Android devices
can classify an adb-tethered power source either way. The runner wakes the
display, collapses stale system panels, and rejects a remaining secure keyguard
both before preparation and immediately before instrumentation. This prevents
a short screen timeout or notification shade from invalidating the explicit
background/resume proof without permanently changing the developer's phone.

Every physical Android instrumentation runner, plus the ordinary Release
launch proof, shares the same fail-closed device preflight. Each checks the
secure keyguard before starting an expensive build, keeps an already-unlocked
wired device awake for every build and test phase, rechecks foreground
readiness immediately before execution, and restores the exact previous
stay-awake value on success, failure, or interruption. The runner never
attempts to bypass a secure lock.

The proof APK is ARM64-only and locally signed with Android's debug key. It is
an installable Release-mode integration target, not a distributable app.
Every checked-in Android build/test command first rebuilds the app's workspace
dependency graph. The Gradle Hermes bundle tasks also track those compiled
package exports explicitly, preventing an up-to-date bundle from masking a
new Solid Native runtime or renderer build. The shared runner respects
`ANDROID_HOME`, falls back to `ANDROID_SDK_ROOT`, and discovers Android Studio's
standard SDK directory on macOS and Linux when neither variable is set.
The root project pins Kotlin 2.2.10 to the version loaded by AGP 9.2.1; this
also makes AsyncStorage select its matching KSP 2.2.10 toolchain instead of
emitting a version-mismatch warning. Keep those versions aligned when upgrading
the Android build stack. The application module already uses AGP's built-in
Kotlin plugin. The two temporary compatibility flags in `gradle.properties`
remain because AsyncStorage 3.1.1 still applies `kotlin-android` and uses its
legacy source-set DSL; remove them when that dependency supports built-in Kotlin
and the AGP 9 DSL, before adopting AGP 10.

## Android platform-reactivity proof

Run the orientation, appearance, causal, and teardown gate on one attached,
unlocked Android device:

```sh
SOLID_NATIVE_ANDROID_SERIAL=<adb-serial> \
pnpm --filter @solid-native/native-e2e android:platform-reactivity:test
```

The Release app renders only Solid's `createWindowDimensions` and
`createColorScheme` accessors. Instrumentation requests landscape and portrait
on the live Activity, independently checks Android's configuration plus display
and font scales, and requires both direct dimension events to reach their named
Solid computation and exact normal-priority Fabric commit. It then changes the
real Android system night mode away from and back to its captured value and
requires the same event → computation → commit chain for both appearance
deliveries. Event and computation telemetry are strict allowlists and cannot
retain native metric or appearance payloads.

The runner snapshots and restores night mode on success, failure, interruption,
and instrumentation cleanup; orientation remains scoped to the test Activity.
It also requires non-terminating owner teardown, removes both APKs, verifies one
Solid runtime, and rejects React Native's appearance/dimensions hooks while
allowing only its reviewed imperative utilities. This gate caught the custom
Activity failing to forward `onConfigurationChanged` into `ReactHost`; both the
checked-in shell and generated project template now preserve that required
bridgeless lifecycle call.

The symmetric signed iPhone gate uses the same application and source-map
policy:

```sh
SOLID_NATIVE_IOS_DESTINATION=<CoreDevice-id> \
SOLID_NATIVE_IOS_TEAM=<development-team> \
pnpm --filter @solid-native/native-e2e ios:platform-reactivity:test
```

XCTest rotates the live physical device to landscape and portrait, validates
positive finite Solid window snapshots against the independently reported
device orientation, and flushes each delivery through its named causal Fabric commit. It then
changes the device appearance away from and back to the captured preference and
requires both Solid outputs. The test and exit cleanup restore appearance and
orientation, while the signed runner verifies the exact bundle, source map,
code signatures, marker set, non-terminating teardown, and terminal process
cleanup.

## Android and iOS memory-warning causal proof

Run the Android callback-to-frame gate on one connected, unlocked device:

```sh
pnpm --filter @solid-native/native-e2e android:memory-warning:test
```

The Release app subscribes to the generated `SolidNativePlatformAndroid`
TurboModule.
Instrumentation invokes the exact `MainApplication.onTrimMemory` entry with
Android's running-critical level on the device main thread. The generated app
forwards only real pressure levels and `onLowMemory`; `UI_HIDDEN` backgrounding
does not increment the public count. The test requires the native callback,
Hermes event, named Solid computation, Fabric commit, mount, next frame, and
physical teardown tap to form one complete chain. This is deterministic
callback injection on hardware, not a claim that the test created genuine
system-wide pressure. Teardown requires the JavaScript disposal request, the
native `surface-stopped` acknowledgement, and the resolved application disposal
promise independently.

Run the owner-bound memory-pressure gate on one connected, unlocked iPhone:

```sh
SOLID_NATIVE_IOS_DESTINATION=<CoreDevice-id> \
SOLID_NATIVE_IOS_TEAM=<development-team> \
pnpm --filter @solid-native/native-e2e ios:memory-warning:test
```

The signed Release app subscribes directly to the pinned `RCTAppState`
TurboModule's payload-free `memoryWarning` event. After XCTest observes the
Solid owner and initial Fabric frame, it opens a compile-time-only proof URL in
the existing process. AppDelegate posts UIKit's exact
`didReceiveMemoryWarningNotification` on the device main thread; the route is
absent unless the dedicated Release proof defines
`SOLID_NATIVE_MEMORY_WARNING_PROOF`. Success requires the resulting platform
event, named Solid computation, text mutation, Fabric commit, native mount, and
next frame to retain one causal chain without recording a native payload.

XCTest then taps the proof's native teardown control and requires its
accessibility tree to disappear while the process remains foreground. The
runner verifies the Solid runtime in the Release source map and stops all
app/test processes through the bounded iOS watchdog on success, failure,
timeout, or interruption. This proves the physical UIKit-to-RCTAppState path;
it does not claim OS-generated memory pressure or jetsam behavior.

## Physical outbound-Linking proof

Run the direct TurboModule Linking, causal delivery, Settings, and teardown gate
on an attached, unlocked physical device:

```sh
SOLID_NATIVE_ANDROID_SERIAL=<adb-serial> \
pnpm --filter @solid-native/native-e2e android:linking:test

SOLID_NATIVE_IOS_DESTINATION=<CoreDevice-id> \
SOLID_NATIVE_IOS_TEAM=<development-team> \
pnpm --filter @solid-native/native-e2e ios:linking:test
```

The Release app first requires the direct native `canOpenURL` call to resolve
its own registered, scheme-qualified URL. It then calls `openURL`; Android
delivers the exact URL back to the existing `singleTask` Activity, the custom
Activity forwards the intent into `ReactHost`, and the native event emitter
reaches a Solid-owned accessor in Hermes. An explicit commit barrier requires
that private `platform.url.open` event and its named Solid computation to cause
the normal-priority Fabric commit without retaining the URL in telemetry.

The same app calls `openSettings` through the public service. Instrumentation
requires Android's real `com.android.settings` app-details screen and the
`Solid Native E2E` label, sends Back, and checks that the original Activity and
reactive URL state survived. The signed iPhone Release gate makes the same
direct calls with an isolated registered/queryable scheme, requires iOS to
deliver the URL to the existing process, observes the normal-priority causal
Fabric commit, opens the real app-specific Settings page, and reactivates the
same PID with the delivered Solid state intact. Both platforms finish with
non-terminating owner teardown and guarded process cleanup; Android additionally
verifies removal of both APKs. The source-map gate requires the reviewed direct
TurboModule registry and emitter seam exactly once while rejecting both React
Native's `Linking.js` facade and the higher-level navigation package.

## Physical native-alert proof

Run the direct TurboModule/Solid alert gate on one attached, unlocked physical
Android device:

```sh
SOLID_NATIVE_ANDROID_SERIAL=<adb-serial> \
pnpm --filter @solid-native/native-e2e android:alert:test
```

Run the signed Release counterpart on an unlocked physical iPhone:

```sh
SOLID_NATIVE_IOS_DESTINATION=<CoreDevice-identifier> \
SOLID_NATIVE_IOS_TEAM=<development-team> \
pnpm --filter @solid-native/native-e2e ios:alert:test
```

The checked-in Release app presents a destructive operating-system dialog and
a cancellable dialog without evaluating React Native's `Alert.js`. AndroidX
taps the real native button (accepting theme-controlled label casing), sends
system Back for dismissal, and requires both stable application results to
retain their private alert event and named Solid computation through a
user-blocking Fabric commit. The iPhone gate presents UIKit's real alert twice,
selects its destructive and cancel-styled actions, and verifies both stable
button identities through the same causal path. This physical gate caught that
React Native 0.87's Objective-C module returns a string button key even though
its JavaScript spec declares a number; the direct adapter accepts only bounded,
canonical string or numeric indices. The source-map gate admits only the
reviewed adapter/service/owner seam, and telemetry must not contain dialog
content or button identities. Both platforms require non-terminating owner
teardown and guarded process cleanup; Android additionally removes both APKs.

## Physical native-sharing proof

Run the direct TurboModule/Solid sharing gate on one attached, unlocked
physical Android device:

```sh
SOLID_NATIVE_ANDROID_SERIAL=<adb-serial> \
pnpm --filter @solid-native/native-e2e android:sharing:test
```

Run its signed Release counterpart on an unlocked physical iPhone:

```sh
SOLID_NATIVE_IOS_DESTINATION=<CoreDevice-identifier> \
SOLID_NATIVE_IOS_TEAM=<development-team> \
pnpm --filter @solid-native/native-e2e ios:sharing:test
```

The Release app opens Android's real sharesheet twice without evaluating React
Native's `Share.js`. Instrumentation swipes the operating-system chooser when
needed and physically selects a temporary receiver exported only by the test
APK. That isolated receiver verifies the exact `ACTION_SEND`, `text/plain`,
message-plus-URL, URL-only, and subject payloads at the receiving-application
boundary while publishing only safe pass/fail UI text. Both truthful
`presented` results must retain their private platform event through a
user-blocking Solid commit, and share content must remain absent from causal
telemetry. Success requires acknowledged surface teardown, no app or receiver
process, and removal of both APKs. The signed iPhone gate opens UIKit's real
activity popover without loading the
React Native sharing facades, selects Copy to prove a truthful `completed`
settlement, and dismisses a second presentation to prove `dismissed`. Both
results must retain their privacy-safe platform event and named Solid
computation through the user-blocking Fabric commit. The test also proves that
the owner survives both presentations until explicit teardown, leaves the
native host running afterward, validates the Release source map and signatures,
and rejects leftover application or test-runner processes.

## Native-clipboard proof

Run the direct TurboModule/Solid clipboard gate on one attached, unlocked
physical Android device:

```sh
SOLID_NATIVE_ANDROID_SERIAL=<adb-serial> \
pnpm --filter @solid-native/native-e2e android:clipboard:test
```

Run the signed iPhone gate with:

```sh
SOLID_NATIVE_IOS_DESTINATION=<core-device-id> \
SOLID_NATIVE_IOS_TEAM=<development-team-id> \
pnpm --filter @solid-native/native-e2e ios:clipboard:test
```

The proof is deliberately asymmetric. The Release app writes one private text
canary and AndroidX reads it independently through the operating-system
`ClipboardManager`; AndroidX then writes a different canary that the app must
read through the pinned React Native 0.87 TurboModule. The native read must
retain exactly its default-priority platform event, `clipboard.root` owner, and
`platform.clipboard.output` computation through the matching normal-priority
Solid commit without recording either canary in telemetry. The app then writes
the package's documented empty-text clear value, which AndroidX verifies at the
OS boundary. The original device clipboard is restored in a `finally` block,
including on assertion failure. Success requires acknowledged surface teardown
and verified process/package cleanup.

The iPhone proof cannot use `UIPasteboard` from its out-of-process XCTest
runner: that API is unavailable there on a physical device. Instead, the gate
builds and signs a second native-only application. That app archives the full
original pasteboard, seeds the external canary, independently verifies the
Solid Native write and clear, then restores every original item and
representation. This exercises Apple's real cross-application paste sheets
three times. The UI test restores from its `defer`; the shell runner can launch
the helper's recovery-only mode after an interrupted test and preserves the
installed recovery archive if that launch is impossible. The gate also checks
both app signatures, rejects React Native clipboard facades in the target
source map, proves exact private causal lineage, disposes the Solid surface
without terminating the host, and removes both applications and all test
processes.

## Cross-platform secure-storage proof

Run the Keystore and Solid-ownership gate on one attached, unlocked Android
device:

```sh
SOLID_NATIVE_ANDROID_SERIAL=<adb-serial> \
pnpm --filter @solid-native/native-e2e android:secure-storage:test
```

The Release app stores and restores an opaque session canary through
`@solid-native/secure-storage`, then deletes it and proves absence through the
same public contract. AndroidX independently requires the application service
to exist as a non-exportable Android `SecretKey`, inspects the Keychain
DataStore file to prove the canary is not plaintext, and requires both the
Keystore alias and persisted service record to disappear after deletion. The
read settlement must cause the exact normal-priority Solid/Fabric commit, while
neither the key nor value may enter causal telemetry. The bundle gate requires
the complete versioned adapter and rejects `react-native-keychain`'s
React-facing wrapper and runtime enums. Success is withheld until surface,
process, package, and device stay-awake cleanup finish.

Run the matching signed Release gate on one attached, unlocked physical iPhone:

```sh
SOLID_NATIVE_IOS_DESTINATION=<core-device-id> \
SOLID_NATIVE_IOS_TEAM=<development-team> \
pnpm --filter @solid-native/native-e2e ios:secure-storage:test
```

The iOS proof first deletes any prior record, stores the private canary, then
terminates and relaunches the application so Hermes, the Solid owner tree, and
`RCTHost` are recreated. It requires the exact value to survive through the
iOS Keychain, deletes it, verifies absence, and tears down the live surface
without terminating the app. The runner requires the same secret-free causal
markers and facade-rejecting Release source map, and its process guard removes
application and XCTest processes on normal and handled-signal exits; its
detached watchdog also attempts cleanup after abnormal parent loss or timeout.
The adapter defaults to
`kSecAttrAccessibleWhenUnlockedThisDeviceOnly` and disables iCloud Keychain
synchronization.

The native-tabs XCTest includes the equivalent Keychain-backed product
relaunch and logout sequence. It is intentionally not claimed as promoted in
this integration until the complete signed physical-iPhone flow reruns cleanly.

## Android Pressable interaction proof

Run the React-free Pressable gate on one attached, unlocked physical Android
device:

```sh
SOLID_NATIVE_ANDROID_SERIAL=<adb-serial> \
pnpm --filter @solid-native/native-e2e android:pressable:test
```

AndroidX injects one continuous diagonal gesture through the visible bounds,
the configured retained region, beyond that region, and back to the target. It
requires Solid-owned pressed feedback to remain active inside the retained
region, deactivate outside it, reactivate on re-entry, and deliver exactly one
press only after release back on the target. A separate raw `ACTION_CANCEL`
must suppress release and leave the same Pressable healthy for the next real
tap. The facade keeps the Pressable host as the default native hit target and
retains the activation-time page origin, so reactive function children and
Android's changing out-of-bounds local coordinates cannot interrupt or corrupt
the gesture.

The proof also starts a drag on a Pressable nested in an Android ScrollView.
The fixture pins a genuinely overflowing 160dp viewport instead of allowing
the ScrollView base flex-grow style to consume its content height. Its
deliberately large `pressRetentionOffset` keeps the pointer inside the
Solid-owned retained region, so the required press cancellation plus positive
native `scrollY` can only come from the parent ScrollView taking over the
gesture. The ripple phase independently inspects the mounted foreground as an
Android `RippleDrawable`, checks its density-scaled radius and native pressed
state, and compares physical screenshots before and during touch to reject a
configured-but-invisible ripple.

Success requires the exact scenario counters, terminal surface teardown with
the Activity still alive, source maps containing the Solid facade but none of
React Pressable/Pressability or its ripple hook, and verified removal of both
APKs and processes. The shared device lease rejects a secure keyguard before
build and immediately before instrumentation.

## iOS Pressable interaction proof

Run the guarded signed Release proof on one attached, unlocked physical
iPhone:

```sh
SOLID_NATIVE_IOS_DESTINATION=<core-device-id> \
SOLID_NATIVE_IOS_TEAM=<development-team> \
pnpm --filter @solid-native/native-e2e ios:pressable:test
```

XCTest performs a slow diagonal drag beyond the retained region and requires
release suppression, then taps the same native target to prove recovery. It
repeats displaced-release recovery on a second Pressable, verifies an ordinary
iOS tap, and requires the native `UIScrollView` to take over a drag from a
Pressable with positive scroll movement and no press. The app's final assertion
checks every counter before allowing terminal owner/surface teardown. The
runner preflights CoreDevice lock state before Xcode work, verifies the exact
React-free Pressable source-map seam, retains an XCTest result bundle, and uses
the shared process watchdog for cleanup. It performs a clean build-for-testing
so an incrementally replaced Hermes bundle cannot retain an older app-resource
seal; both the application and XCTest bundle must pass strict code-sign
verification before the watchdog permits launch.

This gate passed on a physical iPhone 17 Pro running iOS 26.6.1. The run proved
diagonal and displaced release suppression, recovery on the next gesture, an
ordinary platform-neutral tap, positive native scroll takeover without an
accidental press, terminal owner/surface teardown, and process cleanup. It does
not claim Android's same-gesture retained-region re-entry, raw injected
`ACTION_CANCEL`, or visible ripple pixels.

## Android native-vibration proof

Run the direct TurboModule/Solid vibration gate on one attached, unlocked
physical Android device:

```sh
SOLID_NATIVE_ANDROID_SERIAL=<adb-serial> \
pnpm --filter @solid-native/native-e2e android:vibration:test
```

The runner saves the device's `vibrate_on` setting, temporarily enables it so a
disabled user preference cannot turn a hardware proof into a false positive,
and restores the exact original value on success, failure, or interruption.
AndroidX physically starts a repeating pattern and requires the Pixel vibrator
service to report a live infinite waveform owned by the proof package with the
exact `0/80/160/140 ms` segments and repeat index. It then proves explicit
cancellation, starts the waveform again, and proves Solid owner disposal stops
the OS resource while leaving the Activity alive. Success requires teardown,
setting restoration, facade-rejecting source maps, and verified process/package
cleanup. iOS remains Release-compiled and awaits physical scheduled-pulse
timing coverage.

## Android native-image cache proof

Run the direct ImageLoader/Solid ownership gate on one attached, unlocked
physical Android device:

```sh
SOLID_NATIVE_ANDROID_SERIAL=<adb-serial> \
pnpm --filter @solid-native/native-e2e android:images:test
```

The runner exposes a bounded Mac-loopback PNG server only to device port 38474
through `adb reverse`. AndroidX physically starts an authenticated dimension
request, requires the exact decoded geometry, proves the prefetch URI is absent
before native work and present afterward, and verifies ordered hot/missing/hot
cache results without fetching the missing URI. Each successful operation must
retain its default-priority image event and named Solid computation through the
normal Fabric commit, while private URIs and headers remain outside telemetry.

Two held server responses independently prove that explicit prefetch
cancellation and Solid owner disposal both abort Android's native transport.
The latter must also remove the Fabric tree without terminating the Activity.
Success requires exact server-side request evidence, acknowledged teardown, the
facade-rejecting source-map gates, removal of both APKs, and removal of the
reverse tunnel. iOS remains Release-compiled; its physical metadata/cache gate
and identifier-free cancellation semantics remain open.

## Android and iOS native-localization proof

Run the startup locale and physical layout-direction gate on one attached,
unlocked Android device that supports scoped application locales:

```sh
SOLID_NATIVE_ANDROID_SERIAL=<adb-serial> \
pnpm --filter @solid-native/native-e2e android:localization:test
```

The runner installs one Release app, gives only that disposable package an
`en-US,ar-SA` locale config, and cold-starts it once in each locale. It never
changes the device locale or global force-RTL setting. Each phase requires the
Activity resources, the pinned `I18nManager` snapshot, and native decor-view
direction to agree. AndroidX then compares the physical bounds of leading and
trailing Fabric children, proving the same row is LTR in English and mirrored
in Arabic rather than trusting a boolean alone.

This gate found that React Native 0.87 calculates natural Android RTL from an
arbitrary available locale. The package-owned `SolidNativeSurface` now
synchronizes RN's package-scoped Fabric direction from the Activity's effective
locale immediately before creating each surface. Success additionally requires
style swapping, acknowledged surface teardown without Activity termination,
facade-rejecting source maps, and removal of both APKs; uninstalling removes
the scoped locale config.

Run the matching signed iPhone gate with:

```sh
SOLID_NATIVE_IOS_DESTINATION=<CoreDevice-identifier> \
SOLID_NATIVE_IOS_TEAM=<development-team> \
pnpm --filter @solid-native/native-e2e ios:localization:test
```

The Release app declares English and Arabic bundle localizations because
React Native's native iOS direction lookup only enables natural RTL for a
supported application language. XCTest cold-starts that same binary under
process-scoped `en-US` and `ar-SA` preferences without changing the phone's
language. It requires Hermes Intl and the direct native `I18nManager` snapshot
to report the exact locale and direction, then compares the physical Fabric
child bounds to prove the row mirrors. Both owners tear down without terminating
the host process; the runner also enforces source-map policy, signing, marker,
process, and application cleanup gates.

## Android native-accessibility proof

Run the native preference, announcement, and teardown gate on one attached,
unlocked Android device:

```sh
SOLID_NATIVE_ANDROID_SERIAL=<adb-serial> \
pnpm --filter @solid-native/native-e2e android:accessibility:test
```

The runner snapshots the device's transition-animation and high-text-contrast
settings before installing the Release app. Android instrumentation changes
each preference away from and back to its original value, requires the direct
native module event to update the matching Solid accessor, and physically
presses a proof control to publish the pending Fabric revision. All four
transitions must retain the exact privacy-safe accessibility event, named Solid
computation, and normal-priority commit causes without recording the preference
name or value.

The same run verifies a complete native snapshot, a non-shortening recommended
timeout, and explicit refresh. Android's `UiAutomation` arms an event filter
before the announcement button is pressed and requires the resulting operating-
system `TYPE_ANNOUNCEMENT` event to carry the proof app's package and exact
bounded message. Success also requires surface teardown while the Activity
remains alive, facade-rejecting source maps, exact setting restoration, and
removal of both APKs. The runner never enables a user accessibility service.
iOS remains Release-compiled and awaits equivalent physical preference and
announcement coverage.

## Native-networking physical proof

Run the owner-bound native transport and causal-observability gate on one
attached, securely unlocked physical Android device:

```sh
SOLID_NATIVE_ANDROID_SERIAL=<adb-serial> \
pnpm --filter @solid-native/native-e2e android:networking:test
```

The matching iPhone runner uses the connected-device and signing settings from
the other iOS physical gates:

```sh
SOLID_NATIVE_IOS_DESTINATION=<xcode-device-id> \
SOLID_NATIVE_IOS_TEAM=<development-team-id> \
pnpm --filter @solid-native/native-e2e ios:networking:test
```

On a Mac whose `.local` name resolves to multiple active interfaces, select the
private address reachable from the iPhone explicitly:

```sh
SOLID_NATIVE_IOS_DESTINATION=<xcode-device-id> \
SOLID_NATIVE_IOS_TEAM=<development-team-id> \
SOLID_NATIVE_IOS_NETWORKING_HOST=<mac-private-ipv4> \
pnpm --filter @solid-native/native-e2e ios:networking:test
```

The override accepts only canonical RFC 1918 IPv4 addresses; public, loopback,
malformed, and non-canonical addresses are rejected before the server starts.

The runner binds a bounded local HTTP server and exposes only its ephemeral
host port to device loopback port 38473 with `adb reverse`. AndroidX injects
real touchscreen input to start split-chunk SSE and structured JSON requests,
then requires native response, incremental-data, and completion delivery
through React Native 0.87's `Networking` TurboModule. Hermes proves that the
response, first stream chunk, and JSON completion each retain their exact
private platform event and named Solid computation through the matching Fabric
commit, UI-thread mount, and following frame. Unique URL, header, body, and
stream canaries must remain absent from telemetry.

The same run forces a pre-header socket failure, accepts at most one transparent
OkHttp retry for that idempotent request, cancels one live request explicitly,
then starts another live request and physically disposes its Solid owner. The
last request must reject as `NetworkOwnerDisposedError`, disappear from the
native accessibility tree while the Activity remains alive, close its server
response, and acknowledge surface teardown in JavaScript before instrumentation
may pass. The Release source-map gate requires the direct platform adapter,
service, Solid ownership, SSE, and JSON seams exactly once. Success is published
only after the app process and both disposable APK packages are gone and the
reverse tunnel has been removed. The proof app alone permits local cleartext
traffic; this does not change production application policy.

The iOS runner starts the same bounded protocol server on the Mac and cold-opens
the signed app with a 144-bit, run-scoped local path capability. It uses the
Mac's `*.local` name by default and supports an explicit RFC 1918 address for a
dual-homed Mac. The app rejects credentials, privileged or missing ports,
public or loopback addresses, non-local hosts, extra URL state, and malformed
capability paths before creating network work. ATS keeps
arbitrary loads disabled and allows only local networking for this proof
bundle; XCTest handles iOS's one-time Local Network permission inside the
recorded run. The Release UI test requires the same protocol, causal, privacy,
cancellation, accessibility-removal, foreground-process, and teardown behavior,
while the runner independently checks every JavaScript marker, server-side
request/abort evidence, the composed Hermes source map, and process cleanup.
The app and UI-test bundle are code-signing-free Release-compiled in CI-like
local verification. Signed iPhone 17 Pro qualification on iOS 26.6.1 has now
proven native request creation, the native zero-based request-ID callback,
bounded URLSession timeout delivery, and mapping to
`NetworkRequestTimedOutError`. It also found and fixed a test bug where querying
SpringBoard for a nonexistent permission alert backgrounded the proof app. The
complete server protocol, cancellation, and teardown sequence still requires a
signed run over a reachable local interface before iOS is described as fully
physically verified.

## Android native UI-worklet proof

The dedicated `solidWorklet` Release flavor exercises the application-facing
`@solid-native/animation/native` path and the lower-level
`@solid-native/animation/react-native` adapter without a React component
renderer:

```sh
pnpm --filter @solid-native/native-e2e android:worklet:test
```

The test first authors its production graph through typed named inputs and
numeric expression helpers. `createNativeViewAnimation` binds it through a
Solid-owned ref, waits for the Fabric mount and first platform frame, publishes
a named update, then proves that a reduced-motion timing request applies its
validated endpoint without leaving a display callback pending. It verifies the
mounted outputs and disposes the graph. It then
requires the C++ decoder to reject an unsupported native View channel without
retaining a graph. A physical accessibility tap then installs
an owner-bound graph on a committed Fabric View. Instrumentation independently
checks the initial opacity, confirms the callback came from Android's main
thread with a positive `Choreographer` timestamp and the exact Fabric tag, and
then taps an update that applies density-correct translation plus opacity,
scale, and rotation in the next native frame. A second tap starts a one-second
timing and observes it between its endpoints. It explicitly cancels that
driver, requires the native sequence and mounted outputs to remain frozen for
50 ms with no queued frame, verifies the session mirror matches the visible
vector, then resumes a named partial timing with a shorter easing. The proof
requires several `Choreographer` frames plus the exact final properties on the
mounted View. A five-second sustained timing then requires at least 270
frames, complete interval accounting, no omitted quantile samples, and bounded
mean/p95/p99 cadence before its exact endpoint is accepted. The next stage
submits three timing keyframes in one Hermes-to-JSI call. The shared native
evaluator drives both direction changes without JavaScript stage handoffs;
instrumentation independently observes both legs on the mounted View and then
requires the exact endpoint, complete sequence cadence, and an idle scheduler.
The next stage starts a native spring, observes an intermediate frame, replaces
it atomically from that evaluated vector, and requires the underdamped
replacement to overshoot before snapping to its exact endpoint with zero
velocity. Android instrumentation polls the mounted `View` during flight and
independently requires translation beyond the target. The next stage starts a velocity
decay, observes native progress, replaces it atomically from that evaluated
vector, and requires an exact analytical endpoint, zero speed, and coherent
frame statistics. Instrumentation independently observes the mounted `View`
moving and validates its endpoint. A subsequent tap attaches a bounded two-axis
native pan from that endpoint, then the instrumentation injects a real
density-correct touchscreen drag into that View and requires the
`OnTouchListener` path to advance and apply the graph on the main thread without
a Hermes update callback. The real release velocity then starts analytical
decay on `Choreographer`; instrumentation requires the mounted View to continue
beyond the direct-touch endpoint before exact settlement. The app then detaches
the listener through the public session, requires gesture inspection to
disappear without another output frame, and publishes an identical named Solid
update from the synchronized vector to prove JavaScript ownership resumed.
Finally it disposes
the Solid root, requires the graph target and controls to disappear, observes
zero active worklets and a stopped surface from Hermes, and verifies the
Activity process survives. The runner rejects JavaScript failure markers,
verifies all phase markers, prints the raw stability JSON for retention, checks
the single Solid runtime sourcemap, and uninstalls both APKs.

## iOS native UI-worklet proof

The `worklet.tsx` entry point also runs against the signed Release iOS shell on
a connected iPhone:

```sh
SOLID_NATIVE_IOS_DESTINATION=<device-identifier> \
SOLID_NATIVE_IOS_TEAM=<development-team> \
pnpm --filter @solid-native/native-e2e ios:worklet:test
```

The focused XCTest taps the accessible native controls, requires initial and
updated `CADisplayLink` frames, starts a timing, observes an intermediate frame,
explicitly cancels it, requires an idle frozen frame and synchronized session
mirror, then resumes it and requires the replacement endpoint. It then runs the same
five-second stability gate, classifying a p50 at or below 10 ms as high refresh
and requiring at least 500 frames there (270 otherwise), complete interval
accounting, and bounded mean/p95/p99 cadence. It then executes three native
timing keyframes, requiring both direction changes, an exact endpoint, and
complete cadence statistics without a JavaScript stage handoff. It then
interrupts one analytical spring with another, requires native overshoot, exact
settlement, zero terminal velocity, and coherent spring-frame statistics. It
then interrupts one analytical decay with another, requires exact
cadence-independent settlement, zero terminal speed, and coherent decay-frame
statistics. It attaches a
`UIPanGestureRecognizer`, performs a real XCUI drag on the target, and requires
native gesture sequence/output completion, release-velocity decay, exact
settlement, synchronized recognizer detachment, a first post-detach Solid frame,
and an idle scheduler before disposal.
An applied frame is published only after a main-thread readback confirms the
mounted `UIView`'s alpha and affine transform; XCTest's accessibility frame is
not used because iOS reports its pre-transform layout rectangle. The runner
reuses a matching CocoaPods graph, fails closed when any decoder, conformance,
initial/update, timing, stability, keyframes, spring, decay, pan-attachment,
explicit-cancellation, pan-detachment, pan-completion, or teardown marker is absent, and prints
the raw stability JSON
for retention.

## Android framework-free Fabric Host proof

This focused Release proof exercises the neutral host below Solid on a
connected Android phone:

```sh
pnpm --filter @solid-native/native-e2e android:fabric-host:test
```

The entry imports only `@solid-native/fabric-host` and
`@solid-native/host-contract`. It submits raw transactions to mount 12 native
nodes, receives a real touchscreen press through Fabric, commits a text update,
and requires the exact native mount and next-frame lifecycle events. A second
physical press removes every relationship and node before stopping the surface
without terminating the Activity.

The runner builds and installs dedicated Release application and instrumentation
APKs, runs exactly one test, checks every lifecycle marker, verifies process
teardown, and uninstalls both APKs. A source-map gate then rejects any Solid,
renderer, runtime, core, or navigation source. This proof passes on the
tethered Pixel 9a; it establishes that Fabric Host is independently usable, not
that the neutral layer is the primary product.

## Android nested routed-modal proof

The dedicated Release instrumentation proof drives two genuinely nested
Dialog-backed `NativeModalStack` routes on a connected Android phone:

```sh
pnpm --filter @solid-native/native-e2e android:navigation:modal-stack:test
```

The first cycle opens `/first` and `/second`, then sends two real Android global
Back actions. Each action must remove only the top Dialog, cross its exact
hidden boundary, dispose its keyed Solid route owner afterward, and produce one
platform history pop. The second cycle recreates both routes and calls
`history.back(2)`. The runtime must serialize the two native dismissals from
top to bottom, retain both owners until their respective hidden boundaries,
and acknowledge one application transition only after the root is exposed.

The runner fails closed on exact show, request, hidden, transition, creation,
and disposal counts; it also verifies hidden and disposal ordering, root-owner
retention, terminal surface teardown without process termination, and exactly
one Solid runtime in the Release source map. It uninstalls both APKs after the
proof. This test passes on the tethered Pixel 9a and exercises real Fabric
Modal/Dialog hosts rather than simulated modal nodes.

## Android single-stack process-restoration proof

The dedicated `solidNavigation` Release flavor and
`dev.solidnative.navigation` application isolate durable single-stack behavior
from the larger camera/navigation target. Run the complete proof on a connected
Android phone with:

```sh
pnpm --filter @solid-native/native-e2e android:navigation:restoration:test
```

The command builds and installs the application and instrumentation APKs once,
then runs six fail-closed phases. The seed phase launches a registered URL,
scrolls the root to 320dp, requires the native event to enter the durable scroll
registry, then physically pushes to detail through the Solid-backed TanStack
router. The proof verifies that the real `react-native-screens` `ScreenStack`
and AppCompat toolbar have positive geometry. It flushes the two-entry history
and keyed root offset to the community AsyncStorage SQLite backend, reads and
decodes both exact snapshots, and tears down every route owner and the Fabric
surface while deliberately preserving the durable values. The runner then
force-stops the package and requires its process to be gone.

An ordinary no-URL launch must run under a different PID, restore the detail,
and preload exactly its nearest prior route into the inactive native screen
owner. The application preload policy receives that exact root entry and an
unaborted owner-bound signal; terminal teardown requires the signal to abort.
The first real Android system Back must be rejected by an active
TanStack blocker, publish visible blocked state, and leave the detail plus its
real ScreenStack and toolbar mounted. The blocker releases itself on the second
system Back, which must expose the resolved root and root loader data while
preserving the forward detail entry at history index zero. The phase flushes
and validates that state, removes its storage key, and waits for JavaScript's
terminal ownership assertion before instrumentation may exit. The newly
revealed root must also expose a replacement native ScrollView already restored
to at least 320dp before the durable-restoration marker can pass.

A third distinct process proves navigation-specific memory reclamation. It
pushes detail, retains references to the exact Java `ScreenStack` plus both
native `Screen` objects, and injects Android's real `Application.onTrimMemory`
boundary. `UI_HIDDEN` must remain an ordinary visibility transition. A
deterministic running-critical callback must then reduce the route-tree budget,
dispose the inactive root Solid owner, clear the application-owned query/image/
AI-stream cache, and retain current history plus every native screen identity.
Explicit recovery restores the budget without resurrecting stale root state;
system Back remounts a fresh root owner and loader into the original native
root `Screen`. This proves the production callback path, not system-wide OS
memory exhaustion.

A fourth distinct process starts cleanly and performs 30 physical root/detail
cycles through the same native `ScreenStack`. Every push uses the accessibility
tree, and every pop is a real Android system Back. Instrumentation requires the
exact Java `ScreenStack` object and root Solid owner to survive all 30 cycles,
while 30 detail owners and native content nodes are created and disposed
exactly once. Detail loaders run 30 times; the zero-stale TanStack root loader
revalidates after each Back and therefore runs 31 times without recreating the
keyed root component.

The fifth distinct process launches `/protected` without a session and requires
TanStack's `beforeLoad` redirect to replace it with `/login` before protected
content mounts. One physical press starts a 500 ms `/slow` loader; a second
physical press interrupts it with an absolute replacing navigation to `/home`.
The proof requires two privacy-bounded `navigation.programmatic` tasks, cancels
the displaced task, and attributes the separate pending and final
normal-priority commits to the winner. The pending native `Screen` identity is
reused for home, stale loader settlement cannot alter the exact
`[/login, /home]` history, and Android system Back reveals the original login
`Screen`. Login revalidation and every route, focus-task, and native-node owner
are counted through terminal teardown.

The sixth phase runs under another distinct PID. It first writes an obsolete
two-entry snapshot, then cold-launches the registered deep link. The accepted
URL must clear the competing durable state before persistence starts and mount
one resolved linked screen with no Back entry. Every phase rejects a JavaScript
failure marker and requires exact loader, route-owner, native-node, root, and
surface teardown accounting. Before installation, the source-map gate requires
one production Solid runtime, the exact entrypoint, generated native bindings,
core facade, and complete four-file navigation package seam while rejecting
any `react-native-screens` JavaScript wrapper. Success is published only after
the process is gone and both disposable APKs are uninstalled; the exit trap
repeats best-effort cleanup on failure. This proves the Pixel process-death,
bounded and policy-selected preload, native-pressure reclamation/recovery,
sustained native-stack, platform-Back, and cold-URL precedence paths.

The six-phase source currently passes that complete Release proof on the
tethered Pixel 9a. Its three-process signed iPhone companion also passes on the
current shared entrypoint, including durable root-scroll restoration. The
compatibility catalog therefore records the freshly exercised Android and iOS
stack, screen, and header claims as `device-verified`; modal and tab claims keep
their separate evidence levels.

## iOS single-stack process-restoration proof

The same `navigation-restoration.tsx` application runs as a signed
`dev.solidnative.navigation` Release bundle on the connected iPhone:

```sh
pnpm --filter @solid-native/native-e2e ios:navigation:restoration:test
```

The runner first performs a signed `build-for-testing`, retains the composed
Hermes source map, and applies the same exact Solid/navigation seam before it
starts the device-process watchdog or launches the app. XCTest then uses
`test-without-building`, so the physically exercised bundle is the one that
passed the policy rather than a second implicit rebuild.

One XCTest method drives the same three phases without reinstalling the app. It
opens the seed URL, requires the resolved root loader and positive-size native
`UINavigationBar`, then performs a slow physical drag on the tagged native
scroll container. The root must move by at least 320 points while the link stays
hittable, after which XCTest physically pushes the Solid/TanStack detail. It
then presses a Solid-owned UIKit bar button, opens the native menu, enters its
submenu, selects the nested action, and requires both native events to update
visible Solid state. A short, slow left-edge drag must report natural gesture
cancellation while leaving the detail and its native bar mounted. The test next
presses the control that flushes and decodes its two-entry history and keyed
root-scroll AsyncStorage snapshots before complete Solid/Fabric teardown. The
process remains foregrounded until XCTest terminates it.

An ordinary no-URL launch starts a second PID and must restore the detail plus
exactly one preloaded historical root. XCTest requires the native detail bar,
performs a real left-edge swipe that an active TanStack blocker must reject,
and requires visible blocked state while the detail and native detail bar stay
mounted. The blocker releases itself on a second left-edge swipe, which must
expose the resolved root and native root bar. JavaScript independently validates
the blocked and completed platform-pop metadata, flushes the post-pop snapshot
at index zero, while XCTest requires the replacement scroll container's root to
return to the seeded on-screen position within four points. Teardown removes
both storage keys, balances both route owners and loaders, stops the surface,
and leaves the process alive for explicit termination.

The third PID opens the registered cold URL after the application writes an
obsolete stored stack. The accepted URL must remove that value before
persistence begins, mount only the resolved linked route with no Back entry,
and expose the native cold-link bar. The runner rejects failure output, requires
every ready, router, persistence, gesture, restoration, discarded-storage, and
teardown marker, including both header-action markers, the blocker-attempt, and
the blocker-release marker, plus durable scroll capture and restoration. It
parses the diagnostics for exactly three distinct app process identifiers. Its
exit trap stops any remaining Solid Native app process on success, failure, or
interruption. This complete signed Release path passes on the physical iPhone.

## iOS native-sheet detent proof

The same isolated navigation application has a focused signed Release path for
the platform-specific sheet container:

```sh
pnpm --filter @solid-native/native-e2e ios:navigation:sheet:test
```

XCTest opens a dedicated registered URL, physically pushes the Solid/TanStack
detail as an `RNSModalScreen` with `[0.55, 0.92]` detents, and requires the real
UIKit sheet grabber to begin in its expanded state with positive geometry. A
bounded slow drag moves that grabber into the system's half-screen state. The
test then requires the stable native detent-`0` event to update Solid-owned
accessible output, the detail route to remain mounted, and the UIKit grabber to
move down by more than 40 points.

The physically hittable sheet control then flushes and validates the current
two-entry history, removes the temporary AsyncStorage value, and disposes the
sheet owner and Fabric surface while the app process stays foregrounded. The
runner rejects JavaScript failure output, requires the ready/router/detent/
persistence/teardown markers, accepts exactly one app PID, and stops any
remaining app or test-runner process on every exit path. This path passes on the
physical iPhone.

## iOS standalone routed-modal proof

The dedicated `navigation-modal.tsx` application verifies Solid-owned history
entries projected into React Native's real standalone Modal container:

```sh
pnpm --filter @solid-native/native-e2e ios:navigation:modal:test
```

One signed Release XCTest presents two UIKit page sheets in one app process.
The first closes through application `history.back()` and remains owned until
the portable hidden boundary. XCTest then performs a physical top-edge drag on
the second sheet while a Solid platform-transition blocker is active. UIKit
rejects the gesture, Hermes reports the blocked request, and the modal, route,
and application root remain mounted. A native button reactively removes the
blocker; a second physical drag dismisses the same sheet and produces exactly
one platform-origin history pop.

React Native 0.87 emits `requestClose` after UIKit completes that interactive
dismissal without emitting the ordinary Modal host `dismiss` callback. The
core facade normalizes the request into one portable `onDismiss`/`onHidden`
sequence and deduplicates any late `dismiss`. The application and runner require
the ready, show, blocked, enabled, request, platform-pop, dismiss, hidden, and
teardown markers; exactly two modal-owner disposals; one retained application
owner until final disposal; one app PID; and a stopped Fabric surface while the
process remains alive. The exit guard stops residual app and test-runner
processes on success, failure, or interruption. This complete path passes on a
physical iPhone.

## Android native-tabs proof

The dedicated `solidTabs` Release flavor and `dev.solidnative.tabs`
application isolate Solid Native's locally experimental native-tabs projection from the
main camera/navigation proof. Run it on the connected Android device with:

```sh
pnpm --filter @solid-native/native-e2e android:tabs:test
```

The command builds and installs the application and test APKs once, then runs
five instrumentation phases in separate app processes. The first cleanly
launches a seed URL, physically selects Settings, routes from its root to a
detail, flushes the selected key and two-entry history to AsyncStorage, and
tears down the Solid surface while preserving that durable snapshot. The runner
force-stops the package and verifies its process is gone. Its ordinary no-URL
relaunch must start under a different process ID, restore Settings/detail, and
preload exactly the nearest historical entry. Android's real system Back must
then reveal the resolved root instead of an unresolved placeholder. Disposal
removes the proof key before the runner force-stops that process.

A third fresh process cold-opens a protected Settings route and drives a
representative cross-container product flow. TanStack `beforeLoad` replaces the
denied entry with login before protected content mounts; authentication reuses
that exact native `Screen` for the root. The flow changes scene-local Solid
state, enters a real 75 ms async detail through the public
`TanStackNativeLink`, and starts a slow programmatic sheet route. The link press
must start exactly one privacy-bounded `navigation.link` task and commit pending
state separately before its final normal-priority commit. While the sheet route
is pending, a second physical press replaces it with the final Material sheet.
The displaced `navigation.programmatic` task must finish canceled, the winner
must own its commits, and the late loader settlement must be detached without
changing the exact `[/, /detail, /sheet]` history. Instrumentation requires the
same Material tab host and nested `ScreenStack`, three native `Screen` instances
with retained root/detail identity, positive sheet geometry, and sheet
loader/state output. Android Back dismisses only the sheet; a Home/Settings
round trip must retain the detail and its signal; a second Back reveals the
original root `Screen`. JavaScript then requires exact auth, interruption,
sheet/detail loader, owner, native-node, persistence, and terminal surface
accounting.

Sign-in may navigate only after a Solid-owned secure-storage controller
persists its opaque session through Android Keystore-backed storage. The fourth
phase force-stops that product process, cold-opens `/protected` in a distinct
process, and requires its asynchronous TanStack `beforeLoad` to restore the
exact session before protected loader data or UI can publish. Login must remain
absent. AndroidX physically presses logout; JavaScript removes the credential,
reads it back as absent, and requires exact secure read/write/remove event
counts with neither the key nor value serialized in telemetry. Success also
requires exact protected-route, tab-owner, native-node, and Fabric-surface
teardown.

The fifth phase cold-launches the registered cross-tab URL through Android's
real `ACTION_VIEW` path after writing an obsolete, Home-selected restoration
snapshot to the community AsyncStorage 3.x SQLite backend. The application
loads it through its generated `RNAsyncStorage` seam and the wrapper-free
`@solid-native/storage/async-storage-3` adapter before
`createNativeTabsStateFromStorage`. The accepted URL must discard that
snapshot, select Settings, and mount its resolved detail directly with no Back
entry before any test-authored navigation. JavaScript requires the storage key
to be absent before it installs ongoing persistence, closing the
pre-persistence crash window. The proof then replaces that detail with the
Settings root and verifies that no obsolete screen reappears.

The same run finds the real `react-native-screens` Material
`BottomNavigationView`, requires positive geometry and non-null compiled Home
and Settings drawable icons, and injects touchscreen taps into its accessible
items. It observes the corresponding Solid-owned native scenes, increments a
Settings-local signal, switches away and back, and requires the value to
remain. A `createNativeTabsState` coordinator supplies the controlled Solid
selection and retained keyed histories; Settings projects its coordinator-owned
history through a TanStack adapter, Solid-backed router, route loaders,
provider, and `TanStackNativeStack`. The test navigates through the router,
requires validated detail loader data to reach the Solid route component,
checks ScreenStack/header geometry, retains that component and native screen
through tab switches, then sends Android's real system Back action. The
selected Settings history must consume it, pop and clean up the second detail
owner, and retain the routed root and tab host. JavaScript independently
validates discrete selection events, keyed native-root identity, both detail
lifetimes, and exact cleanup. Before disposal, the tabs persistence controller
flushes the latest selection and both histories to AsyncStorage;
JavaScript reads and decodes that envelope, rejects any obsolete entry,
requires the selected Settings history to contain only the final root, and
removes the proof key. It then requires both tab owners, the nested root, and
the Fabric surface to stop cleanly. Before either APK is installed, the
source-map gate requires one production Solid runtime plus the exact tabs
entrypoint, generated native bindings, core facade, and complete four-file
navigation package seam, and rejects the `react-native-screens` JavaScript
wrapper. This proves cold cross-tab launch precedence, durable multi-history
restoration across process death, selected-tab Android Back, and composition
for the resource-icon surface. It does not prove an arbitrary
restored-stack preload depth or automatically promote a future upstream release.
The runner uninstalls both disposable APKs, including their test data, on
success or failure.

## iOS native-tabs proof

The same `tabs.tsx` application runs as a signed `dev.solidnative.tabs` Release
bundle on the connected iPhone:

```sh
pnpm --filter @solid-native/native-e2e ios:tabs:test
```

Run the focused one-process application-shaped composition independently with:

```sh
pnpm --filter @solid-native/native-e2e ios:tabs:product:test
```

That focused runner signs and builds the test bundle first, verifies the
composed Hermes map against the exact Solid-owned tabs/navigation seam, and
only then starts its watchdog and executes XCTest without rebuilding.

That URL starts at the protected Settings route, requires `beforeLoad` to
replace it with login before denied content mounts, authenticates into the same
native `Screen`, changes retained Solid state, and enters a 75 ms async detail
through the public `TanStackNativeLink`. It then exposes a pending slow sheet
route and physically interrupts it with the winning native sheet. XCTest waits
for the displaced task to settle with causal ownership detached, requires the
winning task's final normal-priority commit, presses the sheet's native header
Back, round-trips the real tab bar while retaining the detail and its state,
presses the detail header Back, and verifies terminal surface removal. The
runner requires the auth, link, interruption, composition, platform Back,
selection, persistence, and teardown markers under exactly one app PID.

One XCTest method drives four real application processes without reinstalling
between phases. The first opens a dedicated icon-ownership URL. A bounded,
main-thread application inspector requires the live two-item `UITabBar`, its
positive geometry, Home selection, item identifiers, and exact configured
standard/scroll-edge background and shadow, normal/selected title and icon
colors, selected badge background, nil blur, and a positive selected font
weight. The Solid fixture then moves Home through template raster, empty, SF
Symbol, a
racing raster immediately cleared to empty, stable empty, restored SF Symbol,
and restored raster states. UIKit must expose both image slots consistently and
must not allow the stale asynchronous raster callback to reclaim the item. The
inspector is gated to that exact URL, has per-step and global deadlines, and
stops permanently on success or failure.

The next process opens the seed URL, requires the native two-item `UITabBar`
with the configured accessibility labels and test identifiers, physically
selects Settings, routes through the Solid-backed TanStack router, persists the
selected nested detail, naturally cancels a short left-edge gesture without
mutating history, and disposes the complete Solid/Fabric surface while leaving
the process alive. XCTest then terminates that PID and performs an ordinary
no-URL launch. The new PID must restore Settings/detail, preload its nearest
root, reject one full left-edge gesture through a TanStack blocker while
retaining the detail, release that blocker, and return through a second real
left-edge interactive pop before the durable key is removed and the second
surface is disposed.

The fourth PID opens the registered cold URL. The app first writes obsolete
Home-selected state through AsyncStorage, then proves the accepted URL removes
that value before persistence starts and mounts only Settings/detail. XCTest
resets to the clean root, changes a Settings-owned Solid signal, pushes through
the TanStack router, switches to Home and back through the native tab bar, and
requires both the signal and detail screen to retain identity. A second physical
left-edge pop returns to the retained root. The runner rejects JavaScript
failure markers and requires every UIKit appearance/image phase plus selection,
process-seed/restoration, discarded storage, natural-cancellation,
blocker-rejection/release, platform-gesture, persistence, and exact teardown
markers from the result bundle. A bounded retry
allows the final cold-phase gesture to cancel naturally without weakening its
retained-detail invariant. The runner stops any remaining app process on
success, failure, or interruption.

Together the two runners prove the bounded one-entry iPhone restoration path,
cold-link precedence, native tab selection and appearance, asynchronous icon
ownership, naturally canceled, blocker-rejected, and allowed selected-tab
gestures, retained Solid/TanStack ownership, SQLite persistence, and the
composed auth/link/interruption/stack/sheet flow on the current 4.27 pin.
Arbitrary restored depth, every UIKit trait/layout variant, XCAsset-specific
delivery, and promotion of future upstream releases remain separate gates.

## Android fixed-extent list proof

The dedicated `solidList` Release flavor and `dev.solidnative.list` application
exercise the Solid-owned `VirtualizedList` without adding list work to the main
camera/navigation proof. Build, install, and launch it with:

```sh
pnpm --filter @solid-native/native-e2e android:list:install
```

Run the connected-device instrumentation proof with:

```sh
pnpm --filter @solid-native/native-e2e android:list:test
```

The test finds the actual `android.widget.ScrollView` through Android
accessibility, injects a multi-move touchscreen swipe, and waits for the
Solid/Hermes validation marker. For 1,000 logical fixed-size rows, JavaScript
requires a settled positive offset, no live owner for row zero, exact
creation/disposal accounting, no more than 12 active keyed row owners, a
positive 392-point native viewport measurement, and exact UI-thread Fabric
mount observations. Instrumentation independently requires row zero to leave
the accessibility tree, counts at most 12 accessible rows, and checks that the
process survived. During the gesture it records the real Android window's
`FrameMetrics` on a separate callback thread, requires at least five complete
frame reports with none dropped, rejects Android's 700 ms frozen-frame
threshold, and reports deadline misses plus p50, p95, and maximum render time.
It then injects a touchscreen tap on the prepend control, requires the visible
keyed row and its exact screen bounds to survive the 50-row native correction,
and keeps the window bounded. A second tap calls the public `scrollToIndex`
handle for logical index 950 and requires stable row 900's Solid window to mount
before the isolated native command. JavaScript and instrumentation independently
observe the target row and exact 53,032-point offset. A final
physical press requires every created row owner to dispose, waits for Android
to acknowledge the native surface stop, independently observes the list leave
the accessibility tree, and verifies that the Activity still survives. A
successful run emits:

```text
SOLID_NATIVE_VIRTUALIZED_LIST_READY
SOLID_NATIVE_VIRTUALIZED_LIST_FRAME_METRICS { ... }
SOLID_NATIVE_VIRTUALIZED_LIST_SUCCEEDED { ... }
SOLID_NATIVE_VIRTUALIZED_LIST_PREPEND_SUCCEEDED { ... }
SOLID_NATIVE_VIRTUALIZED_LIST_IMPERATIVE_SUCCEEDED { ... }
SOLID_NATIVE_VIRTUALIZED_LIST_TEARDOWN_SUCCEEDED { ... }
```

Collect the default one warmup plus six measured cold instrumentation runs with:

```sh
SOLID_NATIVE_ANDROID_SERIAL=<serial> \
  pnpm --filter @solid-native/native-e2e android:list:benchmark
```

The runner rebuilds and installs both Release APKs, invokes only the list test
through Android's instrumentation runner, and clears logcat before every
sample. A sample is accepted only when the instrumentation result and all five
independent frame/window/prepend/imperative/teardown markers agree on their bounded
owner counts, exact sequences, native revisions, target offset, and complete
surface stop. It summarizes frame count, deadline misses, p50/p95/max frame
duration, and total instrumentation duration without removing outliers. Set
`SOLID_NATIVE_ANDROID_LIST_WARMUP_SAMPLES`,
`SOLID_NATIVE_ANDROID_LIST_SAMPLES`, and
`SOLID_NATIVE_ANDROID_LIST_TIMEOUT` to change the bounded defaults. Set
`SOLID_NATIVE_ANDROID_LIST_OUTPUT_DIR` to retain the complete JSON result under
a timestamped directory, including every raw sample, thermal status, power
mode, device/OS identity, app revision, and dirty-worktree state.

The one-shot test is physical functional, boundedness, and frame evidence. The
runner adds a repeated single-variant distribution, but it is still not a
matched React Native comparison or compositor-presentation measurement and
does not support a general smoothness claim. A matched iPhone performance
distribution remains open.

### Android initial-list positioning proof

The separate initial-position entry starts the same 1,000-row fixed list at
stable key `initial-100` with zero overscan. Run it on one connected physical
Android device with:

```sh
SOLID_NATIVE_ANDROID_SERIAL=<serial> \
  pnpm --filter @solid-native/native-e2e android:list:initial:test
```

This is a first-mount proof, not another imperative-jump test. JavaScript
requires mount revision 1 to own exactly rows 100–106 and never row zero.
Android instrumentation independently reads the live native `ScrollView`,
requires its offset to equal `100 * 50` density-independent pixels, counts
exactly seven accessible rows, and rejects row zero in the native tree. No
`scrollTo` command is issued. A physical press then disposes the application;
the runner requires balanced owner cleanup, acknowledged surface stop, a
surviving process, and verified package/process removal before success.

The promoted Pixel 9a Release run observed the expected 13,125-pixel native
offset at density 2.625, all seven target rows, and clean teardown. The script
also validates the production source map against the single-Solid-runtime
policy.

### Android intrinsic-height list proof

The dedicated measured-list entry uses `estimatedItemSize={56}` and
`recycleRowViews` for 240 rows that alternate between intrinsic 40-point and
80-point extents. Run its signed Release workload on one connected physical
Android device with:

```sh
SOLID_NATIVE_ANDROID_SERIAL=<serial> \
  pnpm --filter @solid-native/native-e2e android:list:measured:test
```

JavaScript requires native layout events for both row sizes, a positive
touchscreen scroll, a later measured window beyond the initial rows, balanced
live-owner accounting, and at most 15 mounted owners. Android instrumentation
independently checks the first three native accessibility bounds: their pixel
heights must match the device-density conversions of 40/80/40 points and their
edges must be adjacent. This rejects a facade that renders intrinsic children
but continues positioning wrappers at the 56-point estimate, since that would
leave gaps or overlaps. After a physical swipe, instrumentation requires row
zero to leave the native tree and independently enforces the same bounded
window. The runner validates application and native proof markers, rejects
emulators and locked devices, leases/restores stay-awake state, and removes the
test packages and processes before reporting success.

Instrumentation also records the direct native parent wrapper for every keyed
accessible row before and after the swipe. It requires at least one identical
Java `View` object to represent two different row labels; the keyed child owner
still remounts and participates in JavaScript's creation/disposal accounting.
This proves Solid Native's renderer-owned wrapper contract independently of
React Native's hidden Android platform-pool feature flag.

The Pixel 9a Release promotion observed 40/80-point rows as 105/210 physical
pixels, adjacent native bounds, 15 measured keys, and 11 live owners after the
physical scroll. The same native wrapper moved from row 1 to row 13. The signed
iPhone Release promotion observed 40/80/40-point frames, adjacent edges, 14
measured keys, and 12 live owners after the physical scroll. Exact UIKit
wrapper-identity observation and repeated measured-list performance
distributions remain open.

### iOS intrinsic-height list promotion

The signed iPhone counterpart is checked in as a separate, cleanup-guarded
Release runner. Its application and XCTest target compile together for generic
iPhoneOS, and its production source map passes the single-Solid-runtime gate.
With the device connected, unlocked, and configured for the same development
team as the other iOS proofs, run:

```sh
SOLID_NATIVE_IOS_DESTINATION=<CoreDevice identifier> \
SOLID_NATIVE_IOS_TEAM=<Apple team identifier> \
  pnpm --filter @solid-native/native-e2e ios:list:measured:test
```

XCTest waits for native measurement to replace the 56-point estimate, then
independently requires the first three accessible row frames to be 40, 80, and
40 points with adjacent edges. It drags the real nested `UIScrollView`, requires
row zero to leave the accessibility tree, observes a later measured row, and
keeps the exposed window to at most 15 rows. The runner additionally requires
the JavaScript ready/success markers, verifies the production Solid source map,
and stops all leased application processes before returning.

The entry enables `recycleRowViews`, so the same run exercises keyed-owner
disposal and wrapper reassignment through JavaScript's accounting. XCUITest
does not expose trustworthy `UIView` pointer identity, however, so this gate
does not promote the exact native-wrapper identity claim by itself. Android's
in-process instrumentation remains the independent object-identity proof until
an equivalent bounded UIKit observer is available. The signed physical run now
passes this geometry, boundedness, ownership, source-map, and cleanup contract.

## iOS fixed-extent list proof

The same `list.tsx` application runs as a signed `dev.solidnative.list` Release
bundle on the connected iPhone:

```sh
pnpm --filter @solid-native/native-e2e ios:list:test
```

XCTest requires the identified 392-point Fabric container and its real nested
`UIScrollView`, then counts distinct row labels rather than duplicated UIKit
accessibility wrappers. It performs one excluded warmup drag and one measured
70%-viewport touchscreen drag. JavaScript requires the settled offset to evict
row zero beyond the two-row overscan, waits for the exact native mount revision,
measures the viewport, and proves at most 12 keyed Solid row owners remain.
XCTest independently requires row zero to leave the accessibility tree and at
most 12 distinct row labels to remain.

The measured drag uses Apple's scrolling/deceleration signpost metric. On iOS
26 and newer it also uses the app-targeted hitch metric. The runner exports and
validates the result-bundle JSON, requiring one finite measurement for duration,
system animation frame rate/count and hitch data, plus a complete app hitch set
when available. These metrics are retained in the `.xcresult` and reported as a
single diagnostic; they are not a thresholded or matched performance claim.

XCTest next prepends 50 rows, requires the visible keyed row to retain its exact
screen frame across the native 2,800-point offset correction, and keeps the
window bounded. It then physically presses the enabled jump control. The
application moves the Solid window to logical index 950 for stable row 900,
accepts the observed two-commit structural race, requires every structural
transaction to be command-free, and issues one isolated
`scrollTo(0, 53032, false)` transaction. Both layers require row 900 and no more
than 12 distinct/live rows. A final physical press balances every row-owner
cleanup, waits for native surface stop, removes the list from the accessibility
tree, and leaves the process running. The runner rejects the JavaScript failure
marker and requires ready, physical-scroll, prepend, imperative, and teardown
markers before accepting the test.

### iOS initial-list positioning promotion

The first-mount counterpart is checked in as a cleanup-guarded Release runner:

```sh
SOLID_NATIVE_IOS_DESTINATION=<CoreDevice identifier> \
SOLID_NATIVE_IOS_TEAM=<Apple team identifier> \
  pnpm --filter @solid-native/native-e2e ios:list:initial:test
```

It runs the same `list-initial.tsx` entry as Android. XCUITest requires the
first native accessibility tree to contain exactly rows 100–106, rejects row
zero, and verifies that row 100 is aligned to the real `UIScrollView` viewport
start. The JavaScript side independently requires revision 1, seven target
owners, and no top-row owner; no imperative scrolling API is present in the
entry. A physical disposal must remove the native list while the process stays
alive, and the runner accepts the result only after the ready/teardown markers,
production source-map policy, and process guard agree.

The signed physical iPhone Release run observes exactly rows 100–106 in the
first native tree, aligns row 100 to the viewport start, balances all seven row
owners during teardown, and passes the production source-map policy.

## Android repeated list diagnostics

Run the matched React Native 0.87 `FlatList` control and Solid Native
`VirtualizedList` scenario with:

```sh
SOLID_NATIVE_ANDROID_SERIAL=<serial> \
  pnpm --filter @solid-native/native-e2e android:list:matched
```

The runner builds and installs isolated Release application and instrumentation
APKs for both implementations. Each starts with the same 1,000 stable 56-point
rows in a 392-point viewport, receives the same injected multi-move touchscreen
swipe, and uses the same settled-proof frame interval. Instrumentation then
captures one visible original anchor, physically prepends 50 rows, and requires
that anchor to retain its native bounds while the content offset changes by
exactly 2,800 points. A final physical press requests logical index 950, which
must resolve to stable original row 900 at view position 0.5 and exact offset
53,032. The React control uses ordinary React Native Fabric and `FlatList`; its
instrumentation requires a finite exposed window of at most 50 rows. The Solid
variant retains its stricter 12-owner accounting, bounded command-free prepend
transactions, isolated native scroll command, and deterministic surface
teardown proof. Samples
run in a shuffled seed-balanced order. The result records the unsigned 32-bit
seed, exact plan, each distribution, and the paired `Solid - React` delta
without removing outliers. Environment evidence includes the deterministic
Android native-compatibility fingerprint and its bounded input count.

The defaults are one excluded warmup pair and six measured pairs. Override them
with `SOLID_NATIVE_ANDROID_LIST_WARMUP_PAIRS`,
`SOLID_NATIVE_ANDROID_LIST_SAMPLES`, and
`SOLID_NATIVE_ANDROID_LIST_TIMEOUT`. Set
`SOLID_NATIVE_ANDROID_LIST_ORDER_SEED` to reproduce an order exactly.
`SOLID_NATIVE_ANDROID_LIST_OUTPUT_DIR`
retains the full raw result. This is a matched diagnostic of Android window
frame durations through each mounted success marker. It is not a
compositor-presentation measurement, the different list policies are part of
what is being compared, and it cannot support a general performance claim.
On success, failure, or interruption, the runner force-stops both application
identities and verifies that neither process remains on the device.

### Android platform-view recycling experiment

React Native 0.87 already implements reset-aware, per-surface Android pools
for View and Text, but its master recycling flag is disabled in the stable
defaults and its custom-feature-flags loader is internal. The dedicated
`solidListRecycling` flavor confines that version-coupled opt-in to this
physical test app; it is not part of the Solid Native runtime or public host
contract.

Run its one-shot proof with:

```sh
SOLID_NATIVE_ANDROID_SERIAL=<serial> \
  pnpm --filter @solid-native/native-e2e android:list:recycling:test
```

In addition to every ordinary Solid list assertion, instrumentation records
actual Java `View` object identities at the initial, physically scrolled, and
imperative windows. The test succeeds only when one object represents two
different logical row labels, proving platform reuse rather than inferring it
from timing. Run a paired off/on distribution with:

```sh
SOLID_NATIVE_ANDROID_SERIAL=<serial> \
SOLID_NATIVE_ANDROID_LIST_SAMPLES=12 \
  pnpm --filter @solid-native/native-e2e android:list:recycling:benchmark
```

The runner alternates identical Solid list variants, requires the native
identity marker in every recycling sample, and preserves generic
observed-minus-baseline distributions. This experiment concerns platform view
objects beneath create/delete mutations. It does not enable renderer-visible
node reuse, so `HostCapabilities.viewRecycling` correctly remains false.

## React Native control application

The same native shell also builds a standard React Native 0.87 application as
an end-to-end control. It uses React, AppRegistry, and the ordinary Fabric
renderer instead of installing the Solid Native JSI binding. The control has a
single state update with stable accessibility identifiers and console markers,
including the same generated Fabric native component, so later device
benchmarks can compare closely matched mounted and updated native trees without
maintaining a separate project.

Build, install, and launch the Android Release control:

```sh
pnpm --filter @solid-native/native-e2e android:control
```

Run its physical-device accessibility and state-update test:

```sh
pnpm --filter @solid-native/native-e2e android:control:test
```

The Android control uses the `reactControl` product flavor and bundle ID
`dev.solidnative.control`. The original proof remains the `solid` flavor with
bundle ID `dev.solidnative.e2e`.

Build, sign, install, and launch the iOS Release control with the same device
and team variables used by the Solid proof:

```sh
pnpm --filter @solid-native/native-e2e ios:control
```

Run its physical-device accessibility and state-update test:

```sh
pnpm --filter @solid-native/native-e2e ios:control:test
```

The iPhone must be unlocked for `devicectl` to launch the installed app. Set
`SOLID_NATIVE_IOS_CONTROL_BUNDLE_ID` if the default
`dev.solidnative.control` identifier is unavailable to the selected team.

The UI test taps **Run React update**, verifies that the text advances from
`React control count 0` to `React control count 1`, and requires both
corresponding markers from the Xcode result bundle:

```text
SOLID_NATIVE_REACT_CONTROL_READY
SOLID_NATIVE_REACT_CONTROL_UPDATE_SUCCEEDED
```

The control deliberately keeps the same React Native, Hermes, Fabric, Codegen,
native dependency, Release-mode, and signing baseline. Dormant Solid Native
native code remains linked into this integration shell, so this target is
appropriate for renderer/runtime latency comparisons but not binary-size
comparisons.

## iOS idle-resource sampling

Install the dedicated, matched Release scenarios. They use separate bundle IDs
from the interactive proof applications, so a benchmark run cannot accidentally
measure the proof tree or overwrite it:

```sh
pnpm --filter @solid-native/native-e2e ios:memory:install:solid
pnpm --filter @solid-native/native-e2e ios:memory:install:control
```

Then capture the same Activity Monitor sample for each application:

```sh
SOLID_NATIVE_IOS_MEMORY_DURATION=60 \
  pnpm --filter @solid-native/native-e2e ios:memory:solid
SOLID_NATIVE_IOS_MEMORY_DURATION=60 \
  pnpm --filter @solid-native/native-e2e ios:memory:control
```

The sampler cold-launches the selected target, waits five seconds, and records
two complementary Xcode Instruments tables. Duration-weighted live intervals
provide process CPU, cumulative CPU time, thread count, physical footprint, and
real memory across the complete observation. Sparse raw updates retain resident
size plus cumulative context-switch and interrupt-wakeup counters. This matters
for a genuinely idle process: Instruments may emit no raw update during a long,
unchanged tail even though the process and trace remain alive. The sampler emits
both sources plus processor summaries and least-squares memory slopes as
`SOLID_NATIVE_IOS_MEMORY_RESULT`. The result binds the trace to the deterministic
iOS native-compatibility fingerprint and its bounded input count. It
deliberately does not classify a short sample as an energy or leak verdict. The
CPU/wakeup fields make an accidentally retained display link, camera session,
or other periodic native callback visible even when its memory stays flat. The
iPhone must be unlocked when the capture starts. The benchmark-only launch
argument disables its idle timer for the lifetime of that process. The reporter
uses interval coverage—not the timestamp of the last sparse update—to reject a
trace that does not cover the requested post-warmup duration. Process attachment
and Xcode's occasionally unstable XML export each
retry up to three times. If `xctrace` crashes after writing an export, the
sampler accepts it only after the same strict schema and sample validation used
by the reporter succeeds. The host
preflight rejects a sustained macOS Console device-log relay before recording;
do not reopen Console during the sample. Repeat both renderer orders and use
longer recordings before drawing a conclusion. Set
`SOLID_NATIVE_IOS_MEMORY_OUTPUT_DIR` to retain the raw `.trace`, exported XML,
machine-readable `resource-result.json`, launch metadata, and device metadata
outside the repository. Failed or incomplete temporary traces are retained with
their path printed. The raw metadata contains device identifiers; do not commit
or publish it without review.

## Android idle-resource sampling

Install the two dedicated Android Release flavors, which use the same matched
tree and separate application IDs:

```sh
pnpm --filter @solid-native/native-e2e android:memory:install:solid
pnpm --filter @solid-native/native-e2e android:memory:install:control
```

Then run the equivalent paired `dumpsys meminfo --local` sampler:

```sh
SOLID_NATIVE_ANDROID_MEMORY_DURATION=60 \
  pnpm --filter @solid-native/native-e2e android:memory:solid
SOLID_NATIVE_ANDROID_MEMORY_DURATION=60 \
  pnpm --filter @solid-native/native-e2e android:memory:control
```

It cold-launches each target, samples process CPU time, main-thread context
switches, thread count, total proportional set size (PSS), and resident set size
(RSS) once per second without invoking the app's detailed memory callback, and records the
device model, Android version, SDK level, power-saver value, and start/end
thermal status. It also records the exact Android native-compatibility
fingerprint produced by the built Solid Native CLI. The sampler force-stops its
target and verifies the PID is gone before reporting success, including on
interruption or failure. Set
`SOLID_NATIVE_ANDROID_MEMORY_OUTPUT_DIR` to retain the machine-readable
`resource-result.json`. As on iOS, repeat both orders and do not interpret a
short idle sample as an energy or leak verdict. Both variants render the same
root View, two Text nodes, generated Fabric component, and Pressable; their
intended variable is React/Fiber versus Solid's renderer/runtime. Each performs
one startup count update during the five-second settle window and then remains
idle at the same native tree.

## Android matched mixed product workload

Run the seed-balanced Solid Native/React Native order-dashboard diagnostic with:

```sh
pnpm --filter @solid-native/native-e2e android:workload:matched
```

Both Release applications render the same summaries, progress state, 12
text-heavy order rows in a real ScrollView, and periodic priority alert. Each
process receives 30 physical touchscreen inputs. Instrumentation requires the
exact processed count, active-order summary, and active row after every input,
plus six alert insertions and removals, bounded Window frame metrics, consistent
device identity, and verified process cleanup. The Solid application updates
only the affected row signals and shared summaries; the React control performs
the matching immutable state update.

Use `SOLID_NATIVE_ANDROID_WORKLOAD_SAMPLES`,
`SOLID_NATIVE_ANDROID_WORKLOAD_WARMUP_PAIRS`, and
`SOLID_NATIVE_ANDROID_WORKLOAD_ORDER_SEED` to configure the distribution, and
`SOLID_NATIVE_ANDROID_WORKLOAD_OUTPUT_DIR` to retain its JSON. The shared
benchmark flavors declare `ENTRY_FILE` as a Gradle bundle input, preventing a
cached counter bundle from being mistaken for the dashboard. A clean Pixel 9a
corpus with one excluded warmup pair, six measured pairs, thermal status 0,
all 360 exact state updates, and no frozen or dropped frame reports is retained
in
[`../../docs/benchmark-results/android-matched-product-workload-pixel-9a-2026-08-24.json`](../../docs/benchmark-results/android-matched-product-workload-pixel-9a-2026-08-24.json).
It remains diagnostic-only; see
[`../../docs/benchmarks.md`](../../docs/benchmarks.md#matched-mixed-product-workload)
for the measured distributions and interpretation limits.

## Android product-workload causal proof

Run the observed Solid Release entry through the same physical order-dashboard
instrumentation with:

```sh
pnpm --filter @solid-native/native-e2e android:product:telemetry:test
```

The dashboard marks its screen as one named `CausalOwner` and separates
summary/progress, priority-alert, and order-queue native output with static
`CausalComputation` names. For each of 30 real AndroidX touchscreen inputs,
Hermes rejects the interaction unless the discrete native `press`, owner,
affected computations, exact Solid commit, matching Fabric UI-thread mount,
and following Choreographer callback form one complete causal graph. The 12
alert insert/remove transitions must include the alert computation; the other
18 commits must not invent one.

Android instrumentation independently requires the exact processed summary,
active-order summary, active-row accessibility state, six alert appearances,
six alert removals, bounded Window frame metrics, and a live app process. The
host parser then joins those native assertions to all 30 per-interaction graph
markers and rejects gaps, duplicates, reordered Fabric revisions, inconsistent
timing boundaries, or a weakened final result. It also requires the telemetry
stream to exclude every rendered order ID, customer, amount, and alert string.
The command verifies the Release source map, force-stops the process, and
uninstalls both disposable packages before reporting success.

This command is a functional observability proof, not an overhead comparison
or a compositor-presentation measurement.

Run the same dashboard with a seed-balanced, telemetry-disabled/telemetry-enabled
Solid Native pair using:

```sh
pnpm --filter @solid-native/native-e2e android:product:telemetry:matched
```

Both dedicated Release flavors use the same product component, Solid owner and
computation annotations, lifecycle subscriptions, 30 physical inputs, Android
accessibility assertions, and Window frame capture. The intended variable is
whether `NativeRoot` receives a fully sampled causal telemetry session. The
baseline must emit zero records; the observed variant must validate every
native-event-to-frame graph and scan all retained records for rendered product
values. Both Release source maps are verified before measurement.

The default run excludes one warmup pair and retains six measured process
pairs, producing 180 paired interaction samples. Configure it with
`SOLID_NATIVE_ANDROID_PRODUCT_TELEMETRY_SAMPLES`,
`SOLID_NATIVE_ANDROID_PRODUCT_TELEMETRY_WARMUP_PAIRS`, and
`SOLID_NATIVE_ANDROID_PRODUCT_TELEMETRY_ORDER_SEED`; set
`SOLID_NATIVE_ANDROID_PRODUCT_TELEMETRY_OUTPUT_DIR` to retain the complete
JSON. Per-interaction summaries cover handler-to-commit, mount, and next-vsync
boundaries. Per-process summaries retain accessibility completion and Window
frame metrics. Interactions within one process remain correlated observations,
and neither next-vsync nor Window frame duration proves compositor
presentation. The runner force-stops and verifies both processes before
publishing success, including on interruption or failure.

A clean Pixel 9a corpus with seed `20260824`, one excluded warmup pair, and six
measured pairs is retained in
[`../../docs/benchmark-results/android-product-telemetry-pixel-9a-2026-08-24.json`](../../docs/benchmark-results/android-product-telemetry-pixel-9a-2026-08-24.json).
All 360 physical state transitions passed, the six observed processes validated
180 causal chains and emitted 2,376 records, all six baselines emitted zero,
thermal status stayed at 0, and no process reported a frozen or dropped frame.
The narrow handler-to-commit boundary showed a +0.710 ms paired median; the
handler-to-frame paired median was -0.061 ms across a much broader
zero-crossing distribution. See
[`../../docs/benchmarks.md`](../../docs/benchmarks.md#matched-mixed-product-workload)
for the complete bounded interpretation.

## Android causal-telemetry overhead

Install the two dedicated Android Release flavors. They have separate
application IDs so both remain available for a seed-balanced run:

```sh
pnpm --filter @solid-native/native-e2e android:telemetry:install:baseline
pnpm --filter @solid-native/native-e2e android:telemetry:install:observed
```

Then run the default six samples per variant:

```sh
pnpm --filter @solid-native/native-e2e android:telemetry:benchmark
```

Each run records its shuffled balanced variant plan and unsigned 32-bit seed.
Set `SOLID_NATIVE_ANDROID_TELEMETRY_ORDER_SEED` to reproduce that order exactly.

Both flavors run the same Solid owner/computation annotations, native tree,
100-commit warmup, and 1,000 measured signal commits in Hermes. The baseline
omits telemetry from `NativeRoot`; the observed flavor retains the complete
session with runtime resource identity and a counting no-op sink. The middle
measurement uses `flush()` to isolate JavaScript, causal-record construction,
JSI transaction, and Fabric shadow-tree commit work. An initial and final
`flushMounted()` require the real UI-thread mount path to remain functional,
but mount latency and frame time are intentionally outside the measured
window.

The host runner uses its recorded seed-balanced flavor order, rejects malformed
or inconsistent results, and records every raw sample with revision, dirty
state, device model, OS/SDK, power-saver value, and thermal status before and
after each launch, plus the Android native-compatibility fingerprint and input
count. It force-stops both flavors and verifies that neither process remains
before publishing a successful result, including when interrupted or a sample
fails. Set
`SOLID_NATIVE_ANDROID_TELEMETRY_SAMPLES` to change the number of pairs and
`SOLID_NATIVE_ANDROID_TELEMETRY_OUTPUT_DIR` to retain the complete JSON outside
the repository. Successful runs emit
`SOLID_NATIVE_ANDROID_TELEMETRY_RESULT`. This is a narrowly scoped
shadow-commit diagnostic, not a UI-frame or product-performance claim.

Run the matched native-event path with the same installed applications:

```sh
pnpm --filter @solid-native/native-e2e android:telemetry:event
```

For each cold launch, the app completes the same warmup, waits for the
benchmark button's real mounted frame, and reports its native layout bounds.
The runner validates Android's current display density, converts those
density-independent bounds to physical pixels, and injects one touchscreen tap
at the center. The app requires a discrete native `press`, one exact Solid
commit, its matching Fabric UI-thread mount, and the first Choreographer
callback after that mount.

The event result keeps handler-to-commit, handler-to-mount, handler-to-next-vsync,
commit-to-mount, commit-to-next-vsync, and mount-to-next-vsync as separate raw
metrics. The native event's monotonic timestamp is retained but never
subtracted from wall-clock lifecycle timestamps. Every metric retains baseline,
observed, and paired observed-minus-baseline distributions (minimum, p25,
median, p75, p95, maximum, and mean). The console headline reports the median
paired delta; the JSON also records the difference and relative difference
between independent medians because those are distinct statistics. Successful
runs emit `SOLID_NATIVE_ANDROID_TELEMETRY_EVENT_RESULT`. A next-vsync callback
does not prove compositor presentation, and the simple one-press path is not a
representative application workload.

On iOS console forwarding and Android logcat, the assertions emit these stable
markers:

```text
SOLID_NATIVE_TURBOMODULE_SUCCEEDED
SOLID_NATIVE_TURBOMODULE_ASYNC_SUCCEEDED
SOLID_NATIVE_TURBOMODULE_EVENT_SUCCEEDED
SOLID_NATIVE_CODEGEN_COMPONENT_SUCCEEDED
SOLID_NATIVE_MOUNT_LIFECYCLE_SUCCEEDED
SOLID_NATIVE_FRAME_SUCCEEDED
SOLID_NATIVE_E2E_READY
SOLID_NATIVE_NOTIFICATION_CAUSALITY_SUCCEEDED
SOLID_NATIVE_NOTIFICATION_PRESS_CAUSALITY_SUCCEEDED
SOLID_NATIVE_CAMERA_PREVIEW_CAUSALITY_SUCCEEDED
SOLID_NATIVE_CAMERA_CAPTURE_SUCCEEDED
SOLID_NATIVE_CAMERA_CAPTURE_CAUSALITY_SUCCEEDED
SOLID_NATIVE_CAUSAL_SCOPE_SUCCEEDED
SOLID_NATIVE_CAUSAL_OWNER_SUCCEEDED
SOLID_NATIVE_CAUSAL_COMPUTATION_SUCCEEDED
SOLID_NATIVE_RUNTIME_RESOURCE_SUCCEEDED
SOLID_NATIVE_SOLID_SIGNAL_SUCCEEDED
SOLID_NATIVE_MEASUREMENT_SUCCEEDED
SOLID_NATIVE_SCROLL_COMMAND_SUCCEEDED
SOLID_NATIVE_SCROLL_EVENT_SUCCEEDED
SOLID_NATIVE_IMAGE_LOAD_SUCCEEDED
SOLID_NATIVE_SCROLL_IMAGE_CAUSALITY_SUCCEEDED {"nativeEvents":2,"taskScopes":2}
SOLID_NATIVE_SCROLLVIEW_SUCCEEDED
SOLID_NATIVE_NAVIGATION_PUSH_SUCCEEDED
SOLID_NATIVE_NAVIGATION_BACK_EVENT_SUCCEEDED
SOLID_NATIVE_NAVIGATION_BACK_CAUSALITY_SUCCEEDED
SOLID_NATIVE_NAVIGATION_POP_SUCCEEDED
SOLID_NATIVE_NAVIGATION_CAUSALITY_SUCCEEDED {"interactions":3}
SOLID_NATIVE_NAVIGATION_FOCUS_SCOPE_SUCCEEDED
SOLID_NATIVE_DEEP_LINK_CAUSALITY_SUCCEEDED
SOLID_NATIVE_TEXTINPUT_CAUSALITY_SUCCEEDED {"applicationEvents":<count>,"causalEvents":<count>}
SOLID_NATIVE_TEXTINPUT_SELECTION_CAUSALITY_SUCCEEDED
SOLID_NATIVE_TEXTINPUT_SELECTION_INSERTION_CAUSALITY_SUCCEEDED {"observedChangeEvents":<count>,"causalChangeEvents":<count>,"selectionEvents":<count>}
SOLID_NATIVE_TEXTINPUT_SUBMIT_CAUSALITY_SUCCEEDED
SOLID_NATIVE_TEXTINPUT_MULTILINE_CAUSALITY_SUCCEEDED {"observedChangeEvents":<count>,"causalChangeEvents":<count>,"keyEvents":<count>,"sizeEvents":<count>}
SOLID_NATIVE_SWITCH_CAUSALITY_SUCCEEDED
SOLID_NATIVE_MODAL_SHOW_SUCCEEDED
SOLID_NATIVE_MODAL_CAUSALITY_SUCCEEDED {"interactions":3}
SOLID_NATIVE_MODAL_DISMISS_SUCCEEDED
SOLID_NATIVE_IDENTITY_RECLAMATION_SUCCEEDED
SOLID_NATIVE_TEARDOWN_SUCCEEDED
```
