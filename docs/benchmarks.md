# Benchmark methodology

Performance claims need reproducible controls. A fast run on one developer
machine is diagnostic evidence, not a product claim, and JavaScript-only results
must never be presented as device or compositor performance.

## Native UI-worklet cadence diagnostic

The dedicated physical worklet proof includes a five-second native timing. The
application reads statistics through the public inspection boundary and fails
unless the timing reaches its exact graph endpoint, accounts for every interval,
retains every interval used by the proof, and stays inside cadence-adaptive
mean/p95/p99 bounds. The runner prints the raw JSON marker so a CI invocation can
retain it with its device metadata and logs.

```sh
SOLID_NATIVE_ANDROID_SERIAL=<serial> \
  pnpm --filter @solid-native/native-e2e android:worklet:test

SOLID_NATIVE_IOS_DESTINATION=<device-identifier> \
SOLID_NATIVE_IOS_TEAM=<development-team> \
  pnpm --filter @solid-native/native-e2e ios:worklet:test
```

On 2026-08-21, a Pixel 9a run recorded 302 frames and 301 intervals with a
16.65293 ms mean, 16.65238 ms p50, 16.66986 ms p95, and 16.68183 ms p99. An
iPhone 17 Pro run recorded 601 frames and 600 intervals with an 8.33478 ms
mean and 8.33475 ms p50/p95/p99 after the iOS scheduler was changed from
one-shot display links to one persistent maximum-refresh `CADisplayLink`. Both
runs recorded zero omitted interval samples and subsequently passed their
analytical decay, real native-pan, and teardown phases.

The same Release-device proof also runs a bounded analytical spring after the
cadence gate. It interrupts an active spring from its last evaluated native
vector, samples an underdamped position beyond `1`, and accepts completion only
at position `1`, velocity `0`, and the exact target graph outputs. Android
instrumentation additionally samples the mounted `View` and requires visible
translation past the target. This is a semantic and scheduler gate; it is not a
cross-framework spring-performance benchmark.

The proof next runs a bounded analytical velocity decay. It observes a moving
native frame, replaces the driver from the last evaluated vector, and accepts
completion only at the derived cadence-independent endpoint with speed `0` and
coherent frame statistics. The subsequent real pan begins at that decay
endpoint. Android instrumentation additionally observes and validates the
mounted `View`; this is likewise a semantic scheduler gate, not a
cross-framework decay-performance benchmark.

Before the sustained cadence gate, the same proof cancels a live timing through
the synchronous native handshake. It accepts the phase only when the graph
sequence and mounted output remain unchanged, the native scheduler reports no
pending frame, and a subsequent named partial timing starts from the returned
visible vector. This is a cancellation/ownership invariant, not a latency
measurement.

This is a fail-closed scheduler correctness gate on two devices, not a matched
framework benchmark or compositor-presentation measurement. The platform
display timestamp advances even though Hermes does not process frame updates;
that is the architectural behavior under test. Repeated alternating samples,
thermal and power metadata, application-load variants, and compositor evidence
would be required for a broader performance claim.

## Causal renderer overhead

The first checked-in harness isolates the JavaScript cost of causal
instrumentation during steady-state Solid signal commits. It uses the same
renderer and deterministic in-memory host in four modes:

1. Instrumentation disabled.
2. Instrumentation enabled with a no-op sink.
3. Instrumentation and runtime/build resource stamping enabled with a no-op
   sink.
4. Instrumentation enabled with the default bounded local timeline.

Each sample mounts one Text node, warms the runtime, then applies and flushes one
text update per signal change. Mode order rotates between samples to reduce
order bias. The harness validates the final native snapshot and exact commit
count before accepting each measurement. Garbage collection is requested
between samples when the runtime exposes it.

Run the default profile:

```sh
pnpm benchmark
```

Tune duration without editing source:

```sh
SOLID_NATIVE_BENCH_WARMUP=500 \
SOLID_NATIVE_BENCH_ITERATIONS=5000 \
SOLID_NATIVE_BENCH_SAMPLES=20 \
pnpm benchmark
```

For machine-readable output, invoke the underlying runner with `--json`:

```sh
pnpm --filter '@solid-native/testing...' build
node --conditions=browser --expose-gc \
  packages/testing/benchmark/causal-overhead.mjs --json
```

Record the commit SHA, clean/dirty state, command, output JSON, power mode, and
whether other heavy processes were running. Compare full distributions and
absolute time per commit. A single relative percentage can be misleading when
the disabled baseline is very small.

## Physical Android causal-telemetry diagnostic

