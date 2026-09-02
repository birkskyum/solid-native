# Causal observability

## Product thesis

Solid Native should make a native interaction explainable as one causal chain:

```text
native input
  -> Solid-owned event handler and reactive flush
  -> coalesced renderer transaction
  -> host commit
  -> native shadow-tree revision
  -> platform mount
  -> next-vsync frame opportunity
  -> displayed frame
```

Fine-grained reactivity makes this unusually useful. The runtime knows which
input entered Solid, which mutations were coalesced, which commit carried them,
and which native revision observed an event or measurement. That is a stronger
wedge than offering another undifferentiated crash dashboard.

Protocol v0 now follows a renderer commit through its exact Fabric revision and
an observed platform UI-thread mount on iOS and Android, then to the first
`CADisplayLink` or `Choreographer` callback after that mount. The commit
operation ID crosses JSI as opaque causal context, and the backend reports
commit, mount, and next-vsync timing as separate operations. The final OS
compositor-presentation boundary is not observable through these callbacks and
remains future work.

The sharing vertical demonstrates this graph for imperative platform UI, not
only direct view events. On a signed physical iPhone, completing and dismissing
UIKit activity presentations produce distinct privacy-safe platform events.
Each event causes the named `platform.share.output` Solid computation, which in
turn causes the exact user-blocking Fabric commit that displays the result.
Message, URL, subject, and activity type never enter the telemetry record.

The physical dialog proof applies the same policy to two UIKit button
settlements. Destructive and cancel-styled identities affect application state
without becoming telemetry attributes; only the stable platform event and
`platform.alert.output` computation cause their user-blocking Fabric commits.

## Solid diagnostic attribution

Solid 2 and Solid Native now expose complementary halves of the explanation:

| Channel                       | What it can explain                                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Solid development attribution | Which named signal, memo, async landing, or refresh caused a computation to rerun; dependency-set changes; and aggregate rerun/waste cost                                      |
| Solid Native causal telemetry | Which native or platform event entered the application, which named output and task affected a transaction, and which host commit reached a Fabric mount and frame opportunity |

The workspace is pinned to `solid-js` and `@solidjs/universal` `2.0.0-rc.3`.
Under Solid's development condition, an executable renderer test now proves
that the named `native-count` write is the root cause of the `native-label`
memo rerun, that the derived value reaches a universal renderer effect named
`counter.output`, and that the same update produces exactly one new native host
commit. A `CausalComputation name="counter.output"` supplies that same static
name to the Solid development effect and to the value-free
`solid-native.computation` operation that causes the commit. Production
condition runs use Universal's unmodified helpers and skip attribution because
Solid correctly removes the `DEV` surface.

`@solidjs/universal` `2.0.0-rc.3` accepts an effect name internally for
`effect` and `insert`, but does not expose that option in its public types or
through `spread`. Solid Native therefore carries a narrowly tested,
development-only compatibility adapter. An upstream-ready `next` change adds
explicit renderer effect options to `effect`, `insert`, and `spread`; once that
API is published, the local `spread` mirror can be removed without changing
the Solid Native component API.

`@solid-native/testing/diagnostics` now wraps the published
`@solidjs/diagnostics` RC3 harness in-process. One successful scenario captures
the official diagnostics, rerun attribution, and cost tables alongside every
render's exact value-free native commit summary; official no-diagnostic,
rerun, and waste assertions compose with Solid Native commit/mutation budgets.
A strict checked-in policy format preserves Solid's upstream scenario fields
and adds one `native` namespace for total/per-render commit and mutation caps.
Its bounded parser rejects unknown fields and malformed policies, and assertion
fails closed when a captured scenario has no reviewed entry. The repository's
counter scenario is enforced through that same file API rather than duplicating
its definition of done in test code.
It resolves against the application's exact `@solidjs/signals` instance,
automatically disposes every render before capture closes, and includes that
owner cleanup in the artifact. A second reactive-core instance would observe a
different graph and produce a dangerously plausible empty report, so the
workspace and package peers remain exactly pinned. This remains development/CI
tooling, not a production telemetry SDK. The browser/Vite bridge is not reused
as a native transport. Solid Native instead defines a schema-zero one-shot
Hermes envelope capped at 1 MiB. It normalizes codes, bounded static names,
rerun/dependency/cost fields, and a value-free cause graph while dropping
messages/data, values/previews, stacks, owner IDs, raw nodes, props, text, and
rendered content. Its detached parser rejects unknown fields and invalid or
over-budget structure before the CLI exposes an artifact.

Metro resolves the controller implementation only in development bundles; the
same import is an inert shim in production and the production source-map gate
rejects the development implementation. RC3 attribution has process-global
enable/disable ownership, so capture is deliberately exclusive. The native
mailbox carries separate begin/end operations and the Android CLI opens one
timed window, cleans each nonce response, and makes a bounded best-effort end
request if capture fails. This is a local development artifact, not implicit
hosted telemetry or an exact rerun-to-Fabric join.

These two channels cannot yet be represented as one exact per-rerun causal
graph. Current attribution records have monotonic Solid run/change sequences
and live node identity, but no cross-channel operation token or timestamp that
can safely join a particular rerun to a Solid Native event or commit. Matching
the static computation name is now deterministic correlation, but still not
proof that one particular rerun caused one particular commit. The remaining
useful upstream seam is a dev-only correlation token or event hook that can
retain the active application cause without making the reactive core depend on
a native renderer. It should also permit multiple diagnostic consumers without
one consumer's `disable()` clearing every listener and history buffer.

