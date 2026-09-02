# Roadmap and validation gates

Each phase ends with evidence-based acceptance criteria.

## Phase 0: feasibility and due diligence

Deliverables:

- License and dependency inventory
- Minimal Hermes/JSI application shell
- Direct experiment creating and committing Fabric shadow nodes without React Fiber
- Solid 2 universal renderer spike
- Draft host contract exercised by an in-memory test backend
- One native event round trip
- Upgrade-risk notes for the selected React Native release
- Baseline React Native control application

Exit criteria:

- A signal updates native text without re-rendering through React.
- The update crosses one explicit transaction/commit boundary.
- View creation, layout, mount, event, and cleanup are understood end to end.
- No license or architecture blocker has been discovered.
- The likely upstream maintenance surface is documented.

Current executable status:

- Complete: provisional host contract, transactional Solid universal renderer,
  in-memory backend, event round trip, core descriptor draft, and compiled TSX
  sandbox.
- Complete: the in-memory backend now has an application-facing
  `renderNative` API with live semantic queries, host-provenance event targets,
  explicit flush/act boundaries, render-scoped commit history, and exact
  destroyed-surface cleanup. The same contract runs under production and
  strict Solid development conditions; reusable physical-device scenarios and
  higher-level matchers remain separate follow-up work.
- Complete: React Native 0.87/Hermes baseline selection, version-pinned native
  boundary, React-free empty surface bootstrap, direct Fabric shadow-node mount,
  clone-based native text update, versioned transaction decode, and atomic
  validation rollback in an iOS simulator.
- Complete: Fabric Host exports a machine-readable React Native boundary
  manifest covering its native headers, Android imports, generated Codegen
  headers, CocoaPods dependencies, and CMake inputs. Repository, package, and
  isolated-artifact gates reject unreviewed drift from that inventory.
- Complete: deterministic pre-bundle JSI installation, guarded transport
  validation, and a synchronous Hermes-to-Fabric update in the iOS simulator.
- Complete: runtime-owned JSI/Fabric instance handles for every node created by
  JavaScript, including atomic rollback and successful runtime teardown/relaunch.
- Complete: empty-tree ownership transfer plus the single-surface
  framework-neutral `NativeHost` adapter for JavaScript node allocation, commits, events,
  measurement, live-node teardown validation, and guarded native surface stop.
- Complete: `@solid-native/fabric-host` is a separately built, dependency-gated
  package with no Solid imports. A framework-free Android Release bundle uses
  raw host transactions to mount 12 nodes, receives a physical touchscreen
  event, commits a native update, observes exact mount and next-frame lifecycle
  events, deletes every node, and stops the surface. Its source map rejects
  Solid, renderer, runtime, core, and navigation sources.
- Complete: the iOS pod exposes a production `SolidNativeFabricApplication`
  bootstrap that publishes only an empty Fabric revision before JavaScript
  commit 1. The checked-in application consumes it instead of running the
  historical staged-text and intentional-rollback smoke sequence on every
  launch; idempotent stop also releases its surface, binding, and `RCTHost`.
  Binding invalidation synchronously cancels native UI worklet state so a
  retained or delayed Hermes teardown cannot leave display callbacks active.
- Complete: application Fabric props use the owning Hermes runtime instead of
  React Native's deprecated dynamic `RawProps` path.
- Complete: deleted instance identities and event routes are reclaimed on the
  Hermes thread after iOS or Android mounts their retiring Fabric revision.
- Complete: the controlled TextInput facade exposes semantic
  `onChangeText(text)` updates and a separate typed `onChange(event)` escape
  hatch while retaining monotonic event-count reconciliation, same-text native
  acknowledgements, and stale-event rejection.
- Complete on Pixel and iPhone: the validated platform service exposes current software
  keyboard visibility, finite screen metrics, dismissal, and owner-bound
  show/hide subscriptions without leaking React Native's platform-specific
  event names into application code. Core's `createKeyboard` projects that
  service into fine-grained Solid visibility and metrics accessors. The
  physical Release proof requires Android's real IME insets to become visible
  after focusing TextInput and hidden after submission, and requires the
  private `platform.keyboard.visibility` event to complete successfully without
  retaining keyboard geometry in telemetry. The signed-iPhone XCTest independently
  requires the real software keyboard to appear after native TextInput focus and
  disappear after submission, while the Release runner fails closed unless the
  normalized Solid keyboard-state marker is present.
- Complete for phone orientation on Pixel and iPhone: the validated platform
  service exposes finite logical window width/height plus positive display and
  font scales, and follows rotation, resize, and foldable-window deliveries with
  idempotent cleanup. Core's `createWindowDimensions` projects those values into
  independent Solid accessors, suppresses structurally identical updates, and
  preserves a privacy-safe `platform.window.dimensions` causal boundary. The
  Pixel Release gate requests landscape and portrait on the live Activity,
  independently verifies Android's orientation, density, and font scale, and
  requires both native deliveries to retain the named Solid computation in
  their exact Fabric commits. The signed iPhone gate rotates the live device in
  both directions, validates the corresponding logical frame, and requires the
  same two causal commit chains before restoring its captured orientation.
- Complete for system appearance on Pixel and iPhone: the validated platform service
  exposes current light/dark appearance, native change delivery, explicit
  application override, and restoration of the system preference. Core's
  `createColorScheme` binds that state to one fine-grained Solid accessor,
  suppresses duplicate deliveries, removes its native listener with the owner,
  and records actual changes through the privacy-safe
  `platform.appearance.change` causal boundary. Its adapter uses the React-free
  Appearance utility directly rather than React Native's `useColorScheme`
  hook. The Pixel gate toggles Android's real system night mode away from and
  back to its captured value, requires both native/Solid/Fabric chains, and
  restores the user setting in both instrumentation and shell cleanup. It
  exposed a missing `ReactHost.onConfigurationChanged` call in the custom
  Activity; the checked-in shell and generated project template now forward
  that lifecycle boundary. The signed iPhone gate changes the physical device
  appearance away from and back to its captured setting, requires both causal
  Solid/Fabric deliveries, and restores the original preference in failure-safe
  cleanup.
- Complete on physical Pixel and iPhone in the pinned boundary:
  outgoing Linking operations
  validate bounded, scheme-qualified URLs, narrow `canOpenURL` to a real
  boolean, call the Android/iOS TurboModule directly, and expose the
  application-settings destination without evaluating `Linking.js`. Dedicated
  Release gates ask each operating system to resolve the app's own
  registered URL, open it through the public service, require the exact URL to
  return to the existing process and Hermes subscription, and project that
  delivery into a named Solid computation and normal-priority Fabric commit.
  Each then opens the real per-app Settings page, verifies the application
  label, returns to the same live process with state intact, and performs
  non-terminating teardown; Android additionally proves exact APK cleanup.
  Their telemetry allowlists and source-map gates prevent URL values and React
  Native's `Linking.js` facade from entering either proof.
- Complete on physical Pixel and iPhone: core exposes a zero-output,
  reactive `StatusBar` component whose property-level stack follows Solid mount
  order and restores the next live entry on owner disposal. `auto` style owns an
  Appearance listener only while required, resolves icon contrast without a
  React hook, and suppresses duplicate native writes. The runtime calls the
  platform `StatusBarManager` TurboModule directly, translates unsupported
  Android animation arguments, and the generator emits iOS's required
  `UIViewControllerBasedStatusBarAppearance=false` contract. The default
  Release application mounts the automatic visible entry and its built iOS
  plist preserves that native requirement. The checked-in Pixel Release gate
  performs physical `WindowInsetsController` checks for dark/light icon
  appearance, hidden/visible state, child-owner disposal, parent restoration,
  and non-terminating teardown. The signed iPhone Release gate distinguishes
  dark, light, and hidden system glyph output from physical screenshots,
  verifies the native press and named Solid computation in every resulting
  Fabric commit, restores the parent entry, and tears down without terminating
  the process.
- Complete on physical Pixel and iPhone: core exposes a
  Solid-owned safe-area provider, fine-grained inset/frame accessors, and
  padding/margin application with per-edge `off`, `additive`, and `maximum`
  modes. The implementation reuses only the generated native components from
  exactly pinned `react-native-safe-area-context` 5.8.1; React context, hooks,
  and wrappers are absent from the application bundle. Deterministic tests
  cover first-metric gating, payload validation, immutable snapshots, and
  reactive native edge updates. A checked-in Pixel Release gate performs a
  direct comparison between Android system/cutout insets and physical child
  placement plus terminal owner teardown. The signed iPhone Release gate
  independently compares notch/home-indicator metrics with UIKit accessibility
  frames, rotates portrait to landscape and back, proves the native inset event
  and named Solid computation caused each Fabric commit, and tears down without
  terminating the process.
- Complete on Pixel, Release-compiled for iPhone: core exposes a vertical
  `RefreshableScrollView` that owns the incompatible platform composition,
  controlled refresh reconciliation, Android layout-style split, nested-scroll
  arbitration, typed backing ScrollView handle, indicator props, and native refresh
  command without evaluating React Native's RefreshControl or ScrollView
  JavaScript facades. Vertical `VirtualizedList` composes the same control while
  retaining its bounded Solid row window and backing ScrollView handle. The
  Pixel Release gate performs two real touchscreen pulls, proves rejected and
  accepted/completed controlled paths, retains exact native wrapper/ScrollView
  identities, and stops the surface. The signed iPhone Release gate proves the
  same controlled paths against its backing `UIScrollView`, retains its native
  identity and frame, verifies the transient accepted commit from exported
  device diagnostics, and balances terminal teardown and process cleanup.
- Complete on Pixel and iPhone: `View.onLayout` and current
  Fabric measurement now drive a Solid-owned `KeyboardAvoidingView` bottom
  spacer. The signed physical iPhone gate requires native content to move above
  the real keyboard, return after hide, and preserve the private keyboard
  event-to-measure-to-commit causal chain. The Pixel instrumentation uses
  `adjustNothing` to prove that Solid, rather than window resizing, owns the
  movement, requires restoration after submit/blur, and verifies accessible
  terminal teardown. Initial
  mount layout routing is staged before Fabric apply on both platforms and
  rolled back with a rejected transaction, preventing synchronous first-layout
  delivery from racing route publication.
- Complete on Pixel and iPhone: `KeyboardAwareScrollView`
  observes native TextInput focus/blur, selects the nearest nested scroll owner,
  measures the viewport and focused field, and sends an absolute native
  `scrollTo` only when the real keyboard obscures the field. Focus switches,
  blur, hide, option changes, and disposal cancel stale measurements. The signed
  iPhone Release gate independently requires positive physical movement and
  keyboard clearance while Hermes proves the private keyboard-event-to-task-to-
  two-measurements-to-command causal chain. The Pixel test uses `adjustNothing`
  and reads fresh native IME geometry after Next-to-Done traversal before
  requiring both focused editors to clear the keyboard.
- Complete on Pixel and iPhone: zero-wrapper `TextInputFocusGroup` owns render-order form focus
  policy. It derives reactive Next/Done keys, skips non-editable destinations,
  preserves multiline newline and explicit-key behavior, and links the native
  submit event through an `input.focus.traversal` task to the Fabric focus
  command. Its upgraded two-field physical gate requires the first Return to
  keep the keyboard visible while focusing and revealing the next editor, then
  requires the final Return to submit, blur, and hide.
- Complete: renderer commit operation IDs cross JSI as bounded opaque context;
  structural commits return their exact Fabric revision and emit a distinct
  revision-aware platform mount lifecycle event with backend timing.
- Complete: the causal lifecycle continues from that mount to the first iOS
  `CADisplayLink` or Android `Choreographer` callback, measuring commit-to-frame
  and mount-to-frame latency without claiming compositor presentation.
- Complete: opt-in vendor-neutral telemetry links native events, Solid-owned
  handler flushes, host commits, measurements, commands, and surface lifecycle
  without recording props or event payloads.
- Complete: canonical signed-release lineage is accepted as one fail-closed
  `authorizedRelease` verifier output rather than manually reassembled fields.
  Project, platform, release/channel, source revision, release/bundle/native/
  artifact fingerprints, authenticated key, input evidence, and trust-policy
  identity are stamped immutably onto every causal record without making the
  runtime a trust authority or allowing application operation attributes to
  substitute delivery identity.
- Complete: `solid-native release symbolication` requires input-complete signed
  authorization, repeats bundle/source-map verification, and emits the exact
  generated bundle and self-contained canonical map under the identical frozen
  `authorizedRelease` lineage used by runtime telemetry. The schema remains
  vendor-neutral; mutable local paths are operational inputs outside the signed
  identity, and backend credentials, last-moment digest checking, transport,
  and retention stay with the selected adapter.
- Complete for Android: `solid-native release correlate-device-proof`
  independently verifies a complete signed release and signed physical receipt
  under separate versioned trust policies, derives immutable source/native/APK
  proof constraints from the authorized release, requires project identity
  equality, repeats the release bundle proof, requires exact signed JavaScript
  bundle and canonical source-map bytes from a portable receipt, rejects legacy
  receipts that cannot identify the JavaScript bundle, and emits one frozen
  path-free correlation descriptor.
  Independent policy rollback floors and receipt/time narrowing remain
  available; execution evidence never becomes release authority.
- Complete: a bounded local causal timeline and failure-isolated sink fan-out
  give development tools an exporter-independent inspection primitive. A
  selected operation can now explain its retained transitive causes and
  consequences in stable timeline order while reporting evicted or
  cross-process cause IDs explicitly instead of presenting an incomplete graph
  as complete. A versioned, bounded, deeply frozen JSON-shaped handoff and
  strict untrusted-value parser can now move detached snapshots out of Hermes.
  The CLI reads one capped UTF-8 JSON handoff from a file or stdin, produces a
  path-free summary, reconstructs a selected graph, and hides custom attributes
  unless the user explicitly opts in. It also exports deterministic Chrome JSON
  duration lanes and retained causal flow arrows for direct Perfetto import,
  assigning concurrent operations to non-overlapping lanes. Concrete Android
  and iOS one-shot commands now request nonce-bound snapshots from explicit
  debuggable apps, validate and consume app-private responses, and exit without
  a resident relay. The physical Pixel and iPhone paths retain surface, commit,
  mount, and frame slices plus causal flows. It also resolves bounded
  explicit JavaScript locations or pinned Hermes and generic JavaScript stack
  text through flat or indexed canonical Metro/OXC maps without retaining raw
  error messages, generated bundle URLs, or checkout paths. File/stdin byte,
  line, frame, and method-name limits fail closed before source-map work. A
  self-contained offline HTML debugger now adds search, status filters,
  selected-operation links, causal navigation, and incomplete-graph warnings
  under a locked content security policy without a server or external assets.
  A deterministic local comparison command now gates increased errors and
  incomplete causal graphs between bounded baseline/candidate snapshots and
  reports per-kind successful p95 deltas under an optional explicit CI threshold, without
  reading custom attributes or depending on stable operation IDs.
  The resident on-device client now has bounded privacy-safe operation-name/ID
  filtering and direct retained cause/effect traversal. A live-session desktop
  client remains open.
