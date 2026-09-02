# Routing and native navigation

TanStack Router for Solid 2 should own route matching and application navigation state. Solid Native should not create a competing router.

## Responsibility split

```text
TanStack Router
  route tree, params, search state, loaders, redirects
             |
Solid Native history adapter
  location synchronization, deep links, restoration
             |
Native presentation
  stacks, tabs, screens, headers, modals, gestures
```

Typed application links stay on the same boundary. `TanStackNativeLink` feeds
TanStack's registered `NavigateOptions` into the router, derives active and
pending state from TanStack's stores with Solid memos, and presents the result
through Solid Native's React-free `Pressable`. It does not introduce a second
matcher or emulate a DOM anchor. External URLs remain platform-linking work;
`href` and document reload options are rejected by the native link. Touch
intent can preload at native press-in, while render preloading begins only
after the first Solid settlement; both use TanStack's existing loader cache
and stop publishing link-local state after owner disposal.

Programmatic transitions use `useTanStackNativeNavigate({ from })`, which
preserves TanStack's registered destination, search, state, mask, and parameter
types while resolving relative paths from the owning route. Route-entry auth
and onboarding guards use TanStack `beforeLoad` plus the package's
`tanStackRedirect` re-export. A replacing redirect updates the native history
entry in place, so denied content is not exposed behind Android Back or an iOS
interactive pop.

Both entry points preserve causality across asynchronous loaders. A native link
creates a `navigation.link` task beneath the Fabric press; the programmatic hook
creates `navigation.programmatic`. TanStack's pending and settled store
publications re-enter the active task before Solid flushes, connecting the
request to every resulting native commit and its Fabric mount/frame chain.
Task names are static: route hrefs, params, search state, loader values, and
error messages never enter telemetry. A newer request cancels the displaced
router task, and provider/root teardown cancels unfinished work.

The Android Release product path physically combines authentication and
interruption. A `/protected` launch is replaced by `/login` before protected
content can mount. One press starts a slow programmatic route; a second press
replaces it with `/home` while the loader is still pending. The displaced task
is canceled, the winner causes the separately committed pending and final
normal-priority frames, and late stale-loader bookkeeping is detached from both
navigation tasks and cannot alter route or history. The same native pending
`Screen` is reused for home, and Android Back reveals the original login
`Screen` with the forward home entry retained.

The native-tabs product gate additionally ties authentication to the promoted
secure-storage boundary. A physical sign-in is not allowed to navigate until a
Solid-owned controller has persisted the opaque session. After the composed
surface is torn down, a forced fresh Android process cold-opens `/protected`;
its asynchronous `beforeLoad` restores the exact Keystore-backed value before
protected loader data or UI can publish. A physical logout removes and re-reads
the credential as absent before terminal disposal. Exact secure read, write,
and remove event counts remain causally visible while the key and value remain
absent from telemetry. The matching two-process iOS Keychain scenario is
implemented but awaits a clean physical rerun.

## Implemented native history

`NativeHistory` is implemented as a framework-neutral state machine. It adds:

- Stable native screen identities
- Serialization for process restoration
- System-originated deep-link entries
- Reconciliation of router navigation with platform-driven back actions
- Transaction identifiers to avoid router/native feedback loops

Application-originated `push`, `replace`, `back`, and `reset` operations mutate
history immediately and remain acknowledgement-tracked until native
presentation completes. A same-identity `replace` is acknowledged by
`NativeStack` immediately because it is a reactive update to the retained
screen rather than a platform presentation transition; waiting for a native
`transitionEnd` would leak search-parameter and state replacements on platforms
that correctly emit no transition. Destroying a stack or modal presenter also
drains the acknowledgements it owns so an externally retained history cannot
accumulate orphaned diagnostics. A platform back is deliberately two phase:

```ts
const transition = history.requestPlatformBack();

// Complete only after the OS gesture or back operation decides its outcome.
history.completePlatformTransition(transition.id, true);
// Passing false cancels it without changing the history snapshot.
```

Only one platform transition may be pending at a time. Completion also verifies
that its original source entry is still current, preventing a stale gesture
from overwriting newer application navigation.

### Process restoration and persistence

Persistence uses an explicit version-0 envelope instead of trusting arbitrary
JSON as a typed `NativeHistorySnapshot`:

```ts
const serialized = serializeNativeHistorySnapshot(history.snapshot);
const snapshot = deserializeNativeHistorySnapshot(serialized);
const restoredHistory = new NativeHistory({ snapshot });
```

Both serialization and construction validate IDs, hrefs, indices, duplicate
entries, finite numbers, plain-object/array state, circular references, nesting
depth, and total state values. Deserialization additionally rejects invalid
JSON, unsupported versions, payloads over 1,048,576 characters, and stacks over
512 entries. Returned snapshots and history accessors are deep clones, so a
storage adapter cannot mutate live history through a retained object reference.

The codec remains pure, while the storage integration is explicit and
dependency-injected. Any asynchronous string store implementing `getItem`,
`setItem`, and `removeItem` can supply launch restoration and ordered ongoing
persistence:

```ts
const launch = await createNativeHistoryFromStorage({
  storage,
  storageKey: "navigation",
  initialURL: await NativePlatform.getInitialURL(),
  resolveDeepLink: parseApplicationUrl,
});

const persistence = createNativeHistoryPersistence(launch.history, storage, {
  storageKey: "navigation",
  onError: reportPersistenceFailure,
});

// A release or background boundary can await actual native durability.
await persistence.flush();
```

