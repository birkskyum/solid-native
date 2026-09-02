# Developer platform

The developer platform keeps the native workflow inspectable and locally
operable. Xcode, Gradle, artifacts, compatibility checks, and release evidence
remain available without a required remote control plane.

## Local open-source workflow

Developers must be able to:

- Create a project
- Generate and inspect native projects
- Build and run locally
- Add native modules through autolinking/codegen
- Use a development client
- Receive JavaScript/TSX updates during development
- Debug source maps and inspect the Solid graph/native tree
- Inspect and export a causal event/reactivity/commit timeline locally
- Run unit and device integration tests
- Upgrade the runtime with explicit compatibility diagnostics
- Produce store-ready binaries without a hosted account

## CLI responsibilities

The first executable commands are:

```text
solid-native create NAME [--directory PATH] [--package-name ID] [--title TITLE]
solid-native build ios|android [--cwd PATH] [--dry-run] [--] [native options]
solid-native bundle ios|android [--cwd PATH] [--output PATH] [--hermes-source] [--dry-run]
solid-native bundle verify MANIFEST [--json]
solid-native debug compare BASELINE CANDIDATE [--max-p95-regression PERCENT] [--json]
solid-native debug inspect SNAPSHOT|- [--operation ID] [--show-attributes] [--json]
solid-native debug report SNAPSHOT|- [--diagnostics ARTIFACT] [--operation ID] [--show-attributes] [--output FILE]
solid-native debug trace SNAPSHOT|- [--show-attributes]
solid-native debug capture-android PACKAGE --serial ID [--timeout MS]
solid-native debug capture-ios BUNDLE --device ID [--timeout MS]
solid-native debug diagnostics-android PACKAGE --serial ID [--duration MS] [--timeout MS]
solid-native debug diagnostics-ios BUNDLE --device ID [--duration MS] [--timeout MS]
solid-native debug report-android PACKAGE --serial ID [--duration MS] [--timeout MS] [--show-attributes] [--output FILE]
solid-native debug report-ios BUNDLE --device ID [--duration MS] [--timeout MS] [--show-attributes] [--output FILE]
solid-native debug diagnostics-inspect ARTIFACT|- [--json]
solid-native debug correlate DIAGNOSTICS SNAPSHOT [--json]
solid-native debug watch-android PACKAGE --serial ID [--interval MS] [--count N] [--json]
solid-native debug watch-ios BUNDLE --device ID [--interval MS] [--count N] [--json]
solid-native debug symbolicate MAP (--at LINE:COLUMN... | --stack STACK|-) [--json]
solid-native doctor [--platform all|ios|android] [--cwd PATH] [--json]
solid-native fingerprint [--platform all|ios|android] [--cwd PATH] [--json]
solid-native generate [--platform all|ios|android] [--cwd PATH] [--output PATH]
solid-native logs android PACKAGE [--serial ID] [--since VALUE] [--dry-run] [--json]
solid-native logs ios BUNDLE --device ID --restart [--dry-run] [--json]
solid-native device status-ios BUNDLE --device ID [--json]
solid-native device stop-ios BUNDLE --device ID [--json]
solid-native open android PACKAGE URL [--serial ID] [--cold] [--dry-run] [--json]
solid-native open ios BUNDLE URL --device ID [--cold] [--dry-run] [--json]
solid-native device-proof sign RECEIPT --key PRIVATE_KEY --key-id ID --project NAME
solid-native device-proof signing-request RECEIPT --key-id ID --project NAME
solid-native device-proof assemble-signature REQUEST --signature FILE --public-key FILE
solid-native device-proof profile RECEIPT [--json]
solid-native device-proof ingestion SIGNATURE --proof RECEIPT (--public-key FILE --key-id ID --project NAME | --trust-policy FILE [--minimum-policy-sequence INTEGER])
solid-native device-proof verify-signature SIGNATURE --proof RECEIPT --public-key FILE --key-id ID --project NAME
solid-native device-proof verify-signature SIGNATURE --proof RECEIPT --trust-policy FILE [--minimum-policy-sequence INTEGER]
solid-native run ios|android [--cwd PATH] [--dry-run] [--] [native options]
solid-native start [--cwd PATH] [--dry-run] [--] [Metro options]
solid-native release create --bundle FILE --artifact FILE --release ID --channel NAME --revision SHA [--inspect-embedded-bundle] [--android-upload-certificate-sha256 HEX | --android-signing-certificate-sha256 HEX...]
solid-native release verify-android-signing AAB|APK [--expected-certificate-sha256 HEX...] [--json]
solid-native release sign MANIFEST --key PRIVATE_KEY --key-id ID
solid-native release verify MANIFEST --bundle FILE --artifact FILE [--json]
solid-native release verify-signature SIGNATURE --manifest MANIFEST --public-key FILE --key-id ID --project NAME --platform ios|android --channel NAME (--bundle FILE --artifact FILE | --envelope-only)
solid-native release verify-signature SIGNATURE --manifest MANIFEST --trust-policy FILE [--minimum-policy-sequence INTEGER] (--bundle FILE --artifact FILE | --envelope-only)
solid-native release correlate-device-proof SIGNATURE --manifest MANIFEST --bundle FILE --artifact FILE --trust-policy FILE --device-signature FILE --proof RECEIPT --device-trust-policy FILE
```

