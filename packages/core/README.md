# `@solid-native/core`

The first typed public primitives and their backend descriptors are implemented:
View, Text, Image, Pressable, Button, ScrollView, RefreshableScrollView, TextInput,
ActivityIndicator, Switch, Modal, StatusBar, StyleSheet, SafeAreaProvider, SafeAreaView,
Screen, ScreenStack, ScreenHeader, ScreenHeaderSubview, TabsHost, and TabsScreen. A
Solid-owned
`VirtualizedList` composes the verified ScrollView facade rather than
pretending a nonexistent native component is available. It supports one fixed
item extent, caller-supplied exact heterogeneous layouts, or intrinsic native
row measurement seeded by a bounded estimate. Component functions compile
through the universal renderer and contain no React, Fiber, or Fabric types.

`CORE_COMPONENT_DESCRIPTORS` is the provisional descriptor set used by test and
native hosts. Each included primitive has a concrete mapping in the pinned
native backend; future APIs are not advertised as descriptors before that
mapping exists. Accessibility props are forwarded reactively to the
pinned React Native backend, with deterministic snapshot coverage for changing
state. The public contract includes roles, state, range/text values, live
regions, labeling and containment controls, and typed custom accessibility
actions plus iOS accessibility tap, escape, and magic-tap gestures. Each
callback installs a real Fabric listener only when supplied and enters Solid as
a discrete, direct causal input. Signed physical
tests verify headings, images, buttons, scrolling, and single-line/multiline
editors and controlled switches through Android's accessibility node API and
iOS XCTest. Physical custom-action delivery, broader component and
assistive-technology coverage, dynamic type, and locale conformance remain
required before a stable SDK claim.

`Pressable` is a Solid-owned interaction facade rather than a type alias for a
Fabric view. It defaults to an accessible, focusable, non-collapsible native
target. It also defaults `pointerEvents` to `box-only`, while preserving an
explicit caller override, so the stable Pressable view owns an active gesture
even when function children reactively replace their native descendants. It
derives `accessibilityState.disabled`; suppresses press callbacks while disabled;
and exposes fine-grained pressed state to function styles and children.
`onLongPress` is synthesized from the native press-in/release
lifecycle with a configurable `delayLongPress` (500 ms by default) and cancels
on release, disable, or owner disposal. `unstable_pressDelay` delays pressed
feedback and `onPressIn`, while a quick release still delivers an ordered
press-in/press-out pair. Both delayed boundaries re-enter the causal protocol at
discrete priority. A completed long press suppresses the following `onPress`,
matching the React Native wrapper contract without loading React Pressability.
The facade owns retained-region movement as well: it combines `hitSlop` with
`pressRetentionOffset` (using the React Native defaults), releases pressed
feedback when the pointer leaves that rectangle, restores feedback on re-entry,
and suppresses release outside the retained region. `onPressMove` receives each
native move. Page coordinates retain the activation-time target origin for the
whole gesture, avoiding Android's changing local coordinates after a pointer
leaves or re-enters the view. Touch-array and pointer-offset payloads are both
normalized, and a long press is cancelled after more than 10
density-independent pixels of drift even if the pointer remains inside the
retained region.
When a containing `ScrollView` begins a native drag, it synchronously cancels
every active descendant Pressable registered with that scroll owner. The later
native release is suppressed, nested scroll owners chain cancellation upward,
and the next gesture starts cleanly. This keeps UIKit/Android scroll takeover
authoritative without a React responder wrapper.
On Android, `android_ripple` produces React Native's pinned `RippleAndroid`
drawable without importing its Pressable wrapper. Ripple colors are normalized
only at the Fabric backend boundary; foreground/background placement updates
reactively; and hotspot plus pressed-state commands retain the originating
native event's causal context. The prop is omitted completely on iOS.
Target-level `onFocus` and `onBlur` callbacks expose keyboard and assistive
technology focus transitions as default-priority causal events.
`onHoverIn` and `onHoverOut` subscribe directly to the native Fabric pointer
enter/leave path on both backends. `delayHoverIn` and `delayHoverOut` are
non-negative millisecond delays owned by the Solid component: leaving before a
delayed entry cancels it, re-entering before a delayed exit preserves the active
hover interval, and owner disposal cancels both timers. Delayed callbacks open
named causal platform scopes without relying on React Pressability.

```tsx
<Pressable
  disabled={saving()}
  android_ripple={{ color: "#ffffff33", radius: 28, foreground: true }}
  delayHoverIn={80}
  delayHoverOut={120}
  delayLongPress={600}
  hitSlop={8}
  pressRetentionOffset={{ top: 20, right: 20, bottom: 30, left: 20 }}
  unstable_pressDelay={80}
  style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
  onPress={save}
  onHoverIn={showPreview}
  onHoverOut={hidePreview}
  onLongPress={showActions}
>
  {({ pressed }) => <Text>{pressed ? "Release" : "Save"}</Text>}
</Pressable>
```

Hover has deterministic transition/cleanup coverage and both native Release
compile gates; physical pointer-device promotion remains. Retained regions and
Android ripple have deterministic coverage and Release compile gates. A
physical Pixel Release gate also proves diagonal retained-region
exit/re-entry, raw cancellation plus recovery, parent ScrollView takeover,
visible foreground ripple rendering, teardown, and process/package cleanup.
The signed iPhone Release gate verifies diagonal and displaced release
suppression, next-gesture recovery, an ordinary tap, positive native
ScrollView takeover without an accidental press, teardown, and process
cleanup. Same-gesture retained-region re-entry, raw cancellation injection,
physical pointer hover, and broader assistive-technology input remain open on
iOS.

