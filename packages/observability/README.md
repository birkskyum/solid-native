# `@solid-native/observability`

This package defines Solid Native's vendor-neutral causal telemetry protocol.
It records operation boundaries and cause IDs without depending on a monitoring
vendor or exporting application props and native event payloads.

The initial protocol covers surfaces, native events, selected Solid owner
lifetimes and native-output computations, explicit background tasks, renderer
commits, platform mounts, next-vsync frame observations, measurements, and
commands.
`createCausalTelemetry` isolates sink failures from application execution,
including synchronous and asynchronous failures from the optional diagnostic
reporter, and accepts deterministic clocks, backend timestamps/durations, and
ID factories for tests. A validated resource identity can stamp the runtime
ABI, platform, build, release, and update onto every record without allowing
individual operations to spoof those fields. The renderer does not create
telemetry records unless a root opts in.

`createSampledCausalTelemetry` makes one validated decision for the complete
session. A rejected session returns `undefined`, allowing the renderer to keep
its zero-instrumentation path; a retained session preserves every causal edge.

`createCausalTimeline` provides a bounded in-memory view for development tools,
and `createCausalTelemetryFanout` isolates exporters while delivering the same
record stream to a local timeline and one or more external backends.
`timeline.explain(operationId)` reconstructs the retained transitive causes and
effects of a selected event, computation, commit, mount, or frame in stable
timeline order. It reports cause IDs that are no longer retained, so a debugger
does not silently present an evicted or cross-process graph as complete.
`explainCausalTimelineSnapshot(snapshot, operationId)` performs the same query
on an isolated snapshot after it has crossed a development-client boundary.
`groupCausalTimelineSnapshot(snapshot)` partitions retained operations into
weakly connected causal components, keeping consumers of the same unresolved
or evicted cause together. Each bounded group reports entry and terminal
operations, unresolved causes, active/error/cancelled counts, and elapsed time.
Its `groupId` is only the earliest retained operation ID, not an invented
distributed trace identity; a group can change when the bounded timeline
evicts history.
`createCausalDebugSnapshot` turns that snapshot into a versioned, bounded,
deeply frozen JSON-shaped handoff. `parseCausalDebugSnapshot` validates the
untrusted value before a desktop debugger queries it; it rejects unsupported
schema versions, unknown fields, duplicate operation IDs, inconsistent active
counts, and oversized operation, cause, attribute, or string collections.

`correlateNativeSolidDiagnostics` is the pure, transport-independent join
between one parsed Solid diagnostics envelope and one causal snapshot. It
matches bounded static effect/native-output names inside the capture window and
follows retained native computation → commit → mount → frame edges. The result
is deeply frozen and explicitly records `exactPerRerunJoin: false`; callers
cannot accidentally promote the current time-window heuristic into an exact
claim. Keeping this function in the protocol package lets on-device tools,
desktop clients, and hosted ingestion apply the same semantics without taking
a dependency on the Node.js CLI.

The portable handoff is transport-neutral and needs no account, network
service, or vendor SDK. The parser bounds and validates structure; it is not a
redaction system. Built-in Solid Native instrumentation records
low-cardinality identifiers and timings rather than props or event payloads.
Applications adding custom attributes remain responsible for excluding secrets
and personal data.

`createSentryCausalExporter` is the first vendor adapter. It accepts the narrow
`startInactiveSpan` API exposed by current Sentry JavaScript and React Native
SDKs, so this package has no Sentry dependency and does not initialize or own
the customer's SDK. It maps operations to UI span categories, converts the
protocol's millisecond timestamps to Sentry seconds, preserves safe attributes,
and stores bounded multi-cause IDs as span data rather than indexed tags.

`createOpenTelemetryCausalExporter` provides the equivalent dependency-free
boundary for a tracer returned by `@opentelemetry/api`. It uses the protocol's
epoch-millisecond timestamps directly, leaves batching and transport with the
application's configured SDK, and marks only actual error outcomes as
OpenTelemetry errors. Cancellation remains explicit span data rather than being
misclassified as a failure.