An accepted initial URL takes precedence and starts a fresh one-entry stack,
so restored screens do not unexpectedly sit behind a platform intent. If the
URL is absent or ignored, a valid snapshot retains its stable screen IDs. Bad
or obsolete state considered for restoration is removed and returned as
`restorationError`; launch falls back to the configured safe initial location
instead of preventing startup. A valid stored stack superseded by an accepted
URL is also removed before the storage launch helper returns. This closes the
window in which a crash before persistence setup could let the next ordinary
launch resurrect the discarded stack. Native store availability or cleanup
failures still reject startup so the application shell can select its own
recovery policy.

Persistence writes the initial snapshot and observes every later history
update. Native writes are serialized, and updates arriving behind a slow write
coalesce to the newest snapshot, so an older completion can never overwrite
newer navigation. `flush()` is the explicit durability and error boundary;
diagnostic-handler failures cannot hide the underlying storage failure. The
subscription is disposed with its Solid owner and also exposes idempotent
manual disposal.
`pendingApplicationTransitionCount` and `hasPendingPlatformTransition` expose
small diagnostic counters without exposing mutable transition collections.

## Implemented native stack

`NativeStack` subscribes to `NativeHistory` and renders the active history
prefix as keyed Solid owners inside the public `ScreenStack` and `Screen`
facades. The React Native 0.87 backend maps those components to
`RNSScreenStack` and `RNSScreen` from the pinned `react-native-screens`
integration.

```tsx
const history = new NativeHistory({ initialHref: "/" });

const App = () => (
  <NativeStack
    history={history}
    defaultScreenOptions={{
      gestureEnabled: true,
      nativeBackButtonDismissalEnabled: true,
      presentation: "push",
    }}
    screenOptions={(entry) => ({
      gestureEnabled: entry.href === "/locked" ? false : undefined,
    })}
    renderHeader={(entry) => (
      <ScreenHeader title={entry().href === "/" ? "Home" : "Detail"}>
        {entry().href === "/detail" ? (
          <ScreenHeaderSubview type="right">
            <Pressable
              accessible
              accessibilityRole="button"
              onPress={saveDetail}
            >
              <Text>Save</Text>
            </Pressable>
          </ScreenHeaderSubview>
        ) : null}
      </ScreenHeader>
    )}
    onUpdate={({ transition, snapshot }) => {
      persist(snapshot);
      recordNavigation(transition);
    }}
  >
    {(entry, index) => <RouteContent entry={entry()} depth={index()} />}
  </NativeStack>
);
```

Both `NativeStack` and `NativeTabs` accept reactive
`defaultScreenOptions`. Each keyed route/tab resolver is shallowly merged after
that navigator-wide layer: matching keys override it, and an explicitly owned
`undefined` clears an inherited option. Non-structural changes flow into the
existing native node through Solid without reconstructing its keyed owner. A
stack entry captures `presentation` when that owner is created because its
native push/modal/sheet container is structural. Nested transport values such
as styles, icons, and special-effect objects are atomic rather than implicitly
deep-merged.

`mapArray` keys each screen by its stable history entry ID. Pushing and popping
does not recreate an unaffected root screen or its direct content handle;
permanently removed screens dispose with their Solid owner. Native transition
completion acknowledges application transactions. An iOS native dismissal
requests and completes the matching platform transition after the native event
handler unwinds, so disposal cannot invalidate the handler that is executing.
A naturally canceled interactive gesture leaves history unchanged and surfaces
through `onPlatformBackCancel`. A dismissal held by `preventNativeDismiss`
instead enters blocker arbitration and reports a rejected result through
`onPlatformBackBlocked`; the two native outcomes are intentionally distinct.

`renderHeader` mounts one basic `ScreenHeader` configuration inside the same
keyed owner, after its route content. This preserves the direct-child ordering
required by the native screen stack and keeps reactive title/options updates
attached to the stable screen identity. The Fabric backend maps the logical
facade directly to `RNSScreenStackHeaderConfig` and maps
`ScreenHeaderSubview` to `RNSScreenStackHeaderSubview`; no React wrapper
participates. Titles, colors, back-button policy, shadow/translucency, iOS
large-title typography, platform top-inset handling, and custom back, left,
right, and center slots are implemented. Slot children remain ordinary
Solid-owned native nodes with reactive props and event handlers. On iOS,
transport-safe left/right bar-button arrays add native buttons, spacing,
SF Symbols/XCAssets, badges, reactive state, and bounded nested menus. Callback
functions never enter RawProps: deterministic button/menu IDs return through
discrete direct events and resolve against the latest Solid-owned item tree.
Android omits this iOS-only upstream API and continues to use custom subview
slots. A signed physical iPhone proof presses a native bar button, opens a
nested UIKit menu, selects its action, and observes both callbacks through
Solid-visible reactive state before exercising the same screen's interactive
navigation lifecycle. Navigator-wide screen presentation and tab item defaults
inherit through `defaultScreenOptions`; callback-bearing header content remains
explicitly owned by `renderHeader` rather than entering an opaque option merge.

Native stack sheets use the same keyed route owner. Returning
`presentation: "sheet"` from `screenOptions` selects iOS `RNSModalScreen` or an
Android `RNSScreen` backed by Material bottom-sheet behavior. The options expose
ascending ratio detents or `"fitToContents"`, initial and undimmed indices,
grabber/corner/scroll policy, Android elevation and inset/resize behavior, and a
typed `onScreenSheetDetentChange(entry, event)` callback. Invalid ranges,
ordering, indices, or Android's greater-than-three detent case fail before the
transaction crosses JSI. The physical Pixel Release proof drags `[0.55, 0.92]`
from the large sheet to stable detent `0`, projects the native event into a
Solid signal and accessible text, persists the route, and restores it in a new
process. The signed iPhone Release proof presents the same ratios through
`RNSModalScreen`, drags the real UIKit grabber from its expanded state to the
system's half-screen state, requires stable detent `0` in Solid-visible output,
verifies that the keyed detail owner remains mounted while the native container
moves, and then tears down the sheet and Fabric surface exactly.