Attribution artifacts need a separate privacy decision from the runtime
protocol. Solid's write records can contain short value previews, and optional
write stacks expose source locations. Solid Native causal telemetry
intentionally records neither values nor rendered content. Local diagnostics
may retain the richer artifact and checked-in budgets, but any future device or
hosted export must be explicit, bounded, redacted, and disabled by default.

## Open protocol

`@solid-native/observability` defines a versioned, vendor-neutral stream of
operation-started and operation-finished records. Each operation has a stable
process-local ID and zero or more causal IDs, so a batched commit can retain all
the events or imperative boundaries that caused it instead of forcing the data
into a single-parent tree.

The renderer currently emits operations for:

- Surface lifetime
- Native event handling, including dropped-event reasons
- Opt-in named Solid owner lifetimes and the native commits their subtrees cause
- Opt-in named Solid native-output computations, coalesced per commit
- Explicit owner-bound background tasks and their synchronous Solid settlements
- Serialized host commits, priority, sequence, and mutation counts
- Platform mounts, exact host revision, and backend-observed mount duration
- First platform frame callbacks after mount, with commit-to-frame and
  mount-to-frame duration
- Measurement boundaries, their independent event/owner/computation causes,
  and observed commit sequence
- Native commands, their synchronous event/owner/computation cause when one is
  active, and the commit that transports each command

Telemetry is opt-in per `NativeRoot`. With no telemetry object, the renderer
does not read a clock, allocate operation IDs, build attribute records, or call
an exporter. Instrumentation and exporter failures are isolated from rendering;
an `onSinkError` observer that throws or rejects is isolated as well, preventing
recursive diagnostics from becoming an application failure path.

```ts
import { createCausalTelemetry } from "@solid-native/observability";
import { mount } from "@solid-native/renderer";

const authorizedRelease = releaseVerification.authorizedRelease;
if (authorizedRelease?.inputsVerified !== true)
  throw new Error("Release inputs are not authorized");

const telemetry = createCausalTelemetry({
  sink(record) {
    exporter.enqueue(record);
  },
  authorizedRelease,
  resource: {
    runtimeName: binding.backend,
    runtimeVersion: binding.backendVersion,
    hostContractVersion: binding.contractVersion,
    platform: binding.platform,
    updateFingerprint: installedUpdate.fingerprint,
  },
});

const app = mount(App, host, {
  surface: { name: "main" },
  telemetry,
});
```

Resource identity is validated and copied when the telemetry session is
created. Its bounded static fields are attached to both start and finish
records after operation attributes, so a caller cannot spoof the runtime,
platform, build, release, or update identity for one operation. The native
end-to-end app asserts the runtime name, version, host-contract version, and
platform against the installed JSI binding on either physical target. Build,
release, and update fingerprints must come from signed delivery metadata; the
runtime deliberately does not invent them.

The first-class `authorizedRelease` input structurally matches the release
CLI's successful verifier output. It binds project, platform, release, channel,
source revision, release/bundle/native/artifact fingerprints, authenticated
signing key, input evidence, and optional trust-policy identity as one unit.
The session rejects envelope-only evidence, unknown or incomplete schema-v0
fields, mismatched runtime platforms, and any duplicated manual release fields
in `resource`. It copies the validated identity once, and operation attributes
cannot override it.

Cryptographic trust is established before this API: the observability package
does not verify signatures, choose keys, or decide which policy is current.
Pass the successful policy verifier's `authorizedRelease`, which is derived
from the exact manifest snapshot that passed every signature, policy, and build
input check and is absent from failed reports. A structurally identical object
from an untrusted source is still untrusted. The legacy individual lineage
fields remain available for non-production integrations, but production code
should use the unitary `authorizedRelease` path.

An authenticated device proof is deliberately a different identity. The
device-proof CLI verifies clean physical execution under its own signing
context and returns `authenticatedProof`, but that object cannot satisfy
`authorizedRelease` and must not be attached as delivery authority. When a
versioned device-lab trust policy is used, the object includes its exact
normalized fingerprint and sequence so an ingestion service can retain the
verified trust decision and enforce its own sequence high-water mark. A managed
observability service can use the open release/device correlator described
below rather than rebuilding that comparison from serialized lookalikes.
Portable schema-1 receipts additionally expose a deterministic fingerprint of
the instrumentation identity and normalized source policy. The verifier
requires that profile to be explicitly pinned or carried by a schema-1 lab
policy, preventing a trusted key from silently substituting an easier test.

## Device-proof ingestion handoff

`solid-native device-proof ingestion` verifies the signed physical-device
receipt and repeats its bounded read before returning an uploader-neutral
descriptor. The handoff carries the exact authenticated proof lineage plus
device model/OS/ABI, power and thermal context, native compatibility, generated
binding, JavaScript bundle, and source-map identities, both APK facts, and
instrumentation timing and result digests. Legacy schema-0 ingestion exposes
only its historically named source-map identity. The descriptor contains no
checkout paths, stable device serial digest,
public key, or detached-signature bytes.

The verifier may pin the receipt, source revision, native compatibility, APK,
and inclusive measurement window before creating this descriptor. This keeps a
stale or unrelated valid lab run out of a rollout dashboard. Measurement bounds
still trust the signed lab clock; independent timestamping and durable replay
state belong to the control plane. The handoff's frozen `verificationPolicy`
retains the exact constraints that admitted it for downstream audit.