`Button` is a convenience composition over that same Solid-owned `Pressable`
and `Text`; it does not add a native descriptor or load a React component. It
requires a title and activation callback, derives an accessible button label
from the title unless one is supplied, uppercases the visible Android title,
and follows the familiar React Native `color` convention (Android background,
iOS title). Android receives native ripple feedback and iOS receives pressed
opacity. The title, color, disabled state, root style, and text style all remain
fine-grained reactive props. Use `Pressable` directly when an application
needs arbitrary children or a wholly custom interaction contract.

```tsx
<Button
  title={saving() ? "Saving…" : "Save"}
  disabled={saving()}
  color="#2563eb"
  onPress={save}
  style={{ borderRadius: 10 }}
  textStyle={{ fontWeight: "600" }}
/>
```

`StyleSheet` provides the familiar static-style workflow without loading React
Native's JavaScript facade. `create` is an identity operation, so named style
references remain stable. `compose` preserves either reference without an
allocation when the other side is nullish, while `flatten` resolves nested
arrays from left to right and rejects circular arrays deterministically.
`absoluteFill` and `absoluteFillObject` share one frozen portable fill style.

```tsx
const styles = StyleSheet.create({
  card: { backgroundColor: "#dbeafe", borderRadius: 12, padding: 16 },
  selected: { borderColor: "#2563eb", borderWidth: 2 },
});

<View style={StyleSheet.compose(styles.card, selected() && styles.selected)} />;
```

`ScrollView` exposes the pinned Fabric
`maintainVisibleContentPosition={{ minIndexForVisible, autoscrollToTopThreshold }}`
contract directly, with a cloned and integer-bounded configuration. This keeps
an eligible visible child anchored when earlier children are inserted, which is
useful for chat and bidirectional feeds, and can optionally return to the start
when the user was already within a threshold. The prop is reactive and removes
the native policy when set to `undefined`; it uses native iOS and Android
implementations without React's ScrollView wrapper. Reordering anchored
children, occlusion, and transforms retain the pinned native limitations.

Its `ref` receives a frozen `ScrollViewHandle` instead of an untyped native
node. `scrollTo({ x, y, animated })` and `scrollToEnd({ animated })` validate
named options and dispatch causally attributed commands to the backing Fabric
ScrollView. Coordinates are finite and non-negative; omitted axes start at
zero and animation defaults to true. The handle's `nativeNode` remains the
explicit escape hatch for measurement and native-event identity.

```tsx
let viewport!: ScrollViewHandle;

<ScrollView ref={(handle) => (viewport = handle)}>{content()}</ScrollView>;

await viewport.scrollTo({ y: 320, animated: false });
```

`VirtualizedList` accepts the same policy and treats `minIndexForVisible` as a
logical data index. Its keyed window retains an eligible visible row across a
data/layout revision, moves that row to its new exact layout offset, and
translates the policy to the row's current mounted-child index for the native
ScrollView. The platform can therefore adjust its content offset without a
JavaScript `scrollTo` command or a transient unmount of the visible row.

`RefreshableScrollView` owns the cross-platform pull-to-refresh composition
instead of exposing React's incompatible element shapes. It inserts
`PullToRefreshView` beside the content container on iOS and wraps the real
ScrollView with `AndroidSwipeRefreshLayout` on Android, while its `ref` always
receives a handle targeting the backing ScrollView. The vertical-only facade splits Android layout
styles onto the wrapper, keeps visual styles on the inner ScrollView, enables
nested scrolling by default for native gesture arbitration, and normalizes
platform-specific indicator colors, title, size, enablement, and top offset.
`refreshing` is controlled: a native pull that `onRefresh` does not
accept is restored through `setNativeRefreshing`, even when the Solid value did
not change.

```tsx
<RefreshableScrollView
  refreshing={refreshing()}
  colors={["#146ef5", "#16a34a"]}
  tintColor="#146ef5"
  onRefresh={() => {
    setRefreshing(true);
    return reload().finally(() => setRefreshing(false));
  }}
>
  {messages()}
</RefreshableScrollView>
```

Vertical `VirtualizedList` uses the same native composition when both
`refreshing` and `onRefresh` are supplied. Its public handle and imperative
scroll commands continue to target the backing ScrollView, while the bounded
Solid row window remains below the platform refresh control. Indicator props
are shared with `RefreshableScrollView`; horizontal lists reject refresh
configuration at the type and runtime boundaries.

The public tree and state reconciliation have deterministic Android/iOS
coverage and Release compile gates. Physical Pixel and iPhone Release proofs
perform two real pull gestures, require rejected controlled state to stop
through the native command, hold and complete an accepted refresh, preserve
the backing native ScrollView identity, and tear down the surface. Android
additionally seals the exact native wrapper identity.

`createWindowDimensions` exposes independently tracked `width`, `height`,
`scale`, and `fontScale` accessors. It reads through the validated platform
service, follows rotation, resizing, and foldable-window changes, suppresses
structurally identical deliveries, and releases the native listener with its
Solid owner. Native metric payloads remain outside causal telemetry.

```ts
const window = createWindowDimensions(platform);
const isCompact = createMemo(() => window.width() < 600);
```

`createColorScheme` projects the native application appearance into a
fine-grained `"light" | "dark"` accessor without a React hook. It suppresses
duplicate native deliveries, records each actual change as the privacy-safe
`platform.appearance.change` causal input, and removes the native listener with
its Solid owner. The platform service also accepts an explicit light or dark
application override; `"system"` restores the device preference.