Standalone modal routing is a separate `NativeModalStack` projection. History
entry `0` remains the application content; each later active entry owns a keyed
cross-platform `Modal` portal:

```tsx
<NativeModalStack
  history={history}
  defaultModalOptions={{
    allowSwipeDismissal: true,
    animationType: "slide",
    presentationStyle: "pageSheet",
  }}
  modalOptions={(entry) => ({
    accessibilityLabel: `Modal ${entry.href}`,
  })}
  onPlatformBackBlocked={(entry) => recordBlockedClose(entry.href)}
>
  {(entry, _index, isFocused) => (
    <RouteContent entry={entry()} focused={isFocused()} />
  )}
</NativeModalStack>
```

Modal entries are structurally nested portals. Android therefore preserves
Dialog ordering, while UIKit can present every successive page sheet from the
preceding modal host instead of asking the application root to present sibling
controllers. Application Back changes only the top modal's native `visible`
prop and retains its route owner and pending transition until a cross-platform
hidden boundary. Multi-pop and reset operations repeat that top-down sequence;
they never ask the native platform to dismiss overlapping modal lifetimes in
parallel. Android reports each boundary after removing its Dialog; iOS first
keeps the Fabric event route alive for UIKit's asynchronous `onDismiss`. A native close
request uses `requestPlatformBack`, including asynchronous blockers, before it
changes history. Active blockers disable iOS swipe dismissal so UIKit cannot
complete ahead of the decision. Restored modal prefixes mount without fake
transitions, and terminal removal reclaims the core facade's private detached
parking tree rather than keeping it alive until root shutdown.

React Native 0.87 reports an accepted interactive page-sheet dismissal through
`requestClose` after UIKit has removed the sheet and omits the ordinary host
`dismiss` event. The core facade normalizes that event into the same exact-once
`onDismiss` and `onHidden` lifecycle used by application closes and deduplicates
a late native `dismiss` if both arrive. A signed iPhone Release proof closes one
real page sheet through application history, rejects a physical drag while a
Solid blocker is active, reactively enables dismissal, and accepts a second
physical drag. It requires exactly one platform history pop, two modal-owner
disposals, retained root content, and non-terminating Fabric teardown.

The Android nested-modal Release proof presents two real Dialog-backed routes,
closes them with two system Back actions, recreates the same stack, and applies
one application `back(2)`. It requires two serialized hidden boundaries in
top-down order, disposes each retained route owner only after its boundary,
acknowledges exactly one application transition, keeps the root owner alive,
and stops the Fabric surface without terminating the Activity process.

The child callback also receives an `isFocused` accessor owned by that keyed
screen. A platform `appear` focuses that owner and blurs its sibling owners;
`disappear` also blurs the emitting owner on backends that provide it. This
exclusive focus reconciliation matters because Android's screen stack does not
always emit a paired `disappear` when another screen covers or replaces one.
A route can express visibility-dependent work as a fine-grained Solid
computation instead of inferring it from history state. `onScreenFocus` and
`onScreenBlur` expose original semantic native events alongside the stable
history entry, but portable visibility policy should use `isFocused`. When
causal telemetry is enabled, native lifecycle events participate in the same
event-to-update-to-commit chain as other native input.

Hidden route owners remain live by default: covering a screen does not silently
change ordinary Solid signal or async semantics. Native work that should pause
with visibility uses an explicit owner-safe scope. Its setup starts only after
the platform focuses the screen, cleanup runs on blur or disposal, and the same
retained owner can start it again when Back reveals it:

```ts
createNativeScreenFocusEffect(isFocused, () => {
  const sensor = startSensor();
  return () => sensor.stop();
});
```

For promise-based work, `createNativeScreenFocusTask` supplies a fresh standard
`AbortSignal` for each focused interval. Blur, Back/reset removal, and owner
disposal abort it exactly once. A late rejection after cancellation is stale;
an active failure reaches the optional isolated error observer or the global
error path:

```ts
createNativeScreenFocusTask(
  isFocused,
  async (signal) => {
    const response = await fetch(orderURL, { signal });
    setOrder(await response.json());
  },
  {
    enabled: () => appState() === "active",
    onError: reportRouteError,
  },
);
```

The reactive `enabled` gate is intersected with native focus, allowing AppState,
connectivity, consent, or power policy to abort and later restart work without
disposing the retained route owner.

Accessibility focus is an explicit route policy rather than a side effect of
mounting every screen. A route can close over a native ref and request one
platform focus move after each positive native `appear` event:

```ts
let heading: NativeNode | undefined;

createNativeScreenAccessibilityFocus(isFocused, () => heading);

return <Text ref={(node) => (heading = node)}>Order details</Text>;
```

TanStack route components can instead call
`createTanStackNativeScreenAccessibilityFocus(() => heading)`. Solid Native
resolves the target after the focused Solid subtree settles and sends Fabric's
native accessibility-focus event against its current shadow node. This also
covers a restored or async route whose native Screen appears before its match
component assigns the heading ref; blur or disposal cancels the pending focus
interval. No React component instance or public tag crosses the API boundary,
and ordinary input focus remains separate.