- Complete: production session sampling either retains the complete causal
  graph or returns to the renderer's zero-instrumentation path; deterministic
  tests reject invalid decisions and resource configuration even when sampled
  out.
- Complete: a signed physical-iPhone Release build installs and runs the
  JavaScript-owned structural commit, returns its exact Fabric revision, and
  delivers causal `commit-mounted` lifecycle callbacks through Hermes. The
  rendered surface is visibly verified after adding direct-RawProps color
  normalization.
- Complete: a physical press on a nested Fabric text tag is de-normalized from
  `topTouchEnd`, routed through the logical parent graph to its Pressable, and
  delivered to Hermes. The device run also verifies measurement, complete
  identity reclamation, safe empty-surface stop, and a surviving application
  process.
- Complete: the public Pressable facade now owns accessible, focusable, and
  non-collapsible defaults; reactive disabled semantics; function-based
  pressed styles and children; callback suppression; and a disposal-safe
  delayed press-in/configurable long-press timer pair. A quick release retains
  ordered press-in/press-out delivery; both delayed boundaries run as discrete
  causal platform events; and a synthesized long press suppresses the following
  ordinary press. Native target-level focus and blur transitions are also routed
  at default priority. Retained-region movement is now Solid-owned too: native
  touch/pointer movement composes `hitSlop` with `pressRetentionOffset`, releases
  and restores feedback across the boundary, cancels long press after drift,
  suppresses an outside release, and recovers on the next gesture. Deterministic
  coverage and both Release compile gates exist. The facade now also owns
  Android ripple drawable placement, backend color normalization, hotspot, and
  pressed commands without React's Pressable wrapper. The physical Pixel
  Release gate now passes diagonal exit/re-entry, cancellation and recovery,
  parent ScrollView takeover, visible foreground ripple pixels, terminal
  teardown, and package/process cleanup. The Pressable host owns the default
  native hit target, and one activation-time page origin keeps movement stable
  when reactive children change or Android changes out-of-bounds local
  coordinates. Solid-owned hover entry/exit callbacks now route direct Fabric
  pointer events with bounded delays, cancellation, causal attribution, and
  owner cleanup; both native Release compile paths pass. A guarded signed
  iPhone Release gate now passes diagonal and displaced release suppression,
  next-gesture recovery, an ordinary tap, positive parent ScrollView takeover
  without an accidental press, terminal teardown, and process cleanup.
  ScrollView drag ownership cancels every registered descendant Pressable
  before the later native release. Same-gesture retained-region re-entry, raw
  cancellation injection, and physical pointer-hover input remain open on iOS.
- Complete: core now exports a small reactive `Button` composed from the
  physically proven Solid-owned Pressable and Text facades. It owns the
  accessible button role and title-derived label, familiar Android/iOS visual
  defaults, Android ripple, iOS pressed feedback, reactive disabled/color/title
  state, and root/text style escape hatches without adding a Fabric descriptor.
  Production and strict-Diagnostics tests cover both platform presentations,
  while the packed external starter type-checks, tests, doctors, and produces
  verified Android/iOS bundles with all three starter actions using the public
  composition.
- Complete deterministically and Release-compiled: ScrollView exposes the
  pinned iOS/Android `maintainVisibleContentPosition` policy through a strict,
  reactive Solid prop for chat-style prepends. VirtualizedList now retains its
  keyed logical anchor, translates the logical minimum into the mounted native
  child index, and delegates offset correction to the platform without a
  JavaScript scroll command. A physical Pixel Release proof retains the exact
  Android row View and screen coordinate across a 50-row prepend; signed iPhone
  promotion remains open.
- Complete on Pixel and iPhone: base, refreshable, keyboard-aware, and
  TanStack-restored ScrollViews share a stable typed public handle. Named,
  bounded `scrollTo` and `scrollToEnd` options replace application-level raw
  Fabric command strings while preserving the backing native node as an
  explicit measurement/event-identity escape hatch. Production and strict
  Solid Diagnostics suites cover command transport, validation, disposal, and
  handle forwarding; physical Release runs independently complete the typed
  command, continuous event, measurement, and Fabric causality chain.
- Complete: the disposable proof is now a checked-in React Native 0.87 Release
  target with portable workspace/pod paths, Solid-generated TSX, a signal-driven
  press scenario, deterministic disposal, and a signed physical XCUITest
  runner.
- Complete: physical-device UI automation marker-verifies the iOS
  AppState/Fabric lifecycle commit, native press, Solid signal update, async
  reveal, identity reclamation, and teardown. The iOS 26 runner reacquires the
  real button after background/foreground activation when available and retains
  its pre-background coordinate as a fallback, without a test-only event hook.
- Complete: a checked-in ARM64 Android Release shell installs on a physical
  Pixel, mounts the same Solid tree through the shared portable coordinator,
  mounts an AppState lifecycle commit, routes a native press into Hermes,
  mounts its signal update, measures positive geometry, reclaims identities, stops its
  empty surface, and keeps the process alive. A checked-in AndroidX
  instrumentation test repeats the lifecycle, accessible touchscreen, and
  teardown assertions on connected hardware.
- Complete: the Android JSI installer, Kotlin `BindingsInstaller`, CMake source
  integration, portable Fabric coordinator, and UI-worklet evaluator are owned
  by the packed `@solid-native/fabric-host/native/android` seam rather than the test
  application. The checked-in Pixel shell consumes that seam through AGP 9's
  built-in Kotlin source-set API, while the generated upstream-style shell uses
  React Native 0.87's external Kotlin plugin. The runtime's exported Gradle
  helper supports both, resolves the installed package, wires its Kotlin and
  CMake inputs, and is verified from an isolated packed consumer. The complete
  Release instrumentation proof passes with that helper. The package-owned production `SolidNativeSurface` also owns
  empty-surface publication, UI-worklet handlers, immediate native-work
  cancellation, and bounded asynchronous start/stop acknowledgment instead of
  leaving that lifecycle in the test activity.
- Complete: `solid-native create` delegates to the exact React Native 0.87
  community template, rejects template drift or an existing target, and then
  writes the package-owned iOS, Android, CMake/JNI, OXC/Metro, and bounded
  JavaScript startup integration. A registry-shaped local artifact install
  type-checks, creates a Release bundle, compiles the upstream external-Kotlin
  Android shell, mounts a signal-driven press update on the physical Pixel, and
  compiles, signs, installs, and launches the generated Release shell on the
  physical iPhone. A prebuilt Android AAR is deliberately deferred: compiling
  the native source into `appmodules` preserves the exact React Native C++ ABI
  and application Codegen provider chain instead of creating a second binary
  compatibility matrix.
- Complete: Android's UI-thread Fabric mount hook reports the mounted base
  revision before Hermes receives lifecycle telemetry or reclaims identities;
  command-only transactions return no synthetic revision or mount event.
- Complete: the React-free bundle verifies synchronous `PlatformConstants`,
  asynchronous Linking, and event-emitting AppState TurboModule paths on both
  physical platforms.
- Complete: a pinned `@solid-native/runtime/react-native` platform service now
  contains React Native implementation imports, validates its 0.87.0
  native-module fingerprint, rejects malformed initial URLs and lifecycle/link
  payloads, and normalizes idempotent AppState, Linking, and hardware-Back
  subscriptions. The physical application consumes this boundary instead of
  importing five React Native internals directly. Core's `createAppState`
  projects the lifecycle into a fine-grained Solid accessor and binds native
  subscription cleanup to its Solid owner. Non-Fabric subscription callbacks
  can now enter the causal protocol through
  `createCausalPlatformEventHandler`; AppState uses it by default. A Pixel
  Release run requires the private platform event, named Solid lifecycle
  output, and root owner to be the exact three causes of the matching commit,
  mount, and next frame. The equivalent iOS causal assertion remains open.
- Complete: owner-bound native navigation subscriptions now enter the same
  non-Fabric causal boundary. A delivery-scoped retained-event result preserves
  React Native BackHandler's synchronous boolean while explicitly re-entering
  the discrete event around asynchronous blocker settlement. Pixel denies the
  first hardware Back without a commit, then requires only the allowed second
  event to cause its user-blocking pop commit, exact mount, and next frame. A
  live URL independently causes its normal structural chain without exporting
  the URL. Fabric handlers now have an equivalent explicit retained-event
  result; an iPhone interactive pop keeps its truthful default-priority
  `Screen.dismiss` event across deferred history settlement and requires that
  event plus the route owner to cause the exact pop commit, mount, and frame.
- Complete on Pixel: the generated Android Application forwards running-low,
  running-critical, background-or-worse trim levels and `onLowMemory` through
  the package-owned `SolidNativePlatformAndroid` Codegen TurboModule; ordinary
  `UI_HIDDEN` backgrounding is excluded. The owner-bound warning counter then
  requires the exact private event → Solid computation → Fabric commit → mount
  → next-frame chain and terminal teardown. The physical proof injects the
  exact Application callback deterministically and does not claim genuine
  system-wide memory pressure.
- Complete in the navigation runtime: an owner-bound TanStack memory policy
  converts those warnings into a recoverable mounted-route budget. The native
  stack cancels restoration prewarming, clears inactive and preloaded Router
  matches through the public cache boundary, and discards inactive settled
  snapshots without rewriting native history or the current route. External
  application caches remain an explicit policy surface. A six-process Pixel
  Release proof now drives that policy through the real Android
  `Application.onTrimMemory` callback, reduces the mounted-route budget from two
  to one, disposes the inactive Solid owner, clears an application-owned cache,
  preserves exact native stack/screen identities, then acknowledges recovery
  and remounts a fresh root through operating-system Back. The shared entry
  compiles in an unsigned iOS Release build; a fresh physical iPhone run remains
  open.
- Complete in the navigation runtime: `TanStackNativeScrollView` records finite
  native offsets under the owning stable history entry and restores a newly
  mounted container after route-tree parking without commanding a retained
  native view on every refocus. The deterministic host proof covers real
  ScrollView events/commands, negative UIKit bounce normalization, malformed
  payload isolation, stable outer Screen identity, and bounded entry pruning.
  A versioned controller now restores those offsets across process death only
  when navigation restored the same stable history IDs, removes stale state on
  fresh/deep-link launches, and coalesces bounded vendor-neutral storage writes.
  History, tabs, and scroll queues retain the newest value after a failed write
  and retry only on a later update or explicit flush, avoiding both silent loss
  and hot failure loops. Live scroll capture enforces the full serialized cap
  with exact incremental accounting, rejecting an oversize update atomically
  without serializing the entire registry at native scroll cadence. A focused
  six-process Pixel Release proof now captures 320dp, persists it with the
  stable root history ID, restores it in a fresh PID, and preserves the same
  offset through memory-pressure reclamation/remounting. The signed iPhone
  companion performs a physical 320-point drag and requires the replacement
  scroll container in its second PID to recover the same on-screen position.
- Complete for the promoted single-stack and tabs product paths: a shared
  cross-platform source-map gate requires the exact entrypoint, generated
  native bindings, core facade, and complete Solid navigation package seam,
  and rejects every `react-native-screens` JavaScript wrapper. Android applies
  it before installing either APK. iOS separates signed `build-for-testing`
  from `test-without-building`, verifies the composed Hermes map between those
  steps, and starts its device-process watchdog only after the artifact passes.
- Complete on Pixel and iPhone: the owner-bound notification accessor accepts a lazily
  loaded service and gives all five normalized foreground kinds stable platform
  event names. Service replacement, detachment, root disposal, and failing
  native subscription setup/removal are deterministic and diagnostic failures
  remain isolated. Delivery/dismissal observations use default priority; press
  and action inputs are discrete. The physical Release run requires the delivery
  event, root owner, and `platform.notification.output` computation to be the
  exact causes of its normal Fabric commit, mount, and next frame while the
  notification identifier remains absent from telemetry. Android then opens the
  operating-system notification shade and taps the explicitly pinned default
  body action. Its discrete press event, root owner, and the same named output
  are the exact causes of a user-blocking commit, mount, and frame. The signed
  iPhone Release gate independently requires wrapper-free native delivery to
  produce the same private default-priority event, root owner, and named Solid
  computation as the exact causes of its normal commit. It then proves native
  query, cancellation, owner teardown, and host-process survival. Notification
  Center content inspection and body-press interaction remain Android-only.
- Complete: a checked-in TypeScript Fabric spec generates a custom component
  descriptor and typed prop binding. Solid mounts the native iOS and Android
  implementations without React rendering, measures them on both physical
  devices, and tears their identities down through the shared coordinator.
- Complete: Solid 2 promise-returning computations drive native `Loading`
  fallback/reveal transitions atomically. Primitive nodes adopt the surface of
  their insertion parent, detached fallback identities are reclaimed in the
  reveal transaction, and disposed owners ignore late async results. Physical
  Android instrumentation holds the fallback through a lifecycle round trip,
  then verifies the promise reveal as exact Fabric commit 4 after native input.
- Complete: a discrete native event can invoke a genuine Solid 2 action;
  optimistic state mounts in a user-blocking commit and reconciles in a
  separate normal-priority commit when yielded work settles. Returning the
  action promise links both commits to the initiating native event.
- Complete: a reproducible in-memory harness measures causal telemetry overhead
  with instrumentation disabled, a no-op sink, and the bounded local timeline.
