# `@solid-native/renderer`

This package implements the Solid 2 `@solidjs/universal` integration and the
transactional logical node graph. A `NativeRoot` owns one host surface, hides
opaque node handles from application refs, routes native events through Solid
2's unowned event boundary, and serializes commits for synchronous or
asynchronous hosts.

## Responsibilities

- Implement the universal renderer node operations
- Maintain the logical JavaScript parent/child/sibling graph
- Normalize intrinsic elements, props, styles, refs, and events
- Tie roots, listeners, resources, and native nodes to Solid ownership
- Collect and coalesce mutations per native surface
- Commit on Solid flush boundaries
- Expose explicit synchronous boundaries for supported measurement/focus cases
- Validate text nesting and component descriptors

## Implemented foundation

- Solid 2 RC universal renderer operations and JSX runtime types
- Per-surface logical parent/child/sibling graphs with host-hidden sentinels
- Transport-safe props, style flattening, event-prop separation, and refs
- Coalesced property/text mutations and serialized atomic commits
- Direct, capture, and bubbling event delivery at mapped commit priorities
- Solid 2-compatible unowned event invocation, so ordinary component-local
  signals can be written without weakening owned-computation diagnostics
- Explicit async measurement and command boundaries; commands drain in their
  own transactions after any structural work, even when a native event races
  an asynchronous host commit
- A host-owned `focusAccessibility()` ref operation that targets the current
  Fabric shadow node without exposing React tags or conflating input focus
- Commands revalidate the root immediately before dispatch, so teardown cancels
  work that lost a race with disposal without targeting a retired native handle
  or poisoning surface cleanup
- Measurements revalidate both before and after the host read; teardown waits
  for an already-started asynchronous read before deleting its node, while the
  caller receives no geometry from a disposed surface
- Root flushes wait for commands scheduled by framework-owned reactive effects,
  so controlled native state has a deterministic completion boundary
- Opt-in causal telemetry linking native events and imperative work to commits
- Owner-captured platform-event handlers for non-Fabric native subscriptions
- Owner-bound causal scopes for explicitly linking background settlements to
  the exact Solid/Fabric commit they produce
- Opt-in causal computation boundaries that batch selected reactive native
  output into one operation per commit
- Native commands capture an active named owner/computation synchronously, so
  their later isolated commit retains its Solid cause across async dispatch
- Root commit and telemetry diagnostic observers isolate both synchronous
  throws and rejected return values without replacing the underlying failure
- `mountAsync` makes root construction transactional: after surface acquisition,
  allocation, initial-prop normalization, event/lifecycle subscription, and
  initial Solid render failures are not rejected until native rollback
  completes. The synchronous `mount` API also starts rollback before preserving
  the original render failure, but cannot expose asynchronous cleanup completion
  to its caller. Application disposal always attempts native teardown even when
  a Solid owner or host subscription cleanup throws. Every distinct unsubscribe,
  commit, and surface-stop failure is retained instead of letting an earlier
  cleanup step bypass or hide a later one
- Solid 2 error recovery can retain a previously mounted native subtree after
  its fallback replaces it. Detached host identities are deleted promptly,
  while their logical tree is preserved and rematerialized with fresh handles
  if Solid later retries it; retained event routes are restored with the tree
- Deterministic disposal and surface cleanup

Background promises do not have an implicit global async context. Create a
scope inside a Solid owner, then re-enter it around each synchronous reactive
settlement that should cause native work:

```ts
const refresh = createCausalScope("profile.refresh");

void loadProfile().then(
  (profile) => {
    refresh.run(() => setProfile(profile));
    refresh.finish();
  },
  (error) => refresh.fail(error),
);
```

The scope records its static identifier, never the profile value or error
message. Unfinished scopes are cancelled when their Solid owner is disposed.

When a component must start separate tasks from future callbacks, capture the
root-scoped factory during component setup rather than creating one task eagerly:

```ts
const createTask = useNativeCausalScopeFactory();

const startRefresh = () => {
  const refresh = createTask("profile.refresh");
  void loadProfile().then(
    (profile) => {
      refresh.run(() => setProfile(profile));
      refresh.finish();
    },
    (error) => refresh.fail(error),
  );
};
```

The task takes its parent cause when the factory is invoked, so a later Fabric
press can become its exact cause. Factory-created tasks are rooted and cancelled
when the native root is disposed, but the caller owns earlier finish, failure,
replacement, and cancellation policy.

