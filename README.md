# Solid Native

Solid Native is an experimental Solid 2 platform for building real iOS and
Android applications. Solid owns the component, reactive, async, and resource
lifetime model; a versioned host contract connects it to native renderers.

The first backend reuses the lower half of React Native—Fabric, Yoga, Hermes,
JSI, native views, and native-module infrastructure—without using React or
Fiber as the application renderer.

> [!WARNING]
> Solid Native is an advanced technical preview, not a published production
> SDK. Package names, versions, licensing, branding, and public APIs remain
> provisional.

## Why this exists

Solid is unusually well matched to a native runtime:

- Fine-grained dependencies can update only the affected native properties.
- Batched writes can still become one coherent native commit.
- Owners provide deterministic lifetimes for views, subscriptions, tasks, and
  hardware resources.
- Solid 2 async state and actions can preserve causality across native events,
  optimistic work, and later settlements.
- Compiled JSX and `@solidjs/universal` provide a direct custom-renderer seam.

The goal is a Solid-first native application platform—not Solid syntax over
React components and not a web application inside a WebView.

Read [Why Solid Native, and why Solid](docs/why-solid-native.md) for the full
technical argument and [the NativeScript comparison](docs/nativescript-comparison.md)
for the closest prior art.

## Architecture

```text
Solid 2 TSX + OXC compiler
            │
            ▼
     @solidjs/universal
            │
            ▼
  @solid-native/renderer
            │
            ▼
  versioned host contract
            │
            ▼
 React Native lower-half backend
 Fabric + Yoga + Hermes + JSI
            │
            ▼
 UIKit / Android native views
```

Solid reactive writes enter a logical transaction. The backend updates the
affected shadow-node paths, runs native layout when required, and mounts one
atomic mutation set on the UI thread.

The framework-neutral Fabric adapter is independently packaged from the Solid
renderer. This keeps React Native version coupling behind an explicit boundary
and leaves room for other framework adapters or native backends.

See [Architecture](docs/architecture.md), the
[host contract](docs/host-contract.md), and
[ADR 0001](docs/adr/0001-first-host-backend.md).

## Current implementation status

The following paths are implemented and covered by deterministic tests. The
strongest integration paths also have checked-in Release-mode proofs that run
on physical Pixel and iPhone hardware.

| Area        | Current capability                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compiler    | Babel-free Solid universal JSX compilation through the pinned OXC backend, with Metro source-map composition                                                  |
| Runtime     | Hermes startup, React-free Fabric surfaces, atomic host transactions, measurement, events, commands, rollback, and deterministic teardown                     |
| Components  | Native View, Text, Pressable, Button, Image, ScrollView, RefreshableScrollView, TextInput, ActivityIndicator, Switch, Modal, safe-area, and status-bar APIs   |
| Navigation  | TanStack Router core with Solid state, native stacks, headers, sheets, tabs, blockers, deep links, persistence, restoration, and platform Back reconciliation |
| Lists       | Fixed and measured virtualized rows, bounded ownership, initial positioning, scroll restoration, and opt-in native-view recycling                             |
| Animation   | Bounded UI-thread worklet graphs with timing, spring, decay, interruption, cancellation, and reduced-motion policy                                            |
| Native APIs | Storage, secure storage, notifications, camera, clipboard, sharing, vibration, localization, images, networking, dialogs, and accessibility                   |
| Tooling     | Project creation, OXC/Metro setup, Codegen, doctor, native builds, logs, source maps, upgrade audits, and release/device evidence                             |
| Diagnostics | Privacy-safe causal tracing from native input through Solid work, Fabric commit, native mount, and next-frame opportunity                                     |

Important remaining gates include choosing a license and final name, publishing
an intentional package set, validating installation on independent machines,
qualifying stable backend upgrades, closing remaining interaction and
accessibility gaps, and proving representative long-running workloads.

The detailed, evidence-linked inventory lives in
[Current project status](docs/project-status.md). Planned acceptance gates live
in the [roadmap](docs/roadmap.md).

