# Why Solid Native, and why Solid

## The short thesis

Solid Native should exist if developers want all three of these properties at
once:

1. TypeScript and JSX as the application language.
2. Real platform views and mature iOS and Android infrastructure.
3. A fine-grained reactive application model that owns both local UI work and
   the client side of a coherent server/client data protocol.

Today those goals usually force a compromise. React Native provides a mature
native substrate and ecosystem, but React and Fiber own application rendering.
NativeScript can render native views from Solid, but commits the application to
NativeScript's runtime, view abstraction, and plugin ecosystem. Web containers
preserve web code at the cost of making the DOM and WebView the primary UI
host. Flutter and Compose are coherent native-platform choices, but abandon the
TypeScript/Solid application model.

Solid Native takes a narrower path: make Solid the application runtime and use
the valuable lower half of React Native as the first replaceable device
backend. Fabric, Yoga, Hermes, JSI, Codegen, TurboModules, native views, and
platform tooling can be reused without putting a React component tree between
Solid and the host.

This is not merely “Solid syntax for native views.” It is a Solid-owned native
platform with its own component semantics, lifetime model, transactional host
contract, navigation integration, UI-thread work, testing, server/client seam,
and causal observability.

## Why Solid is unusually well matched

Solid is not universally better than every UI framework. It is an unusually
strong candidate for this architecture because several of its defining
properties map directly onto native-runtime responsibilities.

### Fine-grained dependencies map to native mutations

A Solid component establishes a reactive graph. A later signal write reruns
the computations that read that signal; it does not require repeated component
execution and general tree reconciliation as the normal update mechanism.

That maps naturally to a native host:

```text
signal write
    -> affected Solid computation
    -> property or structural mutation
    -> one coalesced host transaction
    -> Fabric revision
    -> native mount
```

The benefit is architectural before it is a benchmark claim. The renderer can
know which native property or owned subtree became dirty without first
reconstructing an application tree. Fabric still performs the native work that
cannot be wished away: shadow-tree updates, layout, text measurement, view
creation, and mounting.

### Fine-grained computation and atomic presentation are complementary

Native UI cannot safely expose every intermediate reactive write. Solid's
automatic batching and explicit flush boundaries let the application compute
small changes while the renderer publishes one coherent native transaction.

This avoids a false choice between fine-grained reactivity and frame-level
atomicity. Solid determines precisely what changed; the Solid Native host
contract determines when the complete mutation set becomes visible.

### The owner graph is a native resource-lifetime model

Solid owners give computations, cleanups, async work, and child scopes an
explicit lifetime. Solid Native can extend that same lifetime to:

- Native node and event-route identities
- Retained navigation screens and tab histories
- Camera sessions, subscriptions, and opaque native resources
- Gesture and animation graphs running on the UI thread
- Server continuations and in-flight work for an owned route or subtree
- Deferred identity reclamation after the retiring native revision mounts

This is deeper than adapting a component API. One ownership graph can govern
creation, retention, cancellation, native teardown, and late-result rejection
from the server/client boundary through the platform mount boundary.

### Solid 2 makes asynchronous work part of the application graph

Solid 2 computations can expose promises and async iterables through reactive
boundaries. Actions provide a place for optimistic state, declared affected
data, awaited work, and eventual reconciliation. Solid Native can preserve
those semantics instead of adding a second native-specific suspense, task,
cache, or mutation system.