```ts
import * as Sentry from "@sentry/react-native";
import { mount } from "@solid-native/renderer";
import {
  createCausalDebugSnapshot,
  createCausalTelemetryFanout,
  createCausalTimeline,
  createSampledCausalTelemetry,
  createSentryCausalExporter,
  explainCausalTimelineSnapshot,
  groupCausalTimelineSnapshot,
  parseCausalDebugSnapshot,
} from "@solid-native/observability";

const verifiedRelease = releaseVerification.authorizedRelease;
if (verifiedRelease?.inputsVerified !== true)
  throw new Error("Release inputs are not authorized");

const timeline = createCausalTimeline();
const sentry = createSentryCausalExporter({ sentry: Sentry });
const telemetry = createSampledCausalTelemetry({
  sink: createCausalTelemetryFanout({
    sinks: [timeline.sink, sentry.sink],
  }),
  sampleRate: 0.1,
  authorizedRelease: verifiedRelease,
  resource: {
    runtimeName: "react-native-fabric",
    runtimeVersion: "0.87.0",
    hostContractVersion: 1,
    platform: "ios",
    buildFingerprint: "ci/482:arm64",
    updateFingerprint: "sha256:0123abcd",
  },
});

mount(App, host, {
  surface: { name: "main" },
  ...(telemetry === undefined ? {} : { telemetry }),
});

const selectedCommit = timeline
  .snapshot()
  .operations.find((operation) => operation.name === "solid-native.commit");
const explanation =
  selectedCommit === undefined
    ? undefined
    : timeline.explain(selectedCommit.operationId);

// A transport can send this JSON from Hermes to a local development client.
const payload = JSON.stringify(createCausalDebugSnapshot(timeline.snapshot()));

// The receiving debugger validates before inspecting the detached graph.
const received = parseCausalDebugSnapshot(JSON.parse(payload));
const detachedExplanation =
  selectedCommit === undefined
    ? undefined
    : explainCausalTimelineSnapshot(received, selectedCommit.operationId);
const retainedGroups = groupCausalTimelineSnapshot(received);

// End any incomplete spans when the application telemetry lifetime ends.
sentry.close();
```

`authorizedRelease` structurally accepts the CLI verifier's output as one
release identity. It rejects envelope-only evidence, malformed or additional
schema fields, partial trust-policy identity, a mismatched runtime platform,
and duplicated manual release fields. Project, release, channel, revision,
release/bundle/native/artifact fingerprints, signer identity, input evidence,
and trust-policy identity are copied once and attached after operation
attributes, so application spans cannot override them.

The observability package validates this boundary but does not authenticate
it. Use the object from a successful policy and build-input verification, not
an unsigned manifest or application-authored lookalike. The individual
release-lineage resource fields remain for non-production compatibility.

The OpenTelemetry path uses the same causal stream:

```ts
import { trace } from "@opentelemetry/api";
import {
  createCausalTelemetry,
  createOpenTelemetryCausalExporter,
} from "@solid-native/observability";

const openTelemetry = createOpenTelemetryCausalExporter({
  tracer: trace.getTracer("@solid-native/observability"),
});
const telemetry = createCausalTelemetry({ sink: openTelemetry.sink });

// Pass telemetry to mount(...), then close incomplete spans with its lifetime.
openTelemetry.close();
```

Both adapters bound active spans and exported cause IDs, report duplicate,
dropped, orphaned, and truncated records through `snapshot()`, and close
unfinished spans as cancelled. Session selection belongs to the protocol
boundary; exporter-side sampling, transport, native crash capture, and SDK
initialization remain the application's vendor configuration.

See the [observability architecture](../../docs/observability.md) for privacy,
exporter, and native-timing boundaries.