The Android Release process proof registers a platform accessibility listener
before launch and observes focus events sourced from both the root and pushed
detail headings. That same run retains the stack through restoration and 30
push/system-Back cycles. The navigation entry also passes a generic iOS
Release/ARM64 build through React Native's `UIAccessibilityLayoutChanged`
path; a physical VoiceOver assertion is still outstanding.

TanStack route components can use
`createTanStackNativeScreenFocusEffect(setup)` without passing the context
accessor explicitly, or `createTanStackNativeScreenFocusTask(task, options)` for
abort-aware asynchronous work. This is the initial hidden-screen policy;
globally pausing an arbitrary owner graph would make pending resources and
external effects ambiguous and needs workload evidence before it becomes a
runtime feature.

## Implemented experimental native tabs

`NativeTabs` projects a keyed tab definition array into the pinned
`react-native-screens` Fabric tab host. Each stable key owns one Solid scene,
so local signals and native handles survive selection changes and metadata
reordering. The portable facade accepts one to five tabs, matching Android's
native `BottomNavigationView` bound. `isSelected` reflects the native host's
acknowledged state rather than merely the application request.

The native host uses a provenance protocol instead of a bare selected index.
Every JavaScript request carries the provenance it was based on, and every
native acknowledgement advances that value. `NativeTabs` keeps the desired
controlled key, actual native key, latest provenance, and last outbound request
separate. It can therefore retry a stale request from current native state and
roll back a user selection rejected by controlled application policy without
creating a request/event loop. Malformed payloads, unknown keys, and invalid
provenance fail at the semantic boundary or enter the explicit `onError` path.

The first surface includes text titles and badges, accessible/test labels,
selection prevention, repeated-selection effects, platform direction and
appearance mode, resource-safe icons, and screen lifecycle callbacks. Android
drawable identifiers and URI-backed raster sources plus iOS SF Symbol/XCAsset
names and URI-backed original/template sources are validated and flattened to
the pinned native props. A source is a URI string or bounded plain
`{ uri, width?, height?, scale? }` record; Solid Native copies it before
transport and excludes opaque numeric `require()` assets. Android vector XML
continues to use `drawableResource` because the upstream Fresco image path
decodes raster data. `standardAppearance` accepts bounded Android and iOS
branches; `scrollEdgeAppearance` accepts the corresponding iOS branch.
They cover state/layout-specific title, icon, badge and bar colors, typography,
Android ripple/indicator/label policy, and iOS blur/shadow policy. Solid Native
validates and copies the nested values before transport, while the Fabric host
recursively converts only these known appearance color properties to React
Native's processed-color representation. Android
maps to `RNSTabsHostAndroid` and `RNSTabsScreenAndroid`; iOS maps to their iOS
counterparts. Signed Pixel and iPhone Release proofs physically tap the real
Material `BottomNavigationView` and `UITabBar`, check positive accessible item
geometry, retain a scene-local signal across repeated tab switches, and balance
both keyed owner cleanups. The Pixel tab fixture loads Home through a
data-URI/Fresco callback and Settings from a compiled drawable while verifying
a single Solid runtime in the Hermes bundle. The dedicated appearance phase
waits for both icons and asserts the configured Material color state lists,
indicator, and label mode directly on the native view. That phase then drives
image, empty, and compiled-resource icon states through retained Solid owners.
The iPhone starts a separate, bounded proof process and inspects the live
`UITabBar` on UIKit's main thread. It requires the exact configured standard and
scroll-edge background and shadow, normal/selected title and icon colors,
selected badge background, nil blur, positive selected font weight, item
identifiers, selection, and visible geometry. It then observes template raster,
empty, SF Symbol, a racing raster immediately superseded by empty, stable empty,
restored SF Symbol, and
restored raster states in order, checking both Home image slots at every phase.
The inspector is enabled only by the exact proof launch URL, polls for at most
30 seconds, and stops immediately after success or failure.
The pinned native patch reconciles Android's mutually exclusive
icon props after the complete Fabric prop transaction and rejects stale image
callbacks; iOS image callbacks likewise retain weak view references and apply
only while their source and icon type remain current. Together, those reviewed
sources back device-verified compatibility claims for `RNSTabsHostAndroid`,
`RNSTabsScreenAndroid`, `RNSTabsHostIOS`, and `RNSTabsScreenIOS`.

```tsx
<NativeTabs
  tabs={tabs}
  screenOptions={(tab) => ({
    title: tab.title,
    icon: tab.icon,
    standardAppearance: {
      android: {
        tabBarBackgroundColor: "#fff7ed",
        tabBarItemLabelVisibilityMode: "labeled",
        selected: { tabBarItemIconColor: "#ea580c" },
      },
      ios: {
        stacked: {
          selected: { tabBarItemIconColor: "#ea580c" },
        },
        tabBarBlurEffect: "systemDefault",
      },
    },
  })}
>
  {(tab) => <TabScene tab={tab} />}
</NativeTabs>
```