```ts
const colorScheme = createColorScheme(platform);
const foreground = createMemo(() =>
  colorScheme() === "dark" ? "#ffffff" : "#111111",
);

platform.setColorSchemeOverride("system");
```

A checked-in Pixel Release gate drives portrait → landscape → portrait and
Android's real system appearance away from and back to its original value. It
independently checks the Activity configuration, display density, and font
scale, then requires all four native changes to pass through the matching named
Solid computation and privacy-safe Fabric commit. The exact bundle keeps only
React Native's imperative `Appearance` and `Dimensions` utilities and rejects
its hooks. A generic iOS Release app compiles the same entrypoint; equivalent
physical iPhone delivery remains open.

`StatusBar` is a zero-output Solid component backed directly by the native
`StatusBarManager` TurboModule. Reactive entries merge by mount order and by
property, so a deeper owner can change only visibility while retaining an
ancestor's icon style. Disposal removes the exact entry and restores the next
active configuration. `barStyle="auto"` follows native appearance only while
an automatic entry is active; duplicate resolved values do not cross the
native boundary.

```tsx
<StatusBar
  source={platform}
  barStyle="auto"
  hidden={fullscreen()}
  animated
  showHideTransition="fade"
/>
```

The generated iOS shell sets
`UIViewControllerBasedStatusBarAppearance=false`, which the pinned native
manager requires. Android ignores the animation arguments its native manager
does not support while preserving the same portable configuration contract.
A checked-in Pixel Release gate physically reads status-bar icon appearance and
visibility across child mount, hide, child disposal, parent restoration, and
terminal application teardown. The exact Release app and instrumentation pass
that gate on a physical Pixel while the bundle policy rejects React-facing
platform facades. A signed physical-iPhone Release gate verifies the required
plist ownership mode, distinguishes dark, light, and absent system glyphs from
screenshots, proves native-press to named-Solid-computation to Fabric-commit
causality for every owner transition, restores the parent entry, and tears down
without terminating the process.

`SafeAreaProvider` and `SafeAreaView` reuse the Codegen native components from
the exactly pinned `react-native-safe-area-context` 5.8.1 dependency. They do
not import its React provider, context, hooks, or component wrappers. The Solid
provider validates, clones, and freezes each native metric delivery, then
publishes independently tracked inset and frame accessors through Solid
context. Without `initialMetrics`, children wait for the first native delivery
so they cannot render against invented zero insets. Supplying bootstrap metrics
allows them to participate in the initial native transaction.

```tsx
function Content() {
  const insets = useSafeAreaInsets();
  const frame = useSafeAreaFrame();

  return (
    <SafeAreaView
      edges={{ top: "maximum", right: "off", bottom: "additive", left: "off" }}
      style={{ minHeight: frame.height() }}
    >
      <Text>Top inset: {insets.top()}</Text>
    </SafeAreaView>
  );
}

<SafeAreaProvider>
  <Content />
</SafeAreaProvider>;
```

An edge can be `off`, `additive`, or `maximum`; an edge array is shorthand for
`additive` on the named edges and `off` elsewhere. `mode="padding"` is the
default, while `mode="margin"` delegates native inset application to margins.
The native dependency is autolinked by ordinary React Native platform tooling
and has compiled into the checked-in Android and iOS Release shells. A
Release-compiled Pixel gate compares actual system/cutout insets with physical
child placement and terminal owner teardown. A signed physical-iPhone gate
independently compares notch/home-indicator metrics with UIKit accessibility
frames, rotates portrait to landscape and back, proves causal native-event to
Solid-computation to Fabric-commit propagation, and stops the surface while the
process stays alive.

`ScreenHeader` configures the platform navigation bar owned by its parent
`Screen`. It covers native titles, colors, back-button policy,
shadow/translucency, iOS large-title typography, and Solid-owned custom back,
left, right, and center slots without mounting a React wrapper. A visible
header consumes the platform top inset by default; the explicit
`disableTopInsetApplication` escape hatch is for nested shells whose ancestor
already owns it. `NativeStack.renderHeader` is the safe composition path: the
config is kept as a direct, non-first child of the keyed native screen, as
required by the pinned `react-native-screens` implementation. Native bar-button
items are also available on iOS through `headerLeftBarButtonItems` and
`headerRightBarButtonItems`: buttons, fixed spacing, SF Symbols/XCAssets,
badges, and bounded nested menus are normalized into plain Fabric data.
Generated positional IDs cross native; `onPress` functions remain inside the
current Solid owner and are recovered when the discrete native event returns.
Android deliberately omits the iOS-only arrays and uses the cross-platform
custom subview slots. The Pixel Release proof physically presses a reactive
right-slot action inside a real, positively sized AppCompat toolbar and
observes its updated accessibility label. The signed iPhone Release proof
presses the real UIKit bar item, opens its native submenu, selects the nested
action, and observes both events through Solid-owned reactive state.

```tsx
<ScreenHeader
  title="Order"
  headerRightBarButtonItems={[
    {
      type: "menu",
      icon: { type: "sfSymbol", name: "ellipsis.circle" },
      menu: {
        items: [
          { type: "action", title: "Archive", onPress: archiveOrder },
          {
            type: "submenu",
            title: "Move",
            items: [{ type: "action", title: "Inbox", onPress: moveToInbox }],
          },
        ],
      },
    },
  ]}
/>
```

