# `@solid-native/cli`

Local development CLI for project creation, native generation,
autolinking/codegen, running, diagnostics, testing, builds, and upgrades. The
implemented commands include a fail-closed project scaffold, a read-only
environment/project diagnostic, and a transparent local device runner:

```sh
solid-native create MyApp --package-name dev.example.myapp --title "My App"
solid-native add navigation
solid-native build ios -- --scheme MyApp
solid-native build android -- --tasks bundleRelease
solid-native bundle ios -- --max-workers 4
solid-native bundle ios --hermes-source
solid-native bundle android --hermes-source
solid-native bundle sources android/app/build/generated/sourcemaps/react/release/index.android.bundle.map --require app:///src/index.tsx --forbid-containing /node_modules/react/
solid-native bundle verify ios/build/solid-native-bundle/solid-native-bundle.json
solid-native device status-ios dev.example.myapp --device CORE_DEVICE_ID
solid-native device stop-ios dev.example.myapp --device CORE_DEVICE_ID
solid-native device-proof --help
solid-native release --help
solid-native debug capture-android dev.example.myapp --serial DEVICE_SERIAL
solid-native debug capture-android dev.example.myapp --serial DEVICE_SERIAL | solid-native debug inspect -
solid-native debug capture-android dev.example.myapp --serial DEVICE_SERIAL | solid-native debug trace - > causal-trace.json
solid-native debug capture-ios dev.example.myapp --device CORE_DEVICE_ID | solid-native debug inspect -
solid-native debug capture-ios dev.example.myapp --device CORE_DEVICE_ID | solid-native debug trace - > causal-trace.json
solid-native debug diagnostics-android dev.example.myapp --serial DEVICE_SERIAL --duration 1000
solid-native debug diagnostics-ios dev.example.myapp --device CORE_DEVICE_ID --duration 1000
solid-native debug report-android dev.example.myapp --serial DEVICE_SERIAL --duration 1000 --output causal-report.html
solid-native debug report-ios dev.example.myapp --device CORE_DEVICE_ID --duration 1000 --output causal-report.html
solid-native debug diagnostics-inspect solid-diagnostics.json
solid-native debug correlate solid-diagnostics.json causal-timeline.json
solid-native debug watch-android dev.example.myapp --serial DEVICE_SERIAL
solid-native debug watch-ios dev.example.myapp --device CORE_DEVICE_ID --interval 2000 --count 10
solid-native debug watch-android dev.example.myapp --serial DEVICE_SERIAL --json > causal-inspections.ndjson
solid-native debug compare baseline.json candidate.json --max-p95-regression 20
solid-native debug compare baseline.json candidate.json --json
solid-native debug inspect causal-timeline.json --operation commit-42
device-snapshot-command | solid-native debug inspect - --operation commit-42
solid-native debug report causal-timeline.json --diagnostics solid-diagnostics.json --operation commit-42 --output causal-report.html
device-snapshot-command | solid-native debug report - --output causal-report.html
solid-native debug trace causal-timeline.json > causal-trace.json
device-snapshot-command | solid-native debug trace - > causal-trace.json
solid-native debug symbolicate main.jsbundle.map --at 427:19 --at 439:7
solid-native debug symbolicate main.jsbundle.map --stack device.stack
device-stack-command | solid-native debug symbolicate main.jsbundle.map --stack -
solid-native doctor
solid-native fingerprint --platform all --json
solid-native doctor --platform ios
solid-native doctor --platform android --json
solid-native doctor --platform android --strict
solid-native doctor --cwd path/to/application
solid-native generate --platform all
solid-native logs android dev.example.myapp --serial DEVICE_SERIAL
solid-native logs ios dev.example.myapp --device CORE_DEVICE_ID --restart
solid-native open android dev.example.myapp 'dev.example.myapp://settings' --serial DEVICE_SERIAL
solid-native open ios dev.example.myapp 'dev.example.myapp://settings' --device CORE_DEVICE_ID --cold
solid-native start -- --port 8081
solid-native test
solid-native test test/navigation.test.tsx
solid-native test --production
solid-native run ios -- --device CORE_DEVICE_ID --mode Release
solid-native run android -- --device DEVICE_SERIAL --mode release
solid-native upgrade react-native --cwd path/to/current-app --candidate path/to/installed-candidate
solid-native upgrade react-native --cwd path/to/current-app --candidate path/to/installed-candidate --json
```

`create` delegates the base platform projects to the exact upstream React
Native 0.87 community template, always with dependency and CocoaPods
installation disabled. It validates the generated shape before changing any
file, then installs the package-owned iOS application, Android surface,
BindingsInstaller, app-level CMake/JNI entrypoint, OXC Metro worker, and a small
Solid starter whose typed graph drives a native UI-thread animation through the
application-facing ref API. The generated `ios` and `android` projects stay visible and
application-owned. JavaScript dependencies are installed only after the
manifest contains the complete Solid Native and pnpm 9 pins plus the verified
`react-native-safe-area-context` 5.8.1 native-component dependency. The latter
is consumed through Solid-owned core facades; its React wrapper is not part of
the generated root. `--skip-install` leaves that final step to the caller.
Existing targets are never replaced.
`--dry-run --json` emits the exact upstream command and target without creating
anything.
Successful creation keeps the upstream scaffold's React-oriented banner and
run instructions out of the Solid Native first-run output, then prints the
application-local doctor and Metro commands. Recent upstream output is retained
within a fixed bound and replayed when scaffolding fails, while the later
package installation remains visible as it runs. Creation rechecks that the
target is absent immediately before the upstream command and explicitly
disables upstream replacement. An upstream failure or rejected Solid Native
conversion removes only that newly created regular-directory scaffold so the
same command can be retried; an unexpected non-directory target fails closed,
and a converted project remains available when dependency installation alone
fails.

