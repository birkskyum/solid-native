# ADR 0002: TanStack Router owns routing

- Status: Accepted
- Date: 2026-08-19

## Context

TanStack Router already provides typed route trees, parameters, search state,
loaders, redirects, and navigation state. Native applications additionally
need platform screen containers, gestures, transitions, back handling, deep
links, and process restoration. The evaluated `@tanstack/solid-router`
1.170.29 release still declares a Solid 1 peer range. Its
`@tanstack/history` boundary is framework-neutral, and `@tanstack/router-core`
1.171.26 now exposes a supported framework-store extension point.

## Decision

Use TanStack Router as the routing engine. Pin `@tanstack/history` 1.162.1 and
adapt it to `NativeHistory`. Pin `@tanstack/router-core` 1.171.26 and supply its
store extension point with Solid 2 signals, memos, and `flush` batching. Keep
the incompatible Solid 1 component package outside the runtime while building
native presentation over core matches and transitions: screens, stacks, tabs,
modals, and platform-driven back actions. Own the core subscription and first
load in a Solid 2 provider, render match states through native-node callbacks,
and keep browser scroll restoration disabled at this native boundary.

Do not create a competing Solid Native router.

## Consequences

- Application routing benefits from the existing TanStack ecosystem.
- Solid Native work focuses on genuinely native presentation and synchronization.
- TanStack match and loader state participates directly in the Solid 2 graph.
- The adapter must handle feedback loops and canceled interactive transitions.
- React Native router instances must explicitly use `isServer: false` because
  a native client has no `document`.
- Web and native applications can potentially share route definitions and loader logic.
- The project depends on stable-enough TanStack extension points and must collaborate upstream where necessary.

## Validation

The history adapter deterministically covers exact-once push, replace, backward
and forward traversal, external deep links, completed platform back, restored
location keys, async programmatic blockers, and prevented native-dismiss
arbitration. Router-core tests additionally execute matching, pending async
loaders, loader data, and error match state through actual Solid 2 stores. A
renderer-level provider test covers nested layout/outlet presentation,
initial/pending content, successful loader data, loader and component error
recovery, global not-found presentation, browser-scroll isolation, and owner
teardown. Compile-time tests cover registered route IDs and route-specific
params/loader data. A physical Pixel proves the first real system Back can
remain blocked and the next can complete exactly once. Remaining validation
includes physical route-component presentation through the deterministic
inactive-screen match freezer, historical match prewarming, plus the matching
blocked and naturally canceled physical iPhone gestures.
