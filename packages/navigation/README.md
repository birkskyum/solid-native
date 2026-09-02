# `@solid-native/navigation`

TanStack Router owns route matching, params, loaders, redirects, and navigation
state. `createTanStackNativeHistory` implements its pinned framework-neutral
history contract over `NativeHistory`, while `createTanStackNativeRouter`
instantiates the routing core with Solid 2-owned signals and memos. Solid 2's
`flush(fn)` is the atomic store-publication boundary; the integration does not
install the published Solid 1 component package or create a competing route
matcher:

```ts
const rootRoute = new TanStackRootRoute();
const homeRoute = new TanStackRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  loader: () => loadHome(),
  component: Home,
});
const routeTree = rootRoute.addChildren([homeRoute]);
const nativeHistory = new NativeHistory({ initialHref: "/" });
const routerHistory = createTanStackNativeHistory(nativeHistory);

const router = createTanStackNativeRouter({
  routeTree,
  history: routerHistory,
  isServer: false,
});

<TanStackNativeRouterProvider router={router}>
  <TanStackNativeMatches />
</TanStackNativeRouterProvider>;
```

The provider owns the history subscription, initial load, and Solid 2 router
publication boundary. `TanStackNativeMatches` renders nested route components
and `TanStackNativeOutlet` boundaries directly into native nodes. Route options
accept native `component`, `pendingComponent`, `errorComponent`, and
`notFoundComponent` functions. Loader failures retry through invalidation;
component failures reset through a Solid 2 `Errored` boundary. Registered-router
typing flows through `useTanStackNativeMatch` and
`useTanStackNativeLoaderData`, including route-ID validation and route-specific
params/loader data. `TanStackNativeRouteView` remains the lower-level explicit
callback projection when an application does not want route option components.
No path uses React or a DOM provider. The factory also disables TanStack core's
browser scroll-reset listener. Native scroll ownership remains local to each
container; `TanStackNativeScrollView` restores a remounted container without
installing a browser-style global scroll registry.

`TanStackNativeLink` turns the registered-router navigation contract into a
real native `Pressable`. Its render state is backed by Solid memos over
TanStack's committed and pending locations, plus the native gesture and the
link's own unsettled navigation request:

```tsx
<TanStackNativeLink
  options={{ to: "/detail/$id", params: { id: item.id } }}
  activeOptions={{ includeSearch: false }}
  preload="intent"
  pressableProps={{
    accessibilityLabel: `Open ${item.title}`,
    testID: `detail-${item.id}`,
  }}
  onNavigationError={(error) => diagnostics.capture(error)}
>
  {(state) => (
    <Text style={{ opacity: state.pressed ? 0.6 : 1 }}>
      {state.isTransitioning ? "Opening…" : item.title}
    </Text>
  )}
</TanStackNativeLink>
```

`pressed`, `isActive`, `isPending`, `isTransitioning`, and `isPreloading` are
getter-backed reactive values, so consumers update only the computations that
read them. `preload="intent"` starts TanStack preloading at native press-in;
`preload="render"` starts after the component's first Solid settlement. When
the prop is omitted, compatible `defaultPreload` router policies apply. A web
`viewport` default deliberately becomes no preloading because the native
component does not invent a DOM observer; applications can select `render`
explicitly. Preload work is deduplicated per link, failures are isolated
through `onPreloadError`, and late completion cannot write into a disposed
Solid owner.

Duplicate presses are ignored until the current navigation settles. The link
owns `accessibilityRole`, `disabled`, and the selected/busy accessibility
state; other native interaction, style, ref, label, and testing props pass
through `pressableProps` reactively. Browser-only `href` and
`reloadDocument` options fail closed. External URLs belong to the platform
linking service, while this component remains an in-application native route
primitive.

With causal telemetry enabled, the press starts a privacy-safe
`navigation.link` task. TanStack's immediate pending publication and its later
loader settlement both re-enter that task, so the final native commit does not
lose the initiating press at an `await` boundary. Programmatic navigation uses
the matching `navigation.programmatic` task. Neither operation records the
destination, params, search state, loader value, or error message. Navigation
is latest-wins per router: a newer request cancels the displaced task, and
provider/root disposal cancels an unfinished task.

The checked-in Pixel 9a Release process suite exercises this public link with
a real 75 ms async detail loader. It requires the Fabric press to cause the
`navigation.link` task, a separately flushed pending frame, and the eventual
normal-priority native commit. The assertion also limits task attributes to
the static runtime resource and task-name keys above. Seed, memory-pressure,
and every one of 30 native churn navigations pass this causal settlement check.
The last promoted signed-iPhone product process physically exercised the same
public link and required its async detail plus the later interrupted sheet route
to retain bounded causal ownership through their final normal-priority commits.
The current shared-entrypoint candidate is held at `native-integrated` until
that complete physical process reruns.

Programmatic navigation uses the same registered route types. A default
`from` keeps relative transitions local to the calling route:

```tsx
const navigate = useTanStackNativeNavigate({ from: "/login" });

await navigate({ to: "../home" });
```

Route-entry authentication should stay in TanStack's routing state machine,
not a component effect. `tanStackRedirect` is the package-level re-export of
the core redirect primitive:

