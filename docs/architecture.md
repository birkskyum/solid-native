# Architecture

## Layer model

```text
Application
  Solid components, signals, stores, async graph
        |
Compiler/runtime frontend
  Solid 2 OXC transform + @solidjs/universal
        |
Solid Native renderer
  Native JSX, ownership, refs, events, node graph, mutation collection
        |
Versioned host contract
  Surfaces, commits, events, commands, measurement, capabilities
        |
Backend adapter
  First: React Native lower-half / Fabric
  Possible later: NativeScript or standalone C++/Rust host
        |
Native runtime
  Hermes, JSI, Yoga, native components, UI thread
        |
Platforms
  UIKit and Android native views
```

## Renderer frontend

The compiler should generate Solid universal renderer operations. The renderer maintains a lightweight JavaScript node graph required by `@solidjs/universal` for parent, child, and sibling queries.

The implemented frontend uses the AST-native `@dom-expressions/compiler` OXC
backend with `generate: "universal"` and `@solid-native/renderer` as its module
target. `@solid-native/compiler` owns that configuration, the built-in list,
source-map validation, standalone TypeScript erasure, and its cache identity so
Metro and non-Metro builds cannot drift independently. The upstream compiler
version is pinned exactly while that package is published on an experimental
prerelease line. `@solid-native/metro` runs the shared JSX pass before Metro,
then composes the compiler source map with Metro's output map. It does not
rewrite Babel AST locations: that experiment changed Metro release output
semantics around a Solid 2 `Loading` boundary on Hermes.
Its resolver also canonicalizes ESM and CommonJS dependency edges onto one
browser Solid runtime. This is an application-correctness boundary: bundling
`solid.js` and `solid.cjs` together creates independent signal graphs, so a
router store created through one graph cannot update a renderer subscribed
through the other.

Metro's React Refresh boundary heuristic also mistakes some exported Solid
component functions for React components. The generated configuration forces
application source edits through a complete runtime reload, preventing stale
Solid owners and native resources from surviving a React-only refresh. This is
the safe development baseline; owner-preserving Solid HMR still requires an
explicit compiler/runtime ownership protocol.

OXC replaces `babel-preset-solid` for every Solid application module; there is
no Babel Solid fallback. It does not yet replace React Native's complete
Babel/Metro transform. The latter still
owns React Native syntax, platform constants, module conversion, dependency
collection, HMR, and the selected Hermes transform profile. This separation
lets Solid Native use Solid's deeper OXC compiler today without pretending the
pinned React Native backend has become Babel-free. The standalone native
sandbox uses OXC for both Solid universal compilation and TypeScript erasure,
so it has no Babel dependency at all.

Creating a Solid node does not have to create a platform view immediately. Operations enter a pending transaction associated with a native surface. The transaction is committed at a Solid flush boundary or an explicit synchronous host boundary.

Responsibilities:

- Map intrinsic JSX names to registered native component descriptors
- Preserve reactive property expressions without re-running components
- Normalize styles and event names
- Manage root ownership and cleanup
- Maintain logical parent/child relationships
- Coalesce repeated property writes within one transaction
- Distinguish layout-affecting and paint-only changes when descriptors allow it
- Deliver native events through Solid 2's unowned event boundary while
  retaining the target node's causal owner annotations
- Reject invalid structures such as raw text outside text-capable parents

## Transactional commit model

Fine-grained reactivity and atomic native rendering are complementary:

```text
signal writes
    |
Solid recomputes affected expressions
    |
renderer coalesces native mutations by surface
    |
host backend produces the next shadow-tree state
    |
Yoga runs if layout is dirty
    |
backend mounts one mutation list on the UI thread
```

The first implementation should favor correctness over cleverness. A transaction must have a monotonically increasing sequence number. Late events and measurements must identify the surface and committed sequence they refer to.

Potential synchronous boundaries include imperative measurement, focus, text selection, and platform callbacks that require a committed view. These should be explicit and rare.

## Solid 2 async boundaries and actions

Solid 2 computations can return promises or async iterables directly. A
`Loading` boundary owns the fallback/content transition; the native renderer
must preserve that ownership instead of introducing a second suspense or
scheduling system.

The universal renderer applies some updates in an intentionally unowned effect
phase. Primitive text and sentinel nodes therefore cannot discover their native
surface through the current Solid owner. They remain root-neutral until their
first insertion, when the parent node identifies the correct surface and the
renderer allocates the host identity. This also prevents one global “current
surface” from corrupting concurrent roots.