- Complete for the first Android and iOS native executors: `@solid-native/animation`
  validates and deeply freezes bounded numeric worklet graphs, defines atomic
  timestamped host updates and owner-bound graph sessions, and evaluates
  reference semantics in memory. Both React Native bindings independently
  decode the graph in C++, schedule evaluation through Android `Choreographer`
  or iOS `CADisplayLink`, and apply bounded opacity/translation/scale/rotation
  channels to one owned Fabric view on the main thread. Physical Pixel and
  signed iPhone Release tests verify native rejection, initial/update frames,
  target identity, output application, sequence inspection, cancellation, and
  empty-surface teardown. The Solid adapter rejects ownerless installation
  before allocating a native graph; the physical proof captures its render
  owner and explicitly re-enters it when a native event installs the session.
  Coarse bridge update failures dispose before reporting, cleanup attempts
  remain exactly-once even when native destruction throws, and synchronously or
  asynchronously failing diagnostic hooks are isolated from owner teardown.
  Application code can author that same bounded protocol from typed named
  inputs and numeric expression helpers instead of hand-writing transport ASTs.
  `createNativeViewAnimation` binds a ref only after the renderer's native mount
  acknowledgement, hides Fabric/backend adapter construction, exposes the full
  imperative driver surface, optionally synchronizes a Solid accessor, and
  owns teardown. Its pull-based reduced-motion policy accepts the accessibility
  controller's fine-grained accessor without a package dependency: target-based
  drivers publish their validated endpoint immediately, explicit decay is
  suppressed, and direct pan tracking remains while release inertia is omitted.
  The physical Android Release proof installs, updates, inspects,
  and disposes this product path before continuing into adapter conformance.
  Both also start, advance, interrupt, and finish a bounded native timing
  without JavaScript frame updates. They accept 1–32 cumulative named timing
  keyframes in one call, validate every complete native endpoint before
  replacement, skip stages analytically after late callbacks, and retain one
  cadence window for the full sequence without JavaScript stage handoffs. Both
  expose an optional synchronous cancellation handshake that freezes the exact
  last evaluated native vector, removes the pending driver frame, preserves
  diagnostics, and updates the session mirror only after validating the
  returned complete vector. The Android Release proof cancels a moving timing,
  observes a stable mounted output and idle scheduler, then resumes a named
  partial timing from that frozen vector. The iOS implementation is
  Release/ARM64 compile-verified pending its physical rerun. Both now bind bounded
  two-axis pan input to the owned view, transfer the graph input vector to
  native ownership, and expose a synchronized detachment handshake that returns
  visible state before Solid ownership resumes. The Android Release proof
  removes the real listener, preserves the mounted output, and applies a first
  post-detach Solid frame from that vector. The iOS implementation is
  Release/ARM64 compile-verified pending its physical rerun. Both pass a real physical touchscreen-drag proof
  through `OnTouchListener` or `UIPanGestureRecognizer` without a Hermes update
  callback. Both executors now publish bounded frame-cadence statistics with
  exact aggregate counts and explicit quantile-sample loss. Five-second
  physical gates recorded 302 clean frames on a 60 Hz-class Pixel path and 601
  clean frames on a 120 Hz iPhone path, then passed the same pan and teardown
  proof. Both native bindings also execute the same bounded analytical spring
  across underdamped, critically damped, and overdamped regimes. Physical
  proofs interrupt an active spring from its latest evaluated frame, observe
  underdamped overshoot, require an exact endpoint and zero terminal velocity,
  and retain bounded spring cadence statistics. Both bindings also run the same
  bounded analytical velocity decay. Physical proofs interrupt it from the
  latest evaluated vector, require a cadence-independent exact endpoint, zero
  terminal speed, bounded decay statistics, native pan handoff, and teardown.
  Android now also carries the real recognizer velocity into that analytical
  decay without a Hermes callback, validates the final pan and terminal vectors
  before publication, and physically proves motion beyond the touch endpoint.
  Android also physically proves both direction changes and exact settlement
  for the three-leg keyframe sequence. The matching iOS keyframe and release
  paths are Release/ARM64 compile-verified and await a physical rerun.
  Concurrent independently driven values and heterogeneous driver chaining
  remain open.
- Complete on Android: matched Release flavors run the same annotated Solid
  tree with the telemetry session omitted or sampled in, use a reproducible
  seed-balanced cold-launch order, record raw Hermes/JSI/Fabric shadow-commit
  samples and environment metadata, and require a final physical UI-thread
  mount. A second mode injects a density-correct physical-device touchscreen
  tap and records the exact native event, Solid commit, Fabric mount, and
  next-vsync boundaries. A third mode runs 30 sequential real taps per launched
  flavor, rejects gaps or overlap, and separates six cold process pairs from
  180 correlated event pairs. Clean Pixel 9a results for all three modes are
  retained with thermal status 0 throughout; the event-to-frame distributions
  are explicitly too broad for a stable latency claim. Android telemetry, list,
  and idle-resource results include the deterministic native-compatibility
  fingerprint and bounded input count, failing before device work if the CLI
  evidence is unavailable or malformed. All modes are diagnostic-only; an iOS
  counterpart remains open. The representative Solid order dashboard now
  requires all 30 physical inputs to retain their native event, named owner,
  affected computations, exact commit, Fabric mount, and next-vsync chain;
  Android independently verifies every visible state and six structural alert
  lifetimes, while the proof rejects rendered values in telemetry. A separate
  matched Solid Native/React Native run has a clean six-pair Pixel 9a corpus
  retaining 360 exact state transitions with thermal status 0 and no frozen or
  dropped frame reports. The product workload now also has a seed-balanced
  telemetry-disabled/telemetry-enabled Android runner with identical lifecycle
  waits and 30 physical inputs per process. Its clean six-pair Pixel corpus
  retains 180 paired events with thermal status 0 and no frozen or dropped
  frame reports; the narrow handler-to-commit boundary has a +0.710 ms paired
  median while the broader event-to-frame distribution crosses zero. Three
  exhaustive Pixel navigation interactions now also require native focus,
  static owner, named Solid computation, exact commit, Fabric mount, and
  next-vsync causality. The iOS counterpart and broader text-input composition
  remain open. The first controlled TextInput value path is now complete on the
  Pixel: all contributing direct native `changeText` operations, including
  facade-consumed controlled acknowledgements, join the static root owner and
  `input.text.value.output` computation at the exact commit, mount, and frame;
  the proof rejects typed content in telemetry. The Pixel's programmatic
  controlled-selection command now also retains that owner/computation chain
  across the async dispatch boundary and into its exact command-only commit,
  without recording arguments. The Pixel submit path now joins its direct
  discrete event, `input.text.submit.output` computation, user-blocking commit,
  mount, and frame while independently verifying blur; neither submitted text
  nor command arguments enter telemetry. The multiline Pixel path now likewise
  joins every contributing change operation with
  `input.multiline.value.output`, its user-blocking commit, mount, and frame,
  while retaining key and content-size callbacks as successful non-causal
  observations and rejecting the editor value. Physical selection insertion
  now also distinguishes its contributing change from the successful
  non-writing selection callback while preserving the editor computation,
  commit, mount, and frame. The controlled Switch rollback now retains both
  its discrete native event and `input.switch.controlled.output` computation
  through the isolated, user-blocking command commit without recording payload
  or arguments. Its following measurement retains that named output without
  exporting geometry. Android Modal presentation, show, and platform close now
  likewise retain `modal.lifecycle.output` through three exact commit, mount,
  and frame chains. The iOS causal composition run remains open.
- Complete: a standard React Native/Fabric control shares the native shell and
  generated component with the Solid target. Both paths pass physical Android
  instrumentation and signed iOS XCTest runs, including accessible native
  input, visible state updates, and marker-verified Hermes execution.
- Complete: a paired iOS Activity Monitor sampler cold-launches the installed
  Solid and React/Fabric targets, retains exportable Instruments artifacts on
  request, and reports raw post-warmup process CPU, cumulative CPU time,
  context switches, interrupt wakeups, thread bounds, memory samples, and
  slopes without misclassifying a short idle observation as an energy or leak
  verdict. All physical-iOS runners now reject a sustained high-CPU macOS
  Console device-log relay before launch, preventing known host-tooling heat and
  invalid Instruments evidence from being mistaken for an application leak.
  Bounded runners install a parent-liveness watchdog in addition to ordinary
  shell traps, with a 20-minute wall-clock lease so an abruptly killed or wedged
  test or Instruments shell still reaps every Solid Native app and XCTest
  process instead of accumulating variant bundle processes on the phone. A
  read-only repository status command maps any surviving test PIDs back to
  their installed bundle identities and can emit versioned JSON for unattended
  diagnostics. The public CLI now adds application-scoped `device status-ios`
  and `device stop-ios`: both require one exact developer-installed bundle,
  keep installation paths out of their output, and the stop path follows only
  that bundle's replacement generations until four clean polls span one second.
  A signed physical-iPhone run found and stopped the isolated Devtools PID, then
  reported a stable zero-process result. Normal runner teardown verifies foreground cleanup
  before releasing that watchdog, retries transient CoreDevice failures three
  times, and leaves the detached guard alive to retry after parent exit when
  foreground cleanup still fails. Broad cleanup now reacquires the complete
  device process inventory after every termination and requires four
  consecutive clean polls, so an iOS scene replacement under a new PID cannot
  hide behind the departed process that CoreDevice was originally asked to
  stop. Every direct physical runner also checks CoreDevice's current lock
  state before compilation or Xcode work, preventing an auto-locked phone from
  turning a long Release build into a stalled installation. Paired Activity
  Monitor results also retain the
  deterministic iOS native-compatibility fingerprint and bounded input count,
  failing before device launch when that CLI evidence is unavailable or
  malformed. They combine duration-weighted live intervals with sparse raw
  counter updates, so a long unchanged idle tail counts as trace coverage
  without inventing samples or mistaking Instruments' sparse encoding for app
  suspension. XML written before a known `xctrace export` crash is accepted only
  after strict table-specific schema and row validation.
  They also classify XCTest's pre-launch UI-automation timeout from the
  structured result bundle and never retry it automatically, so a wedged device
  service is not misreported as application CPU or amplified into more heat.
- Complete: the paired Android sampler records local PSS/RSS samples plus
  process CPU time/percentage, main-thread context switches, thread bounds, thermal,
  power-saver, device, OS, revision, and dirty-state metadata with the same
  diagnostic-only interpretation. Its target process is synchronously
  force-stopped and verified absent on success, failure, or interruption.
- Complete: idle-memory sampling no longer reuses the assertion-heavy proof
  application. Dedicated Solid and React Release identities mount the same
  View/Text/generated-component/Pressable tree on both platforms. The iOS
  runner retries launch attachment and export failures and rejects traces that
  do not cover their requested post-warmup duration.
- Complete: the public ScrollView facade owns React Native's required hidden
  content-container structure and selects the vertical/horizontal platform
  components in the native backend. Signed iPhone and Pixel Release runs
  dispatch `scrollTo` as command-only sequence 5, receive a positive-offset
  continuous event, mount Solid result commit 6, and verify fresh geometry. The
  Pixel proof additionally retains the named ScrollView computation through
  the argument-free command operation and its normal-priority command-only
  commit.
- Complete: the public Image facade canonicalizes URI sources, applies source
  dimensions and React Native-compatible defaults, and opts into load/error
  notifications only when observed. Signed iPhone and Pixel Release runs decode
  the same offline PNG, receive a default-priority direct `load` event with
  decoded geometry, and batch the Image and ScrollView status writes into exact
  commit 6. On Pixel, the independent Image and ScrollView events each parent a
  bounded task across the async barrier; the shared commit requires both tasks,
  both named status computations, the root owner, its exact mount, and the next
  frame without retaining event payloads. The equivalent iOS causal run remains
  open.
- Complete: the public ActivityIndicator facade owns the React-wrapper defaults,
  centers a deterministically sized native spinner in a styleable container,
  and keeps platform descriptor details behind the backend. Android maps to an
  indeterminate `AndroidProgressBar` with its required constructor style; iOS
  maps to `ActivityIndicatorView`. Signed Pixel/iPhone tests verify their actual
  accessibility wrappers and positive native geometry.
- Complete: the public Switch facade owns native event subscription,
  accessibility checked/disabled state, both public callback forms, and
  controlled-state restoration without React Native's React wrapper. The
  backend selects `AndroidSwitch` or UIKit `Switch`, translates tint colors and
  command names, and treats `valueChange` as discrete bubbling input. Signed
  Pixel/iPhone tests physically toggle the real control and verify an isolated
  command returns its value to the rejected Solid-controlled state. The Pixel
  proof additionally requires that command to retain both its exact input and
  `input.switch.controlled.output` causes plus user-blocking commit priority,
  without recording payloads or arguments.
- Complete: the public Modal facade owns defaults, content/accessibility
  containment, presentation validation, and the platform-specific dismissal
  lifetime normally supplied by React Native's React wrapper. Host contract v1
  carries the backend platform identity. Android mounts `visible=false` before
  structurally dismissing its Dialog; iOS retains the ComponentView event route
  until UIKit emits its asynchronous `onDismiss` completion. Signed Pixel and
  iPhone automation proves show plus system-Back request or UIKit completion on
  the real native modal. The Pixel additionally proves three independent
  `modal.lifecycle.output` chains from physical presentation, native show, and
  system-Back close through their exact commits, Fabric mounts, and following
  frames without retaining payloads. A cross-platform `onHidden` boundary now
  follows the final park commit, and terminal component cleanup explicitly
  reclaims the private detached parking tree instead of retaining it until
  native-root shutdown.
- Complete: `NativeHistory` drives Solid-owned `Screen`/`ScreenStack`
  presentation through pinned native Fabric containers. Signed iPhone and Pixel
  runs mount application push commit 7, reconcile a physical edge-swipe or
  Android system Back into platform-originated history, and mount pop commit 8.
- Complete: each keyed stack owner can mount a reactive `ScreenHeader` directly
  as the native screen's non-first child. The transport-safe surface owns
  titles, colors, back-button policy, shadow/translucency, iOS large-title
  typography, safe top-inset handling, and custom back/left/right/center
  subviews without a React wrapper. The iOS path also owns native left/right
  bar-button arrays with buttons, spacing, SF Symbols/XCAssets, badges,
  reactive state, and bounded nested menus. Only validated data and generated
  positional IDs cross Fabric; discrete native item/menu events recover the
  current Solid-owned callbacks. The Pixel Release test physically presses a
  reactive Solid-owned right-slot action, observes its changed native
  accessibility label, and requires the corresponding AppCompat toolbar to
  have positive native geometry. The signed iPhone Release test physically
  presses the UIKit bar button, observes its Solid state update, opens the
  native menu and submenu, selects the nested action, and observes the second
  Solid update before continuing through cancellation, restoration, and
  teardown.
- Complete on Pixel and iPhone: keyed stack entries expose a
  validated form-sheet contract with ascending ratio or content-fit detents,
  initial/undimmed indices, grabber, corner, scroll, elevation, top-inset, and
  resize policies plus typed stable/transient detent events. Android keeps the
  `RNSScreen` Material bottom-sheet path while iOS selects `RNSModalScreen` for
  modal geometry. A physical Pixel drag moves `[0.55, 0.92]` to stable detent
  `0`, crosses the native event adapter into a Solid signal and accessible
  output, persists the sheet route, and restores that history in a fresh
  process. A signed iPhone Release run presents the same ratios, drags the real
  UIKit grabber from expanded to half-screen, requires stable detent `0` in
  Solid-visible state without recreating the route, verifies positive native
  geometry movement, and tears down the sheet owner and Fabric surface.
- Complete: `NativeModalStack` retains history entry `0` as application
  content and projects later active entries into keyed standalone `Modal`
  routes. Application and platform closes preserve each Solid owner through
  Android's park commit or iOS UIKit dismissal, acknowledge pending history
  only after the final hidden route, arbitrate async blockers, disable iOS
  swipe dismissal while blocked, and restore modal prefixes without synthetic
  transitions. The core facade also normalizes React Native 0.87's accepted
  interactive iOS `requestClose` into an exact-once portable dismissal when the
  ordinary host `dismiss` event is absent. Production/development tests require
  detached native nodes and route owners to be reclaimed exactly once. A signed
  iPhone Release proof closes one page sheet through application history,
  rejects a physical drag while blocked, accepts another after reactive
  unblocking, and verifies one platform pop plus balanced non-terminating
  teardown.