The Android integration shell adds two matched ARM64 Release flavors for the
same Solid/Fabric tree and signal-update loop. Both include the same named owner
and native-output computation annotations. The baseline passes no telemetry
session to the renderer; the observed flavor creates one sampled-in session
with runtime resource identity and a counting no-op sink. In shadow-commit
mode, each cold launch warms up 100 commits, measures 1,000 `flush()` commits,
and requires a final `flushMounted()` acknowledgement before emitting a result.

Install both flavors and run six seed-balanced samples per variant:

```sh
pnpm --filter @solid-native/native-e2e android:telemetry:install:baseline
pnpm --filter @solid-native/native-e2e android:telemetry:install:observed
pnpm --filter @solid-native/native-e2e android:telemetry:benchmark
```

The event-path mode reuses those installed flavors and the same warmed tree:

```sh
pnpm --filter @solid-native/native-e2e android:telemetry:event
```

For a bounded sequence of real inputs within each launched process, use the
sustained-event mode:

```sh
pnpm --filter @solid-native/native-e2e android:telemetry:sustained
```

It runs 30 sequential taps per process by default. Set
`SOLID_NATIVE_ANDROID_TELEMETRY_EVENT_ITERATIONS` from 1 through 200 to change
that bound. The runner waits for each exact event, Solid commit, Fabric mount,
and next-vsync result before injecting the next tap, and rejects duplicate,
missing, or noncontiguous event indices. Results distinguish
`processPairCount`, `eventsPerProcess`, and their flattened `eventPairCount`.
Events from the same process share runtime and thermal state, so those event
pairs are correlated observations rather than independent cold-launch samples.

After the warmup's final mounted frame, the app reports the measured native
Pressable bounds. The runner converts React Native's density-independent
coordinates with Android's validated current display density and injects one
touchscreen tap per cold launch. A sample is accepted only when the platform
delivers a discrete `press`, Solid produces the exact next commit, Fabric's
UI-thread hook observes its revision, and Choreographer reports the first
next-vsync callback after that mount.

The event sample reports handler-to-commit, handler-to-mount,
handler-to-next-vsync, commit-to-mount, commit-to-next-vsync, and
mount-to-next-vsync independently. Native commit/mount/frame durations use the
backend's monotonic clock. Handler boundaries use short-lived wall-clock
differences between Hermes and the native backend. The raw native event
timestamp belongs to a separate platform clock and is recorded but never mixed
into either duration family.

For every metric, the machine-readable result includes baseline, observed, and
paired observed-minus-baseline distributions with count, minimum, p25, median,
p75, p95, maximum, and mean. It also retains the difference and relative
difference between the two independent medians. The console headline uses the
median of paired deltas, which preserves each within-pair cold-launch comparison;
that value need not equal the difference between medians.

Raw samples, record counts, device/OS/runtime identity, repository revision and
dirty state, deterministic Android native-compatibility fingerprint and input
count, display density, power-saver state, and thermal status around every
sample remain in the result. Flavor order uses a shuffled, balanced plan to
reduce systematic order bias while retaining exact pairs. The result records
both the unsigned 32-bit seed and complete order plan; set
`SOLID_NATIVE_ANDROID_TELEMETRY_ORDER_SEED` to reproduce it,
`SOLID_NATIVE_ANDROID_TELEMETRY_SAMPLES` to tune pair count, and
`SOLID_NATIVE_ANDROID_TELEMETRY_OUTPUT_DIR` to retain JSON outside the working
tree. Before publishing success, the runner force-stops both installed flavors
and verifies their processes are absent. Exit and termination-signal hooks apply
the same cleanup on failure or interruption.

Shadow-commit mode measures the narrow Hermes-to-Fabric transaction path; its
final mount is a correctness condition outside the timed interval. Event-path
mode adds one real input, platform mount, and next-vsync boundary. Sustained
event mode repeats that exact path without paying a cold launch between every
input. None measures compositor presentation, startup, an exporter or network
transport, or a representative product workload. Treat all modes as
overhead-budget evidence and retain the raw distribution; do not turn one
device's relative delta into a general performance claim.

The clean-worktree Pixel 9a/Android 17 run on 2026-08-21 at revision `d55b885`
used seed `20260821` for six measured cold-launch pairs in both modes. Power
saver was off, every sample began and ended at thermal status 0, and the cleanup
guard verified both application processes absent before returning success. Both
results carry native-compatibility fingerprint
`sha256:de2b954e9a790b3088d7b200e61b615bc4d9c407e340f8aaae8dfc60dedf99b1`
over 103 bounded inputs.

