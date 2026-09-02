# Project status

Snapshot: 2026-08-27

## Short version

Solid Native is past the architectural-spike stage. A Solid 2 application can
compile with OXC, run on Hermes, create and update real Fabric trees without a
React render tree, use native iOS and Android controls, navigate through native
stacks and tabs, call selected native modules, run bounded UI-thread animation
graphs, and retain a causal chain from native input through Solid work to a
Fabric mount and next-frame opportunity.

The repository is not ready to describe as a production SDK. Its strongest
vertical paths are real and physically exercised, but the public release,
upgrade, development-client, API-stability, compatibility-coverage, and
external-adoption gates are still open. Every workspace package is currently
private and versioned `0.0.0`, and the project has not selected its final
license or name.

## What exists and works

### Solid-owned native runtime

- Solid 2 components establish the application graph. Signal updates change
  only the dependent native props or structures; application components are
  not rendered through React or Fiber.
- `@dom-expressions/compiler`'s OXC backend performs the universal Solid JSX
  transform. `@solid-native/compiler` owns the shared transform contract, and
  `@solid-native/metro` composes its source maps with Metro's output.
- A transactional universal renderer batches mutations behind an explicit,
  versioned host contract. It supports creation, updates, moves, removal,
  deletion, events, commands, measurement, refs, rollback, and deterministic
  owner cleanup. The dependency-free contract now also owns deterministic
  capability/component inspection and structured incompatibility errors, so
  backend qualification does not require the Solid runtime.
- The separately packaged `@solid-native/fabric-host` targets React Native's
  lower Fabric/Yoga/Hermes/JSI layer without importing Solid. A framework-free
  Release proof now passes on both a physical Pixel and a signed physical
  iPhone: each mounts and updates Fabric directly from raw host transactions,
  observes mount-to-frame lifecycle events, and tears down the exact tree and
  surface. Their source maps contain the Fabric host and host contract but no
  Solid or renderer runtime, establishing that the seam is not intrinsically
  tied to the Solid adapter. Bounded native-surface readiness now belongs to
  that package too, so a different framework adapter does not need the Solid
  runtime or a copied bootstrap polling loop.
- Package-owned iOS and Android bootstraps start an empty Fabric surface, let
  JavaScript publish the first application revision, reclaim retired native
  identities after mount, cancel native work during teardown, and stop without
  terminating the application process. Fabric Host leases that surface across
  every adapter wrapping the same native binding, preventing concurrent hosts
  from allocating overlapping node identities or replacing event routes. The
  lease survives failed teardown and is released only after native stop is
  observed. Fabric Host also owns the guarded React Native fatal-error handoff;
  the Solid runtime only scopes it to an application's lifetime. Native startup
  treats root construction as an asynchronous transaction after surface
  ownership transfer: allocation, prop normalization, subscription, and initial
  Solid render failures await surface reclamation before rejection. Normal
  application disposal still tears down the surface when an owner, event, or
  lifecycle cleanup throws and retains every distinct shutdown failure.
  Backend-neutral callers also have an awaited `startApplicationAsync`
  transaction; the legacy synchronous entrypoint starts best-effort rollback
  rather than stranding a surface after an initial render failure.

### Application and component surface

The public core currently includes:

- `View`, `Text`, `Pressable`, compositional `Button`, `Image`, `ScrollView`,
  `RefreshableScrollView`, `TextInput`, `ActivityIndicator`, and `Switch`
- A frozen typed `ScrollView` handle with validated `scrollTo`/`scrollToEnd`
  promises and an explicit backing-node escape hatch, shared by base,
  refreshable, keyboard-aware, and TanStack-restored scrolling
- A backend-neutral `StyleSheet` with typed named styles, allocation-aware
  composition, deterministic nested flattening, and portable absolute fill
- `StatusBar`, safe-area primitives, keyboard state, keyboard avoidance,
  keyboard-aware scrolling, and form focus traversal. Safe-area delivery,
  physical inset placement, rotation, causal commits, and teardown now have
  Release proofs on both the Pixel and iPhone; status-bar contrast, visibility,
  owner restoration, causal commits, and teardown now do as well
- Platform appearance, window dimensions, application lifecycle, linking, and
  Android hardware-Back integration. Appearance, window rotation, and direct
  outbound Linking now have matched causal Release proofs on the physical Pixel
  and iPhone
- Platform `Modal`, native screen stack/header/sheet primitives, native tabs,
  and a `VirtualizedList` for fixed, supplied exact, or intrinsically measured
  rows, including controlled native pull-to-refresh on vertical lists and
  serialized index/offset/stable-key scrolling plus deduplicated start/end edge
  loading. Each mounted row has fine-grained viewport visibility accessors, so
  overscan can remain bounded without forcing application-wide view-token
  diffs. Initial index/key targets mount in the first native offset transaction
  and have a physical Pixel Release proof that starts at row 100 with only the
  seven target rows mounted, the exact density-correct native offset, no
  imperative scroll command, and balanced teardown. The symmetric signed
  iPhone proof starts with the same seven rows, aligns row 100 to the native
  viewport, issues no imperative command, and balances all owners at teardown
- Accessibility props, preferences, announcements, recommended timeouts,
  native focus, and physical accessibility-tree smoke coverage