`create` delegates the base Xcode and Gradle projects to the exact upstream
React Native 0.87 community template, validates its known shape, and then
replaces the React application root with the package-owned Solid Native
bootstrap. It wires the OXC Metro transform, source-owned Android CMake/JNI
integration, Kotlin surface lifecycle, iOS pod/application lifecycle, direct
React Native build dependencies required by pnpm's strict layout, and a small
fine-grained Solid starter. It refuses an existing target and fails before
writing when the upstream template drifts. Dependency installation happens
only after transformation, while dry-run exposes the exact upstream command.

`doctor` is read-only and returns a schema-versioned report with stable check
IDs, human remediations, and nonzero failure status. It validates the exact
device-verified React Native and Solid pins; direct Codegen, Gradle, and Hermes
build-tool pins; the installed Solid OXC/Metro worker and resolver; the
safe full-reload policy; the Solid-owned JavaScript bootstrap; an ancestor pnpm
lockfile; Solid Native core/Fabric Host/runtime alignment; the installed React Native/Hermes
compiler dependency pair; the compiler's reported release and HBC format;
Fabric/Hermes native configuration; and the relevant Xcode, CocoaPods, JDK,
Android SDK, and adb toolchain. It understands applications nested in a pnpm
monorepo without requiring every package to repeat the root package-manager pin
or lockfile.

When an application declares `@solid-native/navigation`, `doctor` also resolves
the package-exported `react-native-screens` backend contract. It requires the
exact screens peer and React Native pin, authenticates the packaged patch, and
hashes the post-patch Android/iOS sources named by the contract. This detects a
common clean-install failure mode: the dependency version is correct, but the
application did not configure its package manager to apply Solid Native's
reviewed native patch.

`fingerprint` turns those verified inputs into deterministic per-platform
compatibility identities. It hashes the actual installed Solid Native
core/Fabric Host/runtime/compiler/Metro package bytes, dependency locks, OXC/bootstrap, and
the selected native project without emitting file contents or absolute package
paths. Ordinary application source stays outside this native-compatibility
identity. The local result is unsigned; a delivery system must bind it to and
sign the source revision, artifact digest, release, and update channel before a
runtime trusts it. See [the fingerprint contract](compatibility-fingerprints.md).

For the pinned React Native 0.87 backend, `doctor` also reads the application
native sources. It requires the package-exported Android Gradle helper, CMake
target integration, JNI installer registration, and `ReactHost`
`bindingsInstaller`; on iOS it requires the package-exported podspec and the
verified empty-surface AppDelegate bootstrap. These checks are intentionally
version-specific: a runtime dependency that is installed but never connected
to Hermes is not a healthy application.

The same report distinguishes declarations from the installed artifacts. Core,
Fabric Host, and runtime declarations must match; installed manifest versions
must match the set and any exact declaration; and the selected platform's
Gradle or podspec export must resolve to a present file inside the Fabric Host
package. This makes a
partial tarball, stale lockfile install, or mixed release fail before a native
build.