```ts
const protectedRoute = new TanStackRoute({
  getParentRoute: () => rootRoute,
  path: "/protected",
  beforeLoad: ({ context }) => {
    if (!context.session()) {
      throw tanStackRedirect({ to: "/login", replace: true });
    }
  },
});
```

With the native history adapter, `replace: true` removes the protected entry
instead of leaving pre-authentication content behind the system Back action.
The navigate hook also rejects browser-only `href` and `reloadDocument`
options; external destinations continue through the platform linking service.

The Pixel 9a Release product proof combines these contracts rather than testing
them as isolated helpers. An unauthenticated `/protected` launch redirects by
replacement to `/login`; a physical sign-in press begins a slow `/slow` load,
and a second physical press interrupts it with an absolute
`navigate({ to: "/home", replace: true })`. The displaced
`navigation.programmatic` task is canceled, the winning task owns a separately
flushed pending frame and the final normal-priority native commit, and late
loader bookkeeping is causally detached and cannot change route or history.
The retained pending `Screen` becomes `/home` without leaking a third native
container. Android Back then reveals the original login `Screen`, with native
history exactly `[/login, /home]` at index zero and balanced Solid owners at
teardown.

For platform stack presentation, `TanStackNativeStack` couples those match
trees to `NativeStack`'s keyed screen owners. A visited screen keeps its last
settled match snapshot while inactive, so its route components, local Solid
state, and native handles survive a push and are reused on Back. Route
components can read the owning entry, index, and native focus accessor through
`useTanStackNativeScreen`. `renderUnresolved` is deliberately required: a
restored historical entry may not yet have been visited by the single-current-
location TanStack core, so the application must supply a safe native placeholder
until that index receives its first settled match.

Mounted route ownership has a separate opt-in budget. A reactive
`maxMountedRouteTrees` value counts the current route plus the nearest inactive
route trees. Older trees are parked: their Solid component owners and native
content nodes dispose, while their keyed native `Screen` containers, history
entries, and settled TanStack snapshots remain. Raising the budget remounts a
parked tree without navigating or replacing its screen container. Applications
can distinguish this state with `renderParked`; when it is omitted,
`renderUnresolved` is reused.

```tsx
const memoryPolicy = createTanStackNativeMemoryPolicy(platformServices, {
  normalMountedRouteTrees: 8,
  pressuredMountedRouteTrees: 2,
  onMemoryPressure: (warningCount) =>
    Promise.all(applicationCaches.map((cache) => cache.reclaim(warningCount))),
  onMemoryPressureError: (error, warningCount) =>
    diagnostics.capture(error, { warningCount }),
});

<TanStackNativeStack
  history={history}
  memoryPolicy={memoryPolicy}
  renderUnresolved={() => <LoadingScreen />}
  renderParked={() => <ParkedScreen />}
/>;

// Call only after the application has evidence that its working set is safe.
memoryPolicy.acknowledgeRecovery();
```

The current route is always inside any valid budget. A limit of `1` parks the
immediate predecessor too, so gesture-driven stacks should normally retain at
least `2` or intentionally provide a gesture-safe parked presentation. Parking
recreates component-local state when the tree mounts again; it does not rewrite
navigation history. Without a memory policy, it also retains settled TanStack
snapshots and the router's loader cache. The default remains unbounded to
preserve existing state-retention semantics.

Route trees that contain long native content can use
`TanStackNativeScrollView` to keep the last finite native offset alongside the
stable history-entry identity:

```tsx
function FeedRoute() {
  return (
    <TanStackNativeScrollView
      restorationKey="feed"
      onRestorationError={(error, entry) =>
        diagnostics.capture(error, { route: entry.href })
      }
    >
      <Feed />
    </TanStackNativeScrollView>
  );
}
```

Each `TanStackNativeStack` owns a bounded entry-keyed offset registry. Native
scroll events update only that entry's named container. When parking or memory
pressure remounts its route tree, the replacement `ScrollView` receives one
non-animated native `scrollTo` after the screen is focused. A retained native
container is never commanded again merely because its screen blurs and
refocuses. Transient negative UIKit bounce offsets are clamped to zero, invalid
payloads are isolated through `onRestorationError`, and a continuous run of
capture failures reports once until a valid event recovers so a bad native
stream or full registry cannot flood diagnostics at scroll cadence. Entries
removed by a push/reset are pruned. Each entry can retain at most 32 named
containers. This works in memory by default. For process-death restoration, create a
`NativeScrollRestoration` from the versioned stored snapshot and pass it to the
stack's `scrollRestoration` prop. The storage launch helper accepts offsets only
when navigation itself reports `source: "restoration"`; a fresh or deep-link
launch deletes stale offsets so a newly generated screen ID cannot inherit an
older process's position. Storage writes are serialized and coalesced behind
the same vendor-neutral adapter contract as history persistence.