These are native component facades and Solid-owned compositions with reactive
props, not wrappers that render React components. `Button` is deliberately
implemented as `Pressable` plus `Text`, so it adds familiar platform defaults
and accessible starter ergonomics without expanding the native descriptor
surface. `RefreshableScrollView` has guarded physical Pixel and iPhone Release
proofs for real rejected and accepted/completed pulls, stable backing native
identity, source-map policy, and terminal teardown. The strongest common interaction
paths have run in Release builds on a physical Pixel and iPhone: native mount,
press, signal update, image decode, scrolling, text editing, Switch control,
measurement, keyboard presentation/dismissal, accessibility discovery, owner
cleanup, and non-terminating surface teardown.

### Navigation

- A backend-neutral native history supports keys, traversal, deep links,
  process restoration, persistence, blockers, and exact-once external
  synchronization.
- TanStack Router core is integrated through Solid 2-backed match, loader, and
  error state. The project does not reimplement TanStack Router.
- Native stack, headers, modal/sheet presentation, nested keyed stacks, and
  retained native screen ownership work on iOS and Android.
- The current process-restoration and product-composition runners bind their
  physical behavior to an exact cross-platform source-map policy. It requires
  the selected entrypoint, generated native bindings, core facade, and complete
  Solid navigation package seam, rejects the `react-native-screens` JavaScript
  wrapper, and on iOS verifies the signed `build-for-testing` artifact before
  `test-without-building` can launch it.
- TanStack stacks can reactively bound mounted route trees. Parking disposes an
  inactive Solid match owner and its native content while retaining the exact
  keyed native screen, history entry, and settled router snapshot for remount.
- Core exposes an owner-bound, causally traced cross-platform memory-warning
  counter, allowing that route-tree budget to shrink without a React Native
  JavaScript facade. iOS uses the pinned AppState module. Android's generated
  Application forwards pressure callbacks through the package-owned
  `SolidNativePlatformAndroid` TurboModule while excluding ordinary
  backgrounding.
  Release iPhone and Pixel gates verify each callback through Hermes, Solid,
  Fabric mount/frame, and teardown; OS-generated system-wide pressure remains
  open.
- Navigation turns that owner-bound stream into an explicit recoverable memory
  policy. A warning clamps mounted route owners, cancels restored-entry
  prewarming, clears inactive/preloaded Router matches, and discards inactive
  snapshots while keeping the current route and native history intact.
- Native tabs retain one Solid owner and independent history per tab. Selected
  nested routes survive process death, platform Back/edge-pop behavior is
  reconciled with application history, and cold deep links win over stale
  persisted state. The current Pixel phase and freshly promoted iPhone phase
  compose the selected tab's typed native link and async-loaded TanStack push
  stack with a native sheet.
  The link preserves press/task/pending/final-commit causality, retains exact
  tab/stack/root/detail native identities across sheet Back and a tab round trip,
  then return to the original root through a second platform Back with exact
  ownership teardown. Android uses the Material sheet and system Back; iOS uses
  the UIKit sheet and its native header Back controls.
- Native-tab appearance and icon transport are physically verified on Android
  and iOS, including raster image, empty, and platform-resource transitions on
  the same retained tab owner. The iPhone proof inspects the live `UITabBar`'s
  standard and scroll-edge appearances and both image slots directly.
  Asynchronous image callbacks cannot overwrite a newer icon request on either
  platform.

### Native ecosystem integration

- `@solid-native/codegen` consumes React Native Codegen schemas and emits typed,
  React-free component and raw TurboModule bindings.
- A fail-closed compatibility catalog distinguishes schema discovery,
  generated bindings, native integration, and device verification instead of
  treating every New Architecture library as automatically compatible.
- AsyncStorage 3.x has a narrow validated key-value adapter used for real
  navigation persistence.
- Notify Kit has a bounded local-notification adapter with foreground events,
  permissions, cancellation, physical-device qualification on both platforms,
  and a real Android notification-shade press.
- VisionCamera's imperative Nitro API can enumerate hardware, own a camera
  session, mount its generated native preview through a bounded opaque-resource
  reference, capture a JPEG, and release the session with its Solid owner.
- Clipboard, sharing, vibration, localization, dialogs, images, networking,
  notifications, storage, accessibility, and camera each have explicit
  packages rather than accumulating unrelated platform calls in core.
- The camera/storage/notification vertical workload has run on both physical
  platforms. Notify Kit's wrapper-free seam is cataloged as device-verified on
  each; Android alone currently inspects and presses the OS-visible
  notification content.

### Animation and async ownership

- `@solid-native/animation` defines a bounded, serializable UI-worklet graph
  rather than evaluating arbitrary JavaScript on the UI thread.
- Native Android `Choreographer` and iOS `CADisplayLink` executors apply owned
  opacity, translation, scale, and rotation updates directly to Fabric views.
- Physical Release tests cover graph validation, updates, output application,
  inspection, cancellation, and teardown on both platforms.
- Solid 2 promise-returning computations mount owned loading/reveal states, and
  late results cannot revive disposed native subtrees.
- Solid 2 actions preserve causality across an immediate optimistic commit and
  a later settlement commit.

### Observability, diagnostics, and release integrity

- Vendor-neutral causal telemetry can connect a native event, Solid owner and
  computation, task/action, host commit, exact Fabric revision, native mount,
  and next-vsync/frame callback.
- Explicit retained-event controllers now cover both non-Fabric platform
  callbacks and Fabric handlers. Android BackHandler preserves its synchronous
  boolean across blocker settlement, while iOS native-stack dismissal retains
  the truthful `Screen.dismiss` event through its deferred history commit.