When an async boundary reveals, removing the fallback, inserting the resolved
content, and reclaiming the detached fallback subtree are part of one native
transaction. Reclamation is child-first so the host never observes deletion of
an attached node. Disposing the owning Solid root prevents a late async result
from allocating or mounting native nodes.

Native event handlers run outside component/computation ownership, matching
Solid 2's event semantics and preserving its development-time protection
against writes from owned computations. The target native node still carries
explicit causal-owner annotations. Handlers invoke Solid 2 actions directly; the renderer does not
introduce a competing mutation primitive. An optimistic write made during a
discrete event inherits the event's user-blocking native priority.
Reconciliation after the action's yielded work settles becomes a separate
normal-priority transaction unless another explicit priority scope causes it.
Returning the action promise from the event handler also lets the renderer
carry the native event's causal identity into that settlement transaction
without introducing global async state.

## Solid server/native client boundary

Solid 2's server/client model is relevant to native even though a native client
does not hydrate HTML. The intended reuse boundary is reactive data rather than
rendered platform UI:

```text
Solid server computation or server function
        |
snapshot / async continuation / action settlement / invalidation
        |
versioned Solid Native transport adapter
        |
local Solid signals, stores, actions, and owners
        |
renderer transaction -> Fabric backend
```

The native bundle constructs and owns its component tree. An authoritative
server value can seed an async computation; streamed store changes can update
the local graph; and a native event can run an optimistic action across the
server boundary. Owner disposal cancels route- or subtree-scoped continuation
work and prevents late results from allocating native nodes.

This path is proposed, not implemented. Solid `2.0.0-rc.3` exposes the desired
async, optimistic, and `ssrSource` semantics, and the upstream `next` branch
has extensible server-function transport and single-flight hooks. Their native
runtime path remains unproven; continuation materialization is internal to the
web serialization layer, and experimental server-component frames currently
materialize DOM/HTML. The runtime must not couple to those private or moving
APIs. A spike will validate native packaging, versioning, authentication,
replay safety, ordering, payload bounds, cancellation, reconnection, and causal
propagation. It will not stream HTML, DOM morphs, or Fabric mutations. See
[ADR 0004](adr/0004-solid-server-native-client.md).

## Fabric-backed backend

The preferred first backend should reuse React Native's lower-level infrastructure where feasible:

- Hermes for JavaScript execution
- JSI for JavaScript/C++ interop
- Yoga for layout
- Fabric shadow nodes, component descriptors, and mounting
- TurboModule infrastructure
- Existing iOS and Android core views
- Codegen schemas and generated native bindings

The backend must not expose raw Fabric types in the Solid public API. It should implement the versioned host contract and own all adaptation to a supported React Native release line.

This is two products with one initial proving path, not a Solid-specific host
that may be generalized later:

1. The framework-neutral host contract and pinned Fabric adapter define native
   nodes, transactions, events, commands, surfaces, resources, and lifecycle.
   They must not import Solid or expose signals, owners, computations, JSX, or
   Solid scheduling concepts. Their conformance suite must be runnable without
   the Solid renderer.
2. The Solid renderer consumes that boundary and maps Solid ownership,
   fine-grained invalidation, JSX insertion, cleanup, and scheduling onto the
   neutral host operations. Solid remains the first and deepest consumer, so it
   drives the requirements and proves that the boundary is useful.

The repository keeps both `packages/host-contract` and
`packages/fabric-host` free of Solid imports. Fabric Host owns JavaScript-side
binding validation, transaction encoding, the `NativeHost` adapter, and the
pinned backend fingerprint. `packages/runtime` depends on both Fabric Host and
the renderer to provide the compatible Solid application bootstrap and
owner-scoped helpers. The native C++/Objective-C++ implementation, podspec, and
Gradle/CMake seam live under Fabric Host as well, so package ownership matches
the dependency boundary. Runtime exports no native build integration of its
own.

This boundary is executable rather than only structural. A dedicated Android
Release entry imports Fabric Host and the host contract directly, mounts a raw
native tree, receives a physical Fabric event, commits an update, observes
commit-to-mount-to-frame lifecycle events, and tears down every node and the
surface. Its source-map verifier forbids Solid, renderer, runtime, core, and
navigation sources. Repository dependency checks separately prevent those
imports from entering the neutral packages.