`createTanStackNativeMemoryPolicy(platformServices, options)` owns that warning
subscription on both pinned backends and exposes the count, pressure state, and
reactive route-tree limit. While pressure is active, `TanStackNativeStack`
cancels restoration prewarming, calls the pinned router's public `clearCache`
boundary to abort and evict inactive/preloaded matches, and discards its own
inactive settled snapshots. The current match, keyed native screens, and native
history remain intact. `acknowledgeRecovery()` restores the normal mount budget
without resurrecting discarded loader data. An explicit
`maxMountedRouteTrees` prop still acts as an additional upper bound.

iOS warnings enter through the native AppState event. The generated Android
application forwards actual memory-pressure callback levels through the
package-owned `SolidNativePlatformAndroid` TurboModule while excluding ordinary
`UI_HIDDEN` backgrounding. External caches such as TanStack Query, decoded
images, and inactive AI streams remain application-owned. `onMemoryPressure`
lets them join each warning generation without coupling navigation to a cache
vendor. Its return value is deliberately not awaited, so cache work cannot
delay route-tree reclamation; sync throws and promise rejections are isolated
and delivered to `onMemoryPressureError` when provided.

Applications can opt into bounded restored-stack work with
`preloadRestoredEntries`. After the current route has genuinely resolved, the
stack preloads that many nearest prior entries sequentially and mounts their
route trees inside the existing inactive screen owners. It never changes the
current router/native location, never starts without an explicit positive
bound, and never mounts a late result after disposal. An unselected entry or a
preload that yields no compatible match keeps using `renderUnresolved`;
`shouldPreloadRestoredEntry(entry, index, signal)` can synchronously or
asynchronously skip candidates inside that bound before any loader starts. Its
shared signal aborts as soon as memory pressure begins or the stack owner
disposes. `onPreloadError` observes selection and setup failures that escape
TanStack's own preload result handling. Like the package's other explicit
diagnostic hooks, it is an isolated observer: both synchronous throws and
rejected return values are contained instead of replacing the navigation
failure or safe fallback it observed.

Dedicated Pixel and iPhone Release proofs persist a root/detail stack, tear down
its Solid surface, terminate the package, and restore detail under a new process
ID on an ordinary no-URL launch. With `preloadRestoredEntries: 1`, Android
system Back or an iPhone left-edge interactive pop reveals the resolved prior
root instead of the unresolved fallback while retaining detail as the forward
entry. A third process proves an accepted cold URL clears competing durable
history before persistence begins. Both platforms validate the native stack,
route loaders, ownership accounting, and non-terminating surface teardown.

Retained route owners and ordinary Solid computations stay live while a screen
is covered. This preserves local state and keeps fine-grained application data
semantics unsurprising. Work that should exist only while the operating system
considers a screen focused—camera sessions, sensors, expensive subscriptions,
or timers—can opt into a narrower native lifecycle scope:

```ts
createTanStackNativeScreenFocusEffect(() => {
  const subscription = locationService.watch(updateLocation);
  return () => subscription.remove();
});
```

Promise-based work can use an abort-aware scope instead. Each focus interval
gets a fresh standard `AbortSignal`; blur, Back/reset removal, or parent
disposal aborts it before another interval starts. Rejections that arrive after
that cancellation are stale and ignored, while failures from the active
interval reach `onError` (or the global error path when no handler is supplied):

```ts
createTanStackNativeScreenFocusTask(
  async (signal) => {
    const response = await fetch(detailURL, { signal });
    setDetail(await response.json());
  },
  {
    enabled: () => appState() === "active",
    onError: reportRouteError,
  },
);
```

The optional reactive `enabled` gate intersects with native focus. Closing it
aborts the current interval; reopening it while the screen remains focused
starts a fresh one. This lets backgrounding, connectivity, consent, or power
policy stop work without changing the retained route owner.

Screens can also opt into a single platform accessibility-focus move after
each positive native appear event. The target accessor is resolved only after
the keyed route subtree has mounted, so it can close over an ordinary native
ref without exposing a React tag:

```ts
let heading: NativeNode | undefined;

createTanStackNativeScreenAccessibilityFocus(() => heading);

return <Text ref={(node) => (heading = node)}>Order details</Text>;
```

`createNativeScreenAccessibilityFocus(isFocused, target)` provides the same
policy for a direct `NativeStack` child. Target resolution waits for the
focused Solid subtree to settle, including when an async or restored route's
native Screen appears before its match component and ref. Blur or owner
disposal cancels that pending focus interval. The underlying Fabric operation
uses the mounted shadow node and React Native's cross-platform accessibility
event path; it is distinct from input focus.

The signed Pixel Release process suite observes Android's real
`TYPE_VIEW_FOCUSED` events for both the root heading and the pushed detail
heading, then continues through restoration and 30 native push/Back cycles.
The same navigation entry and Objective-C++ Fabric path compile as a generic
iOS Release/ARM64 application; a VoiceOver-focused physical iPhone assertion
remains a separate device proof.

Setup begins only after a positive native focus event. Cleanup runs on blur,
Back/reset disposal, or parent disposal, and setup can run again when the same
retained owner regains focus. `createNativeScreenFocusEffect(isFocused, setup)`
provides the same synchronous policy for the accessor passed directly by
`NativeStack`; `createNativeScreenFocusTask(isFocused, task, options)` provides
the corresponding abort-aware asynchronous policy.
Solid Native does not globally pause an owner graph: that would hide updates,
change ordinary signal semantics, and offer no safe rule for pending async work.