- The workspace now runs on Solid `2.0.0-rc.3`. In strict development mode,
  Solid's new attribution engine traces a named signal write through a named
  memo into a universal renderer effect. An opt-in `CausalComputation` now
  gives that Solid effect and the native causal operation the same stable name,
  while the testing host independently proves the resulting native commit.
  `@solid-native/testing/diagnostics` now captures the official published RC3
  diagnostics/rerun/cost artifact and exact value-free native commit summaries
  through one bounded scenario, automatically including reverse-order owner
  cleanup. One bounded checked-in policy now applies Solid's official
  diagnostic/rerun/waste fields and an explicit native commit/mutation
  namespace together; its strict parser rejects malformed policy, and a
  scenario missing from the reviewed file fails closed. This is deterministic
  cross-channel correlation, not yet an exact per-rerun join; that still needs
  an upstream correlation token or event seam. A tested Solid `next` commit is prepared locally to
  expose Universal's renderer effect options so the temporary development-only
  `spread` adapter can disappear after publication.
- A separate schema-zero native diagnostics envelope now turns that same Solid
  development surface into a bounded device artifact without forwarding
  diagnostic messages/data, reactive values/previews, stacks, owner IDs, raw
  nodes, props, text, or rendered content. It retains only codes, bounded static
  names, rerun/dependency/cost fields, and a value-free cause graph. Creation,
  serialization, and detached parsing are strict and capped at 1 MiB.
  Development Metro resolution loads the exclusive RC3 controller; optimized
  bundles receive an inert shim and a source-map gate rejects accidental
  retention. The app-private native mailbox now carries versioned causal,
  diagnostics-begin, and diagnostics-end operations on both platform shells.
  `debug diagnostics-android` and `debug diagnostics-ios` provide timed desktop
  capture clients with nonce binding, strict parsing, response deletion or
  acknowledgement, and best-effort session cleanup. `debug correlate` turns a
  diagnostics artifact plus a later causal snapshot into a versioned,
  machine-readable static-name/capture-window join that explicitly denies exact
  per-rerun correlation. A dedicated Pixel Debug workload now physically proves
  a named Solid write across 28 reruns, 42 retained causes, and balanced
  28-scope/28-write cost summaries, joined to 19 complete native computation →
  Fabric commit → mount → frame chains without evictions or discarded records.
  The signed iPhone Debug path is now physically qualified with its embedded
  development runtime. Its latest isolated-bundle run captured 48 named Solid
  reruns and 72 retained causes, joined the named native output to 29 complete
  computation → Fabric commit → mount → frame chains with zero causal
  eviction/discard, and generated a locked offline report retaining 22 complete
  chains with custom attributes excluded. The watchdog verified terminal
  process cleanup, and the isolated proof application was removed afterward.
  `debug diagnostics-inspect` turns a bounded file or stdin artifact into
  deterministic code, rerun, cause, and ranked-cost summaries without adding
  runtime values or application content. The self-contained `debug report`
  debugger can now opt into that artifact, show named Solid/native correlation
  cards and totals, and deep-link each card to the retained frame operations
  without gaining network permissions. `debug report-android` and
  `debug report-ios` now run the complete ordered live capture and emit that
  debugger without intermediate JSON files, while keeping custom causal
  attributes excluded unless disclosure is explicit. An explicit `--output`
  publishes a private atomic file without replacing existing evidence; stdout
  remains the composable default. The public Android command most recently
  passed on the physical Pixel with 189 retained operations, 30 Solid reruns,
  and 19 complete native frame chains. The signed iPhone command is physically
  qualified too; its latest locked report retained 389 native operations, 36
  Solid reruns, 22 complete native frame chains, and zero custom attributes.
  The pure diagnostics/native correlation now belongs to the observability
  protocol package rather than the CLI, so an on-device inspector or managed
  ingestion service can apply the identical validated, non-exact join without
  importing Node.js file tooling. The development causal panel is now its first
  non-CLI consumer: generated apps share the exclusive Solid diagnostics
  controller with the private transport, provide a manual capture/stop flow,
  render bounded rerun/output/frame totals without values or cause names, and
  automatically dispose a panel-owned capture on unmount. Production remains
  a dependency-free/inert path. The true-development Pixel proof also repeats
  network- and causal-panel open/close cycles, verifying that stable overlay
  slots retain the application and badges while each detached panel tree is
  discarded rather than reinserted into Fabric. The symmetric signed iPhone
  proof now passes as well: it repeats fresh network/causal panel ownership,
  shows the bounded one-rerun/one-frame Solid correlation without a cause name,
  recovers async, guarded-Hermes, and Solid-render failures, and tears down the
  Solid surface while the native host stays foreground. Its source-map gate,
  shared process watchdog, terminal cleanup, and isolated app removal all pass.
- The runtime supports bounded local timelines, failure-isolated fan-out,
  dependency-free Sentry and OpenTelemetry adapters, sampling that keeps whole
  causal graphs, and privacy-safe attributes.
- The CLI can capture one-shot device snapshots, summarize and traverse causal
  graphs, group retained causal components consistently with the on-device
  inspector, symbolicate them with canonical Metro/OXC maps, export Perfetto
  JSON with group markers and per-slice group IDs, generate a group-first
  offline debugger with opt-in Solid diagnostics correlation, and compare
  bounded baseline/candidate traces, including
  lost-edge fragmentation when equivalent operation shapes split into more
  causal groups.
- Release tooling creates canonical bundle/source-map artifacts, signed
  release envelopes, trust-policy verification, signed Android device-proof
  receipts, and correlation between an authorized release and its physical
  proof. This is a strong protocol foundation; it is not yet a hosted release
  service.

### Tooling and validation

