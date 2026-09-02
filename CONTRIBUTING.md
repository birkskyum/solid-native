# Contributing

Solid Native is in an architecture-validation phase. Early contributions should reduce uncertainty rather than expand the public surface.

## Before writing production code

1. Read the vision, architecture, roadmap, and open questions.
2. Record a consequential or difficult-to-reverse choice as an ADR.
3. Add a measurable acceptance criterion to the relevant roadmap milestone.
4. Keep the Solid-facing API independent of a specific React Native release.

## Working principles

- Prefer small executable spikes over speculative abstractions.
- Keep rendering correctness tests host-independent.
- Treat accessibility, text, input, and cleanup as core behavior.
- Benchmark end-to-end native behavior, not only JavaScript operations.
- Keep React Native compatibility claims explicit: native module, native component, or React component.
- Preserve third-party copyright and license notices.

## Commands

```sh
pnpm run ci:verify
```

This is the hosted pull-request gate and runs formatting, build, type, and
deterministic test checks with the frozen dependency graph. The individual
commands remain useful while iterating:

```sh
pnpm check
pnpm build
pnpm licenses:verify
pnpm packages:verify
pnpm test
pnpm format:check
```

GitHub Actions repeats `pnpm run ci:verify` on Node 22, 24, and 26 with read-only
repository permissions and immutable action revisions. Signed iOS and connected
Android Release tests remain separate physical-device gates; do not infer native
compatibility from the hosted JavaScript job.

`packages:verify` creates real private tarballs in an isolated temporary
directory, checks every export and executable against the packlist, requires
the runtime's native backend sources, confirms pnpm rewrote workspace dependency
protocols, enforces the supported Node toolchain range, and prevents packages
that execute Solid code from installing a second reactive runtime. It then
installs all tarballs into an isolated offline consumer and imports every public
entry point before removing the artifacts. Packages remain private until the
repository's naming and licensing gates are resolved.

Before a release candidate, exercise the complete generated-project boundary
outside the workspace:

```sh
pnpm run starter:verify
pnpm run starter:verify -- --platform all --native-build
# Build, install, interact with, and remove a unique Release starter:
pnpm run starter:verify -- --platform android --android-device DEVICE_SERIAL
# Signed-build, launch, and remove a dedicated Release starter:
pnpm run starter:verify -- --platform ios --ios-device DEVICE_ID --ios-team TEAM_ID
```

This opt-in gate builds and packs every distributable package, installs the
packed CLI, creates a fresh application, installs only the packed Solid Native
artifacts, then type-checks, diagnoses, bundles, and verifies each selected
platform. `--native-build` additionally compiles Android Release and an unsigned
generic-device iOS Release build. It is intentionally absent from hosted CI, so
registry access and native compilation do not consume pull-request runner
minutes. `--android-device` implies the native build and refuses emulators,
locked hardware, and installed-package collisions before packing or Gradle. It
then verifies the APK's embedded application ID, generated title, Solid
ownership copy, and counter through Android accessibility before and after one
device input. Its random gate package, process, UI dump, and reversible
stay-awake lease are all checked during cleanup. Failures preserve the temporary
project; `--keep` preserves successful runs as well.

The corresponding `--ios-device` gate requires an explicit Apple development
team. It rejects unavailable, nonphysical, locked, Developer-Mode-disabled, and
bundle-colliding destinations before packing. After the signed Release build,
it verifies the app's bundle and signing-team identities, installation, and a
live process, then terminates and uninstalls the dedicated starter. Its stable gate
bundle ID lets Xcode reuse one provisioning profile instead of registering a
new App ID on every run. This is a signed launch proof; rendered iOS interaction
remains covered by the checked-in XCTest suites.

`licenses:verify` fingerprints exact installed package versions and their
declared licenses against the reviewed policy. Use `licenses:inventory` to emit
the normalized JSON for dependency review. Passing this drift check is not a
legal compatibility opinion and does not replace distribution notices.

## Decision records

Create ADRs in `docs/adr`. Use a short context/decision/consequences format and mark superseded decisions rather than silently rewriting history.