The physical Pixel Release proof runs this projection end to end: TanStack
loaders publish the root, detail, and deep-link matches; native Back restores
the original root Solid owner and Fabric handle; and a cold deep-link reset
replaces the keyed screen with a newly matched root component. It also requires
exactly one focus-owned work scope across the root/detail transition, reacquires
the retained root's scope on Back, and balances every setup during teardown.
The dedicated process runner additionally performs 30 physical push/system-Back
cycles against one retained Java `ScreenStack`, balances 30 detail owners, and
observes TanStack's expected zero-stale root-loader revalidation without
recreating the keyed root component.
Metro is required to canonicalize Solid's conditional exports so router stores
and native render effects participate in the same reactive graph.

Adapter push, replace, back, forward, and arbitrary traversal publish exactly
one TanStack update. Native deep links and completed platform backs enter from
the other direction and are translated without echoing a second native
transition. TanStack location keys and indices are transport-safe, survive
`NativeHistory` persistence, and are repaired for older restored entries that
did not contain them. Async TanStack blockers cover programmatic traversal and
register with `NativeHistory` while active. Android Back is consumed until the
decision settles; iOS `preventNativeDismiss` holds the screen and reports the
attempt so an allowed result can pop through ordinary Solid reconciliation.
`ignoreBlocker` retains the same explicit bypass semantics as upstream history.
Naturally canceled iOS gestures surface through `onPlatformBackCancel`, while a
blocker-rejected attempt surfaces separately through `onPlatformBackBlocked`.

`NativeStack` is the first Solid-owned presentation primitive. It keeps one
keyed Solid owner per history entry, renders the active history prefix into
native `Screen`/`ScreenStack` containers, acknowledges application transitions
after the native stack finishes, and reconciles platform dismissals without a
router/native feedback loop. A same-screen `replace` is acknowledged
immediately because it updates the retained container without starting a
native transition. Disposing a stack or modal presenter drains any remaining
acknowledgements it owns so a longer-lived history does not retain orphaned
transaction IDs. Its child callback receives accessors so route content can
stay reactive without losing screen identity:

```tsx
const history = new NativeHistory({ initialHref: "/" });

<NativeStack
  history={history}
  defaultScreenOptions={{
    gestureEnabled: true,
    nativeBackButtonDismissalEnabled: true,
    presentation: "push",
  }}
  onScreenFocus={(entry, event) => recordVisibility(entry, event)}
  renderHeader={(entry) => (
    <ScreenHeader title={entry().href === "/" ? "Home" : "Detail"}>
      {entry().href === "/detail" ? (
        <ScreenHeaderSubview type="right">
          <Pressable accessible accessibilityRole="button" onPress={saveDetail}>
            <Text>Save</Text>
          </Pressable>
        </ScreenHeaderSubview>
      ) : null}
    </ScreenHeader>
  )}
>
  {(entry, _index, isFocused) =>
    entry().href === "/" ? (
      <Home isFocused={isFocused} />
    ) : (
      <Detail entry={entry()} isFocused={isFocused} />
    )
  }
</NativeStack>;
```

`defaultScreenOptions` is a reactive navigator-wide layer on both
`NativeStack` and `NativeTabs`. The keyed entry/tab `screenOptions` result is
shallowly applied after those defaults, so matching keys override and an
explicit `undefined` clears an inherited value. Reactive non-structural changes
update the existing native nodes without recreating their Solid owners. A
stack entry captures `presentation` when its keyed owner is created because the
native push/modal/sheet container is structural. Nested values such as styles
and tab special effects remain atomic; compose them explicitly when an
application needs a deeper merge.

Sheet presentation is part of each keyed route's `screenOptions`, so changing a
native detent does not recreate the route component or its Solid owner:

```tsx
<NativeStack
  history={history}
  screenOptions={(entry) =>
    entry.href === "/checkout"
      ? {
          presentation: "sheet",
          sheetAllowedDetents: [0.45, 0.9],
          sheetInitialDetent: "last",
          sheetGrabberVisible: true,
        }
      : { presentation: "push" }
  }
  onScreenSheetDetentChange={(entry, event) =>
    recordDetent(entry.id, event.payload.index, event.payload.isStable)
  }
>
  {(entry, index, isFocused) => (
    <RouteContent entry={entry()} depth={index()} focused={isFocused()} />
  )}
</NativeStack>
```

Detent arrays are transport-safe ascending ratios, with a portable maximum of
three enforced on Android; `"fitToContents"` is also supported. Native events
are runtime-validated before the typed callback receives `{ index, isStable }`.
The Pixel Release proof physically drags a two-detent Material sheet, observes
detent `0` in Solid-owned accessible output, persists the sheet route, and then
restores the same history in a fresh process. The signed iPhone Release proof
presents the same route through `RNSModalScreen`, physically moves the UIKit
grabber from expanded to half-screen, observes stable detent `0` through Solid,
requires the keyed route content to survive the geometry change, and balances
sheet/Fabric teardown.