- Complete: `NativeStack`, `TanStackNativeStack`, and experimental `NativeTabs`
  accept reactive navigator-wide `defaultScreenOptions`. Keyed route/tab
  resolvers shallowly override matching keys, explicit `undefined` clears an
  inherited value, nested transport contracts remain atomic, and each stack
  owner captures its structural presentation kind once. Production and
  development renderer suites update inherited tab badges and stack gestures
  in place while retaining every keyed native node and Solid owner.
- Complete, experimental: `NativeTabs` retains one Solid owner and native root
  per stable tab key, reconciles controlled selection through the native
  provenance protocol, retries stale requests without feedback loops, and
  validates selection/lifecycle payloads. Dedicated signed Pixel and iPhone
  Release runs physically tap their native tab bars, require positive accessible
  geometry, retain scene-local signal state across repeated switches, and
  balance teardown. Android independently loads a URI-backed raster icon through
  Fresco, checks a compiled drawable icon, and passes the singleton Solid/Hermes
  bundle gate. The public icon contract maps Android URI sources plus iOS SF
  Symbol, XCAsset, original image-source, and template image-source descriptors
  without transporting opaque React asset objects. Bounded platform appearance
  objects cover native tab state/layout colors and typography, Android
  ripple/indicator/label policy, and iOS standard/scroll-edge blur and shadow
  policy; the renderer validates
  and copies them before the Fabric host recursively processes known nested
  color values. The Pixel gate reads the resulting Material state lists and
  policy directly. Together with the iPhone gate, it backed device-verified
  4.25.2 catalog claims for `RNSTabsHostAndroid`, `RNSTabsScreenAndroid`,
  `RNSTabsHostIOS`, and `RNSTabsScreenIOS`. Upstream stabilized the Tabs API in
  4.26. The Pixel and iPhone restoration/appearance/image gates now pass again
  on 4.27, promoting all four Android/iOS tab surfaces to `device-verified`.
  The pinned patch now also reconciles mutually exclusive Android icon props at
  the end of each native update transaction and guards Android/iOS asynchronous
  completions by current request ownership. A signed Pixel sequence physically
  proves image removal, resource replacement, post-transition stability, and
  final image restoration without replacing the retained Solid tab owner.
  A signed iPhone sequence directly inspects both `UITabBarAppearance` objects,
  item identities, selection, geometry, state colors, badge styling, blur,
  shadow, and selected font weight. It then proves template-raster removal, SF
  Symbol replacement, stale-raster rejection during an immediate clear, stable
  empty state, and resource/raster restoration on the retained Home owner.
- Complete on Pixel and iPhone: one product phase composes a protected cold
  launch, replacing login redirect, the platform tab host, the Settings tab's
  Solid-owned TanStack `ScreenStack`, an async detail entered through
  `TanStackNativeLink`, an interrupted programmatic route, and a final native
  sheet. The link press owns its separate pending and normal-priority commits.
  The slow sheet task is canceled when a second press replaces it; the winner
  owns the final commit, late settlement is causally detached, and history is
  exactly `[/, /detail, /sheet]`. The flow retains the exact tab host, stack,
  root/detail Screens, and scene signal. Android uses system Back around its
  Material sheet; iOS uses the UIKit sheet and physically presses both native
  header Back controls. Both round-trip Home/Settings, restore detail, reveal
  root, and balance route, loader, native-node, Screen, tab-owner, and
  Fabric-surface lifetimes exactly.
- Complete: a keyed Settings tab owns an independent `NativeHistory` and real
  nested `NativeStack`. The Pixel proof pushes a detail screen, verifies the
  native ScreenStack/header geometry, retains the detail handle and shared
  signal across Home/Settings switches, then routes a real Android system Back
  event to the selected Settings history, pops and disposes the detail once,
  and preserves the tab host and root owner. The dynamic handler captures its
  target across asynchronous blocker arbitration. That same tab now owns a
  TanStack history adapter, Solid-backed router stores, provider, loaders, and
  `TanStackNativeStack`; the Pixel proof navigates through the router, renders
  loader data, and retains its route component and native identity across tab
  switches. `createNativeTabsState` now replaces application glue with a
  fine-grained selected-key accessor, retained keyed histories, atomic live
  cross-tab links, and a bounded versioned persistence envelope. Cold links
  discard restoration and start directly at the accepted target; ignored URLs
  still allow exact-key restoration, while corrupt or incompatible storage is
  removed after safe fallback. The same coordinator now drives a physical
  Pixel cold cross-tab launch from Android's registered URL. That run supplies
  obsolete Home-selected state through the actual AsyncStorage 3.x adapter,
  requires the URL-discarded key to be cleared before persistence setup and
  Settings/detail to start without a stale Back entry, replaces it with the
  clean root, then proves retained TanStack state and selected-history Back
  through physical tab interaction. It flushes, reads, and decodes the final
  multi-history envelope from AsyncStorage before removing the proof key. A
  separate seed/restore sequence now flushes Settings root/detail, stops the
  app process, verifies it is gone, restores the selected detail under
  a different PID, preloads the nearest root, and returns through real Android
  system Back or an iPhone left-edge interactive pop. Each runner then performs
  the cold-link phase under a third PID. The iPhone additionally proves the
  generated `UITabBar`, native item identifiers/state, a naturally canceled
  selected-tab gesture, blocker rejection with the detail retained, an allowed
  retry after release, and the same retained TanStack route component. The
  runtime normalizes the nested stack's `gestureCancel` blocker event with the
  standalone stack's `nativeDismissCancel` event. Arbitrary restored-stack
  preload policy remains open; future upstream pins must repeat the physical
  promotion matrix.
- Complete: repeated navigation tests preserve the keyed root screen and direct
  content handle across 100 deterministic native-dismiss cycles, dispose each
  removed Solid owner exactly once, cover canceled dismissals, and keep the
  final native tree bounded. The signed physical Pixel process proof repeats 30
  push/system-Back cycles against one retained Java `ScreenStack`, balances all
  detail owners and nodes, and verifies zero-stale loader revalidation without
  root-component recreation. A separate in-memory benchmark records
  history-only, direct rendered stack, and TanStack/Solid 2 rendered two-commit
  churn distributions.
- Complete: native history persistence has a versioned, bounded JSON codec that
  validates untrusted restoration shapes and transport-safe state, rejects
  cycles and resource-exhaustion inputs, and preserves forward entries and
  stable screen identities without automatic storage side effects. Transient
  write failures retain the newest coalesced snapshot for an explicit or
  update-driven retry. Push, replace, reset, and system deep-link candidates
  also validate the complete serialized bound before assignment, so a rejected
  application state leaves both stack and generated-ID allocation unchanged.
- Complete: a framework-neutral live-link adapter validates React
  Native-compatible URL events and records accepted destinations as
  system-originated history. The signed physical iPhone and Pixel runs open the
  registered URL through the operating system, deliver it through the native
  Linking path, and mount exact Fabric commit 9 in the real screen stack.
- Complete: cold-start reconciliation gives an accepted platform URL precedence
  over restored navigation without exposing old screens behind Back, preserves
  stable IDs when valid restoration wins, and reports corrupt or obsolete
  storage while falling back to a safe initial route.
- Complete: signed iPhone and Pixel runs now cold-launch from the registered
  URL and mount its isolated native stack as commit 1. Native focus drives a
  visible Solid commit 2 before the clean-root reset in commit 3. The reset
  root's own native focus is now an explicit commit-4 barrier. The current
  exhaustive sequence proves a separate running-process URL and focus reaction
  in commits 16 and 17.
- Complete: `NativeStack` exposes native-event-derived focus state as a
  per-screen Solid accessor, plus focus/blur callbacks carrying the stable
  history entry and semantic native event. A focus exclusively reconciles all
  keyed owners even when Android omits a paired disappear event. Signed iPhone
  and Pixel runs mount visible detail, restored-root, and deep-link focus
  reactions and feed the renderer's existing causal event telemetry.
- Complete: direct launcher startup and cold-link root reset synchronize the
  initial native screen focus reaction before geometry reads or resource
  acquisition. Each commit is incorporated into the proof sequence, so a late
  focus cannot be coalesced with camera or AppState work and shift every later
  causal boundary.
- Complete: pinned TanStack Router core now runs on Solid 2 signals and memos
  behind an owner-bound native provider. A native-node route view covers
  initial/pending load, loader data, error recovery, global not-found state,
  browser-scroll isolation, and teardown. Nested route components and outlets,
  loader/component error boundaries, and registered-router typed match/loader
  selectors are deterministic. `TanStackNativeStack` retains the last settled
  match tree, local Solid state, and native identities per inactive keyed screen;
  the physical Pixel Release proof now exercises route loaders/components,
  blocker-mediated system Back, retained root identity, deep linking, and a
  cold reset through that projection. Retained route graphs stay live by
  default, while owner-safe focus effects start and clean up expensive native
  work from actual focus/blur events without destroying screen state. An
  abort-aware task variant gives every focused interval a fresh standard
  `AbortSignal`, ignores only stale post-cancellation rejections, and reports
  active failures through the isolated diagnostic convention. The physical
  signed iPhone and Pixel process suites now prove balanced task starts/aborts
  across transitions and final teardown in addition to exclusive detail/root
  focus. The Pixel Release proof covers six distinct app processes: seed,
  restore, memory-pressure recovery, 30-cycle native churn, authenticated
  interruption, and cold-link precedence.
  Restored inactive entries now have an explicit, sequential, owner-safe
  preload bound. A one-entry bound is physically proven across Pixel and iPhone
  app-process restarts. Navigation history, platform-event, tab, provider, and
  preload diagnostics now also isolate both synchronous throws and asynchronous
  rejections. A typed `TanStackNativeLink` now projects registered-router
  destinations through the React-free native `Pressable`, with Solid-owned
  active/pending/transition state, duplicate-request suppression, and explicit
  native touch-intent/render preloading; choosing a general real-world restored-
  stack preload policy remains.
  A registered-router typed navigation hook now owns relative programmatic
  transitions, and TanStack `beforeLoad` redirects replace denied native
  history entries for auth/onboarding flows without component-side effects.
  Native link presses and programmatic calls now start bounded, privacy-safe
  navigation tasks that retain causality through asynchronous loader settlement
  into the final Solid/Fabric commit; concurrent requests are latest-wins and
  teardown cancels unfinished tasks. The Pixel Release process suite now proves
  the public native link across a real async loader and a separate pending
  frame, including all 30 churn cycles. A sixth product phase physically proves
  auth replacement followed by an interrupted slow programmatic route: the
  displaced task cancels, the retained native screen becomes the winning home
  route, stale loader settlement cannot overwrite history, and Android Back
  reveals the original login screen. The corresponding iPhone path now passes
  a signed current-source UI Automation run, including Keychain session
  restoration and secure deletion across two application processes.
- Complete: the public `TextInput` facade maintains React Native's native event
  counter internally, rejects malformed counts, and drops stale changes so a
  controlled Solid value cannot overwrite newer platform input. Deterministic
  conformance covers the event-to-value-to-prop round trip. The backend maps
  the portable component to `AndroidTextInput` or `RCTTextInput`, normalizes
  public values to Fabric's `text` prop, fixes the counted
  `setTextAndSelection` signature, and normalizes changes to discrete priority.
  Signed Pixel/iPhone tests focus the real editor, type through platform UI
  automation, then prove a later Solid value replaces the platform editor and
  visible mirror with fresh geometry after the final event-count
  acknowledgement.
- Complete: the public TextInput facade derives React Native-compatible
  `submitBehavior` from single-line/multiline mode and deprecated
  `blurOnSubmit`, without invoking React Native's React wrapper. The host treats
  native `submitEditing` as direct discrete input. Signed Pixel/iPhone tests
  press the real return key after a controlled replacement and verify the
  submitted current text, native blur, and resulting Solid commit.
- Complete: the TextInput facade normalizes the pinned React Native 0.87 form
  contract without its React wrapper. Reactive `inputMode`, `enterKeyHint`, and
  `readOnly` own their documented precedence over lower-level keyboard, return
  key, and editability props. Portable autocomplete values map to Android
  autofill hints or iOS text-content types, with explicit iOS policy winning.
  Deterministic Android/iOS conformance also proves keyboard suppression,
  hidden-caret behavior, read-only focus-group exclusion, default font scaling,
  and Android's sentence-capitalization, empty-placeholder, transparent-
  underline, cursor-color, and selection-handle wrapper behavior. Physical
  autofill UI policy remains an alpha validation item because it depends on
  configured device credentials and operating-system suggestion state.
- Complete: TextInput style normalization no longer depends on React Native's
  React wrapper. Nested style arrays retain last-write precedence; numeric font
  weights become native strings; `verticalAlign` becomes
  `textAlignVertical`; and multiline iOS editors receive the wrapper's
  five-point top inset only when no padding, vertical padding, or top padding
  was supplied. Deterministic conformance proves each rule reacts without
  remounting on Android and iOS.
- Complete: the TextInput facade owns React Native's event-counted controlled
  text/selection synchronization, validates and normalizes public selection
  ranges, tracks native ranges internally, and uses isolated
  `setTextAndSelection` commands. Renderer flushes await commands started by
  framework reactive effects. Signed Pixel/iPhone tests place the native caret
  at offset 5, physically insert `X` there, observe the platform-specific
  selection callback, and restore the controlled editor with the latest event
  count. The native coordinator rebases retained nodes and commands onto the
  newest mounted ShadowNode family member so platform-owned editor state cannot
  be replaced by an obsolete Solid-side snapshot between those operations.
- Complete: multiline TextInput exposes `numberOfLines` and direct,
  default-priority native `contentSizeChange` events while retaining Solid-owned
  submit-behavior defaults. Its `keyPress` route is discrete and bubbling;
  Android enables the native input-connection watcher only when subscribed.
  Same-text native echoes advance the hidden event acknowledgement without
  invoking application change handlers twice. Signed Pixel/iPhone tests observe
  `Enter` before typing two physical lines, commit the controlled value, observe
  native content-size growth, and prove newline mode retains focus without
  submit or blur. The exhaustive runner exposes readiness before demanding an
  input-driven size event and compares the observed minimum/maximum heights,
  avoiding a mount-time event-order dependency on empty editors.
- Complete: TextInput exposes the remaining pinned React Native 0.87 editing
  lifecycle surface without its React wrapper. `onEndEditing` receives the
  platform's final text as default-priority lifecycle input, while opt-in
  `onScroll` installs the native editor watcher and crosses both adapters at
  continuous priority. Deterministic tests cover subscription and payload
  delivery; the Android and iOS Release compilers cover the native routes.