- `solid-native create` starts from the exact pinned React Native community
  template and adds the Solid compiler, Metro, iOS pod, Android Gradle/CMake,
  native bootstrap, and application entrypoint integration.
- `doctor`, `fingerprint`, `generate`, `start`, `bundle`, `build`, `run`,
  application-scoped `logs`, physical-device deep-link `open`, and
  release/debugging commands have inspectable and machine-readable plans.
- Development uses safe whole-runtime reloads so React Refresh cannot retain
  stale Solid owners or native resources. A repeated Android reload soak checks
  surface/worklet cleanup and resource trends. The matching iOS runner has an
  automated Local Network permission preflight, an offline bundled-lifecycle
  baseline, same-process reload assertions, exact-bundle cleanup, and Activity
  Monitor resource export. A signed iPhone 17 Pro completed 20 consecutive
  bundled Hermes runtime replacements in one process and on one Fabric surface;
  every replacement settled at one active worklet with no pending native frame.
  Its 24 Activity Monitor samples moved from 15 MiB to 14 MiB physical footprint
  with 13–14 threads. This isolates runtime/Fabric ownership from transport; the
  live Metro-backed physical variant remains to be promoted independently.
- The deterministic in-memory host runs renderer and navigation conformance in
  both production and strict Solid development modes.
- `@solid-native/testing` now exposes a deterministic application renderer with
  live text/role/label/test-ID/component queries, native event delivery,
  explicit commit boundaries, scoped commit history, exact surface cleanup, and
  a bounded deterministic formatter for inspecting the committed native tree.
  Its abortable `waitFor` boundary flushes and observes delayed service or
  streamed Solid updates with the last assertion and native tree on timeout;
  async `findBy*` text/role/label/test-ID/component queries provide the direct
  semantic path for those delayed native results. A bounded `debugCommits`
  formatter exposes render-scoped priorities and mutations while keeping text,
  prop, and command-argument values opt-in; wait timeouts include its safe tail.
  First-class commit checkpoints plus typed commit/mutation queries now match
  exact transaction shape, causal IDs, native identities, component/command
  names, and prop/event-name sets without exposing application values; singular
  failures use the same bounded value-free transaction tail.
  `within(element)` scopes the full sync/async semantic query set to one live
  native subtree so retained sibling navigation screens do not create false
  ambiguity.
- `solid-native test` now gives generated applications a first-party test loop:
  bounded in-project discovery, the shared Solid universal OXC compiler, Node's
  built-in runner, source maps, and signal-safe execution without Babel, Jest,
  React's test renderer, Metro, or a device. It selects the development runtime
  by default so Solid's official attribution is available and retains an
  explicit optimized-production mode for non-diagnostic scenarios.
  Dependency-aware watch mode and a bounded test-name regular-expression filter
  support focused iteration. The generated starter tests its actual `App`
  counter, a delayed response and streamed chunk through the real Solid-owned
  network controller, exact owner/surface cleanup, no Solid diagnostics or
  wasted computations, at most six reruns, and the observed six-commit/
  105-mutation native budget. It now checkpoints and structurally matches each
  counter/request/response/chunk transaction through the public testing API;
  that integration removed a split JSX counter expression which had replaced
  two text nodes with eight mutations, leaving one text update plus its
  accessibility-label update.
- The repository gate checks formatting, dependency licenses, architectural
  import boundaries, all workspace builds, packed artifact contents,
  offline installation, every exported runtime/type surface, the installed CLI
  executable, its external create plan, and a packed OXC/TSX render-and-press
  test, TypeScript, unit/conformance tests,
  compatibility evidence, and the OXC sandbox.
- A fresh temporary application created outside the workspace from the packed
  CLI and packed `0.0.0` package set now passes TypeScript, production bundling,
  all Android and iOS doctor checks, a four-ABI Android Release build, CocoaPods
  resolution, and a generic iPhoneOS Release build. The Android proof starts
  from a shell that resolves Java 8: the CLI finds Android Studio's Java 21 and
  carries the same visible `JAVA_HOME` through diagnosis and Gradle. This proves
  the packaged starter/native layout on this Mac; the hardware modes below now
  add signed-device adoption evidence, while independent developers and store
  archives remain separate gates.
- The same process is now an explicit `starter:verify` release gate rather than
  a one-off shell exercise. It creates a new upstream-derived application,
  installs only packed Solid Native artifacts, applies the public
  `solid-native add navigation` recipe and verifies its shipped patch digest,
  type-checks and runs the exact generated `App.test.tsx`, verifies canonical
  bundles, and
  can Release-compile all four Android ABIs plus an unsigned generic iPhoneOS
  target. An additional explicit Android-device mode uses a collision-free
  package identity, refuses emulators and locked hardware before expensive
  work, and requires the generated Release starter's accessibility tree plus a
  live Solid counter update before verified package/process/settings cleanup.
  Its full interaction now passes on the Pixel 9a, including a physical tap,
  Solid-owned counter update, live-process check, uninstall, process/UI cleanup,
  and stay-awake restoration. That run exposed and fixed modern ADB's
  multi-line streamed-install acknowledgement without weakening exit-status or
  post-cleanup checks. A symmetric explicit iOS mode now rejects unsafe CoreDevice
  destinations and bundle collisions, validates signed bundle/team identity,
  and requires install, live launch, termination, and uninstall. The generated
  packed project resolved its 88-pod graph and completed a signed physical-
  iPhone Release build on this Mac. The complete signed gate now passes on the
  iPhone 17 Pro: install, launch survival, termination, uninstall, and process/
  application cleanup are verified. The current run first applied the public
  navigation recipe, verified all three patched native files, and compiled the
  resulting `RNScreens` pod into the signed application. It exposed and fixed
  Xcode 26.6's current `runningProcesses` CoreDevice schema; aggregate failures
  now retain their underlying hardware and cleanup causes. These hardware gates
  are deliberately opt-in and absent from GitHub Actions.