A native press can therefore cause an optimistic Solid write, a user-blocking
host commit, awaited server work, and a later reconciliation commit while
retaining one causal identity. Disposing the owner can also prevent a late
async result from allocating native nodes. The upstream
[async-data](https://github.com/solidjs/solid/blob/next/documentation/solid-2.0/05-async-data.md)
and
[actions/optimistic](https://github.com/solidjs/solid/blob/next/documentation/solid-2.0/06-actions-optimistic.md)
RFCs define these semantics.

### Solid has a direct custom-renderer seam

The compiler can lower TSX to operations supplied by `@solidjs/universal`.
Solid Native uses that seam directly, with a shared OXC transform, rather than
emulating browser globals or translating Solid components into another
framework's components.

The result preserves Solid semantics at the renderer boundary and keeps the
version-specific Fabric implementation behind a small host contract. A future
backend can implement that contract without changing the public component and
ownership model.

## The server/client opportunity

The native opportunity is not server-rendering UIKit or Android views. A native
client should build and own its platform tree locally. The reusable part is the
reactive data protocol above the renderer:

```text
Solid server computations / server functions
        |
typed snapshot + async continuation + invalidation
        |
Solid Native transport adapter
        |
Solid signals + stores + actions + owners
        |
atomic host transaction -> native views
```

If Solid exposes a renderer-neutral transport boundary, a native application
can benefit in several concrete ways:

- An authoritative server snapshot can seed async computations at cold start,
  avoiding a duplicate initial fetch and unnecessary loading transition.
- Promises and bounded async-store traces can stream into the same reactive
  graph; only native properties and rows that read changed data update.
- A native input can invoke the same typed server action as a web input, show
  optimistic state immediately, and then revert or reconcile on settlement.
- Navigation disposal can cancel route-scoped transport work and prevent late
  data from reviving a removed native screen.
- The last committed snapshot can support an explicit offline policy, followed
  by versioned resumption and reconciliation after reconnect.
- Web and native applications can share queries, validation, action rules, and
  server functions while keeping their renderers and device capabilities
  distinct.
- Observability can follow one cause from native input through a server action
  and invalidation back into a Solid computation, Fabric revision, mount, and
  frame opportunity.

Solid 2 already defines per-computation server/client policies such as
`ssrSource: "server" | "hybrid" | "client"`. Its upstream `next` branch also
has extensible server-function transport, result, response, and single-flight
hooks. The missing proof is a supported native packaging/runtime path.
Continuation materialization in `2.0.0-rc.3` remains internal to the web
serialization layer, and the experimental server-component frame materializer
is intentionally DOM/HTML-specific. Solid Native must not depend directly on
`sharedConfig`, browser callback globals, or undocumented serializer details.

The responsible path is a versioned transport adapter and an upstream
renderer-neutral seam. The first experiment should serialize data and
continuations, not HTML and not Fabric mutations. It must prove cancellation,
ordering, bounded payloads, schema mismatch behavior, reconnection, and causal
context before becoming an application API. See
[ADR 0004](adr/0004-solid-server-native-client.md).

This experiment is strategically important beyond mobile: a successful native
adapter would demonstrate that Solid's server/client model is a universal
reactive protocol rather than only an HTML hydration technique.

## A distinctive observability model

Conventional mobile traces can show an input callback, JavaScript task, native
mount, and displayed frame. Solid additionally provides the dependency and
ownership structure that explains why work ran.

With explicit opt-in names and privacy-safe attributes, a causal trace can
connect:

```text
native input
    -> Solid owner / computation / action
    -> optional server function and invalidation
    -> signal-driven mutation
    -> host transaction
    -> exact Fabric revision
    -> platform mount
    -> next frame opportunity
```

That makes the runtime easier to debug locally while preserving an exportable,
vendor-neutral telemetry boundary. See
[causal observability](observability.md).

## Why not another framework?

The relevant question is not which framework wins in the abstract. It is which
framework best expresses a TypeScript, truly native, end-to-end reactive
runtime on top of React Native's lower-level machinery.

| Candidate             | What it already does well                                                   | Why it is less aligned with this exact goal                                                                                                                                                      |
| --------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| React Native          | Largest directly relevant ecosystem and an integrated React/Fabric pipeline | React and Fiber own component execution, scheduling, and reconciliation; replacing that ownership is the point of this project                                                                   |
| NativeScript + Solid  | Proven Solid rendering, direct platform API access, and native views        | Solid is a frontend over NativeScript's runtime and view model; it does not directly capture the Fabric/TurboModule ecosystem bet                                                                |
| Vue or Svelte         | Productive compiler/reactivity models and strong web communities            | Neither supplies this project's combination of Solid ownership, Solid 2 async/actions, hydration policy, and the existing universal-renderer seam; each would define a different platform thesis |
| Flutter               | Consistent cross-platform UI, tooling, and performance                      | Uses Dart and primarily owns rendering through its widget/engine stack rather than reusing platform views and the React Native native-module substrate                                           |
| Compose Multiplatform | Strong Kotlin-native model and platform integration                         | Chooses Kotlin and Compose semantics, not TypeScript, JSX, or the Solid ecosystem                                                                                                                |
| WebView wrappers      | Maximum reuse for DOM applications                                          | The browser remains the UI host, so native components, accessibility, layout, gestures, and module lifetimes are indirect                                                                        |

NativeScript is the closest comparison and useful prior art. Its existence
validates demand, but it also sharpens the niche: retain React Native's lower
half, let Solid own application and server/client semantics, and observe the
complete pipeline. See the detailed
[NativeScript comparison](nativescript-comparison.md).

## How the layers reinforce one another

The renderer becomes more useful as the surrounding layers reinforce one
another:

- A stable Solid-facing host contract contains React Native version churn.
- A stable server/native protocol contains transport and backend churn.
- Physical-device conformance tests turn compatibility claims into evidence.
- A native-module catalog records what works unchanged, through an adapter, or
  only after native changes.
- Runtime and protocol fingerprints make native builds and delivered code/data
  safely compatible.
- Causal telemetry ties source behavior to server work, runtime ABI, native
  symbols, device conditions, commits, updates, and releases.
- Upgrade automation and retained compatibility history reduce operational
  risk for every additional application.

## The honest boundary

Solid is the best candidate only if the objective remains:

> A Solid-first TypeScript native application platform, using true native
> views and React Native's lower-level ecosystem without React owning the
> application renderer, while preserving Solid's end-to-end async model.

If the objective becomes maximum React library compatibility, React Native is
the better choice. If it becomes direct universal exposure of every platform
API, NativeScript may be the shorter path. If it becomes a completely uniform
custom-drawn UI, Flutter is already mature. If native TypeScript is no longer
important, Compose and SwiftUI deserve direct consideration.

Solid Native also carries real risks: Solid 2 and its OXC compiler integration
are currently pinned to release candidates; its server-function path is not yet
proven or packaged for native and its experimental server-component frames are
DOM-specific; Fabric is a versioned boundary with upgrade cost; native packages
still need wrappers and conformance; and performance advantages must be
demonstrated on representative applications rather than inferred from the
reactive model.

Those constraints make the thesis falsifiable. The project should continue
only while device evidence shows that Solid semantics survive native mounting,
the backend remains maintainable across React Native upgrades, a supported
server/native seam can be established, external teams can ship real
applications, and repeated operational problems can be solved without
compromising the framework's semantics.