`add navigation` installs the CLI-matched `@solid-native/navigation` release and
the exact verified `react-native-screens` backend. It copies the
content-addressed patch shipped by the navigation package into the
application, merges only its `pnpm.patchedDependencies` entry, and reinstalls
so the patch is applied to native sources. A different application-owned patch,
dependency declaration, package identity, backend contract, digest, redirected
path, or concurrently changed manifest fails closed. Existing exact
declarations use an idempotent install path, which supports private registries,
local packed artifacts, and migrations. `--dry-run` is non-mutating and exposes
the complete plan; `--json` is available only with that mode. Success also
requires the final installed core, navigation, and screens identities plus every
reviewed patched native file to match the shipped contract. Other capability
recipes remain explicit future work rather than partially configured installs.

The generated app includes `test/App.test.tsx` and maps `pnpm test` to
`solid-native test`. The runner discovers conventional test/spec files beneath
`test/`, compiles TS and TSX through the shared Solid universal OXC pipeline,
and invokes Node's built-in test runner under the browser and development
export conditions. This makes Solid's structured diagnostics and attribution
available to application tests by default. Use `--production` for a separate
optimized-runtime semantics pass.
Use `pnpm test -- --watch` to rerun affected tests as imported files change, or
`pnpm test -- --test-name-pattern "counter"` to focus matching test names.
Explicit files or directories must remain inside the application. The plan is
inspectable with `--dry-run --json`, file count and module bytes are bounded,
and the subprocess receives the same interrupt-safe lifecycle as native build
commands. This deterministic host path does not claim Fabric, Yoga, OS UI, or
device performance coverage.

`doctor` discovers the nearest project from nested directories, validates
Node.js and the exact device-verified React Native backend, requires the Solid
Native core/runtime pair, and recognizes a package-manager pin inherited from a
monorepo root. For applications it also requires the exact Solid singleton and
React Native Codegen/Gradle/Hermes toolchain, the installed Solid OXC/Metro
worker, resolver, and safe full-reload policy, a Solid-owned runtime entrypoint,
and an ancestor pnpm lockfile. It also requires the application-local Hermes
compiler to match the exact compiler dependency of the installed React Native
package, executes `hermesc -version`, and rejects an unexpected release or HBC
format before a native build can produce a launch-time bytecode abort. Native
checks cover Fabric and Hermes configuration, the Gradle
wrapper, Android SDK, JDK, adb, Podfile, Xcode, and CocoaPods. The version-pinned
startup chain includes package-exported Gradle/pod integration, Android CMake
target configuration, JNI registration, Android `bindingsInstaller`, the
package-owned Android `SolidNativeSurface`, and the production iOS
`SolidNativeFabricApplication` empty-surface bootstrap. A declared dependency
without its compiler, JavaScript, or native wiring therefore fails instead of
producing a misleading green report.

The package check requires matching core/runtime declarations, matching
installed manifest versions, exact-declaration agreement, and the selected
platform's real package export (`./android-gradle` or `./ios-podspec`) with a
present in-package target. This catches stale or incomplete installs before
Gradle, CocoaPods, or Hermes sees them.

Human output includes a remediation beside every warning or failure. `--json`
emits the stable schema-versioned report for CI. The process exits 1 when a
required check fails and 2 for invalid command-line input; warnings do not make
an otherwise usable environment fail. Add `--strict` in release CI to exit 1
when either a warning or failure remains. Strict mode does not mutate the
report's stable `ok` meaning (`false` only for failed required checks), so JSON
consumers can distinguish policy failure from an unusable environment through
the summary counts.

Android commands preserve an explicit `JAVA_HOME`. When it is absent, `doctor`,
`run android`, and `build android` discover Android Studio's bundled JBR on the
current platform and use the same resolved JDK for validation and execution.
Dry-run plans print that environment default, so an otherwise hidden difference
from the shell's `java` is inspectable before Gradle starts.

`debug inspect` is the first concrete consumer of the local causal-debug
handoff. It reads at most 16 MiB of strict UTF-8 JSON, applies the observability
package's untrusted snapshot parser, and emits a path-free count/status report.
Its schema-one output also groups retained weakly connected operations, reports
entry/terminal and unresolved-cause IDs, and links a selected operation to its
group. The local group ID is the earliest retained operation ID: it may change
after eviction and is not a distributed trace ID.
`--operation ID` reconstructs the retained ancestors, descendants, and missing
cause IDs for one event, computation, commit, mount, or frame. Custom
application attributes are omitted from both text and JSON by default;
`--show-attributes` is an explicit local disclosure because validation cannot
decide whether application-authored attributes contain private data. The
command accepts a file or bounded stdin via `-`, performs no network request,
starts no server, and exits after consuming one snapshot.

`debug compare BASELINE CANDIDATE` applies that same bounded parser to two local
snapshots and emits a deterministic aggregate regression report. It compares
operation/status counts, unresolved causal edges, evictions, discarded records,
retained-group shape, and per-operation-kind successful p95 durations without
returning custom attributes. When operation-kind counts are identical, splitting
the candidate into more retained groups is a regression because it reveals a
lost causal edge that unresolved-ID counting cannot see. Extra groups stay
informational when the candidate added operations. Increased errors or graph
incompleteness exit with status 1.
Durations are always reported, but remain informational unless
`--max-p95-regression PERCENT` supplies an explicit CI threshold; `--json`
returns the frozen schema-zero comparison. Operation IDs need not be stable
between runs. The caller remains responsible for comparing equivalent
workloads, devices, and build/release identities—the command does not infer
semantic comparability from private operation attributes.

`debug capture-android PACKAGE --serial ID` supplies a concrete one-shot adb
channel for debuggable builds. It verifies `run-as`, binds each request to a
fresh nonce and the device's numeric Android user, reads only the matching
app-private cache response, validates it, removes it, and exits. The native
receiver is inactive in non-debuggable builds. Capture prints the raw snapshot,
including application-authored attributes, so pipe it to `inspect` or `trace`
for privacy-filtered output instead of retaining it casually.