A tab's keyed child callback is also a natural ownership boundary for its own
`NativeHistory` and `NativeStack`. The dedicated Pixel and iPhone proofs mount
that real nested `ScreenStack` and header inside Settings, push a detail owner,
switch to Home and back, and require both the detail native handle and shared
scene-local signal to survive. Android system Back and an iPhone left-edge
interactive pop must each select the Settings history, pop only its detail, and
leave the tab host and root owner alive. The framework-neutral
`createHardwareBackHandler` accepts a history accessor for this purpose and
captures the selected history before starting asynchronous blocker work, so a
later tab switch cannot redirect completion to another stack. This establishes
stack-in-tab composition and selected-tab platform Back. The retained Settings
owner now also owns a TanStack history adapter, Solid-backed router stores,
provider, loaders, and `TanStackNativeStack`. Physical Pixel and iPhone
automation enter the detail through `router.navigate`, read validated loader
data in its Solid route component, retain that component and native screen
across tab switches, then return through the platform-owned Back path. Cross-tab
deep-link routing and independent restoration no longer require
application-authored coordination. The optional
`createNativeTabsState` owns a Solid selected-key accessor and one
`NativeHistory` per stable tab key. `openDeepLink` changes the target history
and selection as one coordinator update; `createNativeTabsStatePersistence`
coalesces both sources into one versioned, bounded envelope. Restoration is
accepted only when its exact key set matches the configured tabs.

A dedicated Pixel product phase and the freshly promoted iPhone phase cold-open
the protected Settings route, replaces it with login before denied content mounts, authenticates into
the same native `Screen`, and then traverses typed `TanStackNativeLink` → nested
push stack → interrupted programmatic transition → platform-native sheet. The
detail loader crosses 75 ms of real async work; one privacy-bounded
`navigation.link` task retains the Fabric press through a separate pending
commit and final normal-priority commit. A slow sheet loader then exposes a
native pending UI whose interrupt press replaces the request with the final
sheet. The displaced `navigation.programmatic` task is canceled, the winning
task owns its commits, and the late settlement is detached and cannot change
the exact `[/, /detail, /sheet]` history. Android uses system Back around its
Material sheet; iOS uses the UIKit sheet and physically presses each native
header Back control. Both switch Home and Settings while retaining the detail
and its Solid signal, then reveal the original root. Instrumentation requires
the platform tab host and `ScreenStack`, plus retained root/detail `Screen`
identities around the one sheet `Screen`. Route, loader, native-node, tab-owner,
and surface teardown counts are exact. The current revision is device-verified
on Android; its changed shared iOS entrypoint is held at `native-integrated`
until the complete signed-device process reruns.

Cold launch has an explicit safety policy. If the application URL resolver
accepts the initial URL, `createNativeTabsStateFromLaunch` discards restoration
and starts the target tab directly at the resolved route, so Back cannot expose
an obsolete or pre-authentication stack. If the resolver ignores the URL,
valid restoration still wins. The storage variant removes corrupt, obsolete,
or key-incompatible data after selecting the safe fresh fallback. URL parsing,
the storage adapter/key, and whether a live link is authorized remain
application policy.

The signed Pixel and iPhone Release proofs exercise this policy through each
platform's registered cold-launch URL path. They write an obsolete snapshot
selecting Home with stale entries in both child histories to the AsyncStorage
3.x SQLite backend, then read it through `createNativeTabsStateFromStorage`.
The accepted URL targets the Settings detail, which must mount with
`canGoBack === false`.
Each proof requires the discarded durable envelope to be gone before installing
ongoing persistence. Replacing the linked detail with the Settings root cannot
reveal either stale entry. Each run then creates fresh routed history and
retains it across physical tab switches. Android Back and an iPhone left-edge
interactive pop each consume only the selected post-launch history. Finally,
persistence flushes both current histories and selection through the same
native adapter; the proof reads and decodes the durable envelope, rejects stale
entries, and removes its key.

Each runner separately proves process restoration. It physically selects
Settings, routes from root to detail, flushes the two-entry child history, tears
down the Solid surface, terminates the app, and verifies the process is gone.
An ordinary no-URL launch under a different PID restores Settings/detail.
`TanStackNativeStack` preloads exactly one prior entry for this bounded proof,
then the platform's real Android Back or iPhone interactive pop reveals the
resolved, retained root. A final cold-link phase runs under another PID and
proves that a newly accepted URL still discards that restored state. This
establishes both native-tabs process-replacement paths and the pre-persistence
crash-window policy; arbitrary restored depth remains unclaimed.

This API remains locally experimental while its public contract is hardened;
the current stable upstream pin has completed Solid Native's physical promotion
matrix. The
signed iPhone proof now covers all three selected-tab interactive outcomes: a
naturally canceled short gesture, a blocker-rejected full gesture that retains
the selected detail, and an allowed retry that pops it. The pinned native host
reports the blocked standalone-stack path as `nativeDismissCancel`, but reports
the equivalent stack-under-tabs path as `gestureCancel`; `NativeStack`
normalizes both event shapes into the same blocker arbitration without
conflating an unblocked natural cancellation. Future upstream pins must repeat
the same release gate.

Applications normally bind both live platform event sources to the current
Solid owner without adding React Native to the navigation package itself:

```ts
createNativeNavigationBindings(history, NativePlatform, {
  hardwareBack: {
    onTransition: recordPlatformBack,
    onError: reportFatalNavigationError,
  },
  deepLinks: {
    resolve(url) {
      const destination = parseApplicationUrl(url);
      return destination && { href: destination.href, state: { url } };
    },
    onError: reportFatalNavigationError,
  },
});
```

The binding disposes both subscriptions with its Solid owner and also exposes
an idempotent `dispose()` for an earlier stop. Partial setup removes an already
registered Back listener if URL subscription fails. The Back callback returns
`false` at the root so the host can perform its default action. When history
can pop, it synchronously consumes Back, completes one platform-originated
transition, and lets `NativeStack` reconcile the native tree.

The binding also establishes the causal ingress boundary. Hardware Back is the
static, discrete `platform.hardware-back.press` event; a running-process URL is
the default-priority `platform.url.open` event. Neither callback payload is
recorded. On Pixel, a blocker-mediated Back has been verified as the exact
platform event and Solid owner causing its user-blocking commit, mount, and next frame.
The live-link proof requires the URL event, owner, and the new screen's narrow
`navigation.focus.output` to cause its normal-priority commit through the same
mount/frame chain, while rejecting the URL from telemetry.

