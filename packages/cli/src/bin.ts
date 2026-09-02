#!/usr/bin/env node

import path from "node:path";

import {
  SOLID_NATIVE_CLI_VERSION,
  VERIFIED_REACT_NATIVE_VERSION,
  NATIVE_CAUSAL_DEBUG_WATCH_DEFAULT_MAX_CONSECUTIVE_FAILURES,
  assembleNativeDeviceProofSignature,
  assembleNativeReleaseSignature,
  auditNativeReactNativeUpgrade,
  checkNativeBundleSources,
  checkNativeCompatibilityCatalog,
  checkNativeSolidBindingGeneration,
  compareNativeCausalDebugFiles,
  correlateNativeSolidDiagnosticsFiles,
  captureNativeAndroidCausalDebugReport,
  captureNativeAndroidCausalDebugSnapshot,
  captureNativeAndroidSolidDiagnostics,
  captureNativeIosCausalDebugReport,
  captureNativeIosCausalDebugSnapshot,
  captureNativeIosSolidDiagnostics,
  createNativeAdapterScaffoldPlan,
  createNativePackageAddPlan,
  createNativeAndroidLogsPlan,
  createNativeAndroidDeviceProof,
  createNativeCompatibilityEvidenceReport,
  createNativeDeviceProofIngestion,
  createNativeDeviceProofSignature,
  createNativeDeviceProofSigningRequest,
  createNativeSolidBindingAudit,
  createNativeBuildPlan,
  createNativeBundlePlan,
  createNativeCausalTraceFile,
  createNativeCausalTraceStream,
  createNativeCausalDebugReportFile,
  createNativeCausalDebugReportStream,
  createNativeCreatePlan,
  createNativeFingerprint,
  createNativeGeneratePlan,
  createNativeIosLogsPlan,
  createNativeDeepLinkPlan,
  createNativeReleaseManifest,
  createNativeReleaseDeviceCorrelation,
  createNativeReleaseSignature,
  createNativeReleaseSigningRequest,
  createNativeSymbolicationHandoff,
  createNativeRunPlan,
  createNativeStartPlan,
  createNativeTestPlan,
  executeNativeBuildPlan,
  executeNativeAdapterScaffoldPlan,
  executeNativePackageAddPlan,
  executeNativeBundlePlan,
  executeNativeCreatePlan,
  executeNativeGeneratePlan,
  executeNativeIosLogsPlan,
  executeNativeDeepLinkPlan,
  executeNativeAndroidLogsPlan,
  executeNativeRunPlan,
  executeNativeStartPlan,
  executeNativeTestPlan,
  formatDoctorReport,
  formatNativeAndroidApkSigningReport,
  formatNativeAndroidBundleSigningReport,
  formatNativeCausalDebugComparison,
  formatNativeAndroidLogsPlan,
  formatNativeCausalDebugInspection,
  formatNativeBuildPlan,
  formatNativeBundleVerification,
  formatNativeBundlePlan,
  formatNativeCompatibilityCatalogReport,
  formatNativeCreatePlan,
  formatNativeCreateSuccess,
  formatNativePackageAddPlan,
  formatNativeDeviceProofIngestion,
  formatNativeDeviceProofSignatureVerification,
  formatNativeFingerprint,
  formatNativeGeneratePlan,
  formatNativeIosApplicationProcessStatus,
  formatNativeIosApplicationProcessStop,
  formatNativeIosLogsPlan,
  formatNativeDeepLinkPlan,
  formatNativeReleaseVerification,
  formatNativeReleaseDeviceCorrelation,
  formatNativeReleaseSignatureVerification,
  formatNativeReactNativeUpgradeReport,
  formatNativeSourceLocationSymbolication,
  formatNativeStackTraceSymbolication,
  formatNativeSolidDiagnosticsInspection,
  formatNativeSolidDiagnosticsCorrelation,
  formatNativeSymbolicationHandoff,
  formatNativeRunPlan,
  formatNativeSourceMapPolicyReport,
  formatNativeStartPlan,
  formatNativeTestPlan,
  inspectNativeCausalDebugFile,
  inspectNativeCausalDebugSnapshot,
  inspectNativeCausalDebugStream,
  inspectNativeSolidDiagnosticsFile,
  inspectNativeSolidDiagnosticsStream,
  inspectNativeDeviceProofProfile,
  readNativeSolidDiagnosticsDebugFile,
  readNativeDeviceProofReceipt,
  readNativeIosApplicationProcessStatus,
  runDoctor,
  stopNativeIosApplicationProcesses,
  symbolicateNativeSourceLocations,
  symbolicateNativeStackTraceFile,
  symbolicateNativeStackTraceStream,
  verifyNativeBundleManifest,
  verifyNativeAndroidApkSigning,
  verifyNativeAndroidBundleSigning,
  verifyNativeDeviceProofSignature,
  verifyNativeReleaseManifest,
  verifyNativeReleaseSignature,
  watchNativeCausalDebugSnapshots,
  writeNativeCausalDebugReportFile,
  type DoctorPlatform,
  type NativeBuildPlatform,
  type NativeBundlePlatform,
  type NativeFingerprintPlatform,
  type NativeGeneratePlatform,
  type NativeGenerateSource,
  type NativeGeneratedSourceLocation,
  type NativeReleaseAuthorizationPolicy,
  type NativeRunPlatform,
  type NativeTestRuntime,
} from "./index.js";

const HELP = `Solid Native CLI ${SOLID_NATIVE_CLI_VERSION}

Usage:
  solid-native add navigation [--cwd PATH] [--dry-run] [--json]
  solid-native adapter create MODULE --library PACKAGE [--output FILE] [--bindings FILE] [--dry-run]
  solid-native create NAME [--directory PATH] [--package-name ID] [--title TITLE]
  solid-native build ios|android [--cwd PATH] [--dry-run] [--] [native options]
  solid-native debug capture-android PACKAGE --serial ID [--timeout MS]
  solid-native debug diagnostics-android PACKAGE --serial ID [--duration MS] [--timeout MS]
  solid-native debug report-android PACKAGE --serial ID [--duration MS] [--timeout MS] [--show-attributes] [--output FILE]
  solid-native debug capture-ios BUNDLE --device ID [--timeout MS]
  solid-native debug diagnostics-ios BUNDLE --device ID [--duration MS] [--timeout MS]
  solid-native debug report-ios BUNDLE --device ID [--duration MS] [--timeout MS] [--show-attributes] [--output FILE]
  solid-native debug diagnostics-inspect ARTIFACT|- [--json]
  solid-native debug correlate DIAGNOSTICS SNAPSHOT [--json]
  solid-native debug watch-android PACKAGE --serial ID [--interval MS] [--count N] [--max-failures N] [--timeout MS] [--json]
  solid-native debug watch-ios BUNDLE --device ID [--interval MS] [--count N] [--max-failures N] [--timeout MS] [--json]
  solid-native debug compare BASELINE CANDIDATE [--max-p95-regression PERCENT] [--json]
  solid-native debug inspect SNAPSHOT|- [--operation ID] [--show-attributes] [--json]
  solid-native debug report SNAPSHOT|- [--diagnostics ARTIFACT] [--operation ID] [--show-attributes] [--output FILE]
  solid-native debug trace SNAPSHOT|- [--show-attributes]
  solid-native debug symbolicate MAP (--at LINE:COLUMN... | --stack STACK|-) [--json]
  solid-native bundle ios|android [--cwd PATH] [--output PATH] [--dry-run]
  solid-native bundle sources MAP [--require SOURCE] [--forbid-containing TEXT] [--json]
  solid-native bundle verify MANIFEST [--json]
  solid-native compatibility check [--cwd PATH] [--catalog FILE] [--platform all|ios|android] [--json]
  solid-native compatibility evidence FILE... [--cwd PATH] [--json]
  solid-native device status-ios BUNDLE --device ID [--json]
  solid-native device stop-ios BUNDLE --device ID [--json]
  solid-native device-proof create-android --serial ID --not-before UTC --bundle FILE --source-map FILE --apk FILE --instrumentation-apk FILE --bindings FILE --instrumentation-results DIR --instrumentation-class CLASS --instrumentation-test TEST --require SOURCE --output FILE
  solid-native device-proof sign RECEIPT --key PRIVATE_KEY --key-id ID --project NAME
  solid-native device-proof signing-request RECEIPT --key-id ID --project NAME
  solid-native device-proof assemble-signature REQUEST --signature FILE --public-key FILE
  solid-native device-proof profile RECEIPT [--json]
  solid-native device-proof ingestion SIGNATURE --proof RECEIPT --trust-policy FILE
  solid-native device-proof verify-signature SIGNATURE --proof RECEIPT --public-key FILE --key-id ID --project NAME
  solid-native device-proof verify-signature SIGNATURE --proof RECEIPT --trust-policy FILE
  solid-native doctor [--platform all|ios|android] [--cwd PATH] [--strict] [--json]
  solid-native fingerprint [--platform all|ios|android] [--cwd PATH] [--json]
  solid-native generate [--platform all|ios|android] [--cwd PATH] [--output PATH]
  solid-native logs android PACKAGE [--serial ID] [--since VALUE] [--dry-run]
  solid-native logs ios BUNDLE --device ID --restart [--dry-run]
  solid-native open android PACKAGE URL [--serial ID] [--cold] [--dry-run]
  solid-native open ios BUNDLE URL --device ID [--cold] [--dry-run]
  solid-native run ios|android [--cwd PATH] [--dry-run] [--] [native options]
  solid-native release create --bundle FILE --artifact FILE --release ID --channel NAME --revision SHA [--android-upload-certificate-sha256 HEX | --android-signing-certificate-sha256 HEX...]
  solid-native release verify-android-signing AAB|APK [--expected-certificate-sha256 HEX...] [--json]
  solid-native release sign MANIFEST --key PRIVATE_KEY --key-id ID [--bundle FILE --artifact FILE]
  solid-native release signing-request MANIFEST --key-id ID [--bundle FILE --artifact FILE]
  solid-native release assemble-signature REQUEST --signature FILE --public-key FILE
  solid-native release correlate-device-proof SIGNATURE --manifest MANIFEST --bundle FILE --artifact FILE --trust-policy FILE --device-signature FILE --proof RECEIPT --device-trust-policy FILE
  solid-native release verify MANIFEST --bundle FILE --artifact FILE [--json]
  solid-native release verify-signature SIGNATURE --manifest MANIFEST --public-key FILE --key-id ID --project NAME --platform ios|android --channel NAME (--bundle FILE --artifact FILE | --envelope-only)
  solid-native release verify-signature SIGNATURE --manifest MANIFEST --trust-policy FILE (--bundle FILE --artifact FILE | --envelope-only)
  solid-native release symbolication SIGNATURE --manifest MANIFEST --trust-policy FILE --bundle FILE --artifact FILE [--json]
  solid-native start [--cwd PATH] [--dry-run] [--] [Metro options]
  solid-native test [FILE|DIRECTORY...] [--watch] [--test-name-pattern REGEXP] [--production] [--cwd PATH] [--dry-run] [--json]
  solid-native upgrade react-native --candidate PATH [--cwd PATH] [--json]
  solid-native --help
  solid-native --version

The doctor command is read-only. It checks the pinned React Native backend,
Fabric/Hermes project settings, and the local Xcode or Android toolchain.
--strict exits nonzero for warnings as well as failures, without changing the
machine-readable report schema.`;

const UPGRADE_HELP = `Usage:
  solid-native upgrade react-native --candidate PATH [--cwd PATH] [--json]

Audits an already-installed candidate project against the current application
without changing either tree or using the network. It verifies exact package,
normalized runtime, Hermes compiler/bytecode, React, Codegen, Gradle plugin,
lockfile, and Fabric-boundary identities; fingerprints the imported upstream
header surface; and prints the native and physical-device gates still required.
A passing audit never promotes an unverified React Native backend.`;

const FINGERPRINT_HELP = `Usage:
  solid-native fingerprint [--platform all|ios|android] [--cwd PATH] [--json]

Hashes the reviewed runtime identity, lockfile, compiler/bootstrap, and native
project inputs into deterministic per-platform compatibility fingerprints.
The result is unsigned local metadata; a delivery system must sign it before a
running application trusts it.`;

const CAUSAL_DEBUG_HELP = `Usage:
  solid-native debug capture-android PACKAGE --serial ID [--timeout MS]
  solid-native debug diagnostics-android PACKAGE --serial ID
                                                [--duration MS] [--timeout MS]
  solid-native debug report-android PACKAGE --serial ID [--duration MS]
                                           [--timeout MS] [--show-attributes]
                                           [--output FILE]
  solid-native debug capture-ios BUNDLE --device ID [--timeout MS]
  solid-native debug diagnostics-ios BUNDLE --device ID
                                            [--duration MS] [--timeout MS]
  solid-native debug report-ios BUNDLE --device ID [--duration MS]
                                      [--timeout MS] [--show-attributes]
                                      [--output FILE]
  solid-native debug diagnostics-inspect ARTIFACT|- [--cwd PATH] [--json]
  solid-native debug correlate DIAGNOSTICS SNAPSHOT [--cwd PATH] [--json]
  solid-native debug watch-android PACKAGE --serial ID [--interval MS]
                                   [--count N] [--max-failures N]
                                   [--timeout MS] [--json]
  solid-native debug watch-ios BUNDLE --device ID [--interval MS]
                              [--count N] [--max-failures N]
                              [--timeout MS] [--json]
  solid-native debug compare BASELINE CANDIDATE
                             [--max-p95-regression PERCENT]
                             [--cwd PATH] [--json]
  solid-native debug inspect SNAPSHOT|- [--operation ID] [--show-attributes]
                                        [--cwd PATH] [--json]
  solid-native debug report SNAPSHOT|- [--diagnostics ARTIFACT]
                                       [--operation ID] [--show-attributes]
                                       [--output FILE] [--cwd PATH]
  solid-native debug trace SNAPSHOT|- [--show-attributes] [--cwd PATH]
  solid-native debug symbolicate MAP (--at LINE:COLUMN... | --stack STACK|-)
                                      [--cwd PATH] [--json]

Validates one bounded causal-debug snapshot from a device or test process and
prints a path-free structural summary. Selecting an operation reconstructs its
retained causal ancestors and descendants. Attributes remain excluded unless
--show-attributes is explicit; the snapshot parser validates structure but
cannot determine whether custom application attributes contain private data.

Capture Android asks one running debuggable application for an app-private,
nonce-bound snapshot, validates it, removes the response, and writes only the
snapshot JSON to stdout. Store builds do not expose the transport.

Diagnostics Android opens one exclusive, timed Solid diagnostics and attribution
window in a development bundle. It writes a strict, bounded artifact containing
only diagnostic codes, static computation names, dependency changes, rerun
causes, and aggregate costs. Values, messages, stacks, owner IDs, props, text,
and rendered content never cross the device boundary.

Capture iOS delivers a nonce URL to one explicit device and bundle, consumes
only the matching app-container response through CoreDevice, acknowledges its
deletion, and writes the validated snapshot JSON. Store builds ignore requests.

Diagnostics iOS applies the same exclusive, timed, value-free Solid diagnostics
protocol through nonce-bound CoreDevice URLs and app-container responses.

Report Android and report iOS perform the complete live workflow in one
command: capture diagnostics first, capture the containing causal timeline
second, validate and correlate both, and emit the self-contained HTML debugger
to stdout or a private atomic file selected with --output. Existing output
files are never overwritten. Application-authored causal attributes stay
excluded unless --show-attributes is explicit. Device response files are
consumed by the same nonce-bound transports and no intermediate local artifact
is required.

Correlate validates a diagnostics artifact and a later causal snapshot, then
joins named Solid effect reruns to native computation → commit → mount → frame
chains in the same bounded capture window. The result explicitly remains a
static-name/window correlation, not an exact per-rerun token join.

Diagnostics inspect validates one captured artifact and prints bounded counts,
rerun outcomes, retained causes, aggregate costs, and the hottest static scope
and write names. It never adds raw runtime values or application content.

Watch repeats the matching one-shot capture sequentially and prints a safe
inspection after each response. It retains no snapshots, never overlaps
requests, and stops after three consecutive failures by default. --json emits
newline-delimited inspections. Without --count it runs until interrupted.
Watching iOS uses CoreDevice URL delivery for every capture and can foreground
the selected application.

Compare reads two bounded snapshots and reports aggregate operation, status,
graph-quality, and per-kind successful p95 duration deltas without exposing attributes.
Increased errors, evictions, discarded records, or unresolved causes fail the
comparison. Duration is informational unless --max-p95-regression supplies an
explicit percentage threshold; a failed comparison exits with status 1.

Report emits one self-contained offline HTML debugger to stdout. It includes a
searchable timeline and navigable causal links, makes no network requests, and
excludes application-authored attributes unless --show-attributes is explicit.
--output writes a private atomic file and refuses to replace an existing path.

Trace emits a deterministic Chrome JSON event array to stdout. Perfetto can
open it directly and renders retained cause relationships as flow arrows.
Attributes remain excluded unless --show-attributes is explicit.

Symbolication resolves either explicit one-based JavaScript locations or one
bounded Hermes/JSC/JavaScript stack file through a previously canonicalized
portable Solid Native source map. Use --stack - for strict bounded UTF-8 stdin.
Raw messages and generated bundle URLs are not retained in its result.`;

const ADAPTER_HELP = `Usage:
  solid-native adapter create MODULE --library PACKAGE [--cwd PATH]
                              [--platform all|ios|android]
                              [--bindings FILE] [--output FILE]
                              [--dry-run] [--json]

Scaffolds an application-owned TurboModule adapter from one exact installed
Codegen dependency. Methods remain behind explicit policy hooks with unknown
outputs until application validation is written. Codegen event emitters become
decoded Solid-owned accessors. Existing files are never overwritten, and the
selected generated binding must be current before creation.`;

const ADD_HELP = `Usage:
  solid-native add navigation [--cwd PATH] [--dry-run] [--json]

Installs one reviewed Solid Native capability recipe. The navigation recipe
pins the supported react-native-screens backend, copies its content-addressed
patch into the application without overwriting a different file, merges the
pnpm patch mapping, and reinstalls so the native dependency is actually
patched. Use --dry-run to inspect every package and filesystem action.`;

const CREATE_HELP = `Usage:
  solid-native create NAME [--directory PATH] [--package-name ID] [--title TITLE]
                           [--skip-install] [--dry-run] [--json]

Creates an application-owned React Native 0.87 shell, replaces its React root
with Solid Native's OXC/Metro and JSI/Fabric bootstrap, and installs with the
validated pnpm 9 toolchain. Use --dry-run to inspect the upstream init command.`;

const GENERATE_HELP = `Usage:
  solid-native generate [--platform all|ios|android] [--cwd PATH]
                        [--source app|library] [--output PATH] [--verbose]
                        [--solid-library PACKAGE]...
                        [--solid-output FILE | --no-solid]
                        [--audit | --check | --dry-run] [--json]

Solid Native resolves the application-local React Native 0.87 Codegen command.
Generated native artifacts stay in the application-owned platform tree unless
an explicit output path is supplied. Component and TurboModule application
schemas also emit React-free typed Solid bindings under generated/ by default.
Repeat --solid-library to include installed, direct dependency Codegen specs in
the same binding module. --check compares that module without running native
Codegen or writing files. --audit inventories reusable and excluded surfaces
without evaluating package wrappers. Use --dry-run to inspect both outputs.`;

const COMPATIBILITY_HELP = `Usage:
  solid-native compatibility check [--cwd PATH] [--catalog FILE]
                                   [--platform all|ios|android] [--json]
  solid-native compatibility evidence FILE... [--cwd PATH] [--json]

Re-audits exact installed dependency Codegen schemas against an
application-owned compatibility catalog. Claims distinguish schema discovery,
generated bindings, native integration, and physical-device verification.
Evidence references must remain inside the application and match their pinned
SHA-256. The evidence operation prints ready-to-paste content-addressed entries;
it does not approve changes or replace running the referenced physical proof.`;