- Complete: the first local CLI command, `solid-native doctor`, discovers nested
  applications, validates the exact React Native backend and Solid Native
  core/Fabric Host/runtime set, checks Fabric/Hermes and both native toolchains,
  supplies actionable remediations, and emits a schema-versioned JSON report
  with CI-safe exit status. Navigation consumers additionally verify the exact
  screens peer, package-exported patch, and post-patch native file hashes. Its
  dependency-injected diagnostic engine and executable entry points have
  deterministic tests, and the command passes against the checked-in
  physical-device application on the current Mac.
- Complete: `solid-native run ios|android` resolves the nearest application's
  pinned local React Native CLI, verifies its backend/core/Fabric Host/runtime contract,
  forwards native arguments without a shell, streams the underlying build, and
  preserves its exit status. Schema-versioned dry-run plans expose the exact
  invocation before it mutates device state. Tests cover planning, quoting,
  execution injection, invalid backend ranges, and executable JSON output; the
  real command has completed Release build, install, and launch on the physical
  Pixel and signed iPhone. Explicit iOS physical-device names and identifiers
  now carry a bounded CoreDevice lock preflight before React Native starts;
  `--udid` retains simulator behavior by resolving CoreSimulator first. Locked
  phones, disabled Developer Mode, and tunnel failures therefore fail before
  Metro, CocoaPods, or Xcode work.
- Complete: `solid-native logs android PACKAGE` selects one exact
  authorized device, resolves the installed package UID, and streams only that
  application's JavaScript and native logcat records across process restarts.
  Read-only dry runs expose the serial, UID, bounded history, and exact command;
  live output is neither parsed nor retained. `solid-native logs ios BUNDLE`
  requires an explicit CoreDevice and restart acknowledgement, verifies the
  developer-installed app through machine-readable discovery, and streams its
  launch console without claiming history or cross-restart continuity. Its
  signal path terminates the launched app and local streamer together.
- Complete: public `solid-native device status-ios` and `device stop-ios`
  provide exact-bundle lifecycle recovery for physical development phones.
  Status is read-only; stop terminates only PIDs mapped inside one verified
  developer-installed app URL, catches immediate replacement generations, and
  succeeds only after a one-second clean window. Strict parsing, bounded
  CoreDevice output/time, idempotence, relaunch failure, path-free JSON, and the
  real signed-iPhone running → stopped → stable-zero sequence all pass. Neither
  command uninstalls the app or targets unrelated device processes.
- Complete: `solid-native open android PACKAGE URL` and its iOS counterpart
  provide inspected physical-device deep-link delivery with explicit preserve
  and cold modes. Android constrains resolution to the verified installed
  package and validates the exact Activity returned by `am`; iOS verifies one
  developer-installed bundle and consumes CoreDevice's bounded JSON launch
  acknowledgement. Dry runs remain read-only, URL and device inputs are
  bounded, and success deliberately does not claim that application routing
  rendered a particular destination.
- Complete: `solid-native build ios|android` applies the same installed Fabric Host/runtime,
  backend, native-project, SDK environment, process-tree, and exit-code gates,
  but delegates to the application-local non-launching React Native build
  command. It defaults to Release, respects explicit iOS schemes/destinations
  and Android Gradle tasks, and emits schema-versioned dry-run plans for local
  CI and signing workflows.
- Complete: both native `run` and `build` plan construction now reuses the
  application-level Solid/compiler diagnostic gate. A missing exact Solid
  singleton, direct native tool pin, installed Metro package, OXC resolver or
  transform worker, or Solid-owned JavaScript bootstrap fails during planning,
  before either native build system starts—even for a dry run.
- Complete: `solid-native generate` resolves the pinned application-local React
  Native Codegen implementation, supplies explicit project/platform/source
  inputs, defaults to an isolated app-local build tree or accepts another
  contained artifact root, and provides inspectable schema-versioned dry runs.
  The isolation prevents React Native's multi-library app generator from
  polluting Gradle's application Codegen target with dependency sources that
  autolinking compiles separately. Native and Solid outputs are staged under
  one transaction identity: upstream failure preserves the last good artifacts,
  success replaces the complete native tree so stale schemas disappear, and
  publication failure rolls both outputs back. Planning and execution are
  dependency-injected and tested. A real all-platform run generated the app's
  custom Fabric C++ descriptors/props/shadow nodes, Android view-manager
  interfaces, and iOS provider registrations in an isolated tree.
  For component, TurboModule, and mixed app schemas, a successful CLI run now
  also atomically emits the matching typed React-free Solid binding module;
  dry-run JSON exposes both output boundaries and the binding kind, with
  explicit path and opt-out controls.
- Complete: `solid-native generate --solid-library PACKAGE` accepts repeatable,
  explicit dependency compatibility targets. It fails closed unless each
  package is directly declared and installed with a matching identity, a modern
  Codegen config, and a source root contained by that package. Application and
  selected dependency schemas produce one atomic module; the dry-run plan
  exposes every origin, package, library, kind, and absolute source input. The
  native E2E artifact now uses this same CLI discovery path to combine its
  application Fabric component and AsyncStorage's dependency-owned TurboModule.
- Complete: every CLI-generated binding module exports a frozen portable
  provenance manifest with app/dependency origin, package and installed
  version, Codegen library, and schema kind. A deterministic SHA-256 binds that
  metadata to the full emitted ABI source while excluding machine-local paths.
  The physical shell validates the structure and exact AsyncStorage version on
  ordinary launch; the digest is audit/observability identity, not a signature.
- Complete: `solid-native generate --check` provides a read-only CI gate for
  generated bindings. It rebuilds expected output in memory, never invokes
  native Codegen or writes files, distinguishes match/missing/stale/unreadable
  in stable text or JSON, and exits nonzero on drift. The native E2E package now
  calls this public command directly and carries no custom generation script.
- Complete: `solid-native generate --audit` provides a path-free, wrapper-free
  compatibility inventory for application and explicitly selected dependency
  schemas. It separates directly projectable descriptors from interface-only
  and platform-excluded declarations and preserves raw TurboModule risk
  metadata. The CLI regression suite pins the actual `react-native-screens`
  4.27.0 inventory, including 15 directly projectable package components, 16
  interface-only declarations, and the fact that `RNSScreen` needs the runtime's
  independently reviewed registration path; audit output alone is not promoted
  to a device-support claim.
- Complete: `solid-native compatibility check` validates a bounded, strict,
  application-owned catalog against exact installed dependency schemas. It
  audits packages separately to preserve attribution; distinguishes direct,
  interface-only, and module surfaces across four explicit evidence levels;
  requires contained app-relative proof paths above discovery; and fails on
  package, version, Codegen identity, category, platform, surface, or evidence
  drift. Every proof path pins its exact lowercase SHA-256, so modified or
  substituted evidence fails separately from missing evidence. The native E2E
  catalog records device-backed AsyncStorage, Notify Kit, and screens claims
  while leaving `RNSModule` at schema discovery and reporting all other surfaces as
  unclaimed. The command validates catalog consistency but does not execute or
  attest the referenced physical run.
- Complete on Android: the physical Release runner emits a bounded, strict,
  path-free schema-1 device-proof receipt only after fresh instrumentation,
  exact source policy, and single-Solid-runtime verification pass. It rejects
  stale, ambiguous, skipped, failed, and emulator results and binds the
  JavaScript bundle, canonical source map, both APKs, generated bindings,
  native-compatibility identity, clean Git state, and privacy-safe device facts
  to the exact result. The current clean Pixel receipt is retained,
  schema/profile-checked in CI, and hash-pinned by each Android device-verified
  catalog claim that the suite exercises. Receipts remain unsigned until a
  caller uses the separate governed signing workflow.
- Complete: `solid-native compatibility evidence FILE...` produces bounded,
  ready-to-paste SHA-256 entries under the same physical path-containment rules
  without silently editing or approving the application catalog.
- Complete: `solid-native bundle sources MAP` applies reusable, read-only
  source-graph policy to raw or canonical Metro maps. It normalizes sources
  under the pnpm-lock trust root, requires exact identities once, rejects
  configured dependency fragments, bounds policy and map resources, and emits
  stable text/JSON results. The physical Android restoration runner dogfoods it
  before APK installation instead of maintaining an adapter-specific parser.
- Complete: `@solid-native/storage/async-storage-3` is the first reusable
  wrapper-free generated-ABI product adapter. It injects the exact native
  module, exposes only three reviewed methods, validates its observable result,
  and is dogfooded by every E2E storage/restoration entrypoint with its registry
  seam pinned in the compatibility catalog. Android is `device-verified` after
  its wrapper-free Release bundle, process restoration, 30-cycle native churn,
  and cold-link precedence passed on a tethered Pixel 9a; iOS remains
  `binding-generated` until a fresh unlocked-device run promotes it.
- Complete on Android and iOS: `@solid-native/notifications/notify-kit-10` is the
  second wrapper-free generated-ABI product adapter. It injects the generated
  module and low-level event source, narrows 48 native methods to seven reviewed
  operations, reproduces the version-pinned native payload contract, and maps
  foreground events into the portable notification service. Its 664-source
  Pixel Release map contains the two Solid-owned adapter seams and generated
  binding exactly once with zero Notify Kit facade sources; the complete
  physical proof passed and promotes Android to `device-verified`. A dedicated
  iPhone map applies the same exact seam/facade policy, and its signed Release
  run proves first-install permission handling, an explicit return to active
  before a separate display operation, native foreground delivery and query,
  an exact event/owner/computation causal Solid/Fabric update, cancellation,
  and teardown. Keeping authorization and display separate prevents Notify
  Kit's app-state routing from classifying a delivery during the permission
  sheet's `Inactive` to `Active` transition as background. The replacement iOS
  seam is therefore also `device-verified`.
- Complete: `@solid-native/codegen` validates the pinned React Native component
  schema and projects it into deterministic, deeply immutable Solid Native host
  descriptors. The projection preserves semantic direct/bubbling events,
  command argument order, and platform exclusions; treats raw text as explicit
  application policy; and excludes interface-only declarations unless an
  independently reviewed native registration path opts in. It also emits a
  React-free TypeScript module containing typed Solid component factories,
  prop contracts, native command shims, and frozen descriptor exports. The
  native E2E app consumes that generated module and fails its normal check when
  the checked-in artifact drifts from its component spec.
- Complete: the same validated schema now emits raw React-free TurboModule ABI
  types for aliases, enums, methods, promises, callbacks, and Codegen event
  emitters. Optional and enforcing resolvers accept an injected registry and
  validate the callable surface before returning it. Deeply frozen descriptors
  separate required/optional members and flag any member whose schema contains
  `mixed`, `any`, or untyped `Object`; those values remain `unknown` until an
  explicit portable service adapter validates them.
- Complete: `solid-native adapter create MODULE --library PACKAGE` scaffolds
  that explicit service boundary from one exact dependency schema. It requires
  a current generated binding, derives an extensionless Metro-compatible
  import, emits every method behind a required policy hook with an `unknown`
  result, maps Codegen emitters into explicitly decoded Solid-owned causal
  accessors, and refuses to overwrite application policy code. Planning is
  inspectable and dry-run JSON contains the exact source; creation uses an
  exclusive same-filesystem publish.
- Complete: generated Codegen event-emitter contracts plug structurally into
  `createNativeEventAccessor`. The helper requires a raw-value decoder, owns
  subscription cleanup, isolates decoder/removal errors, blocks retained native
  callbacks after disposal, and routes valid deliveries through privacy-safe
  causal scheduling into a fine-grained Solid accessor.
- Complete: the first vendor exporter maps the privacy-safe causal protocol to
  the stable Sentry `startInactiveSpan` boundary without adding a runtime Sentry
  dependency. It namespaces protocol attributes, preserves bounded multi-cause
  IDs as span data, converts timestamp units, bounds active state, exposes
  malformed/drop counters, and cancels incomplete spans during teardown. Tests
  cover success/error/cancellation, truncation, capacity, and malformed flow.
- Complete: a dependency-free OpenTelemetry adapter maps the same stream onto
  the stable `Tracer.startSpan` boundary with epoch-millisecond timing, bounded
  causal attributes and active state, explicit delivery-health counters, and
  error-only span status. The application retains ownership of its API/SDK,
  processor, sampling, batching, and transport configuration.
- Complete: explicit `solid-native.task` scopes link background asynchronous
  work to only the synchronous Solid settlement and exact native commit it
  causes. Static task identifiers and error classes preserve the protocol's
  privacy boundary; unfinished scopes cancel with their Solid owner.
- Complete: opt-in `CausalOwner` boundaries link named Solid subtree lifetimes
  to only the native commits they cause. Nested boundaries preserve causal
  ancestry, sibling commits remain unrelated, and the protocol records no
  signal values, props, text, or dependency reads.
- Complete: opt-in `CausalComputation` boundaries carry static annotations
  through Solid's universal renderer, batch selected native-output mutations
  into one operation per commit, and preserve owner/event/task causality
  without observing dependencies, signal values, props, text, or reads.
- Complete: in development builds, the same `CausalComputation` identifier now
  names Solid's native-output render effect and the corresponding causal
  operation. Strict tests prove a named write/memo/effect chain alongside the
  exact native mutation and commit cause. This is a stable correlation key;
  `debug correlate` now turns it into a schema-zero static-name/capture-window
  artifact while explicitly denying an exact per-rerun join, which remains
  dependent on a future Solid correlation seam.
- Complete: `@solid-native/testing/diagnostics` applies one checked-in scenario
  policy to Solid's official diagnostic/rerun/waste budget and to native
  total/per-render commit and mutation limits. The format preserves upstream
  fields under version 1 and adds only an explicit `native` namespace. Its
  bounded parser rejects oversized input, unknown fields, invalid regular
  expressions, duplicate diagnostic allowances, malformed names, and invalid
  numeric caps; an unbudgeted captured scenario fails closed.
- Complete: `@solid-native/testing` exposes render-owned commit checkpoints and
  typed singular/plural commit and mutation queries. Structural matchers cover
  priorities, causal IDs, exact ordered mutation kinds, native identities,
  component/command names, placement, and prop/event-name sets; ambiguity and
  absence fail with bounded value-free transaction diagnostics.
- Complete in source and local tests, and physically verified on Android: a
  schema-zero native Solid diagnostics protocol opens one exclusive timed RC3
  attribution window through the app-private debug mailbox. Its 1 MiB strict
  artifact keeps bounded codes, static names, dependency changes, value-free
  causes, reruns, and costs while excluding messages/data, values/previews,
  stacks, owner IDs, raw nodes, props, text, and rendered content. Metro keeps
  the controller out of optimized bundles. The Android and iOS CLI clients bind
  begin/end to fresh nonces, consume each private response, and attempt bounded
  cleanup on failure. A path-free inspection command reports deterministic
  diagnostic-code, rerun, cause, and ranked-cost summaries from bounded files
  or stdin. A separate local correlate command validates that artifact with a
  later causal snapshot and follows matching named native-output operations
  through their retained commit/mount/frame descendants. The Pixel Debug proof
  captures a named write through 28 reruns and 42 retained causes with positive
  scope/write cost accounting, then joins that static output name to 19 complete
  native frame chains while preserving zero eviction/discard and mailbox
  cleanup. It correctly records `exactPerRerunJoin: false`.
  The signed iPhone Debug path is physically qualified with its embedded
  development runtime. Its latest isolated-bundle run captures 48 named Solid
  reruns and 72 retained causes, then joins the named native output to 29
  complete computation → Fabric commit → mount → frame chains with zero
  causal eviction/discard. It correctly records `exactPerRerunJoin: false` and
  verifies terminal process cleanup; the isolated proof app was removed after
  qualification.
