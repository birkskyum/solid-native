# NativeScript comparison

Last reviewed: 2026-08-20

There is meaningful overlap between NativeScript and Solid Native, but the
architectural bets are different.

NativeScript already supports Solid through
[`@nativescript-community/solid-js`](https://docs.nativescript.org/configuration/vite),
alongside other framework integrations. Therefore, "build native applications
with Solid" is not, by itself, a differentiated product thesis.

## The distinction

> NativeScript brings the native platform into JavaScript, then lets
> frameworks, including Solid, render through NativeScript.

> Solid Native keeps React Native's lower-level platform and native-module
> ecosystem, removes React and Fiber from the application renderer, and makes
> Solid the renderer and control plane.

| Axis                | NativeScript                                      | Solid Native                                                           |
| ------------------- | ------------------------------------------------- | ---------------------------------------------------------------------- |
| Foundation          | NativeScript-owned runtimes                       | React Native's Hermes, JSI, and Fabric stack                           |
| UI pipeline         | NativeScript Core views                           | Fabric shadow trees, Yoga, and mounting                                |
| Native access       | Direct platform APIs through generated bindings   | TurboModules, Codegen modules, and native components                   |
| Solid's role        | One supported framework integration               | The primary renderer and application model                             |
| Ecosystem bet       | NativeScript plugins and direct native SDK access | The compatible lower layers of the React Native ecosystem              |
| Primary opportunity | Broad, direct native API access                   | Solid semantics, React Native infrastructure, and causal observability |

NativeScript owns its runtime and native-binding system. Its tooling generates
metadata for public native APIs and exposes those APIs to JavaScript. Its UI
layer wraps native controls with NativeScript concepts such as `View`,
`createNativeView`, and native-view lifecycle hooks. See NativeScript's
[runtime repository](https://github.com/NativeScript/NativeScript),
[native-binding architecture](https://github.com/NativeScript/NativeScript/wiki/Deep-dive%3A-How-NativeScript%27s-JS--native-bindings-work),
[custom native-element documentation](https://docs.nativescript.org/guide/create-custom-native-elements),
and [current Android Node-API runtime](https://github.com/NativeScript/napi-android).

Solid Native instead uses Solid computations to produce versioned host
transactions. Its first backend translates those transactions into React
Native Fabric revisions while retaining Fabric, Yoga, Hermes, JSI, and the
native-module infrastructure below React's renderer.

## Where Solid Native can be distinct

The current implementation is building toward several properties that are more
specific than merely rendering Solid components as native views:

- Solid computations produce Fabric revisions without React or Fiber owning
  the application tree.
- A versioned transactional host contract insulates Solid semantics from a
  particular backend implementation.
- Native interoperability targets TurboModules, React Native Codegen, and
  generated Fabric native components.
- Observability can follow an interaction from native input through a Solid
  signal and owner, host commit, exact Fabric revision, UI mount, and the next
  vertical-sync frame opportunity.
- The host contract leaves room for another backend in the future; NativeScript
  itself is useful prior art and could be evaluated as such a backend.

Compatibility must remain a layered claim. Framework-neutral JavaScript,
TurboModules, and some generated native components are plausible compatibility
targets. React component libraries are not expected to work directly because
their JavaScript layer depends on React's ownership and scheduling semantics.
See the [React Native compatibility strategy](react-native-compatibility.md).

## The Solid 2 depth criterion

When the primary goal is to exploit Solid 2 as deeply as possible, the platform
should be understood as a Solid 2 native runtime whose first device backend is
Fabric:

```text
Solid 2
signals + owners + async + actions + scheduling
                         |
                         v
Solid-native semantic layer
transactions + lifecycle + events + observability
                         |
                         v
versioned host contract
                         |
                         v
Fabric backend
layout + mounting + accessibility + native components
```

Fabric should not define the public component model or application semantics.
Solid should own the parts where Solid 2 is distinctive, while Fabric supplies
native machinery that the project should not need to recreate.

The existing NativeScript Solid package describes itself as a custom renderer
and compatibility patches built through DOMiNATIVE and `undom-ng`. It makes
Solid capable of rendering NativeScript views, but it primarily treats Solid as
one frontend integration over NativeScript's platform model. Solid Native uses
Solid's intended custom-platform seam, [`@solidjs/universal`](https://github.com/solidjs/solid/blob/main/packages/solid/universal/README.md),
directly and defines its native semantics above a backend-neutral contract.

Deep Solid 2 integration means preserving the following properties end to end:

- Signal changes produce minimal native mutations without component
  re-execution.
- Solid's microtask batching produces one coherent native transaction.
- Owners govern native nodes, event subscriptions, resources, and cleanup.
- Native events execute inside their originating Solid owner and causal context.
- Async computations and async iterables drive native loading and pending UI.
- Actions, optimistic state, and refresh behavior compose with navigation and
  native interactions.
- Error and loading boundaries preserve stable native subtrees.
- Observability correlates signals, owners, async work, host commits, mounts,
  and frame opportunities.
- App state, sensors, navigation, and native modules expose Solid-native
  reactive primitives.
- Animation and gesture work can extend the reactive model onto the UI thread
  without introducing React's scheduler into the application model.

Solid 2's first-class async graph, deterministic batching, actions, and
optimistic primitives make this substantially more interesting than providing
Solid syntax for native views. See the
[Solid 2 release overview](https://github.com/solidjs/solid/releases).

Deep integration does not require coupling to Solid's private internals. The
renderer should use supported Solid APIs behind a small, versioned adapter.
Depth means that Solid semantics survive through native mounting and disposal;
private coupling would only make upstream upgrades unsafe.

## Strategic boundary

If Solid Native abandons React Native compatibility and begins building its own
universal platform bindings, complete UI abstraction, and plugin ecosystem, it
will converge on NativeScript from a weaker starting position.

The sustainable technical boundary is narrower:

> A Solid-first native application runtime built on React Native's Fabric and
> native-module ecosystem, with fine-grained causal observability.

In architectural terms: Solid Native is the runtime; Fabric is a replaceable
device backend.

NativeScript validates demand for using Solid to create native applications.
It also clarifies the differentiation: retain the valuable lower half of React
Native, replace React's rendering semantics with Solid's reactive graph, and
make the complete native pipeline exceptionally observable.