const DEVICE_PROOF_HELP = `Usage:
  solid-native device-proof create-android --serial ID --not-before UTC
                              --bundle FILE --source-map FILE --apk FILE
                              --instrumentation-apk FILE --bindings FILE
                              --instrumentation-results DIR
                              --instrumentation-class CLASS
                              --instrumentation-test TEST --require SOURCE
                              [--require SOURCE]...
                              [--forbid-containing TEXT]...
                              --output FILE [--cwd PATH] [--json]
  solid-native device-proof sign RECEIPT --key PRIVATE_KEY --key-id ID
                              --project NAME [--cwd PATH] [--output PATH]
                              [--json]
  solid-native device-proof signing-request RECEIPT --key-id ID
                              --project NAME [--cwd PATH] [--output PATH]
                              [--json]
  solid-native device-proof assemble-signature REQUEST --signature FILE
                              --public-key FILE [--cwd PATH] [--output PATH]
                              [--json]
  solid-native device-proof profile RECEIPT [--cwd PATH] [--json]
  solid-native device-proof ingestion SIGNATURE --proof RECEIPT
                              --public-key FILE --key-id ID --project NAME
                              [--cwd PATH] [--json]
  solid-native device-proof ingestion SIGNATURE --proof RECEIPT
                              --trust-policy FILE
                              [--minimum-policy-sequence INTEGER]
                              [--cwd PATH] [--json]
  solid-native device-proof verify-signature SIGNATURE --proof RECEIPT
                              --public-key FILE --key-id ID --project NAME
                              [--cwd PATH] [--json]
  solid-native device-proof verify-signature SIGNATURE --proof RECEIPT
                              --trust-policy FILE
                              [--minimum-policy-sequence INTEGER]
                              [--cwd PATH] [--json]
  Verification and ingestion optionally accept:
                              [--proof-sha256 SHA256] [--revision SHA]
                              [--native-fingerprint SHA256]
                              [--artifact-sha256 HEX]
                              [--profile-fingerprint SHA256]
                              [--minimum-measured-at UTC]
                              [--maximum-measured-at UTC]

The create-android operation emits an immutable portable schema-1 receipt only
after one fresh passing physical-device test, a clean stable Git revision,
live non-emulator device inspection, exact source-map policy, and stable bundle,
map, binding, and APK digests. It never overwrites existing evidence.

Signing strictly validates a clean physical-device receipt before signing its
exact bytes with a caller-managed Ed25519 key. Device-proof statements use a distinct
cryptographic context from release signatures and carry a separately governed
project identity. Verification requires either a pinned public key, key ID, and
project name or a versioned trust policy with active/revoked keys, and exposes
authenticated proof lineage only when every check passes. The ingestion
operation returns a path-free, uploader-neutral environment and execution
descriptor under that same authenticated lineage. Optional exact receipt,
revision, native-compatibility, application-artifact, and measurement-window
constraints prevent a valid but stale or unrelated lab result from satisfying
one rollout. Portable schema-1 receipts require a profile fingerprint over the
instrumentation and source policy; the profile operation prints the exact
reviewable identity. The signed measurement time is not an independent trusted
timestamp. The
signing-request operation emits the exact contextual payload for an offline,
HSM, or KMS signer; assemble-signature verifies returned raw or canonical
base64url Ed25519 bytes without reading private-key material. The CLI does not
generate keys, infer trust from a key file, or turn execution evidence into
release authorization.`;

const RUN_HELP = `Usage:
  solid-native run ios [--cwd PATH] [--dry-run] [--json] [--] [run-ios options]
  solid-native run android [--cwd PATH] [--dry-run] [--json] [--] [run-android options]

Solid Native resolves the application-local React Native 0.87 CLI and streams
its native build output directly. Arguments after the platform are forwarded;
use --dry-run to inspect the exact command without building or installing.
An explicit Android --device or --deviceId value is verified through adb before
Gradle starts. Physical targets must be unlocked and receive a reversible wired
stay-awake lease until run-android exits; emulators are not modified. Without a
selector, exactly one authorized target must be connected. Use --list-devices
for React Native's interactive multi-device selection. An automatically
resolved target is pinned into the run-android invocation after validation.
An explicit iOS --device value is treated as physical. An explicit --udid is
resolved against CoreSimulator first; physical destinations must be currently
unlocked before Metro, CocoaPods, or Xcode can start.`;

const LOGS_HELP = `Usage:
  solid-native logs android PACKAGE [--serial ID] [--since VALUE]
                                    [--dry-run] [--json]
  solid-native logs ios BUNDLE --device ID --restart [--dry-run] [--json]

Selects exactly one authorized Android device (or the explicit serial), resolves
the installed application's exact UID, and streams only that UID's JavaScript
and native logcat records across process restarts. History defaults to logcat
-T 1; --since accepts another bounded logcat time or count. Dry runs perform
read-only device/package discovery and print the exact streaming command.

iOS requires an explicit CoreDevice identifier and --restart acknowledgement.
It verifies one developer-installed bundle, replaces that application process,
and attaches its standard streams through Xcode's supported launch console.
It does not include historical logs or survive an application restart. Ctrl-C
ends the console and launched app instead of leaving background processes.`;

const DEVICE_HELP = `Usage:
  solid-native device status-ios BUNDLE --device ID [--json]
  solid-native device stop-ios BUNDLE --device ID [--json]

Inspects or stops one exact developer-installed iOS application on an explicit
CoreDevice target. status-ios is read-only. stop-ios terminates every observed
process generation for that bundle and requires a full one-second clean window
before succeeding, so an immediate scene relaunch cannot be mistaken for
cleanup. Neither operation uninstalls the application or targets another
bundle.`;

const OPEN_HELP = `Usage:
  solid-native open android PACKAGE URL [--serial ID] [--cold]
                                        [--dry-run] [--json]
  solid-native open ios BUNDLE URL --device ID [--cold]
                                   [--dry-run] [--json]

Delivers one validated absolute URL to an explicitly targeted installed
application on a physical device. Android constrains intent resolution to the
selected package and verifies the resolved Activity. iOS verifies one
developer-installed bundle and consumes CoreDevice's structured launch result.

The default preserve mode does not terminate an existing application process;
it launches the app when absent. --cold explicitly stops any existing process
before delivery. Dry runs perform only device/application discovery and print
the exact inspected command. URL query values are visible in plan JSON and the
platform-tool command, so do not use production credentials as test links.`;

const BUILD_HELP = `Usage:
  solid-native build ios [--cwd PATH] [--dry-run] [--json] [--] [build-ios options]
  solid-native build android [--cwd PATH] [--dry-run] [--json] [--] [build-android options]

Creates a non-launching Release build through the application-local React
Native 0.87 CLI. Native options can select another mode, scheme, destination,
or Gradle task. Android Release mode produces bundle/release/app-release.aab;
pass --tasks assembleRelease explicitly when an APK is required. Use --dry-run
to inspect the exact command without building.`;

const BUNDLE_HELP = `Usage:
  solid-native bundle ios|android [--cwd PATH] [--output PATH]
                                  [--entry-file FILE] [--hermes-source]
                                  [--dry-run] [--json]
                                  [--] [Metro options]
  solid-native bundle verify MANIFEST [--json]
  solid-native bundle sources MAP [--cwd PATH] [--require SOURCE]...
                                  [--forbid-containing TEXT]... [--json]

Creates a production OXC/Metro bundle, copied assets, and a composed source map
whose machine paths are canonicalized to portable app:/// identities.
--hermes-source emits the exact non-minified input expected by native iOS and
Android Release Hermes packaging. Use --dry-run to inspect without writing
artifacts. The sources operation validates a raw or canonical map through the
same bounded parser, requires each exact normalized source once, and rejects
every source containing a forbidden fragment.`;

const START_HELP = `Usage:
  solid-native start [--cwd PATH] [--dry-run] [--json] [--] [Metro options]

Validates the installed Solid runtime, OXC/Metro compiler, and application
bootstrap before starting the application-local React Native 0.87 Metro server.
Use --dry-run to inspect the exact command without opening a listening port.`;

const TEST_HELP = `Usage:
  solid-native test [FILE|DIRECTORY...] [--watch]
                    [--test-name-pattern REGEXP]
                    [--production]
                    [--cwd PATH] [--dry-run] [--json]

Discovers *.test and *.spec JavaScript/TypeScript files beneath test/ by
default, compiles TS and TSX with the same Solid universal OXC pipeline used by
Metro, and runs them with Node's built-in test runner. Explicit inputs must stay
inside the application. --watch reruns affected tests when their imported
dependencies change. --test-name-pattern filters test names with a JavaScript
regular expression. No simulator, device, Babel, Jest, or React renderer is
started. Tests use Solid's development runtime by default so diagnostics and
attribution are available. --production selects the optimized runtime for an
explicit production-semantics pass. Use --dry-run to inspect the exact files
and command.`;

const RELEASE_HELP = `Usage:
  solid-native release verify-android-signing AAB|APK
                              [--expected-certificate-sha256 HEX...]
                              [--cwd PATH] [--json]
  solid-native release create --bundle MANIFEST --artifact FILE --release ID
                              --channel NAME --revision SHA [--cwd PATH]
                              [--inspect-embedded-bundle] [--output PATH]
                              [--android-upload-certificate-sha256 HEX]
                              [--android-signing-certificate-sha256 HEX...]
                              [--json]
  solid-native release verify MANIFEST --bundle MANIFEST --artifact FILE
                              [--cwd PATH] [--json]
  solid-native release sign MANIFEST --key PRIVATE_KEY --key-id ID
                              [--bundle MANIFEST --artifact FILE]
                              [--cwd PATH] [--output PATH] [--json]
  solid-native release signing-request MANIFEST --key-id ID
                              [--bundle MANIFEST --artifact FILE]
                              [--cwd PATH] [--output PATH] [--json]
  solid-native release assemble-signature REQUEST --signature FILE
                              --public-key FILE [--cwd PATH]
                              [--output PATH] [--json]
  solid-native release correlate-device-proof SIGNATURE --manifest MANIFEST
                              --bundle MANIFEST --artifact FILE
                              --trust-policy FILE
                              [--minimum-policy-sequence INTEGER]
                              --device-signature FILE --proof RECEIPT
                              --device-trust-policy FILE
                              [--device-minimum-policy-sequence INTEGER]
                              [--device-profile-fingerprint SHA256]
                              [--proof-sha256 SHA256]
                              [--minimum-measured-at UTC]
                              [--maximum-measured-at UTC]
                              [--cwd PATH] [--json]
  solid-native release verify-signature SIGNATURE --manifest MANIFEST
                              --public-key FILE --key-id ID --project NAME
                              --platform ios|android --channel NAME
                              [--release ID] [--revision SHA]
                              [--release-fingerprint SHA256]
                              [--bundle-fingerprint SHA256]
                              [--native-fingerprint SHA256]
                              [--artifact-sha256 HEX]
                              (--bundle MANIFEST --artifact FILE |
                               --envelope-only) [--cwd PATH]
                              [--json]
  solid-native release verify-signature SIGNATURE --manifest MANIFEST
                              --trust-policy FILE
                              [--minimum-policy-sequence INTEGER]
                              (--bundle MANIFEST --artifact FILE |
                               --envelope-only) [--cwd PATH] [--json]
  solid-native release symbolication SIGNATURE --manifest MANIFEST
                              (--trust-policy FILE |
                               --public-key FILE --key-id ID --project NAME
                               --platform ios|android --channel NAME)
                              --bundle MANIFEST --artifact FILE
                              [--minimum-policy-sequence INTEGER]
                              [--cwd PATH] [--json]

Creates or verifies an unsigned deterministic envelope binding the portable
bundle, native compatibility inputs, source revision, channel, and final native
artifact. Detached Ed25519 signatures require either separately pinned key and
scope options or a bounded trust-policy file carrying active/revoked Ed25519
keys plus project/platform/channel scope. Supplying
--bundle and --artifact makes signing and signature verification check every
release input. A signing request exposes the same canonical contextual payload
for an offline or HSM/KMS signer; assembly requires the matching Ed25519 public
key and never reads a private key. Envelope-only verification must be explicit.
The release symbolication operation requires complete input verification and emits the
exact bundle/source-map pair under the same authorized release identity used by
runtime telemetry; it performs no upload. The CLI does not generate keys or
manage credentials. Android signing verification uses JDK jarsigner/keytool,
rejects unsigned or Android-Debug-signed AABs, and can pin the expected upload
certificate SHA-256. Passing that fingerprint to release create also binds the
verified public identity into the envelope. It does not claim Play acceptance
or Play App Signing.`;

interface DoctorArguments {
  readonly cwd?: string;
  readonly json: boolean;
  readonly platform: DoctorPlatform;
  readonly strict: boolean;
}

interface UpgradeArguments {
  readonly candidate: string;
  readonly cwd?: string;
  readonly json: boolean;
}

interface FingerprintArguments {
  readonly cwd?: string;
  readonly json: boolean;
  readonly platform: NativeFingerprintPlatform;
}

interface CausalDebugInspectArguments {
  readonly operation: "inspect";
  readonly cwd?: string;
  readonly includeAttributes: boolean;
  readonly json: boolean;
  readonly operationId?: string;
  readonly snapshotPath: string;
}

interface CausalDebugCaptureAndroidArguments {
  readonly operation: "capture-android";
  readonly packageName: string;
  readonly serial: string;
  readonly timeoutMs?: number;
}

interface SolidDiagnosticsCaptureAndroidArguments {
  readonly operation: "diagnostics-android";
  readonly packageName: string;
  readonly serial: string;
  readonly durationMs?: number;
  readonly timeoutMs?: number;
}

interface CausalDebugReportAndroidArguments {
  readonly operation: "report-android";
  readonly packageName: string;
  readonly serial: string;
  readonly durationMs?: number;
  readonly timeoutMs?: number;
  readonly includeAttributes: boolean;
  readonly outputPath?: string;
}

interface CausalDebugCaptureIosArguments {
  readonly operation: "capture-ios";
  readonly bundleIdentifier: string;
  readonly device: string;
  readonly timeoutMs?: number;
}

interface SolidDiagnosticsCaptureIosArguments {
  readonly operation: "diagnostics-ios";
  readonly bundleIdentifier: string;
  readonly device: string;
  readonly durationMs?: number;
  readonly timeoutMs?: number;
}

interface CausalDebugReportIosArguments {
  readonly operation: "report-ios";
  readonly bundleIdentifier: string;
  readonly device: string;
  readonly durationMs?: number;
  readonly timeoutMs?: number;
  readonly includeAttributes: boolean;
  readonly outputPath?: string;
}

interface SolidDiagnosticsInspectArguments {
  readonly operation: "diagnostics-inspect";
  readonly artifactPath: string;
  readonly cwd?: string;
  readonly json: boolean;
}

interface SolidDiagnosticsCorrelateArguments {
  readonly operation: "correlate";
  readonly diagnosticsPath: string;
  readonly snapshotPath: string;
  readonly cwd?: string;
  readonly json: boolean;
}

interface CausalDebugWatchArgumentsBase {
  readonly count?: number;
  readonly intervalMs?: number;
  readonly json: boolean;
  readonly maxConsecutiveFailures?: number;
  readonly timeoutMs?: number;
}

interface CausalDebugWatchAndroidArguments extends CausalDebugWatchArgumentsBase {
  readonly operation: "watch-android";
  readonly packageName: string;
  readonly serial: string;
}

interface CausalDebugWatchIosArguments extends CausalDebugWatchArgumentsBase {
  readonly operation: "watch-ios";
  readonly bundleIdentifier: string;
  readonly device: string;
}

interface CausalDebugCompareArguments {
  readonly operation: "compare";
  readonly baselinePath: string;
  readonly candidatePath: string;
  readonly cwd?: string;
  readonly json: boolean;
  readonly maxP95RegressionPercent?: number;
}

interface CausalDebugTraceArguments {
  readonly operation: "trace";
  readonly cwd?: string;
  readonly includeAttributes: boolean;
  readonly snapshotPath: string;
}

interface CausalDebugReportArguments {
  readonly operation: "report";
  readonly cwd?: string;
  readonly diagnosticsPath?: string;
  readonly includeAttributes: boolean;
  readonly operationId?: string;
  readonly outputPath?: string;
  readonly snapshotPath: string;
}

interface CausalDebugSymbolicateArgumentsBase {
  readonly operation: "symbolicate";
  readonly cwd?: string;
  readonly json: boolean;
  readonly sourceMapPath: string;
}

type CausalDebugSymbolicateArguments = CausalDebugSymbolicateArgumentsBase &
  (
    | {
        readonly input: "locations";
        readonly locations: readonly NativeGeneratedSourceLocation[];
      }
    | {
        readonly input: "stack";
        readonly stackPath: string;
      }
  );

type CausalDebugArguments =
  | CausalDebugCaptureAndroidArguments
  | SolidDiagnosticsCaptureAndroidArguments
  | CausalDebugReportAndroidArguments
  | CausalDebugCaptureIosArguments
  | SolidDiagnosticsCaptureIosArguments
  | CausalDebugReportIosArguments
  | SolidDiagnosticsInspectArguments
  | SolidDiagnosticsCorrelateArguments
  | CausalDebugWatchAndroidArguments
  | CausalDebugWatchIosArguments
  | CausalDebugCompareArguments
  | CausalDebugInspectArguments
  | CausalDebugReportArguments
  | CausalDebugTraceArguments
  | CausalDebugSymbolicateArguments;

interface CompatibilityCheckArguments {
  readonly operation: "check";
  readonly catalogPath?: string;
  readonly cwd?: string;
  readonly json: boolean;
  readonly platform: NativeGeneratePlatform;
}

interface CompatibilityEvidenceArguments {
  readonly operation: "evidence";
  readonly cwd?: string;
  readonly json: boolean;
  readonly paths: readonly string[];
}

type CompatibilityArguments =
  CompatibilityCheckArguments | CompatibilityEvidenceArguments;

interface DeviceProofSignArguments {
  readonly operation: "sign";
  readonly proofPath: string;
  readonly privateKeyPath: string;
  readonly keyId: string;
  readonly projectName: string;
  readonly cwd?: string;
  readonly outputPath?: string;
  readonly json: boolean;
}

interface DeviceProofCreateAndroidArguments {
  readonly operation: "create-android";
  readonly applicationApkPath: string;
  readonly applicationBundlePath: string;
  readonly cwd?: string;
  readonly forbiddenSourceFragments: readonly string[];
  readonly generatedBindingsPath: string;
  readonly instrumentationApkPath: string;
  readonly instrumentationClass: string;
  readonly instrumentationResultsDirectory: string;
  readonly instrumentationTest: string;
  readonly json: boolean;
  readonly notBefore: string;
  readonly outputPath: string;
  readonly requiredSources: readonly string[];
  readonly serial: string;
  readonly sourceMapPath: string;
}

interface DeviceProofSigningRequestArguments {
  readonly operation: "signing-request";
  readonly proofPath: string;
  readonly keyId: string;
  readonly projectName: string;
  readonly cwd?: string;
  readonly outputPath?: string;
  readonly json: boolean;
}

interface DeviceProofAssembleSignatureArguments {
  readonly operation: "assemble-signature";
  readonly requestPath: string;
  readonly detachedSignaturePath: string;
  readonly publicKeyPath: string;
  readonly cwd?: string;
  readonly outputPath?: string;
  readonly json: boolean;
}

interface DeviceProofProfileArguments {
  readonly operation: "profile";
  readonly proofPath: string;
  readonly cwd?: string;
  readonly json: boolean;
}

interface DeviceProofVerifySignatureBaseArguments {
  readonly operation: "ingestion" | "verify-signature";
  readonly signaturePath: string;
  readonly proofPath: string;
  readonly expectedProofSha256?: string;
  readonly expectedSourceRevision?: string;
  readonly expectedNativeCompatibilityFingerprint?: string;
  readonly expectedApplicationArtifactSha256?: string;
  readonly expectedProfileFingerprint?: string;
  readonly minimumMeasuredAt?: string;
  readonly maximumMeasuredAt?: string;
  readonly cwd?: string;
  readonly json: boolean;
}

interface DeviceProofVerifySignaturePinnedArguments extends DeviceProofVerifySignatureBaseArguments {
  readonly publicKeyPath: string;
  readonly expectedKeyId: string;
  readonly projectName: string;
  readonly trustPolicyPath?: never;
  readonly minimumTrustPolicySequence?: never;
}

interface DeviceProofVerifySignaturePolicyArguments extends DeviceProofVerifySignatureBaseArguments {
  readonly trustPolicyPath: string;
  readonly minimumTrustPolicySequence?: number;
  readonly publicKeyPath?: never;
  readonly expectedKeyId?: never;
  readonly projectName?: never;
}

type DeviceProofVerifySignatureArguments =
  | DeviceProofVerifySignaturePinnedArguments
  | DeviceProofVerifySignaturePolicyArguments;

type DeviceProofArguments =
  | DeviceProofCreateAndroidArguments
  | DeviceProofSignArguments
  | DeviceProofSigningRequestArguments
  | DeviceProofAssembleSignatureArguments
  | DeviceProofProfileArguments
  | DeviceProofVerifySignatureArguments;

interface AdapterArguments {
  readonly bindingsPath?: string;
  readonly cwd?: string;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly moduleName: string;
  readonly outputPath?: string;
  readonly packageName: string;
  readonly platform: NativeGeneratePlatform;
}

interface AddArguments {
  readonly capability: "navigation";
  readonly cwd?: string;
  readonly dryRun: boolean;
  readonly json: boolean;
}

interface RunArguments {
  readonly cwd?: string;
  readonly dryRun: boolean;
  readonly forwardedArgs: readonly string[];
  readonly json: boolean;
  readonly platform: NativeRunPlatform;
}

interface AndroidLogsArguments {
  readonly platform: "android";
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly packageName: string;
  readonly serial?: string;
  readonly since?: string;
}

interface IosLogsArguments {
  readonly platform: "ios";
  readonly bundleIdentifier: string;
  readonly device: string;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly restart: true;
}

type LogsArguments = AndroidLogsArguments | IosLogsArguments;

interface DeviceIosArguments {
  readonly operation: "status-ios" | "stop-ios";
  readonly bundleIdentifier: string;
  readonly device: string;
  readonly json: boolean;
}

interface AndroidOpenArguments {
  readonly platform: "android";
  readonly cold: boolean;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly packageName: string;
  readonly serial?: string;
  readonly url: string;
}

interface IosOpenArguments {
  readonly platform: "ios";
  readonly bundleIdentifier: string;
  readonly cold: boolean;
  readonly device: string;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly url: string;
}

type OpenArguments = AndroidOpenArguments | IosOpenArguments;

interface BuildArguments {
  readonly cwd?: string;
  readonly dryRun: boolean;
  readonly forwardedArgs: readonly string[];
  readonly json: boolean;
  readonly platform: NativeBuildPlatform;
}