`debug diagnostics-android PACKAGE --serial ID --duration MS` and
`debug diagnostics-ios BUNDLE --device ID --duration MS` reuse the app-private
nonce mailboxes to open and close one exclusive Solid diagnostics window in a
development bundle. The returned schema-zero artifact is capped at 1 MiB and
strictly validates diagnostic codes, bounded static computation names,
dependency changes, value-free cause chains, and aggregate costs. It does not
transport diagnostic messages/data, reactive values/previews, stacks, owner
IDs, raw nodes, props, text, or rendered content. A failed capture makes one
bounded, nonce-bound best-effort end request before preserving the primary
error. Production bundles resolve an inert controller and reject the request.
`debug diagnostics-inspect ARTIFACT|-` applies the same strict 1 MiB parser to
a saved file or stdin and prints diagnostic-code counts, rerun outcomes,
retained cause counts, aggregate cost totals, and the hottest bounded static
scope/write names. `--json` emits the path-free schema-zero inspection.

`debug correlate DIAGNOSTICS SNAPSHOT` validates both bounded artifacts and
joins named Solid effect reruns to `solid-native.computation` operations that
started in the same capture window. It then follows retained graph edges through
Fabric commits, native mounts, and next-frame observations. The schema-zero
result always reports `correlationMode: "static-name-and-capture-window"` and
`exactPerRerunJoin: false`: current Solid diagnostics expose static names and
aggregate reruns, but no token that can prove which individual rerun produced
which native commit. This makes the useful cross-layer evidence machine-readable
without turning timing proximity into a stronger claim. The command reads local
files only, performs no network request, and never adds values or custom causal
attributes to its output.

`debug report-android PACKAGE --serial ID` and
`debug report-ios BUNDLE --device ID` turn that complete workflow into one live
device command. They capture the timed Solid diagnostics artifact first, take
the later causal snapshot required to contain the window, validate and
correlate both, and emit the self-contained HTML debugger to stdout or a
private atomic `--output` path that is never overwritten.
The nonce-bound transports consume their device responses, and the workflow
does not need intermediate local JSON files. Application-authored causal
attributes remain excluded unless `--show-attributes` is explicit.

`debug capture-ios BUNDLE --device ID` provides the equivalent one-shot
CoreDevice channel. It sends a fresh nonce as a launch payload URL to the
explicit bundle and device, copies only that nonce's response from the app data
container, strictly validates the CoreDevice result and snapshot, then delivers
an acknowledgement that removes the response. The command requires a timeout
from 5,000 through 30,000 milliseconds because CoreDevice itself has a
five-second floor. Ordinary store Release builds ignore the private request;
no URL scheme, socket, resident relay, or hosted account is required.

`debug watch-android` and `debug watch-ios` turn those same one-shot transports
into a bounded live terminal view. Captures are sequential, each request keeps
the nonce validation and cleanup contract above, and the CLI retains no
snapshot history. The default interval is one second; `--interval`
accepts 100 through 30,000 milliseconds, `--count` provides a finite run, and
an unbounded run stops cleanly on SIGINT or SIGTERM. Transient device failures
are retried, but three consecutive failures stop the command unless
`--max-failures` selects another bound from 1 through 100. Human and NDJSON
output contain only the privacy-safe inspection, never custom snapshot
attributes. Every iOS iteration uses CoreDevice payload delivery and may
foreground the selected application. This is a polling development client,
not a background daemon, socket relay, or hosted session.

`debug report` turns the same validated snapshot into one self-contained
offline HTML debugger. It opens with a searchable group-first timing view,
switches to individual operations, preserves deep links for both views, and
navigates from a retained group into its entries, terminals, and operations.
The operation view retains direct cause/effect navigation, ancestor/descendant
counts, and explicit unresolved-cause warnings. The file
has no external assets or network permissions and locks its fixed script and
style bytes with a content security policy. Snapshot data is base64-encoded
before embedding so application text cannot become HTML or executable code.
Application-authored attributes are not embedded unless `--show-attributes` is
explicit. The complete report is capped at 32 MiB. It is written to stdout by
default; `--output` publishes it as a private atomic file without replacing an
existing artifact.
Passing `--diagnostics ARTIFACT` adds the same strictly parsed, value-free
correlation used by `debug correlate`. The report shows Solid rerun and complete
native-frame-chain counts, one card per named output, its bounded named causes,
and links into the exact retained frame operations. The UI states that the
association is static-name/window based and not an exact per-rerun join. Static
diagnostics names are included only under this explicit option; reactive values
and implicit custom causal attributes remain excluded.

`debug trace` applies that same strict parser and byte cap, then emits a
deterministic Chrome JSON event array that can be opened directly in Perfetto.
Completed operations are duration slices; active operations extend to the
snapshot capture time; retained cause/effect relationships are visible flow
arrows. Concurrent operations of the same kind receive deterministic overflow
lanes so the output never relies on ambiguous overlapping slices. Structural
operation IDs and counters are present. Every operation slice also carries its
local retained-group ID, and each group has a summary marker with bounded
status, entry/terminal, and unresolved-cause counts. The marker labels that ID
as local retained-component identity rather than a distributed trace ID.
Application attributes remain excluded unless `--show-attributes` is explicit.
The command writes only JSON to stdout and rejects snapshots requiring more
than 50,000 retained flow arrows before allocating the expanded trace. This
makes file redirection and the Android one-shot device pipe composable without
a resident process or network request.

`debug symbolicate` resolves either up to 1,024 explicit, one-based
`LINE:COLUMN` locations or one bounded Hermes/JSC/JavaScript stack through a
canonical portable production source map. `--stack FILE` reads at most 1 MiB of
strict UTF-8 and `--stack -` accepts the same bounded input over stdin. The
parser follows the pinned React Native Hermes dialect, recognizes its native,
internal-bytecode, skipped-frame, and zero-based bytecode-offset forms, and
falls back to the pinned generic JavaScript parser when those Hermes markers
are absent. The command reruns the complete bounded map validation, supports
flat and indexed maps, reports ignored and unmapped positions, and emits only
portable `app:///` source identities rather than checkout paths. Raw error
messages and generated bundle URLs are not retained in text or JSON results.
Use `--at` for producers whose stack syntax is not one of those supported
dialects.