The neutral package identity and dependency direction are established before
public extraction. Publishing it under an independent identity should happen
only when the contract and Fabric compatibility policy are credible; Vue,
Svelte, or other renderers can then consume the same boundary without a rewrite
or a misleading after-the-fact rebrand. The dependency graph is
`framework renderer -> host contract <- Fabric Host`; the Solid runtime facade
composes the renderer and Fabric Host, and neither neutral package imports it.
Repository CI enforces that direction. The public name is a separate decision; registry,
source-host, and trademark collision checks remain required before a rename.

Fabric Host also publishes its version-specific upstream dependency inventory
as `@solid-native/fabric-host/react-native-boundary`. The checked manifest is
reconstructed from native includes, Android imports, pod dependencies, and
CMake inputs. This does not pretend React Native's Fabric implementation is a
stable public ABI; it turns that deliberate use of internals into a bounded,
reviewable upgrade surface instead of an undocumented copy or a floating
dependency.

Transport-safe `HostValue` data and native resources are different contracts.
Props currently accept bounded primitives, arrays, and records; functions stay
in the renderer event registry. Native objects such as Nitro HybridObjects,
image buffers, streams, and camera preview surfaces must not cross that value
boundary by accidental serialization. The first resource contract therefore
accepts only a non-array JSI object, returns a frozen typed handle marker, caps
each runtime/surface registry at 64 entries, and resolves the exact identity
only when that marker is the complete value of a direct Fabric prop. Solid
ownership supplies deterministic release; dirty handoff and teardown fail.
VisionCamera live preview proves this narrow contract on Android. Broader
resource classes still need individual capability, threading, and invalidation
gates rather than inheriting compatibility from autolinking.

There are two implementation strategies to spike:

1. **Drive Fabric constructs directly:** Build/clone shadow nodes and commit roots without React Fiber.
2. **Extract a smaller host runtime:** Reuse component descriptors, layout, mounting, and modules while replacing React-shaped coordination.

The spike should choose based on upgrade cost, not merely shortest initial implementation.

## Threading

At minimum, distinguish:

- **JavaScript thread:** Solid graph and application code
- **UI thread:** Platform-view creation and mutation
- **Background work:** Build-independent native tasks and optional layout/commit work where supported
- **UI worklet execution:** Bounded graphs currently run inside platform display
  callbacks on the UI thread; a separate runtime remains an option for richer work

No public component API should assume that all host operations are synchronous. Commands and measurements must state their timing guarantees.

## Events

Native events enter through the backend and are routed by surface/node handles. The core event model should define:

- Direct versus bubbling events
- Capture behavior where supported
- Event priority
- Coalescing for continuous events
- Cancellation/default behavior
- Lifetime of native event payloads
- Ownership and cleanup of listeners

The event model should resemble familiar JSX conventions without pretending native controls implement the DOM.

## Core components

The first component set should remain deliberately small:

- View
- Text
- Image
- Pressable
- ScrollView
- TextInput
- ActivityIndicator
- Switch
- Modal; validated native stack sheet presentation/detents through Screen
- Screen/ScreenStack/ScreenHeader/ScreenHeaderSubview
- Experimental TabsHost/TabsScreen facades; navigation owns keyed tab state,
  and each tab owner can retain an independent native stack plus Solid-backed
  TanStack router/provider graph; platform appearance is a bounded nested host
  value rather than an opaque React object
- Fixed-extent VirtualizedList with physically verified iOS/Android Solid-owned
  keyed windowing; Android platform-view reuse is separately validated behind
  an isolated React Native flag, while variable measurement and
  renderer-visible recycling still await production contracts

Each component requires accessibility mappings, platform-specific behavior, commands, events, measurement, and tests. A large list of shallow wrappers is less valuable than a small dependable core.

## Animation

JavaScript-thread signals are insufficient for interactive 60/120 Hz gestures under load. The animation subsystem needs a UI-thread execution model with:

- Shareable reactive values
- Serialized or compiled worklets
- Gesture event inputs
- Derived values and interpolation
- Cancellation and cleanup tied to Solid ownership
- A bridge between ordinary signals and UI-thread values