This is the open seam for fleet dashboards and regression analysis. Backend
adapters own transport, credentials, retention, indexing, access control, and
the persisted trust-policy high-water mark. As with `authorizedRelease`, a
plain object with the same fields is not automatically trusted; production code
must pass the result of the live verifier boundary.

## Release/device correlation handoff

`solid-native release correlate-device-proof` independently authenticates the
complete Android release and physical-device receipt, including both versioned
trust policies and their optional rollback floors. It then derives the proof's
required source revision, native-compatibility fingerprint, and APK digest from
the live `authorizedRelease`, and requires the two authenticated project
identities to match. A stale, cross-project, ABI-mismatched, or different-APK
receipt therefore cannot produce a correlation record even if its device-lab
signature is otherwise valid.

The handoff also repeats verification of the release's bundle manifest and
requires a portable device receipt's JavaScript bundle and canonical source-map
byte counts and SHA-256 values to match both exact production artifacts. Legacy
schema-0 receipts are rejected because their historical `bundle` field contains
only source-map identity. This prevents an otherwise matching APK statement
from being correlated to different executed JavaScript or symbolication input.

The path-free result retains the original input-complete `authorizedRelease`,
the full device-proof ingestion descriptor, and one compact matched identity.
This is suitable for a fleet or release-health adapter, but it does not make
device execution a delivery authorization and it does not make serialized
output self-authenticating. Durable replay state, independently trusted time,
policy distribution, storage, alerts, and access control remain backend work.

## Privacy and cardinality

Protocol v0 records operation metadata, not application data. It intentionally
does not record component props, text, command arguments, event payloads,
measurement coordinates or dimensions, or error messages. Error records
contain a low-cardinality error type. Node handles are process-local diagnostic
values and exporters should attach them as span data rather than indexed tags.

Future payload capture must be explicit, sampled, redacted, and disabled by
default. The protocol should remain useful without collecting user content.

Sampling happens once per causal session through
`createSampledCausalTelemetry`. A rejected session returns `undefined`, which
an application omits from its `NativeRoot` options to preserve the renderer's
zero-instrumentation path. A retained session records the complete graph;
sampling operations independently would sever task, owner, event, commit,
mount, and frame relationships. The sample rate and injected random source are
strictly validated, and resource configuration is validated even when the
session is rejected.

## Exporters

Sentry is the natural first exporter because it already serves Solid, React
Native, native mobile, and Expo applications. The runtime does not depend on the
Sentry SDK. The implemented `createSentryCausalExporter` accepts the small
structural API around `startInactiveSpan`, `setAttribute`, `setStatus`, and
`end` that current Sentry JavaScript and React Native SDKs expose. Applications
pass their initialized Sentry namespace into it; Solid Native neither bundles
nor configures the vendor SDK. This follows Sentry's current custom
instrumentation API rather than its removed transaction/child-span API.

The Sentry adapter translates operations into UI-category spans, converts protocol
milliseconds into Sentry seconds, prefixes protocol attributes, and records a
bounded list of additional causal IDs as structured span data rather than
indexed tags. One parent cannot represent a many-to-one causal graph, so the
original IDs remain the authoritative link model. Active spans and exported
causes are bounded; snapshots expose drops, duplicates, orphans, and truncation,
and `close()` cancels incomplete spans during teardown.

The implemented `createOpenTelemetryCausalExporter` accepts the narrow stable
`Tracer.startSpan`, `Span.setAttribute`, `Span.setStatus`, and `Span.end`
surface. Applications pass a tracer from their initialized OpenTelemetry API;
Solid Native adds no OpenTelemetry dependency and does not own SDK processors,
sampling, batching, or network transport. Protocol timestamps already use the
epoch-millisecond `TimeInput` accepted by the JavaScript API. Actual errors map
to error status with a static description. Successful and cancelled operations
retain the default unset status, with `solid_native.outcome` distinguishing
them, so ordinary owner or surface teardown is not reported as a failure. Like
the Sentry adapter, it keeps bounded causal IDs as attributes because one
OpenTelemetry parent cannot represent the protocol's many-to-one graph.

This separation keeps three concerns independent:

| Layer            | Responsibility                                                      |
| ---------------- | ------------------------------------------------------------------- |
| Runtime protocol | Capture causality, ordering, revision metadata, and safe attributes |
| Vendor adapter   | Translate records, sampling, transport, and SDK-specific context    |

The protocol, local timeline, and exporters remain open and transport-neutral.
Applications retain control of where their telemetry is processed and stored.

## Local timeline

`createCausalTimeline` reconstructs completed and active operations from the
record stream. It has a fixed capacity (1,000 operations by default), reports
evictions and malformed/orphaned records, and returns isolated snapshots so a
consumer cannot mutate retained telemetry. This gives a development client a
small, deterministic inspection primitive without running a service or keeping
an unbounded history in an application process.

`timeline.explain(operationId)` is the local debugger query over that retained
graph. It returns the selected operation, all retained transitive causes, all
retained transitive consequences, and any referenced cause IDs that are absent.
Results preserve timeline order and are isolated copies. Missing IDs remain
explicit because bounded eviction and future cross-process/server causes must
not be mistaken for a complete local explanation.
`explainCausalTimelineSnapshot` applies the same query to a detached snapshot,
so a Mac development client does not need a live reference to the timeline
inside the native application's Hermes process.