When a blocker is active, the callback still returns `true` synchronously as
React Native requires. The binding retains that one event delivery, explicitly
re-enters it only around the later allow/deny mutation, and finishes or fails it
with the blocker decision. Disposal cancels unfinished retention. The physical
Pixel path denies the first Back without a commit, then proves that only the
second, allowed event causes the pop commit; no ambient asynchronous context is
installed.

iOS interactive stack pops have a distinct ingress: react-native-screens emits
the direct Fabric `dismiss` event rather than React Native BackHandler. The
stack retains that default-priority event across its deferred history
settlement, so the event and Solid route owner remain attached to the exact pop
commit, mount, and next frame. This preserves the truthful platform distinction
instead of inventing an iOS hardware-Back event.

The lower-level callbacks remain available when an application shell needs to
own subscriptions outside a Solid root:

```ts
const back = createHardwareBackHandler(history, options);
const liveURL = createDeepLinkHandler(history, options);
```

Malformed events are rejected before history changes, a resolver can ignore
URLs outside the application's domain, and accepted URLs produce ordinary
system-originated transitions. URL parsing remains application policy rather
than a second route matcher inside Solid Native.

Provided navigation diagnostics (`onError`, `onNavigationError`, and
`onPreloadError`) are isolated observers. A hook that throws synchronously or
returns a rejected promise cannot replace a blocker failure, escape an event
handoff, hide a persistence failure, or displace a restored screen's safe
fallback.

## Native presentation responsibilities

- Push, replace, pop, reset, and dismiss
- iOS interactive swipe-back
- Android hardware and predictive back
- Native stack headers, large titles, Solid-owned back/left/right/center
  subviews, and native iOS bar-button/nested-menu arrays (implemented)
- Locally experimental keyed native tabs and nested `NativeStack` composition
  (implemented on the initial text/badge surface, including selected-tab
  Android system Back, cold cross-tab launch precedence, transport-safe
  resource icons, and an independently owned TanStack Router), plus Solid-owned
  tab selection, cross-tab links, bounded restoration, and physical iPhone
  allowed/blocked/canceled gesture policy; upstream is stable and the current
  pin is physically promoted on both platforms
- Native stack sheets with detents and standalone `NativeModalStack` routing,
  including restoration, blockers, and platform dismissal (implemented)
- Screen focus/blur and visibility lifecycle
- State restoration after process death
- Opt-in accessibility focus after transitions
- Retained Solid owners with explicit focus-scoped native work
- Abort-aware focus tasks with stale-rejection isolation

## Synchronization rules

Three sources can initiate navigation:

1. Application code calls the router.
2. The platform completes an interactive back gesture or hardware-back action.
3. The operating system opens a deep link or restores prior state.

Every transition needs an origin and transaction ID. The adapter must acknowledge native completion without generating a second transition. Canceled interactive gestures must leave router state unchanged or explicitly roll it back.

## Router integration boundary

The framework-neutral adapter is implemented against the pinned
`@tanstack/history` contract:

```ts
const nativeHistory = new NativeHistory({ initialHref: "/" });
const history = createTanStackNativeHistory(nativeHistory);

const router = createTanStackNativeRouter({
  routeTree,
  history,
  // React Native is a client runtime without `document`.
  isServer: false,
});
```

The adapter projects each active native entry into TanStack's parsed
`pathname`, `search`, `hash`, and history state. It preserves an existing
TanStack location key during process restoration, repairs the absolute history
index from the native snapshot, and allocates collision-free keys for new
router entries. Router-originated mutation suppresses the synchronous native
subscription and then emits once through TanStack; system deep links, direct
native operations, and completed platform back transitions take the inverse
path. Push, replace, Back, Forward, and `go(delta)` are deterministic in both
directions.

TanStack blockers are evaluated for programmatic adapter navigation, including
async blockers and `ignoreBlocker`. The adapter registers one generic
`NativeHistory` platform blocker only while TanStack blockers exist. Android's
Back callback consumes the operating-system action synchronously, then either
completes or cancels the pending logical transition after the async decision.
On iOS, every active stack screen receives `preventNativeDismiss`; the backend
keeps it mounted and reports the attempted dismissal. An allowed result removes
the screen through ordinary Solid reconciliation, while a blocked result leaves
both stacks unchanged. Blocker failures fail closed and remove the pending
transition instead of stranding navigation state.