In shadow-commit mode, the baseline median was 311.429 µs/commit and the
observed median was 350.897 µs/commit. The paired `observed - baseline` median
was 39.817 µs/commit; the independent median difference was 39.467 µs, or
12.67%. Baseline samples emitted no records, while observed samples emitted
8,710–8,810 complete causal records. The full distribution is retained in
[`benchmark-results/android-causal-telemetry-shadow-pixel-9a-2026-08-21.json`](benchmark-results/android-causal-telemetry-shadow-pixel-9a-2026-08-21.json).

In event-path mode, handler-to-commit medians were 1.425 ms baseline and
1.219 ms observed, with a −0.269 ms paired median delta. Handler-to-next-vsync
medians were 30.432 ms and 24.230 ms, with a −6.375 ms paired median delta,
but individual paired deltas ranged from −14.396 ms to +1.740 ms. That broad,
zero-crossing distribution makes six pairs insufficient for a stable latency
conclusion. It does show that both flavors completed the exact input, commit,
mount, and next-vsync proof without thermal throttling. The raw result is
retained in
[`benchmark-results/android-causal-telemetry-event-pixel-9a-2026-08-21.json`](benchmark-results/android-causal-telemetry-event-pixel-9a-2026-08-21.json).

A second clean-worktree run at revision `3d86dca` used the same seed for six
process pairs with 30 sequential physical taps per launched flavor: 180 paired
events and 360 raw samples. Power saver remained off, all per-process initial
and final thermal statuses were 0, and cleanup again left neither flavor
running. The result carries native-compatibility fingerprint
`sha256:4972fba17603bc029e8224987388e21a3c01a51ddbab95c6842d1ecac3e25d20`
over 103 bounded inputs.

In sustained-event mode, handler-to-commit medians were 2.384 ms baseline and
2.672 ms observed. The paired median delta was +0.268 ms; the independent
median difference was +0.287 ms, or 12.06%. Handler-to-next-vsync medians were
31.971 ms and 31.697 ms, with a −0.677 ms paired median delta and paired values
from −15.639 ms through +16.683 ms. This locates the observed median difference
near instrumented commit construction while showing that scheduling
variability dominates the wider frame path; it does not establish a universal
overhead ratio. Nor does it make the 180 within-process pairs statistically
independent. The complete result is retained in
[`benchmark-results/android-causal-telemetry-sustained-pixel-9a-2026-08-21.json`](benchmark-results/android-causal-telemetry-sustained-pixel-9a-2026-08-21.json).

## Matched steady property updates

The Android update benchmark uses the existing matched idle-resource shells:
the Solid Native renderer and an ordinary React Native 0.87/Fabric control each
mount the same View, two Text nodes, generated Fabric component, and Pressable.
Both settle at count 1 before measurement. AndroidX then injects 30 real
touchscreen presses per launched process and requires the accessibility tree to
expose every exact count from 2 through 31 before injecting the next press.
This makes dropped or coalesced application updates a hard failure without
flooding either runtime's input queue.

```sh
pnpm --filter @solid-native/native-e2e android:update:matched
```

The runner builds and installs both Release applications and test APKs, runs
one warmup pair, then records six seed-balanced process pairs. Configure those
bounds with `SOLID_NATIVE_ANDROID_UPDATE_WARMUP_PAIRS`,
`SOLID_NATIVE_ANDROID_UPDATE_SAMPLES`, and
`SOLID_NATIVE_ANDROID_UPDATE_ORDER_SEED`. Set
`SOLID_NATIVE_ANDROID_UPDATE_OUTPUT_DIR` to retain the raw JSON outside the
working tree.

Each sample retains all 30 touch-down-to-accessibility-visible completion
durations and their p50/p95/max. That boundary deliberately includes the 50 ms
injected touch gesture, accessibility observation, and polling overhead; it is
useful as matched end-to-end evidence, not a pure renderer latency. A native
Window `FrameMetrics` listener independently records frame count, deadline
misses, frozen frames, dropped reports, and p50/p95/max frame duration across
the update sequence. Android may produce fewer Window reports than inputs even
when all 30 visible states are proven, so the gate requires at least 25 frames
and zero dropped reports rather than inventing a one-input/one-frame invariant.

The result also records raw sample order, app/test duration, device/OS/runtime
compatibility identity, power-saver state, and thermal status around each
process. Exit and signal hooks force-stop both application identities and
verify their processes are absent before success. Window frame duration is not
compositor presentation, and this small property-only tree is one workload—not
a general Solid-versus-React performance verdict.