## Try it from source

Requirements:

- Node.js `^22.13.0`, `^24.3.0`, or `>=26.0.0`
- pnpm 9.15.0 through Corepack
- Xcode for iOS work
- Android Studio and the Android SDK for Android work

Install and verify the workspace:

```sh
corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm install --frozen-lockfile
pnpm ci:verify
```

Run the deterministic Solid renderer sandbox:

```sh
pnpm --filter @solid-native/native-sandbox start
```

The sandbox compiles Solid TSX with OXC, mounts it through the transactional
renderer, delivers a native-style press, commits the signal update, measures
the result, and tears down the in-memory host.

Inspect the native application without launching a device:

```sh
pnpm build
node packages/cli/dist/bin.js doctor --cwd apps/native-e2e
node packages/cli/dist/bin.js build android --cwd apps/native-e2e --dry-run
node packages/cli/dist/bin.js build ios --cwd apps/native-e2e --dry-run
```

For native setup, generated projects, and physical-device commands, follow
[Getting started from source](docs/getting-started.md). The
[native E2E guide](apps/native-e2e/README.md) documents the signed Release
proofs and their cleanup guarantees.

## Repository map

| Path                                          | Responsibility                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| `packages/host-contract`                      | Framework-neutral surface, node, mutation, event, command, and commit protocol |
| `packages/fabric-host`                        | Pinned React Native/Fabric adapter and native application integration          |
| `packages/compiler`, `packages/metro`         | Shared OXC Solid transform and Metro integration                               |
| `packages/renderer`, `packages/runtime`       | Solid universal renderer, ownership, and application bootstrap                 |
| `packages/core`                               | Public native components and platform state primitives                         |
| `packages/navigation`                         | TanStack Router integration and native presentation                            |
| `packages/animation`                          | Bounded worklet graphs and native UI-thread executors                          |
| `packages/codegen`                            | React-free component and TurboModule bindings from React Native schemas        |
| `packages/observability`, `packages/devtools` | Causal telemetry, diagnostics, and local inspection                            |
| `packages/testing`                            | Deterministic host tests and native integration helpers                        |
| `packages/cli`                                | Project creation, native workflows, diagnostics, and release tooling           |
| `packages/*` service packages                 | Validated, owner-safe access to selected native APIs                           |
| `apps/native-sandbox`                         | Small deterministic renderer exercise                                          |
| `apps/native-e2e`                             | Physical-device application and Release verification harness                   |

## Core decisions

- Solid owns the public component model and application lifetime graph.
- React Native's lower-level runtime is the first backend, not the permanent
  public API contract.
- Native mutations are fine-grained; presentation commits remain atomic.
- TanStack Router supplies routing; Solid Native supplies native navigation
  presentation and platform reconciliation.
- Native-module and native-component compatibility are explicit, versioned
  claims. Arbitrary React component compatibility is not a goal.
- Performance and compatibility claims require representative device evidence.

## Documentation

- [Getting started](docs/getting-started.md)
- [Project status](docs/project-status.md)
- [Vision and boundaries](docs/vision.md)
- [Architecture](docs/architecture.md)
- [Host contract](docs/host-contract.md)
- [Fabric boundary and compatibility](docs/react-native-compatibility.md)
- [Navigation](docs/navigation.md)
- [Causal observability](docs/observability.md)
- [Developer platform](docs/developer-platform.md)
- [Benchmark methodology](docs/benchmarks.md)
- [Package publication readiness](docs/package-publication.md)
- [Roadmap](docs/roadmap.md)
- [Risks and open questions](docs/risks-and-open-questions.md)
- [Architecture decisions](docs/adr/README.md)

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a change. Keep platform
boundaries explicit, add deterministic coverage for new contracts, and avoid
claiming physical behavior without a corresponding device proof.

Do not publish packages from this repository until the project has selected a
license, verified naming and trademarks, and replaced provisional contracts
with reviewed public APIs.