`TabsHost` and `TabsScreen` are intentionally low-level facades over the pinned
`react-native-screens` native tabs implementation. That upstream API is marked
experimental and may change without notice, so Solid Native makes the same
status explicit rather than presenting it as a stable core primitive. The
facades currently cover provenance-based selection requests, titles, badges,
accessibility/test labels, selection prevention, repeated-selection effects,
resource-safe Android drawable and URI-backed raster icons, iOS SF
Symbol/XCAsset and URI-backed original/template icons, and lifecycle events.
They also select and validate bounded per-platform standard appearance objects
plus the iOS scroll-edge appearance before transport. URI sources are strings
or plain `{ uri, width?, height?, scale? }` records that are validated, copied,
and frozen before transport; opaque numeric `require()` assets and React Native
objects do not cross the Solid renderer boundary. Android vector resources use
`drawableResource`; the upstream Fresco image-source path decodes raster data.
`@solid-native/navigation` owns keyed Solid screen lifetimes and
controlled-state reconciliation through `NativeTabs`.

`Screen.preventNativeDismiss` exposes the pinned native screen container's
dismissal hold without importing React types. `NativeStack` drives it while a
router blocker exists: iOS reports an attempted dismiss without removing the
screen, and Android system Back is held by the framework-neutral Back handler.
The Pixel device test requires one blocked Back followed by one allowed Back.
`Screen.onGestureCancel` is the separate platform event for a swipe that the
user abandons; `onNativeDismissCancel` means native dismissal was explicitly
prevented.

`createAppState(platformServices)` converts the validated native lifecycle
source into a fine-grained Solid accessor initialized from the platform's real
state. Its AppState subscription belongs to the current Solid owner and is
removed automatically on disposal. Every delivery enters through a private
`platform.app-state.change` causal event before updating Solid. The physical
Pixel application proves that event, a named output computation, and its owner
are the exact causes of the lifecycle commit and following mount/frame. The
event records no lifecycle value. The physical application uses that accessor
instead of retaining and releasing a native listener manually.

`createMemoryWarningCount(platformServices)` owns the platform memory-warning
subscription in the same way and exposes a monotonic, payload-free count. Each
delivery enters through `platform.memory-warning`, so a route or cache policy
can react without retaining a naked native listener or exporting application
state. React Native 0.87 emits this AppState-module event on iOS; its Android
AppState implementation does not provide a matching event, so the generated
Android shell forwards `Application.onTrimMemory` and `onLowMemory` through the
package-owned `SolidNativePlatformAndroid` TurboModule. Ordinary `UI_HIDDEN`
backgrounding is excluded. Both backends reach the same payload-free Solid API.

`createKeyboard(platformServices)` provides the same Solid-owned boundary for
software-keyboard visibility. It exposes fine-grained `visible()` and
`metrics()` accessors plus `dismiss()`, normalizes Android/iOS delivery to one
portable shown/hidden state, suppresses duplicate geometry, and releases both
native listeners with the current owner. Visible metrics are finite screen
coordinates with non-negative dimensions; hidden state never retains stale
geometry. Every native transition enters the causal protocol as the private
`platform.keyboard.visibility` event without exporting its geometry.

```ts
const keyboard = createKeyboard(platformServices);

<Text>{keyboard.visible() ? `Keyboard: ${keyboard.metrics()?.height}` : "Keyboard hidden"}</Text>;
```

`View.onLayout` exposes the validated native layout event without importing
React types. `KeyboardAvoidingView` combines that event with a current Fabric
measurement and `createKeyboard`'s screen-space metrics. It appends a
non-collapsible bottom spacer equal to the view/keyboard intersection, clears
the spacer when the keyboard hides, cancels stale measurements, and releases
all work with the current Solid owner. A horizontally disjoint floating
keyboard does not move content. `keyboardVerticalOffset` moves the effective
keyboard top upward for fixed native headers.

```tsx
const keyboard = createKeyboard(platformServices);

<KeyboardAvoidingView
  keyboard={keyboard}
  keyboardVerticalOffset={headerHeight()}
  style={{ flex: 1, justifyContent: "flex-end" }}
>
  <TextInput submitBehavior="blurAndSubmit" />
</KeyboardAvoidingView>;
```

The measurement is a named `keyboard.avoidance.measurement` causal task. When
telemetry is enabled, the native keyboard event therefore remains connected to
the Fabric measurement and spacer commit without recording keyboard geometry.
Measurement and callback failures can be isolated with `onMeasurementError`;
`onAvoidanceChange` reports distinct applied spacer extents.

`KeyboardAwareScrollView` solves the complementary form problem: keeping the
currently focused native editor visible inside a scrolling form. Every
`TextInput` observes native focus and blur, finds its nearest owning
`KeyboardAwareScrollView`, and asks that owner to measure both the scroll
viewport and field. If the real keyboard covers the field, the owner issues an
absolute vertical `scrollTo` command with optional clearance. It does not reset
the user's scroll position when the keyboard hides.

```tsx
const keyboard = createKeyboard(platformServices);

<KeyboardAwareScrollView
  keyboard={keyboard}
  extraScrollHeight={16}
  keyboardVerticalOffset={headerHeight()}
  onVisibilityError={reportFormVisibilityFailure}
>
  <TextInput accessibilityLabel="Email" inputMode="email" />
  <TextInput accessibilityLabel="Password" secureTextEntry />
</KeyboardAwareScrollView>;
```

Nested scroll forms choose the nearest owner. Focus switches, blur, keyboard
hide, option changes, and owner disposal invalidate older measurements before
they can issue a stale command. Negative iOS bounce offsets are normalized to
zero, floating keyboards that are horizontally disjoint from the field do not
move it, and fields taller than the remaining viewport align their top edge.
`calculateFocusedFieldScrollOffset` exposes the validated geometry calculation
for custom containers and deterministic tests.