interface BundleArguments {
  readonly cwd?: string;
  readonly dryRun: boolean;
  readonly entryFile?: string;
  readonly forwardedArgs: readonly string[];
  readonly json: boolean;
  readonly hermesSource: boolean;
  readonly outputDirectory?: string;
  readonly platform: NativeBundlePlatform;
}

interface BundleVerifyArguments {
  readonly json: boolean;
  readonly manifestPath: string;
}

interface BundleSourcesArguments {
  readonly cwd?: string;
  readonly forbiddenSourceFragments: readonly string[];
  readonly json: boolean;
  readonly requiredSources: readonly string[];
  readonly sourceMapPath: string;
}

interface StartArguments {
  readonly cwd?: string;
  readonly dryRun: boolean;
  readonly forwardedArgs: readonly string[];
  readonly json: boolean;
}

interface TestArguments {
  readonly cwd?: string;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly paths: readonly string[];
  readonly runtime: NativeTestRuntime;
  readonly testNamePattern?: string;
  readonly watch: boolean;
}

interface ReleaseCreateArguments {
  readonly androidSigningCertificateSha256s: readonly string[];
  readonly androidUploadCertificateSha256?: string;
  readonly artifactPath: string;
  readonly bundleManifestPath: string;
  readonly channel: string;
  readonly cwd?: string;
  readonly json: boolean;
  readonly inspectEmbeddedBundle: boolean;
  readonly outputPath?: string;
  readonly release: string;
  readonly sourceRevision: string;
}

interface ReleaseVerifyAndroidSigningArguments {
  readonly artifactPath: string;
  readonly cwd?: string;
  readonly expectedCertificateSha256s: readonly string[];
  readonly json: boolean;
}

interface ReleaseVerifyArguments {
  readonly artifactPath: string;
  readonly bundleManifestPath: string;
  readonly cwd?: string;
  readonly json: boolean;
  readonly manifestPath: string;
}

interface ReleaseSignArguments {
  readonly cwd?: string;
  readonly json: boolean;
  readonly keyId: string;
  readonly manifestPath: string;
  readonly outputPath?: string;
  readonly privateKeyPath: string;
  readonly artifactPath?: string;
  readonly bundleManifestPath?: string;
}

interface ReleaseSigningRequestArguments {
  readonly cwd?: string;
  readonly json: boolean;
  readonly keyId: string;
  readonly manifestPath: string;
  readonly outputPath?: string;
  readonly artifactPath?: string;
  readonly bundleManifestPath?: string;
}

interface ReleaseAssembleSignatureArguments {
  readonly cwd?: string;
  readonly detachedSignaturePath: string;
  readonly json: boolean;
  readonly outputPath?: string;
  readonly publicKeyPath: string;
  readonly requestPath: string;
}

interface ReleaseDeviceCorrelationArguments {
  readonly artifactPath: string;
  readonly bundleManifestPath: string;
  readonly cwd?: string;
  readonly deviceMinimumTrustPolicySequence?: number;
  readonly deviceProofPath: string;
  readonly deviceProfileFingerprint?: string;
  readonly deviceSignaturePath: string;
  readonly deviceTrustPolicyPath: string;
  readonly expectedProofSha256?: string;
  readonly json: boolean;
  readonly manifestPath: string;
  readonly maximumMeasuredAt?: string;
  readonly minimumMeasuredAt?: string;
  readonly minimumTrustPolicySequence?: number;
  readonly signaturePath: string;
  readonly trustPolicyPath: string;
}

interface ReleaseVerifySignatureArguments {
  readonly cwd?: string;
  readonly expectedKeyId?: string;
  readonly artifactPath?: string;
  readonly bundleManifestPath?: string;
  readonly json: boolean;
  readonly manifestPath: string;
  readonly minimumTrustPolicySequence?: number;
  readonly policy?: NativeReleaseAuthorizationPolicy;
  readonly publicKeyPath?: string;
  readonly signaturePath: string;
  readonly trustPolicyPath?: string;
  readonly envelopeOnly: boolean;
}

interface GenerateArguments {
  readonly audit: boolean;
  readonly check: boolean;
  readonly cwd?: string;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly outputPath?: string;
  readonly platform: NativeGeneratePlatform;
  readonly source: NativeGenerateSource;
  readonly generateSolidBindings: boolean;
  readonly solidLibraries: readonly string[];
  readonly solidOutputPath?: string;
  readonly verbose: boolean;
}

interface CreateArguments {
  readonly directory?: string;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly packageName?: string;
  readonly projectName: string;
  readonly skipInstall: boolean;
  readonly title?: string;
}

function argumentValue(
  args: readonly string[],
  index: number,
  flag: string,
): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new TypeError(`${flag} requires a value.`);
  }
  return value;
}

function parseCreateArguments(
  args: readonly string[],
): CreateArguments | undefined {
  const projectName = args[0];
  if (projectName === "--help" || projectName === "-h") {
    process.stdout.write(`${CREATE_HELP}\n`);
    return undefined;
  }
  if (projectName === undefined || projectName.startsWith("-")) {
    throw new TypeError("create requires a project name.");
  }
  let directory: string | undefined;
  let dryRun = false;
  let json = false;
  let packageName: string | undefined;
  let skipInstall = false;
  let title: string | undefined;
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--directory") {
      directory = argumentValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--package-name") {
      packageName = argumentValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--title") {
      title = argumentValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--skip-install") {
      skipInstall = true;
      continue;
    }
    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${CREATE_HELP}\n`);
      return undefined;
    }
    throw new TypeError(`Unknown create option ${String(argument)}.`);
  }
  if (json && !dryRun) {
    throw new TypeError(
      "create --json requires --dry-run so scaffold logs cannot corrupt JSON output.",
    );
  }
  return {
    dryRun,
    json,
    projectName,
    skipInstall,
    ...(directory === undefined ? {} : { directory }),
    ...(packageName === undefined ? {} : { packageName }),
    ...(title === undefined ? {} : { title }),
  };
}

function parseDoctorArguments(args: readonly string[]): DoctorArguments {
  let cwd: string | undefined;
  let json = false;
  let platform: DoctorPlatform = "all";
  let strict = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--strict") {
      strict = true;
      continue;
    }
    if (argument === "--cwd") {
      cwd = argumentValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--platform") {
      const value = argumentValue(args, index, argument);
      if (value !== "all" && value !== "ios" && value !== "android") {
        throw new TypeError(`Unsupported platform ${value}.`);
      }
      platform = value;
      index += 1;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${HELP}\n`);
      process.exitCode = 0;
      return {
        json,
        platform,
        strict,
        ...(cwd === undefined ? {} : { cwd }),
      };
    }
    throw new TypeError(`Unknown doctor option ${String(argument)}.`);
  }
  return { json, platform, strict, ...(cwd === undefined ? {} : { cwd }) };
}

function parseUpgradeArguments(
  args: readonly string[],
): UpgradeArguments | undefined {
  const target = args[0];
  if (target === "--help" || target === "-h") {
    process.stdout.write(`${UPGRADE_HELP}\n`);
    return undefined;
  }
  if (target !== "react-native") {
    throw new TypeError(
      target === undefined
        ? "upgrade requires the react-native target."
        : `Unsupported upgrade target ${target}.`,
    );
  }
  let candidate: string | undefined;
  let cwd: string | undefined;
  let json = false;
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--candidate") {
      candidate = argumentValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--cwd") {
      cwd = argumentValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${UPGRADE_HELP}\n`);
      return undefined;
    }
    throw new TypeError(`Unknown upgrade option ${String(argument)}.`);
  }
  if (candidate === undefined) {
    throw new TypeError("upgrade react-native requires --candidate PATH.");
  }
  return {
    candidate,
    json,
    ...(cwd === undefined ? {} : { cwd }),
  };
}

function parseFingerprintArguments(
  args: readonly string[],
): FingerprintArguments | undefined {
  let cwd: string | undefined;
  let json = false;
  let platform: NativeFingerprintPlatform = "all";
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--cwd") {
      cwd = argumentValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--platform") {
      const value = argumentValue(args, index, argument);
      if (value !== "all" && value !== "ios" && value !== "android") {
        throw new TypeError(`Unsupported platform ${value}.`);
      }
      platform = value;
      index += 1;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${FINGERPRINT_HELP}\n`);
      return undefined;
    }
    throw new TypeError(`Unknown fingerprint option ${String(argument)}.`);
  }
  return { json, platform, ...(cwd === undefined ? {} : { cwd }) };
}

function parseCausalDebugArguments(
  args: readonly string[],
): CausalDebugArguments | undefined {
  const operation = args[0];
  if (operation === "--help" || operation === "-h") {
    process.stdout.write(`${CAUSAL_DEBUG_HELP}\n`);
    return undefined;
  }
  if (
    operation !== "capture-android" &&
    operation !== "diagnostics-android" &&
    operation !== "report-android" &&
    operation !== "capture-ios" &&
    operation !== "diagnostics-ios" &&
    operation !== "report-ios" &&
    operation !== "diagnostics-inspect" &&
    operation !== "correlate" &&
    operation !== "watch-android" &&
    operation !== "watch-ios" &&
    operation !== "compare" &&
    operation !== "inspect" &&
    operation !== "report" &&
    operation !== "trace" &&
    operation !== "symbolicate"
  ) {
    throw new TypeError(
      "debug requires capture-android, diagnostics-android, report-android, capture-ios, diagnostics-ios, report-ios, diagnostics-inspect, correlate, watch-android, watch-ios, compare, inspect, report, trace, or symbolicate.",
    );
  }
  if (operation === "correlate") {
    const diagnosticsPath = args[1];
    const snapshotPath = args[2];
    if (
      diagnosticsPath === "--help" ||
      diagnosticsPath === "-h" ||
      snapshotPath === "--help" ||
      snapshotPath === "-h"
    ) {
      process.stdout.write(`${CAUSAL_DEBUG_HELP}\n`);
      return undefined;
    }
    if (
      diagnosticsPath === undefined ||
      snapshotPath === undefined ||
      diagnosticsPath.startsWith("-") ||
      snapshotPath.startsWith("-")
    ) {
      throw new TypeError(
        "debug correlate requires diagnostics and causal snapshot paths.",
      );
    }
    let cwd: string | undefined;
    let json = false;
    for (let index = 3; index < args.length; index += 1) {
      const argument = args[index];
      if (argument === "--cwd") {
        cwd = argumentValue(args, index, argument);
        index += 1;
        continue;
      }
      if (argument === "--json") {
        json = true;
        continue;
      }
      if (argument === "--help" || argument === "-h") {
        process.stdout.write(`${CAUSAL_DEBUG_HELP}\n`);
        return undefined;
      }
      throw new TypeError(
        `Unknown debug correlate option ${String(argument)}.`,
      );
    }
    return {
      operation,
      diagnosticsPath,
      snapshotPath,
      json,
      ...(cwd === undefined ? {} : { cwd }),
    };
  }
  if (operation === "compare") {
    const baselinePath = args[1];
    const candidatePath = args[2];
    if (
      baselinePath === "--help" ||
      baselinePath === "-h" ||
      candidatePath === "--help" ||
      candidatePath === "-h"
    ) {
      process.stdout.write(`${CAUSAL_DEBUG_HELP}\n`);
      return undefined;
    }
    if (
      baselinePath === undefined ||
      candidatePath === undefined ||
      baselinePath.startsWith("-") ||
      candidatePath.startsWith("-")
    ) {
      throw new TypeError(
        "debug compare requires baseline and candidate snapshot paths.",
      );
    }
    let cwd: string | undefined;
    let json = false;
    let maxP95RegressionPercent: number | undefined;
    for (let index = 3; index < args.length; index += 1) {
      const argument = args[index];
      if (argument === "--cwd") {
        cwd = argumentValue(args, index, argument);
        index += 1;
        continue;
      }
      if (argument === "--json") {
        json = true;
        continue;
      }
      if (argument === "--max-p95-regression") {
        const value = Number(argumentValue(args, index, argument));
        if (!Number.isFinite(value) || value < 0 || value > 10_000) {
          throw new TypeError(
            "--max-p95-regression requires a finite percentage from 0 through 10000.",
          );
        }
        maxP95RegressionPercent = value;
        index += 1;
        continue;
      }
      if (argument === "--help" || argument === "-h") {
        process.stdout.write(`${CAUSAL_DEBUG_HELP}\n`);
        return undefined;
      }
      throw new TypeError(`Unknown debug compare option ${String(argument)}.`);
    }
    return {
      operation,
      baselinePath,
      candidatePath,
      json,
      ...(cwd === undefined ? {} : { cwd }),
      ...(maxP95RegressionPercent === undefined
        ? {}
        : { maxP95RegressionPercent }),
    };
  }
  const androidDeviceOperation =
    operation === "capture-android" ||
    operation === "diagnostics-android" ||
    operation === "report-android" ||
    operation === "watch-android";
  const iosDeviceOperation =
    operation === "capture-ios" ||
    operation === "diagnostics-ios" ||
    operation === "report-ios" ||
    operation === "watch-ios";
  const deviceOperation = androidDeviceOperation || iosDeviceOperation;
  const liveReportOperation =
    operation === "report-android" || operation === "report-ios";
  const watchOperation =
    operation === "watch-android" || operation === "watch-ios";
  const inputPath = args[1];
  if (inputPath === "--help" || inputPath === "-h") {
    process.stdout.write(`${CAUSAL_DEBUG_HELP}\n`);
    return undefined;
  }
  if (
    inputPath === undefined ||
    (inputPath.startsWith("-") &&
      !(operation !== "symbolicate" && !deviceOperation && inputPath === "-"))
  ) {
    throw new TypeError(
      deviceOperation
        ? `debug ${operation} requires ${androidDeviceOperation ? "an Android application ID" : "an iOS bundle identifier"}.`
        : `debug ${operation} requires an input path.`,
    );
  }
  let count: number | undefined;
  let cwd: string | undefined;
  let includeAttributes = false;
  let json = false;
  let device: string | undefined;
  let diagnosticsPath: string | undefined;
  let durationMs: number | undefined;
  let intervalMs: number | undefined;
  let maxConsecutiveFailures: number | undefined;
  let operationId: string | undefined;
  let outputPath: string | undefined;
  let serial: string | undefined;
  let stackPath: string | undefined;
  let timeoutMs: number | undefined;
  const locations: NativeGeneratedSourceLocation[] = [];
  for (let index = 2; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--cwd") {
      if (deviceOperation) {
        throw new TypeError(`debug ${operation} does not support --cwd.`);
      }
      cwd = argumentValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--json") {
      if (
        operation === "report" ||
        liveReportOperation ||
        operation === "trace" ||
        operation === "capture-android" ||
        operation === "diagnostics-android" ||
        operation === "capture-ios" ||
        operation === "diagnostics-ios"
      ) {
        throw new TypeError(
          operation === "trace" || operation === "report" || liveReportOperation
            ? `debug ${operation} always emits ${operation === "trace" ? "Chrome JSON" : "HTML"} and does not support --json.`
            : `debug ${operation} always emits snapshot JSON and does not support --json.`,
        );
      }
      json = true;
      continue;
    }
    if (argument === "--operation") {
      if (operation !== "inspect" && operation !== "report") {
        throw new TypeError(`debug ${operation} does not support --operation.`);
      }
      operationId = argumentValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--diagnostics") {
      if (operation !== "report") {
        throw new TypeError(
          `debug ${operation} does not support --diagnostics.`,
        );
      }
      const value = argumentValue(args, index, argument);
      if (value === "-") {
        throw new TypeError(
          "debug report --diagnostics requires a file path, not stdin.",
        );
      }
      if (diagnosticsPath !== undefined) {
        throw new TypeError("debug report accepts --diagnostics only once.");
      }
      diagnosticsPath = value;
      index += 1;
      continue;
    }
    if (argument === "--show-attributes") {
      if (
        operation === "symbolicate" ||
        operation === "diagnostics-inspect" ||
        (deviceOperation && !liveReportOperation)
      ) {
        throw new TypeError(
          `debug ${operation} does not support --show-attributes.`,
        );
      }
      includeAttributes = true;
      continue;
    }
    if (argument === "--output") {
      if (operation !== "report" && !liveReportOperation) {
        throw new TypeError(`debug ${operation} does not support --output.`);
      }
      if (outputPath !== undefined) {
        throw new TypeError(`debug ${operation} accepts --output only once.`);
      }
      const value = argumentValue(args, index, argument);
      if (value === "-") {
        throw new TypeError(
          `debug ${operation} --output requires a file path; omit it for stdout.`,
        );
      }
      outputPath = value;
      index += 1;
      continue;
    }
    if (argument === "--serial") {
      if (!androidDeviceOperation) {
        throw new TypeError(`debug ${operation} does not support --serial.`);
      }
      serial = argumentValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--device") {
      if (!iosDeviceOperation) {
        throw new TypeError(`debug ${operation} does not support --device.`);
      }
      device = argumentValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--timeout") {
      if (!deviceOperation) {
        throw new TypeError(`debug ${operation} does not support --timeout.`);
      }
      const value = argumentValue(args, index, argument);
      timeoutMs = Number(value);
      if (!Number.isSafeInteger(timeoutMs)) {
        throw new TypeError("--timeout requires a safe integer.");
      }
      index += 1;
      continue;
    }
    if (argument === "--duration") {
      if (
        operation !== "diagnostics-android" &&
        operation !== "diagnostics-ios" &&
        operation !== "report-android" &&
        operation !== "report-ios"
      ) {
        throw new TypeError(`debug ${operation} does not support --duration.`);
      }
      durationMs = Number(argumentValue(args, index, argument));
      if (!Number.isSafeInteger(durationMs)) {
        throw new TypeError("--duration requires a safe integer.");
      }
      index += 1;
      continue;
    }
    if (
      argument === "--interval" ||
      argument === "--count" ||
      argument === "--max-failures"
    ) {
      if (!watchOperation) {
        throw new TypeError(`debug ${operation} does not support ${argument}.`);
      }
      const value = Number(argumentValue(args, index, argument));
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new TypeError(`${argument} requires a positive safe integer.`);
      }
      if (argument === "--interval") intervalMs = value;
      if (argument === "--count") count = value;
      if (argument === "--max-failures") {
        maxConsecutiveFailures = value;
      }
      index += 1;
      continue;
    }
    if (argument === "--at") {
      if (operation !== "symbolicate") {
        throw new TypeError(`debug ${operation} does not support --at.`);
      }
      const value = argumentValue(args, index, argument);
      const match = /^([1-9]\d*):([1-9]\d*)$/u.exec(value);
      if (match === null) {
        throw new TypeError(
          `Symbolication location ${JSON.stringify(value)} must use positive one-based LINE:COLUMN.`,
        );
      }
      const line = Number(match[1]);
      const column = Number(match[2]);
      if (!Number.isSafeInteger(line) || !Number.isSafeInteger(column)) {
        throw new TypeError(
          `Symbolication location ${JSON.stringify(value)} must use safe integers.`,
        );
      }
      locations.push({ line, column });
      index += 1;
      continue;
    }
    if (argument === "--stack") {
      if (operation !== "symbolicate") {
        throw new TypeError(`debug ${operation} does not support --stack.`);
      }
      if (stackPath !== undefined) {
        throw new TypeError("debug symbolicate accepts --stack only once.");
      }
      const value = args[index + 1];
      if (
        value === undefined ||
        value.length === 0 ||
        (value.startsWith("-") && value !== "-")
      ) {
        throw new TypeError("--stack requires a file path or - for stdin.");
      }
      stackPath = value;
      index += 1;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${CAUSAL_DEBUG_HELP}\n`);
      return undefined;
    }
    throw new TypeError(
      `Unknown debug ${operation} option ${String(argument)}.`,
    );
  }
  if (operation === "capture-android") {
    if (serial === undefined) {
      throw new TypeError("debug capture-android requires --serial.");
    }
    return {
      operation,
      packageName: inputPath,
      serial,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    };
  }
  if (operation === "diagnostics-android") {
    if (serial === undefined) {
      throw new TypeError("debug diagnostics-android requires --serial.");
    }
    return {
      operation,
      packageName: inputPath,
      serial,
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    };
  }
  if (operation === "report-android") {
    if (serial === undefined) {
      throw new TypeError("debug report-android requires --serial.");
    }
    return {
      operation,
      packageName: inputPath,
      serial,
      includeAttributes,
      ...(outputPath === undefined ? {} : { outputPath }),
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    };
  }
  if (operation === "capture-ios") {
    if (device === undefined) {
      throw new TypeError("debug capture-ios requires --device.");
    }
    return {
      operation,
      bundleIdentifier: inputPath,
      device,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    };
  }
  if (operation === "diagnostics-ios") {
    if (device === undefined) {
      throw new TypeError("debug diagnostics-ios requires --device.");
    }
    return {
      operation,
      bundleIdentifier: inputPath,
      device,
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    };
  }
  if (operation === "report-ios") {
    if (device === undefined) {
      throw new TypeError("debug report-ios requires --device.");
    }
    return {
      operation,
      bundleIdentifier: inputPath,
      device,
      includeAttributes,
      ...(outputPath === undefined ? {} : { outputPath }),
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    };
  }
  if (operation === "watch-android") {
    if (serial === undefined) {
      throw new TypeError("debug watch-android requires --serial.");
    }
    return {
      operation,
      packageName: inputPath,
      serial,
      json,
      ...(count === undefined ? {} : { count }),
      ...(intervalMs === undefined ? {} : { intervalMs }),
      ...(maxConsecutiveFailures === undefined
        ? {}
        : { maxConsecutiveFailures }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    };
  }
  if (operation === "diagnostics-inspect") {
    return {
      operation,
      artifactPath: inputPath,
      json,
      ...(cwd === undefined ? {} : { cwd }),
    };
  }
  if (operation === "watch-ios") {
    if (device === undefined) {
      throw new TypeError("debug watch-ios requires --device.");
    }
    return {
      operation,
      bundleIdentifier: inputPath,
      device,
      json,
      ...(count === undefined ? {} : { count }),
      ...(intervalMs === undefined ? {} : { intervalMs }),
      ...(maxConsecutiveFailures === undefined
        ? {}
        : { maxConsecutiveFailures }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    };
  }
  if (operation === "symbolicate") {
    if (locations.length > 0 && stackPath !== undefined) {
      throw new TypeError(
        "debug symbolicate --at and --stack are mutually exclusive.",
      );
    }
    if (locations.length === 0 && stackPath === undefined) {
      throw new TypeError("debug symbolicate requires --at or --stack.");
    }
    const common = {
      operation,
      json,
      sourceMapPath: inputPath,
      ...(cwd === undefined ? {} : { cwd }),
    } as const;
    return stackPath === undefined
      ? { ...common, input: "locations", locations }
      : { ...common, input: "stack", stackPath };
  }
  if (operation === "trace") {
    return {
      operation,
      includeAttributes,
      snapshotPath: inputPath,
      ...(cwd === undefined ? {} : { cwd }),
    };
  }
  if (operation === "report") {
    return {
      operation,
      includeAttributes,
      snapshotPath: inputPath,
      ...(outputPath === undefined ? {} : { outputPath }),
      ...(cwd === undefined ? {} : { cwd }),
      ...(diagnosticsPath === undefined ? {} : { diagnosticsPath }),
      ...(operationId === undefined ? {} : { operationId }),
    };
  }
  return {
    operation,
    includeAttributes,
    json,
    snapshotPath: inputPath,
    ...(cwd === undefined ? {} : { cwd }),
    ...(operationId === undefined ? {} : { operationId }),
  };
}

function parseCompatibilityArguments(
  args: readonly string[],
): CompatibilityArguments | undefined {
  const operation = args[0];
  if (operation === "--help" || operation === "-h") {
    process.stdout.write(`${COMPATIBILITY_HELP}\n`);
    return undefined;
  }
  if (operation === "evidence") {
    let cwd: string | undefined;
    let json = false;
    const paths: string[] = [];
    for (let index = 1; index < args.length; index += 1) {
      const argument = args[index]!;
      if (argument === "--help" || argument === "-h") {
        process.stdout.write(`${COMPATIBILITY_HELP}\n`);
        return undefined;
      }
      if (argument === "--json") {
        json = true;
        continue;
      }
      if (argument === "--cwd") {
        cwd = argumentValue(args, index, argument);
        index += 1;
        continue;
      }
      if (argument.startsWith("-")) {
        throw new TypeError(
          `Unknown compatibility evidence option ${String(argument)}.`,
        );
      }
      paths.push(argument);
    }
    if (paths.length === 0) {
      throw new TypeError("compatibility evidence requires at least one file.");
    }
    return {
      operation,
      json,
      paths: Object.freeze(paths),
      ...(cwd === undefined ? {} : { cwd }),
    };
  }
  if (operation !== "check") {
    throw new TypeError(
      "compatibility requires the check or evidence operation.",
    );
  }
  let catalogPath: string | undefined;
  let cwd: string | undefined;
  let json = false;
  let platform: NativeGeneratePlatform = "all";
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${COMPATIBILITY_HELP}\n`);
      return undefined;
    }
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--catalog") {
      catalogPath = argumentValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--cwd") {
      cwd = argumentValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--platform") {
      const value = argumentValue(args, index, argument);
      if (value !== "all" && value !== "ios" && value !== "android") {
        throw new TypeError(`Unsupported platform ${value}.`);
      }
      platform = value;
      index += 1;
      continue;
    }
    throw new TypeError(`Unknown compatibility option ${String(argument)}.`);
  }
  return {
    operation,
    json,
    platform,
    ...(catalogPath === undefined ? {} : { catalogPath }),
    ...(cwd === undefined ? {} : { cwd }),
  };
}

