# `@solid-native/testing`

The package supplies a deterministic application test renderer over a strict
in-memory implementation of `NativeHost`. It renders ordinary Solid Native
components, records commits, exposes semantic queries, injects native events,
and verifies exact surface cleanup without a simulator.

```tsx
import { renderNative } from "@solid-native/testing";

const screen = await renderNative(() => <App />);

await screen.press(screen.getByRole("button", { name: "Increment count" }));

screen.getByText("Count: 1");
console.log(screen.debug());
await screen.cleanup();
screen.assertDisposed();
```

Fresh applications run TS/TSX tests with the first-party command:

```sh
pnpm test
# or focus one file
pnpm exec solid-native test test/counter.test.tsx
# rerun affected tests, optionally focused by test name
pnpm exec solid-native test --watch --test-name-pattern "counter"
# exercise the same non-diagnostic tests against optimized Solid
pnpm exec solid-native test --production
```

The command uses Node's built-in test runner and the same shared Solid
universal OXC compiler as Metro. It selects Solid's development runtime by
default so official diagnostics and attribution are available; `--production`
selects optimized semantics for tests that do not require those development-
only channels. It does not load Babel, Jest, React's test renderer, Metro, a
simulator, or a device. Default discovery is confined to
`*.test` and `*.spec` JavaScript/TypeScript files beneath `test/`; explicit
inputs must resolve inside the application, and the loader rejects oversized
modules. Node releases with synchronous module hooks use them directly, while
the minimum supported Node 22 release uses its worker-based registration API.
Watch mode follows the test files and their imported dependency graph; the
test-name filter is validated as a bounded JavaScript regular expression before
the child runner starts.

`renderNative` installs the core component descriptors by default and flushes
the initial commit before returning. It deliberately disables background
auto-commit scheduling: `flush()`, `act()`, `fireEvent()`, and `press()` are
explicit deterministic boundaries. Queries always inspect the latest immutable
host snapshot:

- `getByText`, `queryByText`, and `queryAllByText`
- `getByRole`, including an optional accessible name
- `getByLabelText`, `getByTestId`, and `getByComponent`
- `findByText`, `findByRole`, `findByLabelText`, `findByTestId`, and
  `findByComponent` for delayed output

Use `screen.within(element)` to scope that complete synchronous and asynchronous
query set to one currently mounted native subtree. The scope includes its root,
which is useful for a screen-level test ID. It follows the latest immutable
snapshot and fails on stale or cross-render roots instead of leaking matches
from retained sibling screens.

The singular `getBy` and `queryBy` forms reject ambiguous matches with a bounded
summary of the mounted native elements. Event targets carry their owning host
and surface identity; a stale, removed, or cross-render target fails instead of
dispatching to a reused numeric handle. `commits` exposes only the commits made
since that render began, while the underlying `host` remains available for
controlled measurements and lower-level assertions.

`debug()` returns (and never prints) a readable native tree with node handles,
semantic accessibility props, subscribed events, and raw text. Output is
bounded by configurable node and depth limits so it is safe to include in test
failure messages. Use `debug({ includeProps: true })` when transport props are
needed; their deterministic JSON is separately clipped to keep diagnostics
bounded.

`debugCommits()` returns the render-scoped native transactions in chronological
order, including surface, sequence, priority, mutation kinds, and causal
operation IDs. It keeps the latest bounded commits and mutations. Text, prop,
and command-argument values require explicit
`debugCommits({ includeValues: true })`; timeout failures include a value-free
commit tail automatically.

Tests that care about native transaction shape do not need to search the raw
commit array. Capture the current sequence immediately before an action, then
use the singular or plural commit/mutation queries:

```tsx
const checkpoint = screen.commitCheckpoint();
await screen.press(screen.getByRole("button", { name: "Increment" }));

screen.getCommit({
  afterSequence: checkpoint,
  priority: "user-blocking",
  mutationTypes: ["update-text"],
});

const update = screen.getMutation({
  type: "update-text",
  afterSequence: checkpoint,
});
```

`getCommit`/`queryCommit`/`queryAllCommits` match sequence, priority, causal
operation ID, and the exact ordered mutation-kind list. The corresponding
mutation methods return the containing commit, the mutation, and its index.
Their discriminated matchers support component and command names, current or
historical native elements, parent/child placement, and exact prop-name or
event-name sets. They intentionally do not match text, prop values, or command
arguments: assert public UI and behavior for those details. Singular queries
reject ambiguity, cross-render elements are rejected, and failures append the
same bounded value-free commit tail as timeout diagnostics.

Development tests can capture Solid's official diagnostic/attribution artifact
and the scenario's exact native transactions together:

```tsx
import {
  assertNativeDiagnosticsBudgetFile,
  captureNativeDiagnostics,
  expectNativeCommitBudget,
  expectNoDiagnostics,
  expectNoWaste,
  parseNativeDiagnosticsBudgetFile,
} from "@solid-native/testing/diagnostics";
import { readFile } from "node:fs/promises";

const { artifact } = await captureNativeDiagnostics(
  async ({ render }) => {
    const screen = await render(() => <Counter />);
    await screen.press(screen.getByLabelText("Increment"));
    screen.getByText("Count: 1");
  },
  { scenario: "counter press" },
);

expectNoDiagnostics(artifact.solid);
expectNoWaste(artifact.solid);
expectNativeCommitBudget(artifact, {
  maxCommits: 3, // mount, update, owner cleanup
  maxMutations: 16,
});

const budgets = parseNativeDiagnosticsBudgetFile(
  await readFile("solid-native.diagnostics.json", "utf8"),
);
assertNativeDiagnosticsBudgetFile(artifact, budgets);
```

The checked-in policy extends Solid's upstream format without renaming its
fields:

```json
{
  "formatVersion": 1,
  "scenarios": {
    "counter press": {
      "maxReruns": 1,
      "maxWastedRuns": 0,
      "scopes": { "/^counter/": 1 },
      "native": {
        "maxCommits": 3,
        "maxMutations": 16,
        "maxCommitsPerRender": 3,
        "maxMutationsPerCommit": 8
      }
    }
  }
}
```

Parsing rejects oversized input, unknown fields, invalid regular expressions,
duplicate allow-list entries, control characters, and unbounded numeric values,
then returns a frozen policy. Assertion selects the artifact's exact scenario;
a missing policy entry fails so a renamed or newly added test cannot silently
run without reviewed Solid and native budgets.

`captureNativeDiagnostics` resolves against the application's exact
`@solidjs/signals` instance, automatically disposes every render in reverse
order, and records cleanup before closing capture. Render and commit counts are
bounded; native summaries retain mutation kinds and optional opaque causal IDs,
never props, text, or command arguments. The upstream Solid artifact can include
signal value previews and optional source data, so it is local development/CI
material—not a production or hosted telemetry payload. Static names correlate
the two channels deterministically, but the artifact does not claim an exact
per-rerun-to-commit causal token that Solid does not yet expose.

Use `waitFor` when a timer, native-service fake, streamed chunk, or other
asynchronous source will update Solid state:

```tsx
const loaded = await screen.findByText("Loaded", { timeout: 2_000 });

// Or poll any synchronous assertion/value.
await screen.waitFor(() => screen.getByRole("button", { name: "Continue" }));
```

Each attempt drains microtasks and flushes pending native mutations before
running the synchronous assertion. Timeouts and intervals are bounded; an
`AbortSignal` can cancel polling. A timeout preserves the last assertion as its
cause and includes a clipped native tree, so a failing test explains what was
actually committed.

Pass `hostOptions` to select a deterministic platform, capabilities, clock, or
custom descriptor set. Pass `host` when a test intentionally owns an existing
`InMemoryHost`; the two ownership modes cannot be combined.

Implemented:

- Atomic commit validation and rollback
- Create, update, move, remove, delete, and command mutations
- Ordered commit recording and surface snapshots
- Event injection and subscription cleanup
- Deterministic measurement responses
- Component descriptor and raw-text validation
- Application rendering with text, role, label, test-ID, and component queries
- General native-event delivery plus a discrete `press` convenience boundary
- Idempotent application cleanup with an exact destroyed-surface assertion
- A bounded first-party Node/OXC TSX test runner shared with generated apps
- A bounded, deterministic `debug()` view of the committed native tree
- A bounded, privacy-aware `debugCommits()` native transaction tail
- Render-scoped commit checkpoints and typed structural commit/mutation queries
- Abortable, bounded `waitFor()` polling for asynchronous Solid/native output
- Renderer conformance for Solid batching, reconciliation, refs, and cleanup
- Runtime compatibility and native-history synchronization tests
- A complete second renderer/navigation pass against Solid's development
  runtime that fails on warnings or errors from Solid 2's ownership,
  strict-read, lifecycle, and scheduler diagnostics
- Bounded `@solidjs/diagnostics` artifacts joined to value-free native commit
  summaries, with official rerun/waste assertions, native transaction budgets,
  and one strict checked-in policy format covering both channels
- An opt-in causal telemetry overhead benchmark with disabled, no-op sink,
  resource-stamped no-op sink, and bounded local-timeline modes
- A native-navigation churn benchmark covering raw history, `NativeStack`, and
  the TanStack/Solid 2 stack while validating exact owner disposal, bounded
  final nodes, stable root identity, and two commits per push/pop cycle

Run the benchmark outside the correctness suite:

```sh
pnpm benchmark
```

It runs the causal instrumentation benchmark and the navigation churn
benchmark against the deterministic in-memory host. Neither represents Fabric,
device, React Native control, or compositor performance; see the repository
benchmark methodology before using the results.

Remaining testing tools:

- iOS/Android integration harness
- Accessibility and performance scenario runners

This renderer proves Solid ownership and host-contract behavior. It does not
simulate Fabric, Yoga, operating-system services, native navigation gestures,
or device performance; those claims still require the checked-in physical
integration runners.