`groupCausalTimelineSnapshot` partitions that detached graph into bounded
weakly connected components. Retained branches sharing one unresolved or
evicted cause stay together, and each group reports its entry/terminal nodes,
unresolved causes, active/error/cancelled counts, and elapsed time. The local
`groupId` is the earliest retained operation ID, not a protocol-level or
distributed trace identity; eviction can change the shape and identity of the
remaining local group. This distinction prevents a convenient debugger view
from overstating cross-process causality.

`solid-native debug inspect` exposes the same grouping in its schema-one,
privacy-safe output. It reports group operation kinds and IDs, entries,
terminals, status counts, and unresolved causes, and links an explicitly
selected operation back to its retained group. Custom attributes remain
excluded unless disclosure is explicit.

`createCausalDebugSnapshot` is the versioned device-to-development-client
envelope around that detached snapshot. Its schema-zero payload is JSON-shaped,
deeply frozen, and bounded by operation, cause, attribute, and string counts.
The receiver must call `parseCausalDebugSnapshot` before graph queries. The
parser rejects unsupported versions, unknown fields, duplicate operation IDs,
inconsistent counters, non-finite values, and oversized payload components,
so an attached app cannot make the desktop tool retain arbitrary object graphs.
The envelope is transport-neutral: a local development client can move it over
an existing device channel without an account or hosted ingestion service.
The open CLI can already validate a handoff saved as a bounded local file and
inspect one causal chain:

```sh
solid-native debug inspect causal-timeline.json --operation commit-42
solid-native debug capture-android dev.example.app --serial DEVICE_SERIAL | solid-native debug inspect -
solid-native debug capture-ios dev.example.app --device CORE_DEVICE_ID | solid-native debug inspect -
solid-native debug diagnostics-android dev.example.app --serial DEVICE_SERIAL --duration 1000 > solid-diagnostics.json
solid-native debug diagnostics-ios dev.example.app --device CORE_DEVICE_ID --duration 1000 > solid-diagnostics.json
solid-native debug report-android dev.example.app --serial DEVICE_SERIAL --duration 1000 --output causal-report.html
solid-native debug report-ios dev.example.app --device CORE_DEVICE_ID --duration 1000 --output causal-report.html
solid-native debug diagnostics-inspect solid-diagnostics.json
solid-native debug correlate solid-diagnostics.json causal-timeline.json
solid-native debug compare baseline.json candidate.json --max-p95-regression 20
solid-native debug report causal-timeline.json --diagnostics solid-diagnostics.json --operation commit-42 --output causal-report.html
solid-native debug capture-ios dev.example.app --device CORE_DEVICE_ID | solid-native debug report - --output causal-report.html
solid-native debug trace causal-timeline.json > causal-trace.json
solid-native debug capture-android dev.example.app --serial DEVICE_SERIAL | solid-native debug trace - > causal-trace.json
solid-native debug capture-ios dev.example.app --device CORE_DEVICE_ID | solid-native debug trace - > causal-trace.json
solid-native debug symbolicate main.jsbundle.map --at 427:19
solid-native debug symbolicate main.jsbundle.map --stack device.stack
device-stack-command | solid-native debug symbolicate main.jsbundle.map --stack -
```