`fingerprint` hashes the exact runtime versions, installed Solid Native
core/runtime/compiler/Metro artifact bytes, lockfile, OXC/bootstrap, and
platform-native project inputs into deterministic SHA-256 compatibility
identities. It excludes ordinary application source and absolute paths, emits
an auditable digest for every input, bounds file count and size, and fails when
a required native input is absent. The result is deliberately unsigned; a
delivery pipeline must sign it with the release/artifact identity before a
runtime or OTA client trusts it.

`run` discovers the same nearest application, enforces the exact
device-verified React Native pin, validates the installed Solid Native
core/runtime pair, selected platform export, exact Solid and native build pins,
installed OXC/Metro worker, Metro wiring, and Solid-owned JavaScript bootstrap.
It then invokes that application's local React Native CLI directly without a
shell or a hidden package-manager shim. Invalid or partial application wiring
therefore fails even for `--dry-run`, before Gradle or Xcode starts. Native CLI
options are forwarded unchanged; `--` keeps Solid Native flags unambiguous.
Build output streams to the terminal and the native process exit status is
preserved.
Interrupt, termination, and hangup signals are forwarded to the active native
process tree on macOS and Linux, and to the direct native child on Windows,
before the CLI exits. This prevents an interrupted Gradle or Xcode invocation
from continuing in the background.
An explicit Android `--device SERIAL` or legacy `--deviceId SERIAL` is verified
through `adb` before Gradle starts. Emulators receive availability validation
only. Without an explicit selector, the CLI resolves exactly one authorized
target; zero or multiple targets fail before Gradle with an instruction to
connect one target, pass `--device`, or use `--list-devices`. This intentionally
prevents the upstream run-all default from acquiring ambiguous global device
state. The resolved serial is then passed explicitly to the same React Native
invocation, so validation and installation cannot select different targets. A
physical target must be unlocked; the CLI wakes it, dismisses a
non-secure keyguard, and temporarily sets the USB/AC charging
stay-awake mask for the build, install, and launch window. The exact prior
setting is restored after success, a non-zero native exit, or a thrown process
failure. Secure locks fail before the expensive build and also restore the
lease. A per-user, per-serial host lock prevents concurrent terminals from
competing for the same global setting. If an owning CLI is killed abruptly, the
next run recognizes the dead process and restores its bounded, token-matched
recovery record before acquiring the device. Ambiguous or corrupt ownership
metadata fails closed instead of guessing. Interactive device selection remains
upstream-owned because its exact target is not known until React Native prompts.
An explicit iOS `--device NAME_OR_ID` is known to select physical hardware, so
the CLI reads its structured CoreDevice lock state before starting React
Native. An explicit `--udid ID` is first resolved against CoreSimulator and
receives the same lock gate only when it is a physical device. Locked phones,
disabled Developer Mode, and developer-services tunnel failures therefore stop
before Metro, CocoaPods, or Xcode spends time on the build. Default and named
`--simulator` runs remain unchanged. A bare `--device` retains the upstream
"first available physical device" behavior but cannot be preflighted until the
upstream CLI resolves its identity; pass a name or identifier for the
deterministic fail-fast path.

`logs android PACKAGE` provides the first application-scoped device log stream.
It selects exactly one authorized device unless `--serial` is explicit, checks
that device is live, resolves an exact installed package UID through Android's
package manager, and runs `adb logcat --uid=...` so JavaScript and native records
remain visible across application process restarts without mixing in unrelated
device logs. It defaults to `-T 1`; `--since` accepts another bounded logcat
time or count. Dry-run discovery is read-only and exposes the serial, UID, and
fully quoted command as text or schema-versioned JSON. Live output is never
wrapped in JSON, retained, uploaded, or parsed by the CLI, because application
logs can contain private data. Interrupt, termination, and hangup signals are
forwarded to the detached adb process group.

`logs ios BUNDLE --device ID --restart` is the bounded CoreDevice counterpart.
It first uses Xcode's machine-readable app inventory to require exactly one
developer-installed bundle on the explicit device. Because CoreDevice can
connect application standard streams only during launch, `--restart` is a
mandatory acknowledgement: the live command replaces the existing app,
attaches `devicectl`'s launch console, and terminates that app when the stream
is interrupted. It does not claim historical output or continuity across a
later app restart. Dry runs perform only the installed-app lookup and expose
the exact launch plan. Live records remain unparsed and unretained; terminal
signals are forwarded to the isolated CoreDevice process group, handlers are
removed on exit, and an interrupted CLI returns the conventional signal exit
code instead of leaving a streamer or app behind.

`device status-ios BUNDLE --device ID` and `device stop-ios BUNDLE --device ID`
make that lifecycle state explicit without relying on a test runner. Both first
require exactly one developer-installed application for the supplied bundle and
map only processes whose CoreDevice executable URL is inside that exact app
installation. Status is read-only and can emit schema-zero JSON. Stop targets
only the observed process identifiers, keeps polling for replacement process
generations, and succeeds only after four clean polls spanning one second. It
is idempotent, never uninstalls the app, and fails after a bounded relaunch loop
instead of claiming cleanup. This is a local safety control for development
devices, not remote application management.

`open android PACKAGE URL` and `open ios BUNDLE URL` provide application-targeted
physical-device deep-link delivery. Both validate an absolute URL, perform
read-only device and installed-app discovery before producing an inspectable
plan, and consume a platform acknowledgement after delivery. Android adds an
explicit package constraint to the browsable `VIEW` intent and accepts success
only when `am start-activity -W` reports an Activity inside that package. iOS
uses CoreDevice's `--payload-url` and accepts only its bounded JSON launch
result for the verified developer-installed bundle. Default `preserve` mode
does not terminate a running app and launches it when absent; `--cold`
explicitly requests process replacement first. These commands do not claim
that an application accepted or rendered a route—application-level navigation
tests remain responsible for that assertion. URLs are visible to the local
platform tool and in optional plan/result JSON, so test links should not carry
production credentials.