- Complete: `debug report --diagnostics` embeds that same strict correlation in
  the CSP-locked offline debugger. It shows aggregate rerun/frame-chain counts,
  bounded output/cause names, and links into retained frame operations while
  making the non-exact join explicit and keeping application values and custom
  causal attributes excluded by default.
- Complete: `debug report-android` and `debug report-ios` turn the ordered
  diagnostics-window → causal-snapshot → correlated-report workflow into one
  live-device command. Both validated responses are consumed through the
  existing nonce-bound transports, no intermediate local artifact is required,
  and application-authored causal attributes remain explicit opt-in data. An
  optional output path is published privately and atomically without clobbering
  an existing report; stdout remains supported. The public Android command is
  physically qualified on the Pixel; its latest run retained 189 native
  operations, 30 Solid reruns, 19 complete native frame chains, zero
  included custom attributes, mailbox cleanup, and terminal process cleanup.
  The symmetric signed iPhone command is now physically qualified as well: its
  latest locked report retained 389 native operations, 36 Solid reruns, 22
  complete native frame chains, and zero custom attributes. The enclosing
  runner verified mailbox consumption and terminal device-process cleanup.
- Complete: the resident development causal panel reuses the protocol package's
  pure Solid/native correlator. Generated applications share one exclusive
  diagnostics controller between the private device transport and
  `DevelopmentRoot`; a manual capture hides the inspector while the developer
  exercises the app, stopping reopens it with bounded named rerun/output/frame
  totals, and owner cleanup disposes unfinished capture state. Values and cause
  names stay out of the view, the non-exact join is explicit, and production
  resolution remains inert. A true-development physical Pixel proof repeatedly
  opens and closes the network and causal panels, validates fresh panel-tree
  ownership across Fabric detach, and completes the diagnostics plus all error
  recovery paths without terminating the host surface. The equivalent signed
  iPhone proof now passes the same strict source-map gate, repeated fresh panel
  ownership, bounded one-rerun/one-frame correlation without cause-name
  disclosure, all three error-recovery paths, and terminal Solid teardown while
  the native host remains foreground. Its process guard verifies a clean device
  afterward; the isolated app and XCTest runner were removed after qualification.
- Complete: core accessibility props and nested state update reactively through
  the Solid renderer. Roles, range/text values, live regions, labeling and
  containment controls are typed, and custom native accessibility actions plus
  iOS accessibility tap, escape, and magic-tap gestures enter Solid as discrete
  direct causal events. The physical Pixel test verifies
  native heading, ImageView, Button, ScrollView, and editable
  single-line/multiline TextInput semantics; signed iPhone XCTest verifies the
  corresponding static text, Image, Button, text field, and text-view elements.
  This satisfies the current Phase 1 core-interaction smoke gate, not
  comprehensive assistive-technology conformance; physical action/gesture
  delivery remains open.
- Complete on Android and iOS: the fake `VirtualizedList` native descriptor has been
  replaced by a fixed-extent Solid-owned window over the verified ScrollView
  facade. Stable keys retain overlapping row owners and native handles through
  scroll and reorder, off-window owners dispose exactly once, item/index
  accessors update without remounting, and a repeated-window benchmark rejects
  unbounded nodes or owners. A dedicated Pixel 9a Release flavor injects a real
  touchscreen swipe into Android's native ScrollView and requires the
  accessibility tree, live Solid owners, measured viewport, and exact Fabric
  mount revisions to retain a bounded window of at most 12 rows across 1,000
  logical items. A second physical press disposes every owner created by the
  tested window shift, waits for Android's asynchronous main-thread surface
  stop acknowledgment, removes the accessibility tree, and leaves the process
  alive. A signed iPhone Release runner now proves the same bounded owners,
  exact mount/measurement, physical scroll, row-900 command barrier, complete
  surface stop, and surviving process through the real nested `UIScrollView`.
  It independently counts distinct accessible rows and parses Apple's one-shot
  scrolling/deceleration and iOS 26 app-hitch metrics from the result bundle.
  Android window `FrameMetrics` now cover the physical gesture, reject
  missing reports and frozen frames, and export deadline misses plus
  p50/p95/max render durations. The same Pixel Release workload now prepends 50
  fixed rows after the physical gesture, retains the eligible keyed Solid owner
  and exact Android View, observes the expected native offset delta without a
  JavaScript scroll command, keeps that row at the same screen coordinate, and
  remains bounded at 12 mounted rows. The signed iPhone Release proof retains
  the same keyed Solid owner and accessible frame across the same native
  correction; exact UIKit object identity remains open. An isolated React
  Native 0.87 flag flavor now
  proves Android platform View identity reuse and measures paired off/on frame
  distributions. The public facade also accepts a validated exact
  `getItemLayout` table for heterogeneous rows, binary-searches its offsets,
  reacts to changed lengths without remounting retained keys, and applies the
  true row geometry to imperative index scrolling. It now also accepts a
  positive `estimatedItemSize`, measures only mounted intrinsic rows through
  native layout, retains learned extents by stable key, prunes removed keys,
  rewindows as geometry settles, and composes those revisions with keyed
  prepend anchoring. A physical Pixel Release workload independently verifies
  alternating 40/80-point native bounds, adjacency after replacing a 56-point
  estimate, and bounded ownership after a touchscreen swipe. The public facade
  now also has an opt-in, renderer-owned `recycleRowViews` policy: deterministic
  tests prove wrapper-handle reuse across unrelated keys, retained-key identity,
  keyed owner disposal/recreation, surplus-slot reclamation, and rejection of
  stale measured events. A physical Pixel proof retains one exact Java wrapper
  `View` across measured row 1 and row 13 while keyed owner disposal remains
  balanced and the window bounded. A checked-in signed-iPhone gate now requires
  40/80/40-point accessible native frames, adjacency, physical scroll eviction,
  bounded ownership, source-map validation, and guarded process cleanup; its
  application and XCTest target pass a signed physical Release run with 14
  learned row extents and 12 live owners after the drag. Exact UIKit wrapper
  identity still needs a trustworthy in-process observer. Repeated matched iPhone
  performance and broader sustained workloads remain open. The list ref now
  exposes serialized `scrollToOffset`, `scrollToIndex`, `scrollToKey`, and
  `scrollToEnd` promises. A queued keyed scroll resolves against the latest
  reactive order, follows the stable item through reordering, and rejects a
  removed key rather than targeting its former index. Deterministic renderer
  tests prove clamping, horizontal and vertical coordinates, validation,
  structural/command commit separation, and cleanup. Symmetric scroll-driven
  start/end callbacks deduplicate one content identity and re-arm when the
  corresponding first/last key changes, pairing paginated prepends with the
  existing keyed anchor. Each keyed row now also receives fine-grained
  `isVisible()` and `visibleFraction()` accessors. They react to native scroll,
  measured geometry, reorder, and anchoring without remounting retained owners;
  overscan rows explicitly report zero coverage. Construction-time initial
  index/key targets mount their bounded window and native `contentOffset` in the
  first Fabric transaction rather than flashing the top rows before an
  imperative command. A dedicated Pixel Release proof starts a 1,000-row list
  at stable key 100, requires the first revision and accessibility tree to
  contain only rows 100–106, reads the exact density-correct 5,000-point offset
  from the live native ScrollView, and tears down all seven owners without ever
  issuing a scroll command. The cleanup-guarded signed iPhone Release run
  requires rows 100–106, no row zero, viewport-start alignment on the first
  transaction, balanced seven-owner teardown, and one production Solid runtime.
  Pixel and iPhone automation prepend 50 rows and then physically press a jump
  to stable row 900 at logical index 950, require its bounded Solid-owned window
  to mount before the isolated native command, and observe the exact
  53,032-point offset before teardown. A
  fail-closed Android runner now performs a fixed warmup
  plus repeated cold instrumentation samples, validates all native-frame,
  bounded-window, imperative, and teardown markers as one result, preserves raw
  JSON with device/thermal/power/revision metadata on request, and reports
  distributions without outlier removal. An isolated React Native 0.87
  `FlatList` Release control now exercises the same item count, extent,
  viewport, physical swipe, settled frame interval, 50-row keyed prepend with
  exact 2,800-point anchor correction, and logical-index-950/stable-row-900 jump.
  A second
  runner builds both variants and records reproducible seed-balanced shuffled
  pairs with strict device/evidence compatibility and paired `Solid - React`
  deltas. Both list and telemetry runners retain their seed and exact variant
  plan so randomized physical order remains auditable rather than implicit.
  All bounded Android list and telemetry runners now install exit/signal cleanup
  hooks, force-stop every relevant application identity, verify that its PID is
  gone, and publish success only after cleanup completes.
  Clean single-variant and matched Pixel 9a runs with one warmup and six
  measured samples are retained in `docs/benchmark-results`; both variants had
  zero deadline misses, frozen frames, or dropped reports. Those historical
  corpora predate the keyed-prepend phase and remain optimization baselines, not
  current-protocol comparisons. They record lower React Native frame-duration
  distributions alongside Solid's smaller live row-owner window. A fresh clean
  repeated prepend-protocol corpus, further optimization, and sustained
  representative workloads remain open.
- Complete on Android: the matched Solid Native and ordinary React Native 0.87
  Release shells run 30 sequential physical counter updates per process and
  require every exact accessibility-visible state before the next input. A
  clean seed-balanced Pixel run retained six pairs, 180 updates per renderer,
  with 29–30 Window frame reports per process and zero deadline misses, frozen
  frames, dropped reports, or thermal throttling. Raw completion samples keep
  their injected-gesture/accessibility overhead explicit; paired frame
  distributions remain diagnostic rather than a general renderer verdict.
- Complete: a read-only hosted CI workflow installs the frozen pnpm graph and
  runs formatting, build, type, and deterministic test gates across the stated
  Node 22 minimum plus Node 24 and 26. Third-party actions are pinned to
  immutable reviewed revisions. Signed iOS and connected Android Release runs
  remain explicit physical-device gates rather than being implied by hosted CI.
- Complete: CI now packs each implemented package into an isolated temporary
  tarball, validates every export and executable against the actual packlist,
  verifies workspace protocols were rewritten, requires every JavaScript
  subpath to carry a packed TypeScript declaration, and keeps the packages
  private. An isolated strict NodeNext consumer resolves every typed subpath and
  exercises the Metro resolver declaration. The runtime artifact now includes
  the podspec, portable C++ coordinator, and platform binding sources that
  workspace-relative native builds had previously concealed from its `files`
  allowlist. The iOS podspec and Android Gradle helper are explicit package
  exports, resolve from the isolated tarball consumer, and drive the checked-in
  native builds without repository paths.
- Complete: the installed production and build-tool dependency graph has a
  normalized package/version/license fingerprint and reviewed license-count
  policy. CI rejects dependency or declared-license drift, and maintainers can
  export the full normalized inventory without machine-specific paths. This is
  an engineering review gate, not a compatibility opinion or substitute for
  final distribution notices and legal review.
- Complete: every implemented package advertises React Native 0.87's supported
  Node.js toolchain range. Packages that execute Solid code require the exact
  device-verified Solid 2 runtime as a peer instead of installing a private
  reactive singleton. The artifact gate enforces both invariants in source and
  packed manifests, then installs every tarball into an isolated offline
  consumer, imports every runtime-safe entry point, and type-resolves every
  JavaScript export.
- Complete: `solid-native doctor` now verifies that declared Solid Native packages
  are connected to the version-pinned native startup chain. It inspects the
  exported Android Gradle helper, CMake target, JNI registration, and
  `bindingsInstaller`, plus the exported iOS podspec and AppDelegate bootstrap,
  with stable fail-closed check IDs and actionable remediations.
- Complete: the same diagnostic separates package declarations from installed
  artifacts. It rejects mismatched core/Fabric Host/runtime declarations or installed
  versions, stale exact installs, missing platform exports, targets that escape
  the Fabric Host package, and partial tarballs before native build invocation.
  Native `run` plan construction reuses this artifact gate, including dry runs,
  so launching cannot bypass it. Android run plans also expose standard SDK
  discovery as a non-overriding `ANDROID_HOME` default, aligning execution with
  doctor without hiding environment mutation.
- Complete: application diagnostics now fail closed on a drifted Solid runtime
  singleton, incomplete direct React Native Codegen/Gradle/Hermes pins, a
  missing or stale installed `@solid-native/metro`, absent OXC worker/resolver
  wiring, a JavaScript entrypoint that does not start the Solid-owned runtime,
  or a missing pnpm lockfile. Both the checked-in hardware target and the
  registry-shaped generated application pass all 29 checks.
- Complete: `solid-native add navigation` installs the CLI-matched navigation
  package and exact screens backend, materializes the shipped content-addressed
  patch under application ownership, merges its pnpm mapping, and reinstalls.
  It has a non-mutating machine-readable plan, an idempotent private/local
  artifact mode, bounded inputs, conflict and symlink refusal, atomic manifest
  publication, interrupt-aware package-manager execution, and final native-byte
  verification. The packed external starter exercises the recipe and then
  passes the independent patched-backend doctor check plus a canonical
  production bundle. Its iOS path also resolves the patched `RNScreens` pod,
  compiles and signs a Release application, and passes launch plus cleanup on
  the physical iPhone 17 Pro. Additional capability recipes remain gated on
  equally complete native configuration.
- Complete: `solid-native fingerprint` produces deterministic SHA-256 native
  compatibility identities from the exact backend versions, actual installed
  Solid Native core/Fabric Host/runtime/compiler/Metro bytes, lockfile, compiler/bootstrap,
  and platform build/startup files. It excludes ordinary app source and
  absolute package paths, isolates app-native drift by platform, bounds input
  size/count, and fails closed on missing inputs. Both the checked-in and
  registry-shaped generated applications emit iOS and Android identities. The
  local result remains unsigned until a delivery pipeline binds it to a source
  revision and artifact signature.
- Complete: `solid-native start` validates the exact installed Fabric Host/runtime,
  Solid/OXC compiler, Metro resolver, safe full-reload policy, and JavaScript
  bootstrap before starting the application-local React Native 0.87 development
  server. The reload policy prevents React Refresh from retaining stale Solid
  owners when it mistakes a Solid component export for a React boundary. Its
  dry-run plan is inspectable, Metro arguments are forwarded unchanged, and
  termination is propagated to the complete process group so workers and ports
  do not linger. Owner-preserving Solid HMR remains a compiler/runtime protocol
  milestone rather than a React Refresh claim. A bounded physical-Pixel soak
  now drives 20 complete Hermes replacements through that Metro path inside one
  unchanged application process. Every replacement mounts commit 1, installs
  exactly one demand-driven native graph, reaches zero pending Choreographer
  callbacks, records per-cycle PSS/RSS/thread evidence, and verifies app,
  reverse-tunnel, and Metro cleanup before publishing success.
