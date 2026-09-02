# Vision and boundaries

## Vision

Make Solid a first-class way to build native applications, with the same conceptual integrity it has on the web: components execute to establish a reactive graph, and subsequent state changes update only the native properties and structures that depend on them.

The long-term project is not merely a renderer. It is a coherent platform consisting of a native runtime, component model, native-module system, navigation presentation, animation system, development tooling, testing, and documentation.

## Why Solid 2

Solid 2 is a particularly good foundation because it provides:

- Fine-grained reactive dependencies instead of repeated component execution
- Automatic batching and explicit flush boundaries
- Async values as part of the reactive graph
- Owners that can govern native nodes, subscriptions, resources, and cleanup
- Actions that preserve causality across optimistic and settled native commits
- A compiled JSX model
- `@solidjs/universal` as the supported seam for a custom renderer

Those features can reduce JavaScript-side tree construction and make data dependencies predictable. They do not remove the cost of native layout, text measurement, image decoding, view creation, or cross-thread synchronization. Native performance claims must therefore be proven end to end.

They also make the reactive graph an unusually strong source of causal
observability: the runtime can explain which owner, computation, event, or
async task caused a native commit, then follow it through the exact host
revision and mount boundary. A renderer-neutral server/native adapter could
extend the same graph across authoritative data, async continuations, and
actions without server-rendering platform views. The complete comparative
argument is in
[Why Solid Native, and why Solid](why-solid-native.md).

## What “a full counterpart to React Native” means

Success requires all of the following:

1. **Application model:** Solid components, signals, ownership, async boundaries, and disposal.
2. **Renderer:** Native elements, reactive properties, children, events, refs, portals, and atomic commits.
3. **Native runtime:** JavaScript engine, threads, layout, platform views, surface lifecycle, and native interop.
4. **Core components:** Accessible, typed primitives with predictable cross-platform behavior.
5. **Native ecosystem:** A stable way to create and consume native modules and components.
6. **Application framework:** Typed routing, native navigation, gestures, animation, app lifecycle, and deep links.
7. **Developer experience:** CLI, local development, HMR, source maps, profiling, tests, upgrades, and documentation.
8. **Delivery:** Builds, signing, store submission, updates, team workflows, and observability.

NativeScript with Solid covers meaningful parts of this list and is valuable prior art. It does not by itself establish a Solid-owned component contract, ecosystem, and delivery platform.

## Non-goals

- Rendering Solid applications through React components
- Preserving compatibility with arbitrary React component libraries
- Using a WebView as the default UI host
- Reimplementing TanStack Router
- Promising all React Native packages will work unchanged
- Maintaining permanent, unversioned dependencies on Fabric internals
- Claiming performance improvements without representative device benchmarks

## Product principles

- **Solid semantics first:** Public APIs should feel natural to Solid developers.
- **Native behavior is real behavior:** Accessibility, input, focus, navigation, and platform conventions are not optional polish.
- **Fine-grained but atomic:** Compute small changes, commit coherent frames.
- **Compatibility is layered:** Treat module, native-component, and React-component compatibility as different claims.
- **Backend independence:** Solid code targets a stable host protocol rather than a particular Fabric revision.
- **Open foundation:** The runtime and local toolchain must remain independently usable.