`NativeModalStack` covers standalone platform modals without pretending they
are native-stack sheets. Entry `0` is retained application content; every later
active `NativeHistory` entry is a keyed `Modal` route. The same history can
therefore use push, Back, restoration, deep links, persistence, and blockers:

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

Modal entries form a real nested portal hierarchy rather than a set of sibling
overlays. That matches Android's Dialog ordering and UIKit's requirement that
each successive sheet be presented from the preceding modal host. Application
pops first commit `visible=false`, retain every affected modal route owner, and
dismiss only the topmost modal. Each next dismissal starts after the preceding
core facade reports its cross-platform `onHidden` boundary; the complete
history transition is acknowledged only after the requested stack depth is
reached. Android reaches that boundary after its Dialog is removed; iOS retains
the Fabric event route through UIKit's asynchronous dismissal callback. Native close requests enter
`requestPlatformBack`, including async blocker arbitration, before mutating
history. While blockers exist, iOS swipe dismissal is disabled so a gesture
cannot outrun the decision. Restored modal entries mount directly without a
synthetic transition, and removed owners release their detached parking trees
instead of surviving until application shutdown.

A dedicated signed iPhone Release proof presents two real UIKit page sheets.
Application Back closes the first only after its hidden boundary; a physical
drag against the second is rejected while a Solid platform blocker is active;
and another physical drag dismisses it after a native button reactively removes
that blocker. React Native's accepted interactive-dismissal `requestClose` is
normalized into one portable dismissal/hidden sequence, producing exactly one
platform pop, two disposed modal owners, a retained application owner, and a
clean Fabric surface stop without terminating the app process.

The third child accessor follows actual native screen lifecycle rather than
merely the current history index. A native `appear` focuses its keyed owner and
reactively blurs the other owners in the same stack; a backend `disappear` also
blurs its owner when supplied. Reading the accessor creates a narrowly scoped
Solid dependency. `onScreenFocus` and `onScreenBlur` expose the corresponding
native synthetic events for analytics, data-refresh, and application lifecycle
policy; some backends omit `disappear` when replacing or covering a screen, so
portable visibility logic should use the accessor. The renderer's opt-in
causal telemetry records native lifecycle input as ordinary
`solid-native.event` operations.

`renderHeader(entry, index, isFocused)` runs once inside each keyed screen
owner and mounts its returned `ScreenHeader` after the route content. Header
props remain reactive when an entry is replaced without changing its stable
screen ID. The facade owns native titles, colors, back-button policy,
shadow/translucency, iOS large-title typography, safe-area top-inset handling,
and custom `back`, `left`, `right`, and `center` subviews. A subview can contain
ordinary Solid Native content and event handlers; no React wrapper or second
component owner participates. iOS headers can additionally declare native
`headerLeftBarButtonItems`/`headerRightBarButtonItems` with buttons, fixed
spacing, resource-safe icons, badges, and bounded nested menus. Only normalized
data and generated IDs cross Fabric; item callbacks stay inside the keyed Solid
owner and run when the discrete native event returns. Android uses the
cross-platform custom subview path because the upstream arrays are iOS-only.
Navigator-wide screen presentation and tab item defaults inherit through
`defaultScreenOptions`; callback-bearing header content remains explicitly
owned by `renderHeader` rather than entering an opaque option merge.

`NativeTabs` is the first deliberately experimental native-tab projection. It
retains one Solid owner per stable tab key and treats the platform's
acknowledged selection as the source of screen visibility. Controlled Solid
state can request a different key without losing the native provenance needed
to reject stale updates. The portable facade accepts one to five tabs because
Android's native `BottomNavigationView` cannot host more:

```tsx
const tabsState = createNativeTabsState({
  tabs: [
    { key: "home", initialHref: "/" },
    { key: "settings", initialHref: "/settings" },
  ],
});

<NativeTabs
  tabs={tabs}
  selectedKey={tabsState.selectedKey()}
  defaultScreenOptions={{ preventNativeSelection: false }}
  screenOptions={(tab) => ({
    title: tab.title,
    icon: {
      android: { type: "drawableResource", name: tab.androidDrawable },
      ios: { type: "sfSymbol", name: tab.sfSymbol },
    },
    tabBarItemAccessibilityLabel: `${tab.title} tab`,
  })}
  onTabSelected={(selection) => tabsState.handleTabSelected(selection)}
>
  {(tab, index, isSelected) => (
    <TabScene tab={tab()} index={index()} isSelected={isSelected} />
  )}
</NativeTabs>;

const settingsHistory = tabsState.history("settings");
tabsState.openDeepLink({
  tabKey: "settings",
  href: "/settings/account",
});
```