- Complete: `solid-native bundle` produces a minified per-platform production
  bundle, composed OXC/Metro map, and asset directory through the verified
  application-local backend. It rejects compiler/output overrides, bounds map
  parsing, canonicalizes checkout paths to portable `app:///` source
  identities, and fails closed when a source escapes the reviewed lockfile
  root. Flat/indexed schema-v3 maps require bounded mappings, names, ordered
  inline sections, and complete embedded source content; remote sections,
  mixed forms, traversal, malformed ignore lists, excessive nesting, and
  aggregate resource overflow fail closed. Its deterministic unsigned manifest
  hashes the final bundle, rewritten map, and every bounded regular asset into
  one bundle fingerprint. The read-only verifier rejects malformed manifests,
  digest changes, missing or extra assets, and a digest-matching but unusable
  source map with a machine-readable report and distinct integrity-failure exit
  status. The checked-in application bundle retains exactly one Solid runtime.
- Complete: `solid-native release create` binds the bundle and native
  compatibility fingerprints to bounded release/channel/revision metadata and
  a streamed final-binary digest without emitting machine paths. The read-only
  release verifier recomputes the canonical envelope, artifact, complete bundle
  set, and current native inputs. The envelope remains explicitly unsigned and
  cannot prove build provenance until a trusted pipeline builds and signs it.
- Complete for Android signing identity: AAB creation and verification use
  strict JDK JAR inspection to bind one non-debug upload certificate. APK
  creation and verification use the newest stable Android SDK `apksigner`,
  reject warnings and debug signers, and bind the exact bounded certificate set
  across every Android version declared as supported, including
  version-targeted signing-key rotation. Both inspect immutable private
  snapshots under bounded time/output/disk contracts and reverify from the
  release envelope without reading a keystore.
- Complete: deterministic detached Ed25519 release attestations authenticate
  the canonical envelope fingerprint and bounded key ID without embedding a
  trust root or key material. Verification requires an independently pinned
  public key, expected identity, and trusted project/platform/channel scope, or
  one bounded versioned trust-policy file carrying the same scope and up to 32
  canonical Ed25519 keys marked active or revoked. Policies require a positive
  monotonic sequence, normalize key order into a deterministic fingerprint,
  stamp both on successful authorized lineage, and accept an external minimum
  sequence that rejects policy rollback. Optional release, revision, envelope,
  bundle, native, and artifact digest pins authorize a specific delivery. It
  rejects another, unknown, or revoked key, an altered envelope,
  or a cross-scope release and preserves distinct trust-failure and
  malformed-input exit statuses. Passing reports expose immutable authenticated
  release lineage from the exact verified snapshot; failed reports omit it.
  Signature verification itself requires either paired bundle/native inputs or
  explicit envelope-only mode. Paired inputs repeat the artifact, bundle,
  embedded-Hermes, and native compatibility proof against the same manifest
  fingerprint; authorized lineage records whether that proof ran. The public
  TypeScript contract rejects missing, partial, or conflicting evidence modes
  and guarantees lineage after an `ok: true` narrow. The signing path can
  require a passing artifact, bundle, embedded
  Hermes, and native-compatibility verification before it reads the private key;
  explicit envelope-only signing remains available for isolated signers.
  A deterministic external signing request exposes the exact contextual payload
  and digest for offline/HSM/KMS custody; assembly validates returned raw or
  canonical-base64url Ed25519 bytes with the public key before emitting the same
  detached statement, without reading private-key material.
  Credential custody, build policy, trusted policy distribution, monotonic
  rollback state, and audit retention remain delivery-system responsibilities.
- Complete for Android receipt schemas 0 and 1: `solid-native device-proof
sign` validates a strict clean physical receipt before reading a
  caller-managed Ed25519 key and signs its exact bytes under a cryptographic
  context distinct from release authorization. Verification accepts either
  pinned public-key/project inputs or a bounded versioned policy containing
  proof scope, project identity, and up to 32 canonical active/revoked Ed25519
  keys. Policies have deterministic fingerprints and positive monotonic
  sequences; a caller-supplied minimum rejects rollback and successful lineage
  records the exact policy identity. Proof, policy age, key, signature, and
  project checks remain distinct, and privacy-safe authenticated proof lineage
  exists only on complete success. Symlinked, oversized, dirty, changed,
  malformed, or cross-project evidence fails closed. External signing is also
  complete: an HSM/KMS request exposes the exact
  contextual payload and digest, while assembly verifies returned raw or
  canonical-base64url Ed25519 bytes with a public key and never reads private
  material. A separate ingestion operation repeats verification and the final
  receipt read before returning a deeply frozen, path-free descriptor carrying
  authenticated environment, native/bundle/artifact, power, and execution facts
  while omitting stable device identity and key/signature material. Trusted
  exact receipt/source/native/APK pins and inclusive canonical-UTC measurement
  bounds reject valid evidence for the wrong rollout or signed time window.
  Portable schema 1 supports distinct JavaScript bundle/source-map lineage,
  application-owned instrumentation, and bounded source policies only when
  their normalized profile fingerprint is explicitly
  pinned or governed by a schema-1 trust policy; a trusted key cannot silently
  substitute a different test. `device-proof profile` exposes that identity for
  review, and successful lineage records receipt schema/profile. Those bounds
  do not establish time independently. `device-proof create-android` now
  produces schema-1 evidence only after a fresh single-test result, physical
  device and clean-Git checks, direct source-policy evaluation, two stable
  artifact digest passes, final result/binding/native-identity revalidation,
  and atomic no-clobber publication. Trusted timestamps and iOS receipt parity
  remain subsequent control-plane work;
  trusted policy distribution and persisted sequence high-water state remain
  operator responsibilities.
- Complete for Android and iOS: `bundle --hermes-source` reproduces React
  Native 0.87's Release Metro input shape. Opt-in release inspection parses the
  APK/AAB or IPA, validates its single Hermes entry, bytecode version, and
  internal checksum, recompiles the reviewed source with the pinned compiler
  and native Release flags, and requires complete bytecode SHA-256 equality.
  iOS source-map builds compare directly; ordinary Xcode builds canonicalize
  only the length-prefixed intermediate filename and Hermes footer first. The
  signed envelope carries that internal identity and verification repeats the
  proof. Bounded single-disk ZIP64 archives are supported without extraction;
  multi-disk archives remain explicitly unsupported.
- Complete: `@solid-native/compiler` centralizes the pinned Solid-aware OXC
  universal transform, built-ins, validation, source maps, and cache identity.
  Metro and the Babel-free standalone sandbox consume the same package, and
  the refactored Metro path passes the full physical Pixel Release proof.
- Runtime-complete for the main Android and iOS scenarios: the first external
  community TurboModule proof pins AsyncStorage 3.1.1, uses ordinary React Native
  autolinking and Codegen, and exposes it through a validated Solid Native
  storage adapter. A physical Pixel Release run round-trips and removes its
  SQLite value, then flushes and decodes the newest owner-bound single-stack
  navigation snapshot. The dedicated Android tabs run also loads URL-competing
  state and flushes the final selected key plus both retained histories through
  the same backend. The signed iPhone Hermes run round-trips and removes the
  native value, then flushes and decodes the current single-stack snapshot.
  Dedicated iPhone single-stack and native-tabs runs also persist and restore
  two-entry histories across terminated processes, remove them after physical
  pops, and verify cold-link precedence under third PIDs.
- Complete: the exhaustive interactive shell treats native-adapter activation
  as a measured lifetime boundary. Notifications, VisionCamera, and AsyncStorage
  load only after the explicit intensive-proof press. On the physical iPhone,
  deferring AsyncStorage 3.1.1's Kotlin/Native runtime reduced the untouched
  shell from 12–15 to 5–7 threads and from about 19.09 to 0.08 interrupt wakeups
  per second; a source-order regression test keeps all three adapters behind
  the gate. Dedicated restoration targets remain intentionally storage-eager.
- Runtime-complete and device-verified on Android and iOS: a second external
  package pins the New-Architecture-only Notify Kit 10.5.0 module behind a
  bounded Solid Native API. Its actual 48-method Codegen ABI is checked in;
  the application injects the generated native module and React Native's
  low-level event source into a seven-operation, versioned
  `@solid-native/notifications/notify-kit-10` adapter without evaluating the
  vendor JavaScript facade. The Release source policy requires those Solid-owned
  seams exactly once and forbids every Notify Kit wrapper source. Pixel
  instrumentation grants the actual Android runtime permission,
  requires the operating system's `NotificationManager` to expose the expected
  title/body, physically presses it, observes its foreground events through an owner-bound Solid
  accessor, and requires cancellation before teardown. CocoaPods generates
  `NotifeeSpec`; a dedicated signed iPhone Release path applies the same exact
  wrapper-free source policy and proves first-install permission handling,
  foreground delivery and displayed-ID query, private causal Solid/Fabric
  update, cancellation, and non-terminating teardown. Independent OS-level
  content inspection and notification-body interaction remain Android-only.
- Complete on Android and iOS: `@solid-native/dialogs` provides a bounded,
  framework-neutral alert contract, a React-free RN 0.87 TurboModule
  adapter, and a Solid-owned promise controller. Button and dismissal
  settlements become discrete causal events while dialog content and stable
  button identities remain private. Package validation, owner-disposal, and
  renderer causality are covered. The Pixel Release gate physically presents
  Android's operating-system dialog, accepts theme-controlled button casing
  while preserving its label and stable application identity, selects the
  native destructive action, dismisses a second dialog through system Back,
  proves both user-blocking causal commits without private content, and requires
  surface, process, and package cleanup before success. The signed iPhone
  Release gate physically selects destructive and cancel-styled UIKit actions,
  verifies both button identities and privacy-safe causal commits, and performs
  non-terminating owner teardown. It also caught the pinned native module's
  string button-key ABI despite React Native's numeric JavaScript declaration;
  the adapter now accepts only bounded canonical string or numeric indices.
- Complete on Android and iOS: `@solid-native/sharing` provides a bounded,
  framework-neutral text/URL/subject contract over Android's pinned
  `ShareModule` and iOS's pinned `ActionSheetManager`, without loading React
  Native's sharing facades. Android URL-only and message-plus-URL requests are
  mapped into its text-only native ABI instead of losing the URL. The public
  result distinguishes Android chooser presentation from iOS completion and
  dismissal rather than overstating a presentation as a successful share.
  Owner-bound settlements become three discrete causal events while message,
  URL, subject, and activity type remain private. Package validation, overlap
  rejection, owner disposal, renderer causality, a native Release entrypoint,
  and a facade-rejecting source-map gate are covered. The Pixel Release gate
  physically selects an instrumentation-only receiver through Android's real
  sharesheet and verifies message-plus-URL, URL-only, MIME type, and subject at
  the receiving-application boundary. It also caught and fixed the pinned
  TurboModule's exact two-argument Hermes ABI, proves both causal commits, and
  requires surface, process, and package cleanup before success. The signed
  iPhone Release gate opens UIKit's activity popover, selects Copy to prove a
  truthful `completed` settlement, dismisses a second presentation to prove
  `dismissed`, verifies both privacy-safe causal Fabric commits, and confirms
  explicit owner teardown without terminating the app. Both physical gates
  reject React Native's sharing facades in their Release source maps.
- Complete on Android and Release-compiled for iOS: `@solid-native/vibration`
  provides bounded pulse/pattern input, direct pinned Android/iOS TurboModule
  adapters, and process-wide revocable leases. Android receives one native
  waveform; iOS's fixed system pulses use a package-owned scheduler rather than
  React Native's global timer state. Starting new feedback invalidates the old
  lease, so later disposal of an older Solid owner cannot cancel a newer
  owner's feedback. Repeating patterns and pending iOS timers stop with their
  current owner. The Pixel Release gate temporarily enables and always restores
  the user's vibration setting, observes the exact live repeating waveform and
  owner through Android's vibrator service, proves explicit cancellation and
  owner-disposal cancellation, and requires surface, process, and package
  cleanup. The app declares VIBRATE permission and passes a facade-rejecting
  source-map gate. A code-signing-free generic iOS Release app compiles the same
  path; physical iOS pulse scheduling and cancellation timing remain open.
- Complete on Pixel and iPhone: `@solid-native/clipboard` provides
  a bounded portable text contract, direct pinned Android/iOS Clipboard
  TurboModule adapter, and Solid-owned asynchronous reads. It rejects
  application writes and untrusted native results larger than 1 Mi UTF-16 code
  units. Read settlements enter Solid causality at default priority without
  exporting clipboard content, while owner disposal rejects all pending reads
  and disables later access from the retired controller. The Pixel Release gate
  independently verifies app-to-OS writes and OS-to-app reads with different
  private canaries, proves empty-text clearing and the exact normal-priority
  causal commit, restores the user's prior clipboard in all outcomes, and
  requires surface, process, and package cleanup. Its source-map policy rejects
  the deprecated React Native facade, re-export, and generated JavaScript spec.
  The signed iPhone gate uses a second native-only signed application rather
  than the physical XCTest runner, where the general pasteboard is unavailable.
  That source app archives the complete original pasteboard, seeds and observes
  private canaries across three real application boundaries and Apple privacy
  sheets, independently verifies write and clear, and restores every item and
  representation. Its persisted recovery archive is restored by XCTest and by
  shell cleanup after interruptions. Both physical gates require the exact
  platform-event, named-owner, and named-computation causes through the matching
  normal-priority commit, keep private content out of telemetry, dispose the
  surface without terminating the host, and verify complete cleanup.
- Complete on Pixel and iPhone:
  `@solid-native/secure-storage` provides ordered bounded string credentials,
  an explicit `react-native-keychain` 10 ABI adapter, and Solid-owned read,
  write, and delete settlements. It never evaluates the dependency's
  React-facing wrapper or dynamic enums. iOS defaults to device-only access
  while unlocked with cloud synchronization disabled; Android requires at
  least software-backed Keystore storage. Keys and values remain absent from
  causal telemetry. The checked-in Pixel gate independently requires a
  non-exportable Android `SecretKey`, encrypted-at-rest DataStore bytes, exact
  restoration, native alias/record deletion, the read's normal-priority causal
  commit, and complete cleanup. The bundle gate rejects all keychain facades.
  The signed iPhone gate stores the canary, terminates and recreates Hermes,
  Solid, and `RCTHost`, restores the exact device-only Keychain value, deletes
  it, and verifies the same causal privacy and teardown contract. The
  dependency declares `RNKeychainSpec` without publishing a discoverable
  Codegen surface, so the package-owned host enables React Native 0.87's
  bridgeless legacy registry fallback before constructing `RCTHost`; the CLI
  rejects attempts to misclassify that empty declaration as a generated Solid
  binding.
  The Pixel native-tabs product gate now consumes this package as an actual
  authentication boundary: sign-in persists before navigation, a forced fresh
  process authorizes `/protected` through an async Keystore read, and physical
  logout removes then proves absence before exact teardown. The matching
  Keychain-backed product composition is implemented and remains a pending
  physical iPhone promotion gate.