- Checked-in device runners cover many Release-mode Android and signed iOS
  paths. Evidence claims are source-hashed so later changes invalidate stale
  compatibility promotion instead of silently inheriting it.

## Evidence at a glance

`Device verified` below means a checked-in physical-device path has passed. It
does not imply that every prop or operating-system variant of that area is
supported.

| Area                                           | Android                                                                                  | iOS                                                                                  | Important qualification                                                        |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| React-free Hermes/Fabric application shell     | Device verified, including framework-neutral host proof                                  | Device verified, including framework-neutral host proof                              | Pinned to React Native 0.87.0                                                  |
| Core mount/update/event/measure/teardown       | Device verified, including Pressable movement, cancellation, scroll takeover, and ripple | Device verified, including Pressable movement, release recovery, and scroll takeover | Same-gesture iOS re-entry, raw cancellation, and physical pointer hover remain |
| Accessibility smoke tree                       | Device verified                                                                          | Device verified                                                                      | Full preference/delivery parity remains                                        |
| Keyboard avoidance and focus traversal         | Device verified                                                                          | Device verified                                                                      | IME composition, autofill UI, and hardware-keyboard traversal remain           |
| Native stack, modal/sheet, restoration         | Device verified on 4.27                                                                  | Device verified on 4.27                                                              | General route preload policy remains                                           |
| Native tabs and process restoration            | Device verified on 4.27                                                                  | Device verified on 4.27                                                              | Bounded one-entry restoration; arbitrary restored depth remains                |
| Virtualized list                               | Device verified, including measured heights, row recycling, and keyed prepends           | Device verified, including measured heights, keyed prepends, and first positioning   | Exact iOS row-wrapper identity and repeated matched performance remain         |
| UI-thread animation graph                      | Device verified                                                                          | Device verified                                                                      | Rich gestures and additional output classes remain                             |
| AsyncStorage-backed restoration                | Device verified                                                                          | End-to-end workload verified                                                         | The catalog's generated-binding claim still needs focused iOS promotion        |
| Local notification                             | Device verified with OS content/press assertions                                         | Device verified through native delivery/query/cancellation                           | Remote push/background execution remains; OS content/press is Android-only     |
| Camera preview and photo capture               | Device verified with OS assertions                                                       | Device verified                                                                      | Video, frame processors, and durable media remain                              |
| Causal event-to-commit-to-mount-to-frame chain | Device verified across representative paths                                              | Device verified across representative paths                                          | Async route settlement is physical on both; broader coverage remains           |
| Solid diagnostics device artifact              | Device verified through 19 same-window native frame chains                               | Device verified through 29 same-window native frame chains                           | Exact per-rerun correlation token remains                                      |
| Matched React Native performance evidence      | Repeated samples exist for selected workloads                                            | Partial                                                                              | Benchmark gate is intentionally still open                                     |

## What still has to work

### 1. Make the repository consumable

- Select the project name, legal entity/organization shape, trademark posture,
  and open-source license.
- Replace `private: true`/`0.0.0` package manifests with an intentional public
  package set, dependency policy, versioning policy, changelog, and release
  process. A read-only `pnpm packages:release-plan` gate now discovers all 27
  candidate packages, validates their internal workspace edges, rejects missing
  packages and runtime dependency cycles, and emits five deterministic
  publication waves. Its strict mode remains intentionally red on the guarded
  privacy, placeholder-version, license, repository, and public-access
  decisions; it neither edits manifests nor contacts a registry.
- Keep the generated starter and task-oriented source-checkout guide coherent,
  then turn them into a published quickstart and validate it with external
  developers. The current E2E application remains evidence infrastructure,
  not a first-user tutorial.
- Keep the opt-in packed external-starter gate green as packages become
  publishable and run it from clean release hosts. Its initial same-machine run
  exposed and fixed a whitespace-sensitive doctor check for the generated
  Android TurboModule spec, a `pnpm doctor` command collision, and stale shell
  JDK selection before any could reach a first user.
- Prove clean installation and store-capable builds with at least two external
  developers on machines that do not contain this monorepo.

### 2. Measure backend maintenance rather than assuming it

- An initial isolated
  [React Native 0.88 nightly rehearsal](react-native-0.88-upgrade-rehearsal.md)
  now passes workspace build/check, the complete Android Release native build,
  the ordinary physical Pixel launch, CocoaPods resolution, a 100-target
  generic-device iOS Release build, and the strict one-Solid/no-React-facade
  source-map gate. Its collision-free signed Release app now also launches,
  survives a bounded process check, terminates, and uninstalls cleanly on the
  physical iPhone 17 Pro. It exposed and fixed a fail-open Hermes compiler/
  runtime pairing hazard in the supported CLI. This is a forward canary, not a
  supported 0.88 backend.
- Package, normalized runtime, Hermes compiler, and HBC identities now live in
  one dependency-free `@solid-native/react-native-compat` contract consumed by
  the CLI, Fabric host, runtime services, and direct TurboModule adapters. The
  native integration gate checks both JSI bindings and pod pins against it.