The clean-worktree Pixel 9a/Android 17 run on 2026-08-21 at revision `9323f15`
used seed `20260821`, one excluded warmup pair, and six measured pairs: 180
verified updates per renderer. Power saver was off; all 12 measured processes
began and ended at thermal status 0; and every sample recorded zero deadline
misses, frozen frames, and dropped reports before verified cleanup. Frame count
was 29 or 30 per process. The result carries native-compatibility fingerprint
`sha256:83e05cc435e128a2d53f32880007bc14428645cd595cf242e0792e9f473a108b`
over 103 bounded inputs.

React Native and Solid Native frame-p50 medians were 6.380 ms and 7.264 ms; the
paired `Solid - React` median was +0.857 ms. Frame-p95 medians were 9.119 ms and
9.761 ms, with a +0.839 ms paired median whose individual paired values ranged
from −1.219 ms through +2.184 ms. The coarse completion-p95 medians were
186.319 ms and 186.546 ms, demonstrating how the fixed gesture/accessibility
cost dominates that boundary. Six pairs support a reproducible diagnostic,
not a framework-wide speed ratio. The complete result is retained in
[`benchmark-results/android-matched-steady-updates-pixel-9a-2026-08-21.json`](benchmark-results/android-matched-steady-updates-pixel-9a-2026-08-21.json).

## Matched mixed product workload

The property-only tree is complemented by a small order-fulfillment screen:
two summary cards, a reactive progress bar, a real ScrollView containing 12
text-heavy order rows, and a priority alert that mounts and unmounts
periodically. The Solid application stores each row phase in its own signal;
one input updates the old and new rows plus summary/progress state without
rerunning unrelated row components. The React Native 0.87 control derives the
same visible tree from one ordinary immutable state update.

```sh
pnpm --filter @solid-native/native-e2e android:workload:matched
```

Each launched process receives 30 AndroidX touchscreen inputs. Instrumentation
does not accept a summary counter alone: every cycle also requires the exact
active-order summary and row accessibility state. Counts 5, 10, 15, 20, 25,
and 30 must mount the priority alert, and the following cycles must remove it,
proving six structural insertions and removals. Window frame metrics cover this
complete sequence. The same seed-balanced ordering, warmup, thermal/power,
native-fingerprint, raw-sample, and verified process-cleanup rules used by the
steady-update runner apply here. Configure them with the
`SOLID_NATIVE_ANDROID_WORKLOAD_*` environment variables.

Both workloads deliberately share the two memory benchmark flavors. Android's
Gradle graph treats `ENTRY_FILE` as the declared bundle entry input, so changing
between the counter and dashboard invalidates stale Hermes assets rather than
silently reusing another scenario's bundle. The runner also wakes the display,
dismisses a non-secure keyguard, and collapses system panels before each sample
so Android's active accessibility window is the launched application.

A clean-worktree Pixel 9a/Android 17 run on 2026-08-24 at revision `08cb132`
used seed `20260824`, one excluded warmup pair, and six measured pairs: 180
updates per renderer. Power saver was off, thermal status remained 0 in every
sample, every exact row and structural assertion passed, and there were no
frozen frames or dropped frame reports.

React Native and Solid Native frame-p50 medians were 4.404 ms and 5.433 ms;
the paired `Solid - React` median was +0.915 ms. Frame-p95 medians were 13.698
ms and 14.908 ms, with a +0.872 ms paired median whose individual paired
values ranged from +0.532 ms through +2.872 ms. Completion-p95 medians were
296.898 ms and 296.148 ms, with a −1.420 ms paired median. That disagreement
is useful: the completion boundary includes touchscreen injection and repeated
accessibility assertions, while Window frame metrics do not measure compositor
presentation. Six pairs provide a reproducible diagnostic, not a general
framework speed ratio. The raw evidence is retained in
[`benchmark-results/android-matched-product-workload-pixel-9a-2026-08-24.json`](benchmark-results/android-matched-product-workload-pixel-9a-2026-08-24.json).

The Solid dashboard also has a separate observed functional gate:

```sh
pnpm --filter @solid-native/native-e2e android:product:telemetry:test
```

It requires every physical interaction to preserve its native-event → named
Solid owner/computations → exact commit → Fabric mount → next-vsync causal
chain, while Android independently checks the same visible state. This command
is a correctness and privacy gate rather than an overhead comparison.

The matched product-telemetry diagnostic holds that exact workload constant:

```sh
pnpm --filter @solid-native/native-e2e android:product:telemetry:matched
```

It builds dedicated Solid Native Release flavors from the same product
component. Both retain owner/computation annotations, lifecycle subscriptions,
30 physical inputs, exact visible-state assertions, and Window frame capture;
only the observed flavor passes a fully sampled causal session to `NativeRoot`.
The baseline must emit zero telemetry records. The observed flavor must validate
all 30 causal graphs and exclude rendered order values from its records.