The whole measure-to-command sequence is the named
`keyboard.focus.visibility` causal task. That preserves the chain from the
private native focus or keyboard event through both Fabric measurements and the
`scrollTo` command without putting field contents or keyboard geometry into
telemetry. `onFocusedFieldScroll` reports applied destinations;
`onVisibilityError` reports measurement, command, and callback failures while
isolating application diagnostics. Measurement and callback failures remain
local; a rejected host command commit is also retained by the renderer's
root-level commit-failure boundary because native tree state is then unknown.
The checked-in physical Pixel Release profiles use Android's `adjustNothing`
window policy and require actual IME clearance for both initial focus and a
Next-to-Done focus traversal. They also refresh the live IME inset after focus
changes because Android may change keyboard geometry with the editor's return
key configuration.

`TextInputFocusGroup` adds render-order form traversal without adding a native
wrapper. Single-line descendants derive `next` or `done` return keys from the
currently focusable fields, react immediately when `editable` or `readOnly`
changes, and move to the next editor through the native `focus` command after
`submitEditing`. Multiline fields whose submit behavior is `newline` retain
their ordinary newline behavior. An explicit `enterKeyHint` or `returnKeyType`
wins over the derived group label, with `enterKeyHint` taking React Native's
documented precedence when both are supplied. `focusNextOnSubmit={false}` opts
a field out as a traversal source while still allowing it to be a destination.

```tsx
<KeyboardAwareScrollView keyboard={keyboard} extraScrollHeight={16}>
  <TextInputFocusGroup onTraversalError={reportFocusFailure}>
    <TextInput accessibilityLabel="Email" inputMode="email" />
    <TextInput accessibilityLabel="Password" secureTextEntry />
  </TextInputFocusGroup>
</KeyboardAwareScrollView>
```

Nested groups select their nearest owner, unavailable destinations are skipped,
and conditionally inserted fields are ordered from the current logical native
tree rather than their historical creation time. Disposal or a later submit
cancels queued traversal before it can focus a stale node. Every actual move is
an `input.focus.traversal` causal task linking the private submit event to the
Fabric focus command without recording field contents. Application submit
callbacks still run, and `onTraversalError` isolates diagnostic failures while
the renderer retains terminal host-command failure semantics.

`createNativeEventAccessor(emitter, options)` applies the same ownership and
causal semantics to a generated Codegen TurboModule event emitter. Its required
`decode` function is the runtime native-data boundary: malformed values are
reported without updating the signal, while valid values become fine-grained
Solid state. The subscription is removed with its Solid Native owner, cleanup
failures are isolated through `onError`, and callbacks retained by a
misbehaving native module become inert before they can re-enter a disposed
renderer root.

```ts
const changed = createNativeEventAccessor(nativeModule.onChanged, {
  name: "platform.account.changed",
  priority: "discrete",
  decode: decodeAccountChange,
  onError: reportNativeBoundaryError,
});
```

The emitter type is structural, so the generated
`SolidNativeEventEmitter<T>` contract plugs in directly without importing
React Native into portable application code. Event values and decoder errors
are not added to causal telemetry.

The `TextInput` facade always subscribes to the native change event and mirrors
its monotonic `eventCount` into React Native's hidden
`mostRecentEventCount` prop. Controlled Solid values can therefore reconcile
without overwriting newer native keystrokes. Stale change events are ignored,
same-text native echoes still advance the acknowledgement count without
calling the semantic text-change handler twice, and malformed event counts fail at
the semantic boundary instead of corrupting the controlled-input state. Public
`onChangeText` receives the validated current string, so the ordinary Solid
pattern is simply `onChangeText={setValue}`. Applications that need native
event metadata can also use the typed `onChange` callback; both callbacks are
fed by the same validated event and only the raw callback observes a same-text
acknowledgement. Public
`value`/`defaultValue` are translated to Fabric's actual `text` prop, and
`setTextAndSelection` declares React Native's required event-count argument.
The facade also exposes multiline `numberOfLines`, `onContentSizeChange`,
continuous `onScroll`, default-priority `onEndEditing`, and discrete bubbling
`onKeyPress` input, and derives React Native-compatible `submitBehavior`
defaults from `multiline` and the deprecated `blurOnSubmit` input instead of
depending on React Native's React wrapper. Controlled `selection` ranges are
normalized to explicit start/end offsets and validated as non-negative 32-bit
integers. The facade always observes native selection changes, remembers the
last native range, and reconciles changed controlled text or selection through
one event-counted `setTextAndSelection` command. In other words, Solid owns the
synchronization work performed by React Native's React-only
`useTextInputStateSynchronization` hook.

The facade also owns React Native's React-wrapper normalization for production
form semantics. `inputMode` takes precedence over `keyboardType`, including
the platform-specific search keyboard and `none` keyboard/caret behavior;
`enterKeyHint` takes precedence over `returnKeyType`; and `readOnly` takes
precedence over `editable`. Portable `autoComplete` values become Android
autofill hints or iOS `textContentType`, while an explicit iOS
`textContentType` wins. Capitalization, correction, spelling, secure entry,
maximum length, selection, caret/context-menu visibility, password rules, and
platform autofill policy remain direct reactive native props. Font scaling is
enabled unless explicitly disabled, matching React Native's public wrapper.
Android also receives its wrapper defaults for sentence capitalization, an
empty placeholder, and a transparent underline; `selectionColor` supplies the
cursor and selection-handle colors unless either is explicitly overridden
(including with `null`). TextInput styles retain their nested-array precedence
while numeric font weights become native strings and `verticalAlign` becomes
`textAlignVertical`; multiline iOS inputs receive React Native's five-point top
inset only when the caller did not supply padding, vertical padding, or top
padding. These mappings live in the Solid facade so application code never
imports or executes React Native's React-only `TextInput` component.