function parseDeviceProofArguments(
  args: readonly string[],
): DeviceProofArguments | undefined {
  const operation = args[0];
  if (operation === "--help" || operation === "-h") {
    process.stdout.write(`${DEVICE_PROOF_HELP}\n`);
    return undefined;
  }
  if (operation === "create-android") {
    let applicationApkPath: string | undefined;
    let applicationBundlePath: string | undefined;
    let cwd: string | undefined;
    const forbiddenSourceFragments: string[] = [];
    let generatedBindingsPath: string | undefined;
    let instrumentationApkPath: string | undefined;
    let instrumentationClass: string | undefined;
    let instrumentationResultsDirectory: string | undefined;
    let instrumentationTest: string | undefined;
    let json = false;
    let notBefore: string | undefined;
    let outputPath: string | undefined;
    const requiredSources: string[] = [];
    let serial: string | undefined;
    let sourceMapPath: string | undefined;
    const singles = new Set<string>();
    for (let index = 1; index < args.length; index += 1) {
      const argument = args[index]!;
      if (argument === "--help" || argument === "-h") {
        process.stdout.write(`${DEVICE_PROOF_HELP}\n`);
        return undefined;
      }
      if (argument === "--json") {
        json = true;
        continue;
      }
      if (argument === "--require" || argument === "--forbid-containing") {
        const value = argumentValue(args, index, argument);
        if (argument === "--require") requiredSources.push(value);
        else forbiddenSourceFragments.push(value);
        index += 1;
        continue;
      }
      if (
        argument === "--apk" ||
        argument === "--bindings" ||
        argument === "--bundle" ||
        argument === "--cwd" ||
        argument === "--instrumentation-apk" ||
        argument === "--instrumentation-class" ||
        argument === "--instrumentation-results" ||
        argument === "--instrumentation-test" ||
        argument === "--not-before" ||
        argument === "--output" ||
        argument === "--serial" ||
        argument === "--source-map"
      ) {
        if (singles.has(argument)) {
          throw new TypeError(
            `device-proof create-android option ${argument} is duplicated.`,
          );
        }
        singles.add(argument);
        const value = argumentValue(args, index, argument);
        if (argument === "--apk") applicationApkPath = value;
        if (argument === "--bindings") generatedBindingsPath = value;
        if (argument === "--bundle") applicationBundlePath = value;
        if (argument === "--cwd") cwd = value;
        if (argument === "--instrumentation-apk") {
          instrumentationApkPath = value;
        }
        if (argument === "--instrumentation-class") {
          instrumentationClass = value;
        }
        if (argument === "--instrumentation-results") {
          instrumentationResultsDirectory = value;
        }
        if (argument === "--instrumentation-test") {
          instrumentationTest = value;
        }
        if (argument === "--not-before") notBefore = value;
        if (argument === "--output") outputPath = value;
        if (argument === "--serial") serial = value;
        if (argument === "--source-map") sourceMapPath = value;
        index += 1;
        continue;
      }
      throw new TypeError(
        `Unknown device-proof create-android option ${String(argument)}.`,
      );
    }
    const missing = [
      ...(serial === undefined ? ["--serial"] : []),
      ...(notBefore === undefined ? ["--not-before"] : []),
      ...(applicationBundlePath === undefined ? ["--bundle"] : []),
      ...(sourceMapPath === undefined ? ["--source-map"] : []),
      ...(applicationApkPath === undefined ? ["--apk"] : []),
      ...(instrumentationApkPath === undefined
        ? ["--instrumentation-apk"]
        : []),
      ...(generatedBindingsPath === undefined ? ["--bindings"] : []),
      ...(instrumentationResultsDirectory === undefined
        ? ["--instrumentation-results"]
        : []),
      ...(instrumentationClass === undefined
        ? ["--instrumentation-class"]
        : []),
      ...(instrumentationTest === undefined ? ["--instrumentation-test"] : []),
      ...(requiredSources.length === 0 ? ["--require"] : []),
      ...(outputPath === undefined ? ["--output"] : []),
    ];
    if (missing.length > 0) {
      throw new TypeError(
        `device-proof create-android requires ${missing.join(", ")}.`,
      );
    }
    return {
      operation,
      applicationApkPath: applicationApkPath!,
      applicationBundlePath: applicationBundlePath!,
      forbiddenSourceFragments: Object.freeze(forbiddenSourceFragments),
      generatedBindingsPath: generatedBindingsPath!,
      instrumentationApkPath: instrumentationApkPath!,
      instrumentationClass: instrumentationClass!,
      instrumentationResultsDirectory: instrumentationResultsDirectory!,
      instrumentationTest: instrumentationTest!,
      json,
      notBefore: notBefore!,
      outputPath: outputPath!,
      requiredSources: Object.freeze(requiredSources),
      serial: serial!,
      sourceMapPath: sourceMapPath!,
      ...(cwd === undefined ? {} : { cwd }),
    };
  }
  if (operation === "profile") {
    const proofPath = args[1];
    if (
      proofPath === undefined ||
      proofPath.startsWith("-") ||
      proofPath.length === 0
    ) {
      throw new TypeError("device-proof profile requires a receipt path.");
    }
    let cwd: string | undefined;
    let json = false;
    for (let index = 2; index < args.length; index += 1) {
      const argument = args[index]!;
      if (argument === "--help" || argument === "-h") {
        process.stdout.write(`${DEVICE_PROOF_HELP}\n`);
        return undefined;
      }
      if (argument === "--json") {
        json = true;
        continue;
      }
      if (argument === "--cwd") {
        cwd = argumentValue(args, index, argument);
        index += 1;
        continue;
      }
      throw new TypeError(
        `Unknown device-proof profile option ${String(argument)}.`,
      );
    }
    return {
      operation,
      proofPath,
      json,
      ...(cwd === undefined ? {} : { cwd }),
    };
  }
  if (operation === "sign") {
    const proofPath = args[1];
    if (
      proofPath === undefined ||
      proofPath.startsWith("-") ||
      proofPath.length === 0
    ) {
      throw new TypeError("device-proof sign requires a receipt path.");
    }
    let cwd: string | undefined;
    let json = false;
    let keyId: string | undefined;
    let outputPath: string | undefined;
    let privateKeyPath: string | undefined;
    let projectName: string | undefined;
    for (let index = 2; index < args.length; index += 1) {
      const argument = args[index]!;
      if (argument === "--help" || argument === "-h") {
        process.stdout.write(`${DEVICE_PROOF_HELP}\n`);
        return undefined;
      }
      if (argument === "--json") {
        json = true;
        continue;
      }
      if (
        argument === "--cwd" ||
        argument === "--key" ||
        argument === "--key-id" ||
        argument === "--output" ||
        argument === "--project"
      ) {
        const value = argumentValue(args, index, argument);
        if (argument === "--cwd") cwd = value;
        if (argument === "--key") privateKeyPath = value;
        if (argument === "--key-id") keyId = value;
        if (argument === "--output") outputPath = value;
        if (argument === "--project") projectName = value;
        index += 1;
        continue;
      }
      throw new TypeError(
        `Unknown device-proof sign option ${String(argument)}.`,
      );
    }
    const missing = [
      ...(privateKeyPath === undefined ? ["--key"] : []),
      ...(keyId === undefined ? ["--key-id"] : []),
      ...(projectName === undefined ? ["--project"] : []),
    ];
    if (missing.length > 0) {
      throw new TypeError(`device-proof sign requires ${missing.join(", ")}.`);
    }
    return {
      operation,
      proofPath,
      privateKeyPath: privateKeyPath!,
      keyId: keyId!,
      projectName: projectName!,
      json,
      ...(cwd === undefined ? {} : { cwd }),
      ...(outputPath === undefined ? {} : { outputPath }),
    };
  }
  if (operation === "signing-request") {
    const proofPath = args[1];
    if (
      proofPath === undefined ||
      proofPath.startsWith("-") ||
      proofPath.length === 0
    ) {
      throw new TypeError(
        "device-proof signing-request requires a receipt path.",
      );
    }
    let cwd: string | undefined;
    let json = false;
    let keyId: string | undefined;
    let outputPath: string | undefined;
    let projectName: string | undefined;
    for (let index = 2; index < args.length; index += 1) {
      const argument = args[index]!;
      if (argument === "--help" || argument === "-h") {
        process.stdout.write(`${DEVICE_PROOF_HELP}\n`);
        return undefined;
      }
      if (argument === "--json") {
        json = true;
        continue;
      }
      if (
        argument === "--cwd" ||
        argument === "--key-id" ||
        argument === "--output" ||
        argument === "--project"
      ) {
        const value = argumentValue(args, index, argument);
        if (argument === "--cwd") cwd = value;
        if (argument === "--key-id") keyId = value;
        if (argument === "--output") outputPath = value;
        if (argument === "--project") projectName = value;
        index += 1;
        continue;
      }
      throw new TypeError(
        `Unknown device-proof signing-request option ${String(argument)}.`,
      );
    }
    const missing = [
      ...(keyId === undefined ? ["--key-id"] : []),
      ...(projectName === undefined ? ["--project"] : []),
    ];
    if (missing.length > 0) {
      throw new TypeError(
        `device-proof signing-request requires ${missing.join(", ")}.`,
      );
    }
    return {
      operation,
      proofPath,
      keyId: keyId!,
      projectName: projectName!,
      json,
      ...(cwd === undefined ? {} : { cwd }),
      ...(outputPath === undefined ? {} : { outputPath }),
    };
  }
  if (operation === "assemble-signature") {
    const requestPath = args[1];
    if (
      requestPath === undefined ||
      requestPath.startsWith("-") ||
      requestPath.length === 0
    ) {
      throw new TypeError(
        "device-proof assemble-signature requires a signing request path.",
      );
    }
    let cwd: string | undefined;
    let detachedSignaturePath: string | undefined;
    let json = false;
    let outputPath: string | undefined;
    let publicKeyPath: string | undefined;
    for (let index = 2; index < args.length; index += 1) {
      const argument = args[index]!;
      if (argument === "--help" || argument === "-h") {
        process.stdout.write(`${DEVICE_PROOF_HELP}\n`);
        return undefined;
      }
      if (argument === "--json") {
        json = true;
        continue;
      }
      if (
        argument === "--cwd" ||
        argument === "--output" ||
        argument === "--public-key" ||
        argument === "--signature"
      ) {
        const value = argumentValue(args, index, argument);
        if (argument === "--cwd") cwd = value;
        if (argument === "--output") outputPath = value;
        if (argument === "--public-key") publicKeyPath = value;
        if (argument === "--signature") detachedSignaturePath = value;
        index += 1;
        continue;
      }
      throw new TypeError(
        `Unknown device-proof assemble-signature option ${String(argument)}.`,
      );
    }
    const missing = [
      ...(detachedSignaturePath === undefined ? ["--signature"] : []),
      ...(publicKeyPath === undefined ? ["--public-key"] : []),
    ];
    if (missing.length > 0) {
      throw new TypeError(
        `device-proof assemble-signature requires ${missing.join(", ")}.`,
      );
    }
    return {
      operation,
      requestPath,
      detachedSignaturePath: detachedSignaturePath!,
      publicKeyPath: publicKeyPath!,
      json,
      ...(cwd === undefined ? {} : { cwd }),
      ...(outputPath === undefined ? {} : { outputPath }),
    };
  }
  if (operation !== "ingestion" && operation !== "verify-signature") {
    throw new TypeError(
      "device-proof requires create-android, profile, sign, signing-request, assemble-signature, ingestion, or verify-signature.",
    );
  }
  const signaturePath = args[1];
  if (
    signaturePath === undefined ||
    signaturePath.startsWith("-") ||
    signaturePath.length === 0
  ) {
    throw new TypeError(`device-proof ${operation} requires a signature path.`);
  }
  let cwd: string | undefined;
  let expectedApplicationArtifactSha256: string | undefined;
  let expectedKeyId: string | undefined;
  let expectedNativeCompatibilityFingerprint: string | undefined;
  let expectedProofSha256: string | undefined;
  let expectedProfileFingerprint: string | undefined;
  let expectedSourceRevision: string | undefined;
  let json = false;
  let maximumMeasuredAt: string | undefined;
  let minimumTrustPolicySequence: number | undefined;
  let minimumMeasuredAt: string | undefined;
  let proofPath: string | undefined;
  let projectName: string | undefined;
  let publicKeyPath: string | undefined;
  let trustPolicyPath: string | undefined;
  for (let index = 2; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${DEVICE_PROOF_HELP}\n`);
      return undefined;
    }
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (
      argument === "--artifact-sha256" ||
      argument === "--cwd" ||
      argument === "--key-id" ||
      argument === "--maximum-measured-at" ||
      argument === "--minimum-measured-at" ||
      argument === "--minimum-policy-sequence" ||
      argument === "--native-fingerprint" ||
      argument === "--proof" ||
      argument === "--proof-sha256" ||
      argument === "--profile-fingerprint" ||
      argument === "--project" ||
      argument === "--public-key" ||
      argument === "--revision" ||
      argument === "--trust-policy"
    ) {
      const value = argumentValue(args, index, argument);
      if (argument === "--artifact-sha256") {
        expectedApplicationArtifactSha256 = value;
      }
      if (argument === "--cwd") cwd = value;
      if (argument === "--key-id") expectedKeyId = value;
      if (argument === "--maximum-measured-at") maximumMeasuredAt = value;
      if (argument === "--minimum-measured-at") minimumMeasuredAt = value;
      if (argument === "--minimum-policy-sequence") {
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed) || parsed <= 0) {
          throw new TypeError(
            `device-proof ${operation} --minimum-policy-sequence must be a positive safe integer.`,
          );
        }
        minimumTrustPolicySequence = parsed;
      }
      if (argument === "--native-fingerprint") {
        expectedNativeCompatibilityFingerprint = value;
      }
      if (argument === "--proof") proofPath = value;
      if (argument === "--proof-sha256") expectedProofSha256 = value;
      if (argument === "--profile-fingerprint") {
        expectedProfileFingerprint = value;
      }
      if (argument === "--project") projectName = value;
      if (argument === "--public-key") publicKeyPath = value;
      if (argument === "--revision") expectedSourceRevision = value;
      if (argument === "--trust-policy") trustPolicyPath = value;
      index += 1;
      continue;
    }
    throw new TypeError(
      `Unknown device-proof ${operation} option ${String(argument)}.`,
    );
  }
  const pinnedTrustSupplied =
    publicKeyPath !== undefined ||
    expectedKeyId !== undefined ||
    projectName !== undefined;
  if (trustPolicyPath !== undefined && pinnedTrustSupplied) {
    throw new TypeError(
      `device-proof ${operation} --trust-policy cannot be combined with pinned-key options.`,
    );
  }
  if (
    trustPolicyPath === undefined &&
    minimumTrustPolicySequence !== undefined
  ) {
    throw new TypeError(
      `device-proof ${operation} --minimum-policy-sequence requires --trust-policy.`,
    );
  }
  const missing = [...(proofPath === undefined ? ["--proof"] : [])];
  if (trustPolicyPath === undefined) {
    missing.push(
      ...(publicKeyPath === undefined ? ["--public-key"] : []),
      ...(expectedKeyId === undefined ? ["--key-id"] : []),
      ...(projectName === undefined ? ["--project"] : []),
    );
  }
  if (missing.length > 0) {
    throw new TypeError(
      `device-proof ${operation} requires ${missing.join(", ")}.`,
    );
  }
  const base = {
    operation,
    signaturePath,
    proofPath: proofPath!,
    json,
    ...(cwd === undefined ? {} : { cwd }),
    ...(expectedProofSha256 === undefined ? {} : { expectedProofSha256 }),
    ...(expectedProfileFingerprint === undefined
      ? {}
      : { expectedProfileFingerprint }),
    ...(expectedSourceRevision === undefined ? {} : { expectedSourceRevision }),
    ...(expectedNativeCompatibilityFingerprint === undefined
      ? {}
      : { expectedNativeCompatibilityFingerprint }),
    ...(expectedApplicationArtifactSha256 === undefined
      ? {}
      : { expectedApplicationArtifactSha256 }),
    ...(minimumMeasuredAt === undefined ? {} : { minimumMeasuredAt }),
    ...(maximumMeasuredAt === undefined ? {} : { maximumMeasuredAt }),
  } as const;
  return trustPolicyPath === undefined
    ? {
        ...base,
        publicKeyPath: publicKeyPath!,
        expectedKeyId: expectedKeyId!,
        projectName: projectName!,
      }
    : {
        ...base,
        trustPolicyPath,
        ...(minimumTrustPolicySequence === undefined
          ? {}
          : { minimumTrustPolicySequence }),
      };
}

function parseAdapterArguments(
  args: readonly string[],
): AdapterArguments | undefined {
  const operation = args[0];
  if (operation === "--help" || operation === "-h") {
    process.stdout.write(`${ADAPTER_HELP}\n`);
    return undefined;
  }
  if (operation !== "create") {
    throw new TypeError("adapter requires the create operation.");
  }
  const moduleName = args[1];
  if (
    moduleName === undefined ||
    moduleName.startsWith("-") ||
    moduleName.length === 0
  ) {
    throw new TypeError("adapter create requires a TurboModule name.");
  }
  let bindingsPath: string | undefined;
  let cwd: string | undefined;
  let dryRun = false;
  let json = false;
  let outputPath: string | undefined;
  let packageName: string | undefined;
  let platform: NativeGeneratePlatform = "all";
  for (let index = 2; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${ADAPTER_HELP}\n`);
      return undefined;
    }
    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (
      argument === "--bindings" ||
      argument === "--cwd" ||
      argument === "--library" ||
      argument === "--output" ||
      argument === "--platform"
    ) {
      const value = argumentValue(args, index, argument);
      index += 1;
      if (argument === "--bindings") bindingsPath = value;
      if (argument === "--cwd") cwd = value;
      if (argument === "--library") packageName = value;
      if (argument === "--output") outputPath = value;
      if (argument === "--platform") {
        if (value !== "all" && value !== "ios" && value !== "android") {
          throw new TypeError(`Unsupported platform ${value}.`);
        }
        platform = value;
      }
      continue;
    }
    throw new TypeError(`Unknown adapter option ${String(argument)}.`);
  }
  if (packageName === undefined) {
    throw new TypeError("adapter create requires --library PACKAGE.");
  }
  if (json && !dryRun) {
    throw new TypeError("adapter create --json requires --dry-run.");
  }
  return {
    dryRun,
    json,
    moduleName,
    packageName,
    platform,
    ...(bindingsPath === undefined ? {} : { bindingsPath }),
    ...(cwd === undefined ? {} : { cwd }),
    ...(outputPath === undefined ? {} : { outputPath }),
  };
}