The default one excluded warmup pair and six seed-balanced measured process
pairs yield 180 paired event observations. Event-level distributions report
handler-to-commit, mount, and next-vsync boundaries; process-level distributions
report the coarser accessibility completion and Window frame metrics. Raw
samples retain both proof records, physical evidence, runtime/device identity,
thermal and power state, repository revision, and native-compatibility
fingerprint. Use the `SOLID_NATIVE_ANDROID_PRODUCT_TELEMETRY_*` variables to
set pair count, warmup count, order seed, timeout, and output directory.
Interactions in one process are correlated, accessibility polling dominates
its completion boundary, and neither lifecycle next-vsync nor Window frame
duration measures compositor presentation.

A clean-worktree Pixel 9a/Android 17 run on 2026-08-24 at revision `b2a2d11`
used seed `20260824`, one excluded warmup pair, and six measured process pairs:
180 paired interactions and 360 physical state transitions. Power saver was
off, every process began and ended at thermal status 0, all observed processes
validated 30 causal chains and emitted exactly 396 records, all baselines
emitted zero, and no process reported a frozen frame or dropped frame-metrics
sample. The native-compatibility fingerprint was
`sha256:0cd79f38e5fe944dabf93a2df0ec071847776eed23c3858f54a5908c11bbe193`
over 103 bounded inputs.

Handler-to-commit medians were 6.068 ms baseline and 6.714 ms observed. The
paired `observed - baseline` median was +0.710 ms; the independent median
difference was +0.646 ms, or 10.65%. This is the narrowest boundary that
contains causal record construction and validation, so it is the most useful
overhead signal in this corpus.

Handler-to-next-vsync medians were 57.895 ms and 57.740 ms, with a -0.061 ms
paired median, but individual paired deltas ranged from -8.261 ms through
+16.037 ms. Process-level Window frame-p95 medians were 15.351 ms and
15.586 ms, with a +0.280 ms paired median; accessibility completion-p95 medians
were 295.159 ms and 296.169 ms, with a +0.857 ms paired median. Those broader
boundaries cross scheduler, input-injection, and polling noise and do not
support a latency improvement or regression claim from six process pairs. The
raw evidence is retained in
[`benchmark-results/android-product-telemetry-pixel-9a-2026-08-24.json`](benchmark-results/android-product-telemetry-pixel-9a-2026-08-24.json).

## Native navigation churn

The second JavaScript harness repeatedly pushes a keyed Solid screen and
reconciles a simulated native dismissal. It runs both `NativeStack` directly
and `TanStackNativeStack` through TanStack Router's Solid 2 stores, route
matching, synchronous loaders, provider subscription, and retained match
trees. Every measured cycle produces two renderer commits. The harness rejects
a sample unless the root screen and its direct content handle remain stable,
each detail owner is disposed exactly once, application transitions are
acknowledged, router and native history return to the same idle location, and
the final in-memory native tree contains only the bounded root stack.

The physical Android companion is an invariant gate rather than a timing
benchmark:

```sh
pnpm --filter @solid-native/native-e2e android:navigation:restoration:test
```

Its sustained phase performs 30 accessibility-driven pushes and operating-
system Back actions through a real `react-native-screens` container. It requires
one stable Java `ScreenStack` and root Solid owner, 30 balanced detail owners,
and the expected TanStack zero-stale loader revalidation before complete
surface/process/package cleanup. A separate process injects Android's
running-critical memory callback, requires inactive Solid ownership and
application caches to be reclaimed without changing the retained native screen
identities or history, acknowledges recovery, and proves a fresh root remount
through system Back.

`pnpm benchmark` runs both harnesses. Tune navigation churn separately:

```sh
SOLID_NATIVE_NAV_BENCH_WARMUP=250 \
SOLID_NATIVE_NAV_BENCH_ITERATIONS=2000 \
SOLID_NATIVE_NAV_BENCH_SAMPLES=20 \
pnpm benchmark
```

For only its machine-readable output:

```sh
pnpm --filter '@solid-native/testing...' build
node --conditions=browser --expose-gc \
  packages/testing/benchmark/native-navigation.mjs --json
```

The `history-only` mode isolates `NativeHistory`; `rendered-stack` adds Solid
keyed ownership, deterministic host commits, snapshot validation, and event
injection; `tanstack-stack` additionally includes TanStack route matching,
loader execution, Solid 2 store publication, frozen inactive matches, and the
provider's history synchronization. They are separate absolute baselines, not
an apples-to-apples speed comparison.

