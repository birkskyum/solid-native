# `@solid-native/animation`

This package defines the portable animation/worklet foundation and its native
UI-thread executors. The React Native 0.87 Fabric backends decode the same
bounded graph in C++, evaluate frames from Android `Choreographer` or iOS
`CADisplayLink`, and apply supported output channels directly to the owned
platform view.

The version-0 protocol represents numeric work as a bounded, transport-safe
graph rather than an arbitrary JavaScript closure. Inputs have explicit initial
values; output channels use constants, named inputs, arithmetic, absolute and
negated values, clamping, and linear interpolation. Parsing clones and deeply
freezes the graph while rejecting unsupported fields, duplicate or undeclared
identifiers, non-finite numbers, invalid ranges, more than 64 inputs or outputs,
more than 32 expression levels, and more than 512 expression nodes.

```ts
import {
  createUIWorkletGraph,
  createUIWorkletSession,
} from "@solid-native/animation";

const graph = createUIWorkletGraph(
  { progress: 0 },
  ({ progress }, { interpolate }) => ({
    opacity: interpolate(progress, [0, 1], [0.2, 1]),
  }),
);

const session = createUIWorkletSession(host, graph);
session.update({ progress: 0.5 }, performance.now());
session.animate(
  { progress: 1 },
  { durationMilliseconds: 240, easing: "ease-in-out" },
  performance.now(),
);
session.dispose();
```

The authoring callback runs once while the graph is defined; it never runs on
the UI thread and captures no application state. Its named input expressions
and `constant`, `add`, `subtract`, `multiply`, `divide`, `min`, `max`, `abs`,
`negate`, `clamp`, and `interpolate` helpers compile immediately to the same
bounded transport graph. Numeric outputs and operands are constant shorthand.
The explicit `protocolVersion`/array/AST form remains accepted for code
generators, native adapter fixtures, and persisted protocol data.

`UIWorkletHost` is the injected execution boundary. Installation receives only
the frozen graph; updates carry a complete positional input vector and a
monotonic timestamp; destruction releases the graph handle. Updates must be
atomic: a rejected input frame cannot partially publish values or output
channels. `createInMemoryUIWorkletHost` supplies executable reference semantics
and inspectable snapshots for deterministic tests. It runs in JavaScript and is
explicitly not evidence of UI-thread performance.

`@solid-native/animation/solid` adds the ownership boundary:

```ts
import { createSignal } from "solid-js";
import { createSolidUIWorklet } from "@solid-native/animation/solid";

const [inputs, setInputs] = createSignal({ progress: 0 });
const session = createSolidUIWorklet(host, graph, inputs);

setInputs({ progress: 1 });
// The current Solid owner cancels `session` during cleanup.
```

This bridge is for coarse application-state synchronization. Gesture samples
and frame ticks should originate inside a native host so they do not round-trip
through the JavaScript thread. The owned helpers require an active Solid owner
and reject installation before allocating a native graph when none exists.
An input failure disposes the graph before reporting it, owner cleanup remains
idempotent even when the native destroy call throws, and synchronous or
asynchronously rejected diagnostic hooks cannot revive the session or escape as
background failures.
Native event handlers intentionally run outside reactive ownership; code that
installs an owned worklet from one must capture its component owner during
setup and explicitly re-enter it with Solid's `runWithOwner`.

Every session also accepts a pull-based reduced-motion policy. The accessor is
read when motion is requested, so it can be wired directly to the fine-grained
preference exposed by `@solid-native/accessibility/solid` without making either
package depend on the other:

```tsx
import { createNativeViewAnimation } from "@solid-native/animation/native";
import { createAccessibilityPreferences } from "@solid-native/accessibility/solid";

const preferences = createAccessibilityPreferences(accessibilityService, {
  appState: platform,
});
const animation = createNativeViewAnimation(graph, {
  reduceMotion: preferences.reduceMotionEnabled,
});
```

When the accessor returns `true`, timing, keyframe, and spring requests validate
normally but publish their final target immediately. Explicit decay is
suppressed at its current input vector, and a newly attached pan gesture keeps
direct touch tracking while omitting its optional release decay. `undefined`
is treated as no preference while the initial native query is loading. The
policy is intentionally pulled for each new request; an application that wants
to stop motion already in flight when its policy changes can call `cancel()`.

Hosts may implement the bounded timing extension used by `session.animate`.
Version 0 supports `linear`, `ease-in`, `ease-out`, and `ease-in-out` durations
up to 60 seconds. Solid publishes one complete target vector; the platform
display callback advances interpolation without JavaScript frame traffic. A
new immediate update cancels the timing, while a new timing continues from the
last evaluated native frame. Disposal remains the terminal cancellation
boundary. The deterministic host exposes `advanceFrame()` for exact reference
tests.

The independent `session.animateKeyframes` extension sends a complete bounded
timing sequence in one host call:

```ts
session.animateKeyframes(
  [
    {
      inputs: { progress: 0.5, offset: 24 },
      timing: { durationMilliseconds: 120, easing: "ease-out" },
    },
    {
      inputs: { progress: 1, offset: 0 },
      timing: { durationMilliseconds: 180, easing: "ease-in-out" },
    },
  ],
  performance.now(),
);
```

A sequence contains 1–32 stages and its combined duration cannot exceed 60
seconds. Named partial targets resolve cumulatively before crossing the host,
so every transported stage is a complete input vector. The host validates the
graph result at every stage endpoint before replacing an active driver. Display
callbacks evaluate elapsed time analytically and skip across completed stages,
which preserves the intended result when a callback is late and avoids a
JavaScript wakeup between stages. A replacement timing, keyframe sequence,
spring, or decay starts from the latest evaluated native vector.

After the first successfully evaluated timing frame, inspection includes
`timingFrameStatistics`. It reports frame and interval counts, first/last
display timestamps, global minimum/maximum/mean intervals, and nearest-rank
p50/p95/p99 intervals. Quantiles retain at most 8,192 interval samples; longer
runs keep exact aggregate counts and extrema while publishing the number of
samples omitted from quantiles. A new timing or keyframe sequence resets the
statistics, and an immediate update clears them. Keyframe statistics cover the
whole sequence. These values measure the platform display callback driving the
worklet, not compositor presentation.

Hosts may independently implement `session.cancel(timestamp)`. Cancellation
stops any active timing, keyframe sequence, spring, or decay and synchronously
returns the exact input vector from the last evaluated native frame. The
session validates that the result is complete and finite before replacing its
Solid-side mirror, so a later named partial animation resumes from what the user
actually saw instead of an earlier JavaScript target. A missing capability,
host exception, malformed vector, or stale timestamp fails closed without
advancing the mirror or its clock. Cancellation does not publish another frame,
discard cadence diagnostics, destroy the graph, or detach an owned pan gesture;
spring velocity and decay speed become zero while their last position/elapsed
diagnostics remain inspectable.

Hosts may independently implement `session.spring`. Its required definition
contains bounded mass, stiffness, damping, normalized initial velocity, rest
speed/displacement thresholds, and a hard duration cap:

```ts
session.spring(
  { progress: 1 },
  {
    mass: 1,
    stiffness: 100,
    damping: 10,
    initialVelocity: 0,
    restSpeedThreshold: 0.01,
    restDisplacementThreshold: 0.001,
    maximumDurationMilliseconds: 5_000,
  },
  performance.now(),
);
```

The portable reference evaluates the closed-form damped harmonic oscillator,
including underdamped, critically damped, and overdamped regimes. Position and
velocity therefore depend on elapsed time rather than display-callback count;
position may overshoot the target. Velocity uses normalized input-vector
progress per second, so one spring advances the complete vector atomically.
Crossing both rest thresholds or the maximum duration snaps to the exact target.
A replacement driver starts from the latest evaluated host vector, while an
immediate update cancels the spring.

Hosts may independently implement `session.decay` for gesture-release and
other inertial motion. Velocities are named graph-input units per second;
unspecified inputs receive zero velocity and the host advances the complete
vector atomically:

```ts
session.decay(
  { offsetX: 1_200, offsetY: -240 },
  {
    deceleration: 2,
    velocityThreshold: 1,
    maximumDurationMilliseconds: 5_000,
  },
  performance.now(),
);
```

`deceleration` is exponential velocity loss per second. The analytical
reference derives one terminal time from the maximum absolute input velocity,
the threshold, and the hard duration cap. Every input therefore stops together
at a refresh-rate-independent endpoint. Inspection exposes elapsed display
time, maximum current speed, and bounded frame statistics. A replacement
driver begins at the latest evaluated host vector; immediate updates, timings,
springs, pan input, and owner disposal cancel the decay.

Hosts may also implement the native pan-input extension. Both axes name
declared graph inputs and have finite, strictly ascending bounds:

```ts
session.attachPanGesture({
  xInput: "offsetX",
  yInput: "offsetY",
  minX: -120,
  maxX: 120,
  minY: -80,
  maxY: 80,
  releaseDecay: {
    deceleration: 12,
    velocityThreshold: 5,
    maximumDurationMilliseconds: 1_000,
  },
});
```