function parseAddArguments(args: readonly string[]): AddArguments | undefined {
  const capability = args[0];
  if (capability === "--help" || capability === "-h") {
    process.stdout.write(`${ADD_HELP}\n`);
    return undefined;
  }
  if (capability !== "navigation") {
    throw new TypeError(
      "add requires a supported capability; currently: navigation.",
    );
  }
  let cwd: string | undefined;
  let dryRun = false;
  let json = false;
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${ADD_HELP}\n`);
      return undefined;
    }
    if (argument === "--cwd") {
      cwd = argumentValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (argument === "--json") {
      json = true;
      continue;
    }
    throw new TypeError(`Unknown add option ${String(argument)}.`);
  }
  if (json && !dryRun) {
    throw new TypeError("add --json requires --dry-run.");
  }
  return {
    capability,
    dryRun,
    json,
    ...(cwd === undefined ? {} : { cwd }),
  };
}

function parseRunArguments(args: readonly string[]): RunArguments | undefined {
  const platform = args[0];
  if (platform === "--help" || platform === "-h") {
    process.stdout.write(`${RUN_HELP}\n`);
    return undefined;
  }
  if (platform !== "ios" && platform !== "android") {
    throw new TypeError("run requires an ios or android platform.");
  }
  let cwd: string | undefined;
  let dryRun = false;
  let json = false;
  const forwardedArgs: string[] = [];
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") {
      forwardedArgs.push(...args.slice(index + 1));
      break;
    }
    if (argument === "--cwd") {
      cwd = argumentValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${RUN_HELP}\n`);
      return undefined;
    }
    if (argument !== undefined) forwardedArgs.push(argument);
  }
  if (json && !dryRun) {
    throw new TypeError(
      "run --json requires --dry-run so build logs cannot corrupt JSON output.",
    );
  }
  return {
    dryRun,
    forwardedArgs,
    json,
    platform,
    ...(cwd === undefined ? {} : { cwd }),
  };
}

function parseLogsArguments(
  args: readonly string[],
): LogsArguments | undefined {
  const platform = args[0];
  if (platform === "--help" || platform === "-h") {
    process.stdout.write(`${LOGS_HELP}\n`);
    return undefined;
  }
  if (platform !== "android" && platform !== "ios") {
    throw new TypeError("logs requires an ios or android platform.");
  }
  const applicationIdentifier = args[1];
  if (applicationIdentifier === "--help" || applicationIdentifier === "-h") {
    process.stdout.write(`${LOGS_HELP}\n`);
    return undefined;
  }
  if (
    applicationIdentifier === undefined ||
    applicationIdentifier.startsWith("-")
  ) {
    throw new TypeError(
      platform === "android"
        ? "logs android requires an application package."
        : "logs ios requires an application bundle identifier.",
    );
  }
  if (platform === "ios") {
    let device: string | undefined;
    let dryRun = false;
    let json = false;
    let restart = false;
    for (let index = 2; index < args.length; index += 1) {
      const argument = args[index];
      if (argument === "--device") {
        device = argumentValue(args, index, argument);
        index += 1;
        continue;
      }
      if (argument === "--restart") {
        restart = true;
        continue;
      }
      if (argument === "--dry-run") {
        dryRun = true;
        continue;
      }
      if (argument === "--json") {
        json = true;
        continue;
      }
      if (argument === "--help" || argument === "-h") {
        process.stdout.write(`${LOGS_HELP}\n`);
        return undefined;
      }
      throw new TypeError(`Unknown logs option ${String(argument)}.`);
    }
    if (device === undefined) {
      throw new TypeError("logs ios requires --device ID.");
    }
    if (!restart) {
      throw new TypeError(
        "logs ios requires --restart to acknowledge replacement and termination of the application process.",
      );
    }
    if (json && !dryRun) {
      throw new TypeError(
        "logs --json requires --dry-run so live device output cannot corrupt JSON.",
      );
    }
    return {
      platform,
      bundleIdentifier: applicationIdentifier,
      device,
      dryRun,
      json,
      restart: true,
    };
  }
  const packageName = applicationIdentifier;
  let dryRun = false;
  let json = false;
  let serial: string | undefined;
  let since: string | undefined;
  for (let index = 2; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${LOGS_HELP}\n`);
      return undefined;
    }
    if (argument === "--serial" || argument === "--since") {
      const value = argumentValue(args, index, argument);
      index += 1;
      if (argument === "--serial") serial = value;
      else since = value;
      continue;
    }
    throw new TypeError(`Unknown logs option ${String(argument)}.`);
  }
  if (json && !dryRun) {
    throw new TypeError(
      "logs --json requires --dry-run so live device output cannot corrupt JSON.",
    );
  }
  return {
    platform,
    dryRun,
    json,
    packageName,
    ...(serial === undefined ? {} : { serial }),
    ...(since === undefined ? {} : { since }),
  };
}

function parseDeviceArguments(
  args: readonly string[],
): DeviceIosArguments | undefined {
  const operation = args[0];
  if (operation === "--help" || operation === "-h") {
    process.stdout.write(`${DEVICE_HELP}\n`);
    return undefined;
  }
  if (operation !== "status-ios" && operation !== "stop-ios") {
    throw new TypeError("device requires status-ios or stop-ios.");
  }
  const bundleIdentifier = args[1];
  if (bundleIdentifier === "--help" || bundleIdentifier === "-h") {
    process.stdout.write(`${DEVICE_HELP}\n`);
    return undefined;
  }
  if (bundleIdentifier === undefined || bundleIdentifier.startsWith("-")) {
    throw new TypeError(
      `device ${operation} requires an iOS bundle identifier.`,
    );
  }

  let device: string | undefined;
  let json = false;
  for (let index = 2; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--device") {
      if (device !== undefined) {
        throw new TypeError(
          `device ${operation} option --device is duplicated.`,
        );
      }
      device = argumentValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--json") {
      if (json) {
        throw new TypeError(`device ${operation} option --json is duplicated.`);
      }
      json = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${DEVICE_HELP}\n`);
      return undefined;
    }
    throw new TypeError(
      `Unknown device ${operation} option ${String(argument)}.`,
    );
  }
  if (device === undefined) {
    throw new TypeError(`device ${operation} requires --device ID.`);
  }
  return { operation, bundleIdentifier, device, json };
}

function parseOpenArguments(
  args: readonly string[],
): OpenArguments | undefined {
  const platform = args[0];
  if (platform === "--help" || platform === "-h") {
    process.stdout.write(`${OPEN_HELP}\n`);
    return undefined;
  }
  if (platform !== "android" && platform !== "ios") {
    throw new TypeError("open requires an ios or android platform.");
  }
  const applicationIdentifier = args[1];
  const url = args[2];
  if (
    applicationIdentifier === "--help" ||
    applicationIdentifier === "-h" ||
    url === "--help" ||
    url === "-h"
  ) {
    process.stdout.write(`${OPEN_HELP}\n`);
    return undefined;
  }
  if (
    applicationIdentifier === undefined ||
    applicationIdentifier.startsWith("-")
  ) {
    throw new TypeError(
      platform === "android"
        ? "open android requires an application package."
        : "open ios requires an application bundle identifier.",
    );
  }
  if (url === undefined || url.startsWith("-")) {
    throw new TypeError("open requires an absolute deep-link URL.");
  }

  let cold = false;
  let device: string | undefined;
  let dryRun = false;
  let json = false;
  let serial: string | undefined;
  for (let index = 3; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--cold") {
      cold = true;
      continue;
    }
    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${OPEN_HELP}\n`);
      return undefined;
    }
    if (argument === "--serial" && platform === "android") {
      serial = argumentValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--device" && platform === "ios") {
      device = argumentValue(args, index, argument);
      index += 1;
      continue;
    }
    throw new TypeError(`Unknown open option ${String(argument)}.`);
  }

  if (platform === "ios") {
    if (device === undefined) {
      throw new TypeError("open ios requires --device ID.");
    }
    return {
      platform,
      bundleIdentifier: applicationIdentifier,
      cold,
      device,
      dryRun,
      json,
      url,
    };
  }
  return {
    platform,
    cold,
    dryRun,
    json,
    packageName: applicationIdentifier,
    url,
    ...(serial === undefined ? {} : { serial }),
  };
}

function parseBuildArguments(
  args: readonly string[],
): BuildArguments | undefined {
  const platform = args[0];
  if (platform === "--help" || platform === "-h") {
    process.stdout.write(`${BUILD_HELP}\n`);
    return undefined;
  }
  if (platform !== "ios" && platform !== "android") {
    throw new TypeError("build requires an ios or android platform.");
  }
  let cwd: string | undefined;
  let dryRun = false;
  let json = false;
  const forwardedArgs: string[] = [];
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") {
      forwardedArgs.push(...args.slice(index + 1));
      break;
    }
    if (argument === "--cwd") {
      cwd = argumentValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${BUILD_HELP}\n`);
      return undefined;
    }
    if (argument !== undefined) forwardedArgs.push(argument);
  }
  if (json && !dryRun) {
    throw new TypeError(
      "build --json requires --dry-run so build logs cannot corrupt JSON output.",
    );
  }
  return {
    dryRun,
    forwardedArgs,
    json,
    platform,
    ...(cwd === undefined ? {} : { cwd }),
  };
}

function parseBundleArguments(
  args: readonly string[],
): BundleArguments | undefined {
  const platform = args[0];
  if (platform === "--help" || platform === "-h") {
    process.stdout.write(`${BUNDLE_HELP}\n`);
    return undefined;
  }
  if (platform !== "ios" && platform !== "android") {
    throw new TypeError("bundle requires an ios or android platform.");
  }
  let cwd: string | undefined;
  let dryRun = false;
  let entryFile: string | undefined;
  let hermesSource = false;
  let json = false;
  let outputDirectory: string | undefined;
  const forwardedArgs: string[] = [];
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") {
      forwardedArgs.push(...args.slice(index + 1));
      break;
    }
    if (argument === "--cwd") {
      cwd = argumentValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--output") {
      outputDirectory = argumentValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--entry-file") {
      entryFile = argumentValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--hermes-source") {
      hermesSource = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${BUNDLE_HELP}\n`);
      return undefined;
    }
    if (argument !== undefined) forwardedArgs.push(argument);
  }
  if (json && !dryRun) {
    throw new TypeError(
      "bundle --json requires --dry-run so Metro logs cannot corrupt JSON output.",
    );
  }
  return {
    dryRun,
    forwardedArgs,
    hermesSource,
    json,
    platform,
    ...(cwd === undefined ? {} : { cwd }),
    ...(entryFile === undefined ? {} : { entryFile }),
    ...(outputDirectory === undefined ? {} : { outputDirectory }),
  };
}

function parseBundleVerifyArguments(
  args: readonly string[],
): BundleVerifyArguments | undefined {
  const manifestPath = args[0];
  if (manifestPath === "--help" || manifestPath === "-h") {
    process.stdout.write(`${BUNDLE_HELP}\n`);
    return undefined;
  }
  if (manifestPath === undefined || manifestPath.startsWith("-")) {
    throw new TypeError("bundle verify requires a manifest path.");
  }
  let json = false;
  for (const argument of args.slice(1)) {
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${BUNDLE_HELP}\n`);
      return undefined;
    }
    throw new TypeError(`Unknown bundle verify option ${argument}.`);
  }
  return { json, manifestPath };
}

function parseBundleSourcesArguments(
  args: readonly string[],
): BundleSourcesArguments | undefined {
  const sourceMapPath = args[0];
  if (sourceMapPath === "--help" || sourceMapPath === "-h") {
    process.stdout.write(`${BUNDLE_HELP}\n`);
    return undefined;
  }
  if (sourceMapPath === undefined || sourceMapPath.startsWith("-")) {
    throw new TypeError("bundle sources requires a source-map path.");
  }
  let cwd: string | undefined;
  let json = false;
  const requiredSources: string[] = [];
  const forbiddenSourceFragments: string[] = [];
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (
      argument === "--cwd" ||
      argument === "--require" ||
      argument === "--forbid-containing"
    ) {
      const value = argumentValue(args, index, argument);
      index += 1;
      if (argument === "--cwd") cwd = value;
      else if (argument === "--require") requiredSources.push(value);
      else forbiddenSourceFragments.push(value);
      continue;
    }
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${BUNDLE_HELP}\n`);
      return undefined;
    }
    throw new TypeError(`Unknown bundle sources option ${String(argument)}.`);
  }
  return {
    forbiddenSourceFragments,
    json,
    requiredSources,
    sourceMapPath,
    ...(cwd === undefined ? {} : { cwd }),
  };
}

function parseStartArguments(
  args: readonly string[],
): StartArguments | undefined {
  let cwd: string | undefined;
  let dryRun = false;
  let json = false;
  const forwardedArgs: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") {
      forwardedArgs.push(...args.slice(index + 1));
      break;
    }
    if (argument === "--cwd") {
      cwd = argumentValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${START_HELP}\n`);
      return undefined;
    }
    if (argument !== undefined) forwardedArgs.push(argument);
  }
  if (json && !dryRun) {
    throw new TypeError(
      "start --json requires --dry-run so Metro logs cannot corrupt JSON output.",
    );
  }
  return {
    dryRun,
    forwardedArgs,
    json,
    ...(cwd === undefined ? {} : { cwd }),
  };
}

function parseTestArguments(
  args: readonly string[],
): TestArguments | undefined {
  let cwd: string | undefined;
  let dryRun = false;
  let json = false;
  let runtime: NativeTestRuntime = "development";
  let testNamePattern: string | undefined;
  let watch = false;
  const paths: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--cwd") {
      cwd = argumentValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--production") {
      runtime = "production";
      continue;
    }
    if (argument === "--watch") {
      watch = true;
      continue;
    }
    if (argument === "--test-name-pattern") {
      testNamePattern = argumentValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${TEST_HELP}\n`);
      return undefined;
    }
    if (argument?.startsWith("-") === true) {
      throw new TypeError(`Unknown test option ${argument}.`);
    }
    if (argument !== undefined) paths.push(argument);
  }
  if (json && !dryRun) {
    throw new TypeError(
      "test --json requires --dry-run so test output cannot corrupt JSON output.",
    );
  }
  return {
    dryRun,
    json,
    paths,
    runtime,
    watch,
    ...(cwd === undefined ? {} : { cwd }),
    ...(testNamePattern === undefined ? {} : { testNamePattern }),
  };
}

function parseReleaseCreateArguments(
  args: readonly string[],
): ReleaseCreateArguments | undefined {
  let artifactPath: string | undefined;
  const androidSigningCertificateSha256s: string[] = [];
  let androidUploadCertificateSha256: string | undefined;
  let bundleManifestPath: string | undefined;
  let channel: string | undefined;
  let cwd: string | undefined;
  let inspectEmbeddedBundle = false;
  let json = false;
  let outputPath: string | undefined;
  let release: string | undefined;
  let sourceRevision: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${RELEASE_HELP}\n`);
      return undefined;
    }
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--inspect-embedded-bundle") {
      inspectEmbeddedBundle = true;
      continue;
    }
    if (
      argument === "--artifact" ||
      argument === "--android-signing-certificate-sha256" ||
      argument === "--android-upload-certificate-sha256" ||
      argument === "--bundle" ||
      argument === "--channel" ||
      argument === "--cwd" ||
      argument === "--output" ||
      argument === "--release" ||
      argument === "--revision"
    ) {
      const value = argumentValue(args, index, argument);
      index += 1;
      if (argument === "--artifact") artifactPath = value;
      if (argument === "--android-signing-certificate-sha256") {
        androidSigningCertificateSha256s.push(value);
      }
      if (argument === "--android-upload-certificate-sha256") {
        androidUploadCertificateSha256 = value;
      }
      if (argument === "--bundle") bundleManifestPath = value;
      if (argument === "--channel") channel = value;
      if (argument === "--cwd") cwd = value;
      if (argument === "--output") outputPath = value;
      if (argument === "--release") release = value;
      if (argument === "--revision") sourceRevision = value;
      continue;
    }
    throw new TypeError(`Unknown release create option ${String(argument)}.`);
  }
  const missing = [
    ...(artifactPath === undefined ? ["--artifact"] : []),
    ...(bundleManifestPath === undefined ? ["--bundle"] : []),
    ...(release === undefined ? ["--release"] : []),
    ...(channel === undefined ? ["--channel"] : []),
    ...(sourceRevision === undefined ? ["--revision"] : []),
  ];
  if (missing.length > 0) {
    throw new TypeError(`release create requires ${missing.join(", ")}.`);
  }
  if (
    androidSigningCertificateSha256s.length > 0 &&
    androidUploadCertificateSha256 !== undefined
  ) {
    throw new TypeError(
      "release create accepts either APK signing certificates or an AAB upload certificate, not both.",
    );
  }
  return {
    androidSigningCertificateSha256s,
    artifactPath: artifactPath!,
    bundleManifestPath: bundleManifestPath!,
    channel: channel!,
    inspectEmbeddedBundle,
    json,
    release: release!,
    sourceRevision: sourceRevision!,
    ...(androidUploadCertificateSha256 === undefined
      ? {}
      : { androidUploadCertificateSha256 }),
    ...(cwd === undefined ? {} : { cwd }),
    ...(outputPath === undefined ? {} : { outputPath }),
  };
}

function parseReleaseVerifyAndroidSigningArguments(
  args: readonly string[],
): ReleaseVerifyAndroidSigningArguments | undefined {
  const artifactPath = args[0];
  if (artifactPath === "--help" || artifactPath === "-h") {
    process.stdout.write(`${RELEASE_HELP}\n`);
    return undefined;
  }
  if (artifactPath === undefined || artifactPath.startsWith("-")) {
    throw new TypeError(
      "release verify-android-signing requires an AAB or APK path.",
    );
  }
  let cwd: string | undefined;
  const expectedCertificateSha256s: string[] = [];
  let json = false;
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${RELEASE_HELP}\n`);
      return undefined;
    }
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--cwd" || argument === "--expected-certificate-sha256") {
      const value = argumentValue(args, index, argument);
      index += 1;
      if (argument === "--cwd") cwd = value;
      if (argument === "--expected-certificate-sha256") {
        expectedCertificateSha256s.push(value);
      }
      continue;
    }
    throw new TypeError(
      `Unknown release verify-android-signing option ${String(argument)}.`,
    );
  }
  return {
    artifactPath,
    expectedCertificateSha256s,
    json,
    ...(cwd === undefined ? {} : { cwd }),
  };
}

function parseReleaseVerifyArguments(
  args: readonly string[],
): ReleaseVerifyArguments | undefined {
  const manifestPath = args[0];
  if (manifestPath === "--help" || manifestPath === "-h") {
    process.stdout.write(`${RELEASE_HELP}\n`);
    return undefined;
  }
  if (manifestPath === undefined || manifestPath.startsWith("-")) {
    throw new TypeError("release verify requires a manifest path.");
  }
  let artifactPath: string | undefined;
  let bundleManifestPath: string | undefined;
  let cwd: string | undefined;
  let json = false;
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${RELEASE_HELP}\n`);
      return undefined;
    }
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (
      argument === "--artifact" ||
      argument === "--bundle" ||
      argument === "--cwd"
    ) {
      const value = argumentValue(args, index, argument);
      index += 1;
      if (argument === "--artifact") artifactPath = value;
      if (argument === "--bundle") bundleManifestPath = value;
      if (argument === "--cwd") cwd = value;
      continue;
    }
    throw new TypeError(`Unknown release verify option ${String(argument)}.`);
  }
  const missing = [
    ...(artifactPath === undefined ? ["--artifact"] : []),
    ...(bundleManifestPath === undefined ? ["--bundle"] : []),
  ];
  if (missing.length > 0) {
    throw new TypeError(`release verify requires ${missing.join(", ")}.`);
  }
  return {
    artifactPath: artifactPath!,
    bundleManifestPath: bundleManifestPath!,
    json,
    manifestPath,
    ...(cwd === undefined ? {} : { cwd }),
  };
}