`build ios|android` applies the same backend, installed-artifact,
native-project, and Android SDK checks, then delegates to the pinned
application-local `build-ios` or `build-android` command without launching a
simulator or device. It selects Release mode unless `--mode`, Android `--tasks`,
or interactive selection is forwarded explicitly. Dry-run and JSON plans
expose the exact command and non-overriding environment defaults for local CI
and signing workflows; streamed builds preserve their native exit code and
signal cleanup. React Native 0.87's Android Release mode runs `bundleRelease`,
so the generated starter's default artifact is
`android/app/build/outputs/bundle/release/app-release.aab`. An explicit
`--tasks assembleRelease` selects an APK build instead.

The upstream starter initially assigns `signingConfigs.debug` to its Release
build. This keeps local AAB production credential-free, but the result is not a
Play-distributable release. The Android doctor reports that condition as a
warning. It passes the signing-intent check only when the Release block selects
an explicit non-debug signing config, while clearly leaving keystore
availability, credential protection, and Play App Signing validation to the
application's delivery pipeline. Keys and credentials remain app-owned and
must stay outside source control.

`bundle ios|android` emits a minified production OXC/Metro bundle, composed
source map, copied asset tree, and `solid-native-bundle.json`. It fixes the compiler, platform, production
mode, entry, and output arguments while forwarding operational Metro options.
After Metro succeeds, absolute paths beneath the pnpm lock root are replaced by
portable `app:///` source identities; an invalid map or source outside that root
fails the command. Flat or indexed maps must carry bounded VLQ mappings, names,
ordered inline sections, and one embedded content string for every source.
Remote sections, mixed map forms, traversal, malformed ignore lists, excessive
nesting, and aggregate resource limits fail closed. This removes checkout-path
leakage while retaining a self-contained symbolication artifact.
The deterministic unsigned manifest records byte counts and SHA-256 digests
for the bundle, canonical map, and every bounded regular asset, then derives a
single bundle fingerprint using locale-independent path ordering. Bind that identity to the native compatibility
fingerprint and sign the resulting release metadata before trusting it for OTA
delivery.
`bundle verify` is read-only: it validates the bounded manifest schema,
recomputes the canonical fingerprint and all file digests, and compares the
complete on-disk asset set. A digest-matching source map is parsed again and
must still satisfy the canonical portable schema. Integrity mismatches return
exit status 1; malformed input returns 2. Since the manifest is unsigned,
successful verification still does not establish who produced it.

`upgrade react-native --candidate PATH` turns a prepared, isolated dependency
candidate into a deterministic read-only audit. It requires the source to be
the device-verified backend and both applications to have exact declared,
installed, and locked React Native, Hermes compiler, React, Codegen, and Gradle
plugin identities. It executes each application-local `hermesc -version`,
keeps the npm package release distinct from the normalized
`ReactNativeVersion.h` identity, and reports the resolved Metro transform
worker without assuming its version follows React Native's release number.

The command also requires the candidate Fabric Host boundary manifest to name
the exact React Native package release. It locates and hashes the bounded set
of React Native-owned headers in both package trees, reports added, removed,
moved, changed, ambiguous, and external native inputs, and emits the remaining
repository, Android, iOS, navigation, capability, performance, and memory
qualification gates. It never edits a manifest, installs a package, builds a
native target, contacts a registry, or marks an unverified backend as
supported. A successful exit means the candidate is internally coherent
enough to begin qualification; `promotionReady` remains `false` in both text
and JSON output.

`bundle sources MAP` applies an explicit dependency policy to a raw or
canonical Metro map without rewriting it. The command runs the same bounded
source-map parser, normalizes in-root absolute paths to portable `app:///`
identities in memory, requires every repeated `--require` identity exactly
once, and fails if any source contains a repeated `--forbid-containing`
fragment. Policy mismatches return exit status 1 with stable text or JSON
checks; malformed maps, escaping paths, duplicate policy entries, and empty
policies return 2. This lets applications prove wrapper-free generated native
boundaries in Release automation without carrying their own source-map parser.

`bundle ios|android --hermes-source` reproduces the non-minified Metro input
consumed by React Native's Release Hermes tasks; Android also retains the exact
packager-map naming used by Gradle.
`release verify-android-signing AAB|APK` verifies the produced Android artifact
without reading a keystore. For an AAB, the selected JDK's `jarsigner` and
`keytool` strictly verify every entry and require exactly one non-debug upload
certificate. For an APK, the newest stable Android SDK `apksigner` verifies all
Android versions declared as supported by the manifest and returns the exact
bounded, non-debug certificate set, including version-targeted key rotation.
Repeat `--expected-certificate-sha256 HEX` to pin that complete APK set; AABs
accept one upload-certificate pin. A failed policy exits 1; malformed input or
unavailable tools exit 2. `release create
--android-upload-certificate-sha256 HEX` binds an AAB, while repeated
`--android-signing-certificate-sha256 HEX` values bind an APK. `release verify`
repeats the selected proof automatically. This does not establish Play
acceptance or the app-signing certificate Google may apply during distribution.
Every tool is bounded to 30 seconds and 256 KiB of combined retained output;
timeout or truncation fails closed. Inspection uses a private immutable
snapshot, requires temporary free space approximately equal to the artifact,
and removes the snapshot afterward.
`release create --inspect-embedded-bundle` validates the IPA or APK/AAB ZIP
entry, Hermes bytecode version, internal checksum, and source hash, then
recompiles with the pinned compiler. Android requires exact bytecode SHA-256
equality. iOS does too when Xcode emitted a Hermes source map; ordinary iOS
builds additionally canonicalize the sole length-prefixed Xcode intermediate
filename and Hermes footer before requiring complete bytecode equality. The
verifier repeats the proof. Malformed, duplicate, encrypted, oversized, or
mismatched archives fail closed. Bounded single-disk ZIP64 archives use the same
limits and proof; multi-disk archives remain unsupported.