- The reviewed Fabric boundary manifest is now the native build source of
  truth: CocoaPods derives every exact React Native constraint and the C++
  runtime tuple from it, while Gradle passes that same tuple through CMake.
  Candidate preparation no longer requires global Podspec or C++ namespace
  rewrites, and the compile guard still fails closed on a mismatched native
  tree.
- All physical Android instrumentation proofs and the ordinary-launch proof now
  share a fail-closed secure-keyguard preflight and a reversible wired
  stay-awake lease, preventing expensive builds from ending in ambiguous
  auto-lock timeouts.
- Repeat the signed physical iOS launch against a stable 0.88 release, then
  rerun representative navigation, module, lifecycle, stability, and benchmark
  gates before extending the supported-backend matrix.
- The read-only `solid-native upgrade react-native --candidate PATH` workflow
  now compares an installed candidate against the verified baseline. It
  validates exact package/runtime/Hermes/React/Codegen/Gradle/lock identities,
  fingerprints the manifest-bounded upstream header surface, and emits every
  remaining native and physical promotion gate without changing either tree.
- Propose the remaining Android/iOS latest-request-wins tab-icon fixes upstream.
  The 4.27.0 rebase already removed the former Fresco-nullability and
  `RCTCxxBridge` guards, reducing the patch from four native areas to two.
- The navigation package now ships that reduced patch, its exact screens peer,
  and a machine-readable post-patch file contract. `solid-native doctor`
  verifies the real installed native bytes, so an external consumer cannot pass
  merely by installing an unpatched package with the right version number.
- Keep the framework-neutral Fabric host independently packaged. A future
  backend is possible, but building one now is not required to validate the
  Solid product.

### 3. Finish the daily development experience

- The CLI now has honest application-scoped logging on both physical platforms:
  UID-filtered Android logcat survives app restarts, while the explicit iOS
  CoreDevice path requires restart acknowledgement and owns the launch console
  and app teardown. Public `device status-ios` and `device stop-ios` operations
  now require one exact developer-installed bundle, expose path-free process
  state, terminate only that bundle's observed PIDs, follow replacement
  generations, and require a one-second clean-stability window. A signed
  physical-iPhone proof found the isolated Devtools PID, stopped it, and then
  reported zero processes before uninstall. Application-targeted deep-link
  delivery now supports
  explicit preserve/cold modes, package-constrained Android resolution, and
  structured CoreDevice acknowledgement on iOS. A Solid-owned development
  error overlay now catches recoverable render and guarded Hermes failures, and
  the explicit native networking seam has bounded privacy-aware lifecycle
  inspection plus an opt-in Solid-owned on-device panel. The CLI now also has a
  bounded, interruptible Android/iOS causal watch built on the nonce-scoped
  one-shot transports, with privacy-safe terminal and NDJSON output. Generated
  apps wire the build-aware inspector into an owner-safe bounded native request
  workflow without loading the recorder in production. Generated platform
  shells also replace host, JSI-binding, and initial-surface startup blanks with
  a dependency-free accessible native fallback whose Release message is
  generic. That shell now also accepts a bounded post-start fatal handoff:
  terminal Fabric commits enter it automatically, while
  `startNativeApplication` owns an `ErrorUtils` bridge for fatal Hermes
  exceptions and restores its predecessor on failed startup or explicit
  application disposal. Native takeover failure still falls back to the prior
  platform handler without overwriting a newer global owner. It stops the live
  surface, transports no stacks or arbitrary thrown values, and leaves
  recoverable development errors with the Solid overlay. Generated development
  roots now also include the first resident causal graph client: it snapshots
  the bounded local timeline, lists operation status/duration without
  application attributes, filters by operation name/ID, and navigates directly
  through
  retained transitive causes/effects. Refresh remains explicit so rendering the
  inspector cannot feed its own Fabric telemetry back into an unbounded update
  loop. A physical Pixel proof now opens the panel, filters by an exact opaque
  ID, switches between flat operations and bounded weakly connected causal
  groups, selects the matching group and commit, walks to its retained cause
  through both back levels, clears the trace, closes the panel without
  remounting the application, and then completes all error-recovery and
  terminal-teardown checks. Local group IDs are explicitly not presented as
  distributed trace identities.
- Extend the new in-process `@solidjs/diagnostics` integration beyond the first
  checked-in scenario budgets. The timed path is now physical on both devices;
  pursue an upstream correlation hook beyond the current
  static-name/capture-window join before claiming an exact
  Solid-rerun-to-Fabric correlation, and keep value previews and stacks out of
  hosted telemetry by default.
- Design owner-preserving Solid HMR only after an explicit compiler/runtime
  ownership protocol exists. Safe full-runtime reload is the supported current
  behavior.
- Connect the stabilized deterministic query/event/commit/cleanup API and its
  structural transaction matchers to reusable native-device scenarios.
- Make common Xcode, CocoaPods, Android SDK, and device failures easier to
  diagnose from the CLI. Android doctor now distinguishes the generated
  development-signed Release fallback from an explicit non-debug signing
  configuration without claiming custody or validation of private keys;
  `doctor --strict` lets release CI make any remaining warning fail without
  weakening the stable report schema. A separate Android release check now
  verifies the actual AAB JAR signature, rejects debug/multiple signers, can pin
  the upload-certificate SHA-256, and can bind that identity plus the exact AAB
  digest directly into the release envelope for automatic reverification. The
  symmetric APK path uses Android SDK `apksigner`, treats warnings as failures,
  binds the complete non-debug signer set across supported Android versions,
  and preserves explicit key rotation. Signing-credential and store acceptance
  checks remain delivery-pipeline work.

### 4. Close component and interaction gaps