The portable version-0 foundation uses bounded serialized numeric graphs,
atomic timestamped input frames, deterministic reference evaluation, explicit
graph cancellation, and a coarse Solid-signal bridge whose session is disposed
with its owner. This deliberately avoids treating arbitrary captured
JavaScript closures as transport. Android and iOS share an independent C++
decoder, evaluator, bounded timing/keyframe implementation, analytical spring, and
analytical velocity-decay implementation. `Choreographer` or `CADisplayLink`
invokes it on the UI thread
and the platform applies the complete output frame directly to the graph's
owned Fabric view. Solid can publish an immediate vector, timing intent, a
bounded sequence of timing intents, spring intent, or named per-input velocities;
display callbacks advance and interrupt it without JavaScript frame updates.
The binding is capability-detected as a four-method base plus optional timing,
keyframe, spring, decay, explicit cancellation, and pan extensions and
exposes bounded frame inspection without callbacks into application state.
Timing inspection retains exact frame/interval counts, display-timestamp
bounds, and global interval minimum/maximum/mean, plus nearest-rank
p50/p95/p99 from at most 8,192 retained intervals with explicit dropped-sample
accounting. It observes display-callback cadence rather than compositor
presentation. iOS holds one `CADisplayLink` for the active timing and requests
the display's maximum refresh range; Android reschedules through
`Choreographer`.
Timing sequences carry 1–32 complete targets in one call and are capped at 60
seconds in total. Every stage endpoint is validated before publication. The
native evaluator uses elapsed time to cross late stage boundaries without a
Hermes handoff, retains one cadence-statistics window for the complete
sequence, and begins replacement drivers from the latest evaluated vector.
Springs share the same complete-vector and ownership model. Their closed-form
damped-oscillator result depends on elapsed time rather than callback count,
supports all three damping regimes, preserves overshoot, and snaps to an exact
target only when both rest thresholds or a hard duration cap are reached.
Inspection publishes normalized position and velocity plus independently reset
frame statistics. Replacement drivers start from the latest evaluated native
vector.
Decay shares the same elapsed-time and complete-vector rules. Velocity falls
exponentially from a bounded named input vector. One terminal time is derived
from the maximum starting speed, a positive threshold, and a hard duration cap,
so all axes stop together at the same refresh-rate-independent endpoint.
Inspection publishes elapsed time, maximum current speed, and independently
reset bounded frame statistics. Replacement begins from the latest evaluated
native vector and reaches its exact analytical endpoint with zero terminal
speed.
Explicit cancellation is a synchronous ownership handshake rather than a
blind stop: the native executor linearizes against its display callback,
removes the active driver and queued frame, and returns the last evaluated
complete input vector. The session validates that vector before synchronizing
its local mirror, allowing later named partial work to resume from visible
state. It preserves diagnostics, does not emit a duplicate frame, and does not
destroy the graph or relinquish native pan ownership.
An optional native pan extension binds two declared inputs and finite bounds to
the graph's owned view. Gesture begin snapshots the latest inputs; native
change/end/cancel samples apply bounded translation, evaluate the complete
graph, and mutate the view on the platform UI thread without a Hermes callback.
Attachment transfers the full input vector to native ownership so later
JavaScript updates cannot publish a stale mirror. A synchronized detachment
extension stops native input and release decay, returns the final complete
vector, and restores Solid ownership only after session validation. An optional release
definition transfers native recognizer velocity directly into analytical decay;
the terminal vector is validated before the final touch frame publishes, cancel
does not start inertia, and pan bounds do not clamp the inertial path. Real
Pixel and iPhone drag proofs cover delivery and teardown. Five-second physical
gates additionally cover clean 60 Hz-class Pixel and 120 Hz-class iPhone
display-callback cadence with complete sampled intervals. Both devices also
pass spring and decay interruption, exact settlement, native pan handoff, and
teardown gates. Android additionally physically proves keyframe sequencing and
the release handoff; the matching iOS paths are Release/ARM64 compile-verified
pending the next device rerun. Concurrent independently driven values and
heterogeneous driver chaining remain open.

This should be completed before claiming production readiness.

## Testing and observability

The renderer must be testable without iOS or Android. A deterministic in-memory backend should record commits and events. Native integration tests then verify layout, text, accessibility, gestures, and lifecycle behavior on devices.

Observability is a versioned side channel rather than a monitoring-vendor dependency. The renderer assigns causal operation IDs to surface lifetimes, native events, commits, measurements, and commands. A commit retains every observed cause that contributed to its batch. The default path is disabled, does not inspect application values, and must not let instrumentation failure affect rendering.

The open protocol follows an interaction through the host commit and, on both
React Native 0.87 backends, through the exact shadow-tree revision, observed
UI-thread mount, and first platform frame callback after that mount. Compositor
presentation remains a separate boundary. Dependency-free Sentry and
OpenTelemetry adapters, plus the bounded local timeline, consume the same
records while leaving SDK initialization and transport with the application.
See [causal observability](observability.md).

Performance baselines should include startup time, JS/native memory, initial mount, isolated property updates, structural list updates, text-heavy screens, scroll smoothness, gesture latency, and animation frame stability.