The CLI caps a file or stdin stream at 16 MiB, requires strict UTF-8 JSON, omits
custom attributes by default, returns no source path in its report, and performs
no network request. `debug capture-android` sends a fresh nonce through adb
under the app UID. `debug capture-ios` sends one through CoreDevice to an
explicit bundle, copies the matching response from its app data container, and
acknowledges deletion. `debug diagnostics-android` and `debug diagnostics-ios`
reuse those private transports for an exclusive timed, value-free Solid
diagnostics window, with the end request bound to the begin nonce. Both
transports validate and consume responses before exiting. No socket, polling
app task, account, or network service is created. `debug correlate` validates
both local artifacts, associates named Solid effect reruns with same-window
native-output computations, and follows their retained edges through Fabric
commit → mount → frame. It explicitly reports a static-name/window correlation,
not an exact per-rerun join, until Solid supplies a correlation token. Physical
Pixel and iPhone runs retain the same surface → commit → mount → frame chain.
The pure `correlateNativeSolidDiagnostics` contract lives in
`@solid-native/observability`; the CLI adds only bounded file input and human
formatting. On-device and hosted consumers can therefore reuse the same frozen
join without importing Node.js tooling.
The first non-CLI consumer now ships in the development causal panel. A
generated app shares one exclusive diagnostics controller between its private
device transport and `DevelopmentRoot`; **Capture Solid** closes the inspector
for an application interaction, **Stop Solid** ends the window, and the panel
reopens with rerun/output/frame totals from the same strict correlator. The
panel omits reactive values and diagnostic cause names, explicitly denies an
exact per-rerun join, and disposes a capture that still belongs to it when the
root unmounts. Stable application/badge/panel slots and fresh panel trees on
each reopening respect Fabric's single-parent ownership instead of reinserting
reclaimed shadow nodes. A true-development Pixel run repeatedly opens both the
network and causal panels before proving the complete capture and recovery
flow. The symmetric signed iPhone run now repeats fresh panel ownership, shows
the one-rerun/one-frame correlation without exposing its cause name, recovers
async, guarded-Hermes, and Solid-render failures, and disposes the Solid surface
without terminating the native host. Production resolution remains inert.
The live `report-android` and `report-ios` commands perform those two ordered
captures and generate the correlated offline debugger without retaining the
intermediate artifacts; application-authored causal attributes remain excluded
unless explicitly requested. `--output` publishes the report with private file
permissions through an atomic no-clobber write; omitting it preserves stdout.
`debug compare` supplies the first
local regression gate over two such files. It is independent of unstable
operation IDs and never returns custom attributes: aggregate errors and graph
incompleteness fail automatically. Its schema-one summaries also report
retained, isolated, and largest group counts. A higher candidate group count
fails as causal fragmentation only when operation-kind counts match; newly
added work does not create a false regression. Per-operation-kind successful
p95 deltas become gating only under an explicit percentage. This makes the open local primitive
usable in CI and leaves fleet baselines, workload/release matching, retention,
and alert policy as managed-service concerns. `debug report` now supplies the
first Solid Native-owned visual debugger as a self-contained offline HTML file. It
opens with the same retained causal groups, switches to individual operations,
supports status/search filtering and deep links in both views, and retains
direct causal navigation under a locked content security policy. Application
attributes stay out of the embedded data unless explicitly requested. A
resident live-session desktop application remains separate product work.
With `--diagnostics`, that same offline file adds named Solid rerun/native-frame
cards, aggregate chain counts, and direct links to the retained frame
operations. The option is the explicit privacy boundary for including bounded
static diagnostics names; it does not include reactive values or imply an
exact per-rerun join.
`debug trace` turns the same validated snapshot into a deterministic Chrome
JSON trace that Perfetto can open directly:
completed operations become duration slices, active operations extend to the
capture time, and retained causes become flow arrows. Overlapping operations
receive separate deterministic lanes rather than producing an ambiguous trace.
Retained groups become bounded summary markers, and each operation slice
carries its local group ID with an explicit local-retained-component scope.
Attributes remain opt-in, and expansion fails before allocation above 50,000
retained flow arrows. Bounded stdin lets that device command feed one snapshot
without creating a resident background relay.
The separate symbolication command resolves explicit, one-based generated
positions or a bounded Hermes/JSC/JavaScript stack through the canonical
Metro/OXC map and returns portable source identities. Files and stdin are
strict UTF-8 and capped at 1 MiB, 4,096 lines, and 1,024 frames. Hermes-specific
markers select the pinned React Native parser and normalize its zero-based
bytecode offsets; otherwise the pinned generic JavaScript parser is used. Raw
error messages and generated bundle URLs are not retained. Unknown native-crash
or vendor formats can still supply explicit positions with `--at`.

```ts
const payload = JSON.stringify(createCausalDebugSnapshot(timeline.snapshot()));
const received = parseCausalDebugSnapshot(JSON.parse(payload));
const explanation = explainCausalTimelineSnapshot(received, operationId);
```

Structural validation is not semantic redaction. Solid Native's built-in
attributes intentionally exclude props, native event payloads, and error
messages. Applications that add their own attributes must apply the same
privacy rule before records enter the timeline.

```ts
import * as Sentry from "@sentry/react-native";
import {
  createCausalTelemetry,
  createCausalTelemetryFanout,
  createCausalTimeline,
  createSentryCausalExporter,
} from "@solid-native/observability";

const timeline = createCausalTimeline({ capacity: 2_000 });
const sentryExporter = createSentryCausalExporter({ sentry: Sentry });
const sink = createCausalTelemetryFanout({
  sinks: [timeline.sink, sentryExporter.sink],
  onSinkError({ error, sinkIndex }) {
    reportExporterFailure(error, sinkIndex);
  },
});
const telemetry = createCausalTelemetry({ sink });
```

The same fanout can include an OpenTelemetry adapter, or use it instead of
Sentry. Vendor SDKs remain responsible for their own batching and retry policy;
the protocol boundary samples complete causal sessions so transport concerns do
not introduce operation-level sampling.

Protocol timestamps and durations are milliseconds. The default telemetry
clock uses `Date.now`; injected clocks must preserve the same unit. A backend
can supply epoch timestamps plus a monotonic duration for work that finishes on
another thread. Native event timestamps remain separate because their platform
clock may not be wall-clock time.

On the React Native 0.87 backends, a structural commit returns its Fabric
shadow-tree revision as `hostRevision`. iOS observes the mounting coordinator
on the main queue; Android uses `UIManagerMountHook`, whose callback follows
visible UI-thread mount effects, and reads the mounting coordinator's base
revision. Both emit `commit-mounted` only after that exact revision, or a later
coalesced revision that includes it, has mounted. Commands advance the host
sequence but do not invent a Fabric revision or mount event. The mount operation
links back to the renderer commit via an opaque operation ID limited to 128
characters. A following `solid-native.frame` operation links to the mount and
ends at the first platform display callback after it. This proves the revision
was mounted before a next-vsync opportunity, but it does not claim that the OS
compositor presented particular pixels. Neither operation carries props, event
payloads, or text. The exact revision and causal commit-to-frame path has run in
Release builds on a physical iPhone and Pixel. A separate matched Pixel Release
diagnostic now measures sampled-in causal record construction through Hermes,
JSI, and Fabric shadow-tree commits while requiring a final real mount. It
also has a separate one-press mode that follows native input through a Solid
commit, UI-thread mount, and first Choreographer callback. The raw native event
timestamp remains separate from wall-clock lifecycle timestamps. Neither mode
claims compositor presentation or product-wide performance.