Attachment transfers the session's complete input vector to the native host
until `session.detachPanGesture(timestamp)` succeeds. Each gesture begins from
the latest graph inputs, applies bounded
translation to the two selected inputs, evaluates every derived output, and
publishes the frame atomically. JavaScript `update`, `animate`, `spring`, and
`decay` calls then fail closed instead of overwriting native-owned state with a
stale mirror.
When `releaseDecay` is present, a successful gesture end transfers the native
recognizer's logical-unit velocity directly into the same analytical decay
driver. The selected x/y inputs receive velocity in units per second and every
other graph input receives zero. Pan bounds constrain the direct-touch phase;
inertial motion may continue beyond them. Before publishing the final pan frame,
the host validates both that frame and the decay's analytical terminal vector,
so a graph failure cannot expose a half-completed handoff. Cancellation never
starts inertia, and a new gesture begin interrupts an active release decay.
Detachment linearizes with any native sample, stops release decay, removes the
recognizer/listener, and returns the complete final vector. The session validates
that vector before clearing `nativeInputsOwned`, so subsequent Solid work resumes
from visible state; failures leave native ownership intact. Disposal remains the
terminal graph boundary. The in-memory host's
`dispatchPanGesture()` supplies deterministic begin/change/end/cancel reference
semantics, optional release velocities, and a gesture clock independent of
JavaScript update timestamps.

`@solid-native/animation/native` is the application-facing path. It binds one
graph to a native element, waits for the renderer's platform mount
acknowledgement, creates the backend host, and owns native teardown with the
current Solid owner:

```tsx
import { createNativeViewAnimation } from "@solid-native/animation/native";

const animation = createNativeViewAnimation(graph, {
  inputs: () => ({ progress: progress() }),
  onError: reportError,
});

return <View ref={animation.ref} />;
```

`animation.ready` resolves to `true` after installation, or `false` if its
owner ends first. After it resolves, the controller directly exposes `update`,
`animate`, `animateKeyframes`, `spring`, `decay`, `cancel`,
`attachPanGesture`, `detachPanGesture`, and `inspect`. An imperative call made
before readiness fails with a targeted error instead of racing an uncommitted
Fabric identity. The controller is single-target, cannot be rebound to another
element, reports asynchronous installation failures through `error`, `ready`,
and the optional `onError`, and is idempotently disposable.

`@solid-native/animation/react-native` remains the lower-level adapter entry
for integration code that already owns a committed `NativeNode`. Its
`createNativeViewUIWorkletHost(node)` result can be paired with
`createSolidUIWorklet(host, graph, inputs)` when an application needs to own
mount sequencing itself.

The Android and iOS adapters accept `opacity`, `translateX`, `translateY`,
`scaleX`, `scaleY`, and numeric-degree `rotation`. Translation values are
logical display units: Android converts them to device pixels while UIKit uses
them as points.
All candidate input vectors are synchronously validated, then the native graph
is evaluated again on the UI frame. Outputs are installed together before the
frame is drawn. Unknown channels, stale/uncommitted node handles, non-finite
values, non-monotonic timestamps, graph limits, and surface leaks fail closed.
Deleting the target cancels native execution defensively; ordinary sessions
are disposed earlier with their Solid owner.

Each binding advertises `uiWorklets: true` only when install, update, destroy,
and inspection methods are all present. The checked-in Pixel and signed iPhone
Release proofs verify native decoding, platform display-callback/main-thread
delivery, real mounted Fabric view properties, frame sequence/timestamp
inspection, a real touchscreen drag delivered through Android's
`OnTouchListener` or UIKit's `UIPanGestureRecognizer` without a Hermes update
callback, and terminal owner/surface teardown. The current Pixel proof runs a
five-second timing gate and validates complete cadence statistics, executes a
three-leg native keyframe sequence without JavaScript stage handoffs, then
interrupts one native spring with another, observes underdamped overshoot, and
requires an exact endpoint with zero terminal velocity. It then interrupts one
analytical decay with another from the latest native vector, requires the exact
refresh-rate-independent endpoint and zero terminal speed, and hands that
endpoint to the real pan recognizer. Android instrumentation independently
samples the mounted `View` during both spring and decay. A Pixel 9a delivered
302 frames at 16.653 ms mean and 16.652 ms p50; an iPhone 17 Pro delivered 601
frames at 8.33478 ms mean and 8.33475 ms p50/p95. Neither run dropped an
interval sample. The Pixel proof additionally verifies a real drag handing its
native release velocity to decay and continuing beyond the direct-touch
endpoint without a Hermes callback. The iOS keyframe and release-handoff paths
are Release/ARM64 compile-verified and await the next physical-device rerun.
The Pixel proof also cancels a live timing, requires the mounted output and
native sequence to remain frozen with no queued frame, synchronizes the session
mirror, and resumes a named partial timing from that vector. The matching iOS
cancellation path is Release/ARM64 compile-verified and awaits a physical rerun.
The Pixel additionally detaches the real pan after inertia, verifies that the
gesture state disappears without moving the view, and publishes the first
post-detach Solid frame from the synchronized vector. The matching iOS detach
path is Release/ARM64 compile-verified pending a physical rerun.
The application-facing ref path is physically verified on the Pixel, including
mount sequencing, a named update, output inspection, and graph disposal; the
same entry and Hermes bundle compile for generic iOS Release/ARM64.
These are single-device correctness diagnostics, not general performance claims;
concurrent independently driven values and heterogeneous driver chaining remain
open.