- Complete on physical Android: Pressable retained-region re-entry, diagonal
  movement, raw cancellation/recovery, parent ScrollView takeover, and visible
  foreground ripple rendering pass in one Release instrumentation gate with
  verified teardown and package/process cleanup. The facade keeps the stable
  Pressable host as the default touch target and calculates movement against an
  activation-time page origin, so reactive child replacement and Android's
  out-of-bounds local-coordinate changes cannot break an active gesture.
  Deterministic tests cover those invariants plus `hitSlop`, delayed feedback,
  release suppression, and long-press drift cancellation. Solid-owned hover
  callbacks now map direct pointer enter/leave through both native backends,
  own bounded entry/exit delay cancellation, preserve causal attribution, and
  cancel timers on disposal; both Release compile paths pass. A signed iPhone
  Release gate now physically verifies diagonal and displaced release
  suppression, recovery on the next gesture, an ordinary tap, and positive
  native ScrollView takeover without an accidental press. ScrollView drag
  ownership cancels registered descendant Pressables before the later native
  release and preserves next-gesture recovery. Same-gesture retained-region
  re-entry, raw cancellation injection, and physical pointer-hover input remain
  open on iOS before broad parity claims.
- Add trustworthy in-process UIKit wrapper-object observation for typed
  visible-content anchoring. Pixel and signed-iPhone Release proofs already
  retain the keyed Solid owner, bounded window, and screen coordinate across a
  50-row prepend without a JavaScript scroll command; Android additionally
  proves exact Java `View` identity.
- Validate IME composition, hardware-keyboard traversal, physical autofill UI,
  accessibility focus order, and additional international text-input cases.
- Promote automatic variable-height measurement and the opt-in recycled
  row-view contract on iOS. Android independently verifies 40/80-point native
  row geometry, bounded post-swipe ownership, keyed disposal, and one exact
  Java wrapper `View` moving from row 1 to row 13. Deterministic coverage also
  proves retained-key identity, surplus-slot reclamation, and rejection of
  stale pre-assignment measurements. A dedicated signed-iPhone Release gate is
  now checked in for 40/80/40-point UIKit accessibility frames, adjacency,
  physical scroll eviction, boundedness, source-map validation, and guarded
  cleanup. Its application and XCTest target now pass a signed physical iPhone
  Release run with learned native extents and bounded ownership. Exact UIKit
  wrapper-object observation remains separate from that accessibility proof.
- Expand gesture composition and animation interruption semantics beyond the
  initial bounded native graph.
- Continue accessibility and vibration parity work where iOS is currently only
  compiled or covered indirectly. Extend notification coverage separately to
  remote push, background execution, rich actions, and iOS Notification Center
  content/press assertions.

### 5. Harden navigation as an application framework

- Typed in-application links now render through Solid Native's real
  `Pressable` and preserve TanStack's registered route/parameter contract.
  Active, pending, pressed, and unsettled-navigation state are fine-grained
  Solid reads; native props remain reactive, duplicate requests are bounded,
  browser-only navigation fails closed, and native touch-intent or post-render
  preloading is explicit, deduplicated, failure-isolated, and disposal-safe.
  Normal plus strict-Diagnostics suites exercise the complete interaction. The
  Pixel 9a Release process suite also enters detail through that public link
  with a real async loader and verifies press → task → separate normal-priority
  final commit in seed, memory-pressure, and all 30 churn navigations. The task
  exposes only static runtime resource keys and its static name. A focused
  signed-iPhone product flow physically entered the same 75 ms async detail
  through the public link and required its pending/final causal chain. The
  current secure-session candidate now passes that complete two-process flow,
  including Keychain restoration and secure logout in the second process.
- Programmatic route changes now have a registered-router typed native hook
  with route-local relative resolution. TanStack `beforeLoad` redirects are
  exposed at the package boundary and deterministically prove that a replacing
  authentication redirect removes the denied native-history entry before
  rendering login content. The Pixel Release product phase combines that
  redirect with two physical programmatic presses: a slow route is displaced by
  a replacing home route, its task is canceled, its retained native `Screen` is
  reused, and late settlement cannot overwrite the winning normal-priority
  commit or the exact `[/login, /home]` history. Android Back reveals the
  original login `Screen`, and all route/focus owners balance at teardown. The
  freshly promoted iPhone composed-flow proof independently authenticated from
  a protected launch, interrupted a pending sheet route, and required the
  winning sheet's separately settled normal-priority causal commit before
  native Back on the current shared entrypoint.
- TanStack Native now exposes vendor-neutral external-cache reclamation for
  each memory-warning generation plus an abortable per-entry historical
  preload policy. It clears Router loader/preload caches, cancels restoration
  prewarming, and discards inactive settled route snapshots while retaining
  current route and native history identity. Eventually exercise OS-generated
  pressure in addition to the physically verified UIKit/RCTAppState and
  Android Application callback paths. Hidden asynchronous screen work already
  has an explicit
  abort-on-blur/disposal policy; parked owner graphs have deterministic
  disposal/remount semantics and can react to the cross-platform warning
  counter.