Native user selection, controlled rollback, and a stale request can race. The
host therefore acknowledges every accepted selection with a monotonically
increasing provenance. `NativeTabs` keeps that acknowledgement separate from
the last JavaScript request, retries a rejected desired key from the newest
provenance, and does not echo a native selection back as a redundant request.
Replacing or reordering tab metadata with the same keys updates accessors
without recreating scenes or native roots. Signed Pixel and iPhone Release
proofs tap the real Material and UIKit tab bars and preserve a scene-local
signal across two complete tab switches. The underlying `react-native-screens`
4.27.0 release labels its Tabs API stable and has completed Solid Native's
physical-device promotion matrix. `NativeTabs` remains experimental while its
own public contract is hardened. A keyed tab may create its own
`NativeHistory` and `NativeStack`; both proofs push a real nested stack detail,
retain it through both tab switches, then route Android system Back or an iPhone
interactive pop to that selected history without recreating the root.
Android system Back remains a discrete non-Fabric platform event. An iPhone
interactive pop instead arrives through the native `Screen.dismiss` Fabric
event; `NativeStack` retains that default-priority event across its deferred
history settlement, making the same event and route owner the exact causes of
the pop commit, mount, and frame without relabeling it as hardware Back.
`createHardwareBackHandler`
accepts either one history or an accessor that chooses a retained tab's history
at event time. It captures that target across asynchronous blocker arbitration,
so changing tabs while a decision is pending cannot complete against the wrong
stack. That keyed Settings owner also mounts its own TanStack history adapter,
Solid-backed router stores, provider, route loaders, and `TanStackNativeStack`.
Both proofs navigate through the router, render validated loader data, retain
the route component and native screen across tab switches, and return through
the platform-owned Back path. Transport-safe tab icons map compiled Android
drawable names, URI-backed Android raster sources, iOS SF Symbol/XCAsset names,
and URI-backed iOS original/template sources directly to the pinned native
screens. Sources are bounded plain data rather than React Native `require()`
values. Bounded per-platform `standardAppearance` and iOS
`scrollEdgeAppearance` objects configure native state/layout colors,
typography, Android ripple/indicator/label policy, and iOS blur/shadow policy.
The renderer validates and copies these objects; the Fabric boundary processes
their nested color values without exposing arbitrary React Native objects.

The current Pixel phase and last promoted iPhone product-composition phase cold-open a protected Settings
route, replace it with login before denied content can mount, and reuse that
exact native `Screen` for the authenticated root. They then enter an async detail
through `TanStackNativeLink` and requests a slow programmatic sheet route. The
75 ms detail loader produces a separate pending frame beneath one
privacy-bounded `navigation.link` task. While the sheet loader is pending, a
second physical press replaces it with the final native sheet: the displaced
`navigation.programmatic` task is canceled, the winning task causes the final
normal-priority commit, and the late stale settlement is detached from both
tasks and cannot change the exact `[/, /detail, /sheet]` history. The flow
retains the tab host, nested `ScreenStack`, root `Screen`, detail `Screen`, and
scene-local Solid state. Android uses system Back around its Material sheet;
iOS uses the UIKit sheet and physically presses each native header Back control.
Both round-trip Home/Settings, restore detail, reveal the original root, and
finish with exact route, loader, native-node, `Screen`, tab-owner, and surface
lifetime accounting. This verifies auth + tabs + TanStack stack + async data +
interruption + sheet composition without introducing another navigation
coordinator. The changed iOS entrypoint is conservatively `native-integrated`
until its complete signed-device process reruns.

The Pixel product phase now also persists its opaque session through a
Solid-owned `@solid-native/secure-storage` controller before navigation is
allowed to leave login. After that composed flow tears down, the runner
force-stops the process and cold-opens `/protected` in a distinct process. Its
async `beforeLoad` restores the exact Android Keystore-backed credential before
the protected component or loader may publish, with no login surface exposed.
A physical logout removes the credential, proves a subsequent read is absent,
and disposes the route, controller, tab owners, native nodes, and Fabric surface.
The gate requires exact read/write/remove causal-event counts and rejects the
credential key and value anywhere in serialized telemetry. The equivalent
two-process Keychain integration is implemented in the signed-iPhone proof but
remains pending a clean physical rerun.

`createNativeTabsState` supplies the optional higher-level state policy: one
fine-grained selected-key accessor, one retained `NativeHistory` per stable
key, atomic cross-tab live links, and one bounded versioned snapshot. Its
storage helpers serialize and coalesce both selection and child-history
updates, retain the newest snapshot after a failed native write, and retry it
on the next update or explicit flush. At cold launch an accepted URL starts its
target tab directly and discards restoration, preventing stale screens from
appearing behind Back; unhandled URLs still permit restoration. The Pixel and
iPhone Release proofs
invoke their registered URLs after storing obsolete Home-selected state through
the AsyncStorage 3.x adapter, load it with
`createNativeTabsStateFromStorage`, and require the discarded durable value to
be cleared before the resolved Settings detail mounts with no Back entry. Each
replaces that detail with the clean root, creates and pops only fresh history
through the selected-tab platform path, then flushes and decodes the final
multi-history envelope through the same native store. A preceding phase starts
cleanly, selects Settings, pushes its TanStack detail, flushes that two-entry
history, tears down the Solid surface, and stops the app process. An ordinary
no-URL launch in a distinct app process restores the selected detail, preloads
exactly the nearest prior entry,
and returns to the retained root through real Android system Back or an iPhone
left-edge interactive pop. Each runner verifies different process IDs before
performing the cold-link override phase. The iPhone proof also requires the real
two-item `UITabBar`, configured item identifiers and selection state, retained
Solid signal/route state across physical tab switches, and exact owner/surface
teardown. A preceding iPhone process directly verifies both UIKit appearance
objects and drives Home through raster, empty, SF Symbol, racing-raster
rejection, and restored-raster states. The Pixel proof loads one Home icon
through the asynchronous URI/Fresco path and one Settings icon as a compiled
drawable. Opaque React Native asset
objects, application URL parsing/storage selection, and a general preload depth
are not claimed by this surface.