The `ActivityIndicator` facade likewise owns the behavior normally supplied by
React Native's React wrapper. It defaults to animating, hiding when stopped,
and the small size; centers the platform spinner inside a styleable public
container; and translates `small`, `large`, or numeric sizes into deterministic
20, 36, or caller-selected layout dimensions. Accessibility props, `testID`,
and the public ref stay on the native spinner. The backend selects
`ActivityIndicatorView` on Apple platforms and `AndroidProgressBar` on Android,
including Android's constructor-only progress style and indeterminate defaults.
Signed iPhone and Pixel tests require positive native geometry and the actual
platform accessibility wrapper rather than treating a raw descriptor name as a
portable public API.

The `Switch` facade owns controlled-state restoration instead of depending on
React Native's React wrapper. Native toggles arrive as discrete bubbling
`valueChange` events and call both the semantic boolean `onValueChange`
callback and the lower-level `onChange` event callback. If the public `value`
does not accept the platform's eager toggle, the facade sends an isolated
`setValue` command to restore it; repeated rejected toggles are restored too.
The backend maps the portable control to `AndroidSwitch`/`setNativeValue` or
UIKit `Switch`/`setValue`, translates disabled and tint props, and preserves
the public switch accessibility role and checked state. Signed Pixel and
iPhone tests physically toggle the real native control and require its value to
return to the Solid-controlled state. The Pixel proof also requires the
restoration command to retain native-input and named-output causes plus
user-blocking priority without exporting the boolean payload or command
argument. Its following physical measurement retains the named output without
exporting coordinates or dimensions.

The `Modal` facade owns the cross-platform lifetime that React Native normally
implements in its React wrapper. Public content and accessibility styling live
on an inner full-screen View, while presentation props and the public ref stay
on `ModalHostView`. Android ignores `visible=false`, so after that prop revision
mounts the facade structurally parks the native host to dismiss its Dialog. iOS
does the inverse: it retains the host and its EventEmitter until UIKit's
asynchronous dismissal completion delivers `onDismiss`, then parks it. The
facade also supplies portable defaults, derives `overFullScreen` for transparent
content, and rejects incompatible transparency, system-bar, and swipe-dismissal
combinations. Android additionally requires `onRequestClose`, matching the
native manager's system-Back contract. `onHidden` is the cross-platform Solid
lifecycle boundary after a previously visible host is fully parked: Android
fires it after the false visibility commit and iOS after UIKit's `onDismiss`
completion is mounted. Removing the facade then releases its private detached
parking tree instead of retaining native/logical nodes until root shutdown.
React Native 0.87 reports an accepted interactive iOS page-sheet dismissal
through `requestClose` after UIKit has already removed the sheet, but does not
emit the ordinary Modal host `dismiss` event. The facade normalizes that path
into the same exact-once `onDismiss` and `onHidden` boundary and deduplicates a
late native `dismiss` if a backend supplies both events.
Signed Pixel and iPhone tests present the real platform modal,
close it through system Back or its native button, and require the corresponding
request/completion event in Hermes. The Pixel proof additionally retains the
physical presentation, native show, and system-Back reconciliation as three
separate `modal.lifecycle.output` commit/mount/frame chains.
A separate signed iPhone proof routes two real page-sheet modals through
`NativeModalStack`: application Back closes the first, a physical UIKit drag is
rejected while a Solid blocker is active, and a second physical drag closes the
next sheet after that blocker is reactively removed. It requires one platform
pop, exact owner disposal, retained application content, and non-terminating
Fabric teardown.

Native stack sheets use `Screen presentation="sheet"`, which maps to iOS form
sheets and Android Material bottom sheets without a React wrapper. The public
surface validates ascending ratio detents (or `"fitToContents"`), the initial
and largest-undimmed detent, corner radius, grabber, scrolling expansion,
Android elevation/top-inset/resize policy, and the typed
`onSheetDetentChange` payload. Android rejects more than three detents instead
of silently truncating them. Defaults match the pinned `react-native-screens`
wrapper: one full-height detent, index `0`, always dimmed, system corner radius,
no grabber, scrolling expansion, elevation `24`, constrained top inset, and
native resize animation.

```tsx
<Screen
  presentation="sheet"
  sheetAllowedDetents={[0.45, 0.9]}
  sheetInitialDetent="last"
  sheetGrabberVisible
  onSheetDetentChange={(event) => setDetent(event.payload.index)}
>
  <Checkout />
</Screen>
```

The backend retains `RNSScreen` for Android and selects iOS's required
`RNSModalScreen` descriptor for modal/sheet presentation. A standalone `Sheet`
primitive remains outside the contract; sheets are navigation entries with the
same keyed Solid ownership, native dismissal, and restoration semantics as
other stack screens. Signed physical Pixel and iPhone proofs drag the real
Material/UIKit sheet from the larger `[0.55, 0.92]` detent to stable index `0`,
observe the validated native event through Solid-owned accessible state, retain
the keyed route owner during the geometry change, and balance terminal native
teardown.

The signed physical iPhone and Pixel targets focus the real native editor, type
a value through platform UI automation, verify that a later Solid value
replaces both the platform editor text and visible mirror with fresh native
geometry, place the controlled caret at offset 5, and insert `X` at that exact
position. The proof then restores the controlled value and presses the real
return key to observe a current-value submit followed by native blur.
The same targets then replace that editor with an intrinsically sized
multiline editor, type `Solid`, Return, and `Native`, commit the controlled
two-line value through Solid, and observe positive native content-size growth.
Both native backends report the Return key as `Enter` before the text change.
The editor remains focused and emits neither submit nor blur because its
effective submit behavior is `newline`.

