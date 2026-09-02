# `@solid-native/devtools`

This package provides Solid Native's local, development-only error channel and
native recovery overlay. It imports no React component and performs no network
or file I/O.

```tsx
import {
  createDevelopmentErrorController,
  createDevelopmentErrorHandler,
} from "@solid-native/devtools";
import { installReactNativeDevelopmentErrorBridge } from "@solid-native/devtools/react-native";
import { DevelopmentErrorOverlay } from "@solid-native/devtools/solid";

const errors = createDevelopmentErrorController();
const reportNativeError = createDevelopmentErrorHandler(errors, "native");
const runtimeErrors = installReactNativeDevelopmentErrorBridge(errors);

startNativeApplication(
  () => (
    <DevelopmentErrorOverlay controller={errors}>
      <App onNativeError={reportNativeError} />
    </DevelopmentErrorOverlay>
  ),
  options,
);

// During development-client teardown:
runtimeErrors.remove();
```

`DevelopmentErrorOverlay` catches errors from its Solid subtree and renders a
native `View`/`Text`/`ScrollView`/`Pressable` recovery surface. `Retry` resets
Solid's `Errored` boundary. Errors explicitly sent to the controller replace
the subtree until dismissed, so promise rejections and adapter `onError` paths
can share the same experience without a process-global hook.

The optional `react-native` entry point installs one narrow global bridge over
React Native's existing `ErrorUtils` guard. Non-fatal guarded runtime errors are
owned by the Solid overlay by default; fatal errors are always forwarded to the
previous platform handler. Removal is idempotent and restores the predecessor
only while the bridge still owns the global slot. Set `forwardNonFatal: true`
when the React Native handler should also receive recoverable errors.

A synchronous `onDismiss` observer may repair a tracked source before retry.
The overlay waits through that native event flush and calls Solid's explicit
reset only if the fallback remains mounted, preventing two recovery paths from
reusing a reclaimed native node.

The controller retains at most 20 distinct reports by default and at most 50
when configured. Consecutive equivalent reports are coalesced, messages and
stacks are bounded, snapshots are immutable, hostile getters are isolated, and
subscriber failures cannot replace the application error. The channel is
process-local and does not upload diagnostics.

This overlay is not a platform fatal-error screen. Generated shells use Fabric
Host's dependency-free native fallback when the host, JSI binding, or initial
surface cannot start. They also install the runtime's preceding fatal handler,
so this package's deliberate forwarding hands fatal Hermes errors to the
native shell; terminal Fabric commit failures enter the same boundary directly.
The shell stops the live Fabric surface and shows generic Release UI instead of
trying to recover a potentially corrupted tree. React Native 0.87's
unhandled-rejection tracker has no reversible global registration surface, so
promise paths still use an explicit handler. Source-map symbolication is also
separate; the overlay deliberately shows only the bounded stack it receives.

The resident causal inspector, explicit-report dismiss path, guarded Hermes
runtime path, and Solid render-error retry path all pass on a tethered physical
Android device. The proof opens the inspector, switches to causal groups,
filters by an exact opaque operation ID, selects the matching group and commit,
walks to its retained cause, traverses both back levels, clears and closes the
trace, and then exercises all three recovery paths. It also verifies the
accessibility tree, single recovered subtree, wrapper-free Metro source
boundary, global-handler restoration, Activity survival, process teardown, and
package removal.

Error messages and stacks can contain credentials or user data. Keep this
package in development entry points and do not treat its retained history as a
privacy-safe telemetry payload.

Generated applications can instead use the build-aware root:

```tsx
import { DevelopmentRoot } from "@solid-native/devtools/root";

startNativeApplication(
  () => (
    <DevelopmentRoot>
      <App />
    </DevelopmentRoot>
  ),
  options,
);
```

`createSolidNativeMetroResolver` maps that entry point to the full overlay and
runtime bridge only when Metro's `dev` flag is true. Production resolution is a
pass-through component whose JavaScript imports none of the controller,
overlay, core-component, or React Native bridge implementation.

The optional network inspector instruments Solid Native's explicit transport
instead of patching `fetch` or `XMLHttpRequest`:

```ts
import { createDevelopmentNetworkInspector } from "@solid-native/devtools/network";
import { createReactNativeNetworkService } from "@solid-native/networking/react-native";

const requests = createDevelopmentNetworkInspector({
  captureRequestTargets: true,
});
const network = requests.instrument(createReactNativeNetworkService());
```

It retains a bounded local history of method, platform, status, timing, chunk
counts, byte progress, and low-cardinality failure class. Target capture is
off by default; when enabled it keeps only URL origin and path. Headers, bodies,
response text, query strings, fragments, error messages, and stacks are never
retained. When every history slot contains an active request, inspection drops
new records without blocking application traffic and exposes the count through
`droppedCount()`.

