# Package publication

Solid Native's packages are intentionally guarded from registry publication
while the project name, license, repository home, and initial version policy
remain undecided. The guard is explicit: every candidate package currently has
`private: true` and version `0.0.0`.

The repository can still answer two separate questions before those decisions
are made:

1. Are the package artifacts structurally consumable?
2. In what dependency order could an intentional public package set ship?

## Inspect the release plan

Run the read-only report from the repository root:

```sh
pnpm packages:release-plan
```

The report discovers distributable manifests under `packages/`, validates
internal workspace references, rejects missing internal packages and runtime
dependency cycles, and emits deterministic dependency waves. A package appears
only after its internal runtime dependencies. Peer dependencies are validated
but do not impose publication order.

The current plan has five acyclic waves and no structural blockers. It remains
blocked on the intentional decisions represented by package privacy, placeholder
versions, license metadata, repository metadata, and public scoped-package
access. The command never edits a manifest and never contacts a registry.

For tooling, suppress pnpm's command banner and request the versioned JSON
schema:

```sh
pnpm --silent packages:release-plan --json > package-release-plan.json
```

Once the public metadata decisions have landed, release CI can turn the report
into a fail-closed gate:

```sh
pnpm packages:release-plan --check
```

`--check` exits nonzero whenever either a decision or structural blocker
remains. It is deliberately not part of `ci:verify` while publication is
guarded.

## Verify what would be installed

The release plan does not replace artifact verification:

```sh
pnpm build
pnpm packages:verify
```

That second command packs every candidate package, checks export and native
artifact allowlists, installs all tarballs into an isolated consumer, imports
the public entrypoints, type-checks them, runs Solid Native TSX through the
installed CLI, and validates the generated application and native integration
layout. It also verifies that the present private publication guard survives
packing and that no `workspace:` range leaks into a tarball.

The eventual release workflow should keep both gates: the release plan owns
metadata and dependency ordering, while artifact verification owns the bytes a
consumer actually receives.
