# ADR 0001: React Native lower half as the first host backend

- Status: Proposed
- Date: 2026-08-19

## Context

A complete native platform needs a JavaScript engine, interop layer, layout, native components, mounting, modules, platform build integration, and years of platform-specific behavior. Reimplementing all of that before validating Solid's rendering model would delay useful evidence.

NativeScript already supports Solid 2 and is valuable prior art, but using it as the only foundation would make the product a NativeScript flavor rather than establish the desired React Native ecosystem and runtime compatibility path.

React Native's lower-level implementation provides Hermes, JSI, Yoga, Fabric, native views, TurboModules, and Codegen under permissive open-source licensing. Fabric is nevertheless shaped around React/Fiber and is not a stable framework-neutral API.

## Decision

Use a pinned React Native release line as the first native backend. Adapt or extract the lower-level runtime behind a Solid-owned, versioned host contract. Do not expose Fabric or React types in application-facing packages.

Use NativeScript as a reference renderer and consider it as a later backend for the same contract.

## Consequences

Benefits:

- Fastest path to real native views and production-proven platform behavior
- Potential compatibility with TurboModules and Fabric Native Components
- Reuse of Hermes, Yoga, build integration, and native core components
- Concrete benchmark comparison against ordinary React Native

Costs:

- Upstream internals may change frequently
- Some Fabric assumptions may be inseparable from Fiber
- Compatibility requires a strict tested version matrix
- The project must retain license notices and conduct trademark/legal review
- A future standalone backend may still be necessary

## Validation

Before accepting this ADR, complete a spike that creates, lays out, commits, mounts, updates, and deletes native nodes without React rendering the application. Then port the adapter across at least one small React Native revision or inspect the changes required well enough to estimate upgrade cost.