`run` applies the same verified-backend checks, resolves the application's
local React Native CLI, verifies the installed core/Fabric Host/runtime release and the
selected platform export, exact Solid/native build pins, installed OXC/Metro
worker, Metro wiring, and Solid-owned JavaScript bootstrap, and transparently
delegates to `run-ios` or `run-android`. It never invokes a shell, forwards
platform arguments unchanged, streams native build output, and preserves the
child exit status. A dry-run also rejects mismatched, partial, or React-owned
application wiring. Its interrupt, termination, and hangup handlers forward the
signal to the native process tree on macOS and Linux (or the direct child on
Windows), then remove themselves when it closes. This avoids lingering Gradle
or Xcode work after an interrupted run. Its schema-versioned `--dry-run --json`
plan makes the exact command and project root inspectable by people and
automation before any build, install, or launch.
For iOS, an explicit `--device NAME_OR_ID` is a physical destination. The CLI
reads its bounded structured CoreDevice lock state before starting React
Native. An explicit `--udid ID` is first resolved against CoreSimulator, so
simulators retain their normal path while a physical UDID receives the same
gate. A locked phone, disabled Developer Mode, or a failed developer-services
tunnel now stops before Metro, CocoaPods, or Xcode starts. A bare `--device`
still delegates first-device selection upstream; supplying its name or
identifier enables the deterministic preflight.
When Android's SDK is found only at the platform-standard location, the plan
also exposes it as an `ANDROID_HOME` default. Execution never replaces an
explicit caller value.
The path is proven with Release builds installed and launched on a physical
Pixel and signed iPhone.

`logs android PACKAGE` resolves one explicit or unambiguous authorized device,
requires the package to be installed under one exact numeric UID, and streams
the UID-filtered JavaScript and native logcat records across process restarts.
The default one-line history avoids dumping an old device buffer; `--since`
accepts another bounded logcat `-T` value. Dry runs perform only read-only
device/package discovery and expose a schema-versioned exact command. The CLI
does not parse, persist, or upload application logs, and forwards terminal
signals to the adb process group.

`logs ios BUNDLE --device ID --restart` verifies the exact developer-installed
application through CoreDevice's JSON interface before producing a plan. Apple
exposes an application console by connecting standard streams during launch,
so the explicit restart acknowledgement is required: execution replaces the
current app process, streams only that launch, and Ctrl-C terminates both the
app and local CoreDevice streamer. It deliberately does not claim historical
logs or persistence across a later restart. Dry-run discovery is read-only;
live output is streamed without parsing, retention, or upload.

`device status-ios BUNDLE --device ID` and `device stop-ios BUNDLE --device ID`
provide the corresponding application lifecycle control. They require one
exact developer-installed bundle and map running processes only when the
CoreDevice executable URL belongs to that installation. Status is read-only
and emits path-free schema-zero text or JSON. Stop terminates only those exact
process identifiers, follows replacement generations, and requires four clean
polls spanning one second before succeeding. It is bounded and idempotent,
does not uninstall the application, and fails instead of claiming success when
the app keeps relaunching. A signed physical-iPhone run has validated the
running PID, one-generation stop, stable zero-process result, and cleanup.

`open android PACKAGE URL` sends a browsable `VIEW` intent constrained to one
installed package and accepts only an `am start-activity -W` result naming an
Activity from that exact package. `open ios BUNDLE URL --device ID` requires
one developer-installed application and sends the URL through CoreDevice's
supported launch payload, consuming its bounded structured result rather than
screen-scraping tool output. The default `preserve` mode leaves an existing
process alive, but can launch the app when absent; `--cold` explicitly requests
termination before delivery. Dry runs stop after read-only discovery and expose
the exact plan, including CoreDevice's private result-file placeholder. A
successful command proves targeted operating-system delivery, not that the app
recognized a route or reached a particular screen. Test URLs must not contain
production credentials because the URL remains visible in the local command
and optional JSON output.

`build` reuses the same resolution, installed-artifact gate, Android SDK
default, process isolation, signal forwarding, and exit-code preservation, but
delegates to the pinned non-launching `build-ios` or `build-android` command. It
selects Release mode by default while leaving explicit Xcode schemes,
destinations, modes, and Gradle tasks visible as forwarded native options.
Schema-versioned dry-run plans make the exact local or CI invocation auditable.

`bundle` emits a minified production OXC/Metro JavaScript bundle, its composed
source map, copied assets, and a deterministic artifact manifest for one
platform. It owns the entry, mode,
minification, output, and Solid Metro configuration while forwarding
operational options such as worker count. Before success it rewrites absolute
source-map identities beneath the pnpm lock root to stable `app:///` paths and
fails if a source escapes that reviewed root. Flat and indexed schema-v3 maps
must contain bounded VLQ mappings, names, strictly ordered inline sections, and
one embedded source-content string per source. Nesting and aggregate section,
source, and name counts are bounded; remote sections, ambiguous mixed maps,
path traversal, and malformed ignore lists fail closed. The result is portable
for CI and symbolication and does not disclose a developer's checkout path. It
remains an unsigned JavaScript artifact rather than an OTA authorization
envelope. The manifest records byte counts and SHA-256 digests for the final
bundle, rewritten map, and every bounded regular asset, then derives one bundle
fingerprint. A delivery pipeline can bind that identity beside
`solid-native fingerprint`'s native compatibility identity before signing a
release envelope.
`bundle verify` independently parses the bounded schema, recomputes the
manifest fingerprint and every artifact digest, and rejects missing, changed,
or unlisted assets. It also revalidates that the digest-matching map is still a
canonical, self-contained symbolication artifact, so a manifest cannot bless
structurally useless JSON merely because its hash matches. A green result
proves local integrity, not provenance; the manifest remains forgeable until a
trusted pipeline signs the enclosing release.