A representative physical-Android functional proof now drives 30 real presses
through the order-dashboard workload. Each interaction must join the native
event, a static `fulfillment.screen` owner, the affected summary and queue
computations, the exact Fabric commit, its UI-thread mount, and the following
Choreographer callback. Twelve alert insert/remove transitions must also carry
the alert computation, while the other 18 commits must not invent it. Android
instrumentation independently verifies all 30 visible summary/row states, six
alert lifetimes, and bounded Window frame evidence. The proof scans the emitted
records and fails if they contain any rendered order ID, customer, amount, or
alert text. A separate Android runner now holds that dashboard constant across
telemetry-disabled and fully sampled flavors, balances process order, and pairs
all 30 event boundaries per process. Its clean six-pair Pixel corpus validates
180 observed causal chains and isolates a +0.710 ms handler-to-commit paired
median, while the broader handler-to-next-vsync distribution crosses zero and
supports no frame-latency claim. Neither runner measures compositor
presentation; compositor-level evidence and an iOS counterpart remain future
work.

The exhaustive physical-Android application also proves causal composition
across real native navigation. For application push, Android system Back, and
an operating-system deep link, the newly focused screen must retain its exact
direct, default-priority `focus` event with one handler. The resulting commit
must cite that event, the static `e2e.root` owner, and only focus/blur events
observed in that transition; it must also cite the affected
`navigation.focus.output` Solid computation. Each operation must finish
successfully, and the same host revision must continue through the exact
commit-to-mount-to-next-`Choreographer` chain. The proof rejects a same-sequence
blur event as a substitute for focus and emits
`SOLID_NATIVE_NAVIGATION_CAUSALITY_SUCCEEDED {"interactions":3}` only after all
three graphs pass. This composition check has passed in the full Pixel 9a
Release run; its iOS counterpart remains to be rerun.

Navigation's non-Fabric ingress is independently causal. The owner-bound
platform binding names hardware Back as the discrete
`platform.hardware-back.press` event and a running-process URL as the
default-priority `platform.url.open` event. The Pixel Release proof requires an
blocker-mediated Back and the root owner to be the exact causes of the user-blocking
pop commit, then follows its mount and next frame. The live-link proof requires
the URL event, root owner, and only the already-narrow
`navigation.focus.output` computation as the causes of its normal-priority
structural commit. The URL and all other callback payload values remain absent
from telemetry. React Native's synchronous `BackHandler` contract cannot return
the blocker promise, so the binding returns its consumed boolean and registers
a delivery-scoped retention. Only the allow/deny mutation explicitly re-enters
that event and its discrete priority. Pixel denies the first physical Back
without a structural commit, then requires the retained second event to cause
the allowed pop commit, mount, and frame.

A focused signed-iPhone Release gate independently exercises outbound Linking.
iOS resolves and reopens the app's own scheme into its existing process; the
private `platform.url.open` event and named `platform.url.output` computation
must cause the normal-priority Fabric commit without retaining the URL. The gate
then opens the real app-specific Settings page and returns to the same live
Solid state before non-terminating teardown.

Foreground notifications use the same non-Fabric boundary. The owner-bound
accessor assigns delivered, pressed, action-pressed, dismissed, and unknown
inputs stable `platform.notification.*` names, with discrete priority reserved
for user actions. The physical Pixel Release run requires
`platform.notification.delivered`, the static `e2e.root` owner, and only the
named `platform.notification.output` computation to cause the normal-priority
visible-status commit. The exact host revision continues through mount and the
next `Choreographer` frame, while the notification identifier and all callback
payload values remain absent from telemetry. Root disposal owns subscription
cleanup; the application no longer maintains a parallel manual listener. The
same Pixel run opens Android's actual notification shade and taps the adapter's
explicit default body action. Its `platform.notification.pressed` operation is
discrete and, together with the root owner and named notification output, is the
exact cause set for the user-blocking visible press commit, mount, and following
frame.

A focused signed-iPhone Release gate now applies the same privacy and causality
contract to the wrapper-free adapter seam. After native permission and delivery,
the displayed-ID query must succeed and `platform.notification.delivered`, the
static owner, and only `platform.notification.output` must cause the normal
Fabric commit. The notification ID, title, body, and channel values remain
absent from telemetry. Cancellation and owner disposal complete while the host
process remains in the foreground. Notification Center content inspection and
the discrete press path remain Android-only.

Camera session lifecycle has the same opt-in projection without changing the
lower-level imperative ownership API. `createCameraSessionEvent` binds a current
or lazily supplied session to its Solid owner and names started, stopped,
interrupted, resumed, and error callbacks under `platform.camera.session.*`.
Session replacement, detachment, root disposal, and failing native subscription
setup/removal have deterministic coverage; diagnostic failures remain isolated.
Deterministic renderer coverage requires each default-priority event, the
selected owner, and one `platform.camera.session.output` computation to be the
exact cause set for its normal commit. Interruption reasons, native error
values, and camera identity remain private. The physical Pixel Release gate now
observes CameraX's real second `started` transition after the generated preview
output attaches. Its private platform event, `e2e.root`, and the named session
output are the exact causes of a normal commit, mount, and next frame. The same
run confirms that ordinary Android backgrounding leaves the independently owned
session open; interruption/resume therefore remains a separate
device-contention or operating-system-pressure gate instead of being inferred
from AppState.