function parseReleaseSignArguments(
  args: readonly string[],
): ReleaseSignArguments | undefined {
  const manifestPath = args[0];
  if (manifestPath === "--help" || manifestPath === "-h") {
    process.stdout.write(`${RELEASE_HELP}\n`);
    return undefined;
  }
  if (manifestPath === undefined || manifestPath.startsWith("-")) {
    throw new TypeError("release sign requires a manifest path.");
  }
  let artifactPath: string | undefined;
  let bundleManifestPath: string | undefined;
  let cwd: string | undefined;
  let json = false;
  let keyId: string | undefined;
  let outputPath: string | undefined;
  let privateKeyPath: string | undefined;
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${RELEASE_HELP}\n`);
      return undefined;
    }
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (
      argument === "--artifact" ||
      argument === "--bundle" ||
      argument === "--cwd" ||
      argument === "--key" ||
      argument === "--key-id" ||
      argument === "--output"
    ) {
      const value = argumentValue(args, index, argument);
      index += 1;
      if (argument === "--artifact") artifactPath = value;
      if (argument === "--bundle") bundleManifestPath = value;
      if (argument === "--cwd") cwd = value;
      if (argument === "--key") privateKeyPath = value;
      if (argument === "--key-id") keyId = value;
      if (argument === "--output") outputPath = value;
      continue;
    }
    throw new TypeError(`Unknown release sign option ${String(argument)}.`);
  }
  const missing = [
    ...(privateKeyPath === undefined ? ["--key"] : []),
    ...(keyId === undefined ? ["--key-id"] : []),
  ];
  if (missing.length > 0) {
    throw new TypeError(`release sign requires ${missing.join(", ")}.`);
  }
  if ((artifactPath === undefined) !== (bundleManifestPath === undefined)) {
    throw new TypeError(
      "release sign requires --artifact and --bundle together.",
    );
  }
  return {
    json,
    keyId: keyId!,
    manifestPath,
    privateKeyPath: privateKeyPath!,
    ...(artifactPath === undefined ? {} : { artifactPath }),
    ...(bundleManifestPath === undefined ? {} : { bundleManifestPath }),
    ...(cwd === undefined ? {} : { cwd }),
    ...(outputPath === undefined ? {} : { outputPath }),
  };
}

function parseReleaseSigningRequestArguments(
  args: readonly string[],
): ReleaseSigningRequestArguments | undefined {
  const manifestPath = args[0];
  if (manifestPath === "--help" || manifestPath === "-h") {
    process.stdout.write(`${RELEASE_HELP}\n`);
    return undefined;
  }
  if (manifestPath === undefined || manifestPath.startsWith("-")) {
    throw new TypeError("release signing-request requires a manifest path.");
  }
  let artifactPath: string | undefined;
  let bundleManifestPath: string | undefined;
  let cwd: string | undefined;
  let json = false;
  let keyId: string | undefined;
  let outputPath: string | undefined;
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${RELEASE_HELP}\n`);
      return undefined;
    }
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (
      argument === "--artifact" ||
      argument === "--bundle" ||
      argument === "--cwd" ||
      argument === "--key-id" ||
      argument === "--output"
    ) {
      const value = argumentValue(args, index, argument);
      index += 1;
      if (argument === "--artifact") artifactPath = value;
      if (argument === "--bundle") bundleManifestPath = value;
      if (argument === "--cwd") cwd = value;
      if (argument === "--key-id") keyId = value;
      if (argument === "--output") outputPath = value;
      continue;
    }
    throw new TypeError(
      `Unknown release signing-request option ${String(argument)}.`,
    );
  }
  if (keyId === undefined) {
    throw new TypeError("release signing-request requires --key-id.");
  }
  if ((artifactPath === undefined) !== (bundleManifestPath === undefined)) {
    throw new TypeError(
      "release signing-request requires --artifact and --bundle together.",
    );
  }
  return {
    json,
    keyId,
    manifestPath,
    ...(artifactPath === undefined ? {} : { artifactPath }),
    ...(bundleManifestPath === undefined ? {} : { bundleManifestPath }),
    ...(cwd === undefined ? {} : { cwd }),
    ...(outputPath === undefined ? {} : { outputPath }),
  };
}

function parseReleaseAssembleSignatureArguments(
  args: readonly string[],
): ReleaseAssembleSignatureArguments | undefined {
  const requestPath = args[0];
  if (requestPath === "--help" || requestPath === "-h") {
    process.stdout.write(`${RELEASE_HELP}\n`);
    return undefined;
  }
  if (requestPath === undefined || requestPath.startsWith("-")) {
    throw new TypeError(
      "release assemble-signature requires a signing request path.",
    );
  }
  let cwd: string | undefined;
  let detachedSignaturePath: string | undefined;
  let json = false;
  let outputPath: string | undefined;
  let publicKeyPath: string | undefined;
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${RELEASE_HELP}\n`);
      return undefined;
    }
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (
      argument === "--cwd" ||
      argument === "--output" ||
      argument === "--public-key" ||
      argument === "--signature"
    ) {
      const value = argumentValue(args, index, argument);
      index += 1;
      if (argument === "--cwd") cwd = value;
      if (argument === "--output") outputPath = value;
      if (argument === "--public-key") publicKeyPath = value;
      if (argument === "--signature") detachedSignaturePath = value;
      continue;
    }
    throw new TypeError(
      `Unknown release assemble-signature option ${String(argument)}.`,
    );
  }
  const missing = [
    ...(detachedSignaturePath === undefined ? ["--signature"] : []),
    ...(publicKeyPath === undefined ? ["--public-key"] : []),
  ];
  if (missing.length > 0) {
    throw new TypeError(
      `release assemble-signature requires ${missing.join(", ")}.`,
    );
  }
  return {
    detachedSignaturePath: detachedSignaturePath!,
    json,
    publicKeyPath: publicKeyPath!,
    requestPath,
    ...(cwd === undefined ? {} : { cwd }),
    ...(outputPath === undefined ? {} : { outputPath }),
  };
}

function parseReleaseDeviceCorrelationArguments(
  args: readonly string[],
): ReleaseDeviceCorrelationArguments | undefined {
  const signaturePath = args[0];
  if (signaturePath === "--help" || signaturePath === "-h") {
    process.stdout.write(`${RELEASE_HELP}\n`);
    return undefined;
  }
  if (signaturePath === undefined || signaturePath.startsWith("-")) {
    throw new TypeError(
      "release correlate-device-proof requires a release signature path.",
    );
  }
  let artifactPath: string | undefined;
  let bundleManifestPath: string | undefined;
  let cwd: string | undefined;
  let deviceMinimumTrustPolicySequence: number | undefined;
  let deviceProofPath: string | undefined;
  let deviceProfileFingerprint: string | undefined;
  let deviceSignaturePath: string | undefined;
  let deviceTrustPolicyPath: string | undefined;
  let expectedProofSha256: string | undefined;
  let json = false;
  let manifestPath: string | undefined;
  let maximumMeasuredAt: string | undefined;
  let minimumMeasuredAt: string | undefined;
  let minimumTrustPolicySequence: number | undefined;
  let trustPolicyPath: string | undefined;
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${RELEASE_HELP}\n`);
      return undefined;
    }
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (
      argument === "--artifact" ||
      argument === "--bundle" ||
      argument === "--cwd" ||
      argument === "--device-minimum-policy-sequence" ||
      argument === "--device-profile-fingerprint" ||
      argument === "--device-signature" ||
      argument === "--device-trust-policy" ||
      argument === "--manifest" ||
      argument === "--maximum-measured-at" ||
      argument === "--minimum-measured-at" ||
      argument === "--minimum-policy-sequence" ||
      argument === "--proof" ||
      argument === "--proof-sha256" ||
      argument === "--trust-policy"
    ) {
      const value = argumentValue(args, index, argument);
      index += 1;
      if (argument === "--artifact") artifactPath = value;
      if (argument === "--bundle") bundleManifestPath = value;
      if (argument === "--cwd") cwd = value;
      if (argument === "--device-signature") deviceSignaturePath = value;
      if (argument === "--device-profile-fingerprint") {
        deviceProfileFingerprint = value;
      }
      if (argument === "--device-trust-policy") {
        deviceTrustPolicyPath = value;
      }
      if (argument === "--manifest") manifestPath = value;
      if (argument === "--maximum-measured-at") maximumMeasuredAt = value;
      if (argument === "--minimum-measured-at") minimumMeasuredAt = value;
      if (argument === "--proof") deviceProofPath = value;
      if (argument === "--proof-sha256") expectedProofSha256 = value;
      if (argument === "--trust-policy") trustPolicyPath = value;
      if (
        argument === "--minimum-policy-sequence" ||
        argument === "--device-minimum-policy-sequence"
      ) {
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed) || parsed <= 0) {
          throw new TypeError(
            `release correlate-device-proof ${argument} must be a positive safe integer.`,
          );
        }
        if (argument === "--minimum-policy-sequence") {
          minimumTrustPolicySequence = parsed;
        } else {
          deviceMinimumTrustPolicySequence = parsed;
        }
      }
      continue;
    }
    throw new TypeError(
      `Unknown release correlate-device-proof option ${String(argument)}.`,
    );
  }
  const missing = [
    ...(manifestPath === undefined ? ["--manifest"] : []),
    ...(bundleManifestPath === undefined ? ["--bundle"] : []),
    ...(artifactPath === undefined ? ["--artifact"] : []),
    ...(trustPolicyPath === undefined ? ["--trust-policy"] : []),
    ...(deviceSignaturePath === undefined ? ["--device-signature"] : []),
    ...(deviceProofPath === undefined ? ["--proof"] : []),
    ...(deviceTrustPolicyPath === undefined ? ["--device-trust-policy"] : []),
  ];
  if (missing.length > 0) {
    throw new TypeError(
      `release correlate-device-proof requires ${missing.join(", ")}.`,
    );
  }
  return {
    artifactPath: artifactPath!,
    bundleManifestPath: bundleManifestPath!,
    deviceProofPath: deviceProofPath!,
    deviceSignaturePath: deviceSignaturePath!,
    deviceTrustPolicyPath: deviceTrustPolicyPath!,
    json,
    manifestPath: manifestPath!,
    signaturePath,
    trustPolicyPath: trustPolicyPath!,
    ...(cwd === undefined ? {} : { cwd }),
    ...(deviceMinimumTrustPolicySequence === undefined
      ? {}
      : { deviceMinimumTrustPolicySequence }),
    ...(deviceProfileFingerprint === undefined
      ? {}
      : { deviceProfileFingerprint }),
    ...(expectedProofSha256 === undefined ? {} : { expectedProofSha256 }),
    ...(maximumMeasuredAt === undefined ? {} : { maximumMeasuredAt }),
    ...(minimumMeasuredAt === undefined ? {} : { minimumMeasuredAt }),
    ...(minimumTrustPolicySequence === undefined
      ? {}
      : { minimumTrustPolicySequence }),
  };
}

function parseReleaseVerifySignatureArguments(
  args: readonly string[],
  operation = "verify-signature",
  requireInputs = false,
): ReleaseVerifySignatureArguments | undefined {
  const command = `release ${operation}`;
  const signaturePath = args[0];
  if (signaturePath === "--help" || signaturePath === "-h") {
    process.stdout.write(`${RELEASE_HELP}\n`);
    return undefined;
  }
  if (signaturePath === undefined || signaturePath.startsWith("-")) {
    throw new TypeError(`${command} requires a signature path.`);
  }
  let cwd: string | undefined;
  let expectedKeyId: string | undefined;
  let artifactPath: string | undefined;
  let bundleManifestPath: string | undefined;
  let envelopeOnly = false;
  let json = false;
  let manifestPath: string | undefined;
  let minimumTrustPolicySequence: number | undefined;
  let publicKeyPath: string | undefined;
  let trustPolicyPath: string | undefined;
  let projectName: string | undefined;
  let platform: "android" | "ios" | undefined;
  let channel: string | undefined;
  let release: string | undefined;
  let sourceRevision: string | undefined;
  let releaseFingerprint: string | undefined;
  let bundleFingerprint: string | undefined;
  let nativeCompatibilityFingerprint: string | undefined;
  let artifactSha256: string | undefined;
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${RELEASE_HELP}\n`);
      return undefined;
    }
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--envelope-only") {
      if (requireInputs) {
        throw new TypeError(`${command} does not support --envelope-only.`);
      }
      envelopeOnly = true;
      continue;
    }
    if (
      argument === "--cwd" ||
      argument === "--artifact" ||
      argument === "--artifact-sha256" ||
      argument === "--bundle" ||
      argument === "--bundle-fingerprint" ||
      argument === "--channel" ||
      argument === "--key-id" ||
      argument === "--manifest" ||
      argument === "--minimum-policy-sequence" ||
      argument === "--native-fingerprint" ||
      argument === "--platform" ||
      argument === "--project" ||
      argument === "--public-key" ||
      argument === "--release" ||
      argument === "--release-fingerprint" ||
      argument === "--revision" ||
      argument === "--trust-policy"
    ) {
      const value = argumentValue(args, index, argument);
      index += 1;
      if (argument === "--cwd") cwd = value;
      if (argument === "--artifact") artifactPath = value;
      if (argument === "--artifact-sha256") artifactSha256 = value;
      if (argument === "--bundle") bundleManifestPath = value;
      if (argument === "--bundle-fingerprint") bundleFingerprint = value;
      if (argument === "--channel") channel = value;
      if (argument === "--key-id") expectedKeyId = value;
      if (argument === "--manifest") manifestPath = value;
      if (argument === "--minimum-policy-sequence") {
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed) || parsed <= 0) {
          throw new TypeError(
            `${command} --minimum-policy-sequence must be a positive safe integer.`,
          );
        }
        minimumTrustPolicySequence = parsed;
      }
      if (argument === "--native-fingerprint")
        nativeCompatibilityFingerprint = value;
      if (argument === "--platform") {
        if (value !== "android" && value !== "ios") {
          throw new TypeError(`${command} --platform must be ios or android.`);
        }
        platform = value;
      }
      if (argument === "--project") projectName = value;
      if (argument === "--public-key") publicKeyPath = value;
      if (argument === "--trust-policy") trustPolicyPath = value;
      if (argument === "--release") release = value;
      if (argument === "--release-fingerprint") releaseFingerprint = value;
      if (argument === "--revision") sourceRevision = value;
      continue;
    }
    throw new TypeError(`Unknown ${command} option ${String(argument)}.`);
  }
  const missing = [...(manifestPath === undefined ? ["--manifest"] : [])];
  const pinnedPolicySupplied =
    publicKeyPath !== undefined ||
    expectedKeyId !== undefined ||
    projectName !== undefined ||
    platform !== undefined ||
    channel !== undefined ||
    release !== undefined ||
    sourceRevision !== undefined ||
    releaseFingerprint !== undefined ||
    bundleFingerprint !== undefined ||
    nativeCompatibilityFingerprint !== undefined ||
    artifactSha256 !== undefined;
  if (trustPolicyPath !== undefined && pinnedPolicySupplied) {
    throw new TypeError(
      `${command} --trust-policy cannot be combined with pinned key or scope options.`,
    );
  }
  if (
    trustPolicyPath === undefined &&
    minimumTrustPolicySequence !== undefined
  ) {
    throw new TypeError(
      `${command} --minimum-policy-sequence requires --trust-policy.`,
    );
  }
  if (trustPolicyPath === undefined) {
    missing.push(
      ...(publicKeyPath === undefined ? ["--public-key"] : []),
      ...(expectedKeyId === undefined ? ["--key-id"] : []),
      ...(projectName === undefined ? ["--project"] : []),
      ...(platform === undefined ? ["--platform"] : []),
      ...(channel === undefined ? ["--channel"] : []),
    );
  }
  if (missing.length > 0) {
    throw new TypeError(`${command} requires ${missing.join(", ")}.`);
  }
  if ((artifactPath === undefined) !== (bundleManifestPath === undefined)) {
    throw new TypeError(
      `${command} requires --artifact and --bundle together.`,
    );
  }
  if (
    envelopeOnly &&
    (artifactPath !== undefined || bundleManifestPath !== undefined)
  ) {
    throw new TypeError(
      `${command} --envelope-only cannot be combined with --artifact or --bundle.`,
    );
  }
  if (!envelopeOnly && artifactPath === undefined) {
    throw new TypeError(
      requireInputs
        ? `${command} requires --artifact and --bundle.`
        : `${command} requires --artifact and --bundle or --envelope-only.`,
    );
  }
  return {
    ...(artifactPath === undefined ? {} : { artifactPath }),
    ...(bundleManifestPath === undefined ? {} : { bundleManifestPath }),
    envelopeOnly,
    json,
    manifestPath: manifestPath!,
    signaturePath,
    ...(trustPolicyPath === undefined
      ? {
          expectedKeyId: expectedKeyId!,
          policy: {
            projectName: projectName!,
            platform: platform!,
            channel: channel!,
            ...(release === undefined ? {} : { release }),
            ...(sourceRevision === undefined ? {} : { sourceRevision }),
            ...(releaseFingerprint === undefined ? {} : { releaseFingerprint }),
            ...(bundleFingerprint === undefined ? {} : { bundleFingerprint }),
            ...(nativeCompatibilityFingerprint === undefined
              ? {}
              : { nativeCompatibilityFingerprint }),
            ...(artifactSha256 === undefined ? {} : { artifactSha256 }),
          },
          publicKeyPath: publicKeyPath!,
        }
      : {
          trustPolicyPath,
          ...(minimumTrustPolicySequence === undefined
            ? {}
            : { minimumTrustPolicySequence }),
        }),
    ...(cwd === undefined ? {} : { cwd }),
  };
}

function parseGenerateArguments(
  args: readonly string[],
): GenerateArguments | undefined {
  let audit = false;
  let check = false;
  let cwd: string | undefined;
  let dryRun = false;
  let json = false;
  let outputPath: string | undefined;
  let platform: NativeGeneratePlatform = "all";
  let source: NativeGenerateSource = "app";
  let generateSolidBindings = true;
  const solidLibraries: string[] = [];
  let solidOutputPath: string | undefined;
  let verbose = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${GENERATE_HELP}\n`);
      return undefined;
    }
    if (argument === "--cwd") {
      cwd = argumentValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--platform") {
      const value = argumentValue(args, index, argument);
      if (value !== "all" && value !== "ios" && value !== "android") {
        throw new TypeError(`Unsupported platform ${value}.`);
      }
      platform = value;
      index += 1;
      continue;
    }
    if (argument === "--source") {
      const value = argumentValue(args, index, argument);
      if (value !== "app" && value !== "library") {
        throw new TypeError(`Unsupported Codegen source ${value}.`);
      }
      source = value;
      index += 1;
      continue;
    }
    if (argument === "--output") {
      outputPath = argumentValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--solid-output") {
      solidOutputPath = argumentValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--solid-library") {
      solidLibraries.push(argumentValue(args, index, argument));
      index += 1;
      continue;
    }
    if (argument === "--no-solid") {
      generateSolidBindings = false;
      continue;
    }
    if (argument === "--verbose") {
      verbose = true;
      continue;
    }
    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (argument === "--check") {
      check = true;
      continue;
    }
    if (argument === "--audit") {
      audit = true;
      continue;
    }
    if (argument === "--json") {
      json = true;
      continue;
    }
    throw new TypeError(`Unknown generate option ${String(argument)}.`);
  }
  if (Number(audit) + Number(check) + Number(dryRun) > 1) {
    throw new TypeError(
      "generate --audit, --check, and --dry-run are mutually exclusive.",
    );
  }
  if (json && !audit && !dryRun && !check) {
    throw new TypeError(
      "generate --json requires --audit, --dry-run, or --check so Codegen logs cannot corrupt JSON output.",
    );
  }
  if (
    !generateSolidBindings &&
    (solidOutputPath !== undefined || solidLibraries.length > 0)
  ) {
    throw new TypeError(
      "--solid-output and --solid-library cannot be combined with --no-solid.",
    );
  }
  if ((audit || check) && !generateSolidBindings) {
    throw new TypeError(
      "generate --audit and --check cannot be combined with --no-solid.",
    );
  }
  if ((audit || check) && outputPath !== undefined) {
    throw new TypeError(
      "generate --audit and --check cannot be combined with the native --output path.",
    );
  }
  return {
    audit,
    check,
    dryRun,
    json,
    platform,
    source,
    generateSolidBindings,
    solidLibraries,
    verbose,
    ...(cwd === undefined ? {} : { cwd }),
    ...(outputPath === undefined ? {} : { outputPath }),
    ...(solidOutputPath === undefined ? {} : { solidOutputPath }),
  };
}

function terminalSafeErrorMessage(error: unknown): string {
  let message = "Unknown error";
  try {
    message = error instanceof Error ? error.message : String(error);
  } catch {
    // Hostile error values must not interfere with CLI shutdown.
  }
  return message.slice(0, 2_048).replace(/\p{Cc}/gu, (character) => {
    const codePoint = character.codePointAt(0);
    return `\\u${(codePoint ?? 0).toString(16).padStart(4, "0")}`;
  });
}

