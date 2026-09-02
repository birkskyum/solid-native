# Compatibility fingerprints

`solid-native fingerprint` produces a deterministic, per-platform identity for
the inputs that determine whether delivered JavaScript can safely use an
installed Solid Native binary. It is a local open-source primitive for build
metadata, OTA compatibility, device-test identity, and observability
correlation.

```sh
solid-native fingerprint
solid-native fingerprint --platform ios
solid-native fingerprint --platform android --json
```

The report has schema version 0 and SHA-256 targets for iOS and/or Android. Each
target includes its final `sha256:<hex>` fingerprint and the sorted relative
input labels with their individual SHA-256 digests. File contents and absolute
installed-package paths are not emitted. The report's `projectRoot` is for local
diagnostics and is excluded from the fingerprint payload.

Repository-owned Android memory, list, and causal-telemetry runners, plus the
iOS Activity Monitor memory runner, invoke the built CLI before touching the
device and retain the platform target fingerprint plus its bounded input count
in every result. A malformed or unavailable fingerprint fails the run before an
expensive physical sample begins.

## What the fingerprint means

This is a conservative **native compatibility fingerprint**, not a source,
release, or final-binary digest. Ordinary application source files are excluded
so a JavaScript-only update can retain compatibility. The bootstrap entrypoint
is included because switching away from Solid's host ownership changes the
runtime contract.

Every target hashes a canonical JSON payload containing:

- schema and platform identity;
- application package name;
- exact React Native, Hermes compiler, and Solid runtime versions;
- installed Solid Native core, Fabric Host, runtime, compiler, and Metro versions;
- every file shipped by those five installed Solid Native packages, excluding
  their nested dependency directories;
- the application manifest, pnpm lockfile, OXC/Metro configuration, and
  Solid-owned bootstrap;
- the selected platform's checked-in build configuration and native startup
  chain.

The Android target includes the root and application Gradle files, Gradle
wrapper properties, ProGuard rules, manifest, CMake/JNI entrypoints,
`MainApplication`, and `MainActivity`. The iOS target includes the Podfile and
lock, application Xcode project, AppDelegate, Info.plist, and privacy manifest.
Missing inputs fail closed. Individual inputs are limited to 8 MiB and each
installed package is limited to 1,024 files so an accidentally broad path
cannot turn fingerprinting into an unbounded scan.
Input labels use locale-independent code-unit ordering, so the same unusual
Unicode or mixed-case filenames cannot reorder a fingerprint across CI hosts.

Changing Android-only application integration changes only the Android target;
changing an iOS-only input changes only iOS. A common runtime, compiler,
manifest, or dependency-lock change changes both. Hashing the actual installed
Solid Native artifacts also detects a locally repacked package that reused its
version string.

## Trust boundary

The CLI result is intentionally unsigned. A running application must not trust
a developer-machine report merely because its hash is internally consistent.
A delivery pipeline should bind the compatibility fingerprint to the source
revision, final artifact digest, application version, signing identity, and
update channel, then sign that envelope. Only verified delivery metadata should
populate `CausalTelemetryResource.nativeCompatibilityFingerprint`,
`bundleFingerprint`, `releaseFingerprint`, and `releaseSignerKeyId`, or
authorize an OTA update.

`solid-native bundle` supplies the complementary JavaScript artifact identity:
its unsigned manifest hashes the final production bundle, canonicalized source
map, and copied assets into one bundle fingerprint. Neither local fingerprint
is trusted alone; the delivery envelope binds both identities to release and
channel metadata before signing.
`solid-native bundle verify` can recheck the bundle manifest, each artifact
digest, and the complete asset set before that binding step. This detects local
corruption or stale files but cannot establish provenance for unsigned data.

`solid-native release create` performs that deterministic local binding for one
final native artifact, source revision, application release, and channel. Its
output remains explicitly unsigned; see [release envelopes](release-envelopes.md)
for the verification contract and the provenance work a trusted signer must
still perform.

On Android and iOS, the optional embedded-bundle proof additionally binds the
Hermes bytecode found inside the APK/AAB or IPA to a `--hermes-source` bundle by
recompiling it with the pinned compiler. Android and source-map-enabled iOS
builds require direct byte-for-byte equality. Ordinary Xcode builds receive the
same complete comparison after canonicalizing only the embedded intermediate
filename and Hermes footer. This is stronger than merely placing an unrelated
bundle and binary digest in one envelope.

This separation keeps the compatibility calculation open and inspectable while
leaving credential custody, signing, distribution, retention, and policy in the
application's chosen build service or self-hosted pipeline.