## Virtualized list window churn

The fixed-extent list harness moves a 600-point viewport forward by one
50-point row per commit through 10,000 logical items. With two overscan rows on
each side, it rejects a sample if more than 16 rows remain mounted, if the
in-memory node graph grows beyond those rows and their fixed wrappers, if a
window shift fails to commit, or if any Solid row owner survives application
disposal.

```sh
pnpm --filter '@solid-native/testing...' build
node --conditions=browser --expose-gc \
  packages/testing/benchmark/virtualized-list.mjs --json
```

Tune it with `SOLID_NATIVE_LIST_BENCH_WARMUP`,
`SOLID_NATIVE_LIST_BENCH_ITERATIONS`, `SOLID_NATIVE_LIST_BENCH_SAMPLES`,
`SOLID_NATIVE_LIST_BENCH_ITEMS`, `SOLID_NATIVE_LIST_BENCH_ITEM_SIZE`,
`SOLID_NATIVE_LIST_BENCH_VIEWPORT_SIZE`, and
`SOLID_NATIVE_LIST_BENCH_OVERSCAN`. The result reports raw batch durations plus
minimum, median, p95, maximum, mean, and median time per window shift.

This is a JavaScript/in-memory ownership and transaction diagnostic. It excludes
Hermes, JSI, Fabric, Yoga, platform scrolling, mount, frame scheduling, GPU
work, and native view-pool behavior. It is a boundedness gate for the prototype,
not a smooth-scrolling or product-performance claim.

The separate `android:list:test` Release scenario is functional physical-device
evidence, not a timing benchmark. On the Pixel 9a it injects a touchscreen
swipe into the real native ScrollView, waits for motion to settle, and requires
the Solid-owned row window and Android accessibility tree to stay bounded at 12
mounted rows for 1,000 logical items. It also waits for exact Fabric mount
revisions and native measurement. The instrumentation records the real window's
`FrameMetrics` from gesture start through the mounted success marker, rejects
dropped reports and Android frozen frames, and logs raw frame count, system
deadline misses, p50, p95, and maximum duration. The scenario then injects a
touchscreen tap that invokes the public imperative handle and proves row 900 is mounted before its
native scroll command; that later functional step is outside the captured
gesture interval.

The separate `ios:list:test` signed Release scenario closes the matching iPhone
runtime path. XCTest performs one excluded warmup and one measured
70%-viewport drag through the real nested `UIScrollView`. The application and
UI test independently require a bounded window of at most 12 live Solid owners
and distinct accessible row labels, row-zero eviction, exact Fabric mount and
measurement barriers, the row-900 imperative command, complete surface stop,
and a surviving process.

The measured drag records Apple's scrolling/deceleration signpost data and, on
iOS 26, the app-targeted `XCTHitchMetric`. A fail-closed parser requires one
finite result for duration, system animation frame rate/count and hitch data,
plus the complete application hitch set when available. The `.xcresult` retains
the raw measurement. This is a one-shot platform diagnostic without thermal or
power metadata, a matched React control, a checked-in result, or regression
thresholds; it establishes runtime coverage but not a general iPhone
performance claim.

`android:list:benchmark` turns that scenario into a fail-closed repeated
diagnostic. It rebuilds and installs the Release application and instrumentation
APK, performs one warmup by default, then records six measured cold
instrumentation runs. Each accepted sample contains the complete frame,
bounded-window, keyed-prepend, imperative-index, and teardown evidence; the
runner preserves
every raw sample and reports distributions without outlier removal. Optional
JSON retention records thermal status around each run, power mode, device/OS,
CPU ABI, app revision, dirty-worktree state, and the exact Android
native-compatibility fingerprint. This is still a single Solid Native variant;
use the matched runner for an ordinary React Native control.

`android:list:matched` builds isolated Release variants for that Solid scenario
and an ordinary React Native 0.87 `FlatList` control. Both start with 1,000
stable 56-point rows in a 392-point viewport, use the same injected touchscreen
gesture and 150 ms settled-proof interval, prepend the same 50 stable rows while
retaining the visible original anchor at an exact 2,800-point native offset
correction, and physically request logical index 950. That request must resolve
to stable original row 900 at view position 0.5 and exact offset 53,032. One
excluded warmup pair and six
measured pairs run by default. A recorded unsigned 32-bit seed shuffles a
balanced implementation-order plan; set `SOLID_NATIVE_ANDROID_LIST_ORDER_SEED`
to reproduce it. Every sample must contain compatible device frame,
bounded-window, prepend, and imperative evidence; the stricter Solid lifecycle
evidence must additionally prove bounded command-free prepend transactions,
balanced keyed owners, and complete surface teardown. The result retains
raw evidence and reports the React and Solid distributions plus paired
`Solid - React` deltas without outlier removal. Both application identities are
force-stopped and verified absent before success, with the same cleanup
attempted on failure or interruption. The result also binds the device evidence
to the deterministic Android native-compatibility fingerprint and its bounded
input count.