`DevelopmentNetworkPanel` from `@solid-native/devtools/solid` adds an opt-in
on-device viewer over that history. Its compact badge shows retained and active
counts; opening it lists the newest bounded request metadata and clearing it
does not cancel application requests. The wrapped application subtree keeps its
native identity while the panel opens, updates, clears, and closes.
The application, badge, and overlay slots have stable Fabric ownership. Closing
discards the detached panel tree, and reopening creates fresh native nodes
instead of attempting to reinsert nodes Fabric has reclaimed. The physical
Android development proof opens and closes both network and causal panels twice
before exercising the rest of the overlay.

The build-aware root accepts the same inspector without changing its production
behavior:

```tsx
<DevelopmentRoot networkInspector={requests}>
  <App network={network} />
</DevelopmentRoot>
```

Metro's production root ignores the development-only inspector prop and still
returns only its children; the compiled shim has no runtime imports.

The same development root can host a bounded causal timeline:

```tsx
import {
  createCausalTelemetry,
  createCausalTimeline,
} from "@solid-native/observability";
import { createDevelopmentSolidDiagnosticsController } from "@solid-native/devtools/solid-diagnostics";

const causalTimeline = createCausalTimeline({ capacity: 2_000 });
const telemetry = createCausalTelemetry({ sink: causalTimeline.sink });
const solidDiagnostics = createDevelopmentSolidDiagnosticsController();

<DevelopmentRoot
  causalTimeline={causalTimeline}
  solidDiagnostics={solidDiagnostics}
>
  <App />
</DevelopmentRoot>;
```

`DevelopmentCausalPanel` from `@solid-native/devtools/solid` adds a resident
native trace viewer. It lists a bounded newest-first operation snapshot and can
drill into the selected operation's retained transitive causes, effects, and
evicted cause count. Retained cause/effect rows are selectable, so the developer
can walk the causal graph in either direction without returning to the root
list. A bounded case-insensitive filter searches only operation names and IDs;
it never reads or renders application attributes. It exposes operation names,
IDs, status, duration, and graph shape, but no application attribute values.
Selectable rows include the opaque operation ID in their accessibility name,
which keeps repeated low-cardinality operation names individually addressable.
The explicit Groups mode summarizes weakly connected retained operations by
fixed operation-name sequence, activity/outcome counts, duration, and opaque
group ID. Selecting a group opens its bounded operation list before drilling
into the same cause/effect explorer. A group ID is the earliest retained
operation ID for local navigation, not a distributed trace ID, and shared
unresolved cause IDs keep related retained branches together without rendering
attribute values.

`@solid-native/devtools/solid-diagnostics` is a separate one-shot capture
controller shared by desktop tooling and the on-device causal inspector. Metro
substitutes its Solid development implementation only in development bundles;
the exported production shim is inert. A session owns RC3 attribution
exclusively, drains scheduled work on end, retains at most 256 newest
diagnostics, and hands all raw records to the observability package's
privacy-bounded normalizer. The controller itself opens no socket and uploads
nothing.

When `solidDiagnostics` is present, open **Trace** and press **Capture Solid**.
The panel closes while the app is exercised and the badge changes to **Stop
Solid**. Stopping reopens the panel with named Solid rerun totals correlated to
same-window native-output → commit → mount → frame chains. This is a validated
static-name/window correlation, not an exact per-rerun join. It renders neither
reactive values nor diagnostic cause names, and an active panel-owned session
is disposed automatically if the root unmounts.

Snapshots refresh only when the panel opens or the developer presses
`Refresh`. This is a correctness boundary: rendering the inspector creates
Fabric telemetry of its own, so a view subscribed live to that same timeline
would continuously cause itself. The application subtree keeps its native
identity while the panel opens, filters, navigates, clears, and closes. The
controlled native filter also retains its own identity across keystrokes so an
active keyboard/focus session is not interrupted. Metro's production root
ignores the timeline prop, and the generated Release entry does not allocate a
timeline.

For one source path in both build modes, use the second Metro-selected helper:

```tsx
import { createInspectableNetworkService } from "@solid-native/devtools/network-service";
import { createReactNativeNetworkService } from "@solid-native/networking/react-native";

const network = createInspectableNetworkService(
  createReactNativeNetworkService(),
  { captureRequestTargets: true },
);

<DevelopmentRoot networkInspector={network.inspector}>
  <App network={network.service} />
</DevelopmentRoot>;
```

Development bundles resolve the helper to the recorder and panel-compatible
inspector. Production bundles validate the inputs, return the exact original
`NetworkService`, set `inspector` to `undefined`, and load none of the recorder.