The evaluated `@tanstack/solid-router` 1.170.29 package still declares a Solid
1 peer range (`^1.9.10`). Instead, `createTanStackNativeRouter` uses the
framework-store extension point in pinned `@tanstack/router-core` 1.171.26.
Core mutable atoms are Solid 2 signals, derived stores are memos, and router
batch publication uses Solid 2 `flush`. Deterministic tests exercise actual
matching, pending async loaders, loader data, and error match state.
`TanStackNativeRouterProvider` now owns the history subscription, first load,
transition publication, and cleanup. `TanStackNativeRouteView` renders the
active leaf match as native nodes across pending, success, error/retry, and
global-not-found branches. `TanStackNativeMatches` additionally walks the
matched hierarchy through `TanStackNativeOutlet`, honoring native route option
components for pending, loader error, component error, and not-found state.
Registered-router match and loader-data selectors validate route IDs and retain
route-specific params/data types. The binding intentionally disables TanStack's
browser scroll-reset listener; native scroll restoration belongs to native
scroll containers. Router instances on React Native must use `isServer: false`
because the runtime is a client even though it intentionally has no DOM. A
screen-aware projection that freezes each inactive route tree inside its keyed
`NativeStack` owner is implemented by `TanStackNativeStack`. It captures only
settled state for the matching TanStack history index, keeps that snapshot while
the screen is inactive, and reuses the same route component/native identities
on Back. New or restored entries with no settled snapshot render the required
application-supplied `renderUnresolved` placeholder. Applications may set a
positive `preloadRestoredEntries` bound to preload the nearest prior entries
sequentially after the current route resolves. Preloading never navigates,
preserves the keyed native owner when Back later exposes the entry, and ignores
late results after stack disposal. `shouldPreloadRestoredEntry` can apply an
application auth/network/cache policy to each candidate before its loader
starts. One shared abort signal cancels policy work on memory pressure or stack
disposal, and selection failures use the isolated `onPreloadError` observer.
Zero remains the default so process restoration cannot unexpectedly execute an
unbounded set of loaders.

Applications that cannot keep every inactive Solid route graph mounted can set
the reactive `maxMountedRouteTrees` budget. It counts the current match tree
and the nearest inactive trees. Entries outside the budget render
`renderParked` (or `renderUnresolved` when no parked renderer is supplied), and
their route component owners and native content nodes dispose. The keyed
`Screen`, history entry, and last settled TanStack snapshot remain, so raising
the budget remounts content without replacing the native container or changing
location. A value of `1` also parks the immediate predecessor; native
gesture-driven stacks should normally keep at least two trees mounted unless
the application deliberately accepts its parked presentation during Back.
This bounds mounted UI ownership, not TanStack's data cache, and recreates
component-local state after parking.

Dedicated Pixel and iPhone Release runners prove this across real process
boundaries. Each persists a root/detail stack, tears down the Solid surface,
terminates the package, and verifies the process is gone. An ordinary no-URL
launch under a different PID restores detail and preloads exactly the nearest
root. Android system Back or an iPhone left-edge interactive pop reveals that
resolved root while retaining detail as the forward entry. A third PID
cold-launches an accepted URL over an obsolete stored stack; the durable value
must be cleared before ongoing persistence starts, and Back cannot reveal
either obsolete entry. Every phase requires exact route-owner, loader,
native-node, root, and Fabric-surface teardown accounting. The iPhone run also
requires positive-size native navigation bars and validates the platform-pop
metadata before accepting its gesture marker.

## Physical proof

The checked-in React-free Release application first cold-launches from its
registered URL on both devices. The native Linking initial-URL promise feeds
`createNativeHistoryFromStorage`; Solid mounts and measures the resolved
one-entry stack in commit 1. Its native `appear` event changes the keyed
`isFocused` accessor and mounts visible focus state in commit 2. The proof then
resets to a fresh one-entry root in commit 3 without leaving the linked screen
behind Back. It waits for that root's native focus and mounts the accessor
reaction in commit 4 before resource acquisition or measurement can continue.
The iOS shell defers Solid host startup until application
activation so a cold URL delivered after `didFinishLaunching` can still be
merged into React Native's launch options.

An ordinary launch without an initial URL also waits for the root screen's
native `appear` event and flushes its focus accessor before measuring the
screen. The focus reaction is commit 2 on that shorter path. Recording it in
the proof's dynamic sequence offset prevents measurement itself from flushing
a pending lifecycle update and reporting unexpectedly newer geometry.

The application later pushes a detail entry into the actual native screen
stack in commit 12, waits for the exact Fabric mount lifecycle, and mounts its
native-focus reaction in commit 13. On Pixel, the content is the real
`TanStackNativeStack` projection: the route loader and component settle before
the native commit, the first system Back is held by an active TanStack blocker,
and the second system Back completes the single logical pop. Native focus owns
exactly one work scope across that transition; the covered root cleans up, the
detail takes ownership, and the retained root reacquires the scope on Back.
Root teardown balances every setup. The restored root also reuses its original
Solid owner and direct Fabric handle. A physical iPhone performs the matching
left-edge interactive pop through the underlying native stack. The dedicated
iPhone process-restoration run also reruns the TanStack route-component
projection with its retained preloaded-root owner. Its checked-in XCTest path
now requires a short seed-process edge drag to cancel naturally with no
blocker, then attempts one blocker-rejected edge swipe after restoration,
requires the detail to remain, and repeats the swipe after the blocker releases.
That complete signed physical run now passes, including the preceding native
header button and nested-menu interactions. The current exhaustive sequence
mounts the retained root in commit 14 and its native-focus reaction in commit 15.
They then receive the registered application URL a second time. iOS opens it
through XCTest's system API and Android delivers an `ACTION_VIEW` intent to the
running Activity. React Native's native Linking implementation forwards both
live events to Hermes; the framework-neutral handler resolves the URL into
history and Solid mounts the linked screen in commit 16, followed by its focus
reaction in commit 17. Both devices then reclaim every native identity during
teardown.

On the physical Pixel path, each of those three focus reactions additionally
proves the complete causal graph: the exact native focus event and any truthful
same-transition blur event, static `e2e.root` owner, affected
`navigation.focus.output` computation, route commit, exact Fabric revision
mount, and following `Choreographer` callback. Same-sequence focus and blur
records are distinguished by semantic event name; Android's omitted blur is
accepted only when no synthetic event was invented.