The clean-worktree Pixel 9a/Android 17 run on 2026-08-20 at revision `fbc44b3`
used one excluded warmup followed by six measured samples with thermal status
0 and power saver off. Samples contained 74–75 frames, zero deadline misses,
zero frozen frames, and zero dropped reports. The p50 distribution had a
5.860 ms median (5.742–6.007 ms range), p95 had an 11.039 ms median
(10.603–11.880 ms range), and the maximum-frame distribution had a 12.910 ms
median (12.345–15.044 ms range). No sample was removed. The complete result is
retained in
[`benchmark-results/android-solid-list-pixel-9a-2026-08-20.json`](benchmark-results/android-solid-list-pixel-9a-2026-08-20.json).

The earlier clean-worktree matched run on the same Pixel 9a/Android 17 at revision
`2c84108` used one excluded warmup pair and six measured alternating pairs.
Thermal status remained 0 and power saver remained off. Both variants recorded
zero deadline misses, frozen frames, and dropped reports. React Native captured
68–70 frames per sample with median p50/p95/maximum durations of
4.867/9.442/11.430 ms; Solid Native captured 74–75 frames with medians of
5.543/10.917/12.702 ms. The paired median `Solid - React` deltas were
0.694 ms at p50, 1.568 ms at p95, and 2.447 ms for the sample maximum. No
sample was removed. At the settled and imperative proofs, Solid retained 12
and 11 live keyed row owners respectively, while FlatList reported 30 mounted
row components in every sample. Those ownership counts are useful boundedness
evidence, but they are not native-memory measurements.

The result does not show a frame-duration advantage for Solid in this narrow
scenario. The implementations also reach their proof marker after different
amounts of framework-specific validation, reflected in Solid's additional
captured frames. Treat this as an optimization baseline and ownership tradeoff,
not a winner declaration. The full raw result is retained in
[`benchmark-results/android-matched-list-pixel-9a-2026-08-20.json`](benchmark-results/android-matched-list-pixel-9a-2026-08-20.json).

That retained corpus and the subsequent 2026-08-21 corpus below predate the
keyed-prepend phase: they jump directly to row 900 at offset 50,232. They remain
checked-in historical optimization baselines, but their frame distributions
must not be compared numerically with results from the current longer
prepend-plus-jump protocol. A fresh repeated current-protocol corpus is still
required before making a new comparison claim.

A subsequent clean-worktree run on 2026-08-21 at revision `b1883a3` used seed
`20260821` for a balanced shuffled plan and bound all samples to Android native
compatibility fingerprint
`sha256:d7abc5a49aa8c813bd1499b3a728eca6cb16fa4c307e9a2b9f94a50cb01fcaae`
over 103 inputs. Thermal status remained 0 and power saver remained off. React
Native captured 68–72 frames per sample with median p50/p95/maximum durations
of 4.763/9.403/11.869 ms; Solid Native captured 74–76 frames with medians of
5.783/11.530/12.631 ms. The paired median `Solid - React` deltas were 0.966 ms
at p50, 1.819 ms at p95, and 0.546 ms for the sample maximum. Every sample had
zero deadline misses, frozen frames, and dropped reports; every Solid sample
also balanced all 38 row-owner creations with 38 disposals and stopped its
surface. No sample was removed. Six pairs remain a diagnostic corpus rather
than a performance ranking. The complete result is retained and validated in
CI at
[`benchmark-results/android-matched-list-pixel-9a-2026-08-21.json`](benchmark-results/android-matched-list-pixel-9a-2026-08-21.json).

The separate Android platform-view recycling experiment compares the identical
Solid list with React Native 0.87's master recycling flag off and on. The
recycling flavor inherits the new-architecture stable defaults and changes only
that flag. Every recycling sample additionally requires instrumentation to
observe the same Java `View` object under two different logical row labels.
This proves reset/reuse beneath create/delete mutations without claiming that
Solid logical node handles are reusable.