async function main(args: readonly string[]): Promise<void> {
  const command = args[0];
  if (command === undefined || command === "--help" || command === "-h") {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (command === "--version" || command === "-v") {
    process.stdout.write(`${SOLID_NATIVE_CLI_VERSION}\n`);
    return;
  }
  if (command === "debug") {
    const options = parseCausalDebugArguments(args.slice(1));
    if (options === undefined) return;
    if (options.operation === "capture-android") {
      const snapshot = await captureNativeAndroidCausalDebugSnapshot({
        packageName: options.packageName,
        serial: options.serial,
        ...(options.timeoutMs === undefined
          ? {}
          : { timeoutMs: options.timeoutMs }),
      });
      process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
      return;
    }
    if (options.operation === "diagnostics-android") {
      const diagnostics = await captureNativeAndroidSolidDiagnostics({
        packageName: options.packageName,
        serial: options.serial,
        ...(options.durationMs === undefined
          ? {}
          : { durationMs: options.durationMs }),
        ...(options.timeoutMs === undefined
          ? {}
          : { timeoutMs: options.timeoutMs }),
      });
      process.stdout.write(`${JSON.stringify(diagnostics, null, 2)}\n`);
      return;
    }
    if (options.operation === "report-android") {
      const report = await captureNativeAndroidCausalDebugReport({
        packageName: options.packageName,
        serial: options.serial,
        includeAttributes: options.includeAttributes,
        ...(options.durationMs === undefined
          ? {}
          : { durationMs: options.durationMs }),
        ...(options.timeoutMs === undefined
          ? {}
          : { timeoutMs: options.timeoutMs }),
      });
      if (options.outputPath === undefined) {
        process.stdout.write(report);
      } else {
        const outputPath = await writeNativeCausalDebugReportFile({
          report,
          outputPath: options.outputPath,
        });
        process.stdout.write(`Wrote causal report: ${outputPath}\n`);
      }
      return;
    }
    if (options.operation === "capture-ios") {
      const snapshot = await captureNativeIosCausalDebugSnapshot({
        bundleIdentifier: options.bundleIdentifier,
        device: options.device,
        ...(options.timeoutMs === undefined
          ? {}
          : { timeoutMs: options.timeoutMs }),
      });
      process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
      return;
    }
    if (options.operation === "diagnostics-ios") {
      const diagnostics = await captureNativeIosSolidDiagnostics({
        bundleIdentifier: options.bundleIdentifier,
        device: options.device,
        ...(options.durationMs === undefined
          ? {}
          : { durationMs: options.durationMs }),
        ...(options.timeoutMs === undefined
          ? {}
          : { timeoutMs: options.timeoutMs }),
      });
      process.stdout.write(`${JSON.stringify(diagnostics, null, 2)}\n`);
      return;
    }
    if (options.operation === "report-ios") {
      const report = await captureNativeIosCausalDebugReport({
        bundleIdentifier: options.bundleIdentifier,
        device: options.device,
        includeAttributes: options.includeAttributes,
        ...(options.durationMs === undefined
          ? {}
          : { durationMs: options.durationMs }),
        ...(options.timeoutMs === undefined
          ? {}
          : { timeoutMs: options.timeoutMs }),
      });
      if (options.outputPath === undefined) {
        process.stdout.write(report);
      } else {
        const outputPath = await writeNativeCausalDebugReportFile({
          report,
          outputPath: options.outputPath,
        });
        process.stdout.write(`Wrote causal report: ${outputPath}\n`);
      }
      return;
    }
    if (options.operation === "correlate") {
      const correlation = await correlateNativeSolidDiagnosticsFiles({
        diagnosticsPath: options.diagnosticsPath,
        snapshotPath: options.snapshotPath,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      });
      process.stdout.write(
        options.json
          ? `${JSON.stringify(correlation, null, 2)}\n`
          : `${formatNativeSolidDiagnosticsCorrelation(correlation)}\n`,
      );
      return;
    }
    if (
      options.operation === "watch-android" ||
      options.operation === "watch-ios"
    ) {
      let interrupted = false;
      let interruptWait: (() => void) | undefined;
      const interrupt = (): void => {
        interrupted = true;
        interruptWait?.();
      };
      const waitForInterval = (milliseconds: number): Promise<void> =>
        new Promise((resolve) => {
          let settled = false;
          const finish = (): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            interruptWait = undefined;
            resolve();
          };
          const timer = setTimeout(finish, milliseconds);
          interruptWait = finish;
        });
      process.once("SIGINT", interrupt);
      process.once("SIGTERM", interrupt);
      try {
        await watchNativeCausalDebugSnapshots({
          capture: () =>
            options.operation === "watch-android"
              ? captureNativeAndroidCausalDebugSnapshot({
                  packageName: options.packageName,
                  serial: options.serial,
                  ...(options.timeoutMs === undefined
                    ? {}
                    : { timeoutMs: options.timeoutMs }),
                })
              : captureNativeIosCausalDebugSnapshot({
                  bundleIdentifier: options.bundleIdentifier,
                  device: options.device,
                  ...(options.timeoutMs === undefined
                    ? {}
                    : { timeoutMs: options.timeoutMs }),
                }),
          onSnapshot: (snapshot, index) => {
            const inspection = inspectNativeCausalDebugSnapshot(snapshot);
            process.stdout.write(
              options.json
                ? `${JSON.stringify(inspection)}\n`
                : `${index === 0 ? "" : "\n"}Snapshot ${String(index + 1)}\n${formatNativeCausalDebugInspection(inspection)}\n`,
            );
          },
          onCaptureError: (error, consecutiveFailureCount) => {
            const maximum =
              options.maxConsecutiveFailures ??
              NATIVE_CAUSAL_DEBUG_WATCH_DEFAULT_MAX_CONSECUTIVE_FAILURES;
            process.stderr.write(
              `solid-native: device snapshot failed (${String(consecutiveFailureCount)}/${String(maximum)}): ${terminalSafeErrorMessage(error)}\n`,
            );
          },
          shouldContinue: () => !interrupted,
          ...(options.count === undefined ? {} : { count: options.count }),
          ...(options.intervalMs === undefined
            ? {}
            : { intervalMs: options.intervalMs }),
          ...(options.maxConsecutiveFailures === undefined
            ? {}
            : {
                maxConsecutiveFailures: options.maxConsecutiveFailures,
              }),
          dependencies: { wait: waitForInterval },
        });
      } finally {
        interruptWait?.();
        process.off("SIGINT", interrupt);
        process.off("SIGTERM", interrupt);
      }
      return;
    }
    if (options.operation === "compare") {
      const comparison = await compareNativeCausalDebugFiles({
        baselinePath: options.baselinePath,
        candidatePath: options.candidatePath,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.maxP95RegressionPercent === undefined
          ? {}
          : {
              maxP95RegressionPercent: options.maxP95RegressionPercent,
            }),
      });
      process.stdout.write(
        options.json
          ? `${JSON.stringify(comparison, null, 2)}\n`
          : `${formatNativeCausalDebugComparison(comparison)}\n`,
      );
      if (!comparison.ok) process.exitCode = 1;
      return;
    }
    if (options.operation === "diagnostics-inspect") {
      const inspection =
        options.artifactPath === "-"
          ? await inspectNativeSolidDiagnosticsStream(process.stdin)
          : await inspectNativeSolidDiagnosticsFile({
              artifactPath: options.artifactPath,
              ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
            });
      process.stdout.write(
        options.json
          ? `${JSON.stringify(inspection, null, 2)}\n`
          : `${formatNativeSolidDiagnosticsInspection(inspection)}\n`,
      );
      return;
    }
    if (options.operation === "symbolicate") {
      if (options.input === "stack") {
        const result =
          options.stackPath === "-"
            ? await symbolicateNativeStackTraceStream({
                sourceMapPath: options.sourceMapPath,
                stream: process.stdin,
                ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
              })
            : await symbolicateNativeStackTraceFile({
                sourceMapPath: options.sourceMapPath,
                stackPath: options.stackPath,
                ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
              });
        process.stdout.write(
          options.json
            ? `${JSON.stringify(result, null, 2)}\n`
            : `${formatNativeStackTraceSymbolication(result)}\n`,
        );
        return;
      }
      const result = await symbolicateNativeSourceLocations({
        sourceMapPath: options.sourceMapPath,
        locations: options.locations,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      });
      process.stdout.write(
        options.json
          ? `${JSON.stringify(result, null, 2)}\n`
          : `${formatNativeSourceLocationSymbolication(result)}\n`,
      );
      return;
    }
    if (options.operation === "trace") {
      const traceOptions = {
        includeAttributes: options.includeAttributes,
      };
      const trace =
        options.snapshotPath === "-"
          ? await createNativeCausalTraceStream(process.stdin, traceOptions)
          : await createNativeCausalTraceFile({
              ...traceOptions,
              snapshotPath: options.snapshotPath,
              ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
            });
      process.stdout.write(`${JSON.stringify(trace, null, 2)}\n`);
      return;
    }
    if (options.operation === "report") {
      const diagnostics =
        options.diagnosticsPath === undefined
          ? undefined
          : await readNativeSolidDiagnosticsDebugFile(
              options.diagnosticsPath,
              options.cwd,
            );
      const reportOptions = {
        includeAttributes: options.includeAttributes,
        ...(diagnostics === undefined ? {} : { diagnostics }),
        ...(options.operationId === undefined
          ? {}
          : { operationId: options.operationId }),
      };
      const report =
        options.snapshotPath === "-"
          ? await createNativeCausalDebugReportStream(
              process.stdin,
              reportOptions,
            )
          : await createNativeCausalDebugReportFile({
              ...reportOptions,
              snapshotPath: options.snapshotPath,
              ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
            });
      if (options.outputPath === undefined) {
        process.stdout.write(report);
      } else {
        const outputPath = await writeNativeCausalDebugReportFile({
          report,
          outputPath: options.outputPath,
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        });
        process.stdout.write(`Wrote causal report: ${outputPath}\n`);
      }
      return;
    }
    const inspectionOptions = {
      includeAttributes: options.includeAttributes,
      ...(options.operationId === undefined
        ? {}
        : { operationId: options.operationId }),
    };
    const inspection =
      options.snapshotPath === "-"
        ? await inspectNativeCausalDebugStream(process.stdin, inspectionOptions)
        : await inspectNativeCausalDebugFile({
            ...inspectionOptions,
            snapshotPath: options.snapshotPath,
            ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          });
    process.stdout.write(
      options.json
        ? `${JSON.stringify(inspection, null, 2)}\n`
        : `${formatNativeCausalDebugInspection(inspection)}\n`,
    );
    return;
  }
  if (command === "create") {
    const options = parseCreateArguments(args.slice(1));
    if (options === undefined) return;
    const plan = await createNativeCreatePlan({
      projectName: options.projectName,
      skipInstall: options.skipInstall,
      ...(options.directory === undefined
        ? {}
        : { directory: options.directory }),
      ...(options.packageName === undefined
        ? {}
        : { packageName: options.packageName }),
      ...(options.title === undefined ? {} : { title: options.title }),
    });
    if (options.dryRun) {
      process.stdout.write(
        options.json
          ? `${JSON.stringify(plan, null, 2)}\n`
          : `Target: ${plan.targetDirectory}\nCommand: ${formatNativeCreatePlan(plan)}\n`,
      );
      return;
    }
    process.stdout.write(
      `Creating ${plan.projectName} with Solid Native's verified React Native ${VERIFIED_REACT_NATIVE_VERSION} backend...\n`,
    );
    const exitCode = await executeNativeCreatePlan(plan);
    process.exitCode = exitCode;
    if (exitCode === 0) {
      process.stdout.write(`${formatNativeCreateSuccess(plan)}\n`);
    }
    return;
  }
  if (command === "add") {
    const options = parseAddArguments(args.slice(1));
    if (options === undefined) return;
    const plan = await createNativePackageAddPlan({
      capability: options.capability,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    });
    if (options.dryRun) {
      process.stdout.write(
        options.json
          ? `${JSON.stringify(plan, null, 2)}\n`
          : `Project: ${plan.projectRoot}\n${formatNativePackageAddPlan(plan)}\n`,
      );
      return;
    }
    const exitCode = await executeNativePackageAddPlan(plan);
    process.exitCode = exitCode;
    if (exitCode === 0) {
      process.stdout.write(
        `Added Solid Native ${plan.capability} to ${plan.projectRoot}.\n`,
      );
    }
    return;
  }
  if (command === "adapter") {
    const options = parseAdapterArguments(args.slice(1));
    if (options === undefined) return;
    const plan = await createNativeAdapterScaffoldPlan({
      moduleName: options.moduleName,
      packageName: options.packageName,
      platform: options.platform,
      ...(options.bindingsPath === undefined
        ? {}
        : { bindingsPath: options.bindingsPath }),
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.outputPath === undefined
        ? {}
        : { outputPath: options.outputPath }),
    });
    if (options.dryRun) {
      process.stdout.write(
        options.json
          ? `${JSON.stringify(plan, null, 2)}\n`
          : `Adapter: ${plan.outputPath}\nBindings: ${plan.bindingGeneration.outputPath}\nModule: ${plan.moduleName} from ${plan.packageName}${plan.packageVersion === undefined ? "" : `@${plan.packageVersion}`}\n`,
      );
      return;
    }
    await executeNativeAdapterScaffoldPlan(plan);
    process.stdout.write(
      `Created native adapter scaffold: ${plan.outputPath}\n`,
    );
    return;
  }
  if (command === "build") {
    const options = parseBuildArguments(args.slice(1));
    if (options === undefined) return;
    const plan = await createNativeBuildPlan({
      platform: options.platform,
      forwardedArgs: options.forwardedArgs,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    });
    if (options.dryRun) {
      process.stdout.write(
        options.json
          ? `${JSON.stringify(plan, null, 2)}\n`
          : `Project: ${plan.projectRoot}\nCommand: ${formatNativeBuildPlan(plan)}\n`,
      );
      return;
    }
    process.exitCode = await executeNativeBuildPlan(plan);
    return;
  }
  if (command === "bundle") {
    if (args[1] === "sources") {
      const options = parseBundleSourcesArguments(args.slice(2));
      if (options === undefined) return;
      const report = await checkNativeBundleSources(options);
      process.stdout.write(
        options.json
          ? `${JSON.stringify(report, null, 2)}\n`
          : `${formatNativeSourceMapPolicyReport(report)}\n`,
      );
      if (!report.ok) process.exitCode = 1;
      return;
    }
    if (args[1] === "verify") {
      const options = parseBundleVerifyArguments(args.slice(2));
      if (options === undefined) return;
      const report = await verifyNativeBundleManifest(options.manifestPath);
      process.stdout.write(
        options.json
          ? `${JSON.stringify(report, null, 2)}\n`
          : `${formatNativeBundleVerification(report)}\n`,
      );
      if (!report.ok) process.exitCode = 1;
      return;
    }
    const options = parseBundleArguments(args.slice(1));
    if (options === undefined) return;
    const plan = await createNativeBundlePlan({
      platform: options.platform,
      forwardedArgs: options.forwardedArgs,
      hermesSource: options.hermesSource,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.entryFile === undefined
        ? {}
        : { entryFile: options.entryFile }),
      ...(options.outputDirectory === undefined
        ? {}
        : { outputDirectory: options.outputDirectory }),
    });
    if (options.dryRun) {
      process.stdout.write(
        options.json
          ? `${JSON.stringify(plan, null, 2)}\n`
          : `Project: ${plan.projectRoot}\nCommand: ${formatNativeBundlePlan(plan)}\n`,
      );
      return;
    }
    const exitCode = await executeNativeBundlePlan(plan);
    process.exitCode = exitCode;
    if (exitCode === 0) {
      process.stdout.write(
        `Bundle: ${plan.bundlePath}\nSource map: ${plan.sourceMapPath}\nAssets: ${plan.assetsDirectory}\nManifest: ${plan.manifestPath}\n`,
      );
    }
    return;
  }
  if (command === "fingerprint") {
    const options = parseFingerprintArguments(args.slice(1));
    if (options === undefined) return;
    const report = await createNativeFingerprint({
      platform: options.platform,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    });
    process.stdout.write(
      options.json
        ? `${JSON.stringify(report, null, 2)}\n`
        : `${formatNativeFingerprint(report)}\n`,
    );
    return;
  }
  if (command === "compatibility") {
    const options = parseCompatibilityArguments(args.slice(1));
    if (options === undefined) return;
    if (options.operation === "evidence") {
      const report = await createNativeCompatibilityEvidenceReport({
        paths: options.paths,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      });
      process.stdout.write(
        options.json
          ? `${JSON.stringify(report, null, 2)}\n`
          : `${report.evidence.map((entry) => `${entry.sha256}  ${entry.path}`).join("\n")}\n`,
      );
      return;
    }
    const report = await checkNativeCompatibilityCatalog({
      platform: options.platform,
      ...(options.catalogPath === undefined
        ? {}
        : { catalogPath: options.catalogPath }),
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    });
    process.stdout.write(
      options.json
        ? `${JSON.stringify(report, null, 2)}\n`
        : `${formatNativeCompatibilityCatalogReport(report)}\n`,
    );
    if (!report.ok) process.exitCode = 1;
    return;
  }
  if (command === "device") {
    const options = parseDeviceArguments(args.slice(1));
    if (options === undefined) return;
    if (options.operation === "status-ios") {
      const status = await readNativeIosApplicationProcessStatus({
        bundleIdentifier: options.bundleIdentifier,
        device: options.device,
      });
      process.stdout.write(
        options.json
          ? `${JSON.stringify(status, null, 2)}\n`
          : `${formatNativeIosApplicationProcessStatus(status)}\n`,
      );
      return;
    }
    const result = await stopNativeIosApplicationProcesses({
      bundleIdentifier: options.bundleIdentifier,
      device: options.device,
    });
    process.stdout.write(
      options.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : `${formatNativeIosApplicationProcessStop(result)}\n`,
    );
    return;
  }
  if (command === "device-proof") {
    const options = parseDeviceProofArguments(args.slice(1));
    if (options === undefined) return;
    if (options.operation === "create-android") {
      const result = await createNativeAndroidDeviceProof({
        applicationApkPath: options.applicationApkPath,
        applicationBundlePath: options.applicationBundlePath,
        forbiddenSourceFragments: options.forbiddenSourceFragments,
        generatedBindingsPath: options.generatedBindingsPath,
        instrumentationApkPath: options.instrumentationApkPath,
        instrumentationClass: options.instrumentationClass,
        instrumentationResultsDirectory:
          options.instrumentationResultsDirectory,
        instrumentationTest: options.instrumentationTest,
        notBefore: options.notBefore,
        outputPath: options.outputPath,
        requiredSources: options.requiredSources,
        serial: options.serial,
        sourceMapPath: options.sourceMapPath,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      });
      process.stdout.write(
        options.json
          ? `${JSON.stringify(result, null, 2)}\n`
          : `Android device proof: ${result.receiptSha256}\nReceipt: ${result.receiptPath}\nProfile: ${result.profile.profileFingerprint}\n`,
      );
      return;
    }
    if (options.operation === "profile") {
      const receipt = await readNativeDeviceProofReceipt(
        path.resolve(options.cwd ?? process.cwd(), options.proofPath),
      );
      const profile = inspectNativeDeviceProofProfile(receipt);
      process.stdout.write(
        options.json
          ? `${JSON.stringify(profile, null, 2)}\n`
          : `Device-proof profile: ${profile.profileFingerprint}\nReceipt schema: ${String(profile.receiptSchemaVersion)}\nInstrumentation: ${profile.instrumentation.className}#${profile.instrumentation.testName}\nSource-policy checks: ${String(profile.sourcePolicy.length)}\n`,
      );
      return;
    }
    if (options.operation === "sign") {
      const result = await createNativeDeviceProofSignature({
        proofPath: options.proofPath,
        privateKeyPath: options.privateKeyPath,
        keyId: options.keyId,
        projectName: options.projectName,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.outputPath === undefined
          ? {}
          : { outputPath: options.outputPath }),
      });
      process.stdout.write(
        options.json
          ? `${JSON.stringify(result, null, 2)}\n`
          : `Device proof: ${result.signature.proofSha256}\nProject: ${result.signature.projectName}\nKey: ${result.signature.keyId}\nSignature: ${result.signaturePath}\n`,
      );
      return;
    }
    if (options.operation === "signing-request") {
      const result = await createNativeDeviceProofSigningRequest({
        proofPath: options.proofPath,
        keyId: options.keyId,
        projectName: options.projectName,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.outputPath === undefined
          ? {}
          : { outputPath: options.outputPath }),
      });
      process.stdout.write(
        options.json
          ? `${JSON.stringify(result, null, 2)}\n`
          : `Device proof: ${result.request.proofSha256}\nProject: ${result.request.projectName}\nKey: ${result.request.keyId}\nPayload SHA-256: ${result.request.payloadSha256}\nSigning request: ${result.requestPath}\n`,
      );
      return;
    }
    if (options.operation === "assemble-signature") {
      const result = await assembleNativeDeviceProofSignature({
        requestPath: options.requestPath,
        detachedSignaturePath: options.detachedSignaturePath,
        publicKeyPath: options.publicKeyPath,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.outputPath === undefined
          ? {}
          : { outputPath: options.outputPath }),
      });
      process.stdout.write(
        options.json
          ? `${JSON.stringify(result, null, 2)}\n`
          : `Device proof: ${result.signature.proofSha256}\nProject: ${result.signature.projectName}\nKey: ${result.signature.keyId}\nSigning request: ${result.requestPath}\nSignature: ${result.signaturePath}\n`,
      );
      return;
    }
    const deviceProofPolicyOptions = {
      ...(options.expectedProofSha256 === undefined
        ? {}
        : { expectedProofSha256: options.expectedProofSha256 }),
      ...(options.expectedProfileFingerprint === undefined
        ? {}
        : { expectedProfileFingerprint: options.expectedProfileFingerprint }),
      ...(options.expectedSourceRevision === undefined
        ? {}
        : { expectedSourceRevision: options.expectedSourceRevision }),
      ...(options.expectedNativeCompatibilityFingerprint === undefined
        ? {}
        : {
            expectedNativeCompatibilityFingerprint:
              options.expectedNativeCompatibilityFingerprint,
          }),
      ...(options.expectedApplicationArtifactSha256 === undefined
        ? {}
        : {
            expectedApplicationArtifactSha256:
              options.expectedApplicationArtifactSha256,
          }),
      ...(options.minimumMeasuredAt === undefined
        ? {}
        : { minimumMeasuredAt: options.minimumMeasuredAt }),
      ...(options.maximumMeasuredAt === undefined
        ? {}
        : { maximumMeasuredAt: options.maximumMeasuredAt }),
    };
    const verificationOptions =
      options.trustPolicyPath === undefined
        ? {
            proofPath: options.proofPath,
            signaturePath: options.signaturePath,
            ...deviceProofPolicyOptions,
            publicKeyPath: options.publicKeyPath,
            expectedKeyId: options.expectedKeyId,
            projectName: options.projectName,
            ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          }
        : {
            proofPath: options.proofPath,
            signaturePath: options.signaturePath,
            ...deviceProofPolicyOptions,
            trustPolicyPath: options.trustPolicyPath,
            ...(options.minimumTrustPolicySequence === undefined
              ? {}
              : {
                  minimumTrustPolicySequence:
                    options.minimumTrustPolicySequence,
                }),
            ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          };
    if (options.operation === "ingestion") {
      const ingestion =
        await createNativeDeviceProofIngestion(verificationOptions);
      process.stdout.write(
        options.json
          ? `${JSON.stringify(ingestion, null, 2)}\n`
          : `${formatNativeDeviceProofIngestion(ingestion)}\n`,
      );
      return;
    }
    const report = await verifyNativeDeviceProofSignature(verificationOptions);
    process.stdout.write(
      options.json
        ? `${JSON.stringify(report, null, 2)}\n`
        : `${formatNativeDeviceProofSignatureVerification(report)}\n`,
    );
    if (!report.ok) process.exitCode = 1;
    return;
  }
  if (command === "generate") {
    const options = parseGenerateArguments(args.slice(1));
    if (options === undefined) return;
    const plan = await createNativeGeneratePlan({
      platform: options.platform,
      source: options.source,
      generateSolidBindings: options.generateSolidBindings,
      solidLibraries: options.solidLibraries,
      verbose: options.verbose,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.outputPath === undefined
        ? {}
        : { outputPath: options.outputPath }),
      ...(options.solidOutputPath === undefined
        ? {}
        : { solidOutputPath: options.solidOutputPath }),
    });
    if (options.audit) {
      if (plan.solidBindings === undefined) {
        throw new TypeError(
          "generate --audit requires an application or selected dependency Codegen config.",
        );
      }
      const report = createNativeSolidBindingAudit(plan.solidBindings, {
        platform: options.platform,
      });
      process.stdout.write(
        options.json
          ? `${JSON.stringify(report, null, 2)}\n`
          : `Solid binding audit: ${report.components.length} reusable components, ${report.interfaceOnlyComponents.length} interface-only components, ${report.modules.length} TurboModules.\nInputs: ${report.inputs.map((input) => `${input.packageName}${input.packageVersion === undefined ? "" : `@${input.packageVersion}`}`).join(", ")}\n`,
      );
      return;
    }
    if (options.check) {
      if (plan.solidBindings === undefined) {
        throw new TypeError(
          "generate --check requires an application or selected dependency Codegen config.",
        );
      }
      const report = await checkNativeSolidBindingGeneration(
        plan.solidBindings,
      );
      process.stdout.write(
        options.json
          ? `${JSON.stringify(report, null, 2)}\n`
          : `Solid bindings ${report.status}: ${report.outputPath}\n`,
      );
      if (!report.ok) process.exitCode = 1;
      return;
    }
    if (options.dryRun) {
      process.stdout.write(
        options.json
          ? `${JSON.stringify(plan, null, 2)}\n`
          : `Project: ${plan.projectRoot}\nCommand: ${formatNativeGeneratePlan(plan)}${plan.solidBindings === undefined ? "" : `\nSolid bindings: ${plan.solidBindings.outputPath}`}\n`,
      );
      return;
    }
    process.exitCode = await executeNativeGeneratePlan(plan);
    return;
  }
  if (command === "release") {
    const operation = args[1];
    if (operation === "--help" || operation === "-h") {
      process.stdout.write(`${RELEASE_HELP}\n`);
      return;
    }
    if (operation === "verify-android-signing") {
      const options = parseReleaseVerifyAndroidSigningArguments(args.slice(2));
      if (options === undefined) return;
      const extension = path.extname(options.artifactPath).toLowerCase();
      if (extension !== ".aab" && extension !== ".apk") {
        throw new TypeError(
          "release verify-android-signing requires an .aab or .apk artifact.",
        );
      }
      if (
        extension === ".aab" &&
        options.expectedCertificateSha256s.length > 1
      ) {
        throw new TypeError(
          "An Android App Bundle accepts exactly one expected upload certificate.",
        );
      }
      const report =
        extension === ".aab"
          ? await verifyNativeAndroidBundleSigning({
              artifactPath: options.artifactPath,
              ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
              ...(options.expectedCertificateSha256s[0] === undefined
                ? {}
                : {
                    expectedCertificateSha256:
                      options.expectedCertificateSha256s[0],
                  }),
            })
          : await verifyNativeAndroidApkSigning({
              artifactPath: options.artifactPath,
              ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
              ...(options.expectedCertificateSha256s.length === 0
                ? {}
                : {
                    expectedCertificateSha256s:
                      options.expectedCertificateSha256s,
                  }),
            });
      process.stdout.write(
        options.json
          ? `${JSON.stringify(report, null, 2)}\n`
          : `${extension === ".aab" ? formatNativeAndroidBundleSigningReport(report) : formatNativeAndroidApkSigningReport(report)}\n`,
      );
      if (!report.ok) process.exitCode = 1;
      return;
    }
    if (operation === "create") {
      const options = parseReleaseCreateArguments(args.slice(2));
      if (options === undefined) return;
      const releaseOptions = {
        artifactPath: options.artifactPath,
        bundleManifestPath: options.bundleManifestPath,
        channel: options.channel,
        inspectEmbeddedBundle: options.inspectEmbeddedBundle,
        release: options.release,
        sourceRevision: options.sourceRevision,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.outputPath === undefined
          ? {}
          : { outputPath: options.outputPath }),
      };
      const result =
        options.androidSigningCertificateSha256s.length > 0
          ? await createNativeReleaseManifest({
              ...releaseOptions,
              androidSigningCertificateSha256s:
                options.androidSigningCertificateSha256s,
            })
          : options.androidUploadCertificateSha256 !== undefined
            ? await createNativeReleaseManifest({
                ...releaseOptions,
                androidUploadCertificateSha256:
                  options.androidUploadCertificateSha256,
              })
            : await createNativeReleaseManifest(releaseOptions);
      process.stdout.write(
        options.json
          ? `${JSON.stringify(result, null, 2)}\n`
          : `Release: ${result.manifest.releaseFingerprint}\nManifest: ${result.manifestPath}\nUnsigned: verify a trusted signature before delivery.\n`,
      );
      return;
    }
    if (operation === "sign") {
      const options = parseReleaseSignArguments(args.slice(2));
      if (options === undefined) return;
      const result = await createNativeReleaseSignature({
        keyId: options.keyId,
        manifestPath: options.manifestPath,
        privateKeyPath: options.privateKeyPath,
        ...(options.artifactPath === undefined
          ? {}
          : { artifactPath: options.artifactPath }),
        ...(options.bundleManifestPath === undefined
          ? {}
          : { bundleManifestPath: options.bundleManifestPath }),
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.outputPath === undefined
          ? {}
          : { outputPath: options.outputPath }),
      });
      process.stdout.write(
        options.json
          ? `${JSON.stringify(result, null, 2)}\n`
          : `Release: ${result.signature.releaseFingerprint}\nKey: ${result.signature.keyId}\nInputs: ${result.verification === undefined ? "envelope only" : "verified artifact, bundle, and native compatibility"}\nSignature: ${result.signaturePath}\n`,
      );
      return;
    }
    if (operation === "signing-request") {
      const options = parseReleaseSigningRequestArguments(args.slice(2));
      if (options === undefined) return;
      const result = await createNativeReleaseSigningRequest({
        keyId: options.keyId,
        manifestPath: options.manifestPath,
        ...(options.artifactPath === undefined
          ? {}
          : { artifactPath: options.artifactPath }),
        ...(options.bundleManifestPath === undefined
          ? {}
          : { bundleManifestPath: options.bundleManifestPath }),
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.outputPath === undefined
          ? {}
          : { outputPath: options.outputPath }),
      });
      process.stdout.write(
        options.json
          ? `${JSON.stringify(result, null, 2)}\n`
          : `Release: ${result.request.releaseFingerprint}\nKey: ${result.request.keyId}\nInputs: ${result.verification === undefined ? "envelope only" : "verified artifact, bundle, and native compatibility"}\nPayload SHA-256: ${result.request.payloadSha256}\nSigning request: ${result.requestPath}\n`,
      );
      return;
    }
    if (operation === "assemble-signature") {
      const options = parseReleaseAssembleSignatureArguments(args.slice(2));
      if (options === undefined) return;
      const result = await assembleNativeReleaseSignature({
        detachedSignaturePath: options.detachedSignaturePath,
        publicKeyPath: options.publicKeyPath,
        requestPath: options.requestPath,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.outputPath === undefined
          ? {}
          : { outputPath: options.outputPath }),
      });
      process.stdout.write(
        options.json
          ? `${JSON.stringify(result, null, 2)}\n`
          : `Release: ${result.signature.releaseFingerprint}\nKey: ${result.signature.keyId}\nSigning request: ${result.requestPath}\nSignature: ${result.signaturePath}\n`,
      );
      return;
    }
    if (operation === "correlate-device-proof") {
      const options = parseReleaseDeviceCorrelationArguments(args.slice(2));
      if (options === undefined) return;
      const correlation = await createNativeReleaseDeviceCorrelation({
        release: {
          manifestPath: options.manifestPath,
          signaturePath: options.signaturePath,
          bundleManifestPath: options.bundleManifestPath,
          artifactPath: options.artifactPath,
          trustPolicyPath: options.trustPolicyPath,
          ...(options.minimumTrustPolicySequence === undefined
            ? {}
            : {
                minimumTrustPolicySequence: options.minimumTrustPolicySequence,
              }),
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        },
        deviceProof: {
          proofPath: options.deviceProofPath,
          signaturePath: options.deviceSignaturePath,
          trustPolicyPath: options.deviceTrustPolicyPath,
          ...(options.deviceMinimumTrustPolicySequence === undefined
            ? {}
            : {
                minimumTrustPolicySequence:
                  options.deviceMinimumTrustPolicySequence,
              }),
          ...(options.deviceProfileFingerprint === undefined
            ? {}
            : {
                expectedProfileFingerprint: options.deviceProfileFingerprint,
              }),
          ...(options.expectedProofSha256 === undefined
            ? {}
            : { expectedProofSha256: options.expectedProofSha256 }),
          ...(options.minimumMeasuredAt === undefined
            ? {}
            : { minimumMeasuredAt: options.minimumMeasuredAt }),
          ...(options.maximumMeasuredAt === undefined
            ? {}
            : { maximumMeasuredAt: options.maximumMeasuredAt }),
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        },
      });
      process.stdout.write(
        options.json
          ? `${JSON.stringify(correlation, null, 2)}\n`
          : `${formatNativeReleaseDeviceCorrelation(correlation)}\n`,
      );
      return;
    }
    if (operation === "verify") {
      const options = parseReleaseVerifyArguments(args.slice(2));
      if (options === undefined) return;
      const report = await verifyNativeReleaseManifest({
        artifactPath: options.artifactPath,
        bundleManifestPath: options.bundleManifestPath,
        manifestPath: options.manifestPath,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      });
      process.stdout.write(
        options.json
          ? `${JSON.stringify(report, null, 2)}\n`
          : `${formatNativeReleaseVerification(report)}\n`,
      );
      if (!report.ok) process.exitCode = 1;
      return;
    }
    if (operation === "symbolication") {
      const options = parseReleaseVerifySignatureArguments(
        args.slice(2),
        "symbolication",
        true,
      );
      if (options === undefined) return;
      const commonOptions = {
        manifestPath: options.manifestPath,
        signaturePath: options.signaturePath,
        ...(options.trustPolicyPath === undefined
          ? {
              expectedKeyId: options.expectedKeyId!,
              policy: options.policy!,
              publicKeyPath: options.publicKeyPath!,
            }
          : {
              trustPolicyPath: options.trustPolicyPath,
              ...(options.minimumTrustPolicySequence === undefined
                ? {}
                : {
                    minimumTrustPolicySequence:
                      options.minimumTrustPolicySequence,
                  }),
            }),
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      };
      const handoff = await createNativeSymbolicationHandoff({
        ...commonOptions,
        artifactPath: options.artifactPath!,
        bundleManifestPath: options.bundleManifestPath!,
      });
      process.stdout.write(
        options.json
          ? `${JSON.stringify(handoff, null, 2)}\n`
          : `${formatNativeSymbolicationHandoff(handoff)}\n`,
      );
      return;
    }
    if (operation === "verify-signature") {
      const options = parseReleaseVerifySignatureArguments(args.slice(2));
      if (options === undefined) return;
      const commonOptions = {
        manifestPath: options.manifestPath,
        signaturePath: options.signaturePath,
        ...(options.trustPolicyPath === undefined
          ? {
              expectedKeyId: options.expectedKeyId!,
              policy: options.policy!,
              publicKeyPath: options.publicKeyPath!,
            }
          : {
              trustPolicyPath: options.trustPolicyPath,
              ...(options.minimumTrustPolicySequence === undefined
                ? {}
                : {
                    minimumTrustPolicySequence:
                      options.minimumTrustPolicySequence,
                  }),
            }),
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      };
      const report = await verifyNativeReleaseSignature(
        options.envelopeOnly
          ? { ...commonOptions, envelopeOnly: true }
          : {
              ...commonOptions,
              artifactPath: options.artifactPath!,
              bundleManifestPath: options.bundleManifestPath!,
            },
      );
      process.stdout.write(
        options.json
          ? `${JSON.stringify(report, null, 2)}\n`
          : `${formatNativeReleaseSignatureVerification(report)}\n`,
      );
      if (!report.ok) process.exitCode = 1;
      return;
    }
    throw new TypeError(
      "release requires verify-android-signing, create, sign, signing-request, assemble-signature, correlate-device-proof, verify, verify-signature, or symbolication.",
    );
  }
  if (command === "run") {
    const options = parseRunArguments(args.slice(1));
    if (options === undefined) return;
    const plan = await createNativeRunPlan({
      platform: options.platform,
      forwardedArgs: options.forwardedArgs,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    });
    if (options.dryRun) {
      process.stdout.write(
        options.json
          ? `${JSON.stringify(plan, null, 2)}\n`
          : `Project: ${plan.projectRoot}\nCommand: ${formatNativeRunPlan(plan)}\n`,
      );
      return;
    }
    process.exitCode = await executeNativeRunPlan(plan);
    return;
  }
  if (command === "logs") {
    const options = parseLogsArguments(args.slice(1));
    if (options === undefined) return;
    if (options.platform === "ios") {
      const plan = await createNativeIosLogsPlan({
        bundleIdentifier: options.bundleIdentifier,
        device: options.device,
        restart: options.restart,
      });
      if (options.dryRun) {
        process.stdout.write(
          options.json
            ? `${JSON.stringify(plan, null, 2)}\n`
            : `Device: ${plan.device}\nApplication: ${plan.application.name} ${plan.application.version} (${plan.bundleIdentifier})\nRestarts application: yes\nHistorical logs: no\nCommand: ${formatNativeIosLogsPlan(plan)}\n`,
        );
        return;
      }
      process.stderr.write(
        `Restarting ${plan.bundleIdentifier} on ${plan.device} and streaming its launch console; Ctrl-C stops the app and stream.\n`,
      );
      process.exitCode = await executeNativeIosLogsPlan(plan);
      return;
    }
    const plan = await createNativeAndroidLogsPlan({
      packageName: options.packageName,
      ...(options.serial === undefined ? {} : { serial: options.serial }),
      ...(options.since === undefined ? {} : { since: options.since }),
    });
    if (options.dryRun) {
      process.stdout.write(
        options.json
          ? `${JSON.stringify(plan, null, 2)}\n`
          : `Device: ${plan.serial}\nPackage: ${plan.packageName} (UID ${String(plan.uid)})\nCommand: ${formatNativeAndroidLogsPlan(plan)}\n`,
      );
      return;
    }
    process.stderr.write(
      `Streaming ${plan.packageName} on ${plan.serial} (UID ${String(plan.uid)}); press Ctrl-C to stop.\n`,
    );
    process.exitCode = await executeNativeAndroidLogsPlan(plan);
    return;
  }
  if (command === "open") {
    const options = parseOpenArguments(args.slice(1));
    if (options === undefined) return;
    const plan =
      options.platform === "android"
        ? await createNativeDeepLinkPlan({
            platform: "android",
            packageName: options.packageName,
            url: options.url,
            cold: options.cold,
            ...(options.serial === undefined ? {} : { serial: options.serial }),
          })
        : await createNativeDeepLinkPlan({
            platform: "ios",
            bundleIdentifier: options.bundleIdentifier,
            device: options.device,
            url: options.url,
            cold: options.cold,
          });
    if (options.dryRun) {
      process.stdout.write(
        options.json
          ? `${JSON.stringify(plan, null, 2)}\n`
          : `Device: ${plan.platform === "android" ? plan.serial : plan.device}\nApplication: ${plan.platform === "android" ? plan.packageName : `${plan.application.name} ${plan.application.version} (${plan.bundleIdentifier})`}\nMode: ${plan.mode}\nCommand: ${formatNativeDeepLinkPlan(plan)}\n`,
      );
      return;
    }
    const result = await executeNativeDeepLinkPlan(plan);
    process.stdout.write(
      options.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : result.platform === "android"
          ? `Opened ${result.url} in ${result.activity} on ${result.serial} (${result.launchState}, ${result.mode}).\n`
          : `Opened ${result.url} in ${result.bundleIdentifier} on ${result.device} (PID ${String(result.processIdentifier)}, ${result.mode}).\n`,
    );
    return;
  }
  if (command === "start") {
    const options = parseStartArguments(args.slice(1));
    if (options === undefined) return;
    const plan = await createNativeStartPlan({
      forwardedArgs: options.forwardedArgs,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    });
    if (options.dryRun) {
      process.stdout.write(
        options.json
          ? `${JSON.stringify(plan, null, 2)}\n`
          : `Project: ${plan.projectRoot}\nCommand: ${formatNativeStartPlan(plan)}\n`,
      );
      return;
    }
    process.exitCode = await executeNativeStartPlan(plan);
    return;
  }
  if (command === "test") {
    const options = parseTestArguments(args.slice(1));
    if (options === undefined) return;
    const plan = await createNativeTestPlan({
      paths: options.paths,
      runtime: options.runtime,
      watch: options.watch,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.testNamePattern === undefined
        ? {}
        : { testNamePattern: options.testNamePattern }),
    });
    if (options.dryRun) {
      process.stdout.write(
        options.json
          ? `${JSON.stringify(plan, null, 2)}\n`
          : `Project: ${plan.projectRoot}\nRuntime: ${plan.runtime}\nTests: ${plan.testFiles.map((file) => path.relative(plan.projectRoot, file)).join(", ")}\nCommand: ${formatNativeTestPlan(plan)}\n`,
      );
      return;
    }
    process.exitCode = await executeNativeTestPlan(plan);
    return;
  }
  if (command === "upgrade") {
    const options = parseUpgradeArguments(args.slice(1));
    if (options === undefined) return;
    const report = await auditNativeReactNativeUpgrade({
      candidate: options.candidate,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    });
    process.stdout.write(
      options.json
        ? `${JSON.stringify(report, null, 2)}\n`
        : `${formatNativeReactNativeUpgradeReport(report)}\n`,
    );
    if (!report.ok) process.exitCode = 1;
    return;
  }
  if (command !== "doctor") {
    throw new TypeError(`Unknown command ${command}. Run solid-native --help.`);
  }
  const options = parseDoctorArguments(args.slice(1));
  if (args.includes("--help") || args.includes("-h")) return;
  const report = await runDoctor({
    platform: options.platform,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  });
  process.stdout.write(
    options.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : `${formatDoctorReport(report)}\n`,
  );
  if (!report.ok || (options.strict && report.summary.warn > 0)) {
    process.exitCode = 1;
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`solid-native: ${terminalSafeErrorMessage(error)}\n`);
  process.exitCode = 2;
});