The same Android application now proves the first controlled-input causal
composition path. Every direct, discrete native `changeText` operation that
contributes to the initial controlled value commit remains a cause of that
user-blocking commit, together with the static `e2e.root` owner and exactly one
`input.text.value.output` computation. The exact host revision then continues
through Fabric mount and the next `Choreographer` frame. The proof separately
counts application-visible callbacks and all contributing transport events:
React Native's controlled editor can acknowledge intermediate values with
same-text events that the facade consumes internally, but those real native
operations must not disappear from the causal graph. The current Pixel 9a run
observed 13 application callbacks and 25 contributing native events. These
counts are evidence rather than a fixed batching contract. The proof also
rejects telemetry containing the typed value and emits
`SOLID_NATIVE_TEXTINPUT_CAUSALITY_SUCCEEDED` with both counts only after the
complete graph passes. The programmatic controlled-selection path also retains
the static owner and editor-output computation before crossing the renderer's
required microtask boundary, then links that computation to exactly one
argument-free `setTextAndSelection` telemetry operation and its isolated
command commit. Command-only commits intentionally have no Fabric revision,
mount, or frame operation. The physical return-key path now separately proves
the direct discrete `submitEditing` operation, static owner,
`input.text.submit.output` computation, user-blocking commit, exact Fabric
mount, and following frame. Its direct default-priority `blur` operation must
also finish successfully but is correctly absent from the commit's causes
because its handler performs no Solid write. The physical selection-insertion
path now applies the same rule: the latest Pixel run retained one contributing
change operation out of two observed changes, one successful non-writing
selection observation, the editor-output computation, user-blocking commit,
mount, and frame. Multiline input has its own
`input.multiline.value.output` boundary: all contributing discrete
`changeText` operations join its user-blocking commit, static owner, exact
Fabric mount, and following frame. Successful bubbling key events and intrinsic
content-size observations remain non-causes because their handlers only
validate native behavior. The current Pixel run observed 24 change operations,
of which 23 contributed to the coalesced commit, plus 12 key operations and one
size operation; another passing run emitted 13 key operations. The final
change was a late controlled acknowledgement. Those counts are evidence rather
than a fixed keyboard batching contract, and the proof rejects telemetry
containing the inserted or two-line values. The Pixel controlled-Switch path
also retains its discrete `valueChange` and
`input.switch.controlled.output` computation as independent causes of the
argument-free `setValue` operation. Its isolated command commit remains
user-blocking and emits no synthetic mount or frame. Its following positive
geometry read retains the same computation while recording only sequencing
metadata. The Android Modal path now retains three distinct interactions under
`modal.lifecycle.output`: the physical presentation press and its
user-blocking commit, direct default-priority `show` and its status commit, and
system-Back `requestClose` plus its visibility reconciliation. Every chain
continues through its exact Fabric mount and next frame without recording the
event payload. The corresponding iOS causal run remains open.

The Pixel ScrollView/Image composition also covers a deliberately split async
case. Programmatic `scrollTo` retains `input.scroll.viewport.output` through its
normal-priority command-only commit. The direct Image `load` and continuous
ScrollView `scroll` events each parent a bounded task scope; those scopes later
settle `media.image.status.output` and `input.scroll.status.output` into one
two-mutation Fabric commit. The proof requires both tasks, both computations,
the root owner, and the exact commit-to-mount-to-frame chain while rejecting
event payload and command-argument attributes. The equivalent iOS causal run
remains open.

The physical Pixel camera path covers asynchronous native resources rather than
input events. `camera.session.preview` spans Solid's session request, the
owner-bound ready promise, and publication of the typed PreviewView resource;
`camera.capture` begins before VisionCamera crosses the Nitro photo boundary.
Each task is explicitly finished or failed after Solid settlement. Each
successful commit has exactly three causes: its surface-parented task, the
static root owner, and its named `camera.preview.output` or
`camera.capture.output` computation. The proof requires normal priority, the
authorized runtime resource identity, a positive mutation count with no
command, the exact Fabric host revision, mount, and next frame. Only static task
names enter telemetry; preview handles, temporary file paths, dimensions,
orientation, timestamps, and other photo metadata do not. The equivalent iOS
causal runs remain open.

Fabric is not the only native input boundary. TurboModule and other platform
subscriptions bypass the renderer's native-node event router, so
`createCausalPlatformEventHandler` captures the current renderer root and named
owner when the subscription is created. Each delivery starts a
`solid-native.event` with a static name, `platform` source, declared priority,
and coalescing policy. Callback arguments and payload values are never recorded.
Synchronous Solid writes inherit that event and returned promises use the same
bounded settlement rule as Fabric handlers. Names and options are validated at
owner setup.

The networking controller applies this boundary separately to response
metadata, incremental chunks, completion, and failure. The bounded JSON layer
parses and freezes a finite document during the completion settlement; its
synchronous `onResult` observer therefore lets a Solid write retain the exact
`platform.network.complete` cause. The URL, headers, body, raw chunks, and
parsed values remain absent from telemetry. Consumers using a later promise
continuation must create an explicit task or causal scope if they want to
attribute additional asynchronous work rather than implying process-global
async context. `createJSONResource` uses that synchronous observer internally,
so its decoded value and ready state produce a commit caused by the same native
completion while reactive request replacement cancels stale work.
`createServerEventStream` applies the equivalent rule to each decoded SSE event:
the latest-event signal and synchronous application observer run inside the
native chunk cause, while URLs, IDs, retry hints, and event data remain values
rather than telemetry attributes.