`release create` combines a verified bundle manifest, the current platform's
native compatibility identity, bounded release/channel/revision metadata, and
the streamed digest of a final native binary into `solid-native-release.json`.
For an AAB, `--android-upload-certificate-sha256 HEX` additionally requires and
records its non-debug upload signer. For an APK, repeat
`--android-signing-certificate-sha256 HEX` for its complete reviewed signer set.
`release verify` rechecks the canonical envelope, binary, any bound Android
signing identity, full bundle set, and native checkout. The envelope is
intentionally unsigned: a trusted pipeline must prove the claimed source
produced the artifact and sign the delivery statement. See
[the release contract](../../docs/release-envelopes.md).

`release sign` adds a deterministic detached Ed25519 statement using a
caller-managed private key. Supplying `--bundle` and `--artifact` makes it
recheck the final binary, bundle set, embedded Hermes linkage, and current
native compatibility before reading the key and signing; a failed check cannot
produce a signature. Omitting both preserves envelope-only signing for an
isolated signer that cannot access build outputs. `release signing-request`
emits the exact contextual payload plus its SHA-256 for an offline, HSM, or KMS
signer. `release assemble-signature` accepts 64 raw Ed25519 signature bytes or
canonical base64url, verifies them with the supplied public key, and writes the
same detached statement without ever reading a private key. The unsigned
request is a signing instruction, not proof that its build was authorized.
`release verify-signature`
accepts either a separately pinned public key/key ID plus trusted scope flags,
or a versioned `--trust-policy` file containing the scope and up to 32 canonical
Ed25519 SPKI keys marked `active` or `revoked`. It rejects a changed envelope,
unknown or revoked key, invalid signature, or cross-scope release and returns
status 1 for trust mismatches. Trust policies carry a required positive
sequence, are normalized into a deterministic fingerprint, and can be checked
against `--minimum-policy-sequence` so a delivery system can reject a policy
older than its persisted high-water mark. Verification
requires either paired `--bundle`/`--artifact` inputs or an explicit
`--envelope-only` mode. Paired inputs rerun the complete release proof and a
failure prevents authorization. Optional exact release, revision, envelope,
bundle, native, and artifact digest pins support a specific rollout. A passing
report exposes `authorizedRelease`, constructed from the exact verified
manifest snapshot; its `inputsVerified` field distinguishes complete input
proof from envelope-only authentication. Failed reports omit it so consumers
do not need to reread unsigned lineage. The TypeScript API makes the two input
modes a discriminated union and narrows `ok: true` to a report with required
authorized lineage; policy-backed lineage additionally includes the exact
trust-policy fingerprint and sequence. Compile-time tests reject missing,
partial, or conflicting modes. Solid Native never embeds the private key or declares an arbitrary
policy file trustworthy. Key custody, trusted policy distribution, monotonic
rollback prevention, and audit retention remain delivery-system
responsibilities.

`release symbolication` is the open boundary to a selected symbolication
backend. It accepts the same pinned-key or trust-policy inputs as signature
verification but always requires the bundle manifest and final native artifact;
envelope-only evidence is rejected. After repeating signature, policy, native,
bundle, and source-map validation, it emits a frozen schema-v0 descriptor whose
`authorizedRelease` is exactly the verifier output also consumed by runtime
telemetry. The descriptor carries the local generated-bundle and source-map
paths, their signed byte counts and SHA-256 digests, entry point, and minification
mode without choosing a vendor:

```sh
solid-native release symbolication solid-native-release.json.sig.json \
  --manifest solid-native-release.json \
  --trust-policy production-ios-trust.json \
  --minimum-policy-sequence 7 \
  --bundle ios/build/solid-native-bundle/solid-native-bundle.json \
  --artifact ios/build/SolidNative.ipa \
  --json
```

The absolute `localPath` values are ephemeral uploader inputs and are excluded
from every fingerprint. A backend adapter must compare the declared byte count
and digest at the last practical moment before transport; the handoff does not
turn a mutable path into authenticated storage. Solid Native performs no
network request and reads no vendor credential at this boundary.
For local debugging, `debug symbolicate` can resolve explicit generated
positions or a bounded local stack directly from the validated map; unlike the
release handoff, it does not authenticate a release or prepare an upload.

On Android, a standard SDK location discovered by the same logic as `doctor`
appears in the plan as an `ANDROID_HOME` environment default. Execution applies
it only when neither the caller nor process already supplies that variable;
explicit `ANDROID_HOME` or `ANDROID_SDK_ROOT` configuration remains
authoritative.

`generate` delegates to the pinned application's React Native Codegen command,
with explicit project root, platform, and app/library source semantics. Its
default native output is isolated under `build/solid-native-codegen`;
`--output` resolves another artifact root inside the application. The isolated
default is intentional: React Native's app-level Codegen discovers dependency
schemas too, merges their artifacts into one directory, and does not remove
files for schemas that disappear. Writing that result into Gradle's app-level
Codegen directory can leave dependency implementations there and later link
them a second time beside their autolinked libraries. Each execution also uses
a fresh sibling staging tree. A nonzero upstream exit preserves the previous
native and Solid outputs; success publishes both together and removes the old
tree, so obsolete generated sources cannot survive an otherwise successful
run. A publication error rolls both artifacts back to their last good state.
When
`package.json` contains a `components`, `modules`, or `all` `codegenConfig`,
successful native generation also parses that same spec through
`@solid-native/codegen` and atomically writes
`generated/<codegenConfig.name>.ts`. Component schemas produce typed Solid
factories, props, command shims, and frozen host descriptors. Module schemas
produce raw TurboModule ABI types, injected-registry resolvers, callable-surface
validation, and frozen audit metadata; mixed schemas contain both. Native
values still enter portable application code through an explicit validating
adapter. Repeating `--solid-library PACKAGE` opts direct, installed dependencies
into the same atomic module. The plan validates each declared package identity,
modern Codegen config, and package-contained source root before parsing; mixed
app/dependency output defaults to `generated/SolidNativeBindings.ts`.
`--solid-output` selects another app-local `.ts` file; `--no-solid` explicitly
disables this second artifact. Dry-run JSON exposes it as `solidBindings`,
including its effective `components`, `modules`, or `all` kind and every
application/dependency input. Generated modules also export a deeply frozen,
portable `SOLID_NATIVE_BINDING_MANIFEST`: it records package/library identity
and installed versions without local paths, plus a deterministic SHA-256 over
those inputs and the emitted ABI surface. This is audit identity, not a
signature or proof that dependency source is trusted.