For iOS and Android, `bundle --hermes-source` instead emits the exact
non-minified Metro input expected by React Native 0.87's Release Hermes tasks;
Android also retains Gradle's packager-map basename. `release create
--inspect-embedded-bundle` opens the IPA, APK, or AAB without extracting it,
validates its single Hermes entry, bytecode version, and internal checksum, and
recompiles the reviewed source with the pinned application-local compiler.
Android and source-map-enabled iOS builds require exact bytecode SHA-256
equality. Ordinary Xcode builds receive the same comparison after canonicalizing
only their length-prefixed absolute intermediate filename and Hermes footer.
This closes the gap between “these two files were hashed together” and “this
archive contains code compiled from this reviewed bundle source” on both
platforms.

`release create` binds the verified bundle fingerprint, selected native
compatibility fingerprint and runtime versions, source revision, application
release/channel, and final native artifact digest into one deterministic
unsigned envelope. For AABs,
`--android-upload-certificate-sha256` additionally gates creation on strict JAR
verification and binds the non-debug public upload-certificate identity. For
APKs, repeated `--android-signing-certificate-sha256` values gate Android SDK
`apksigner` verification and bind the exact non-debug certificate set across
the supported Android-version range.
`release verify` independently recomputes all four integrity layers, any bound
Android signing identity, plus any declared native archive linkage against a
checkout and the supplied artifacts. This is the open handoff
to a signing or delivery service, not a claim that a developer-machine hash
proves build provenance. See [the release envelope contract](release-envelopes.md).

`release sign` creates a deterministic detached Ed25519 statement over that
canonical release fingerprint. `release verify-signature` accepts either a
separately pinned public key/key ID plus trusted scope flags, or one versioned
trust-policy file containing that scope and bounded canonical Ed25519 keys.
Policy keys are explicitly `active` or `revoked`; an unknown or revoked key
cannot produce authorized lineage even when the detached signature is
cryptographically valid. Each policy carries a positive monotonic sequence and
gets a deterministic normalized fingerprint. A caller can supply its persisted
minimum sequence to reject policy rollback. Optional release, revision, and
artifact-identity pins can constrain one exact rollout. Production verification accepts paired
bundle/native inputs and repeats the complete integrity proof; isolated
signature checks must opt into envelope-only mode, which is marked in the
authorized result. The CLI validates keys, signatures, inputs, and policy
matching but does not generate keys, store credentials, securely distribute
the policy, retain an audit log, or enforce monotonic rollout/rollback state.

`release symbolication` uses only input-complete authorization and repeats the
bundle proof before returning a vendor-neutral descriptor for the exact
generated bundle and canonical source map. The descriptor carries the same
frozen `authorizedRelease` lineage used by runtime telemetry, plus local upload
paths and signed size/digest expectations. It performs no network request and
does not turn mutable local paths into trusted identity; a backend adapter owns
last-moment byte verification, credentials, transport, and retention.

For customer-held or hardware-backed keys, `release signing-request` emits the
exact contextual payload and digest after the same optional input proof;
`release assemble-signature` verifies the returned raw/base64url Ed25519 bytes
with the public key and creates the ordinary detached statement without reading
private-key material. The unsigned request does not replace signer-side release
policy or build provenance.

`generate` resolves the same local pinned toolchain and gives it explicit
project, platform, and source inputs. It reuses React Native's Codegen schema
and native artifacts while leaving Solid in charge of the application-facing
component and module APIs. Native artifacts default to the isolated
`build/solid-native-codegen` tree; an explicit output root must remain inside
the app. This prevents React Native's multi-library app Codegen command from
leaving dependency sources in Gradle's application Codegen directory, where
they would be linked again beside their autolinked libraries. Dry-run plans
expose the exact native root plus a distinct `solidBindings` artifact and its
schema kind before generation. Execution stages the native tree and Solid
module under one transaction identity. Upstream failure preserves both prior
outputs; successful publication replaces the complete native tree and Solid
file; and a publication failure rolls both back. Explicit `--solid-library`
inputs add only installed direct dependencies after validating package
identity, modern Codegen configuration, and package-contained source roots;
app and dependency specs are combined into one inspectable module. Component,
TurboModule, and mixed schemas are supported; the Solid artifact is written
atomically only after upstream native Codegen succeeds. The command has
generated the checked-in app's custom Fabric descriptors, props, shadow nodes,
view-manager interfaces, and provider registrations for both platforms in that
isolated artifact tree.

The Solid module carries a frozen, path-free binding manifest containing each
input's origin, package/version, Codegen library, and kind. Its deterministic
SHA-256 covers that metadata and the complete emitted source. It can key
compatibility evidence and release observability, but remains unsigned build
metadata rather than supply-chain authorization.

For CI, `generate --check` reconstructs the Solid output in memory and compares
exact bytes without invoking native Codegen or mutating build trees. Its stable
report distinguishes matching, missing, stale, and unreadable artifacts and
uses exit status `1` for every drift state.

For dependency discovery and upgrade review, `generate --audit` reads those
same validated schemas without evaluating package wrappers or writing native
artifacts. Its path-free report inventories projected components and
TurboModules separately from interface-only and platform-excluded declarations.
Selecting a dependency whose declared Codegen kind exposes no matching surface
fails closed, which distinguishes stale empty Codegen metadata from a generated
native ABI. A legacy module may still be integrated through an explicitly
versioned and validated native seam, but it cannot be reported as a generated
binding. A discovered surface establishes schema compatibility only. Native
registration, a validating Solid adapter, and physical-device tests remain
independent gates before a catalog entry can claim runtime support.

`compatibility check` makes that distinction executable. It reads the bounded,
strict `solid-native.compatibility.json` owned by the application, discovers
the catalog's exact dependency versions through the same wrapper-free Codegen
path, and re-audits every package separately on each selected platform. Claims
record a schema category plus one of four evidence levels: discovered schema,
generated binding, native integration, or device verification. Non-discovery
claims must point to contained application evidence files. The gate fails for
package/library/version drift, a missing or reclassified surface, a platform
exclusion, or missing, escaping, or SHA-256-mismatched evidence and reports all
remaining audited surfaces as unclaimed rather than silently promoting them.

The check validates catalog/schema consistency and the exact reviewed bytes of
each referenced proof mechanism; it deliberately does not execute a physical
suite or infer that a device run succeeded from a script hash.

The Android physical Release runner closes the local evidence gap separately.
Only after fresh instrumentation passes and the bundle's source policy and
single-Solid-runtime gates succeed, it atomically emits a strict, path-free
receipt. That receipt binds the instrumentation result and exit code, both
APKs, source map and source count, wrapper-free policy verdict, generated
binding identity, native-compatibility fingerprint, Git revision/dirty state,
and a privacy-safe physical-device identity. It rejects stale, ambiguous,
skipped, failed, or emulator evidence. The repository runner still emits the
fixed schema-0 profile. Portable schema 1 permits application-owned
instrumentation and source checks under an explicitly pinned verification
profile; see [the receipt contract](device-proof-receipts.md). Every receipt
remains unsigned evidence until separately authenticated, while trusted
timestamps remain a delivery/control-plane concern.

Applications can retain selected clean receipts as compatibility evidence. The
native E2E catalog hash-pins its current Pixel receipt alongside the reviewed
runner, adapters, and generated binding, and CI parses that retained result with
the same strict schema. This makes `device-verified` reviewable as both a proof
mechanism and a concrete successful execution without treating an unsigned
receipt as authorization.

`device-proof sign` gives that retained evidence its own trust domain. It
strictly validates a supported Android receipt and clean source state before
reading a caller-managed Ed25519 key, hashes the exact receipt bytes, and signs
a path-free statement carrying a separately governed project name and key ID.
Its `solid-native.device-proof-signature.v0` context is intentionally distinct
from release signatures. `device-proof verify-signature` requires the exact
receipt and either pinned public-key/project inputs or a bounded versioned
policy containing the Android proof scope, project, positive sequence, and up
to 32 canonical Ed25519 keys marked active or revoked. A minimum accepted
sequence provides a caller-owned rollback gate; successful policy-backed
reports stamp the normalized policy fingerprint and sequence onto the
privacy-safe `authenticatedProof`. Any proof, policy age, key, signature, or
project mismatch omits authenticated lineage and exits nonzero. The verifier
does not decide whether an arbitrary local policy is trusted or persist the
sequence high-water mark. This creates an open ingestion boundary for managed
device labs without claiming that device execution authorizes delivery of an
application release.

`device-proof profile` exposes the deterministic instrumentation/source-policy
identity for review. Schema-1 receipts require that fingerprint through an
explicit verification constraint or a schema-1 trust policy; changing the test
or any source gate therefore fails even when a trusted lab key signs the new
receipt. Successful lineage records both receipt schema and actual profile.

Both verification modes can additionally pin the exact receipt fingerprint,
source revision, native-compatibility fingerprint, and application APK digest.
Inclusive canonical-UTC measurement bounds prevent an older or unrelated but
otherwise valid lab statement from satisfying one rollout. They rely on the
time signed by the device-lab key and therefore complement, but do not replace,
an independently trusted timestamp. Every machine-readable report retains the
normalized constraints as one frozen `policy`.

`device-proof ingestion` turns that one successful verifier invocation into a
deeply frozen, uploader-neutral descriptor. It repeats the bounded receipt read
and digest check at the handoff boundary, then carries authenticated lineage,
device/OS/power context, native compatibility, generated binding and bundle
identities, APK facts, and instrumentation evidence without local paths, the
stable device serial digest, public keys, or detached-signature bytes. Its
frozen `verificationPolicy` records the exact constraints that admitted the
proof. A serialized lookalike is not independently trusted; an adapter must
consume the live verifier result and remains responsible for transport,
retention, policy high-water state, and access control.

`release correlate-device-proof` closes the next provenance gap without
collapsing the two trust domains. It requires an input-complete authorized
Android release under a versioned release policy and independently verifies the
physical receipt under a versioned device-lab policy. The release's source
revision, native-compatibility fingerprint, and final APK digest become
mandatory proof constraints inside the verifier; callers cannot provide or
weaken those lineage values. The two independently authenticated project
identities must also match. Optional exact receipt and signed-time bounds remain
available, as do independent minimum policy sequences for both domains.
At the handoff boundary it repeats the release bundle-manifest proof and also
requires the signed device receipt's JavaScript bundle byte count and SHA-256 to
match that exact production bundle.
The result is one frozen, path-free `solid-native.release-device-correlation`
descriptor containing the original `authorizedRelease` and complete
device-proof ingestion handoff. Execution evidence remains evidence, never a
substitute release authority.

For customer-held keys, `device-proof signing-request` exports that exact
contextual payload and digest without private-key access;
`device-proof assemble-signature` accepts raw or canonical-base64url Ed25519
bytes, verifies them against the supplied public key, and atomically creates the
ordinary detached statement. The unsigned request instructs an external signer
but does not replace its policy, audit, or key-custody controls.

`solid-native compatibility evidence FILE...` produces the normalized path and
SHA-256 object for up to 16 contained application files without mutating the
catalog. It applies the same physical-containment rules as the check, so a
reviewer can deliberately accept changed evidence without copying opaque hash
commands into application workflows.

`adapter create` supplies the next boundary after discovery. It selects one
TurboModule from one exact installed Codegen dependency and emits an editable
app-owned TypeScript scaffold only when the corresponding generated binding is
current. Existing adapter files are never overwritten. Each method remains
behind a required application policy function with an `unknown` portable
result, preventing schema types from being mistaken for domain validation.
Generated event glue uses explicit decoders and `createNativeEventAccessor`, so
delivery enters Solid's causal scheduler and the native subscription follows a
Solid owner. A completed adapter can then become the contained evidence path
for a catalog's `native-integrated` or `device-verified` claim.

The first checked-in product adapter applies this route to AsyncStorage 3.x.
`@solid-native/storage/async-storage-3` accepts the generated native module by
injection, selects only three reviewed database methods, binds native `this`,
freezes argument collections, and narrows the one observable native result
from `unknown`. The Android Release bundle has a source-map gate requiring that
adapter, the generated binding, and the product adapter while rejecting every
AsyncStorage JavaScript wrapper. Its catalog claim was held at
`native-integrated` until that proof passed on hardware. The refreshed Android
restoration run now passes on a tethered Pixel 9a, promoting the claim to
`device-verified`; iOS remains `binding-generated`. None of the three E2E
entrypoints evaluate AsyncStorage's React-facing JavaScript wrapper.

The second product adapter applies the same boundary to Notify Kit 10.5.
`@solid-native/notifications/notify-kit-10` accepts an injected generated module
and low-level event source, exposes seven reviewed operations from the
48-method ABI, reproduces the required native payload defaults, and validates
permissions, displayed IDs, foreground events, cleanup, and platform-specific
cancellation. Its physical Android runner requires the app seam, generated
binding, and product adapter exactly once in the Release map while rejecting
all `react-native-notify-kit` JavaScript sources. Real permission, OS-visible
delivery, notification-shade press, causal updates, cancellation, camera, and
teardown passed on the Pixel 9a, promoting Android to `device-verified`; iOS
remains `binding-generated` pending a fresh signed run.

The bundle boundary is reusable rather than adapter-specific:
`solid-native bundle sources MAP` parses a raw or canonical Metro source map
under the lockfile-root trust boundary, normalizes source identities in memory,
requires selected sources exactly once, and rejects configured dependency
fragments. The Android restoration runner dogfoods this public command before
installing its APK; a policy mismatch is a failed physical proof, not a warning.

`start` applies the installed-runtime, exact backend, Solid/OXC compiler, Metro
resolver, safe full-reload policy, and application-bootstrap checks before
delegating to the application-local React Native Metro server. Metro arguments
remain visible and are forwarded unchanged. Application edits restart the
complete runtime instead of entering React Refresh's incompatible component
boundary. The same process-group signal handling used by native builds stops
Metro and its workers when the command is interrupted, avoiding orphaned
development processes and listening ports.

`test` discovers bounded in-project test/spec files, compiles TS/TSX with the
same Solid universal OXC pipeline as Metro, and delegates reporting and
concurrency to Node's built-in runner. Generated applications include a real
component press/update/cleanup test. `upgrade react-native` performs a
read-only installed-candidate and native-boundary audit; it does not promote an
unverified backend.

The first package-management recipe is implemented:

```text
solid-native add navigation
```

It pins the matching Solid Native navigation release and verified
`react-native-screens` backend, then copies the navigation package's
content-addressed patch into the application and merges its one pnpm patch
mapping before reinstalling. The plan is inspectable and non-mutating under
`--dry-run`; exact dependencies already supplied by a private registry or local
artifact use an idempotent install mode. Conflicting declarations, mappings,
files, package identities, backend contracts, digests, symlinked targets, and
concurrent manifest changes fail closed. Success requires the final installed
package identities and all three reviewed native files to match the contract.
The packed external starter exercises this command against registry-shaped
tarballs and independently requires `doctor` to validate the same native bytes
before bundling.

Future `add` recipes should meet the same complete native-configuration bar.
The CLI orchestrates existing platform tools rather than obscuring Xcode and
Gradle, and generated native projects remain owned and editable by the
application developer.

## Development client

A useful development client needs:

- Runtime and native-module fingerprinting
- Embedding and verifying signed delivery metadata built from the local
  compatibility fingerprint
- Fast bundle delivery
- A bounded, process-local native error overlay now catches failed Solid
  subtrees and explicitly reported async/native errors through
  `@solid-native/devtools`; native fatal-error capture and source-map
  symbolication remain development-client work
- Device logs
- Physical Android and iOS deep-link invocation is available through
  `solid-native open`, with preserve and explicit cold-launch modes
- Network and performance inspection
- Multiple project channels
- Clear rejection of bundles incompatible with the installed native runtime

## Observability boundary

The runtime protocol, privacy-safe default instrumentation, local timeline, and
dependency-free Sentry and OpenTelemetry adapters are part of the open-source
developer platform. Applications provide their own initialized Sentry or
OpenTelemetry SDK, and the local protocol remains transport-neutral and
exportable.

Local causal debugging is a native development feature, not a hosted-service
dependency. The version-zero causal debug snapshot is a bounded, immutable,
transport-neutral handoff from the app's Hermes process to a desktop
development client. Its creator and strict untrusted-value parser are complete.
`solid-native debug inspect` now consumes one capped UTF-8 JSON handoff,
summarizes its operation/status counts and retained causal groups, and
reconstructs a selected causal graph without showing custom attributes unless
explicitly requested. Schema one identifies a selected operation's local group
and reports group entries, terminals, status counts, and unresolved causes. A
group ID is eviction-sensitive local identity, not a distributed trace ID. The
handoff may be a file, bounded stdin, or either implemented one-shot device
command without making the CLI own a resident relay.
`solid-native debug compare` applies the same parser to a baseline and candidate
file, then reports operation/status changes, graph incompleteness, and
per-operation-kind successful p95 duration deltas without returning custom
attributes. Its schema-one summaries include retained, isolated, and largest
group counts. If operation-kind counts match, a higher candidate group count
fails as causal fragmentation; group growth stays informational when operations
were added. Increased errors, evictions, discarded records, or unresolved
causes fail with status 1. Latency becomes a failure only under an explicit
`--max-p95-regression` percentage, keeping policy with the application or CI.
The comparison is operation-ID-independent and path-free, but callers must
still ensure the two snapshots represent equivalent workloads, devices, and
releases.
`solid-native debug trace` consumes the same validated handoff and emits a
deterministic Chrome JSON event array for direct import into Perfetto. It maps
operations to non-overlapping lanes and retained causal relationships to flow
arrows. Group summary markers expose bounded status and graph-shape counts, and
each operation slice carries the same explicitly local retained-group ID used
by inspect and report. Active operations extend to the capture time, and custom
attributes remain excluded unless explicitly requested. This supplies an
immediately usable visual timeline artifact while keeping transport and UI
ownership separate.
`solid-native debug report` emits a self-contained offline HTML debugger from
that same handoff. Its default group view can be filtered and drilled into
individual operations; both groups and operations have local deep links. The
operation view exposes direct cause/effect navigation, retained graph counts,
and missing-cause warnings without a local server. Its fixed script and style
are CSP-hashed, its untrusted data is base64-encoded before embedding, it has no
network permission, and application attributes remain excluded unless
disclosure is explicit.
An explicit `--diagnostics ARTIFACT` enriches that offline debugger with
value-free Solid rerun/native-frame correlation cards and links to the retained
frame operations. The report labels the association as static-name/window
correlation and never upgrades it to an exact per-rerun claim.
`solid-native debug symbolicate` separately maps either bounded, explicit
one-based JavaScript locations or a bounded Hermes/JSC/JavaScript stack through
the already validated portable production source map, including indexed maps
and ignored/unmapped results. Stack input is capped at 1 MiB, 4,096 lines, and
1,024 frames, with strict UTF-8 for files and stdin. The Hermes branch follows
the exact pinned React Native dialect and normalizes zero-based bytecode offsets
before the one-pass map lookup; stacks without Hermes-specific markers use the
pinned generic JavaScript parser. Results do not retain the raw error message or
generated bundle URLs. This local command does not authenticate the source map;
authenticated release handoff remains the `release symbolication` boundary.
Both native transports are concrete. `debug capture-android` requires an
explicit serial and debuggable installed package, then uses a nonce-bound
request under the app UID. `debug capture-ios` requires an explicit CoreDevice
identifier and bundle, delivers a nonce payload URL, consumes only the matching
app-container response, and requires a successful cleanup acknowledgement.
The matching `debug diagnostics-android` and `debug diagnostics-ios` commands
open and close an exclusive timed Solid diagnostics window over the same
private, nonce-bound transports and return a strict value-free artifact. Both
validate the response and exit. Android non-debuggable builds and ordinary
iOS store Release builds are inert. Physical Pixel and iPhone proofs cover the
complete surface-to-commit-to-mount-to-frame chain and direct Perfetto
conversion. `debug correlate` validates a diagnostics artifact alongside a
later causal snapshot, matches static Solid effect/native-output names inside
the bounded capture window, and follows retained native graph edges through
commit, mount, and frame. Its versioned result explicitly says the join is not
exact per rerun because the current Solid diagnostics protocol exposes no
correlation token. `debug watch-android` and `debug watch-ios` reuse those exact
one-shot transports sequentially, retain no snapshot history, emit privacy-safe text
or NDJSON inspections, wake immediately on interruption, and stop after a
bounded number of consecutive failures. They require no socket or background
relay. The offline report and terminal watch are concrete local clients; a
richer resident live-session desktop graph remains separate product work.

`debug report-android` and `debug report-ios` compose the two one-shot captures
into the first complete live-device debugger workflow. Diagnostics is captured
before the causal snapshot so the latter can retain the full window; both
artifacts are validated and correlated in memory, then the CSP-locked report is
written to stdout or, with `--output`, a private atomic file. Existing output
files are never overwritten. No intermediate JSON file is required, device
response files are consumed by their existing nonce protocols, and custom
causal attributes remain opt-in.