- Complete on Pixel and iPhone: `@solid-native/localization`
  validates and freezes the startup locale, effective layout direction, and
  left/right style-swap policy from the pinned cross-platform `I18nManager`
  TurboModule without evaluating React Native's facade or generated JavaScript
  spec. Android locale separators are normalized, while iOS uses Hermes `Intl`
  because its native module omits the identifier. Runtime force/allow/swap
  mutations are intentionally absent because their native effects require an
  application restart. The Pixel gate uses package-scoped `en-US` and `ar-SA`
  cold starts without changing device-wide settings, and independently proves
  the Activity locale, native decor direction, TurboModule snapshot, style
  policy, and mirrored Fabric child geometry. It caught React Native 0.87's
  arbitrary available-locale RTL lookup; the package-owned Android surface now
  synchronizes the effective application locale before Fabric creation. The
  gate also requires non-terminating teardown, facade-rejecting source maps,
  and process/package cleanup. The signed iPhone gate declares English and
  Arabic bundle localizations, cold-starts the same Release binary with
  process-scoped `en-US` and `ar-SA` preferences, and requires Hermes Intl, the
  native snapshot, style swapping, and mirrored physical Fabric geometry to
  agree. Both iOS owners stop without terminating their process, and the runner
  removes the signed app without changing the device language.
- Complete on Android and Release-compiled for iOS: `@solid-native/images`
  provides bounded image metadata, prefetch, and ordered cache inspection over
  React Native 0.87's cross-platform `ImageLoader` TurboModule. Its adapter
  normalizes Android's object dimensions and signed request IDs against iOS's
  tuple dimensions and identifier-free prefetch ABI without evaluating either
  React Native Image facade or generated JavaScript spec. Android prefetches are
  cancelled natively; iOS, which exposes no cancellation primitive, rejects
  immediately and ignores late settlement. Owner disposal rejects all pending
  image work, and successful dimensions, prefetch, and cache results retain
  their causal Solid commit without exporting URIs or request headers. Package,
  ABI, ownership, and telemetry gates are covered. The Pixel Release gate uses
  a host-observed local HTTP boundary to prove private-header dimensions, a
  cold-to-hot prefetch transition, ordered cache inspection without network
  work, explicit native transport cancellation, and Solid owner-disposal
  cancellation. It requires privacy-safe causal commits, live Activity
  retention, acknowledged Fabric teardown, source-map policy, and removal of
  the process, APKs, and reverse tunnel. A code-signing-free generic iOS Release
  app compiles the same entrypoint; physical iOS metadata and cache behavior
  remain open.
- Implemented and physically verified on Android: `@solid-native/networking`
  provides bounded incremental HTTP(S) text transport over React Native 0.87's
  native `Networking` module. It maps Android's client-owned signed request IDs,
  tuple headers, and positional call against iOS's object call and callback-owned
  ID, including cancellation before that callback arrives. Response metadata,
  every incremental chunk, completion, and failure carry distinct causal events
  into the Solid computations and Fabric commits they trigger without exporting
  URLs, headers, request bodies, response headers, or streamed text. The service
  bounds all request inputs and native settlements, enforces event order and
  monotonic progress, avoids response accumulation, and aborts on explicit or
  owner-driven cancellation. Package, ABI, ownership, privacy, and telemetry
  gates are covered. A bounded SSE protocol layer handles arbitrary newline and
  native chunk boundaries, validates HTTP 200 and `text/event-stream`, exposes
  last-event-ID and retry state without hidden reconnection work, and preserves
  native chunk/completion causality through parsed events and Fabric commits.
  Its Solid-owned stream exposes connection, response, latest-event, event-ID,
  retry, completion, and failure state; reactive request replacement and owner
  disposal cancel stale native work, while restart remains explicit and adds no
  hidden Last-Event-ID or sleep policy. A
  separate finite JSON layer caps chunk count, characters, nesting, and value
  count, accepts standard and structured-suffix JSON media types, deeply
  freezes the parsed document, and preserves native completion causality for
  synchronous Solid result writes without imposing HTTP-status policy. Its
  Solid-first JSON resource turns static or reactive requests into fine-grained
  loading, error, response, result, and last-good-value state; it cancels
  superseded or owner-disposed native work, supports explicit refetch and
  cancellation, and keeps synchronous decoding in the completion cause.
  The exact Android Release app passes the pinned bootstrap and direct-seam
  source-map policy. A dedicated physical Pixel gate serves split SSE and JSON
  responses through a local reverse tunnel, forces an RN-native transport
  failure, physically triggers explicit and owner-driven cancellation, proves
  response/chunk/completion-to-Solid-computation-to-Fabric-commit/mount/frame
  causality, scans telemetry for private canaries, and requires terminal
  process/package/tunnel cleanup. That run exposed and fixed RN 0.87 Android's
  two-element success/non-timeout completion tuple; its third timeout element
  is present only for socket timeouts. The iOS parity runner now reuses the same
  bounded server and evidence contract through a 144-bit run-scoped local cold-
  launch capability. It defaults to the Mac's `*.local` name and accepts an
  explicitly selected canonical RFC 1918 address for dual-homed Macs; the app
  rejects public, loopback, credentialed, privileged, or malformed endpoints.
  It keeps arbitrary ATS loads disabled and declares the one-time local-network
  permission explicitly. A code-signing-free generic iOS Release app and UI
  test bundle compile with the injected capability, and their composed Hermes
  map passes both the single-Solid-runtime and complete-networking-seam gates.
  Signed iPhone 17 Pro qualification on iOS 26.6.1 proved request creation,
  React Native's zero-based iOS request-ID callback, a native URLSession timeout,
  and canonical `NetworkRequestTimedOutError` delivery. It also exposed a UI-
  test bug where querying SpringBoard for an absent permission alert backgrounded
  the app; the proof now scopes the alert to the app and fails promptly when the
  process exits. The complete signed server protocol, permission, cancellation,
  and teardown run over a reachable local interface remains the iOS promotion
  gate. Server functions and Solid
  server-component framing remain intentionally deferred to their evolving
  protocol layers.
- Complete on Android and Release-compiled for iOS:
  `@solid-native/accessibility` provides validated Android/iOS preference
  snapshots and changes, bounded announcements, recommended timeouts, and an
  owner-bound Solid 2 controller with fine-grained accessors. It calls the
  pinned native modules and low-level event emitter directly without evaluating
  React Native's `AccessibilityInfo.js`. Query/event races and overlapping
  refreshes are deterministic; an optional app-state source refreshes exactly
  once per foreground transition for preferences without native change events.
  Cleanup is idempotent, and causal telemetry
  contains only `platform.accessibility.preference`, never preference values or
  announcement text. The Android Release source-map gate requires the complete
  five-source seam exactly once and rejects the React-facing facade. The Pixel
  gate changes reduced motion and high text contrast away from and back to their
  original settings, proves all four direct native deliveries through the
  corresponding fine-grained Solid outputs and causal Fabric commits, and
  rejects preference identity or values in telemetry. Android UI automation
  also captures the exact operating-system announcement event after a physical
  control press. Recommended timeout, explicit refresh, non-terminating surface
  teardown, exact setting restoration, and process/package cleanup are required
  for success. The generic iOS Release app compiles the same entrypoint;
  physical iOS preference, announcement, and teardown coverage remains open.
- Runtime-complete for the main Android and iOS scenarios: the third external
  proof pins VisionCamera 5.2.2, NitroModules 0.36.5, and NitroImage 0.15.1 behind a
  bounded `@solid-native/camera` API. The adapter drives the imperative Nitro
  permission, device-factory, preview/photo-output, and session APIs without
  invoking VisionCamera's React hooks or rendering a React tree. A bounded
  owner-scoped resource registry preserves the preview output's exact JSI
  identity only for its direct generated Fabric prop. Solid owns asynchronous
  session startup, events, preview retention, idempotent stop, and cleanup. An
  opt-in owner-bound accessor now gives all five validated session lifecycle
  kinds stable `platform.camera.session.*` causes without recording camera
  identity, interruption reasons, or errors. Session replacement, detachment,
  root disposal, and failing setup/removal paths are deterministic and isolate
  diagnostic failures. Renderer coverage is complete. The physical Pixel gate
  also captures CameraX's second real
  `started` callback after preview attachment and requires that platform event,
  `e2e.root`, and `platform.camera.session.output` to be the exact causes of its
  normal commit, mount, and frame. Ordinary backgrounding leaves this
  independently owned Android session open, so interruption/resume remains a
  separate contention or operating-system-pressure assertion.
  Physical Pixel instrumentation independently observes Android mark a
  previously available camera unavailable, requires the mounted positive-size
  native PreviewView to reach `STREAMING`, captures a real JPEG through the
  same session, validates the bounded temporary-file metadata and its separate
  Solid/Fabric result commit, and observes camera availability return after root
  disposal. The Pixel preview requires its surface-parented
  `camera.session.preview` task, root owner, and `camera.preview.output`
  computation to be the exact three causes of its commit, mount, and frame. The
  photo result likewise requires the surface-parented
  `camera.capture` task, static root owner, and `camera.capture.output`
  computation to be the exact three causes of its normal-priority commit, then
  follows the matching host revision through mount and next frame without
  exporting resource or photo metadata. AppState acceptance is armed before the
  visible capture checkpoint mounts, closing the device-runner lifecycle race.
  The equivalent iOS causal assertions remain open.
  The signed physical-iPhone Release run also grants permission, selects a back
  camera, starts the native session, mounts the generated preview, captures and
  commits a real JPEG result, and stops the session during teardown.
  Video, frame processors, preview callbacks, durable media persistence, and
  independent iOS operating-system assertions remain separate gates.

## Phase 1: vertical technical preview

Deliverables:

- iOS and Android application shells
- View, Text, Pressable, Button, Image, ScrollView, ActivityIndicator, and Switch
- Styles, including a React-free typed `StyleSheet` workflow, refs,
  measurement, and direct/bubbling events
- Root ownership and deterministic cleanup
- In-memory renderer conformance suite
- TanStack Router native history and Solid 2 core adapters (implemented against
  pinned `@tanstack/history` and `@tanstack/router-core`, including exact-once
  external synchronization, restoration-safe keys, traversal, programmatic
  blockers, physical Pixel system-Back arbitration, and Solid 2-backed
  match/loader/error state plus owner-bound nested and keyed-stack native
  presentation; its route components and retained native identity are
  physically verified on Pixel and iPhone, with an explicit
  live-owner/focus-scoped-work policy and a one-entry restored preload proven
  across process death for both single-stack and native-tabs histories on Pixel
  and iPhone. The Pixel restoration proof rejects its first physical Back
  through a TanStack blocker and allows the second; the matching signed iPhone
  run naturally cancels a short seed gesture, rejects the first restored
  gesture through the TanStack blocker, and completes the second. General
  preload policy remains open.)
- Solid server/native client protocol spike, beginning with server functions,
  action settlement, single-flight data, and bounded continuation traces. The
  experimental upstream server-component frame work is changing actively;
  review its renderer-neutral `ops`/adapter opportunity after 2026-08-28 rather
  than copying this week's DOM-specific wire internals.
- Two-screen native stack and platform back behavior
- Three representative native modules (storage, local notifications, and a
  hardware camera session including photo capture are physically exercised on
  Android and iOS; the Android runner adds independent operating-system
  assertions, while richer video/frame outputs remain)
- CLI commands for doctor, generate, and run
- Published benchmark methodology

Exit criteria:

- The same application source runs on iOS and Android.
- Core interactions pass accessibility smoke tests.
- Navigation state remains correct through platform back/deep links.
- At least two external developers can build the sample from clean machines.
- Performance is competitive enough to continue; no fixed target is assumed.

## Phase 2: adopter alpha

Deliverables:

- TextInput and keyboard/focus correctness (the controlled TextInput path and
  initial owner-bound keyboard visibility/metrics/dismissal API are complete on
  signed Pixel and iPhone hardware; typed View layout and bottom-spacer keyboard
  avoidance are implemented with signed iPhone movement/restoration evidence
  and a Release-compiled focused Pixel gate; automatic focused-field scrolling
  is implemented with signed iPhone movement/clearance evidence and a
  Release-compiled focused Pixel gate; render-order Next/Done focus policy is
  implemented; the cross-platform autofill/input-mode contract is implemented
  deterministically, while physical autofill UI, accessibility focus order,
  hardware-keyboard traversal, and IME composition remain)
- Screen stack, tabs, modals, and restoration
- Fixed-extent virtualized list prototype (physical Android/iOS windowing,
  keyed prepend anchoring, initial positioning, and measured-height geometry; an
  Android repeated matched React Native control and isolated Android
  platform-view reuse proof are complete; matched iPhone and other sustained
  workloads, and iOS promotion of exact renderer-visible row-view identity
  remain)
- UI-thread animation/gesture foundation
- Native module and component codegen (React-free component/prop/command and
  raw TurboModule ABI generation plus the first fail-closed compatibility
  catalog and reusable policy-gated adapter scaffolding are complete; broader
  catalog coverage and product-specific adapters remain)
- Development client, HMR, symbolication, and inspector
- Testing package and device CI
- Explicit supported React Native/backend matrix
- Upgrade tooling
- Documentation sufficient for an application team

Exit criteria:

- Several external teams are building real applications.
- At least two applications are on a credible store-release path.
- Upgrade cost across one React Native release is measured.
- Critical module gaps have owners or documented alternatives.

## Phase 3: production beta

Deliverables:

- Stable application and module APIs within a documented compatibility policy
- Reliable local release builds
- Signing/credential workflows
- Internal distribution and store submission
- Signed OTA update protocol with rollback
- Crash/startup/update observability
- Team roles and policy controls
- Security review and operational runbooks

Exit criteria:

- Production applications are released.
- Release workflows run repeatedly with reproducible evidence.
- Upgrade and incident response can be supported sustainably.

## Phase 4: ecosystem expansion

- Broader native-module compatibility
- Verified module program
- Team security, audit, and policy controls
- Windows/macOS/visionOS evaluation
- Alternative NativeScript or standalone backend
- Self-hosted infrastructure integration

## Workstreams

Every phase should track these workstreams independently:

- Renderer correctness
- Native runtime and upgrades
- Core components and accessibility
- Navigation
- Animation and gestures
- Native modules/codegen
- Tooling and developer experience
- Testing and performance
- Documentation and ecosystem
- Release validation and operations