Native URL sources can feed the same history without coupling this package to
React Native's singleton:

```ts
const subscription = Linking.addEventListener(
  "url",
  createDeepLinkHandler(history, {
    resolve: (url) => parseApplicationUrl(url),
  }),
);
```

The handler validates the event, lets the application parse or ignore the URL,
and records accepted destinations as system-originated transitions.

The React Native 0.87 backend currently realizes those semantic components
with `react-native-screens` 4.27.0, the first stable release line that explicitly
supports React Native 0.87. The repository pins and narrowly patches that exact
version for latest-request-wins tab icon ownership; see the
[compatibility strategy](../../docs/react-native-compatibility.md). This is a
backend implementation dependency, not permission for React components to own
the application tree.

The Pixel 9a has passed the exact 4.27.0 six-process stack-restoration suite
and the native-tab restoration, Material appearance, and asynchronous image
ownership suite. The signed iPhone passes its corresponding native-tab
restoration, UIKit appearance, asynchronous image-ownership suite and a focused
auth/link/interruption/stack/sheet composition process. The exercised Android
and iOS screens surfaces are device-verified.

`@solid-native/navigation` declares 4.27.0 as an exact peer and ships both the
reviewed patch and a machine-readable backend contract. The supported CLI
workflow installs both exact packages and materializes the immutable patch in
the application:

```sh
solid-native add navigation
```

The command verifies the shipped contract and patch digest, refuses to replace
a different application-owned file or mapping, merges the following pnpm
configuration, reinstalls the dependency graph, and verifies every reviewed
patched native file before reporting success:

```json
{
  "pnpm": {
    "patchedDependencies": {
      "react-native-screens@4.27.0": "patches/react-native-screens@4.27.0.patch"
    }
  }
}
```

Exact declarations that already resolve through a private registry or local
packed-artifact override are supported idempotently. Use
`solid-native add navigation --dry-run --json` to inspect the complete package,
patch, and reinstall plan without changing the application.

`solid-native doctor` reads the exported backend contract, verifies the patch
asset, exact React Native/screens declarations, and the SHA-256 identity of all
three installed patched native files. Merely installing the right upstream
version is therefore insufficient to produce a passing backend check.

Process-restoration snapshots use a versioned, bounded JSON envelope:

```ts
const persisted = serializeNativeHistorySnapshot(history.snapshot);
const restored = new NativeHistory({
  snapshot: deserializeNativeHistorySnapshot(persisted),
});
```

Deserialization validates the complete shape and transport-safe state before a
history instance is created. The current limits are 512 stack entries and
1,048,576 serialized characters. The application shell can reconcile its
untrusted storage value with the platform's initial URL before first mount:

```ts
const launch = await createNativeHistoryFromStorage({
  storage,
  storageKey: "navigation",
  initialURL: await NativePlatform.getInitialURL(),
  resolveDeepLink: (url) => parseApplicationUrl(url),
});
const scrollLaunch = await createNativeScrollRestorationFromStorage(
  launch.history,
  {
    storage,
    storageKey: "navigation-scroll",
    historySource: launch.source,
  },
);

const persistence = createNativeHistoryPersistence(launch.history, storage, {
  storageKey: "navigation",
});
const scrollPersistence = createNativeScrollRestorationPersistence(
  scrollLaunch.restoration,
  storage,
  { storageKey: "navigation-scroll" },
);

const stack = (
  <TanStackNativeStack
    history={launch.history}
    scrollRestoration={scrollLaunch.restoration}
    renderUnresolved={renderUnresolved}
  />
);
await Promise.all([persistence.flush(), scrollPersistence.flush()]);
```

An accepted initial URL starts a fresh stack, valid storage preserves its
stable screen IDs when no URL wins, and corrupt storage is surfaced through
`launch.restorationError` while the app falls back to its safe initial route.
Corrupt state considered for restoration is removed. A valid snapshot
superseded by an accepted URL is also removed before launch returns, preventing
a crash before persistence setup from resurrecting the discarded stack. The
same serialized-size bound is enforced against candidate in-memory history
before push, replace, reset, or deep-link assignment, so oversized application
state cannot partially mutate navigation and then fail inside a persistence
subscriber.
Ongoing writes are serialized and coalesce behind a slow native operation,
while `flush()` exposes their durability or failure. A failed newest history,
tabs, or scroll snapshot remains pending without entering a hot retry loop; the
next state change or explicit `flush()` retries it, and newer state still
supersedes an older failed value. The observer disposes with its Solid owner.
Scroll snapshots use a separate versioned envelope, retain at most 512 history
entries and 32 named containers per entry, and are capped at 1,048,576
serialized characters. Live captures maintain that complete bound with
incremental per-container accounting, so an oversized capture is rejected
before mutation without serializing the full registry on every native scroll
event. Keeping the keys separate lets applications discard high-volume
presentation state independently while the required `historySource` gate
prevents it from crossing a fresh navigation launch.
An injected `NativeScrollRestoration` remains application-owned; dispose its
storage observer and controller with the application shell after final flush.
Selecting and configuring the actual platform store remains explicit
application-shell policy; `@solid-native/storage/async-storage-3` supplies the
first validated wrapper-free AsyncStorage adapter for an injected generated
native module.