`createNativeComponent<Props>(name)` creates a Solid component for a registered
native implementation, and `createNativeComponentDescriptor(name, options)`
declares the corresponding host capabilities. Names are validated as native
identifiers. The physical-device target uses these helpers with a React Native
Codegen spec without importing or rendering Codegen's React wrapper.

The public API must contain no React, Fiber, or raw Fabric types. Working package names and component names remain provisional until naming and API review.

`CausalOwner`, `CausalComputation`, `createCausalScope`,
`createCausalPlatformEventHandler`, `retainCausalPlatformEvent`, and
`retainCausalNativeEvent` expose the renderer-owned observability boundaries
through the core package. Retained event results preserve either a platform
API's synchronous return or a Fabric handler's original delivery while
explicitly re-entering it around one later settlement. Computation boundaries
name selected reactive native output and never inspect signals, values, props,
callback arguments, or dependency reads.

## VirtualizedList geometry and ownership

`VirtualizedList` mounts only the visible rows plus a bounded number of
whole-row overscan items. Stable keys own each row's Solid lifetime. Rows
that remain in the window keep their owner and native handle across scrolling
or data reordering; rows that leave are disposed, and a later re-entry creates a
fresh owner. `renderItem` receives fine-grained `item()` and `index()` accessors
so a keyed row can move or receive replacement data without remounting.

```tsx
let list: VirtualizedListHandle | undefined;

<>
  <VirtualizedList
    ref={(handle) => (list = handle)}
    data={messages()}
    itemSize={56}
    viewportSize={560}
    overscan={2}
    maintainVisibleContentPosition={{
      minIndexForVisible: 0,
      autoscrollToTopThreshold: 80,
    }}
    keyExtractor={(message) => message.id}
    renderItem={({ item, index }) => (
      <Text>{() => `${index() + 1}. ${item().title}`}</Text>
    )}
  />
  <Pressable
    onPress={() =>
      list?.scrollToKey({ key: selectedMessageId(), viewPosition: 0.5 })
    }
  >
    <Text>Jump to selected message</Text>
  </Pressable>
</>;
```

Use `getItemLayout` instead of `itemSize` when rows have known heterogeneous
geometry:

```tsx
<VirtualizedList
  data={messages()}
  viewportSize={560}
  getItemLayout={(data, index) => ({
    index,
    length: data[index]!.height,
    offset: data[index]!.offset,
  })}
  keyExtractor={(message) => message.id}
  renderItem={({ item }) => <Text>{() => item().title}</Text>}
/>
```

Use `estimatedItemSize` when row extent is content-dependent and is not known
before native layout:

```tsx
<VirtualizedList
  data={messages()}
  viewportSize={560}
  estimatedItemSize={72}
  recycleRowViews
  maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
  keyExtractor={(message) => message.id}
  renderItem={({ item }) => (
    <View style={{ padding: 12 }}>
      <Text>{() => item().title}</Text>
    </View>
  )}
/>
```

Fixed and caller-supplied extents are exact density-independent pixels: the
facade forces the viewport's scroll-axis size and absolutely positions rows in
a content container with the complete logical extent. Exact-layout results must be plain
`{ index, length, offset }` objects for the requested index, with positive
lengths and ordered, non-overlapping offsets; gaps can represent separators.
Applications should precompute offsets with their data so each callback is
constant-time. The implementation validates the full layout once per reactive
data/layout revision, then binary-searches it while scrolling. The fixed `itemSize` mode
keeps constant-time geometry without allocating a per-row layout table. Keys
must be unique, bounded strings and the extractor must be pure. Every content
extent must remain finite; invalid geometry is rejected before a native node is
allocated. `onEndReachedThreshold` is a fraction of one viewport and fires at
most once for a given item-count, last-key, and content extent.

Measured mode positions unmounted rows with the positive
`estimatedItemSize`, leaves each mounted wrapper unconstrained on the scroll
axis, and replaces the estimate after its native `onLayout` reports a positive
intrinsic extent. Measurements follow stable keys through reorder/prepend and
are discarded when the key leaves the data set; a transient zero native extent
keeps the estimate. Only the bounded visible/overscan window installs layout
listeners. Imperative index scrolling uses the best current measured/estimated
geometry, so a distant content-dependent target can refine as its window enters
native layout. Use exact `getItemLayout` when the first command must know every
preceding offset exactly.

`recycleRowViews` is an explicit construction-time performance policy. When
enabled, the list keeps one native wrapper `View` per current window slot and
reassigns a leaving key's wrapper to an entering key instead of deleting and
recreating that wrapper. Retained keys keep their wrapper identity, surplus
slots are reclaimed when the window shrinks, and the pool never grows beyond
the active bounded window. Only the wrapper is reused: the old keyed
`renderItem` owner and all of its children are disposed before a new keyed owner
is mounted inside that slot, so component state and event handlers do not leak
between items. A layout event observed before a measured slot's reassignment
commit is ignored rather than attributed to its new key.

This renderer-owned list policy is separate from
`HostCapabilities.viewRecycling`. That host capability remains false for the
Fabric adapter while React Native's platform pools are opaque below ordinary
create/delete mutations. `recycleRowViews` gives the renderer a concrete,
testable stable handle without claiming generic host-level pooling. A physical
Pixel Release proof retains one exact Java wrapper `View` while it moves from
one measured logical row to another, alongside keyed owner disposal accounting.
A signed iPhone Release proof independently observes the first 40/80/40-point
intrinsic row frames with adjacent edges, evicts row zero through a physical
`UIScrollView` drag, learns 14 row extents, and remains bounded at 12 live owners.
XCTest does not expose trustworthy `UIView` pointer identity, so exact UIKit
wrapper reuse remains a separate promotion gate.