TurboModule and other platform subscriptions do not enter through Fabric's
node event router. `createCausalPlatformEventHandler` captures the current root
and optional named owner, then gives each delivery a bounded
`solid-native.event` operation with the declared priority:

```ts
const onAppState = createCausalPlatformEventHandler(
  "platform.app-state.change",
  setAppState,
);
```

The operation records its static name, source, priority, and coalescing policy,
never callback arguments. Synchronous Solid writes inherit the event cause;
returned promises follow the same settlement rule as Fabric handlers. Invalid
names and options fail during owner setup rather than after a native callback.

Some native APIs require a synchronous result even when application policy
settles later. `retainCausalPlatformEvent` preserves that result while exposing
one delivery-scoped controller for the later write:

```ts
const onBack = createCausalPlatformEventHandler(
  "platform.hardware-back.press",
  () =>
    retainCausalPlatformEvent(true, (event) => {
      void confirmNavigation().then(
        (allowed) => {
          try {
            event.run(() => setNavigationAllowed(allowed));
            event.finish();
          } catch (error) {
            event.fail(error);
          }
        },
        (error) => event.fail(error),
      );
    }),
  { priority: "discrete" },
);
```

The native caller still receives `true` synchronously. Only writes inside
`event.run` inherit the delivery and its priority. The controller closes once,
records only an error class on failure, and is cancelled if its root is
disposed; no ambient context crosses the promise.

Fabric handlers that must defer their actual mutation use the parallel
`retainCausalNativeEvent`. The handler returns its retained envelope
synchronously; later `event.run` calls preserve the original Fabric event and
its scheduling priority until `finish`, `fail`, or root cancellation. Native
stack dismissal uses this boundary so an iOS interactive pop remains the cause
of the asynchronous history reconciliation instead of becoming an unowned
normal update.

Selected Solid subtrees can also opt into an owner-level causal boundary:

```tsx
<CausalOwner name="profile.screen">
  <ProfileScreen />
</CausalOwner>
```

The boundary starts one `solid-native.owner` operation for that Solid lifetime.
Native commits caused inside the subtree link to it, while sibling work does
not. The boundary records only the validated static name; it does not inspect
signals, props, text, or reactive reads. Nested boundaries preserve their owner
ancestry through causal IDs.

Selected reactive output can be named more narrowly than its owning component:

```tsx
<CausalComputation name="profile.status.output">
  <Text>{status()}</Text>
</CausalComputation>
```

The boundary carries a static annotation through Solid's universal renderer to
the native nodes it creates. Mutations are coalesced into one
`solid-native.computation` operation per pending commit, and the commit retains
the computation alongside any owner, event, or task causes. It does not observe
the signal dependency, status value, text, props, or reactive reads. Nested
computation boundaries retain causal ancestry. If Solid cleans up a conditional
boundary before removing its native children, those teardown mutations inherit
the nearest still-active parent boundary rather than reopening the finished
computation. Its duration covers the native output batch from the first host
mutation until transaction drain; it is not a measurement of the underlying
reactive computation's CPU time.

In a Solid development build, the same static identifier also names the
universal render effects created inside the boundary. Solid's attribution
engine can therefore report a chain such as named signal write → named memo →
`profile.status.output`, while Solid Native independently links
`profile.status.output` → host commit → Fabric mount/frame. The shared name is
a deterministic correlation key, not an exact per-rerun causal token; the two
channels intentionally retain different data and lifetimes.

Measurements dispatched through a node retain its active owner/computation in
addition to any synchronous native-event call-site cause. The geometry read
still crosses the existing flush and disposal barriers, while telemetry records
only sequencing metadata—not coordinates or dimensions.

Commands dispatched through a node capture its active owner/computation before
the renderer crosses the microtask boundary required to isolate native side
effects. The command operation cites that named Solid output, and its
command-only commit cites the command. Telemetry records the static command
name, never its arguments. Priority crosses the same boundary, so commands
requested during discrete native input remain user-blocking after async
dispatch; ordinary programmatic commands retain normal priority. A native
event and a node's owner/computation annotation are independent command causes:
when both exist, neither replaces the other.

Use `mount` for application startup; its returned disposer can be awaited.
Concurrent or later disposal calls return the same promise, so every caller
observes the actual surface-stop completion or the same teardown failure. The
standard `render` export exists for compiler compatibility.

The Fabric direct-shadow-node path is now physical-device-verified in the
runtime package, including JSI transactions, events, measurement, and teardown.
Broader native components and JavaScript-owned surface creation come next. No
Fabric or React types belong in this package.