The integration pins `@tanstack/history` 1.162.1 and
`@tanstack/router-core` 1.171.26. The evaluated `@tanstack/solid-router`
1.170.29 release still declares `solid-js ^1.9.10`, so its concrete component
binding remains outside this Solid 2 RC workspace. Router core now exposes a
framework store extension point; the native binding uses that supported seam
for real typed matching, pending loads, loader data, and error match state.
Solid-owned route presentation must not depend on a DOM provider.

Implemented now:

- A contract-checked TanStack `RouterHistory` adapter with restoration-safe
  state indices/keys, forward traversal, programmatic blockers, and exact-once
  native/router notification flow
- A Solid 2-native TanStack Router core using fine-grained signals, derived
  memos, and `flush`-atomic match publication
- An owner-bound native router provider and leaf route-state view covering
  initial/pending load, success, loader error with retry, global not-found, and
  teardown without a DOM
- A registered-router typed `TanStackNativeLink` backed by the real native
  `Pressable`, with fine-grained active/pending/transition state, duplicate
  navigation suppression, touch-intent/render preloading, reactive native
  props, and accessible current-route semantics
- A typed programmatic navigation hook with route-local relative resolution,
  plus native-history-safe TanStack route-entry redirects for authentication
  and onboarding guards
- Nested native route components/outlets, route-local pending/error/not-found
  presentation, Solid component-error recovery, and registered-router typed
  match/loader selectors
- A `TanStackNativeStack` projection that freezes each inactive screen's last
  settled match tree while preserving keyed Solid/native identity
- A reactive mounted-route-tree budget that disposes older Solid match owners
  while preserving keyed native screen containers, navigation history, and
  settled router snapshots
- A TanStack-native `ScrollView` that retains named offsets per stable history
  entry and restores exactly once when parking remounts the native container
- Shared blocker arbitration for Android hardware Back and prevented iOS
  native-dismiss attempts, with errors failing closed
- Stable, serializable native history
- Application push, replace, pop, reset, and system deep-link transitions
- Two-phase completion or cancellation of platform-initiated back transitions
- Native stack presentation with keyed Solid screen ownership
- Standalone `NativeModalStack` routing with keyed owner retention through
  platform dismissal, restoration, and async close blockers
- Native-event-derived per-screen focus accessors and focus/blur callbacks
- Owner-safe focus scopes for opt-in background-work suspension while retained
- Abort-aware focus tasks for canceling asynchronous screen work on blur or
  disposal without leaking stale failures
- Opt-in transition-complete accessibility focus without React refs or tags
- Basic native stack titles, back-button policy, and iOS large-title styling
- Experimental native tabs with keyed Solid owners, controlled provenance
  reconciliation, selection/lifecycle events, transport-safe appearance,
  tab-aware history/restoration, and physical Pixel/iPhone proofs. The reviewed
  appearance gates back device-verified `RNSTabsHostAndroid`,
  `RNSTabsScreenAndroid`, `RNSTabsHostIOS`, and `RNSTabsScreenIOS` catalog
  claims.
- iOS interactive dismiss and Android system-back reconciliation
- A framework-neutral `createHardwareBackHandler` callback for Android's native
  Back event source
- A framework-neutral `createDeepLinkHandler` callback for native URL event
  sources, physically verified through registered iOS and Android app links
- An owner-bound `createNativeNavigationBindings` helper that subscribes both
  platform sources, enters the causal protocol with privacy-safe static event
  names and appropriate priorities, and removes them during Solid cleanup
- Deterministic cold-start precedence and corrupt-restoration fallback through
  `createNativeHistoryFromLaunch`
- Explicit `createNativeHistoryFromStorage` restoration plus owner-bound,
  ordered `createNativeHistoryPersistence` with a flush boundary

Still to provide:

- Promote the stable upstream native-tab pin through Solid Native's complete
  unlocked-device matrix, then graduate the local experimental API
- More aggressive hidden-screen freezing only if adopter workloads show
  focus-scoped native work is insufficient

`createNativeNavigationBindings` names Android hardware Back as
`platform.hardware-back.press` with discrete priority and live URLs as
`platform.url.open` with default priority. Callback payloads never enter
telemetry. A physical Pixel Release run proves a blocker-mediated Back through
its exact user-blocking commit, mount, and frame, and proves a running-process
URL through its normal-priority commit and newly focused screen output. When a
blocker is active, the binding preserves `BackHandler`'s synchronous consumed
boolean and uses a delivery-scoped retention to re-enter only around the later
allow/deny settlement. The Pixel proof exercises a denied first Back and an
allowed second Back; only the allowed event causes the pop commit.

See [the navigation design](../../docs/navigation.md) and
[ADR 0002](../../docs/adr/0002-tanstack-router.md).