`retainCausalPlatformEvent(result, register)` covers native APIs that must
return synchronously before asynchronous application policy settles. The
native source receives `result` immediately; `register` receives one bounded
event controller. Only synchronous work inside `event.run` inherits the event
and its priority, and the caller explicitly finishes or fails it. Root disposal
cancels unfinished retention. The controller carries no callback arguments or
settlement values and does not establish process-global async context.

`createAppState` adopts this boundary by default. The current Pixel Release run
requires the surface-parented `platform.app-state.change` event, `e2e.root`
owner, and `platform.app-state.output` computation to be the exact three causes
of the one-text normal-priority commit. That commit must carry the authorized
runtime identity and continue through its exact Fabric revision, mount, and
next frame. The proof rejects lifecycle output in telemetry. The equivalent
iOS causal run remains open.

Synchronous mutations caused by a native event link to that event operation.
If an event handler returns a promise, propagation remains synchronous, but the
renderer observes settlement and links mutations already queued by that
settlement to the same event. Returning a Solid 2 action promise therefore
connects both its optimistic commit and later reconciliation commit without a
process-global async context. Fire-and-forget work that is not returned cannot
be inferred safely and is not attributed automatically. For work that begins
outside a native event or cannot return its promise, `createCausalScope` starts
a bounded `solid-native.task` operation. The application re-enters `scope.run`
only around synchronous Solid writes, then explicitly finishes or fails the
scope. This preserves an exact task-to-commit edge without pretending an
implicit async context survives `await`. Task names are restricted to static
1–128 character identifiers, error telemetry contains only its class, and an
unfinished scope is cancelled with its Solid owner.

```ts
const refresh = createCausalScope("profile.refresh");

void loadProfile().then(
  (profile) => {
    refresh.run(() => setProfile(profile));
    refresh.finish();
  },
  (error) => refresh.fail(error),
);
```

`useNativeCausalScopeFactory` captures the native root during component setup
when a later event must create a fresh task. The task inherits the cause active
at factory invocation, is cancelled with the root, and otherwise requires the
caller to define its bounded lifecycle. The TanStack native binding uses this
seam to preserve two fixed-name chains:

```text
Fabric press -> navigation.link task -> pending/loader settlement
             -> Solid native mutations -> Fabric commit -> mount -> next-vsync

programmatic call -> navigation.programmatic task -> loader settlement
                  -> Solid native mutations -> Fabric commit -> mount -> next-vsync
```

Only those static task names are recorded. Destinations, params, search state,
loader data, and error messages remain outside the protocol. Router work is
latest-wins, so starting another navigation cancels the displaced task;
provider or root teardown cancels any task still open.

Selected owner subtrees can be annotated without instrumenting the entire
reactive graph:

```tsx
<CausalOwner name="profile.screen">
  <ProfileScreen />
</CausalOwner>
```

This creates one `solid-native.owner` operation for the boundary lifetime.
Descendant native commits link to it, nested boundaries retain causal ancestry,
and sibling commits remain unrelated. Only the validated static owner name is
recorded; signal values, props, text, and dependency reads remain outside the
protocol.

Reactive native output can be annotated more narrowly than a component owner:

```tsx
<CausalComputation name="profile.status.output">
  <Text>{status()}</Text>
</CausalComputation>
```

The annotation follows nodes created by that Solid subtree. All of its native
mutations in one pending renderer transaction share a single
`solid-native.computation` operation, including nodes materialized later by a
conditional. Its commit keeps the computation together with independent owner,
event, and explicit task causes. Nested computation boundaries preserve causal
ancestry. When Solid disposes a conditional boundary before the renderer
removes its native children, teardown uses the nearest still-active parent
boundary; it does not reopen a finished computation. Only the static name and
`native-output` kind are recorded; the runtime does not observe dependencies,
signal values, rendered text, props, or reads. Computation duration covers the
native-output batch from its first host mutation until the renderer drains the
transaction; it does not claim to measure the reactive computation's CPU time.

Imperative commands issued by an annotated native node capture the active
owner/computation chain synchronously, before the renderer defers native work
to avoid re-entering Solid's reactive flush. The command operation therefore
connects named Solid output to its later command-only commit even though the
actual host dispatch is asynchronous. Command arguments remain outside the
protocol. The renderer captures commit priority at the same boundary: a command
requested by a discrete native event keeps a user-blocking command commit,
while an ordinary programmatic command remains normal priority. The synchronous
call-site cause and the target node's selected owner/computation are retained
independently, so adding a named output boundary cannot erase native input from
the command's causal graph.

## Symbolication handoff

The CLI's `release symbolication` operation joins build-time symbols to the
runtime protocol without selecting a telemetry vendor. It requires a complete
signed-release verification, revalidates the exact bundle and self-contained
source map, and returns both artifacts under the same `authorizedRelease`
identity stamped onto causal records. Local paths are transient transport
inputs; the signed byte counts, SHA-256 digests, bundle fingerprint, and release
lineage are the correlation contract. Backend adapters remain responsible for
last-moment byte verification, upload, credentials, retention, and vendor
release naming.

## Next native milestones

1. Evaluate platform-safe compositor presentation signals without overstating
   next-vsync callbacks.
2. Add the matched physical-iOS sampling diagnostic and the representative
   product causal proof. Android now repeats the exact synthetic
   event/commit/mount/frame path 30 times per process, has a separate matched
   30-update Solid/React control, and validates causality inside the mixed
   product workload. Its matched product-overhead runner now has a clean
   six-pair Android corpus for the same component with telemetry disabled and
   enabled. A matched iOS distribution remains open.