`generate --check` is the read-only CI half of this workflow. It rebuilds the
expected Solid module in memory, compares exact bytes, and reports `match`,
`missing`, `stale`, or `unreadable` without invoking React Native Codegen or
writing any file. It exits `1` for every non-match and supports stable JSON.

`generate --audit` is the discovery half. It parses the application and
explicit `--solid-library` schemas without evaluating their React-facing
JavaScript wrappers, then reports reusable component descriptors, raw
TurboModule surfaces, interface-only components, platform exclusions, and
path-free package/version inputs. Explicit dependency selection fails when a
package declares Codegen but its configured source exposes no surface matching
the declared kind; a stale `codegenConfig` on a legacy native module therefore
cannot produce an empty but apparently valid binding manifest. The report is
suitable for a compatibility catalog or upgrade diff, but is deliberately not
a device-support claim: interface-only components need an independently
reviewed native registration path, and every emitted surface still needs
integration and physical evidence.

`compatibility check` reconciles those discoveries with the app-owned
`solid-native.compatibility.json` catalog (or `--catalog FILE`). Catalog
packages use exact installed versions and Codegen library identities. Every
claim names one package, schema category, surface, platform, and evidence
level: `schema-discovered`, `binding-generated`, `native-integrated`, or
`device-verified`. All levels beyond discovery require at least one portable
application-relative evidence path paired with its lowercase SHA-256 digest.
Unknown fields, duplicate claims, version drift, category drift, platform
exclusion, missing surfaces, missing or modified evidence, path traversal, and
symlink escape fail closed. Each dependency is re-audited in isolation, so an
identically named application or neighboring dependency surface cannot satisfy
its claim. The report also retains package identity for every
discovered-but-unclaimed surface.

`compatibility evidence FILE...` hashes 1-16 contained application files and
prints normalized, ready-to-paste evidence entries. `--json` returns the
bounded structured report. The command accepts paths relative to `--cwd`,
rejects missing files, directories, duplicates, path escape, and physical
symlink escape, and never edits the catalog. A digest update therefore remains
an explicit review decision instead of automatically blessing changed proof.

```json
{
  "evidence": [
    {
      "path": "adapters/RNExample.ts",
      "sha256": "<64 lowercase hexadecimal characters>"
    }
  ]
}
```

This command checks catalog consistency and reviewed evidence bytes; it does
not execute proof scripts or turn an authored `device-verified` claim into
fresh device evidence. CI should run both the catalog check and the referenced
physical suites at the cadence required by its release policy.

`device-proof sign RECEIPT` validates the current strict Android schema,
including the exact passing test identity, physical-device marker, clean Git
revision, native-compatibility identity, generated bindings, wrapper-free
source policy, APKs, and instrumentation result. It then hashes the exact
receipt bytes and signs a small path-free statement with a caller-managed
Ed25519 key. The statement includes a required project name supplied by the
signing policy and uses the domain-separated
`solid-native.device-proof-signature.v0` context, so neither a device-proof
signature nor its digest can be replayed as a release signature. Symlinked or
oversized inputs, non-Ed25519 keys, unsafe key IDs, group/world-readable POSIX
private keys, dirty receipts, and files that change during signing fail before
publication.

`device-proof verify-signature` requires the exact receipt and either a
separately pinned public key, key ID, and project name or one bounded versioned
trust-policy file. A policy carries the Android proof scope, project, positive
monotonic sequence, and up to 32 canonical Ed25519 SPKI keys marked `active` or
`revoked`. Its normalized fingerprint is independent of key order.
`--minimum-policy-sequence` lets a caller reject a policy older than its
persisted high-water mark. The local file is an input, not a trust root;
trusted distribution and high-water state remain the caller's responsibility.
Optional exact receipt, source revision, native-compatibility, and application
APK pins let a pipeline constrain one intended build. Inclusive
`--minimum-measured-at` and `--maximum-measured-at` bounds reject a signed run
outside a canonical UTC window. These bounds trust the lab's signed receipt
clock; they are replay policy, not an independent timestamp authority.

A machine-readable report separates proof, trust-policy, key, cryptographic
signature, project-policy, lineage, and time-policy checks. Only an all-pass
result carries `authenticatedProof`, a privacy-safe lineage summary with the
source revision, native fingerprint, application APK digest, device model,
measurement time, and authenticated key. Policy-backed success also stamps the
exact policy fingerprint and sequence. Every report carries the normalized,
frozen `policy` that was actually applied, including its exact pins and time
bounds, so audit code need not reconstruct the decision from process arguments.
A failure omits authenticated lineage and returns status 1.
This authenticates retained execution evidence; it does not authorize an app
release, infer that a local policy is trusted, generate keys, or provide
HSM/KMS custody and audit retention.

`device-proof ingestion` applies the same pinned-key or trust-policy verifier,
then rereads the bounded receipt and requires its digest to remain identical at
the handoff boundary. It returns a deeply frozen, uploader-neutral descriptor
containing authenticated lineage, non-unique device/OS/power context, native
compatibility, generated-binding and bundle identities, APK facts, and the
instrumentation result. Its `verificationPolicy` is that same normalized
verifier input. The descriptor omits local paths, the stable device serial
digest, public keys, and signature bytes. Its shape alone is not proof: an
adapter must receive it from this successful verifier invocation, then own
transport, credentials, retention, and high-water policy state.

For customer-held keys, `device-proof signing-request` emits the same canonical
contextual payload and its SHA-256 after strict receipt validation, without
reading a private key. An offline, HSM, or KMS signer returns either 64 raw
Ed25519 bytes or canonical unpadded base64url.
`device-proof assemble-signature` validates the request's internal payload,
parses the detached bytes under strict limits, verifies them with the supplied
Ed25519 public key, and only then atomically writes the ordinary signature
statement. Assembly cannot overwrite any input and never reads private-key
material. The request remains an unsigned signing instruction; external signer
policy and key custody are still outside the CLI.

