# Host contract

The host contract separates renderer-facing semantics from any specific
framework or native backend. Its first TypeScript draft lives in
`packages/host-contract`; `NativeHost` is the neutral interface implemented by
both the in-memory test backend and Fabric Host.

## Design goals

- Versioned and capability-driven
- Independent of React, Fiber, and raw Fabric types
- Supports multiple application surfaces
- Collects fine-grained changes into atomic commits
- Represents direct events and native commands
- Allows asynchronous hosts without making every call asynchronous
- Provides enough information for deterministic testing and replay

## Node model

The renderer owns logical JavaScript nodes. The backend owns platform/shadow nodes addressed by opaque numeric handles. Handles are scoped to a surface and are never application-facing refs.

Application refs should expose a controlled `NativeElementRef` API for focus, blur, measure, and descriptor-specific commands.

## Mutation model

The initial mutation vocabulary contains:

- Create element
- Create text
- Update properties
- Update text
- Replace a node's semantic event-listener set
- Insert/move child
- Remove child
- Delete node
- Dispatch command

Transactions carry a surface, sequence number, priority, ordered mutations,
and optional opaque causal context. Repeated updates to the same property
should be coalesced before crossing the host boundary. Causal operation IDs are
process-local correlation values, limited to 128 characters, and must never
contain application data.

Creation and deletion are separate from insertion and removal. This distinction is important for native screen containers, recycling, and backends whose shadow nodes can outlive a mounted view.

## Values

Only transport-safe property values belong in commits. Functions remain in the renderer's event/command registry. A sorted, unique set of semantic event names crosses the boundary whenever a node starts or stops observing an event, allowing the backend to enable only the native emitters it needs. Large binary data, images, native objects, and streams need resource handles rather than accidental serialization.

The React Native 0.87 runtime implements the first deliberately narrow resource
handle: a private registry retains one exact non-array JSI object, while the
transaction carries a frozen `{handle, kind}` marker. The marker is valid only
as the complete value of a direct native prop and is resolved while constructing
RawProps; it is ordinary transport-safe data everywhere else. Registry capacity,
kind syntax, owner cleanup, surface scope, and teardown leaks are bounded and
validated. This does not make arbitrary nested native objects part of
`HostValue`, and other backends or resource classes still require explicit
capability contracts.

## Events

Events identify:

- Surface and target node
- Event name
- Commit sequence observed by native code
- Timestamp
- Priority
- Whether the event can bubble or be coalesced
- Transport-safe payload

The renderer resolves registered callbacks and runs them inside the appropriate Solid owner and scheduling priority.

## Commit lifecycle

Synchronous commit acceptance and platform mounting are distinct states.
`HostCommitResult.mounted` currently means that a transaction entered the
backend mounting pipeline; a structural backend may additionally return the
exact revision it created as `hostRevision`.

A backend with the `commitMountEvents` capability can publish a later
`commit-mounted` lifecycle event containing the surface, commit sequence, exact
host revision, wall-clock ingress/completion timestamps, monotonic mount
duration, and the commit's optional causal context. It can then publish
`commit-frame` at the first platform display callback after that mount, with
commit-to-frame and mount-to-frame durations. This is a next-vsync observation:
it proves the revision was mounted before a frame opportunity, not that the OS
compositor presented particular pixels. A command may advance a surface
sequence without creating a structural revision, so it must not emit synthetic
mount or frame events.

## Measurements and commands

Measurement can require the latest transaction to be mounted. The public API should distinguish:

- Reading the most recently committed measurement
- Awaiting measurement after pending commits
- Forcing a synchronous flush where a platform API permits it

The renderer checks surface liveness after the pending commit and again after
the host read. Teardown waits for a host measurement that already started
before deleting nodes or destroying the surface, but rejects its now-stale
result to application code. A measurement that is still waiting on structural
work when teardown begins never enters the host.

Native commands should be declared by component descriptors and validated by
codegen rather than being arbitrary string calls in application code. The
renderer revalidates the surface immediately before a command transaction:
disposal wins a race with pending structural work, rejects the command, and
continues surface cleanup without sending work to a retired node handle.

Application and root disposal are single-flight operations. Repeated callers
receive the same promise and therefore cannot mistake an in-progress native
surface stop for completed teardown; a stop failure is likewise shared rather
than silently converted to success for later callers.

## Capabilities and compatibility

Backends report capabilities such as synchronous measurement, bubbling events,
commit-mount events, UI worklets, native screens, view recycling, and supported
schema versions. Feature packages must fail clearly when a capability is
unavailable.

`viewRecycling` specifically means that the host exposes a renderer-visible
reusable-node contract. It does not describe an implementation detail below
the mutation boundary. Fabric can satisfy a `delete-node` followed by a later
`create-element` with a reset and pooled platform view while the renderer still
owns two distinct logical handles. React Native 0.87 does this by default in
the iOS component-view registry; Android has reset-aware, per-surface View/Text
pools behind its off-by-default master feature flag. The native Fabric adapter
therefore continues to report `viewRecycling: false` until Solid Native defines
and tests reusable logical identities rather than inferring them from platform
object reuse.

The core list's opt-in `recycleRowViews` policy does not change that capability.
It is owned above the host boundary: the renderer deliberately keeps a bounded
row-wrapper handle alive, disposes the old keyed content owner, and mounts the
new keyed owner into that wrapper. This produces an observable reusable list
cell without claiming that arbitrary create/delete mutations share a platform
object or that the backend exposes a generic node pool.

Every host also reports a stable platform identifier. This is separate from
optional capabilities: it lets a portable facade normalize a lifecycle that is
intrinsically different on Android and iOS without reaching through the host to
a backend-specific `Platform` module.

The contract version is separate from package versions and React Native
versions. Version 1 adds the required host/native-binding platform identity. A
backend declares a compatible contract range.