Every `renderItem` scope also receives fine-grained `isVisible()` and
`visibleFraction()` accessors. Visibility is the intersection of that item's
scroll-axis extent with the logical viewport: an overscan row can remain
mounted while reporting `false` and `0`, a partially clipped row reports its
covered fraction, and an item larger than the viewport may never reach `1`.
Native scroll offsets, measured-row corrections, reorder, and keyed prepend
anchoring update these accessors without recreating the row owner. Applications
can consume them in a row-local effect for media playback, impression policy,
or nearby-data preparation without diffing a global array of view tokens.

When `maintainVisibleContentPosition` is present, a data or geometry revision
selects the first still-existing visible key at or after the logical
`minIndexForVisible`. The list keeps that key at the same viewport-relative
position while React Native's native iOS/Android ScrollView applies the actual
offset correction. `autoscrollToTopThreshold` remains native-owned: the keyed
anchor stays mounted until the platform emits its threshold-driven scroll back
to the list. A physical Pixel release proof prepends 50 rows, retains the exact
Solid owner and Android `View` for the visible row, observes the expected
2,800-point offset delta, and measures no screen-coordinate movement. The signed
iPhone proof retains the same keyed Solid owner and accessible row frame across
the same 2,800-point native correction. It does not claim exact UIKit object
identity.

The ref exposes `scrollToOffset`, `scrollToIndex`, `scrollToKey`, and
`scrollToEnd` as serialized promises. Each method first moves the Solid-owned
window to the clamped destination, waits for that structural revision to mount,
and only then sends an isolated native `scrollTo` command. Index and key methods
accept `viewPosition` from start (`0`) through end (`1`) plus a
density-independent `viewOffset`. `scrollToKey` resolves the stable identity
against the latest reactive data only when its queued operation begins, so a
reorder follows the item and a removed key rejects without scrolling another
row. `nativeNode` exposes the backing ScrollView when measurement or native-event
identity is required. Calls queued when the list's Solid owner is disposed
reject without dispatching a command to the retired ScrollView. Index bounds
are likewise checked against the latest reactive data when a queued operation
begins.

`initialScrollIndex` and `initialScrollKey` are mutually exclusive,
construction-time starting positions. The list resolves the target before
allocating its native tree, mounts the target window immediately, and places a
platform `contentOffset` on the first Fabric ScrollView commit. This is not a
post-mount command, so an application opening a long feed does not first paint
the top rows. The target is aligned to the viewport start and clamped so the
final viewport remains filled. Fixed and exact layouts use exact geometry;
measured layouts use the configured estimate until native row measurements
arrive. Later positioning belongs to the serialized ref methods, and changing
an initial-position prop after construction has no effect.

A physical Pixel 9a Release proof starts a 1,000-row fixed list at stable key
`initial-100`. The first JavaScript mount revision contains exactly rows
100–106, Android's live `ScrollView` reports the density-correct 5,000-point
offset (13,125 physical pixels on the tested device), and row zero never enters
the accessibility tree. The proof sends no imperative scroll command, then
physically disposes the surface, balances all seven row owners, and requires the
application process to survive.

The corresponding cleanup-guarded signed iPhone Release run independently
requires rows 100–106, rejects row zero, aligns row 100 with the native
`UIScrollView` viewport start on the first transaction, balances all seven row
owners during physical teardown, and validates the production bundle's single
Solid runtime.

`onStartReachedThreshold` and `onEndReachedThreshold` are fractions of one
viewport. Their callbacks are driven by validated native scroll offsets and
fire at most once for the current edge-content identity. Repeated events at the
same edge are suppressed; changing the first key re-arms `onStartReached`, and
changing the last key re-arms `onEndReached`. This lets bidirectional feeds load
another page and then preserve the visible keyed row with
`maintainVisibleContentPosition`.

The current bounded list intentionally excludes sticky content, multi-column
layout, and general scroll/frame performance claims. Platform-owned
view pooling is a distinct lower layer: iOS Fabric already pools component
views, and an isolated Android React Native 0.87 feature-flag flavor proves
reset-aware View reuse without changing Solid logical handles. The public host
capability remains off until reusable logical identity has its own measured
contract. The in-memory churn gate proves bounded node count and exact
Solid-owner cleanup over repeated window shifts.
A dedicated physical Pixel 9a Release proof injects a real touchscreen swipe
into the native `android.widget.ScrollView`, requires row zero to leave
Android's accessibility tree, and observes 12 or fewer mounted rows for 1,000
logical items. It then physically invokes `scrollToIndex` for row 900, verifies
that the target window mounts before the isolated command, and observes the
exact requested native offset while keeping at most 12 rows alive. A final
physical press disposes the root, balances every row-owner creation with one
cleanup, waits for the native surface to stop, and requires the Android process
to survive.
A dedicated signed iPhone Release proof performs two 70%-viewport touchscreen
drags through the real nested `UIScrollView`, independently counts at most 12
distinct accessible row labels, and exercises the same exact mount,
measurement, row-900 command barrier, owner cleanup, surface-stop, and
non-terminating process invariants. Its one measured drag records Apple's
scrolling/deceleration metric and, on iOS 26, an app-targeted hitch metric. This
is iOS runtime and raw one-shot diagnostic evidence, not a repeated matched
performance claim.