`adapter create MODULE --library PACKAGE` turns one installed dependency
TurboModule schema into an editable application-owned adapter scaffold. The
command uses the same contained package discovery as binding generation,
selects the exact module and optional platform, derives an extensionless import
so Metro resolves the generated TypeScript binding, and refuses to write unless
that binding passes
`generate --check` semantics. It creates `adapters/MODULE.ts` by default,
supports explicit contained `--bindings` and `--output` paths, and atomically
refuses to overwrite an existing file. `--dry-run --json` exposes the complete
source and provenance without writing.

Method wrappers are deliberately not native pass-throughs: required policy
hooks receive a bound native invoker and frozen arguments, while their portable
return remains `unknown` until application validation is implemented. Event
emitters become decoder-gated, causally named Solid accessors whose
subscriptions follow the current owner. The scaffold is safe to edit and is
never regenerated over application policy code.

`start` validates the same exact backend, installed runtime pair, OXC/Metro
compiler, resolver, safe full-reload policy, and Solid-owned application
bootstrap before delegating to the application-local Metro server. Application
source edits reload the complete runtime because React Refresh cannot replace
mounted Solid owners safely; owner-preserving Solid HMR remains future work.
Arguments after `--` are forwarded unchanged. Interrupt, termination, and
hangup signals stop Metro's complete process group so its workers and listening
port do not outlive the CLI.

Inspect a stable, machine-readable execution plan without building or
installing anything:

```sh
solid-native create MyApp --skip-install --dry-run --json
solid-native fingerprint --platform android --json
solid-native bundle android --output /tmp/app-bundle --dry-run --json
solid-native start --dry-run --json -- --port 9090
solid-native build ios --dry-run --json -- --scheme MyApp
solid-native generate --cwd path/to/application --platform ios --solid-library @react-native-async-storage/async-storage --dry-run --json
solid-native generate --cwd path/to/application --platform all --solid-library @react-native-async-storage/async-storage --check
solid-native generate --cwd path/to/application --platform all --solid-library react-native-screens --audit --json
solid-native compatibility check --cwd path/to/application --json
solid-native device-proof sign android-device-proof.json --key device-private.pem --key-id lab-1 --project example-app
solid-native device-proof signing-request android-device-proof.json --key-id lab-hsm-1 --project example-app
solid-native device-proof assemble-signature android-device-proof.json.signing-request.json --signature device-proof-signature.bin --public-key device-public.pem
solid-native device-proof verify-signature android-device-proof.json.sig.json --proof android-device-proof.json --public-key device-public.pem --key-id lab-1 --project example-app --json
solid-native device-proof verify-signature android-device-proof.json.sig.json --proof android-device-proof.json --trust-policy device-lab-trust.json --minimum-policy-sequence 7 --json
solid-native device-proof ingestion android-device-proof.json.sig.json --proof android-device-proof.json --trust-policy device-lab-trust.json --minimum-policy-sequence 7 --json
solid-native adapter create RNAsyncStorage --cwd path/to/application --library @react-native-async-storage/async-storage --dry-run --json
solid-native run ios --cwd path/to/application --dry-run --json -- --udid DEVICE_ID
solid-native run android --cwd path/to/application --dry-run -- --device DEVICE_SERIAL
solid-native logs android dev.example.myapp --serial DEVICE_SERIAL --dry-run --json
solid-native logs ios dev.example.myapp --device CORE_DEVICE_ID --restart --dry-run --json
solid-native open android dev.example.myapp 'dev.example.myapp://settings' --serial DEVICE_SERIAL --dry-run --json
solid-native open ios dev.example.myapp 'dev.example.myapp://settings' --device CORE_DEVICE_ID --dry-run --json
```

In this repository, build and dogfood it with:

```sh
pnpm --filter @solid-native/cli build
node packages/cli/dist/bin.js doctor --cwd apps/native-e2e
node packages/cli/dist/bin.js fingerprint --cwd apps/native-e2e
node packages/cli/dist/bin.js start --cwd apps/native-e2e --dry-run
node packages/cli/dist/bin.js bundle android --cwd apps/native-e2e --dry-run
node packages/cli/dist/bin.js bundle verify path/to/solid-native-bundle.json --json
node packages/cli/dist/bin.js build android --cwd apps/native-e2e --dry-run
node packages/cli/dist/bin.js generate --cwd apps/native-e2e --platform all --dry-run
node packages/cli/dist/bin.js run android --cwd apps/native-e2e --dry-run -- --device DEVICE_SERIAL
node packages/cli/dist/bin.js logs android dev.solidnative.e2e --serial DEVICE_SERIAL --dry-run
node packages/cli/dist/bin.js logs ios dev.solidnative.e2e --device CORE_DEVICE_ID --restart --dry-run
node packages/cli/dist/bin.js open android dev.solidnative.e2e 'dev.solidnative.e2e://navigation/settings' --serial DEVICE_SERIAL --dry-run
node packages/cli/dist/bin.js open ios dev.solidnative.e2e 'dev.solidnative.e2e://navigation/settings' --device CORE_DEVICE_ID --dry-run
```

The runner has been dogfooded through Release build, install, and launch on the
repository's physical Pixel and signed iPhone targets. The generator has emitted
the app's custom native component descriptors and bindings for both platforms
into an isolated artifact tree. A registry-shaped local package installation of
the generated application has type-checked, produced a Release OXC/Metro
bundle, compiled the external-Kotlin Android template and package-owned C++
seam, installed on the physical Pixel, and mounted a fine-grained counter update
after an operating-system tap. The same artifact-installed application has
applied `solid-native add navigation`, verified the patched backend, resolved
`RNScreens` through CocoaPods, and compiled, signed, installed, and launched as
a Release build on the physical iPhone.

The CLI leaves Xcode and Gradle projects visible and editable. External
automation may perform the same operations, but local production builds remain
fully supported.