- `TanStackNativeScrollView` now closes the in-process scroll-loss case created
  by that reclamation policy: offsets are keyed by stable history entry plus a
  bounded container key, malformed native payloads fail through an isolated
  hook, and only a replacement ScrollView receives a non-animated restoration
  command. A versioned, size-bounded `NativeScrollRestoration` can now be loaded
  and persisted through an application-owned native store; it accepts durable
  offsets only alongside an actually restored history and deletes them for
  fresh/deep-link launches. History, tabs, and scroll persistence retain the
  newest snapshot after a transient native-store failure and retry it on the
  next change or explicit flush without a hot loop. Candidate history also
  proves its complete serialized-size bound before mutation, preventing an
  oversized route state from partially committing ahead of persistence. Scroll
  capture enforces its independent 1 MiB envelope through exact incremental
  accounting rather than whole-registry serialization on each event. Fresh
  Release promotion now passes on both devices: the six-process Pixel path
  persists and restores 320dp across process death and pressure remounting, and
  the signed iPhone path performs a real drag before requiring the replacement
  scroll container in PID two to recover the same on-screen position.
- Keep both platform suites current across future `react-native-screens` pin
  upgrades. The Pixel 9a has passed the six-process
  restoration/memory/churn/product suite plus native-tab restoration,
  appearance, and asynchronous image ownership on 4.27.0. The signed iPhone has
  a prior full native-tab restoration/appearance/image promotion plus a fresh
  current-source auth/link/interruption/stack/sheet composition run on the same
  pin. The compatibility catalog promotes the freshly rerun stack, screen, and
  header claims to `device-verified`; modal and tab surfaces remain bounded by
  their independent current-source promotion gates.
- Expand the representative application-shaped flow beyond navigation into the
  first early-adopter module set. The current physical Pixel flow and freshly
  promoted iPhone flow combine a
  protected cold launch, replacing authentication redirect, retained native
  tab, typed link, async data, nested stack, interrupted programmatic request,
  platform-native sheet, platform Back, cross-tab state retention, causal
  telemetry, and exact teardown in one process. The Pixel flow now persists its
  session before leaving login, tears down and force-stops that process, then
  restores the exact Keystore-backed credential through an asynchronous
  `beforeLoad` in a distinct process. Physical logout removes and verifies the
  credential before exact owner/native/Fabric teardown; telemetry exposes only
  exact operation counts, never the key or value. The matching Keychain-backed
  iPhone integration now passes the same two-process restore-and-clear contract
  in a signed Release run. Remote data mutation, background delivery, and
  production error recovery remain open.

### 6. Broaden native-module compatibility deliberately

- Survey the capabilities required by initial adopters, then classify
  the top modules as direct TurboModule, generated component, narrow adapter,
  native modification, or unsupported React-component dependency.
- Secure storage is implemented over a versioned `react-native-keychain` 10
  legacy-native seam. Signed Release gates pass on both Pixel and iPhone: the
  former independently checks a non-exportable Android Keystore key and
  encrypted persistence, while the latter recreates Hermes, Solid, and
  `RCTHost` before restoring the exact device-only Keychain value. Both delete
  their records, prove secret-free causal delivery, and complete non-terminating
  teardown. Generated-binding discovery rejects the dependency's empty Codegen
  declaration instead of overclaiming a TurboModule. The Pixel representative
  authentication flow now consumes this promoted capability across a forced
  process restart and secure logout; the corresponding signed iPhone
  composition proof now passes the same protected-session lifecycle across two
  fresh application processes.
- Add remote push/background handlers, richer media, files, permissions,
  location, and other capabilities selected from real product demand.
- Decide whether Expo Modules Core interoperability is technically worthwhile.
- Add compatibility CI that reruns promoted claims against supported native
  versions and devices.

### 7. Prove representative performance and stability

- Add startup, navigation/input composition, text-heavy, and sustained mixed
  workloads with matched React Native 0.87 controls.
- Run repeated randomized samples on both devices while recording thermal,
  power, OS, hardware, revision, and native-runtime identity.
- Retain raw samples with fixed warmup/outlier rules. A next-vsync callback must
  not be marketed as compositor presentation.
- Run longer lifecycle, navigation, image, camera, reload, and background/
  foreground soaks with bounded memory and thread assertions.

### 8. Integrate Solid's server/client protocol at the right seam

- Revisit the active Solid 2 server-component work after 2026-08-28 and pursue
  a renderer-neutral frame/data interface upstream rather than copying current
  DOM/HTML internals.
- First prove typed server functions, single-flight data, optimistic action
  settlement, cancellation with route/owner disposal, bounded streaming,
  reconnection, and causal context propagation.
- Native clients should render their own platform views. The shared protocol
  should carry authoritative data, continuations, invalidations, and actions—not
  HTML or raw Fabric mutations.

## Recommended execution order

1. Publishable foundation: licensing/naming decision, public package boundary,
   starter app, and external clean-machine builds.
2. Maintenance proof: finish the React Native upgrade rehearsal on iOS and a
   stable release, then add the supported matrix and actionable upgrade
   workflow.
3. Developer loop: error experience, logs, inspector, testing API, and robust
   full reload before attempting owner-preserving HMR.
4. Product correctness: remaining interaction/input/list gaps, iOS evidence
   parity, and one representative multi-feature application flow.
5. Early adopters: select module and workflow priorities from applications
   that are actually heading toward a store release.
6. Server/client spike: collaborate with Solid upstream on a renderer-neutral
   protocol once the active work is stable enough to target.

## Honest current label

The best current description is **an advanced, physically validated technical
preview foundation**. It is much more than a renderer experiment, but it is not
yet a supported production application platform. The next credibility jump
comes from making it installable and maintainable by people outside this
checkout—not from adding another isolated native primitive.

For the detailed evidence trail and acceptance criteria, see
[Roadmap and validation gates](roadmap.md), [Architecture](architecture.md),
[React Native compatibility strategy](react-native-compatibility.md), and
[Benchmark methodology](benchmarks.md).