The clean-worktree Pixel 9a/Android 17 run on 2026-08-20 at revision `c8cafc9`
used one excluded warmup pair and 12 measured alternating pairs. Thermal status
remained 0 before and after every sample and power saver remained off. Both
variants recorded zero deadline misses, frozen frames, and dropped reports.
Recycling reduced the p95 median from 11.428 ms to 10.780 ms (−5.7%); the
paired `recycling - baseline` p95 delta had a −0.768 ms median, and recycling
had the lower p95 in 11 of 12 pairs. Median p50 was effectively unchanged
(5.723 vs 5.724 ms). The sample-maximum median increased from 12.454 ms to
12.612 ms (+1.3%), with one recycling maximum of 15.132 ms; neither side
crossed the frame deadline. No sample was removed. The complete result is
retained in
[`benchmark-results/android-solid-list-view-recycling-pixel-9a-2026-08-20.json`](benchmark-results/android-solid-list-view-recycling-pixel-9a-2026-08-20.json).

This is positive evidence for Android platform pooling in the tested workload,
not authorization to enable an internal, off-by-default React Native flag for
applications. The native Fabric host continues to report
`viewRecycling: false`: that capability is reserved for a future
renderer-visible reusable-identity contract. iOS Fabric's existing internal
component-view pool belongs to the same lower layer.

Android `FrameMetrics.TOTAL_DURATION` ends when work is issued to the display
subsystem, not when the compositor presents it. The diagnostic therefore does
not close the device benchmark gate below or support a general smoothness
claim.

## What this does not measure

The in-memory harness does not include Hermes, JSI serialization, Fabric
shadow-tree work, platform mount, frame scheduling, GPU/compositor work,
application startup, native memory, or React. The physical Android and iPhone
diagnostics add Hermes, JSI, and shadow-tree commits. Android's event mode also
adds a UI-thread mount and next-vsync callback; the iPhone one-shot adds Apple's
scroll-animation and app-hitch instrumentation. They retain the exclusions in
their sections and cannot support a “faster than React Native” claim.

## Device benchmark gate

The Phase 0 benchmark gate remains open until the repository has:

- More representative matched React Native 0.87 controls beyond the completed
  fixed-extent Android list, idle-memory, steady-property-update, telemetry, and
  mixed order-dashboard scenarios. The dashboard has a clean repeated corpus;
  broader navigation/input composition remains open.
- Repeated physical-iPhone and physical-Android runs with thermal state, power
  mode, OS, hardware, app revision, and native runtime fingerprint recorded.
- Startup and broader mixed/text-heavy workloads. Steady property updates,
  structural list updates, event-to-mount, event-to-next-vsync, memory, and
  dropped-frame scenarios now have bounded Android evidence.
- Raw exportable samples, fixed warmup rules, randomized scenario order, and no
  cherry-picked outlier removal.

Next-vsync callbacks remain distinct from compositor presentation in both the
benchmark schema and any published interpretation.

## iOS idle-resource diagnostic

The physical-device shell includes a paired Activity Monitor sampler for the
Solid renderer and ordinary React/Fabric control. Dedicated install commands
build separate memory-only application identities with the same View/Text/custom
Fabric component/Pressable tree, avoiding both the interactive proof tree and
its assertions. Both perform one startup count update before the measurement
window and settle on the same visible tree. Run `ios:memory:solid` and
`ios:memory:control` with the same duration and device conditions. Each result
records the commit revision, dirty state, hardware, OS, native-compatibility
fingerprint and input count, raw post-warmup samples, first/last/peak values,
and least-squares physical-footprint, real-memory, and resident-size slopes.
Duration-weighted `activity-monitor-process-live` intervals provide complete
coverage, CPU distributions, cumulative CPU time, thread bounds, and live
memory. Sparse `sysmon-process` updates provide resident memory and cumulative
context-switch and interrupt-wakeup rates. The split is intentional: a quiet
process may stop producing raw update rows while a final live interval still
covers the unchanged tail. Retained runs include both XML exports and the
machine-readable resource result alongside the raw trace. Schema changes,
counter regressions, noncontiguous intervals, and incomplete traces fail closed
instead of emitting a result.

This is an idle-process diagnostic, not a leak verdict or representative-workload
benchmark. Run multiple samples in both orders, retain raw traces, control
thermal and power state, and add a sustained interaction scenario before using
the data for a performance claim.

The Android shell provides the paired `android:memory:solid` and
`android:memory:control` commands with the same diagnostic-only interpretation.
Its dedicated Release flavors render the same matched tree under separate app
IDs. It samples local process CPU time, CPU percentage, main-thread context
switches, thread bounds, and `dumpsys meminfo` totals once per second and includes thermal,
power-saver, OS, SDK, revision, and dirty-state metadata in its machine-readable
result. The target PID is verified absent before a successful run returns.