The Pixel process suite enters detail through `TanStackNativeLink` rather
than an ad-hoc press handler. Its loader crosses a real 75 ms asynchronous
boundary, while the proof application's manual host drain commits pending state
separately. Seed, memory-pressure recovery, and all 30 churn links require the
native press to cause a privacy-bounded `navigation.link` task and that task to
cause the eventual normal-priority Fabric commit. The accepted task attributes
are exactly the static runtime resource fields and `task.name`; route data never
enters the record. The freshly promoted iPhone product process uses the same
link and requires its async detail plus the later interrupted sheet route to
retain bounded causal ownership through their final normal-priority commits on
the current shared entrypoint.

The same application autolinks AsyncStorage 3.1.1 as an external Codegen
TurboModule instead of implementing a storage singleton inside navigation. The
physical Pixel round-trips and removes a value through its SQLite backend, then
requires the latest navigation location to survive an explicit persistence
flush and versioned decode. The matching signed iPhone Hermes run also
round-trips and removes a native value, then flushes and decodes the newest
owner-bound single-stack snapshot. Dedicated iPhone single-stack and native-tabs
proofs persist and restore their two-entry histories across process termination,
exercise a native left-edge pop, remove the durable values, and validate cold
URL precedence under third PIDs. The single-stack proof additionally performs
a physical 320-point root drag and requires the replacement scroll container to
recover the same on-screen position in its restored process.

The matrix also captured a backend distinction that the public API handles
explicitly. Android reliably emits `appear` for the newly visible screen but
may omit a paired `disappear` for the covered or replaced screen. One native
focus therefore updates all keyed `isFocused` accessors exclusively;
`onScreenBlur` remains a truthful callback for actual backend events instead of
inventing a synthetic native event. Focus and blur are normalized to direct,
default-priority lifecycle input on both host adapters.

The backend now uses `react-native-screens` 4.27.0, whose stable line explicitly
supports React Native 0.87. The former Android Fresco-nullability and iOS
`RCTCxxBridge` compatibility hunks are upstream and have been removed. Two
narrow behavioral hunks remain: Android reuses the upstream latest-request-wins
icon resolver for tab props, and iOS rejects stale asynchronous tab-image
completions. Android Release and generic iPhoneOS Release builds pass on this
pin. The Pixel 9a has passed the current 4.27 six-process navigation suite, and
the signed iPhone has passed the current three-process single-stack suite with
durable scroll restoration. The catalog therefore promotes the exercised
stack, screen, and header surfaces on both platforms to `device-verified`;
modal and tab surfaces retain independent current-evidence promotion gates.

## Validation scenarios

- Typed navigation to a parameterized screen
- Async loader and error boundary
- Native back gesture and Android back
- Native tab state retention, nested TanStack route loading/push/retain/pop,
  process restoration, and selected-tab platform Back (Pixel and iPhone
  complete for the bounded one-entry path)
- Cold-start deep link
- Process restoration (bounded single-stack and native-tabs Pixel/iPhone paths
  complete)
- Canceled interactive transition
- Correct Solid cleanup after a screen is permanently removed

The cold-start URL, basic push, physical platform-pop, and running-process
native deep-link scenarios are complete on iPhone and Pixel. The TanStack
history boundary now has deterministic push/replace/traversal, blocker,
restoration-key, external deep-link, completed-platform-back, and exact-once
feedback-loop coverage. Its Solid 2 provider deterministically renders nested
layouts/outlets, initial and pending loads, successful loader data, recoverable
loader and component errors, and global 404 state as native nodes, then removes
its history subscription on disposal. Compile-time contracts additionally
cover registered route IDs, params, and loader selectors.
Physical Pixel automation additionally proves a blocked system Back leaves the
detail screen mounted before the next allowed Back pops it, route loader data
reaches the native component, and the restored root retains its Solid owner and
Fabric handle. A separate fresh-process phase repeats physical push/system-Back
30 times, requires the exact Java `ScreenStack` and root Solid owner to remain,
balances all 30 detail owners and native nodes, and verifies the link press-to-
async-loader-to-final-commit causal chain on every cycle. Its root loader runs
once initially and once after each Back under TanStack's zero-stale revalidation
policy, while the keyed root component is created only once. The iPhone
single-stack run independently reruns the TanStack route component and retained
preloaded-root owner across process restoration. Its complete physical XCTest
passes a naturally canceled seed gesture, a blocker-held restored gesture, and
the allowed rerun.
Explicit storage restoration, ordered/coalesced persistence, failure
propagation, and owner-bound cleanup are adversarially tested; the full physical
persistence proof is complete on Pixel and iPhone for both bounded single-stack
and native-tabs histories. A deterministic parking proof additionally lowers a
reactive mounted-tree budget, disposes the inactive Solid match owner, preserves
the exact keyed native `Screen`, and remounts content when the budget expands.
The reusable TanStack native memory policy now clamps mounted route owners,
cancels restoration prewarming, clears inactive/preloaded Router matches, and
drops inactive settled snapshots while preserving current route and native
history identity. External data caches such as TanStack Query and historical
preload beyond the physically proven one-entry bound remain release gates. The
owner-bound warning source itself is physically verified on both platforms.

The deterministic suite additionally runs 100 consecutive native-dismiss
cycles. It asserts that every detail owner is created and disposed exactly
once, the root owner and direct native content handle remain stable, the final
host snapshot stays bounded, and a canceled native dismissal does not mutate
history. The physical Android companion runs 30 of those cycles through the
actual `react-native-screens` container and operating-system Back source; it is
an ownership and identity invariant, not a timing benchmark. The canceled
single-stack and selected-tab gestures both pass in the physical iPhone harness;
the selected-tab run additionally proves blocker rejection and release.
